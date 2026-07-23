import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Loader2, Shield, Workflow } from "lucide-react";

import { blockImagePaste, type AuthDraft } from "./core";
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
        <span className="titlebar-brand-icon" aria-hidden="true">
          <span className="naimage-logo-mark">
            <i />
            <i />
            <i />
          </span>
        </span>
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
          <div className="brand-icon auth-brand-icon">
            <Workflow size={20} />
          </div>
          <span className="eyebrow">naimage</span>
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
  submitAuth,
  message
}: {
  authDraft: AuthDraft;
  setAuthDraft: Dispatch<SetStateAction<AuthDraft>>;
  submitAuth: () => void | Promise<void>;
  message: string;
}) {
  const [authBusy, setAuthBusy] = useState(false);
  const messageIsError = /(?:错误|失败|失效|不可用|未连接|请重新登录|请输入|不存在|未注册|不正确|无效|已拒绝)/i.test(message);

  function updateAuth<K extends keyof AuthDraft>(key: K, value: AuthDraft[K]) {
    setAuthDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy || !authDraft.email.trim() || !authDraft.password.trim()) return;
    setAuthBusy(true);
    try {
      await submitAuth();
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <main className="auth-shell" onPasteCapture={blockImagePaste}>
      <AuthTitlebar status={authDraft.mode === "register" ? "账户注册" : "账户登录"} />
      <div className="auth-stage">
        <section className="auth-card" aria-label="登录注册">
          <div className="auth-card-top">
            <div className="brand-icon auth-brand-icon">
              <Workflow size={20} />
            </div>
            <span>naimage</span>
          </div>
          <span className="eyebrow">naimage</span>
          <h1>{authDraft.mode === "register" ? "创建 naimage 账户" : "登录 naimage"}</h1>
          <p>登录后进入项目画布与 Agent 工作台。</p>

          <form className="auth-form auth-gate-form" onSubmit={submit}>
            <SegmentedControl className="auth-switch" aria-label="登录注册切换">
              <SegmentButton active={authDraft.mode === "login"} type="button" onClick={() => updateAuth("mode", "login")}>
                登录
              </SegmentButton>
              <SegmentButton active={authDraft.mode === "register"} type="button" onClick={() => updateAuth("mode", "register")}>
                注册
              </SegmentButton>
            </SegmentedControl>

            {authDraft.mode === "register" ? (
              <Field label="昵称">
                <input
                  className="basic-auth-name"
                  value={authDraft.name}
                  onChange={(event) => updateAuth("name", event.target.value)}
                  autoComplete="name"
                />
              </Field>
            ) : null}

            <Field label="用户名">
              <input
                className="basic-auth-email"
                value={authDraft.email}
                onChange={(event) => updateAuth("email", event.target.value)}
                type="text"
                autoComplete="username"
                maxLength={20}
                required
              />
            </Field>

            <Field label="密码">
              <input
                className="basic-auth-password"
                value={authDraft.password}
                onChange={(event) => updateAuth("password", event.target.value)}
                type="password"
                autoComplete={authDraft.mode === "login" ? "current-password" : "new-password"}
                minLength={8}
                maxLength={20}
                required
              />
            </Field>

            <ActionButton
              className="basic-auth-submit"
              variant="primary"
              type="submit"
              busy={authBusy}
              icon={<Shield size={16} />}
            >
              {authDraft.mode === "register" ? "注册并进入" : "登录"}
            </ActionButton>
          </form>

          {message ? (
            <InlineNotice className="auth-message" tone={messageIsError ? "danger" : "info"} aria-live="polite">{message}</InlineNotice>
          ) : null}
        </section>
      </div>
    </main>
  );
}
