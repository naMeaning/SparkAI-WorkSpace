import { cloneElement, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { ButtonBase } from "./ui";

type CanvasToolbarPagesProps = {
  expanded: boolean;
  children: ReactElement<ButtonHTMLAttributes<HTMLButtonElement> & { "data-plugin-command"?: string }>[];
};

/** Keeps each command intact while the canvas and Agent panel change width. */
export function CanvasToolbarPages({ expanded, children }: CanvasToolbarPagesProps) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [pageStarts, setPageStarts] = useState([0]);
  const [anchor, setAnchor] = useState(0);
  const commandKeys = children.map((child) => child.key).join("|");

  useLayoutEffect(() => setAnchor(0), [commandKeys]);

  useLayoutEffect(() => {
    const actions = actionsRef.current;
    const measurement = measureRef.current;
    if (!expanded || !actions || !measurement) return;
    const measure = () => {
      const available = actions.getBoundingClientRect().width;
      if (available <= 0) return;
      const gap = parseFloat(getComputedStyle(actions).columnGap) || 0;
      const starts = [0];
      let used = 0;
      Array.from(measurement.children).forEach((child, index) => {
        const width = child.getBoundingClientRect().width;
        if (used > 0 && used + gap + width > available + 0.5) {
          starts.push(index);
          used = width;
        } else {
          used += (used > 0 ? gap : 0) + width;
        }
      });
      setPageStarts((previous) => previous.length === starts.length && previous.every((start, index) => start === starts[index]) ? previous : starts);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(actions);
    Array.from(measurement.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [children, expanded]);

  // Preserve the viewed command on resize; a changed/filtered tool list starts at page one.
  const safeAnchor = Math.min(anchor, Math.max(0, children.length - 1));
  const page = pageStarts.reduce((current, start, index) => start <= safeAnchor ? index : current, 0);
  const start = pageStarts[page];
  const end = pageStarts[page + 1] ?? children.length;

  return (
    <div className="canvas-plugin-toolbar-pages" aria-hidden={!expanded}>
      <div id="canvas-plugin-toolbar-actions" className="canvas-plugin-toolbar-actions" ref={actionsRef}>
        {children.slice(start, end)}
      </div>
      <div className="canvas-plugin-toolbar-pagination" aria-label="画布工具分页">
        <ButtonBase
          className="canvas-plugin-toolbar-previous"
          aria-label="上一页画布工具"
          aria-controls="canvas-plugin-toolbar-actions"
          title="上一页"
          disabled={page === 0}
          tabIndex={expanded ? 0 : -1}
          onClick={() => setAnchor(pageStarts[page - 1])}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </ButtonBase>
        <span className="canvas-plugin-toolbar-page" aria-live="polite" aria-atomic="true" aria-label={`第 ${page + 1} 页，共 ${pageStarts.length} 页`}>
          {page + 1}/{pageStarts.length}
        </span>
        <ButtonBase
          className="canvas-plugin-toolbar-next"
          aria-label="下一页画布工具"
          aria-controls="canvas-plugin-toolbar-actions"
          title="下一页"
          disabled={page === pageStarts.length - 1}
          tabIndex={expanded ? 0 : -1}
          onClick={() => setAnchor(pageStarts[page + 1])}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </ButtonBase>
      </div>
      <div className="canvas-plugin-toolbar-actions canvas-plugin-toolbar-measure" aria-hidden="true" ref={measureRef}>
        {children.map((child) => cloneElement(child, { disabled: true, tabIndex: -1, "data-plugin-command": undefined }))}
      </div>
    </div>
  );
}
