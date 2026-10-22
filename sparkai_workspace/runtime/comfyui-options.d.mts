export type ComfyUiTaskOptions = { templateId: string; templateHash: string; baseUrl: string; checkpoint: string; seed: number; width: number; height: number; negativePrompt?: string };
export const LOCAL_HOSTS: Set<string>;
export function localBaseUrl(value?: unknown): string;
export function normalizeComfyUiTaskOptions(value: unknown): ComfyUiTaskOptions;
export type ComfyUiGenerationMetadata = { protocol?: "comfyui"; seed?: number; steps?: number; cfg?: number; denoise?: number; sampler?: string; scheduler?: string; templateId?: string; templateVersion?: number; templateHash?: string; workflowHash?: string; sourceHashes?: string[] };
export function normalizeComfyUiGenerationMetadata(value: unknown): ComfyUiGenerationMetadata;
