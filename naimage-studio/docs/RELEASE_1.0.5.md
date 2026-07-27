# naimage 1.0.5 发布说明

版本日期：2026-07-24

1.0.5 是产品从旧品牌和旧网络身份强制迁移到 naimage/SparkAI 的升级基线。该版本统一安装身份、可执行文件、项目格式、资源协议、更新清单和 Session Relay 路由，为后续 1.0.6 的双接入与授权能力建立稳定边界。

## 本次更新

- 产品名、应用 ID、可执行文件、安装器、快捷方式、项目格式、资源协议和公开路由统一为 naimage。
- 默认服务品牌切换为 SparkAI，账号、Relay 和更新服务默认指向 `https://sparkapi.org`。
- 更新发布清单 product 固定为 `naimage-studio`，下载入口固定为 `/downloads/naimage-studio/windows`，模型 Relay 固定为 `/naimage/v1/*`。
- 更名前 1.0.4 客户端必须通过 1.0.5 完整安装器完成应用身份、快捷方式和卸载身份迁移；后续版本可使用签名 Restart 更新。
- 旧 AIEYRA 更新地址强制迁移到 SparkAPI；用户明确配置的其他合法更新地址仍保留。
- 更新签名密钥完成轮换；客户端只内置 Ed25519 公钥，私钥不进入安装包、GitHub Actions 日志或仓库公开内容。
- 加入 New API 风格调色盘主题、黄色 naimage 图标和 SparkAI 跨境电商安装器文案。

## 发布与升级边界

- canonical 安装包：`naimage-Setup-1.0.5-x64.exe`。
- canonical manifest product：`naimage-studio`。
- canonical 应用 ID：`org.sparkai.naimage`。
- 1.0.5 是当前更新 compatibility 的最低基线；更早版本不能直接复用 1.0.5 之后的 Restart ASAR。
- GitHub 私有仓库凭据不内置在客户端，在线更新由受控 SparkAPI 下载与清单服务提供。

历史制品的实际哈希与签名以对应 tag、发布清单和 sidecar 为准。后续版本不得恢复旧公开路由或旧品牌身份；旧项目/设置只允许作为本地迁移输入读取。
