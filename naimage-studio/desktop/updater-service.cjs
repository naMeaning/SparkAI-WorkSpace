"use strict";

const { spawn } = require("node:child_process");
const { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statfsSync, statSync, writeFileSync } = require("node:fs");
const {
  createReadStream: createRawReadStream,
  existsSync: rawExistsSync,
  renameSync: rawRenameSync,
  rmSync: rawRmSync,
  statSync: rawStatSync
} = require("original-fs");
const { createHash, randomBytes, verify } = require("node:crypto");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { setTimeout: delay } = require("node:timers/promises");
const { canonicalDesktopRelease } = require("../update-release.cjs");

const DESKTOP_UPDATE_PRODUCT = "naimage-studio";
const DESKTOP_UPDATE_PRODUCT_HEADER = "X-Naimage-Desktop-Product";
const DESKTOP_UPDATE_DOWNLOAD_PREFIX = "/downloads/naimage-studio/";
const UPDATE_HEALTH_TOKEN_ARGUMENT_PREFIX = "--naimage-update-token=";
const LEGACY_DESKTOP_UPDATE_PRODUCT = "iiimage-studio";
const LEGACY_DESKTOP_UPDATE_DOWNLOAD_PREFIX = "/downloads/iiimage-studio/";
const LEGACY_UPDATE_HEALTH_TOKEN_ARGUMENT_PREFIX = "--iiimage-update-token=";

function createDesktopUpdaterService(options = {}) {
  const {
    app,
    BrowserWindow,
    configDir,
    projectRoot,
    packageMetadata,
    settingsPath,
    defaultSettings,
    aidebugMode = false,
    aidebugLiveImage = false,
    migrateSettings,
    readJson,
    writeJson,
    isPathInside,
    log = () => {},
    requireNewApiSession,
    newApiRequest,
    newApiUserAuthHeaders,
    resolveNewApiBaseUrl,
    newApiTransportFetch,
    parseJsonText,
    newApiErrorMessage,
    shutdownApplicationServices
  } = options;

  const updatesDir = path.join(configDir, "updates");
  const pendingUpdatePath = path.join(updatesDir, "pending-update.json");
  const updateStatePath = path.join(updatesDir, "update-state.json");
  const updateHealthDir = path.join(updatesDir, "health");
  const updateCompatibility = String(packageMetadata.naimageUpdateCompatibility || "").trim();
  const updatePublicKeyPath = process.env.NAIMAGE_UPDATE_PUBLIC_KEY
    ? path.resolve(process.env.NAIMAGE_UPDATE_PUBLIC_KEY)
    : path.join(projectRoot, "build", "update-public-key.pem");
  const updateHelperPath = path.join(process.resourcesPath, "update-helper.ps1");
  const updateLauncherPath = path.join(process.resourcesPath, "update-launcher.ps1");
  const updateHealthArgument = process.argv.find((item) => item.startsWith(UPDATE_HEALTH_TOKEN_ARGUMENT_PREFIX))
    || process.argv.find((item) => item.startsWith(LEGACY_UPDATE_HEALTH_TOKEN_ARGUMENT_PREFIX));
  const updateHealthToken = String(updateHealthArgument || "").split("=").slice(1).join("=").trim();
  const updateRollbackDetected = process.argv.includes("--update-rollback") || process.env.NAIMAGE_UPDATE_ROLLBACK_SELFTEST === "1";

  let restartUpdateHealthAcknowledged = false;
  let latestDesktopUpdate = null;
  let updateCheckPromise = null;
  let updateDownloadOperation = null;
  let updateApplyOperation = null;
  let latestDesktopUpdateProgress = null;
  let lastDesktopUpdateStateWriteAt = 0;
  let lastDesktopUpdateStateStage = "";
  let desktopUpdateStateLoaded = false;
  let persistedDesktopUpdateRollback = null;
  let desktopUpdateHandoffAccepted = false;
  let installerCaptchaInflight = null;

  function currentDesktopVersion() {
    return String((app.isPackaged ? app.getVersion() : packageMetadata.version) || "0.0.0");
  }

  function parseDesktopVersion(value) {
    const text = String(value || "").trim();
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.exec(text);
    if (!match) return null;
    return {
      text,
      core: [Number(match[1]), Number(match[2]), Number(match[3])],
      prerelease: match[4] ? match[4].split(".") : []
    };
  }

  function compareDesktopVersions(leftValue, rightValue) {
    const left = parseDesktopVersion(leftValue);
    const right = parseDesktopVersion(rightValue);
    if (!left || !right) return null;
    for (let index = 0; index < 3; index += 1) {
      if (left.core[index] !== right.core[index]) return left.core[index] < right.core[index] ? -1 : 1;
    }
    if (!left.prerelease.length && !right.prerelease.length) return 0;
    if (!left.prerelease.length) return 1;
    if (!right.prerelease.length) return -1;
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
      const leftPart = left.prerelease[index];
      const rightPart = right.prerelease[index];
      if (leftPart === undefined) return -1;
      if (rightPart === undefined) return 1;
      if (leftPart === rightPart) continue;
      const leftNumeric = /^\d+$/.test(leftPart);
      const rightNumeric = /^\d+$/.test(rightPart);
      if (leftNumeric && rightNumeric) return Number(leftPart) < Number(rightPart) ? -1 : 1;
      if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
      return leftPart < rightPart ? -1 : 1;
    }
    return 0;
  }

  function desktopUpdatePlatformPayload() {
    return {
      product: DESKTOP_UPDATE_PRODUCT,
      current_version: currentDesktopVersion(),
      platform: process.platform,
      architecture: process.arch,
      compatibility: updateCompatibility
    };
  }

  function desktopUpdateRequestHeaders(settings) {
    return {
      ...newApiUserAuthHeaders(settings),
      [DESKTOP_UPDATE_PRODUCT_HEADER]: DESKTOP_UPDATE_PRODUCT
    };
  }

  function normalizeDesktopUpdateArtifact(value, kind, version) {
    const source = value && typeof value === "object" ? value : {};
    const filename = String(source.filename || "").trim();
    const sha256 = String(source.sha256 || "").trim().toLowerCase();
    const size = Math.max(0, Math.floor(Number(source.size) || 0));
    if (!filename || path.basename(filename) !== filename) throw new Error("更新清单包含无效文件名。");
    if (kind === "installer" && !/\.exe$/i.test(filename)) throw new Error("完整安装包格式无效。");
    if (kind === "restart" && !/\.asar$/i.test(filename)) throw new Error("重启更新包格式无效。");
    if (!/^[a-f0-9]{64}$/.test(sha256) || size <= 0) throw new Error("更新清单的完整性信息无效。");
    const artifactVersion = String(source.version || version || "").trim();
    if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(artifactVersion)) {
      throw new Error("更新包版本格式无效。");
    }
    if (artifactVersion && version && artifactVersion !== version) throw new Error("更新包版本与发布清单不一致。");
    return { kind, filename, version, sha256, size };
  }

  function desktopUpdateArtifactsMatch(left, right) {
    return Boolean(
      left && right &&
      left.kind === right.kind &&
      left.version === right.version &&
      left.filename === right.filename &&
      left.sha256 === right.sha256 &&
      left.size === right.size
    );
  }

  function verifyDesktopReleasePayload(value) {
    const source = value && typeof value === "object" ? value : {};
    const version = String(source.latest_version || source.version || "").trim();
    const release = {
      schema_version: Number(source.schema_version) || 0,
      product: String(source.product || "").trim(),
      channel: String(source.channel || "stable").trim(),
      version,
      published_at: String(source.published_at || "").trim(),
      minimum_version: String(source.minimum_version || "").trim(),
      compatibility: String(source.compatibility || "").trim(),
      notes: Array.isArray(source.notes) ? source.notes.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12) : [],
      restart: source.restart || null,
      installer: source.installer || null
    };
    if (
      release.schema_version !== 1
      || ![DESKTOP_UPDATE_PRODUCT, LEGACY_DESKTOP_UPDATE_PRODUCT].includes(release.product)
      || !parseDesktopVersion(version)
    ) {
      throw new Error("服务器返回了不兼容的更新清单。");
    }
    if (!parseDesktopVersion(release.minimum_version) || !release.compatibility) {
      throw new Error("更新清单缺少有效的兼容性边界。");
    }
    if (!release.installer) throw new Error("更新清单缺少完整安装包。");
    const signatureText = String(source.signature || "").trim();
    if (!signatureText || !existsSync(updatePublicKeyPath)) throw new Error("更新清单缺少可信签名。");
    let signature;
    try {
      signature = Buffer.from(signatureText, "base64");
    } catch {
      throw new Error("更新清单签名格式无效。");
    }
    const verified = signature.length > 0 && verify(
      null,
      Buffer.from(canonicalDesktopRelease(release), "utf8"),
      readFileSync(updatePublicKeyPath, "utf8"),
      signature
    );
    if (!verified) throw new Error("更新清单签名校验失败，已停止更新。");
    const installer = normalizeDesktopUpdateArtifact(release.installer, "installer", version);
    const restart = release.restart ? normalizeDesktopUpdateArtifact(release.restart, "restart", version) : null;
    const declaredUpdateType = source.update_type === "restart" || source.update_type === "installer" ? source.update_type : "none";
    const declaredArtifact = declaredUpdateType === "restart" ? restart : declaredUpdateType === "installer" ? installer : null;
    if (declaredUpdateType === "restart" && !restart) throw new Error("服务器未提供兼容的重启更新包。");
    if (source.artifact && declaredArtifact) {
      const selectedFromServer = normalizeDesktopUpdateArtifact(source.artifact, declaredUpdateType, version);
      if (!desktopUpdateArtifactsMatch(selectedFromServer, declaredArtifact)) {
        throw new Error("服务器选择的更新包与签名清单不一致。");
      }
    }
    const currentVersion = currentDesktopVersion();
    const releaseComparison = compareDesktopVersions(version, currentVersion);
    const minimumComparison = compareDesktopVersions(currentVersion, release.minimum_version);
    if (releaseComparison === null || minimumComparison === null) throw new Error("更新清单的版本边界无效。");
    const serverOffersUpdate = source.update_available === true && releaseComparison > 0;
    const restartCompatible = Boolean(
      restart &&
      release.compatibility === updateCompatibility &&
      minimumComparison >= 0
    );
    let updateType = "none";
    if (serverOffersUpdate) {
      // The signed compatibility boundary is authoritative. If a stale or
      // misconfigured server selects a restart archive for another Electron
      // shell, fall back to the signed full installer instead of risking a
      // non-booting application.
      updateType = declaredUpdateType === "installer"
        ? "installer"
        : restartCompatible
          ? "restart"
          : "installer";
    }
    const selectedArtifact = updateType === "restart" ? restart : updateType === "installer" ? installer : null;
    return {
      currentVersion,
      latestVersion: version,
      updateAvailable: updateType !== "none",
      updateType,
      requiresCaptcha: updateType === "installer",
      channel: release.channel,
      publishedAt: release.published_at,
      minimumVersion: release.minimum_version,
      compatibility: release.compatibility,
      notes: release.notes,
      signature: signatureText,
      restart,
      installer,
      artifact: selectedArtifact,
      raw: release
    };
  }

  function discardPendingDesktopUpdate(filePath = "") {
    const resolved = filePath ? path.resolve(String(filePath)) : "";
    try {
      if (resolved && resolved !== path.resolve(pendingUpdatePath) && isPathInside(resolved, updatesDir)) {
        rawRmSync(resolved, { force: true });
      }
    } catch (error) {
      log(`pending desktop update artifact cleanup failed ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      rmSync(pendingUpdatePath, { force: true });
    } catch (error) {
      log(`pending desktop update metadata cleanup failed ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function pruneDesktopUpdateDirectories(keepVersions = []) {
    if (!existsSync(updatesDir)) return;
    const keep = new Set(keepVersions.filter((value) => parseDesktopVersion(value)).map(String));
    for (const entry of readdirSync(updatesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !parseDesktopVersion(entry.name) || keep.has(entry.name)) continue;
      const target = path.resolve(updatesDir, entry.name);
      if (!isPathInside(target, updatesDir)) continue;
      try {
        rawRmSync(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 120 });
      } catch (error) {
        log(`desktop update directory cleanup failed ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  function pendingDesktopUpdate() {
    const pending = readJson(pendingUpdatePath, null);
    if (!pending || typeof pending !== "object") return null;
    const filePath = path.resolve(String(pending.path || ""));
    // Electron's patched fs presents *.asar paths as virtual directories. Update
    // artifacts are raw archives on disk, so their metadata must come from
    // original-fs or a valid archive is incorrectly rejected as size 0.
    if (!filePath || !isPathInside(filePath, updatesDir) || !rawExistsSync(filePath)) {
      discardPendingDesktopUpdate(filePath);
      return null;
    }
    const kind = pending.kind === "restart" || pending.kind === "installer" ? pending.kind : "";
    const version = String(pending.version || "").trim();
    const sha256 = String(pending.sha256 || "").toLowerCase();
    const size = Math.max(0, Math.floor(Number(pending.size) || 0));
    const versionComparison = compareDesktopVersions(version, currentDesktopVersion());
    if (!kind || versionComparison === null || !/^[a-f0-9]{64}$/.test(sha256) || size <= 0) {
      discardPendingDesktopUpdate(filePath);
      return null;
    }
    if (versionComparison <= 0) {
      discardPendingDesktopUpdate(filePath);
      return null;
    }
    const info = rawStatSync(filePath);
    if (!info.isFile() || info.size !== size) {
      discardPendingDesktopUpdate(filePath);
      return null;
    }
    return {
      kind,
      version,
      filename: path.basename(filePath),
      path: filePath,
      sha256,
      size,
      downloadedAt: String(pending.downloadedAt || "")
    };
  }

  function publicPendingDesktopUpdate() {
    const pending = pendingDesktopUpdate();
    if (!pending) return null;
    return {
      kind: pending.kind,
      version: pending.version,
      filename: pending.filename,
      sha256: pending.sha256,
      size: pending.size,
      downloadedAt: pending.downloadedAt
    };
  }

  const desktopUpdateProgressStages = new Set([
    "checking",
    "checked",
    "downloading",
    "retrying",
    "verifying",
    "ready",
    "applying",
    "error"
  ]);

  function normalizeDesktopUpdateProgress(value) {
    const source = value && typeof value === "object" ? value : {};
    const stage = String(source.stage || "");
    if (!desktopUpdateProgressStages.has(stage)) return null;
    const kind = source.kind === "restart" || source.kind === "installer" ? source.kind : undefined;
    const progress = {
      stage,
      message: String(source.message || "").slice(0, 240),
      version: parseDesktopVersion(source.version) ? String(source.version) : undefined,
      kind,
      received: Math.max(0, Math.floor(Number(source.received) || 0)),
      total: Math.max(0, Math.floor(Number(source.total) || 0)),
      percent: Math.max(0, Math.min(100, Number(source.percent) || 0)),
      attempt: Math.max(0, Math.floor(Number(source.attempt) || 0)),
      createdAt: Number.isFinite(Date.parse(String(source.createdAt || ""))) ? String(source.createdAt) : new Date().toISOString()
    };
    return Object.fromEntries(Object.entries(progress).filter(([, item]) => item !== undefined));
  }

  function loadDesktopUpdateState() {
    if (desktopUpdateStateLoaded) return;
    desktopUpdateStateLoaded = true;
    try {
      if (!existsSync(updateStatePath)) return;
      const parsed = JSON.parse(readFileSync(updateStatePath, "utf8"));
      latestDesktopUpdateProgress = normalizeDesktopUpdateProgress(parsed?.progress);
      const rollback = parsed?.rollback && typeof parsed.rollback === "object" ? parsed.rollback : null;
      if (rollback?.active === true) {
        persistedDesktopUpdateRollback = {
          active: true,
          version: parseDesktopVersion(rollback.version) ? String(rollback.version) : latestDesktopUpdateProgress?.version,
          kind: rollback.kind === "restart" || rollback.kind === "installer" ? rollback.kind : "restart",
          reason: String(rollback.reason || "新版本启动失败，已自动恢复到可用版本。").slice(0, 240),
          detectedAt: Number.isFinite(Date.parse(String(rollback.detectedAt || ""))) ? String(rollback.detectedAt) : new Date().toISOString()
        };
      }
    } catch (error) {
      log(`desktop update state load failed ${error instanceof Error ? error.message : String(error)}`);
      rmSync(updateStatePath, { force: true });
    }
  }

  function persistDesktopUpdateState() {
    writeJson(updateStatePath, {
      progress: latestDesktopUpdateProgress,
      rollback: persistedDesktopUpdateRollback
    });
  }

  function storedDesktopUpdateProgress() {
    loadDesktopUpdateState();
    return latestDesktopUpdateProgress;
  }

  function desktopUpdateRollbackRecovery(pending = null) {
    loadDesktopUpdateState();
    if (updateRollbackDetected && !persistedDesktopUpdateRollback?.active) {
      const progress = latestDesktopUpdateProgress;
      persistedDesktopUpdateRollback = {
        active: true,
        version: progress?.version || pending?.version,
        kind: progress?.kind || pending?.kind || "restart",
        reason: "新版本启动失败，已自动恢复到可用版本。",
        detectedAt: new Date().toISOString()
      };
      latestDesktopUpdateProgress = normalizeDesktopUpdateProgress({
        stage: "error",
        message: "新版本启动失败，已自动恢复到可用版本。请改用完整安装包完成升级。",
        version: persistedDesktopUpdateRollback.version,
        kind: persistedDesktopUpdateRollback.kind,
        createdAt: persistedDesktopUpdateRollback.detectedAt
      });
      try {
        persistDesktopUpdateState();
      } catch (error) {
        log(`desktop update rollback state save failed ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (persistedDesktopUpdateRollback?.active && persistedDesktopUpdateRollback.version && !updateRollbackDetected) {
      const recoveredVersionComparison = compareDesktopVersions(currentDesktopVersion(), persistedDesktopUpdateRollback.version);
      if (recoveredVersionComparison !== null && recoveredVersionComparison >= 0) {
        const recoveredVersion = persistedDesktopUpdateRollback.version;
        persistedDesktopUpdateRollback = null;
        latestDesktopUpdateProgress = normalizeDesktopUpdateProgress({
          stage: "checked",
          message: `已通过完整安装更新到 naimage ${currentDesktopVersion()}。`,
          version: recoveredVersion,
          kind: "installer",
          percent: 100,
          createdAt: new Date().toISOString()
        });
        try {
          persistDesktopUpdateState();
        } catch (error) {
          log(`desktop update recovery completion save failed ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return persistedDesktopUpdateRollback?.active ? { ...persistedDesktopUpdateRollback } : null;
  }

  function effectiveDesktopUpdateProgress(pending) {
    const progress = storedDesktopUpdateProgress();
    const rollback = desktopUpdateRollbackRecovery(pending);
    if (rollback) {
      if (pending?.kind === "installer") {
        return normalizeDesktopUpdateProgress({
          stage: "ready",
          message: "完整安装包已下载并校验，可直接启动安装程序完成恢复。",
          version: pending.version,
          kind: pending.kind,
          total: pending.size,
          received: pending.size,
          percent: 100,
          createdAt: pending.downloadedAt
        });
      }
      return normalizeDesktopUpdateProgress({
        stage: "error",
        message: "新版本启动失败，已自动恢复到可用版本。请改用完整安装包完成升级。",
        version: rollback.version || progress?.version,
        kind: rollback.kind || progress?.kind,
        createdAt: rollback.detectedAt
      });
    }
    const pendingReadyProgress = pending ? normalizeDesktopUpdateProgress({
      stage: "ready",
      message: pending.kind === "restart" ? "更新已下载，可直接重启并更新。" : "安装包已下载，可直接启动安装程序。",
      version: pending.version,
      kind: pending.kind,
      total: pending.size,
      received: pending.size,
      percent: 100,
      createdAt: pending.downloadedAt
    }) : null;
    if (!progress) return pendingReadyProgress;
    if (
      pending &&
      (
        progress.version !== pending.version ||
        progress.kind !== pending.kind ||
        ["checked", "error", "ready"].includes(progress.stage)
      )
    ) {
      // A size-checked future-version pending artifact is the durable source of
      // truth. Never let an older completed/error snapshot hide its install
      // action after reopening Settings or restarting the application.
      return pendingReadyProgress;
    }
    const comparison = progress.version ? compareDesktopVersions(currentDesktopVersion(), progress.version) : null;
    if (["checking", "downloading", "retrying", "verifying", "applying"].includes(progress.stage)) {
      if (comparison !== null && comparison >= 0) {
        return normalizeDesktopUpdateProgress({
          ...progress,
          stage: "checked",
          message: `已更新到 naimage ${currentDesktopVersion()}。`,
          percent: 100
        });
      }
      return normalizeDesktopUpdateProgress({
        ...progress,
        stage: "error",
        message: pending ? "上次更新在完成前中断，已保留下载进度，可以继续。" : "上次更新未完成，请重新检查更新。"
      });
    }
    if (progress.stage === "ready" && !pending) {
      return comparison !== null && comparison >= 0
        ? normalizeDesktopUpdateProgress({ ...progress, stage: "checked", message: `已更新到 naimage ${currentDesktopVersion()}。`, percent: 100 })
        : normalizeDesktopUpdateProgress({ ...progress, stage: "error", message: "已下载的更新文件不可用，请重新下载。" });
    }
    return progress;
  }

  function desktopUpdaterStatus() {
    const rawPending = publicPendingDesktopUpdate();
    const recovery = desktopUpdateRollbackRecovery(rawPending);
    const failedPending = recovery && rawPending?.kind === "restart" && (!recovery.version || recovery.version === rawPending.version)
      ? rawPending
      : null;
    const pending = failedPending ? null : rawPending;
    const latestMatchesPending = Boolean(
      pending && latestDesktopUpdate &&
      pending.version === latestDesktopUpdate.latestVersion &&
      pending.kind === latestDesktopUpdate.updateType
    );
    const latestSupportsRecovery = Boolean(
      latestDesktopUpdate &&
      (!recovery || (latestDesktopUpdate.updateAvailable && latestDesktopUpdate.updateType === "installer" && latestDesktopUpdate.installer))
    );
    const remembered = latestSupportsRecovery && (!pending || latestMatchesPending)
      ? {
          latestVersion: latestDesktopUpdate.latestVersion,
          updateAvailable: latestDesktopUpdate.updateAvailable,
          updateType: latestDesktopUpdate.updateType,
          requiresCaptcha: latestDesktopUpdate.requiresCaptcha,
          channel: latestDesktopUpdate.channel,
          publishedAt: latestDesktopUpdate.publishedAt,
          minimumVersion: latestDesktopUpdate.minimumVersion,
          notes: latestDesktopUpdate.notes,
          artifact: latestDesktopUpdate.artifact,
          restart: latestDesktopUpdate.restart,
          installer: latestDesktopUpdate.installer
        }
      : recovery
        ? {
            latestVersion: recovery.version || rawPending?.version,
            updateAvailable: true,
            updateType: "installer",
            requiresCaptcha: true,
            channel: "stable",
            artifact: null
          }
      : pending
        ? {
            latestVersion: pending.version,
            updateAvailable: true,
            updateType: pending.kind,
            requiresCaptcha: false,
            channel: "stable",
            artifact: pending
          }
        : {};
    return {
      ok: true,
      ...remembered,
      currentVersion: currentDesktopVersion(),
      compatibility: updateCompatibility,
      packaged: app.isPackaged,
      rollbackDetected: Boolean(recovery),
      recovery,
      pending,
      failedPending,
      canApplyPending: Boolean(pending),
      busy: Boolean(updateCheckPromise || updateDownloadOperation || updateApplyOperation),
      progress: effectiveDesktopUpdateProgress(pending)
    };
  }

  function desktopUpdaterFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...desktopUpdaterStatus(), ok: false, error: message };
  }

  function publishDesktopUpdateProgress(payload) {
    const message = normalizeDesktopUpdateProgress({ ...payload, createdAt: new Date().toISOString() });
    if (!message) return;
    loadDesktopUpdateState();
    latestDesktopUpdateProgress = message;
    const now = Date.now();
    const persistNow = message.stage !== lastDesktopUpdateStateStage || now - lastDesktopUpdateStateWriteAt >= 1_500;
    if (persistNow) {
      try {
        persistDesktopUpdateState();
        lastDesktopUpdateStateWriteAt = now;
        lastDesktopUpdateStateStage = message.stage;
      } catch (error) {
        log(`desktop update state save failed ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send("naimage:update:progress", message);
      }
    }
  }

  function reconcilePendingDesktopUpdate(release) {
    const pending = pendingDesktopUpdate();
    if (!pending || !release) return pending;
    const recovery = desktopUpdateRollbackRecovery(pending);
    if (recovery && pending.kind === "restart" && (!recovery.version || recovery.version === pending.version)) {
      return pending;
    }
    const comparison = compareDesktopVersions(pending.version, release.latestVersion);
    if (comparison === null) {
      discardPendingDesktopUpdate(pending.path);
      return null;
    }
    if (comparison < 0) {
      discardPendingDesktopUpdate(pending.path);
      return null;
    }
    if (comparison > 0) return pending;
    const signedArtifact = pending.kind === "restart" ? release.restart : release.installer;
    const pendingIdentity = { ...pending, filename: pending.filename };
    if (pending.kind !== release.updateType || !desktopUpdateArtifactsMatch(pendingIdentity, signedArtifact)) {
      discardPendingDesktopUpdate(pending.path);
      return null;
    }
    return pending;
  }

  async function performDesktopUpdateCheck() {
    if (aidebugMode && !aidebugLiveImage) {
      const currentVersion = currentDesktopVersion();
      latestDesktopUpdate = {
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        updateType: "none",
        requiresCaptcha: false,
        channel: "stable",
        publishedAt: "",
        minimumVersion: currentVersion,
        compatibility: updateCompatibility,
        notes: [],
        restart: null,
        installer: null,
        artifact: null
      };
      return desktopUpdaterStatus();
    }
    const settings = migrateSettings(readJson(settingsPath, defaultSettings));
    requireNewApiSession(settings);
    publishDesktopUpdateProgress({ stage: "checking", message: "正在安全检查新版本…" });
    const request = desktopUpdatePlatformPayload();
    const query = new URLSearchParams(request).toString();
    const response = await newApiRequest(settings, `/api/desktop-update/check?${query}`, {
      service: "update",
      headers: desktopUpdateRequestHeaders(settings)
    });
    let verified = verifyDesktopReleasePayload(response?.data || response);
    const recovery = desktopUpdateRollbackRecovery(publicPendingDesktopUpdate());
    if (recovery && verified.updateAvailable && verified.installer) {
      verified = {
        ...verified,
        updateType: "installer",
        requiresCaptcha: true,
        artifact: verified.installer
      };
    }
    latestDesktopUpdate = verified;
    reconcilePendingDesktopUpdate(verified);
    const retainedPending = publicPendingDesktopUpdate();
    const retainedRecovery = desktopUpdateRollbackRecovery(retainedPending);
    pruneDesktopUpdateDirectories([verified.latestVersion, retainedPending?.version, retainedRecovery?.version]);
    publishDesktopUpdateProgress({
      stage: "checked",
      message: recovery && verified.updateAvailable
        ? `已切换为 naimage ${verified.latestVersion} 完整安装恢复。`
        : verified.updateAvailable
          ? `发现 naimage ${verified.latestVersion}`
          : "当前已是最新版本。",
      version: verified.latestVersion,
      kind: verified.updateType === "restart" || verified.updateType === "installer" ? verified.updateType : undefined
    });
    return desktopUpdaterStatus();
  }

  async function checkDesktopUpdate() {
    if (updateCheckPromise) return updateCheckPromise;
    const task = performDesktopUpdateCheck();
    const wrapped = task.finally(() => {
      if (updateCheckPromise === wrapped) updateCheckPromise = null;
    });
    updateCheckPromise = wrapped;
    return wrapped;
  }

  async function sha256File(filePath) {
    const hash = createHash("sha256");
    for await (const chunk of createRawReadStream(filePath)) hash.update(chunk);
    return hash.digest("hex");
  }

  function ensureAuthorizedDownloadUrl(settings, value) {
    const base = new URL(resolveNewApiBaseUrl(settings, "update"));
    const target = new URL(String(value || ""), base);
    const trustedDownloadPath = target.pathname.startsWith(DESKTOP_UPDATE_DOWNLOAD_PREFIX)
      || target.pathname.startsWith(LEGACY_DESKTOP_UPDATE_DOWNLOAD_PREFIX);
    if (target.origin !== base.origin || !trustedDownloadPath) {
      throw new Error("服务器返回了不可信的更新下载地址。");
    }
    return target.toString();
  }

  function ensureDesktopUpdateDiskSpace(directory, requiredBytes, operation) {
    const info = statfsSync(directory);
    const available = Number(info.bavail) * Number(info.bsize);
    const required = Math.max(0, Math.floor(Number(requiredBytes) || 0));
    if (!Number.isFinite(available) || available < required) {
      const requiredMb = Math.max(1, Math.ceil(required / 1024 / 1024));
      const availableMb = Number.isFinite(available) ? Math.max(0, Math.floor(available / 1024 / 1024)) : 0;
      throw new Error(`${operation}需要至少 ${requiredMb} MB 可用空间，当前约 ${availableMb} MB。`);
    }
    return available;
  }

  function rememberDownloadedDesktopArtifact(artifact, destination) {
    const previousPending = pendingDesktopUpdate();
    if (artifact.kind === "installer" && previousPending?.kind === "restart" && desktopUpdateRollbackRecovery(previousPending)) {
      discardPendingDesktopUpdate(previousPending.path);
    }
    const pending = {
      kind: artifact.kind,
      version: artifact.version,
      path: destination,
      sha256: artifact.sha256,
      size: artifact.size,
      downloadedAt: new Date().toISOString()
    };
    writeJson(pendingUpdatePath, pending);
    pruneDesktopUpdateDirectories([artifact.version, desktopUpdateRollbackRecovery(pending)?.version]);
    publishDesktopUpdateProgress({
      stage: "ready",
      message: artifact.kind === "restart" ? "更新已就绪，重启后生效。" : "安装包已下载并通过校验。",
      version: artifact.version,
      kind: artifact.kind,
      received: artifact.size,
      total: artifact.size,
      percent: 100
    });
    return {
      ok: true,
      pending: {
        kind: pending.kind,
        version: pending.version,
        filename: path.basename(pending.path),
        sha256: pending.sha256,
        size: pending.size,
        downloadedAt: pending.downloadedAt
      }
    };
  }

  async function downloadDesktopArtifact(settings, downloadUrl, artifact, options = {}) {
    const destinationDir = path.resolve(updatesDir, artifact.version || "unknown");
    if (!isPathInside(destinationDir, updatesDir)) throw new Error("更新包目标目录越界，已停止下载。");
    mkdirSync(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, artifact.filename);
    const staging = `${destination}.part`;
    const targetUrl = ensureAuthorizedDownloadUrl(settings, downloadUrl);
    let lastError = null;

    if (rawExistsSync(destination)) {
      const existingInfo = rawStatSync(destination);
      if (existingInfo.isFile() && existingInfo.size === artifact.size) {
        publishDesktopUpdateProgress({ stage: "verifying", message: "正在复用已下载的更新包…", version: artifact.version, kind: artifact.kind });
        if (await sha256File(destination) === artifact.sha256) {
          rmSync(staging, { force: true });
          return rememberDownloadedDesktopArtifact(artifact, destination);
        }
      }
      rawRmSync(destination, { force: true });
    }
    const resumableBytes = existsSync(staging) ? Math.min(statSync(staging).size, artifact.size) : 0;
    ensureDesktopUpdateDiskSpace(destinationDir, Math.max(0, artifact.size - resumableBytes) + 64 * 1024 * 1024, "下载更新");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (existsSync(staging) && statSync(staging).size > artifact.size) rmSync(staging, { force: true });
      let existing = existsSync(staging) ? statSync(staging).size : 0;
      if (existing >= artifact.size) break;
      const controller = new AbortController();
      const totalTimer = setTimeout(() => controller.abort(new Error("更新包下载超过 30 分钟，已中断。")), 30 * 60_000);
      try {
        const headers = desktopUpdateRequestHeaders(settings);
        if (attempt > 0 || existing > 0) headers.Range = `bytes=${existing}-`;
        const response = await newApiTransportFetch(targetUrl, {
          method: "GET",
          headers,
          signal: controller.signal,
          connectTimeoutMs: 30_000,
          headersTimeoutMs: 60_000,
          idleTimeoutMs: 60_000
        });
        if (!response.ok || !response.body) {
          const text = await response.text();
          const data = parseJsonText(text);
          const error = new Error(newApiErrorMessage(data, response.status));
          error.status = response.status;
          if (response.status === 416 && existing > 0) rmSync(staging, { force: true });
          throw error;
        }
        if (![200, 206].includes(response.status)) {
          response.body.destroy();
          throw new Error(`更新服务器返回了不支持的下载状态 ${response.status}。`);
        }
        if (response.status === 200 && existing > 0) {
          rmSync(staging, { force: true });
          existing = 0;
        } else if (response.status === 206) {
          const contentRange = String(response.headers.get("content-range") || "");
          const range = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
          const rangeStart = Number(range?.[1]);
          const rangeEnd = Number(range?.[2]);
          const rangeTotal = Number(range?.[3]);
          if (!range || rangeStart !== existing || rangeEnd < rangeStart || rangeTotal !== artifact.size) {
            response.body.destroy();
            rmSync(staging, { force: true });
            throw new Error("更新服务器返回了不匹配的续传区间，正在从头重试。");
          }
        }
        let received = existing;
        let lastProgressAt = 0;
        const counter = new Transform({
          transform(chunk, _encoding, callback) {
            received += chunk.length;
            if (received > artifact.size) {
              callback(new Error("更新包响应超过清单声明大小。"));
              return;
            }
            const now = Date.now();
            if (now - lastProgressAt >= 120 || received >= artifact.size) {
              lastProgressAt = now;
              publishDesktopUpdateProgress({
                stage: "downloading",
                message: `正在下载 ${artifact.version}…`,
                version: artifact.version,
                kind: artifact.kind,
                received,
                total: artifact.size,
                percent: Math.min(100, Math.round((received / artifact.size) * 1000) / 10)
              });
            }
            callback(null, chunk);
          }
        });
        await pipeline(response.body, counter, createWriteStream(staging, { flags: existing > 0 && response.status === 206 ? "a" : "w" }));
        if (statSync(staging).size !== artifact.size) throw new Error("更新包下载不完整，正在续传。");
        break;
      } catch (error) {
        lastError = error;
        const status = Number(error?.status || 0);
        if (status === 401 || status === 403 || status === 404 || attempt === 2) throw error;
        publishDesktopUpdateProgress({ stage: "retrying", message: `下载中断，正在重试 ${attempt + 1}/2…`, attempt: attempt + 1 });
        await delay(700 * (attempt + 1));
      } finally {
        clearTimeout(totalTimer);
      }
    }

    if (!existsSync(staging) || statSync(staging).size !== artifact.size) {
      throw lastError || new Error("更新包下载不完整。");
    }
    publishDesktopUpdateProgress({ stage: "verifying", message: "正在校验更新包签名与完整性…", version: artifact.version });
    const actualHash = await sha256File(staging);
    if (actualHash !== artifact.sha256) {
      rmSync(staging, { force: true });
      if (!options.integrityRetried) {
        publishDesktopUpdateProgress({
          stage: "retrying",
          message: "下载内容校验不一致，正在从头重新下载一次…",
          version: artifact.version,
          kind: artifact.kind,
          attempt: 1
        });
        return downloadDesktopArtifact(settings, downloadUrl, artifact, { ...options, integrityRetried: true });
      }
      throw new Error("更新包 SHA-256 校验失败，文件已删除。");
    }
    rawRmSync(destination, { force: true });
    rawRenameSync(staging, destination);
    return rememberDownloadedDesktopArtifact(artifact, destination);
  }

  async function serializeUpdateDownload(kind, task) {
    if (updateDownloadOperation) {
      if (updateDownloadOperation.kind === kind) return updateDownloadOperation.promise;
      throw new Error("另一种更新包正在下载，请等待当前下载完成。");
    }
    const promise = Promise.resolve().then(task).finally(() => {
      if (updateDownloadOperation?.promise === promise) updateDownloadOperation = null;
    });
    updateDownloadOperation = { kind, promise };
    return promise;
  }

  async function downloadDesktopRestartUpdate() {
    return serializeUpdateDownload("restart", async () => {
      const settings = migrateSettings(readJson(settingsPath, defaultSettings));
      requireNewApiSession(settings);
      const update = latestDesktopUpdate?.updateAvailable ? latestDesktopUpdate : (await checkDesktopUpdate());
      const resolved = update?.updateType ? update : latestDesktopUpdate;
      if (!resolved || resolved.updateType !== "restart" || !resolved.restart) throw new Error("当前没有可用的重启更新。");
      const response = await newApiRequest(settings, "/api/desktop-update/authorize", {
        service: "update",
        method: "POST",
        headers: desktopUpdateRequestHeaders(settings),
        body: desktopUpdatePlatformPayload()
      });
      const data = response?.data || response;
      const verified = verifyDesktopReleasePayload(data?.release || {});
      if (verified.updateType !== "restart" || !desktopUpdateArtifactsMatch(verified.restart, resolved.restart)) {
        throw new Error("更新授权与已检查版本不一致，请重新检查更新。");
      }
      return downloadDesktopArtifact(settings, data.download_url, verified.restart);
    });
  }

  async function createDesktopInstallerCaptcha() {
    if (installerCaptchaInflight) return installerCaptchaInflight;
    const task = (async () => {
      const settings = migrateSettings(readJson(settingsPath, defaultSettings));
      requireNewApiSession(settings);
      if (!latestDesktopUpdate?.updateAvailable) await checkDesktopUpdate();
      if (!latestDesktopUpdate || latestDesktopUpdate.updateType !== "installer") throw new Error("当前版本不需要下载安装包。");
      const response = await newApiRequest(settings, "/api/desktop-download/captcha", {
        service: "update",
        method: "POST",
        headers: desktopUpdateRequestHeaders(settings)
      });
      const data = response?.data || response;
      const installer = normalizeDesktopUpdateArtifact(data.installer, "installer", latestDesktopUpdate.latestVersion);
      if (!desktopUpdateArtifactsMatch(installer, latestDesktopUpdate.installer)) {
        throw new Error("验证码对应的安装包已经变化，请重新检查更新。");
      }
      const challengeId = String(data.challenge_id || "").trim();
      const imageDataUrl = String(data.image_data_url || "").trim();
      const expiresIn = Math.max(0, Math.floor(Number(data.expires_in) || 0));
      if (!challengeId || !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(imageDataUrl) || expiresIn <= 0) {
        throw new Error("服务器返回的升级验证码无效，请重试。");
      }
      return {
        ok: true,
        challengeId,
        imageDataUrl,
        expiresIn,
        expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
        installer
      };
    })();
    const wrapped = task.finally(() => {
      if (installerCaptchaInflight === wrapped) installerCaptchaInflight = null;
    });
    installerCaptchaInflight = wrapped;
    return wrapped;
  }

  async function downloadDesktopInstallerUpdate(payload = {}) {
    return serializeUpdateDownload("installer", async () => {
      const settings = migrateSettings(readJson(settingsPath, defaultSettings));
      requireNewApiSession(settings);
      const challengeId = String(payload.challengeId || "").trim();
      const code = String(payload.code || "").trim();
      if (!challengeId || !/^\d{6}$/.test(code)) throw new Error("请输入有效的 6 位升级验证码。");
      if (!latestDesktopUpdate?.updateAvailable) await checkDesktopUpdate();
      if (!latestDesktopUpdate || latestDesktopUpdate.updateType !== "installer" || !latestDesktopUpdate.installer) {
        throw new Error("当前版本不需要下载安装包。");
      }
      const response = await newApiRequest(settings, "/api/desktop-download/authorize", {
        service: "update",
        method: "POST",
        headers: desktopUpdateRequestHeaders(settings),
        body: {
          product: DESKTOP_UPDATE_PRODUCT,
          challenge_id: challengeId,
          code
        }
      });
      const data = response?.data || response;
      const installer = normalizeDesktopUpdateArtifact(data.installer, "installer", latestDesktopUpdate.latestVersion);
      if (!desktopUpdateArtifactsMatch(installer, latestDesktopUpdate.installer)) {
        throw new Error("下载授权与签名发布清单不一致，请重新检查更新。");
      }
      return downloadDesktopArtifact(settings, data.download_url, installer);
    });
  }

  async function verifyPendingDesktopUpdate(kind) {
    const pending = pendingDesktopUpdate();
    if (!pending || pending.kind !== kind) throw new Error(kind === "restart" ? "没有已下载的重启更新。" : "没有已下载的完整安装包。");
    publishDesktopUpdateProgress({ stage: "verifying", message: "正在进行安装前完整性复验…", version: pending.version, kind });
    const actualHash = await sha256File(pending.path);
    if (actualHash !== pending.sha256) {
      rawRmSync(pending.path, { force: true });
      rmSync(pendingUpdatePath, { force: true });
      throw new Error("待安装文件完整性校验失败，文件已删除。");
    }
    return pending;
  }

  async function serializeDesktopUpdateApplication(kind, task) {
    if (desktopUpdateHandoffAccepted) throw new Error("更新已经启动，请等待程序完成交接。");
    if (updateApplyOperation) {
      if (updateApplyOperation.kind === kind) return updateApplyOperation.promise;
      throw new Error("另一种更新正在启动，请等待当前操作完成。");
    }
    const promise = Promise.resolve().then(task).finally(() => {
      if (updateApplyOperation?.promise === promise) updateApplyOperation = null;
    });
    updateApplyOperation = { kind, promise };
    return promise;
  }

  function waitForDesktopUpdateChildSpawn(child, label, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener("spawn", onSpawn);
        child.removeListener("error", onError);
        if (error) reject(error);
        else {
          child.once("error", (lateError) => log(`${label}启动后异常：${lateError instanceof Error ? lateError.message : String(lateError)}`));
          resolve(child);
        }
      };
      const onSpawn = () => finish();
      const onError = (error) => finish(new Error(`${label}启动失败：${error instanceof Error ? error.message : String(error)}`));
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish(new Error(`${label}启动超时，程序已保持当前版本。`));
      }, timeoutMs);
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
  }

  async function applyDesktopRestartUpdate() {
    return serializeDesktopUpdateApplication("restart", async () => {
    if (!app.isPackaged) throw new Error("开发运行模式不会替换程序文件，请使用正式安装版验证更新。");
    if (process.platform !== "win32") throw new Error("当前平台暂不支持重启更新。");
    if (!existsSync(updateHelperPath) || !existsSync(updateLauncherPath)) throw new Error("更新助手缺失，请下载完整安装包升级。");
    if (desktopUpdateRollbackRecovery(publicPendingDesktopUpdate())) {
      throw new Error("该重启更新曾启动失败，已停止重复应用。请改用完整安装包升级。");
    }
    const pending = await verifyPendingDesktopUpdate("restart");
    const target = path.join(process.resourcesPath, "app.asar");
    if (!existsSync(target)) throw new Error("无法定位当前程序资源，请下载完整安装包升级。");
    ensureDesktopUpdateDiskSpace(process.resourcesPath, pending.size + 64 * 1024 * 1024, "应用重启更新");
    const token = randomBytes(24).toString("hex");
    const healthFile = path.join(updateHealthDir, `${token}.ok`);
    const readyFile = path.join(updateHealthDir, `${token}.ready`);
    const helperPidFile = path.join(updateHealthDir, `${token}.pid`);
    const logFile = path.join(updatesDir, "update-helper.log");
    const bootstrapLogFile = path.join(updatesDir, "update-helper-bootstrap.log");
    rmSync(readyFile, { force: true });
    rmSync(helperPidFile, { force: true });
    let helperFailure = null;
    mkdirSync(updatesDir, { recursive: true });
    const payloadBase64 = Buffer.from(JSON.stringify({
      HelperPath: updateHelperPath,
      ParentPid: process.pid,
      Source: pending.path,
      Target: target,
      ExpectedSha256: pending.sha256,
      AppExe: process.execPath,
      Token: token,
      HealthFile: healthFile,
      ReadyFile: readyFile,
      LogFile: logFile,
      HelperPidFile: helperPidFile,
      BootstrapLogFile: bootstrapLogFile
    }), "utf8").toString("base64");
    const bootstrapFd = openSync(bootstrapLogFile, "a");
    let launcher;
    try {
      launcher = spawn("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", updateLauncherPath,
        "-PayloadBase64", payloadBase64
      ], {
        detached: false,
        stdio: ["ignore", bootstrapFd, bootstrapFd],
        windowsHide: true
      });
    } finally {
      closeSync(bootstrapFd);
    }
    log(`restart update launcher spawned pid=${launcher.pid || 0} file=${updateLauncherPath}`);
    launcher.once("error", (error) => {
      helperFailure = error;
    });
    launcher.once("exit", (code) => {
      if (code !== 0) helperFailure = new Error(`更新启动器退出（${code ?? "unknown"}）。`);
    });
    for (let attempt = 0; attempt < 100 && !rawExistsSync(readyFile) && !helperFailure; attempt += 1) {
      await delay(100);
    }
    if (!rawExistsSync(readyFile)) {
      try { launcher.kill(); } catch {}
      try {
        const helperPid = Number(readFileSync(helperPidFile, "utf8").trim());
        if (Number.isInteger(helperPid) && helperPid > 0) process.kill(helperPid);
      } catch {}
      rmSync(helperPidFile, { force: true });
      throw helperFailure || new Error("更新助手启动超时，程序已保持当前版本。");
    }
    for (let attempt = 0; attempt < 20 && !rawExistsSync(helperPidFile); attempt += 1) await delay(25);
    let helperPid = 0;
    try {
      helperPid = Number(readFileSync(helperPidFile, "utf8").trim()) || 0;
    } catch {}
    rmSync(helperPidFile, { force: true });
    log(`restart update helper ready pid=${helperPid}`);
    launcher.unref();
    desktopUpdateHandoffAccepted = true;
    publishDesktopUpdateProgress({ stage: "applying", message: "naimage 即将重启并完成更新…", version: pending.version, kind: pending.kind });
    setTimeout(() => app.quit(), 180);
    return { ok: true, restarting: true, version: pending.version };
    });
  }

  async function launchDesktopInstallerUpdate() {
    return serializeDesktopUpdateApplication("installer", async () => {
      if (!app.isPackaged) throw new Error("开发运行模式不会启动发布安装器。");
      const pending = await verifyPendingDesktopUpdate("installer");
      publishDesktopUpdateProgress({ stage: "applying", message: "正在启动新版安装器…", version: pending.version, kind: pending.kind });
      let installer;
      try {
        installer = spawn(pending.path, [], { detached: true, stdio: "ignore", windowsHide: false });
        await waitForDesktopUpdateChildSpawn(installer, "新版安装器");
      } catch (error) {
        try { installer?.kill(); } catch {}
        throw error;
      }
      installer.unref();
      const shutdown = await shutdownApplicationServices();
      desktopUpdateHandoffAccepted = true;
      publishDesktopUpdateProgress({ stage: "applying", message: "新版安装器已启动，naimage 正在安全退出…", version: pending.version, kind: pending.kind });
      log(`desktop installer spawned pid=${installer.pid || 0} shutdownTimedOut=${shutdown?.timedOut === true}`);
      setTimeout(() => app.exit(0), 80);
      return { ok: true, launching: true, version: pending.version, installerPid: installer.pid || 0 };
    });
  }

  function markRestartUpdateHealthy() {
    if (restartUpdateHealthAcknowledged) return true;
    if (!/^[a-f0-9]{32,96}$/i.test(updateHealthToken)) return false;
    try {
      mkdirSync(updateHealthDir, { recursive: true });
      writeFileSync(path.join(updateHealthDir, `${updateHealthToken}.ok`), `${new Date().toISOString()}\n`, "utf8");
      restartUpdateHealthAcknowledged = true;
      log(`restart update healthy token=${updateHealthToken.slice(0, 8)}`);
      return true;
    } catch (error) {
      log(`restart update health marker failed ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  function ensureRuntimeDirectories() {
    mkdirSync(updatesDir, { recursive: true });
    mkdirSync(updateHealthDir, { recursive: true });
  }

  function recoverRollback() {
    return desktopUpdateRollbackRecovery(publicPendingDesktopUpdate());
  }

  return {
    applyDesktopRestartUpdate,
    checkDesktopUpdate,
    compareDesktopVersions,
    createDesktopInstallerCaptcha,
    currentDesktopVersion,
    desktopUpdaterFailure,
    desktopUpdaterStatus,
    downloadDesktopInstallerUpdate,
    downloadDesktopRestartUpdate,
    ensureRuntimeDirectories,
    launchDesktopInstallerUpdate,
    markRestartUpdateHealthy,
    normalizeDesktopUpdateArtifact,
    pendingDesktopUpdate,
    publishDesktopUpdateProgress,
    publicPendingDesktopUpdate,
    recoverRollback,
    verifyDesktopReleasePayload
  };
}

module.exports = {
  createDesktopUpdaterService
};
