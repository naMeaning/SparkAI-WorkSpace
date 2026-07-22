import { useEffect, useRef, useState } from "react";

import type { OverflowTooltipState } from "../core";

function elementHasHiddenText(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const clamp = style.getPropertyValue("-webkit-line-clamp");
  return (
    element.scrollWidth > element.clientWidth + 1 ||
    element.scrollHeight > element.clientHeight + 1 ||
    (clamp && clamp !== "none" && element.scrollHeight > element.clientHeight + 1)
  );
}

function normalizeTooltipText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function elementAllowsAutoOverflowTooltip(element: HTMLElement) {
  if (element.closest(".overflow-tooltip")) return false;
  if (element.dataset.overflowTooltip !== undefined) return true;
  if (element.isContentEditable) return false;
  const tag = element.tagName.toLowerCase();
  if (["html", "body", "main", "section", "article", "aside", "form", "nav", "svg", "path", "img", "input", "textarea", "select"].includes(tag)) {
    return false;
  }
  const text = normalizeTooltipText(element.textContent || "");
  if (text.length < 2 || text.length > 900) return false;
  const style = window.getComputedStyle(element);
  const clamp = style.getPropertyValue("-webkit-line-clamp");
  const clipsText = style.overflowX === "hidden" || style.overflowX === "clip" || style.overflowY === "hidden" || style.overflowY === "clip";
  return (
    style.textOverflow === "ellipsis" ||
    (clamp && clamp !== "none") ||
    (clipsText && (style.whiteSpace === "nowrap" || style.display.includes("-webkit-box")))
  );
}

function findOverflowTooltipTarget(source: EventTarget | null) {
  if (!(source instanceof Element)) return null;
  const explicit = source.closest<HTMLElement>("[data-overflow-tooltip]");
  if (explicit) return explicit;
  let current: Element | null = source;
  while (current && current !== document.body) {
    if (current instanceof HTMLElement && elementAllowsAutoOverflowTooltip(current) && elementHasHiddenText(current)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function getOverflowTooltipText(element: HTMLElement) {
  return normalizeTooltipText(element.dataset.overflowTooltip || element.textContent || "");
}

export function OverflowTooltipLayer() {
  const [tooltip, setTooltip] = useState<OverflowTooltipState | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    function clearPending() {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function hide() {
      clearPending();
      targetRef.current = null;
      setTooltip(null);
    }

    function handlePointerOver(event: PointerEvent) {
      const target = findOverflowTooltipTarget(event.target);
      if (!target || target === targetRef.current) return;
      clearPending();
      setTooltip(null);
      targetRef.current = target;
      timerRef.current = window.setTimeout(() => {
        const current = targetRef.current;
        if (!current || current !== target || !document.contains(current) || !current.matches(":hover")) return;
        const text = getOverflowTooltipText(current);
        if (!text || !elementHasHiddenText(current)) return;
        const rect = current.getBoundingClientRect();
        const placement: OverflowTooltipState["placement"] = rect.bottom + 148 < window.innerHeight ? "bottom" : "top";
        const rawX = rect.left + rect.width / 2;
        const x = Math.max(188, Math.min(window.innerWidth - 188, rawX));
        const y = placement === "bottom" ? Math.min(window.innerHeight - 18, rect.bottom + 10) : Math.max(18, rect.top - 10);
        setTooltip({ text, x, y, placement });
      }, 3000);
    }

    function handlePointerOut(event: PointerEvent) {
      const current = targetRef.current;
      if (!current) return;
      const next = event.relatedTarget as Node | null;
      if (next && current.contains(next)) return;
      hide();
    }

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("keydown", hide);
    return () => {
      clearPending();
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("keydown", hide);
    };
  }, []);

  if (!tooltip) return null;
  return (
    <div
      className={`overflow-tooltip ${tooltip.placement}`}
      style={{ left: tooltip.x, top: tooltip.y }}
      role="tooltip"
    >
      {tooltip.text}
    </div>
  );
}
