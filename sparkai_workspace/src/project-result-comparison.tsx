import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ActionButton, IconActionButton, InlineNotice } from "./ui";
import { creationTargetKey, type CreationTarget } from "./creation-session";

export type ProjectComparisonItem = { target: CreationTarget; label: string; src: string };

export default function ProjectResultComparison({ items, close, onExport, exportBusy }: {
  items: ProjectComparisonItem[];
  close: () => void;
  onExport: (target: CreationTarget) => Promise<void>;
  exportBusy: boolean;
}) {
  const [exportError, setExportError] = useState("");
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [close]);

  async function exportItem(target: CreationTarget) {
    setExportError("");
    try { await onExport(target); }
    catch (error) { setExportError(error instanceof Error ? error.message : "图片导出失败。"); }
  }

  return <div className="project-result-comparison-backdrop" role="presentation" onClick={close}>
    <section className="project-result-comparison" role="dialog" aria-modal="true" aria-label="所选成果对比" onClick={event => event.stopPropagation()}>
      <header><strong>所选成果对比</strong><IconActionButton label="关闭成果对比" icon={<X size={16} />} onClick={close} /></header>
      {exportError ? <InlineNotice tone="danger" className="project-result-comparison-error">{exportError}</InlineNotice> : null}
      <div className="project-result-comparison-images">{items.map((item, index) => {
        const role = index === 0 ? "对比基准" : "所选版本";
        return <figure key={`${index}:${creationTargetKey(item.target)}`}>
          <div className="project-result-comparison-frame"><img src={item.src} alt={item.label} /></div>
          <figcaption className="project-result-comparison-caption">
            <span className="project-result-comparison-label">{role} · {item.label}</span>
            <ActionButton variant="secondary" className="project-result-comparison-export" aria-label={`导出${role} ${item.label}`} disabled={exportBusy}
              onClick={() => void exportItem(item.target)}>导出</ActionButton>
          </figcaption>
        </figure>;
      })}</div>
    </section>
  </div>;
}
