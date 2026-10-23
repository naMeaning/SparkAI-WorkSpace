"use strict";
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createComfyUiTemplateService, builtIn } = require("../desktop/comfyui-template-service.cjs");
const { stableHash } = require("../runtime/image-generation/comfyui-executor.cjs");

(async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sparkai-comfy-template-")), configPath = path.join(root, "templates.json"), apiFile = path.join(root, "api.json");
  let selected = apiFile, canceled = false, inspected = 0;
  const service = () => createComfyUiTemplateService({ configPath,
    readJson: (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } },
    writeJson: (file, value) => writeFileSync(file, JSON.stringify(value)),
    dialog: { showOpenDialog: async () => ({ canceled, filePaths: [selected] }) },
    executor: { inspect: async baseUrl => { inspected++; return { baseUrl, objectInfo: {
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [["fixture.safetensors", "系列/基础模型.safetensors", "C:/private/model.safetensors", "/private/model.safetensors", "../model.safetensors"]] } } },
      KSampler: { input: { required: { sampler_name: [["euler", "dpmpp_2m", "Bearer secret"]], scheduler: [["normal", "bad/path"]], steps: ["INT", { min: 2, max: 80 }], cfg: ["FLOAT", { min: 1, max: 20 }], denoise: ["FLOAT", { min: 2, max: 4 }] } } }, CloudApi: {} },
      systemStats: { python_path: "private-path", devices: [{ name: "fixture device", type: "cpu", private: "secret" }, { name: "C:/private/device", type: "C:/private/type" }, { name: "Bearer fixture-token", type: "cuda" }] } }; } }
  });
  try {
    const owner = service(), templates = owner.list().templates;
    assert.equal(templates.length, 4); assert.equal(templates[1].imageInputs, 1); assert.equal(templates[0].workflow, undefined);
    assert.equal(templates[0].schemaVersion, 2); assert.equal(templates[0].modelFamily, "checkpoint");
    assert.ok(templates[0].exposedInputs.includes("steps")); assert.ok(templates[0].exposedInputs.includes("denoise"));
    assert.equal(templates[0].defaults.steps, 20); assert.equal(templates[0].parameterRanges.cfg.max, 30); assert.match(String(templates[0].policyVersion), /^comfyui-core-v2$/);
    const input = { templateId: templates[0].id, templateHash: templates[0].templateHash, checkpoint: "fixture.safetensors", seed: -1, width: 512, height: 768 };
    const frozen = owner.resolve(input); frozen.workflow["6"].inputs.text = "mutation";
    assert.equal(owner.resolve(input).workflow["6"].inputs.text, "");
    assert.throws(() => owner.resolve({ ...input, templateHash: "0".repeat(64) }), { code: "COMFYUI_TEMPLATE_CHANGED" });
    assert.throws(() => owner.resolve({ ...input, path: "C:/arbitrary" }), { code: "COMFYUI_REQUEST_INVALID" });
    for (const baseUrl of ["http://remote.example", "http://127.0.0.1:8188/proxy", "http://user:pass@localhost:8188"]) assert.throws(() => owner.resolve({ ...input, baseUrl }));
    assert.throws(() => owner.resolve({ ...input, width: 513 }), { code: "COMFYUI_PARAMETERS_INVALID" });
    const environment = await owner.inspect({ baseUrl: "http://localhost:8188" });
    assert.equal(inspected, 1); assert.equal(JSON.stringify(environment).includes("private-path"), false); assert.equal(JSON.stringify(environment).includes("secret"), false);
    assert.deepEqual(environment.checkpoints, ["fixture.safetensors", "系列/基础模型.safetensors"]); assert.deepEqual(environment.samplers, ["euler", "dpmpp_2m"]); assert.deepEqual(environment.schedulers, ["normal"]);
    assert.deepEqual(environment.parameterRanges.steps, { min: 2, max: 80, step: 1 }); assert.deepEqual(environment.parameterRanges.cfg, { min: 1, max: 20, step: 0.1 }); assert.equal(environment.parameterRanges.denoise, undefined);
    assert.deepEqual(environment.devices, [{ name: "fixture device", type: "cpu" }, { name: "", type: "cuda" }]);
    assert.match(environment.capabilitiesHash, /^[a-f0-9]{64}$/);
    const fixture = builtIn("generate"); writeFileSync(apiFile, JSON.stringify(fixture.workflow));
    const imported = await owner.importTemplate({ label: "Explicit API JSON", outputNodeId: "9", inputMappings: fixture.inputMappings });
    assert.equal(imported.template.operation, "generate"); assert.equal(service().list().templates.length, 5);
    assert.equal((await owner.importTemplate({ label: "Updated", outputNodeId: "9", inputMappings: fixture.inputMappings })).template.version, 2);
    await assert.rejects(owner.importTemplate({ outputNodeId: "8", inputMappings: fixture.inputMappings }), { code: "COMFYUI_NODE_MAPPING_INVALID" });
    writeFileSync(apiFile, JSON.stringify({ nodes: [{ type: "KSampler" }] }));
    await assert.rejects(owner.importTemplate({ outputNodeId: "9", inputMappings: [] }), { code: "COMFYUI_WORKFLOW_INVALID" });
    const cloud = builtIn("generate").workflow; cloud["11"] = { class_type: "CloudApi", inputs: {} }; writeFileSync(apiFile, JSON.stringify(cloud));
    await assert.rejects(owner.importTemplate({ outputNodeId: "9", inputMappings: fixture.inputMappings }), { code: "COMFYUI_NODE_UNAPPROVED" });
    const originalMappings = fixture.inputMappings.filter(mapping => !["steps", "cfg", "sampler", "scheduler", "denoise"].includes(mapping.kind));
    const oldBuiltInHash = stableHash({ workflow: fixture.workflow, inputMappings: originalMappings, outputNodeId: "9" });
    const migratedBuiltIn = owner.resolve({ ...input, templateHash: oldBuiltInHash });
    assert.equal(migratedBuiltIn.templateHash, templates[0].templateHash); assert.equal(migratedBuiltIn.steps, 20);
    const oldCustom = { ...fixture, id: "legacy-custom", builtIn: false, schemaVersion: undefined, policyVersion: undefined, inputMappings: originalMappings, defaults: { steps: 99 }, exposedInputs: ["steps"] };
    writeFileSync(configPath, JSON.stringify({ version: 1, templates: [oldCustom] }));
    const legacy = service().list().templates.find(template => template.id === "legacy-custom");
    assert.equal(legacy.schemaVersion, 2); assert.equal(legacy.defaults.steps, 20); assert.equal(legacy.exposedInputs.includes("steps"), false);
    assert.equal(service().resolve({ ...input, templateId: legacy.id, templateHash: oldBuiltInHash }).templateHash, legacy.templateHash);
    assert.throws(() => service().resolve({ ...input, templateId: legacy.id, templateHash: legacy.templateHash, steps: 10 }), { code: "COMFYUI_PARAMETER_UNSUPPORTED" });
    writeFileSync(apiFile, JSON.stringify(fixture.workflow));
    await service().importTemplate({ label: "Persistence migration", outputNodeId: "9", inputMappings: fixture.inputMappings });
    assert.equal(service().resolve({ ...input, templateId: legacy.id, templateHash: oldBuiltInHash }).templateHash, legacy.templateHash, "A subsequent import preserves the verified v1 hash alias");
    const stored = JSON.parse(readFileSync(configPath, "utf8"));
    const legacyRecord = stored.templates.find(template => template.id === legacy.id); legacyRecord.policyVersion = "changed-policy";
    writeFileSync(configPath, JSON.stringify(stored));
    assert.throws(() => service().resolve({ ...input, templateId: legacy.id, templateHash: oldBuiltInHash }), { code: "COMFYUI_TEMPLATE_CHANGED" }, "A policy update invalidates the v1 alias");
    const fixed = { ...fixture, id: "fixed-steps", builtIn: false, inputMappings: fixture.inputMappings.map(mapping => mapping.kind === "steps" ? { ...mapping, value: 12 } : mapping), defaults: { steps: 99 } };
    writeFileSync(configPath, JSON.stringify({ version: 1, templates: [fixed] }));
    const fixedMetadata = service().list().templates.find(template => template.id === fixed.id);
    assert.equal(fixedMetadata.defaults.steps, 12); assert.equal(fixedMetadata.exposedInputs.includes("steps"), false);
    assert.throws(() => service().resolve({ ...input, templateId: fixed.id, templateHash: fixedMetadata.templateHash, steps: 13 }), { code: "COMFYUI_PARAMETER_UNSUPPORTED" });
    writeFileSync(configPath, JSON.stringify({ version: 1, templates: [] }));
    canceled = true; assert.equal((await owner.importTemplate({})).canceled, true);
    assert.equal(service().list().templates.length, 4, "Native cancellation leaves the template store unchanged");
    console.log(JSON.stringify({ ok: true, checks: 14, modelRequests: 0, persistence: true, nativeImportOnly: true, credentialsRedacted: true, legacyV1Read: true }));
  } finally { rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
