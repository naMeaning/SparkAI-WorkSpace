export type ImageContentName = { displayName: string; confidence?: "high" | "medium"; source: "visual" | "fallback" | "manual" };
export function normalizeContentName(value: unknown): ImageContentName | undefined;
export function normalizeStoredContentName(value: unknown): ImageContentName | undefined;
export function canApplyContentName(node: object): boolean;
export function contentNamePatch<T extends object>(node: T, name: unknown, assetPath?: string): Partial<T> | undefined;
