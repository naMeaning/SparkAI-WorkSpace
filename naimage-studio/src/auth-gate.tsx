import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { KeyRound, Loader2, LogIn, Server, Shield } from "lucide-react";

import { blockImagePaste, type AuthDraft, type LicenseStatus } from "./core";
import {
  ActionButton,
  Field,
  InlineNotice,
  SegmentedControl,
  SegmentButton
} from "./ui";
import { WindowControls } from "./window-controls";

function AuthTitlebar({ status }: { status: string }) {
  return (
    <header className="ide-topbar auth-topbar">
      <div className="titlebar-brand">
        <img className="titlebar-brand-icon" src="./naimage.png" alt="" draggable={false} />
        <strong>naimage</strong>
      </div>
      <span className="auth-titlebar-status">{status}</span>
      <span className="auth-titlebar-spacer" aria-hidden="true" />
      <WindowControls />
    </header>
  );
}

export function BootScreen({ message }: { message: string }) {
  return (
    <main className="auth-shell" onPasteCapture={blockImagePaste}>
      <AuthTitlebar status="启动检查" />
      <div className="auth-stage">
        <section className="auth-card boot-card" aria-label="启动检查">
          <img className="auth-brand-icon" src="./naimage.png" alt="" draggable={false} />
          <span className="eyebrow">SparkAI Workspace</span>
          <h1>正在启动</h1>
          <p>{message}</p>
          <div className="boot-line">
            <Loader2 size={16} className="spin" />
            <span>正在准备工作台</span>
          </div>
        </section>
      </div>
    </main>
  );
}

export function AuthGate({
  authDraft,
  setAuthDraft,
  submitAccount,
  submitCustom,
  activateLicense,
  accountAuthenticated,
  license,
  message
}: {
  authDraft: AuthDraft;
  setAuthDraft: Dispatch<SetStateAction<AuthDraft>>;
  submitAccount: () => void | Promise<void>;
  submitCustom: () => void | Promise<void>;
  activateLicense: () => void | Promise<void>;
  accountAuthenticated: boolean;
  license: LicenseStatus | null;
  message: string;
}) {
  const [busy, setBusy] = useState(false);
  const customMode = authDraft.accessMode === "custom";
  const needsActivation = license?.required === true && license.active !== true;
  const accountNeedsActivation = !customMode && accountAuthenticated && needsActivation;
  const messageIsError = /(?:错误|失败|失效|不可用|未连接|请重新|无效|拒绝|过期)/i.test(message);

  function updateAuth<K extends keyof AuthDraft>(key: K, value: AuthDraft[K]) {
    setAuthDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (accountNeedsActivation) await activateLicense();
      else if (customMode) await submitCustom();
      else await submitAccount();
    } finally {
      setBusy(false);
    }
  }

  const status = customMode ? "自定义接口" : accountNeedsActivation ? "激活软件" : authDraft.mode === "register" ? "账户注册" : "账户登录";

  return (
    <main className="auth-shell" onPasteCapture={blockImagePaste}>
      <AuthTitlebar status={status} />
      <div className="auth-stage">
        <section className="auth-card auth-access-card" aria-label="naimage 访问配置">
          <div className="auth-card-top">
            <img className="auth-brand-icon" src="./naimage.png" alt="" draggable={false} />
            <span>SparkAI Workspace</span>
          </div>
          <span className="eyebrow">naimage</span>
          <h1>选择使用方式</h1>
          <p>登录 SparkAPI 使用账户额度，或连接你自己的 OpenAI 兼容接口。</p>

          <form className="auth-form auth-gate-form" onSubmit={submit}>
            <SegmentedControl className="auth-switch access-mode-switch" aria-label="访问方式">
              <SegmentButton active={!customMode} type="button" onClick={() => updateAuth("accessMode", "account")}>
                <LogIn size={14} />账号登录
              </SegmentButton>
              <SegmentButton active={customMode} type="button" onClick={() => updateAuth("accessMode", "custom")}>
                <Server size={14} />自定义接口
              </SegmentButton>
            </SegmentedControl>

            {!customMode && !accountNeedsActivation ? (
              <>
                <SegmentedControl className="auth-switch" aria-label="登录注册切换">
                  <SegmentButton active={authDraft.mode === "login"} type="button" onClick={() => updateAuth("mode", "login")}>登录</SegmentButton>
                  <SegmentButton active={authDraft.mode === "register"} type="button" onClick={() => updateAuth("mode", "register")}>注册</SegmentButton>
                </SegmentedControl>
                {authDraft.mode === "register" ? (
                  <Field label="昵称">
                    <input value={authDraft.name} onChange={(event) => updateAuth("name", event.target.value)} autoComplete="name" />
                  </Field>
                ) : null}
                <Field label="用户名">
                  <input value={authDraft.email} onChange={(event) => updateAuth("email", event.target.value)} autoComplete="username" maxLength={20} required />
                </Field>
                <Field label="密码">
                  <input value={authDraft.password} onChange={(event) => updateAuth("password", event.target.value)} type="password" autoComplete={authDraft.mode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={20} required />
                </Field>
              </>
            ) : null}

            {customMode ? (
              <>
                <Field label="Base URL">
                  <input value={authDraft.baseUrl} onChange={(event) => updateAuth("baseUrl", event.target.value)} type="url" placeholder="https://example.com/v1" autoComplete="url" required />
                </Field>
                <Field label="API Key">
                  <input value={authDraft.apiKey} onChange={(event) => updateAuth("apiKey", event.target.value)} type="password" placeholder="sk-..." autoComplete="off" required />
                </Field>
                <div className="auth-model-grid">
                  <Field label="Agent 模型（可选）">
                    <input value={authDraft.agentModel} onChange={(event) => updateAuth("agentModel", event.target.value)} placeholder="gpt-5.6-terra" autoComplete="off" />
                  </Field>
                  <Field label="生图模型（可选）">
                    <input value={authDraft.imageModel} onChange={(event) => updateAuth("imageModel", event.target.value)} placeholder="gpt-image-2" autoComplete="off" />
                  </Field>
                </div>
              </>
            ) : null}

            {(customMode || accountNeedsActivation) && (needsActivation || authDraft.activationCode) ? (
              <Field label="激活码">
                <input
                  value={authDraft.activationCode}
                  onChange={(event) => updateAuth("activationCode", event.target.value.toUpperCase())}
                  placeholder="NAI-XXXX-XXXX-XXXX-XXXX"
                  autoComplete="off"
                  required={needsActivation}
                />
              </Field>
            ) : null}

            {license?.grace ? <InlineNotice tone="warning">授权服务器暂时不可用，当前处于离线宽限期。</InlineNotice> : null}
            {!license?.required && license?.supported === false ? <InlineNotice tone="neutral">当前服务尚未启用激活门禁，可以直接进入。</InlineNotice> : null}

            <ActionButton className="basic-auth-submit" variant="primary" type="submit" busy={busy} icon={accountNeedsActivation ? <KeyRound size={16} /> : <Shield size={16} />}>
              {accountNeedsActivation ? "激活并进入" : customMode ? "连接并进入" : authDraft.mode === "register" ? "注册并继续" : "登录"}
            </ActionButton>
          </form>

          {message ? <InlineNotice className="auth-message" tone={messageIsError ? "danger" : "info"} aria-live="polite">{message}</InlineNotice> : null}
        </section>
      </div>
    </main>
  );
}
