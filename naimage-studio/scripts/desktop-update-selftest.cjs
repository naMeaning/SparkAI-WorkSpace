const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { createHash } = require("node:crypto");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const originalFs = require("original-fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");
const { canonicalDesktopRelease } = require("../update-release.cjs");
const packageMetadata = require("../package.json");
const packageVersion = packageMetadata.version;
const futureReleaseVersion = "99.0.0";
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "naimage-update-selftest-"));
const publicKeyPath = path.join(temporaryRoot, "public.pem");
const pair = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});
writeFileSync(publicKeyPath, pair.publicKey, "utf8");
process.env.NAIMAGE_AGENT_PROTOCOL_SELFTEST = "1";
process.env.NAIMAGE_UPDATE_PUBLIC_KEY = publicKeyPath;
process.env.NAIMAGE_CONFIG_DIR = temporaryRoot;

const settingsPath = path.join(temporaryRoot, "app-settings.json");
writeFileSync(settingsPath, `${JSON.stringify({
  accountBaseUrl: "https://image.aieyra.cn",
  relayBaseUrl: "",
  updateBaseUrl: "https://image.aieyra.cn",
  serverSessionCookie: "session=old",
  serverUserId: "7"
}, null, 2)}\n`, "utf8");

const main = require("../electron-main.cjs");

let failure = null;
try {
  const release = {
    schema_version: 1,
    product: "naimage-studio",
    channel: "stable",
    version: futureReleaseVersion,
    published_at: "2026-07-18T12:00:00.000Z",
    minimum_version: "1.0.0",
    compatibility: packageMetadata.naimageUpdateCompatibility,
    notes: ["在线更新闭环。"],
    restart: {
      filename: `naimage-Restart-Update-${futureReleaseVersion}-x64.asar`,
      sha256: "a".repeat(64),
      size: 1024
    },
    installer: {
      filename: `naimage-Setup-${futureReleaseVersion}-x64.exe`,
      sha256: "b".repeat(64),
      size: 2048
    }
  };
  const signature = sign(null, Buffer.from(canonicalDesktopRelease(release), "utf8"), pair.privateKey).toString("base64");
  const response = {
    ...release,
    current_version: packageVersion,
    latest_version: release.version,
    update_available: true,
    update_type: "restart",
    requires_captcha: false,
    signature,
    artifact: { ...release.restart, kind: "restart", version: release.version }
  };

  const verified = main.verifyDesktopReleasePayload(response);
  assert.throws(
    () => main.verifyDesktopReleasePayload({ ...response, product: "iiimage-studio" }),
    /不兼容的更新清单/,
    "The desktop updater must reject the retired product identity"
  );
  const splitDefaults = main.migrateSettings({ accountBaseUrl: "https://sparkapi.org" });
  assert.equal(main.resolveNewApiBaseUrl(splitDefaults, "account"), "https://sparkapi.org");
  assert.equal(main.resolveNewApiBaseUrl(splitDefaults, "relay"), "https://sparkapi.org");
  assert.equal(main.resolveNewApiBaseUrl(splitDefaults, "update"), "https://image.aieyra.cn", "Updater must not probe the account-only Spark host by default");
  assert.equal(main.migrateSettings({ serverUrl: "https://legacy-account.example" }).accountBaseUrl, "https://legacy-account.example");
  assert.equal(main.migrateSettings({ serverUrl: "https://legacy-account.example" }).updateBaseUrl, "https://image.aieyra.cn");
  assert.equal(verified.updateType, "restart");
  assert.equal(verified.restart.sha256, "a".repeat(64));
  assert.equal(main.currentDesktopVersion(), packageVersion);
  assert.equal(main.compareDesktopVersions("1.0.3", "1.0.3"), 0);
  assert.equal(main.compareDesktopVersions("1.0.4", "1.0.3"), 1);
  assert.equal(main.compareDesktopVersions("1.0.3-rc.1", "1.0.3"), -1);
  assert.equal(main.compareDesktopVersions("invalid", "1.0.3"), null);
  assert.throws(
    () => main.verifyDesktopReleasePayload({ ...response, restart: { ...response.restart, sha256: "c".repeat(64) } }),
    /签名校验失败/
  );
  assert.throws(
    () => main.normalizeDesktopUpdateArtifact({ filename: "..\\evil.asar", sha256: "a".repeat(64), size: 1 }, "restart", "1.0.1"),
    /无效文件名/
  );
  assert.throws(
    () => main.normalizeDesktopUpdateArtifact({ filename: "safe.asar", sha256: "a".repeat(64), size: 1 }, "restart", "1.2.3-/../../outside"),
    /版本格式无效/
  );
  const incompatibleRelease = {
    ...release,
    version: "99.0.1",
    compatibility: `${packageMetadata.naimageUpdateCompatibility}-different-shell`
  };
  const incompatibleResponse = {
    ...incompatibleRelease,
    latest_version: incompatibleRelease.version,
    update_available: true,
    update_type: "restart",
    requires_captcha: false,
    signature: sign(null, Buffer.from(canonicalDesktopRelease(incompatibleRelease), "utf8"), pair.privateKey).toString("base64"),
    artifact: { ...incompatibleRelease.restart, kind: "restart", version: incompatibleRelease.version }
  };
  const installerFallback = main.verifyDesktopReleasePayload(incompatibleResponse);
  assert.equal(installerFallback.updateType, "installer", "An incompatible Electron shell must use the signed full installer");
  assert.equal(installerFallback.requiresCaptcha, true);

  const replayedCurrentRelease = {
    ...release,
    version: packageVersion,
    restart: { ...release.restart, filename: `naimage-Restart-Update-${packageVersion}-x64.asar` },
    installer: { ...release.installer, filename: `naimage-Setup-${packageVersion}-x64.exe` }
  };
  const replayedCurrent = main.verifyDesktopReleasePayload({
    ...replayedCurrentRelease,
    latest_version: packageVersion,
    update_available: true,
    update_type: "restart",
    signature: sign(null, Buffer.from(canonicalDesktopRelease(replayedCurrentRelease), "utf8"), pair.privateKey).toString("base64"),
    artifact: { ...replayedCurrentRelease.restart, kind: "restart", version: packageVersion }
  });
  assert.equal(replayedCurrent.updateAvailable, false, "A signed replay must never downgrade or reinstall the current version");
  assert.equal(replayedCurrent.updateType, "none");
  const sessionSettings = {
    accountBaseUrl: "https://image.aieyra.cn",
    relayBaseUrl: "",
    updateBaseUrl: "https://image.aieyra.cn",
    serverSessionCookie: "session=old",
    serverUserId: "7"
  };
  const rotated = main.persistNewApiSessionCookie(sessionSettings, {
    requestSessionCookie: "session=old",
    headers: new Headers({ "set-cookie": "session=rotated-value; Path=/; HttpOnly; Secure; SameSite=Lax" })
  });
  assert.equal(rotated, "session=rotated-value");
  assert.equal(sessionSettings.serverSessionCookie, "session=rotated-value");
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).serverSessionCookie, "session=rotated-value");

  const staleSettings = {
    accountBaseUrl: "https://image.aieyra.cn",
    relayBaseUrl: "",
    updateBaseUrl: "https://image.aieyra.cn",
    serverSessionCookie: "session=old",
    serverUserId: "7"
  };
  const retained = main.persistNewApiSessionCookie(staleSettings, {
    requestSessionCookie: "session=old",
    headers: new Headers({ "set-cookie": "session=late-stale-value; Path=/; HttpOnly; Secure; SameSite=Lax" })
  });
  assert.equal(retained, "session=rotated-value");
  assert.equal(staleSettings.serverSessionCookie, "session=rotated-value");
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).serverSessionCookie, "session=rotated-value");

  const retainedAfterStaleClear = main.clearNewApiAuth({
    accountBaseUrl: "https://image.aieyra.cn",
    relayBaseUrl: "",
    updateBaseUrl: "https://image.aieyra.cn",
    serverSessionCookie: "session=old",
    serverUserId: "7"
  });
  assert.equal(retainedAfterStaleClear.serverSessionCookie, "session=rotated-value");
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).serverSessionCookie, "session=rotated-value");

  const futureUpdateVersion = "99.0.2";
  const updateAssetDir = path.join(temporaryRoot, "updates", futureUpdateVersion);
  const updateAssetPath = path.join(updateAssetDir, "naimage-test-update.asar");
  const updateBytes = Buffer.from("raw-asar-update-regression", "utf8");
  mkdirSync(updateAssetDir, { recursive: true });
  originalFs.writeFileSync(updateAssetPath, updateBytes);
  const updateHash = createHash("sha256").update(updateBytes).digest("hex");
  writeFileSync(path.join(temporaryRoot, "updates", "pending-update.json"), `${JSON.stringify({
    kind: "restart",
    version: futureUpdateVersion,
    path: updateAssetPath,
    sha256: updateHash,
    size: updateBytes.length,
    downloadedAt: "2026-07-18T12:00:00.000Z"
  }, null, 2)}\n`, "utf8");
  writeFileSync(path.join(temporaryRoot, "updates", "update-state.json"), `${JSON.stringify({
    progress: {
      stage: "error",
      message: "older failed update",
      version: "98.0.0",
      kind: "restart",
      createdAt: "2026-07-18T12:00:00.000Z"
    }
  }, null, 2)}\n`, "utf8");
  const pending = main.pendingDesktopUpdate();
  assert.equal(pending?.kind, "restart");
  assert.equal(pending?.size, updateBytes.length);
  const resumedStatus = main.desktopUpdaterStatus();
  assert.equal(resumedStatus.latestVersion, futureUpdateVersion);
  assert.equal(resumedStatus.updateType, "restart");
  assert.equal(resumedStatus.canApplyPending, true);
  assert.equal(resumedStatus.progress?.stage, "ready", "A verified pending update must override an older error snapshot");
  assert.equal(resumedStatus.progress?.version, futureUpdateVersion);
  const failedStatus = main.desktopUpdaterFailure(new Error("probe failure"));
  assert.equal(failedStatus.ok, false, "Updater failure payloads must not be overwritten by status.ok");
  assert.equal(failedStatus.error, "probe failure");

  const staleInstallerDir = path.join(temporaryRoot, "updates", packageVersion);
  const staleInstallerPath = path.join(staleInstallerDir, `naimage-Setup-${packageVersion}-x64.exe`);
  const staleInstallerBytes = Buffer.from("already-installed-full-package", "utf8");
  mkdirSync(staleInstallerDir, { recursive: true });
  originalFs.writeFileSync(staleInstallerPath, staleInstallerBytes);
  writeFileSync(path.join(temporaryRoot, "updates", "pending-update.json"), `${JSON.stringify({
    kind: "installer",
    version: packageVersion,
    path: staleInstallerPath,
    sha256: createHash("sha256").update(staleInstallerBytes).digest("hex"),
    size: staleInstallerBytes.length,
    downloadedAt: "2026-07-19T12:00:00.000Z"
  }, null, 2)}\n`, "utf8");
  assert.equal(main.pendingDesktopUpdate(), null, "An already installed full package must not remain pending");
  assert.equal(existsSync(staleInstallerPath), false, "The stale installer artifact must be removed from the managed updates directory");
  assert.equal(existsSync(path.join(temporaryRoot, "updates", "pending-update.json")), false, "Stale pending metadata must be removed after upgrade");

  console.log(JSON.stringify({ ok: true, version: main.currentDesktopVersion(), signatureVerified: true, tamperRejected: true, incompatibleRestartUsesInstaller: true, signedReplayRejected: true, failureStatusPreserved: true, sessionRotationPersisted: true, staleSessionRotationRejected: true, staleAuthClearRejected: true, rawAsarRehydrated: true, pendingStatusResumed: true, staleInstallerPendingCleaned: true }, null, 2));
} catch (error) {
  failure = error;
  process.exitCode = 1;
  console.error(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
  // This process never enters the normal Electron lifecycle. `app.quit()` can
  // be ignored before `ready`, so exit explicitly after stdio has had one turn
  // to flush and preserve assertion failures as a non-zero result.
  setTimeout(() => app.exit(failure ? 1 : 0), 20);
}
