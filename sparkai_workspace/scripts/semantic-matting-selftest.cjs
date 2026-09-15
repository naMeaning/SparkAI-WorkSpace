"use strict";

const assert = require("node:assert/strict");
const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { refineSemanticLayers } = require("../semantic-matting.cjs");
const { resolveLayerReplayRoot } = require("./layer-replay-fixture.cjs");

const explicitRoot = process.argv.find((value, index) => index > 1 && value !== "--write");
const replayFixture = resolveLayerReplayRoot({ repoRoot: process.cwd(), explicitRoot, requireMaskReplay: true });
if (!replayFixture.root) {
  const result = {
    ok: true,
    skipped: true,
    reason: "no-completed-mask-replay-fixture",
    hint: "Run test:layer-mask-replay with a real output folder and --write before strict semantic replay.",
  };
  if (process.env.NAIMAGE_REQUIRE_REAL_LAYER_FIXTURE === "1") assert.fail(result.hint);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
const root = replayFixture.root;
const files = readdirSync(root).filter((name) => name.toLowerCase().endsWith(".png"));
const previewName = files.find((name) => /-preview-1-01\.png$/i.test(name));
const backgroundName = files.find((name) => /-1-background-1-01\.png$/i.test(name));
assert(previewName && backgroundName, "missing preview or background image");
const replayRoot = path.join(root, "mask-replay");
const layerSpecs = [
  { id: "foreground-scene", role: "foreground", name: "raw-02-foreground-scene.png" },
  { id: "subject", role: "subject", name: "raw-03-subject.png" },
  { id: "props", role: "decoration", name: "raw-04-props.png" },
  { id: "title", role: "text", name: "raw-05-title.png" },
  { id: "body-text", role: "text", name: "raw-06-body-text.png" }
];
assert(layerSpecs.every((layer) => existsSync(path.join(replayRoot, layer.name))), "run test:layer-mask-replay --write first");
const dataUrl = (filePath) => `data:image/png;base64,${readFileSync(filePath).toString("base64")}`;
const preview = PNG.sync.read(readFileSync(path.join(root, previewName)));

(async () => {
  const alignedDirect = await refineSemanticLayers({
    mode: "direct-alignment",
    width: preview.width,
    height: preview.height,
    previewSource: dataUrl(path.join(root, previewName)),
    backgroundSource: dataUrl(path.join(root, backgroundName)),
    layers: layerSpecs
      .filter((layer) => layer.role === "subject" || layer.role === "decoration")
      .map((layer) => ({ id: layer.id, role: layer.role, source: dataUrl(path.join(replayRoot, layer.name)) }))
  });
  assert(alignedDirect.ok && alignedDirect.reports.every((report) => report.accepted === true), "direct subject/decoration alignment failed");
  const alignedDirectById = new Map(alignedDirect.layers.map((layer) => [layer.id, layer.source]));
  const result = await refineSemanticLayers({
    width: preview.width,
    height: preview.height,
    previewSource: dataUrl(path.join(root, previewName)),
    backgroundSource: dataUrl(path.join(root, backgroundName)),
    layers: layerSpecs.map((layer) => ({
      ...layer,
      source: alignedDirectById.get(layer.id) || dataUrl(path.join(replayRoot, layer.name)),
      preserveGeometry: layer.id === "body-text" || layer.role === "decoration",
      directSubjectSeed: layer.role === "subject"
    }))
  });
  const subject = result.reports.find((report) => report.role === "subject");
  const lockedText = result.reports.find((report) => report.id === "body-text");
  assert(result.ok && result.engine === "opencv-grabcut", "semantic matting engine did not complete");
  assert(subject?.accepted === true, `subject semantic matte rejected: ${subject?.reason || "missing"}`);
  assert(subject.outputVisiblePixels >= subject.inputVisiblePixels * 0.55, "subject matte lost excessive content");
  assert(subject.outputVisiblePixels <= subject.inputVisiblePixels * 2.8, "subject matte expanded excessively");
  assert(lockedText?.geometryPreserved === true, "locked text geometry was not preserved");
  assert.equal(lockedText.geometryIou, 1, "locked text alpha IoU changed");
  assert.equal(lockedText.visibleRetention, 1, "locked text visible coverage changed");
  const lockedSource = PNG.sync.read(readFileSync(path.join(replayRoot, "raw-06-body-text.png")));
  const lockedResult = PNG.sync.read(Buffer.from(String(result.layers.find((layer) => layer.id === "body-text").source).split(",")[1] || "", "base64"));
  for (let offset = 3; offset < lockedSource.data.length; offset += 4) {
    assert.equal(lockedResult.data[offset], lockedSource.data[offset], `locked text alpha changed at pixel ${Math.floor(offset / 4)}`);
  }

  const directPayload = {
    mode: "direct-alignment",
    width: preview.width,
    height: preview.height,
    previewSource: dataUrl(path.join(root, previewName)),
    backgroundSource: dataUrl(path.join(root, backgroundName)),
    layers: [{ id: "direct-subject", role: "subject", source: dataUrl(path.join(replayRoot, "raw-03-subject.png")) }]
  };
  const productionDirect = await refineSemanticLayers(directPayload);
  assert(!Object.hasOwn(productionDirect.reports[0] || {}, "alignmentScaleCandidates"), "production direct alignment leaked diagnostic candidates");
  const diagnosticDirect = await refineSemanticLayers(directPayload, { diagnostics: true });
  assert(Array.isArray(diagnosticDirect.reports[0]?.alignmentScaleCandidates), "diagnostic direct alignment omitted scale candidates");
  const checker = new PNG({ width: 64, height: 64, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  for (let y = 0; y < checker.height; y += 1) {
    for (let x = 0; x < checker.width; x += 1) {
      const offset = (y * checker.width + x) * 4;
      const value = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 254 : 236;
      checker.data[offset] = value;
      checker.data[offset + 1] = value;
      checker.data[offset + 2] = value;
      checker.data[offset + 3] = 255;
      if (x >= 20 && x < 44 && y >= 16 && y < 52) {
        checker.data[offset] = 38;
        checker.data[offset + 1] = 112;
        checker.data[offset + 2] = 168;
      }
    }
  }
  const isolated = await refineSemanticLayers({
    mode: "background-removal",
    width: checker.width,
    height: checker.height,
    source: `data:image/png;base64,${PNG.sync.write(checker).toString("base64")}`
  });
  assert(isolated.ok && isolated.engine === "checkerboard-chroma-isolation", "background isolation worker did not complete");
  assert.equal(isolated.checkerboardDetected, true, "background isolation worker missed checkerboard plate");
  const isolatedPng = PNG.sync.read(Buffer.from(String(isolated.source).split(",")[1] || "", "base64"));
  assert.equal(isolatedPng.data[(4 * checker.width + 4) * 4 + 3], 0, "checker background remained opaque");
  assert.equal(isolatedPng.data[(30 * checker.width + 30) * 4 + 3], 255, "foreground was removed by checker isolation");
  if (process.argv.includes("--write")) {
    const outputRoot = path.join(replayRoot, "semantic-matting");
    mkdirSync(outputRoot, { recursive: true });
    for (const layer of result.layers) {
      const encoded = String(layer.source).split(",")[1] || "";
      writeFileSync(path.join(outputRoot, `${layer.id}.png`), Buffer.from(encoded, "base64"));
    }
    writeFileSync(path.join(outputRoot, "report.json"), JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify({
    ok: true,
    engine: result.engine,
    outputRoot: process.argv.includes("--write") ? path.join(replayRoot, "semantic-matting") : "",
    reports: result.reports,
    directDiagnosticsSuppressed: true,
    backgroundIsolationWorker: true
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
