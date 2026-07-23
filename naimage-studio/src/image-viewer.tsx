import { useEffect, useRef, useState, type Dispatch, type MouseEvent, type SetStateAction, type SyntheticEvent } from "react";
import { Download, FolderOpen, Layers3, Maximize2, Minus, Plus } from "lucide-react";

import {
  imageAssetSrc,
  imageAssetThumbnailSrc,
  type ImageAsset,
  type ImageViewerState
} from "./core";
import {
  ActionButton,
  ButtonBase,
  DialogShell,
  IconActionButton,
  SurfaceBody,
  SurfaceHeader
} from "./ui";
import { useStableEvent } from "./use-stable-event";

const IMAGE_VIEWER_MIN_SCALE = 0.05;
const IMAGE_VIEWER_MAX_SCALE = 8;
const CLOSE_BUTTON_REASON = "close-button" as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function imageOrientationForSize(size?: { width: number; height: number } | null) {
  if (!size?.width || !size.height) return "unknown";
  const ratio = size.width / size.height;
  if (ratio >= 1.22) return "landscape";
  if (ratio <= 0.82) return "portrait";
  return "square";
}

export function ImageViewer({
  viewer,
  setViewer,
  close,
  openFolder,
  saveAs,
  exportPsd,
  openAssetMenu
}: {
  viewer: ImageViewerState;
  setViewer: Dispatch<SetStateAction<ImageViewerState | null>>;
  close: () => void;
  openFolder: (asset?: ImageAsset) => void | Promise<void>;
  saveAs: (index: number) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
  exportPsd: (index: number) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
  openAssetMenu: (event: MouseEvent, index: number) => void;
}) {
  const asset = viewer.assets[viewer.index] ?? viewer.assets[0];
  const src = imageAssetSrc(asset);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const userAdjustedImageRef = useRef(false);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
  } | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [imageView, setImageView] = useState({ scale: 1, x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const viewerOrientation = imageOrientationForSize(naturalSize);

  function setIndex(index: number) {
    const nextIndex = (index + viewer.assets.length) % viewer.assets.length;
    setViewer((current) => (current ? { ...current, index: nextIndex } : current));
  }

  function fitScaleFor(size = naturalSize) {
    const stage = stageRef.current;
    if (!stage || !size?.width || !size.height) return 1;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 1;
    const padding = 26;
    return clamp(
      Math.min((rect.width - padding) / size.width, (rect.height - padding) / size.height, 1),
      IMAGE_VIEWER_MIN_SCALE,
      IMAGE_VIEWER_MAX_SCALE
    );
  }

  function fitImage(size = naturalSize, markUser = false) {
    if (markUser) userAdjustedImageRef.current = true;
    setImageView({ scale: fitScaleFor(size), x: 0, y: 0 });
  }

  function showActualSize() {
    userAdjustedImageRef.current = true;
    setImageView({ scale: 1, x: 0, y: 0 });
  }

  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    userAdjustedImageRef.current = true;
    setImageView((current) => {
      const nextScale = clamp(current.scale * factor, IMAGE_VIEWER_MIN_SCALE, IMAGE_VIEWER_MAX_SCALE);
      if (nextScale === current.scale) return current;

      const rect = stageRef.current?.getBoundingClientRect();
      const pointerX = rect && clientX !== undefined ? clientX - rect.left - rect.width / 2 : 0;
      const pointerY = rect && clientY !== undefined ? clientY - rect.top - rect.height / 2 : 0;
      const worldX = (pointerX - current.x) / current.scale;
      const worldY = (pointerY - current.y) / current.scale;

      return {
        scale: nextScale,
        x: pointerX - worldX * nextScale,
        y: pointerY - worldY * nextScale
      };
    });
  }

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    const size = {
      width: image.naturalWidth || 1,
      height: image.naturalHeight || 1
    };
    setNaturalSize(size);
    window.requestAnimationFrame(() => {
      if (!userAdjustedImageRef.current) fitImage(size);
    });
  }

  const handleViewerWheel = useStableEvent((event: WheelEvent) => {
    event.preventDefault();
    zoomAt(event.deltaY > 0 ? 0.88 : 1.12, event.clientX, event.clientY);
  });

  function beginPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    userAdjustedImageRef.current = true;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewX: imageView.x,
      viewY: imageView.y
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    setImageView((current) => ({
      ...current,
      x: pan.viewX + event.clientX - pan.startX,
      y: pan.viewY + event.clientY - pan.startY
    }));
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }
    panRef.current = null;
    setIsPanning(false);
  }

  useEffect(() => {
    setNaturalSize(null);
    setImageView({ scale: 1, x: 0, y: 0 });
    setIsPanning(false);
    panRef.current = null;
    userAdjustedImageRef.current = false;
  }, [src]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.addEventListener("wheel", handleViewerWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleViewerWheel);
  }, [handleViewerWheel]);

  const handleViewerKey = useStableEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") close();
    else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAt(1.12);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomAt(0.88);
    } else if (event.key === "0") {
      event.preventDefault();
      fitImage(undefined, true);
    } else if (event.key === "1") {
      event.preventDefault();
      showActualSize();
    } else if (event.key === "ArrowRight" && viewer.assets.length > 1) {
      event.preventDefault();
      setIndex(viewer.index + 1);
    } else if (event.key === "ArrowLeft" && viewer.assets.length > 1) {
      event.preventDefault();
      setIndex(viewer.index - 1);
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleViewerKey);
    return () => window.removeEventListener("keydown", handleViewerKey);
  }, [handleViewerKey]);

  return (
    <DialogShell
      surface="image-viewer"
      ariaLabel="图片查看"
      layerClassName="image-viewer-layer"
      className={`image-viewer image-${viewerOrientation}`}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={viewer.nodeTitle}
            description={`图片 ${viewer.index + 1}/${viewer.assets.length}${naturalSize ? ` · ${naturalSize.width} × ${naturalSize.height}` : ""}`}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭图片查看器"
          >
            <div className="image-viewer-actions" aria-label="图片查看工具">
              <IconActionButton label="缩小图片" onClick={() => zoomAt(0.88)} icon={<Minus size={18} />} />
              <span className="viewer-zoom-label">{Math.round(imageView.scale * 100)}%</span>
              <IconActionButton label="放大图片" onClick={() => zoomAt(1.12)} icon={<Plus size={18} />} />
              <IconActionButton label="适配窗口" onClick={() => fitImage(undefined, true)} icon={<Maximize2 size={18} />} />
              <ActionButton variant="ghost" className="actual-size-button" onClick={showActualSize} aria-label="按原始大小查看" title="按原始大小查看">
                100%
              </ActionButton>
              <IconActionButton label="另存为" onClick={() => void saveAs(viewer.index)} icon={<Download size={18} />} />
              <IconActionButton label="导出 Photoshop PSD" onClick={() => void exportPsd(viewer.index)} icon={<Layers3 size={18} />} />
              {asset?.path ? (
                <IconActionButton label="打开图片文件夹" onClick={() => openFolder(asset)} icon={<FolderOpen size={18} />} />
              ) : null}
            </div>
          </SurfaceHeader>
          <SurfaceBody className="image-viewer-body">
            <div
              ref={stageRef}
              className={`image-viewer-stage ${isPanning ? "is-panning" : ""}`}
              data-scale={imageView.scale.toFixed(3)}
              data-offset-x={Math.round(imageView.x)}
              data-offset-y={Math.round(imageView.y)}
              onPointerDown={beginPan}
              onPointerMove={movePan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onDoubleClick={() => (Math.abs(imageView.scale - 1) > 0.02 ? showActualSize() : fitImage(undefined, true))}
              onContextMenu={(event) => openAssetMenu(event, viewer.index)}
            >
              <img
                src={src}
                alt={`生成图 ${viewer.index + 1}`}
                draggable={false}
                onLoad={handleImageLoad}
                style={{
                  width: naturalSize?.width ? `${naturalSize.width}px` : undefined,
                  height: naturalSize?.height ? `${naturalSize.height}px` : undefined,
                  transform: `translate(-50%, -50%) translate3d(${imageView.x}px, ${imageView.y}px, 0) scale(${imageView.scale})`
                }}
              />
            </div>
            {viewer.assets.length > 1 ? (
              <div className="image-viewer-strip" aria-label="图片列表">
                {viewer.assets.map((item, index) => (
                  <ButtonBase
                    key={`${item.runId || item.assetUrl || item.url || item.path || "asset"}-${item.index ?? index}-${index}`}
                    className={`ui-choice-row ${index === viewer.index ? "active" : ""}`}
                    type="button"
                    aria-label={`查看图片 ${index + 1}`}
                    title={`查看图片 ${index + 1}`}
                    onClick={() => setIndex(index)}
                    onContextMenu={(event) => openAssetMenu(event, index)}
                  >
                    <img src={imageAssetThumbnailSrc(item)} alt={`生成图 ${index + 1}`} draggable={false} loading="lazy" decoding="async" />
                  </ButtonBase>
                ))}
              </div>
            ) : null}
          </SurfaceBody>
        </>
      )}
    </DialogShell>
  );
}
