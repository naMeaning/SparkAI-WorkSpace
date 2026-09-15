import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { CreditCard, Loader2, LogOut, RotateCcw, Shield } from "lucide-react";

import { formatDuration, yuan, type AuthDraft, type ServerLogEntry, type ServerUser, type ServerWallet } from "./core";
import { ActionButton, DrawerShell, Field, IconActionButton, InlineNotice, SegmentButton, SegmentedControl, SurfaceBody, SurfaceHeader, SurfaceSection } from "./ui";

declare const __NAIMAGE_AIDEBUG__: boolean;

const CLOSE_BUTTON_REASON = "close-button" as const;
const WHEN_IDLE = "when-idle" as const;

export type AccountDrawerProps = {
  user: ServerUser | null;
  wallet: ServerWallet | null;
  logs: ServerLogEntry[];
  message: string;
  authDraft: AuthDraft;
  setAuthDraft: Dispatch<SetStateAction<AuthDraft>>;
  submitAuth: () => void | Promise<void>;
  logout: () => void | Promise<void>;
  recharge: () => void | Promise<void>;
  refresh: () => void | Promise<void>;
  close: () => void;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatLogTime(createdAt?: string) {
  const raw = String(createdAt || "").trim();
  const numeric = Number(raw);
  const timestamp = raw && Number.isFinite(numeric)
    ? numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
    : Date.parse(raw);
  if (!Number.isFinite(timestamp)) return "时间未知";
  const value = new Date(timestamp);
  if (value.getFullYear() < 2000) return "时间未知";
  return value.toLocaleString("zh-CN", { hour12: false });
}

function safeUsageLogText(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[敏感信息已隐藏]")
    .replace(/((?:authorization|api[_-]?key|relay[_-]?token|access[_-]?token|refresh[_-]?token|token|session(?:id)?|cookie|secret)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, "$1[敏感信息已隐藏]")
    .replace(/([?&](?:token|key|secret|session|session_id)=)[^&\s]+/gi, "$1[敏感信息已隐藏]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function logActionLabel(log: ServerLogEntry) {
  const detail = log.detail ?? {};
  if (log.type === "error" || detail.success === false || detail.status === "failed") return "生成失败";
  if (typeof detail.amountCents === "number" && detail.amountCents > 0) return "额度入账";
  if (/recharge|topup|credit/i.test(log.type)) return "额度变动";
  if (/register/i.test(log.type)) return "账户注册";
  if (/login|session/i.test(log.type)) return "账户登录";
  if (typeof detail.trialImagesUsed === "number" && detail.trialImagesUsed > 0 && !(typeof detail.chargedCents === "number" && detail.chargedCents > 0)) return "试用抵扣";
  if (typeof detail.chargedCents === "number" && detail.chargedCents > 0) return "额度损耗";
  if (typeof detail.costCents === "number" && detail.costCents > 0) return "额度预估";
  if (log.type === "consume") return "图像生成";
  return "使用记录";
}

function formatLogDetail(log: ServerLogEntry) {
  const detail = log.detail ?? {};
  const parts = [
    typeof detail.count === "number" ? `${detail.count} 张` : "",
    typeof detail.returned === "number" ? `返回 ${detail.returned} 张` : "",
    typeof detail.trialImagesUsed === "number" && detail.trialImagesUsed > 0 ? `试用抵扣 ${detail.trialImagesUsed} 张` : "",
    typeof detail.chargedCents === "number" ? `扣费 ${yuan(detail.chargedCents)}` : "",
    typeof detail.costCents === "number" ? `应扣 ${yuan(detail.costCents)}` : "",
    typeof detail.amountCents === "number" ? `入账 ${yuan(detail.amountCents)}` : "",
    typeof detail.rmbCost === "number" ? `损耗 ¥${detail.rmbCost.toFixed(2)}` : "",
    typeof detail.promptTokens === "number" && detail.promptTokens > 0 ? `输入 ${detail.promptTokens} tokens` : "",
    typeof detail.completionTokens === "number" && detail.completionTokens > 0 ? `输出 ${detail.completionTokens} tokens` : "",
    typeof detail.responseTimeMs === "number" ? `耗时 ${formatDuration(detail.responseTimeMs / 1000)}` : "",
    typeof detail.message === "string" ? safeUsageLogText(detail.message) : "",
    typeof detail.model === "string" ? detail.model : ""
  ].filter(Boolean);
  return parts.join(" · ") || "已记录";
}

export default function AccountDrawer({
  user,
  wallet,
  logs,
  message,
  authDraft,
  setAuthDraft,
  submitAuth,
  logout,
  recharge,
  refresh,
  close
}: AccountDrawerProps) {
  const [authBusy, setAuthBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [rechargeBusy, setRechargeBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logPage, setLogPage] = useState(1);

  async function waitForDebugActionDelay() {
    if (!__NAIMAGE_AIDEBUG__) return;
    const delay = Math.max(0, Math.min(5_000, Number(window.__naimageDebugSurfaceSaveDelayMs || 0)));
    if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
  }

  function updateAuth<K extends keyof AuthDraft>(key: K, value: AuthDraft[K]) {
    setAuthDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy || !authDraft.email.trim() || !authDraft.password.trim()) return;
    setAuthBusy(true);
    try {
      await waitForDebugActionDelay();
      await submitAuth();
    } finally {
      setAuthBusy(false);
    }
  }

  async function refreshPanel() {
    if (refreshBusy) return;
    setRefreshBusy(true);
    try {
      await waitForDebugActionDelay();
      await refresh();
    } finally {
      setRefreshBusy(false);
    }
  }

  async function rechargeForDev() {
    if (rechargeBusy) return;
    setRechargeBusy(true);
    try {
      await waitForDebugActionDelay();
      await recharge();
    } finally {
      setRechargeBusy(false);
    }
  }

  async function logoutFromDrawer() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await waitForDebugActionDelay();
      await logout();
    } finally {
      setLogoutBusy(false);
    }
  }

  const usageLogs = logs;
  const logPageSize = 6;
  const logPageCount = Math.max(1, Math.ceil(usageLogs.length / logPageSize));
  const currentLogPage = clamp(logPage, 1, logPageCount);
  const pagedLogs = usageLogs.slice((currentLogPage - 1) * logPageSize, currentLogPage * logPageSize);
  const balanceText = yuan(wallet?.balanceCents ?? user?.balanceCents ?? 0);
  const costText = typeof wallet?.imageCostCents === "number" ? yuan(wallet.imageCostCents) : "同步中";
  const costMetaText = typeof wallet?.imageCostCents === "number" ? "每张生成" : "等待服务端";
  const trialText = `${Math.max(0, Number(user?.trialImagesRemaining ?? 0) || 0)} 张`;
  const accountName = user?.name?.trim() || user?.username || user?.account || user?.email || "已登录账户";
  const accountDetail = user?.email && user.email !== accountName ? user.email : user?.username || user?.account || "服务端账户已连接";
  const accountInitial = accountName.trim().slice(0, 1).toUpperCase() || "A";
  const drawerBusy = authBusy || refreshBusy || rechargeBusy || logoutBusy;
  const messageIsError = /(?:错误|失败|失效|不可用|未连接|请重新登录|请输入)/i.test(message);

  useEffect(() => {
    setLogPage((current) => clamp(current, 1, logPageCount));
  }, [logPageCount]);

  return (
    <DrawerShell
      surface="account"
      ariaLabel="账户"
      className="account-drawer"
      busy={drawerBusy}
      closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE }}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title="账户"
            description={user ? user.email || user.username || "已登录" : "登录与用量"}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭账户"
            closeDisabled={drawerBusy}
          />
          <SurfaceBody className="account-surface-body">
            {!user ? (
              <SurfaceSection className="account-surface-section account-auth-section" aria-labelledby="account-auth-heading">
                <h3 id="account-auth-heading">{authDraft.mode === "register" ? "注册账户" : "登录账户"}</h3>
                <SegmentedControl className="account-auth-switch" aria-label="登录注册切换">
                  <SegmentButton active={authDraft.mode === "login"} onClick={() => updateAuth("mode", "login")}>登录</SegmentButton>
                  <SegmentButton active={authDraft.mode === "register"} onClick={() => updateAuth("mode", "register")}>注册</SegmentButton>
                </SegmentedControl>
                <form className="account-auth-form" onSubmit={submit}>
                  {authDraft.mode === "register" ? (
                    <Field label="昵称">
                      <input value={authDraft.name} onChange={(event) => updateAuth("name", event.target.value)} autoComplete="name" />
                    </Field>
                  ) : null}
                  <Field label="用户名">
                    <input value={authDraft.email} onChange={(event) => updateAuth("email", event.target.value)} type="text" autoComplete="username" maxLength={20} required />
                  </Field>
                  <Field label="密码">
                    <input value={authDraft.password} onChange={(event) => updateAuth("password", event.target.value)} type="password" autoComplete={authDraft.mode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={20} required />
                  </Field>
                  <ActionButton variant="primary" className="account-auth-submit" type="submit" busy={authBusy} icon={<Shield size={16} />}>
                    {authDraft.mode === "register" ? "注册并进入" : "登录"}
                  </ActionButton>
                </form>
              </SurfaceSection>
            ) : (
              <>
                <SurfaceSection className="account-surface-section account-overview-section" aria-labelledby="account-overview-heading">
                  <div className="account-section-header">
                    <h3 id="account-overview-heading">账户概览</h3>
                    <IconActionButton
                      label="刷新账户"
                      icon={refreshBusy ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}
                      onClick={refreshPanel}
                      disabled={refreshBusy}
                    />
                  </div>
                  <div className="account-profile" aria-label="账户状态">
                    <span className="account-surface-avatar">{accountInitial}</span>
                    <div className="account-surface-profile-copy">
                      <strong>{accountName}</strong>
                      <small>{accountDetail}</small>
                    </div>
                    <span className="account-status">已连接</span>
                  </div>
                  <div className="account-balance-grid" aria-label="钱包余额">
                    <div><span>额度</span><strong>{balanceText}</strong><em>可用余额</em></div>
                    <div><span>单张损耗</span><strong>{costText}</strong><em>{costMetaText}</em></div>
                    <div><span>试用额度</span><strong>{trialText}</strong><em>免费张数</em></div>
                    <small>{user.username || user.account || user.email}</small>
                  </div>
                  <div className="account-primary-actions" aria-label="账户操作">
                    <ActionButton variant="primary" onClick={rechargeForDev} busy={rechargeBusy} icon={<CreditCard size={15} />}>充值额度</ActionButton>
                    <ActionButton variant="danger" className="account-logout-button" onClick={() => void logoutFromDrawer()} busy={logoutBusy} icon={<LogOut size={15} />}>退出登录</ActionButton>
                  </div>
                </SurfaceSection>

                <SurfaceSection className="account-surface-section account-usage-section" aria-labelledby="account-usage-heading">
                  <div className="account-section-header">
                    <h3 id="account-usage-heading">使用日志</h3>
                    <span className="account-usage-count">{usageLogs.length} 条</span>
                  </div>
                  {usageLogs.length > 0 ? (
                    <div className="account-usage-list">
                      {pagedLogs.map((log) => (
                        <article key={log.id}>
                          <span>{formatLogTime(log.createdAt)}</span>
                          <strong>{logActionLabel(log)}</strong>
                          <p>{formatLogDetail(log)}</p>
                        </article>
                      ))}
                    </div>
                  ) : <p className="account-empty">还没有使用记录。</p>}
                  {usageLogs.length > logPageSize ? (
                    <div className="account-log-pager">
                      <ActionButton variant="ghost" className="account-page-action" onClick={() => setLogPage((current) => Math.max(1, current - 1))} disabled={currentLogPage <= 1}>上一页</ActionButton>
                      <span>{currentLogPage} / {logPageCount}</span>
                      <ActionButton variant="ghost" className="account-page-action" onClick={() => setLogPage((current) => Math.min(logPageCount, current + 1))} disabled={currentLogPage >= logPageCount}>下一页</ActionButton>
                    </div>
                  ) : null}
                </SurfaceSection>
              </>
            )}
            {message ? (
              <InlineNotice className="account-surface-message" tone={messageIsError ? "danger" : "info"}>{message}</InlineNotice>
            ) : null}
          </SurfaceBody>
        </>
      )}
    </DrawerShell>
  );
}
