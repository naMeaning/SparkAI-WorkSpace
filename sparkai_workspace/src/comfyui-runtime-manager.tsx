import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentLocalRuntime, AgentProviderControlRequest, ComfyUiRuntimeJob, ComfyUiRuntimeManifest, ComfyUiRuntimePlan, ServerBridge } from "./core";
import { ActionButton, Field, InlineNotice } from "./ui";

type ControlRequest = Parameters<ServerBridge["comfyui"]>[0];
const runningJobs = new Set<ComfyUiRuntimeJob["state"]>(["authorized", "downloading", "installing", "validating"]);
const jobLabels: Record<ComfyUiRuntimeJob["state"], string> = { authorized: "已授权", downloading: "正在下载", paused: "已暂停", installing: "正在安装", validating: "正在验证", completed: "已完成", failed: "失败" };
const runtimeLabels: Record<AgentLocalRuntime["state"], string> = { ready: "可启动", running: "运行中", stopped: "已停止", failed: "不可用", removed: "已移除", orphaned: "原进程归属待确认" };
const manifestLabel = (manifest: ComfyUiRuntimeManifest) => manifest.reviewStatus === "needs-review" ? "待审核 · 不可安装" : manifest.trust === "reviewed-registry" ? "审核清单" : manifest.trust === "user-import" ? "手动导入" : "未审核";
function byteLabel(bytes: number) {
  const size = Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : 0;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = size ? Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024))) : 0;
  return `${size.toLocaleString()} B${unit ? `（${(size / 1024 ** unit).toFixed(2)} ${units[unit]}）` : ""}`;
}

export default function ComfyUiRuntimeManager({ onConnectionsChanged, platform = "comfyui" }: { onConnectionsChanged: () => void; platform?: "comfyui" | "agent" }) {
  const isAgent = platform === "agent";
  const title = isAgent ? "本地 Agent" : "ComfyUI";
  const control = useCallback(async (payload: ControlRequest) => {
    if (!isAgent) return window.naimageServer?.comfyui(payload);
    const action = payload.action === "manifest-import" ? "local-manifest-import" : `local-${payload.action}`;
    return window.naimageAgent?.providerControl({ ...payload, action } as AgentProviderControlRequest);
  }, [isAgent]);
  const [manifests, setManifests] = useState<ComfyUiRuntimeManifest[]>([]);
  const [runtimes, setRuntimes] = useState<AgentLocalRuntime[]>([]);
  const [jobs, setJobs] = useState<ComfyUiRuntimeJob[]>([]);
  const [manifestId, setManifestId] = useState("");
  const [runtimeId, setRuntimeId] = useState("");
  const [plan, setPlan] = useState<ComfyUiRuntimePlan | null>(null);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const mounted = useRef(false);
  const operation = useRef(0);
  const listRevision = useRef(0);
  const listing = useRef(false);
  const connectionRevision = useRef("");
  const selectedManifest = manifests.find(item => item.manifestId === manifestId);
  const selectedRuntime = runtimes.find(item => item.runtimeId === runtimeId && item.state !== "removed");
  const activeRevision = selectedRuntime?.revisions.find(item => item.revisionId === selectedRuntime.activeRevisionId);
  const previousRevisions = selectedRuntime?.revisions.filter(item => item.state === "ready" && item.revisionId !== selectedRuntime.activeRevisionId) || [];

  const refresh = useCallback(async () => {
    const revision = ++listRevision.current;
    listing.current = true;
    try {
      const result = await control({ action: "runtime-list" });
      if (!mounted.current || revision !== listRevision.current) return;
      if (!result?.ok) throw new Error(result?.error || "读取本机运行环境失败。");
      setManifests(result.manifests || []); setRuntimes(result.runtimes || []); setJobs(result.jobs || []);
      setManifestId(current => current || result.manifests?.[0]?.manifestId || "");
      const nextConnections = (result.runtimes || []).map(runtime => `${runtime.runtimeId}:${runtime.connectionId}:${runtime.state}`).sort().join("|");
      if (connectionRevision.current !== nextConnections) { connectionRevision.current = nextConnections; onConnectionsChanged(); }
    } finally { if (revision === listRevision.current) listing.current = false; }
  }, [onConnectionsChanged, control]);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(error => { if (mounted.current) setStatus(error instanceof Error ? error.message : String(error)); });
    return () => { mounted.current = false; operation.current += 1; listRevision.current += 1; };
  }, [refresh]);
  const hasRunningJob = jobs.some(job => runningJobs.has(job.state));
  useEffect(() => {
    if (!hasRunningJob) return;
    const timer = window.setInterval(() => {
      if (listing.current) return;
      void refresh().catch(error => { if (mounted.current) setStatus(error instanceof Error ? error.message : String(error)); });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasRunningJob, refresh]);

  async function run(payload: ControlRequest, message: string) {
    if (busy) return;
    const revision = ++operation.current;
    setBusy(payload.action); setStatus("");
    try {
      const result = await control(payload);
      if (!mounted.current || operation.current !== revision) return;
      if (!result?.ok) throw new Error(result?.error || "运行环境操作未完成。");
      if (result.canceled) { setStatus("已取消，未新增下载或启动操作。"); return; }
      if (payload.action === "runtime-plan") {
        if (!result.plan) throw new Error("安装计划暂不可用，请重新生成计划。");
        setPlan(result.plan);
      }
      if (result.manifest) { setManifestId(result.manifest.manifestId); setPlan(null); }
      if (result.runtime && payload.action === "runtime-existing-import") { setRuntimeId(result.runtime.runtimeId); setPlan(null); }
      if (payload.action === "runtime-remove") { setRuntimeId(""); setPlan(null); }
      await refresh();
      if (mounted.current && operation.current === revision) setStatus(message);
    } catch (error) { if (mounted.current && operation.current === revision) setStatus(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current && operation.current === revision) setBusy(""); }
  }
  const locked = Boolean(busy);
  const orphaned = selectedRuntime?.state === "orphaned";
  const canPlan = !orphaned && selectedManifest?.installable === true && selectedManifest.reviewStatus !== "needs-review" && (!runtimeId || Boolean(selectedRuntime)) && (!selectedManifest.modelOnly || Boolean(selectedRuntime)) && (selectedManifest.modelOnly || selectedRuntime?.mode !== "existing");
  const planMatches = plan?.manifestId === manifestId && (!runtimeId || plan.runtimeId === runtimeId);
  const act = (request: ControlRequest, message: string) => void run(request, message);
  function runtimeAction(action: "runtime-start" | "runtime-stop" | "runtime-rollback" | "runtime-remove", message: string) {
    if (selectedRuntime) act({ action, runtimeId: selectedRuntime.runtimeId, ...(action === "runtime-rollback" && isAgent ? { revisionId: previousRevisions[0]?.revisionId } : {}) }, message);
  }

  return <section data-comfyui-runtime-manager data-managed-platform={platform} aria-label={`${title} 本机运行环境和模型`}>
    <InlineNotice>{isAgent ? "托管 llama.cpp 与模型使用独立目录，并复用审核清单、校验、暂停与回滚。启动后请导入引用该环境的 Agent 配置并明确选择。" : "托管环境将 Python 和审核依赖装入独立目录。已有环境只登记并验证。"}打开或刷新此面板不会下载或启动服务。</InlineNotice>
    <div className="manual-image-task-controls" data-comfyui-runtime-actions>
      <ActionButton disabled={locked} onClick={() => act({ action: "runtime-list" }, "本地状态已刷新。")}>刷新状态</ActionButton>
      <ActionButton busy={busy === "manifest-import"} disabled={locked} onClick={() => act({ action: "manifest-import" }, "安装清单已导入，请生成计划并审核。")}>导入安装清单</ActionButton>
      {!isAgent ? <ActionButton busy={busy === "runtime-existing-import"} disabled={locked} onClick={() => act({ action: "runtime-existing-import" }, "已有环境已登记，尚未启动。")}>登记已有环境</ActionButton> : null}
    </div>
    <Field label="安装清单"><select aria-label={`${title} 安装清单`} disabled={locked} value={manifestId} onChange={event => { setManifestId(event.target.value); setPlan(null); }}>
      {!selectedManifest ? <option value={manifestId}>{manifestId ? "原清单不可用 · 请重新选择" : "请导入审核安装清单"}</option> : null}
      {manifests.map(manifest => <option key={manifest.manifestId} value={manifest.manifestId}>{manifest.label} · {manifest.version} · {manifestLabel(manifest)}</option>)}
    </select></Field>
    {selectedManifest ? <p data-comfyui-manifest-review={selectedManifest.reviewStatus || "unknown"}>{manifestLabel(selectedManifest)} · {selectedManifest.artifactCount || 0} 项文件{selectedManifest.modelOnly ? " · 仅模型包" : ""}{selectedManifest.reviewStatus === "needs-review" ? "。完整依赖、许可证和展开体积尚未审核，当前不能安装。" : ""}</p> : null}
    <Field label={selectedManifest?.modelOnly ? "模型安装到" : "安装目标"}><select aria-label={`${title} 运行环境目标`} disabled={locked} value={runtimeId} onChange={event => { setRuntimeId(event.target.value); setPlan(null); }}>
      <option value="">{selectedManifest?.modelOnly ? "请选择已登记的环境" : "新建独立托管环境"}</option>
      {runtimeId && !selectedRuntime ? <option value={runtimeId}>原环境不可用 · 请重新选择</option> : null}
      {runtimes.filter(runtime => runtime.state !== "removed").map(runtime => <option key={runtime.runtimeId} value={runtime.runtimeId}>{runtime.label} · {runtime.mode === "managed" ? "托管" : "已有"} · {runtimeLabels[runtime.state]}</option>)}
    </select></Field>
    {selectedRuntime?.mode === "existing" && selectedManifest && !selectedManifest.modelOnly ? <InlineNotice>已有 Python 环境不能被安装包覆盖。请选择“新建独立托管环境”，或给已有环境选择仅模型包。</InlineNotice> : null}
    <ActionButton busy={busy === "runtime-plan"} disabled={locked || !canPlan} onClick={() => act({ action: "runtime-plan", manifestId, ...(runtimeId ? { runtimeId } : {}) }, "安装计划已生成，尚未下载。")}>生成安装计划</ActionButton>
    {plan && planMatches ? <section data-comfyui-runtime-plan data-plan-id={plan.planId}>
      <strong>{plan.label} · {plan.version}</strong>
      <p>下载：{byteLabel(plan.downloadBytes)} · 展开：{byteLabel(plan.expandedBytes)}</p>
      <p>所需磁盘：{byteLabel(plan.requiredDiskBytes)} · 可用磁盘：{byteLabel(plan.availableDiskBytes)}</p>
      <p>系统：{plan.requirements.os.join(" / ") || "未声明"} · 架构：{plan.requirements.arch.join(" / ") || "未声明"} · GPU：{plan.requirements.gpu.join(" / ") || "未声明"} · 显存：{byteLabel(plan.requirements.vramBytes)}</p>
      <div data-comfyui-runtime-artifacts>{plan.artifacts.map(artifact => <section key={artifact.artifactId} data-artifact-id={artifact.artifactId}>
        <p><strong>{artifact.label}</strong> · {artifact.kind} · 来源：{artifact.sourceLabel} · 许可证：{artifact.license.id}</p>
        <p>下载 {byteLabel(artifact.bytes)} · 展开 {byteLabel(artifact.expandedBytes)} · 依赖：{artifact.dependencies.map(id => plan.artifacts.find(item => item.artifactId === id)?.label || id).join("、") || "无"}</p>
      </section>)}</div>
      <InlineNotice tone="warning">下载需要联网。下一步系统确认会显示完整来源、许可和依赖；只有你在系统窗口允许后才会下载并安装。工作流不能自行安装软件。</InlineNotice>
      {!plan.canInstall ? <InlineNotice tone="warning">当前计划不满足安装条件，请检查审核状态、系统和可用磁盘。</InlineNotice> : null}
      <ActionButton variant="primary" busy={busy === "runtime-install"} disabled={locked || !plan.canInstall} onClick={() => act({ action: "runtime-install", planId: plan.planId }, "安装任务已受理，进度将在下方更新。")}>审核并安装</ActionButton>
    </section> : null}
    {selectedRuntime ? <section data-comfyui-runtime-selected data-runtime-id={selectedRuntime.runtimeId}>
      <p><strong>{selectedRuntime.label}</strong> · {selectedRuntime.mode === "managed" ? "独立托管环境" : "已有环境"} · {runtimeLabels[selectedRuntime.state]}{activeRevision ? ` · ${activeRevision.version}` : ""}</p>
      {orphaned ? <InlineNotice tone="warning">应用重启后无法确认原服务进程的归属。请先在系统中确认并正常关闭原进程，再重新打开应用；当前不能接管、修改或移除此环境。</InlineNotice> : null}
      <div className="manual-image-task-controls">
        <ActionButton disabled={locked || orphaned || selectedRuntime.state === "running" || selectedRuntime.state === "failed"} onClick={() => runtimeAction("runtime-start", isAgent ? "环境已启动。请导入引用该环境的 Agent 配置并明确应用。" : "运行环境已启动，可在执行连接中选择本机环境。")}>启动环境</ActionButton>
        <ActionButton disabled={locked || selectedRuntime.state !== "running"} onClick={() => runtimeAction("runtime-stop", "运行环境已停止。")}>停止环境</ActionButton>
        <ActionButton disabled={locked || orphaned || !previousRevisions.length || selectedRuntime.state === "running"} onClick={() => runtimeAction("runtime-rollback", "已回滚到上一验证版本。")}>回滚上一版本</ActionButton>
        <ActionButton variant="danger" disabled={locked || orphaned || selectedRuntime.state === "running"} onClick={() => runtimeAction("runtime-remove", "环境登记已移除，项目素材与已有环境文件保留。")}>移除环境</ActionButton>
      </div>
    </section> : null}
    {jobs.length ? <section data-comfyui-runtime-jobs aria-label="安装任务">{[...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(job => <section key={job.jobId} data-job-id={job.jobId} data-job-state={job.state}>
      <p>{manifests.find(manifest => manifest.manifestId === job.manifestId)?.label || "安装任务"} · {jobLabels[job.state]} · {byteLabel(job.downloadedBytes)} / {byteLabel(job.totalBytes)}{job.errorCode ? ` · ${job.errorCode}` : ""}</p>
      <progress max={Math.max(1, job.totalBytes)} value={Math.min(job.totalBytes, job.downloadedBytes)} aria-label={`${title} 下载进度`} />
      {["authorized", "downloading"].includes(job.state) ? <ActionButton disabled={locked} onClick={() => act({ action: "runtime-pause", jobId: job.jobId }, "下载已暂停，已验证文件保留。")}>暂停下载</ActionButton> : null}
      {job.state === "paused" ? <ActionButton disabled={locked} onClick={() => act({ action: "runtime-resume", jobId: job.jobId }, "正在按原授权恢复安装任务。")}>继续安装</ActionButton> : null}
    </section>)}</section> : null}
    {status ? <InlineNotice data-comfyui-runtime-status role="status">{status}</InlineNotice> : null}
  </section>;
}
