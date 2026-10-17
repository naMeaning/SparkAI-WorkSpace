import { useEffect, useState } from "react";
import type { ImageOperationSummary } from "./core";
import { ActionButton, DialogShell, SurfaceHeader, SurfaceBody, SurfaceFooter } from "./ui";

const stateLabels: Record<string, string> = { accepted: "查询原任务", uncertain: "创建结果不确定，请到渠道核对", response: "已有原结果", "delivery-failed": "原结果保存未完成", partial: "部分图片已保存", saved: "成果已保存，可恢复到画布", rejected: "请求未受理，请修正配置" };
export default function ImageRecoveryDialog({ load, recover, close }: { load: () => Promise<ImageOperationSummary[]>; recover: (key: string) => Promise<unknown>; close: () => void }) {
  const [items, setItems] = useState<ImageOperationSummary[]>([]), [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function refresh() { try { setItems((await load()).reverse()); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } }
  useEffect(() => { void refresh(); }, []);
  return <DialogShell surface="image-recovery" ariaLabel="恢复图片结果" className="image-recovery-dialog" onRequestClose={close}>
    {({ requestClose }) => <>
      <SurfaceHeader title="恢复图片结果" description="查询原任务或重试保存已有图片。恢复不会重新生图。" onClose={() => requestClose("close-button")} />
      <SurfaceBody>
        {error ? <p role="alert">{error}</p> : null}
        {!items.length ? <p>当前项目没有待恢复的图片记录。</p> : items.map(item => <section key={item.key} style={{ padding: "12px 0", borderBottom: "1px solid var(--border-color)" }}>
          <strong>{item.model} · 第 {item.requestIndex} 项</strong>
          <p>{stateLabels[item.state] || "保存未完成"} · 已保存 {item.savedCount} 张</p>
          <small>{new Date(item.createdAt).toLocaleString()} {item.errorCategory ? `· ${item.errorCategory}` : ""}</small>
          <div><ActionButton disabled={!item.canRecover || Boolean(busy)} busy={busy === item.key} onClick={() => {
            setBusy(item.key); setError("");
            void recover(item.key).then(refresh).catch(async e => {
              setError(e instanceof Error ? e.message : String(e));
              await refresh();
            }).finally(() => setBusy(""));
          }}>{item.taskIdPresent && !item.savedCount ? "查询原任务并保存" : "恢复已有结果"}</ActionButton></div>
        </section>)}
      </SurfaceBody>
      <SurfaceFooter><ActionButton disabled={Boolean(busy)} onClick={() => void refresh()}>刷新记录</ActionButton><ActionButton onClick={() => requestClose("action")}>完成</ActionButton></SurfaceFooter>
    </>}
  </DialogShell>;
}
