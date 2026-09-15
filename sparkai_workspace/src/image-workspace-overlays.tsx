import React, {
  type Dispatch,
  type FormEvent,
  type MouseEvent,
  type PointerEventHandler,
  type Ref,
  type SetStateAction,
} from "react";
import {
  Check,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Images,
  Layers3,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  SlidersHorizontal,
  WandSparkles,
  Workflow,
} from "lucide-react";
import {
  imageAssetSrc,
  imageAssetThumbnailSrc,
  parseImageSizeValue,
  type AppSettings,
  type ImageAsset,
  type ImageCollection,
  type ImageCollectionExportPreviewResult,
  type ImageExportFormat,
  type WorkflowNode,
} from "./core";
import {
  actualImageAspectRatio,
  imageAssetOutputFormat,
  imageGenerationDisplayRows,
  imageGenerationSourceLabel,
} from "./image-generation-metadata";
import {
  ActionButton,
  ButtonBase,
  DialogShell,
  Field,
  IconActionButton,
  InlineNotice,
  SegmentedControl,
  SegmentButton,
  SurfaceBody,
  SurfaceFooter,
  SurfaceHeader,
  UnsavedChangesDialog,
} from "./ui";

const CLOSE_BUTTON_REASON = "close-button" as const;
const WHEN_IDLE = "when-idle" as const;

export type RegionRedrawDraft = {
  mode: "redraw" | "cutout";
  nodeId: string;
  assetIndex: number;
  prompt: string;
  initialPrompt: string;
  brushSize: number;
  maskDirty: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  ready: boolean;
  busy: boolean;
  error?: string;
};

export type NodeEditorDraft = {
  nodeId: string;
  assetIndex: number;
  title: string;
  prompt: string;
  error?: string;
};

export type ImageCollectionDialogState = {
  mode: "rename" | "replace";
  collectionIds: string[];
  names: Record<string, string>;
  sourceCollectionId?: string;
  itemId?: string;
  requestIndex?: number;
  replacementNodeId?: string;
  replacementAssetIndex?: number;
  defectReason?: string;
  error?: string;
};

export type ImageCollectionExportDialogState = {
  collectionIds: string[];
  format: ImageExportFormat;
  preview: ImageCollectionExportPreviewResult;
  error?: string;
};

export type LayerViewerState = {
  groupId: string;
  selectedNodeId: string;
  mode: "composite" | "solo" | "onion";
};

type CollectionEntry = { node: WorkflowNode; collection: ImageCollection };
type ReplacementCandidate = { node: WorkflowNode; asset: ImageAsset; assetIndex: number };

export function ImageCollectionActionDialog({
  draft,
  setDraft,
  collectionEntries,
  replacementCandidates,
  busy,
  close,
  submit,
  notifyBlocked,
}: {
  draft: ImageCollectionDialogState;
  setDraft: Dispatch<SetStateAction<ImageCollectionDialogState | null>>;
  collectionEntries: CollectionEntry[];
  replacementCandidates: ReplacementCandidate[];
  busy: boolean;
  close: () => void;
  submit: () => unknown;
  notifyBlocked: () => void;
}) {
  const sourceEntry = collectionEntries.find((entry) => entry.collection.id === draft.sourceCollectionId);
  const sourceItem = sourceEntry?.collection.items.find((item) => (
    (draft.itemId && item.id === draft.itemId) ||
    (!draft.itemId && draft.requestIndex !== undefined && item.requestIndex === draft.requestIndex)
  ));
  const replacementNodes = [...new Map(replacementCandidates.map((candidate) => [candidate.node.id, candidate.node])).values()];
  const replacementAssets = replacementCandidates.filter((candidate) => candidate.node.id === draft.replacementNodeId);
  const selectedReplacement = replacementAssets.find((candidate) => candidate.assetIndex === draft.replacementAssetIndex);
  const isRename = draft.mode === "rename";
  const canSubmit = isRename
    ? collectionEntries.length > 0 && collectionEntries.every((entry) => Boolean(draft.names[entry.collection.id]?.trim()))
    : Boolean(sourceEntry && sourceItem && selectedReplacement && draft.defectReason?.trim());

  return (
    <DialogShell
      surface="image-collection"
      ariaLabel={isRename ? "重命名图片组" : "替换图片组槽位"}
      className="image-collection-dialog"
      busy={busy}
      closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE, action: WHEN_IDLE }}
      onRequestClose={close}
      onCloseBlocked={notifyBlocked}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={isRename ? (collectionEntries.length > 1 ? "批量重命名图片组" : "重命名图片组") : "替换图片组槽位"}
            description={isRename
              ? "保存后会同步画布标题、项目会话、导出目录名称和 Agent 查询名称。"
              : "替换图必须来自当前项目；原图会保留到独立瑕疵图片组。"}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeDisabled={busy}
          />
          <SurfaceBody>
            <form
              id="image-collection-action-form"
              className="image-collection-action-form"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                void submit();
              }}
            >
              {isRename ? (
                <div className="image-collection-rename-fields">
                  {collectionEntries.map((entry, index) => (
                    <Field
                      key={entry.collection.id}
                      label={collectionEntries.length > 1 ? `图片组 ${index + 1}` : "图片组名称"}
                      hint={`${entry.node.displayCode || entry.node.id} · 当前：${entry.collection.name || entry.node.title || "图片组"}`}
                    >
                      <input
                        data-autofocus={index === 0 ? "true" : undefined}
                        value={draft.names[entry.collection.id] ?? ""}
                        maxLength={80}
                        placeholder="输入图片组名称"
                        disabled={busy}
                        onChange={(event) => setDraft((current) => current ? {
                          ...current,
                          names: { ...current.names, [entry.collection.id]: event.target.value },
                          error: undefined,
                        } : current)}
                      />
                    </Field>
                  ))}
                </div>
              ) : (
                <>
                  <div className="image-collection-slot-summary">
                    <strong>{sourceEntry?.collection.name || sourceEntry?.node.title || "图片组"}</strong>
                    <span>槽位 {sourceItem?.requestIndex ?? draft.requestIndex ?? "-"}</span>
                    {sourceItem?.title ? <small>{sourceItem.title}</small> : null}
                  </div>
                  <Field label="替换图片所在成果">
                    <select
                      data-autofocus="true"
                      value={draft.replacementNodeId || ""}
                      disabled={busy || replacementNodes.length === 0}
                      onChange={(event) => {
                        const replacementNodeId = event.target.value;
                        const firstAsset = replacementCandidates.find((candidate) => candidate.node.id === replacementNodeId);
                        setDraft((current) => current ? {
                          ...current,
                          replacementNodeId,
                          replacementAssetIndex: firstAsset?.assetIndex,
                          error: undefined,
                        } : current);
                      }}
                    >
                      <option value="">选择当前项目中的成果</option>
                      {replacementNodes.map((node) => (
                        <option key={node.id} value={node.id}>{node.displayCode || node.id} · {node.title || "图片成果"}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="替换图片槽位">
                    <select
                      value={Number.isInteger(draft.replacementAssetIndex) ? String(draft.replacementAssetIndex) : ""}
                      disabled={busy || replacementAssets.length === 0}
                      onChange={(event) => setDraft((current) => current ? {
                        ...current,
                        replacementAssetIndex: event.target.value === "" ? undefined : Number(event.target.value),
                        error: undefined,
                      } : current)}
                    >
                      <option value="">选择图片</option>
                      {replacementAssets.map((candidate) => (
                        <option key={`${candidate.node.id}:${candidate.assetIndex}`} value={candidate.assetIndex}>
                          图片 {candidate.assetIndex + 1} · {candidate.asset.title || candidate.asset.originalName || candidate.asset.displayCode || "受管图片"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="瑕疵原因" hint="该说明会写入瑕疵图片组 manifest。">
                    <textarea
                      value={draft.defectReason || ""}
                      maxLength={320}
                      rows={4}
                      placeholder="说明原图需要被替换的原因"
                      disabled={busy}
                      onChange={(event) => setDraft((current) => current ? {
                        ...current,
                        defectReason: event.target.value,
                        error: undefined,
                      } : current)}
                    />
                  </Field>
                  {replacementCandidates.length === 0 ? (
                    <InlineNotice tone="warning">当前项目没有其他已完成的受管图片可用于替换。</InlineNotice>
                  ) : null}
                </>
              )}
              {draft.error ? <InlineNotice tone="danger" role="alert">{draft.error}</InlineNotice> : null}
            </form>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")} disabled={busy}>取消</ActionButton>
            <ActionButton
              variant="primary"
              type="submit"
              form="image-collection-action-form"
              busy={busy}
              disabled={!canSubmit}
              icon={isRename ? <Check size={16} /> : <Images size={16} />}
            >
              {isRename ? "保存名称" : "替换并保留原图"}
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}

export function ImageCollectionExportDialog({
  draft,
  busy,
  close,
  confirm,
  refreshPreview,
  notifyBlocked,
  formatLabels,
  formatBytes,
}: {
  draft: ImageCollectionExportDialogState;
  busy: boolean;
  close: () => void;
  confirm: () => unknown;
  refreshPreview: (format: ImageExportFormat) => unknown;
  notifyBlocked: () => void;
  formatLabels: Record<ImageExportFormat, string>;
  formatBytes: (value: number) => string;
}) {
  const preview = draft.preview;
  const groups = preview.groups ?? [];
  const relativeRoot = preview.relativeRoot || "image-groups";
  const canSubmit = Boolean(preview.ok && preview.previewToken && preview.imageCount);
  return (
    <DialogShell
      surface="image-collection"
      ariaLabel="图片组导出预检"
      className="image-collection-dialog image-collection-export-dialog"
      busy={busy}
      closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE, action: WHEN_IDLE }}
      onRequestClose={close}
      onCloseBlocked={notifyBlocked}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={groups.length > 1 ? `导出 ${groups.length} 个图片组` : "导出图片组"}
            description={`文件将写入当前项目的 ${relativeRoot}，一个图片组对应一个同名文件夹。`}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeDisabled={busy}
          />
          <SurfaceBody>
            <form
              id="image-collection-export-form"
              className="image-collection-export-form"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                void confirm();
              }}
            >
              <Field label="输出格式" hint="JPEG 会使用白色背景展平透明像素。">
                <select
                  data-autofocus="true"
                  value={draft.format}
                  disabled={busy}
                  onChange={(event) => void refreshPreview(event.target.value as ImageExportFormat)}
                >
                  {(Object.keys(formatLabels) as ImageExportFormat[]).map((format) => (
                    <option key={format} value={format}>{formatLabels[format]}</option>
                  ))}
                </select>
              </Field>
              <div className="image-collection-export-summary" aria-label="导出预检统计">
                <div><span>图片组</span><strong>{preview.collectionCount ?? groups.length}</strong></div>
                <div><span>可导出图片</span><strong>{preview.imageCount ?? 0}</strong></div>
                <div><span>总槽位</span><strong>{preview.slotCount ?? 0}</strong></div>
                <div><span>失败槽位</span><strong>{preview.failedSlotCount ?? 0}</strong></div>
                <div><span>等待槽位</span><strong>{preview.pendingSlotCount ?? 0}</strong></div>
                <div><span>预计图片体积</span><strong>约 {formatBytes(preview.estimatedBytes || 0)}</strong></div>
              </div>
              {(preview.failedSlotCount || preview.pendingSlotCount) ? (
                <InlineNotice tone="warning">失败或等待槽位会保留在 manifest 中，但不会伪造图片文件。</InlineNotice>
              ) : null}
              <div className="image-collection-export-groups" aria-label="导出图片组明细">
                {groups.map((group) => (
                  <div key={group.collectionId} className="image-collection-export-group-row">
                    <span>
                      <strong>{group.name}</strong>
                      <small>{group.role === "defects" ? "瑕疵组" : "结果组"} · {relativeRoot}/{group.directoryName}</small>
                    </span>
                    <span>{group.imageCount} 张 / {group.slotCount} 槽</span>
                  </div>
                ))}
              </div>
              {draft.error ? <InlineNotice tone="danger" role="alert">{draft.error}</InlineNotice> : null}
            </form>
          </SurfaceBody>
          <SurfaceFooter>
            <ActionButton onClick={() => requestClose("action")} disabled={busy}>取消</ActionButton>
            <ActionButton
              variant="primary"
              type="submit"
              form="image-collection-export-form"
              busy={busy}
              disabled={!canSubmit}
              icon={<Download size={16} />}
            >
              确认导出 {preview.imageCount ?? 0} 张图片
            </ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}

export function NodeEditorDialog({
  draft,
  setDraft,
  nodes,
  fallbackNodes,
  maximized,
  setMaximized,
  closePromptOpen,
  setClosePromptOpen,
  fileActionBusy,
  agentExecutionBusy,
  collectionItemForAsset,
  groupMembers,
  nodeWorkName,
  firstPromptLine,
  openViewer,
  openAssetMenu,
  saveStandalone,
  saveAsset,
  openFolder,
  openEditor,
  recompose,
  explode,
  saveDraft,
  exportPsd,
  continueFromEditor,
}: {
  draft: NodeEditorDraft;
  setDraft: Dispatch<SetStateAction<NodeEditorDraft | null>>;
  nodes: WorkflowNode[];
  fallbackNodes: ReadonlyMap<string, WorkflowNode>;
  maximized: boolean;
  setMaximized: Dispatch<SetStateAction<boolean>>;
  closePromptOpen: boolean;
  setClosePromptOpen: Dispatch<SetStateAction<boolean>>;
  fileActionBusy: boolean;
  agentExecutionBusy: boolean;
  collectionItemForAsset: (node: WorkflowNode, assetIndex: number) => ImageCollection["items"][number] | undefined;
  groupMembers: (nodeId: string) => WorkflowNode[];
  nodeWorkName: (node: WorkflowNode) => string;
  firstPromptLine: (value: string) => string;
  openViewer: (node: WorkflowNode, assetIndex: number) => void;
  openAssetMenu: (event: MouseEvent, node: WorkflowNode, assetIndex: number) => void;
  saveStandalone: (asset: ImageAsset, fileName: string, title: string) => unknown;
  saveAsset: (node: WorkflowNode, assetIndex: number) => unknown;
  openFolder: (asset?: ImageAsset) => unknown;
  openEditor: (node: WorkflowNode) => void;
  recompose: (nodeId: string) => unknown;
  explode: (nodeId: string) => void;
  saveDraft: (closeAfterSave: boolean) => unknown;
  exportPsd: (node: WorkflowNode, assetIndex: number) => unknown;
  continueFromEditor: () => void;
}) {
  const editorNode = nodes.find((node) => node.id === draft.nodeId) ?? fallbackNodes.get(draft.nodeId) ?? null;
  const editorAssetIndex = Math.max(0, Math.min(Number(draft.assetIndex || 0), Math.max(0, (editorNode?.assets?.length ?? 1) - 1)));
  const editorAsset = editorNode?.type === "image" ? (editorNode.assets?.[editorAssetIndex] ?? editorNode.layerComposition?.mergedAsset) : undefined;
  const canContinue = Boolean(editorNode?.type === "image" && editorAsset);
  const editorCollectionItem = editorNode ? collectionItemForAsset(editorNode, editorAssetIndex) : undefined;
  const editingCollectionMember = Boolean(editorNode?.imageCollection && editorNode.assets?.[editorAssetIndex]);
  const layerComposition = editorNode?.layerComposition;
  const layerGroup = editorNode?.layerGroup;
  const layerMembers = editorNode?.layerGroup ? groupMembers(editorNode.id) : [];
  const layerGroupExpanded = layerMembers.some((member) => member.layerGroup?.detached);
  const editorSourceTitle = editingCollectionMember
    ? (editorCollectionItem?.title || editorAsset?.title || editorNode?.title || (editorNode ? nodeWorkName(editorNode) : ""))
    : (editorAsset?.title || editorNode?.title || (editorNode ? nodeWorkName(editorNode) : ""));
  const editorSourcePrompt = editingCollectionMember
    ? (editorCollectionItem?.prompt || editorAsset?.prompt || editorAsset?.revisedPrompt || editorNode?.imageParams?.prompt || firstPromptLine(editorNode?.prompt || "") || editorNode?.prompt || "")
    : (editorAsset?.prompt || editorAsset?.revisedPrompt || editorNode?.imageParams?.prompt || firstPromptLine(editorNode?.prompt || "") || editorNode?.prompt || "");
  const editorDirty = draft.title !== editorSourceTitle || draft.prompt !== editorSourcePrompt;
  const showGenerationDetails = Boolean(editorAsset && !layerComposition && !layerGroup);
  const editorAssetRatio = editorAsset ? actualImageAspectRatio(editorAsset.width, editorAsset.height) : undefined;
  const editorAssetPixels = editorAsset && Number(editorAsset.width) > 0 && Number(editorAsset.height) > 0
    ? `${Math.round(Number(editorAsset.width))}×${Math.round(Number(editorAsset.height))}`
    : undefined;
  const editorAssetFormat = editorAsset ? imageAssetOutputFormat(editorAsset) : undefined;
  const generationRows = editorAsset
    ? imageGenerationDisplayRows(editorAsset, editorNode?.imageParams, editorAssetIndex, editorNode?.assets?.length ?? 1)
    : [];
  const generationSource = editorAsset ? imageGenerationSourceLabel(editorAsset, editorNode?.imageParams) : "";

  return (
    <>
      <DialogShell
        surface="node-editor"
        ariaLabel="成果编辑器"
        layerClassName={`node-editor-layer${maximized ? " is-maximized" : ""}`}
        className={`node-editor-dialog unified-node-editor${maximized ? " is-maximized" : ""}`}
        busy={fileActionBusy}
        dirty={editorDirty}
        closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE, action: WHEN_IDLE }}
        onRequestClose={() => {
          if (editorDirty) {
            setClosePromptOpen(true);
            return;
          }
          setDraft(null);
        }}
        onCloseBlocked={() => setDraft((current) => current ? { ...current, error: "正在处理图片文件，请稍候。" } : current)}
      >
        {({ requestClose }) => (
          <>
            <SurfaceHeader
              title="编辑成果"
              description={editorNode
                ? layerGroup
                  ? `分层 PNG #${String(layerGroup.groupNumber).padStart(3, "0")} · 第 ${layerGroup.order}/${layerGroup.total} 层`
                  : layerComposition
                    ? `分层 PNG #${String(layerComposition.groupNumber ?? 0).padStart(3, "0")} · ${layerComposition.layers.length} 层`
                    : editingCollectionMember
                      ? `图片 ${editorAssetIndex + 1} · ${editorSourceTitle || "图片成果"}`
                      : "图片成果"
                : "成果已不存在"}
              onClose={() => requestClose(CLOSE_BUTTON_REASON)}
              closeLabel="关闭成果编辑器"
              closeDisabled={fileActionBusy}
            >
              <IconActionButton
                className="node-editor-maximize"
                data-node-editor-action="toggle-maximize"
                label={maximized ? "还原成果编辑器" : "最大化成果编辑器"}
                aria-label={maximized ? "还原成果编辑器" : "最大化成果编辑器"}
                title={maximized ? "还原成果编辑器" : "最大化成果编辑器"}
                onClick={() => setMaximized((current) => !current)}
                icon={maximized ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              />
            </SurfaceHeader>
            <SurfaceBody className="unified-node-editor-body">
              {editorAsset ? (
                <div className="unified-node-editor-preview" data-ui-interactive="true" draggable={false}>
                  <ButtonBase
                    className="unified-node-editor-preview-open"
                    data-ui-control="preview"
                    type="button"
                    draggable={false}
                    onClick={() => editorNode?.assets?.[editorAssetIndex] && openViewer(editorNode, editorAssetIndex)}
                    onContextMenu={(event) => {
                      if (editorNode?.assets?.[editorAssetIndex]) {
                        openAssetMenu(event, editorNode, editorAssetIndex);
                        return;
                      }
                      event.preventDefault();
                      void saveStandalone(editorAsset, `${draft.title || "图片成果"}.png`, "编辑器预览");
                    }}
                    title={editorNode?.layerGroup ? "查看原图；分层组请使用合成、图层文件夹或 PSD 导出" : "查看原图；右键可保存图片"}
                  >
                    <img src={imageAssetSrc(editorAsset)} alt={draft.title || "图片成果"} />
                    {editorAssetRatio || editorAssetPixels ? (
                      <span className="unified-node-editor-image-specs" aria-label="最终图片规格">
                        {editorAssetRatio ? <b>{editorAssetRatio}</b> : null}
                        {editorAssetPixels ? <b>{editorAssetPixels}</b> : null}
                      </span>
                    ) : null}
                    <span className="unified-node-editor-preview-hint"><ImageIcon size={14} />单击查看原图</span>
                  </ButtonBase>
                  <ActionButton
                    variant="secondary"
                    className="unified-node-editor-save-image"
                    draggable={false}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (editorNode?.assets?.[editorAssetIndex]) void saveAsset(editorNode, editorAssetIndex);
                      else void saveStandalone(editorAsset, `${draft.title || "图片成果"}.png`, "编辑器预览");
                    }}
                    disabled={fileActionBusy}
                    title="另存为"
                    icon={<Download size={14} />}
                  >
                    另存为
                  </ActionButton>
                </div>
              ) : (
                <div className="unified-node-editor-preview is-empty">
                  <Workflow size={28} />
                  <span>当前成果没有图片预览</span>
                </div>
              )}
              <div className={`unified-node-editor-fields ${layerComposition || layerGroup ? "has-layer-composition" : ""} ${showGenerationDetails ? "has-generation-details" : ""}`.trim()}>
                <Field label={editingCollectionMember ? "图片标题" : "成果标题"}>
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value, error: undefined } : current)}
                    placeholder="给这个成果一个容易识别的名称"
                  />
                </Field>
                {showGenerationDetails ? (
                  <section className="node-editor-generation-details" aria-label={generationSource === "本地导入" ? "图片信息" : "生成参数"} data-generation-source={generationSource}>
                    <header>
                      <span><SlidersHorizontal size={14} />{generationSource === "本地导入" ? "图片信息" : "生成参数"}</span>
                      <em>{generationSource}{editorAssetFormat ? ` · ${editorAssetFormat.toUpperCase()}` : ""}</em>
                    </header>
                    <dl className="node-editor-generation-grid">
                      {generationRows.map((row) => (
                        <div key={row.key} data-generation-param={row.key}>
                          <dt>{row.label}</dt>
                          <dd title={[row.requested, row.actual].filter(Boolean).join(" → ")}>
                            {row.requested ? <span className="is-request">{row.requested}</span> : null}
                            {row.requested && row.actual ? <i aria-hidden="true">→</i> : null}
                            {row.actual ? (
                              <strong className={`is-${row.actualSource || "value"}`} data-param-source={row.actualSource || "value"}>
                                {row.actualSource ? <small>{row.actualSource === "api" ? "响应" : row.actualSource === "asset" ? "成图" : "本次"}</small> : null}
                                {row.actual}
                              </strong>
                            ) : null}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}
                <Field className="is-prompt" label="提示词">
                  <textarea
                    value={draft.prompt}
                    onChange={(event) => setDraft((current) => current ? { ...current, prompt: event.target.value, error: undefined } : current)}
                    placeholder="编辑这个成果的完整提示词；继续生成时会直接使用这里的内容"
                  />
                </Field>
                {layerGroup ? (
                  <section className="node-editor-layer-panel" aria-label="独立分层 PNG 操作">
                    <header><span><Layers3 size={15} />图层列表</span><strong>{layerGroup.compositionWidth}×{layerGroup.compositionHeight}</strong></header>
                    <div className="node-editor-layer-list">
                      {[...layerMembers].sort((left, right) => Number(right.layerGroup?.order ?? 0) - Number(left.layerGroup?.order ?? 0)).map((member) => (
                        <ButtonBase
                          type="button"
                          key={member.id}
                          className={`ui-choice-row ${member.id === editorNode?.id ? "current" : ""}`}
                          onClick={() => editorNode && openEditor(member)}
                          title={`编辑 ${member.layerGroup?.layerTitle || member.title}`}
                        >
                          <i>{member.layerGroup?.order}</i>
                          <em>{member.layerGroup?.layerTitle || member.title}</em>
                          <small>{member.layerGroup?.role || "layer"} · {member.layerGroup?.detached ? "独立" : "叠放"}</small>
                        </ButtonBase>
                      ))}
                    </div>
                    <div className="node-editor-layer-actions">
                      <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="open-layers" onClick={() => void openFolder(editorAsset)} icon={<FolderOpen size={15} />}>打开图层文件夹</ActionButton>
                      {layerGroupExpanded ? (
                        <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="recompose" onClick={() => void recompose(editorNode!.id)} icon={<Layers3 size={15} />}>图层重组</ActionButton>
                      ) : (
                        <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="explode" onClick={() => explode(editorNode!.id)} icon={<Layers3 size={15} />}>展开图层</ActionButton>
                      )}
                    </div>
                  </section>
                ) : null}
                {layerComposition ? (
                  <section className="node-editor-layer-panel" aria-label="分层 PNG 操作">
                    <header><span><Layers3 size={15} />分层 PNG</span><strong>#{String(layerComposition.groupNumber ?? 0).padStart(3, "0")} · {layerComposition.layers.length} 层</strong></header>
                    <div className="node-editor-layer-list">
                      {[...layerComposition.layers].sort((left, right) => Number(right.order ?? 0) - Number(left.order ?? 0)).map((layer) => (
                        <span key={`${editorNode?.id}-${layer.id}`}><i>{Number(layer.order ?? 0)}</i><em>{layer.title || layer.id}</em><small>{layer.role || "layer"}</small></span>
                      ))}
                    </div>
                    <div className="node-editor-layer-actions">
                      <ActionButton
                        variant="secondary"
                        className="node-editor-action"
                        data-node-editor-action="open-layers"
                        onClick={() => void openFolder(layerComposition.layers.map((layer) => layer.asset).find((asset) => asset?.path) ?? layerComposition.mergedAsset ?? layerComposition.previewAsset)}
                        icon={<FolderOpen size={15} />}
                      >
                        打开图层文件夹
                      </ActionButton>
                      {layerComposition.layout === "exploded" ? (
                        <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="recompose" onClick={() => void recompose(editorNode!.id)} icon={<Layers3 size={15} />}>图层重组</ActionButton>
                      ) : (
                        <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="explode" onClick={() => explode(editorNode!.id)} icon={<Layers3 size={15} />}>展开图层</ActionButton>
                      )}
                    </div>
                  </section>
                ) : null}
                {draft.error ? <InlineNotice className="node-editor-error" tone="danger">{draft.error}</InlineNotice> : null}
              </div>
            </SurfaceBody>
            <SurfaceFooter className="unified-node-editor-footer">
              <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="cancel" onClick={() => requestClose("action")}>取消</ActionButton>
              <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="save" onClick={() => saveDraft(true)} icon={<Check size={15} />} disabled={!editorDirty}>保存</ActionButton>
              {editorNode?.assets?.[editorAssetIndex] && !layerGroup && !layerComposition ? (
                <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="export-psd" onClick={() => void exportPsd(editorNode, editorAssetIndex)} disabled={fileActionBusy} icon={<Layers3 size={15} />}>导出 PSD</ActionButton>
              ) : null}
              {canContinue ? (
                <ActionButton variant="primary" className="node-editor-action" data-node-editor-action="continue" onClick={continueFromEditor} disabled={agentExecutionBusy} icon={<WandSparkles size={15} />}>保存并继续生成</ActionButton>
              ) : null}
            </SurfaceFooter>
          </>
        )}
      </DialogShell>
      {closePromptOpen ? (
        <UnsavedChangesDialog
          surface="node-editor-unsaved"
          ariaLabel="保存成果修改"
          title="关闭前要保存成果修改吗？"
          description="成果标题或提示词还有未保存的修改。"
          detail={<p>保存只更新当前成果信息，不会执行图片模型或产生费用。</p>}
          busy={fileActionBusy}
          onContinueEditing={() => setClosePromptOpen(false)}
          onDiscard={() => {
            setClosePromptOpen(false);
            setDraft(null);
          }}
          onSave={() => {
            const saved = saveDraft(true);
            if (!saved) setClosePromptOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export function RegionRedrawDialog({
  draft,
  setDraft,
  nodes,
  imageSize,
  closePromptOpen,
  setClosePromptOpen,
  sourceCanvasRef,
  maskCanvasRef,
  beginPaint,
  movePaint,
  endPaint,
  clearPaintState,
  clearMask,
  submit,
  agentExecutionBusy,
}: {
  draft: RegionRedrawDraft;
  setDraft: Dispatch<SetStateAction<RegionRedrawDraft | null>>;
  nodes: WorkflowNode[];
  imageSize: AppSettings["imageSize"];
  closePromptOpen: boolean;
  setClosePromptOpen: Dispatch<SetStateAction<boolean>>;
  sourceCanvasRef: Ref<HTMLCanvasElement>;
  maskCanvasRef: Ref<HTMLCanvasElement>;
  beginPaint: PointerEventHandler<HTMLCanvasElement>;
  movePaint: PointerEventHandler<HTMLCanvasElement>;
  endPaint: PointerEventHandler<HTMLCanvasElement>;
  clearPaintState: () => void;
  clearMask: () => void;
  submit: () => unknown;
  agentExecutionBusy: boolean;
}) {
  const redrawNode = nodes.find((item) => item.id === draft.nodeId) ?? null;
  const isCutout = draft.mode === "cutout";
  const editorTitle = isCutout ? "AI 抠图" : "AI 重绘";
  const fallbackSize = parseImageSizeValue(redrawNode?.imageParams?.size || imageSize || "");
  const sourceWidth = draft.sourceWidth || fallbackSize?.width || 1;
  const sourceHeight = draft.sourceHeight || fallbackSize?.height || 1;
  const redrawDirty = draft.prompt !== draft.initialPrompt || draft.maskDirty;
  const closeRedraw = () => {
    clearPaintState();
    setClosePromptOpen(false);
    setDraft(null);
  };
  return (
    <>
      <DialogShell
        surface="region-redraw"
        ariaLabel={editorTitle}
        layerClassName="region-redraw-layer"
        className={`region-redraw-dialog ${isCutout ? "is-cutout" : "is-redraw"}`}
        busy={draft.busy}
        dirty={redrawDirty}
        closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE, action: WHEN_IDLE }}
        onRequestClose={() => redrawDirty ? setClosePromptOpen(true) : closeRedraw()}
        onCloseBlocked={() => setDraft((current) => current ? { ...current, error: `${editorTitle}正在执行，请稍候。` } : current)}
      >
        {({ requestClose }) => (
          <>
            <SurfaceHeader title={editorTitle} description={redrawNode?.title || "选中的图片成果"} onClose={() => requestClose(CLOSE_BUTTON_REASON)} closeLabel={`关闭${editorTitle}`} closeDisabled={draft.busy} />
            <SurfaceBody className="region-redraw-body">
              <div className="region-redraw-stage-panel">
                <div className="region-redraw-stage-head">
                  <strong>{isCutout ? "涂抹要保留的主体" : "涂抹要修改的位置"}</strong>
                  <span>{isCutout ? "大致覆盖主体即可，AI 会结合描述识别自然边缘。" : "红色区域会交给 Image 2 重绘，其他区域保持不变。"}</span>
                </div>
                <div className={`region-redraw-canvas-shell ${draft.ready ? "ready" : "loading"}`} style={{ aspectRatio: `${sourceWidth} / ${sourceHeight}` }}>
                  <canvas ref={sourceCanvasRef} className="region-redraw-source-canvas" aria-label={`${editorTitle}来源图片`} />
                  <canvas
                    ref={maskCanvasRef}
                    className="region-redraw-mask-canvas"
                    aria-label={`${editorTitle}选区蒙版`}
                    onPointerDown={beginPaint}
                    onPointerMove={movePaint}
                    onPointerUp={endPaint}
                    onPointerCancel={endPaint}
                    onLostPointerCapture={clearPaintState}
                  />
                  {!draft.ready ? <div className="region-redraw-loading"><Loader2 size={20} className="spin" aria-hidden="true" /><span>正在准备原图和蒙版…</span></div> : null}
                </div>
              </div>
              <aside className="region-redraw-controls">
                <Field className="region-redraw-prompt-field" label={isCutout ? "主体描述" : "重绘要求"}>
                  <textarea
                    value={draft.prompt}
                    placeholder={isCutout ? "例如：保留人物、发丝和手持的透明雨伞，移除背景。" : "例如：把涂抹区域改成一枚银色胸针，保持人物、衣服和光线不变。"}
                    disabled={draft.busy}
                    onChange={(event) => setDraft((current) => current ? { ...current, prompt: event.target.value, error: undefined } : current)}
                  />
                </Field>
                <Field className="region-redraw-brush-field" label={<><WandSparkles size={15} />笔刷大小<strong>{draft.brushSize}px</strong></>}>
                  <input type="range" min="12" max="240" step="4" value={draft.brushSize} disabled={!draft.ready || draft.busy} onChange={(event) => setDraft((current) => current ? { ...current, brushSize: Number(event.target.value) } : current)} />
                </Field>
                <InlineNotice className="region-redraw-note" tone="info" icon={<WandSparkles size={16} />}>
                  <p>{isCutout ? "选区负责告诉 Agent 主体大致在哪里，描述负责消除歧义；提交前不会生成图片。" : "可以多次涂抹。选区决定修改范围，具体内容由描述决定。"}</p>
                </InlineNotice>
                {draft.error ? <InlineNotice className="region-redraw-error" tone="danger">{draft.error}</InlineNotice> : null}
              </aside>
            </SurfaceBody>
            <SurfaceFooter
              className="region-redraw-footer"
              leading={<ActionButton variant="ghost" onClick={clearMask} disabled={!draft.ready || draft.busy || !draft.maskDirty} icon={<RotateCcw size={15} />}>清空涂抹</ActionButton>}
            >
              <ActionButton onClick={() => requestClose("action")} disabled={draft.busy}>取消</ActionButton>
              <ActionButton variant="primary" onClick={() => void submit()} busy={draft.busy} disabled={agentExecutionBusy || !draft.ready} icon={<WandSparkles size={15} />}>
                {draft.busy ? (isCutout ? "正在抠图…" : "正在重绘…") : `执行${editorTitle}`}
              </ActionButton>
            </SurfaceFooter>
          </>
        )}
      </DialogShell>
      {closePromptOpen ? (
        <UnsavedChangesDialog
          surface="region-redraw-unsaved"
          ariaLabel={`放弃${editorTitle}修改`}
          title={`要放弃未提交的${editorTitle}修改吗？`}
          description="当前描述或涂抹选区还没有提交。"
          detail={<p>继续编辑会保留当前蒙版；放弃只关闭编辑器，不会调用图片模型或产生费用。</p>}
          busy={draft.busy}
          onContinueEditing={() => setClosePromptOpen(false)}
          onDiscard={closeRedraw}
          discardLabel="放弃并关闭"
        />
      ) : null}
    </>
  );
}

export function LayerGroupViewerDialog({
  viewer,
  setViewer,
  nodes,
  fileActionBusy,
  close,
  openAssetMenu,
  showAll,
  setVisibility,
  selectNode,
  openEditor,
  exportMerged,
  exportFolder,
  exportPsd,
  recompose,
  explode,
  mergeVisible,
}: {
  viewer: LayerViewerState;
  setViewer: Dispatch<SetStateAction<LayerViewerState | null>>;
  nodes: WorkflowNode[];
  fileActionBusy: boolean;
  close: () => void;
  openAssetMenu: (event: MouseEvent, node: WorkflowNode, assetIndex: number) => void;
  showAll: (nodeId: string) => void;
  setVisibility: (nodeId: string, visible: boolean) => void;
  selectNode: (nodeId: string) => void;
  openEditor: (node: WorkflowNode) => void;
  exportMerged: (nodeId: string) => unknown;
  exportFolder: (nodeId: string) => unknown;
  exportPsd: (nodeId: string) => unknown;
  recompose: (nodeId: string) => unknown;
  explode: (nodeId: string) => void;
  mergeVisible: (nodeId: string) => unknown;
}) {
  const members = nodes.filter((node) => node.layerGroup?.id === viewer.groupId).sort((left, right) => Number(left.layerGroup?.order ?? 0) - Number(right.layerGroup?.order ?? 0));
  const selectedLayer = members.find((member) => member.id === viewer.selectedNodeId) ?? members[members.length - 1];
  const group = selectedLayer?.layerGroup;
  if (!selectedLayer || !group) return null;
  const groupExpanded = members.some((member) => member.layerGroup?.detached);
  return (
    <DialogShell
      surface="layer-group-viewer"
      ariaLabel={`分层查看器 ${group.title || "分层 PNG"}`}
      layerClassName="layer-group-viewer-layer"
      className="layer-group-viewer"
      busy={fileActionBusy}
      closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE, action: WHEN_IDLE }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader title={group.title || "分层 PNG"} description={`#${String(group.groupNumber).padStart(3, "0")} · ${members.length} 个真实 PNG 图层`} onClose={() => requestClose(CLOSE_BUTTON_REASON)} closeLabel="关闭分层查看器" closeDisabled={fileActionBusy}>
            <SegmentedControl className="layer-viewer-mode-switch" aria-label="分层查看模式">
              {(["composite", "solo", "onion"] as const).map((mode) => (
                <SegmentButton key={mode} type="button" active={viewer.mode === mode} onClick={() => setViewer((current) => current ? { ...current, mode } : current)}>
                  {mode === "composite" ? "合成" : mode === "solo" ? "单层" : "透视"}
                </SegmentButton>
              ))}
            </SegmentedControl>
          </SurfaceHeader>
          <SurfaceBody className="layer-group-viewer-body">
            <div className="layer-viewer-stage-wrap">
              <div className="layer-viewer-stage" style={{ aspectRatio: `${group.compositionWidth} / ${group.compositionHeight}` }} aria-label={`${viewer.mode === "composite" ? "合成" : viewer.mode === "solo" ? "单层" : "透视"}预览`} onContextMenu={(event) => openAssetMenu(event, selectedLayer, 0)}>
                <div className="layer-viewer-image-stack">
                  {members.map((member, index) => {
                    const asset = member.assets?.[0];
                    if (!asset) return null;
                    const visible = member.layerGroup?.visible !== false;
                    const selected = member.id === selectedLayer.id;
                    const shouldRender = viewer.mode === "solo" ? selected : visible;
                    const opacity = viewer.mode === "onion" ? (selected ? 1 : visible ? 0.24 : 0) : shouldRender ? 1 : 0;
                    const blendMode = member.layerGroup?.blendMode;
                    return (
                      <img
                        key={member.id}
                        src={imageAssetSrc(asset)}
                        alt={member.layerGroup?.layerTitle || `图层 ${index + 1}`}
                        draggable={false}
                        style={{
                          zIndex: Number(member.layerGroup?.order ?? index + 1),
                          opacity: opacity * Number(member.layerGroup?.opacity ?? 1),
                          mixBlendMode: blendMode && blendMode !== "normal" && blendMode !== "source-over" ? blendMode : "normal",
                        }}
                      />
                    );
                  })}
                </div>
                <span className="layer-viewer-selected-label">第 {group.order}/{group.total} 层 · {group.layerTitle}</span>
              </div>
            </div>
            <aside className="layer-viewer-rail" aria-label="图层列表">
              <header><span>图层</span><ButtonBase className="ui-inline-action" type="button" onClick={() => showAll(selectedLayer.id)}>显示全部</ButtonBase></header>
              <div>
                {[...members].reverse().map((member) => {
                  const memberGroup = member.layerGroup!;
                  const visible = memberGroup.visible !== false;
                  return (
                    <article key={member.id} className={`${member.id === selectedLayer.id ? "active" : ""} ${visible ? "" : "hidden"}`} draggable={false} onContextMenu={(event) => openAssetMenu(event, member, 0)} title="右键可另存当前图层；需要作为普通图片拖动时请先合并可见图层">
                      <IconActionButton className="layer-viewer-eye" label={visible ? `隐藏 ${memberGroup.layerTitle}` : `显示 ${memberGroup.layerTitle}`} onClick={() => setVisibility(member.id, !visible)} icon={visible ? <Eye size={15} /> : <EyeOff size={15} />} />
                      <ButtonBase type="button" className="ui-choice-row layer-viewer-row" onClick={() => { setViewer((current) => current ? { ...current, selectedNodeId: member.id } : current); selectNode(member.id); }} onDoubleClick={() => openEditor(member)}>
                        <span className="layer-viewer-thumb">{member.assets?.[0] ? <img src={imageAssetThumbnailSrc(member.assets[0])} alt="" draggable={false} loading="lazy" decoding="async" /> : null}</span>
                        <span><strong>{memberGroup.layerTitle}</strong><small>{memberGroup.order}/{memberGroup.total} · {memberGroup.role}</small></span>
                      </ButtonBase>
                    </article>
                  );
                })}
              </div>
            </aside>
          </SurfaceBody>
          <SurfaceFooter className="layer-group-viewer-footer" leading={<p>查看不会创建新节点；合并会保留全部原图层。</p>}>
            <ActionButton variant="secondary" onClick={() => void exportMerged(selectedLayer.id)} disabled={fileActionBusy} icon={<Download size={15} />}>合成 PNG</ActionButton>
            <ActionButton variant="secondary" onClick={() => void exportFolder(selectedLayer.id)} disabled={fileActionBusy} icon={<FolderOpen size={15} />}>图层文件夹</ActionButton>
            <ActionButton variant="secondary" onClick={() => void exportPsd(selectedLayer.id)} disabled={fileActionBusy} icon={<Layers3 size={15} />}>Photoshop PSD</ActionButton>
            <ActionButton variant="secondary" onClick={() => groupExpanded ? void recompose(selectedLayer.id) : explode(selectedLayer.id)} icon={<Layers3 size={15} />}>{groupExpanded ? "图层重组" : "展开到画布"}</ActionButton>
            <ActionButton variant="primary" onClick={() => void mergeVisible(selectedLayer.id)} busy={fileActionBusy} icon={<ImageIcon size={15} />}>合并可见图层为新图片</ActionButton>
          </SurfaceFooter>
        </>
      )}
    </DialogShell>
  );
}

export default NodeEditorDialog;
