import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const aidebugRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(aidebugRoot, "..");
const defaultDiagnosticsRoot = join(repoRoot, ".diagnostics", "aidebug-review");
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function asPositiveInteger(value, label, { minimum = 1, maximum = 10000 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function parseCrop(value) {
  const separator = String(value || "").indexOf(":");
  if (separator <= 0) {
    throw new Error(`Invalid --crop value "${value}". Expected label:x,y,width,height.`);
  }
  const label = String(value).slice(0, separator).trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(label)) {
    throw new Error(`Invalid crop label "${label}". Use letters, digits, dash, or underscore.`);
  }
  const values = String(value).slice(separator + 1).split(",").map((item) => Number(item.trim()));
  if (values.length !== 4 || values.some((item) => !Number.isInteger(item))) {
    throw new Error(`Invalid --crop value "${value}". Coordinates must be integers.`);
  }
  const [left, top, width, height] = values;
  if (left < 0 || top < 0 || width <= 0 || height <= 0) {
    throw new Error(`Invalid --crop value "${value}". Origin must be non-negative and size must be positive.`);
  }
  return { label, left, top, width, height };
}

function takeValue(argv, index, flag) {
  const current = argv[index];
  if (current === flag) {
    if (index + 1 >= argv.length) throw new Error(`${flag} requires a value.`);
    return { value: argv[index + 1], consumed: 2 };
  }
  if (current.startsWith(`${flag}=`)) return { value: current.slice(flag.length + 1), consumed: 1 };
  return null;
}

function parseArgs(argv) {
  const options = {
    inputs: [],
    crops: [],
    columns: 3,
    tileWidth: 480,
    maxImages: 24,
    outputDir: "",
    selfTest: false,
    help: false
  };
  for (let index = 0; index < argv.length;) {
    const current = argv[index];
    if (current === "--self-test") {
      options.selfTest = true;
      index += 1;
      continue;
    }
    if (current === "--help" || current === "-h") {
      options.help = true;
      index += 1;
      continue;
    }
    const input = takeValue(argv, index, "--input");
    if (input) {
      options.inputs.push(input.value);
      index += input.consumed;
      continue;
    }
    const crop = takeValue(argv, index, "--crop");
    if (crop) {
      options.crops.push(parseCrop(crop.value));
      index += crop.consumed;
      continue;
    }
    const outputDir = takeValue(argv, index, "--output-dir");
    if (outputDir) {
      options.outputDir = outputDir.value;
      index += outputDir.consumed;
      continue;
    }
    const columns = takeValue(argv, index, "--columns");
    if (columns) {
      options.columns = asPositiveInteger(columns.value, "--columns", { maximum: 8 });
      index += columns.consumed;
      continue;
    }
    const tileWidth = takeValue(argv, index, "--tile-width");
    if (tileWidth) {
      options.tileWidth = asPositiveInteger(tileWidth.value, "--tile-width", { minimum: 240, maximum: 1200 });
      index += tileWidth.consumed;
      continue;
    }
    const maxImages = takeValue(argv, index, "--max-images");
    if (maxImages) {
      options.maxImages = asPositiveInteger(maxImages.value, "--max-images", { maximum: 100 });
      index += maxImages.consumed;
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }
  return options;
}

function resolveExistingPath(value, bases = [process.cwd(), repoRoot]) {
  const candidates = isAbsolute(value)
    ? [resolve(value)]
    : bases.map((base) => resolve(base, value));
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function collectDirectoryImages(directory, output, limit) {
  const queue = [directory];
  while (queue.length && output.length < limit) {
    const current = queue.shift();
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (output.length >= limit) break;
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
      } else if (entry.isFile() && imageExtensions.has(extname(entry.name).toLowerCase())) {
        output.push(entryPath);
      }
    }
  }
}

function collectReportCandidates(value, ancestry = [], output = []) {
  if (typeof value === "string") {
    const evidenceKey = ancestry.some((key) => /screen|capture|frame/i.test(key));
    if (evidenceKey && imageExtensions.has(extname(value).toLowerCase())) {
      const leaf = String(ancestry[ancestry.length - 1] || "");
      const priority = /^screenshotPath$/i.test(leaf)
        ? 0
        : leaf === "path" && ancestry.some((key) => /screenshotEvidence/i.test(key))
          ? 1
          : /firstFrame|frame/i.test(leaf)
            ? 3
            : ancestry.some((key) => /native/i.test(key))
              ? 4
              : 2;
      output.push({ value, priority, order: output.length });
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectReportCandidates(item, ancestry, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  Object.entries(value).forEach(([key, item]) => collectReportCandidates(item, [...ancestry, key], output));
  return output;
}

function collectInputImages(inputs, maxImages) {
  const discovered = [];
  for (const input of inputs) {
    const inputPath = resolveExistingPath(input);
    if (!inputPath) throw new Error(`Input does not exist: ${input}`);
    const stat = statSync(inputPath);
    if (stat.isDirectory()) {
      collectDirectoryImages(inputPath, discovered, maxImages);
      continue;
    }
    if (imageExtensions.has(extname(inputPath).toLowerCase())) {
      discovered.push(inputPath);
      continue;
    }
    if (extname(inputPath).toLowerCase() !== ".json") {
      throw new Error(`Unsupported input type: ${inputPath}`);
    }
    const report = JSON.parse(readFileSync(inputPath, "utf8"));
    const reportDir = dirname(inputPath);
    const candidates = collectReportCandidates(report)
      .sort((left, right) => left.priority - right.priority || left.order - right.order);
    for (const candidate of candidates) {
      const resolvedCandidate = resolveExistingPath(candidate.value, [reportDir, repoRoot]);
      if (resolvedCandidate) discovered.push(resolvedCandidate);
    }
  }
  const unique = [...new Set(discovered.map((item) => resolve(item)))].slice(0, maxImages);
  if (!unique.length) throw new Error("No screenshot images were found in the supplied inputs.");
  return unique;
}

function ensureFreshOutputDirectory(outputDir) {
  if (existsSync(outputDir) && readdirSync(outputDir).length > 0) {
    throw new Error(`Output directory is not empty: ${outputDir}`);
  }
  mkdirSync(outputDir, { recursive: true });
}

function safeName(value) {
  return String(value || "image")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function createMontage(items, outputPath, { columns, tileWidth }) {
  const imageHeight = Math.round(tileWidth * 9 / 16);
  const captionHeight = 38;
  const gap = 16;
  const padding = 18;
  const resolvedColumns = Math.min(columns, items.length);
  const rows = Math.ceil(items.length / resolvedColumns);
  const canvasWidth = padding * 2 + resolvedColumns * tileWidth + (resolvedColumns - 1) * gap;
  const canvasHeight = padding * 2 + rows * (imageHeight + captionHeight) + (rows - 1) * gap;
  const composites = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const column = index % resolvedColumns;
    const row = Math.floor(index / resolvedColumns);
    const left = padding + column * (tileWidth + gap);
    const top = padding + row * (imageHeight + captionHeight + gap);
    const image = await sharp(item.path, { failOn: "error", limitInputPixels: 200_000_000 })
      .rotate()
      .resize(tileWidth, imageHeight, {
        fit: "contain",
        background: { r: 11, g: 15, b: 19, alpha: 1 }
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const visibleLabel = `${String(index + 1).padStart(2, "0")} ${item.label}`.slice(0, 68);
    const caption = Buffer.from(
      `<svg width="${tileWidth}" height="${captionHeight}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="100%" height="100%" fill="#1f2830"/>` +
      `<text x="12" y="25" fill="#d7e2ea" font-family="Segoe UI,Arial,sans-serif" font-size="14">${escapeXml(visibleLabel)}</text>` +
      `</svg>`
    );
    composites.push({ input: image, left, top: top + captionHeight });
    composites.push({ input: caption, left, top });
  }
  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 16, g: 20, b: 24, alpha: 1 }
    }
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  return { width: canvasWidth, height: canvasHeight, columns: resolvedColumns, rows };
}

export async function createVisualReview({ sources, crops = [], outputDir, columns = 3, tileWidth = 480 }) {
  ensureFreshOutputDirectory(outputDir);
  const cropDir = join(outputDir, "crops");
  if (crops.length) mkdirSync(cropDir, { recursive: true });
  const sourceEntries = [];
  const cropEntries = [];
  const errors = [];
  for (let index = 0; index < sources.length; index += 1) {
    const sourcePath = resolve(sources[index]);
    const metadata = await sharp(sourcePath, { failOn: "error", limitInputPixels: 200_000_000 }).metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    const sourceEntry = {
      index: index + 1,
      path: sourcePath,
      label: basename(sourcePath),
      width,
      height,
      byteLength: statSync(sourcePath).size,
      sha256: sha256(sourcePath)
    };
    sourceEntries.push(sourceEntry);
    for (const crop of crops) {
      if (crop.left + crop.width > width || crop.top + crop.height > height) {
        errors.push({
          type: "crop-out-of-bounds",
          sourcePath,
          sourceSize: { width, height },
          crop
        });
        continue;
      }
      const cropPath = join(
        cropDir,
        `${String(index + 1).padStart(2, "0")}-${safeName(crop.label)}-${safeName(basename(sourcePath, extname(sourcePath)))}.png`
      );
      await sharp(sourcePath, { failOn: "error", limitInputPixels: 200_000_000 })
        .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
        .png({ compressionLevel: 9 })
        .toFile(cropPath);
      cropEntries.push({
        sourceIndex: index + 1,
        sourcePath,
        path: cropPath,
        label: `${crop.label} · ${basename(sourcePath)}`,
        width: crop.width,
        height: crop.height,
        region: crop,
        byteLength: statSync(cropPath).size,
        sha256: sha256(cropPath)
      });
    }
  }
  const montageItems = [
    ...sourceEntries.map((item) => ({ path: item.path, label: `FULL · ${item.label}` })),
    ...cropEntries.map((item) => ({ path: item.path, label: `CROP · ${item.label}` }))
  ];
  const montagePath = join(outputDir, "montage.png");
  const montage = await createMontage(montageItems, montagePath, { columns, tileWidth });
  const report = {
    ok: errors.length === 0,
    createdAt: new Date().toISOString(),
    outputDir,
    montagePath,
    montage: {
      ...montage,
      byteLength: statSync(montagePath).size,
      sha256: sha256(montagePath)
    },
    sources: sourceEntries,
    crops: cropEntries,
    errors
  };
  const reportPath = join(outputDir, "review.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { ...report, reportPath };
}

async function runSelfTest() {
  const selfTestRoot = join(defaultDiagnosticsRoot, `selftest-${timestamp()}`);
  const inputDir = join(selfTestRoot, "input");
  const outputDir = join(selfTestRoot, "review");
  mkdirSync(inputDir, { recursive: true });
  const first = join(inputDir, "first.png");
  const second = join(inputDir, "second.png");
  await sharp({ create: { width: 640, height: 360, channels: 4, background: { r: 34, g: 112, b: 186, alpha: 1 } } })
    .composite([{ input: Buffer.from('<svg width="640" height="360"><circle cx="320" cy="180" r="105" fill="#f6c85f"/></svg>') }])
    .png()
    .toFile(first);
  await sharp({ create: { width: 640, height: 360, channels: 4, background: { r: 117, g: 55, b: 142, alpha: 1 } } })
    .composite([{ input: Buffer.from('<svg width="640" height="360"><rect x="220" y="80" width="200" height="200" rx="28" fill="#72d6a0"/></svg>') }])
    .png()
    .toFile(second);
  const fixtureReportPath = join(inputDir, "report.json");
  writeFileSync(fixtureReportPath, `${JSON.stringify({
    ok: true,
    results: [
      { screenshotPath: first },
      { screenshotEvidence: { firstFramePath: second } }
    ]
  }, null, 2)}\n`, "utf8");
  const reportSources = collectInputImages([fixtureReportPath], 10);
  const result = await createVisualReview({
    sources: reportSources,
    crops: [{ label: "center", left: 220, top: 80, width: 200, height: 200 }],
    outputDir,
    columns: 2,
    tileWidth: 320
  });
  const montageMetadata = await sharp(result.montagePath).metadata();
  const ok = reportSources.length === 2 && result.ok && result.sources.length === 2 && result.crops.length === 2 &&
    Number(montageMetadata.width || 0) > 0 && Number(montageMetadata.height || 0) > 0 &&
    existsSync(result.reportPath);
  if (!ok) throw new Error("Visual review self-test did not produce complete crop, montage, and manifest evidence.");
  console.log(JSON.stringify({ ok, selfTestRoot, reportPath: result.reportPath, montagePath: result.montagePath }, null, 2));
}

function printHelp() {
  console.log(`Usage:
  node AIDEBUG/visual-review.mjs --input <report.json|image|directory> [options]

Options:
  --input <path>             Repeatable report, screenshot, or directory input.
  --crop <label:x,y,w,h>     Repeatable strict pixel crop applied to each screenshot.
  --output-dir <path>        Must be a new or empty directory. Defaults under .diagnostics.
  --columns <1..8>           Montage columns (default: 3).
  --tile-width <240..1200>   Montage tile width (default: 480).
  --max-images <1..100>      Input safety limit (default: 24).
  --self-test                Generate fixtures and verify crop, montage, and manifest output.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.selfTest) {
    await runSelfTest();
    return;
  }
  if (!options.inputs.length) throw new Error("At least one --input is required.");
  const sources = collectInputImages(options.inputs, options.maxImages);
  const outputDir = options.outputDir
    ? resolve(process.cwd(), options.outputDir)
    : join(defaultDiagnosticsRoot, `review-${timestamp()}`);
  const result = await createVisualReview({
    sources,
    crops: options.crops,
    outputDir,
    columns: options.columns,
    tileWidth: options.tileWidth
  });
  console.log(JSON.stringify({
    ok: result.ok,
    reportPath: result.reportPath,
    montagePath: result.montagePath,
    sourceCount: result.sources.length,
    cropCount: result.crops.length,
    errors: result.errors
  }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
