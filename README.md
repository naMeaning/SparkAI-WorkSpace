# SparkAI WorkSpace

一个免费的 Windows 图片创作工作台。把素材放进项目，用自然语言告诉 Agent 要生成或修改什么，再在画布上比较、整理和继续编辑。

每个项目都有自己的画布、素材和会话记录，适合做商品图、社媒配图、灵感探索和日常图片编辑。项目数据保存在本地，图片请求会发送到你选择的服务商。

![真实九图项目、图片来源关系与 Agent 时间线](sparkai_workspace/docs/assets/github/hero-canvas.webp)

截图来自 `main` 对应的本地开发构建；公开安装包为 [v1.0.9](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9)，后续开发能力尚未进入该 Release。[查看真实作品、七种界面视角和来源记录](sparkai_workspace/docs/GITHUB_SHOWCASE.md)。

## 接入方式

- **账号登录**：保留现有 SparkAPI / New API 协议登录；更广泛的 New API、Sub2API 站点账号兼容是后续适配方向。
- **Base URL + API Key**：通用版可连接兼容的 New API、Sub2API 或其他 OpenAI-compatible 服务，无需购买 Pro。

软件免费；模型调用费用由你选择的上游服务商收取。SparkAPI 专用版只提供官方账号登录。

> 免费双接入已进入 `main` 和 2026-10-17 本地开发包，尚未更新公开 v1.0.9 安装包。旧包可能仍显示 Pro 提示；本次邀请体验请使用包含该改动的开发包。公开下载和版本变化以 [Releases](https://github.com/naMeaning/SparkAI-WorkSpace/releases) 为准。

## 一个实际例子：同一只音箱，换个场景

| 商品母图 | 以母图编辑的海岸场景 |
| --- | --- |
| ![真实模型生成的焦橙音箱商品母图](sparkai_workspace/docs/assets/github/02-product.jpg) | ![使用同一音箱母图完成的真实换背景结果](sparkai_workspace/docs/assets/github/03-reference-edit.jpg) |

这两张图使用 `grok-imagine-image-2.0` 生成，原始文件都是 1024×1024 JPEG。项目里保留了从母图到编辑结果的来源关系。[更多原作、使用示例与逐图 SHA-256](sparkai_workspace/docs/GITHUB_SHOWCASE.md)。

## 试着做一张图

1. 安装适用版本，完成账号登录或自定义接口配置。
2. 创建项目，导入原图或参考图；文字生图也可以从空白画布开始。
3. 在右侧 Agent 描述主体、变化范围、比例和数量。
4. 检查生成成果，继续编辑或导出。

- [详细介绍与安装入口](sparkai_workspace/README.md)
- [真实作品与界面展示](sparkai_workspace/docs/GITHUB_SHOWCASE.md)
- [第一次让 Agent 完成一张图](sparkai_workspace/docs/tutorials/01-first-agent-image.md)
- [全部教程](sparkai_workspace/docs/tutorials/README.md)
- [账号与自定义接口接入说明](sparkai_workspace/docs/NEW_API_DUAL_ACCESS_AND_ACTIVATION.md)
- [分享给朋友的介绍](sparkai_workspace/docs/PROMOTION_COPY.md)

## 参考与致谢

感谢 [New API](https://github.com/QuantumNous/new-api)（AGPL-3.0）、[Sub2API](https://github.com/Wei-Shaw/sub2api)（LGPL-3.0）、[GPT Image Playground](https://github.com/CookSleep/gpt_image_playground)（MIT）和 [Infinite Canvas](https://github.com/basketikun/infinite-canvas)（MIT）。固定参考版本、许可证链接、参考范围与代码纳入边界见[第三方参考项目与许可证](sparkai_workspace/docs/THIRD_PARTY_REFERENCES.md)。上游版权归各自贡献者所有。

## 开发与反馈

桌面客户端与本地 Agent 在 [sparkai_workspace/](sparkai_workspace/)，可选扩展服务在 [sparkai-extension/](sparkai-extension/)。New API / Sub2API 由使用者独立部署与升级。开发约定见 [AGENTS.md](AGENTS.md)，当前实现和验证范围见 [Progress](sparkai_workspace/PROGRESS.md)。

欢迎通过 [Issues](https://github.com/naMeaning/SparkAI-WorkSpace/issues) 反馈问题。请附上应用版本和复现步骤，移除 API Key、Cookie、私人素材和本机路径。
