# SparkAI WorkSpace 进度

## 当前状态

Date: 2026-09-28
Status: partially verified
Outcome: 收口 Agent 发送、设置可读性、图片网关自动适配，并从当前 `main` 源码生成双接入 Windows x64 开发安装包。
Scope: Agent Composer/Main IPC、Goal/TaskScope/独立 Agent 窗口、设置 Glass 表面、图片 provider 适配与响应归一化、Vite/Electron/NSIS 构建。
Authorization: 用户已授权在 `main` 提交并 push，且要求编译 EXE；没有授权真实图片/视频或付费模型调用。
Method: 后续先实现用户明确功能，只运行受改动直接影响的专项和必要构建检查；同步上下文时压缩当前状态、替换过时表述，不机械追加历史或运行无关全量测试。

## 已完成

1. **Agent 发送链路**
   - 普通点击、`Ctrl+Enter`、stale busy 恢复、显式 `replace-source` TaskScope、Goal 确认后派发均已进入 Main IPC。
   - 独立 Agent 窗口消息往返已通过；Main 日志只记录 `chat/steer` 到达和 TaskScope 模式，不记录 prompt、凭据或响应内容。
   - 根因确认：运行结束时 `activeRunRef` 已清空，但 React `setAgentStatus` 的 effect 尚未把 `agentStatusRef` 更新为 idle；在 `runStatus` bridge 不可用时，`sendPrompt` 会 fail-closed，消息因此不会进入 `naimage:agent:chat`。新增 `setAgentStatusSync()` 在每个状态切换点同步写 ref，保留真实跨窗口运行的 fail-closed 保护。
   - 修正 `scripts/agent-send-ipc-selftest.mjs` 的时序：stale chat 只在真正回到 idle 且没有 active run 后才切换 debug running fixture，避免把仍在收尾的旧 run 误判为产品发送失败。
   - 继续审计确认 `applyProjectSession()` 在同一调用内同步更新项目/会话 refs；项目或会话切换后立即发送的竞态目前未复现，没有新增代码修复。
   - `desktop/ipc/agent-ipc.cjs`、`scripts/agent-send-ipc-selftest.mjs`、`scripts/aidebug-goal-mode-suite.mjs` 与上下文映射已同步。

2. **设置面板可读性**
   - 深色主题输入/辅助文字对比度为 `16.98`/`11.84`，浅色主题为 `19.03`/`7.49`；两种主题的抽屉背景均为不透明实色。
   - 设置抽屉和模型配置表面使用近实色背景与 `ink-soft` 辅助文字，避免 Glass 透底影响阅读。

3. **图片协议与逐模型连接**
   - 已支持每个模型自定义 Base URL/API Key，并保持 Main-only 凭据、旧配置兼容和 SparkAPI 专用版访问策略。
   - 当前自动适配覆盖 OpenAI Images、xAI/Grok Images、Gemini Native，以及 NewAPI、Sub2API、direct gateway；同步/异步请求和 URL、Base64、`inlineData` 等多层响应均有 mock 归一化。
   - 用户界面不要求手动填写 protocol、gateway、transport 或 capability。
   - 审计发现异步创建/轮询路径原先固定发送 Bearer；现已复用统一凭据头策略，保留 NewAPI/Sub2API 默认 Bearer，并支持 Gemini 直连的 `x-goog-api-key`。

## 验证证据

- 通过：`corepack pnpm run test:agent-send-ipc`（最新运行 `chat` 4 次、`steer` 2 次、显式 `replace-source` 1 次；覆盖状态同步修复，先前一次失败已定位为专项时序竞态并修正）。
- 通过：`corepack pnpm run aidebug:goal`（`confirmedGoalDispatched:true`、`confirmedGoalReachedMainIpc:true`、`origin:"goal"`、`runtimeRequest:true`）。
- 通过：`corepack pnpm run test:image-generation-adapters`、`corepack pnpm run test:image-generation-async`（含 Gemini 异步创建/轮询认证头回归）、`corepack pnpm run test:custom-api-transport`、`corepack pnpm run test:agent-window-ui`、`corepack pnpm run test:glass-theme`、`corepack pnpm run test:workspace-glass-ui`。
- 通过：`corepack pnpm run build`（1676 modules）；`node --check` 与 `git diff --check`。
- 通过：`corepack pnpm run package:win:variants`，当前源码双变体构建报告 `bundleEnforced:false`；Unrestricted SHA-256 `BA86020B96C12CA0632DD14D9881EC63B87B6993CE453EA9A3066210F8B1BA64`，SparkAPI SHA-256 `3E13961DE6A6E754693516049455BD0DF1DAA718F1BD1C7B9FD17FD572D3EE22`。

## 当前制品

- [Unrestricted EXE](/E:/003Projects/SparkAI-WorkSpace/sparkai_workspace/release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe)：109,803,520 bytes，`MZ`，SHA-256 `BA86020B96C12CA0632DD14D9881EC63B87B6993CE453EA9A3066210F8B1BA64`。
- [SparkAPI EXE](/E:/003Projects/SparkAI-WorkSpace/sparkai_workspace/release/SparkAI-WorkSpace-SparkAPI-Setup-1.0.9-x64.exe)：109,803,520 bytes，`MZ`，SHA-256 `3E13961DE6A6E754693516049455BD0DF1DAA718F1BD1C7B9FD17FD572D3EE22`。
- 两个 EXE 的 `Authenticode` 状态均为 `NotSigned`；这是开发构建，不是正式发布制品。

## 未验证边界

- 未调用真实图片、视频、Seedance 或付费模型，也未与线上 provider 做联调。
- 未运行真实安装/卸载 smoke，未通过正式 `release:final`/Bundle 门禁，未验证数字签名。
- 构建保留既有大 chunk、.NET nullable 和 Node child-process deprecation 警告；这些警告未阻断本次开发打包。

## 上下文与继续方式

- `GOAL.md` 保存当前目标、范围、授权和验收条件；`docs/CONTEXT_MAP.md` 保存模块所有权、IPC/API 边界和测试入口。
- 先前的“图片协议与逐模型连接”目标已完成并作为本轮基础；Extension 的 `/v1/image-tasks*`、New API 管理边界、旧工作流和真实模型安全边界保持不变。
- 后续 `continue` 先检查 `git status`、本文件和 `GOAL.md`，从当前用户目标开始；验证只覆盖直接受影响的专项和必要构建，只有正式发布或用户明确要求时才扩大范围。

## 下一步

后续继续开发时先读取 `GOAL.md`、本文件和 `docs/CONTEXT_MAP.md`，从未验证边界或新的用户目标开始。若转入正式发布，再另行执行正式门禁、安装/卸载 smoke 和签名验证，并重新记录制品哈希。
