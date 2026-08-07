"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const commerceCatalogSchema = require("../plugins/commerce-catalog-schema.json");

const COMMERCE_CATALOG_SCHEMA_VERSION = 1;
const COMMERCE_CATALOG_MAX_PRODUCTS = commerceCatalogSchema.limits.maxProducts;
const COMMERCE_CATALOG_MAX_VARIANTS = commerceCatalogSchema.limits.maxVariantsPerProduct;
const COMMERCE_CATALOG_MAX_SKUS = commerceCatalogSchema.limits.maxSkusPerProduct;
const COMMERCE_CATALOG_MAX_ASSETS = commerceCatalogSchema.limits.maxAssetsPerProduct;
const COMMERCE_CATALOG_MAX_ASSIGNMENT_BATCH = commerceCatalogSchema.limits.maxAssignmentBatch;
const COMMERCE_CATALOG_MAX_BRAND_COLORS = commerceCatalogSchema.limits.maxBrandColors;
const COMMERCE_CATALOG_MAX_BRAND_FONT_LENGTH = commerceCatalogSchema.limits.maxBrandFontLength;
const COMMERCE_CATALOG_MAX_BRAND_RULE_LENGTH = commerceCatalogSchema.limits.maxBrandRuleLength;
const COMMERCE_CATALOG_MAX_FILE_BYTES = 4 * 1024 * 1024;
const COMMERCE_CATALOG_MAX_ASSET_FILE_BYTES = 128 * 1024 * 1024;
const COMMERCE_CATALOG_ID_PATTERN = /^catalog-[a-f0-9]{32}$/;
const PRODUCT_ID_PATTERN = /^product-[a-f0-9]{32}$/;
const VARIANT_ID_PATTERN = /^variant-[a-f0-9]{32}$/;
const SKU_ID_PATTERN = /^sku-[a-f0-9]{32}$/;
const MATERIAL_ID_PATTERN = /^(?:material|result)-[a-f0-9]{32}$/;
const SOURCE_MATERIAL_ID_PATTERN = /^material-[a-f0-9]{32}$/;
const TASK_SCOPE_SNAPSHOT_HASH_PATTERN = /^scope-[a-f0-9]{32}$/;
const COMMERCE_PLAN_HASH_PATTERN = /^commerce-[a-f0-9]{32}$/;
const COMMERCE_RESULT_KEY_PATTERN = /^commerce-result-[a-f0-9]{32}$/;
const PLATFORM_IDS = new Set(commerceCatalogSchema.platforms.map((item) => item.id));
const ASSET_KINDS = new Set(commerceCatalogSchema.assetKinds.map((item) => item.id));
const ASSET_OWNER_TYPES = new Set(commerceCatalogSchema.ownerTypes);
const RESULT_STATES = new Set(commerceCatalogSchema.resultStates);
const BRAND_COLOR_PATTERN = /^#[a-f0-9]{6}$/;

class CommerceCatalogError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CommerceCatalogError";
    this.code = code;
    if (details && typeof details === "object") this.details = details;
  }
}

function cleanText(value, maximum = 240) {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").trim().slice(0, maximum)
    : "";
}

function validTimestamp(value) {
  const candidate = cleanText(value, 80);
  return candidate && Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : "";
}

function cleanPlatforms(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, 24).toLowerCase())
    .filter((item) => PLATFORM_IDS.has(item)))];
}

function cleanOptionValues(value) {
  const options = [];
  const seen = new Set();
  for (const item of Array.isArray(value) ? value : []) {
    const name = cleanText(item?.name, 60);
    const optionValue = cleanText(item?.value, 120);
    const key = name.toLocaleLowerCase();
    if (!name || !optionValue || seen.has(key)) continue;
    seen.add(key);
    options.push({ name, value: optionValue });
    if (options.length >= 24) break;
  }
  return options;
}

function sanitizeStoredBrandStyle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Number(value.version) !== 1 || typeof value.enabled !== "boolean") return null;
  const rawColors = Array.isArray(value.colors) ? value.colors : [];
  const colors = [...new Set(rawColors.map((item) => cleanText(item, 7).toLowerCase()))];
  if (
    colors.length !== rawColors.length || colors.length > COMMERCE_CATALOG_MAX_BRAND_COLORS ||
    colors.some((item) => !BRAND_COLOR_PATTERN.test(item))
  ) return null;
  const fontFamily = cleanText(value.fontFamily, COMMERCE_CATALOG_MAX_BRAND_FONT_LENGTH);
  const logoUsage = cleanText(value.logoUsage, COMMERCE_CATALOG_MAX_BRAND_RULE_LENGTH);
  const modelAppearance = cleanText(value.modelAppearance, COMMERCE_CATALOG_MAX_BRAND_RULE_LENGTH);
  const productAppearance = cleanText(value.productAppearance, COMMERCE_CATALOG_MAX_BRAND_RULE_LENGTH);
  const visualStyle = cleanText(value.visualStyle, COMMERCE_CATALOG_MAX_BRAND_RULE_LENGTH);
  return {
    version: 1,
    enabled: value.enabled,
    ...(fontFamily ? { fontFamily } : {}),
    colors,
    ...(logoUsage ? { logoUsage } : {}),
    ...(modelAppearance ? { modelAppearance } : {}),
    ...(productAppearance ? { productAppearance } : {}),
    ...(visualStyle ? { visualStyle } : {})
  };
}

function cleanRelativePath(value) {
  const candidate = cleanText(value, 1_024).replace(/\\/g, "/").replace(/^\.\//, "");
  if (!candidate || candidate.startsWith("/") || /^[a-z]:\//i.test(candidate)) return "";
  if (candidate.split("/").some((part) => !part || part === "." || part === "..")) return "";
  if (!/^(?:assets\/|output\/(?:imagegen|post)\/|\.naimage\/assets\/)/i.test(candidate)) return "";
  return candidate;
}

function newId(prefix) {
  return `${prefix}-${randomBytes(16).toString("hex")}`;
}

function emptyCommerceCatalog(now = new Date().toISOString(), catalogId = newId("catalog")) {
  return {
    schemaVersion: COMMERCE_CATALOG_SCHEMA_VERSION,
    catalogId,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    products: []
  };
}

function sanitizeStoredVariant(value) {
  const variantId = cleanText(value?.variantId, 48).toLowerCase();
  const title = cleanText(value?.title, 120);
  const createdAt = validTimestamp(value?.createdAt);
  const updatedAt = validTimestamp(value?.updatedAt);
  if (!VARIANT_ID_PATTERN.test(variantId) || !title || !createdAt || !updatedAt) return null;
  return {
    variantId,
    title,
    optionValues: cleanOptionValues(value?.optionValues),
    revision: Math.max(1, Math.floor(Number(value?.revision) || 1)),
    createdAt,
    updatedAt
  };
}

function sanitizeStoredSku(value, variantIds) {
  const skuId = cleanText(value?.skuId, 48).toLowerCase();
  const skuCode = cleanText(value?.skuCode, 120);
  const title = cleanText(value?.title, 120);
  const variantId = cleanText(value?.variantId, 48).toLowerCase();
  const createdAt = validTimestamp(value?.createdAt);
  const updatedAt = validTimestamp(value?.updatedAt);
  if (!SKU_ID_PATTERN.test(skuId) || !skuCode || !createdAt || !updatedAt) return null;
  if (variantId && !variantIds.has(variantId)) return null;
  return {
    skuId,
    skuCode,
    ...(title ? { title } : {}),
    ...(variantId ? { variantId } : {}),
    platforms: cleanPlatforms(value?.platforms),
    revision: Math.max(1, Math.floor(Number(value?.revision) || 1)),
    createdAt,
    updatedAt
  };
}

function sanitizeStoredAsset(value, ownerIds) {
  const linkId = cleanText(value?.linkId, 48).toLowerCase();
  const kind = cleanText(value?.kind, 24).toLowerCase();
  const ownerType = cleanText(value?.ownerType, 24).toLowerCase();
  const ownerId = cleanText(value?.ownerId, 48).toLowerCase();
  const assetId = cleanText(value?.assetId, 160);
  const contentHash = cleanText(value?.contentHash, 128).toLowerCase();
  const relativePath = cleanRelativePath(value?.relativePath);
  const fileName = cleanText(value?.fileName, 240);
  const createdAt = validTimestamp(value?.createdAt);
  if (!MATERIAL_ID_PATTERN.test(linkId) || !ASSET_KINDS.has(kind) || !ASSET_OWNER_TYPES.has(ownerType)) return null;
  if (!ownerIds[ownerType]?.has(ownerId) || !assetId || !contentHash || !relativePath || !fileName || !createdAt) return null;
  const state = cleanText(value?.state, 24).toLowerCase();
  const taskScopeSnapshotHash = cleanText(value?.taskScopeSnapshotHash, 64).toLowerCase();
  const commercePlanHash = cleanText(value?.commercePlanHash, 48).toLowerCase();
  const commerceResultKey = cleanText(value?.commerceResultKey, 64).toLowerCase();
  const sourceLinkId = cleanText(value?.sourceLinkId, 48).toLowerCase();
  const sourceBindingId = cleanText(value?.sourceBindingId, 520);
  const commerceSlotId = cleanText(value?.commerceSlotId, 80);
  const commerceSlotIndex = Number(value?.commerceSlotIndex);
  if (commerceResultKey && (
    kind !== "result" || !COMMERCE_RESULT_KEY_PATTERN.test(commerceResultKey) ||
    !TASK_SCOPE_SNAPSHOT_HASH_PATTERN.test(taskScopeSnapshotHash) || !sourceBindingId ||
    !SOURCE_MATERIAL_ID_PATTERN.test(sourceLinkId) || !COMMERCE_PLAN_HASH_PATTERN.test(commercePlanHash) ||
    !commerceSlotId || !Number.isInteger(commerceSlotIndex) || commerceSlotIndex < 0 || commerceSlotIndex >= 200
  )) return null;
  return {
    linkId,
    kind,
    ownerType,
    ownerId,
    role: cleanText(value?.role, 60) || (kind === "brand" ? "logo" : kind === "result" ? "listing" : "primary"),
    assetId,
    contentHash,
    relativePath,
    fileName,
    ...(Number.isFinite(Number(value?.width)) && Number(value.width) > 0 ? { width: Math.floor(Number(value.width)) } : {}),
    ...(Number.isFinite(Number(value?.height)) && Number(value.height) > 0 ? { height: Math.floor(Number(value.height)) } : {}),
    ...(cleanText(value?.nodeId, 160) ? { nodeId: cleanText(value.nodeId, 160) } : {}),
    ...(Number.isInteger(Number(value?.assetIndex)) && Number(value.assetIndex) >= 0 ? { assetIndex: Number(value.assetIndex) } : {}),
    ...(kind === "result" ? {
      state: RESULT_STATES.has(state) ? state : "candidate",
      ...(taskScopeSnapshotHash && TASK_SCOPE_SNAPSHOT_HASH_PATTERN.test(taskScopeSnapshotHash) ? { taskScopeSnapshotHash } : {}),
      ...(sourceBindingId ? { sourceBindingId } : {}),
      ...(sourceLinkId && SOURCE_MATERIAL_ID_PATTERN.test(sourceLinkId) ? { sourceLinkId } : {}),
      ...(commercePlanHash && COMMERCE_PLAN_HASH_PATTERN.test(commercePlanHash) ? { commercePlanHash } : {}),
      ...(commerceSlotId ? { commerceSlotId } : {}),
      ...(Number.isInteger(commerceSlotIndex) && commerceSlotIndex >= 0 && commerceSlotIndex < 200 ? { commerceSlotIndex } : {}),
      ...(cleanText(value?.commerceLocaleCode, 32) ? { commerceLocaleCode: cleanText(value.commerceLocaleCode, 32) } : {}),
      ...(commerceResultKey && COMMERCE_RESULT_KEY_PATTERN.test(commerceResultKey) ? { commerceResultKey } : {})
    } : {}),
    createdAt
  };
}

function sanitizeStoredProduct(value) {
  const productId = cleanText(value?.productId, 48).toLowerCase();
  const title = cleanText(value?.title, 160);
  const createdAt = validTimestamp(value?.createdAt);
  const updatedAt = validTimestamp(value?.updatedAt);
  const status = value?.status === "archived" ? "archived" : "active";
  const brandStyle = value?.brandStyle === undefined ? undefined : sanitizeStoredBrandStyle(value.brandStyle);
  if (!PRODUCT_ID_PATTERN.test(productId) || !title || !createdAt || !updatedAt || (value?.brandStyle !== undefined && !brandStyle)) return null;
  const variants = [];
  const variantIds = new Set();
  for (const rawVariant of Array.isArray(value?.variants) ? value.variants : []) {
    const variant = sanitizeStoredVariant(rawVariant);
    if (!variant || variantIds.has(variant.variantId)) return null;
    variantIds.add(variant.variantId);
    variants.push(variant);
    if (variants.length > COMMERCE_CATALOG_MAX_VARIANTS) return null;
  }
  const skus = [];
  const skuIds = new Set();
  const skuCodes = new Set();
  for (const rawSku of Array.isArray(value?.skus) ? value.skus : []) {
    const sku = sanitizeStoredSku(rawSku, variantIds);
    const codeKey = sku?.skuCode.toLocaleLowerCase();
    if (!sku || skuIds.has(sku.skuId) || skuCodes.has(codeKey)) return null;
    skuIds.add(sku.skuId);
    skuCodes.add(codeKey);
    skus.push(sku);
    if (skus.length > COMMERCE_CATALOG_MAX_SKUS) return null;
  }
  const ownerIds = { product: new Set([productId]), variant: variantIds, sku: skuIds };
  const assets = [];
  const linkIds = new Set();
  for (const rawAsset of Array.isArray(value?.assets) ? value.assets : []) {
    const asset = sanitizeStoredAsset(rawAsset, ownerIds);
    if (!asset || linkIds.has(asset.linkId)) return null;
    linkIds.add(asset.linkId);
    assets.push(asset);
    if (assets.length > COMMERCE_CATALOG_MAX_ASSETS) return null;
  }
  return {
    productId,
    title,
    ...(cleanText(value?.productCode, 120) ? { productCode: cleanText(value.productCode, 120) } : {}),
    ...(cleanText(value?.brand, 120) ? { brand: cleanText(value.brand, 120) } : {}),
    ...(brandStyle ? { brandStyle } : {}),
    platforms: cleanPlatforms(value?.platforms),
    status,
    revision: Math.max(1, Math.floor(Number(value?.revision) || 1)),
    createdAt,
    updatedAt,
    variants,
    skus,
    assets
  };
}

function comparisonIdentity(productId, asset) {
  return {
    productId,
    ownerType: asset.ownerType,
    ownerId: asset.ownerId,
    sourceLinkId: asset.sourceLinkId || "",
    slotId: asset.commerceSlotId || `role:${asset.role}`,
    slotIndex: Number.isInteger(asset.commerceSlotIndex) ? asset.commerceSlotIndex : -1,
    localeCode: asset.commerceLocaleCode || "source-language",
    role: asset.role
  };
}

function comparisonGroupKey(identity) {
  const material = [
    identity.productId,
    identity.ownerType,
    identity.ownerId,
    identity.sourceLinkId,
    identity.slotId,
    identity.slotIndex,
    identity.localeCode,
    identity.role
  ].join("\u0000");
  return `comparison-${createHash("sha256").update(material).digest("hex").slice(0, 32)}`;
}

function comparisonOwnerLabel(product, ownerType, ownerId) {
  if (ownerType === "sku") {
    const sku = product.skus.find((item) => item.skuId === ownerId);
    return sku ? `${sku.skuCode}${sku.title ? ` · ${sku.title}` : ""}` : ownerId;
  }
  if (ownerType === "variant") return product.variants.find((item) => item.variantId === ownerId)?.title || ownerId;
  return product.title;
}

function comparisonGroupsForDocument(document, productId = "") {
  const groups = new Map();
  for (const product of document.products) {
    if (product.status === "archived" || (productId && product.productId !== productId)) continue;
    for (const asset of product.assets) {
      if (asset.kind !== "result") continue;
      const identity = comparisonIdentity(product.productId, asset);
      const groupKey = comparisonGroupKey(identity);
      const current = groups.get(groupKey) || {
        groupKey,
        productId: product.productId,
        productTitle: product.title,
        productRevision: product.revision,
        ownerType: identity.ownerType,
        ownerId: identity.ownerId,
        ownerLabel: comparisonOwnerLabel(product, identity.ownerType, identity.ownerId),
        sourceLinkId: identity.sourceLinkId,
        sourceLabel: product.assets.find((item) => item.linkId === identity.sourceLinkId)?.fileName || "手动结果",
        slotId: identity.slotId,
        slotIndex: identity.slotIndex,
        localeCode: identity.localeCode,
        role: identity.role,
        candidates: []
      };
      current.candidates.push({
        linkId: asset.linkId,
        assetId: asset.assetId,
        contentHash: asset.contentHash,
        fileName: asset.fileName,
        relativePath: asset.relativePath,
        ...(asset.width ? { width: asset.width } : {}),
        ...(asset.height ? { height: asset.height } : {}),
        ...(asset.nodeId ? { nodeId: asset.nodeId } : {}),
        ...(Number.isInteger(asset.assetIndex) ? { assetIndex: asset.assetIndex } : {}),
        state: asset.state || "candidate",
        ...(asset.taskScopeSnapshotHash ? { taskScopeSnapshotHash: asset.taskScopeSnapshotHash } : {}),
        ...(asset.commercePlanHash ? { commercePlanHash: asset.commercePlanHash } : {}),
        ...(asset.commerceResultKey ? { commerceResultKey: asset.commerceResultKey } : {}),
        createdAt: asset.createdAt
      });
      groups.set(groupKey, current);
    }
  }
  return [...groups.values()]
    .filter((group) => group.candidates.length >= 2 && new Set(group.candidates.map((candidate) => candidate.contentHash)).size >= 2)
    .map((group) => ({
      ...group,
      approvedLinkIds: group.candidates.filter((candidate) => candidate.state === "approved").map((candidate) => candidate.linkId),
      candidates: group.candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.linkId.localeCompare(right.linkId))
    }))
    .sort((left, right) => (
      left.productTitle.localeCompare(right.productTitle, "zh-CN") ||
      left.ownerLabel.localeCompare(right.ownerLabel, "zh-CN") ||
      left.slotIndex - right.slotIndex ||
      left.slotId.localeCompare(right.slotId) ||
      left.localeCode.localeCompare(right.localeCode)
    ));
}

function sanitizeCommerceCatalogDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Number(value.schemaVersion) !== COMMERCE_CATALOG_SCHEMA_VERSION) return null;
  const catalogId = cleanText(value.catalogId, 48).toLowerCase();
  const createdAt = validTimestamp(value.createdAt);
  const updatedAt = validTimestamp(value.updatedAt);
  if (!COMMERCE_CATALOG_ID_PATTERN.test(catalogId) || !createdAt || !updatedAt) return null;
  const products = [];
  const productIds = new Set();
  const commerceResultKeys = new Set();
  for (const rawProduct of Array.isArray(value.products) ? value.products : []) {
    const product = sanitizeStoredProduct(rawProduct);
    if (!product || productIds.has(product.productId)) return null;
    productIds.add(product.productId);
    for (const asset of product.assets) {
      if (!asset.commerceResultKey) continue;
      if (commerceResultKeys.has(asset.commerceResultKey)) return null;
      commerceResultKeys.add(asset.commerceResultKey);
    }
    products.push(product);
    if (products.length > COMMERCE_CATALOG_MAX_PRODUCTS) return null;
  }
  return {
    schemaVersion: COMMERCE_CATALOG_SCHEMA_VERSION,
    catalogId,
    revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
    createdAt,
    updatedAt,
    products
  };
}

function normalizeCommerceCatalogGoalTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const bindingId = cleanText(value.bindingId, 520);
  const catalogId = cleanText(value.catalogId, 48).toLowerCase();
  const productId = cleanText(value.productId, 48).toLowerCase();
  const ownerType = cleanText(value.ownerType, 24).toLowerCase();
  const ownerId = cleanText(value.ownerId, 48).toLowerCase();
  const sourceLinkId = cleanText(value.sourceLinkId, 48).toLowerCase();
  const catalogRevision = Number(value.catalogRevision);
  const productRevision = Number(value.productRevision);
  const ownerIdValid = ownerType === "product"
    ? PRODUCT_ID_PATTERN.test(ownerId) && ownerId === productId
    : ownerType === "variant"
      ? VARIANT_ID_PATTERN.test(ownerId)
      : ownerType === "sku" && SKU_ID_PATTERN.test(ownerId);
  if (
    !bindingId || !COMMERCE_CATALOG_ID_PATTERN.test(catalogId) || !PRODUCT_ID_PATTERN.test(productId) ||
    !ownerIdValid || !SOURCE_MATERIAL_ID_PATTERN.test(sourceLinkId) ||
    !Number.isSafeInteger(catalogRevision) || catalogRevision < 0 ||
    !Number.isSafeInteger(productRevision) || productRevision < 1
  ) return null;
  return { bindingId, catalogId, catalogRevision, productId, productRevision, ownerType, ownerId, sourceLinkId };
}

function commerceResultRole(value) {
  const slotId = cleanText(value, 80).toLowerCase();
  if (/(?:^|[-_])(?:main|hero|cover)(?:[-_]|$)/.test(slotId)) return "main";
  if (/(?:dimension|dimensions|size|specification|specifications)/.test(slotId)) return "size";
  if (/(?:use-case|usage|scene|lifestyle)/.test(slotId)) return "scene";
  if (/(?:feature|detail|how-to|package|brand)/.test(slotId)) return "selling-point";
  return "listing";
}

function sameGoalResultCandidate(left, right) {
  if (!left || !right) return false;
  const leftTarget = left.target || {};
  const rightTarget = right.target || {};
  return leftTarget.bindingId === rightTarget.bindingId &&
    leftTarget.catalogId === rightTarget.catalogId &&
    leftTarget.catalogRevision === rightTarget.catalogRevision &&
    leftTarget.productId === rightTarget.productId &&
    leftTarget.productRevision === rightTarget.productRevision &&
    leftTarget.ownerType === rightTarget.ownerType &&
    leftTarget.ownerId === rightTarget.ownerId &&
    leftTarget.sourceLinkId === rightTarget.sourceLinkId &&
    left.sourceAssetId === right.sourceAssetId &&
    left.asset?.contentHash === right.asset?.contentHash &&
    left.sourceBindingId === right.sourceBindingId &&
    left.commercePlanHash === right.commercePlanHash &&
    left.commerceSlotId === right.commerceSlotId &&
    left.commerceSlotIndex === right.commerceSlotIndex &&
    left.commerceLocaleCode === right.commerceLocaleCode;
}

function sameArchivedGoalResult(prior, candidate, taskScopeSnapshotHash, role) {
  if (!prior || !candidate) return false;
  const priorProduct = prior.product;
  const priorAsset = prior.asset;
  return priorProduct?.productId === candidate.target.productId &&
    priorAsset?.kind === "result" &&
    priorAsset.ownerType === candidate.target.ownerType &&
    priorAsset.ownerId === candidate.target.ownerId &&
    priorAsset.role === role &&
    priorAsset.contentHash === candidate.asset.contentHash &&
    priorAsset.taskScopeSnapshotHash === taskScopeSnapshotHash &&
    priorAsset.sourceBindingId === candidate.sourceBindingId &&
    priorAsset.sourceLinkId === candidate.target.sourceLinkId &&
    priorAsset.commercePlanHash === candidate.commercePlanHash &&
    priorAsset.commerceSlotId === candidate.commerceSlotId &&
    priorAsset.commerceSlotIndex === candidate.commerceSlotIndex &&
    (priorAsset.commerceLocaleCode || "") === (candidate.commerceLocaleCode || "");
}

function createProjectCommerceCatalogService({
  getProjectById,
  projectCommerceCatalogPath,
  projectRelativePath,
  resolveProjectRelativePath,
  projectSessionFromDisk,
  readProjectList,
  now = () => new Date().toISOString(),
  allocateId = newId
} = {}) {
  if (![getProjectById, projectCommerceCatalogPath, projectRelativePath, resolveProjectRelativePath, projectSessionFromDisk, readProjectList].every((item) => typeof item === "function")) {
    throw new TypeError("commerce catalog project services are required");
  }

  function projectForId(projectIdValue) {
    const projectId = cleanText(projectIdValue, 160);
    const project = projectId ? getProjectById(projectId, readProjectList()) : null;
    if (!project) throw new CommerceCatalogError("PROJECT_NOT_FOUND", "目标项目不存在或已被移除。", { projectId });
    return project;
  }

  function writeDocument(project, document) {
    const sanitized = sanitizeCommerceCatalogDocument(document);
    if (!sanitized) throw new CommerceCatalogError("CATALOG_INVALID", "SKU 商品素材库包含无效数据，未写入磁盘。");
    const filePath = projectCommerceCatalogPath(project);
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      writeFileSync(tempPath, `${JSON.stringify(sanitized, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      renameSync(tempPath, filePath);
    } finally {
      rmSync(tempPath, { force: true });
    }
    return sanitized;
  }

  function readDocument(project, { create = true } = {}) {
    const filePath = projectCommerceCatalogPath(project);
    if (!existsSync(filePath)) {
      const empty = emptyCommerceCatalog(now(), allocateId("catalog"));
      return create ? writeDocument(project, empty) : empty;
    }
    let raw;
    try {
      const buffer = readFileSync(filePath);
      if (buffer.length > COMMERCE_CATALOG_MAX_FILE_BYTES) {
        throw new CommerceCatalogError("CATALOG_TOO_LARGE", "SKU 商品素材库超过 4MB 安全上限。", { maximumBytes: COMMERCE_CATALOG_MAX_FILE_BYTES });
      }
      raw = JSON.parse(buffer.toString("utf8"));
    } catch (error) {
      if (error instanceof CommerceCatalogError) throw error;
      throw new CommerceCatalogError("CATALOG_CORRUPT", "SKU 商品素材库无法读取；原文件已保留，未自动覆盖。", { path: filePath });
    }
    const document = sanitizeCommerceCatalogDocument(raw);
    if (!document) throw new CommerceCatalogError("CATALOG_CORRUPT", "SKU 商品素材库格式无效；原文件已保留，未自动覆盖。", { path: filePath });
    return document;
  }

  function assertCatalogRevision(document, value) {
    const expectedRevision = Math.floor(Number(value));
    if (!Number.isInteger(expectedRevision) || expectedRevision !== document.revision) {
      throw new CommerceCatalogError("CATALOG_REVISION_CONFLICT", "SKU 商品素材库已在其他窗口发生变化，请刷新后重试。", {
        expectedRevision: Number.isFinite(expectedRevision) ? expectedRevision : null,
        currentRevision: document.revision
      });
    }
  }

  function productForMutation(document, productIdValue, expectedProductRevision) {
    const productId = cleanText(productIdValue, 48).toLowerCase();
    const index = document.products.findIndex((item) => item.productId === productId);
    if (index < 0) throw new CommerceCatalogError("PRODUCT_NOT_FOUND", "商品不存在或已被移除。", { productId });
    const product = document.products[index];
    const expected = Math.floor(Number(expectedProductRevision));
    if (!Number.isInteger(expected) || expected !== product.revision) {
      throw new CommerceCatalogError("PRODUCT_REVISION_CONFLICT", "商品已在其他窗口发生变化，请刷新后重试。", {
        productId,
        expectedRevision: Number.isFinite(expected) ? expected : null,
        currentRevision: product.revision
      });
    }
    return { index, product };
  }

  function list(payload = {}) {
    const project = projectForId(payload.expectedProjectId ?? payload.projectId);
    const catalog = readDocument(project);
    return { ok: true, projectId: project.id, catalogRevision: catalog.revision, catalog };
  }

  function saveProduct(payload = {}) {
    const project = projectForId(payload.expectedProjectId);
    const document = readDocument(project);
    assertCatalogRevision(document, payload.expectedCatalogRevision);
    const title = cleanText(payload.title, 160);
    if (!title) throw new CommerceCatalogError("INVALID_PRODUCT", "商品名称不能为空。", { field: "title" });
    const requestedProductId = cleanText(payload.productId, 48).toLowerCase();
    const currentIndex = requestedProductId ? document.products.findIndex((item) => item.productId === requestedProductId) : -1;
    if (requestedProductId && currentIndex < 0) throw new CommerceCatalogError("PRODUCT_NOT_FOUND", "要编辑的商品不存在。", { productId: requestedProductId });
    if (currentIndex < 0 && document.products.length >= COMMERCE_CATALOG_MAX_PRODUCTS) {
      throw new CommerceCatalogError("CATALOG_LIMIT_REACHED", `每个项目最多管理 ${COMMERCE_CATALOG_MAX_PRODUCTS} 个商品。`);
    }
    const current = currentIndex >= 0 ? document.products[currentIndex] : null;
    if (current) productForMutation(document, current.productId, payload.expectedProductRevision);
    const brandStyle = payload.brandStyle === undefined
      ? current?.brandStyle
      : sanitizeStoredBrandStyle({
          ...payload.brandStyle,
          version: 1,
          ...(payload.brandStyle?.enabled && !cleanText(payload.brandStyle?.logoUsage, COMMERCE_CATALOG_MAX_BRAND_RULE_LENGTH)
            ? { logoUsage: commerceCatalogSchema.brandStyle.defaultLogoUsage }
            : {})
        });
    if (payload.brandStyle !== undefined && !brandStyle) {
      throw new CommerceCatalogError("INVALID_BRAND_STYLE", "品牌风格锁定包含无效字体、色板或约束文本。", { field: "brandStyle" });
    }
    const timestamp = now();
    const usedVariantIds = new Set();
    const variants = (Array.isArray(payload.variants) ? payload.variants : []).map((item, index) => {
      const existingId = cleanText(item?.variantId, 48).toLowerCase();
      const existing = existingId ? current?.variants.find((variant) => variant.variantId === existingId) : null;
      if (existingId && !existing) throw new CommerceCatalogError("VARIANT_NOT_FOUND", "商品变体已过期，请刷新后重试。", { variantId: existingId });
      const variantId = existing?.variantId || allocateId("variant");
      if (!VARIANT_ID_PATTERN.test(variantId) || usedVariantIds.has(variantId)) throw new CommerceCatalogError("INVALID_VARIANT", "商品变体 ID 无效或重复。", { index });
      const variantTitle = cleanText(item?.title, 120);
      if (!variantTitle) throw new CommerceCatalogError("INVALID_VARIANT", "商品变体名称不能为空。", { index });
      usedVariantIds.add(variantId);
      const optionValues = cleanOptionValues(item?.optionValues);
      const changed = !existing || existing.title !== variantTitle || JSON.stringify(existing.optionValues) !== JSON.stringify(optionValues);
      return {
        variantId,
        title: variantTitle,
        optionValues,
        revision: existing ? existing.revision + (changed ? 1 : 0) : 1,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: changed ? timestamp : existing?.updatedAt || timestamp
      };
    });
    if (variants.length > COMMERCE_CATALOG_MAX_VARIANTS) throw new CommerceCatalogError("PRODUCT_LIMIT_REACHED", `每个商品最多管理 ${COMMERCE_CATALOG_MAX_VARIANTS} 个变体。`);
    const variantByIndex = new Map(variants.map((item, index) => [index, item.variantId]));
    const usedSkuIds = new Set();
    const usedSkuCodes = new Set();
    const skus = (Array.isArray(payload.skus) ? payload.skus : []).map((item, index) => {
      const existingId = cleanText(item?.skuId, 48).toLowerCase();
      const existing = existingId ? current?.skus.find((sku) => sku.skuId === existingId) : null;
      if (existingId && !existing) throw new CommerceCatalogError("SKU_NOT_FOUND", "SKU 已过期，请刷新后重试。", { skuId: existingId });
      const skuId = existing?.skuId || allocateId("sku");
      const skuCode = cleanText(item?.skuCode, 120);
      const codeKey = skuCode.toLocaleLowerCase();
      if (!SKU_ID_PATTERN.test(skuId) || usedSkuIds.has(skuId) || !skuCode || usedSkuCodes.has(codeKey)) {
        throw new CommerceCatalogError("INVALID_SKU", "SKU 编码不能为空且不能重复。", { index });
      }
      usedSkuIds.add(skuId);
      usedSkuCodes.add(codeKey);
      const requestedVariantId = cleanText(item?.variantId, 48).toLowerCase();
      const variantIndex = Number.isInteger(Number(item?.variantIndex)) ? Number(item.variantIndex) : -1;
      const variantId = requestedVariantId || variantByIndex.get(variantIndex) || "";
      if (variantId && !usedVariantIds.has(variantId)) throw new CommerceCatalogError("VARIANT_NOT_FOUND", "SKU 关联的变体不存在。", { index, variantId });
      const titleValue = cleanText(item?.title, 120);
      const platforms = cleanPlatforms(item?.platforms);
      const changed = !existing || existing.skuCode !== skuCode || (existing.title || "") !== titleValue || (existing.variantId || "") !== variantId || JSON.stringify(existing.platforms) !== JSON.stringify(platforms);
      return {
        skuId,
        skuCode,
        ...(titleValue ? { title: titleValue } : {}),
        ...(variantId ? { variantId } : {}),
        platforms,
        revision: existing ? existing.revision + (changed ? 1 : 0) : 1,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: changed ? timestamp : existing?.updatedAt || timestamp
      };
    });
    if (skus.length > COMMERCE_CATALOG_MAX_SKUS) throw new CommerceCatalogError("PRODUCT_LIMIT_REACHED", `每个商品最多管理 ${COMMERCE_CATALOG_MAX_SKUS} 个 SKU。`);
    const retainedOwnerIds = new Set([requestedProductId, ...variants.map((item) => item.variantId), ...skus.map((item) => item.skuId)]);
    const orphanedAssets = (current?.assets || []).filter((item) => item.ownerType !== "product" && !retainedOwnerIds.has(item.ownerId));
    if (orphanedAssets.length) {
      throw new CommerceCatalogError("ASSET_OWNER_IN_USE", "仍有素材关联到已移除的变体或 SKU，请先解除这些素材。", {
        linkIds: orphanedAssets.slice(0, 40).map((item) => item.linkId)
      });
    }
    const productId = current?.productId || allocateId("product");
    const nextProduct = {
      productId,
      title,
      ...(cleanText(payload.productCode, 120) ? { productCode: cleanText(payload.productCode, 120) } : {}),
      ...(cleanText(payload.brand, 120) ? { brand: cleanText(payload.brand, 120) } : {}),
      ...(brandStyle ? { brandStyle } : {}),
      platforms: cleanPlatforms(payload.platforms),
      status: current?.status || "active",
      revision: (current?.revision || 0) + 1,
      createdAt: current?.createdAt || timestamp,
      updatedAt: timestamp,
      variants,
      skus,
      assets: current?.assets || []
    };
    const products = [...document.products];
    if (currentIndex >= 0) products[currentIndex] = nextProduct;
    else products.push(nextProduct);
    const saved = writeDocument(project, { ...document, revision: document.revision + 1, updatedAt: timestamp, products });
    return { ok: true, changed: true, projectId: project.id, catalogRevision: saved.revision, product: nextProduct };
  }

  function archiveProduct(payload = {}) {
    const project = projectForId(payload.expectedProjectId);
    const document = readDocument(project);
    assertCatalogRevision(document, payload.expectedCatalogRevision);
    const { index, product } = productForMutation(document, payload.productId, payload.expectedProductRevision);
    const archived = payload.archived !== false;
    const status = archived ? "archived" : "active";
    if (product.status === status) return { ok: true, changed: false, projectId: project.id, catalogRevision: document.revision, product };
    const timestamp = now();
    const nextProduct = { ...product, status, revision: product.revision + 1, updatedAt: timestamp };
    const products = [...document.products];
    products[index] = nextProduct;
    const saved = writeDocument(project, { ...document, revision: document.revision + 1, updatedAt: timestamp, products });
    return { ok: true, changed: true, projectId: project.id, catalogRevision: saved.revision, product: nextProduct };
  }

  function authoritativeAsset(project, nodeIdValue, assetIndexValue, sessionValue = undefined) {
    const nodeId = cleanText(nodeIdValue, 160);
    const assetIndex = Math.floor(Number(assetIndexValue));
    const session = sessionValue ?? projectSessionFromDisk(project);
    const node = (Array.isArray(session?.nodes) ? session.nodes : []).find((item) => item?.id === nodeId);
    const asset = Number.isInteger(assetIndex) && assetIndex >= 0 ? node?.assets?.[assetIndex] : null;
    if (!node || node.type !== "image" || !asset || asset.status === "error" || asset.status === "pending") {
      throw new CommerceCatalogError("ASSET_NOT_FOUND", "画布图片不存在、尚未完成或已被移除。", { nodeId, assetIndex });
    }
    const assetId = cleanText(asset.assetId, 160);
    const contentHash = cleanText(asset.contentHash, 128).toLowerCase();
    const relativePath = cleanRelativePath(asset.relativePath)
      || cleanRelativePath(projectRelativePath(project.path, asset.path));
    const resolvedPath = relativePath ? resolveProjectRelativePath(project.path, relativePath) : "";
    let fileIsManaged = false;
    let actualContentHash = "";
    try {
      const stat = resolvedPath ? lstatSync(resolvedPath) : null;
      const realProjectPath = realpathSync(project.path);
      const realAssetPath = resolvedPath ? realpathSync(resolvedPath) : "";
      const relativeRealPath = realAssetPath ? path.relative(realProjectPath, realAssetPath) : "";
      fileIsManaged = Boolean(
        stat?.isFile() && !stat.isSymbolicLink() && stat.size > 0 &&
        stat.size <= COMMERCE_CATALOG_MAX_ASSET_FILE_BYTES && relativeRealPath &&
        !relativeRealPath.startsWith(`..${path.sep}`) && relativeRealPath !== ".." && !path.isAbsolute(relativeRealPath)
      );
      if (fileIsManaged) actualContentHash = createHash("sha256").update(readFileSync(resolvedPath)).digest("hex");
    } catch {
      fileIsManaged = false;
    }
    if (!assetId || !contentHash || !relativePath || !resolvedPath || !fileIsManaged) {
      throw new CommerceCatalogError("ASSET_NOT_MANAGED", "该图片尚未成为可持久化的项目素材，请先重新导入或等待保存完成。", { nodeId, assetIndex });
    }
    if (actualContentHash !== contentHash) {
      throw new CommerceCatalogError("ASSET_HASH_MISMATCH", "The managed image content no longer matches the canvas record.", { nodeId, assetIndex });
    }
    return {
      assetId,
      contentHash,
      relativePath,
      fileName: cleanText(asset.fileName || path.basename(asset.path || relativePath), 240),
      ...(Number(asset.width) > 0 ? { width: Math.floor(Number(asset.width)) } : {}),
      ...(Number(asset.height) > 0 ? { height: Math.floor(Number(asset.height)) } : {}),
      nodeId,
      assetIndex
    };
  }

  function assignAssets(payload = {}) {
    const project = projectForId(payload.expectedProjectId);
    const document = readDocument(project);
    assertCatalogRevision(document, payload.expectedCatalogRevision);
    const { index, product } = productForMutation(document, payload.productId, payload.expectedProductRevision);
    if (product.status === "archived") throw new CommerceCatalogError("PRODUCT_ARCHIVED", "已归档商品不能继续添加素材。", { productId: product.productId });
    const kind = cleanText(payload.kind, 24).toLowerCase();
    const ownerType = cleanText(payload.ownerType || "product", 24).toLowerCase();
    const ownerId = ownerType === "product" ? product.productId : cleanText(payload.ownerId, 48).toLowerCase();
    if (!ASSET_KINDS.has(kind) || !ASSET_OWNER_TYPES.has(ownerType)) throw new CommerceCatalogError("INVALID_ASSET_ROLE", "素材类型或归属范围无效。");
    const ownerExists = ownerType === "product"
      || (ownerType === "variant" ? product.variants : product.skus).some((item) => item[ownerType === "variant" ? "variantId" : "skuId"] === ownerId);
    if (!ownerExists) throw new CommerceCatalogError("ASSET_OWNER_NOT_FOUND", "素材关联的商品变体或 SKU 不存在。", { ownerType, ownerId });
    const inputs = Array.isArray(payload.assets) ? payload.assets : [];
    if (!inputs.length || inputs.length > COMMERCE_CATALOG_MAX_ASSIGNMENT_BATCH) {
      throw new CommerceCatalogError("INVALID_ASSETS", `每次需要关联 1 至 ${COMMERCE_CATALOG_MAX_ASSIGNMENT_BATCH} 张画布图片。`);
    }
    const role = cleanText(payload.role, 60) || (kind === "brand" ? "logo" : kind === "result" ? "listing" : "primary");
    const nextAssets = [...product.assets];
    let changed = false;
    for (const input of inputs) {
      const asset = authoritativeAsset(project, input?.nodeId, input?.assetIndex);
      const duplicate = nextAssets.some((item) => item.kind === kind && item.ownerType === ownerType && item.ownerId === ownerId && item.role === role && item.assetId === asset.assetId);
      if (duplicate) continue;
      nextAssets.push({
        linkId: allocateId(kind === "result" ? "result" : "material"),
        kind,
        ownerType,
        ownerId,
        role,
        ...asset,
        ...(kind === "result" ? { state: "candidate" } : {}),
        createdAt: now()
      });
      changed = true;
    }
    if (!changed) return { ok: true, changed: false, projectId: project.id, catalogRevision: document.revision, product };
    if (nextAssets.length > COMMERCE_CATALOG_MAX_ASSETS) throw new CommerceCatalogError("PRODUCT_LIMIT_REACHED", `每个商品最多关联 ${COMMERCE_CATALOG_MAX_ASSETS} 条素材记录。`);
    const timestamp = now();
    const nextProduct = { ...product, assets: nextAssets, revision: product.revision + 1, updatedAt: timestamp };
    const products = [...document.products];
    products[index] = nextProduct;
    const saved = writeDocument(project, { ...document, revision: document.revision + 1, updatedAt: timestamp, products });
    return { ok: true, changed: true, projectId: project.id, catalogRevision: saved.revision, product: nextProduct };
  }

  function reconcileGoalResults(payload = {}) {
    const project = projectForId(payload.expectedProjectId);
    const taskScopeSnapshotHash = cleanText(payload.taskScopeSnapshotHash, 64).toLowerCase();
    if (!TASK_SCOPE_SNAPSHOT_HASH_PATTERN.test(taskScopeSnapshotHash)) {
      throw new CommerceCatalogError("INVALID_TASK_SCOPE", "Commerce Goal 缺少有效的 TaskScope 快照标识。");
    }
    const session = projectSessionFromDisk(project);
    const nodes = Array.isArray(session?.nodes) ? session.nodes : [];
    const candidatesByKey = new Map();
    let scanned = 0;
    for (const node of nodes) {
      if (!node || node.type !== "image") continue;
      // Failed and in-flight nodes are intentionally ignored. A completed node
      // with incomplete commerce provenance is a hard error so a partial Goal
      // cannot be silently archived.
      if (node.imageState !== "done") continue;
      const groupedEntries = (Array.isArray(node.imageCollection?.items) ? node.imageCollection.items : [])
        .filter((item) => item?.status === "done" && item.taskProvenance?.taskScopeSnapshotHash === taskScopeSnapshotHash)
        .map((item) => ({ provenance: item.taskProvenance, assetIndex: Number(item.assetIndex) - 1 }));
      const entries = groupedEntries.length
        ? groupedEntries
        : node.taskProvenance?.taskScopeSnapshotHash === taskScopeSnapshotHash
          ? [{ provenance: node.taskProvenance, assetIndex: 0 }]
          : [];
      for (const entry of entries) {
        scanned += 1;
        const provenance = entry.provenance;
        const target = normalizeCommerceCatalogGoalTarget(provenance.commerceCatalogTarget);
        const sourceBindingId = cleanText(provenance.sourceBindingId, 520);
        const commercePlanHash = cleanText(provenance.commercePlanHash, 48).toLowerCase();
        const commerceResultKey = cleanText(provenance.commerceResultKey, 64).toLowerCase();
        const commerceSlotId = cleanText(provenance.commerceSlotId, 80);
        const commerceSlotIndex = Number(provenance.commerceSlotIndex);
        if (
          !target || target.bindingId !== sourceBindingId || !COMMERCE_PLAN_HASH_PATTERN.test(commercePlanHash) ||
          !COMMERCE_RESULT_KEY_PATTERN.test(commerceResultKey) || !commerceSlotId ||
          !Number.isInteger(commerceSlotIndex) || commerceSlotIndex < 0 || commerceSlotIndex >= 200 ||
          !cleanText(provenance.sourceAssetId, 160) ||
          (provenance.sourceNodeId && node.parentId !== provenance.sourceNodeId)
        ) {
          throw new CommerceCatalogError("RESULT_PROVENANCE_INVALID", "Commerce Goal 结果的 SKU 归属来源校验失败。", { nodeId: node.id });
        }
        if (!Array.isArray(node.assets) || !Number.isInteger(entry.assetIndex) || entry.assetIndex < 0 || entry.assetIndex >= node.assets.length) {
          throw new CommerceCatalogError("RESULT_SHAPE_INVALID", "Commerce Goal 图片组条目缺少对应的已完成图片。", { nodeId: node.id });
        }
        if (!groupedEntries.length && node.assets.length !== 1) {
          throw new CommerceCatalogError("RESULT_SHAPE_INVALID", "旧版 Commerce Goal 的每个结果节点必须只包含一张已完成图片。", { nodeId: node.id });
        }
        const asset = authoritativeAsset(project, node.id, entry.assetIndex, session);
        const candidate = {
          target,
          asset,
          sourceAssetId: cleanText(provenance.sourceAssetId, 160),
          sourceBindingId,
          commercePlanHash,
          commerceResultKey,
          commerceSlotId,
          commerceSlotIndex,
          commerceLocaleCode: cleanText(provenance.commerceLocaleCode, 32)
        };
        const duplicate = candidatesByKey.get(commerceResultKey);
        if (duplicate) {
          if (!sameGoalResultCandidate(duplicate, candidate)) {
            throw new CommerceCatalogError("RESULT_OPERATION_CONFLICT", "同一 Commerce 结果标识指向了不同图片或 SKU，未写入素材库。", { commerceResultKey });
          }
          continue;
        }
        candidatesByKey.set(commerceResultKey, candidate);
        if (candidatesByKey.size > COMMERCE_CATALOG_MAX_ASSIGNMENT_BATCH) {
          throw new CommerceCatalogError(
            "GOAL_RESULT_LIMIT_REACHED",
            "Commerce Goal result count exceeds the assignment batch limit.",
            { maximum: COMMERCE_CATALOG_MAX_ASSIGNMENT_BATCH }
          );
        }
      }
    }

    const document = readDocument(project);
    let candidates = [...candidatesByKey.values()];
    if (!candidates.length) {
      return {
        ok: true,
        changed: false,
        projectId: project.id,
        catalogRevision: document.revision,
        details: { scanned, added: 0, existing: 0 }
      };
    }
    const existingResults = new Map();
    document.products.forEach((product) => product.assets.forEach((asset) => {
      if (asset.kind === "result" && asset.commerceResultKey) existingResults.set(asset.commerceResultKey, { product, asset });
    }));
    let existing = 0;
    candidates = candidates.filter((candidate) => {
      const prior = existingResults.get(candidate.commerceResultKey);
      if (!prior) return true;
      const role = commerceResultRole(candidate.commerceSlotId);
      const same = sameArchivedGoalResult(prior, candidate, taskScopeSnapshotHash, role);
      if (!same) {
        throw new CommerceCatalogError("RESULT_OPERATION_CONFLICT", "同一 Commerce 结果标识已归档到不同图片或 SKU，未修改素材库。", {
          commerceResultKey: candidate.commerceResultKey
        });
      }
      existing += 1;
      return false;
    });
    if (!candidates.length) {
      return {
        ok: true,
        changed: false,
        projectId: project.id,
        catalogRevision: document.revision,
        details: { scanned, added: 0, existing }
      };
    }
    for (const { target } of candidates) {
      if (target.catalogId !== document.catalogId) {
        throw new CommerceCatalogError("CATALOG_ID_CONFLICT", "Commerce Goal 冻结的 SKU 素材库已被替换，结果未自动归档。", {
          expectedCatalogId: target.catalogId,
          currentCatalogId: document.catalogId
        });
      }
      assertCatalogRevision(document, target.catalogRevision);
    }

    const productIndexes = new Map(document.products.map((product, index) => [product.productId, index]));
    const additions = new Map();
    for (const candidate of candidates) {
      const { target, asset, commerceResultKey } = candidate;
      const productIndex = productIndexes.get(target.productId);
      const product = Number.isInteger(productIndex) ? document.products[productIndex] : null;
      if (!product) throw new CommerceCatalogError("PRODUCT_NOT_FOUND", "Commerce Goal 目标商品已被移除，结果未自动归档。", { productId: target.productId });
      if (product.revision !== target.productRevision) {
        throw new CommerceCatalogError("PRODUCT_REVISION_CONFLICT", "Commerce Goal 目标商品在生成期间发生变化，结果未自动归档。", {
          productId: product.productId,
          expectedRevision: target.productRevision,
          currentRevision: product.revision
        });
      }
      if (product.status === "archived") throw new CommerceCatalogError("PRODUCT_ARCHIVED", "Commerce Goal 目标商品已归档，结果未自动归档。", { productId: product.productId });
      const sourceLink = product.assets.find((item) => item.linkId === target.sourceLinkId);
      if (
        !sourceLink || sourceLink.kind !== "master" || sourceLink.ownerType !== target.ownerType ||
        sourceLink.ownerId !== target.ownerId || sourceLink.assetId !== candidate.sourceAssetId
      ) {
        throw new CommerceCatalogError("SOURCE_LINK_CONFLICT", "Commerce Goal 冻结的母图归属已发生变化，结果未自动归档。", {
          productId: product.productId,
          sourceLinkId: target.sourceLinkId
        });
      }
      const role = commerceResultRole(candidate.commerceSlotId);
      const prior = existingResults.get(commerceResultKey);
      if (prior) {
        const same = sameArchivedGoalResult(prior, candidate, taskScopeSnapshotHash, role);
        if (!same) {
          throw new CommerceCatalogError("RESULT_OPERATION_CONFLICT", "同一 Commerce 结果标识已归档到不同图片或 SKU，未修改素材库。", { commerceResultKey });
        }
        existing += 1;
        continue;
      }
      const link = {
        linkId: allocateId("result"),
        kind: "result",
        ownerType: target.ownerType,
        ownerId: target.ownerId,
        role,
        ...asset,
        state: "candidate",
        taskScopeSnapshotHash,
        sourceBindingId: candidate.sourceBindingId,
        sourceLinkId: target.sourceLinkId,
        commercePlanHash: candidate.commercePlanHash,
        ...(candidate.commerceSlotId ? { commerceSlotId: candidate.commerceSlotId } : {}),
        ...(Number.isInteger(candidate.commerceSlotIndex) ? { commerceSlotIndex: candidate.commerceSlotIndex } : {}),
        ...(candidate.commerceLocaleCode ? { commerceLocaleCode: candidate.commerceLocaleCode } : {}),
        commerceResultKey,
        createdAt: now()
      };
      const productAdditions = additions.get(product.productId) || [];
      productAdditions.push(link);
      additions.set(product.productId, productAdditions);
      existingResults.set(commerceResultKey, { product, asset: link });
    }
    const added = [...additions.values()].reduce((total, items) => total + items.length, 0);
    if (!added) {
      return {
        ok: true,
        changed: false,
        projectId: project.id,
        catalogRevision: document.revision,
        details: { scanned, added: 0, existing }
      };
    }
    const timestamp = now();
    const products = document.products.map((product) => {
      const productAdditions = additions.get(product.productId);
      if (!productAdditions?.length) return product;
      const assets = [...product.assets, ...productAdditions];
      if (assets.length > COMMERCE_CATALOG_MAX_ASSETS) {
        throw new CommerceCatalogError("PRODUCT_LIMIT_REACHED", `每个商品最多关联 ${COMMERCE_CATALOG_MAX_ASSETS} 条素材记录。`, { productId: product.productId });
      }
      return { ...product, assets, revision: product.revision + 1, updatedAt: timestamp };
    });
    const saved = writeDocument(project, {
      ...document,
      revision: document.revision + 1,
      updatedAt: timestamp,
      products
    });
    return {
      ok: true,
      changed: true,
      projectId: project.id,
      catalogRevision: saved.revision,
      catalog: saved,
      details: { scanned, added, existing }
    };
  }

  function removeAsset(payload = {}) {
    const project = projectForId(payload.expectedProjectId);
    const document = readDocument(project);
    assertCatalogRevision(document, payload.expectedCatalogRevision);
    const { index, product } = productForMutation(document, payload.productId, payload.expectedProductRevision);
    const linkId = cleanText(payload.linkId, 48).toLowerCase();
    if (!product.assets.some((item) => item.linkId === linkId)) throw new CommerceCatalogError("ASSET_LINK_NOT_FOUND", "素材关联不存在或已被移除。", { linkId });
    const timestamp = now();
    const nextProduct = { ...product, assets: product.assets.filter((item) => item.linkId !== linkId), revision: product.revision + 1, updatedAt: timestamp };
    const products = [...document.products];
    products[index] = nextProduct;
    const saved = writeDocument(project, { ...document, revision: document.revision + 1, updatedAt: timestamp, products });
    return { ok: true, changed: true, projectId: project.id, catalogRevision: saved.revision, product: nextProduct };
  }

  function updateResultState(payload = {}) {
    const project = projectForId(payload.expectedProjectId);
    const document = readDocument(project);
    assertCatalogRevision(document, payload.expectedCatalogRevision);
    const { index, product } = productForMutation(document, payload.productId, payload.expectedProductRevision);
    const linkId = cleanText(payload.linkId, 48).toLowerCase();
    const state = cleanText(payload.state, 24).toLowerCase();
    if (!RESULT_STATES.has(state)) throw new CommerceCatalogError("INVALID_RESULT_STATE", "生成结果状态无效。", { state });
    const assetIndex = product.assets.findIndex((item) => item.linkId === linkId && item.kind === "result");
    if (assetIndex < 0) throw new CommerceCatalogError("ASSET_LINK_NOT_FOUND", "生成结果不存在或已被移除。", { linkId });
    if (product.assets[assetIndex].state === state) return { ok: true, changed: false, projectId: project.id, catalogRevision: document.revision, product };
    const timestamp = now();
    const assets = [...product.assets];
    assets[assetIndex] = { ...assets[assetIndex], state };
    const nextProduct = { ...product, assets, revision: product.revision + 1, updatedAt: timestamp };
    const products = [...document.products];
    products[index] = nextProduct;
    const saved = writeDocument(project, { ...document, revision: document.revision + 1, updatedAt: timestamp, products });
    return { ok: true, changed: true, projectId: project.id, catalogRevision: saved.revision, product: nextProduct };
  }

  function listComparisons(payload = {}) {
    const project = projectForId(payload.expectedProjectId);
    const document = readDocument(project);
    const productId = cleanText(payload.productId, 48).toLowerCase();
    if (productId && !PRODUCT_ID_PATTERN.test(productId)) {
      throw new CommerceCatalogError("PRODUCT_NOT_FOUND", "A/B 比较指定的商品无效。", { productId });
    }
    return {
      ok: true,
      changed: false,
      projectId: project.id,
      catalogRevision: document.revision,
      groups: comparisonGroupsForDocument(document, productId)
    };
  }

  function selectComparisonWinner(payload = {}) {
    const project = projectForId(payload.expectedProjectId);
    const document = readDocument(project);
    assertCatalogRevision(document, payload.expectedCatalogRevision);
    const { index, product } = productForMutation(document, payload.productId, payload.expectedProductRevision);
    const groupKey = cleanText(payload.groupKey, 48).toLowerCase();
    const winnerLinkId = cleanText(payload.winnerLinkId, 48).toLowerCase();
    if (!/^comparison-[a-f0-9]{32}$/.test(groupKey)) throw new CommerceCatalogError("COMPARISON_GROUP_INVALID", "A/B 比较组无效。", { groupKey });
    const group = comparisonGroupsForDocument({ ...document, products: [product] }, product.productId)
      .find((candidate) => candidate.groupKey === groupKey);
    if (!group) throw new CommerceCatalogError("COMPARISON_GROUP_NOT_FOUND", "A/B 比较组已变化或不再包含多个方案，请刷新后重试。", { groupKey });
    if (!group.candidates.some((candidate) => candidate.linkId === winnerLinkId)) {
      throw new CommerceCatalogError("COMPARISON_WINNER_INVALID", "选定结果不属于当前 A/B 比较组。", { groupKey, winnerLinkId });
    }
    const memberIds = new Set(group.candidates.map((candidate) => candidate.linkId));
    let changed = false;
    const assets = product.assets.map((asset) => {
      if (!memberIds.has(asset.linkId)) return asset;
      const state = asset.linkId === winnerLinkId ? "approved" : "rejected";
      if (asset.state === state) return asset;
      changed = true;
      return { ...asset, state };
    });
    if (!changed) {
      return { ok: true, changed: false, projectId: project.id, catalogRevision: document.revision, product, comparison: group };
    }
    const timestamp = now();
    const nextProduct = { ...product, assets, revision: product.revision + 1, updatedAt: timestamp };
    const products = [...document.products];
    products[index] = nextProduct;
    const saved = writeDocument(project, { ...document, revision: document.revision + 1, updatedAt: timestamp, products });
    const comparison = comparisonGroupsForDocument(saved, product.productId).find((candidate) => candidate.groupKey === groupKey);
    return {
      ok: true,
      changed: true,
      projectId: project.id,
      catalogRevision: saved.revision,
      product: nextProduct,
      comparison,
      details: { winnerLinkId, rejectedLinkIds: [...memberIds].filter((linkId) => linkId !== winnerLinkId) }
    };
  }

  function replaceCatalogForProject(project, value) {
    const document = sanitizeCommerceCatalogDocument(value);
    if (!document) throw new CommerceCatalogError("CATALOG_INVALID", "导入的 SKU 商品素材库无效。");
    return writeDocument(project, document);
  }

  return {
    archiveProduct,
    assignAssets,
    list,
    listComparisons,
    readDocument,
    removeAsset,
    reconcileGoalResults,
    replaceCatalogForProject,
    saveProduct,
    selectComparisonWinner,
    updateResultState,
    writeDocument
  };
}

module.exports = {
  ASSET_KINDS,
  ASSET_OWNER_TYPES,
  COMMERCE_CATALOG_ID_PATTERN,
  COMMERCE_CATALOG_MAX_ASSETS,
  COMMERCE_CATALOG_MAX_FILE_BYTES,
  COMMERCE_CATALOG_MAX_PRODUCTS,
  COMMERCE_CATALOG_MAX_SKUS,
  COMMERCE_CATALOG_MAX_VARIANTS,
  COMMERCE_CATALOG_SCHEMA_VERSION,
  CommerceCatalogError,
  comparisonGroupKey,
  comparisonGroupsForDocument,
  MATERIAL_ID_PATTERN,
  PLATFORM_IDS,
  PRODUCT_ID_PATTERN,
  RESULT_STATES,
  SKU_ID_PATTERN,
  VARIANT_ID_PATTERN,
  createProjectCommerceCatalogService,
  emptyCommerceCatalog,
  sanitizeCommerceCatalogDocument
};
