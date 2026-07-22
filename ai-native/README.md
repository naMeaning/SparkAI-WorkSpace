# AI Native

AI Native 现在收敛为一个产品入口：`IIIMAGE STUDIO`。

- 后端整体入口：`services/ai-gateway`
- 内嵌模型网关：`services/ai-gateway/new-api`
- 内部 CRM 业务服务：`services/crm-api`
- 唯一前端 GUI：`services/ai-gateway/new-api/web/default`

`new-api` 和 CRM 不再作为两个对外系统交付。开发和本地运行统一通过根目录 `pnpm run dev` / `pnpm run start` 启动。本地开发看页面访问 `http://127.0.0.1:17862`，该地址由前端 dev server 提供热更新并代理到 New API gateway。

## 目录结构

```text
services/
  ai-gateway/         统一后端入口；构建并启动内嵌 New API
    new-api/          Go 后端和 IIIMAGE STUDIO 前端源码
  crm-api/            内部 CRM 分销服务，由 gateway/new-api 代理调用

packages/
  shared/             共享运行时工具
  crm-contracts/      CRM 共享 TypeScript DTO 和模块契约

scripts/              跨平台 workspace 编排脚本
docs/                 设计说明、实施计划和协作文档
```

CRM 分销页面合并在 `IIIMAGE STUDIO` 内，通过 `/crm/*` 由 New API 登录态进入。

## 包说明

| 包 | 类型 | 说明 |
| --- | --- | --- |
| [`@ai-native/ai-gateway`](services/ai-gateway/README.md) | service | 统一后端入口，负责构建和启动内嵌 New API。 |
| [`@ai-native/crm-api`](services/crm-api/README.md) | internal service | CRM 分销业务服务，作为统一后端内部组件运行。 |
| [`@ai-native/shared`](packages/shared/README.md) | package | 跨包共享工具。 |
| [`@ai-native/crm-contracts`](packages/crm-contracts/README.md) | package | CRM 共享契约。 |

## 前置依赖

- Node.js
- pnpm，版本以根目录 `package.json` 的 `packageManager` 为准
- Bun，用于构建 New API 前端
- Go，用于构建 New API 后端

环境变量样例见 `services/ai-gateway/.env.example` 和 `services/crm-api/.env.example`。
`image.aieyra.cn` 的容器、Caddy、客户端下载与主机加固配置统一放在
[`deploy/production`](deploy/production/README.md)，真实密钥和安装包只放在该目录下被忽略的
`runtime/` 中。

## 首次运行

```bash
pnpm install
pnpm run start
```

本地统一栈默认使用 CRM 内存模式，适合快速调 UI。使用持久化 CRM MySQL 时先迁移数据库，再用
`CRM_DEV_STORAGE=mysql` 启动：

```bash
CRM_DATABASE_URL=mysql://root@127.0.0.1:3306/ai_native_crm \
CRM_DATABASE_NAME=ai_native_crm \
pnpm --filter @ai-native/crm-api migrate

CRM_DEV_STORAGE=mysql pnpm run dev
```

本地默认端口：

| 服务 | 地址 |
| --- | --- |
| IIIMAGE STUDIO 前端开发入口 | `http://127.0.0.1:17862` |
| New API gateway / 嵌入式产物入口 | `http://127.0.0.1:17860` |
| 内部 CRM API | `http://127.0.0.1:17861` |

`17862` 只用于本地前端热更新；`17860` 是 New API gateway 和生产嵌入式产物入口；`17861` 是开发态内部服务端口。

## 根脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm run dev` | 启动统一主栈，等同于 `dev:main`。 |
| `pnpm run dev:main` | 同时启动 New API gateway、内部 CRM API 和前端热更新服务。 |
| `pnpm run start` | 启动统一主栈，不隐式安装依赖。 |
| `pnpm run build` | 构建统一产品，等同于 `build:main`。 |
| `pnpm run build:main` | 构建 gateway/New API 后端和 IIIMAGE STUDIO 前端产物。 |
| `pnpm run check` | 执行 workspace 校验、CRM 契约检查、CRM API 检查和 gateway smoke。 |
| `pnpm run verify:workspace` | 校验统一仓库结构、包名和关键脚本边界。 |
| `pnpm run dev:gateway` | 只启动 gateway/New API，用于定位网关问题。 |
| `pnpm run build:gateway` | 构建内嵌 New API 产物。 |
| `pnpm run smoke:gateway` | 检查 gateway 服务入口和 New API 产物状态。 |
| `pnpm run diagnostics:gateway` | 运行 gateway 诊断。 |
| `pnpm run crm:check` | 单独检查内部 CRM API。 |

## 开发约定

- 只有 `services/ai-gateway` 是对外后端入口。
- `services/crm-api` 是统一后端的内部业务组件。
- 唯一 GUI 是 `services/ai-gateway/new-api/web/default`。
- 账号、登录态、角色、quota、模型计费和用量日志以 `new-api` 为源头；统一 GUI 可按需调用 New API 和 CRM 接口，CRM 只扩展分销、账本、风控和运营审核。
- 依赖安装使用 `pnpm install`，构建使用 `pnpm run build`，启动使用 `pnpm run start`。
- 运行时配置、数据库、日志、诊断输出和构建产物不提交。
- CRM 和 monorepo 最终业务口径以 [`docs/new-api-centered-crm-monorepo-governance.md`](docs/new-api-centered-crm-monorepo-governance.md) 为准。

## 验证

常规改动完成后执行：

```bash
pnpm run check
```

只检查仓库结构时执行：

```bash
pnpm run verify:workspace
```
