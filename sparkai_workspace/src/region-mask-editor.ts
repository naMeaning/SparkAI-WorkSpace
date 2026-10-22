export type MaskRole = "modify" | "preserve" | "annotation";
export type MaskTool = "brush" | "eraser" | "pan";
export type MaskSourceTarget = { assetId: string; occurrenceId: string; contentHash: string };
export type MaskPoint = { x: number; y: number };
export type MaskAction = { id: string; role: MaskRole; kind: "paint" | "erase" | "invert" | "clear"; size: number; points: MaskPoint[] };
export type MaskDocument = { version: 1; sourceTarget: MaskSourceTarget; width: number; height: number; actions: MaskAction[]; cursor: number };
export type MaskView = { zoom: number; panX: number; panY: number };
export type SavedMaskDraft = { version: 1; document: MaskDocument; prompt: string; annotationLabel?: string; view: MaskView; savedAt: number };

const roles: MaskRole[] = ["modify", "preserve", "annotation"];
const MAX_ACTIONS = 256, MAX_POINTS = 40_000;
const sameTarget = (left: MaskSourceTarget, right: MaskSourceTarget) => left.assetId === right.assetId && left.occurrenceId === right.occurrenceId && left.contentHash === right.contentHash;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function maskCanvasPoint(clientX: number, clientY: number, rect: Pick<DOMRect, "left" | "top" | "width" | "height">, width: number, height: number): MaskPoint {
  return { x: Math.max(0, Math.min(width, (clientX - rect.left) / Math.max(1, rect.width) * width)), y: Math.max(0, Math.min(height, (clientY - rect.top) / Math.max(1, rect.height) * height)) };
}

export function zoomMaskView(view: MaskView, nextZoom: number, anchorX = 0, anchorY = 0): MaskView {
  const zoom = Math.max(0.25, Math.min(8, nextZoom));
  const ratio = zoom / view.zoom;
  return { zoom, panX: anchorX - (anchorX - view.panX) * ratio, panY: anchorY - (anchorY - view.panY) * ratio };
}

export function maskDraftKey(projectId: string, target: MaskSourceTarget, mode: string) {
  return `naimage:region-mask:v1:${encodeURIComponent(JSON.stringify([projectId, target.assetId, target.occurrenceId, target.contentHash, mode]))}`;
}

export class RegionMaskEditor {
  private document: MaskDocument;
  constructor(sourceTarget: MaskSourceTarget, width: number, height: number, restored?: MaskDocument) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 32_000_000) throw new Error("选区原图尺寸无效或超过像素上限。");
    this.document = { version: 1, sourceTarget: { ...sourceTarget }, width, height, actions: [], cursor: 0 };
    if (restored) this.restore(restored);
  }
  get width() { return this.document.width; }
  get height() { return this.document.height; }
  get canUndo() { return this.document.cursor > 0; }
  get canRedo() { return this.document.cursor < this.document.actions.length; }
  get dirty() { return this.document.cursor > 0; }
  snapshot() { return copy(this.document); }
  private restore(value: MaskDocument) {
    if (value.version !== 1 || !value.sourceTarget || !sameTarget(value.sourceTarget, this.document.sourceTarget) || value.width !== this.width || value.height !== this.height || !Array.isArray(value.actions) || value.actions.length > MAX_ACTIONS || !Number.isInteger(value.cursor) || value.cursor < 0 || value.cursor > value.actions.length) throw new Error("选区草稿与当前原图不匹配。");
    const ids = new Set<string>();
    let points = 0;
    for (const action of value.actions) {
      if (!action || typeof action.id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(action.id) || ids.has(action.id) || !roles.includes(action.role) || !["paint", "erase", "invert", "clear"].includes(action.kind) || !Number.isFinite(action.size) || action.size < 1 || action.size > 2048 || !Array.isArray(action.points)) throw new Error("选区草稿包含无效笔画。");
      ids.add(action.id);
      points += action.points.length;
      if (points > MAX_POINTS || action.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > this.width || point.y > this.height)) throw new Error("选区草稿包含无效坐标。");
    }
    this.document = copy(value);
  }
  begin(id: string, role: MaskRole, tool: "brush" | "eraser", size: number, point: MaskPoint) {
    this.add({ id, role, kind: tool === "eraser" ? "erase" : "paint", size: Math.max(1, Math.min(2048, size)), points: [this.clamp(point)] });
  }
  append(point: MaskPoint) {
    const action = this.document.actions[this.document.cursor - 1];
    if (!action || !["paint", "erase"].includes(action.kind)) return;
    const current = this.clamp(point), previous = action.points[action.points.length - 1];
    if (Math.hypot(current.x - previous.x, current.y - previous.y) < 0.5) return;
    if (this.document.actions.reduce((count, value) => count + value.points.length, 0) >= MAX_POINTS) throw new Error("选区笔画已达上限，请先清空部分笔画。");
    action.points.push(current);
  }
  private clamp(point: MaskPoint) { return { x: Math.max(0, Math.min(this.width, point.x)), y: Math.max(0, Math.min(this.height, point.y)) }; }
  private add(action: MaskAction) {
    if (this.document.cursor >= MAX_ACTIONS) throw new Error("选区操作已达上限，请重新打开编辑器。");
    this.document.actions = [...this.document.actions.slice(0, this.document.cursor), action];
    this.document.cursor++;
  }
  undo() { if (this.canUndo) this.document.cursor--; }
  redo() { if (this.canRedo) this.document.cursor++; }
  invert(id: string, role: MaskRole) { this.add({ id, role, kind: "invert", size: 1, points: [] }); }
  clear(id: string) { this.add({ id, role: "modify", kind: "clear", size: 1, points: [] }); }
  private layers() {
    const layers = Object.fromEntries(roles.map(role => {
      const canvas = document.createElement("canvas"); canvas.width = this.width; canvas.height = this.height;
      return [role, canvas];
    })) as Record<MaskRole, HTMLCanvasElement>;
    for (const action of this.document.actions.slice(0, this.document.cursor)) {
      if (action.kind === "clear") { for (const canvas of Object.values(layers)) canvas.getContext("2d")!.clearRect(0, 0, this.width, this.height); continue; }
      const context = layers[action.role].getContext("2d", { willReadFrequently: true })!;
      if (action.kind === "invert") {
        const image = context.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < image.data.length; i += 4) { image.data[i] = image.data[i + 1] = image.data[i + 2] = 255; image.data[i + 3] = 255 - image.data[i + 3]; }
        context.putImageData(image, 0, 0); continue;
      }
      const first = action.points[0]; if (!first) continue;
      context.save(); context.globalCompositeOperation = action.kind === "erase" ? "destination-out" : "source-over";
      context.fillStyle = context.strokeStyle = "#fff"; context.lineCap = context.lineJoin = "round"; context.lineWidth = action.size;
      context.beginPath(); context.arc(first.x, first.y, action.size / 2, 0, Math.PI * 2); context.fill();
      context.beginPath(); context.moveTo(first.x, first.y); for (const point of action.points.slice(1)) context.lineTo(point.x, point.y); context.stroke(); context.restore();
    }
    return layers;
  }
  render(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d")!; context.clearRect(0, 0, this.width, this.height);
    const colors = { modify: "#ff3e5c", preserve: "#27c78c", annotation: "#4f9bff" };
    for (const [role, layer] of Object.entries(this.layers()) as [MaskRole, HTMLCanvasElement][]) {
      const tint = layer.getContext("2d")!; tint.globalCompositeOperation = "source-in"; tint.fillStyle = colors[role]; tint.fillRect(0, 0, this.width, this.height);
      context.save(); context.globalAlpha = 0.65; context.drawImage(layer, 0, 0); context.restore();
    }
  }
  exportMask(mode: "edit" | "keep" | "protect", annotationLabel = "") {
    const layers = this.layers();
    const modify = layers.modify.getContext("2d")!.getImageData(0, 0, this.width, this.height).data;
    const preserve = layers.preserve.getContext("2d")!.getImageData(0, 0, this.width, this.height).data;
    const output = document.createElement("canvas"); output.width = this.width; output.height = this.height;
    const context = output.getContext("2d")!, image = context.createImageData(this.width, this.height);
    let paintedPixels = 0;
    for (let offset = 0; offset < image.data.length; offset += 4) {
      const selected = mode === "keep" ? modify[offset + 3] > 8 || preserve[offset + 3] > 8 : mode === "protect" ? preserve[offset + 3] > 8 : modify[offset + 3] > 8 && preserve[offset + 3] <= 8;
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 255;
      image.data[offset + 3] = mode === "edit" ? selected ? 0 : 255 : selected ? 255 : 0;
      if (selected) paintedPixels++;
    }
    context.putImageData(image, 0, 0);
    const annotation = layers.annotation.getContext("2d")!.getImageData(0, 0, this.width, this.height).data;
    let left = this.width, top = this.height, right = -1, bottom = -1;
    for (let i = 0; i < this.width * this.height; i++) if (annotation[i * 4 + 3] > 8) { const x = i % this.width, y = Math.floor(i / this.width); left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    const firstAnnotation = this.document.actions.slice(0, this.document.cursor).find(action => action.role === "annotation");
    const regions = right >= left && firstAnnotation ? [{ regionId: `annotation-${firstAnnotation.id}`, role: "annotation" as const, x: left, y: top, width: right - left + 1, height: bottom - top + 1, label: annotationLabel.trim().slice(0, 320) }] : [];
    return { dataUrl: output.toDataURL("image/png"), paintedPixels, width: this.width, height: this.height, regions };
  }
}

export function readMaskDraft(storage: Pick<Storage, "getItem">, key: string, target: MaskSourceTarget, width: number, height: number): SavedMaskDraft | null {
  const text = storage.getItem(key); if (!text) return null;
  if (text.length > 4_000_000) throw new Error("选区草稿超过本地恢复上限。");
  const value = JSON.parse(text) as SavedMaskDraft;
  if (value.version !== 1 || typeof value.prompt !== "string" || value.prompt.length > 100_000 || !value.view || ![value.view.zoom, value.view.panX, value.view.panY].every(Number.isFinite) || value.view.zoom < 0.25 || value.view.zoom > 8) throw new Error("选区草稿格式无效。");
  new RegionMaskEditor(target, width, height, value.document);
  return value;
}
