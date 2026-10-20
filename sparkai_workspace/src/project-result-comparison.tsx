import { useEffect } from "react";
import type { CreationTarget } from "./creation-session";
export type ProjectComparisonItem = { target: CreationTarget; label: string; src: string };
export default function ProjectResultComparison({ items, close }: { items: ProjectComparisonItem[]; close: () => void }) {
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [close]);
  return <div className="project-result-comparison-backdrop" role="presentation" onClick={close}>
    <section className="project-result-comparison" role="dialog" aria-modal="true" aria-label="所选成果对比" onClick={event => event.stopPropagation()}>
      <header><strong>所选成果对比</strong><button type="button" onClick={close} aria-label="关闭成果对比">关闭</button></header>
      <p>左侧为本次对比基准，右侧为所选版本；对比不会改变采用决定。</p>
      <div className="project-result-comparison-images">{items.map((item, index) => <figure key={JSON.stringify(item.target)}><img key={JSON.stringify(item.target)} src={item.src} alt={item.label} /><figcaption>{index === 0 ? "对比基准" : "所选版本"} · {item.label}</figcaption></figure>)}</div>
    </section>
  </div>;
}
