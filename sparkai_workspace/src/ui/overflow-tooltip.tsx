import { useEffect, useId, useRef, useState } from "react";

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
  const explicit = source.closest<HTMLElement>("[data-ui-tooltip], [data-overflow-tooltip]");
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
  return normalizeTooltipText(element.dataset.uiTooltip || element.dataset.overflowTooltip || element.textContent || "");
}

export function OverflowTooltipLayer() {
  const [tooltip, setTooltip] = useState<OverflowTooltipState | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const tooltipId = `ui-tooltip-${useId()}`;
  const describedByRef = useRef<string | null>(null);

  useEffect(() => {
    let suppressFocusUntilInput = false;
    function clearPending() {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function hide() {
      clearPending();
      const current = targetRef.current;
      if (current?.getAttribute("aria-describedby") === tooltipId) {
        if (describedByRef.current) current.setAttribute("aria-describedby", describedByRef.current);
        else current.removeAttribute("aria-describedby");
      }
      describedByRef.current = null;
      targetRef.current = null;
      setTooltip(null);
    }

    function schedule(target: HTMLElement, keyboard: boolean) {
      if (target === targetRef.current && !keyboard) return;
      hide();
      targetRef.current = target;
      const explicitIcon = target.dataset.uiTooltip !== undefined;
      timerRef.current = window.setTimeout(() => {
        const current = targetRef.current;
        if (!current || current !== target || !document.contains(current)) return;
        if (keyboard ? !current.contains(document.activeElement) : !current.matches(":hover")) return;
        const text = getOverflowTooltipText(current);
        if (!text || (!explicitIcon && !elementHasHiddenText(current))) return;
        const rect = current.getBoundingClientRect();
        const placement: OverflowTooltipState["placement"] = rect.bottom + 148 < window.innerHeight ? "bottom" : "top";
        const rawX = rect.left + rect.width / 2;
        const margin = Math.min(188, window.innerWidth / 2);
        const x = Math.max(margin, Math.min(window.innerWidth - margin, rawX));
        const y = placement === "bottom" ? Math.min(window.innerHeight - 18, rect.bottom + 10) : Math.max(18, rect.top - 10);
        describedByRef.current = current.getAttribute("aria-describedby");
        current.setAttribute("aria-describedby", tooltipId);
        setTooltip({ text, x, y, placement });
      }, explicitIcon ? keyboard ? 0 : 350 : 3000);
    }

    function handlePointerOver(event: PointerEvent) {
      const target = findOverflowTooltipTarget(event.target);
      if (target) { suppressFocusUntilInput = false; schedule(target, false); }
    }

    function handlePointerOut(event: PointerEvent) {
      const current = targetRef.current;
      if (!current) return;
      const next = event.relatedTarget as Node | null;
      if (next && current.contains(next)) return;
      if (current.dataset.uiTooltip !== undefined && current.contains(document.activeElement)) return;
      hide();
    }

    function handleFocusIn(event: FocusEvent) {
      if (suppressFocusUntilInput) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-ui-tooltip]") : null;
      if (target) schedule(target, true);
    }

    function handleKeyDown(event: KeyboardEvent) { hide(); suppressFocusUntilInput = event.key === "Escape"; }
    function handlePointerDown() { suppressFocusUntilInput = false; hide(); }

    function handleFocusOut(event: FocusEvent) {
      if (event.relatedTarget instanceof Node && targetRef.current?.contains(event.relatedTarget)) return;
      hide();
    }

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      hide();
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [tooltipId]);

  if (!tooltip) return null;
  return (
    <div
      className={`overflow-tooltip ${tooltip.placement}`}
      style={{ left: tooltip.x, top: tooltip.y }}
      role="tooltip"
      id={tooltipId}
    >
      {tooltip.text}
    </div>
  );
}
