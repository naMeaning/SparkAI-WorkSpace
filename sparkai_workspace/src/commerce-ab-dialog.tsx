import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Columns2, ImageIcon, Loader2, RefreshCw } from "lucide-react";
import type { CommerceCatalogComparisonCandidate, CommerceCatalogComparisonGroup } from "./commerce-catalog.ts";
import { ActionButton, ButtonBase, DialogShell, InlineNotice, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";
import "./styles/04f-commerce-ab-dialog.css";

export type CommerceAbCanvasAsset = {
  nodeId: string;
  assetIndex: number;
  assetId?: string;
  contentHash?: string;
  previewUrl?: string;
};

export type CommerceAbDialogProps = {
  projectId: string;
  canvasAssets: CommerceAbCanvasAsset[];
  close: () => void;
};

const stateLabels = { candidate: "候选", approved: "已选定", rejected: "未选" } as const;

function slotLabel(group: CommerceCatalogComparisonGroup) {
  const raw = group.slotId.startsWith("role:") ? group.role : group.slotId;
  return raw.replace(/^(?:amazon|aliexpress)-/, "").replace(/[-_]+/g, " ");
}

function shortHash(value?: string) {
  const text = String(value || "");
  return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text;
}

export default function CommerceAbDialog({ projectId, canvasAssets, close }: CommerceAbDialogProps) {
  const [groups, setGroups] = useState<CommerceCatalogComparisonGroup[]>([]);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [activeGroupKey, setActiveGroupKey] = useState("");
  const [selectedLinkId, setSelectedLinkId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const previewByIdentity = useMemo(() => {
    const map = new Map<string, string>();
    canvasAssets.forEach((asset) => {
      if (!asset.previewUrl) return;
      if (asset.assetId) map.set(`asset:${asset.assetId}`, asset.previewUrl);
      if (asset.contentHash) map.set(`hash:${asset.contentHash}`, asset.previewUrl);
      map.set(`node:${asset.nodeId}:${asset.assetIndex}`, asset.previewUrl);
    });
    return map;
  }, [canvasAssets]);

  const previewFor = useCallback((candidate: CommerceCatalogComparisonCandidate) => (
    previewByIdentity.get(`asset:${candidate.assetId}`)
    || previewByIdentity.get(`hash:${candidate.contentHash}`)
    || previewByIdentity.get(`node:${candidate.nodeId || ""}:${candidate.assetIndex ?? 0}`)
    || ""
  ), [previewByIdentity]);

  const load = useCallback(async () => {
    const bridge = window.naimageConfig;
    if (!bridge?.listCommerceCatalogComparisons) {
      setError("当前桌面运行时未提供 A/B 方案比较，请重启应用后再试。");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await bridge.listCommerceCatalogComparisons({ expectedProjectId: projectId });
      if (!result?.ok) throw new Error(result?.error || "读取 A/B 比较组失败。");
      const nextGroups = result.groups ?? [];
      setGroups(nextGroups);
      setCatalogRevision(Number(result.catalogRevision) || 0);
      setActiveGroupKey((current) => nextGroups.some((group) => group.groupKey === current) ? current : nextGroups[0]?.groupKey || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    return window.naimageConfig?.onCommerceCatalogChanged?.((payload) => {
      if (!payload?.projectId || payload.projectId === projectId) void load();
    });
  }, [load, projectId]);

  const activeGroup = groups.find((group) => group.groupKey === activeGroupKey) || null;

  useEffect(() => {
    if (!activeGroup) {
      setSelectedLinkId("");
      return;
    }
    setSelectedLinkId((current) => activeGroup.candidates.some((candidate) => candidate.linkId === current)
      ? current
      : activeGroup.approvedLinkIds[0] || activeGroup.candidates[0]?.linkId || "");
  }, [activeGroup]);

  async function selectWinner() {
    if (!activeGroup || !selectedLinkId) return;
    const bridge = window.naimageConfig;
    if (!bridge?.selectCommerceCatalogComparisonWinner) return setError("当前桌面运行时未提供 A/B 终选能力。");
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await bridge.selectCommerceCatalogComparisonWinner({
        expectedProjectId: projectId,
        expectedCatalogRevision: catalogRevision,
        productId: activeGroup.productId,
        expectedProductRevision: activeGroup.productRevision,
        groupKey: activeGroup.groupKey,
        winnerLinkId: selectedLinkId
      });
      if (!result?.ok) throw new Error(result?.error || "选定最终成果失败。");
      setNotice(result.changed ? "最终成果已选定，同组其他方案已标记为未选。" : "当前方案已经是最终成果。");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell surface="commerce-ab" ariaLabel="A/B 方案比较" className="commerce-ab-dialog" onRequestClose={close}>
      {({ requestClose }) => (
        <>
          <SurfaceHeader title="A/B 方案比较" description="同一商品槽位的生成版本" onClose={() => requestClose("close-button")}>
            <ButtonBase className="commerce-ab-refresh" aria-label="刷新 A/B 比较" title="刷新" disabled={loading || saving} onClick={() => void load()}>
              {loading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
            </ButtonBase>
          </SurfaceHeader>
          <SurfaceBody className="commerce-ab-body">
            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
            {notice ? <InlineNotice tone="info">{notice}</InlineNotice> : null}
            {loading && !groups.length ? (
              <div className="commerce-ab-loading"><Loader2 className="spin" size={18} /><span>正在读取比较组</span></div>
            ) : groups.length ? (
              <div className="commerce-ab-layout">
                <nav className="commerce-ab-groups" aria-label="A/B 比较组">
                  {groups.map((group) => (
                    <ButtonBase
                      key={group.groupKey}
                      className={group.groupKey === activeGroupKey ? "active" : ""}
                      aria-pressed={group.groupKey === activeGroupKey}
                      onClick={() => setActiveGroupKey(group.groupKey)}
                    >
                      <Columns2 size={15} aria-hidden="true" />
                      <span><strong>{group.productTitle}</strong><small>{group.ownerLabel}</small></span>
                      <em>{slotLabel(group)} · {group.localeCode}</em>
                      <b>{group.candidates.length}</b>
                    </ButtonBase>
                  ))}
                </nav>
                {activeGroup ? (
                  <section className="commerce-ab-stage" aria-label={`${activeGroup.productTitle} ${slotLabel(activeGroup)} 比较`}>
                    <header className="commerce-ab-stage-header">
                      <div>
                        <strong>{activeGroup.productTitle} · {slotLabel(activeGroup)}</strong>
                        <span>{activeGroup.ownerLabel} · {activeGroup.localeCode} · 来源 {activeGroup.sourceLabel}</span>
                      </div>
                      <small>{activeGroup.candidates.length} 个方案</small>
                    </header>
                    <div className="commerce-ab-candidates">
                      {activeGroup.candidates.map((candidate, index) => {
                        const selected = candidate.linkId === selectedLinkId;
                        const previewUrl = previewFor(candidate);
                        return (
                          <article className={`commerce-ab-candidate ${selected ? "is-selected" : ""}`} key={candidate.linkId} data-state={candidate.state}>
                            <button type="button" aria-pressed={selected} onClick={() => setSelectedLinkId(candidate.linkId)}>
                              <span className="commerce-ab-image">
                                {previewUrl ? <img src={previewUrl} alt={`方案 ${index + 1}`} draggable={false} /> : <ImageIcon size={24} />}
                                <em>{selected ? <Check size={14} /> : index + 1}</em>
                              </span>
                              <span className="commerce-ab-candidate-copy">
                                <strong>方案 {index + 1}<small data-state={candidate.state}>{stateLabels[candidate.state]}</small></strong>
                                <span title={candidate.fileName}>{candidate.fileName}</span>
                                <span>{candidate.width && candidate.height ? `${candidate.width} × ${candidate.height}` : "尺寸待读取"} · {new Date(candidate.createdAt).toLocaleString("zh-CN")}</span>
                                {candidate.commercePlanHash ? <code title={candidate.commercePlanHash}>{shortHash(candidate.commercePlanHash)}</code> : null}
                              </span>
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="commerce-ab-empty"><Columns2 size={24} /><strong>暂无可比较方案</strong><span>同一商品槽位至少保留两个不同生成结果后会自动出现。</span></div>
            )}
          </SurfaceBody>
          <SurfaceFooter>
            <span className="commerce-ab-footer-note">{groups.length} 个比较组</span>
            <ActionButton variant="ghost" onClick={() => requestClose("action")}>关闭</ActionButton>
            <ActionButton
              variant="primary"
              busy={saving}
              disabled={!activeGroup || !selectedLinkId || loading}
              icon={<Check size={15} />}
              onClick={() => void selectWinner()}
            >
              设为最终成果
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
