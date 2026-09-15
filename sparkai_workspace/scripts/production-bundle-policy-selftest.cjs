const assert = require("node:assert/strict");
const {
  ADVISORY_BUDGET_KEYS,
  BUNDLE_LIMITS,
  HARD_BUDGET_KEYS,
  classifyBundleBudgets
} = require("./production-bundle-policy.cjs");

assert.deepEqual(HARD_BUDGET_KEYS, ["initialJsBytes", "pluginJsBytes", "cssBytes"]);
assert.deepEqual(ADVISORY_BUDGET_KEYS, ["coreAsyncJsBytes", "coreJsBytes", "totalBytes"]);
assert.deepEqual(BUNDLE_LIMITS, {
  initialJsBytes: 685_000,
  coreAsyncJsBytes: 190_000,
  coreJsBytes: 870_000,
  pluginJsBytes: 120_000,
  cssBytes: 270_000,
  totalBytes: 1_200_000
});

const atLimits = classifyBundleBudgets(BUNDLE_LIMITS);
assert.deepEqual(atLimits.failures, []);
assert.deepEqual(atLimits.advisories, []);

const advisoryOnly = classifyBundleBudgets({
  ...BUNDLE_LIMITS,
  coreAsyncJsBytes: BUNDLE_LIMITS.coreAsyncJsBytes + 1,
  coreJsBytes: BUNDLE_LIMITS.coreJsBytes + 1,
  totalBytes: BUNDLE_LIMITS.totalBytes + 1
});
assert.deepEqual(advisoryOnly.failures, []);
assert.deepEqual(advisoryOnly.advisories, [
  "core async JS 190001 > 190000",
  "core JS 870001 > 870000",
  "dist 1200001 > 1200000"
]);

const hardFailure = classifyBundleBudgets({
  ...BUNDLE_LIMITS,
  initialJsBytes: BUNDLE_LIMITS.initialJsBytes + 1_025,
  pluginJsBytes: BUNDLE_LIMITS.pluginJsBytes + 1,
  cssBytes: BUNDLE_LIMITS.cssBytes + 1
});
assert.deepEqual(hardFailure.advisories, []);
assert.deepEqual(hardFailure.failures, [
  "initial JS 686025 > 685000",
  "plugin JS 120001 > 120000",
  "CSS 270001 > 270000"
]);

const initialTolerance = classifyBundleBudgets({
  ...BUNDLE_LIMITS,
  initialJsBytes: BUNDLE_LIMITS.initialJsBytes + 1_024
});
assert.deepEqual(initialTolerance.failures, []);
assert.deepEqual(initialTolerance.advisories, [
  "initial JS 686024 > 685000 (within 1024 byte hard tolerance)"
]);
assert.equal(initialTolerance.checks.find((check) => check.key === "initialJsBytes").status, "within-tolerance");

console.log("production bundle policy selftest passed");
