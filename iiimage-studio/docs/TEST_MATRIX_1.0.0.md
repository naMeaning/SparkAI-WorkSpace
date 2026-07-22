# iiimage Studio 1.0.0 最终测试矩阵

生成日期：2026-07-17

## 构建与静态门禁

| 门禁 | 结果 |
| --- | --- |
| TypeScript `typecheck` | 通过 |
| Vite production build | 通过 |
| 生产 bundle 泄漏与体积 | 通过；JS 630,224 B，CSS 174,637 B，总计 855,423 B |
| Agent Prompt / Schema / FastMemory 隔离 | 通过 |
| Responses 原生协议、Web Search、View Image | 通过 |
| 项目 IO、修订防回退、跨项目隔离 | 通过 |
| 图片容器因果、归组/拆出、比例排版 | 通过 |
| 选择状态与画布命令 | 通过 |
| PNG alpha、图层重放、语义抠图 | 通过 |
| PSD 单图/分层导出和像素回读 | 通过 |
| 缩略图缓存、并发导入与工作线程清理 | 通过 |
| Electron 生命周期 | 通过 |

## GUI 与交互

| 场景 | 最终证据 | 结果 |
| --- | --- | --- |
| 完整主界面、设置、模型、账户和菜单 | `.diagnostics/electron/aidebug-2026-07-17T09-14-27-474Z/report.json` | 通过；独立审计 0 error / 0 warning |
| 选择、Ctrl 多选、中键框选、快捷命令 | `.diagnostics/electron/aidebug-2026-07-17T09-15-10-579Z/report.json` | 通过；独立审计 0 error / 0 warning |
| 图片失败恢复与重试时间线 | `.diagnostics/electron/aidebug-2026-07-17T09-15-27-448Z/report.json` | 通过；独立审计 0 error / 0 warning |
| Prompt、FastMemory、窄屏、动效、GFM、退出登录 | `.diagnostics/electron/agent-text-ui-2026-07-17T09-13-55-805Z/report.json` | 通过 |
| 真实 AI 抠图视觉审计 | `.diagnostics/electron/aidebug-2026-07-17T03-08-51-233Z/report.json` | 通过；0 error / 0 warning |
| 真实 AI 重绘视觉审计 | `.diagnostics/electron/aidebug-2026-07-17T03-12-57-321Z/report.json` | 通过；0 error / 0 warning |

## 性能

| 门禁 | 最终证据 | 结果 |
| --- | --- | --- |
| 开发 AIDebug 压力真值 | `.diagnostics/electron/aidebug-2026-07-17T09-16-16-019Z/report.json` | 通过；1000 节点、500 消息、1000 流增量、10 张 4K 容器与清理均有实测 |
| 生产性能三轮 | `.diagnostics/electron/product-performance-2026-07-17T09-16-50-891Z/report.json` | 通过；严格审计 0 error / 0 warning |

生产性能聚合值：工作台 1205 ms、renderer boot 770.6 ms、heap 22,957,320 B、zoom/pan/drag P95 分别约 1.0/0.2/0.2 ms、交互 Long Task 最大 54 ms。

## 真实图片能力

| 能力 | 证据 | 结论 |
| --- | --- | --- |
| 单图、连续三图、十图并行、混合提示词组和统一容器 | `.diagnostics/electron/aidebug-2026-07-17T08-39-30-805Z/report.json` | 通过 |
| 六层透明 PNG、展开、重组、合并与 PSD | `.diagnostics/electron/aidebug-2026-07-17T04-40-30-198Z/report.json` | 通过 |
| AI 抠图 | `.diagnostics/electron/aidebug-2026-07-17T03-08-51-233Z/report.json` | 通过 |
| AI 重绘 | `.diagnostics/electron/aidebug-2026-07-17T03-12-57-321Z/report.json` | 通过 |
| 商品主体替换 | `.diagnostics/electron/aidebug-2026-07-17T08-01-06-820Z/report.json` | 通过 |
| 文案替换 | `.diagnostics/electron/aidebug-2026-07-17T08-10-04-862Z/report.json` | 通过 |
| 服装上身 | `.diagnostics/electron/aidebug-2026-07-16T20-15-46-111Z/report.json` | 通过 |
| 商品多角度（单正面参考） | `.diagnostics/electron/aidebug-2026-07-17T08-17-33-866Z/report.json` | 链路完成但不作为绿色质量证据；右后视角仍偏右前，已加入推断边界与禁止过度承诺契约 |

## 发布包

| 门禁 | 证据 | 结果 |
| --- | --- | --- |
| 解压版正式运行时 | `.diagnostics/release/packaged-smoke-2026-07-17T09-18-38-105Z/report.json` | 通过 |
| 安装、快捷方式、启动、卸载、零残留 | `.diagnostics/release/installer-smoke-2026-07-17T09-23-48-402Z/report.json` | 通过 |
| 安装包 SHA-256 | `09e52c1cf6ad7d89c95106b7564a0bcd62b2bf55602242e9d2764da4db547da6` | 通过 |
| 精选案例包 SHA-256 | `ae9174b609e6c6322f98244cdff03d2d01b7fda5bbfa05d28e3b4598b08db784` | 通过；33 张真实案例通过 Forge Release 分发 |
| Authenticode | `NotSigned` | 已明确披露，不宣称已签名 |

## 成果归档

桌面 `C:\Users\29488\Desktop\IMAGE` 与 `manifest.json` 一致，共 280 张：`final-posters` 33 张、`historical` 174 张、`layered` 73 张；源文件只复制、不移动，并按 SHA-256 去重。
