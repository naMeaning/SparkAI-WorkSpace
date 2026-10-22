export const AI_IMAGE_EDIT_MODES = Object.freeze({
  edit: Object.freeze({ operation: "edit", label: "整图修改", requiresModifyMask: false }),
  redraw: Object.freeze({ operation: "redraw", label: "局部修改", requiresModifyMask: true }),
  "remove-object": Object.freeze({ operation: "redraw", label: "消除物体", requiresModifyMask: true }),
  "replace-background": Object.freeze({ operation: "replace", label: "换背景", requiresModifyMask: false }),
  cutout: Object.freeze({ operation: "cutout", label: "AI 抠图", requiresModifyMask: true }),
  variants: Object.freeze({ operation: "variants", label: "生成变体", requiresModifyMask: false })
});

export function imageEditModeOperation(mode) {
  return AI_IMAGE_EDIT_MODES[mode]?.operation;
}
