import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { MenuSurface } from "./menu-surface";
import { ButtonBase, joinClassNames } from "./primitives";

export type GlassSelectOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  description?: React.ReactNode;
};

export type GlassSelectProps = {
  value: string;
  options: readonly GlassSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: React.ReactNode;
  disabled?: boolean;
  className?: string;
};

/**
 * A small controlled listbox for settings surfaces. Native select popovers are
 * owned by Windows and cannot follow the active glass theme, so this surface
 * keeps the same value contract while rendering through the document menu
 * portal and exposing a predictable keyboard interaction.
 */
export function GlassSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "请选择",
  disabled = false,
  className,
}: GlassSelectProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const firstEnabledIndex = Math.max(0, options.findIndex((option) => !option.disabled));

  useEffect(() => {
    if (!open) return;
    const focusIndex = selected && !selected.disabled ? selectedIndex : firstEnabledIndex;
    const option = options[focusIndex];
    const frame = window.requestAnimationFrame(() => {
      if (option) optionRefs.current[option.value]?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [firstEnabledIndex, open, options, selected, selectedIndex]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function close() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  function openMenu() {
    if (disabled || !options.length || !triggerRef.current) return;
    setOpen(true);
  }

  function focusOption(index: number) {
    if (!options.length) return;
    const direction = index < 0 ? -1 : 1;
    let next = ((index % options.length) + options.length) % options.length;
    for (let count = 0; count < options.length; count += 1) {
      if (!options[next]?.disabled) {
        optionRefs.current[options[next].value]?.focus({ preventScroll: true });
        return;
      }
      next = (next + direction + options.length) % options.length;
    }
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      window.requestAnimationFrame(() => focusOption(selectedIndex - 1));
    }
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const currentValue = (document.activeElement as HTMLButtonElement | null)?.dataset.glassSelectValue;
    const currentIndex = options.findIndex((option) => option.value === currentValue);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(currentIndex + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const option = options.find((candidate) => candidate.value === currentValue);
      if (!option || option.disabled) return;
      event.preventDefault();
      onChange(option.value);
      close();
    }
  }

  const rect = triggerRef.current?.getBoundingClientRect();
  return (
    <div className={joinClassNames("glass-select", open && "is-open", className)} data-glass-select="true">
      <ButtonBase
        ref={triggerRef}
        className="glass-select-trigger"
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="glass-select-value" title={selected ? String(selected.label) : undefined}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </ButtonBase>
      {open && rect ? (
        <MenuSurface
          className="glass-select-menu"
          x={rect.left}
          y={rect.bottom + 5}
          ariaLabel={ariaLabel}
          onRequestClose={close}
          onKeyDown={handleMenuKeyDown}
          style={{ width: Math.max(180, Math.min(360, rect.width)) }}
        >
          <div id={listboxId} className="glass-select-options" role="listbox" aria-label={ariaLabel}>
            {options.map((option) => (
              <ButtonBase
                key={option.value}
                ref={(element) => { optionRefs.current[option.value] = element; }}
                className={joinClassNames("glass-select-option", option.value === value && "is-selected")}
                type="button"
                role="option"
                id={`${listboxId}-${option.value || "empty"}`}
                data-ui-menu-focus="true"
                data-glass-select-value={option.value}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
              >
                <span className="glass-select-option-copy">
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                {option.value === value ? <Check size={14} aria-hidden="true" /> : null}
              </ButtonBase>
            ))}
          </div>
        </MenuSurface>
      ) : null}
    </div>
  );
}
