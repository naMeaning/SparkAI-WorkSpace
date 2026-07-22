"use strict";

const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initializeCanvas, readPsd } = require("ag-psd");
const { PNG } = require("pngjs");
const sharp = require("sharp");
const { exportLayeredPsd, preparePsdRasterSource, PsdExportError } = require("../psd-export.cjs");

sharp.cache(false);

initializeCanvas(undefined, (width, height) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
}));

function writeFixture(filePath, width, height, pixelAt) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha] = pixelAt(x, y);
      png.data[offset] = red;
      png.data[offset + 1] = green;
      png.data[offset + 2] = blue;
      png.data[offset + 3] = alpha;
    }
  }
  writeFileSync(filePath, PNG.sync.write(png));
}

function readSingleLayerPsd(filePath) {
  const psd = readPsd(readFileSync(filePath), {
    useImageData: true,
    skipThumbnail: true,
    logMissingFeatures: false,
  });
  assert.equal(psd.children?.length, 1, "Single image PSD must contain exactly one layer");
  assert(psd.children[0].imageData?.data, "Single image PSD layer must contain RGBA pixels");
  return psd;
}

function assertNoConversionStaging(cacheDir) {
  assert.equal(
    readdirSync(cacheDir).some((entry) => entry.includes(".convert-") && entry.endsWith(".tmp")),
    false,
    "Raster conversion staging files must be cleaned up",
  );
}

async function exportPreparedSingleLayer({ sourcePath, cacheDir, outputPath, layerName, ownerPid }) {
  const prepared = await preparePsdRasterSource({ sourcePath, cacheDir, ownerPid });
  try {
    const result = await exportLayeredPsd({
      outputPath,
      layers: [{ name: layerName, path: prepared.path }],
    });
    return { prepared, result, psd: readSingleLayerPsd(outputPath) };
  } finally {
    if (prepared.converted) rmSync(prepared.path, { force: true });
  }
}

async function expectCode(promise, code) {
  try {
    await promise;
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert(error instanceof PsdExportError, `Expected PsdExportError, received ${error}`);
    assert.equal(error.code, code);
    assert.match(error.message, /[\u4e00-\u9fff]/u, "Errors should be friendly Chinese text");
  }
}

async function main() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "iiimage-psd-selftest-"));
  try {
    const width = 7;
    const height = 5;
    const topPath = path.join(directory, "top.png");
    const middlePath = path.join(directory, "middle.png");
    const bottomPath = path.join(directory, "bottom.png");
    const wrongSizePath = path.join(directory, "wrong.png");
    const outputPath = path.join(directory, "中文分层成果.psd");

    writeFixture(topPath, width, height, (x, y) => [250, 90 + x, 20 + y, (x + y) % 3 === 0 ? 0 : 132]);
    writeFixture(middlePath, width, height, (x, y) => [20 + x, 180, 220 - y, x === y ? 255 : 64]);
    writeFixture(bottomPath, width, height, (x, y) => [30 + x, 40 + y, 80, x === width - 1 ? 180 : 255]);
    writeFixture(wrongSizePath, width + 1, height, () => [0, 0, 0, 255]);

    const stages = [];
    const result = await exportLayeredPsd({
      outputPath,
      width,
      height,
      layers: [
        { name: "标题｜咖啡热流", path: topPath },
        { name: "人物（半透明）", path: middlePath, opacity: 0.75, visible: false },
        { name: "后景｜JVM 字节码", path: bottomPath },
      ],
      onProgress: (entry) => stages.push(entry.stage),
    });

    assert.equal(result.outputPath, outputPath);
    assert.equal(result.width, width);
    assert.equal(result.height, height);
    assert.equal(result.layerCount, 3);
    assert.deepEqual(result.layerNames, ["标题｜咖啡热流", "人物（半透明）", "后景｜JVM 字节码"]);
    assert.equal(result.verification.valid, true);
    assert.equal(result.verification.alphaVerified, true);
    assert.equal(result.verification.rgbaVerified, true);
    assert.equal(result.verification.compositeVerified, true);
    assert.equal(result.verification.composite.photoshopWhiteMatteVerified, true);
    assert(result.verification.layers[0].alpha.transparentPixels > 0);
    assert(result.verification.layers[0].alpha.translucentPixels > 0);
    assert(stages.includes("preflight") && stages.includes("decode") && stages.includes("verify"));
    assert(existsSync(outputPath));

    const independentRead = readPsd(readFileSync(outputPath), {
      useImageData: true,
      skipThumbnail: true,
      logMissingFeatures: false,
    });
    assert.equal(independentRead.width, width);
    assert.equal(independentRead.height, height);
    assert.deepEqual(
      independentRead.children.map((layer) => layer.name),
      ["标题｜咖啡热流", "人物（半透明）", "后景｜JVM 字节码"],
    );
    assert.equal(independentRead.children[1].hidden, true);
    assert.deepEqual(Array.from(independentRead.imageData.data.subarray(0, 4)), [30, 40, 80, 255]);
    const sourceAlpha = 132;
    const expectedSecondPixel = [250, 91, 20].map((channel, channelIndex) =>
      Math.round((channel * sourceAlpha + [31, 40, 80][channelIndex] * (255 - sourceAlpha)) / 255),
    );
    assert.deepEqual(Array.from(independentRead.imageData.data.subarray(4, 8)), [...expectedSecondPixel, 255]);

    const overwriteResult = await exportLayeredPsd({
      outputPath,
      layers: [{ name: "覆盖后的后景", path: bottomPath }],
    });
    assert.equal(overwriteResult.layerCount, 1);
    const overwrittenRead = readPsd(readFileSync(outputPath), {
      useImageData: true,
      skipThumbnail: true,
      logMissingFeatures: false,
    });
    assert.deepEqual(overwrittenRead.children.map((layer) => layer.name), ["覆盖后的后景"]);

    const sixLayerPath = path.join(directory, "六层成果.psd");
    const sixLayerNames = ["文字", "标题", "人物道具", "人物", "前景", "后景"];
    const sixLayerResult = await exportLayeredPsd({
      outputPath: sixLayerPath,
      layers: sixLayerNames.map((name, index) => ({
        name,
        path: [topPath, middlePath, bottomPath][index % 3],
      })),
    });
    assert.equal(sixLayerResult.layerCount, 6);
    assert.deepEqual(sixLayerResult.layerNames, sixLayerNames);

    const rasterCacheDir = path.join(directory, "raster-cache");
    mkdirSync(rasterCacheDir, { recursive: true });
    const directPng = await preparePsdRasterSource({ sourcePath: topPath, cacheDir: rasterCacheDir });
    assert.deepEqual(directPng, { path: topPath, converted: false }, "PNG sources must not be re-encoded");

    const singlePngPath = path.join(directory, "普通透明图片.psd");
    const singlePngResult = await exportLayeredPsd({
      outputPath: singlePngPath,
      layers: [{ name: "普通成果｜透明 PNG", path: topPath }],
    });
    const singlePngRead = readSingleLayerPsd(singlePngPath);
    assert.equal(singlePngResult.width, width);
    assert.equal(singlePngResult.height, height);
    assert.deepEqual(singlePngResult.layerNames, ["普通成果｜透明 PNG"]);
    assert.deepEqual(
      Array.from(singlePngRead.children[0].imageData.data),
      Array.from(PNG.sync.read(readFileSync(topPath)).data),
      "Single layer PNG PSD must preserve exact RGBA pixels",
    );

    const jpegPath = path.join(directory, "商品主图.jpg");
    const jpegRaw = Buffer.alloc(width * height * 3);
    for (let index = 0; index < width * height; index += 1) {
      jpegRaw[index * 3] = (index * 17 + 30) % 256;
      jpegRaw[index * 3 + 1] = (index * 29 + 70) % 256;
      jpegRaw[index * 3 + 2] = (index * 11 + 120) % 256;
    }
    const jpegBytes = await sharp(jpegRaw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    writeFileSync(jpegPath, jpegBytes);
    const jpegExpected = await sharp(jpegBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const jpegExport = await exportPreparedSingleLayer({
      sourcePath: jpegPath,
      cacheDir: rasterCacheDir,
      outputPath: path.join(directory, "商品主图-JPEG.psd"),
      layerName: "商品主图｜JPEG 栅格层",
      ownerPid: process.pid,
    });
    assert.equal(jpegExport.prepared.converted, true);
    assert.equal(jpegExport.prepared.sourceFormat, "jpeg");
    assert.equal(jpegExport.result.width, width);
    assert.equal(jpegExport.result.height, height);
    assert.deepEqual(jpegExport.result.layerNames, ["商品主图｜JPEG 栅格层"]);
    assert.deepEqual(Array.from(jpegExport.psd.children[0].imageData.data), Array.from(jpegExpected.data));

    const webpPath = path.join(directory, "透明商品.webp");
    const webpRaw = Buffer.alloc(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      webpRaw[index * 4] = (index * 31 + 20) % 256;
      webpRaw[index * 4 + 1] = (index * 7 + 80) % 256;
      webpRaw[index * 4 + 2] = (index * 19 + 150) % 256;
      webpRaw[index * 4 + 3] = index % 4 === 0 ? 0 : index % 3 === 0 ? 127 : 255;
    }
    const webpBytes = await sharp(webpRaw, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
    writeFileSync(webpPath, webpBytes);
    const webpExpected = await sharp(webpBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const webpExport = await exportPreparedSingleLayer({
      sourcePath: webpPath,
      cacheDir: rasterCacheDir,
      outputPath: path.join(directory, "透明商品-WEBP.psd"),
      layerName: "透明商品｜WEBP Alpha",
      ownerPid: process.pid,
    });
    assert.equal(webpExport.prepared.sourceFormat, "webp");
    assert.equal(webpExport.prepared.channels, 4);
    assert.deepEqual(Array.from(webpExport.psd.children[0].imageData.data), Array.from(webpExpected.data));

    const parallelPrepared = await Promise.all([
      preparePsdRasterSource({ sourcePath: jpegPath, cacheDir: rasterCacheDir, ownerPid: process.pid }),
      preparePsdRasterSource({ sourcePath: jpegPath, cacheDir: rasterCacheDir, ownerPid: process.pid }),
      preparePsdRasterSource({ sourcePath: webpPath, cacheDir: rasterCacheDir, ownerPid: process.pid }),
    ]);
    try {
      assert.equal(parallelPrepared[0].path, parallelPrepared[1].path, "Concurrent identical conversions should reuse the same cache file");
      assert.notEqual(parallelPrepared[0].path, parallelPrepared[2].path);
      const parallelOutputs = await Promise.all(parallelPrepared.map((prepared, index) => exportLayeredPsd({
        outputPath: path.join(directory, `parallel-${index + 1}.psd`),
        layers: [{ name: `并行图片 ${index + 1}`, path: prepared.path }],
      })));
      assert.deepEqual(parallelOutputs.map((entry) => [entry.width, entry.height]), [[width, height], [width, height], [width, height]]);
    } finally {
      for (const prepared of parallelPrepared) if (prepared.converted) rmSync(prepared.path, { force: true });
    }

    const preAborted = new AbortController();
    preAborted.abort();
    await expectCode(
      preparePsdRasterSource({ sourcePath: jpegPath, cacheDir: rasterCacheDir, signal: preAborted.signal }),
      "PSD_EXPORT_ABORTED",
    );
    assert.deepEqual(readdirSync(rasterCacheDir), [], "A pre-aborted conversion must not create cache files");

    const invalidJpegPath = path.join(directory, "损坏图片.jpg");
    writeFileSync(invalidJpegPath, Buffer.from("not-a-real-jpeg"));
    await expectCode(
      preparePsdRasterSource({ sourcePath: invalidJpegPath, cacheDir: rasterCacheDir, ownerPid: process.pid }),
      "PSD_RASTER_CONVERSION_FAILED",
    );
    assertNoConversionStaging(rasterCacheDir);

    const abortController = new AbortController();
    const abortedConversion = preparePsdRasterSource({
      sourcePath: webpPath,
      cacheDir: rasterCacheDir,
      ownerPid: process.pid,
      signal: abortController.signal,
    });
    abortController.abort();
    await expectCode(abortedConversion, "PSD_EXPORT_ABORTED");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assertNoConversionStaging(rasterCacheDir);
    for (const entry of readdirSync(rasterCacheDir)) rmSync(path.join(rasterCacheDir, entry), { force: true });

    const beforeFailedOverwrite = readFileSync(outputPath);
    await expectCode(
      exportLayeredPsd({
        outputPath,
        layers: [
          { name: "正常", path: topPath },
          { name: "尺寸错误", path: wrongSizePath },
        ],
      }),
      "PSD_EXPORT_DIMENSION_MISMATCH",
    );
    assert.deepEqual(readFileSync(outputPath), beforeFailedOverwrite, "Failed export must not replace an existing PSD");

    await expectCode(
      exportLayeredPsd({
        outputPath: path.join(directory, "pixel-limit.psd"),
        layers: [{ name: "受限图层", path: topPath }],
        limits: { maxCanvasPixels: 10 },
      }),
      "PSD_EXPORT_CANVAS_TOO_LARGE",
    );

    await expectCode(
      exportLayeredPsd({
        outputPath: path.join(directory, "total-pixel-limit.psd"),
        layers: [
          { name: "图层一", path: topPath },
          { name: "图层二", path: middlePath },
        ],
        limits: { maxTotalPixels: 100 },
      }),
      "PSD_EXPORT_PIXEL_LIMIT",
    );

    await expectCode(
      exportLayeredPsd({
        outputPath,
        overwrite: false,
        layers: [{ name: "已存在测试", path: topPath }],
      }),
      "PSD_EXPORT_OUTPUT_EXISTS",
    );
    assert.equal(
      readdirSync(directory).some((entry) => entry.includes(".iiimage-") && entry.endsWith(".tmp")),
      false,
      "Temporary PSD files must be cleaned up",
    );

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        outputBytes: result.outputBytes,
        sha256: result.sha256,
        layerNames: result.layerNames,
        transparencyVerified: result.verification.alphaVerified,
        compositeVerified: result.verification.compositeVerified,
        singleImageFormats: ["png", "jpeg", "webp"],
        parallelRasterConversionVerified: true,
        conversionCleanupVerified: true,
      })}\n`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
