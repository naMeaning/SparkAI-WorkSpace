const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const originalFs = require("original-fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { app } = require("electron");

const persistedMode = process.argv.includes("--verify-persisted");
const configArgument = process.argv.find((value) => value.startsWith("--config="));
const suppliedConfigDir = configArgument ? path.resolve(configArgument.slice("--config=".length)) : "";
const temporaryRoot = persistedMode ? suppliedConfigDir : mkdtempSync(path.join(os.tmpdir(), "naimage-update-rollback-test-"));

process.env.NAIMAGE_AGENT_PROTOCOL_SELFTEST = "1";
process.env.NAIMAGE_CONFIG_DIR = temporaryRoot;
if (!persistedMode) process.env.NAIMAGE_UPDATE_ROLLBACK_SELFTEST = "1";
else delete process.env.NAIMAGE_UPDATE_ROLLBACK_SELFTEST;

let failure = null;
try {
  if (!persistedMode) {
    const version = "99.1.0";
    const updateDir = path.join(temporaryRoot, "updates", version);
    const updatePath = path.join(updateDir, `naimage-Restart-Update-${version}-x64.asar`);
    const bytes = Buffer.from("restart-update-that-failed-health-check", "utf8");
    mkdirSync(updateDir, { recursive: true });
    originalFs.writeFileSync(updatePath, bytes);
    writeFileSync(path.join(temporaryRoot, "updates", "pending-update.json"), `${JSON.stringify({
      kind: "restart",
      version,
      path: updatePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
      downloadedAt: "2026-07-20T08:00:00.000Z"
    }, null, 2)}\n`, "utf8");
    writeFileSync(path.join(temporaryRoot, "updates", "update-state.json"), `${JSON.stringify({
      progress: {
        stage: "applying",
        message: "naimage 即将重启并完成更新…",
        version,
        kind: "restart",
        createdAt: "2026-07-20T08:00:01.000Z"
      }
    }, null, 2)}\n`, "utf8");
  }

  const main = require("../electron-main.cjs");
  const status = main.desktopUpdaterStatus();
  assert.equal(status.rollbackDetected, true, "Rollback recovery must survive beyond the command-line launch");
  assert.equal(status.pending, null, "A failed restart archive must not remain the default action");
  assert.equal(status.failedPending?.kind, "restart", "The failed archive should remain available for diagnostics");
  assert.equal(status.updateAvailable, true);
  assert.equal(status.updateType, "installer", "Rollback recovery must route the user to the signed full installer");
  assert.equal(status.requiresCaptcha, true);
  assert.equal(status.canApplyPending, false);
  assert.equal(status.progress?.stage, "error");
  assert.match(status.progress?.message || "", /完整安装包/);

  const persistedState = JSON.parse(readFileSync(path.join(temporaryRoot, "updates", "update-state.json"), "utf8"));
  assert.equal(persistedState.rollback?.active, true);
  assert.equal(persistedState.rollback?.version, status.failedPending.version);

  if (!persistedMode) {
    const childEnvironment = { ...process.env };
    delete childEnvironment.NAIMAGE_UPDATE_ROLLBACK_SELFTEST;
    const child = spawnSync(process.execPath, [__filename, "--verify-persisted", `--config=${temporaryRoot}`], {
      cwd: path.dirname(__dirname),
      env: childEnvironment,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000
    });
    assert.equal(child.status, 0, `Persisted rollback probe failed:\n${child.stdout || ""}\n${child.stderr || ""}`);
    console.log(JSON.stringify({
      ok: true,
      rollbackPersisted: true,
      failedRestartSuppressed: true,
      installerFallbackReachable: true,
      nextOrdinaryLaunchPreserved: true
    }, null, 2));
  }
} catch (error) {
  failure = error;
  process.exitCode = 1;
  console.error(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  if (!persistedMode && existsSync(temporaryRoot)) rmSync(temporaryRoot, { recursive: true, force: true });
  setTimeout(() => app.exit(failure ? 1 : 0), 20);
}
