export type ImageLocalProcessing = {
  outputFormat?: "png" | "jpeg" | "webp";
  maskComposite?: { width: number; height: number; protectedPixelCount: number; changedPixels: 0; verified: true };
  alpha?: { width: number; height: number; transparentPixels: number; visiblePixels: number; transparentRatio: number; visibleRatio: number; verified: true };
};
export function normalizeImageLocalProcessing(value: unknown): ImageLocalProcessing | undefined;
