import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isStale, shouldBuildFrontendDist } = require("../services/ai-gateway/server.cjs");

function touch(path, seconds) {
  const date = new Date(seconds * 1000);
  utimesSync(path, date, date);
}

test("isStale detects missing targets and newer source trees", () => {
  const root = mkdtempSync(join(tmpdir(), "gateway-server-test-"));
  const sourceDir = join(root, "src");
  const target = join(root, "dist", "index.html");

  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(sourceDir, "route.tsx"), "source");
  writeFileSync(target, "target");

  touch(join(sourceDir, "route.tsx"), 200);
  touch(sourceDir, 200);
  touch(target, 100);
  assert.equal(isStale(target, [sourceDir]), true);

  touch(target, 300);
  assert.equal(isStale(target, [sourceDir]), false);
  assert.equal(isStale(join(root, "missing"), [sourceDir]), true);
});

test("shouldBuildFrontendDist skips stale frontend rebuild when dev server owns frontend", () => {
  const root = mkdtempSync(join(tmpdir(), "gateway-server-test-"));
  const sourceDir = join(root, "src");
  const target = join(root, "dist", "index.html");

  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(sourceDir, "route.tsx"), "source");
  writeFileSync(target, "target");

  touch(join(sourceDir, "route.tsx"), 200);
  touch(sourceDir, 200);
  touch(target, 100);

  assert.equal(shouldBuildFrontendDist(target, [sourceDir], { externalFrontendDevServer: true }), false);
  assert.equal(shouldBuildFrontendDist(target, [sourceDir], { externalFrontendDevServer: false }), true);
  assert.equal(shouldBuildFrontendDist(join(root, "missing"), [sourceDir], { externalFrontendDevServer: true }), true);
});
