# Nimage Workspace Harness

## Purpose

This workspace contains the SparkAI WorkSpace desktop client and a small optional extension service. The user's stock New API deployment is external to this workspace and must remain independently upgradeable.

The harness is designed around the operating preferences established in the Nimage conversations: ship useful product increments quickly, keep the implementation small and maintainable, verify the affected user path rather than mechanically running every check, and never describe an unverified result as complete.

## Route The Task First

| Request concerns | Work in | Read first |
| --- | --- | --- |
| Electron desktop UI, canvas, local project/assets/session, local Agent runtime, plugins, IPC, CLI/MCP, installer, Windows EXE | `naimage-studio/` | `naimage-studio/AGENTS.md`, `PRODUCT_INTENT.md`, relevant `docs/CONTEXT_MAP.md` sections |
| Pro License, redemption codes, `/v1/image-tasks`, extension Docker/Caddy deployment | `ai-native/` | `ai-native/AGENTS.md`, relevant `WORKSPACE_CONTEXT_MAP.md` sections |
| Account/quota/channel/billing or New API web admin | External stock New API | Do not modify or copy it into this workspace; use its upstream documentation |
| Auth/image-task/API contract crossing desktop and extension | Both repositories | `WORKSPACE_CONTEXT_MAP.md`, then each repository's local map |

`ai-native/` is not a New API fork or a submodule of the desktop client. Do not copy account, channel, quota, billing, CRM, or New API management features into it or Electron, and do not treat a desktop-only test as proof of a cross-repository change.

## Authority And Precedence

Apply higher-level platform instructions first. Within this workspace, keep intent and facts separate:

| Question | Authority order |
| --- | --- |
| What should change? | Current explicit user request -> current Goal -> accepted decision ledger -> product intent -> older conversation -> prior assistant proposal |
| What is true now? | Current code, contracts, generated artifacts and observed tests -> context maps -> progress reports -> prior assistant final answer |
| What may incur cost or affect others? | Explicit user authorization -> repository rules; absence of authorization means do not perform the action |

Later explicit user direction replaces an older one. A past assistant answer is useful design context, never standalone proof that a feature exists or that it still matches the product.

## Start Every Nontrivial Task

1. Inspect the worktree and preserve unrelated user changes.
2. Classify the request: discussion, diagnosis, implementation, Goal, build, release, or cross-repository contract.
3. Read the owner repository's constraints and only the context-map sections that cover the target boundary.
4. State a short acceptance contract: outcome, non-goals, affected boundary, validation, and any authorization needed.
5. For Goal work, maintain the active repository `GOAL.md` and `PROGRESS.md` without erasing unrelated active product work.

The detailed protocol, decision ledger and verification matrix live in [HARNESS.md](HARNESS.md). Keep a durable task brief only when a task spans sessions, changes a contract, or needs handoff; use [harness/TASK_BRIEF_TEMPLATE.md](harness/TASK_BRIEF_TEMPLATE.md).

## Default Working Rules

- A request to discuss, explain, audit or plan is read-only unless it also explicitly asks for a change.
- A request to diagnose establishes cause and evidence; implement a fix only when asked or when the wording clearly includes it.
- `continue` resumes the currently accepted scope after checking the live worktree and progress documents. It does not revive superseded requirements.
- Change real data flow and the owner component before adjusting presentation. Avoid masking a broken contract with CSS or a UI-only workaround.
- Keep one source of truth for shared behavior. In the desktop client, an externally controllable action must keep GUI, shared command schema, CLI/MCP documentation and contract tests aligned.
- Update the appropriate context map in the same change whenever ownership, public symbols, IPC/API/schema, persistence or test entry points move.
- Prefer the smallest verification that proves the changed boundary. A visible interaction needs a relevant exercised UI path and screenshot/observable-state evidence; a formal release follows the repository release checklist.

## Safety Boundaries

- Do not send real image/video/model requests, especially Seedance, without explicit user authorization for that request. Do not repeat an ambiguous creation request.
- Do not expose API keys, session cookies, bearer tokens, private paths or signed upstream URLs in renderer state, logs, project files, public DTOs or reports.
- GitHub/network actions, publishing, dependency installation, destructive cleanup, credential configuration and production changes require the scope the user explicitly granted.
- Never use reset, checkout, broad cleanup or overwrite another task's dirty changes to make a local result look clean.

## Completion Standard

Report what changed, the exact evidence actually collected, and what remains unverified. Include artifact paths, hashes and release state only when they were genuinely produced. Do not substitute a plan, a static search result, or a previous final answer for an exercised result.
