"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  createScientificRunnerService,
  inspectDelimitedFile,
  validateScientificOutputFile
} = require("../desktop/scientific-runner-service.cjs");
const { normalizeScientificFigurePlan } = require("../runtime/scientific-figure-plan.cjs");

function projectRelativePath(projectPath, filePath) {
  const relative = path.relative(path.resolve(projectPath), path.resolve(filePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return relative.replace(/\\/g, "/");
}

function resolveProjectRelativePath(projectPath, relativePath) {
  const root = path.resolve(projectPath);
  const target = path.resolve(root, String(relativePath || ""));
  const relative = path.relative(root, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? target : null;
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "naimage-scientific-"));
  const projectPath = path.join(root, "project");
  const exportParent = path.join(root, "exports");
  const sourcePath = path.join(root, "measurements.csv");
  const multilineSourcePath = path.join(root, "multiline.csv");
  const disguisedPngPath = path.join(root, "disguised.png");
  const unsafeSvgPath = path.join(root, "unsafe.svg");
  const project = { id: "scientific-project", path: projectPath };
  await Promise.all([mkdir(projectPath, { recursive: true }), mkdir(exportParent, { recursive: true })]);
  await writeFile(sourcePath, "time,control,treated\n0,1.0,1.1\n1,1.4,2.0\n2,1.8,3.2\n3,2.1,4.3\n", "utf8");
  await writeFile(multilineSourcePath, "id,note,value\n1,\"first line\nsecond \"\"quoted\"\" line\",3\n2,plain,4\n", "utf8");
  await writeFile(disguisedPngPath, "<html>not a png</html>", "utf8");
  await writeFile(unsafeSvgPath, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf8");
  const changes = [];
  const service = createScientificRunnerService({
    assetUrlFor: (filePath) => `naimage-test://${encodeURIComponent(filePath)}`,
    getProjectById: (id, list) => list.projects.find((item) => item.id === id),
    onTaskChanged: (task) => changes.push(task),
    projectMetaDirName: ".naimage",
    projectRelativePath,
    readProjectList: () => ({ activeProjectId: project.id, projects: [project] }),
    resolveProjectRelativePath,
    pythonCommand: process.env.NAIMAGE_SCIENTIFIC_PYTHON || "python"
  });

  try {
    const multiline = await inspectDelimitedFile(multilineSourcePath, ".csv");
    assert.equal(multiline.rowCount, 2, "Quoted CSV fields may span physical lines without inflating row counts");
    assert.equal(multiline.sampleRows[0].note, 'first line\nsecond "quoted" line');
    await assert.rejects(
      validateScientificOutputFile(disguisedPngPath, ".png", 22),
      (error) => error.code === "SCIENTIFIC_OUTPUT_SIGNATURE_INVALID"
    );
    await assert.rejects(
      validateScientificOutputFile(unsafeSvgPath, ".svg", 74),
      (error) => error.code === "SCIENTIFIC_SVG_UNSAFE"
    );
    const imported = await service.importData({ expectedProjectId: project.id, sourcePath });
    assert.equal(imported.ok, true);
    assert.equal(imported.dataSource.rowCount, 4);
    assert.deepEqual(imported.dataSource.fields, ["time", "control", "treated"]);
    assert.equal(imported.sampleRows.length, 4);
    assert.deepEqual(await service.listData(project.id), [imported.dataSource]);

    const plan = normalizeScientificFigurePlan({
      backend: "python",
      figureType: "multi-panel",
      researchClaim: "处理组随时间呈现更高的测量值；本测试不推断统计显著性。",
      dataSources: [imported.dataSource],
      panels: [
        { id: "panel-a", label: "A", title: "对照与处理", chartType: "line", sourceBindings: [imported.dataSource.id], xField: "time", yFields: ["control", "treated"] },
        { id: "panel-b", label: "B", title: "处理组分布", chartType: "scatter", sourceBindings: [imported.dataSource.id], xField: "time", yFields: ["treated"] }
      ],
      outputFormats: ["png", "svg"],
      dimensions: { widthMm: 120, heightMm: 80, dpi: 150 }
    });
    const task = await service.renderTask({ expectedProjectId: project.id, plan, timeoutMs: 120_000 });
    assert.equal(task.state, "ready");
    assert.equal(task.backend, "python");
    assert.ok(task.outputs.some((output) => output.name === "figure-preview.png" && output.kind === "figure"));
    assert.equal(task.outputs.filter((output) => output.kind === "panel").length, 2);
    assert.ok(task.outputs.some((output) => output.format === "py" && output.kind === "script"), JSON.stringify(task.outputs));
    assert.ok(task.outputs.every((output) => !path.isAbsolute(output.relativePath)));
    assert.equal((await service.getTask(project.id, task.taskId)).taskId, task.taskId);
    assert.equal((await service.listTasks(project.id))[0].taskId, task.taskId);

    const exported = await service.exportTask({ expectedProjectId: project.id, taskId: task.taskId, destinationParent: exportParent });
    assert.equal(exported.ok, true);
    assert.equal(exported.fileCount, task.outputs.length);
    assert.ok(changes.some((change) => change.state === "running"));
    assert.ok(changes.some((change) => change.state === "ready"));

    const journalPath = path.join(projectPath, ".naimage", "scientific", "task-journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    journal.tasks[0].state = "running";
    journal.tasks[0].progress = 52;
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    const recovered = await service.recoverAll();
    assert.equal(recovered.interrupted, 1);
    assert.equal((await service.getTask(project.id, task.taskId)).state, "interrupted");
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
  console.log("scientific runner selftest passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
