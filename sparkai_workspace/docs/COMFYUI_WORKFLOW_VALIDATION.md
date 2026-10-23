# ComfyUI Phase 2：工作流、受管蒙版与透明输出

状态：实现、专项、Windows EXE身份与本地原位安装通过；源码主提交已普通推送。Phase 1 的制品与推送证据见 [连接验证](COMFYUI_CONNECTION_VALIDATION.md)，不能用作本阶段验收。

## 契约与范围

- 同一 `image_gen`、TaskScope、executor、image-operation-journal 和项目资产库；没有第二条图片执行链。
- 工作流公开能力为 `generate`、`img2img`、`inpaint`、`cutout`。`workflowId/templateId` 与 `strength/denoise` 可同值兼容，冲突在网络前拒绝。
- Main 解析 `comfyui.sourceImage/maskImage/referenceImages` 的稳定身份，蒙版另绑定源图 hash、尺寸和不可变 revision；原图与蒙版均保留。
- 蒙版透明区是 inpaint 修改区 / cutout 移除区；不以黑白颜色推断范围。首批 cutout 使用用户蒙版，不宣称自动主体分割模型已经可用。
- 原生 API Format JSON 导入先在 Main 留临时草稿，Renderer/CLI/MCP 只收到节点类型、审核端口及能力候选；向导批准映射后才保存。未知节点、脚本、任意文件节点不可执行，原始 workflow 与路径不进入公开 DTO。
- 旧 generate/img2img 的 schema 2 / policy v2 / hash 保持兼容，新能力使用 schema 3 / policy v3；新 hash 绑定能力，角色与 checkpoint/alpha 要求从审核图派生。历史恢复不要求新的 capabilitiesHash。

## 审核节点语义依据

核对固定 ComfyUI commit `bef11fcbfa8d772678e2ad00b1294c63eb3e5da7` 的核心实现（只读源码核对，不是服务执行）：

- [nodes.py](https://github.com/Comfy-Org/ComfyUI/blob/bef11fcbfa8d772678e2ad00b1294c63eb3e5da7/nodes.py#L1747)：`LoadImage` 的 MASK 为 `1-alpha`，`LoadImageMask(channel=alpha)` 返回该 MASK。
- [nodes_compositing.py](https://github.com/Comfy-Org/ComfyUI/blob/bef11fcbfa8d772678e2ad00b1294c63eb3e5da7/comfy_extras/nodes_compositing.py#L189)：`JoinImageWithAlpha` 使用 `1-resize_mask(mask)` 拼回 RGBA，其审核模块身份是 `comfy_extras.nodes_compositing`。
- 因此 stock cutout 将 `LoadImageMask(alpha)` 直连 `JoinImageWithAlpha`，还原用户蒙版 alpha；不附加反相。输出还必须通过实际像素 alpha 校验，节点名或 PNG 文件名不能代替校验。

## 验证入口与当前证据

| 边界 | 入口 | 当前结果 |
| --- | --- | --- |
| typed 节点/连线/角色、模板 hash 与导入 | `test:comfyui-template`、`test:comfyui-executor`、`test:comfyui-capability` | 14 / 35 / 21 通过；capability 为 6 fake POST / 16 upload / 7 view |
| Main 稳定素材/受管 mask、journal、保护像素与 alpha | `test:comfyui-main`、`test:creation-mask`、`test:creation`、`test:project-io`、`test:image-recovery` | Main 23、mask 11、creation 16、项目 IO 322 资产、恢复 14 子进程通过 |
| GUI/共享 schema/CLI/MCP/Skill | `test:automation-service`、`test:mcp-wrapper`、`test:ipc-registration`、`test:automation-debug` | 通过；MCP 127、IPC 170 注册 / 167 preload |
| TypeScript 与图片观察边界 | `typecheck`、`test:view-image` | typecheck、view-image 已通过 |
| 实际 Electron 交互 | `test:comfyui-ui` | 13组 / 25截图通过；7 loopback POST / 6 view / 7 upload / 1定向队列取消，2次正常退出0 |

UI harness 的系统文件选择结果由隔离 Electron 测试入口替换；实际 Main 导入、审核、mask/资产服务、executor/journal 与 Renderer 均执行。仅返回既有商品照片/本地像素 fixture 的 loopback fake server，不执行真实模型或真实 ComfyUI 节点。未通过的初试报告保留于 `.diagnostics/comfyui-ui-2026-10-23T01-43-08-644Z/report.json` 与 `.diagnostics/comfyui-ui-2026-10-23T01-45-51-050Z/report.json`；不作为成功证据。

Main 最终报告：`.diagnostics/electron/comfyui-main-1792720876139/report.json`，15 loopback POST / 14 upload / 12 view / 2 个新 Main 进程恢复。inpaint lost-ack 恢复、暂存 mask 篡改拒绝、超大有效 PNG 蒙版与 >3200 万像素源图均覆盖；容量拒绝 GET/upload/POST=0。mask 报告 `.diagnostics/creation-mask-1792720538668/report.json`，恢复报告 `.diagnostics/image-recovery-gn9U2K/report.json`。所有网络计数属于 fake/loopback。

最终 UI 报告：`.diagnostics/comfyui-ui-2026-10-23T02-24-45-665Z/report.json`。884×640 下源图/蒙版/映射向导实际可达并审阅截图；inpaint 131,072保护像素逐像素不变、130,396修改像素改变，cutout 131,072透明与131,072不透明像素；原图和蒙版hash不变。不透明结果被Main以`IMAGE_EDIT_ALPHA_INVALID`拒绝、journal无成果；外部命令也明确失败，unknown/queued不再报告完成。参考合并完整三元修复的身份39/选择16/容器17通过。早期UI失败报告保留，最终轮次才作为成功证据。

## 交付与未验证边界

本阶段 production EXE：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，110,071,808 B，SHA-256 `ad710dc70bbc372a4050f07c5aa1921592caffaf14899af88ffe877c70d72f1d`。715源文件冻结hash `3849d39ed36c290d640b17fb88fbc3b39b80c1860b9b71a3275eb3d47bbb31a0`；132dist/191owner逐字节核对，ASAR 53,254,636 B / `30102c95d0373766fd15a3eb961a2a88032317120afac8298edac5f1812f67bf`。品牌`/S`原位升级exit0/17,038ms，原注册目录、版本、配置与快捷方式保留，已安装EXE/ASAR与候选包匹配。专项两次正常退出0、安装前全部同名实例0。

Bundle仅CSS292,621>270,000 B失败，initial JS4,310/plugin86,613 B在限内，无AIDebug泄漏；按本地开发包规则记录，不是正式Release。未上传EXE、tag或Release。证据`.diagnostics/comfyui-workflows-delivery/package.log`、`frozen-source.json`、`package-audit.json`、`install.json`、`bundle.log`；39个本阶段文件提交`5697000fa5f0fcec30c797595b6ba049af76e678`并普通push origin/main，远端实查与本地一致；最终收尾身份见本地delivery索引。

真实 LAN/remote ComfyUI、真实模型请求、权重下载与依赖安装均未执行。审核核心节点的实际安装版本、真实模型的质量/耗时/显存、人工系统文件选择器操作仍无本阶段实测；本阶段没有扩展该授权。
