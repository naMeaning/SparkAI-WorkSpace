export const LICENSE_ADMIN_UI_PATH = "/api/naimage/license/admin";

const HTML = String.raw`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>SparkAI License 管理</title>
    <link rel="stylesheet" href="/api/naimage/license/admin/assets/style.css">
  </head>
  <body>
    <header class="topbar">
      <div>
        <p class="product-name">SparkAI Extension</p>
        <h1>License 管理</h1>
      </div>
      <div class="topbar-actions">
        <span id="connection-state" class="connection-state" data-tone="neutral">未连接</span>
        <button id="logout-button" class="button button-secondary" type="button" hidden>退出管理</button>
      </div>
    </header>

    <main class="page-shell">
      <section id="auth-panel" class="auth-panel" aria-labelledby="auth-heading">
        <div>
          <p class="eyebrow">管理员验证</p>
          <h2 id="auth-heading">连接 License 服务</h2>
          <p class="section-copy">使用部署时配置的管理员 Token。凭据只保留在当前页面内存中，刷新页面后需要重新输入。</p>
        </div>
        <form id="auth-form" class="auth-form" autocomplete="off">
          <label for="admin-token">管理员 Token</label>
          <div class="inline-field">
            <input id="admin-token" name="admin_token" type="password" minlength="32" autocomplete="off" spellcheck="false" required>
            <button id="login-button" class="button button-primary" type="submit">进入后台</button>
          </div>
          <p id="auth-error" class="field-error" role="alert" hidden></p>
        </form>
      </section>

      <div id="dashboard" hidden>
        <section class="summary-strip" aria-label="兑换码汇总">
          <div class="summary-item">
            <span>兑换码总数</span>
            <strong id="summary-total">0</strong>
          </div>
          <div class="summary-item">
            <span>启用中</span>
            <strong id="summary-enabled">0</strong>
          </div>
          <div class="summary-item">
            <span>已禁用</span>
            <strong id="summary-disabled">0</strong>
          </div>
          <div class="summary-item">
            <span>已兑换设备</span>
            <strong id="summary-activations">0</strong>
          </div>
          <div class="summary-item">
            <span>设备总额度</span>
            <strong id="summary-capacity">0</strong>
          </div>
        </section>

        <div class="workspace-grid">
          <section class="create-panel" aria-labelledby="create-heading">
            <div class="section-heading">
              <div>
                <p class="eyebrow">创建</p>
                <h2 id="create-heading">生成兑换码</h2>
              </div>
            </div>
            <form id="create-form" class="create-form">
              <label class="field-block" for="batch-name">
                <span>批次名称</span>
                <input id="batch-name" name="name" type="text" maxlength="80" value="SparkAI Pro" required>
              </label>

              <div class="field-grid">
                <label class="field-block" for="code-count">
                  <span>生成数量</span>
                  <input id="code-count" name="count" type="number" min="1" max="100" step="1" value="1" required>
                </label>
                <label class="field-block" for="max-activations">
                  <span>每码可兑换设备数</span>
                  <input id="max-activations" name="max_activations" type="number" min="1" max="100" step="1" value="3" required>
                </label>
              </div>

              <div class="setting-group">
                <label class="toggle-line" for="permanent-license">
                  <span>
                    <strong>永久授权</strong>
                    <small>关闭后，授权从首次激活开始计时</small>
                  </span>
                  <input id="permanent-license" type="checkbox" checked>
                </label>
                <label class="field-block" for="valid-days">
                  <span>激活后有效天数</span>
                  <input id="valid-days" name="valid_days" type="number" min="1" max="3650" step="1" value="30" disabled required>
                </label>
              </div>

              <div class="setting-group">
                <label class="toggle-line" for="no-deadline">
                  <span>
                    <strong>无兑换截止时间</strong>
                    <small>关闭后，超过截止时间的新设备不能兑换</small>
                  </span>
                  <input id="no-deadline" type="checkbox" checked>
                </label>
                <label class="field-block" for="redemption-deadline">
                  <span>兑换截止时间</span>
                  <input id="redemption-deadline" name="redemption_deadline" type="datetime-local" disabled required>
                </label>
              </div>

              <p class="form-note">同一设备重复激活不会重复占用次数。禁用兑换码会立即撤销该码已激活的所有设备授权。</p>
              <p id="create-error" class="field-error" role="alert" hidden></p>
              <button id="create-button" class="button button-primary button-full" type="submit">生成兑换码</button>
            </form>
          </section>

          <section class="list-panel" aria-labelledby="list-heading">
            <div class="section-heading list-heading-row">
              <div>
                <p class="eyebrow">管理</p>
                <h2 id="list-heading">兑换码列表</h2>
              </div>
              <button id="refresh-button" class="button button-secondary" type="button">刷新</button>
            </div>

            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">批次 / 兑换码</th>
                    <th scope="col">使用次数</th>
                    <th scope="col">授权时长</th>
                    <th scope="col">兑换截止</th>
                    <th scope="col">状态</th>
                    <th scope="col" class="action-column">操作</th>
                  </tr>
                </thead>
                <tbody id="codes-body">
                  <tr><td colspan="6" class="empty-state">连接后加载兑换码</td></tr>
                </tbody>
              </table>
            </div>

            <footer class="pagination">
              <label for="page-size">
                每页
                <select id="page-size">
                  <option value="10">10</option>
                  <option value="20" selected>20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </label>
              <span id="page-label">第 1 / 1 页</span>
              <div class="pagination-actions">
                <button id="previous-page" class="button button-secondary" type="button" disabled>上一页</button>
                <button id="next-page" class="button button-secondary" type="button" disabled>下一页</button>
              </div>
            </footer>
          </section>
        </div>
      </div>
    </main>

    <dialog id="codes-dialog" class="codes-dialog">
      <form method="dialog" class="dialog-header">
        <div>
          <p class="eyebrow">创建成功</p>
          <h2>保存这些兑换码</h2>
        </div>
        <button class="button button-secondary" value="close" type="submit">关闭</button>
      </form>
      <p class="dialog-warning">兑换码明文只在本次创建后显示，服务端不会保存可恢复的明文。</p>
      <pre id="generated-codes" tabindex="0"></pre>
      <div class="dialog-actions">
        <button id="copy-codes" class="button button-primary" type="button">复制全部</button>
        <button id="download-codes" class="button button-secondary" type="button">下载 TXT</button>
      </div>
    </dialog>

    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
    <script src="/api/naimage/license/admin/assets/app.js" defer></script>
  </body>
</html>
`;

const CSS = String.raw`:root {
  color-scheme: light;
  font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-synthesis: none;
  color: #18201d;
  background: #f3f5f4;
}

* {
  box-sizing: border-box;
}

[hidden] {
  display: none !important;
}

body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
  background: #f3f5f4;
}

button,
input,
select {
  font: inherit;
}

button,
select,
input[type="checkbox"] {
  cursor: pointer;
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 76px;
  padding: 14px clamp(18px, 4vw, 56px);
  border-bottom: 1px solid #d8ddda;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(12px);
}

.product-name,
.eyebrow {
  margin: 0 0 4px;
  color: #527067;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-size: 22px;
  line-height: 1.25;
}

h2 {
  margin-bottom: 0;
  font-size: 18px;
  line-height: 1.35;
}

.topbar-actions,
.inline-field,
.dialog-actions,
.pagination-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.connection-state {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 4px 10px;
  border: 1px solid #d1d8d4;
  border-radius: 999px;
  background: #f7f9f8;
  color: #56615d;
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
}

.connection-state[data-tone="success"] {
  border-color: #a6cdbd;
  background: #eaf6f0;
  color: #176344;
}

.connection-state[data-tone="danger"] {
  border-color: #e3b3b0;
  background: #fff0ef;
  color: #9a2f2a;
}

.page-shell {
  width: min(1500px, 100%);
  margin: 0 auto;
  padding: 28px clamp(18px, 4vw, 56px) 52px;
}

.auth-panel {
  display: grid;
  grid-template-columns: minmax(220px, 0.75fr) minmax(360px, 1.25fr);
  gap: 40px;
  align-items: end;
  max-width: 980px;
  margin: 72px auto 0;
  padding: 34px;
  border: 1px solid #d5dbd8;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 16px 44px rgba(24, 32, 29, 0.08);
}

.section-copy {
  max-width: 52ch;
  margin: 12px 0 0;
  color: #66716d;
  font-size: 14px;
  line-height: 1.7;
}

.auth-form,
.create-form {
  display: grid;
  gap: 16px;
}

label,
.field-block > span {
  color: #35403c;
  font-size: 13px;
  font-weight: 650;
}

.auth-form > label {
  margin-bottom: -8px;
}

input,
select {
  min-height: 40px;
  border: 1px solid #c8d0cc;
  border-radius: 6px;
  background: #ffffff;
  color: #18201d;
  outline: none;
}

input {
  width: 100%;
  padding: 8px 11px;
}

select {
  padding: 7px 28px 7px 10px;
}

input:focus,
select:focus,
button:focus-visible {
  border-color: #277a5c;
  box-shadow: 0 0 0 3px rgba(39, 122, 92, 0.16);
}

.inline-field input {
  min-width: 0;
  flex: 1;
}

.button {
  min-height: 38px;
  padding: 8px 14px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}

.button-primary {
  border-color: #176344;
  background: #176344;
  color: #ffffff;
}

.button-primary:hover:not(:disabled) {
  background: #104f36;
}

.button-secondary {
  border-color: #cbd3cf;
  background: #ffffff;
  color: #35403c;
}

.button-secondary:hover:not(:disabled) {
  border-color: #8ea098;
  background: #f6f8f7;
}

.button-danger {
  border-color: #e0aaa6;
  background: #fff7f6;
  color: #9a2f2a;
}

.button-danger:hover:not(:disabled) {
  background: #ffe9e7;
}

.button-full {
  width: 100%;
}

.field-error {
  margin: 0;
  color: #a02f2a;
  font-size: 13px;
  line-height: 1.5;
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(110px, 1fr));
  margin-bottom: 20px;
  border: 1px solid #d6dcda;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}

.summary-item {
  min-width: 0;
  padding: 16px 18px;
  border-right: 1px solid #e2e6e4;
}

.summary-item:last-child {
  border-right: 0;
}

.summary-item span {
  display: block;
  color: #6a7571;
  font-size: 12px;
}

.summary-item strong {
  display: block;
  margin-top: 6px;
  font-size: 23px;
  line-height: 1.2;
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(300px, 380px) minmax(640px, 1fr);
  gap: 20px;
  align-items: start;
}

.create-panel,
.list-panel {
  border: 1px solid #d6dcda;
  border-radius: 8px;
  background: #ffffff;
}

.create-panel {
  padding: 22px;
}

.list-panel {
  min-width: 0;
  overflow: hidden;
}

.section-heading {
  margin-bottom: 20px;
}

.list-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin: 0;
  padding: 20px 22px;
  border-bottom: 1px solid #e2e6e4;
}

.field-block {
  display: grid;
  gap: 7px;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.setting-group {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #e0e5e2;
  border-radius: 6px;
  background: #f8faf9;
}

.toggle-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.toggle-line span {
  min-width: 0;
}

.toggle-line strong,
.toggle-line small {
  display: block;
}

.toggle-line small {
  margin-top: 3px;
  color: #6c7773;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.45;
}

.toggle-line input {
  width: 38px;
  height: 21px;
  min-height: 0;
  flex: 0 0 38px;
  appearance: none;
  padding: 2px;
  border: 1px solid #aeb9b4;
  border-radius: 999px;
  background: #c6ceca;
  transition: background 140ms ease, border-color 140ms ease;
}

.toggle-line input::before {
  display: block;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(24, 32, 29, 0.22);
  content: "";
  transition: transform 140ms ease;
}

.toggle-line input:checked {
  border-color: #176344;
  background: #176344;
}

.toggle-line input:checked::before {
  transform: translateX(17px);
}

.form-note {
  margin: 0;
  color: #68736f;
  font-size: 12px;
  line-height: 1.65;
}

.table-scroll {
  width: 100%;
  overflow-x: auto;
}

table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
}

th,
td {
  padding: 13px 14px;
  border-bottom: 1px solid #e5e9e7;
  text-align: left;
  vertical-align: middle;
}

th {
  background: #f8faf9;
  color: #5f6a66;
  font-size: 12px;
  font-weight: 750;
}

td {
  color: #35403c;
  font-size: 13px;
}

tbody tr:hover {
  background: #fbfcfc;
}

.code-name,
.code-hint {
  display: block;
}

.code-name {
  max-width: 250px;
  overflow: hidden;
  color: #1b2421;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-hint {
  margin-top: 4px;
  color: #74807b;
  font-family: Consolas, "SFMono-Regular", monospace;
  font-size: 12px;
}

.usage-value {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 3px 8px;
  border: 1px solid #cbd3cf;
  border-radius: 999px;
  background: #f7f9f8;
  color: #56615d;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.status-badge[data-tone="success"] {
  border-color: #add1c2;
  background: #edf8f3;
  color: #176344;
}

.status-badge[data-tone="warning"] {
  border-color: #e4c88d;
  background: #fff8e8;
  color: #7b5511;
}

.status-badge[data-tone="danger"] {
  border-color: #e4b4b0;
  background: #fff0ef;
  color: #9a2f2a;
}

.action-column {
  width: 84px;
  text-align: right;
}

td.action-column .button {
  min-height: 32px;
  padding: 6px 10px;
  font-size: 12px;
}

.empty-state {
  height: 140px;
  color: #7b8581;
  text-align: center;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 18px;
  min-height: 64px;
  padding: 11px 16px;
  color: #65706c;
  font-size: 13px;
}

.pagination label {
  display: flex;
  align-items: center;
  gap: 7px;
}

.pagination select {
  min-height: 34px;
}

.codes-dialog {
  width: min(620px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  padding: 0;
  border: 1px solid #cad2ce;
  border-radius: 8px;
  background: #ffffff;
  color: #18201d;
  box-shadow: 0 24px 80px rgba(24, 32, 29, 0.28);
}

.codes-dialog::backdrop {
  background: rgba(18, 25, 22, 0.56);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 22px;
  border-bottom: 1px solid #e1e6e3;
}

.dialog-warning {
  margin: 18px 22px 12px;
  color: #76500e;
  font-size: 13px;
  line-height: 1.55;
}

.codes-dialog pre {
  max-height: 320px;
  margin: 0 22px;
  padding: 14px;
  overflow: auto;
  border: 1px solid #d9dfdc;
  border-radius: 6px;
  background: #f6f8f7;
  color: #17201d;
  font-family: Consolas, "SFMono-Regular", monospace;
  font-size: 14px;
  line-height: 1.75;
  user-select: text;
  white-space: pre-wrap;
  word-break: break-all;
}

.dialog-actions {
  justify-content: flex-end;
  padding: 16px 22px 22px;
}

.toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 30;
  max-width: min(420px, calc(100vw - 48px));
  padding: 11px 14px;
  border: 1px solid #accdbf;
  border-radius: 6px;
  background: #173f31;
  color: #ffffff;
  box-shadow: 0 12px 32px rgba(24, 32, 29, 0.2);
  font-size: 13px;
  line-height: 1.45;
}

.clipboard-helper {
  position: fixed;
  opacity: 0;
  pointer-events: none;
}

@media (max-width: 1100px) {
  .workspace-grid {
    grid-template-columns: 1fr;
  }

  .create-panel {
    max-width: none;
  }
}

@media (max-width: 760px) {
  .topbar {
    align-items: flex-start;
    min-height: 70px;
    padding: 12px 16px;
  }

  .product-name,
  .connection-state {
    display: none;
  }

  h1 {
    font-size: 19px;
  }

  .page-shell {
    padding: 18px 12px 36px;
  }

  .auth-panel {
    grid-template-columns: 1fr;
    gap: 22px;
    margin-top: 28px;
    padding: 22px;
  }

  .inline-field {
    align-items: stretch;
    flex-direction: column;
  }

  .summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .summary-item {
    border-right: 0;
    border-bottom: 1px solid #e2e6e4;
  }

  .summary-item:last-child {
    grid-column: 1 / -1;
    border-bottom: 0;
  }

  .field-grid {
    grid-template-columns: 1fr;
  }

  .pagination {
    align-items: flex-end;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 10px;
  }

  .pagination-actions {
    width: 100%;
  }

  .pagination-actions .button {
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
`;

const SCRIPT = String.raw`(function () {
  "use strict";

  var API_ROOT = "/api/naimage/license/admin";
  var token = "";
  var currentPage = 1;
  var pageSize = 20;
  var totalItems = 0;
  var toastTimer = 0;

  var authPanel = document.getElementById("auth-panel");
  var authForm = document.getElementById("auth-form");
  var adminTokenInput = document.getElementById("admin-token");
  var loginButton = document.getElementById("login-button");
  var authError = document.getElementById("auth-error");
  var dashboard = document.getElementById("dashboard");
  var logoutButton = document.getElementById("logout-button");
  var connectionState = document.getElementById("connection-state");
  var createForm = document.getElementById("create-form");
  var createButton = document.getElementById("create-button");
  var createError = document.getElementById("create-error");
  var permanentLicense = document.getElementById("permanent-license");
  var validDaysInput = document.getElementById("valid-days");
  var noDeadline = document.getElementById("no-deadline");
  var deadlineInput = document.getElementById("redemption-deadline");
  var codesBody = document.getElementById("codes-body");
  var refreshButton = document.getElementById("refresh-button");
  var previousPage = document.getElementById("previous-page");
  var nextPage = document.getElementById("next-page");
  var pageSizeInput = document.getElementById("page-size");
  var pageLabel = document.getElementById("page-label");
  var codesDialog = document.getElementById("codes-dialog");
  var generatedCodes = document.getElementById("generated-codes");
  var copyCodesButton = document.getElementById("copy-codes");
  var downloadCodesButton = document.getElementById("download-codes");
  var toast = document.getElementById("toast");

  function setConnection(label, tone) {
    connectionState.textContent = label;
    connectionState.dataset.tone = tone;
  }

  function setButtonBusy(button, busy, busyLabel) {
    if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? busyLabel : button.dataset.idleLabel;
  }

  function showError(element, message) {
    element.textContent = message;
    element.hidden = false;
  }

  function clearError(element) {
    element.textContent = "";
    element.hidden = true;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(function () {
      toast.hidden = true;
    }, 2600);
  }

  async function api(path, options) {
    var requestOptions = options || {};
    var headers = new Headers(requestOptions.headers || {});
    headers.set("accept", "application/json");
    headers.set("authorization", "Bearer " + token);
    if (requestOptions.body) headers.set("content-type", "application/json");
    var response = await fetch(API_ROOT + path, Object.assign({}, requestOptions, { headers: headers }));
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok || payload.success === false) {
      var error = new Error(payload && payload.error && payload.error.message || payload.message || "请求失败 (HTTP " + response.status + ")");
      error.status = response.status;
      throw error;
    }
    return payload.data;
  }

  function formatDate(epochSeconds) {
    if (!epochSeconds) return "无限制";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(epochSeconds * 1000));
  }

  function appendTextCell(row, text, className) {
    var cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = text;
    row.appendChild(cell);
    return cell;
  }

  function codeStatus(item) {
    if (Number(item.status) !== 1) return { label: "已禁用", tone: "danger" };
    if (Number(item.expired_time) > 0 && Number(item.expired_time) <= Math.floor(Date.now() / 1000)) {
      return { label: "已过兑换期", tone: "warning" };
    }
    if (Number(item.activation_count) >= Number(item.max_activations)) {
      return { label: "次数已用完", tone: "warning" };
    }
    return { label: "启用中", tone: "success" };
  }

  function renderRows(items) {
    codesBody.replaceChildren();
    if (!items.length) {
      var emptyRow = document.createElement("tr");
      appendTextCell(emptyRow, "暂无兑换码", "empty-state").colSpan = 6;
      codesBody.appendChild(emptyRow);
      return;
    }

    items.forEach(function (item) {
      var row = document.createElement("tr");
      var identity = document.createElement("td");
      var name = document.createElement("span");
      var hint = document.createElement("span");
      name.className = "code-name";
      name.textContent = item.name;
      name.title = item.name;
      hint.className = "code-hint";
      hint.textContent = "ID " + item.id + " · " + item.code_hint;
      identity.append(name, hint);
      row.appendChild(identity);

      appendTextCell(row, String(item.activation_count) + " / " + String(item.max_activations), "usage-value");
      appendTextCell(row, Number(item.valid_days) === 0 ? "永久" : "激活后 " + item.valid_days + " 天");
      appendTextCell(row, formatDate(Number(item.expired_time)));

      var statusCell = document.createElement("td");
      var status = codeStatus(item);
      var badge = document.createElement("span");
      badge.className = "status-badge";
      badge.dataset.tone = status.tone;
      badge.textContent = status.label;
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      var actionCell = document.createElement("td");
      actionCell.className = "action-column";
      var disableButton = document.createElement("button");
      disableButton.type = "button";
      disableButton.className = "button button-danger";
      disableButton.textContent = "禁用";
      disableButton.disabled = Number(item.status) !== 1;
      disableButton.addEventListener("click", function () {
        disableCode(item, disableButton);
      });
      actionCell.appendChild(disableButton);
      row.appendChild(actionCell);
      codesBody.appendChild(row);
    });
  }

  function renderSummary(summary) {
    document.getElementById("summary-total").textContent = summary.total;
    document.getElementById("summary-enabled").textContent = summary.enabled;
    document.getElementById("summary-disabled").textContent = summary.disabled;
    document.getElementById("summary-activations").textContent = summary.activation_count;
    document.getElementById("summary-capacity").textContent = summary.activation_capacity;
  }

  function updatePagination() {
    var pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage > pageCount) currentPage = pageCount;
    pageLabel.textContent = "第 " + currentPage + " / " + pageCount + " 页，共 " + totalItems + " 条";
    previousPage.disabled = currentPage <= 1;
    nextPage.disabled = currentPage >= pageCount;
  }

  async function loadCodes(options) {
    var settings = options || {};
    if (!token) return;
    if (!settings.silent) {
      codesBody.replaceChildren();
      var loadingRow = document.createElement("tr");
      appendTextCell(loadingRow, "正在加载…", "empty-state").colSpan = 6;
      codesBody.appendChild(loadingRow);
    }
    setButtonBusy(refreshButton, true, "刷新中");
    try {
      var data = await api("/codes?page=" + currentPage + "&size=" + pageSize);
      totalItems = Number(data.total) || 0;
      renderRows(Array.isArray(data.items) ? data.items : []);
      renderSummary(data.summary || {
        total: totalItems,
        enabled: 0,
        disabled: 0,
        activation_count: 0,
        activation_capacity: 0
      });
      updatePagination();
      setConnection("已连接", "success");
      return true;
    } catch (error) {
      setConnection("连接失败", "danger");
      if (settings.login) throw error;
      if (error.status === 401 || error.status === 403) {
        logout("管理员 Token 无效或已更换。");
        return false;
      }
      codesBody.replaceChildren();
      var errorRow = document.createElement("tr");
      appendTextCell(errorRow, error.message, "empty-state").colSpan = 6;
      codesBody.appendChild(errorRow);
      return false;
    } finally {
      setButtonBusy(refreshButton, false, "刷新中");
    }
  }

  async function disableCode(item, button) {
    var confirmed = window.confirm("确认禁用“" + item.name + "”（" + item.code_hint + "）？\n\n该码已激活的所有设备授权也会立即撤销，此操作不可撤回。");
    if (!confirmed) return;
    setButtonBusy(button, true, "处理中");
    try {
      await api("/codes/" + item.id + "/disable", { method: "POST" });
      showToast("兑换码已禁用，关联设备授权已撤销");
      await loadCodes({ silent: true });
    } catch (error) {
      showToast(error.message);
      setButtonBusy(button, false, "处理中");
    }
  }

  function logout(message) {
    token = "";
    currentPage = 1;
    totalItems = 0;
    adminTokenInput.value = "";
    generatedCodes.textContent = "";
    if (codesDialog.open) codesDialog.close();
    codesBody.replaceChildren();
    var emptyRow = document.createElement("tr");
    appendTextCell(emptyRow, "连接后加载兑换码", "empty-state").colSpan = 6;
    codesBody.appendChild(emptyRow);
    renderSummary({ total: 0, enabled: 0, disabled: 0, activation_count: 0, activation_capacity: 0 });
    updatePagination();
    dashboard.hidden = true;
    logoutButton.hidden = true;
    authPanel.hidden = false;
    setConnection("未连接", "neutral");
    if (message) showError(authError, message);
    adminTokenInput.focus();
  }

  authForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearError(authError);
    var candidate = adminTokenInput.value.trim();
    if (candidate.length < 32) {
      showError(authError, "管理员 Token 至少需要 32 个字符。");
      return;
    }
    token = candidate;
    setButtonBusy(loginButton, true, "验证中");
    try {
      await loadCodes({ login: true });
      adminTokenInput.value = "";
      authPanel.hidden = true;
      dashboard.hidden = false;
      logoutButton.hidden = false;
    } catch (error) {
      token = "";
      setConnection("连接失败", "danger");
      showError(authError, error.message);
    } finally {
      setButtonBusy(loginButton, false, "验证中");
    }
  });

  logoutButton.addEventListener("click", function () { logout(); });
  refreshButton.addEventListener("click", function () { loadCodes(); });

  permanentLicense.addEventListener("change", function () {
    validDaysInput.disabled = permanentLicense.checked;
  });

  noDeadline.addEventListener("change", function () {
    deadlineInput.disabled = noDeadline.checked;
    if (!noDeadline.checked && !deadlineInput.value) {
      var tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      var local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60 * 1000);
      deadlineInput.value = local.toISOString().slice(0, 16);
    }
  });

  createForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearError(createError);
    var deadline = 0;
    if (!noDeadline.checked) {
      var parsedDeadline = new Date(deadlineInput.value).getTime();
      if (!Number.isFinite(parsedDeadline) || parsedDeadline <= Date.now()) {
        showError(createError, "兑换截止时间必须晚于当前时间。");
        return;
      }
      deadline = Math.floor(parsedDeadline / 1000);
    }

    var payload = {
      name: document.getElementById("batch-name").value.trim(),
      count: Number(document.getElementById("code-count").value),
      plan: "pro",
      max_activations: Number(document.getElementById("max-activations").value),
      valid_days: permanentLicense.checked ? 0 : Number(validDaysInput.value),
      expired_time: deadline
    };

    setButtonBusy(createButton, true, "生成中");
    try {
      var data = await api("/codes", { method: "POST", body: JSON.stringify(payload) });
      var codes = Array.isArray(data.codes) ? data.codes : [];
      generatedCodes.textContent = codes.join("\n");
      codesDialog.showModal();
      currentPage = 1;
      await loadCodes({ silent: true });
    } catch (error) {
      showError(createError, error.message);
    } finally {
      setButtonBusy(createButton, false, "生成中");
    }
  });

  previousPage.addEventListener("click", function () {
    if (currentPage <= 1) return;
    currentPage -= 1;
    loadCodes();
  });

  nextPage.addEventListener("click", function () {
    var pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage >= pageCount) return;
    currentPage += 1;
    loadCodes();
  });

  pageSizeInput.addEventListener("change", function () {
    pageSize = Number(pageSizeInput.value) || 20;
    currentPage = 1;
    loadCodes();
  });

  copyCodesButton.addEventListener("click", async function () {
    var value = generatedCodes.textContent;
    var helper = null;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        helper = document.createElement("textarea");
        helper.value = value;
        helper.setAttribute("readonly", "");
        helper.className = "clipboard-helper";
        document.body.appendChild(helper);
        helper.select();
        if (!document.execCommand("copy")) throw new Error("copy failed");
      }
      showToast("兑换码已复制");
    } catch {
      showToast("自动复制失败，请在列表中手动复制");
    } finally {
      if (helper) helper.remove();
    }
  });

  downloadCodesButton.addEventListener("click", function () {
    var blob = new Blob([generatedCodes.textContent + "\n"], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "sparkai-license-codes.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("兑换码文件已下载");
  });

  codesDialog.addEventListener("close", function () {
    generatedCodes.textContent = "";
  });
})();
`;

const ASSETS = new Map([
  [LICENSE_ADMIN_UI_PATH, { contentType: "text/html; charset=utf-8", body: HTML }],
  [`${LICENSE_ADMIN_UI_PATH}/`, { contentType: "text/html; charset=utf-8", body: HTML }],
  [`${LICENSE_ADMIN_UI_PATH}/assets/style.css`, { contentType: "text/css; charset=utf-8", body: CSS }],
  [`${LICENSE_ADMIN_UI_PATH}/assets/app.js`, { contentType: "application/javascript; charset=utf-8", body: SCRIPT }]
]);

export function licenseAdminUiAsset(path) {
  return ASSETS.get(path) || null;
}

export function compileLicenseAdminScript() {
  return new Function(SCRIPT);
}
