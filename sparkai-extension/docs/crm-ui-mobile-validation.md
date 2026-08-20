# CRM UI 与移动端验证

统一前端的 CRM、登录页和控制台共用一套浏览器审计入口：

```powershell
$env:CRM_DEV_SEED='true'
$env:GLOBAL_API_RATE_LIMIT_ENABLE='false' # 仅限本地全量截图审计，生产环境不得关闭
pnpm run dev:main
```

在另一个终端设置仅用于本次进程的本地测试账号，然后执行：

```powershell
$env:CRM_UI_USERNAME='<local-test-user>'
$env:CRM_UI_PASSWORD='<local-test-password>'
pnpm run diagnostics:crm-ui
```

审计会在 `.diagnostics/crm-ui-audit/<timestamp>/` 生成截图和 `report.json`，覆盖：

- 官网首页和登录页；
- 控制台概览、钱包、三类 New API 用量流水、用户与系统设置；
- 登录后的客户端下载验证码弹窗，覆盖触发、弹窗尺寸和移动端操作区；
- CRM 1280px、1440px 桌面端，以及 360px、375px、390px、430px 手机端；
- 根据登录账号角色自动覆盖全部平台管理页面或全部“我的分销”页面；要同时验收两侧时，分别使用本地管理员和本地代理测试账号执行一次；
- CRM 移动侧栏，以及用户、代理、充值审核的安全只读弹窗打开检查；
- 页面横向溢出、可见控件尺寸、Dialog/Drawer 是否超屏和文档尺寸；
- 浏览器运行时错误、加载失败、空状态与路由落点；
- 路由是否命中预期地址，以及 React 根节点和页面正文是否真实渲染，避免把空白页或错误页误判为通过。

文档横向溢出、过小可见控件、超屏弹窗/抽屉或浏览器运行时错误会直接令审计失败，不再只写进报告后依赖人工发现。

可通过环境变量覆盖页面、主题和地址：

- `CRM_UI_SECTIONS`
- `CRM_UI_AUTHENTICATED_PATHS`
- `CRM_UI_COLOR_SCHEME=light|dark`
- `CRM_UI_WEB_URL`
- `CRM_UI_API_URL`
- `CRM_UI_AUDIT_OUTPUT`

测试账号和密码只从进程环境读取，不会写入报告、截图元数据或仓库。诊断产物属于运行时文件，不得提交。
