const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const {
  buildProductionSymbolPlan,
  buildSymbolPlan,
  optimizeBundledCss,
  transformCode,
  transformCss
} = require("./production-symbol-compaction.cjs");

const fixturePlan = buildSymbolPlan({
  cssSources: [{
    filePath: "fixture.css",
    code: ".workspace-surface-long,.dynamic-node-image,.comment-only-retired{color:var(--workspace-surface-color);animation:workspace-surface-enter 120ms ease both}@keyframes workspace-surface-enter{from{opacity:0}to{opacity:1}}@keyframes retired-surface-pulse{to{opacity:.5}}"
  }],
  codeSources: [{
    filePath: "fixture.tsx",
    code: "// className=\"comment-only-retired\"\nconst view = <div className={`workspace-surface-long ${kind ? `dynamic-node-${kind}` : ''}`} />;"
  }],
  protectedSources: []
});

assert.ok(fixturePlan.classes.has("workspace-surface-long"));
assert.equal(fixturePlan.classes.has("dynamic-node-image"), false);
assert.ok(fixturePlan.retiredClasses.has("comment-only-retired"));
assert.ok(fixturePlan.customProperties.has("--workspace-surface-color"));
assert.ok(fixturePlan.keyframes.has("workspace-surface-enter"));
assert.ok(fixturePlan.retiredKeyframes.has("retired-surface-pulse"));

const compactClass = fixturePlan.classes.get("workspace-surface-long");
const compactProperty = fixturePlan.customProperties.get("--workspace-surface-color");
const transformedCss = transformCss(
  ".workspace-surface-long{color:var(--workspace-surface-color);animation:workspace-surface-enter 120ms ease both}@keyframes workspace-surface-enter{from{opacity:0}to{opacity:1}}@keyframes retired-surface-pulse{to{opacity:.5}}",
  fixturePlan,
  "fixture.css"
);
const transformedCode = transformCode(
  "import './workspace-surface-long'; const lazy = import('./workspace-surface-long'); const node = <div className=\"workspace-surface-long\" style={{ color: 'var(--workspace-surface-color)' }} />;",
  fixturePlan,
  "fixture.tsx"
);
assert.match(transformedCss, new RegExp(`\\.${compactClass}\\{`));
assert.ok(transformedCss.includes(compactProperty));
assert.ok(transformedCss.includes(fixturePlan.keyframes.get("workspace-surface-enter")));
assert.equal(transformedCss.includes("retired-surface-pulse"), false);
assert.ok(transformedCode.includes(`className=\"${compactClass}\"`));
assert.ok(transformedCode.includes(compactProperty));
assert.ok(transformedCode.includes("import './workspace-surface-long'"));
assert.ok(transformedCode.includes("import('./workspace-surface-long')"));

const optimizedBundle = optimizeBundledCss(
  ".same{color:red;padding:1px}.between{display:block}.same{color:blue}.left{margin:0}.right{margin:0}.fallback{background:#fff;background:color-mix(in srgb,#fff 80%,transparent)}:root.glass-theme-active .surface,:root[data-glass-theme] .surface{color:white}:root[data-theme=\"dark\"] .panel,:root.theme-dark .panel{color:black}"
);
assert.equal(optimizedBundle.includes(".same{color:red"), false);
assert.match(optimizedBundle, /\.same\{padding:1px\}/);
assert.match(optimizedBundle, /\.same\{color:blue\}/);
assert.match(optimizedBundle, /\.left,.right\{margin:0\}/);
assert.match(optimizedBundle, /background:#fff;background:color-mix/);
assert.match(optimizedBundle, /:root\[data-glass-theme\] \.surface/);
assert.match(optimizedBundle, /:root\[data-theme="dark"\] \.panel/);

for (const relativePath of ["src/glass-theme.ts", "public/glass-theme-bootstrap.js"]) {
  const source = require("node:fs").readFileSync(resolve(__dirname, "..", relativePath), "utf8");
  assert.ok(
    source.indexOf("root.dataset.glassTheme") >= 0 &&
    source.indexOf("root.dataset.glassTheme") < source.indexOf('root.classList.toggle("glass-theme-active"'),
    `${relativePath} must establish the canonical glass data attribute before its compatibility class`
  );
  assert.ok(
    source.indexOf("root.dataset.theme") >= 0 &&
    source.indexOf("root.dataset.theme") < source.indexOf('root.classList.toggle("theme-dark"'),
    `${relativePath} must establish the canonical theme data attribute before its compatibility class`
  );
}

const protectedPlan = buildSymbolPlan({
  cssSources: [{ filePath: "protected.css", code: ".release-visible-selector{color:var(--release-visible-color)}" }],
  codeSources: [{ filePath: "protected.tsx", code: "<div className=\"release-visible-selector\" />" }],
  protectedSources: [{ filePath: "probe.mjs", code: "document.querySelector('.release-visible-selector'); getPropertyValue('--release-visible-color')" }]
});
assert.equal(protectedPlan.classes.has("release-visible-selector"), false);
assert.equal(protectedPlan.customProperties.has("--release-visible-color"), false);

const projectPlan = buildProductionSymbolPlan(resolve(__dirname, ".."));
assert.ok(projectPlan.inventory.classes >= 900, "Expected the production CSS inventory to stay non-trivial.");
assert.ok(projectPlan.inventory.compactedClasses >= 500, "Too few statically safe production classes were compacted.");
assert.ok(projectPlan.inventory.compactedCustomProperties >= 80, "Too few internal custom properties were compacted.");
assert.ok(projectPlan.inventory.compactedKeyframes >= 10, "Too few statically safe production keyframes were compacted.");
assert.ok(projectPlan.inventory.retiredKeyframes >= 5, "Expected unused production keyframes to be retired.");
assert.equal(projectPlan.classes.has("product-performance-probe"), false);
assert.equal(projectPlan.customProperties.has("--theme-accent"), true);
assert.ok(projectPlan.classes.has("flow-node"), "The product probe must use stable data attributes so production can compact the high-frequency node class.");
assert.ok(projectPlan.classes.has("workflow-canvas"), "The product probe must use a stable canvas data attribute instead of freezing the visual class name.");

const productPerformanceSource = require("node:fs").readFileSync(resolve(__dirname, "product-performance-gate.mjs"), "utf8");
assert.match(productPerformanceSource, /\[data-canvas-surface=/);
assert.match(productPerformanceSource, /\[data-canvas-node=/);
assert.doesNotMatch(productPerformanceSource, /\.flow-node|\.workflow-canvas/);

console.log(JSON.stringify({ ok: true, inventory: projectPlan.inventory }, null, 2));
