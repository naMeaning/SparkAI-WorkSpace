# SparkAI WorkSpace Harness

## Purpose

This workspace contains the SparkAI WorkSpace desktop client and a small optional extension service. The user's stock New API deployment is external to this workspace and must remain independently upgradeable.

The harness is designed around the operating preferences established in the Nimage conversations: ship useful product increments quickly, keep the implementation small and maintainable, verify the affected user path rather than mechanically running every check, and never describe an unverified result as complete.

## Route The Task First

| Request concerns | Work in | Read first |
| --- | --- | --- |
| Electron desktop UI, canvas, local project/assets/session, local Agent runtime, plugins, IPC, CLI/MCP, installer, Windows EXE | `sparkai_workspace/` | `sparkai_workspace/AGENTS.md`, current `GOAL.md`, top of `PROGRESS.md`, `PRODUCT_INTENT.md`, relevant `docs/CONTEXT_MAP.md` sections |
| Pro License, redemption codes, `/v1/image-tasks`, extension Docker/Caddy deployment | `sparkai-extension/` | `sparkai-extension/AGENTS.md`, relevant `WORKSPACE_CONTEXT_MAP.md` sections |
| Account/quota/channel/billing or New API web admin | External stock New API | Do not modify or copy it into this workspace; use its upstream documentation |
| Auth/image-task/API contract crossing desktop and extension | Both repositories | `WORKSPACE_CONTEXT_MAP.md`, then each repository's local map |

`sparkai-extension/` is not a New API fork or a submodule of the desktop client. Do not copy account, channel, quota, billing, CRM, or New API management features into it or Electron, and do not treat a desktop-only test as proof of a cross-repository change.

## Recover Current State At Every Session

Before reporting development status or choosing implementation work in a new session, after context compaction, or on `continue`:

1. Inspect `git status --short` and the current branch; preserve existing changes.
2. Read the owner repository's `AGENTS.md`. For desktop work, read the current task at the top of [GOAL.md](sparkai_workspace/GOAL.md), then the **当前开发状态** snapshot and newest relevant evidence in [PROGRESS.md](sparkai_workspace/PROGRESS.md).
3. Read product intent, relevant context-map sections and accepted decisions for the requested boundary. For another repository, use its own progress convention; desktop evidence does not establish extension status.
4. Compare the snapshot with live source and available reports/artifacts. Distinguish implementation, exercised verification, remaining work and release state before selecting the next action.

The desktop `PROGRESS.md` snapshot is the maintained status entry point; `GOAL.md` owns the current task contract and context maps own navigation. Keep changing artifact metadata and evidence in progress records and link to them from entry documents. Dated checkpoints retain their status at that time: an old heading containing “current”, “pending” or “unverified” is not a new instruction. Same-version development packages can overwrite local release filenames; use the recorded hash and frozen source to identify a release.

At task acceptance, a material scope change, a verification milestone and completion, update the current task and progress snapshot in the same batch. Update context maps when ownership or a contract changes. Resume the latest accepted scope from the first outstanding condition; completed real-service checks are historical evidence, not a reason to repeat paid requests or publish a development package.

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
3. Recover the current task and progress as above, then read only the context-map sections that cover the target boundary.
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

Every desktop feature addition, functional change, bug fix, or UI/interaction adjustment must produce a local Windows EXE from the final source before handoff, following [the desktop packaging rules](sparkai_workspace/AGENTS.md#验证). The user's standing instruction authorizes this local development packaging without asking again each time. Report the actual EXE path, size, SHA-256 and packaging result; a source build or an older EXE does not satisfy this requirement. Documentation-only edits, planning and read-only diagnosis do not require an EXE.

After every successful package, update the current Goal, Progress and relevant context maps with the source scope, verification, EXE identity and remaining limits, then commit and push the corresponding source and documentation to the configured upstream branch. The user's 2026-10-15 standing instruction authorizes these Git commits and pushes without asking again for each package. Verify the remote branch and the resulting pushed commit; preserve unrelated dirty work and use a normal push. Report packaging, documentation and push results separately, including any actual failure. EXE uploads and formal releases remain separately authorized actions; generated binaries and private configuration retain their existing ignore rules.

Report what changed, the exact evidence actually collected, and what remains unverified. Include artifact paths, hashes and release state only when they were genuinely produced. Do not substitute a plan, a static search result, or a previous final answer for an exercised result.
