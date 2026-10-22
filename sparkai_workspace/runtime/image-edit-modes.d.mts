export type AiImageEditMode = "edit" | "redraw" | "remove-object" | "replace-background" | "cutout" | "variants";
export const AI_IMAGE_EDIT_MODES: Readonly<Record<AiImageEditMode, Readonly<{ operation: "edit" | "replace" | "redraw" | "cutout" | "variants"; label: string; requiresModifyMask: boolean }>>>;
export function imageEditModeOperation(mode: string): "edit" | "replace" | "redraw" | "cutout" | "variants" | undefined;
