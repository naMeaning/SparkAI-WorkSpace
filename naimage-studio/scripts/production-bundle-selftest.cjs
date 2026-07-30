const { existsSync, readdirSync, readFileSync, statSync } = require("node:fs");
const { basename, join, resolve } = require("node:path");
const {
  ADVISORY_BUDGET_KEYS,
  BUNDLE_LIMITS,
  HARD_BUDGET_KEYS,
  classifyBundleBudgets
} = require("./production-bundle-policy.cjs");

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
if (!existsSync(join(dist, "glass-theme-bootstrap.js"))) throw new Error("production glass theme bootstrap missing");

const jsFiles = filesRecursively(assets).filter((path) => path.endsWith(".js"));
const cssFiles = filesRecursively(assets).filter((path) => path.endsWith(".css"));
if (!jsFiles.length || !cssFiles.length) throw new Error("production JS/CSS bundle missing");

const allJsBytes = jsFiles.reduce((sum, path) => sum + statSync(path).size, 0);
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
const pluginJsFiles = jsFiles.filter((path) => /^(?:plugin-[^.]+|commerce-[a-z0-9-]+-dialog-[^.]+)\.js$/i.test(basename(path)));
const pluginInitialJsFiles = pluginJsFiles.filter((path) => initialNames.has(basename(path)));
const coreAsyncJsFiles = asyncJsFiles.filter((path) => !pluginJsFiles.includes(path));
const pluginJsBytes = pluginJsFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const coreJsBytes = allJsBytes - pluginJsBytes;
const initialJsBytes = initialJsFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const asyncJsBytes = asyncJsFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const coreAsyncJsBytes = coreAsyncJsFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const forbiddenMarkers = [
  "runLayerStackSuite",
  "runMixedStressSuite",
  "runCanvasImageCollectionSuite",
  "__naimageDebugApplyAgentActions",
  "__naimageDebugSeedAgentMessages",
  "__naimageAIDebug"
];
const leakedMarkers = forbiddenMarkers.filter((marker) => jsText.includes(marker));

const limits = BUNDLE_LIMITS;
const failures = [];
if (leakedMarkers.length) failures.push(`AIDebug markers leaked: ${leakedMarkers.join(", ")}`);
if (!initialJsFiles.length) failures.push("production entry JS could not be identified from dist/index.html");
if (!pluginJsFiles.length) failures.push("plugin JS chunks missing; expected plugin-* or commerce-*-dialog chunks");
if (pluginInitialJsFiles.length) failures.push(`plugin JS must remain async: ${pluginInitialJsFiles.map((path) => basename(path)).join(", ")}`);
const budgetAssessment = classifyBundleBudgets({
  initialJsBytes,
  coreAsyncJsBytes,
  coreJsBytes,
  pluginJsBytes,
  cssBytes,
  totalBytes
});
failures.push(...budgetAssessment.failures);

const report = {
  ok: failures.length === 0,
  allJsBytes,
  coreJsBytes,
  pluginJsBytes,
  pluginJsFiles: pluginJsFiles.map((path) => basename(path)),
  initialJsBytes,
  asyncJsBytes,
  coreAsyncJsBytes,
  initialJsFiles: initialJsFiles.map((path) => basename(path)),
  asyncJsFiles: asyncJsFiles.map((path) => basename(path)),
  cssBytes,
  totalBytes,
  iconBytes: statSync(join(dist, "naimage.png")).size,
  glassThemeBootstrapBytes: statSync(join(dist, "glass-theme-bootstrap.js")).size,
  limits,
  gatePolicy: {
    hardBudgets: HARD_BUDGET_KEYS,
    advisoryBudgets: ADVISORY_BUDGET_KEYS,
    structuralChecks: ["AIDebug leakage", "entry detection", "plugin chunk presence", "plugin async boundary"],
    productPerformance: "separate hard release gate"
  },
  budgetChecks: budgetAssessment.checks,
  leakedMarkers,
  advisories: budgetAssessment.advisories,
  failures
};

console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
