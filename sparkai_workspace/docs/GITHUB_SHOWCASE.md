# GitHub 产品展示

这里放的是 SparkAI WorkSpace 的实际作品、软件截图和一个完整例子。9 张作品来自 2026-10-18 的展示项目，每次请求只生成 1 张，保存后再做下一张。本页复用已验证的图片，没有重新发起模型请求，也没有使用占位图或测试报告截图。

公开下载是 [v1.0.9 Release](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9)。下面的界面来自 `main` 分支的本地安装版本，应用版本号仍是 `1.0.9`。它和公开下载的 v1.0.9 不是同一个构建，项目知识、成果检索和后续模板改进目前还没有进入公开 Release。

## 先看界面

![真实九图项目、来源关系与 Agent 时间线](./assets/github/hero-canvas.webp)

这张图展示了一个包含 9 张作品的项目：画布上能看到各张图片、Agent 历史记录，以及第 02 张和第 03 张音箱图之间的来源连线。右侧边缘还留着一个历史宣传图容器；下面的作品图都使用没有本地文字覆盖的原图。

截图来自真实 Electron 页面，只做了 WebP 转换，没有拼接界面或覆盖图片。7 张图已经逐张检查，里面没有 API Key、Cookie、Token、License、签名 URL、本机路径、私人项目或完整请求体；尺寸、来源和 SHA-256 见[截图清单](#截图清单)。

## 一个实际例子

### 选中商品图，换一个场景

在画布中选中第 02 张音箱，说明哪些细节必须保留。下面是实际编辑要求的简写：

```text
保留焦橙音箱外形、织物网罩、顶部黄铜旋钮和皮革提带，保持原来的产品视角。
把台座与背景改为清晨海岸的玄武岩、海浪和日出，保留自然接触阴影。
输出 1 张 1:1 图片，无文字、品牌或水印。
```

![真实商品编辑结果与 B 到 C 的来源关系](./assets/github/real-product-edit.webp)

这张图里，左边是第 02 张母图，右边是海岸场景的结果；时间线记录了生成和保存。两张图都是之前完成的请求，截图时没有再次生成。

<details>
<summary>查看母图被选中和 Agent 时间线的完整界面</summary>

![真实商品母图在画布中被选中](./assets/github/real-product-base.webp)

第 02 张母图被选中，Agent 会以它作为当前图片上下文；时间线是对应的商品图会话。

![真实九图成果与商品生成的 Agent 时间线](./assets/github/real-agent-canvas.webp)

9 张图片都留在同一张画布里，Agent 时间线记录了第 02 张图的生成、读取和保存过程。这里的完成状态只说明操作已经记录下来，作品仍需要使用者自己检查。

</details>

### 把常用要求存起来

![真实商品图连接到尚未执行的可复用需求](./assets/github/real-requirement-template.webp)

在一个单独的公开示例项目里导入第 02、03 张图，再保存一条“商品换背景 · 可复用需求”。母图连接到这条需求，需求里写着要保留外形、换成早餐桌面并输出 1 张；界面显示它还没有执行，旁边的海岸图是已有的第 03 张作品。详细操作见[编辑与复用教程](./tutorials/02-edit-and-reuse-results.md)。

### 并排看两个结果

![真实商品母图和海岸场景的评审界面](./assets/github/real-result-comparison.webp)

在同一个项目里并排查看海岸结果和棚拍母图。两张图都来自已有作品，截图时没有再次生成。

### 按关键词找回成果（开发版）

![真实九图项目按音箱关键词检索历史成果](./assets/github/real-knowledge-search.webp)

在项目知识与成果检索里输入“音箱”，可以找到母图和海岸结果。这里的匹配依据是图片名称和创作要求；页面保留“尚未观察”状态，也不会把文字检索说成新的视觉识别结果。检索本身不会调用图片模型。

## 图片作品

下面 9 个文件直接复制自 `artifacts/showcase-2026-10-18/originals/`，与原 `manifest.json` 中的 SHA-256 一致。它们都由 `grok-imagine-image-2.0` 生成，原始文件为 1024 × 1024 JPEG。标题、说明和提示词写在 Markdown 里，没有把旧宣传图里的文字一起带过来。生成记录见[九图展示记录](./AI_NATIVE_SHOWCASE_2026-10-18.md)。

### 01 · 创意视觉

![琥珀玻璃蝴蝶与翅内森林瀑布](./assets/github/01-imagination.jpg)

独立生成的创意视觉：透明琥珀翅面、微型森林和水面倒影。

- 模型：`grok-imagine-image-2.0`
- 原始尺寸/格式：1024 × 1024，JPEG
- SHA-256：`6963ff501c791fed1360107ef627de8c476f59d621ba4b10ab4aaab6bc08c692`

### 02 · 商品摄影

![焦橙音箱与深蓝微水泥台座](./assets/github/02-product.jpg)

独立生成的商品母图，用于后续编辑和换场景。

- 模型：`grok-imagine-image-2.0`
- 原始尺寸/格式：1024 × 1024，JPEG
- SHA-256：`6add9fb90a68c6c27b22b8996194216cdfe62e885cd200db6c159ec8a5d83956`

### 03 · 商品换背景

![焦橙音箱与清晨海岸玄武岩](./assets/github/03-reference-edit.jpg)

以第 02 张音箱作为 SOURCE 编辑，要求保持产品设计并换成清晨海岸背景；项目中保留 `B → C` 的来源关系。

- 模型：`grok-imagine-image-2.0`
- 原始尺寸/格式：1024 × 1024，JPEG
- SHA-256：`a584c7ee0a229ddbd5de0a7a5fae9613ea6e47a01a9fcdcf3dab73f0e2bb4708`

### 04 · 人像摄影

![高端时尚杂志人像](./assets/github/04-portrait.jpg)

独立生成的人像摄影示例。

- 模型：`grok-imagine-image-2.0`
- 原始尺寸/格式：1024 × 1024，JPEG
- SHA-256：`1ab7f5c9e203ff16a8b28b2203264737bed148758e72a9ad4c4b85c4042d1d35`

### 05 · 空间设计

![现代建筑空间](./assets/github/05-space.jpg)

独立生成的空间与建筑摄影示例。

- 模型：`grok-imagine-image-2.0`
- 原始尺寸/格式：1024 × 1024，JPEG
- SHA-256：`77dc86f7156e75b0e142a87348830ffeba983abf512d58cd95e4c623d55b8608`

### 06 · 饮品摄影

![高品质商业饮品摄影](./assets/github/06-food.jpg)

独立生成的饮品商业摄影示例。

- 模型：`grok-imagine-image-2.0`
- 原始尺寸/格式：1024 × 1024，JPEG
- SHA-256：`6a85b0d2a8409a105f242345ebac0e2f5039d59537d40a03d63c947bf9cd5621`

### 07 · 角色设计

![小熊猫星空探险家](./assets/github/07-character.jpg)

独立生成的角色设计示例。

- 模型：`grok-imagine-image-2.0`
- 原始尺寸/格式：1024 × 1024，JPEG
- SHA-256：`21aac1fb01bc843dcf5cc00d68afeb72c8f6184e628a777e4cb55628bc82aea2`

### 08 · 东方山水

![雾山半月与朱红灯舟](./assets/github/08-oriental.jpg)

独立生成的东方山水意境示例。

- 模型：`grok-imagine-image-2.0`
- 原始尺寸/格式：1024 × 1024，JPEG
- SHA-256：`a34b5afd465f94e0dd234dd7b0c73d851d0b89f7b69cfd910b0a1ffa92cfcc95`

### 09 · 超现实场景

![沙漠中的石拱门与门内发光森林小径](./assets/github/09-surreal.jpg)

独立生成的超现实场景示例。

- 模型：`grok-imagine-image-2.0`
- 原始尺寸/格式：1024 × 1024，JPEG
- SHA-256：`15624fa88684a34bb5765cf82be90966df5c349f31f2937406c5a0a8088d811e`

## 想自己试试

1. 先看[教程 01：第一次让 Agent 完成一张图](./tutorials/01-first-agent-image.md)，了解如何导入图片、设置原图/参考图并保存结果。
2. 再看[教程 02：编辑、批量、多款与可复用需求](./tutorials/02-edit-and-reuse-results.md)，了解如何继续编辑和保留来源关系。
3. 需要自动化时，使用[CLI/MCP 教程](./tutorials/03-automation-cli.md)。
4. 想看完整记录，可读[真实 AI Native 九图展示记录](./AI_NATIVE_SHOWCASE_2026-10-18.md)，里面有模型、尺寸、保存状态和 `B → C` 来源证据。

## 截图清单

下面 7 张图均于 2026-10-21 从真实 Electron 开发构建截取，尺寸为 **1584 × 992 WebP**。截图本身不是模型生成的；画布里的作品都来自上面的 `grok-imagine-image-2.0` 图片。前 4 张和检索截图来自九图项目，需求与比较截图来自只导入第 02、03 张作品的公开示例项目。

| 文件 | 来源视角 | SHA-256 |
| --- | --- | --- |
| `hero-canvas.webp` | 九图项目与真实 Agent 历史 | `76e96646a49f6213b8f3bda559cfadaf2bf7a4ba501726631f72f89656eed47f` |
| `real-product-base.webp` | 第 02 张母图选中与对应会话 | `671ac24e6063fc04f8f6c399787cb18c7a6dad279602df5e90c5523315d2bcd5` |
| `real-product-edit.webp` | 第 03 张编辑结果与 B → C 来源 | `f911f0385bc205ed3ee13e16b23efe160a211307d5d1712142b8b69175603bf7` |
| `real-agent-canvas.webp` | 九图画布与第 02 张真实工具时间线 | `c4fafd4c42d90d1882c74f041f5882520797845d86e2e3228648cec7bd2c8d26` |
| `real-requirement-template.webp` | 真实母图连接尚未执行的需求 | `014a749276c6f7bd2eec9f66878cd6c372dd2566c54b6b9ac2aa62a88991fb39` |
| `real-result-comparison.webp` | 两张真实音箱成果的评审界面 | `43a95f63c969726d05997d8333ea3320f5922227d2e58e54159b8b4392097279` |
| `real-knowledge-search.webp` | “音箱”关键词与两项历史成果 | `17aa8efd87dd88d7ed3031bc5c4e2911fa3cb77e3abcc1dde1bdc678d75f8b0e` |

## 版本和费用

软件本身不收取使用费，模型费用由上游服务商决定。这里展示的是一组已经完成的图片操作，不代表所有模型、New API/Sub2API 站点或视频/Seedance 能力都经过验证。公开下载以 [GitHub v1.0.9 Release](https://github.com/naMeaning/SparkAI-WorkSpace/releases/tag/v1.0.9) 为准，`main` 分支的新功能不会自动出现在这个 Release 里。

发布前请执行[隐私与发布前检查](./PRIVACY_AND_PUBLISHING.md)。本页不包含 API Key、Cookie、Token、License、签名 URL、客户资料或本机绝对路径。
