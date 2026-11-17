"use strict";

const { randomUUID, createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const {
  parseRecipeRun,
  sealRecipeRun,
  validateRecipeRunAgainstRecipe,
} = require("../runtime/recipe-run-contract.cjs");
const { builtinRecipeCatalog, builtinToolManifest, BUILTIN_RECIPE_ID } = require("./recipe-store.cjs");

const RECIPE_RUNS_DIR = "recipe-runs";
const RECIPE_RUN_FILE = /^run\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
const LANGUAGES = Object.freeze(["zh-CN", "en-US", "ja-JP"]);
const RATIOS = Object.freeze(["1:1", "4:5", "16:9"]);
const RESOLUTIONS = Object.freeze(["1K", "2K"]);
const QUALITIES = Object.freeze(["auto", "high"]);
const DEFAULT_SCENE_BRIEF = "干净高级的跨境电商美妆商品图，柔和棚拍光，真实材质，保留包装文字、品牌标识和产品比例。";

function serviceError(code, message, cause) {
  return Object.assign(new Error(message), { code, cause });
}

function cleanText(value, maximum, fallback = "") {
  const text = typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maximum) : "";
  return text || fallback;
}

function normalizeHash(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  const hex = text.startsWith("sha256:") ? text.slice(7) : text;
  if (!/^[a-f0-9]{64}$/.test(hex)) throw serviceError("RECIPE_ASSET_HASH_INVALID", "输入图片缺少有效内容指纹；未执行 Recipe。");
  return { prefixed: `sha256:${hex}`, hex };
}

function publicId(value, code, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,179}$/.test(text)) {
    throw serviceError(code, `${label}身份无效；未执行 Recipe。`);
  }
  return text;
}

function normalizeInputIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw serviceError("RECIPE_INPUT_REQUIRED", "请选择一张受管商品图；未执行 Recipe。");
  }
  const assetId = publicId(value.assetId, "RECIPE_ASSET_ID_INVALID", "输入图片");
  const occurrenceId = publicId(value.occurrenceId, "RECIPE_OCCURRENCE_ID_INVALID", "输入图片");
  const contentHash = normalizeHash(value.contentHash).prefixed;
  return { slotId: "product", assetId, occurrenceId, contentHash };
}

function normalizeStudioOptions(options = {}) {
  const catalog = builtinRecipeCatalog();
  const defaults = Object.fromEntries(catalog.outputSlots.map((slot) => [slot.slotId, slot.defaultDirection]));
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw serviceError("RECIPE_OPTIONS_INVALID", "Studio 运行参数无效；未执行 Recipe。");
  }
  const sceneBrief = typeof options.sceneBrief === "string" ? options.sceneBrief.replace(/\u0000/g, "").trim() : "";
  if (!sceneBrief || sceneBrief.length > 1200) {
    throw serviceError("RECIPE_OPTIONS_INVALID", "场景文案必须为 1–1200 个字符；未执行 Recipe。");
  }
  const inputDirections = options.slotDirections;
  if (!inputDirections || typeof inputDirections !== "object" || Array.isArray(inputDirections)) {
    throw serviceError("RECIPE_OPTIONS_INVALID", "输出槽方向无效；未执行 Recipe。");
  }
  const slotDirections = Object.fromEntries(catalog.outputSlots.map((slot) => {
    const raw = inputDirections[slot.slotId];
    const direction = raw === undefined ? defaults[slot.slotId] : typeof raw === "string" ? raw.replace(/\u0000/g, "").trim() : "";
    if (!direction || direction.length > 320) {
      throw serviceError("RECIPE_OPTIONS_INVALID", `输出槽「${slot.label}」方向必须为 1–320 个字符；未执行 Recipe。`);
    }
    return [slot.slotId, direction];
  }));
  if (!LANGUAGES.includes(options.language)) throw serviceError("RECIPE_OPTIONS_INVALID", "市场语言无效；未执行 Recipe。");
  if (!RATIOS.includes(options.ratio)) throw serviceError("RECIPE_OPTIONS_INVALID", "画幅无效；未执行 Recipe。");
  if (!RESOLUTIONS.includes(options.resolution)) throw serviceError("RECIPE_OPTIONS_INVALID", "清晰度无效；未执行 Recipe。");
  if (!QUALITIES.includes(options.quality)) throw serviceError("RECIPE_OPTIONS_INVALID", "质量参数无效；未执行 Recipe。");
  return {
    sceneBrief,
    language: options.language,
    slotDirections,
    ratio: options.ratio,
    resolution: options.resolution,
    quality: options.quality,
  };
}

function languageLabel(language) {
  if (language === "en-US") return "English";
  if (language === "ja-JP") return "Japanese";
  return "Simplified Chinese";
}

function promptForSlot(slot, options) {
  const catalog = builtinRecipeCatalog();
  const target = catalog.outputSlots.find((item) => item.slotId === slot.slotId);
  if (!target) throw serviceError("RECIPE_OUTPUT_SLOT_INVALID", "Recipe 输出槽无效；未执行 Recipe。");
  return [
    `Create one high-end cross-border ecommerce ${slot.label} image from the attached product photo.`,
    `Keep the product structure, packaging shape, colors, labels, brand marks and material identity faithful to the input. Do not invent a different product.`,
    `Global art direction: ${options.sceneBrief}`,
    `${slot.label} direction: ${options.slotDirections[slot.slotId]}`,
    `Target market language: ${languageLabel(options.language)}. Use that language only when visible copy is necessary; otherwise keep the layout copy-light and premium.`,
    `Output composition: ${options.ratio}, ${options.resolution}, clean commercial lighting, no watermark, no extra logos.`,
  ].join("\n");
}

function publicAssetIdentity(asset) {
  const contentHash = normalizeHash(asset?.contentHash);
  const assetId = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,179}$/.test(String(asset?.assetId || ""))
    ? asset.assetId
    : `asset-${contentHash.hex.slice(0, 32)}`;
  const occurrenceId = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,179}$/.test(String(asset?.occurrenceId || ""))
    ? asset.occurrenceId
    : `occ-${contentHash.hex.slice(0, 24)}`;
  return {
    assetId: publicId(assetId, "RECIPE_OUTPUT_ASSET_INVALID", "输出图片"),
    occurrenceId: publicId(occurrenceId, "RECIPE_OUTPUT_OCCURRENCE_INVALID", "输出图片"),
    contentHash: contentHash.prefixed,
  };
}

function rendererAssetProjection(asset, runId) {
  const identity = publicAssetIdentity(asset);
  const relativePath = cleanText(asset?.relativePath, 2000).replace(/\\/g, "/");
  if (relativePath && (path.posix.isAbsolute(relativePath) || relativePath.split("/").includes(".."))) {
    throw serviceError("RECIPE_OUTPUT_PATH_INVALID", "Recipe 成果路径无效；未写入画布。");
  }
  const assetUrl = cleanText(asset?.assetUrl, 8192);
  if (assetUrl && !assetUrl.startsWith("naimage-asset://local/")) {
    throw serviceError("RECIPE_OUTPUT_URL_INVALID", "Recipe 成果地址不是项目受管地址；未写入画布。");
  }
  const mimeType = /^image\/(?:png|jpeg|webp)$/i.test(String(asset?.mimeType || "")) ? String(asset.mimeType).toLowerCase() : "image/png";
  const outputFormat = mimeType === "image/jpeg" ? "jpeg" : mimeType === "image/webp" ? "webp" : "png";
  return {
    assetId: identity.assetId,
    occurrenceId: identity.occurrenceId,
    contentHash: identity.contentHash.slice(7),
    type: "file",
    relativePath: relativePath || undefined,
    assetUrl: assetUrl || undefined,
    originalName: cleanText(asset?.originalName, 260) || undefined,
    mimeType,
    outputFormat,
    width: Number.isSafeInteger(Number(asset?.width)) && Number(asset.width) > 0 ? Number(asset.width) : undefined,
    height: Number.isSafeInteger(Number(asset?.height)) && Number(asset.height) > 0 ? Number(asset.height) : undefined,
    runId,
    prompt: cleanText(asset?.prompt, 12000) || undefined,
    revisedPrompt: cleanText(asset?.revisedPrompt, 12000) || undefined,
  };
}

function runOutputForAsset(asset, slotId) {
  const identity = publicAssetIdentity(asset);
  return {
    slotId,
    ...identity,
    kind: "image",
    mimeType: rendererAssetProjection(asset, "").mimeType,
    ...(Number.isSafeInteger(Number(asset?.width)) && Number(asset.width) > 0 ? { width: Number(asset.width) } : {}),
    ...(Number.isSafeInteger(Number(asset?.height)) && Number(asset.height) > 0 ? { height: Number(asset.height) } : {}),
  };
}

function stepError(code, category, message, retryable = false) {
  return { code, category, message, retryable, at: new Date().toISOString() };
}

function isAbort(error, signal) {
  return signal?.aborted === true || error?.name === "AbortError" || error?.code === "naimage_run_cancelled";
}

function isDefinitiveFailure(error) {
  if (error?.definitive === true) return true;
  const status = Number(error?.status || error?.statusCode || 0);
  if (status >= 400 && status < 500) return true;
  return /^(?:IMAGE_INPUT|IMAGE_GENERATION_REQUEST|RECIPE_|PROJECT_|CONVERSATION_)/.test(String(error?.code || ""));
}

function createRecipeRunService(options = {}) {
  const {
    projectFor,
    recipeStore,
    resolveInputAsset,
    executeImage,
    recoverImage = async () => ({ exists: false }),
    metaDir = ".naimage",
    writeJson,
    now = () => new Date().toISOString(),
    newRunId = () => `run.${randomUUID()}`,
  } = options;
  if (typeof projectFor !== "function") throw new Error("RecipeRunService requires projectFor.");
  if (!recipeStore?.get) throw new Error("RecipeRunService requires recipeStore.");
  if (typeof resolveInputAsset !== "function") throw new Error("RecipeRunService requires resolveInputAsset.");
  if (typeof executeImage !== "function") throw new Error("RecipeRunService requires executeImage.");
  if (typeof writeJson !== "function") throw new Error("RecipeRunService requires an atomic JSON writer.");

  const active = new Map();

  function projectPaths(projectId) {
    const project = projectFor(String(projectId || ""));
    if (!project?.path) throw serviceError("PROJECT_NOT_FOUND", "当前项目不存在，无法执行 Recipe。");
    const root = path.join(path.resolve(project.path), metaDir, RECIPE_RUNS_DIR);
    return { project, root };
  }

  function runPath(projectId, runId) {
    if (!/^run\.[0-9a-f-]{36}$/.test(String(runId || ""))) {
      throw serviceError("RECIPE_RUN_ID_INVALID", "Run 身份无效。");
    }
    return path.join(projectPaths(projectId).root, `${runId}.json`);
  }

  function planPath(projectId, runId) {
    return path.join(projectPaths(projectId).root, `${runId}.input.json`);
  }

  function assetsPath(projectId, runId) {
    return path.join(projectPaths(projectId).root, `${runId}.outputs.json`);
  }

  function readStrict(filePath, code, message) {
    try {
      return JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      throw serviceError(code, message, error);
    }
  }

  function readPlan(projectId, runId) {
    const file = planPath(projectId, runId);
    if (!existsSync(file)) throw serviceError("RECIPE_PLAN_NOT_FOUND", "运行准备记录不存在，请重新检查运行计划。");
    const plan = readStrict(file, "RECIPE_PLAN_INVALID", "运行准备记录无法读取，请重新检查运行计划。");
    if (!plan || plan.schemaVersion !== 1 || plan.runId !== runId || plan.projectId !== projectId) {
      throw serviceError("RECIPE_PLAN_INVALID", "运行准备记录不匹配，请重新检查运行计划。");
    }
    return plan;
  }

  function writePlan(plan) {
    writeJson(planPath(plan.projectId, plan.runId), plan);
  }

  function readRun(projectId, runId) {
    const file = runPath(projectId, runId);
    if (!existsSync(file)) return null;
    const result = parseRecipeRun(readStrict(file, "RECIPE_RUN_INVALID", "Recipe Run 记录无法读取。"));
    if (!result.ok) {
      throw serviceError("RECIPE_RUN_INVALID", "Recipe Run 记录损坏；已停止执行。", result.errors.slice(0, 8));
    }
    if (result.value.projectId !== projectId) throw serviceError("RECIPE_RUN_PROJECT_MISMATCH", "Recipe Run 不属于当前项目。");
    return result.value;
  }

  function writeRun(recipe, run) {
    const sealed = sealRecipeRun(run);
    if (!sealed) throw serviceError("RECIPE_RUN_INVALID", "Recipe Run 状态无法冻结；已停止执行。");
    const validated = validateRecipeRunAgainstRecipe(sealed, recipe);
    if (!validated.ok) {
      throw serviceError("RECIPE_RUN_CONTRACT_INVALID", "Recipe Run 与 Recipe 不一致；已停止执行。", validated.errors.slice(0, 12));
    }
    writeJson(runPath(sealed.projectId, sealed.runId), sealed);
    return sealed;
  }

  function readOutputAssets(projectId, runId) {
    const file = assetsPath(projectId, runId);
    if (!existsSync(file)) return [];
    const document = readStrict(file, "RECIPE_RUN_ASSETS_INVALID", "Recipe Run 输出资产记录无法读取。");
    if (!document || document.schemaVersion !== 1 || !Array.isArray(document.assets)) return [];
    return document.assets.filter((asset) => asset && typeof asset === "object");
  }

  function writeOutputAssets(runId, projectId, assets) {
    writeJson(assetsPath(projectId, runId), {
      schemaVersion: 1,
      runId,
      updatedAt: now(),
      assets,
    });
  }

  function selectedExecutionSlots(recipe) {
    return recipe.outputContract.outputs.map((slot, index) => {
      const owner = recipe.nodes.find((node) => node.type === "Tool" && node.outputPorts.some((port) => port.portId === slot.slotId));
      if (!owner) throw serviceError("RECIPE_OUTPUT_OWNER_MISSING", `输出槽 ${slot.slotId} 缺少受管 Tool；未执行 Recipe。`);
      return { ...slot, stepId: owner.stepId, requestIndex: index + 1 };
    });
  }

  function initialRun(plan, recipe) {
    const tool = builtinToolManifest();
    const createdAt = now();
    const executable = recipe.nodes.filter((node) => ["Skill", "Transform", "Tool", "Review"].includes(node.type));
    const steps = executable.map((node) => {
      if (node.type === "Skill") {
        return {
          stepId: node.stepId,
          status: "succeeded",
          submissionState: "accepted",
          attempt: 1,
          startedAt: createdAt,
          finishedAt: createdAt,
          outputs: [],
        };
      }
      return {
        stepId: node.stepId,
        status: "pending",
        submissionState: "not_submitted",
        attempt: 0,
        outputs: [],
      };
    });
    return writeRun(recipe, {
      schemaVersion: 1,
      runId: plan.runId,
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      recipeHash: recipe.contentHash,
      projectId: plan.projectId,
      ...(plan.conversationId ? { conversationId: plan.conversationId } : {}),
      requestedBy: "user",
      status: "running",
      createdAt,
      updatedAt: createdAt,
      inputAssetIdentity: [plan.inputIdentity],
      permissionSnapshot: {
        schemaVersion: 1,
        approvedBy: "user",
        approvedAt: createdAt,
        tools: [{
          toolId: tool.id,
          version: tool.version,
          contentHash: tool.contentHash,
          permissions: tool.permissions,
        }],
      },
      steps,
      outputs: [],
    });
  }

  function prepare(payload = {}) {
    const projectId = cleanText(payload.projectId, 180);
    const conversationId = cleanText(payload.conversationId, 180);
    const recipeId = cleanText(payload.recipeId, 86, BUILTIN_RECIPE_ID);
    if (!projectId) throw serviceError("PROJECT_REQUIRED", "请先打开项目，再选择 Recipe。");
    const recipe = recipeStore.get(projectId, recipeId);
    const inputIdentity = normalizeInputIdentity(payload.input);
    const resolved = resolveInputAsset(projectId, inputIdentity);
    if (!resolved?.path) throw serviceError("RECIPE_INPUT_UNAVAILABLE", "输入图片不在当前项目受管目录中；未执行 Recipe。");
    const resolvedHash = normalizeHash(resolved.contentHash || inputIdentity.contentHash).prefixed;
    if (resolvedHash !== inputIdentity.contentHash) {
      throw serviceError("RECIPE_INPUT_CHANGED", "输入图片内容与所选素材不一致；未执行 Recipe。");
    }
    const optionsNormalized = normalizeStudioOptions(payload.options);
    const tool = builtinToolManifest();
    const runId = newRunId();
    const createdAt = now();
    const plan = {
      schemaVersion: 1,
      runId,
      projectId,
      ...(conversationId ? { conversationId } : {}),
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      recipeHash: recipe.contentHash,
      inputIdentity,
      input: {
        assetId: inputIdentity.assetId,
        occurrenceId: inputIdentity.occurrenceId,
        contentHash: inputIdentity.contentHash,
        displayCode: cleanText(resolved.displayCode, 40) || undefined,
        name: cleanText(resolved.name || resolved.originalName, 260) || "商品母图",
        width: Number(resolved.width) > 0 ? Number(resolved.width) : undefined,
        height: Number(resolved.height) > 0 ? Number(resolved.height) : undefined,
        mimeType: cleanText(resolved.mimeType, 80) || "image/png",
        sourceNodeId: cleanText(resolved.canvasNodeId, 160) || undefined,
      },
      options: optionsNormalized,
      createdAt,
    };
    writePlan(plan);
    return {
      runId,
      recipe,
      input: plan.input,
      options: optionsNormalized,
      tool: {
        id: tool.id,
        name: tool.name,
        version: tool.version,
        contentHash: tool.contentHash,
        permissions: JSON.parse(JSON.stringify(tool.permissions)),
      },
      expectedOutputs: recipe.outputContract.outputs.map((slot) => ({
        ...slot,
        stepId: selectedExecutionSlots(recipe).find((item) => item.slotId === slot.slotId)?.stepId,
      })),
      estimatedRequests: recipe.outputContract.outputs.length,
    };
  }

  function publicRunResult(projectId, run) {
    const plan = readPlan(projectId, run.runId);
    return {
      run,
      assets: readOutputAssets(projectId, run.runId).map((asset) => {
        const slotId = cleanText(asset?.slotId, 80);
        if (!slotId) throw serviceError("RECIPE_RUN_ASSETS_INVALID", "Recipe Run 成果缺少输出槽；未写入画布。");
        return { ...rendererAssetProjection(asset, run.runId), slotId };
      }),
      recipe: recipeStore.get(projectId, run.recipeId),
      options: plan.options,
      input: plan.input,
    };
  }

  async function recoverStepAssets(plan, step) {
    const result = await recoverImage({
      projectId: plan.projectId,
      runId: plan.runId,
      requestIndex: selectedExecutionSlots(builtinRecipeCatalog().recipe)
        .find((slot) => slot.stepId === step.stepId)?.requestIndex || 0,
    });
    return result && typeof result === "object" ? result : { exists: false };
  }

  async function executeRun(plan, current, recipe, controller) {
    let run = current;
    const slots = selectedExecutionSlots(recipe);
    const tool = builtinToolManifest();
    const delivered = new Map();
    const input = resolveInputAsset(plan.projectId, plan.inputIdentity);
    if (!input?.path) throw serviceError("RECIPE_INPUT_UNAVAILABLE", "输入图片已不可用；已停止 Recipe。");
    if (normalizeHash(input.contentHash || plan.inputIdentity.contentHash).prefixed !== plan.inputIdentity.contentHash) {
      throw serviceError("RECIPE_INPUT_CHANGED", "输入图片在确认后发生变化；已停止 Recipe。");
    }

    let failure = null;
    let pendingRecovery = false;
    for (const slot of slots) {
      if (controller.signal.aborted) break;
      let step = run.steps.find((item) => item.stepId === slot.stepId);
      if (!step) throw serviceError("RECIPE_STEP_MISSING", "Recipe 执行步骤缺失；已停止 Recipe。");
      if (step.status === "succeeded") {
        const existing = step.outputs[0];
        if (existing) delivered.set(slot.slotId, existing);
        continue;
      }
      if (!["pending", "running", "ready", "interrupted"].includes(step.status)) {
        failure = step.error || stepError("RECIPE_STEP_TERMINAL", "execution", "Recipe 步骤已终止，未自动重发。");
        break;
      }

      if (step.status === "running" || ["prepared", "submitted", "accepted", "unknown"].includes(step.submissionState)) {
        const recovered = await recoverStepAssets(plan, step);
        if (recovered.exists === true) {
          if (Array.isArray(recovered.assets) && recovered.assets.length === 1) {
            try {
              const output = runOutputForAsset(recovered.assets[0], slot.slotId);
              const stepOutput = { ...output };
              const projection = rendererAssetProjection(recovered.assets[0], plan.runId);
              const currentAssets = readOutputAssets(plan.projectId, plan.runId)
                .filter((asset) => asset.assetId !== projection.assetId);
              writeOutputAssets(plan.runId, plan.projectId, [...currentAssets, { ...projection, slotId: slot.slotId }]);
              const steps = run.steps.map((item) => item.stepId === step.stepId ? {
                ...item,
                status: "succeeded",
                submissionState: "accepted",
                finishedAt: now(),
                outputs: [stepOutput],
              } : item);
              const outputs = [...run.outputs.filter((item) => item.slotId !== slot.slotId), output];
              run = writeRun(recipe, { ...run, status: "running", updatedAt: now(), steps, outputs });
              delivered.set(slot.slotId, output);
              continue;
            } catch (error) {
              failure = stepError("RECIPE_RECOVERY_OUTPUT_INVALID", "unknown", "已找到原请求，但返回成果身份无效；未自动重发。");
              break;
            }
          }
          if (recovered.pending === true) {
            pendingRecovery = true;
            break;
          }
          failure = recovered.unknown === true
            ? stepError("RECIPE_IMAGE_SUBMISSION_UNKNOWN", "unknown", "图片请求的最终状态无法确认；已停止，不会自动重发。")
            : stepError("RECIPE_IMAGE_RECOVERY_FAILED", "execution", "原图片请求未能恢复；已停止，不会自动重发。");
          break;
        }
        // A persisted prepared/running step can be left behind by a process
        // crash at any point around the request. Without a journal record the
        // only safe interpretation is "unknown"; never turn that into a new
        // paid request.
        failure = stepError(
          step.submissionState === "prepared" ? "RECIPE_RESTART_BEFORE_DISPATCH" : "RECIPE_IMAGE_SUBMISSION_UNKNOWN",
          "unknown",
          "执行中断前无法确认图片请求是否已发出；已停止，不会自动重发。",
        );
        break;
      }

      const startedAt = now();
      run = writeRun(recipe, {
        ...run,
        status: "running",
        updatedAt: startedAt,
        steps: run.steps.map((item) => item.stepId === slot.stepId ? {
          ...item,
          status: "running",
          submissionState: "prepared",
          attempt: Math.max(1, Number(item.attempt) || 0),
          startedAt,
          finishedAt: undefined,
          error: undefined,
        } : item),
      });
      step = run.steps.find((item) => item.stepId === slot.stepId);
      try {
        const result = await executeImage({
          projectId: plan.projectId,
          conversationId: plan.conversationId,
          runId: plan.runId,
          operationId: plan.runId,
          requestIndex: slot.requestIndex,
          stepId: slot.stepId,
          slotId: slot.slotId,
          prompt: promptForSlot(slot, plan.options),
          inputAsset: input,
          inputIdentity: plan.inputIdentity,
          options: plan.options,
          signal: controller.signal,
          model: tool.adapter,
        });
        if (controller.signal.aborted) throw Object.assign(new Error("Recipe Run cancelled."), { name: "AbortError" });
        if (!result?.asset) throw serviceError("RECIPE_IMAGE_RESULT_MISSING", "图片执行器未返回受管成果；未自动重发。", { definitive: true });
        const output = runOutputForAsset(result.asset, slot.slotId);
        const stepOutput = { ...output };
        const projection = rendererAssetProjection(result.asset, plan.runId);
        const currentAssets = readOutputAssets(plan.projectId, plan.runId)
          .filter((asset) => asset.assetId !== projection.assetId);
        writeOutputAssets(plan.runId, plan.projectId, [...currentAssets, { ...projection, slotId: slot.slotId }]);
        run = writeRun(recipe, {
          ...run,
          updatedAt: now(),
          steps: run.steps.map((item) => item.stepId === slot.stepId ? {
            ...item,
            status: "succeeded",
            submissionState: "accepted",
            finishedAt: now(),
            outputs: [stepOutput],
            error: undefined,
          } : item),
          outputs: [...run.outputs.filter((item) => item.slotId !== slot.slotId), output],
        });
        delivered.set(slot.slotId, output);
      } catch (error) {
        if (isAbort(error, controller.signal)) {
          const cancelledStep = {
            status: "cancelled",
            submissionState: "unknown",
            finishedAt: now(),
            error: stepError("RECIPE_RUN_CANCELLED", "cancelled", "运行已取消；已发出的图片请求不会自动重发。"),
          };
          run = writeRun(recipe, {
            ...run,
            status: "cancelled",
            updatedAt: now(),
            steps: run.steps.map((item) => item.stepId === slot.stepId ? { ...item, ...cancelledStep } : item),
            error: cancelledStep.error,
          });
          return publicRunResult(plan.projectId, run);
        }
        const definitive = isDefinitiveFailure(error);
        const errorMessage = cleanText(error?.message, 500, "图片生成失败；未自动重发。");
        failure = definitive
          ? stepError("RECIPE_IMAGE_FAILED", "execution", errorMessage)
          : stepError("RECIPE_IMAGE_SUBMISSION_UNKNOWN", "unknown", "图片请求的最终状态无法确认；已停止，不会自动重发。");
        run = writeRun(recipe, {
          ...run,
          updatedAt: now(),
          steps: run.steps.map((item) => item.stepId === slot.stepId ? {
            ...item,
            status: "failed",
            submissionState: definitive ? "submitted" : "unknown",
            finishedAt: now(),
            error: failure,
          } : item),
        });
        break;
      }
    }

    if (pendingRecovery) return publicRunResult(plan.projectId, run);

    const cancelled = controller.signal.aborted;
    const allSucceeded = slots.every((slot) => run.steps.find((step) => step.stepId === slot.stepId)?.status === "succeeded");
    if (cancelled) {
      const error = stepError("RECIPE_RUN_CANCELLED", "cancelled", "运行已取消；已发出的图片请求不会自动重发。");
      run = writeRun(recipe, {
        ...run,
        status: "cancelled",
        updatedAt: now(),
        steps: run.steps.map((step) => step.status === "pending" || step.status === "running" ? {
          ...step,
          status: "cancelled",
          finishedAt: now(),
          error,
        } : step),
        error,
      });
    } else if (failure || !allSucceeded) {
      const terminal = failure || stepError("RECIPE_RUN_INCOMPLETE", "unknown", "Recipe Run 未完成全部输出；未自动重发。");
      const skipped = stepError("RECIPE_RUN_STEP_SKIPPED", "execution", "前面的步骤失败，此输出未执行；不会自动重发。");
      run = writeRun(recipe, {
        ...run,
        status: "failed",
        updatedAt: now(),
        steps: run.steps.map((step) => step.status === "pending"
          ? { ...step, status: "interrupted", finishedAt: now(), error: skipped }
          : step.status === "running"
            ? { ...step, status: "failed", finishedAt: now(), error: terminal }
            : step),
        error: terminal,
      });
    } else {
      run = writeRun(recipe, {
        ...run,
        status: "succeeded",
        updatedAt: now(),
        outputs: slots.map((slot) => delivered.get(slot.slotId)).filter(Boolean),
      });
    }

    return publicRunResult(plan.projectId, run);
  }

  function launch(plan, run, recipe) {
    if (active.has(run.runId)) return active.get(run.runId).promise;
    const controller = new AbortController();
    const promise = executeRun(plan, run, recipe, controller)
      .catch((error) => {
        try {
          const current = readRun(plan.projectId, plan.runId);
          if (current && !["succeeded", "failed", "cancelled"].includes(current.status)) {
            const terminal = stepError(
              /^[A-Z][A-Z0-9_]{2,63}$/.test(String(error?.code || "")) ? error.code : "RECIPE_RUN_FAILED",
              "execution",
              cleanText(error?.message, 500, "Recipe Run 执行失败；已停止。"),
            );
            const skipped = stepError("RECIPE_RUN_STEP_SKIPPED", "execution", "前面的步骤失败，此输出未执行；不会自动重发。");
            writeRun(recipe, {
              ...current,
              status: "failed",
              updatedAt: now(),
              steps: current.steps.map((step) => step.status === "pending"
                ? { ...step, status: "interrupted", finishedAt: now(), error: skipped }
                : step.status === "running"
                  ? { ...step, status: "failed", finishedAt: now(), error: terminal }
                  : step),
              error: terminal,
            });
          }
        } catch {
          // The original failure is returned to the caller.
        }
        throw error;
      })
      .finally(() => {
        active.delete(run.runId);
      });
    active.set(run.runId, { controller, promise });
    return promise;
  }

  function start(payload = {}) {
    if (payload.confirmed !== true) {
      throw serviceError("RECIPE_CONFIRMATION_REQUIRED", "运行前必须明确确认图片请求和可能产生的费用。");
    }
    const projectId = cleanText(payload.projectId, 180);
    const runId = cleanText(payload.runId, 80);
    if (!projectId) throw serviceError("PROJECT_REQUIRED", "请先打开项目。");
    const existing = readRun(projectId, runId);
    if (existing) {
      if (active.has(runId)) void active.get(runId).promise.catch(() => {});
      return publicRunResult(projectId, existing);
    }
    const plan = readPlan(projectId, runId);
    if (plan.projectId !== projectId) throw serviceError("RECIPE_PLAN_PROJECT_MISMATCH", "运行准备记录不属于当前项目。");
    const recipe = recipeStore.get(projectId, plan.recipeId);
    if (recipe.contentHash !== plan.recipeHash || recipe.version !== plan.recipeVersion) {
      throw serviceError("RECIPE_CHANGED", "Recipe 已在确认前变化，请重新检查运行计划。");
    }
    const confirmedPlan = { ...plan, confirmedAt: now() };
    writePlan(confirmedPlan);
    const run = initialRun(confirmedPlan, recipe);
    void launch(confirmedPlan, run, recipe).catch(() => {});
    return publicRunResult(projectId, run);
  }

  function get(payload = {}) {
    const projectId = cleanText(payload.projectId, 180);
    const runId = cleanText(payload.runId, 80);
    const run = readRun(projectId, runId);
    if (!run) throw serviceError("RECIPE_RUN_NOT_FOUND", "Recipe Run 不存在。");
    return publicRunResult(projectId, run);
  }

  function listRuns(payload = {}) {
    const projectId = cleanText(payload.projectId, 180);
    const { root } = projectPaths(projectId);
    if (!existsSync(root)) return { runs: [] };
    const runs = readdirSync(root)
      .filter((name) => RECIPE_RUN_FILE.test(name))
      .flatMap((name) => {
        const runId = name.slice(0, -5);
        try {
          const run = readRun(projectId, runId);
          if (!run) return [];
          let plan = null;
          try {
            plan = readPlan(projectId, runId);
          } catch {
            plan = null;
          }
          return [{
            runId: run.runId,
            status: run.status,
            recipeId: run.recipeId,
            recipeVersion: run.recipeVersion,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            outputCount: run.outputs.length,
            sourceNodeId: plan?.input?.sourceNodeId || "",
          }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    return { runs };
  }

  function resume(payload = {}) {
    const projectId = cleanText(payload.projectId, 180);
    const runId = cleanText(payload.runId, 80);
    const run = readRun(projectId, runId);
    if (!run) throw serviceError("RECIPE_RUN_NOT_FOUND", "Recipe Run 不存在。");
    if (["succeeded", "failed", "cancelled"].includes(run.status)) return publicRunResult(projectId, run);
    const plan = readPlan(projectId, runId);
    const recipe = recipeStore.get(projectId, run.recipeId);
    if (!active.has(runId)) void launch(plan, run, recipe).catch(() => {});
    return publicRunResult(projectId, run);
  }

  function cancel(payload = {}) {
    const projectId = cleanText(payload.projectId, 180);
    const runId = cleanText(payload.runId, 80);
    const run = readRun(projectId, runId);
    if (!run) {
      const planFile = planPath(projectId, runId);
      if (existsSync(planFile)) unlinkSync(planFile);
      return { cancelled: true, run: null };
    }
    if (["succeeded", "failed", "cancelled"].includes(run.status)) return publicRunResult(projectId, run);
    const activeRun = active.get(runId);
    if (activeRun) {
      activeRun.controller.abort(serviceError("RECIPE_RUN_CANCELLED", "用户取消了 Recipe Run。"));
      return { cancelling: true, run: publicRunResult(projectId, run).run };
    }
    const recipe = recipeStore.get(projectId, run.recipeId);
    const error = stepError("RECIPE_RUN_CANCELLED", "cancelled", "运行已取消；没有新的图片请求会被发送。");
    const cancelled = writeRun(recipe, {
      ...run,
      status: "cancelled",
      updatedAt: now(),
      steps: run.steps.map((step) => step.status === "pending" || step.status === "running" ? {
        ...step,
        status: "cancelled",
        finishedAt: now(),
        error,
      } : step),
      error,
    });
    return publicRunResult(projectId, cancelled);
  }

  async function resumePending(projectIds = []) {
    const resumed = [];
    for (const projectId of projectIds) {
      const { root } = projectPaths(projectId);
      if (!existsSync(root)) continue;
      for (const name of readdirSync(root)) {
        if (!RECIPE_RUN_FILE.test(name)) continue;
        const runId = name.slice(0, -5);
        try {
          const run = readRun(projectId, runId);
          if (run && !["succeeded", "failed", "cancelled"].includes(run.status)) {
            resume({ projectId, runId });
            resumed.push(runId);
          }
        } catch {
          // A corrupt run is left untouched; callers see it through explicit GET.
        }
      }
    }
    return resumed;
  }

  function waitForRun(payload = {}) {
    const runId = cleanText(payload.runId, 80);
    const entry = active.get(runId);
    return entry ? entry.promise : Promise.resolve(null);
  }

  return {
    prepare,
    start,
    get,
    listRuns,
    resume,
    cancel,
    resumePending,
    waitForRun,
  };
}

module.exports = {
  createRecipeRunService,
  normalizeStudioOptions,
  DEFAULT_SCENE_BRIEF,
};
