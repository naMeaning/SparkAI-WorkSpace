import { useEffect, useRef, useState, type Dispatch, type MouseEvent, type SetStateAction, type SyntheticEvent } from "react";
import { Download, FolderOpen, Layers3, Maximize2, Minus, Plus } from "lucide-react";

import {
  imageAssetSrc,
  imageAssetThumbnailSrc,
  type ImageAsset,
  type ImageViewerState
} from "./core";
import { stableIdentityHash, stableImageAssetId, stableImageOccurrenceId } from "./asset-identity";
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

type ViewerImageFrame = {
  src: string;
  identity: string;
  size?: { width: number; height: number } | null;
};

function viewerAssetIdentity(asset: ImageAsset | undefined, nodeId: string, assetIndex: number) {
  if (!asset) return `viewer-empty-${Math.max(0, assetIndex)}`;
  const assetId = stableImageAssetId(asset, assetIndex + 1);
  const occurrenceId = stableImageOccurrenceId(asset, nodeId || "image-viewer", assetIndex);
  return `viewer-${stableIdentityHash(`${occurrenceId}|${assetId}`)}`;
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
  const sourceAssetIndex = viewer.assetIndices?.[viewer.index] ?? viewer.index;
  const assetIdentity = viewerAssetIdentity(asset, viewer.nodeId, sourceAssetIndex);
  const initialFrameRef = useRef({ src, identity: assetIdentity });
  const targetFrameRef = useRef(initialFrameRef.current);
  targetFrameRef.current = { src, identity: assetIdentity };
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
  // The dialog frame must not resize while the selected image is loading. A
  // stable class also prevents the old image from being replaced by a blank
  // orientation frame during rapid keyboard/thumbnail navigation.
  const viewerOrientation = "stable";
  const [displayedSrc, setDisplayedSrc] = useState(initialFrameRef.current.src);
  const displayedSrcRef = useRef(initialFrameRef.current.src);
  const [displayedAssetIdentity, setDisplayedAssetIdentity] = useState(initialFrameRef.current.identity);
  const displayedAssetIdentityRef = useRef(initialFrameRef.current.identity);
  const [outgoingFrame, setOutgoingFrame] = useState<ViewerImageFrame | null>(null);
  const [displayedFrameSize, setDisplayedFrameSize] = useState<{ width: number; height: number } | null>(null);
  const displayedFrameSizeRef = useRef<{ width: number; height: number } | null>(null);
  const preloadSequenceRef = useRef(0);

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
    // The outgoing buffer may finish decoding after the active buffer. It
    // must never change the active dimensions or fit transform.
    if (
      image.dataset.viewerSrc !== displayedSrcRef.current ||
      image.dataset.viewerIdentity !== displayedAssetIdentityRef.current
    ) return;
    const size = {
      width: image.naturalWidth || 1,
      height: image.naturalHeight || 1
    };
    displayedFrameSizeRef.current = size;
    setDisplayedFrameSize(size);
    setNaturalSize(size);
    setOutgoingFrame(null);
    window.requestAnimationFrame(() => {
      if (!userAdjustedImageRef.current) fitImage(size);
    });
  }

  useEffect(() => {
    if (!src || (src === displayedSrcRef.current && assetIdentity === displayedAssetIdentityRef.current)) return;
    const sequence = ++preloadSequenceRef.current;
    const requestedFrame = { src, identity: assetIdentity };
    let disposed = false;
    const preload = new window.Image();
    const requestIsCurrent = () => (
      !disposed &&
      sequence === preloadSequenceRef.current &&
      targetFrameRef.current.src === requestedFrame.src &&
      targetFrameRef.current.identity === requestedFrame.identity
    );
    preload.decoding = "async";
    preload.onload = async () => {
      if (!requestIsCurrent()) return;
      const size = {
        width: preload.naturalWidth || 1,
        height: preload.naturalHeight || 1
      };
      // `onload` means the bytes are available, but decode can still be
      // pending. Wait for the compositor-ready bitmap before swapping the
      // visible layer.
      if (typeof preload.decode === "function") {
        try {
          await preload.decode();
        } catch {
          // Keep the previous frame visible when Chromium cannot produce a
          // compositor-ready bitmap for the requested asset.
          return;
        }
      }
      if (!requestIsCurrent()) return;
      // Keep the old image mounted until the new one is decoded. React then
      // mounts the new buffer above it and removes the old buffer on the next
      // frame, avoiding a blank frame between thumbnails.
      const previousFrame: ViewerImageFrame = {
        src: displayedSrcRef.current,
        identity: displayedAssetIdentityRef.current,
        size: displayedFrameSizeRef.current
      };
      setOutgoingFrame(previousFrame.src && previousFrame.identity !== requestedFrame.identity ? previousFrame : null);
      displayedSrcRef.current = requestedFrame.src;
      displayedAssetIdentityRef.current = requestedFrame.identity;
      setDisplayedSrc(requestedFrame.src);
      setDisplayedAssetIdentity(requestedFrame.identity);
      displayedFrameSizeRef.current = size;
      setDisplayedFrameSize(size);
      setNaturalSize(size);
      setIsPanning(false);
      panRef.current = null;
      userAdjustedImageRef.current = false;
      window.requestAnimationFrame(() => {
        if (requestIsCurrent() && displayedAssetIdentityRef.current === requestedFrame.identity && !userAdjustedImageRef.current) {
          setImageView({ scale: fitScaleFor(size), x: 0, y: 0 });
        }
      });
    };
    preload.onerror = () => {
      // Leave the previous image visible when a transient asset URL fails.
      if (requestIsCurrent()) {
        setIsPanning(false);
        panRef.current = null;
      }
    };
    preload.src = src;
    return () => {
      disposed = true;
      preload.onload = null;
      preload.onerror = null;
    };
  }, [src, assetIdentity]);

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
    if (displayedSrcRef.current === src && displayedAssetIdentityRef.current === assetIdentity) return;
    // The preload effect owns the actual source swap. Do not clear the old
    // dimensions or transform here; that was the source of the visible flash.
    setIsPanning(false);
    panRef.current = null;
  }, [src, assetIdentity]);

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
              data-displayed-src={displayedSrc}
              data-target-src={src}
              data-final-asset={assetIdentity}
              data-target-asset={assetIdentity}
              data-displayed-asset={displayedAssetIdentity}
              data-buffering={displayedSrc === src && displayedAssetIdentity === assetIdentity ? "false" : "true"}
              onPointerDown={beginPan}
              onPointerMove={movePan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onDoubleClick={() => (Math.abs(imageView.scale - 1) > 0.02 ? showActualSize() : fitImage(undefined, true))}
              onContextMenu={(event) => openAssetMenu(event, viewer.index)}
            >
              {outgoingFrame ? (
                <img
                  key={`outgoing:${outgoingFrame.identity}:${outgoingFrame.src}`}
                  className="image-viewer-image image-viewer-image-outgoing"
                  src={outgoingFrame.src}
                  data-viewer-src={outgoingFrame.src}
                  data-viewer-identity={outgoingFrame.identity}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  style={{
                    width: outgoingFrame.size?.width ? `${outgoingFrame.size.width}px` : undefined,
                    height: outgoingFrame.size?.height ? `${outgoingFrame.size.height}px` : undefined,
                    transform: `translate(-50%, -50%) translate3d(${imageView.x}px, ${imageView.y}px, 0) scale(${imageView.scale})`
                  }}
                />
              ) : null}
              <img
                key={`current:${displayedAssetIdentity}:${displayedSrc}`}
                className="image-viewer-image image-viewer-image-current"
                src={displayedSrc}
                data-viewer-src={displayedSrc}
                data-viewer-identity={displayedAssetIdentity}
                alt={`生成图 ${viewer.index + 1}`}
                draggable={false}
                onLoad={handleImageLoad}
                style={{
                  width: displayedFrameSize?.width ? `${displayedFrameSize.width}px` : naturalSize?.width ? `${naturalSize.width}px` : undefined,
                  height: displayedFrameSize?.height ? `${displayedFrameSize.height}px` : naturalSize?.height ? `${naturalSize.height}px` : undefined,
                  transform: `translate(-50%, -50%) translate3d(${imageView.x}px, ${imageView.y}px, 0) scale(${imageView.scale})`
                }}
              />
            </div>
            {viewer.assets.length > 1 ? (
              <div
                className="image-viewer-strip"
                aria-label="最终图片列表"
                data-final-asset-count={viewer.assets.length}
                data-final-asset="true"
              >
                {viewer.assets.map((item, index) => {
                  const identity = item.assetId || item.occurrenceId || item.runId || item.assetUrl || item.url || item.path || `asset-${index}`;
                  const duplicateCount = viewer.assets.slice(0, index).filter((candidate) => (
                    (candidate.assetId || candidate.occurrenceId || candidate.runId || candidate.assetUrl || candidate.url || candidate.path || "") === identity
                  )).length;
                  return (
                  <ButtonBase
                    key={`${identity}-${duplicateCount}`}
                    className={`ui-choice-row ${index === viewer.index ? "active" : ""}`}
                    type="button"
                    data-final-asset="true"
                    aria-label={`查看图片 ${index + 1}`}
                    title={`查看图片 ${index + 1}`}
                    onClick={() => setIndex(index)}
                    onContextMenu={(event) => openAssetMenu(event, index)}
                  >
                    <img src={imageAssetThumbnailSrc(item)} alt={`生成图 ${index + 1}`} draggable={false} loading="lazy" decoding="async" />
                  </ButtonBase>
                  );
                })}
              </div>
            ) : null}
          </SurfaceBody>
        </>
      )}
    </DialogShell>
  );
}
