# Conversation-Derived Decision Ledger

## Evidence Scope

This ledger was synthesized from the user-facing Nimage conversations, with emphasis on explicit user statements and the resulting Codex architectural decisions. It is cross-checked against current workspace sources rather than treating earlier assistant answers as facts.

Primary conversation evidence includes:

- `019f8795-85a8-7b40-8916-a14db39aa2db`: two-repository mapping, local Agent/runtime, New API, persistence, automation and performance work.
- `019fa20f-8b22-75a3-9d4d-3ebb89a65aa0`: deliberate, no-write exploration of cross-border commerce translation and image-set concepts.
- `019fab72-f898-77f3-93d7-5b715eb36f43`: active product evolution, Goal operation, desktop UX, release expectations, contract synchronization and reliability constraints.
- `019fb125-99f6-7a73-8bc8-f8e8bd638ec6`: configurable transparent-glass UI exploration and visual reference process.

Older conversations are represented through the maintained product documents where their raw thread data is no longer available in the desktop history reader. The current authorities for desktop behavior are `sparkai_workspace/AGENTS.md`, `sparkai_workspace/PRODUCT_INTENT.md`, and its context map.

## Active Product Decisions

| ID | Status | Decision | Current authority |
| --- | --- | --- | --- |
| D-01 | active | SparkAI WorkSpace is a desktop visual-creation workspace for ordinary users and creators, not a workflow-editor clone or general Agent IDE. | `sparkai_workspace/PRODUCT_INTENT.md` |
| D-02 | active | `general`, `commerce`, `social`, and `research` are projections over one project, canvas, session, asset space, TaskScope, plugin system and Agent runtime. | Desktop `AGENTS.md` and product intent |
| D-03 | active | The right-side project Agent is the single control center. Canvas content is managed results, groups, relations and reusable requirements, not Agent or plan nodes. | Desktop `AGENTS.md` |
| D-04 | active | Speed and maintainability matter more than forcing a bundle number. Use natural module boundaries; do not add risky split/refactor work merely to pass an advisory size threshold. | User direction, desktop `AGENTS.md` |
| D-05 | active | Development verification is targeted and evidence-driven. Exercise realistic affected user paths for UI/performance work; reserve full release gates for a requested formal release or direct release-boundary change. | User direction, verification matrix |
| D-06 | active | Real model/video calls can cost money. Image/video creation, especially Seedance, requires the authorization defined by the desktop rules; never retry an ambiguous create request just to obtain a result. | Desktop `AGENTS.md`, product intent |
| D-07 | active | Intermediate image frames are temporary same-slot previews. They never become session, library, viewer, or final-canvas assets; final managed assets replace and clear them. | User feedback, Goal/progress, product intent |
| D-08 | active | The UI uses a readable, performant configurable glass system. Material treatment applies to surfaces, not to source image/video content; interaction responsiveness and legibility win over decorative effects. | User feedback, product intent |
| D-09 | active | Any externally controllable desktop action has one shared command definition and must keep renderer, IPC/bridge, CLI/MCP skill/docs and automation contract tests synchronized. | User direction, desktop `AGENTS.md`, context map |
| D-10 | active | Project/session/assets must be managed and durable. Multi-window work, cancellation, pause/stop and Goal execution need authoritative Main-process coordination rather than optimistic client-only state. | User direction, context maps |
| D-11 | active | The workspace separates desktop client and backend ownership. Cross-repository auth, model, update and DTO changes require explicit two-sided contract evidence. | `WORKSPACE_CONTEXT_MAP.md` |
| D-12 | active | Deliverables describe actual evidence, package paths/hashes when produced, and unverified boundaries. A previous assistant claim is not completion evidence. | Repeated user feedback, harness protocol |
| D-13 | active | Each conversation/image model may independently override Base URL and API Key. The two fields inherit independently when blank; Main resolves account credentials and the SparkAPI-only build still rejects custom connections. | Current user request (2026-09-26), `sparkai_workspace/GOAL.md` |
| D-14 | active | Image protocol, gateway, transport and capability details are implementation policy. The user-facing model configuration should prefer automatic adapter selection and keep only the minimum connection overrides needed for compatibility. | Current user direction (2026-09-27), `sparkai_workspace/GOAL.md` |
| D-15 | active | Agent send, settings readability and image adapter changes are one continuation goal; update Goal/Progress/context records before implementation and preserve real evidence through EXE build. | Current user direction (2026-09-27), `goal-documentation-continuity` |

## Operating Preferences From The User

- Move product functionality forward quickly, but do not let shortcuts create heavy, tangled code or misleading completion claims.
- Start from a clear goal and keep goal/progress current as priorities change; a user may steer during execution.
- Prefer concrete UI behavior and realistic scenario evidence over static-only audits when the request concerns user experience, performance, or interaction.
- Do not introduce surprise cost confirmation screens merely because upstream billing metadata is incomplete; distinguish user-authorized execution from optional post-run usage recording.
- Compile Windows EXEs only when requested; report their actual location and integrity data. Publishing or network use is not implied by a build request.
- Keep visual controls discoverable and readable. A user repeatedly flags small type, transparent menus, unclear concepts and hidden affordances as product defects, not cosmetic polish.

## What The Codex Responses Contributed

The retained assistant responses contributed implementation structure, not unilateral product authority. The harness keeps the useful parts and adds the missing guardrails:

| Repeated Codex pattern | Retained as | Harness guardrail |
| --- | --- | --- |
| Build a context map before changing a large unfamiliar surface | Owner routing and source-of-truth lookup | Current code and contracts are checked again before relying on an earlier map |
| Use targeted self-tests for a narrow module | Risk-based V1/V2 evidence | A UI or performance claim also requires exercised visual evidence |
| Keep GUI, IPC, CLI and automation behavior synchronized | Shared-action contract rule | A final answer cannot claim completion until each affected surface is evidenced |
| Update Goal, Progress and context documents after scope changes | Durable task memory | A parallel governance track must not overwrite another active product milestone |
| Report build paths, hashes and release facts | Evidence-based handoff | Artifacts are reported only after this task has actually produced or verified them |

This distinction matters: assistant design proposals can improve the harness, but only the current user decision and current repository evidence determine what is active and complete.

## Superseded Directions: Do Not Restore

| Legacy direction | Current replacement |
| --- | --- |
| Basic mode versus Agent mode, multiple canvas Agents, plan/prompt/tool/post-processing nodes | One persistent project Agent and a result-focused canvas with only reusable requirements as the executable non-image primitive |
| Canvas links imply execution order | Links express provenance; execution requires explicit user/Agent action |
| Generic workflow editor or revived legacy UI to satisfy old tests | Current simplified workspace and current UI evidence; legacy tests are not a product baseline |
| Account mode ignores per-model Base URL | Per-model Base URL and API Key overrides with independent inheritance; SparkAPI-only build remains locked |
| Expose every image protocol/gateway/capability switch as required user configuration | Automatic internal adapter selection with backward-compatible legacy fields and minimal connection controls |
| Local filter/post-effect workflow and click-to-cutout behavior | Current image-model workflow with real mask/alpha contracts |
| Duplicating domain-specific canvases or runtimes | Shared project state with domain projections |
| Treating bundle limits as a universal blocker | Product performance evidence and risk-aware natural boundaries; release-only hard gates where defined |
| Restoring CRM into the desktop client | Keep desktop and backend ownership separate |

## Candidate Or Unverified Work

These are not promises of completion. They require an explicit current task and the relevant authorization or environment before promotion:

- Real paid Seedance protocol validation and fixed compatibility/charging profile.
- Real R runner verification in an available R environment.
- Paid-image execution branches of tutorials and any real provider integration changes.
- New server-side licensing, token or release behavior beyond the existing documented contract.

## How To Add A Decision

Add a row only after recording the user statement or approved proposal that supports it. State the current authority and status. When a newer decision changes it, update this ledger in the same task and preserve a one-line supersession record. Never record credentials, user data, raw private paths, or upstream signed URLs.
