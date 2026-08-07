# Harness Reference

Use this folder when a task needs more than the local implementation details. It is deliberately small: it captures the repeated decisions from the Nimage conversations and turns them into a working agreement for future Codex sessions.

| Need | Read |
| --- | --- |
| Determine which historical preferences remain active | [CONVERSATION_DECISIONS.md](CONVERSATION_DECISIONS.md) |
| Start, steer, pause or hand off a task | [TASK_PROTOCOL.md](TASK_PROTOCOL.md) |
| Choose appropriate verification | [VERIFICATION_MATRIX.md](VERIFICATION_MATRIX.md) |
| Record a durable scope and acceptance contract | [TASK_BRIEF_TEMPLATE.md](TASK_BRIEF_TEMPLATE.md) |
| Decide whether completion is proven | [COMPLETION_AUDIT.md](COMPLETION_AUDIT.md) |

The harness is validated with `node scripts/verify-harness.mjs` from the workspace root. It is a process integrity check, not a replacement for product tests.
