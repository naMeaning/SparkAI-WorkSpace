# 第三方参考项目与许可证

SparkAI WorkSpace 在接口兼容、图片任务合同和无限画布交互设计上参考过下列开源项目。这里列出实际查阅过的固定源码版本和许可证，方便使用者和贡献者追溯来源。

这些项目是研究与设计参考，不是 SparkAI WorkSpace 的运行时依赖。除仓库中已有的历史 New API 目录及其自带许可证文件外，本文列出的项目源码、示例图片和品牌资源没有被打包进桌面客户端。桌面端仍通过受控的 API/IPC 边界连接用户自己的服务。

## 参考清单

| 项目 | 固定参考版本 | 许可证 | 在本项目中的参考范围 |
| --- | --- | --- | --- |
| [New API](https://github.com/QuantumNous/new-api/tree/973cf8ef4600947a4270e95ada7916740fa8264c) | `973cf8ef4600947a4270e95ada7916740fa8264c` | [AGPL-3.0](https://github.com/QuantumNous/new-api/blob/973cf8ef4600947a4270e95ada7916740fa8264c/LICENSE) | 账号、模型目录、图片接口和日志接口的兼容合同核对。 |
| [Sub2API](https://github.com/Wei-Shaw/sub2api/tree/b8dece9000c68815a5b867ca5a1e6f236e173905) | `b8dece9000c68815a5b867ca5a1e6f236e173905` | [LGPL-3.0](https://github.com/Wei-Shaw/sub2api/blob/b8dece9000c68815a5b867ca5a1e6f236e173905/LICENSE) | 同步/异步 Images 路由、任务创建和轮询合同核对。 |
| [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground/tree/cdc171df465b414cba616f7c1d2fd482e11239bf) | `cdc171df465b414cba616f7c1d2fd482e11239bf` | [MIT](https://github.com/CookSleep/gpt_image_playground/blob/cdc171df465b414cba616f7c1d2fd482e11239bf/LICENSE) | OpenAI Images / Sub2API 的提交、编辑、轮询和 multipart 输入结构核对。 |
| [Infinite Canvas](https://github.com/basketikun/infinite-canvas/tree/3a6b64b602ad062b29fac66902ed18a7ef5fd9dc) | `3a6b64b602ad062b29fac66902ed18a7ef5fd9dc` | [MIT](https://github.com/basketikun/infinite-canvas/blob/3a6b64b602ad062b29fac66902ed18a7ef5fd9dc/LICENSE) | 工具分组、点击区域、近实色快捷条和固定屏幕字号等画布交互方向。 |

许可证名称和链接对应上述固定版本的 GitHub `LICENSE` 文件。上游项目的版权仍归各自贡献者所有；本页不改变任何上游许可证，也不表示 SparkAI WorkSpace 与这些项目存在官方隶属或联合发布关系。

## 代码与兼容边界

- New API 和 Sub2API 是用户可以独立部署、升级的服务端项目。SparkAI WorkSpace 只实现客户端兼容层；账号、渠道、额度、计费和服务端管理仍由用户自己的服务负责。
- `sparkai-extension/services/ai-gateway/new-api/` 是扩展仓库中的历史清理输入，不是桌面客户端的运行时依赖。该目录保留上游许可证文件；对它的后续清理或部署不属于桌面客户端发布范围。
- GPT Image Playground 和 Infinite Canvas 的参考只约束合同核对或交互取舍。SparkAI WorkSpace 没有把它们的应用状态、节点体系或界面代码作为第二套产品引入。
- 如果未来把上游源文件、示例或资源实际纳入发布包，必须在同一变更中保留对应许可证和版权声明，并重新审计发布资产。

## 相关记录

- [上游图片与账户接口核对](./UPSTREAM_ACCOUNT_IMAGE_CONTRACT_2026-10-07.md)：记录固定 commit、文件位置和接口合同。
- [画布可读性计划](./CANVAS_READABILITY_PLAN_2026-10-14.md)：记录 Infinite Canvas 的交互参考范围。
- [隐私与发布前检查](./PRIVACY_AND_PUBLISHING.md)：发布前排除凭据、用户数据和诊断文件。
