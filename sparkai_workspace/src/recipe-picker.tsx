import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Loader2,
  Play,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  imageAssetName,
  imageAssetThumbnailSrc,
  type ImageAsset,
  type RecipeActiveRun,
  type RecipePreparation,
  type RecipeRunResult,
  type RecipeStudioOptions,
} from "./core";
import type { RecipeRun } from "../runtime/recipe-run-contract.mjs";
import { stableImageAssetId, stableImageOccurrenceId } from "./asset-identity";
import {
  initialStudioOptions,
  shortHash,
  shortRunId,
  validateStudioOptions,
  type StudioOutputSlot,
} from "./studio-state";
import {
  ActionButton,
  DialogShell,
  Field,
  InlineNotice,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
} from "./ui";

const CLOSE_BUTTON_REASON = "close-button" as const;
const ALWAYS_CLOSE = "always" as const;

const PERMISSION_LABELS: Record<string, string> = {
  network: "网络",
  filesystem: "文件",
  process: "进程",
  models: "模型",
  mcp: "MCP",
};

type RecipeListItem = {
  id: string;
  name: string;
  description: string;
  version: string;
  contentHash: string;
  builtin: boolean;
  inputSlots: Array<{ slotId: string; label: string; dataType: string; required: boolean }>;
  outputSlots: StudioOutputSlot[];
};

type Stage = "studio" | "confirm";

function runStatusLabel(run?: RecipeRun | null) {
  if (!run) return "等待确认";
  const labels: Record<RecipeRun["status"], string> = {
    queued: "排队",
    running: "生成中",
    waiting_approval: "等待确认",
    paused: "已暂停",
    succeeded: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
  };
  return labels[run.status];
}

function formatPermissionValues(values: string[]) {
  return values.length ? values.join(" · ") : "none";
}

export function RecipeStudioDialog({
  projectId,
  conversationId,
  inputNodeId,
  inputAsset,
  inputAssetIndex,
  close,
  onRunStarted,
}: {
  projectId: string;
  conversationId: string;
  inputNodeId: string;
  inputAsset: ImageAsset;
  inputAssetIndex: number;
  close: () => void;
  onRunStarted: (run: RecipeActiveRun) => void;
}) {
  const [stage, setStage] = useState<Stage>("studio");
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeListItem | null>(null);
  const [options, setOptions] = useState<RecipeStudioOptions>(() => initialStudioOptions());
  const [preparation, setPreparation] = useState<RecipePreparation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const input = {
    assetId: stableImageAssetId(inputAsset, inputAssetIndex + 1),
    occurrenceId: stableImageOccurrenceId(inputAsset, inputNodeId, inputAssetIndex),
    contentHash: String(inputAsset.contentHash || "").trim().toLowerCase().replace(/^sha256:/, ""),
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const bridge = window.naimageRecipe;
        if (!bridge) throw new Error("Recipe bridge unavailable.");
        const listed = await bridge.list({ projectId });
        if (!alive) return;
        if (!listed.ok) throw new Error(listed.error || "Recipe 列表读取失败。");
        const recipe = (Array.isArray(listed.recipes) ? listed.recipes : [])
          .find((item) => item.id === "recipe.sparkvas.beauty-product-hero") as RecipeListItem | undefined;
        if (!recipe) throw new Error("内置 Beauty Recipe 不可用。");
        setSelectedRecipe(recipe);
        setOptions(initialStudioOptions(recipe.outputSlots));
      } catch (loadError) {
        if (alive) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function prepareRun() {
    if (!selectedRecipe || !input.contentHash) {
      setError("所选商品图缺少受管内容指纹，不能运行 Recipe。");
      return;
    }
    const validation = validateStudioOptions(options, selectedRecipe.outputSlots.length);
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const bridge = window.naimageRecipe;
      if (!bridge) throw new Error("Recipe bridge unavailable.");
      const response = await bridge.prepare({
        projectId,
        conversationId,
        recipeId: selectedRecipe.id,
        input,
        options,
      });
      if (!response.ok || !response.runId || !response.recipe || !response.input || !response.options) {
        throw new Error(response.error || "运行计划检查失败。");
      }
      setPreparation(response as RecipePreparation);
      setConfirmed(false);
      setStage("confirm");
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : String(prepareError));
    } finally {
      setBusy(false);
    }
  }

  async function startRun() {
    if (!preparation || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      const bridge = window.naimageRecipe;
      if (!bridge) throw new Error("Recipe bridge unavailable.");
      const response = await bridge.start({
        projectId,
        runId: preparation.runId,
        confirmed: true,
      });
      if (!response.ok || !response.run) throw new Error(response.error || "Recipe Run 启动失败。");
      onRunStarted({
        runId: preparation.runId,
        projectId,
        sourceNodeId: inputNodeId,
        sourceAssetIndex: inputAssetIndex,
        recipeName: preparation.recipe.name,
        result: response as RecipeRunResult,
      });
      close();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setBusy(false);
    }
  }

  const headerTitle = stage === "confirm" ? "确认运行" : (selectedRecipe?.name || "Recipe");

  return (
    <DialogShell
      surface="recipe-studio"
      ariaLabel="Recipe Studio"
      layerClassName="recipe-studio-layer"
      className={`recipe-studio-dialog${stage === "confirm" ? " is-confirming" : ""}`}
      busy={busy}
      closePolicy={{
        escape: ALWAYS_CLOSE,
        backdrop: ALWAYS_CLOSE,
        [CLOSE_BUTTON_REASON]: ALWAYS_CLOSE,
      }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={headerTitle}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭 Sparkvas Studio"
          />
          <SurfaceBody className="recipe-studio-body">
            {loading ? (
              <div className="recipe-studio-loading" aria-busy="true">
                <Loader2 className="spin" size={18} />
                <span>读取 Recipe…</span>
              </div>
            ) : null}

            {!loading && stage === "studio" && selectedRecipe ? (
              <section className="recipe-studio-workspace" aria-label="Studio 运行设置" data-recipe-id={selectedRecipe.id}>
                <div className="recipe-studio-form">
                  <div className="recipe-source-card">
                    <img src={imageAssetThumbnailSrc(inputAsset, 320)} alt={imageAssetName(inputAsset)} />
                    <strong>{inputAsset.title || imageAssetName(inputAsset)}</strong>
                  </div>
                  <Field label="场景文案">
                    <textarea
                      aria-label="Recipe 场景文案"
                      value={options.sceneBrief}
                      maxLength={1200}
                      rows={2}
                      onChange={(event) => setOptions((current) => ({ ...current, sceneBrief: event.target.value }))}
                    />
                  </Field>
                  <div className="recipe-option-grid">
                    <Field label="市场语言">
                      <select
                        aria-label="Recipe 市场语言"
                        value={options.language}
                        onChange={(event) => setOptions((current) => ({
                          ...current,
                          language: event.target.value as RecipeStudioOptions["language"],
                        }))}
                      >
                        <option value="zh-CN">简体中文</option>
                        <option value="en-US">English</option>
                        <option value="ja-JP">日本語</option>
                      </select>
                    </Field>
                    <Field label="画幅">
                      <select
                        aria-label="Recipe 画幅"
                        value={options.ratio}
                        onChange={(event) => setOptions((current) => ({
                          ...current,
                          ratio: event.target.value as RecipeStudioOptions["ratio"],
                        }))}
                      >
                        <option value="1:1">1:1</option>
                        <option value="4:5">4:5</option>
                        <option value="16:9">16:9</option>
                      </select>
                    </Field>
                    <Field label="清晰度">
                      <select
                        aria-label="Recipe 清晰度"
                        value={options.resolution}
                        onChange={(event) => setOptions((current) => ({
                          ...current,
                          resolution: event.target.value as RecipeStudioOptions["resolution"],
                        }))}
                      >
                        <option value="1K">1K</option>
                        <option value="2K">2K</option>
                      </select>
                    </Field>
                    <Field label="质量">
                      <select
                        aria-label="Recipe 质量"
                        value={options.quality}
                        onChange={(event) => setOptions((current) => ({
                          ...current,
                          quality: event.target.value as RecipeStudioOptions["quality"],
                        }))}
                      >
                        <option value="high">High</option>
                        <option value="auto">Auto</option>
                      </select>
                    </Field>
                  </div>
                  <div className="recipe-output-editor">
                    <span className="recipe-section-label">输出槽</span>
                    {selectedRecipe.outputSlots.map((slot) => (
                      <label className="recipe-output-row" key={slot.slotId}>
                        <span>{slot.label}</span>
                        <input
                          aria-label={`${slot.label}画面方向`}
                          value={options.slotDirections[slot.slotId] || ""}
                          maxLength={320}
                          onChange={(event) => setOptions((current) => ({
                            ...current,
                            slotDirections: { ...current.slotDirections, [slot.slotId]: event.target.value },
                          }))}
                        />
                      </label>
                    ))}
                  </div>
                  {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
                </div>
              </section>
            ) : null}

            {!loading && stage === "confirm" && preparation ? (
              <section className="recipe-confirm-step" aria-label="确认 Recipe Run">
                <div className="recipe-confirm-main" data-recipe-id={preparation.recipe.id} data-recipe-hash={preparation.recipe.contentHash}>
                  <div className="recipe-kv-list">
                    <div className="recipe-kv-row">
                      <span>Recipe</span>
                      <strong>{preparation.recipe.name}</strong>
                      <code title={preparation.recipe.contentHash}>v{preparation.recipe.version} · {shortHash(preparation.recipe.contentHash)}</code>
                    </div>
                    <div className="recipe-kv-row">
                      <span>输入</span>
                      <strong>{preparation.input.name}</strong>
                      <code title={preparation.input.contentHash}>{preparation.input.assetId}</code>
                    </div>
                  </div>
                  <div className="recipe-permission-box">
                    <span className="recipe-section-label"><ShieldCheck size={13} aria-hidden="true" /> 权限</span>
                    {Object.entries(preparation.tool.permissions).filter(([, values]) => values.length > 0 && !values.includes("none")).map(([scope, values]) => (
                      <div className="recipe-permission-row" key={scope}>
                        <span>{PERMISSION_LABELS[scope] || scope}</span>
                        <code>{formatPermissionValues(values)}</code>
                      </div>
                    ))}
                  </div>
                </div>
                <aside className="recipe-output-preview">
                  <span className="recipe-section-label">预计输出</span>
                  <ol className="recipe-expected-list">
                    {preparation.expectedOutputs.map((item, index) => (
                      <li key={item.slotId}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{item.label}</strong>
                        <em>{preparation.options.ratio} · {preparation.options.resolution}</em>
                      </li>
                    ))}
                  </ol>
                </aside>
                <label className="recipe-confirm-checkbox">
                  <input
                    type="checkbox"
                    aria-label="确认发起六次图片请求"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>确认发起 {preparation.expectedOutputs.length} 次图片生成请求（按当前账户计费）</span>
                </label>
                {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
              </section>
            ) : null}
          </SurfaceBody>
          <SurfaceFooter className="recipe-studio-footer">
            {stage === "studio" ? (
              <>
                <ActionButton onClick={() => requestClose(CLOSE_BUTTON_REASON)}>取消</ActionButton>
                <ActionButton
                  variant="primary"
                  busy={busy}
                  disabled={loading || !selectedRecipe}
                  icon={<Check size={14} />}
                  onClick={() => void prepareRun()}
                >
                  继续
                </ActionButton>
              </>
            ) : null}
            {stage === "confirm" ? (
              <>
                <ActionButton icon={<ArrowLeft size={14} />} disabled={busy} onClick={() => { setError(""); setStage("studio"); }}>
                  返回
                </ActionButton>
                <ActionButton
                  variant="primary"
                  busy={busy}
                  disabled={!confirmed}
                  icon={<Play size={14} />}
                  onClick={() => void startRun()}
                >
                  开始生成
                </ActionButton>
              </>
            ) : null}
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}

export function RecipeRunDock({
  run,
  busy = false,
  onCancel,
  onReveal,
  onRetryDelivery,
  onReconfigure,
  onDismiss,
}: {
  run: RecipeActiveRun;
  busy?: boolean;
  onCancel: () => void;
  onReveal: () => void;
  onRetryDelivery: () => void;
  onReconfigure: () => void;
  onDismiss: () => void;
}) {
  const status = run.result.run.status;
  const inFlight = status === "queued" || status === "running";
  const outputSlots = run.result.recipe?.outputContract?.outputs ?? [];
  const toolSteps = run.result.run.steps.filter((step) => step.stepId.startsWith("step.render-"));
  const total = outputSlots.length || toolSteps.length || 6;
  const completed = toolSteps.filter((step) => step.status === "succeeded").length;
  const errorText = run.deliveryError || run.result.run.error?.message || "";

  return (
    <aside
      className={`recipe-run-dock is-${status}`}
      aria-label="Recipe Run 状态"
      data-recipe-run-id={run.runId}
      data-run-status={status}
    >
      <div className="recipe-run-dock-top">
        <div className="recipe-run-dock-title">
          {inFlight ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <i className={`recipe-run-dot is-${status}`} aria-hidden="true" />}
          <strong>{run.recipeName}</strong>
        </div>
        <span className={`recipe-run-state is-${status}`}>
          {inFlight ? `${completed}/${total}` : runStatusLabel(run.result.run)}
        </span>
        {!inFlight ? (
          <button type="button" className="recipe-run-dock-close" aria-label="关闭进度条" onClick={onDismiss}>
            <X size={13} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="recipe-run-dock-segments" aria-hidden="true">
        {(outputSlots.length ? outputSlots : Array.from({ length: total }, (_, index) => ({ slotId: `slot-${index}` }))).map((slot, index) => {
          const step = toolSteps.find((item) => item.stepId === `step.render-${slot.slotId}`) || toolSteps[index];
          return <i key={slot.slotId} className={`is-${step?.status || "queued"}`} />;
        })}
      </div>

      {errorText ? <p className="recipe-run-dock-error" role="status">{errorText}</p> : null}

      <div className="recipe-run-dock-actions">
        {inFlight ? (
          <ActionButton variant="secondary" busy={run.cancelling} onClick={onCancel}>
            取消
          </ActionButton>
        ) : null}
        {status === "succeeded" && !run.deliveryError ? (
          <ActionButton variant="primary" busy={busy} onClick={onReveal}>
            查看结果
          </ActionButton>
        ) : null}
        {status === "succeeded" && run.deliveryError ? (
          <ActionButton variant="primary" busy={busy} onClick={onRetryDelivery}>
            重试写回
          </ActionButton>
        ) : null}
        {status === "failed" || status === "cancelled" ? (
          <ActionButton variant="secondary" onClick={onReconfigure}>
            重新配置
          </ActionButton>
        ) : null}
      </div>
    </aside>
  );
}

export function RecipeProvenanceDialog({
  projectId,
  runId,
  close,
}: {
  projectId: string;
  runId: string;
  close: () => void;
}) {
  const [result, setResult] = useState<RecipeRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await window.naimageRecipe?.get({ projectId, runId });
        if (!alive) return;
        if (!response?.ok || !response.run) throw new Error(response?.error || "Recipe Run 读取失败。");
        setResult(response as RecipeRunResult);
      } catch (loadError) {
        if (alive) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, runId]);

  return (
    <DialogShell
      surface="recipe-provenance"
      ariaLabel="Recipe Run provenance"
      layerClassName="recipe-provenance-layer"
      className="recipe-provenance-dialog"
      closePolicy={{
        escape: ALWAYS_CLOSE,
        backdrop: ALWAYS_CLOSE,
        [CLOSE_BUTTON_REASON]: ALWAYS_CLOSE,
      }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={result?.recipe.name || "Recipe Run"}
            description={shortRunId(runId)}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭 Recipe Run provenance"
          />
          <SurfaceBody className="recipe-provenance-body" data-sparkvas-provenance={runId}>
            {loading ? <div className="recipe-studio-loading"><Loader2 className="spin" size={18} /><span>读取 Run…</span></div> : null}
            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
            {result ? (
              <>
                <div className="recipe-kv-strip">
                  <div><span>Recipe</span><strong>{result.recipe.id}</strong></div>
                  <div><span>版本</span><strong title={result.recipe.contentHash}>v{result.recipe.version} · {shortHash(result.recipe.contentHash)}</strong></div>
                  <div><span>Run · {runStatusLabel(result.run)}</span><strong title={result.run.runId}>{result.run.runId}</strong></div>
                  <div><span>Scope</span><strong title={result.run.scopeHash}>{shortHash(result.run.scopeHash, 14)}</strong></div>
                </div>
                <div className="recipe-provenance-columns">
                  <section>
                    <span className="recipe-section-label">输入</span>
                    {result.run.inputAssetIdentity.map((asset) => (
                      <div className="recipe-provenance-asset" key={asset.slotId}>
                        <strong>{asset.slotId} · {asset.assetId}</strong>
                        <span>{asset.occurrenceId}</span>
                        <code title={asset.contentHash}>{shortHash(asset.contentHash, 18)}</code>
                      </div>
                    ))}
                    <span className="recipe-section-label">权限</span>
                    {result.run.permissionSnapshot.tools.map((tool) => (
                      <div className="recipe-provenance-permission" key={tool.toolId}>
                        <strong>{tool.toolId}</strong>
                        {Object.entries(tool.permissions).map(([scope, values]) => (
                          <div className="recipe-permission-row" key={scope}>
                            <span>{PERMISSION_LABELS[scope] || scope}</span>
                            <code>{formatPermissionValues(values)}</code>
                          </div>
                        ))}
                      </div>
                    ))}
                  </section>
                  <section>
                    <span className="recipe-section-label">输出</span>
                    {result.run.outputs.map((asset) => {
                      const slot = result.recipe.outputContract.outputs.find((item) => item.slotId === asset.slotId);
                      return (
                        <div className="recipe-provenance-asset" key={asset.slotId}>
                          <strong>{slot?.label || asset.slotId} · {asset.assetId}</strong>
                          <span>{asset.occurrenceId} · {asset.mimeType}</span>
                          <code title={asset.contentHash}>{shortHash(asset.contentHash, 18)}</code>
                        </div>
                      );
                    })}
                  </section>
                </div>
              </>
            ) : null}
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton variant="primary" onClick={() => requestClose(CLOSE_BUTTON_REASON)}>关闭</ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
