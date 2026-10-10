# 隐私与发布前检查清单

这份清单用于把源码、文档和 GitHub Release 公开给其他人时，避免把本机数据一并上传。它补充 [隐私政策](./legal/PRIVACY_POLICY.md) 和 [正式发布清单](./RELEASE_CHECKLIST.md)，不改变软件的本地保存或第三方服务合同。

## 公开前要分清两类内容

**可以公开的内容**是经过审阅的源码、文档、脱敏示例、公开许可证和同一次正式编排生成的 Release 资产。**只留在本机或受控存储的内容**包括凭据、用户数据、诊断原文、签名私钥、未公开素材和任何带身份信息的日志。

当前工作区已经忽略下列本地目录，但“被忽略”不等于“可以在聊天、截图或压缩包中分享”：

| 路径 | 可能包含的内容 | 处理方式 |
| --- | --- | --- |
| `config/` | 登录会话、加密密钥缓存、账户设置、发布私钥 | 不提交、不打包、不截图。 |
| `.diagnostics/` | 截图、窗口信息、请求阶段、用户路径和本地报告 | 只分享经过审阅的脱敏摘要，优先只说状态和数量。 |
| `output/` | 用户导入副本、生成图片、视频和导出成果 | 只分享明确获授权的样例，并先移除 EXIF/路径信息。 |
| `release/`、`dist/` | 安装包、更新包、manifest 和构建中间物 | 仅从正式报告指定的 canonical 资产发布，不放进源码提交。 |
| `.dev-logs/`、`.release-tools/`、`node_modules/` | 本机日志、工具缓存和依赖产物 | 不上传；发布前删除或留在本地。 |

## 绝对不要公开

- API Key、Bearer Token、账号密码、session Cookie、License 码、管理员 Token 和任何 `.env` 内容。
- `config/release-signing-private.pem`、其他签名私钥、设备绑定信息或内部更新凭据。
- 真实用户的项目目录、完整本机路径、联系人、订单号、客户素材、人物照片、未发布商品和科研原始数据。
- 带签名查询参数的上游 URL、原始网络响应、完整请求体、未脱敏截图和包含 Prompt/响应正文的诊断日志。
- 不是本次正式编排生成的旧 EXE、旧 manifest、临时安装包或本地测试账户报告。

示例中的 `<BASE_URL>`、`<PROJECT_ID>` 和 `example` 图片只是占位符。不要把真实值替换后再提交文档。

## 提交前的最小检查

在 `sparkai_workspace` 目录执行并逐项查看结果：

```powershell
git status --short --branch
git diff --check
git ls-files --others --exclude-standard
git diff --name-only
git diff --stat
```

暂存后再次检查：

```powershell
git diff --cached --name-only
git diff --cached --check
```

只把本次源码和文档加入暂存区。看到 `config/`、`.diagnostics/`、`output/`、`release/`、`.env`、证书/私钥或用户导出目录时，先移出暂存区并检查它为什么出现。不要用 `git add .` 代替逐项审阅。

正式发布还要遵循 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)：文档冻结在构建前完成，Release 只上传同一次 `release:final` 生成并核对过的资产；不能把本地报告、私钥或 incomplete marker 当作发布文件。

## 需要提交诊断时

优先使用应用中的“设置 → 工具 → Diagnostic logs”或自动化命令 `app.diagnostics`，因为它们只返回脱敏事件。分享前仍要人工查看：

1. 截图是否露出窗口标题、用户名、桌面路径、浏览器标签或私人图片。
2. 文本是否含有完整 Prompt、Cookie、Bearer、签名 URL、模型请求体或客户信息。
3. 文件名、时间戳和项目名是否可以反推出真实客户或内部项目。

公开材料只保留“发生了什么、成功/失败数量、可复现的公开步骤和脱敏错误摘要”。不要为了证明成功而上传整份 `.diagnostics` 目录。

## 如果已经误传

立即停止继续传播，在对应服务商处撤销/轮换 Key、Token、Cookie 或 License，并让受影响账户重新登录。随后保留事故时间和影响范围，按仓库的受控 Git 历史清理流程处理；只删除当前文件不能撤回已经进入 Git 历史或 Release 的秘密。怀疑发布包含私钥时，应先停止更新分发并重新建立签名信任，再恢复发布。

隐私政策和用户侧数据说明见 [docs/legal/PRIVACY_POLICY.md](./legal/PRIVACY_POLICY.md)。
