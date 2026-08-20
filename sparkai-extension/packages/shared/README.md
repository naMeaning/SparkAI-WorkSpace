# Shared

`@ai-native/shared` 是跨包共享工具包。

## 当前内容

当前只提供一个最小运行时 helper：

```js
createServiceStatus(service, ok)
```

它返回统一形态的服务状态对象：

```js
{
  ok: true,
  service: "crm-api",
  checkedAt: "2026-06-25T00:00:00.000Z"
}
```

## 使用场景

- 放置不属于某个具体 app/service 的通用运行时工具。
- 避免在多个包之间复制基础 helper。
- 不放业务 DTO，CRM 相关契约放到 `@ai-native/crm-contracts`。

## 脚本

当前没有包内脚本。需要校验时由引用方或根 `pnpm run check` 覆盖。
