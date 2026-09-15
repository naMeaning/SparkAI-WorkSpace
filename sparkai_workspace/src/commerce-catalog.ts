import commerceCatalogSchema from "../plugins/commerce-catalog-schema.json" with { type: "json" };
import type { TaskAssetReference } from "./core.ts";

export type CommercePlatformId = "amazon" | "aliexpress";
export type CommerceCatalogProductStatus = "active" | "archived";
export type CommerceCatalogAssetKind = "master" | "brand" | "result";
export type CommerceCatalogAssetOwnerType = "product" | "variant" | "sku";
export type CommerceCatalogResultState = "candidate" | "approved" | "rejected";

export type CommerceCatalogBrandStyle = {
  version: 1;
  enabled: boolean;
  fontFamily?: string;
  colors: string[];
  logoUsage?: string;
  modelAppearance?: string;
  productAppearance?: string;
  visualStyle?: string;
};

export type CommerceCatalogBrandReference = {
  linkId: string;
  assetId: string;
  contentHash: string;
  nodeId: string;
  assetIndex: number;
  role: "logo" | "packaging" | "style-reference";
  purpose: string;
};

export type CommerceCatalogBrandStyleSnapshot = CommerceCatalogBrandStyle & {
  references: CommerceCatalogBrandReference[];
};

export type CommerceCatalogOptionValue = {
  name: string;
  value: string;
};

export type CommerceCatalogVariant = {
  variantId: string;
  title: string;
  optionValues: CommerceCatalogOptionValue[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type CommerceCatalogSku = {
  skuId: string;
  skuCode: string;
  title?: string;
  variantId?: string;
  platforms: CommercePlatformId[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type CommerceCatalogAssetLink = {
  linkId: string;
  kind: CommerceCatalogAssetKind;
  ownerType: CommerceCatalogAssetOwnerType;
  ownerId: string;
  role: string;
  assetId: string;
  contentHash: string;
  relativePath: string;
  fileName: string;
  width?: number;
  height?: number;
  nodeId?: string;
  assetIndex?: number;
  state?: CommerceCatalogResultState;
  taskScopeSnapshotHash?: string;
  sourceBindingId?: string;
  sourceLinkId?: string;
  commercePlanHash?: string;
  commerceSlotId?: string;
  commerceSlotIndex?: number;
  commerceLocaleCode?: string;
  commerceResultKey?: string;
  createdAt: string;
};

/** Catalog destination frozen for one SOURCE binding in a Commerce Goal. */
export type CommerceCatalogGoalTarget = {
  bindingId: string;
  catalogId: string;
  catalogRevision: number;
  productId: string;
  productRevision: number;
  ownerType: CommerceCatalogAssetOwnerType;
  ownerId: string;
  sourceLinkId: string;
  brandStyle?: CommerceCatalogBrandStyleSnapshot;
};

export type CommerceCatalogProduct = {
  productId: string;
  title: string;
  productCode?: string;
  brand?: string;
  brandStyle?: CommerceCatalogBrandStyle;
  platforms: CommercePlatformId[];
  status: CommerceCatalogProductStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  variants: CommerceCatalogVariant[];
  skus: CommerceCatalogSku[];
  assets: CommerceCatalogAssetLink[];
};

export type CommerceCatalogDocument = {
  schemaVersion: 1;
  catalogId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  products: CommerceCatalogProduct[];
};

export type CommerceCatalogAssetLocator = {
  nodeId: string;
  assetIndex: number;
  bindingId?: string;
};

export type CommerceCatalogResult = {
  ok: boolean;
  projectId?: string;
  catalogRevision?: number;
  catalog?: CommerceCatalogDocument;
  product?: CommerceCatalogProduct;
  groups?: CommerceCatalogComparisonGroup[];
  comparison?: CommerceCatalogComparisonGroup;
  changed?: boolean;
  errorCode?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export type CommerceCatalogComparisonCandidate = {
  linkId: string;
  assetId: string;
  contentHash: string;
  fileName: string;
  relativePath: string;
  width?: number;
  height?: number;
  nodeId?: string;
  assetIndex?: number;
  state: CommerceCatalogResultState;
  taskScopeSnapshotHash?: string;
  commercePlanHash?: string;
  commerceResultKey?: string;
  createdAt: string;
};

export type CommerceCatalogComparisonGroup = {
  groupKey: string;
  productId: string;
  productTitle: string;
  productRevision: number;
  ownerType: CommerceCatalogAssetOwnerType;
  ownerId: string;
  ownerLabel: string;
  sourceLinkId: string;
  sourceLabel: string;
  slotId: string;
  slotIndex: number;
  localeCode: string;
  role: string;
  approvedLinkIds: string[];
  candidates: CommerceCatalogComparisonCandidate[];
};

export type CommerceCatalogProductDraft = {
  productId?: string;
  expectedProductRevision?: number;
  title: string;
  productCode?: string;
  brand?: string;
  brandStyle?: CommerceCatalogBrandStyle;
  platforms?: CommercePlatformId[];
  variants?: Array<{
    variantId?: string;
    title: string;
    optionValues?: CommerceCatalogOptionValue[];
  }>;
  skus?: Array<{
    skuId?: string;
    skuCode: string;
    title?: string;
    platforms?: CommercePlatformId[];
    variantId?: string;
    variantIndex?: number;
  }>;
};

type CommerceCatalogSchema = {
  platforms: Array<{ id: CommercePlatformId; label: string }>;
  assetKinds: Array<{
    id: CommerceCatalogAssetKind;
    label: string;
    roles: Array<{ id: string; label: string }>;
  }>;
  ownerTypes: CommerceCatalogAssetOwnerType[];
  resultStates: CommerceCatalogResultState[];
  brandStyle: {
    schemaVersion: 1;
    referenceRoles: CommerceCatalogBrandReference["role"][];
    defaultLogoUsage: string;
  };
  limits: Record<string, number>;
};

const catalogSchema = commerceCatalogSchema as CommerceCatalogSchema;

export const COMMERCE_CATALOG_PLATFORMS = Object.freeze(catalogSchema.platforms.map((item) => ({ ...item })));
export const COMMERCE_CATALOG_ASSET_KINDS = Object.freeze(catalogSchema.assetKinds.map((item) => ({
  ...item,
  roles: item.roles.map((role) => ({ ...role }))
})));
export const COMMERCE_CATALOG_OWNER_TYPES = Object.freeze([...catalogSchema.ownerTypes]);
export const COMMERCE_CATALOG_RESULT_STATES = Object.freeze([...catalogSchema.resultStates]);
export const COMMERCE_CATALOG_BRAND_STYLE = Object.freeze({
  ...catalogSchema.brandStyle,
  referenceRoles: Object.freeze([...catalogSchema.brandStyle.referenceRoles])
});
export const COMMERCE_CATALOG_LIMITS = Object.freeze({ ...catalogSchema.limits });

const CATALOG_ID_PATTERN = /^catalog-[a-f0-9]{32}$/;
const PRODUCT_ID_PATTERN = /^product-[a-f0-9]{32}$/;
const VARIANT_ID_PATTERN = /^variant-[a-f0-9]{32}$/;
const SKU_ID_PATTERN = /^sku-[a-f0-9]{32}$/;
const MATERIAL_ID_PATTERN = /^material-[a-f0-9]{32}$/;
const BRAND_COLOR_PATTERN = /^#[a-f0-9]{6}$/;

function cleanBrandText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maximum) : "";
}

export function normalizeCommerceCatalogBrandStyle(value: unknown): CommerceCatalogBrandStyle | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Partial<CommerceCatalogBrandStyle>;
  const colors = [...new Set((Array.isArray(source.colors) ? source.colors : [])
    .map((item) => cleanBrandText(item, 7).toLowerCase())
    .filter((item) => BRAND_COLOR_PATTERN.test(item)))]
    .slice(0, COMMERCE_CATALOG_LIMITS.maxBrandColors);
  if (source.version !== 1 || typeof source.enabled !== "boolean") return undefined;
  return {
    version: 1,
    enabled: source.enabled,
    ...(cleanBrandText(source.fontFamily, COMMERCE_CATALOG_LIMITS.maxBrandFontLength) ? { fontFamily: cleanBrandText(source.fontFamily, COMMERCE_CATALOG_LIMITS.maxBrandFontLength) } : {}),
    colors,
    ...(cleanBrandText(source.logoUsage, COMMERCE_CATALOG_LIMITS.maxBrandRuleLength) ? { logoUsage: cleanBrandText(source.logoUsage, COMMERCE_CATALOG_LIMITS.maxBrandRuleLength) } : {}),
    ...(cleanBrandText(source.modelAppearance, COMMERCE_CATALOG_LIMITS.maxBrandRuleLength) ? { modelAppearance: cleanBrandText(source.modelAppearance, COMMERCE_CATALOG_LIMITS.maxBrandRuleLength) } : {}),
    ...(cleanBrandText(source.productAppearance, COMMERCE_CATALOG_LIMITS.maxBrandRuleLength) ? { productAppearance: cleanBrandText(source.productAppearance, COMMERCE_CATALOG_LIMITS.maxBrandRuleLength) } : {}),
    ...(cleanBrandText(source.visualStyle, COMMERCE_CATALOG_LIMITS.maxBrandRuleLength) ? { visualStyle: cleanBrandText(source.visualStyle, COMMERCE_CATALOG_LIMITS.maxBrandRuleLength) } : {})
  };
}

function normalizeCommerceCatalogBrandReference(value: unknown): CommerceCatalogBrandReference | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Partial<CommerceCatalogBrandReference>;
  const linkId = cleanBrandText(source.linkId, 48).toLowerCase();
  const assetId = cleanBrandText(source.assetId, 160);
  const contentHash = cleanBrandText(source.contentHash, 128).toLowerCase();
  const nodeId = cleanBrandText(source.nodeId, 160);
  const assetIndex = Number(source.assetIndex);
  const role = source.role;
  const purpose = cleanBrandText(source.purpose, 320);
  if (
    !MATERIAL_ID_PATTERN.test(linkId) || !assetId || !/^[a-f0-9]{32,128}$/.test(contentHash) || !nodeId ||
    !Number.isInteger(assetIndex) || assetIndex < 0 ||
    !COMMERCE_CATALOG_BRAND_STYLE.referenceRoles.includes(role as CommerceCatalogBrandReference["role"]) || !purpose
  ) return undefined;
  return { linkId, assetId, contentHash, nodeId, assetIndex, role: role as CommerceCatalogBrandReference["role"], purpose };
}

function normalizeCommerceCatalogBrandStyleSnapshot(value: unknown): CommerceCatalogBrandStyleSnapshot | undefined {
  const style = normalizeCommerceCatalogBrandStyle(value);
  if (!style?.enabled || !value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rawReferences = Array.isArray((value as { references?: unknown[] }).references) ? (value as { references: unknown[] }).references : [];
  const references = rawReferences.map(normalizeCommerceCatalogBrandReference);
  if (
    references.some((item) => !item) || references.length > COMMERCE_CATALOG_LIMITS.maxBrandReferencesPerSource ||
    new Set(references.map((item) => item!.linkId)).size !== references.length
  ) return undefined;
  return { ...style, references: references as CommerceCatalogBrandReference[] };
}

export function normalizeCommerceCatalogGoalTarget(value: unknown): CommerceCatalogGoalTarget | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Partial<CommerceCatalogGoalTarget>;
  const bindingId = typeof source.bindingId === "string" ? source.bindingId.trim().slice(0, 520) : "";
  const catalogId = typeof source.catalogId === "string" ? source.catalogId.trim().toLowerCase() : "";
  const productId = typeof source.productId === "string" ? source.productId.trim().toLowerCase() : "";
  const ownerType = source.ownerType;
  const ownerId = typeof source.ownerId === "string" ? source.ownerId.trim().toLowerCase() : "";
  const sourceLinkId = typeof source.sourceLinkId === "string" ? source.sourceLinkId.trim().toLowerCase() : "";
  const catalogRevision = Number(source.catalogRevision);
  const productRevision = Number(source.productRevision);
  const rawBrandStyle = source.brandStyle;
  const brandStyle = rawBrandStyle === undefined ? undefined : normalizeCommerceCatalogBrandStyleSnapshot(rawBrandStyle);
  const ownerIdValid = ownerType === "product"
    ? PRODUCT_ID_PATTERN.test(ownerId) && ownerId === productId
    : ownerType === "variant"
      ? VARIANT_ID_PATTERN.test(ownerId)
      : ownerType === "sku" && SKU_ID_PATTERN.test(ownerId);
  if (
    !bindingId || !CATALOG_ID_PATTERN.test(catalogId) || !PRODUCT_ID_PATTERN.test(productId) ||
    !ownerIdValid || !MATERIAL_ID_PATTERN.test(sourceLinkId) ||
    !Number.isSafeInteger(catalogRevision) || catalogRevision < 0 ||
    !Number.isSafeInteger(productRevision) || productRevision < 1 || (rawBrandStyle !== undefined && !brandStyle)
  ) return undefined;
  return {
    bindingId,
    catalogId,
    catalogRevision,
    productId,
    productRevision,
    ownerType: ownerType as CommerceCatalogAssetOwnerType,
    ownerId,
    sourceLinkId,
    ...(brandStyle ? { brandStyle } : {}),
  };
}

const ownerPriority: Record<CommerceCatalogAssetOwnerType, number> = {
  product: 1,
  variant: 2,
  sku: 3,
};

const brandReferenceRoleOrder: CommerceCatalogBrandReference["role"][] = ["logo", "packaging", "style-reference"];

function commerceBrandStyleSnapshotForTarget(
  product: CommerceCatalogProduct,
  ownerType: CommerceCatalogAssetOwnerType,
  ownerId: string,
): CommerceCatalogBrandStyleSnapshot | undefined {
  const style = normalizeCommerceCatalogBrandStyle(product.brandStyle);
  if (!style?.enabled) return undefined;
  const allowedOwnerIds = new Set([product.productId]);
  if (ownerType === "variant") allowedOwnerIds.add(ownerId);
  if (ownerType === "sku") {
    allowedOwnerIds.add(ownerId);
    const sku = product.skus.find((item) => item.skuId === ownerId);
    if (sku?.variantId) allowedOwnerIds.add(sku.variantId);
  }
  const references = brandReferenceRoleOrder.flatMap((role) => {
    const candidates = product.assets.filter((link) => (
      link.kind === "brand" && link.role === role && allowedOwnerIds.has(link.ownerId) &&
      Boolean(link.nodeId) && Number.isInteger(link.assetIndex) && Number(link.assetIndex) >= 0
    ));
    if (!candidates.length) return [];
    const maximumPriority = Math.max(...candidates.map((link) => ownerPriority[link.ownerType]));
    return candidates
      .filter((link) => ownerPriority[link.ownerType] === maximumPriority)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.linkId.localeCompare(right.linkId))
      .map((link): CommerceCatalogBrandReference => ({
        linkId: link.linkId,
        assetId: link.assetId,
        contentHash: link.contentHash,
        nodeId: link.nodeId!,
        assetIndex: link.assetIndex!,
        role,
        purpose: role === "logo"
          ? "品牌 Logo 身份参考；必须保持图形、文字、颜色和比例，不得改写或重新设计。"
          : role === "packaging"
            ? "品牌包装与商品外观参考；保持结构、标签、材质和配色一致。"
            : "品牌视觉风格参考；只迁移色彩、字体气质、光线和版式语言，不替换商品主体。"
      }));
  }).slice(0, COMMERCE_CATALOG_LIMITS.maxBrandReferencesPerSource);
  return { ...style, references };
}

/**
 * Resolve only unambiguous mother-image ownership. Every result stays tied to
 * its own SOURCE binding, so one Commerce Goal may span many products/SKUs.
 */
export function commerceCatalogGoalTargetsForSources(
  catalog: CommerceCatalogDocument,
  sources: readonly TaskAssetReference[],
): CommerceCatalogGoalTarget[] {
  const normalizedCatalogId = String(catalog?.catalogId || "").trim().toLowerCase();
  const catalogRevision = Number(catalog?.revision);
  if (!CATALOG_ID_PATTERN.test(normalizedCatalogId) || !Number.isSafeInteger(catalogRevision) || catalogRevision < 0) return [];
  const products = (Array.isArray(catalog.products) ? catalog.products : []).filter((product) => product.status !== "archived");
  return sources.flatMap((source) => {
    const bindingId = String(source.bindingId || "").trim().slice(0, 520);
    if (!bindingId) return [];
    const assetId = String(source.assetId || "").trim();
    const nodeId = String(source.ownerNodeId || source.nodeId || "").trim();
    const rawAssetIndex = Number.isInteger(Number(source.ownerAssetIndex))
      ? Number(source.ownerAssetIndex)
      : Number(source.assetIndex);
    const assetIndex = Number.isInteger(rawAssetIndex) && rawAssetIndex >= 0 ? rawAssetIndex : -1;
    const candidates = products.flatMap((product) => product.assets
      .filter((link) => link.kind === "master")
      .map((link) => ({ product, link })));
    const exact = assetId ? candidates.filter(({ link }) => link.assetId === assetId) : [];
    const located = nodeId && assetIndex >= 0
      ? candidates.filter(({ link }) => link.nodeId === nodeId && link.assetIndex === assetIndex)
      : [];
    const matched = exact.length ? exact : located;
    if (!matched.length) return [];
    const highestPriority = Math.max(...matched.map(({ link }) => ownerPriority[link.ownerType]));
    const preferred = [...new Map(matched
      .filter(({ link }) => ownerPriority[link.ownerType] === highestPriority)
      .map((candidate) => [`${candidate.product.productId}:${candidate.link.linkId}`, candidate] as const)).values()];
    if (preferred.length !== 1) return [];
    const { product, link } = preferred[0];
    const brandStyle = commerceBrandStyleSnapshotForTarget(product, link.ownerType, link.ownerId);
    const target = normalizeCommerceCatalogGoalTarget({
      bindingId,
      catalogId: normalizedCatalogId,
      catalogRevision,
      productId: product.productId,
      productRevision: product.revision,
      ownerType: link.ownerType,
      ownerId: link.ownerId,
      sourceLinkId: link.linkId,
      ...(brandStyle ? { brandStyle } : {}),
    });
    return target ? [target] : [];
  });
}
