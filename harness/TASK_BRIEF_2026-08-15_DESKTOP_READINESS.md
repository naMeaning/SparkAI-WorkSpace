# Task Brief: SparkAI WorkSpace 1.0.9 desktop readiness

## Classification

- Mode: `goal`
- Owner: `naimage-studio`
- User outcome: 除 SparkAI Extension 生产部署外，完成图片性能、统一导出、验收工具、AIDebug 稳定性和 1.0.9 本地正式发布门禁。
- Why now: 当前功能已有多批测试安装包，但导出中心仍未形成完整 UI 闭环，真实验收缺少安全工具，正式发布门禁尚未执行。

## Scope

- In scope: 常驻缩略图 Worker 与画布缩略图策略；图片/图片组/PSD 统一导出中心；命名模板、项目预设、冲突策略、串行队列、增量导出和历史；真实模型显式授权验收工具；旧 AppData 只读扫描、备份计划和显式执行工具；受影响 AIDebug 稳定性；1.0.9 本地发布文档、门禁和候选制品。
- Explicit non-goals: Extension 生产部署；真实付费图片/视频/Seedance 请求；未经再次确认迁移或清理真实 AppData；删除旧 New API/CRM 源码；Git tag、远端 push、GitHub Release。
- Source-of-truth files and contracts: `naimage-studio/AGENTS.md`、`PRODUCT_INTENT.md`、`GOAL.md`、`PROGRESS.md`、`docs/CONTEXT_MAP.md`、`docs/RELEASE_CHECKLIST.md`。
- Conversation/decision references: 当前 Goal objective；用户 2026-08-15 的未完成事项清单与“生产部署不用管，我来搞”。

## Acceptance

- Observable behavior: 用户可从统一导出中心把单图、多个图片组和 PSD 加入本地串行队列，保存/复用预设，按模板命名，选择冲突策略，跳过未变化内容并查看项目历史；大量 4K 图片冷/热路径不再反复启动子进程；验收入口不会在无明确授权时调用模型或迁移数据。
- Data/contract invariants: Renderer 不提交导出绝对路径；所有目标由 Main 从当前项目解析并复核；项目状态只保存相对路径；普通图片、图片组和 PSD 保持各自现有 owner；真实迁移与付费请求默认拒绝。
- Required documentation synchronization: `GOAL.md`、`PROGRESS.md`、`docs/CONTEXT_MAP.md`、`docs/RELEASE_1.0.9.md`、`docs/README.md`、`scripts/release/release-notes.json`。
- Verification evidence: 导出/IPC/项目迁移/模型合同专项，相关 Electron UI 与性能证据，`typecheck`、`build`、正式 Bundle/产品性能/发布编排结果及本地制品哈希。

## Risk And Authorization

- Real provider/network/release/dependency/destructive action: 仅允许本地构建、测试和本地 Git 提交；不允许真实模型、真实数据迁移/清理、生产部署或网络发布。
- Explicit authorization received: 用户要求完善非生产部署事项并要求工作树提交；未授权付费、破坏性或远端动作。
- Sensitive data boundary: 不读取或输出 API Key、Cookie、Bearer、兑换码、签名 URL；迁移扫描只返回统计和脱敏位置标识。

## Execution Record

- Plan: 性能治理 -> 导出中心 -> 安全验收工具 -> AIDebug 稳定性 -> 发布文档与本地正式门禁 -> 制品复核与本地提交。
- Files changed: 桌面缩略图 Worker/缓存与画布缩略图策略、统一导出中心及项目状态、图片/图片组导出 Main owner、显式验收工具、AIDebug UI/性能套件、发布门禁和版本文档；Extension 管理页已有改动保留并纳入同一工作树审查。
- Tests/scenarios run: 功能专项、IPC 147/144/3、typecheck、UI Surface 15 scenes / 0 failures、性能审计 15/15、10 张 4K 冷/热缓存和三轮产品性能门禁已通过；Extension 工作区/源码检查与 6 项测试通过；113 项正式发布门禁待冻结源码后执行。
- Artifacts produced: 当前只有历史 `bundleEnforced:false` 测试安装包和本轮诊断报告；正式候选制品必须由冻结源码后的单次 `release:final` 生成。
- Unverified boundaries: 生产 Extension、真实 provider 服从度、真实 AppData 迁移、线上更新与发布。
- Decision/status updates: 当前任务排除生产部署和所有未明确授权的外部/破坏性动作。
