"use strict";

const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync, statSync } = require("node:fs");
const path = require("node:path");
const { localBaseUrl } = require("../runtime/image-generation/comfyui-executor.cjs");
const { normalizeImageLocalProcessing } = require("../runtime/image-local-processing.mjs");

const clean = (value, max = 180) => String(value || "").replace(/[\u0000-\u001f]/g, "").slice(0, max);
const failure = (code, message) => Object.assign(new Error(message), { code, unsafeToRetry: true });
const keyFor = (operationId, requestIndex) => createHash("sha256").update(`${operationId}\0${requestIndex}`).digest("hex").slice(0, 32);
const clone = value => JSON.parse(JSON.stringify(value));

function comfySnapshot(snapshot = {}) {
  if (!/^[a-z0-9_-]{1,120}$/i.test(snapshot.submissionId || "") || !/^[a-z0-9_-]{1,180}$/i.test(snapshot.clientId || "") || !/^[a-f0-9]{64}$/.test(snapshot.workflowHash || "") || !/^[a-z0-9_-]{1,120}$/i.test(snapshot.outputNodeId || "")) throw failure("COMFYUI_SNAPSHOT_INVALID", "本地图片任务快照无效。");
  const actualParams = {};
  if (typeof snapshot.actualParams?.model !== "string" || !snapshot.actualParams.model || !Number.isSafeInteger(snapshot.actualParams?.seed) || snapshot.actualParams.seed < 0 || ![snapshot.actualParams.width, snapshot.actualParams.height].every(value => Number.isInteger(value) && value >= 64 && value <= 4096)) throw failure("COMFYUI_SNAPSHOT_INVALID", "本地图片任务参数未冻结。");
  actualParams.model = clean(snapshot.actualParams.model, 1024);
  for (const field of ["seed", "width", "height", "batchSize", "steps", "cfg", "denoise"]) if (Number.isFinite(snapshot.actualParams[field])) actualParams[field] = snapshot.actualParams[field];
  for (const field of ["sampler", "scheduler"]) if (typeof snapshot.actualParams[field] === "string") actualParams[field] = clean(snapshot.actualParams[field], 100);
  const inputMappings = (Array.isArray(snapshot.inputMappings) ? snapshot.inputMappings : []).map(mapping => {
    const value = { nodeId: clean(mapping.nodeId, 120), inputName: clean(mapping.inputName, 120), kind: clean(mapping.kind, 20) };
    if (Number.isInteger(mapping.index)) value.index = mapping.index;
    if (["string", "number", "boolean"].includes(typeof mapping.value)) value.value = typeof mapping.value === "string" ? mapping.value.slice(0, 16_384) : mapping.value;
    return value;
  }).slice(0, 64);
  const inputs = (Array.isArray(snapshot.inputs) ? snapshot.inputs : []).map(input => ({ sha256: /^[a-f0-9]{64}$/.test(input.sha256 || "") ? input.sha256 : "", bytes: Number(input.bytes) || 0, width: Number(input.width) || 0, height: Number(input.height) || 0, mimeType: clean(input.mimeType, 40), ...(input.uploaded ? { uploaded: { name: clean(input.uploaded.name, 1024), subfolder: clean(input.uploaded.subfolder, 1024), type: "input" } } : {}) })).slice(0, 4);
  return { schemaVersion: Number(snapshot.schemaVersion) >= 2 ? 2 : 1, submissionId: snapshot.submissionId,
    ...(snapshot.connectionId ? { connectionId: clean(snapshot.connectionId, 160), networkScope: clean(snapshot.networkScope, 10), ...(snapshot.connectionHash ? { connectionHash: clean(snapshot.connectionHash, 64) } : {}) } : { baseUrl: localBaseUrl(snapshot.baseUrl) }), clientId: snapshot.clientId,
    workflowHash: snapshot.workflowHash, outputNodeId: snapshot.outputNodeId, inputMappings, actualParams, inputs,
    ...(snapshot.promptId ? { promptId: clean(snapshot.promptId, 120) } : {}),
    ...(snapshot.inputNodeId ? { inputNodeId: clean(snapshot.inputNodeId, 120) } : {}),
    ...(snapshot.templateId ? { templateId: clean(snapshot.templateId, 120), templateVersion: Math.max(1, Number(snapshot.templateVersion) || 1), templateHash: /^[a-f0-9]{64}$/.test(snapshot.templateHash || "") ? snapshot.templateHash : "" } : {}),
    ...(typeof snapshot.policyVersion === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(snapshot.policyVersion) ? { policyVersion: snapshot.policyVersion } : {}),
    ...(typeof snapshot.capabilitiesHash === "string" && /^[a-f0-9]{64}$/.test(snapshot.capabilitiesHash) ? { capabilitiesHash: snapshot.capabilitiesHash } : {}),
    preparedAt: clean(snapshot.preparedAt, 50), ...(snapshot.acceptedAt ? { acceptedAt: clean(snapshot.acceptedAt, 50) } : {}), ...(snapshot.recovered === true ? { recovered: true } : {}) };
}

/** Main-only, project-owned delivery journal. Recovery never calls create. */
function createImageOperationJournal({ projectFor, metaDir = ".naimage", extractImages, download, materialize, resolveConnection, pollTask, cancelTask, processImage }) {
  const results = new Map(), inflight = new Map(), processingInputs = new Map();
  function paths(projectId) {
    const project = projectFor(projectId);
    if (!project?.path) throw failure("PROJECT_NOT_FOUND", "图片操作所属项目不存在。");
    const dir = path.join(project.path, metaDir, "image-operations");
    return { dir, file: path.join(dir, "journal.json") };
  }
  function read(projectId) {
    const { file } = paths(projectId);
    if (!existsSync(file)) return { schemaVersion: 1, revision: 0, operations: [] };
    const journal = JSON.parse(readFileSync(file, "utf8"));
    if (journal.schemaVersion !== 1 || !Array.isArray(journal.operations)) throw failure("IMAGE_JOURNAL_INVALID", "图片恢复记录无法读取；已停止派发。");
    return journal;
  }
  function write(projectId, journal) {
    const { dir, file } = paths(projectId); mkdirSync(dir, { recursive: true });
    journal.revision += 1; journal.updatedAt = new Date().toISOString();
    const temporary = `${file}.tmp`; writeFileSync(temporary, JSON.stringify(journal, null, 2)); renameSync(temporary, file);
  }
  function get(projectId, key) { return read(projectId).operations.find(item => item.key === key); }
  function find(projectId, operationId, requestIndex = 1) { return get(projectId, keyFor(clean(operationId), Math.max(1, Number(requestIndex) || 1))); }
  function patch(projectId, key, changes) {
    const journal = read(projectId), item = journal.operations.find(value => value.key === key);
    if (!item) throw failure("IMAGE_OPERATION_NOT_FOUND", "图片操作不存在。");
    Object.assign(item, changes, { updatedAt: new Date().toISOString() }); write(projectId, journal); return item;
  }
  function start(input) {
    const projectId = clean(input.projectId), operationId = clean(input.operationId || input.runId);
    if (!projectId || !operationId) return null;
    const requestIndex = Math.max(1, Number(input.requestIndex) || 1), key = keyFor(operationId, requestIndex);
    const journal = read(projectId);
    const existing = journal.operations.find(item => item.key === key);
    if (existing) {
      if (input.requestHash && existing.requestHash && input.requestHash !== existing.requestHash) throw failure("COMFYUI_SUBMISSION_CONFLICT", "相同本地操作标识已经提交其他内容。");
      throw failure("IMAGE_OPERATION_EXISTS", "该图片操作已派发，请恢复原操作；不会重新生图。");
    }
    if (journal.operations.length >= 500) {
      const completed = journal.operations.findIndex(item => item.provider !== "comfyui" && !item.agentTaskId && (item.state === "saved" || item.state === "rejected"));
      if (completed < 0) throw failure("IMAGE_JOURNAL_FULL", "图片恢复记录已满，请先处理未完成操作。");
      journal.operations.splice(completed, 1);
    }
    const now = new Date().toISOString();
    const parameters = {};
    for (const name of ["n", "ratio", "quality", "resolution", "size", "background", "outputFormat", "outputCompression", "moderation", "inputFidelity", "referenceCount", "mask"]) {
      const value = input.parameters?.[name];
      if (["string", "number", "boolean"].includes(typeof value)) parameters[name] = typeof value === "string" ? clean(value, 80) : value;
    }
    const item = { schemaVersion: 1, projectId, key, operationId, requestIndex, runId: clean(input.runId), agentTaskId: clean(input.agentTaskId), model: clean(input.model),
      protocol: clean(input.protocol, 50), transport: clean(input.transport, 30), connectionId: clean(input.connectionId),
      ...(input.provider === "comfyui" ? { provider: "comfyui", requestHash: /^[a-f0-9]{64}$/.test(input.requestHash || "") ? input.requestHash : "", projectRevision: Math.max(0, Number(input.projectRevision) || 0) } : {}),
      sourceNodeIds: (input.sourceNodeIds || []).map(id => clean(id)).slice(0, 240), parameters,
      sources: (input.sources || []).map(source => ({ nodeId: clean(source.canvasNodeId), assetId: clean(source.assetId), occurrenceId: clean(source.occurrenceId), slot: Math.max(0, Number(source.canvasAssetIndex) || 0), ...(source.contentHash ? { contentHash: /^[a-f0-9]{64}$/i.test(source.contentHash) ? source.contentHash.toLowerCase() : "" } : {}) })).slice(0, 32),
      targetNodeId: clean(input.targetNodeId),
      state: "submitted", stage: "generation", createdAt: now, updatedAt: now, taskId: "", assets: [], slots: [] };
    journal.operations.push(item); write(projectId, journal); return item;
  }
  function prepared(item, snapshot) {
    if (!item) throw failure("IMAGE_OPERATION_REQUIRED", "本地图片任务需要项目持久化记录。");
    const frozen = comfySnapshot(snapshot);
    const current = get(item.projectId, item.key);
    if (current.state === "canceled") throw failure("IMAGE_OPERATION_TERMINAL", "原图片操作已取消。");
    if (current.comfyui && current.comfyui.workflowHash !== frozen.workflowHash) throw failure("COMFYUI_SUBMISSION_CONFLICT", "本地图片操作已冻结其他内容。");
    return patch(item.projectId, item.key, { provider: "comfyui", comfyui: frozen, model: frozen.actualParams.model,
      parameters: { ...current.parameters, size: `${frozen.actualParams.width}x${frozen.actualParams.height}`, seed: frozen.actualParams.seed, width: frozen.actualParams.width, height: frozen.actualParams.height }, state: "submitted", stage: "generation" });
  }
  function accepted(item, event) {
    if (!item) return;
    const snapshot = event.comfyui || event.accepted;
    patch(item.projectId, item.key, { taskId: (/^[a-z0-9_.:-]{1,512}$/i.test(String(event.taskId)) ? String(event.taskId) : (() => { throw failure("IMAGE_TASK_ID_INVALID", "原任务标识无效，已停止等待。"); })()), state: "accepted", stage: "poll", ...(snapshot ? { provider: "comfyui", comfyui: comfySnapshot(snapshot), providerState: "queued" } : {}) });
  }
  function failed(item, error) {
    if (!item) return;
    const current = get(item.projectId, item.key);
    if (current.state === "canceled") return;
    const state = current.assets.length ? "partial" : current.slots.length || current.resultCount ? "delivery-failed" : ["COMFYUI_EXECUTION_FAILED", "COMFYUI_EXECUTION_INTERRUPTED"].includes(error?.code) ? "failed" : current.taskId ? "accepted"
      : error?.ambiguous || error?.unsafeToRetry ? "uncertain" : "rejected";
    patch(item.projectId, item.key, { state, ...(current.provider === "comfyui" && ["failed", "rejected"].includes(state) ? { providerState: state } : {}), errorCategory: /^[a-z0-9_-]+$/i.test(String(error?.errorCategory || error?.code || "")) ? String(error.errorCategory || error.code).slice(0, 100) : "image_operation_failed" });
  }
  function received(item, result, processing) {
    if (!item) return;
    if (get(item.projectId, item.key).state === "canceled") throw failure("IMAGE_OPERATION_TERMINAL", "原图片操作已取消，拒绝迟到结果。");
    const id = `${item.projectId}:${item.key}`;
    let descriptor;
    if (processing?.requireAlpha) descriptor = { kind: "alpha", requireAlpha: true };
    if (processing?.clientMask) {
      processingInputs.set(id, processing.inputs);
      const project = projectFor(item.projectId);
      const relative = processing.sourcePath ? path.relative(project.path, processing.sourcePath) : "";
      // Existing managed source bytes stay in their owner location. Only the
      // transient edit mask needs staging; no input base64 enters the journal.
      descriptor = { kind: "client-mask", source: relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : "", ...(processing.requireAlpha ? { requireAlpha: true } : {}) };
      const source = processing.inputs.editImages[0];
      descriptor.sourceHash = createHash("sha256").update(source.buffer || Buffer.from(source.base64, "base64")).digest("hex");
      const mask = processing.inputs.mask;
      writeFileSync(path.join(paths(item.projectId).dir, `${item.key}-mask.bin`), mask.buffer || Buffer.from(mask.base64, "base64"));
    }
    results.set(id, { result, processed: !(processing?.clientMask || processing?.requireAlpha) });
    patch(item.projectId, item.key, { state: "response", stage: "result", resultCount: extractImages(result).length, ...(item.provider === "comfyui" ? { providerState: "succeeded" } : {}), ...(descriptor ? { processing: descriptor } : {}) });
  }
  async function deliver(item, result, generationContext = {}, processed = true) {
    const current = get(item.projectId, item.key);
    for (const asset of current.assets) {
      if (!asset.path || !existsSync(asset.path)) throw failure("IMAGE_SAVED_ASSET_MISSING", "已保存成果文件缺失，请检查项目图片库；不会重新生图。");
      if (current.provider === "comfyui") {
        const relative = path.relative(realpathSync(projectFor(item.projectId).path), realpathSync(asset.path)), stat = statSync(asset.path);
        if (relative.startsWith("..") || path.isAbsolute(relative) || !stat.isFile() || stat.size > 96 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(asset.contentHash || "") || createHash("sha256").update(readFileSync(asset.path)).digest("hex") !== asset.contentHash) throw failure("IMAGE_SAVED_ASSET_CHANGED", "已保存成果内容或受管位置已改变；不会重新生图。");
      }
    }
    if (current.state === "saved") return current.assets;
    const images = result ? extractImages(result) : [];
    const count = Math.max(images.length, current.resultCount || 0, current.slots.length);
    const slots = [...current.slots], assets = [...current.assets];
    let firstError;
    for (let slot = 0; slot < count; slot++) {
      if (assets.some(asset => asset.recoverySlot === slot + 1)) continue;
      const cache = path.join(paths(item.projectId).dir, `${item.key}-${slot + 1}.bin`);
      try {
        let buffer, needsProcessing = !processed;
        if (existsSync(cache)) buffer = readFileSync(cache);
        else {
          const image = images[slot];
          if (!image) throw failure("IMAGE_RESULT_HANDLE_UNAVAILABLE", "原结果句柄已失效；可查询原任务，不会重新生图。");
          buffer = image.type === "url" ? await download(image.value) : Buffer.from(image.value.replace(/^data:image\/[^;]+;base64,/, ""), "base64");
          if (!buffer.length || buffer.length > 96 * 1024 * 1024) throw failure("IMAGE_OUTPUT_SIZE_INVALID", "原结果大小不合法。");
          writeFileSync(cache, buffer);
        }
        if (slots[slot]?.processed !== undefined) needsProcessing = !slots[slot].processed;
        slots[slot] = { index: slot + 1, state: "cached", processed: !needsProcessing };
        patch(item.projectId, item.key, { slots, stage: "local-save" });
        let outputBuffer = buffer, localProcessing = normalizeImageLocalProcessing(images[slot]?.localProcessing || slots[slot]?.localProcessing);
        if (needsProcessing && current.processing) {
          let inputs = processingInputs.get(`${item.projectId}:${item.key}`);
          if (!inputs && current.processing.kind === "client-mask") {
            const projectRoot = realpathSync(projectFor(item.projectId).path);
            const sourcePath = current.processing.source && path.resolve(projectRoot, current.processing.source);
            if (!sourcePath || !existsSync(sourcePath)) throw failure("IMAGE_PROCESSING_SOURCE_UNAVAILABLE", "原遮罩编辑来源不可用；已保留原结果，不会重新生图。");
            const relative = path.relative(projectRoot, realpathSync(sourcePath));
            if (relative.startsWith("..") || path.isAbsolute(relative)) throw failure("IMAGE_PROCESSING_SOURCE_UNAVAILABLE", "原遮罩编辑来源不在项目内；已停止处理原结果。");
            const source = readFileSync(sourcePath);
            if (createHash("sha256").update(source).digest("hex") !== current.processing.sourceHash) throw failure("IMAGE_PROCESSING_SOURCE_CHANGED", "原编辑来源已改变；已停止处理原结果。");
            inputs = { editImages: [{ buffer: source }], mask: { buffer: readFileSync(path.join(paths(item.projectId).dir, `${item.key}-mask.bin`)) } };
          }
          if (!processImage) throw failure("IMAGE_PROCESSING_UNAVAILABLE", "本地图片处理不可用。");
          const processedResult = await processImage(buffer, inputs || {}, current.processing);
          outputBuffer = Buffer.isBuffer(processedResult) ? processedResult : processedResult.buffer;
          if (!Buffer.isBuffer(outputBuffer) || !outputBuffer.length) throw failure("IMAGE_PROCESSING_FAILED", "本地图片处理未返回有效结果。");
          if (processedResult.localProcessing) localProcessing = normalizeImageLocalProcessing(processedResult.localProcessing);
        }
        if (localProcessing) { slots[slot].localProcessing = localProcessing; patch(item.projectId, item.key, { slots }); }
        const output = await materialize([{ ...images[slot], type: "base64", value: outputBuffer.toString("base64"), requestIndex: item.requestIndex, ...(localProcessing ? { localProcessing } : {}) }],
          `image-${item.key}-${slot + 1}`, item.runId, item.projectId, item.parameters.outputFormat || "png", generationContext);
        const asset = { ...output[0], assetId: `image-${item.key}-${slot + 1}`, occurrenceId: `occ-${item.key}${(slot + 1).toString(16).padStart(2, "0")}`,
          recoveryOperationId: item.operationId, recoveryRequestIndex: item.requestIndex, recoverySlot: slot + 1, ...(localProcessing ? { localProcessing } : {}) };
        assets.push(asset); slots[slot] = { index: slot + 1, state: "saved" };
        patch(item.projectId, item.key, { slots, assets });
        try { unlinkSync(cache); } catch { /* Asset is durable; cache cleanup is independent. */ }
      } catch (error) {
        firstError ||= error; slots[slot] = { ...slots[slot], index: slot + 1, state: existsSync(cache) ? "local-failed" : "download-failed" };
        patch(item.projectId, item.key, { slots, assets, errorCategory: /^[a-z0-9_-]+$/i.test(String(error?.code || "")) ? String(error.code).slice(0, 100) : "image_result_processing" });
      }
    }
    patch(item.projectId, item.key, { state: assets.length === count && count > 0 ? "saved" : assets.length ? "partial" : "delivery-failed", stage: "asset-delivery", assets, slots });
    if (assets.length === count && count > 0) {
      results.delete(`${item.projectId}:${item.key}`); processingInputs.delete(`${item.projectId}:${item.key}`);
      try { unlinkSync(path.join(paths(item.projectId).dir, `${item.key}-mask.bin`)); } catch { /* No processing remains. */ }
    } else if (count > 0 && Array.from({ length: count }, (_, index) => index + 1).every(slot => assets.some(asset => asset.recoverySlot === slot) || existsSync(path.join(paths(item.projectId).dir, `${item.key}-${slot}.bin`)))) {
      // Staged bytes own subsequent local retries; release provider payloads.
      results.delete(`${item.projectId}:${item.key}`); processingInputs.delete(`${item.projectId}:${item.key}`);
    }
    if (!assets.length) throw Object.assign(firstError || failure("IMAGE_RESULT_EMPTY", "原任务未返回图片。"), { unsafeToRetry: true, generationCompleted: true });
    return assets;
  }
  async function recover(projectId, key) {
    const id = `${projectId}:${key}`;
    if (inflight.has(id)) return inflight.get(id);
    const task = (async () => {
      let item = get(projectId, key);
      if (!item) throw failure("IMAGE_OPERATION_NOT_FOUND", "图片操作不存在。");
      if (["canceled", "failed"].includes(item.state) || (item.provider === "comfyui" && item.state === "rejected")) throw failure("IMAGE_OPERATION_TERMINAL", "原图片操作已取消、被拒绝或执行失败；不会重新提交。");
      if (["submitted", "uncertain"].includes(item.state) && !item.taskId && !item.comfyui) throw failure("IMAGE_OPERATION_UNCERTAIN", "创建结果不确定，无法安全重发。请到渠道核对原请求。");
      const retained = results.get(id);
      let result = retained?.result, processed = retained?.processed ?? !item.processing;
      const allCached = item.resultCount > 0 && Array.from({ length: item.resultCount }, (_, index) => index + 1).every(slot => item.assets.some(asset => asset.recoverySlot === slot) || existsSync(path.join(paths(projectId).dir, `${key}-${slot}.bin`)));
      if (!result && !allCached && item.state !== "saved") {
        if (!item.taskId && !item.comfyui) throw failure("IMAGE_RESULT_HANDLE_UNAVAILABLE", "重启后原同步结果句柄不可用，请到渠道核对；不会重新生图。");
        const connection = await resolveConnection(item);
        if (connection.connectionId !== item.connectionId || connection.protocol !== item.protocol || connection.transport !== item.transport) throw failure("IMAGE_CONNECTION_CHANGED", "原操作的连接或凭据已改变，请恢复原配置后查询。");
        result = await pollTask(item, connection);
        if (item.provider === "comfyui" && !result.ok) {
          const state = result.state === "failed" ? "failed" : result.state === "unknown" ? "uncertain" : "accepted";
          patch(projectId, key, { state, stage: "poll", providerState: result.state, ...(result.code ? { errorCategory: clean(result.code, 100) } : {}) });
          return { operation: get(projectId, key), assets: [], pending: result.pending === true, unknown: result.unknown === true, failed: result.state === "failed" };
        }
        // A task query returns the provider result, before any local mask.
        processed = !item.processing;
        patch(projectId, key, { state: "response", stage: "result", resultCount: extractImages(result).length, ...(item.provider === "comfyui" ? { providerState: "succeeded" } : {}) });
        results.set(id, { result, processed }); item = get(projectId, key);
      }
      const request = item.provider === "comfyui" ? { ...item.comfyui.actualParams, protocol: "comfyui", connectionId: item.comfyui.connectionId, networkScope: item.comfyui.networkScope || "local", outputFormat: "png",
        size: `${item.comfyui.actualParams.width}x${item.comfyui.actualParams.height}`, templateId: item.comfyui.templateId,
        templateVersion: item.comfyui.templateVersion, templateHash: item.comfyui.templateHash, workflowHash: item.comfyui.workflowHash,
        sourceHashes: item.comfyui.inputs.map(input => input.sha256) } : { model: item.model, ...item.parameters };
      const assets = await deliver(item, result, { request }, processed);
      return { operation: get(projectId, key), assets };
    })();
    inflight.set(id, task);
    try { return await task; } finally { inflight.delete(id); }
  }
  async function cancel(projectId, key, options = {}) {
    const item = get(projectId, key);
    if (options.connectionId && item?.connectionId !== options.connectionId && item?.comfyui?.connectionId !== options.connectionId) throw failure("IMAGE_CONNECTION_CHANGED", "取消请求与原任务连接不一致；未取消任务。");
    if (!item || item.provider !== "comfyui" || !item.comfyui || !item.taskId) throw failure("COMFYUI_CANCEL_NOT_QUEUED", "没有可核对的本地排队任务。");
    if (["saved", "response", "partial", "delivery-failed", "failed", "rejected", "canceled"].includes(item.state)) throw failure("COMFYUI_CANCEL_NOT_QUEUED", "该任务已经结束或进入成果保存，不能删除排队请求。");
    if (typeof cancelTask !== "function") throw failure("COMFYUI_CANCEL_UNSUPPORTED", "当前运行时没有定向排队取消能力。");
    const connection = await resolveConnection(item);
    if (connection.connectionId !== item.connectionId || connection.protocol !== item.protocol || connection.transport !== item.transport) throw failure("IMAGE_CONNECTION_CHANGED", "原操作连接已改变；未取消任务。");
    const result = await cancelTask(item, connection);
    if (result.canceled === true) patch(projectId, key, { state: "canceled", stage: "canceled", providerState: "canceled" });
    return result;
  }
  function list(projectId) {
    return read(projectId).operations.map(item => ({ key: item.key, operationId: item.operationId, requestIndex: item.requestIndex,
      model: item.model, createdAt: item.createdAt, updatedAt: item.updatedAt, taskIdPresent: Boolean(item.taskId), stage: item.stage,
      state: item.state === "submitted" ? "uncertain" : item.state, savedCount: item.assets.length, errorCategory: item.errorCategory, slots: item.slots,
      ...(item.provider === "comfyui" ? { provider: "comfyui", providerState: ["saved", "response", "partial", "delivery-failed"].includes(item.state) ? "succeeded" : item.providerState, canCancel: Boolean(item.taskId) && !["saved", "response", "partial", "delivery-failed", "failed", "rejected", "canceled"].includes(item.state) } : {}),
      canRecover: !["canceled", "failed"].includes(item.state) && !(item.provider === "comfyui" && item.state === "rejected") && (item.state === "saved" || Boolean(item.taskId || item.comfyui || item.slots.length || results.has(`${projectId}:${item.key}`))) }));
  }
  return { start, prepared, accepted, failed, received, deliver, recover, cancel, list, get, find };
}

module.exports = { createImageOperationJournal };
