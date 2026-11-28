# 品牌定名 Sparkvas

2026-11-16，用户确认产品品牌为 **Sparkvas**：由 `Spark + Canvas` 连写而成，保留火花与画布的双重意象。该决定覆盖此前“不保留 Spark 家族关联”的约束；`SparkCanvas` 因已有 `sparkcanvas.cn` 产品及已注册域名而不采用，`SparkCanva` 因与 Canva 商标过近而不采用。对外品牌、EXE、安装器、仓库、文档、CLI/MCP 展示名与更新源随本次改名切换；技术侧采用一次迁移与一个版本的旧名别名，避免升级丢失项目、设置和凭据。域名优先尝试 `sparkvas.com`，退路为 `sparkvas.studio`。

**Status**: accepted（品牌命名决定，不是改名交付记录）。品牌技术身份迁移不在 [11 月 20 日首版范围](../SPARKVAS_WORKFLOW_FIRST_REFACTOR_2026-11-20.md)内。

**Consequences**:
- 需要维护旧名到 Sparkvas 的迁移映射、兼容别名和下架/回滚说明。
- 持久化 schema 的内部键不为品牌好看而重命名；只改用户可见身份与必要的顶层路径。
- 商标第 9/42 类、域名和搜索冲突仍需正式复核；本 ADR 只记录产品命名决定，不构成法律结论。
