# Sparkvas 实施计划

**日期**：2026-11-16

**依据**：[Sparkvas 产品决策包](PRODUCT_STRATEGY_SPARKVAS_2026-11-16.md)、[GLOSSARY](../GLOSSARY.md)、[ADR-0001](adr/0001-canvas-first-ai-native-workflow-authoring.md)、[ADR-0002](adr/0002-brand-sparkvas.md)、[ADR-0003](adr/0003-github-registry-and-permissioned-tools.md)。

**性质**：原实施计划的历史归档，不作为当前任务单或交付证据。首版范围以 [11 月 20 日工作流优先方案](SPARKVAS_WORKFLOW_FIRST_REFACTOR_2026-11-20.md) 为准；当前主线状态见 [Progress](../PROGRESS.md)。

## 1. 实施目标

先交付一个可验证的垂直切片，再扩展为完整产品：

> 用户在 Sparkvas 画布选中一张美妆商品图，附加一个 Skill，Agent 生成可审阅的 Recipe；用户在 Studio 修改场景、镜头/输出槽位并运行；六张跨境套图和一段短视频回到同一画布，保留来源、版本、权限和 Run 状态。

这个切片同时覆盖产品模型、Main 执行、Studio UI、Recipe Run、权限和 provenance。Marketplace、影视剧 Skill 包、主题收敛和品牌迁移围绕这个切片逐步接入。

## 2. 当前事实与硬约束

以下文件是当前真实 owner，计划必须沿它们扩展：

| 边界 | 当前 owner | 计划用法 |
| --- | --- | --- |
| Renderer 编排 | `src/main.tsx` | 只增加跨域状态和路由；Studio 逻辑进入新模块 |
| 共享类型/合同 | `src/core.ts`、`runtime/tool-schemas.cjs` | 新增 Recipe/Skill/Tool DTO 时同步，不复制第二套 |
| 内置插件 | `plugins/builtin-manifests.json`、`src/plugin-system.ts`、`src/plugin-state.ts`、`desktop/plugin-state.cjs` | 扩展为 Skill/Recipe 包来源，保留现有插件命令 |
| 需求模板/Skill 导入 | `desktop/skill-import.cjs`、`desktop/requirement-library.cjs`、`src/requirement-template-dialog.tsx` | 现有 `CanvasSkill` 作为 legacy adapter；新 Skill manifest 是超集 |
| 项目持久化 | `desktop/project-store.cjs`、`desktop/project-session-normalizer.cjs`、`desktop/project-save-coordinator.cjs` | Recipe 定义和 Run 另建受管文件，仍由 Main 原子写 |
| 项目迁移 | `desktop/project-data-migration.cjs` | 承载旧项目/旧用户数据迁移，不另写一套 |
| 图片执行 | `desktop/image-generation-service.cjs`、`desktop/image-operation-journal.cjs` | Recipe 步骤复用同一执行链和幂等 journal |
| 视频执行 | `desktop/video-task-service.cjs`、`desktop/video-task-adapter.cjs` | Recipe 视频步骤复用 create/poll/download 链 |
| ComfyUI | `desktop/comfyui-*`、`desktop/managed-*`、`runtime/comfyui-*` | Tool 的一种受控适配器；不把任意 workflow 直接暴露给 Registry |
| Agent 工具 | `agent-runtime.cjs`、`runtime/tool-schemas.cjs`、`desktop/agent-integration-service.cjs` | 新增结构化 `recipe` 工具；工具选择仍由模型自主决定 |
| IPC | `desktop/ipc/register-desktop-ipc.cjs`、各领域 `*-ipc.cjs`、preload | 新增 Recipe/Registry IPC，不绕过 Main |
| CLI/MCP | `integrations/naimage-control/references/commands.schema.json`、`src/automation-command-registry.ts` | 先扩展现有 schema，品牌迁移时再改名 |
| 主题 | `src/glass-theme.ts`、`runtime/glass-theme-presets.json`、`src/styles/01-liquid-glass-tokens.css`、`src/glass-lab.tsx` | 收敛为一个 registry；不新增第二套主题系统 |
| 布局 | `src/agent-panel-layout.ts`、`src/settings-persistence.ts`、`src/main.tsx` | 新 Layout Preset 复用现有设置持久化 |
| 品牌身份 | `package.json`、`electron-main.cjs`、`scripts/release/*`、`tools/windows-installer/*` | 可见品牌先改；技术身份迁移单独设 gate |

硬约束：

- 不恢复任意底层节点图；Studio 节点是语义节点，不是 ComfyUI 算子镜像。
- 不创建第二套 Project、Selection、TaskScope、Agent Runtime 或 Session。
- Registry 包不能直接执行任意代码；Skill 只声明，Tool 必须受控并显式授权。
- 所有付费图片/视频请求需要用户当次授权；开发和专项测试使用 fake/loopback。
- 现有图标化 dirty 与旧文档改动必须保留；本计划实施时使用独立分支或 worktree，不覆盖现场。

## 3. 目标架构与所有权

### 3.1 纯合同层（runtime）

新增纯模块，禁止 Electron/React 依赖：

- `runtime/skill-contract.cjs`：Skill manifest、输入槽位、参数、示例、限制、版本和 hash。
- `runtime/tool-contract.cjs`：Tool manifest、权限、能力、输入输出、网络/文件边界、兼容版本。
- `runtime/recipe-contract.cjs`：Recipe 文档、节点/边、输入输出、依赖、版本和 hash。
- `runtime/recipe-graph.cjs`：DAG 校验、端口连接、必需输入、循环拒绝、稳定拓扑排序。
- `runtime/recipe-run-contract.cjs`：Run/Step 状态、幂等键、错误分类、恢复和取消合同。

这些模块同时产出 `.d.mts` 类型镜像，供 Renderer 和测试复用。任何 schema 变化都必须同步 `src/core.ts`、`runtime/tool-schemas.cjs`、CLI/MCP schema 和合同测试。

### 3.2 Main 服务

- `desktop/recipe-store.cjs`：项目内 Recipe 定义的读写、schema 校验、revision、原子保存和 legacy 导入。
- `desktop/recipe-run-service.cjs`：创建 Run、冻结输入/配置/权限、按 DAG 调度步骤、取消、恢复和错误投影。
- `desktop/recipe-registry-service.cjs`：读取 curated index、下载包、校验 hash/许可证/兼容性、安装、更新、回滚和权限确认。
- `desktop/ipc/recipe-ipc.cjs`：只暴露稳定 ID、脱敏 DTO 和明确动作；不把 URL、绝对路径或凭据传给 Renderer。

`recipe-run-service` 只编排现有执行服务，不复制图片/视频/ComfyUI 逻辑。每一步至少绑定：

`runId + stepId + recipeHash + recipeVersion + scopeHash + inputAssetIdentity + model/config/permission snapshot`

### 3.3 Renderer

- `src/studio-state.ts`：Studio 视图模型、selection 映射、图编辑、undo/redo 和 run 投影；禁止写进 `main.tsx`。
- `src/studio-panel.tsx`：Studio 外壳、Canvas/Studio 切换和运行栏。
- `src/studio-graph.tsx`：语义节点/边渲染、缩放平移、连接和选中。
- `src/studio-node.tsx`：节点状态、输入输出、错误和权限提示。
- `src/studio-inspector.tsx`：节点详情、Skill/Tool 参数、版本和 provenance。
- `src/recipe-picker.tsx`：从画布选中素材选择 Skill/Recipe，展示输入、权限和预计输出。
- `src/marketplace-panel.tsx`：Registry 浏览、安装、更新、权限和举报。
- `src/layout-presets.ts`：布局预设的纯校验/序列化；UI 放入现有 chrome/panel 组件。

`src/main.tsx` 只负责实例化这些模块、接现有 bridge、把 Run 结果回投画布；不新增第二套 selection 或 project state。

### 3.4 持久化位置

Phase 1–6 继续使用现有项目元数据目录 `.naimage/`，新增：

- `.naimage/recipes/recipes.json`：Recipe 定义索引与 revision。
- `.naimage/recipes/<recipeId>.json`：单个 Recipe 文档，避免一个巨大文件。
- `.naimage/recipe-runs/<runId>.json`：Run、步骤、权限、输出和恢复状态。

应用级安装内容放入现有 `userData` 下的 `recipes/`、`skills/`、`tools/`、`registry-cache/`；不得写入项目目录。

Phase 7 技术改名时再迁移到 `.sparkvas/`，保留 `.naimage/` 只读兼容一个版本。

## 4. 分阶段实施

### Phase 0：边界与合同冻结（文档）

**目标**：先把旧产品边界改成新方向，避免实现时同时对抗文档和代码。

改动：

- `sparkai_workspace/AGENTS.md`：把“不得恢复工作流编辑器/工具节点”改为“Canvas-first；Studio 只允许语义 Recipe 节点，不恢复底层节点图”。
- `sparkai_workspace/PRODUCT_INTENT.md`：增加 Canvas/Studio、Recipe/Skill/Tool、Recipe Run、权限和 Registry 的目标。
- `sparkai_workspace/docs/CONTEXT_MAP.md`：登记新 owner、持久化、IPC、CLI/MCP 和测试入口。
- `harness/CONVERSATION_DECISIONS.md`：追加 2026-11-16 的产品转向决策。
- 新建 `docs/RECIPE_CONTRACT.md`：给出 Skill/Tool/Recipe/Run 的 v1 示例和 ID 规则。

退出条件：文档不再互相矛盾；没有代码改动；现有图标化 dirty 保留。

### Phase 1：UI 可见品牌与合同骨架

**目标**：让后续开发和演示先使用 Sparkvas 名称，同时建立可测试的纯合同。

改动：

- `src` 的 UI 文案、窗口标题、关于/帮助和文档改为 Sparkvas；暂不改 `package.json` 的 `productName`/`executableName`、appId、安装器身份、数据目录和更新协议，这些留到 Phase 7 与技术迁移一起。
- 新增 `runtime/skill-contract.cjs`、`tool-contract.cjs`、`recipe-contract.cjs`、`recipe-graph.cjs`、`recipe-run-contract.cjs` 及 `.d.mts`。
- 在 `integrations/naimage-control/references/commands.schema.json` 预留 recipe/marketplace 命令名；暂不接执行。

测试：新增 `test:recipe-contract`、`test:skill-contract`、`test:tool-contract`，覆盖 schema、hash、DAG、循环、重复 ID、版本和权限。

退出条件：合同测试通过；可见品牌正确；没有 Recipe 执行 UI。

### Phase 2：Main 持久化与执行骨架

**目标**：用 fake adapter 跑通“一个 Recipe 定义 → 一次 Run → 输出资产”。

改动：

- `desktop/recipe-store.cjs`、`desktop/recipe-run-service.cjs`、`desktop/ipc/recipe-ipc.cjs`、preload 和 `register-desktop-ipc.cjs`。
- 扩展 `desktop/project-store.cjs` 的原子写和 `project-save-coordinator` 的保存屏障。
- `recipe-run-service` 只调用现有图片/视频/ComfyUI 服务的稳定接口；测试用 fake adapter。
- Run 支持 create/start/cancel/status/resume，未知提交不重发。

测试：`test:recipe-store`、`test:recipe-run`、`test:recipe-ipc`、`test:project-io`。至少覆盖重复提交、断线恢复、取消、输入漂移、版本漂移和权限拒绝。

退出条件：无 UI 也能从 fixture 输入产生受管输出和 provenance；0 真实付费请求。

### Phase 3：Studio MVP 与 Canvas 往返

**目标**：真实 Electron 中完成画布选图 → Studio 编辑 → 运行 → 结果回画布。

改动：

- `src/studio-state.ts`、`studio-panel.tsx`、`studio-graph.tsx`、`studio-node.tsx`、`studio-inspector.tsx`、`recipe-picker.tsx`。
- `src/workspace-chrome.tsx` 增加项目内 `Canvas | Studio` 切换；`src/main.tsx` 只接状态和 bridge。
- 画布右键/选中工具栏增加“用 Skill/Recipe 处理”，复用现有 selection 和 TaskScope。

测试：`test:studio-ui`、`test:recipe-ui`，真实隔离 Electron，1280×800 与 884×640、浅/深主题、选中保持、取消/失败/重启。

退出条件：用户能在 Studio 修改节点和输出槽位；运行结果只出现一次；关闭 Studio 不丢画布；无第二套项目状态。

### Phase 4：AI 起草/修改/修复

**目标**：Agent 能根据自然语言生成 Recipe 草稿，并解释、修改和修复。

改动：

- `runtime/tool-schemas.cjs` 增加结构化 `recipe` 工具；`agent-runtime.cjs` 接入 handler。
- `desktop/agent-integration-service.cjs` 转发 draft/update/explain/repair/run；不绕开 Main 权限。
- Agent Prompt 增加 Recipe 语义节点和权限说明，不暴露内部 entry ID。

测试：`test:recipe-agent`、`test:agent-workflow`、`test:tool-schemas`；覆盖自然语言 → 草稿、修改、修复、拒绝越权 Tool、Run 取消。

退出条件：模型能生成可审阅 Recipe；用户拒绝后不执行；工具选择仍为 `tool_choice=auto`。

### Phase 5：Registry 与 Marketplace

**目标**：从 curated Registry 安装一个公开 Skill，并安全运行。

改动：

- 新建独立 `sparkvas-registry` 仓库（或本仓库 `registry/` fixture）：GitHub Action 按 `sparkvas-skill`、`sparkvas-recipe`、`sparkvas-tool` 发现仓库，校验 manifest、许可证、版本、hash 和归档安全，生成 `index.json`。
- `desktop/recipe-registry-service.cjs`：读取 index、缓存、下载、校验、安装 journal、更新/回滚/下架。
- `src/marketplace-panel.tsx`：浏览、详情、权限、安装、更新、举报。
- MVP 只允许官方/已审核 Skill 和 Recipe；第三方 Tool 只展示、不执行。

测试：`test:recipe-registry`、`test:marketplace-ui`、`test:automation-service`、`test:mcp-wrapper`；覆盖恶意 manifest、hash 不匹配、版本不兼容、权限拒绝、回滚。

退出条件：安装一个 Skill 后可在 Studio 使用；未审核 Tool 不能静默执行；下架/回滚可见。

### Phase 6：主题与布局收敛

**目标**：从 9 套主题收敛为浅/深基础主题 + 强调色 + 密度，并交付 Layout Preset。

改动：

- `runtime/glass-theme-presets.json` 升级为 appearance schema v2：`light`、`dark` 两个基础主题，强调色、密度、字号。
- `src/glass-theme.ts`、`src/glass-lab.tsx`、`src/styles/01-liquid-glass-tokens.css`、`07j-*`：单一 registry → token 投影；清理 `!important` 主题补丁和 fallback 漂移；新增 `on-danger`/focus/surface 语义。
- `src/layout-presets.ts`、`src/workspace-chrome.tsx`、`src/settings-persistence.ts`：面板停靠、缩放、显隐、按领域保存预设；只组合受支持 surface。

测试：`test:glass-theme`、`test:settings-persistence`、`test:ui-foundation`、`test:workspace-layout-config-ui`；覆盖旧主题迁移、危险色对比、媒体原色、重启恢复和失效布局回退。

退出条件：默认 UI 不再出现 9 套主题；浅/深和强调色真实生效；布局预设可保存/恢复；无媒体滤镜。

### Phase 7：Sparkvas 技术身份迁移

**目标**：可见品牌和技术身份一起完成，不丢项目、设置、凭据和升级能力。

改动：

- `package.json`：`name`、`productName`、`build.appId`、`executableName`、更新兼容字段。
- `electron-main.cjs`：`internalApplicationName`、`applicationId`、`canonicalUserDataPath`、legacy 名称和迁移 marker。
- `desktop/project-data-migration.cjs`、`project-store.cjs`、`settings-secret-store.cjs`：`.naimage` → `.sparkvas` 兼容与一次性迁移。
- `scripts/release/*`、`tools/windows-installer/*`、`build/installer.nsh`：EXE/安装器/卸载器/快捷方式/更新源显示名。
- `integrations/naimage-control` → `sparkvas-control`：旧命令保留一个版本别名。

测试：`test:project-data-migration`、`test:project-io`、`test:settings-secret-store`、`test:update-*`、installer smoke、重启更新 E2E。必须验证旧安装原位升级、旧项目/设置/凭据/快捷方式保留、失败回滚。

退出条件：Sparkvas 新安装可用；旧 SparkAI 安装可升级；旧 CLI/MCP 名至少一个版本可用；无数据丢失。

### Phase 8：Hero demo 与实习材料

**目标**：把实现变成可展示的作品，而不是只有功能。

内容：

- 美妆香水/护肤 6 张跨境套图（EN/CN/JP）+ 5 秒运镜视频。
- 一个影视剧/短剧 mini-demo：一张参考图 → 分镜/镜头动作 Recipe；证明同一内核可迁移。
- 3 分钟演示脚本、架构图、关键取舍、失败与恢复证据、未验证边界。
- 真实 UI 截图、Run 记录、安装身份和可复现命令。

约束：真实图片/视频请求只在用户当次授权后执行；演示夹具和 fake/loopback 结果必须分开标注。

## 5. 第一个垂直切片

先做 **Beauty Cross-border Set**，不先做通用工作流编辑器：

- 输入：一张香水或护肤商品图（受管资产）。
- Recipe：`product-hero` → `scene-styling` → `model-hand` → `multilingual-output` → `export`。
- Skills：`product-hero`、`scene-styling`、`multilingual-copy`。
- Tool：现有图片生成适配器（curated built-in），不接第三方代码。
- 输出：6 张不同语言/尺寸图片 + 1 个 5 秒视频镜头（视频步骤可以在第二切片加入）。
- 验收：Canvas 选中 → Skill 附加 → Recipe Run → Studio 可编辑 → 结果回 Canvas → provenance 可查。

这个切片验证了最重要的产品假设：用户愿意用“配方”而不是“节点图”完成重复视觉工作。

## 6. 测试与证据矩阵

| 层 | 入口 | 必测 |
| --- | --- | --- |
| 合同 | `test:recipe-contract`、`test:skill-contract`、`test:tool-contract` | schema、hash、DAG、循环、版本、权限 |
| Main | `test:recipe-store`、`test:recipe-run`、`test:recipe-ipc` | 原子保存、幂等、取消、恢复、输入漂移 |
| UI | `test:studio-ui`、`test:recipe-ui` | 选图、编辑、运行、回 Canvas、两尺寸两主题 |
| Agent | `test:recipe-agent`、`test:agent-workflow` | 起草、修改、修复、拒绝越权 |
| 市场 | `test:recipe-registry`、`test:marketplace-ui` | 校验、安装、更新、回滚、权限 |
| 自动化 | `test:automation-service`、`test:mcp-wrapper` | 命令 schema 与 GUI 同合同 |
| 外观 | `test:glass-theme`、`test:settings-persistence`、`test:ui-foundation` | 迁移、对比度、布局、媒体原色 |
| 品牌/迁移 | `test:project-data-migration`、`test:project-io`、installer smoke、update E2E | 原位升级、旧数据、快捷方式、回滚 |

每个可见交互必须有真实 Electron 截图或可观察状态；不能只用 DOM 存在、静态搜索或 mock 结果证明完成。

## 7. 主要风险与处理

| 风险 | 处理 |
| --- | --- |
| Studio 变成第二个项目状态 | 只共享现有 Project/Selection/TaskScope/Run owner；代码审查禁止复制 |
| 工作流图无限膨胀成 ComfyUI | 只允许语义节点；节点类型白名单；不暴露底层算子 |
| Registry 供应链攻击 | 服务端校验、hash、许可证、权限、默认不执行第三方 Tool |
| Run 重复计费 | 冻结 scope/hash，持久化 operationId，未知提交不重发 |
| 品牌迁移丢数据 | 一次迁移 + 旧名兼容 + 迁移 marker + 失败回滚；先备份/只读校验 |
| 主题重构再次碎片化 | 单一 appearance registry；禁止新增第二套 theme 文件 |
| 演示压力导致假完成 | 以垂直切片和真实证据验收；未验证项明确列出 |

## 8. 完成定义

一个阶段只有同时满足以下条件才算完成：

- 设计合同与代码 owner 一致；
- 受影响专项测试通过；
- 可见交互有真实 Electron 证据；
- `GOAL.md`、`PROGRESS.md`、`CONTEXT_MAP.md` 同步；
- 涉及产品代码时按仓库规则生成并安装 Windows EXE，报告真实路径/大小/SHA-256；
- 未验证的真实服务、DPI、支付、第三方 Tool 或影视剧管线明确列出，不冒充完成。

## 9. 下一步

先执行 Phase 0 和 Phase 1，不启动 UI。Phase 0 的产出是边界文档和 `RECIPE_CONTRACT.md`；Phase 1 的产出是纯合同模块与测试。两者通过后，再进入 Main 服务和 Studio MVP。
