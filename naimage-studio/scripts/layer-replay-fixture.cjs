"use strict";

const { existsSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");

const requiredMaskReplayFiles = [
  "raw-02-foreground-scene.png",
  "raw-03-subject.png",
  "raw-04-props.png",
  "raw-05-title.png",
  "raw-06-body-text.png",
];

function childDirectories(root) {
  if (!root || !existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function replayInfo(root, requireMaskReplay = false) {
  if (!root || !existsSync(root)) return null;
  let files;
  try {
    files = readdirSync(root).filter((name) => name.toLowerCase().endsWith(".png"));
  } catch {
    return null;
  }
  const previewName = files
    .filter((name) => /-preview-1-01\.png$/i.test(name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .at(-1);
  if (!previewName) return null;
  const runPrefix = previewName.replace(/-preview-1-01\.png$/i, "");
  const runFiles = files.filter((name) => name.startsWith(`${runPrefix}-`));
  const layerFiles = runFiles.filter((name) => /^.*-[1-8]-[a-z0-9_-]+-1-01\.png$/i.test(name));
  if (layerFiles.length < 2 || !layerFiles.some((name) => /-1-background-1-01\.png$/i.test(name))) return null;
  if (requireMaskReplay) {
    const maskReplayRoot = path.join(root, "mask-replay");
    if (!requiredMaskReplayFiles.every((name) => existsSync(path.join(maskReplayRoot, name)))) return null;
  }
  let modifiedAt = 0;
  try {
    modifiedAt = statSync(path.join(root, previewName)).mtimeMs;
  } catch {
    // A readable replay root is still valid when mtime is unavailable.
  }
  return { root, previewName, modifiedAt };
}

function projectImagegenCandidates(configRoot) {
  const projectsRoot = path.join(configRoot, "projects");
  return childDirectories(projectsRoot).map((projectRoot) => path.join(projectRoot, "output", "imagegen"));
}

function diagnosticReplayCandidates(repoRoot) {
  const electronRoot = path.join(repoRoot, ".diagnostics", "electron");
  return childDirectories(electronRoot)
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left), "en", { numeric: true }))
    .slice(0, 160)
    .flatMap((runRoot) => childDirectories(runRoot).filter((candidate) => path.basename(candidate).startsWith("layer-semantic-replay-")));
}

function discoverLayerReplayRoot(repoRoot, { requireMaskReplay = false } = {}) {
  const configRoots = [process.env.NAIMAGE_CONFIG_DIR, path.join(repoRoot, "config")].filter(Boolean);
  const candidates = [
    ...configRoots.flatMap(projectImagegenCandidates),
    ...diagnosticReplayCandidates(repoRoot),
  ];
  const unique = [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
  return unique
    .map((candidate) => replayInfo(candidate, requireMaskReplay))
    .filter(Boolean)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.root || "";
}

function resolveLayerReplayRoot({ repoRoot, explicitRoot = "", requireMaskReplay = false } = {}) {
  if (explicitRoot) {
    const resolved = path.resolve(explicitRoot);
    if (!replayInfo(resolved, requireMaskReplay)) {
      const suffix = requireMaskReplay ? " and a completed mask-replay folder" : "";
      throw new Error(`invalid real imagegen output folder${suffix}: ${resolved}`);
    }
    return { root: resolved, source: "explicit" };
  }
  const discovered = discoverLayerReplayRoot(path.resolve(repoRoot || process.cwd()), { requireMaskReplay });
  return discovered ? { root: discovered, source: "auto-discovered" } : { root: "", source: "missing" };
}

module.exports = {
  discoverLayerReplayRoot,
  resolveLayerReplayRoot,
};
