export type FrozenImageConfig = {
  provider?: "comfyui"; comfyui?: import("./comfyui-options.mjs").ComfyUiTaskOptions;
  model: string; models: string[]; ratio: string; resolution: string; quality: string; count: number; outputFormat: string;
  configs: Array<{ model: string; protocol?: string; gateway?: string; transportMode?: string; pollIntervalMs?: number; maxWaitMs?: number; capabilities?: Record<string, unknown> }>;
  bindings: Array<{ model: string; protocol?: string; gateway?: string; transportMode?: string }>;
};
export function imageConfigSnapshot(settings?: object): FrozenImageConfig;
export function settingsWithImageConfig<T extends object>(settings?: T, snapshot?: FrozenImageConfig): T;
export function normalizeImageConfigSnapshot(snapshot?: unknown): FrozenImageConfig | undefined;
