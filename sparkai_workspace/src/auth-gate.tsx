import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Loader2, LogIn, Server, Shield } from "lucide-react";

import { blockImagePaste, type AuthDraft } from "./core";
import {
  ActionButton,
  Field,
  InlineNotice,
  SegmentedControl,
  SegmentButton
} from "./ui";
import { WindowControls } from "./window-controls";
import { appAccessPolicy } from "./access-policy";

function AuthTitlebar({ status }: { status: string }) {
  return (
    <header className="ide-topbar auth-topbar">
      <div className="titlebar-brand">
        <img className="titlebar-brand-icon" src="./naimage.png" alt="" draggable={false} />
        <strong>SparkAI WorkSpace</strong>
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
          <span className="eyebrow">SparkAI WorkSpace</span>
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
  selectAccessMode,
  message
}: {
  authDraft: AuthDraft;
  setAuthDraft: Dispatch<SetStateAction<AuthDraft>>;
  submitAccount: () => void | Promise<void>;
  submitCustom: () => void | Promise<void>;
  selectAccessMode: (mode: AuthDraft["accessMode"]) => void | Promise<void>;
  message: string;
}) {
  const [busy, setBusy] = useState(false);
  const customMode = appAccessPolicy.customApiAccess && authDraft.accessMode === "custom";
  const messageIsError = /(?:错误|失败|失效|不可用|未连接|请重新|无效|拒绝|过期)/i.test(message);

  function updateAuth<K extends keyof AuthDraft>(key: K, value: AuthDraft[K]) {
    setAuthDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (customMode) await submitCustom();
      else await submitAccount();
    } finally {
      setBusy(false);
    }
  }

  const status = customMode ? "自定义接口" : authDraft.mode === "register" ? "账户注册" : "账户登录";

  return (
    <main className="auth-shell" onPasteCapture={blockImagePaste}>
      <AuthTitlebar status={status} />
      <div className="auth-stage">
        <section className="auth-card auth-access-card" aria-label="SparkAI WorkSpace 访问配置">
          <div className="auth-card-top">
            <img className="auth-brand-icon" src="./naimage.png" alt="" draggable={false} />
            <span>SparkAI WorkSpace</span>
          </div>
          <span className="eyebrow">SparkAI WorkSpace</span>
          <h1>{appAccessPolicy.customApiAccess ? "选择使用方式" : "登录 SparkAPI"}</h1>
          <p>{appAccessPolicy.customApiAccess ? "软件免费：可登录 SparkAPI，或直接连接你自己的 New API、Sub2API 或其他 OpenAI 兼容接口。上游服务费用由你的账号或 API Key 决定。" : "软件免费，此版本使用 SparkAPI 账号、模型与账户额度。"}</p>

          <form className="auth-form auth-gate-form" onSubmit={submit}>
            {appAccessPolicy.customApiAccess ? (
              <SegmentedControl className="auth-switch access-mode-switch" aria-label="访问方式">
                <SegmentButton active={!customMode} type="button" onClick={() => void selectAccessMode("account")}>
                  <LogIn size={14} />账号登录
                </SegmentButton>
                <SegmentButton active={customMode} type="button" onClick={() => void selectAccessMode("custom")}>
                  <Server size={14} />自定义接口
                </SegmentButton>
              </SegmentedControl>
            ) : null}

            {!customMode ? (
              <>
                <SegmentedControl className="auth-switch" aria-label="登录注册切换">
                  <SegmentButton active={authDraft.mode === "login"} type="button" onClick={() => updateAuth("mode", "login")}>登录</SegmentButton>
                  <SegmentButton active={authDraft.mode === "register"} type="button" onClick={() => updateAuth("mode", "register")}>注册</SegmentButton>
                </SegmentedControl>
                {authDraft.mode === "register" ? (
                  <Field label="昵称">
                    <input className="basic-auth-name" value={authDraft.name} onChange={(event) => updateAuth("name", event.target.value)} autoComplete="name" />
                  </Field>
                ) : null}
                <Field label="用户名">
                  <input className="basic-auth-email" value={authDraft.email} onChange={(event) => updateAuth("email", event.target.value)} autoComplete="username" maxLength={20} required />
                </Field>
                <Field label="密码">
                  <input className="basic-auth-password" value={authDraft.password} onChange={(event) => updateAuth("password", event.target.value)} type="password" autoComplete={authDraft.mode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={20} required />
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

            {customMode ? <InlineNotice tone="neutral">软件免费，直接使用你有权访问的 Base URL 与 API Key。上游服务的模型费用由对应账号或服务商承担。</InlineNotice> : null}

            <ActionButton className="basic-auth-submit" variant="primary" type="submit" busy={busy} icon={customMode ? <Server size={16} /> : <Shield size={16} />}>
              {customMode ? "连接并进入" : authDraft.mode === "register" ? "注册并继续" : "登录"}
            </ActionButton>
          </form>

          {message ? <InlineNotice className="auth-message" tone={messageIsError ? "danger" : "info"} aria-live="polite">{message}</InlineNotice> : null}
        </section>
      </div>
    </main>
  );
}
