type ImageAssetIdentity = {
  assetId?: string;
  occurrenceId?: string;
  displayCode?: string;
  runId?: string;
  path?: string;
  relativePath?: string;
  assetUrl?: string;
  url?: string;
  importBatchId?: string;
  importRootId?: string;
  sourceRelativePath?: string;
  title?: string;
  contentName?: { source: string };
  contentHash?: string;
  sha256?: string;
  index?: number;
  originalName?: string;
  fileName?: string;
  name?: string;
};

export function imageAssetContentHash(asset?: ImageAssetIdentity): string;
export function imageAssetIdentityLocators(asset?: ImageAssetIdentity): string[];
export function imageAssetIdentitySources(
  asset?: ImageAssetIdentity,
  options?: { fallbackIndex?: number; ownerId?: string; slot?: number; contentHashesByLocator?: ReadonlyMap<string, ReadonlySet<string>> | null }
): { primarySource: string; aliasSources: string[] };

export function coalesceImageAssets<T extends ImageAssetIdentity>(
  assets?: readonly T[],
  options?: { generatedOnly?: boolean }
): { assets: T[]; slotMap: Map<number, number> };

export function remapImageAssetSlots<T extends object>(
  node: T,
  sourceAssets: readonly ImageAssetIdentity[],
  assets: readonly ImageAssetIdentity[],
  slotMap: ReadonlyMap<number, number>
): T;
