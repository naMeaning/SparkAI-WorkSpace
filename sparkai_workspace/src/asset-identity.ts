import type {
  ImageAsset,
  ImageAssetIdentityClaim,
  ImageAssetIdentityResolution
} from "./core.ts";

export function stableIdentityHash(value: string) {
  const hashes = [2166136261, 2246822507, 3266489909, 668265263];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hashes[0] = Math.imul(hashes[0] ^ code, 16777619);
    hashes[1] = Math.imul(hashes[1] ^ (code + index), 2246822519);
    hashes[2] = Math.imul(hashes[2] ^ (code + hashes[0]), 3266489917);
    hashes[3] = Math.imul(hashes[3] ^ (code + hashes[1]), 668265263);
  }
  return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("");
}

function normalizedImageContentHash(asset: Partial<ImageAsset> = {}) {
  const value = String(asset.contentHash ?? (asset as Partial<ImageAsset> & { sha256?: string }).sha256 ?? "").trim().toLowerCase();
  return /^[a-f0-9]{32,128}$/.test(value) ? value : "";
}

function imageAssetIdentityLocators(asset: Partial<ImageAsset> = {}) {
  const relativePath = String(asset.relativePath ?? "").trim().replace(/\\/g, "/").toLowerCase();
  const localPath = String(asset.path ?? "").trim().replace(/\\/g, "/").toLowerCase();
  const assetUrl = String(asset.assetUrl ?? "").trim();
  const url = String(asset.url ?? "").trim();
  const stableAssetUrl = /^(?:data|blob):/i.test(assetUrl) ? "" : assetUrl;
  const stableUrl = /^(?:data|blob):/i.test(url) ? "" : url;
  return [...new Set([
    relativePath ? `relative-path:${relativePath}` : "",
    localPath ? `path:${localPath}` : "",
    stableAssetUrl ? `asset-url:${stableAssetUrl}` : "",
    stableUrl ? `url:${stableUrl}` : ""
  ].filter(Boolean))];
}

function imageAssetIdentitySource(asset: Partial<ImageAsset> = {}, fallbackIndex = 1) {
  const contentHash = normalizedImageContentHash(asset);
  const locators = imageAssetIdentityLocators(asset);
  const runId = String(asset.runId ?? "").trim().toLowerCase();
  const originalName = String(asset.originalName ?? "").trim().toLowerCase();
  const stableIndex = Math.max(1, Number(asset.index ?? fallbackIndex) || 1);
  return contentHash
    ? `content:${contentHash}`
    : locators.length
      ? locators[0]
      : runId
        ? `run:${runId}|index:${stableIndex}`
        : originalName
          ? `name:${originalName}|index:${stableIndex}`
          : `index:${stableIndex}`;
}

/**
 * Canonical, path-safe identity for an image payload. Managed content hashes
 * and paths are authoritative; runId is only a fallback for transient or
 * remote assets that do not yet have stable project storage.
 */
export function imageAssetIdentityFingerprint(asset: Partial<ImageAsset> = {}, fallbackIndex = 1) {
  return stableIdentityHash(imageAssetIdentitySource(asset, fallbackIndex));
}

/**
 * Reconciles legacy asset IDs in deterministic input order. The first distinct
 * payload keeps a non-conflicting legacy ID; a later payload that reused that
 * ID receives a deterministic 128-bit replacement based on its real identity,
 * owner and original slot. Repeated references to the same real payload keep
 * sharing one ID.
 */
export function reconcileImageAssetIdentityClaims(claims: ImageAssetIdentityClaim[]): ImageAssetIdentityResolution[] {
  const claimedFingerprintById = new Map<string, string>();
  const canonicalByFingerprint = new Map<string, string>();

  const contentHashesByLocator = new Map<string, Set<string>>();
  for (const claim of claims) {
    const contentHash = normalizedImageContentHash(claim);
    if (!contentHash) continue;
    for (const locator of imageAssetIdentityLocators(claim)) {
      const hashes = contentHashesByLocator.get(locator) ?? new Set<string>();
      hashes.add(contentHash);
      contentHashesByLocator.set(locator, hashes);
    }
  }

  return claims.map((claim, claimIndex) => {
    const fallbackIndex = Math.max(1, Number(claim.index ?? claim.assetIndex + 1) || claimIndex + 1);
    const legacyAssetId = typeof claim.assetId === "string" ? claim.assetId.trim().slice(0, 160) : "";
    const contentHash = normalizedImageContentHash(claim);
    const locators = imageAssetIdentityLocators(claim);
    const bridgedHashes = new Set(
      locators.flatMap((locator) => {
        const hashes = contentHashesByLocator.get(locator);
        return hashes?.size === 1 ? [...hashes] : [];
      })
    );
    const effectiveContentHash = contentHash || (bridgedHashes.size === 1 ? [...bridgedHashes][0] : "");
    const baseSource = effectiveContentHash ? `content:${effectiveContentHash}` : imageAssetIdentitySource(claim, fallbackIndex);
    const weakIdentity = !effectiveContentHash && locators.length === 0 && !String(claim.runId ?? "").trim();
    const primarySource = weakIdentity
      ? `${baseSource}|owner:${claim.ownerId}|slot:${claim.assetIndex}`
      : baseSource;
    const fingerprint = stableIdentityHash(primarySource);
    const aliasFingerprints = [...new Set(
      (effectiveContentHash || locators.length === 0 ? [primarySource] : [primarySource, ...locators])
        .map((source) => stableIdentityHash(source))
    )];
    const knownCanonical = aliasFingerprints.map((alias) => canonicalByFingerprint.get(alias)).find(Boolean);
    if (knownCanonical) {
      aliasFingerprints.forEach((alias) => canonicalByFingerprint.set(alias, knownCanonical));
      return { assetId: knownCanonical };
    }

    let assetId = legacyAssetId || `asset-${fingerprint}`;
    const existingFingerprint = claimedFingerprintById.get(assetId);
    if (existingFingerprint && existingFingerprint !== fingerprint) {
      const replacementSeed = `${legacyAssetId || "asset"}|${fingerprint}|owner:${claim.ownerId}|slot:${claim.assetIndex}`;
      let attempt = 0;
      do {
        assetId = `asset-${stableIdentityHash(attempt ? `${replacementSeed}|attempt:${attempt}` : replacementSeed)}`;
        attempt += 1;
      } while (
        claimedFingerprintById.has(assetId) &&
        claimedFingerprintById.get(assetId) !== fingerprint
      );
    }

    claimedFingerprintById.set(assetId, fingerprint);
    aliasFingerprints.forEach((alias) => canonicalByFingerprint.set(alias, assetId));
    return { assetId };
  });
}

export function stableImageAssetId(asset: Partial<ImageAsset> = {}, fallbackIndex = 1) {
  const existing = typeof asset.assetId === "string" ? asset.assetId.trim() : "";
  if (existing) return existing.slice(0, 160);
  return `asset-${imageAssetIdentityFingerprint(asset, fallbackIndex)}`;
}

export function safeImageSourceRelativePath(value: unknown, maximum = 1000) {
  const source = typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";
  if (!source || source.startsWith("/") || /^[a-z]:/i.test(source) || /[\u0000-\u001f\u007f]/.test(source)) return undefined;
  if (source.split("/").some((segment) => !segment || segment === "." || segment === "..")) return undefined;
  return source.slice(0, maximum);
}

export function safeImageLocatorText(value: unknown, maximum = 32767) {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source || source.length > maximum || source.includes("\u0000")) return undefined;
  return source;
}

export function stableImageOccurrenceId(
  asset: Partial<ImageAsset> = {},
  ownerId = "asset",
  assetIndex = 0,
) {
  const existing = typeof asset.occurrenceId === "string" ? asset.occurrenceId.trim().toLowerCase() : "";
  if (/^occ-[a-f0-9]{16,64}$/.test(existing)) return existing;
  const importBatchId = String(asset.importBatchId ?? "").trim();
  const importRootId = String(asset.importRootId ?? "").trim();
  const sourceRelativePath = safeImageSourceRelativePath(asset.sourceRelativePath)?.toLowerCase() || "";
  const runId = String(asset.runId ?? "").trim().toLowerCase();
  const identity = importBatchId && importRootId && sourceRelativePath
    ? `import:${importBatchId}|root:${importRootId}|source:${sourceRelativePath}`
    : runId
      ? `run:${runId}|slot:${Math.max(0, Math.floor(Number(assetIndex) || 0))}|asset:${stableImageAssetId(asset, assetIndex + 1)}`
      : `owner:${ownerId}|asset:${stableImageAssetId(asset, assetIndex + 1)}`;
  return `occ-${stableIdentityHash(identity)}`;
}
