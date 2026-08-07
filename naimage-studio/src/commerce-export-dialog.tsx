import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCheck2,
  FolderCheck,
  ImageIcon,
  PackageCheck,
  RefreshCw
} from "lucide-react";

import type { CommerceCatalogDocument, CommerceCatalogProduct, CommerceCatalogSku, CommercePlatformId } from "./commerce-catalog";
import type {
  CommerceExportFormat,
  CommerceExportPreviewResult,
  CommerceExportRequest
} from "./commerce-export";
import { COMMERCE_EXPORT_PROFILES } from "./commerce-export";
import {
  ActionButton,
  ButtonBase,
  DialogShell,
  Field,
  InlineNotice,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader
} from "./ui";
import "./styles/04d-commerce-export-dialog.css";

export type CommerceExportDialogProps = {
  projectId: string;
  close: () => void;
};

const emptyCatalog = (): CommerceCatalogDocument => ({
  schemaVersion: 1,
  catalogId: "",
  revision: 0,
  createdAt: "",
  updatedAt: "",
  products: []
});

function skuSupportsPlatform(product: CommerceCatalogProduct, sku: CommerceCatalogSku, platform: CommercePlatformId) {
  if (sku.platforms.length) return sku.platforms.includes(platform);
  if (product.platforms.length) return product.platforms.includes(platform);
  return true;
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    main: "主图",
    listing: "商品图",
    "selling-point": "卖点图",
    scene: "场景图",
    size: "尺寸图"
  };
  return labels[role] || role;
}

function formatLabel(format: CommerceExportFormat) {
  return format === "jpeg" ? "JPEG" : "PNG";
}

export default function CommerceExportDialog({ projectId, close }: CommerceExportDialogProps) {
  const [catalog, setCatalog] = useState<CommerceCatalogDocument>(emptyCatalog);
  const [platform, setPlatform] = useState<CommercePlatformId>("amazon");
  const [format, setFormat] = useState<CommerceExportFormat>("jpeg");
  const [includeCandidates, setIncludeCandidates] = useState(false);
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<CommerceExportPreviewResult | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [successPath, setSuccessPath] = useState("");
  const [externalRevision, setExternalRevision] = useState<number | null>(null);
  const busy = loading || checking || exporting;

  const activeProducts = useMemo(() => catalog.products.filter((product) => product.status === "active"), [catalog]);
  const platformProducts = useMemo(() => activeProducts.map((product) => ({
    product,
    skus: product.skus.filter((sku) => skuSupportsPlatform(product, sku, platform))
  })).filter((item) => item.skus.length), [activeProducts, platform]);
  const eligibleSkuIds = useMemo(() => platformProducts.flatMap((item) => item.skus.map((sku) => sku.skuId)), [platformProducts]);
  const selectedIds = useMemo(() => [...selectedSkuIds].filter((id) => eligibleSkuIds.includes(id)).sort(), [eligibleSkuIds, selectedSkuIds]);
  const requestKey = `${catalog.revision}:${platform}:${format}:${includeCandidates ? 1 : 0}:${selectedIds.join(",")}`;
  const previewCurrent = Boolean(preview?.ok && previewKey === requestKey && externalRevision === null);

  const resetPreview = useCallback(() => {
    setPreview(null);
    setPreviewKey("");
    setSuccessPath("");
  }, []);

  const loadCatalog = useCallback(async () => {
    const bridge = window.naimageConfig?.listCommerceCatalog;
    if (!bridge) {
      setNotice("SKU 商品素材库当前不可用。");
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      const result = await bridge({ expectedProjectId: projectId });
      if (!result?.ok || !result.catalog) throw new Error(result?.error || "SKU 商品素材库读取失败。");
      const next = result.catalog;
      const nextIds = next.products
        .filter((product) => product.status === "active")
        .flatMap((product) => product.skus.filter((sku) => skuSupportsPlatform(product, sku, platform)).map((sku) => sku.skuId));
      setCatalog(next);
      setSelectedSkuIds(new Set(nextIds));
      setExternalRevision(null);
      resetPreview();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [platform, projectId, resetPreview]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => window.naimageConfig?.onCommerceCatalogChanged?.((payload) => {
    if (payload.projectId !== projectId || payload.catalogRevision === catalog.revision) return;
    setExternalRevision(payload.catalogRevision);
    resetPreview();
  }), [catalog.revision, projectId, resetPreview]);

  function changePlatform(nextPlatform: CommercePlatformId) {
    const profile = COMMERCE_EXPORT_PROFILES.find((item) => item.id === nextPlatform);
    const nextIds = activeProducts.flatMap((product) => product.skus
      .filter((sku) => skuSupportsPlatform(product, sku, nextPlatform))
      .map((sku) => sku.skuId));
    setPlatform(nextPlatform);
    setFormat(profile?.defaultFormat ?? "jpeg");
    setSelectedSkuIds(new Set(nextIds));
    resetPreview();
  }

  function toggleProduct(product: CommerceCatalogProduct, skus: CommerceCatalogSku[]) {
    const productSkuIds = skus.map((sku) => sku.skuId);
    const allSelected = productSkuIds.every((id) => selectedSkuIds.has(id));
    setSelectedSkuIds((current) => {
      const next = new Set(current);
      for (const id of productSkuIds) allSelected ? next.delete(id) : next.add(id);
      return next;
    });
    resetPreview();
  }

  function toggleSku(skuId: string) {
    setSelectedSkuIds((current) => {
      const next = new Set(current);
      next.has(skuId) ? next.delete(skuId) : next.add(skuId);
      return next;
    });
    resetPreview();
  }

  function currentRequest(): CommerceExportRequest {
    return {
      expectedProjectId: projectId,
      expectedCatalogRevision: catalog.revision,
      platform,
      format,
      includeCandidates,
      skuIds: selectedIds
    };
  }

  async function runPreview() {
    if (!selectedIds.length) {
      setNotice("请至少选择一个 SKU。");
      return;
    }
    const bridge = window.naimageConfig?.previewCommerceExport;
    if (!bridge) {
      setNotice("平台导出预检当前不可用。");
      return;
    }
    setChecking(true);
    setNotice("");
    setSuccessPath("");
    try {
      const key = requestKey;
      const result = await bridge(currentRequest());
      if (!result?.ok) throw new Error(result?.error || "平台导出预检失败。");
      setPreview(result);
      setPreviewKey(key);
    } catch (error) {
      setPreview(null);
      setPreviewKey("");
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }

  async function exportPackages() {
    if (!previewCurrent || !preview?.summary?.validImages) return;
    const bridge = window.naimageConfig?.exportCommercePackage;
    if (!bridge) {
      setNotice("平台打包导出当前不可用。");
      return;
    }
    setExporting(true);
    setNotice("");
    setSuccessPath("");
    try {
      const result = await bridge({ ...currentRequest(), confirmed: true });
      if (result?.canceled) return;
      if (!result?.ok) throw new Error(result?.error || "平台打包导出失败。");
      setSuccessPath(result.path || result.folderName || "导出完成");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  const summary = previewCurrent ? preview?.summary : undefined;
  const issues = previewCurrent ? preview?.issues ?? [] : [];
  const canExport = Boolean(summary?.validImages && !summary.blockingIssues && !busy && externalRevision === null);

  return (
    <DialogShell
      surface="commerce-export"
      ariaLabel="平台导出中心"
      className="commerce-export-dialog"
      busy={busy}
      closePolicy={{ escape: "when-idle", backdrop: "when-idle", "close-button": "when-idle" }}
      onCloseBlocked={() => setNotice("当前检查或导出尚未完成。")}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title="平台导出中心"
            description="Amazon / 速卖通 · SKU 包与平台检查"
            onClose={() => requestClose("close-button")}
            closeDisabled={busy}
          />
          <SurfaceBody className="commerce-export-body">
            <aside className="commerce-export-selection">
              <div className="commerce-export-controls">
                <Field label="平台">
                  <select value={platform} onChange={(event) => changePlatform(event.target.value as CommercePlatformId)} disabled={busy}>
                    {COMMERCE_EXPORT_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                  </select>
                </Field>
                <Field label="图片格式">
                  <select value={format} onChange={(event) => { setFormat(event.target.value as CommerceExportFormat); resetPreview(); }} disabled={busy}>
                    {(COMMERCE_EXPORT_PROFILES.find((item) => item.id === platform)?.allowedFormats ?? []).map((value) => (
                      <option key={value} value={value}>{formatLabel(value)}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="commerce-export-candidate-toggle">
                <input
                  type="checkbox"
                  checked={includeCandidates}
                  disabled={busy}
                  onChange={(event) => { setIncludeCandidates(event.target.checked); resetPreview(); }}
                />
                <span>包含候选结果</span>
              </label>
              <header className="commerce-export-selection-header">
                <strong>商品与 SKU</strong>
                <small>{selectedIds.length}/{eligibleSkuIds.length}</small>
              </header>
              <div className="commerce-export-product-list">
                {platformProducts.map(({ product, skus }) => {
                  const selectedCount = skus.filter((sku) => selectedSkuIds.has(sku.skuId)).length;
                  return (
                    <section key={product.productId} className="commerce-export-product">
                      <label className="commerce-export-product-row">
                        <input
                          type="checkbox"
                          checked={selectedCount === skus.length}
                          disabled={busy}
                          onChange={() => toggleProduct(product, skus)}
                        />
                        <span><strong>{product.title}</strong><small>{product.productCode || `${skus.length} 个 SKU`}</small></span>
                        <b>{selectedCount}/{skus.length}</b>
                      </label>
                      <div className="commerce-export-sku-list">
                        {skus.map((sku) => (
                          <label key={sku.skuId}>
                            <input type="checkbox" checked={selectedSkuIds.has(sku.skuId)} disabled={busy} onChange={() => toggleSku(sku.skuId)} />
                            <span><strong>{sku.skuCode}</strong><small>{sku.title || "未命名 SKU"}</small></span>
                          </label>
                        ))}
                      </div>
                    </section>
                  );
                })}
                {!loading && !platformProducts.length ? <p className="commerce-export-empty">当前平台暂无活动 SKU</p> : null}
              </div>
            </aside>

            <main className="commerce-export-preview">
              {externalRevision !== null ? (
                <InlineNotice tone="warning" icon={<RefreshCw size={15} />}>
                  <span>SKU 商品素材库已更新。</span>
                  <ButtonBase type="button" disabled={busy} onClick={() => void loadCatalog()}><RefreshCw size={13} />刷新</ButtonBase>
                </InlineNotice>
              ) : null}
              {notice ? <InlineNotice tone="danger" icon={<AlertTriangle size={15} />}>{notice}</InlineNotice> : null}
              {successPath ? <InlineNotice tone="success" icon={<FolderCheck size={15} />}><strong>导出完成</strong><span>{successPath}</span></InlineNotice> : null}

              <section className="commerce-export-summary" aria-label="导出检查摘要">
                <div><PackageCheck size={16} /><span><strong>{summary?.packages ?? selectedIds.length}</strong><small>SKU 包</small></span></div>
                <div><ImageIcon size={16} /><span><strong>{summary?.validImages ?? 0}</strong><small>有效图片</small></span></div>
                <div className={summary?.warnings ? "has-warning" : ""}><AlertTriangle size={16} /><span><strong>{summary?.warnings ?? 0}</strong><small>提醒</small></span></div>
                <div className={summary?.blockingIssues ? "has-blocking" : ""}><FileCheck2 size={16} /><span><strong>{summary?.blockingIssues ?? 0}</strong><small>阻断</small></span></div>
              </section>

              {loading ? (
                <div className="commerce-export-loading"><RefreshCw className="spin" size={20} /><span>读取 SKU 素材库</span></div>
              ) : previewCurrent ? (
                <div className="commerce-export-results">
                  <section className="commerce-export-package-list" aria-label="SKU 导出包">
                    <header><strong>SKU 包</strong><small>{preview?.packages?.length ?? 0} 个</small></header>
                    {(preview?.packages ?? []).map((item) => (
                      <article key={item.skuId} className="commerce-export-package-row">
                        <CheckCircle2 size={15} aria-hidden="true" />
                        <span><strong>{item.skuCode}</strong><small>{item.productTitle}</small></span>
                        <span className="commerce-export-package-images">
                          {item.images.slice(0, 5).map((image) => <i key={image.linkId} title={image.fileName}>{roleLabel(image.role)}</i>)}
                          {item.images.length > 5 ? <i>+{item.images.length - 5}</i> : null}
                        </span>
                        <b>{item.images.filter((image) => image.valid).length} 张</b>
                      </article>
                    ))}
                  </section>
                  <section className="commerce-export-issue-list" aria-label="平台检查问题">
                    <header><strong>平台检查</strong><small>{issues.length} 项</small></header>
                    {issues.map((issue) => (
                      <div key={issue.issueId} className={`commerce-export-issue is-${issue.severity}`}>
                        <AlertTriangle size={14} />
                        <span>{issue.message}</span>
                        <small>{issue.code}</small>
                      </div>
                    ))}
                    {!issues.length ? <div className="commerce-export-clean"><CheckCircle2 size={16} />未发现平台检查问题</div> : null}
                  </section>
                </div>
              ) : (
                <div className="commerce-export-awaiting"><FileCheck2 size={28} /><strong>等待检查</strong></div>
              )}
            </main>
          </SurfaceBody>
          <SurfaceFooter leading={<span className="commerce-export-footer-status">Catalog revision {catalog.revision}</span>}>
            <ActionButton
              variant="secondary"
              icon={<FileCheck2 size={14} />}
              busy={checking}
              disabled={loading || exporting || !selectedIds.length || externalRevision !== null}
              onClick={() => void runPreview()}
            >
              运行检查
            </ActionButton>
            <ActionButton
              variant="primary"
              icon={<Download size={14} />}
              busy={exporting}
              disabled={!canExport}
              onClick={() => void exportPackages()}
            >
              导出 SKU 包
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}
