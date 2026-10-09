import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { KeyRound, Loader2, LogOut, RotateCcw, Shield } from "lucide-react";

import { formatDuration, yuan, type AuthDraft, type ServerLogEntry, type ServerLogQuery, type ServerLogResult, type ServerUser, type ServerWallet } from "./core";
import { ActionButton, DrawerShell, Field, IconActionButton, InlineNotice, SegmentButton, SegmentedControl, SurfaceBody, SurfaceHeader, SurfaceSection } from "./ui";

declare const __NAIMAGE_AIDEBUG__: boolean;

const CLOSE_BUTTON_REASON = "close-button" as const;
const WHEN_IDLE = "when-idle" as const;

export type AccountDrawerProps = {
  user: ServerUser | null;
  wallet: ServerWallet | null;
  message: string;
  authDraft: AuthDraft;
  setAuthDraft: Dispatch<SetStateAction<AuthDraft>>;
  submitAuth: () => void | Promise<void>;
  logout: () => void | Promise<void>;
  manageTokens: () => void;
  refresh: () => void | Promise<void>;
  close: () => void;
};

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
  if (log.type === "error" || detail.success === false || detail.status === "failed") return "调用失败";
  if (typeof detail.amountCents === "number" && detail.amountCents > 0) return "额度入账";
  if (/recharge|topup|credit/i.test(log.type)) return "额度变动";
  if (/register/i.test(log.type)) return "账户注册";
  if (/login|session/i.test(log.type)) return "账户登录";
  if (typeof detail.trialImagesUsed === "number" && detail.trialImagesUsed > 0 && !(typeof detail.chargedCents === "number" && detail.chargedCents > 0)) return "试用抵扣";
  if (typeof detail.chargedCents === "number" && detail.chargedCents > 0) return "额度损耗";
  if (typeof detail.costCents === "number" && detail.costCents > 0) return "额度预估";
  if (log.type === "consume") return "模型调用";
  if (log.type === "refund") return "额度退款";
  if (log.type === "manage") return "账户管理";
  if (log.type === "system") return "系统记录";
  return "使用记录";
}

function formatLogDetail(log: ServerLogEntry) {
  const detail = log.detail ?? {};
  const parts = [
    typeof detail.quotaDisplay === "string" ? `额度 ${detail.quotaDisplay}` : "",
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
    typeof detail.model === "string" ? safeUsageLogText(detail.model) : "",
    typeof detail.tokenName === "string" && detail.tokenName ? `密钥 ${safeUsageLogText(detail.tokenName)}` : "",
    typeof detail.group === "string" && detail.group ? `分组 ${safeUsageLogText(detail.group)}` : "",
    typeof detail.requestId === "string" && detail.requestId ? `请求 ${safeUsageLogText(detail.requestId)}` : ""
  ].filter(Boolean);
  return parts.join(" · ") || "已记录";
}

export default function AccountDrawer({
  user,
  wallet,
  message,
  authDraft,
  setAuthDraft,
  submitAuth,
  logout,
  manageTokens,
  refresh,
  close
}: AccountDrawerProps) {
  const [authBusy, setAuthBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logResult, setLogResult] = useState<ServerLogResult>({ ok: true, logs: [], page: 1, pageSize: 20, total: 0 });
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState("");
  const [logQuery, setLogQuery] = useState<ServerLogQuery>({});
  const [logFilters, setLogFilters] = useState({ type: "0", model: "", tokenName: "", start: "", end: "" });
  const logRequestRef = useRef(0);
  const accountIdRef = useRef(user?.id);
  accountIdRef.current = user?.id;

  async function loadLogs(query: ServerLogQuery = logQuery, page = 1) {
    const request = ++logRequestRef.current;
    const accountId = user?.id;
    if (!accountId || accountId === "custom-api") { setLogBusy(false); setLogError(""); return; }
    setLogBusy(true);
    setLogError("");
    try {
      const result = await window.naimageServer?.logs({ ...query, page, pageSize: 20 });
      if (request !== logRequestRef.current || accountId !== accountIdRef.current) return;
      if (!result?.ok || result.stale) throw new Error(result?.error || "无法加载账户日志。");
      setLogResult(result);
    } catch (error) {
      if (request === logRequestRef.current && accountId === accountIdRef.current) setLogError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === logRequestRef.current) setLogBusy(false);
    }
  }

  useEffect(() => {
    setLogResult({ ok: true, logs: [], page: 1, pageSize: 20, total: 0 });
    setLogQuery({});
    setLogFilters({ type: "0", model: "", tokenName: "", start: "", end: "" });
    void loadLogs({}, 1);
    return () => { logRequestRef.current += 1; };
  }, [user?.id]);

  function filterLogs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query: ServerLogQuery = {
      type: Number(logFilters.type), model: logFilters.model.trim(), tokenName: logFilters.tokenName.trim(),
      startTime: logFilters.start ? Math.floor(new Date(logFilters.start).getTime() / 1000) : undefined,
      endTime: logFilters.end ? Math.floor(new Date(logFilters.end).getTime() / 1000) : undefined
    };
    if (query.startTime && query.endTime && query.startTime > query.endTime) {
      setLogError("日志开始时间不能晚于结束时间。");
      return;
    }
    setLogQuery(query);
    void loadLogs(query, 1);
  }

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
      await loadLogs(logQuery, logResult.page || 1);
    } finally {
      setRefreshBusy(false);
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

  const usageLogs = logResult.logs || [];
  const currentLogPage = logResult.page || 1;
  const logPageCount = Math.max(1, Math.ceil((logResult.total ?? usageLogs.length) / (logResult.pageSize || 20)));
  const balanceText = wallet?.balanceDisplay || (wallet?.nativeQuota ? "待同步" : yuan(wallet?.balanceCents ?? user?.balanceCents ?? 0));
  const accountName = user?.name?.trim() || user?.username || user?.account || user?.email || "已登录账户";
  const accountDetail = user?.email && user.email !== accountName ? user.email : user?.username || user?.account || "服务端账户已连接";
  const accountInitial = accountName.trim().slice(0, 1).toUpperCase() || "A";
  const drawerBusy = authBusy || refreshBusy || logoutBusy;
  const messageIsError = /(?:错误|失败|失效|不可用|未连接|请重新登录|请输入)/i.test(message);

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
                    <div><span>可用额度</span><strong title={balanceText}>{balanceText}</strong><em>{wallet?.balanceQuota === undefined ? "等待服务端同步" : `原始 ${wallet.balanceQuota.toLocaleString("zh-CN")} quota`}</em></div>
                    <div><span>累计使用</span><strong title={wallet?.usedDisplay}>{wallet?.usedDisplay || "待同步"}</strong><em>{wallet?.group ? `分组 ${wallet.group}` : "服务端累计额度"}</em></div>
                    <div><span>请求次数</span><strong>{wallet?.requestCount === undefined ? "待同步" : wallet.requestCount.toLocaleString("zh-CN")}</strong><em>账户累计调用</em></div>
                    <small>{user.username || user.account || user.email}</small>
                  </div>
                  <div className="account-primary-actions" aria-label="账户操作">
                    <ActionButton variant="primary" onClick={manageTokens} icon={<KeyRound size={15} />}>管理密钥</ActionButton>
                    <ActionButton variant="danger" className="account-logout-button" onClick={() => void logoutFromDrawer()} busy={logoutBusy} icon={<LogOut size={15} />}>退出登录</ActionButton>
                  </div>
                </SurfaceSection>

                <SurfaceSection className="account-surface-section account-usage-section" aria-labelledby="account-usage-heading">
                  <div className="account-section-header">
                    <h3 id="account-usage-heading">使用日志</h3>
                    <IconActionButton label="刷新日志" icon={<RotateCcw size={15} />} onClick={() => void loadLogs(logQuery, currentLogPage)} disabled={logBusy} />
                  </div>
                  <form className="account-log-filters" onSubmit={filterLogs} aria-label="日志筛选">
                    <Field label="记录类型"><select aria-label="日志类型" value={logFilters.type} onChange={(event) => setLogFilters((current) => ({ ...current, type: event.target.value }))}>
                      <option value="0">全部记录</option><option value="2">模型调用</option><option value="5">调用失败</option><option value="1">额度入账</option><option value="6">退款</option><option value="3">账户管理</option><option value="4">系统记录</option>
                    </select></Field>
                    <Field label="模型"><input aria-label="日志模型" value={logFilters.model} maxLength={160} placeholder="全部模型" onChange={(event) => setLogFilters((current) => ({ ...current, model: event.target.value }))} /></Field>
                    <Field label="密钥名称"><input aria-label="日志密钥名称" value={logFilters.tokenName} maxLength={50} placeholder="全部密钥" onChange={(event) => setLogFilters((current) => ({ ...current, tokenName: event.target.value }))} /></Field>
                    <Field label="开始时间"><input type="datetime-local" aria-label="日志开始时间" value={logFilters.start} onChange={(event) => setLogFilters((current) => ({ ...current, start: event.target.value }))} /></Field>
                    <Field label="结束时间"><input type="datetime-local" aria-label="日志结束时间" value={logFilters.end} onChange={(event) => setLogFilters((current) => ({ ...current, end: event.target.value }))} /></Field>
                    <div className="account-log-filter-actions">
                      <ActionButton type="submit" variant="primary" disabled={logBusy}>筛选</ActionButton>
                      <ActionButton disabled={logBusy} onClick={() => { setLogFilters({ type: "0", model: "", tokenName: "", start: "", end: "" }); setLogQuery({}); void loadLogs({}, 1); }}>重置</ActionButton>
                    </div>
                  </form>
                  {logError ? <InlineNotice tone="danger">{logError}</InlineNotice> : null}
                  <span className="account-usage-count" aria-live="polite">{logBusy ? "正在加载日志…" : `共 ${logResult.total ?? usageLogs.length} 条${logError && usageLogs.length ? " · 显示上次加载结果" : ""}`}</span>
                  {usageLogs.length > 0 ? (
                    <div className="account-usage-list">
                      {usageLogs.map((log) => (
                        <article key={log.id}>
                          <span>{formatLogTime(log.createdAt)}</span>
                          <strong>{logActionLabel(log)}</strong>
                          <p title={formatLogDetail(log)}>{formatLogDetail(log)}</p>
                          <details className="account-log-detail"><summary>查看详情</summary><p>{formatLogDetail(log)}</p></details>
                        </article>
                      ))}
                    </div>
                  ) : !logBusy && !logError ? <p className="account-empty">没有符合条件的使用记录。</p> : null}
                  {(logPageCount > 1 || currentLogPage > 1 || logResult.hasMore) ? (
                    <div className="account-log-pager">
                      <ActionButton variant="ghost" className="account-page-action" onClick={() => void loadLogs(logQuery, currentLogPage - 1)} disabled={logBusy || currentLogPage <= 1}>上一页</ActionButton>
                      <span>{currentLogPage} / {logPageCount}</span>
                      <ActionButton variant="ghost" className="account-page-action" onClick={() => void loadLogs(logQuery, currentLogPage + 1)} disabled={logBusy || !(logResult.hasMore ?? currentLogPage < logPageCount)}>下一页</ActionButton>
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
