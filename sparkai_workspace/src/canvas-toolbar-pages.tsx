import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactElement } from "react";
import { Search, WandSparkles } from "lucide-react";
import { ButtonBase, IconActionButton, MenuItem, MenuSeparator, MenuSummary, MenuSurface } from "./ui";

type ToolButton = ReactElement<ButtonHTMLAttributes<HTMLButtonElement> & { "data-plugin-command"?: string }>;
type ToolDetail = { label: string; description: string; group: string; shortcut?: string };

/** One entry point for the existing commands; visibility never changes enabled state. */
export function CanvasToolbarPages({ expanded, children, details, recentCommands }: {
  expanded: boolean; children: ToolButton[]; details: Record<string, ToolDetail>; recentCommands: string[];
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerId = useId();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const keyOf = (child: ToolButton) => child.props["data-plugin-command"] || String(child.key);
  const groupOf = (child: ToolButton) => details[keyOf(child)]?.group || "通用创作";
  const groups = [...new Set(children.map(groupOf))];
  const selectedGroup = groups.includes(group) ? group : "";
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = children.filter((child) => {
    const id = keyOf(child), detail = details[id];
    return (!selectedGroup || groupOf(child) === selectedGroup)
      && `${detail?.label || ""} ${detail?.description || ""} ${groupOf(child)} ${id}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const visibleGroups = groups.filter((item) => filtered.some((child) => groupOf(child) === item));
  const recent = normalizedQuery || selectedGroup ? [] : [...new Set(recentCommands)].flatMap((id) => {
    const child = children.find((item) => keyOf(item) === id);
    return child ? [child] : [];
  }).slice(0, 3);

  useEffect(() => { if (!expanded) setMenu(null); }, [expanded]);
  useEffect(() => {
    if (!menu) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [menu]);

  const item = (child: ToolButton, prefix: string) => {
    const id = keyOf(child);
    return <MenuItem key={`${prefix}-${id}`} data-plugin-command={id} disabled={child.props.disabled} title={child.props.title}
      aria-keyshortcuts={child.props["aria-keyshortcuts"]} shortcut={details[id]?.shortcut}
      onClick={(event) => { setMenu(null); child.props.onClick?.(event); }}>{details[id]?.label || child.props.children}</MenuItem>;
  };

  return <div className="canvas-plugin-toolbar-pages" aria-hidden={!expanded}>
    <IconActionButton id={triggerId} className="canvas-all-tools-trigger" label="画布工具" icon={<WandSparkles size={16} aria-hidden="true" />}
      aria-haspopup="menu" aria-expanded={Boolean(menu)} tabIndex={expanded ? 0 : -1}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setQuery(""); setGroup("");
        setMenu(menu ? null : { x: rect.left, y: Math.max(12, rect.top - 450) });
      }} />
    {menu ? <MenuSurface {...menu} triggerId={triggerId} ariaLabel="画布工具" className="canvas-context-menu canvas-tools-menu" data-canvas-no-zoom="true"
      onRequestClose={() => setMenu(null)} onKeyDown={(event) => {
        event.stopPropagation();
        if (event.target === searchRef.current && event.key === "ArrowDown") {
          event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
        }
      }}>
      <label className="canvas-tools-search"><Search size={16} aria-hidden="true" /><input ref={searchRef} type="search" value={query}
        placeholder="搜索工具或领域" aria-label="搜索画布工具" onChange={(event) => setQuery(event.target.value.slice(0, 160))}
        onKeyDown={(event) => { if (["Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key)) event.stopPropagation(); }} /></label>
      {groups.length > 1 ? <div className="canvas-tools-domains" role="group" aria-label="工具领域">
        {["", ...groups].map((value) => <ButtonBase key={value || "all"} type="button" role="menuitem" tabIndex={-1} aria-current={selectedGroup === value ? "true" : undefined}
          onClick={() => setGroup(value)}>{value || "全部"}</ButtonBase>)}
      </div> : null}
      {recent.length ? <><MenuSummary title="最近使用" />{recent.map((child) => item(child, "recent"))}<MenuSeparator /></> : null}
      {visibleGroups.map((value) => <div key={value}><MenuSummary title={value} />{filtered.filter((child) => groupOf(child) === value).map((child) => item(child, value))}</div>)}
      {!filtered.length ? <MenuSummary title="没有匹配工具" /> : null}
    </MenuSurface> : null}
  </div>;
}
