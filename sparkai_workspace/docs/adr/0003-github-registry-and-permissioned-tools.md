# GitHub Registry 与受权限控制的 Tool 分发

2026-11-16，用户确认工作流/插件市场采用 GitHub topic 发现、服务端校验、curated Registry 和客户端安装的链路。Skill、Recipe、Tool 使用不同 topic 和 manifest；客户端不直接从全网 GitHub 搜索或执行包。Skill 为声明式内容，可以在兼容范围内自动安装；Tool 必须声明网络、文件、进程、模型和外部服务权限，并在安装与首次运行前由用户显式授权。所有内容本期免费，保留版本 hash、许可证、兼容版本、下架、回滚和举报记录。

**Status**: accepted（长期分发方案）。Registry、Marketplace 与第三方步骤分发不在 [11 月 20 日首版范围](../SPARKVAS_WORKFLOW_FIRST_REFACTOR_2026-11-20.md)内。

**Considered Options**:
- 直接允许用户粘贴任意 Git URL：发现快，但来源、版本、恶意代码和回滚无法形成产品级信任。
- 只做内置官方包：安全边界简单，但无法形成第三方配方网络，也无法验证平台生态假设。

**Consequences**:
- 需要新增 Registry、manifest、安装 journal、权限审核和版本回滚 owner；不能把 GitHub URL 直接交给 Renderer 或 Agent 执行。
- Tool 的权限模型成为公开产品合同，后续扩展必须保持兼容、可解释和可撤销。
- Marketplace 的内容数量不等于质量；官方样例、作者信誉、版本兼容和真实运行证据必须成为排序信号。
