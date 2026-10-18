# 真实 AI Native 九图展示与 CLI 完善

用户要求在真实 SparkAI WorkSpace 中使用现有生图配置，制作供朋友圈和 GitHub 使用的九张展示图，以作品和宣传为主，辅以简短教学。用户明确排除 Computer Use，并授权补齐必要的 AI Native CLI 缺口。

## 原生控制改动

- `project.create` 增加可选 `parentDirectory`，接收显式已存在的绝对父目录。Main 校验并新建唯一命名的子目录，保留已有同名文件/项目；省略参数继续打开 GUI 原生选择器。
- Renderer 不再把取消目录选择当作创建成功；忙碌、非法目录及写入失败通过 CLI 报错。
- PowerShell CLI 明确输出无 BOM UTF-8，修复 Node/MCP 解析中文名称、路径和错误时因 Windows GBK 代码页造成的乱码。
- GUI、preload 类型、Main IPC、共享命令 schema、自动生成 registry、CLI 参考和 MCP schema 保持同源；没有增加独立生图实现。

## 实际验证

- `test:project-root-policy`：27 项通过，包含无对话框创建、7 类非法父目录、同名不覆盖和原文件保留。
- `test:automation-service`：通过，包括真实 PowerShell 子进程中文/emoji JSON 往返、父目录透传、失败传播、取消状态。
- `typecheck`、production build、包内 122 个 dist 文件/139 个 owner 与生产元数据逐字节核对通过。
- 安装版原生 CLI：拒绝相对目录，保持原项目 8 节点不变；指定绝对目录成功创建空白展示项目，`canvas.state` 实查 ID 和状态。证据位于本地 `artifacts/showcase-2026-10-18/evidence/native-create.json`。
- 九张均通过 `agent.chat → image_gen` 使用真实 `grok-imagine-image-2.0` 生成；原图均为 JPEG 1024×1024，逐张视觉检查通过。9 个 image operation 全部 saved，各 1 张；未重发创建，不包含视频请求。
- 第03张实际使用第02张音箱作为 SOURCE 编辑，保留外壳、织物、旋钮和提带，更换为海边背景；项目持久化 `C.parentId=B / derived-from` 与 SOURCE provenance。其他八张为独立生成。
- 九张本地宣传排版 JPG 1440×1440、九张 GitHub WebP 960×960，18 张原图/宣传图均完整解码、逐文件 hash/尺寸核对；9 处 README 图片链接有效。已检查最终九宫格，缩短第08张标题以保留船只。原图没有被排版版本覆盖。
- 通过原生 CLI 将原图排为3×3，并把宣传图导入同项目一个图片组；实际保存为10节点/18图片，9个生成operation均saved。正常关闭退出成功，无强杀。
- 最终安装后重启原生读取通过：同项目10节点/18图片、9operation全部saved、Agent idle，B→C来源关系保留；没有再次发送生成请求。

## 素材与制品

素材工作目录为本地 `artifacts/showcase-2026-10-18/`；真实项目也在该目录的 `projects/` 中。原图保留真实编码，分享图另外本地排版，模型生成与后期文字明确区分。`brief.json` 保存九图提示词与文案，`manifest.json` 保存实际模型/参数、原图尺寸与 SHA-256。原生请求不重复提交不明确创建；不调用视频模型。

最终开发安装器：`release/SparkAI-WorkSpace-Unrestricted-Setup-1.0.9-x64.exe`，109,867,520 B，SHA-256 `f129ae192aec54a72de1feeeb4941814d1eb2907d509915f0db61312bc6589c5`。ASAR 52,108,695 B / `18f7bd4d1497ab22ffe0ade3bfc5556549644f6d2f2858819cef0291fb578180`。生成与导入完成并正常退出后，品牌 `/S` 原位安装 exit0 / 17,374ms；注册目录、配置保留，已安装EXE/ASAR与最终制品一致。证据集中于本地 `.diagnostics/native-showcase-delivery-2026-10-18/`。

可分享的 `artifacts/showcase-2026-10-18/SparkAI-九图展示包.zip` 为 9,907,688 B，SHA-256 `530ebf2089b5d098a2dc26f360af5370b3c3f28c042cea97dbf548489a4d7647`，只包含原图、分享图、GitHub素材、预览、提示词与发布说明，不包含项目内部记录、自动化连接或凭据。

朋友圈/GitHub 素材尚未发布；本次不是正式 Release。源码与文档的普通push结果见 Progress；生成素材与 EXE 按原规则忽略，不随源码提交。

源码/测试/文档17文件已提交 `e664f992bbf5e878ea69c60b0a1f1ce239b207e1` 并推送origin/main；实查远端、HEAD和upstream一致。本完成记录随后以纯文档提交收尾，最终实查Git身份保存在本地交付索引。
