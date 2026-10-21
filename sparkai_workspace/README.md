# SparkAI WorkSpace

SparkAI WorkSpace 是 Windows 桌面端的 Agent 生图工作台：把图片素材、自然语言任务、生成结果和来源关系放在同一个项目画布里，适合反复创作、编辑、比较和复用。

![真实九图项目、图片来源关系与 Agent 时间线](./docs/assets/github/hero-canvas.webp)

> 公开下载是 [GitHub Release v1.0.9](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9)。界面截图来自 `main` 对应的本地开发构建；后续能力尚未进入该公开安装包。

## 先看展示

- [GitHub 产品展示：真实作品、界面截图和使用示例](./docs/GITHUB_SHOWCASE.md)
- [下载 v1.0.9](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9)
- [完整文档索引](./docs/README.md)

## 它解决什么问题

- **一个项目 Agent**：用自然语言说明主体、场景、比例和要保留的内容；选中的图片会成为当前上下文。
- **成果画布**：原图、参考图、图片容器、需求和生成结果留在同一张画布中，来源关系可回看。
- **持续编辑**：继续修改、生成多款、分层、抠图、重绘，结果以新的图片成果保存，原图仍然保留。
- **本地项目管理**：拖入外部文件时应用复制到项目图片库，不改写原文件；会话、素材和导出结果保存在你选择的项目目录。

## 从商品母图到新场景

| 商品母图 | 以母图编辑的海岸场景 |
| --- | --- |
| ![真实模型生成的焦橙音箱商品母图](./docs/assets/github/02-product.jpg) | ![使用同一音箱母图完成的真实换背景结果](./docs/assets/github/03-reference-edit.jpg) |

选中母图，告诉 Agent：“保留音箱外形、网罩、旋钮和提带，只把背景换成清晨海岸，输出 1 张 1:1 图片。”两张作品实际使用 `grok-imagine-image-2.0`，项目保留母图到结果的来源关系。[查看真实截图、九张原作和来源记录](./docs/GITHUB_SHOWCASE.md)。

## 开始使用

1. 从 [v1.0.9 Release](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9) 下载 Windows x64 安装包。
2. 按[接入说明](./docs/NEW_API_DUAL_ACCESS_AND_ACTIVATION.md)配置模型服务。公开 v1.0.9 仍保留旧自定义接入授权流程；免费双接入属于主分支开发版。
3. 新建项目，导入一张图片，标记它是原图或参考图；纯文字生图可跳过导入。
4. 在右侧 Agent 写清楚主体、场景、需要保留的内容和输出数量。
5. 查看时间线、成果和来源关系，再导出或继续编辑。

第一次使用请读[教程 01](./docs/tutorials/01-first-agent-image.md)；需要编辑、批量、多款或可复用需求时读[教程 02](./docs/tutorials/02-edit-and-reuse-results.md)。自动化脚本见[CLI/MCP 教程](./docs/tutorials/03-automation-cli.md)。

## 版本、接入与费用

`package.json` 当前版本为 `1.0.9`，与公开 Release 的版本号一致。主分支的免费双接入、项目知识、成果检索和便携创作模板改进属于开发版能力，是否包含在下载包中以 Release 说明为准。

软件本身免费；模型调用费用由上游服务商决定。图片请求会把提示词、选定图片和参数发送到你配置的服务商，可能按请求、图片或配额计费。主分支通用开发版支持账号登录或你有权使用的 Base URL + API Key；SparkAPI 专用版只支持官方账号登录。任意 New API/Sub2API 站点兼容性、所有模型及视频/Seedance 能力均未得到全面验证。

## 隐私边界

不要把 API Key、Bearer Token、Cookie、License 码、签名 URL、客户资料、私人图片、完整请求体或本机绝对路径提交到公开仓库。发布源码和截图前请看[隐私与发布前检查](./docs/PRIVACY_AND_PUBLISHING.md)。

## 开发者入口

Windows 开发环境需要 Node.js `>=22.12.0`、pnpm `>=10.12.1`：

```powershell
cd sparkai_workspace
corepack pnpm install
corepack pnpm run dev
```

常用检查：

```powershell
corepack pnpm run typecheck
corepack pnpm run build
```

更多教程、发布说明、上下文地图和安装边界见[文档索引](./docs/README.md)；项目参考范围与上游署名见[第三方参考项目与许可证](./docs/THIRD_PARTY_REFERENCES.md)。
