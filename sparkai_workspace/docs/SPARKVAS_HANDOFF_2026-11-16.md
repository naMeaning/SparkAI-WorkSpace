# Sparkvas 实施交接 Prompt（历史归档）

> 以下为 2026-11-16 交接原案，不是当前实施指令。不要据此重启 Phase 0/1、改名或推送。当前范围见 [Goal](../GOAL.md) 与 [11 月 20 日工作流优先方案](SPARKVAS_WORKFLOW_FIRST_REFACTOR_2026-11-20.md)，交付状态见 [Progress](../PROGRESS.md)。

你是 Sparkvas 的实现 Agent。工作目录为仓库下的 `sparkai_workspace/`。请从当时的真实工作树开始，不要把规划当成已完成证据。

## 必须先读

按顺序阅读：

1. `AGENTS.md`、`PRODUCT_INTENT.md`、`docs/CONTEXT_MAP.md`
2. `GOAL.md` 顶部当前任务、`PROGRESS.md` 顶部当前状态
3. `docs/PRODUCT_STRATEGY_SPARKVAS_2026-11-16.md`
4. `GLOSSARY.md`
5. `docs/adr/0001-canvas-first-ai-native-workflow-authoring.md`
6. `docs/adr/0002-brand-sparkvas.md`
7. `docs/adr/0003-github-registry-and-permissioned-tools.md`
8. `docs/IMPLEMENTATION_PLAN_SPARKVAS_2026-11-16.md`

## 先恢复现场

执行 `git status --short` 和 `git branch --show-current`。当前 `main` 上有“全桌面动作按钮图标化”的在制改动和旧文档 dirty；它们必须保留。不要用 reset、checkout、clean 或覆盖方式让工作树看起来干净。若本任务要改共享 UI/样式，先建立独立分支或 worktree，并记录基线 commit。

## 任务

按实施计划推进 Sparkvas，但不要一次改完。第一个交付批次只做 Phase 0 和 Phase 1：

### Phase 0：边界冻结

- 更新 `AGENTS.md`、`PRODUCT_INTENT.md`、`docs/CONTEXT_MAP.md`、`harness/CONVERSATION_DECISIONS.md`，把旧的“不得恢复工作流编辑器/工具节点”替换为：Canvas-first；Studio 只允许语义 Recipe 节点；不恢复底层 ComfyUI 式节点图；Skill 声明式、Tool 受权限控制。
- 新建 `docs/RECIPE_CONTRACT.md`，定义 `SkillManifest v1`、`ToolManifest v1`、`RecipeDocument v1`、`RecipeRun v1` 的字段、ID 规则、版本、hash、权限、状态和示例。
- ID 规则：`skill.<publisher>.<slug>`、`tool.<publisher>.<slug>`、`recipe.<publisher>.<slug>`；运行身份使用 `runId`，步骤使用 `stepId`。
- 不写产品代码。

### Phase 1：纯合同骨架

- 先改 UI 可见品牌：`src` 文案、窗口标题、关于/帮助和文档改为 Sparkvas；暂不改 `package.json` 的 `productName`/`executableName`、appId、安装器身份、用户数据目录和更新协议，这些留到 Phase 7。域名未确认前不要硬编码下载地址。
- 新增 `runtime/skill-contract.cjs`、`tool-contract.cjs`、`recipe-contract.cjs`、`recipe-graph.cjs`、`recipe-run-contract.cjs`，以及对应 `.d.mts`。
- 只做纯校验、规范化、hash、DAG/端口/循环检查和状态枚举；不接 Electron、React、网络或模型。
- 在 `package.json` 增加 `test:recipe-contract`、`test:skill-contract`、`test:tool-contract`，测试放在 `scripts/`，使用 Node test/现有 selftest 风格。
- 更新 `docs/CONTEXT_MAP.md` 的 owner 和测试入口；更新 `GOAL.md`、`PROGRESS.md`，写清“合同已实现/未实现”和证据。

## 合同要求

- Recipe 是有向无环图，不允许循环；节点类型首版只允许 `Input`、`Brief`、`Skill`、`Transform`、`Tool`、`Review`、`Output`。
- Skill 不执行任意代码；Tool 必须声明 `network`、`filesystem`、`process`、`models`、`mcp` 等权限；首版 Tool 只允许内置/受控适配器，不允许 Registry 直接安装第三方可执行代码。
- Recipe 必须声明 `schemaVersion`、`minAppVersion`、`dependencies`、`inputSlots`、`outputContract`、`license` 和内容 hash。
- Run 必须记录 `recipeHash`、`recipeVersion`、`scopeHash`、`inputAssetIdentity`、`permissionSnapshot`、步骤状态、输出资产和错误；未知/断线提交不重发。
- 公开 DTO 不包含 Key、Cookie、绝对路径、签名 URL 或内部 entry ID。

## 第一垂直切片（下一批，不要现在做）

合同通过后，再按计划做 Beauty Cross-border Set：

`Canvas 选图 → 附加 Skill → Recipe Run → Studio 编辑 → 6 张套图 + 5 秒视频 → 回 Canvas → provenance 可见`

先只接现有图片执行链；视频和 Registry 后置。所有测试使用 fixture/fake/loopback，0 真实付费请求。

## 验证与交付

- 先运行与改动直接相关的合同/纯逻辑测试，再按计划扩展。
- 任何可见交互必须在真实隔离 Electron 中覆盖 1280×800 与 884×640、浅/深主题、选中保持、失败/取消/重启；不能只查 DOM。
- 一旦修改产品代码，按仓库规则执行 production build、最终 Windows EXE、SHA-256、正常退出后的品牌安装、安装身份核对、`GOAL/PROGRESS/CONTEXT_MAP` 同步和普通 upstream push。不要声称未产生的包/安装/发布。
- 如果当前图标化任务尚未收口，先完成独立分支上的合同工作，或等用户确认再合并；不要夹带它的改动。

## 报告格式

最终报告分开写：

- 实际改了什么、为什么；
- 实际运行了哪些测试/截图/构建，结果是什么；
- 未验证的真实模型、视频、DPI、支付、第三方 Tool 或影视剧管线；
- 若产生 EXE/安装，给出真实路径、大小、SHA-256 和安装结果；未产生就明确说未产生。

不要用计划、静态搜索、旧截图或旧 EXE 代替本轮证据。
