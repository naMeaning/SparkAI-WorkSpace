# 统一 New API 分销中台设计

本文档描述当前产品最终口径：`naimage` 使用 New API 作为账号、资产、计费和模型能力底座；分销中台是同一个产品里的统一前端，不要求用户进入 New API 原后台。

## 核心结论

- 用户只登录 `naimage` 分销中台页面。
- 登录、session、角色、用户资产、模型计费、模型调用和用量日志属于 New API。
- 分销中台前端可以按需调用 New API 接口和 CRM 接口。
- New API 已有的能力直接调用 New API 接口反显或操作，不在 CRM API 中重写。
- CRM API 只提供 New API 没有的分销、运营、结算、风控和审计能力。
- CRM 后端可以在线下充值审核和退款等 CRM 业务流程中调用 New API；注册送额度由 New API 注册配置统一发放，New API 通用管理能力由统一前端直接复用 New API 接口。

## 用户可见产品

用户看到的是一个后台：

```text
naimage
  用户中心
  分销中心
  平台管理
```

用户不需要知道 New API 后台存在，也不进入 New API 原后台页面。

## 前端调用边界

统一前端位于：

```text
services/ai-gateway/new-api/web/default
```

该前端可以调用两类接口：

```text
New API 原生接口
  /api/user/*
  /api/log/*
  /api/token/*
  /api/channel/*
  /api/topup/*
  ...

CRM 分销接口
  /api/crm/*
```

调用原则：

- New API 已有能力走 New API 接口。
- CRM 分销扩展能力走 CRM 接口。
- 一个页面可以同时展示两边的数据。
- 前端不通过 localStorage 标记角色或模拟身份，权限以 New API session 和 CRM `/crm/session/self` 返回为准。

## New API 职责

New API 是以下事实源：

- 用户账号。
- 登录态和 session。
- 角色与权限基础。
- quota / 余额。
- 模型定价。
- 模型调用。
- 用量日志。
- New API 已有充值、扣费、token、渠道、模型和系统配置能力。

平台管理页面中涉及这些能力时，直接复用 New API 接口或组件。

## CRM 职责

CRM 保存 New API 没有的业务扩展数据：

- CRM 影子用户与 `new_api_user_id` 绑定。
- 邀请码。
- 客户归属。
- 代理标签、代理等级和直属上级。
- 首充 8.8 折权益。
- 注册 2 元权益状态兼容；实际额度由 New API 注册配置统一发放。
- 线下充值申请和审核。
- CRM 入账事件。
- 分销账本。
- 佣金冻结、释放、阻断和追回。
- 提现申请和线下打款登记。
- 有效客户候选和复核。
- 大客户月结。
- 风控和审计。

CRM 不保存用户密码，不创建浏览器 session，不提供模型调用网关，不保存模型服务封禁字段，也不为了 UI 展示去复制 New API 的用户资产和用量能力。模型调用限制统一通过 New API 用户状态、权限、渠道、模型和 quota 配置处理。

## 余额和用量

余额展示直接来自 New API。

```text
账户余额 = New API 当前 quota 按产品配置展示
```

用量明细展示直接来自 New API 用量接口。

CRM 只在分销业务需要时消费 New API 用量事实：

- 有效客户判断。
- 分销消耗账本。
- 佣金结算。
- 大客户月结。

这些 CRM 业务记录是分销结算快照，不是 New API 用量日志的替代品。

## 余额变更

平台管理可以保留余额调整能力，但能力归属要分清：

- 普通 New API 用户资产管理：前端调用 New API 管理接口。
- CRM 线下充值审核：前端调用 CRM 审核接口，CRM 调用 New API 加 quota，并写入 CRM 分销账本、佣金和审计。
- 注册试用金：New API 注册流程按 `QuotaForNewUser` 一次性写入 quota；CRM 只保留兼容状态，不再次加 quota。
- CRM 退款：CRM 调用 New API 扣 quota，并写入退款账本、佣金追回和审计。

中台余额调整按业务场景选择入口；New API 始终是余额事实源。

## 数据库可靠性

New API 数据库、CRM 数据库和附件存储都有丢失风险。数据库可靠性属于备份、恢复、监控和对账，不作为拆分或解耦的架构理由。

生产部署必须分别保护：

- New API 数据库或数据目录。
- CRM MySQL 数据库。
- CRM 附件目录。

恢复后应做一致性检查：

- New API 用户和 CRM 影子用户绑定。
- New API quota 与中台展示。
- CRM 入账事件、账本、佣金和提现状态。
- 用量同步水位和有效客户候选。

## 当前边界

当前产品边界用正向职责约束：

- 账号、登录态、角色、用户资产、模型计费和用量日志归 New API。
- 用户只进入 `naimage` 统一中台。
- CRM API 聚焦 New API 没有的分销扩展能力。
- 统一前端按页面需要组合 New API 接口和 CRM 接口。
- 数据库可靠性通过备份、恢复、监控和对账处理。

## 验收口径

- 中台页面保留已敲定能力。
- New API 已有能力由中台前端直接调用 New API。
- CRM API 只保留分销扩展能力和分销业务流程。
- CRM 用量同步只服务分销结算，不服务普通展示。
- 测试只覆盖当前真实存在的接口、业务流程和数据结构。
