export type CreationAssetIdentity = { assetId: string; occurrenceId: string; contentHash: string };
export type FrozenCreationMask = CreationAssetIdentity & { target: CreationAssetIdentity; path: string; relativePath: string; mimeType: "image/png"; name: string; width: number; height: number };
export type CreationAssetTarget = CreationAssetIdentity & { nodeId: string; slotId?: string; expectedRevision?: number; label?: string; preserve?: string[]; changes?: string[]; mask?: CreationAssetIdentity };
export type CreationTaskContract = {
  requirementId: string; revision: number; fingerprint: string;
  revisionPlan?: { revisionId: string; baselineReviewIds: string[]; preserve: string[]; changes: string[]; targets: CreationAssetTarget[] };
};
export function normalizeCreationTaskContract(value: unknown): CreationTaskContract | undefined;
export function normalizeCreationMaskAssets(value: unknown): FrozenCreationMask[];
