import React, { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

export function joinClassNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("naimage main UI error", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fatal-screen">
          <div>
            <span className="eyebrow">Main Error</span>
            <h1>SparkAI WorkSpace 界面启动失败</h1>
            <p>{this.state.error.message}</p>
            <ButtonBase onClick={() => window.location.reload()}>
              重新加载
            </ButtonBase>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Field({
  label,
  hint,
  error,
  className,
  children,
  ...labelProps
}: Omit<React.LabelHTMLAttributes<HTMLLabelElement>, "children"> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
}) {
  const supportingText = error ?? hint;
  return (
    <label
      {...labelProps}
      className={joinClassNames("ui-field", className)}
      data-ui-field="true"
      data-ui-invalid={error ? "true" : "false"}
    >
      <span className="ui-field-label">{label}</span>
      {children}
      {supportingText ? (
        <small className={joinClassNames("ui-field-message", error ? "is-error" : undefined)}>{supportingText}</small>
      ) : null}
    </label>
  );
}

export function CodeField({
  label,
  hint,
  error,
  fieldClassName,
  labelHidden = false,
  fill = false,
  className,
  ...textareaProps
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "children"> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  fieldClassName?: string;
  labelHidden?: boolean;
  fill?: boolean;
}) {
  return (
    <Field
      className={joinClassNames(
        "ui-code-field",
        labelHidden && "is-label-hidden",
        fill && "is-fill",
        fieldClassName
      )}
      label={label}
      hint={hint}
      error={error}
    >
      <textarea
        {...textareaProps}
        className={joinClassNames("ui-control", "ui-code-field-control", className)}
        data-ui-control="code"
      />
    </Field>
  );
}

export type UiFeedbackTone = "neutral" | "info" | "success" | "warning" | "danger";

export function InlineNotice({
  tone = "info",
  icon,
  className,
  children,
  role,
  ...noticeProps
}: React.HTMLAttributes<HTMLDivElement> & {
  tone?: UiFeedbackTone;
  icon?: React.ReactNode;
}) {
  return (
    <div
      {...noticeProps}
      className={joinClassNames("ui-inline-notice", `ui-tone-${tone}`, className)}
      data-ui-notice="true"
      data-ui-tone={tone}
      role={role ?? (tone === "danger" ? "alert" : "note")}
    >
      {icon ? <span className="ui-inline-notice-icon" aria-hidden="true">{icon}</span> : null}
      <div className="ui-inline-notice-copy">{children}</div>
    </div>
  );
}

export function StatusLine({
  tone = "neutral",
  busy = false,
  icon,
  live = "off",
  className,
  children,
  role,
  ...statusProps
}: React.HTMLAttributes<HTMLDivElement> & {
  tone?: UiFeedbackTone;
  busy?: boolean;
  icon?: React.ReactNode;
  live?: "off" | "polite" | "assertive";
}) {
  return (
    <div
      {...statusProps}
      className={joinClassNames("ui-status-line", `ui-tone-${tone}`, busy && "is-busy", className)}
      data-ui-status="true"
      data-ui-tone={tone}
      data-ui-busy={busy ? "true" : "false"}
      role={role ?? (live === "off" ? undefined : "status")}
      aria-live={live === "off" ? undefined : live}
      aria-atomic={live === "off" ? undefined : true}
    >
      {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : icon}
      <span>{children}</span>
    </div>
  );
}

/**
 * Semantic base for controls whose visual treatment comes from their host
 * surface (menus, segmented controls, canvas chrome). Keeping the default
 * button type here prevents accidental form submission without repeating the
 * same DOM contract throughout the workspace.
 */
export function ButtonBase({
  type = "button",
  className,
  ...buttonProps
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...buttonProps} type={type} className={joinClassNames("ui-button-base", className)} />;
}

export function ActionButton({
  variant = "secondary",
  busy = false,
  icon,
  className,
  children,
  disabled,
  ...buttonProps
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <ButtonBase
      {...buttonProps}
      type={buttonProps.type ?? "button"}
      className={joinClassNames("ui-action-button", `ui-action-${variant}`, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-ui-control="action"
      data-ui-variant={variant}
    >
      {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : icon}
      <span>{children}</span>
    </ButtonBase>
  );
}

export function IconActionButton({
  label,
  icon,
  className,
  title,
  ...buttonProps
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <ButtonBase
      {...buttonProps}
      type={buttonProps.type ?? "button"}
      className={joinClassNames("ui-icon-action", className)}
      aria-label={buttonProps["aria-label"] ?? label}
      title={title ?? label}
      data-ui-control="icon"
    >
      {icon}
    </ButtonBase>
  );
}

export function SegmentedControl({
  className,
  role = "group",
  ...groupProps
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...groupProps}
      role={role}
      className={joinClassNames("ui-segmented-control", className)}
      data-ui-control-group="segmented"
    />
  );
}

export function SegmentButton({
  active = false,
  className,
  ...buttonProps
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <ButtonBase
      {...buttonProps}
      className={joinClassNames("ui-segment-action", active && "active", className)}
      aria-pressed={buttonProps["aria-pressed"] ?? active}
      data-ui-control="segment"
      data-ui-active={active ? "true" : "false"}
    />
  );
}

export function SearchField({
  label,
  icon,
  className,
  inputProps
}: {
  label: string;
  icon?: React.ReactNode;
  className?: string;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const generatedId = useId();
  const inputId = inputProps?.id || generatedId;
  return (
    <label className={joinClassNames("ui-search-field", className)} htmlFor={inputId} data-ui-search-field="true">
      <span className="sr-only">{label}</span>
      {icon ? <span className="ui-search-field-icon" aria-hidden="true">{icon}</span> : null}
      <input {...inputProps} id={inputId} aria-label={inputProps?.["aria-label"] ?? label} type={inputProps?.type ?? "search"} />
    </label>
  );
}

function finiteInputNumber(value: string | number | readonly string[] | undefined) {
  const number = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizedDeferredNumber(
  value: number,
  min: number | undefined,
  max: number | undefined,
  step: number | undefined
) {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  if (step !== undefined && step > 0) {
    const origin = min ?? 0;
    next = origin + Math.round((next - origin) / step) * step;
    const precision = Math.max(0, String(step).split(".")[1]?.length ?? 0);
    next = Number(next.toFixed(Math.min(12, precision)));
  }
  return next;
}

/**
 * A controlled number field that preserves an empty editing state. Native
 * controlled number inputs otherwise snap back to the last value as soon as
 * the user presses Backspace, which makes replacing the whole value awkward.
 */
export function DeferredNumberInput({
  value,
  onValueChange,
  onBlur,
  onKeyDown,
  min,
  max,
  step,
  ...inputProps
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: number;
  onValueChange: (value: number) => void;
}) {
  const focusedRef = useRef(false);
  const [draft, setDraft] = useState(() => String(value));
  const minimum = finiteInputNumber(min);
  const maximum = finiteInputNumber(max);
  const increment = finiteInputNumber(step);

  useEffect(() => {
    if (!focusedRef.current) setDraft(String(value));
  }, [value]);

  function commit(raw: string, restoreInvalid = true) {
    const parsed = Number(raw);
    if (!raw.trim() || !Number.isFinite(parsed)) {
      if (restoreInvalid) setDraft(String(value));
      return;
    }
    const normalized = normalizedDeferredNumber(parsed, minimum, maximum, increment);
    setDraft(String(normalized));
    if (normalized !== value) onValueChange(normalized);
  }

  return (
    <input
      {...inputProps}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onFocus={(event) => {
        focusedRef.current = true;
        inputProps.onFocus?.(event);
      }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (!next.trim()) return;
        const parsed = Number(next);
        if (!Number.isFinite(parsed)) return;
        if (minimum !== undefined && parsed < minimum) return;
        if (maximum !== undefined && parsed > maximum) return;
        const normalized = normalizedDeferredNumber(parsed, minimum, maximum, increment);
        if (normalized !== value) onValueChange(normalized);
      }}
      onBlur={(event) => {
        focusedRef.current = false;
        commit(event.currentTarget.value);
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit(event.currentTarget.value);
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(String(value));
          event.currentTarget.blur();
        }
        onKeyDown?.(event);
      }}
    />
  );
}
