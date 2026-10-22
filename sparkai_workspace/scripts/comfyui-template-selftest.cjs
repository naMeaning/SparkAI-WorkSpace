"use strict";
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createComfyUiTemplateService, builtIn } = require("../desktop/comfyui-template-service.cjs");

(async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sparkai-comfy-template-")), configPath = path.join(root, "templates.json"), apiFile = path.join(root, "api.json");
  let selected = apiFile, canceled = false, inspected = 0;
  const service = () => createComfyUiTemplateService({ configPath,
    readJson: (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } },
    writeJson: (file, value) => writeFileSync(file, JSON.stringify(value)),
    dialog: { showOpenDialog: async () => ({ canceled, filePaths: [selected] }) },
    executor: { inspect: async baseUrl => { inspected++; return { baseUrl, objectInfo: { CheckpointLoaderSimple: { input: { required: { ckpt_name: [["fixture.safetensors"]] } } }, CloudApi: {} }, systemStats: { python_path: "private-path", devices: [{ name: "fixture device", type: "cpu", private: "secret" }] } }; } }
  });
  try {
    const owner = service(), templates = owner.list().templates;
    assert.equal(templates.length, 2); assert.equal(templates[1].imageInputs, 1); assert.equal(templates[0].workflow, undefined);
    const input = { templateId: templates[0].id, templateHash: templates[0].templateHash, checkpoint: "fixture.safetensors", seed: -1, width: 512, height: 768 };
    const frozen = owner.resolve(input); frozen.workflow["6"].inputs.text = "mutation";
    assert.equal(owner.resolve(input).workflow["6"].inputs.text, "");
    assert.throws(() => owner.resolve({ ...input, templateHash: "0".repeat(64) }), { code: "COMFYUI_TEMPLATE_CHANGED" });
    assert.throws(() => owner.resolve({ ...input, path: "C:/arbitrary" }), { code: "COMFYUI_REQUEST_INVALID" });
    for (const baseUrl of ["http://remote.example", "http://127.0.0.1:8188/proxy", "http://user:pass@localhost:8188"]) assert.throws(() => owner.resolve({ ...input, baseUrl }));
    assert.throws(() => owner.resolve({ ...input, width: 513 }), { code: "COMFYUI_PARAMETERS_INVALID" });
    const environment = await owner.inspect({ baseUrl: "http://localhost:8188" });
    assert.equal(inspected, 1); assert.equal(JSON.stringify(environment).includes("private-path"), false); assert.equal(JSON.stringify(environment).includes("secret"), false);
    assert.deepEqual(environment.checkpoints, ["fixture.safetensors"]);
    const fixture = builtIn("generate"); writeFileSync(apiFile, JSON.stringify(fixture.workflow));
    const imported = await owner.importTemplate({ label: "Explicit API JSON", outputNodeId: "9", inputMappings: fixture.inputMappings });
    assert.equal(imported.template.operation, "generate"); assert.equal(service().list().templates.length, 3);
    assert.equal((await owner.importTemplate({ label: "Updated", outputNodeId: "9", inputMappings: fixture.inputMappings })).template.version, 2);
    await assert.rejects(owner.importTemplate({ outputNodeId: "8", inputMappings: fixture.inputMappings }), { code: "COMFYUI_NODE_MAPPING_INVALID" });
    writeFileSync(apiFile, JSON.stringify({ nodes: [{ type: "KSampler" }] }));
    await assert.rejects(owner.importTemplate({ outputNodeId: "9", inputMappings: [] }), { code: "COMFYUI_WORKFLOW_INVALID" });
    const cloud = builtIn("generate").workflow; cloud["11"] = { class_type: "CloudApi", inputs: {} }; writeFileSync(apiFile, JSON.stringify(cloud));
    await assert.rejects(owner.importTemplate({ outputNodeId: "9", inputMappings: fixture.inputMappings }), { code: "COMFYUI_NODE_UNAPPROVED" });
    canceled = true; assert.equal((await owner.importTemplate({})).canceled, true);
    assert.equal(service().list().templates.length, 3, "Failed imports never replace prior templates");
    console.log(JSON.stringify({ ok: true, checks: 9, modelRequests: 0, persistence: true, nativeImportOnly: true, credentialsRedacted: true }));
  } finally { rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
