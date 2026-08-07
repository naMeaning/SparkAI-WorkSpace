# Task Protocol

## 1. Classify Before Writing

| User wording or intent | Mode | Default action |
| --- | --- | --- |
| Explain, compare, advise, design, "only discuss", "do not modify" | discussion | Inspect and report; no source changes |
| Check why, diagnose, investigate | diagnose | Establish cause and evidence; do not silently expand into implementation |
| Fix, implement, add, change, optimize | implement | Make the scoped change and validate the affected boundary |
| `/goal`, maintain goal, long-running milestone | goal | Maintain goal/progress alongside implementation |
| Build EXE/package | build | Run only the requested packaging and immediately relevant smoke checks |
| Release, publish, full acceptance | release | Follow owner release checklist and obtain required network/publishing authority |

If wording contains both a question and an implementation request, honor both. If a material design choice cannot be inferred safely, stop for direction; otherwise make the smallest documented assumption that preserves user intent.

## 2. Establish The Contract

Before deep work, write or state:

```text
Outcome: what a user can observe when this is done
Scope: modules, repositories and public contracts affected
Non-goals: related areas deliberately untouched
Acceptance: exact evidence and test path
Authorization: real model, network, release, dependency or destructive permission
```

For a durable task, use the template. For Goal work, keep the active repository `GOAL.md` and `PROGRESS.md` focused: append a distinct track instead of replacing another active product milestone.

## 3. Inspect Before Editing

1. Read the routed repository `AGENTS.md`, product intent and relevant context-map section.
2. Inspect `git status`, related implementation and existing tests. Existing dirty changes belong to the user or other active work.
3. Compare previous reports with the live code. A reported implementation may be stale, partial, or later superseded.
4. Locate the source of truth for the behavior. Do not create an adapter, duplicate schema or second state model solely because the first file is inconvenient.

## 4. Implement Along The Real Boundary

- Fix data/contract ownership before appearance.
- Keep frontend renderer, Electron Main/preload and runtime responsibilities bounded.
- When an action is reachable by an external Agent, update the shared command schema, renderer handler, CLI/MCP references and automation contract in one batch.
- When a cross-repository contract changes, update both ends or explicitly report the unmodified side as a blocker; do not claim the system integration is complete from one repository.
- Treat streaming, previews, generated media and user assets according to the current managed-asset rules; a temporary representation cannot leak into durable data merely because it is visually convenient.

## 5. Steer Correctly

When the user changes a running goal:

1. Identify whether it refines, replaces, pauses or expands existing scope.
2. Update the goal/progress task record before resuming implementation.
3. Preserve previous work unless the user explicitly asks to remove it and the target is understood.
4. Recompute acceptance and authorization if the steering changes cost, data, public API or release scope.

`continue` means resume the current accepted objective from live evidence. It never means run every remaining test, publish a release, or send real provider requests without separate authority.

## 6. Verify And Handoff

Use the verification matrix to choose the narrowest sufficient proof. Then perform the completion audit before saying the task is done.

Final handoff contains only facts:

1. User-visible outcome and key files changed.
2. Commands/tests actually run and what each proves.
3. Artifact path, size, hash and time only when generated.
4. Explicit unverified boundaries, especially paid, external, cross-repository or release paths.

No sentence may promote an intended change, a planned test, an interrupted command or an old assistant response into completed work.
