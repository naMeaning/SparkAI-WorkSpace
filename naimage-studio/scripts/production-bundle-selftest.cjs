const { existsSync, readdirSync, readFileSync, statSync } = require("node:fs");
const { basename, join, resolve } = require("node:path");

const root = resolve(__dirname, "..");
const dist = join(root, "dist");
const assets = join(dist, "assets");

function filesRecursively(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(path) : [path];
  });
}

if (!existsSync(join(dist, "index.html"))) throw new Error("dist/index.html missing; run pnpm run build first");
if (!existsSync(join(dist, "naimage.png"))) throw new Error("production icon missing");

const jsFiles = filesRecursively(assets).filter((path) => path.endsWith(".js"));
const cssFiles = filesRecursively(assets).filter((path) => path.endsWith(".css"));
if (!jsFiles.length || !cssFiles.length) throw new Error("production JS/CSS bundle missing");

const jsBytes = jsFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const cssBytes = cssFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const totalBytes = filesRecursively(dist).reduce((sum, path) => sum + statSync(path).size, 0);
const jsText = jsFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const indexText = readFileSync(join(dist, "index.html"), "utf8");
const jsByName = new Map(jsFiles.map((path) => [basename(path), path]));
const initialNames = new Set(
  [...indexText.matchAll(/(?:src|href)=["'][^"']*\/([^/"']+\.js)["']/g)]
    .map((match) => match[1])
    .filter((name) => jsByName.has(name))
);
const queue = [...initialNames];
while (queue.length) {
  const name = queue.shift();
  const path = jsByName.get(name);
  if (!path) continue;
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/(?:from\s*|import\s*)["']\.\/([^"']+\.js)["']/g)) {
    const dependency = match[1];
    if (!jsByName.has(dependency) || initialNames.has(dependency)) continue;
    initialNames.add(dependency);
    queue.push(dependency);
  }
}
const initialJsFiles = jsFiles.filter((path) => initialNames.has(basename(path)));
const asyncJsFiles = jsFiles.filter((path) => !initialNames.has(basename(path)));
const initialJsBytes = initialJsFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const asyncJsBytes = asyncJsFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const forbiddenMarkers = [
  "runLayerStackSuite",
  "runMixedStressSuite",
  "runCanvasImageCollectionSuite",
  "__naimageDebugApplyAgentActions",
  "__naimageDebugSeedAgentMessages",
  "__naimageAIDebug"
];
const leakedMarkers = forbiddenMarkers.filter((marker) => jsText.includes(marker));

const limits = {
  initialJsBytes: 600_000,
  asyncJsBytes: 180_000,
  // Source modularization adds small ESM/chunk boundary overhead. Keep the
  // user-visible initial-load gate unchanged and allow only a narrow total-JS
  // envelope for the additional module graph metadata.
  jsBytes: 652_000,
  cssBytes: 220_000,
  totalBytes: 1_000_000
};
const failures = [];
if (leakedMarkers.length) failures.push(`AIDebug markers leaked: ${leakedMarkers.join(", ")}`);
if (!initialJsFiles.length) failures.push("production entry JS could not be identified from dist/index.html");
if (initialJsBytes > limits.initialJsBytes) failures.push(`initial JS ${initialJsBytes} > ${limits.initialJsBytes}`);
if (asyncJsBytes > limits.asyncJsBytes) failures.push(`async JS ${asyncJsBytes} > ${limits.asyncJsBytes}`);
if (jsBytes > limits.jsBytes) failures.push(`JS ${jsBytes} > ${limits.jsBytes}`);
if (cssBytes > limits.cssBytes) failures.push(`CSS ${cssBytes} > ${limits.cssBytes}`);
if (totalBytes > limits.totalBytes) failures.push(`dist ${totalBytes} > ${limits.totalBytes}`);

const report = {
  ok: failures.length === 0,
  jsBytes,
  initialJsBytes,
  asyncJsBytes,
  initialJsFiles: initialJsFiles.map((path) => basename(path)),
  asyncJsFiles: asyncJsFiles.map((path) => basename(path)),
  cssBytes,
  totalBytes,
  iconBytes: statSync(join(dist, "naimage.png")).size,
  limits,
  leakedMarkers,
  failures
};

console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
