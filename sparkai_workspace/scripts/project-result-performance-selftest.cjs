"use strict";

// Actual Electron Main owners. All image files and requests stay local.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { performance } = require("node:perf_hooks");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const fixtureArgument = process.argv.find(value => value.startsWith("--fixture-root="))?.slice(15);
const profileHydration = process.argv.includes("--profile-hydration");
const runRoot = path.join(root, ".diagnostics/project-result-performance", new Date().toISOString().replace(/[:.]/g, "-"));
const fixtureRoot = fixtureArgument ? path.resolve(fixtureArgument) : path.join(runRoot, "fixtures");
fs.mkdirSync(path.join(runRoot, "config"), { recursive: true });
process.env.NAIMAGE_PROJECT_IO_SELFTEST = "1";
process.env.NAIMAGE_CONFIG_DIR = path.join(runRoot, "config");
const stats = {};
for (const name of ["existsSync", "lstatSync", "statSync", "realpathSync", "readFileSync"]) {
  const original = fs[name];
  fs[name] = function (...args) {
    const start = performance.now();
    try { return original.apply(this, args); }
    finally { const value = stats[name] ||= { calls: 0, ms: 0 }; value.calls++; value.ms += performance.now() - start; }
  };
}
const { app } = require("electron");
const main = require("../electron-main.cjs");
const { sanitizeSession, sessionHasContent } = require("../desktop/project-session-normalizer.cjs");
const { createProjectStore } = require("../desktop/project-store.cjs");
const { createProjectResultIndex } = require("../desktop/project-result-index.cjs");
const { createProjectCommerceCatalogService } = require("../desktop/project-commerce-catalog.cjs");
const { createProjectCreationService } = require("../desktop/project-creation-service.cjs");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const report = { ok: false, realModelRequests: 0, node: process.version, electron: process.versions.electron,
  platform: process.platform, cpu: os.cpus()[0]?.model, fixtureRoot,
  source: "Actual Electron Main asset repository, project-store metadata source selection, normalizer, Catalog and creation owners",
  conditions: { cold: "Fresh index instance and deleted derived cache; OS cache not cleared",
    hot: "Same index instance; authoritative metadata and managed paths/stats checked again; unchanged bytes not read again",
    sharedFixture: "100/500/1000 independent occurrences share one managed file, matching the original failed UI fixture",
    uniqueFixture: "1000 separate managed files with independent occurrences", concurrency: 8 }, checks: [], samples: [] };
const save = () => fs.writeFileSync(path.join(runRoot, "report.json"), JSON.stringify(report, null, 2));
const snapshot = () => structuredClone(stats);
const delta = before => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key,
  { calls: value.calls - (before[key]?.calls || 0), ms: +(value.ms - (before[key]?.ms || 0)).toFixed(2) }]));
const projectOf = (directory, id) => ({ id, path: directory, sessionPath: path.join(directory, "session.json") });
const relative = (base, file) => path.relative(base, file).replace(/\\/g, "/");
const inside = (file, base) => { const rel = path.relative(base, file); return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
const resolveRelative = (base, rel) => { const file = path.resolve(base, rel); return inside(file, base) ? file : ""; };
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
function metadataStore(project) {
  return createProjectStore({ defaultSession: main.defaultSession, comparablePath: value => path.resolve(value).toLowerCase(),
    exportSessionFileName: "start.naimage", legacyExportSessionFileNames: ["start.iiimage"], isPathInside: inside,
    projectMetaDirName: ".naimage", legacyProjectMetaDirNames: [".iiimage"], projectManifestFileName: "project.json",
    projectRoot: project.path, projectsDir: fixtureRoot, sessionPath: project.sessionPath,
    normalizeSessionRevision: main.normalizeSessionRevision, sessionHasContent, readJson,
    writeJson: () => assert.fail("Metadata source selection must never migrate or write"),
    sessionForProjectSave: () => assert.fail("Metadata reads must not serialize assets"),
    sessionWithProjectAssets: () => assert.fail("Metadata reads must not hydrate assets") });
}
function writeFixture(count, directory, { shared = true, id = `performance-${count}` } = {}) {
  fs.mkdirSync(path.join(directory, "assets"), { recursive: true });
  const project = projectOf(directory, id), contentHash = hash(PNG);
  if (shared) fs.writeFileSync(path.join(directory, "assets/fixture.png"), PNG);
  const nodes = Array.from({ length: count }, (_, index) => {
    const relativePath = shared ? "assets/fixture.png" : `assets/fixture-${index}.png`;
    if (!shared) fs.writeFileSync(path.join(directory, relativePath), PNG);
    return { id: `${id}-node-${index}`, type: "image", title: `性能条目 ${String(index + 1).padStart(4, "0")}`,
      x: index % 20 * 220, y: Math.floor(index / 20) * 260, status: "done", imageState: "done", outputs: 1,
      assets: [{ assetId: `blob-${contentHash.slice(0, 32)}`, occurrenceId: `occ-${(index + 1).toString(16).padStart(32, "0")}`,
        contentHash, type: "file", path: path.join(directory, relativePath), relativePath, width: 1, height: 1 }] };
  });
  fs.writeFileSync(project.sessionPath, JSON.stringify({ schemaVersion: 5, sessionRevision: 1, nodes,
    activeConversationId: "performance-c", conversations: [{ id: "performance-c", messages: [] }], messages: [] }));
  return project;
}
function measure(name, callback) {
  const before = snapshot(), start = performance.now(), value = callback();
  return { value, sample: { name, ms: +(performance.now() - start).toFixed(2), filesystem: delta(before) } };
}
function owners(project, mode = "metadata") {
  const store = metadataStore(project), readStats = { calls: 0, ms: 0 }, fileStats = { calls: 0, ms: 0, passes: 0 };
  const readSession = () => { const start = performance.now(); const value = mode === "hydrated" ? main.projectSessionFromDisk(project)
    : sanitizeSession(store.projectSessionMetadataFromDisk(project), { expectedProjectId: project.id });
    readStats.calls++; readStats.ms += performance.now() - start; return value; };
  const projectFor = id => id === project.id ? project : null;
  const catalog = createProjectCommerceCatalogService({ getProjectById: projectFor,
    projectCommerceCatalogPath: item => path.join(item.path, ".naimage/commerce-catalog.json"),
    projectRelativePath: relative, resolveProjectRelativePath: resolveRelative,
    projectSessionFromDisk: readSession, readProjectList: () => ({ projects: [project] }) });
  const creation = createProjectCreationService({ projectFor, readSession, catalogService: catalog,
    projectRelativePath: relative, resolveProjectRelativePath: resolveRelative });
  const timed = validate => (file, projectPath) => { const start = performance.now(); const value = validate(file, projectPath);
    fileStats.calls++; fileStats.ms += performance.now() - start; return value; };
  const options = { projectFor, readSession, catalogService: catalog, creationService: creation,
    controlledProjectAssetFile: timed(main.projectAssetRepository.controlledProjectAssetFile), resolveProjectRelativePath: resolveRelative,
    ...(main.projectAssetRepository.createProjectAssetFileValidator ? { createProjectAssetFileValidator: projectPath => {
      fileStats.passes++; return timed(main.projectAssetRepository.createProjectAssetFileValidator(projectPath)); } } : {}) };
  return { engine: createProjectResultIndex(options), readSession, readStats, fileStats };
}
async function check(name, callback) { await callback(); report.checks.push(name); save(); process.stdout.write(`ok ${report.checks.length} ${name}\n`); }
async function benchmark(project, count, shared) {
  const beforeHash = hash(fs.readFileSync(project.sessionPath)), sample = { assets: count, sharedFile: shared, stages: [] };
  const raw = measure("read and parse Session", () => JSON.parse(fs.readFileSync(project.sessionPath, "utf8")));
  sample.stages.push(raw.sample);
  sample.stages.push(measure("project-store metadata source and normalize", () => sanitizeSession(metadataStore(project).projectSessionMetadataFromDisk(project), { expectedProjectId: project.id })).sample);
  if (profileHydration) {
    const hydrated = measure("hydrate Session assets", () => main.sessionWithProjectAssets(raw.value, project)); sample.stages.push(hydrated.sample);
    sample.stages.push(measure("serialize hydrated Session", () => main.sessionForProjectSave(hydrated.value, project)).sample);
    sample.stages.push(measure("projectSessionFromDisk", () => main.projectSessionFromDisk(project)).sample);
  }
  for (const mode of profileHydration ? ["hydrated", "metadata"] : ["metadata"]) {
    fs.rmSync(path.join(project.path, ".naimage/result-index.json"), { force: true });
    const state = owners(project, mode);
    for (const round of ["cold", "hot"]) {
      const before = snapshot(), start = performance.now(), readBefore = { ...state.readStats }, fileBefore = { ...state.fileStats }, diagnostics = state.engine.diagnostics();
      const result = await state.engine.search({ expectedProjectId: project.id, query: { text: "性能条目" }, limit: 20 });
      assert.equal(result.total, count); assert.equal(result.results.length, 20);
      assert.equal(new Set(result.results.map(value => value.target.occurrenceId)).size, 20);
      assert.equal(state.readStats.calls - readBefore.calls, 1, "Creation discovery shares the authoritative metadata snapshot");
      if (round === "hot") assert.equal(state.engine.diagnostics().fileReads, diagnostics.fileReads, "Unchanged image bytes are not reread");
      sample.stages.push({ name: `${mode} index ${round}`, ms: +(performance.now() - start).toFixed(2), total: result.total,
        sessionReads: state.readStats.calls - readBefore.calls, sessionReadMs: +(state.readStats.ms - readBefore.ms).toFixed(2),
        controlledCalls: state.fileStats.calls - fileBefore.calls, controlledMs: +(state.fileStats.ms - fileBefore.ms).toFixed(2), filesystem: delta(before), diagnostics: state.engine.diagnostics() });
    }
  }
  assert.equal(hash(fs.readFileSync(project.sessionPath)), beforeHash, "Search never rewrites authoritative Session");
  report.samples.push(sample); save(); process.stdout.write(`${JSON.stringify(sample)}\n`);
}
async function run() {
  save();
  for (const count of [100, 500, 1000]) {
    const directory = path.join(fixtureRoot, `project-performance-${count}`), project = fixtureArgument ? projectOf(directory, `performance-${count}`) : writeFixture(count, directory);
    await benchmark(project, count, true);
  }
  await benchmark(writeFixture(1000, path.join(runRoot, "unique-files"), { shared: false, id: "unique-files" }), 1000, false);
  await check("same-file occurrences retain independent hash validation and every query checks current bytes", async () => {
    const project = writeFixture(3, path.join(runRoot, "safety"), { id: "safety" }), raw = readJson(project.sessionPath);
    raw.nodes[2].assets[0].contentHash = "0".repeat(64); fs.writeFileSync(project.sessionPath, JSON.stringify(raw));
    const state = owners(project), input = { expectedProjectId: project.id }, target = raw.nodes[0].assets[0];
    assert.equal((await state.engine.search(input)).total, 2);
    const reads = state.engine.diagnostics().fileReads;
    assert.equal((await state.engine.search(input)).total, 2); assert.equal(state.engine.diagnostics().fileReads, reads);
    const file = path.join(project.path, "assets/fixture.png"), bytes = fs.readFileSync(file), info = fs.statSync(file);
    const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1; fs.writeFileSync(file, changed); fs.utimesSync(file, info.atime, info.mtime);
    assert.equal((await state.engine.search(input)).total, 0, "Same-size replacement with restored mtime is invalidated by fresh ctime/stat/hash");
    await assert.rejects(state.engine.resolveUse({ ...input, targets: [target] }), { code: "RESULT_TARGET_STALE" });
    fs.writeFileSync(file, bytes); assert.equal((await state.engine.search(input)).total, 2);
    fs.unlinkSync(file); assert.equal((await state.engine.search(input)).total, 0);
    fs.writeFileSync(file, bytes); assert.equal((await state.engine.search(input)).total, 2);
  });
  await check("replaced managed root junction cannot reuse a prior query validation", async () => {
    const project = writeFixture(1, path.join(runRoot, "junction-safety"), { id: "junction-safety" }), state = owners(project), input = { expectedProjectId: project.id };
    const first = await state.engine.search(input); assert.equal(first.total, 1);
    const assets = path.join(project.path, "assets"), held = path.join(project.path, "saved-assets"), outside = path.join(runRoot, "outside-project");
    fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "fixture.png"), PNG); fs.renameSync(assets, held);
    try {
      fs.symlinkSync(outside, assets, process.platform === "win32" ? "junction" : "dir");
      assert.equal((await state.engine.search(input)).total, 0);
      await assert.rejects(state.engine.resolveUse({ ...input, targets: [first.results[0].target] }), { code: "RESULT_TARGET_STALE" });
    } finally { if (fs.existsSync(assets) && fs.lstatSync(assets).isSymbolicLink()) fs.unlinkSync(assets); fs.renameSync(held, assets); }
    assert.equal((await state.engine.search(input)).total, 1);
  });
  await check("metadata owner preserves legacy manifest/export source selection without migration or hydration", () => {
    for (const format of ["manifest", "export"]) {
      const project = writeFixture(1, path.join(runRoot, `legacy-${format}`), { id: `legacy-${format}` }), raw = readJson(project.sessionPath);
      fs.unlinkSync(project.sessionPath);
      if (format === "manifest") { fs.mkdirSync(path.join(project.path, ".naimage")); fs.writeFileSync(path.join(project.path, ".naimage/project.json"), JSON.stringify({ version: 1, session: raw, sessionRevision: 7 })); }
      else fs.writeFileSync(path.join(project.path, "start.naimage"), JSON.stringify({ session: raw }));
      const source = sanitizeSession(metadataStore(project).projectSessionMetadataFromDisk(project), { expectedProjectId: project.id });
      assert.equal(source.nodes.length, 1); assert.equal(fs.existsSync(project.sessionPath), false);
    }
  });
  report.ok = true; save(); process.stdout.write(`${path.join(runRoot, "report.json")}\n`);
}
run().then(() => app.exit(0)).catch(error => { report.error = error.stack; save(); process.stderr.write(`${error.stack}\n`); app.exit(1); });
