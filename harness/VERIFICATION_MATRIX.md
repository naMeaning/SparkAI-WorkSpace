# Verification And Authorization Matrix

## Evidence Tiers

| Tier | Use when | Required proof | Do not overclaim |
| --- | --- | --- | --- |
| V0: documentation/harness | Instructions, maps or templates only | Harness verifier and local link/content review | Product behavior has changed |
| V1: isolated logic | Pure transforms, parsers, policy or schema normalization | Focused deterministic self-test | UI, IPC or persistence behavior |
| V2: boundary contract | IPC, preload, runtime, shared command or persistence changes | Owner self-test plus registration/schema/round-trip evidence | Full end-user workflow without exercising it |
| V3: visible interaction | Renderer, canvas, dialogs, layout, input or performance | Relevant Electron/UI scenario; verify visible state, dimensions, overflow and key interaction | Real provider behavior when using mocks |
| V4: package | Requested Windows build, installer, packaging boundary | Build result plus the requested smoke/installer checks | Formal release or online update success |
| V5: release | Explicit formal release, full acceptance or release-sensitive contract | Repository release checklist and all required gates before publishing | Production operation without deployed evidence |

## Desktop Routing

| Changed boundary | Minimum normal-development evidence |
| --- | --- |
| Renderer visual surface | `typecheck` when TypeScript changes, one relevant AIDebug/UI scenario and screenshot or state evidence |
| Canvas selection, drag, grouping, Requirement or image interaction | Targeted canvas/domain test plus an affected GUI scenario |
| Electron Main, preload or IPC | Owner self-test, IPC registration/contract test, and an exercised renderer path if user-visible |
| Agent runtime, image-frame or `view_image` behavior | Runtime-specific self-test; `test:view-image` when that boundary changes |
| External Agent/CLI/MCP action | Shared schema/handler/CLI documentation and `test:automation-service` contract evidence |
| Project persistence or multi-window coordination | Targeted reload/merge/journal case; use multi-window evidence when concurrency semantics changed |
| Theme or readable glass UI | Targeted UI/Glass test plus relevant visual inspection; do not treat a CSS selector assertion as layout proof |
| Build/bundle boundary | Build or bundle verification only if the request, changed boundary or release rules require it |

Exact script names and formal gates belong to the current `sparkai_workspace/AGENTS.md`, package scripts and context map; do not invent a broad command because it sounds reassuring.

## Backend And Cross-Repository Routing

| Changed boundary | Minimum evidence |
| --- | --- |
| Backend route/controller/DTO | Targeted backend check plus contract-side compilation or fixture evidence |
| Shared DTO or API semantics | Both producer and consumer evidence; update `WORKSPACE_CONTEXT_MAP.md` |
| Desktop login/model/update transport | Desktop-side contract test and backend-side compatible route/DTO evidence; state the untested environment if unavailable |
| Production deployment/release | Deployment checklist, backups/rollback requirements and user-authorized environment action |

## Authorization Gates

| Action | Required authority |
| --- | --- |
| Real image/video/model request | Explicit user authorization for the request; Seedance needs distinct explicit authorization |
| Ambiguous create/poll/download state | Do not auto-recreate; inspect state or request direction |
| Network publish, GitHub release, remote push | User asks for that external action; use the documented local proxy only when applicable |
| Dependency installation or toolchain modification | Required by the scoped task and within user permission; report it |
| Destructive cleanup, data migration, credential change | Clear target and explicit authority; prefer recoverable operations |
| Formal release | Explicit release request plus owner checklist |

## Quality Rules For UI Evidence

- Test the behavior the user reported, including its failure condition where practical.
- Inspect screenshots or equivalent rendered evidence for visibility, clipping, overlap, contrast, dimensions and state transitions.
- For performance fixes, exercise the interaction repeatedly enough to detect long-task, layout-thrash, memory or concurrent-operation regressions in the affected path.
- Mocks prove local sequencing and safety, not provider compatibility or billing behavior. Name that boundary in the handoff.

## Final Evidence Statement

Use this form in the final response or progress note:

```text
Proven: <observable outcome> by <command/scenario and artifact>.
Not proven: <specific excluded boundary> because <reason>.
Not performed: <paid/network/release action> because it was not authorized or requested.
```
