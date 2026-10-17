import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement } from "react";
import { Search } from "lucide-react";
import { ButtonBase, MenuItem, MenuSeparator, MenuSummary, MenuSurface } from "./ui";

type ToolButton = ReactElement<ButtonHTMLAttributes<HTMLButtonElement> & { "data-plugin-command"?: string }>;
type ToolDetail = { label: string; description: string; group: string; shortcut?: string };

/** Common commands plus searchable access to the existing command buttons. */
export function CanvasToolbarPages({ expanded, children, details, recentCommands }: {
  expanded: boolean; children: ToolButton[]; details: Record<string, ToolDetail>; recentCommands: string[];
}) {
  const actionsRef = useRef<HTMLDivElement>(null), measureRef = useRef<HTMLDivElement>(null), searchRef = useRef<HTMLInputElement>(null);
  const [commonCount, setCommonCount] = useState(3), [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const keyOf = (child: ToolButton) => child.props["data-plugin-command"] || String(child.key);
  const common = children.slice(0, 5);
  const commonKeys = common.map(keyOf).join("\u0000");
  useLayoutEffect(() => {
    const actions = actionsRef.current, measurement = measureRef.current;
    if (!expanded || !actions || !measurement) return;
    const measure = () => {
      const availableWidth = actions.getBoundingClientRect().width;
      let used = 0, count = 0;
      for (const child of Array.from(measurement.children)) {
        used += child.getBoundingClientRect().width + (count ? 5 : 0);
        if (used > availableWidth + 0.5) break;
        count++;
      }
      setCommonCount(count);
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(actions); observer.observe(measurement);
    for (const child of Array.from(measurement.children)) observer.observe(child);
    return () => observer.disconnect();
    // Parent renders replace React elements during every canvas interaction.
    // Measure when command identity or actual dimensions change instead.
  }, [commonKeys, expanded]);
  useEffect(() => { if (!expanded) setMenu(null); }, [expanded]);
  useEffect(() => {
    if (!menu) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [menu]);
  const filtered = children.filter(child => {
    const id = keyOf(child), detail = details[id];
    return `${detail?.label} ${detail?.description} ${detail?.group} ${id}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const groups = [...new Set(filtered.map(child => details[keyOf(child)]?.group || "通用创作"))];
  const recent = query.trim() ? [] : recentCommands.flatMap(id => { const child = children.find(c => keyOf(c) === id); return child ? [child] : []; }).slice(0, 5);
  const item = (child: ToolButton, prefix: string) => {
    const id = keyOf(child);
    return <MenuItem key={`${prefix}-${id}`} data-plugin-command={id} disabled={child.props.disabled} title={child.props.title}
      aria-keyshortcuts={child.props["aria-keyshortcuts"]} shortcut={details[id]?.shortcut} onClick={event => { setMenu(null); child.props.onClick?.(event); }}>{details[id]?.label || child.props.children}</MenuItem>;
  };
  return <div className="canvas-plugin-toolbar-pages" aria-hidden={!expanded}>
    <div id="canvas-plugin-toolbar-actions" className="canvas-plugin-toolbar-actions" ref={actionsRef}>{common.slice(0, commonCount)}</div>
    <ButtonBase type="button" className="canvas-all-tools-trigger" aria-label="全部画布工具" aria-haspopup="menu" aria-expanded={Boolean(menu)} tabIndex={expanded ? 0 : -1}
      onClick={event => { const r = event.currentTarget.getBoundingClientRect(); setQuery(""); setMenu(menu ? null : { x: r.left, y: Math.max(12, r.top - 450) }); }}><Search size={14} />全部工具</ButtonBase>
    <div className="canvas-plugin-toolbar-actions canvas-plugin-toolbar-measure" aria-hidden="true" ref={measureRef}>{common.map(child => cloneElement(child, { disabled: true, tabIndex: -1, "data-plugin-command": undefined }))}</div>
    {menu ? <MenuSurface {...menu} ariaLabel="全部画布工具" className="canvas-context-menu canvas-tools-menu" data-canvas-no-zoom="true" onRequestClose={() => setMenu(null)}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.target === searchRef.current && event.key === "ArrowDown") {
          event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
        }
        if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLButtonElement && event.target.getAttribute("role") === "menuitem") {
          event.preventDefault(); event.target.click();
        }
      }}>
      <label className="canvas-tools-search"><Search size={14} /><input ref={searchRef} type="search" value={query} placeholder="搜索工具或领域" aria-label="搜索画布工具" onChange={e => setQuery(e.target.value.slice(0, 160))} onKeyDown={event => { if (["Home", "End"].includes(event.key)) event.stopPropagation(); }} /></label>
      {recent.length ? <><MenuSummary title="最近使用" />{recent.map(child => item(child, "recent"))}<MenuSeparator /></> : null}
      {groups.map(group => <div key={group}><MenuSummary title={group} />{filtered.filter(child => (details[keyOf(child)]?.group || "通用创作") === group).map(child => item(child, group))}</div>)}
      {!filtered.length ? <MenuSummary title="没有匹配工具" /> : null}
    </MenuSurface> : null}
  </div>;
}
