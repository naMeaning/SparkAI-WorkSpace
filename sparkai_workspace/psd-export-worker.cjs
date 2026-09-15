"use strict";

const {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");
const { getCompositeImageData, getLayerImageData, initializeCanvas, readPsd, writePsdBuffer } = require("ag-psd");
const { PNG } = require("pngjs");

// `ag-psd` otherwise asks for node-canvas even when raw ImageData is requested.
// A plain typed-array factory keeps alpha bytes exact and avoids a native dependency.
initializeCanvas(undefined, (width, height) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
}));

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

class WorkerExportError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "WorkerExportError";
    this.code = code || "PSD_EXPORT_FAILED";
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new WorkerExportError(code, message, details);
}

function progress(stage, completed, total, message) {
  parentPort.postMessage({
    type: "progress",
    progress: { stage, completed, total, message },
  });
}

function pathKey(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function inspectPngHeader(filePath) {
  let descriptor;
  const header = Buffer.alloc(24);
  try {
    descriptor = openSync(filePath, "r");
    const bytesRead = readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead !== header.length || !header.subarray(0, 8).equals(PNG_SIGNATURE)) {
      fail("PSD_EXPORT_INVALID_PNG", `文件“${path.basename(filePath)}”不是有效的 PNG 图片。`);
    }
    if (header.toString("ascii", 12, 16) !== "IHDR") {
      fail("PSD_EXPORT_INVALID_PNG", `文件“${path.basename(filePath)}”缺少 PNG 尺寸信息。`);
    }
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    if (width <= 0 || height <= 0) {
      fail("PSD_EXPORT_INVALID_PNG", `文件“${path.basename(filePath)}”的图片尺寸无效。`);
    }
    return { width, height };
  } catch (error) {
    if (error instanceof WorkerExportError) throw error;
    fail(
      "PSD_EXPORT_SOURCE_READ_FAILED",
      `无法读取 PNG 文件“${path.basename(filePath)}”：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function alphaSummary(data) {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(Math.min(Math.max(Math.floor(data.length / 4), 1), 65_536));
  let chunkLength = 0;
  let transparentPixels = 0;
  let translucentPixels = 0;
  let opaquePixels = 0;
  let minimum = 255;
  let maximum = 0;

  for (let offset = 3; offset < data.length; offset += 4) {
    const alpha = data[offset];
    chunk[chunkLength++] = alpha;
    if (chunkLength === chunk.length) {
      hash.update(chunk);
      chunkLength = 0;
    }
    if (alpha === 0) transparentPixels += 1;
    else if (alpha === 255) opaquePixels += 1;
    else translucentPixels += 1;
    minimum = Math.min(minimum, alpha);
    maximum = Math.max(maximum, alpha);
  }
  if (chunkLength > 0) hash.update(chunk.subarray(0, chunkLength));

  return {
    sha256: hash.digest("hex"),
    minimum,
    maximum,
    transparentPixels,
    translucentPixels,
    opaquePixels,
  };
}

function rgbaHash(data) {
  return createHash("sha256").update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
}

function decodeLayer(layer, expectedWidth, expectedHeight) {
  let decoded;
  try {
    decoded = PNG.sync.read(readFileSync(layer.realPath));
  } catch (error) {
    fail(
      "PSD_EXPORT_PNG_DECODE_FAILED",
      `无法解码图层“${layer.name}”：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (decoded.width !== expectedWidth || decoded.height !== expectedHeight) {
    fail(
      "PSD_EXPORT_DIMENSION_MISMATCH",
      `图层“${layer.name}”解码后的尺寸为 ${decoded.width}×${decoded.height}，与画布 ${expectedWidth}×${expectedHeight} 不一致。`,
    );
  }

  const data = Uint8Array.from(decoded.data);
  return {
    ...layer,
    data,
    alpha: alphaSummary(data),
    rgbaSha256: rgbaHash(data),
  };
}

function compositeLayers(layers, width, height) {
  const output = new Uint8Array(width * height * 4);

  // Input/PSD order is top-to-bottom; source-over composition runs bottom-to-top.
  for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
    const layer = layers[layerIndex];
    if (!layer.visible || layer.opacity <= 0) continue;
    const source = layer.data;
    const opacity = layer.opacity;

    for (let offset = 0; offset < output.length; offset += 4) {
      const sourceAlpha = source[offset + 3] * opacity;
      if (sourceAlpha <= 0) continue;
      const destinationAlpha = output[offset + 3];
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha / 255);
      if (outputAlpha <= 0) continue;

      const destinationWeight = destinationAlpha * (1 - sourceAlpha / 255);
      output[offset] = Math.round((source[offset] * sourceAlpha + output[offset] * destinationWeight) / outputAlpha);
      output[offset + 1] = Math.round(
        (source[offset + 1] * sourceAlpha + output[offset + 1] * destinationWeight) / outputAlpha,
      );
      output[offset + 2] = Math.round(
        (source[offset + 2] * sourceAlpha + output[offset + 2] * destinationWeight) / outputAlpha,
      );
      output[offset + 3] = Math.round(outputAlpha);
    }
  }

  return output;
}

function extractPixelData(owner, fallback) {
  const data = owner?.imageData || fallback(owner);
  if (!data || !data.data || !Number.isInteger(data.width) || !Number.isInteger(data.height)) return null;
  return data;
}

function compareVisibleComposite(expected, actual) {
  if (expected.length !== actual.length) {
    return { valid: false, maxPremultipliedChannelError: Infinity, differingStraightRgbChannels: 0 };
  }
  let maxPremultipliedChannelError = 0;
  let differingStraightRgbChannels = 0;
  for (let offset = 0; offset < expected.length; offset += 4) {
    const alpha = expected[offset + 3];
    if (actual[offset + 3] !== alpha) {
      return { valid: false, maxPremultipliedChannelError: Infinity, differingStraightRgbChannels };
    }
    if (alpha === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(expected[offset + channel] - actual[offset + channel]);
      if (difference > 0) differingStraightRgbChannels += 1;
      maxPremultipliedChannelError = Math.max(maxPremultipliedChannelError, (difference * alpha) / 255);
    }
  }
  // PSD's composite channels use an 8-bit white matte. Removing that matte on
  // read can amplify straight-RGB rounding at low alpha, while the visible
  // premultiplied result remains within 1.5 channel values (one truncation
  // while writing the matte, plus at most half a value while unmatting).
  return {
    valid: maxPremultipliedChannelError <= 1.51,
    maxPremultipliedChannelError,
    differingStraightRgbChannels,
  };
}

function verifyPsd(buffer, expected) {
  let parsed;
  try {
    parsed = readPsd(buffer, {
      useImageData: true,
      skipThumbnail: true,
      logMissingFeatures: false,
      totalMemoryLimit: Math.min(2_000_000_000, Math.max(64 * 1024 * 1024, expected.totalPixels * 16)),
    });
  } catch (error) {
    fail(
      "PSD_EXPORT_VERIFY_READ_FAILED",
      `PSD 已编码但无法回读验证：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsed.width !== expected.width || parsed.height !== expected.height) {
    fail(
      "PSD_EXPORT_VERIFY_DIMENSION_FAILED",
      `PSD 回读尺寸 ${parsed.width}×${parsed.height} 与预期 ${expected.width}×${expected.height} 不一致。`,
    );
  }

  const children = Array.isArray(parsed.children) ? parsed.children : [];
  if (children.length !== expected.layers.length) {
    fail(
      "PSD_EXPORT_VERIFY_LAYER_COUNT_FAILED",
      `PSD 回读得到 ${children.length} 个图层，预期为 ${expected.layers.length} 个。`,
    );
  }

  const verifiedLayers = [];
  const compositeInputs = [];
  for (let index = 0; index < expected.layers.length; index += 1) {
    const wanted = expected.layers[index];
    const actual = children[index];
    if (actual.name !== wanted.name) {
      fail(
        "PSD_EXPORT_VERIFY_LAYER_NAME_FAILED",
        `PSD 第 ${index + 1} 层名称“${actual.name || "（空）"}”与预期“${wanted.name}”不一致。`,
      );
    }
    if ((actual.hidden === true) === wanted.visible) {
      fail("PSD_EXPORT_VERIFY_VISIBILITY_FAILED", `PSD 图层“${wanted.name}”的显示状态与预期不一致。`);
    }
    if (Math.abs((actual.opacity ?? 1) - wanted.opacity) > 1 / 255 + Number.EPSILON) {
      fail("PSD_EXPORT_VERIFY_OPACITY_FAILED", `PSD 图层“${wanted.name}”的不透明度与预期不一致。`);
    }

    const imageData = extractPixelData(actual, getLayerImageData);
    if (!imageData || imageData.width !== expected.width || imageData.height !== expected.height) {
      fail(
        "PSD_EXPORT_VERIFY_LAYER_DIMENSION_FAILED",
        `PSD 图层“${wanted.name}”没有保留 ${expected.width}×${expected.height} 的完整画布。`,
      );
    }
    const actualRgbaHash = rgbaHash(imageData.data);
    const actualAlpha = alphaSummary(imageData.data);
    if (actualAlpha.sha256 !== wanted.alpha.sha256) {
      fail("PSD_EXPORT_VERIFY_ALPHA_FAILED", `PSD 图层“${wanted.name}”的 Alpha 透明度在回读后发生变化。`);
    }
    if (actualRgbaHash !== wanted.rgbaSha256) {
      fail("PSD_EXPORT_VERIFY_RGBA_FAILED", `PSD 图层“${wanted.name}”的 RGBA 像素在回读后发生变化。`);
    }
    verifiedLayers.push({
      name: wanted.name,
      visible: wanted.visible,
      opacity: wanted.opacity,
      alpha: actualAlpha,
      rgbaSha256: actualRgbaHash,
    });
    compositeInputs.push({
      data: imageData.data,
      visible: wanted.visible,
      opacity: wanted.opacity,
    });
  }

  const compositeImageData = extractPixelData(parsed, getCompositeImageData);
  if (
    !compositeImageData ||
    compositeImageData.width !== expected.width ||
    compositeImageData.height !== expected.height
  ) {
    fail("PSD_EXPORT_VERIFY_COMPOSITE_FAILED", "PSD 没有保留完整尺寸的合成预览数据。");
  }
  const compositeRgbaSha256 = rgbaHash(compositeImageData.data);
  const compositeAlpha = alphaSummary(compositeImageData.data);
  if (compositeAlpha.sha256 !== expected.compositeAlpha.sha256) {
    fail("PSD_EXPORT_VERIFY_COMPOSITE_ALPHA_FAILED", "PSD 合成预览的 Alpha 透明度在回读后发生变化。");
  }
  const recomposed = compositeLayers(compositeInputs, expected.width, expected.height);
  const recomposedAlpha = alphaSummary(recomposed);
  if (compositeAlpha.sha256 !== recomposedAlpha.sha256) {
    fail("PSD_EXPORT_VERIFY_COMPOSITE_ALPHA_FAILED", "PSD 合成预览与已验证图层的 Alpha 合成结果不一致。");
  }
  const visibleComparison = compareVisibleComposite(recomposed, compositeImageData.data);
  if (!visibleComparison.valid) {
    fail("PSD_EXPORT_VERIFY_COMPOSITE_RGBA_FAILED", "PSD 合成预览与图层合成后的可见像素不一致。", {
      maxPremultipliedChannelError: visibleComparison.maxPremultipliedChannelError,
    });
  }

  return {
    valid: true,
    layerCount: verifiedLayers.length,
    layerNames: verifiedLayers.map((layer) => layer.name),
    rgbaVerified: true,
    alphaVerified: true,
    compositeVerified: true,
    layers: verifiedLayers,
    composite: {
      alpha: compositeAlpha,
      sourceRgbaSha256: rgbaHash(recomposed),
      readbackRgbaSha256: compositeRgbaSha256,
      photoshopWhiteMatteVerified: true,
      maxPremultipliedChannelError: visibleComparison.maxPremultipliedChannelError,
      differingStraightRgbChannels: visibleComparison.differingStraightRgbChannels,
    },
  };
}

function writeAtomically(buffer, temporaryPath, outputPath, overwrite) {
  const outputDirectory = path.dirname(outputPath);
  let realOutputDirectory;
  let realTemporaryDirectory;
  try {
    mkdirSync(outputDirectory, { recursive: true });
    realOutputDirectory = realpathSync(outputDirectory);
    realTemporaryDirectory = realpathSync(path.dirname(temporaryPath));
  } catch (error) {
    fail(
      "PSD_EXPORT_OUTPUT_DIRECTORY_FAILED",
      `无法使用 PSD 保存文件夹：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (pathKey(realOutputDirectory) !== pathKey(realTemporaryDirectory)) {
    fail("PSD_EXPORT_UNSAFE_TEMP_PATH", "PSD 临时文件必须与目标文件位于同一文件夹。");
  }

  if (existsSync(outputPath)) {
    let outputStatus;
    try {
      outputStatus = lstatSync(outputPath);
    } catch (error) {
      fail(
        "PSD_EXPORT_OUTPUT_INSPECT_FAILED",
        `无法检查已有 PSD 文件：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (outputStatus.isSymbolicLink() || !outputStatus.isFile()) {
      fail("PSD_EXPORT_UNSAFE_OUTPUT", "PSD 目标路径不是可安全替换的普通文件。");
    }
    if (!overwrite) {
      fail("PSD_EXPORT_OUTPUT_EXISTS", `文件“${path.basename(outputPath)}”已存在。`);
    }
  }

  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx");
    writeFileSync(descriptor, buffer);
    fsyncSync(descriptor);
  } catch (error) {
    fail(
      "PSD_EXPORT_WRITE_FAILED",
      `无法写入 PSD 临时文件：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function preflight(request) {
  const outputPath = path.resolve(request.outputPath);
  const temporaryPath = path.resolve(request.temporaryPath);
  if (path.extname(outputPath).toLowerCase() !== ".psd") {
    fail("PSD_EXPORT_OUTPUT_EXTENSION", "PSD 输出文件必须使用 .psd 扩展名。");
  }
  if (pathKey(outputPath) === pathKey(temporaryPath)) {
    fail("PSD_EXPORT_UNSAFE_TEMP_PATH", "PSD 临时文件不能与目标文件相同。");
  }
  if (!Array.isArray(request.layers) || request.layers.length === 0) {
    fail("PSD_EXPORT_NO_LAYERS", "没有可导出的 PNG 图层。");
  }
  if (request.layers.length > request.limits.maxLayers) {
    fail(
      "PSD_EXPORT_TOO_MANY_LAYERS",
      `共有 ${request.layers.length} 个图层，超过安全上限 ${request.limits.maxLayers} 个。`,
    );
  }

  const layers = [];
  let inputBytes = 0;
  let width = null;
  let height = null;

  for (let index = 0; index < request.layers.length; index += 1) {
    const input = request.layers[index];
    const sourcePath = path.resolve(input.path);
    let sourceStatus;
    try {
      sourceStatus = lstatSync(sourcePath);
    } catch (error) {
      fail(
        "PSD_EXPORT_SOURCE_NOT_FOUND",
        `找不到图层“${input.name}”的 PNG 文件：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (sourceStatus.isSymbolicLink()) {
      fail("PSD_EXPORT_UNSAFE_SOURCE", `图层“${input.name}”使用了符号链接，无法安全导出。`);
    }
    let realPath;
    let status;
    try {
      realPath = realpathSync(sourcePath);
      status = statSync(realPath);
    } catch (error) {
      fail(
        "PSD_EXPORT_SOURCE_READ_FAILED",
        `无法读取图层“${input.name}”的 PNG 文件：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!status.isFile()) {
      fail("PSD_EXPORT_SOURCE_NOT_FILE", `图层“${input.name}”不是普通 PNG 文件。`);
    }
    if (path.extname(realPath).toLowerCase() !== ".png") {
      fail("PSD_EXPORT_SOURCE_NOT_PNG", `图层“${input.name}”必须使用 PNG 文件。`);
    }
    if (pathKey(realPath) === pathKey(outputPath)) {
      fail("PSD_EXPORT_PATH_CONFLICT", `图层“${input.name}”与 PSD 输出文件使用了同一路径。`);
    }

    inputBytes += status.size;
    if (inputBytes > request.limits.maxInputBytes) {
      fail(
        "PSD_EXPORT_INPUT_TOO_LARGE",
        `PNG 图层总体积超过 ${(request.limits.maxInputBytes / 1024 / 1024).toFixed(0)} MB 安全上限。`,
      );
    }

    const dimensions = inspectPngHeader(realPath);
    if (dimensions.width > request.limits.maxDimension || dimensions.height > request.limits.maxDimension) {
      fail(
        "PSD_EXPORT_DIMENSION_TOO_LARGE",
        `图层“${input.name}”尺寸为 ${dimensions.width}×${dimensions.height}，单边不能超过 ${request.limits.maxDimension} 像素。`,
      );
    }
    if (width === null) {
      width = dimensions.width;
      height = dimensions.height;
    } else if (dimensions.width !== width || dimensions.height !== height) {
      fail(
        "PSD_EXPORT_DIMENSION_MISMATCH",
        `图层“${input.name}”尺寸为 ${dimensions.width}×${dimensions.height}，必须与其他图层 ${width}×${height} 完全一致。`,
      );
    }
    layers.push({ ...input, realPath });
    progress("preflight", index + 1, request.layers.length, `正在检查图层 ${index + 1}/${request.layers.length}`);
  }

  if ((request.width && request.width !== width) || (request.height && request.height !== height)) {
    fail(
      "PSD_EXPORT_DIMENSION_MISMATCH",
      `PNG 图层实际尺寸 ${width}×${height} 与指定画布 ${request.width || width}×${request.height || height} 不一致。`,
    );
  }

  const canvasPixels = width * height;
  const totalPixels = canvasPixels * (layers.length + 1);
  if (!Number.isSafeInteger(canvasPixels) || canvasPixels > request.limits.maxCanvasPixels) {
    fail(
      "PSD_EXPORT_CANVAS_TOO_LARGE",
      `画布共有 ${canvasPixels.toLocaleString("zh-CN")} 像素，超过 ${request.limits.maxCanvasPixels.toLocaleString("zh-CN")} 像素安全上限。`,
    );
  }
  if (!Number.isSafeInteger(totalPixels) || totalPixels > request.limits.maxTotalPixels) {
    fail(
      "PSD_EXPORT_PIXEL_LIMIT",
      `图层与合成图共需处理 ${totalPixels.toLocaleString("zh-CN")} 像素，超过 ${request.limits.maxTotalPixels.toLocaleString("zh-CN")} 像素安全上限。请减少图层或图片尺寸。`,
    );
  }

  return { outputPath, temporaryPath, layers, width, height, totalPixels, inputBytes };
}

function run() {
  const prepared = preflight(workerData);
  const decodedLayers = [];
  for (let index = 0; index < prepared.layers.length; index += 1) {
    decodedLayers.push(decodeLayer(prepared.layers[index], prepared.width, prepared.height));
    progress("decode", index + 1, prepared.layers.length, `正在读取图层 ${index + 1}/${prepared.layers.length}`);
  }

  progress("composite", 0, 1, "正在生成 PSD 合成预览");
  let composite = compositeLayers(decodedLayers, prepared.width, prepared.height);
  const compositeAlpha = alphaSummary(composite);
  progress("composite", 1, 1, "PSD 合成预览已生成");

  let psd = {
    width: prepared.width,
    height: prepared.height,
    bitsPerChannel: 8,
    colorMode: 3,
    imageData: {
      width: prepared.width,
      height: prepared.height,
      data: composite,
    },
    children: decodedLayers.map((layer) => ({
      name: layer.name,
      top: 0,
      left: 0,
      bottom: prepared.height,
      right: prepared.width,
      blendMode: "normal",
      opacity: layer.opacity,
      hidden: !layer.visible,
      imageData: {
        width: prepared.width,
        height: prepared.height,
        data: layer.data,
      },
    })),
  };

  progress("encode", 0, 1, "正在编码 Photoshop PSD");
  let psdBuffer;
  try {
    psdBuffer = writePsdBuffer(psd, {
      generateThumbnail: false,
      trimImageData: false,
      noBackground: true,
      logMissingFeatures: false,
    });
  } catch (error) {
    fail(
      "PSD_EXPORT_ENCODE_FAILED",
      `无法编码 Photoshop PSD：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (psdBuffer.length > workerData.limits.maxOutputBytes) {
    fail(
      "PSD_EXPORT_OUTPUT_TOO_LARGE",
      `PSD 文件约 ${(psdBuffer.length / 1024 / 1024).toFixed(1)} MB，超过安全输出上限。`,
    );
  }
  progress("encode", 1, 1, "Photoshop PSD 已编码");

  writeAtomically(psdBuffer, prepared.temporaryPath, prepared.outputPath, workerData.overwrite);
  const expectedLayers = decodedLayers.map((layer) => ({
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    alpha: layer.alpha,
    rgbaSha256: layer.rgbaSha256,
  }));
  // Encoding has finished. Drop the large source references before decoding the
  // PSD again so a six-layer 4K export does not need two complete layer stacks.
  for (const layer of decodedLayers) layer.data = null;
  psd.children = undefined;
  psd.imageData = undefined;
  psd = null;
  composite = null;
  psdBuffer = null;

  progress("verify", 0, 1, "正在从磁盘回读验证 PSD 图层");
  let diskBuffer;
  try {
    diskBuffer = readFileSync(prepared.temporaryPath);
  } catch (error) {
    fail(
      "PSD_EXPORT_VERIFY_READ_FAILED",
      `无法从磁盘回读 PSD 临时文件：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const verification = verifyPsd(diskBuffer, {
    width: prepared.width,
    height: prepared.height,
    totalPixels: prepared.totalPixels,
    layers: expectedLayers,
    compositeAlpha,
  });
  progress("verify", 1, 1, "PSD 图层、透明度与合成预览验证通过");

  if (!workerData.overwrite && existsSync(prepared.outputPath)) {
    fail("PSD_EXPORT_OUTPUT_EXISTS", `文件“${path.basename(prepared.outputPath)}”已存在。`);
  }
  try {
    renameSync(prepared.temporaryPath, prepared.outputPath);
  } catch (error) {
    fail(
      "PSD_EXPORT_COMMIT_FAILED",
      `PSD 已通过验证，但无法保存到目标位置：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let finalStatus;
  try {
    finalStatus = statSync(prepared.outputPath);
  } catch (error) {
    fail(
      "PSD_EXPORT_FINAL_INSPECT_FAILED",
      `PSD 已保存，但无法读取文件状态：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    outputPath: prepared.outputPath,
    width: prepared.width,
    height: prepared.height,
    layerCount: expectedLayers.length,
    layerNames: expectedLayers.map((layer) => layer.name),
    inputBytes: prepared.inputBytes,
    outputBytes: finalStatus.size,
    sha256: createHash("sha256").update(diskBuffer).digest("hex"),
    verification,
  };
}

try {
  if (!parentPort || !workerData) fail("PSD_EXPORT_WORKER_CONTEXT", "PSD Worker 缺少主进程上下文。");
  const result = run();
  parentPort.postMessage({ type: "result", result });
} catch (error) {
  try {
    if (workerData?.temporaryPath && existsSync(workerData.temporaryPath)) {
      rmSync(workerData.temporaryPath, { force: true });
    }
  } catch {
    // Preserve the original export error.
  }
  parentPort?.postMessage({
    type: "error",
    error: {
      code: error?.code || "PSD_EXPORT_FAILED",
      message:
        error instanceof WorkerExportError
          ? error.message
          : `PSD 导出失败：${error instanceof Error ? error.message : String(error)}`,
      details: error?.details,
      stack: error instanceof Error ? error.stack : undefined,
    },
  });
}
