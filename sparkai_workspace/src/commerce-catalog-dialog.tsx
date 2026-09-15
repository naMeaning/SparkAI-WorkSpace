import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Box,
  Check,
  ImageIcon,
  LockKeyhole,
  PackageOpen,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2
} from "lucide-react";

import type {
  CommerceCatalogAssetKind,
  CommerceCatalogAssetLink,
  CommerceCatalogAssetLocator,
  CommerceCatalogBrandStyle,
  CommerceCatalogDocument,
  CommerceCatalogProduct,
  CommerceCatalogProductDraft,
  CommerceCatalogResult,
  CommerceCatalogResultState,
  CommercePlatformId
} from "./commerce-catalog";
import {
  COMMERCE_CATALOG_ASSET_KINDS,
  COMMERCE_CATALOG_BRAND_STYLE,
  COMMERCE_CATALOG_LIMITS,
  COMMERCE_CATALOG_PLATFORMS
} from "./commerce-catalog";
import {
  ActionButton,
  ButtonBase,
  DialogShell,
  Field,
  InlineNotice,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
  UnsavedChangesDialog
} from "./ui";
import "./styles/04c-commerce-catalog-dialog.css";

export type CommerceCatalogCanvasAsset = CommerceCatalogAssetLocator & {
  assetId?: string;
  contentHash?: string;
  previewUrl?: string;
  label?: string;
};

export type CommerceCatalogTranslationCanvasItem = {
  productId: string;
  sourceBindingId: string;
  sourceLinkId?: string;
  commercePlanHash: string;
  localeCode: string;
  status: "generating" | "failed" | "done";
  previewUrl?: string;
  error?: string;
  createdAt?: string;
};

export type CommerceCatalogDialogProps = {
  projectId: string;
  selectedAssets: CommerceCatalogAssetLocator[];
  canvasAssets: CommerceCatalogCanvasAsset[];
  translationCanvasItems?: readonly CommerceCatalogTranslationCanvasItem[];
  close: () => void;
};

type VariantDraft = {
  key: string;
  variantId?: string;
  title: string;
  optionsText: string;
};

type SkuDraft = {
  key: string;
  skuId?: string;
  skuCode: string;
  title: string;
  variantKey: string;
  platforms: CommercePlatformId[];
};

type ProductDraft = {
  productId?: string;
  expectedProductRevision?: number;
  title: string;
  productCode: string;
  brand: string;
  brandStyle: {
    enabled: boolean;
    fontFamily: string;
    colorsText: string;
    logoUsage: string;
    modelAppearance: string;
    productAppearance: string;
    visualStyle: string;
  };
  platforms: CommercePlatformId[];
  variants: VariantDraft[];
  skus: SkuDraft[];
};

const emptyCatalog = (): CommerceCatalogDocument => ({
  schemaVersion: 1,
  catalogId: "",
  revision: 0,
  createdAt: "",
  updatedAt: "",
  products: []
});

function draftKey(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyProductDraft(): ProductDraft {
  return {
    title: "",
    productCode: "",
    brand: "",
    brandStyle: {
      enabled: false,
      fontFamily: "",
      colorsText: "",
      logoUsage: COMMERCE_CATALOG_BRAND_STYLE.defaultLogoUsage,
      modelAppearance: "",
      productAppearance: "",
      visualStyle: ""
    },
    platforms: ["amazon"],
    variants: [],
    skus: []
  };
}

function optionsText(product: CommerceCatalogProduct, variantId?: string) {
  const variant = product.variants.find((item) => item.variantId === variantId);
  return variant?.optionValues.map((item) => `${item.name}=${item.value}`).join("; ") || "";
}

function draftFromProduct(product: CommerceCatalogProduct): ProductDraft {
  const variants = product.variants.map((variant) => ({
    key: variant.variantId,
    variantId: variant.variantId,
    title: variant.title,
    optionsText: optionsText(product, variant.variantId)
  }));
  return {
    productId: product.productId,
    expectedProductRevision: product.revision,
    title: product.title,
    productCode: product.productCode || "",
    brand: product.brand || "",
    brandStyle: {
      enabled: product.brandStyle?.enabled === true,
      fontFamily: product.brandStyle?.fontFamily || "",
      colorsText: product.brandStyle?.colors.join("; ") || "",
      logoUsage: product.brandStyle?.logoUsage || COMMERCE_CATALOG_BRAND_STYLE.defaultLogoUsage,
      modelAppearance: product.brandStyle?.modelAppearance || "",
      productAppearance: product.brandStyle?.productAppearance || "",
      visualStyle: product.brandStyle?.visualStyle || ""
    },
    platforms: [...product.platforms],
    variants,
    skus: product.skus.map((sku) => ({
      key: sku.skuId,
      skuId: sku.skuId,
      skuCode: sku.skuCode,
      title: sku.title || "",
      variantKey: sku.variantId || "",
      platforms: [...sku.platforms]
    }))
  };
}

function parseOptions(value: string) {
  return value
    .split(/[;；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.search(/[=:：]/);
      return separator > 0
        ? { name: item.slice(0, separator).trim(), value: item.slice(separator + 1).trim() }
        : { name: "规格", value: item };
    })
    .filter((item) => item.name && item.value);
}

function parseBrandColors(value: string) {
  return value
    .split(/[;,；，\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function savePayload(draft: ProductDraft): CommerceCatalogProductDraft {
  const brandStyle: CommerceCatalogBrandStyle = {
    version: 1,
    enabled: draft.brandStyle.enabled,
    fontFamily: draft.brandStyle.fontFamily,
    colors: parseBrandColors(draft.brandStyle.colorsText),
    logoUsage: draft.brandStyle.logoUsage,
    modelAppearance: draft.brandStyle.modelAppearance,
    productAppearance: draft.brandStyle.productAppearance,
    visualStyle: draft.brandStyle.visualStyle
  };
  return {
    ...(draft.productId ? { productId: draft.productId, expectedProductRevision: draft.expectedProductRevision } : {}),
    title: draft.title,
    productCode: draft.productCode,
    brand: draft.brand,
    brandStyle,
    platforms: draft.platforms,
    variants: draft.variants.map((variant) => ({
      ...(variant.variantId ? { variantId: variant.variantId } : {}),
      title: variant.title,
      optionValues: parseOptions(variant.optionsText)
    })),
    skus: draft.skus.map((sku) => {
      const variantIndex = draft.variants.findIndex((variant) => variant.key === sku.variantKey);
      const variant = variantIndex >= 0 ? draft.variants[variantIndex] : undefined;
      return {
        ...(sku.skuId ? { skuId: sku.skuId } : {}),
        skuCode: sku.skuCode,
        title: sku.title,
        platforms: sku.platforms,
        ...(variant?.variantId ? { variantId: variant.variantId } : variant ? { variantIndex } : {})
      };
    })
  };
}

function platformLabel(platform: CommercePlatformId) {
  return COMMERCE_CATALOG_PLATFORMS.find((item) => item.id === platform)?.label || platform;
}

function kindLabel(kind: CommerceCatalogAssetKind) {
  return COMMERCE_CATALOG_ASSET_KINDS.find((item) => item.id === kind)?.label || kind;
}

function roleOptions(kind: CommerceCatalogAssetKind) {
  return COMMERCE_CATALOG_ASSET_KINDS.find((item) => item.id === kind)?.roles
    .map((role) => ({ value: role.id, label: role.label })) || [];
}

export default function CommerceCatalogDialog({
  projectId,
  selectedAssets,
  canvasAssets,
  translationCanvasItems = [],
  close
}: CommerceCatalogDialogProps) {
  const [catalog, setCatalog] = useState<CommerceCatalogDocument>(emptyCatalog);
  const [activeProductId, setActiveProductId] = useState("");
  const [draft, setDraft] = useState<ProductDraft>(emptyProductDraft);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [assetKind, setAssetKind] = useState<CommerceCatalogAssetKind>("master");
  const [assetRole, setAssetRole] = useState("primary");
  const [assetOwner, setAssetOwner] = useState("");
  const [externalRevision, setExternalRevision] = useState<number | null>(null);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const dirty = JSON.stringify(draft) !== baseline;
  const activeProduct = catalog.products.find((item) => item.productId === activeProductId) || null;
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return catalog.products
      .filter((product) => showArchived || product.status !== "archived")
      .filter((product) => !query || [product.title, product.productCode, product.brand, ...product.skus.map((sku) => sku.skuCode)]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(query))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [catalog.products, search, showArchived]);
  const canvasAssetByIdentity = useMemo(() => {
    const map = new Map<string, CommerceCatalogCanvasAsset>();
    for (const asset of canvasAssets) {
      if (asset.assetId) map.set(`asset:${asset.assetId}`, asset);
      if (asset.contentHash) map.set(`hash:${asset.contentHash}`, asset);
      map.set(`node:${asset.nodeId}:${asset.assetIndex}`, asset);
    }
    return map;
  }, [canvasAssets]);
  const translationPlans = useMemo(() => {
    if (!activeProduct) return [];
    type TranslationCell = {
      localeCode: string;
      link?: CommerceCatalogAssetLink;
      canvas?: CommerceCatalogTranslationCanvasItem;
    };
    type TranslationRow = {
      key: string;
      sourceBindingId: string;
      sourceLinkId?: string;
      label: string;
      cells: Map<string, TranslationCell>;
    };
    const plans = new Map<string, {
      planHash: string;
      createdAt: string;
      locales: Set<string>;
      rows: Map<string, TranslationRow>;
    }>();
    const ensurePlan = (planHash: string, createdAt = "") => {
      const current = plans.get(planHash);
      if (current) {
        if (createdAt > current.createdAt) current.createdAt = createdAt;
        return current;
      }
      const next = { planHash, createdAt, locales: new Set<string>(), rows: new Map<string, TranslationRow>() };
      plans.set(planHash, next);
      return next;
    };
    const ensureRow = (plan: ReturnType<typeof ensurePlan>, sourceBindingId: string, sourceLinkId?: string) => {
      const key = sourceLinkId || sourceBindingId;
      const current = plan.rows.get(key);
      if (current) return current;
      const master = activeProduct.assets.find((asset) => asset.linkId === sourceLinkId && asset.kind === "master");
      const next: TranslationRow = {
        key,
        sourceBindingId,
        ...(sourceLinkId ? { sourceLinkId } : {}),
        label: master?.fileName || `来源 ${sourceBindingId.slice(-8)}`,
        cells: new Map<string, TranslationCell>()
      };
      plan.rows.set(key, next);
      return next;
    };
    for (const link of activeProduct.assets) {
      if (link.kind !== "result" || link.commerceSlotId !== "translation" || !link.commercePlanHash || !link.commerceLocaleCode || !link.sourceBindingId) continue;
      const plan = ensurePlan(link.commercePlanHash, link.createdAt);
      plan.locales.add(link.commerceLocaleCode);
      const row = ensureRow(plan, link.sourceBindingId, link.sourceLinkId);
      const prior = row.cells.get(link.commerceLocaleCode)?.link;
      if (!prior || prior.createdAt <= link.createdAt) row.cells.set(link.commerceLocaleCode, { localeCode: link.commerceLocaleCode, link });
    }
    for (const item of translationCanvasItems) {
      if (item.productId !== activeProduct.productId || !item.commercePlanHash || !item.localeCode || !item.sourceBindingId) continue;
      const plan = ensurePlan(item.commercePlanHash, item.createdAt);
      plan.locales.add(item.localeCode);
      const row = ensureRow(plan, item.sourceBindingId, item.sourceLinkId);
      const prior = row.cells.get(item.localeCode);
      row.cells.set(item.localeCode, { localeCode: item.localeCode, link: prior?.link, canvas: item });
    }
    return [...plans.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.planHash.localeCompare(left.planHash))
      .map((plan) => ({
        planHash: plan.planHash,
        locales: [...plan.locales],
        rows: [...plan.rows.values()]
      }));
  }, [activeProduct, translationCanvasItems]);

  const selectProduct = useCallback((product: CommerceCatalogProduct | null) => {
    const nextDraft = product ? draftFromProduct(product) : emptyProductDraft();
    setActiveProductId(product?.productId || "");
    setDraft(nextDraft);
    setBaseline(JSON.stringify(nextDraft));
    setAssetOwner(product ? `product:${product.productId}` : "");
    setNotice("");
    setExternalRevision(null);
  }, []);

  const applyResult = useCallback((result: CommerceCatalogResult) => {
    if (!result.ok) {
      if (result.errorCode === "CATALOG_REVISION_CONFLICT" || result.errorCode === "PRODUCT_REVISION_CONFLICT") {
        setExternalRevision(Number(result.details?.currentRevision ?? catalog.revision));
      }
      throw new Error(result.error || "SKU 商品素材库操作失败。");
    }
    if (!result.product) return;
    setCatalog((current) => {
      const exists = current.products.some((item) => item.productId === result.product?.productId);
      return {
        ...current,
        revision: Number(result.catalogRevision ?? current.revision),
        products: exists
          ? current.products.map((item) => item.productId === result.product?.productId ? result.product! : item)
          : [...current.products, result.product!]
      };
    });
    selectProduct(result.product);
  }, [catalog.revision, selectProduct]);

  const loadCatalog = useCallback(async (keepProductId = "") => {
    const bridge = window.naimageConfig?.listCommerceCatalog;
    if (!bridge) throw new Error("当前桌面运行时不支持 SKU 商品素材库。");
    const result = await bridge({ expectedProjectId: projectId });
    if (!result.ok || !result.catalog) throw new Error(result.error || "SKU 商品素材库读取失败。");
    setCatalog(result.catalog);
    const nextProduct = result.catalog.products.find((item) => item.productId === keepProductId)
      || result.catalog.products.find((item) => item.status === "active")
      || result.catalog.products[0]
      || null;
    selectProduct(nextProduct);
  }, [projectId, selectProduct]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadCatalog().catch((error) => {
      if (!cancelled) setNotice(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadCatalog]);

  useEffect(() => window.naimageConfig?.onCommerceCatalogChanged?.((payload) => {
    if (payload.projectId !== projectId || Number(payload.catalogRevision) <= catalog.revision) return;
    if (dirty || busy) {
      setExternalRevision(Number(payload.catalogRevision));
      setNotice("素材库已在其他窗口更新；当前草稿尚未覆盖，请刷新后继续。");
      return;
    }
    void loadCatalog(activeProductId).catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
  }), [activeProductId, busy, catalog.revision, dirty, loadCatalog, projectId]);

  function patchDraft(patch: Partial<ProductDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function togglePlatform(platform: CommercePlatformId, checked: boolean) {
    patchDraft({
      platforms: checked
        ? [...new Set([...draft.platforms, platform])]
        : draft.platforms.filter((item) => item !== platform)
    });
  }

  async function saveProduct(closeAfterSave = false): Promise<boolean> {
    if (!draft.title.trim()) {
      setNotice("请输入商品名称。");
      setClosePromptOpen(false);
      return false;
    }
    if (draft.skus.some((sku) => !sku.skuCode.trim())) {
      setNotice("SKU 编码不能为空。");
      setClosePromptOpen(false);
      return false;
    }
    const bridge = window.naimageConfig?.saveCommerceCatalogProduct;
    if (!bridge) {
      setNotice("当前桌面运行时不支持保存 SKU 商品素材库。");
      setClosePromptOpen(false);
      return false;
    }
    setBusy(true);
    setNotice("");
    try {
      applyResult(await bridge({
        expectedProjectId: projectId,
        expectedCatalogRevision: catalog.revision,
        ...savePayload(draft)
      }));
      setClosePromptOpen(false);
      if (closeAfterSave) close();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      setClosePromptOpen(false);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function requestCatalogClose() {
    if (busy) return;
    if (dirty) {
      setClosePromptOpen(true);
      return;
    }
    close();
  }

  async function archiveProduct() {
    if (!activeProduct || !window.naimageConfig?.archiveCommerceCatalogProduct) return;
    setBusy(true);
    setNotice("");
    try {
      applyResult(await window.naimageConfig.archiveCommerceCatalogProduct({
        expectedProjectId: projectId,
        expectedCatalogRevision: catalog.revision,
        productId: activeProduct.productId,
        expectedProductRevision: activeProduct.revision,
        archived: activeProduct.status !== "archived"
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function assignSelectedAssets() {
    if (!activeProduct || !selectedAssets.length || !window.naimageConfig?.assignCommerceCatalogAssets) return;
    const [ownerType, ownerId] = (assetOwner || `product:${activeProduct.productId}`).split(":");
    setBusy(true);
    setNotice("");
    try {
      applyResult(await window.naimageConfig.assignCommerceCatalogAssets({
        expectedProjectId: projectId,
        expectedCatalogRevision: catalog.revision,
        productId: activeProduct.productId,
        expectedProductRevision: activeProduct.revision,
        kind: assetKind,
        ownerType: ownerType === "variant" || ownerType === "sku" ? ownerType : "product",
        ownerId,
        role: assetRole,
        assets: selectedAssets
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeAsset(link: CommerceCatalogAssetLink) {
    if (!activeProduct || !window.naimageConfig?.removeCommerceCatalogAsset) return;
    setBusy(true);
    setNotice("");
    try {
      applyResult(await window.naimageConfig.removeCommerceCatalogAsset({
        expectedProjectId: projectId,
        expectedCatalogRevision: catalog.revision,
        productId: activeProduct.productId,
        expectedProductRevision: activeProduct.revision,
        linkId: link.linkId
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function reviewTranslationResults(links: CommerceCatalogAssetLink[], state: CommerceCatalogResultState) {
    if (!activeProduct || !links.length || dirty || busy || !window.naimageConfig?.updateCommerceCatalogResultState) return;
    setBusy(true);
    setNotice("");
    try {
      let catalogRevision = catalog.revision;
      let product = activeProduct;
      let changed = 0;
      for (const link of links) {
        if (link.state === state) continue;
        const result = await window.naimageConfig.updateCommerceCatalogResultState({
          expectedProjectId: projectId,
          expectedCatalogRevision: catalogRevision,
          productId: product.productId,
          expectedProductRevision: product.revision,
          linkId: link.linkId,
          state
        });
        if (!result.ok || !result.product) {
          if (result.errorCode === "CATALOG_REVISION_CONFLICT" || result.errorCode === "PRODUCT_REVISION_CONFLICT") {
            setExternalRevision(Number(result.details?.currentRevision ?? catalogRevision));
          }
          throw new Error(result.error || "翻译结果复核失败。");
        }
        catalogRevision = Number(result.catalogRevision ?? catalogRevision);
        product = result.product;
        changed += result.changed === false ? 0 : 1;
      }
      setCatalog((current) => ({
        ...current,
        revision: catalogRevision,
        products: current.products.map((item) => item.productId === product.productId ? product : item)
      }));
      selectProduct(product);
      setNotice(changed ? `已更新 ${changed} 个翻译结果。` : "所选翻译结果状态没有变化。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const ownerOptions = activeProduct ? [
    { value: `product:${activeProduct.productId}`, label: "当前商品" },
    ...activeProduct.variants.map((variant) => ({ value: `variant:${variant.variantId}`, label: `变体 · ${variant.title}` })),
    ...activeProduct.skus.map((sku) => ({ value: `sku:${sku.skuId}`, label: `SKU · ${sku.skuCode}` }))
  ] : [];

  return (
    <>
      <DialogShell
        surface="commerce-catalog"
        ariaLabel="SKU 商品素材库"
        className="commerce-catalog-dialog"
        busy={busy}
        dirty={dirty}
        closePolicy={{ escape: "when-idle", backdrop: "when-idle", "close-button": "when-idle", action: "when-idle" }}
        onCloseBlocked={() => setNotice("当前操作尚未完成。")}
        onRequestClose={requestCatalogClose}
      >
        {({ requestClose }) => (
          <>
          <SurfaceHeader
            title="SKU 商品素材库"
            description="Amazon 与速卖通商品、变体、SKU 和图片资产"
            onClose={() => requestClose("close-button")}
            closeDisabled={busy}
          />
          <SurfaceBody className="commerce-catalog-body">
            <aside className="commerce-catalog-sidebar">
              <div className="commerce-catalog-search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  aria-label="搜索商品或 SKU"
                  placeholder="搜索商品或 SKU"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div className="commerce-catalog-sidebar-actions">
                <ButtonBase
                  type="button"
                  disabled={busy || dirty}
                  onClick={() => selectProduct(null)}
                  title="新建商品"
                  aria-label="新建商品"
                >
                  <Plus size={15} />
                  <span>新建商品</span>
                </ButtonBase>
                <label>
                  <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
                  <span>归档</span>
                </label>
              </div>
              <div className="commerce-catalog-product-list" aria-live="polite">
                {filteredProducts.map((product) => (
                  <ButtonBase
                    key={product.productId}
                    type="button"
                    className={product.productId === activeProductId ? "active" : ""}
                    disabled={busy || (dirty && product.productId !== activeProductId)}
                    onClick={() => selectProduct(product)}
                    title={product.title}
                  >
                    <span className="commerce-catalog-product-mark"><PackageOpen size={15} /></span>
                    <span>
                      <strong>{product.title}</strong>
                      <small>{product.productCode || product.brand || "未设置商品编码"}</small>
                    </span>
                    <span className="commerce-catalog-product-count">{product.skus.length}</span>
                  </ButtonBase>
                ))}
                {!loading && filteredProducts.length === 0 ? (
                  <div className="commerce-catalog-empty-list"><Box size={18} /><span>暂无商品</span></div>
                ) : null}
              </div>
            </aside>

            <main className="commerce-catalog-editor">
              {notice ? (
                <InlineNotice tone={externalRevision !== null ? "warning" : "danger"}>
                  <span>{notice}</span>
                  {externalRevision !== null ? (
                    <ButtonBase type="button" disabled={busy} onClick={() => void loadCatalog(activeProductId)}>
                      <RefreshCw size={13} />刷新
                    </ButtonBase>
                  ) : null}
                </InlineNotice>
              ) : null}

              {loading ? (
                <div className="commerce-catalog-loading"><RefreshCw className="spin" size={20} /><span>读取素材库</span></div>
              ) : (
                <>
                  <section className="commerce-catalog-section commerce-catalog-product-fields" aria-labelledby="commerce-product-fields">
                    <header>
                      <div><strong id="commerce-product-fields">商品信息</strong><small>{activeProduct ? `Revision ${activeProduct.revision}` : "新商品"}</small></div>
                      {activeProduct?.status === "archived" ? <span className="commerce-catalog-archived">已归档</span> : null}
                    </header>
                    <div className="commerce-catalog-field-grid">
                      <Field label="商品名称">
                        <input data-autofocus value={draft.title} onChange={(event) => patchDraft({ title: event.target.value })} />
                      </Field>
                      <Field label="商品编码">
                        <input value={draft.productCode} onChange={(event) => patchDraft({ productCode: event.target.value })} />
                      </Field>
                      <Field label="品牌">
                        <input value={draft.brand} onChange={(event) => patchDraft({ brand: event.target.value })} />
                      </Field>
                      <div className="commerce-catalog-platforms" aria-label="销售平台">
                        {(["amazon", "aliexpress"] as CommercePlatformId[]).map((platform) => (
                          <label key={platform}>
                            <input
                              type="checkbox"
                              checked={draft.platforms.includes(platform)}
                              onChange={(event) => togglePlatform(platform, event.target.checked)}
                            />
                            <span>{platformLabel(platform)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="commerce-catalog-section commerce-brand-style" aria-labelledby="commerce-brand-style">
                    <header>
                      <div>
                        <Palette size={14} aria-hidden="true" />
                        <strong id="commerce-brand-style">品牌风格锁定</strong>
                        <small>后续套图自动按商品 SOURCE 冻结并复用</small>
                      </div>
                      <label className="commerce-brand-style-toggle">
                        <input
                          type="checkbox"
                          checked={draft.brandStyle.enabled}
                          onChange={(event) => patchDraft({ brandStyle: { ...draft.brandStyle, enabled: event.target.checked } })}
                        />
                        <LockKeyhole size={13} aria-hidden="true" />
                        <span>{draft.brandStyle.enabled ? "已启用" : "未启用"}</span>
                      </label>
                    </header>
                    <div className="commerce-brand-style-grid" data-enabled={draft.brandStyle.enabled ? "true" : "false"}>
                      <Field label="字体规范" hint={`${draft.brandStyle.fontFamily.length}/${COMMERCE_CATALOG_LIMITS.maxBrandFontLength}`}>
                        <input
                          disabled={!draft.brandStyle.enabled}
                          maxLength={COMMERCE_CATALOG_LIMITS.maxBrandFontLength}
                          placeholder="例如 Inter / Noto Sans"
                          value={draft.brandStyle.fontFamily}
                          onChange={(event) => patchDraft({ brandStyle: { ...draft.brandStyle, fontFamily: event.target.value } })}
                        />
                      </Field>
                      <Field label="品牌色板" hint={`最多 ${COMMERCE_CATALOG_LIMITS.maxBrandColors} 个 HEX 色`}>
                        <input
                          disabled={!draft.brandStyle.enabled}
                          placeholder="#111827; #f8fafc; #f59e0b"
                          value={draft.brandStyle.colorsText}
                          onChange={(event) => patchDraft({ brandStyle: { ...draft.brandStyle, colorsText: event.target.value } })}
                        />
                      </Field>
                      <div className="commerce-brand-color-preview" aria-label="品牌色板预览">
                        {parseBrandColors(draft.brandStyle.colorsText)
                          .filter((color) => /^#[a-f0-9]{6}$/.test(color))
                          .slice(0, COMMERCE_CATALOG_LIMITS.maxBrandColors)
                          .map((color) => <span key={color} title={color} style={{ backgroundColor: color }} />)}
                        {!parseBrandColors(draft.brandStyle.colorsText).some((color) => /^#[a-f0-9]{6}$/.test(color)) ? <small>输入 HEX 色值</small> : null}
                      </div>
                      <Field className="commerce-brand-style-wide" label="Logo 使用规则" hint={`${draft.brandStyle.logoUsage.length}/${COMMERCE_CATALOG_LIMITS.maxBrandRuleLength}`}>
                        <textarea
                          disabled={!draft.brandStyle.enabled}
                          maxLength={COMMERCE_CATALOG_LIMITS.maxBrandRuleLength}
                          rows={2}
                          value={draft.brandStyle.logoUsage}
                          onChange={(event) => patchDraft({ brandStyle: { ...draft.brandStyle, logoUsage: event.target.value } })}
                        />
                      </Field>
                      <Field label="模特一致性" hint={`${draft.brandStyle.modelAppearance.length}/${COMMERCE_CATALOG_LIMITS.maxBrandRuleLength}`}>
                        <textarea
                          disabled={!draft.brandStyle.enabled}
                          maxLength={COMMERCE_CATALOG_LIMITS.maxBrandRuleLength}
                          rows={3}
                          placeholder="固定人物身份、年龄感、肤色、发型和妆容"
                          value={draft.brandStyle.modelAppearance}
                          onChange={(event) => patchDraft({ brandStyle: { ...draft.brandStyle, modelAppearance: event.target.value } })}
                        />
                      </Field>
                      <Field label="商品外观" hint={`${draft.brandStyle.productAppearance.length}/${COMMERCE_CATALOG_LIMITS.maxBrandRuleLength}`}>
                        <textarea
                          disabled={!draft.brandStyle.enabled}
                          maxLength={COMMERCE_CATALOG_LIMITS.maxBrandRuleLength}
                          rows={3}
                          placeholder="固定轮廓、结构、标签、材质、颜色和比例"
                          value={draft.brandStyle.productAppearance}
                          onChange={(event) => patchDraft({ brandStyle: { ...draft.brandStyle, productAppearance: event.target.value } })}
                        />
                      </Field>
                      <Field className="commerce-brand-style-wide" label="整体视觉语言" hint={`${draft.brandStyle.visualStyle.length}/${COMMERCE_CATALOG_LIMITS.maxBrandRuleLength}`}>
                        <textarea
                          disabled={!draft.brandStyle.enabled}
                          maxLength={COMMERCE_CATALOG_LIMITS.maxBrandRuleLength}
                          rows={2}
                          placeholder="固定光线、构图、留白、背景和质感方向"
                          value={draft.brandStyle.visualStyle}
                          onChange={(event) => patchDraft({ brandStyle: { ...draft.brandStyle, visualStyle: event.target.value } })}
                        />
                      </Field>
                    </div>
                    <p className="commerce-brand-style-note">已关联的 Logo、品牌包装和风格参考图会按商品/SKU 归属自动作为可信参考；无法定位的品牌素材会在派发前阻止执行。</p>
                  </section>

                  <section className="commerce-catalog-section" aria-labelledby="commerce-variants">
                    <header>
                      <div><strong id="commerce-variants">商品变体</strong><small>{draft.variants.length} 个</small></div>
                      <ButtonBase type="button" onClick={() => patchDraft({ variants: [...draft.variants, { key: draftKey("variant"), title: "", optionsText: "" }] })}>
                        <Plus size={13} />新增变体
                      </ButtonBase>
                    </header>
                    <div className="commerce-catalog-rows">
                      {draft.variants.map((variant, index) => (
                        <div className="commerce-catalog-row variant-row" key={variant.key}>
                          <span className="commerce-catalog-row-index">{index + 1}</span>
                          <input
                            aria-label={`变体 ${index + 1} 名称`}
                            placeholder="变体名称"
                            value={variant.title}
                            onChange={(event) => patchDraft({ variants: draft.variants.map((item) => item.key === variant.key ? { ...item, title: event.target.value } : item) })}
                          />
                          <input
                            aria-label={`变体 ${index + 1} 规格`}
                            placeholder="颜色=黑色; 尺寸=500ml"
                            value={variant.optionsText}
                            onChange={(event) => patchDraft({ variants: draft.variants.map((item) => item.key === variant.key ? { ...item, optionsText: event.target.value } : item) })}
                          />
                          <ButtonBase
                            type="button"
                            className="commerce-catalog-row-remove"
                            aria-label={`移除变体 ${variant.title || index + 1}`}
                            title="移除变体"
                            onClick={() => patchDraft({
                              variants: draft.variants.filter((item) => item.key !== variant.key),
                              skus: draft.skus.map((sku) => sku.variantKey === variant.key ? { ...sku, variantKey: "" } : sku)
                            })}
                          >
                            <Trash2 size={13} />
                          </ButtonBase>
                        </div>
                      ))}
                      {draft.variants.length === 0 ? <p className="commerce-catalog-section-empty">暂无变体</p> : null}
                    </div>
                  </section>

                  <section className="commerce-catalog-section" aria-labelledby="commerce-skus">
                    <header>
                      <div><strong id="commerce-skus">SKU</strong><small>{draft.skus.length} 个</small></div>
                      <ButtonBase type="button" onClick={() => patchDraft({ skus: [...draft.skus, { key: draftKey("sku"), skuCode: "", title: "", variantKey: "", platforms: [...draft.platforms] }] })}>
                        <Plus size={13} />新增 SKU
                      </ButtonBase>
                    </header>
                    <div className="commerce-catalog-rows">
                      {draft.skus.map((sku, index) => (
                        <div className="commerce-catalog-row sku-row" key={sku.key}>
                          <span className="commerce-catalog-row-index">{index + 1}</span>
                          <input
                            aria-label={`SKU ${index + 1} 编码`}
                            placeholder="SKU 编码"
                            value={sku.skuCode}
                            onChange={(event) => patchDraft({ skus: draft.skus.map((item) => item.key === sku.key ? { ...item, skuCode: event.target.value } : item) })}
                          />
                          <input
                            aria-label={`SKU ${index + 1} 名称`}
                            placeholder="SKU 名称"
                            value={sku.title}
                            onChange={(event) => patchDraft({ skus: draft.skus.map((item) => item.key === sku.key ? { ...item, title: event.target.value } : item) })}
                          />
                          <select
                            aria-label={`SKU ${index + 1} 变体`}
                            value={sku.variantKey}
                            onChange={(event) => patchDraft({ skus: draft.skus.map((item) => item.key === sku.key ? { ...item, variantKey: event.target.value } : item) })}
                          >
                            <option value="">不关联变体</option>
                            {draft.variants.map((variant) => <option key={variant.key} value={variant.key}>{variant.title || "未命名变体"}</option>)}
                          </select>
                          <div className="commerce-catalog-sku-platforms">
                            {(["amazon", "aliexpress"] as CommercePlatformId[]).map((platform) => (
                              <label key={platform} title={platformLabel(platform)}>
                                <input
                                  type="checkbox"
                                  checked={sku.platforms.includes(platform)}
                                  onChange={(event) => patchDraft({
                                    skus: draft.skus.map((item) => item.key === sku.key ? {
                                      ...item,
                                      platforms: event.target.checked ? [...new Set([...item.platforms, platform])] : item.platforms.filter((value) => value !== platform)
                                    } : item)
                                  })}
                                />
                                <span>{platform === "amazon" ? "A" : "Ali"}</span>
                              </label>
                            ))}
                          </div>
                          <ButtonBase
                            type="button"
                            className="commerce-catalog-row-remove"
                            aria-label={`移除 SKU ${sku.skuCode || index + 1}`}
                            title="移除 SKU"
                            onClick={() => patchDraft({ skus: draft.skus.filter((item) => item.key !== sku.key) })}
                          >
                            <Trash2 size={13} />
                          </ButtonBase>
                        </div>
                      ))}
                      {draft.skus.length === 0 ? <p className="commerce-catalog-section-empty">暂无 SKU</p> : null}
                    </div>
                  </section>

                  <section className="commerce-catalog-section commerce-catalog-assets" aria-labelledby="commerce-assets">
                    <header>
                      <div><strong id="commerce-assets">图片资产</strong><small>{activeProduct?.assets.length || 0} 条关联</small></div>
                    </header>
                    <div className="commerce-catalog-asset-controls">
                      <div className="commerce-catalog-kind-control">
                        {(["master", "brand", "result"] as CommerceCatalogAssetKind[]).map((kind) => (
                          <ButtonBase
                            key={kind}
                            type="button"
                            className={assetKind === kind ? "active" : ""}
                            aria-pressed={assetKind === kind}
                            onClick={() => {
                              setAssetKind(kind);
                              setAssetRole(roleOptions(kind)[0].value);
                            }}
                          >
                            {kindLabel(kind)}
                          </ButtonBase>
                        ))}
                      </div>
                      <select value={assetOwner} onChange={(event) => setAssetOwner(event.target.value)} disabled={!activeProduct}>
                        {ownerOptions.map((owner) => <option key={owner.value} value={owner.value}>{owner.label}</option>)}
                      </select>
                      <select value={assetRole} onChange={(event) => setAssetRole(event.target.value)}>
                        {roleOptions(assetKind).map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                      </select>
                      <ActionButton
                        variant="primary"
                        icon={<ImageIcon size={14} />}
                        disabled={!activeProduct || !selectedAssets.length || dirty || busy}
                        onClick={() => void assignSelectedAssets()}
                        title={dirty ? "请先保存商品改动" : "将画布当前选中的图片关联到商品"}
                      >
                        加入选中图片 · {selectedAssets.length}
                      </ActionButton>
                    </div>
                    {translationPlans.length ? (
                      <div className="commerce-catalog-translation-plans" aria-label="多语言翻译结果矩阵">
                        {translationPlans.map((plan) => {
                          const planLinks = plan.rows.flatMap((row) => [...row.cells.values()].flatMap((cell) => cell.link ? [cell.link] : []));
                          return (
                            <section key={plan.planHash} className="commerce-catalog-translation-plan">
                              <header>
                                <div><strong>翻译矩阵</strong><small>{plan.planHash.slice(-8)} · {plan.rows.length} 张 × {plan.locales.length} 种语言</small></div>
                                <span>
                                  <ButtonBase type="button" disabled={busy || dirty || !planLinks.some((link) => link.state !== "approved")} onClick={() => void reviewTranslationResults(planLinks, "approved")} title="整批标记为已通过">
                                    <Check size={12} />全部通过
                                  </ButtonBase>
                                  <ButtonBase type="button" disabled={busy || dirty || !planLinks.some((link) => link.state !== "rejected")} onClick={() => void reviewTranslationResults(planLinks, "rejected")} title="整批标记为需修改">
                                    <RotateCcw size={12} />全部需修改
                                  </ButtonBase>
                                </span>
                              </header>
                              <div className="commerce-catalog-translation-scroll">
                                <table style={{ minWidth: `${180 + plan.locales.length * 148}px` }}>
                                  <thead><tr><th scope="col">来源图片</th>{plan.locales.map((locale) => <th scope="col" key={locale}>{locale}</th>)}</tr></thead>
                                  <tbody>
                                    {plan.rows.map((row) => (
                                      <tr key={row.key}>
                                        <th scope="row"><strong>{row.label}</strong><small>{row.sourceBindingId.slice(-10)}</small></th>
                                        {plan.locales.map((locale) => {
                                          const cell = row.cells.get(locale);
                                          const link = cell?.link;
                                          const canvas = cell?.canvas;
                                          const preview = link
                                            ? canvasAssetByIdentity.get(`asset:${link.assetId}`)?.previewUrl || canvas?.previewUrl
                                            : canvas?.previewUrl;
                                          const state = link?.state === "approved"
                                            ? "已通过"
                                            : link?.state === "rejected"
                                              ? "需修改"
                                              : link
                                                ? "待复核"
                                                : canvas?.status === "generating"
                                                  ? "生成中"
                                                  : canvas?.status === "failed"
                                                    ? "失败"
                                                    : canvas?.status === "done"
                                                      ? "待归档"
                                                      : "待生成";
                                          return (
                                            <td key={locale}>
                                              <div className={`commerce-catalog-translation-cell is-${link?.state || canvas?.status || "pending"}`} title={canvas?.error || state}>
                                                <span>{preview ? <img src={preview} alt="" draggable={false} /> : <ImageIcon size={14} />}</span>
                                                <strong>{state}</strong>
                                                {link ? (
                                                  <em>
                                                    <ButtonBase type="button" aria-label={`${row.label} ${locale} 标记为已通过`} title="标记为已通过" disabled={busy || dirty || link.state === "approved"} onClick={() => void reviewTranslationResults([link], "approved")}><Check size={12} /></ButtonBase>
                                                    <ButtonBase type="button" aria-label={`${row.label} ${locale} 标记为需修改`} title="标记为需修改" disabled={busy || dirty || link.state === "rejected"} onClick={() => void reviewTranslationResults([link], "rejected")}><RotateCcw size={12} /></ButtonBase>
                                                  </em>
                                                ) : null}
                                              </div>
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="commerce-catalog-asset-grid">
                      {(activeProduct?.assets || []).map((link) => {
                        const canvasAsset = canvasAssetByIdentity.get(`asset:${link.assetId}`)
                          || canvasAssetByIdentity.get(`hash:${link.contentHash}`)
                          || canvasAssetByIdentity.get(`node:${link.nodeId || ""}:${link.assetIndex ?? 0}`);
                        return (
                          <article key={link.linkId} className="commerce-catalog-asset-card">
                            <div className="commerce-catalog-asset-preview">
                              {canvasAsset?.previewUrl ? <img src={canvasAsset.previewUrl} alt="" draggable={false} /> : <ImageIcon size={18} />}
                            </div>
                            <div>
                              <strong>{kindLabel(link.kind)} · {roleOptions(link.kind).find((role) => role.value === link.role)?.label || link.role}</strong>
                              <small>{link.fileName}</small>
                            </div>
                            {link.kind === "result" ? <span className={`commerce-result-state is-${link.state || "candidate"}`}>{link.state === "approved" ? "采用" : link.state === "rejected" ? "淘汰" : "候选"}</span> : null}
                            <ButtonBase type="button" title="解除素材关联" aria-label={`解除素材关联 ${link.fileName}`} disabled={busy} onClick={() => void removeAsset(link)}>
                              <Trash2 size={12} />
                            </ButtonBase>
                          </article>
                        );
                      })}
                      {activeProduct && activeProduct.assets.length === 0 ? <p className="commerce-catalog-section-empty">暂无图片资产</p> : null}
                      {!activeProduct ? <p className="commerce-catalog-section-empty">保存商品后可加入图片资产</p> : null}
                    </div>
                  </section>
                </>
              )}
            </main>
          </SurfaceBody>
          <SurfaceFooter
            leading={activeProduct ? (
              <ActionButton
                variant="ghost"
                icon={activeProduct.status === "archived" ? <RotateCcw size={14} /> : <Archive size={14} />}
                disabled={busy || dirty}
                onClick={() => void archiveProduct()}
              >
                {activeProduct.status === "archived" ? "恢复商品" : "归档商品"}
              </ActionButton>
            ) : <span />}
          >
            <ActionButton
              variant="secondary"
              icon={<RotateCcw size={14} />}
              disabled={busy || !dirty}
              onClick={() => selectProduct(activeProduct)}
            >
              撤销
            </ActionButton>
            <ActionButton
              variant="primary"
              icon={busy ? undefined : dirty ? <Save size={14} /> : <Check size={14} />}
              busy={busy}
              disabled={!dirty || externalRevision !== null}
              onClick={() => void saveProduct()}
            >
              {draft.productId ? "保存商品" : "创建商品"}
            </ActionButton>
          </SurfaceFooter>
          </>
        )}
      </DialogShell>
      {closePromptOpen ? (
        <UnsavedChangesDialog
          surface="commerce-catalog-unsaved"
          ariaLabel="保存商品修改"
          title={draft.productId ? "关闭前要保存商品修改吗？" : "关闭前要创建这个商品吗？"}
          description="当前商品、品牌规范、变体或 SKU 还有未保存内容。"
          detail={<p>保存后会写入当前项目的 SKU 商品素材库；放弃不会删除画布图片或已保存商品。</p>}
          busy={busy}
          onContinueEditing={() => setClosePromptOpen(false)}
          onDiscard={() => {
            setClosePromptOpen(false);
            close();
          }}
          onSave={() => void saveProduct(true)}
          saveLabel={draft.productId ? "保存并关闭" : "创建并关闭"}
          saveDisabled={!draft.title.trim() || draft.skus.some((sku) => !sku.skuCode.trim()) || externalRevision !== null}
        />
      ) : null}
    </>
  );
}
