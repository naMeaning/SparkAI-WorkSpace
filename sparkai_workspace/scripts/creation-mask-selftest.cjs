"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { createCreationMaskService } = require("../desktop/creation-mask-service.cjs");

const root = path.resolve(__dirname, "..", ".diagnostics", `creation-mask-${Date.now()}`);
fs.mkdirSync(path.join(root, "assets"), { recursive: true });
const project = { id: "project", path: root };
const hash = value => createHash("sha256").update(value).digest("hex");
const target = { assetId: "source", occurrenceId: "source-occurrence", contentHash: "" };
let source;
const session = { conversations: [{ id: "conversation" }, { id: "other-conversation" }], nodes: [] };
const options = { projectFor: id => id === project.id ? project : null, readSession: () => session,
  projectRelativePath: (base, file) => path.relative(base, file).replace(/\\/g, "/"), resolveProjectRelativePath: (base, file) => path.resolve(base, file), sharp };
let service = createCreationMaskService(options), checks = 0;
const scope = { expectedProjectId: project.id, conversationId: "conversation", target };
const dataUrl = bytes => `data:image/png;base64,${bytes.toString("base64")}`;
async function check(name, action) { await action(); checks++; process.stdout.write(`ok ${checks} ${name}\n`); }

(async () => {
  source = await sharp({ create: { width: 12, height: 10, channels: 4, background: "red" } }).png().toBuffer();
  target.contentHash = hash(source);
  fs.writeFileSync(path.join(root, "assets", "source.png"), source);
  session.nodes.push({ type: "image", assets: [{ ...target, status: "done", relativePath: "assets/source.png" }] });
  const raw = Buffer.alloc(12 * 10 * 4, 255);
  for (let pixel = 0; pixel < 30; pixel++) raw[pixel * 4 + 3] = 0;
  const maskBytes = await sharp(raw, { raw: { width: 12, height: 10, channels: 4 } }).png().toBuffer();
  let mask, material;
  await check("actual PNG is managed, target bound and survives owner restart", async () => {
    const savedMask = await service.save({ ...scope, dataUrl: dataUrl(maskBytes) });
    ({ mask } = savedMask);
    assert.equal(savedMask.revision, 1); assert.equal(savedMask.width, 12); assert.equal(savedMask.height, 10); assert.deepEqual(savedMask.sourceImage, target);
    assert.deepEqual(Object.keys(mask), ["assetId", "occurrenceId", "contentHash"]);
    service = createCreationMaskService(options);
    material = service.resolve({ ...scope, mask });
    assert.equal(material.mimeType, "image/png"); assert.equal(material.width, 12); assert.equal(material.height, 10); assert.equal(material.revision, 1);
    assert.deepEqual(material.target, target); assert.match(material.relativePath, /^\.naimage\/creation-masks\/mask-[\da-f-]+\.png$/);
    const saved = fs.readFileSync(material.path), metadata = await sharp(saved).metadata();
    assert.equal(hash(saved), mask.contentHash); assert.equal(metadata.hasAlpha, true);
    assert.deepEqual(service.freeze({ ...scope, targets: [{ ...target, mask }] }), [material]);
    assert.deepEqual(service.freeze({ ...scope, targets: [target] }), []);
  });
  await check("new mask revisions keep prior bytes and identities immutable", async () => {
    const priorBytes = fs.readFileSync(material.path);
    const next = await service.save({ ...scope, dataUrl: dataUrl(maskBytes) });
    assert.equal(next.revision, 2); assert.notEqual(next.mask.assetId, mask.assetId); assert.notEqual(next.mask.occurrenceId, mask.occurrenceId);
    assert.deepEqual(fs.readFileSync(material.path), priorBytes);
    assert.equal(service.resolve({ ...scope, mask: { ...mask, revision: 1 } }).revision, 1);
    assert.equal(service.resolve({ ...scope, mask: next.mask, revision: 2 }).revision, 2);
    assert.throws(() => service.resolve({ ...scope, mask: { ...next.mask, revision: 1 } }), { code: "CREATION_MASK_REVISION_INVALID" });
    assert.throws(() => service.resolve({ ...scope, mask: { ...next.mask, revision: 2 }, revision: 1 }), { code: "CREATION_MASK_REVISION_INVALID" });
    for (const revision of [0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => service.resolve({ ...scope, mask: next.mask, revision }), { code: "CREATION_MASK_REVISION_INVALID" });
  });
  await check("list exposes identities and revisions scoped to source and conversation", async () => {
    const other = await service.save({ ...scope, conversationId: "other-conversation", dataUrl: dataUrl(maskBytes) });
    assert.equal(other.revision, 1);
    const listed = service.list({ ...scope, sourceImage: target });
    assert.deepEqual(listed.map(value => value.revision), [1, 2]);
    assert.deepEqual(Object.keys(listed[0]), ["assetId", "occurrenceId", "contentHash", "revision", "width", "height", "sourceImage"]);
    assert.equal(JSON.stringify(listed).includes(root), false); assert.equal(JSON.stringify(listed).includes("data:"), false);
    assert.deepEqual(service.list({ ...scope, conversationId: "other-conversation" }).map(value => value.assetId), [other.mask.assetId]);
    const otherTarget = { ...target, assetId: "other-source", occurrenceId: "other-source-occurrence" };
    session.nodes.push({ type: "image", assets: [{ ...otherTarget, status: "done", relativePath: "assets/source.png" }] });
    assert.deepEqual(service.list({ ...scope, target: otherTarget }), []);
    assert.throws(() => service.list({ ...scope, conversationId: "missing-conversation" }), { code: "CREATION_MASK_SCOPE_INVALID" });
  });
  await check("legacy v1 records resolve as revision one and duplicate identities fail closed", async () => {
    const file = path.join(root, ".naimage", "creation-masks", "manifest.json"), original = fs.readFileSync(file, "utf8");
    const legacy = JSON.parse(original); delete legacy.masks[0].revision; fs.writeFileSync(file, JSON.stringify(legacy));
    assert.equal(service.resolve({ ...scope, mask }).revision, 1); assert.equal(service.list(scope)[0].revision, 1);
    const duplicate = JSON.parse(original); duplicate.masks.push({ ...duplicate.masks[0] }); fs.writeFileSync(file, JSON.stringify(duplicate));
    assert.throws(() => service.resolve({ ...scope, mask }), { code: "CREATION_MASK_STORE_INVALID" });
    fs.writeFileSync(file, original);
  });
  await check("forged mask and cross-conversation identities never resolve", async () => {
    assert.throws(() => service.resolve({ ...scope, mask: { ...mask, occurrenceId: "forged" } }), { code: "CREATION_MASK_IDENTITY_INVALID" });
    assert.throws(() => service.resolve({ ...scope, conversationId: "other-conversation", mask }), { code: "CREATION_MASK_IDENTITY_INVALID" });
    assert.throws(() => service.resolve({ ...scope, target: { ...target, occurrenceId: "other-target" }, mask }), { code: "CREATION_MASK_IDENTITY_INVALID" });
    assert.throws(() => service.resolve({ ...scope, expectedProjectId: "other-project", mask }), { code: "PROJECT_NOT_FOUND" });
  });
  await check("revision mask accepts identity only and exactly one target", async () => {
    assert.throws(() => service.resolve({ ...scope, mask: { ...mask, path: material.path } }), { code: "CREATION_MASK_INVALID" });
    assert.throws(() => service.resolve({ ...scope, mask: { ...mask, dataUrl: dataUrl(maskBytes) } }), { code: "CREATION_MASK_INVALID" });
    assert.throws(() => service.freeze({ ...scope, targets: [{ ...target, mask }, { ...target, occurrenceId: "other" }] }), { code: "CREATION_MASK_SINGLE_TARGET" });
  });
  await check("mismatched pixel dimensions and opaque masks are rejected", async () => {
    const wrongSize = await sharp(maskBytes).resize(24, 20).png().toBuffer();
    await assert.rejects(service.save({ ...scope, dataUrl: dataUrl(wrongSize) }), { code: "CREATION_MASK_SIZE_MISMATCH" });
    await assert.rejects(service.save({ ...scope, dataUrl: dataUrl(source) }), { code: "CREATION_MASK_EMPTY" });
    await assert.rejects(service.save({ ...scope, dataUrl: "data:image/png;base64,AAAA" }), { code: "CREATION_MASK_INVALID" });
    await assert.rejects(service.save({ ...scope, dataUrl: dataUrl(maskBytes.subarray(0, 45)) }), { code: "CREATION_MASK_INVALID" });
    await assert.rejects(service.save({ ...scope, dataUrl: "file:///private/mask.png" }), { code: "CREATION_MASK_INVALID" });
  });
  await check("changed source bytes invalidate a registered mask", async () => {
    fs.writeFileSync(path.join(root, "assets", "source.png"), maskBytes);
    assert.throws(() => service.resolve({ ...scope, mask }), { code: "CREATION_TARGET_STALE" });
    fs.writeFileSync(path.join(root, "assets", "source.png"), source);
  });
  await check("tampered PNG bytes and deleted masks fail before freezing", async () => {
    const saved = fs.readFileSync(material.path);
    fs.writeFileSync(material.path, Buffer.concat([saved, Buffer.from("tampered")]));
    assert.throws(() => service.freeze({ ...scope, targets: [{ ...target, mask }] }), { code: "CREATION_MASK_STALE" });
    fs.writeFileSync(material.path, saved); fs.renameSync(material.path, `${material.path}.saved`);
    assert.throws(() => service.resolve({ ...scope, mask }), { code: "CREATION_MASK_FILE_UNAVAILABLE" });
    fs.renameSync(`${material.path}.saved`, material.path);
  });
  await check("registry path traversal and source outside managed roots are rejected", async () => {
    const manifest = path.join(root, ".naimage", "creation-masks", "manifest.json"), text = fs.readFileSync(manifest, "utf8");
    const corrupted = JSON.parse(text); corrupted.masks[0].relativePath = "assets/source.png";
    fs.writeFileSync(manifest, JSON.stringify(corrupted));
    assert.throws(() => service.resolve({ ...scope, mask }), { code: "CREATION_MASK_STORE_INVALID" });
    fs.writeFileSync(manifest, text);
    session.nodes[0].assets[0].relativePath = "../source.png";
    await assert.rejects(service.save({ ...scope, dataUrl: dataUrl(maskBytes) }), { code: "CREATION_TARGET_STALE" });
    session.nodes[0].assets[0].relativePath = "assets/source.png";
  });
  await check("a linked mask directory cannot redirect writes", async () => {
    const linkedRoot = path.join(root, "linked-project"), outside = path.join(root, "outside");
    fs.mkdirSync(path.join(linkedRoot, ".naimage"), { recursive: true }); fs.mkdirSync(outside);
    fs.cpSync(path.join(root, "assets"), path.join(linkedRoot, "assets"), { recursive: true });
    fs.symlinkSync(outside, path.join(linkedRoot, ".naimage", "creation-masks"), process.platform === "win32" ? "junction" : "dir");
    const linked = createCreationMaskService({ ...options, projectFor: () => ({ id: project.id, path: linkedRoot }) });
    await assert.rejects(linked.save({ ...scope, dataUrl: dataUrl(maskBytes) }), { code: "CREATION_MASK_FILE_UNAVAILABLE" });
    assert.deepEqual(fs.readdirSync(outside), []);
  });
  const result = { ok: true, checks, realModelRequests: 0 };
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
