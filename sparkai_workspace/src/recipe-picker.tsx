import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Image as ImageIcon,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import {
  imageAssetName,
  imageAssetThumbnailSrc,
  type ImageAsset,
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
const WHEN_IDLE = "when-idle" as const;

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

type Stage = "recipe" | "studio" | "confirm" | "running" | "finished";

function terminalRun(status: RecipeRun["status"]) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

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

function stepStatusLabel(status: string) {
  if (status === "succeeded") return "完成";
  if (status === "running") return "生成中";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  if (status === "interrupted") return "未执行";
  if (status === "ready") return "就绪";
  return "等待";
}

export function RecipeStudioDialog({
  projectId,
  conversationId,
  inputNodeId,
  inputAsset,
  inputAssetIndex,
  close,
  onCompleted,
}: {
  projectId: string;
  conversationId: string;
  inputNodeId: string;
  inputAsset: ImageAsset;
  inputAssetIndex: number;
  close: () => void;
  onCompleted: (result: RecipeRunResult, inputNodeId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [stage, setStage] = useState<Stage>("recipe");
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeListItem | null>(null);
  const [options, setOptions] = useState<RecipeStudioOptions>(() => initialStudioOptions());
  const [preparation, setPreparation] = useState<RecipePreparation | null>(null);
  const [runResult, setRunResult] = useState<RecipeRunResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [delivered, setDelivered] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const completionAttemptedRef = useRef(false);

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
        const nextRecipes = Array.isArray(listed.recipes) ? listed.recipes as RecipeListItem[] : [];
        if (!nextRecipes.length) throw new Error("当前项目没有可运行的内置 Recipe。");
        setRecipes(nextRecipes);
        setSelectedRecipe(nextRecipes[0]);
        setOptions(initialStudioOptions(nextRecipes[0].outputSlots));
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

  const handleTerminal = useCallback(async (result: RecipeRunResult) => {
    if (result.run.status !== "succeeded" || completionAttemptedRef.current) return;
    completionAttemptedRef.current = true;
    const completed = await onCompleted(result, inputNodeId);
    if (completed.ok) {
      setDelivered(true);
      setError("");
      return;
    }
    completionAttemptedRef.current = false;
    setError(completed.error || "六张图片已生成，但写回画布失败；可以重试。");
  }, [inputNodeId, onCompleted]);

  useEffect(() => {
    if (stage !== "running" || !preparation?.runId) return;
    let alive = true;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const bridge = window.naimageRecipe;
        if (!bridge) throw new Error("Recipe bridge unavailable.");
        const response = await bridge.get({ projectId, runId: preparation.runId });
        if (!alive) return;
        if (!response.ok || !response.run) throw new Error(response.error || "Recipe Run 状态读取失败。");
        const result = response as RecipeRunResult;
        setRunResult(result);
        if (terminalRun(result.run.status)) {
          setStage("finished");
          if (timer !== null) window.clearInterval(timer);
          await handleTerminal(result);
        }
      } catch (pollError) {
        if (alive) setError(pollError instanceof Error ? pollError.message : String(pollError));
      }
    };
    void poll();
    timer = window.setInterval(() => { void poll(); }, 1_200);
    return () => {
      alive = false;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [handleTerminal, preparation?.runId, projectId, stage]);

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
      setRunResult(null);
      setDelivered(false);
      setConfirmed(false);
      completionAttemptedRef.current = false;
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
      setRunResult(response as RecipeRunResult);
      setStage("running");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setBusy(false);
    }
  }

  async function cancelRun() {
    if (!preparation || cancelling) return;
    setCancelling(true);
    setError("");
    try {
      const response = await window.naimageRecipe?.cancel({ projectId, runId: preparation.runId });
      if (!response?.ok) throw new Error(response?.error || "取消运行失败。");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
    } finally {
      setCancelling(false);
    }
  }

  async function retryCanvasDelivery() {
    if (!runResult) return;
    setBusy(true);
    setError("");
    try {
      const completed = await onCompleted(runResult, inputNodeId);
      if (!completed.ok) throw new Error(completed.error || "写回画布失败。");
      setDelivered(true);
    } catch (deliveryError) {
      setError(deliveryError instanceof Error ? deliveryError.message : String(deliveryError));
    } finally {
      setBusy(false);
    }
  }

  const outputSlots = preparation?.recipe.outputContract.outputs ?? selectedRecipe?.outputSlots ?? [];
  const recipeNodes = preparation?.recipe.nodes ?? (selectedRecipe ? [
    { stepId: "step.input", type: "Input", title: "商品母图" },
    { stepId: "step.brief", type: "Brief", title: "运行设置" },
    { stepId: "step.hero", type: "Skill", title: "Beauty 商品主视觉" },
    ...selectedRecipe.outputSlots.map((slot) => ({
      stepId: `step.render-${slot.slotId}`,
      type: "Tool",
      title: slot.label,
    })),
    { stepId: "step.output", type: "Output", title: "六张套图" },
  ] : []);
  const toolSteps = runResult?.run.steps.filter((step) => step.stepId.startsWith("step.render-")) ?? [];
  const dialogBusy = busy || stage === "running";

  return (
    <DialogShell
      surface="recipe-studio"
      ariaLabel="Sparkvas Recipe Studio"
      layerClassName="recipe-studio-layer"
      className="recipe-studio-dialog"
      busy={dialogBusy}
      closePolicy={{
        escape: WHEN_IDLE,
        backdrop: WHEN_IDLE,
        [CLOSE_BUTTON_REASON]: WHEN_IDLE,
      }}
      onRequestClose={() => {
        if (stage !== "running") close();
      }}
      onCloseBlocked={() => setError("运行进行中；请先等待完成或取消。")}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title="Sparkvas Studio"
            description="Beauty product-hero · 固定十节点 Recipe"
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭 Sparkvas Studio"
            closeDisabled={stage === "running"}
          />
          <SurfaceBody className="recipe-studio-body">
            {loading ? (
              <div className="recipe-studio-loading" aria-busy="true">
                <Loader2 className="spin" size={20} />
                <span>读取内置 Recipe…</span>
              </div>
            ) : null}

            {!loading && stage === "recipe" && selectedRecipe ? (
              <section className="recipe-picker-step" aria-label="选择 Recipe">
                <div className="recipe-picker-heading">
                  <span className="recipe-kicker"><Sparkles size={14} /> 内置 Recipe</span>
                  <h2>{selectedRecipe.name}</h2>
                  <p>{selectedRecipe.description}</p>
                </div>
                <div className="recipe-summary-grid">
                  <div><span>输入</span><strong>{selectedRecipe.inputSlots[0]?.label || "商品母图"}</strong></div>
                  <div><span>输出</span><strong>{selectedRecipe.outputSlots.length} 张套图</strong></div>
                  <div><span>版本</span><strong>{selectedRecipe.version}</strong></div>
                  <div><span>Recipe Hash</span><strong title={selectedRecipe.contentHash}>{shortHash(selectedRecipe.contentHash)}</strong></div>
                </div>
                <div className="recipe-picker-preview">
                  <img src={imageAssetThumbnailSrc(inputAsset, 640)} alt={imageAssetName(inputAsset)} />
                  <div>
                    <span>当前商品图</span>
                    <strong>{inputAsset.title || imageAssetName(inputAsset)}</strong>
                    <code title={input.contentHash}>{shortHash(input.contentHash, 14)}</code>
                  </div>
                </div>
                {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
              </section>
            ) : null}

            {!loading && stage === "studio" && selectedRecipe ? (
              <section className="recipe-studio-workspace" aria-label="Studio 运行设置">
                <aside className="recipe-graph-preview" aria-label="固定流程预览">
                  <span className="recipe-kicker">固定语义流程</span>
                  <div className="recipe-graph-chain">
                    {recipeNodes.map((node) => (
                      <div className={`recipe-graph-node type-${node.type.toLowerCase()}`} key={node.stepId}>
                        <span>{node.type}</span>
                        <strong>{node.title}</strong>
                      </div>
                    ))}
                  </div>
                  <p>仅展示 Input、Brief、Skill、Tool、Output 等语义节点；不暴露 ComfyUI 算子、任意连线或节点市场。</p>
                </aside>
                <div className="recipe-studio-form">
                  <Field label="场景文案">
                    <textarea
                      aria-label="Recipe 场景文案"
                      value={options.sceneBrief}
                      maxLength={1200}
                      rows={4}
                      onChange={(event) => setOptions((current) => ({ ...current, sceneBrief: event.target.value }))}
                    />
                  </Field>
                  <div className="recipe-form-row">
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
                    <span className="recipe-section-label">六个输出槽</span>
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
                <div className="recipe-confirm-main">
                  <span className="recipe-kicker">运行检查</span>
                  <h2>确认输入、权限与六个输出</h2>
                  <div className="recipe-freeze-grid">
                    <div><span>Recipe</span><strong>{preparation.recipe.name}</strong><code>{preparation.recipe.id}</code></div>
                    <div><span>版本 / Hash</span><strong>{preparation.recipe.version}</strong><code title={preparation.recipe.contentHash}>{shortHash(preparation.recipe.contentHash, 16)}</code></div>
                    <div><span>输入</span><strong>{preparation.input.name}</strong><code>{preparation.input.assetId} · {shortHash(preparation.input.contentHash)}</code></div>
                    <div><span>Run</span><strong>{shortRunId(preparation.runId)}</strong><code>{preparation.runId}</code></div>
                  </div>
                  <div className="recipe-permission-box">
                    <span><ShieldCheck size={15} /> 权限快照</span>
                    {Object.entries(preparation.tool.permissions).map(([scope, values]) => (
                      <div key={scope}><code>{scope}</code><span>{values.join(" · ")}</span></div>
                    ))}
                  </div>
                </div>
                <aside className="recipe-output-preview">
                  <span className="recipe-section-label">预计输出</span>
                  {preparation.expectedOutputs.map((slot, index) => (
                    <div key={slot.slotId}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{slot.label}</strong>
                      <small>{preparation.options.ratio} · {preparation.options.resolution}</small>
                    </div>
                  ))}
                  <InlineNotice tone="warning">
                    本次运行会发起 {preparation.estimatedRequests} 次图片请求，实际费用以当前账户和模型供应商计费为准。
                  </InlineNotice>
                </aside>
                <label className="recipe-paid-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    aria-label="确认发起六次图片请求"
                  />
                  <span>我确认发起六次图片请求，并接受可能产生的费用。</span>
                </label>
                {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
              </section>
            ) : null}

            {!loading && (stage === "running" || stage === "finished") && preparation ? (
              <section className="recipe-run-progress" aria-label="Recipe Run 进度">
                <div className="recipe-run-heading">
                  <div>
                    <span className="recipe-kicker">Run {shortRunId(preparation.runId)}</span>
                    <h2>{delivered ? "六张套图已回到 Canvas" : stage === "running" ? "正在生成六张套图" : runStatusLabel(runResult?.run)}</h2>
                  </div>
                  <strong className={`recipe-run-state is-${runResult?.run.status || "running"}`}>
                    {runStatusLabel(runResult?.run)}
                  </strong>
                </div>
                <div className="recipe-run-slots">
                  {toolSteps.length ? toolSteps.map((step, index) => {
                    const node = preparation.recipe.nodes.find((item) => item.stepId === step.stepId);
                    return (
                      <div className={`recipe-run-slot is-${step.status}`} key={step.stepId}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{node?.title || step.stepId}</strong>
                        <small>{stepStatusLabel(step.status)}</small>
                      </div>
                    );
                  }) : preparation.expectedOutputs.map((slot, index) => (
                    <div className="recipe-run-slot is-pending" key={slot.slotId}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{slot.label}</strong>
                      <small>准备中</small>
                    </div>
                  ))}
                </div>
                <div className="recipe-run-provenance">
                  <ImageIcon size={15} />
                  <span>Recipe {shortHash(preparation.recipe.contentHash, 12)}</span>
                  <span>Run {preparation.runId}</span>
                  <span>Input {shortHash(input.contentHash, 12)}</span>
                </div>
                {runResult?.run.error?.message ? <InlineNotice tone="danger">{runResult.run.error.message}</InlineNotice> : null}
                {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
              </section>
            ) : null}
          </SurfaceBody>
          <SurfaceFooter className="recipe-studio-footer">
            {stage === "recipe" ? (
              <>
                <ActionButton onClick={() => requestClose(CLOSE_BUTTON_REASON)}>取消</ActionButton>
                <ActionButton
                  variant="primary"
                  icon={<Sparkles size={15} />}
                  disabled={!selectedRecipe || !input.contentHash}
                  onClick={() => setStage("studio")}
                >
                  在 Studio 中配置
                </ActionButton>
              </>
            ) : null}
            {stage === "studio" ? (
              <>
                <ActionButton icon={<ArrowLeft size={15} />} onClick={() => setStage("recipe")}>返回 Recipe</ActionButton>
                <ActionButton variant="primary" busy={busy} icon={<Check size={15} />} onClick={() => void prepareRun()}>
                  检查运行计划
                </ActionButton>
              </>
            ) : null}
            {stage === "confirm" ? (
              <>
                <ActionButton icon={<ArrowLeft size={15} />} onClick={() => setStage("studio")}>返回设置</ActionButton>
                <ActionButton
                  variant="primary"
                  busy={busy}
                  disabled={!confirmed}
                  icon={<Play size={15} />}
                  onClick={() => void startRun()}
                >
                  确认并运行六张
                </ActionButton>
              </>
            ) : null}
            {stage === "running" ? (
              <ActionButton variant="secondary" busy={cancelling} onClick={() => void cancelRun()}>
                取消运行
              </ActionButton>
            ) : null}
            {stage === "finished" ? (
              <>
                {runResult?.run.status === "succeeded" && !delivered ? (
                  <ActionButton busy={busy} onClick={() => void retryCanvasDelivery()}>重试写回画布</ActionButton>
                ) : null}
                {runResult?.run.status === "failed" || runResult?.run.status === "cancelled" ? (
                  <ActionButton
                    onClick={() => {
                      setStage("studio");
                      setPreparation(null);
                      setRunResult(null);
                      setError("");
                      setConfirmed(false);
                    }}
                  >
                    重新配置
                  </ActionButton>
                ) : null}
                <ActionButton variant="primary" onClick={() => requestClose(CLOSE_BUTTON_REASON)}>
                  {delivered ? "查看 Canvas" : "关闭"}
                </ActionButton>
              </>
            ) : null}
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
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
        escape: WHEN_IDLE,
        backdrop: WHEN_IDLE,
        [CLOSE_BUTTON_REASON]: WHEN_IDLE,
      }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title="Recipe Run Provenance"
            description={runId}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭 Recipe Run provenance"
          />
          <SurfaceBody className="recipe-provenance-body" data-sparkvas-provenance={runId}>
            {loading ? <div className="recipe-studio-loading"><Loader2 className="spin" size={20} /><span>读取 Run…</span></div> : null}
            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
            {result ? (
              <>
                <div className="recipe-freeze-grid">
                  <div><span>Recipe</span><strong>{result.recipe.name}</strong><code>{result.recipe.id}</code></div>
                  <div><span>Recipe Hash</span><strong>{result.recipe.version}</strong><code title={result.recipe.contentHash}>{shortHash(result.recipe.contentHash, 18)}</code></div>
                  <div><span>Run</span><strong>{runStatusLabel(result.run)}</strong><code>{result.run.runId}</code></div>
                  <div><span>Scope Hash</span><strong>{shortHash(result.run.scopeHash, 18)}</strong><code title={result.run.idempotencyKey}>idempotency {shortHash(result.run.idempotencyKey, 12)}</code></div>
                </div>
                <div className="recipe-provenance-columns">
                  <section>
                    <h3>输入</h3>
                    {result.run.inputAssetIdentity.map((asset) => (
                      <div className="recipe-provenance-asset" key={asset.slotId}>
                        <strong>{asset.slotId} · {asset.assetId}</strong>
                        <span>{asset.occurrenceId}</span>
                        <code title={asset.contentHash}>{shortHash(asset.contentHash, 18)}</code>
                      </div>
                    ))}
                    <h3>权限</h3>
                    {result.run.permissionSnapshot.tools.map((tool) => (
                      <div className="recipe-provenance-permission" key={tool.toolId}>
                        <strong>{tool.toolId}</strong>
                        {Object.entries(tool.permissions).map(([scope, values]) => (
                          <span key={scope}>{scope}: {values.join(", ")}</span>
                        ))}
                      </div>
                    ))}
                  </section>
                  <section>
                    <h3>输出</h3>
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
