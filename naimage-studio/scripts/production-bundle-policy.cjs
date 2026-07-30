const BUNDLE_LIMITS = Object.freeze({
  initialJsBytes: 685_000,
  coreAsyncJsBytes: 190_000,
  coreJsBytes: 870_000,
  pluginJsBytes: 120_000,
  cssBytes: 270_000,
  totalBytes: 1_200_000
});

const BUDGET_RULES = Object.freeze([
  { key: "initialJsBytes", label: "initial JS", severity: "hard", tolerance: 1_024 },
  { key: "coreAsyncJsBytes", label: "core async JS", severity: "advisory" },
  { key: "coreJsBytes", label: "core JS", severity: "advisory" },
  { key: "pluginJsBytes", label: "plugin JS", severity: "hard" },
  { key: "cssBytes", label: "CSS", severity: "hard" },
  { key: "totalBytes", label: "dist", severity: "advisory" }
]);

const HARD_BUDGET_KEYS = Object.freeze(
  BUDGET_RULES.filter((rule) => rule.severity === "hard").map((rule) => rule.key)
);
const ADVISORY_BUDGET_KEYS = Object.freeze(
  BUDGET_RULES.filter((rule) => rule.severity === "advisory").map((rule) => rule.key)
);

function classifyBundleBudgets(measurements, limits = BUNDLE_LIMITS) {
  const failures = [];
  const advisories = [];
  const checks = BUDGET_RULES.map((rule) => {
    const actual = Number(measurements[rule.key]);
    const limit = Number(limits[rule.key]);
    const tolerance = Number(rule.tolerance || 0);
    const enforcedLimit = limit + tolerance;
    const exceeded = actual > limit;
    const hardFailure = rule.severity === "hard" && actual > enforcedLimit;
    const message = `${rule.label} ${actual} > ${limit}`;
    if (exceeded) {
      (hardFailure ? failures : advisories).push(
        tolerance && !hardFailure ? `${message} (within ${tolerance} byte hard tolerance)` : message
      );
    }
    return {
      key: rule.key,
      severity: rule.severity,
      actual,
      limit,
      tolerance,
      enforcedLimit,
      status: hardFailure
        ? "exceeded"
        : exceeded
          ? rule.severity === "advisory" ? "advisory-exceeded" : "within-tolerance"
          : "within-limit"
    };
  });

  return { failures, advisories, checks };
}

module.exports = {
  ADVISORY_BUDGET_KEYS,
  BUNDLE_LIMITS,
  HARD_BUDGET_KEYS,
  classifyBundleBudgets
};
