# 画布优先的 AI-native 工作流创作

2026-11-16，用户确认产品从“明确不是工作流编辑器”转向“画布优先、支持用户编辑的 AI-native 工作流编辑器”。画布仍是主界面，承载成果、需求节点与溯源；Studio 是第二创作面，用于查看、编辑和运行 Recipe，产物回到画布。AI 是 Recipe 的第一作者，能起草、修改、解释、修复并运行 Recipe，人类保留审阅、锁定、接管和授权。Recipe 由声明式 Skill 与可执行 Tool 组成；Skill 不执行任意代码，Tool 安装与执行需要显式权限。这样既保留现有项目、Agent、任务恢复和 provenance 的积累，又避免把产品降级为 ComfyUI 式底层节点图。

**Status**: accepted

**Consequences**:
- 现行 `AGENTS.md` 与 `PRODUCT_INTENT.md` 中“不得恢复工作流编辑器/计划节点/工具节点”的边界需要被本次决策显式替代，而不是静默绕过。
- Studio 必须与画布共享 Project、Selection、TaskScope、资产、会话和 provenance，不能形成第二套项目状态。
- 语义节点优先于底层模型节点；AI 生成的工作流必须可审阅、可锁定、可修复，不能成为不可解释的黑盒。
- Marketplace 本期只分发免费 Skill/Recipe；可执行 Tool 的信任、权限和沙箱边界另行决策。
