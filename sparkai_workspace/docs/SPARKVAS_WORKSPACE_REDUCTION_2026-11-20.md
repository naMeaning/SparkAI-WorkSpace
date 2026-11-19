# Sparkvas 工作台减法与后台生成（2026-11-20）

## 可完成路径

选中一张受管商品图 →「用 Skill」→ 编辑 Beauty 商品六视图 → 查看输入、权限与预计六张输出 → 明确确认费用 → 回到 Canvas。生成期间可继续画布操作和编辑 Agent 草稿；可取消、查看失败、主动定位结果。每张结果在 Canvas 保留 Recipe Run 来源，能查看 Recipe、Run、输入、权限和输出。

试用路径：

1. 打开包含受管图片的项目并选中图片。
2. 点击「用 Skill」，编辑场景、语言、尺寸、质量和六张输出描述。
3. 点击「继续」，检查输入、权限与六张预计结果。
4. 明确勾选计费确认并点击「开始生成」。
5. 在生成期间继续编辑或取消；完成后查看结果，点击图片下方 Recipe Run 查看来源。

## 删除与保留

| 去掉的重复表面 | 代码位置与实际操作路径 | 证据与保留能力 |
| --- | --- | --- |
| Canvas 底部重复缩放三按钮 | `src/main.tsx` 的 Canvas 底栏曾与悬浮 `CanvasNavigationControls` 同时显示减小、百分比、放大/适配。悬浮导航保留缩放、适配和百分比；底栏保留画布状态。 | Before [01-before-canvas](../.diagnostics/electron/before-head-baseline-2026-11-19T16-51-58-423Z/01-before-canvas-light-1280x800.png)，After [01-canvas](../.diagnostics/electron/sparkvas-vertical-slice-2026-11-19T17-22-29-407Z/01-canvas-clean-light-1280x800.png)。基线测量确认两个可见百分比均为 90%。 |
| 搜索弹层的第二个项目知识面板 | `src/workspace-chrome.tsx::WorkspaceSearch`。从顶栏「搜索当前项目」打开搜索弹层；删除面板副本，保留素材/需求/会话搜索。项目知识和成果检索仍由右侧 `.project-agent-panel` 中的 `ProjectContextPanel` 唯一拥有。 | Before [02-before-knowledge](../.diagnostics/electron/before-head-baseline-2026-11-19T16-51-58-423Z/02-before-knowledge-duplicate-light-1280x800.png) 测得两个面板；After [01b-search](../.diagnostics/electron/sparkvas-vertical-slice-2026-11-19T17-22-29-407Z/01b-search-no-duplicate-knowledge-light-1280x800.png)，UI 专项断言弹层无知识面板且右栏唯一保留。 |
| 唯一内置 Recipe 的选择器和静态节点图 | `src/recipe-picker.tsx`、`src/styles/07k-recipe-studio.css`。旧 Studio 对话框重复显示单一 Recipe 选择项、十个只读节点和说明文字；现在标题就是唯一内置 Recipe，输入图和编辑字段组成一个设置列。 | Before [04-before-studio](../.diagnostics/electron/before-head-baseline-2026-11-19T16-51-58-423Z/04-before-studio-light-1280x800.png)，After [02-studio](../.diagnostics/electron/sparkvas-vertical-slice-2026-11-19T17-22-29-407Z/02-studio-light-1280x800.png)，dark 小窗 [08-studio-dark](../.diagnostics/electron/sparkvas-vertical-slice-2026-11-19T17-22-29-407Z/08-studio-dark-884x640.png)。Recipe 合同和 Main Run 不变；Studio 仍编辑六槽。 |
| 确认页中的临时 Run ID、`none` 权限行 | `src/recipe-picker.tsx` 确认面板。运行前不再展示用户无动作可做的 Run 内部标识；不含权限的进程/MCP 行从摘要隐藏。 | Before [05-before-confirm](../.diagnostics/electron/before-head-baseline-2026-11-19T16-51-58-423Z/05-before-confirm-light-1280x800.png)，After [03-confirm](../.diagnostics/electron/sparkvas-vertical-slice-2026-11-19T17-22-29-407Z/03-confirm-light-1280x800.png)。冻结 Run 与完整 `permissionSnapshot` 仍留在项目，完成后 provenance 展示。 |
| 空验收状态的计数副标题和重复说明标签 | `src/creation-session-panel.tsx`、`src/project-agent-panel.tsx`、`src/project-agent-composer.tsx`、`src/project-context-panel.tsx` 与 `src/workspace-chrome.tsx`。移除空任务状态的数字摘要、常驻介绍和闲置提示；标题和布局直达动作。 | 基线 [01-before-canvas](../.diagnostics/electron/before-head-baseline-2026-11-19T16-51-58-423Z/01-before-canvas-light-1280x800.png) 与 After [01-canvas](../.diagnostics/electron/sparkvas-vertical-slice-2026-11-19T17-22-29-407Z/01-canvas-clean-light-1280x800.png)；UI 专项断言空态仍有「创作要求」入口、搜索上下文唯一、无重复空提示。 |

没有删除项目知识、画布缩放能力、创建创作要求、Agent 控件、六槽编辑、费用确认、来源数据或任何持久化 owner。没有增加顶层入口、设置页、依赖或用户项目持久化文件。

## 后台与一致性

点击费用确认后 Studio 即关闭。画布角落 dock 显示六槽进度、取消、失败/恢复写回和查看结果；用户可继续操作画布、在 Agent 输入框构思下一轮内容。结果通过原 project/session 保存路径写回。写入失败时移除未持久化节点但保留并发编辑，避免撤销后重新出现；同 Run 写回去重，切项目不跨项目移动焦点。轮询使用串行调度；取消与最后一张成功竞态通过重新读取权威 Run 后走同一去重写回。

无新增 Renderer/Main 状态源、IPC、Schema、命令或存储目录。项目继续使用既有 `.naimage/recipes/` 与 `.naimage/recipe-runs/`。无新增依赖。

## 验证

- 隔离 Electron `test:studio-ui`：89 项通过、12 张截图、0 真实模型请求。覆盖 1280×800 浅色、884×640 深色、选择保持、权限/输出确认、后台继续输入、六图写回、来源、失败、取消、重启恢复及重载去重。主报告：[report.json](../.diagnostics/electron/sparkvas-vertical-slice-2026-11-19T17-22-29-407Z/report.json)。
- 合同：Skill 6/6、Tool 5/5、Recipe 11/11、合同类型检查通过。
- Main 服务：Recipe Store 5/5、Run 8/8、IPC 6/6；IPC 注册 178 registered / 175 preload / 3 internal。
- 状态与隔离：creation session status 10/10、hook 7/7、项目上下文投影通过；TypeScript `typecheck` 通过。
- `test:agent-text-ui` 使用 mock，不访问网络；73 项到达后在测试模型选择器因 fixture 没有模型选项（`optionCount: 0`）失败。其旧点击路径/繁杂文案断言已更新为当前界面，但全套未通过，未作为交付门禁或成功证据。
- `test:bundle` exit 1：CSS 聚合 299,868 B 超正式发布线 270,000 B；initial JS 4,359 B、plugin JS 86,769 B 通过，core async JS 1,642,393 B、core JS 1,646,752 B 和完整 dist 2,069,805 B 为 advisory 超限。开发包流程记录 `bundleEnforced: false`，未冒充正式发布通过。
- 真实模型请求数为 0。未验证真实付费、视频、物理 DPI、支付、Registry/Marketplace。

## 费用与交付状态

生成仅在用户勾选费用确认并点击「开始生成」后提交六个图片请求。`prepare` 不提交，未知上游提交不重发。此次验证全部使用 fixture；真实花费为 0。

Windows package 成功，production build 为 Vite 1720 modules。候选 EXE `release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`：110,278,656 B，SHA-256 `2d2e1cf6b9893c872d5d08a8b461975fca2e28de51de1f8d6fbdd493468f86bb`。解包 EXE `release/win-unpacked/SparkAIWorkSpace.exe`：232,719,872 B，SHA-256 `cd8851cdd15fbe4a8ac67c7743a3aa3f0dc45c6adfa041af605c47948c575f33`；ASAR 53,784,562 B，SHA-256 `b8350c822a78955abcc1bba478bb425a84037769d1912c628f8c4e1d01502530`。

安装器 exit 0；当前用户安装仍是旧技术身份 `SparkAI WorkSpace` v1.0.9，目录 `E:\sparkai-workspace\naimage`。安装 EXE/ASAR 与候选包完全匹配；17 个用户数据文件的路径、大小与 SHA-256 前后相同，桌面/开始菜单快捷方式目标不变。已打开安装版窗口：标题 `Sparkvas`、进程响应。普通 push 与远端核验待完成。
