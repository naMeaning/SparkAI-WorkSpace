import {
  builtinPluginManifests,
  installBuiltinPlugin,
  normalizePluginStates,
  pluginPermissionLabels,
  setBuiltinPluginEnabled,
  uninstallBuiltinPlugin,
  type PluginInstallationState
} from "./plugin-system";
import { ActionButton, ButtonBase, InlineNotice } from "./ui";

export default function PluginSettingsPanel({ states, onChange }: {
  states: PluginInstallationState[];
  onChange: (states: PluginInstallationState[]) => void;
}) {
  const normalized = normalizePluginStates(states);
  return (
    <div className="settings-plugin-catalog">
      {builtinPluginManifests.map((manifest) => {
        const state = normalized.find((item) => item.id === manifest.id);
        return (
          <article key={manifest.id} className="settings-plugin-card" data-plugin-id={manifest.id}>
            <div className="settings-plugin-card-header">
              <div>
                <strong>{manifest.name}</strong>
                <small>{manifest.publisher} · v{manifest.version}</small>
              </div>
              <span className={`settings-update-status ${state?.enabled ? "available" : ""}`}>
                {!state ? "未安装" : state.enabled ? "已启用" : "已停用"}
              </span>
            </div>
            <p>{manifest.description}</p>
            <div className="settings-plugin-permissions" aria-label={`${manifest.name} 权限`}>
              {manifest.permissions.map((permission) => <span key={permission}>{pluginPermissionLabels[permission]}</span>)}
            </div>
            <div className="settings-inline-actions">
              {!state ? (
                <ActionButton variant="primary" onClick={() => onChange(installBuiltinPlugin(normalized, manifest.id))}>安装并授权</ActionButton>
              ) : (
                <>
                  <ButtonBase
                    type="button"
                    className="settings-plugin-enable-toggle"
                    role="switch"
                    aria-checked={state.enabled}
                    onClick={() => onChange(setBuiltinPluginEnabled(normalized, manifest.id, !state.enabled))}
                  >
                    <span aria-hidden="true" />
                    {state.enabled ? "已启用" : "已停用"}
                  </ButtonBase>
                  <ActionButton variant="secondary" onClick={() => onChange(uninstallBuiltinPlugin(normalized, manifest.id))}>卸载</ActionButton>
                </>
              )}
            </div>
          </article>
        );
      })}
      <InlineNotice tone="neutral">当前只允许随 SparkAI WorkSpace 应用签名发布的声明式插件。插件不能注入任意脚本，也不能直接写项目 session；所有命令执行前都会再次检查启用状态和授权。</InlineNotice>
    </div>
  );
}
