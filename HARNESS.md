# Nimage Engineering Harness

This is the stable operating layer for Nimage. It converts product conversations into an execution system that survives context compaction, parallel work, handoffs and changing priorities without turning the repository into a pile of one-off instructions.

## The Four Loops

| Loop | Question it answers | Required artifact |
| --- | --- | --- |
| Intent | What outcome does the user actually want now? | Current task brief, `GOAL.md`, decision ledger |
| Boundary | Which process, repository and contract own it? | Repository `AGENTS.md` and context map |
| Evidence | What would prove the outcome rather than merely suggest it? | Targeted test, runtime observation, screenshot, package artifact |
| Memory | What must survive the next session? | Goal/progress update, context-map update, durable decision when needed |

An Agent should complete all four loops before calling a nontrivial task done. The point is not more process; it is preventing known failure modes from the project history: stale conversation assumptions, repeated UI feedback without an executable regression check, over-testing during iteration, and claims of completion based only on code inspection.

## Quick Start

1. Read [AGENTS.md](AGENTS.md) and route the work to `naimage-studio/`, `ai-native/`, or both.
2. Read [harness/CONVERSATION_DECISIONS.md](harness/CONVERSATION_DECISIONS.md) for stable user priorities and superseded directions.
3. Follow [harness/TASK_PROTOCOL.md](harness/TASK_PROTOCOL.md) to classify scope, authorization and completion conditions.
4. Select the proof burden from [harness/VERIFICATION_MATRIX.md](harness/VERIFICATION_MATRIX.md).
5. Use [harness/TASK_BRIEF_TEMPLATE.md](harness/TASK_BRIEF_TEMPLATE.md) for a durable task, then update goal/progress/context only where the change requires it.
6. Run `node scripts/verify-harness.mjs` after changing this harness.

## Intent Is Not Fact

User statements define desired behavior. Existing source, schemas, generated artifacts and tested runtime behavior establish current fact. Assistant prose may explain a design, but it is not an authority for either completion or safety.

When user intent conflicts with a historical document, preserve the conflict long enough to resolve it explicitly: update the goal/decision ledger, mark the previous direction superseded, and then change code. Never silently restore an old feature because an outdated test or assistant message mentions it.

## Task State

For any task that spans a session, touches a public contract, changes product direction, or may need a handoff, record these six fields before deep implementation:

```text
Mode: discussion | diagnose | implement | goal | build | release
Outcome: observable user result
Scope: owner modules and contracts
Non-goals: explicitly excluded behavior
Acceptance: proof that makes the task complete
Authorization: paid/network/destructive/release permissions, if any
```

For a small localized fix, these fields can live in the working conversation. For durable work, copy the task template into a task note and link it from `GOAL.md` or `PROGRESS.md` as appropriate.

## Decision Discipline

- Promote a conversation item to the durable ledger only when it is an explicit user decision, a user-approved proposal, or an invariant required by the current product intent.
- Label every entry `active`, `superseded`, `candidate`, or `needs validation`. Do not present candidates as committed work.
- When a newer request replaces a decision, keep a short record of what it replaces. This prevents older Agent sessions from reintroducing cancelled flows.
- A change to product direction updates `GOAL.md` and `PROGRESS.md`; a change to architecture or a public contract updates the relevant context map in the same batch.

## Evidence Discipline

Evidence must match the claim. A script syntax check proves syntax, not a UI interaction. A DOM existence assertion does not prove visibility, layout, state transition or responsiveness. A build proves packageability, not that a paid upstream flow is safe.

Use a claim-to-evidence mapping in the handoff:

| Claim type | Minimum useful evidence |
| --- | --- |
| Pure transformation or policy | Focused deterministic self-test |
| Renderer interaction | Relevant UI exercise plus visible-state/screenshot evidence |
| Main/IPC/runtime contract | Targeted owner test plus boundary registration/contract check |
| Shared GUI/CLI/MCP action | Schema, handler and automation contract evidence |
| Persistence/migration | Reload or merge/restart case, not only unit state |
| Windows package | Build output and requested smoke/installer evidence |
| Formal release | Repository release checklist and complete required gates |

The matrix gives exact routing and authorization rules. Keep verification proportional: targeted in development, broad only for releases or changes that genuinely cross those boundaries.

## Harness Layout

| File | Why it exists |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Short machine-readable workspace entry and safety/routing rules |
| [harness/CONVERSATION_DECISIONS.md](harness/CONVERSATION_DECISIONS.md) | Curated user intent, product invariants and superseded directions |
| [harness/TASK_PROTOCOL.md](harness/TASK_PROTOCOL.md) | Repeatable execution and handoff procedure |
| [harness/VERIFICATION_MATRIX.md](harness/VERIFICATION_MATRIX.md) | Risk-based proof and authorization matrix |
| [harness/TASK_BRIEF_TEMPLATE.md](harness/TASK_BRIEF_TEMPLATE.md) | Durable task contract template |
| [harness/COMPLETION_AUDIT.md](harness/COMPLETION_AUDIT.md) | Final evidence audit before declaring success |
| [scripts/verify-harness.mjs](scripts/verify-harness.mjs) | Zero-dependency structural verifier for this harness |

## Scope Boundary

This harness governs the workspace collaboration process. It does not replace product specifications, runtime safety controls, source code tests, the desktop `AGENTS.md`, or the backend `AGENTS.md`. Those local documents remain the detailed authority once the work has been routed.
