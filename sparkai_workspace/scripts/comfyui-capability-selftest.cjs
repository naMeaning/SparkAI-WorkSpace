"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { createComfyUiTemplateService, builtIn } = require("../desktop/comfyui-template-service.cjs");
const { createComfyUiExecutor, normalizeWorkflow, validateDependencies, normalizeCapabilities, templateHashFor, stableHash } = require("../runtime/image-generation/comfyui-executor.cjs");
const { normalizeComfyUiTaskOptions, normalizeComfyUiGenerationMetadata } = require("../runtime/comfyui-options.mjs");
const { CAPABILITY_POLICY_VERSION } = require("../runtime/image-generation/comfyui-template-registry.cjs");
const { createMockServer, objectInfo } = require("./comfyui-executor-selftest.cjs");

const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash("sha256").update(value).digest("hex");
const reportDirectory = path.resolve(__dirname, "../.diagnostics/comfyui-capability");
const fixtureDirectory = path.join(reportDirectory, `fixtures-${process.pid}`);
const results = [];
let source, mask, cutout, sourceHash, maskHash, fixtureNumber = 0, promptPosts = 0, uploads = 0, views = 0;
const upstreamRevision = "bef11fcbfa8d772678e2ad00b1294c63eb3e5da7";

function ownerFixture() {
  let stored = { version: 1, templates: [] }, canceled = false;
  const file = path.join(fixtureDirectory, `workflow-${fixtureNumber++}.json`);
  const owner = createComfyUiTemplateService({ configPath: "memory-templates", readJson: () => copy(stored), writeJson: (_, value) => { stored = copy(value); },
    dialog: { showOpenDialog: async () => ({ canceled, filePaths: [file] }) } });
  return { owner, write: value => fs.writeFileSync(file, JSON.stringify(value)), cancel: () => { canceled = true; },
    store: value => { stored = copy(value); } };
}

function material(role, buffer = role === "maskImage" ? mask : source, index) {
  return { role, buffer, assetId: `asset-${role}-${index ?? 0}`, occurrenceId: `occurrence-${role}-${index ?? 0}`, contentHash: hash(buffer), mimeType: "image/png", width: 64, height: 96,
    ...(index === undefined ? {} : { index }) };
}

function task(kind, server, extra = {}) {
  const template = builtIn(kind), info = normalizeWorkflow(template.workflow, template);
  return { ...template, baseUrl: server.baseUrl, templateId: template.id, workflowId: template.id, templateHash: templateHashFor(info, template.policyVersion),
    submissionId: `capability-${kind}`, seed: 42, prompt: "fixture prompt", negativePrompt: "", width: 64, height: 96,
    ...(kind === "cutout" ? {} : { checkpoint: "fixture.safetensors" }),
    ...(["inpaint", "cutout"].includes(kind) ? { inputs: [material("sourceImage"), material("maskImage")], maskBindings: { sourceHash, maskHash, width: 64, height: 96, revision: 1 } } : {}),
    pollIntervalMs: 10, maxWaitMs: 1000, ...extra };
}

function executor(options = {}) { return createComfyUiExecutor({ persistPrepared: async () => {}, persistAccepted: async () => {}, ...options }); }
async function fixture(config, fn) {
  const server = await createMockServer({ outputNodeId: "9", uploadImages: [source, mask], imageBytes: source, ...config }, source);
  try { await fn(server); } finally { promptPosts += server.posts.length; uploads += server.uploads.length; views += server.views.length; await server.close(); }
}
async function test(name, fn) { const started = Date.now(); await fn(); results.push({ name, ok: true, durationMs: Date.now() - started }); }

async function main() {
  fs.mkdirSync(fixtureDirectory, { recursive: true });
  source = await sharp({ create: { width: 64, height: 96, channels: 4, background: { r: 30, g: 80, b: 120, alpha: 1 } } }).png().toBuffer();
  const maskPixels = Buffer.alloc(64 * 96 * 4, 255); maskPixels[3] = 0; maskPixels[7] = 128;
  mask = await sharp(maskPixels, { raw: { width: 64, height: 96, channels: 4 } }).png().toBuffer();
  const sourcePixels = await sharp(source).ensureAlpha().raw().toBuffer();
  const joinedPixels = Buffer.from(sourcePixels);
  // Reviewed stock implementations: LoadImageMask(alpha) returns 1 - alpha;
  // JoinImageWithAlpha computes 1 - mask. No InvertMask belongs between them.
  for (let i = 3; i < joinedPixels.length; i += 4) { const loadedMask = 1 - maskPixels[i] / 255; joinedPixels[i] = Math.round((1 - loadedMask) * 255); }
  cutout = await sharp(joinedPixels, { raw: { width: 64, height: 96, channels: 4 } }).png().toBuffer();
  sourceHash = hash(source); maskHash = hash(mask);

  await test("four public capabilities derive their model, material and alpha contracts", () => {
    const templates = ownerFixture().owner.list().templates;
    assert.deepEqual(templates.map(value => value.capability), ["generate", "img2img", "inpaint", "cutout"]);
    assert.deepEqual(templates.map(value => value.imageInputs), [0, 1, 2, 2]);
    assert.deepEqual(templates.map(value => value.schemaVersion), [2, 2, 3, 3]);
    assert.equal(templates[3].requiresCheckpoint, false); assert.equal(templates[3].modelFamily, "none"); assert.equal(templates[3].alphaRequired, true);
    assert.deepEqual(templates[3].defaults, {}); assert.deepEqual(templates[3].exposedInputs, ["sourceImage", "maskImage"]);
    assert.deepEqual(templates[2].inputRoles, { sourceImage: { required: true, maxCount: 1 }, maskImage: { required: true, maxCount: 1, managed: true } });
    for (const value of templates) { assert.equal(value.workflow, undefined); assert.equal(value.legacyTemplateHash, undefined); assert.ok(value.inputMappings.every(mapping => !Object.hasOwn(mapping, "value"))); }
  });
  await test("stock v2 template hashes remain identical to Phase 1", () => {
    const templates = ownerFixture().owner.list().templates;
    assert.equal(templates[0].templateHash, "d0fc111afda407ca235b659e504bad11779c39b8962f4cb81a005065355e61ea");
    assert.equal(templates[1].templateHash, "a12a706569cfbb0affef0e25eb72d214c40b420f6597e2e50bbcf9b2ca9af269");
  });
  await test("workflow and strength aliases normalize once and reject conflicts", () => {
    const input = { workflowId: "stock-inpaint", templateHash: "a".repeat(64), strength: 0.75, denoise: 0.75 };
    const options = normalizeComfyUiTaskOptions(input);
    assert.equal(options.templateId, input.workflowId); assert.equal(options.workflowId, input.workflowId); assert.equal(options.denoise, 0.75); assert.equal(options.strength, undefined);
    assert.throws(() => normalizeComfyUiTaskOptions({ ...input, templateId: "other" }), { code: "COMFYUI_TEMPLATE_CHANGED" });
    assert.throws(() => normalizeComfyUiTaskOptions({ ...input, denoise: 0.5 }), { code: "COMFYUI_PARAMETERS_INVALID" });
  });
  await test("draft and session cutout roundtrip keeps no-checkpoint source dimensions", () => {
    const { owner } = ownerFixture(), template = owner.list().templates[3];
    const options = normalizeComfyUiTaskOptions({ workflowId: template.id, templateHash: template.templateHash, width: 11, height: 17 });
    assert.deepEqual(normalizeComfyUiTaskOptions(options), options); assert.equal(options.checkpoint, undefined);
    assert.equal(owner.resolve(options).requiresCheckpoint, false);
    const generation = owner.list().templates[0];
    assert.throws(() => owner.resolve({ workflowId: generation.id, templateHash: generation.templateHash }), { code: "COMFYUI_MODEL_REQUIRED" });
    assert.throws(() => owner.resolve({ workflowId: template.id, templateHash: template.templateHash, denoise: 0.5 }), { code: "COMFYUI_PARAMETER_UNSUPPORTED" });
  });
  await test("material options accept only stable identity and bounded references", () => {
    const input = { templateId: "stock-inpaint", templateHash: "a".repeat(64), sourceImage: { assetId: "source", occurrenceId: "source-occ", contentHash: sourceHash }, maskImage: { assetId: "mask", occurrenceId: "mask-occ", contentHash: maskHash, revision: 1 } };
    assert.equal(normalizeComfyUiTaskOptions(input).maskImage.revision, 1);
    for (const extra of [{ sourceImage: { ...input.sourceImage, path: "private-path" } }, { maskImage: { ...input.maskImage, revision: 0 } }, { referenceImages: Array(5).fill(input.sourceImage) }]) assert.throws(() => normalizeComfyUiTaskOptions({ ...input, ...extra }), { code: "COMFYUI_INPUT_INVALID" });
  });
  await test("MASK links, stock module identities and alpha channel are checked independently", () => {
    const inpaint = builtIn("inpaint"), cut = builtIn("cutout"); inpaint.workflow["3"].inputs.seed = 42; inpaint.workflow["4"].inputs.ckpt_name = "fixture.safetensors";
    const info = normalizeWorkflow(inpaint.workflow, inpaint); validateDependencies(info, objectInfo());
    validateDependencies(normalizeWorkflow(cut.workflow, cut), objectInfo());
    const all = copy(inpaint);
    all.workflow["14"] = { class_type: "InvertMask", inputs: { mask: ["11", 0] } };
    all.workflow["15"] = { class_type: "MaskToImage", inputs: { mask: ["14", 0] } };
    all.workflow["16"] = { class_type: "ImageToMask", inputs: { image: ["15", 0], channel: "red" } };
    all.workflow["12"] = { class_type: "ImageCompositeMasked", inputs: { destination: ["10", 0], source: ["10", 0], mask: ["16", 0], x: 0, y: 0, resize_source: false } };
    all.workflow["5"].inputs.pixels = ["12", 0];
    all.workflow["13"] = { class_type: "SetLatentNoiseMask", inputs: { samples: ["5", 0], mask: ["16", 0] } }; all.workflow["3"].inputs.latent_image = ["13", 0];
    all.workflow["17"] = { class_type: "JoinImageWithAlpha", inputs: { image: ["8", 0], alpha: ["16", 0] } }; all.workflow["9"].inputs.images = ["17", 0];
    const allInfo = normalizeWorkflow(all.workflow, all); validateDependencies(allInfo, objectInfo());
    const wrong = copy(inpaint); wrong.workflow["5"].inputs.mask = ["10", 0]; assert.throws(() => normalizeWorkflow(wrong.workflow, wrong), { code: "COMFYUI_WORKFLOW_INVALID" });
    const rgb = copy(inpaint); rgb.workflow["11"].inputs.channel = "red"; assert.throws(() => normalizeWorkflow(rgb.workflow, rgb), { code: "COMFYUI_NODE_MAPPING_INVALID" });
    for (const name of ["LoadImageMask", "VAEEncodeForInpaint", "SetLatentNoiseMask", "ImageCompositeMasked", "MaskToImage", "ImageToMask", "InvertMask", "JoinImageWithAlpha"]) {
      const objects = objectInfo(); objects[name].python_module = "custom_nodes.forged";
      assert.equal(normalizeCapabilities(objects, {}).coreNodes.includes(name), false);
      assert.throws(() => validateDependencies(allInfo, objects), { code: "COMFYUI_DEPENDENCY_MISSING" });
    }
    const objects = objectInfo(); objects.JoinImageWithAlpha.python_module = "comfy_extras.nodes_mask";
    assert.throws(() => validateDependencies(normalizeWorkflow(cut.workflow, cut), objects), { code: "COMFYUI_DEPENDENCY_MISSING" });
  });
  await test("inpaint cannot claim a mask applied only after the sampler", () => {
    const value = builtIn("inpaint");
    value.workflow["5"] = { class_type: "VAEEncode", inputs: { pixels: ["10", 0], vae: ["4", 2] } };
    value.workflow["12"] = { class_type: "ImageCompositeMasked", inputs: { destination: ["10", 0], source: ["8", 0], mask: ["11", 0], x: 0, y: 0, resize_source: false } };
    value.workflow["9"].inputs.images = ["12", 0];
    assert.throws(() => normalizeWorkflow(value.workflow, value), { code: "COMFYUI_CAPABILITY_INVALID" });
    value.workflow["13"] = { class_type: "SetLatentNoiseMask", inputs: { samples: ["5", 0], mask: ["11", 0] } }; value.workflow["3"].inputs.latent_image = ["13", 0];
    assert.equal(normalizeWorkflow(value.workflow, value).capability, "inpaint");
  });
  await test("v3 hashes cover canonical graph, roles, output, policy and capability", () => {
    const template = builtIn("inpaint"), info = normalizeWorkflow(template.workflow, template), original = templateHashFor(info, template.policyVersion);
    const variants = [copy(info), copy(info), copy(info), copy(info)];
    variants[0].workflow["6"].inputs.text = "different"; variants[1].inputMappings[0].kind = "negative"; variants[2].outputNodeId = "different"; variants[3].capability = "cutout";
    for (const value of variants) assert.notEqual(templateHashFor(value, template.policyVersion), original);
    assert.notEqual(templateHashFor(info, "different-policy"), original);
    const meta = normalizeWorkflow(template.workflow, { ...template, inputRoles: {}, requiresCheckpoint: false, alphaRequired: false });
    assert.equal(meta.requiresCheckpoint, true); assert.equal(meta.inputRoles.maskImage.managed, true); assert.equal(templateHashFor(meta, template.policyVersion), original);
    assert.throws(() => normalizeWorkflow(template.workflow, { ...template, capability: "cutout" }), { code: "COMFYUI_CAPABILITY_INVALID" });
  });
  await test("stored metadata cannot bypass the derived model contract under an existing hash", () => {
    const state = ownerFixture(), value = { ...builtIn("generate"), id: "forged-metadata", builtIn: false, requiresCheckpoint: false, inputRoles: {}, alphaRequired: true };
    state.store({ version: 1, templates: [value] }); const listed = state.owner.list().templates.find(template => template.id === value.id);
    assert.equal(listed.requiresCheckpoint, true); assert.equal(listed.alphaRequired, false);
    assert.throws(() => state.owner.resolve({ templateId: listed.id, templateHash: listed.templateHash }), { code: "COMFYUI_MODEL_REQUIRED" });
  });
  await test("native preview exposes only reviewed ports and approval consumes its draft", async () => {
    const state = ownerFixture(), value = builtIn("inpaint"); value.workflow["6"].inputs.text = "private-workflow-text"; value.workflow["6"]._meta = { title: "private-workflow-path" }; state.write(value.workflow);
    const preview = await state.owner.previewImport({ label: "Reviewed" });
    assert.equal(preview.blocked, false); assert.deepEqual(preview.candidateCapabilities, ["inpaint"]);
    assert.equal(JSON.stringify(preview).includes("private-workflow"), false); assert.equal(preview.workflow, undefined);
    const maskPort = preview.nodes.find(node => node.classType === "LoadImageMask").inputs.find(port => port.inputName === "image"); assert.deepEqual(maskPort.allowedKinds, ["maskImage"]);
    const approved = state.owner.approveImport({ draftId: preview.draftId, capability: "inpaint", outputNodeId: "9", inputMappings: value.inputMappings });
    assert.equal(approved.template.schemaVersion, 3); assert.equal(approved.template.policyVersion, CAPABILITY_POLICY_VERSION); assert.equal(approved.template.workflow, undefined);
    assert.equal(JSON.stringify(approved).includes("private-workflow"), false);
    assert.throws(() => state.owner.approveImport({ draftId: preview.draftId, capability: "inpaint", outputNodeId: "9", inputMappings: value.inputMappings }), { code: "COMFYUI_TEMPLATE_DRAFT_UNAVAILABLE" });
    await assert.rejects(state.owner.previewImport({ path: "arbitrary" }), { code: "COMFYUI_TEMPLATE_IMPORT_INVALID" });
  });
  await test("unknown, script and arbitrary-file workflows stay blocked and unexecutable", async () => {
    for (const node of [{ class_type: "RunPython", inputs: { code: "private-script" } }, { class_type: "LoadArbitraryFile", inputs: { path: "private-file" } }, { class_type: "CloudApi", inputs: {} }]) {
      const state = ownerFixture(); state.write({ ...builtIn("generate").workflow, "30": node });
      const preview = await state.owner.previewImport({}); assert.equal(preview.blocked, true); assert.deepEqual(preview.candidateCapabilities, []);
      assert.equal(JSON.stringify(preview).includes("private-"), false);
      assert.throws(() => state.owner.approveImport({ draftId: preview.draftId, capability: "generate", outputNodeId: "9", inputMappings: [] }), { code: "COMFYUI_TEMPLATE_BLOCKED" });
    }
    const state = ownerFixture(), value = builtIn("inpaint"); value.workflow["10"].inputs.image = "C:/private/source.png"; state.write(value.workflow);
    assert.equal((await state.owner.previewImport({})).blocked, true);
  });
  await test("approval forbids literal mappings, legacy image indices and injected workflow", async () => {
    const state = ownerFixture(), value = builtIn("inpaint"); state.write(value.workflow); const preview = await state.owner.previewImport({});
    const input = { draftId: preview.draftId, capability: "inpaint", outputNodeId: "9", inputMappings: value.inputMappings };
    for (const mapping of [{ ...value.inputMappings[0], value: "literal" }, { ...value.inputMappings[0], kind: "value", value: "literal" }, { nodeId: "10", inputName: "image", kind: "image", index: 0 }]) assert.throws(() => state.owner.approveImport({ ...input, inputMappings: [mapping] }), { code: "COMFYUI_NODE_MAPPING_INVALID" });
    assert.throws(() => state.owner.approveImport({ ...input, workflow: value.workflow }), { code: "COMFYUI_TEMPLATE_IMPORT_INVALID" });
  });
  await test("draft cancellation, expiry and bounded capacity do not alter templates", async () => {
    const state = ownerFixture(), value = builtIn("cutout"); state.write(value.workflow); const preview = await state.owner.previewImport({});
    const now = Date.now; Date.now = () => now() + 16 * 60_000;
    try { assert.throws(() => state.owner.approveImport({ draftId: preview.draftId, capability: "cutout", outputNodeId: "9", inputMappings: value.inputMappings }), { code: "COMFYUI_TEMPLATE_DRAFT_UNAVAILABLE" }); } finally { Date.now = now; }
    const bounded = ownerFixture(); bounded.write(value.workflow); for (let i = 0; i < 8; i++) await bounded.owner.previewImport({});
    await assert.rejects(bounded.owner.previewImport({}), { code: "COMFYUI_TEMPLATE_DRAFT_CAPACITY" });
    state.cancel(); assert.equal((await state.owner.previewImport({})).canceled, true); assert.equal(state.owner.list().templates.length, 4);
  });
  await test("inpaint materializes distinct uploads and persists typed receipts in order", () => fixture({}, async server => {
    let prepared, accepted;
    const e = executor({ persistPrepared: async value => { assert.equal(server.posts.length, 0); prepared = copy(value); }, persistAccepted: async value => { assert.equal(server.gets.some(item => item.startsWith("/history/")), false); accepted = copy(value); } });
    const result = await e.run(task("inpaint", server, { strength: 0.45 }));
    assert.equal(result.ok, true); assert.equal(server.posts.length, 1); assert.equal(server.uploads.length, 2);
    assert.notEqual(server.posts[0].prompt["10"].inputs.image, server.posts[0].prompt["11"].inputs.image); assert.equal(server.posts[0].prompt["3"].inputs.denoise, 0.45);
    for (const receipt of [prepared, accepted]) { assert.equal(receipt.schemaVersion, 3); assert.equal(receipt.capability, "inpaint"); assert.deepEqual(receipt.maskBindings, { sourceHash, maskHash, width: 64, height: 96, revision: 1 }); assert.deepEqual(receipt.inputs.map(item => item.role), ["sourceImage", "maskImage"]); }
    assert.equal(accepted.workflowHash, stableHash(server.posts[0].prompt)); assert.equal(accepted.actualParams.width, 64); assert.equal(result.alphaRequired, false);
  }));
  await test("wrong roles, missing stable identity, hash, size and mask revisions fail before network", () => fixture({}, async server => {
    const valid = task("inpaint", server), variants = [];
    variants.push({ inputs: [material("sourceImage"), { ...material("maskImage"), role: "referenceImages", index: 0 }] });
    const missing = material("sourceImage"); delete missing.assetId; delete missing.occurrenceId; variants.push({ inputs: [missing, material("maskImage")] });
    variants.push({ inputs: [{ ...material("sourceImage"), contentHash: "0".repeat(64) }, material("maskImage")] });
    variants.push({ inputs: [material("sourceImage"), { ...material("maskImage"), width: 96 }] });
    for (const binding of [{ ...valid.maskBindings, sourceHash: "0".repeat(64) }, { ...valid.maskBindings, maskHash: "0".repeat(64) }, { ...valid.maskBindings, revision: 0 }, { ...valid.maskBindings, width: 96 }, { ...valid.maskBindings, token: "private" }]) variants.push({ maskBindings: binding });
    for (const variant of variants) await assert.rejects(executor().run({ ...valid, ...variant }), error => /^COMFYUI_(INPUT|MASK_BINDING|NODE_MAPPING)_/.test(error.code));
    assert.equal(server.gets.length, 0); assert.equal(server.posts.length, 0); assert.equal(server.uploads.length, 0);
  }));
  await test("same submission rejects changed role identity or mask revision before additional network", () => fixture({}, async server => {
    const input = task("inpaint", server), e = executor(); const first = await e.run(input), count = server.gets.length;
    assert.equal(await e.run(input), first);
    await assert.rejects(e.run({ ...input, maskBindings: { ...input.maskBindings, revision: 2 } }), { code: "COMFYUI_SUBMISSION_CONFLICT" });
    await assert.rejects(e.run({ ...input, inputs: [{ ...material("sourceImage"), assetId: "different-source" }, material("maskImage")] }), { code: "COMFYUI_SUBMISSION_CONFLICT" });
    const swapped = [material("maskImage", source), material("sourceImage", mask)];
    await assert.rejects(e.run({ ...input, inputs: swapped, maskBindings: { ...input.maskBindings, sourceHash: maskHash, maskHash: sourceHash } }), { code: "COMFYUI_SUBMISSION_CONFLICT" });
    assert.equal(server.gets.length, count); assert.equal(server.posts.length, 1); assert.equal(server.uploads.length, 2);
  }));
  await test("four mapped reference slots are required exactly and remain bound across input order", () => fixture({}, async server => {
    const input = task("inpaint", server); let pixels = "10";
    for (let i = 0; i < 4; i++) { const id = String(20 + i), composite = String(30 + i); input.workflow[id] = { class_type: "LoadImage", inputs: { image: `reference-${i}.png` } }; input.inputMappings.push({ nodeId: id, inputName: "image", kind: "referenceImages", index: i }); input.workflow[composite] = { class_type: "ImageCompositeMasked", inputs: { destination: [pixels, 0], source: [id, 0], mask: ["11", 0], x: 0, y: 0, resize_source: false } }; pixels = composite; }
    input.workflow["5"].inputs.pixels = [pixels, 0]; input.templateHash = templateHashFor(normalizeWorkflow(input.workflow, input), input.policyVersion);
    input.inputs = [material("referenceImages", source, 3), material("sourceImage"), material("referenceImages", source, 1), material("maskImage"), material("referenceImages", source, 0), material("referenceImages", source, 2)];
    assert.equal((await executor().run(input)).ok, true); assert.equal(server.uploads.length, 6);
    assert.equal(server.posts[0].prompt["20"].inputs.image, "task-inputs/uploaded-5.png"); assert.equal(server.posts[0].prompt["23"].inputs.image, "task-inputs/uploaded.png");
    assert.deepEqual(normalizeWorkflow(input.workflow, input).inputRoles.referenceImages, { required: true, minCount: 4, maxCount: 4 });
    const state = ownerFixture(); state.write(input.workflow); const preview = await state.owner.previewImport({});
    const approved = state.owner.approveImport({ draftId: preview.draftId, capability: "inpaint", outputNodeId: "9", inputMappings: input.inputMappings });
    assert.deepEqual(approved.template.inputRoles.referenceImages, { required: true, minCount: 4, maxCount: 4 });
    const references = Array.from({ length: 4 }, (_, index) => ({ assetId: `reference-${index}`, occurrenceId: `reference-occurrence-${index}`, contentHash: sourceHash }));
    const options = { templateId: approved.template.id, templateHash: approved.template.templateHash, checkpoint: "fixture.safetensors", referenceImages: references };
    assert.equal(normalizeComfyUiTaskOptions(options, approved.template).referenceImages.length, 4);
    for (const values of [undefined, [], references.slice(0, 3), [...references, references[0]]]) assert.throws(() => normalizeComfyUiTaskOptions({ ...options, referenceImages: values }, approved.template), { code: "COMFYUI_INPUT_INVALID" });
    const requests = server.gets.length;
    await assert.rejects(executor().run({ ...input, submissionId: "missing-reference", inputs: input.inputs.filter(value => value.role !== "referenceImages" || value.index !== 2) }), { code: "COMFYUI_NODE_MAPPING_INVALID" });
    await assert.rejects(executor().run({ ...input, submissionId: "extra-reference", inputs: [...input.inputs, material("referenceImages", source, 3)] }), { code: "COMFYUI_IMAGE_INVALID" });
    const duplicate = input.inputs.map(value => value.role === "referenceImages" && value.index === 2 ? { ...value, index: 3 } : value);
    await assert.rejects(executor().run({ ...input, submissionId: "duplicate-reference", inputs: duplicate }), { code: "COMFYUI_INPUT_INVALID" });
    const sparse = copy(input.inputMappings).filter(mapping => mapping.kind !== "referenceImages" || mapping.index !== 2);
    const graph = copy(input.workflow); graph["32"].inputs.source = ["21", 0]; delete graph["22"];
    assert.throws(() => normalizeWorkflow(graph, { ...input, inputMappings: sparse }), { code: "COMFYUI_NODE_MAPPING_INVALID" });
    assert.equal(server.gets.length, requests); assert.equal(server.posts.length, 1);
  }));
  await test("stock cutout restores managed PNG alpha with transparent pixels removed", () => fixture({ imageBytes: cutout }, async server => {
    let accepted; const input = task("cutout", server), value = await executor({ persistAccepted: async receipt => { accepted = copy(receipt); } }).run(input);
    const raw = await sharp(Buffer.from(value.images[0].value, "base64")).ensureAlpha().raw().toBuffer();
    assert.equal(raw[3], 0); assert.equal(raw[7], 128); assert.equal(raw[11], 255); assert.deepEqual(raw.subarray(0, 3), sourcePixels.subarray(0, 3));
    assert.equal(Object.values(server.posts[0].prompt).some(node => node.class_type === "InvertMask"), false);
    assert.equal(accepted.actualParams.model, "comfyui-mask"); assert.equal(accepted.actualParams.seed, undefined); assert.equal(accepted.requiresCheckpoint, false); assert.equal(value.alphaRequired, true);
    assert.equal(hash(source), sourceHash); assert.equal(hash(mask), maskHash);
  }));
  await test("typed accepted recovery ignores changed capabilities and never reposts", () => fixture({}, async server => {
    let accepted; await executor({ persistAccepted: async value => { accepted = copy(value); } }).run(task("inpaint", server));
    const before = server.gets.length; accepted.capabilitiesHash = "0".repeat(64); server.config.objectInfo = {};
    assert.equal((await executor().recover({ accepted })).ok, true); assert.equal(server.posts.length, 1); assert.equal(server.gets.slice(before).includes("/object_info"), false);
  }));
  await test("unknown typed submission remains one POST and recovers its existing receipt", () => fixture({ disconnect: true }, async server => {
    const input = task("inpaint", server), e = executor(); let snapshot;
    await assert.rejects(e.run(input), error => { snapshot = error.snapshot; return error.code === "COMFYUI_SUBMISSION_UNKNOWN"; });
    await assert.rejects(e.run(input), { code: "COMFYUI_SUBMISSION_UNKNOWN" });
    assert.equal(snapshot.schemaVersion, 3); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await executor().recover({ accepted: snapshot })).ok, true); assert.equal(server.posts.length, 1);
  }));
  await test("generation metadata keeps source relationships separate from strict mask binding", () => {
    const binding = { sourceHash, maskHash, width: 64, height: 96, revision: 2 }, sourceHashes = Array.from({ length: 6 }, (_, i) => String(i + 1).repeat(64));
    const metadata = normalizeComfyUiGenerationMetadata({ protocol: "comfyui", capability: "cutout", sourceHashes, maskBindings: binding, token: "private-token" });
    assert.equal(metadata.capability, "cutout"); assert.equal(metadata.sourceHashes.length, 5); assert.deepEqual(metadata.maskBindings, binding); assert.equal(JSON.stringify(metadata).includes("private-token"), false);
    for (const invalid of [{ ...binding, revision: 0 }, { ...binding, sourceHash: "invalid" }, { ...binding, path: "private" }, { ...binding, width: 16385 }]) assert.equal(normalizeComfyUiGenerationMetadata({ protocol: "comfyui", capability: "inpaint", maskBindings: invalid }).maskBindings, undefined);
    assert.equal(normalizeComfyUiGenerationMetadata({ protocol: "comfyui", capability: "generate", maskBindings: binding }).maskBindings, undefined);
  });
  const report = { ok: true, cases: results.length, results, loopbackPromptPosts: promptPosts, loopbackUploads: uploads, loopbackViews: views, realModelRequests: 0, realRemoteRequests: 0,
    stockAlphaReview: { revision: upstreamRevision, loadImageMask: `https://github.com/Comfy-Org/ComfyUI/blob/${upstreamRevision}/nodes.py#L1824`, joinImageWithAlpha: `https://github.com/Comfy-Org/ComfyUI/blob/${upstreamRevision}/comfy_extras/nodes_compositing.py#L189`, formula: "LoadImageMask(alpha)=1-alpha; JoinImageWithAlpha(mask)=1-mask; output alpha equals managed PNG alpha", pixelAlpha: [0, 128, 255], exercisedStockPython: false } };
  fs.writeFileSync(path.join(reportDirectory, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ ...report, results: undefined, report: ".diagnostics/comfyui-capability/report.json" })}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (path.dirname(fixtureDirectory) === reportDirectory) fs.rmSync(fixtureDirectory, { recursive: true, force: true });
});
