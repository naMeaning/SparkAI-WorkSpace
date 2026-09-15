"use strict";

const assert = require("node:assert/strict");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  EXPORT_CENTER_STATE_FORMAT,
  createExportCenterStateService,
  normalizeHistoryEntry,
  safeRelativePath
} = require("../desktop/export-center-state-service.cjs");

const testRoot = mkdtempSync(path.join(os.tmpdir(), "sparkai-export-center-"));

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

async function run() {
  const projectRoot = path.join(testRoot, "project");
  mkdirSync(projectRoot, { recursive: true });
  const project = { id: "project-export-center", path: projectRoot };
  let activeProjectId = project.id;
  const service = createExportCenterStateService({
    getProjectById: (id) => id === project.id ? project : null,
    readProjectList: () => ({ activeProjectId, projects: [project] })
  });

  const first = await service.load({ expectedProjectId: project.id });
  assert.equal(first.ok, true);
  assert.equal(first.state.format, EXPORT_CENTER_STATE_FORMAT);
  assert.deepEqual(first.state.presets, []);
  assert.deepEqual(first.state.history, []);
  assert.equal(existsSync(path.join(projectRoot, ".naimage", "export-center.json")), false,
    "Reading an empty export center must not create project files");

  const saved = await service.savePreset({
    expectedProjectId: project.id,
    preset: {
      name: "跨境商品主图",
      target: "image",
      format: "webp",
      filenameTemplate: "{title}-{index}",
      conflictPolicy: "keep-both",
      incremental: true,
      outputPath: "C:/renderer-must-not-control-output"
    }
  });
  assert.equal(saved.preset.name, "跨境商品主图");
  assert.equal(saved.preset.conflictPolicy, "keep-both");
  assert.equal(Object.hasOwn(saved.preset, "outputPath"), false);
  const firstPresetId = saved.preset.id;

  const overwrittenByName = await service.savePreset({
    expectedProjectId: project.id,
    preset: { name: "跨境商品主图", target: "image", format: "jpeg", conflictPolicy: "skip" }
  });
  assert.equal(overwrittenByName.state.presets.length, 1);
  assert.equal(overwrittenByName.preset.id, firstPresetId, "Saving the same preset name must keep its stable identity");
  assert.equal(overwrittenByName.preset.format, "jpeg");

  await rejectsCode(
    service.savePreset({ expectedProjectId: project.id, preset: { name: "   " } }),
    "EXPORT_PRESET_NAME_REQUIRED"
  );

  await Promise.all(Array.from({ length: 28 }, (_item, index) => service.savePreset({
    expectedProjectId: project.id,
    preset: { name: `预设-${String(index + 1).padStart(2, "0")}`, target: "collection", format: "png" }
  })));
  const cappedPresets = await service.load({ expectedProjectId: project.id });
  assert.equal(cappedPresets.state.presets.length, 24, "Project presets must remain bounded");
  assert.equal(cappedPresets.state.presets.at(-1).name, "预设-28");

  const history = await service.recordHistory({
    expectedProjectId: project.id,
    entry: {
      id: "history-safe-paths",
      jobId: "job-safe-paths",
      target: "image",
      status: "succeeded",
      format: "png",
      relativePaths: [
        "exports/images/good.png",
        "./exports/images/good.png",
        "../outside.png",
        "C:/private/outside.png",
        "/private/outside.png"
      ],
      absolutePath: "C:/private/must-not-persist"
    }
  });
  assert.deepEqual(history.entry.relativePaths, ["exports/images/good.png"]);
  assert.equal(Object.hasOwn(history.entry, "absolutePath"), false);

  for (let index = 0; index < 105; index += 1) {
    await service.recordHistory({
      expectedProjectId: project.id,
      entry: { id: `history-${index}`, jobId: `job-${index}`, status: "skipped", target: "collection", format: "webp" }
    });
  }
  const cappedHistory = await service.load({ expectedProjectId: project.id });
  assert.equal(cappedHistory.state.history.length, 100, "Project export history must remain bounded");
  assert.equal(cappedHistory.state.history.at(-1).id, "history-104");

  const statePath = path.join(projectRoot, ".naimage", "export-center.json");
  const persistedText = readFileSync(statePath, "utf8");
  assert.equal(persistedText.includes("C:/private"), false);
  assert.equal(persistedText.includes("renderer-must-not-control-output"), false);
  assert.equal(JSON.parse(persistedText).format, EXPORT_CENTER_STATE_FORMAT);

  const deleted = await service.deletePreset({ expectedProjectId: project.id, presetId: cappedPresets.state.presets[0].id });
  assert.equal(deleted.deleted, 1);
  const cleared = await service.clearHistory({ expectedProjectId: project.id });
  assert.equal(cleared.cleared, 100);
  assert.deepEqual(cleared.state.history, []);

  activeProjectId = "project-changed";
  await rejectsCode(service.load({ expectedProjectId: project.id }), "PROJECT_CHANGED");
  activeProjectId = project.id;

  writeFileSync(statePath, "{invalid-json", "utf8");
  await rejectsCode(service.load({ expectedProjectId: project.id }), "EXPORT_CENTER_STATE_INVALID");

  assert.equal(safeRelativePath("exports/images/a.png"), "exports/images/a.png");
  assert.equal(safeRelativePath("C:/secret/a.png"), "");
  assert.equal(safeRelativePath("../secret/a.png"), "");
  assert.deepEqual(
    normalizeHistoryEntry({ relativePaths: ["image-groups/A/a.png", "..\\outside.png"] }).relativePaths,
    ["image-groups/A/a.png"]
  );

  return {
    ok: true,
    cases: 14,
    presetLimit: 24,
    historyLimit: 100,
    concurrentWritesSerialized: true,
    rendererPathsDiscarded: true,
    projectBoundaryEnforced: true
  };
}

run()
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    try { rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 }); } catch {}
  });
