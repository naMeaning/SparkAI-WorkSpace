import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentProviderSnapshot } from "./core";

export const AGENT_PROVIDER_CHANGED = "sparkai-agent-provider-changed";
export function agentProviderLabel(profile?: AgentProviderSnapshot | null) {
  if (!profile) return "服务状态待确认";
  return profile.providerKind === "cloud" ? "云端 Agent" : profile.providerKind === "managed-local" ? "托管本地 Agent" : "本地 Agent";
}
export function agentProviderNetworkLabel(profile: AgentProviderSnapshot) {
  return profile.strictOffline ? "严格离线 · 仅本机连接" : profile.networkScope === "local" ? "本机服务 · 可用网络工具" : "远程服务 · 使用网络";
}
export function useAgentProviderStatus(projectId: string, enabled: boolean) {
  const [selected, setSelected] = useState<AgentProviderSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [resolvedProject, setResolvedProject] = useState<string | null>(null);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++epoch.current;
    if (!window.naimageAgent?.providerControl) { setResolvedProject(projectId); setReady(true); return; }
    try {
      const result = await window.naimageAgent.providerControl({ action: "status", ...(projectId ? { projectId } : {}) });
      if (epoch.current !== current) return;
      if (!result.ok || !result.selected) throw new Error(result.errorCode || "AGENT_PROVIDER_UNAVAILABLE");
      setSelected(previous => JSON.stringify(previous) === JSON.stringify(result.selected) ? previous : result.selected!);
      setError("");
    } catch (failure) { if (epoch.current === current) { setSelected(null); setError(failure instanceof Error ? failure.message : "AGENT_PROVIDER_UNAVAILABLE"); } }
    finally { if (epoch.current === current) { setResolvedProject(projectId); setReady(true); } }
  }, [projectId]);
  useEffect(() => {
    if (!enabled) return;
    setReady(false);
    void refresh();
    const listener = () => { void refresh(); };
    const timer = window.setInterval(listener, 2000);
    window.addEventListener("focus", listener);
    window.addEventListener(AGENT_PROVIDER_CHANGED, listener);
    return () => { ++epoch.current; window.clearInterval(timer); window.removeEventListener("focus", listener); window.removeEventListener(AGENT_PROVIDER_CHANGED, listener); };
  }, [enabled, refresh]);
  return { selected, ready: ready && resolvedProject === projectId, error, refresh };
}
