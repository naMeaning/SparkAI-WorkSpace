# Sparkvas 第一垂直切片实施与验收（2026-11-17）

**状态**：本地实现、专项验证、Windows EXE 打包和品牌安装已完成；源码/文档提交与普通 push 在收尾批次完成。当前不是正式 Release。

## 10 行功能审计

1. 用户能完成：从一张受管商品图启动内置 Beauty product-hero Recipe，查看预算/权限/输出，确认后生成六张图并回到同一 Canvas。
2. 操作路径：选中单素材图片 → “用 Skill” → Recipe → Studio 配置 → 检查运行计划 → 勾选六次请求确认 → 运行 → 六图结果节点 → Recipe Run provenance。
3. 新增顶层 UI 入口只有一个：选中单素材图片后的“用 Skill/Recipe 处理”；其余是同一入口内部的 Studio、确认、进度和 provenance 页面。
4. 复用的 owner：既有 Project/Session、Selection、TaskScope、project-store 原子写、图片执行服务、image-operation journal、managed asset 和 Dialog/UI primitives。
5. 新增持久化：项目 `.naimage/recipes/`、`.naimage/recipe-runs/`；不复制第二套项目或任务 schema。
6. 故意不做：视频、Registry/Marketplace、通用节点编辑、Agent 自动起草/修改 Recipe、多 Agent/多项目状态/多主题、Phase 7 品牌技术身份迁移、新 CLI/MCP。
7. 已发现的重复/空壳入口：旧图片编辑下拉中的禁用“扩图（暂未开放）”属于纯占位，本批移除；没有新增第二套 Recipe 菜单。
8. 删除证据：`src/image-workspace-overlays.tsx` 的 “AI 编辑方式”选项只保留实际 `AI_IMAGE_EDIT_MODES`；基线 `eb005c5` 中还存在 `expand` 禁用项，当前代码和 UI 回归断言均要求不存在该值。
9. 测试范围：合同、Store、Run、IPC 注册、typecheck、production build、隔离 Electron UI 成功/失败/取消/重启恢复，以及 packaged smoke；见下方证据。
10. 费用边界：prepare 不派发请求；只有用户勾选确认并点击运行后才可能进入图片执行；未知提交不重发；本轮真实模型/图片请求为 0。

## 用户路径

1. 打开项目，选中一个只有一个受管图片素材的图片节点。
2. 节点快捷栏点击“用 Skill”；Studio 显示唯一内置 Recipe、商品图、Recipe 版本/hash、六个输出槽。
3. 修改场景文案、市场语言、画幅/清晰度/质量与六个槽方向，点击“检查运行计划”。
4. 确认页显示输入资产身份、Recipe 版本/hash、Recipe Run、权限快照、预期六个输出和六次图片请求说明。
5. 勾选“确认发起六次图片请求”后点击“确认并运行六张”；进度页逐槽显示状态，取消按钮只在运行中可用。
6. 成功后同一 Canvas 新增一个含六张成果的结果节点；节点上的 `Recipe Run · <id>` chip 打开 provenance，显示 Recipe、Run、scope、输入和六个输出。

## Owner 与持久化

| 区域 | owner | 职责 |
| --- | --- | --- |
| Main Recipe Store | `desktop/recipe-store.cjs` | 项目级内置 Recipe 种子、索引 revision、原子 JSON 写入、内容 hash 校验 |
| Main Recipe Run | `desktop/recipe-run-service.cjs` | prepare/confirm/start/cancel/resume、计划冻结、唯一 runId、输入身份、权限快照、未知提交保护、结果回投 sidecar |
| Main IPC | `desktop/ipc/recipe-ipc.cjs` | 七个显式通道、确认校验、稳定错误投影 |
| Renderer | `src/recipe-picker.tsx`、`src/studio-state.ts` | 最小 Recipe 选择/Studio/确认/进度/provenance；复用现有 Dialog/UI primitives |
| Canvas 接线 | `src/main.tsx` | 单素材入口、复用 Selection/Project、六图结果节点和 provenance chip |
| 共享类型 | `src/core.ts` | `RecipeStudioOptions`、preparation/run DTO 和 preload bridge 类型 |

持久化只在当前项目 `.naimage/` 下增加：

- `recipes/recipes.json`：内置 Recipe 索引和 revision；
- `recipes/recipe.sparkvas.beauty-product-hero.json`：冻结 Recipe 文档；
- `recipe-runs/<runId>.input.json`：确认前计划、数据输入和参数；
- `recipe-runs/<runId>.json`：sealed `RecipeRun`；
- `recipe-runs/<runId>.outputs.json`：六张已交付资产的 renderer-safe sidecar。

项目恢复、画布 Session、图片 journal 和已有资产仍由原 owner 管理，不新增第二套项目状态。

## 安全边界

- Run 在启动前冻结 `recipeHash`、`recipeVersion`、`scopeHash`、输入 asset/occurrence/contentHash、permissionSnapshot 和 idempotencyKey。
- `prepare` 只写计划，不发图；`start` 必须收到 `confirmed: true`。
- 进程中断后，持久化 `prepared` 步骤没有 journal 证据时也按 unknown 停止，不重发。
- 成功结果先写输出 sidecar，再写 succeeded 步骤；重启恢复不会重复创建画布结果。
- 每个 run 的六张输出通过 asset identity 去重；同一 Run 的取消/失败不会自动重建请求。
- 公开 UI DTO 不返回 API Key、Cookie、签名上游 URL 或内部 continuation；结果暴露的是本项目资产身份/受管地址。

## 删除/隐藏证据

**入口**：画布图片节点右键 → “AI 编辑” → 图片编辑器的“编辑方式”下拉。

**代码位置**：`src/image-workspace-overlays.tsx` 的 `RegionRedrawDialog`，当前只渲染 `AI_IMAGE_EDIT_MODES` 的真实选项。基线 `eb005c5` 的同一位置额外有：

```text
<option value="expand" disabled>扩图（暂未开放）</option>
```

**实际证据**：

- `scripts/image-edit-ui-selftest.mjs` 的隔离 Electron 回归现已断言 `expand` 不存在，并保留真实六模式断言；前三个检查通过。
- after 截图：`.diagnostics/image-edit-ui-2026-11-17T01-14-52-865Z/unified-editor.png`。
- 该专项完整套件后续在既有重启 readiness 和 884×640 精确 viewport 假设上失败，失败报告保留在同目录 `report.json`；这不是删除占位后的图片提交路径失败，按已有测试边界记录，未用其替代本切片 UI 通过证据。

## 验证证据

| 验证 | 结果 |
| --- | --- |
| `test:skill-contract` / `test:tool-contract` / `test:recipe-contract` | 6/6、5/5、11/11 |
| `test:contract-types` / `typecheck` | 均 exit 0 |
| `test:recipe-store` / `test:recipe-run` / `test:recipe-ipc` | 5/5、8/8、6/6 |
| `test:ipc-registration` | 178 注册 invoke、175 preload invoke、3 internal |
| `test:studio-ui` | 73 checks、12 截图、0 真实模型请求；覆盖成功/失败/取消/重启恢复、1280×800、884×640、浅/深主题、选择保持 |
| `build` | 1720 modules，exit 0 |
| `package:smoke` | ok，真实 `SparkAIWorkSpace.exe` 启动/项目/资产/语义/PSD/缩略图 smoke，0 真实请求 |

Studio UI 最终报告：

`.diagnostics/electron/sparkvas-vertical-slice-2026-11-17T01-23-18-647Z/report.json`

关键截图：

- `01-recipe-picker-light-1280x800.png`、`02-studio-light-1280x800.png`
- `03-confirm-light-1280x800.png`、`04-run-finished-light-1280x800.png`
- `05-canvas-result-light-1280x800.png`、`06-provenance-light-1280x800.png`
- `07-recipe-picker-dark-884x640.png`、`08-studio-dark-884x640.png`
- `09-failure-light-1280x800.png`、`10-cancelled-light-1280x800.png`
- `11-restart-recovery-light-1280x800.png`、`12-restart-reload-idempotent-light-1280x800.png`

## 制品、安装与未验证边界

- EXE：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`
- 大小：110,278,656 B
- SHA-256：`4b9c9fb8026de300184ed926a954e592f903d3092b08c67209803c29eb58e23e`
- VersionInfo：1.0.9.0；Authenticode：NotSigned
- ASAR：53,784,865 B / SHA-256 `1fa707df591566a2dd519517aed40c4bd56ac965bc7373f1ccced508356d12e5`
- 品牌 `/S` 原位安装：exit 0 / 26,191 ms；安装目录 `E:\sparkai-workspace\naimage`，安装后 EXE 与 ASAR 与打包目录一致。
- HKCU Uninstall 项仍为 `Software\887890c3-49de-5e86-9a32-28781d680b7f`，显示名/安装身份沿 Phase 7 前的兼容名称。
- packaged smoke 报告：`.diagnostics/release/packaged-smoke-2026-11-17T01-26-10-193Z/report.json`
- Git：源码/测试/文档提交 `e65da8afaf0ff0bef214f1cb0c4fb211e2521e82` 已普通 push `origin/codex/sparkvas-vertical-slice`；本地 HEAD 与 `git ls-remote` 一致，未合并 main。

仍未验证：真实付费图片生成、Seedance/视频、物理 125%/150% DPI、支付、Registry/Marketplace、第三方 Tool、影视剧 Recipe、CLI/MCP 新 Recipe 命令、正式 Release/tag 或 EXE 上传。图片编辑专项的完整回归还受既有 readiness/DPR 测试假设影响；不能把本切片 Studio 的通过结果扩大成该旧专项整体通过。
