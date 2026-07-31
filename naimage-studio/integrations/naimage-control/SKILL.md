---
name: naimage-control
description: Control the local naimage desktop app through its authenticated automation CLI. Use when an agent needs to inspect or operate naimage projects, canvas nodes, image containers, selections, conversations, image generation, imports, or Agent tasks; also use for requests such as “在 naimage 里生成图片”, “查看画布”, “选择或删除节点”, “切换项目”, or “让 naimage Agent 完成任务”.
---

# naimage Control

Use the bundled PowerShell CLI. Resolve paths relative to this Skill directory.

## Workflow

1. Run `scripts/naimage.ps1 status` before issuing a command. The script starts naimage when necessary.
2. Run `canvas.state` or `project.list` before changing existing work.
3. Prefer `agent.chat` for natural-language image work; use direct canvas commands for deterministic project and selection operations.
4. For graph mutations, carry `activeProjectId` from `canvas.state` as `expectedProjectId`. Also carry its latest `canvasRevision` as `expectedCanvasRevision` whenever the command supports it. A mismatch is a failed compare-and-set operation: re-read state and re-plan the whole mutation; never retry a stale subset. `canvas.select` is strict too: every ID and `primaryId` must exist, and `primaryId` must be included in `ids`.
5. Use `canvas.connect` and `canvas.disconnect` with complete exact `edges` arrays. Requirement targets accept multiple ordered SOURCE/REFERENCE bindings; ordinary targets keep one parent and require `replaceExisting=true` to replace it. The whole batch validates before one commit, including every Requirement input in cycle detection. Use `canvas.group`, `canvas.dissolve`, and `canvas.nudge` only with the full explicit node/container set; stale, locked, empty, layered, or unsupported members fail the whole command rather than shrinking to a valid subset.
6. Use `canvas.create-requirement` to create without executing. Use `canvas.update-requirement` with the current Requirement `revision`; its `patch.inputBindings`, when present, replaces the complete ordered binding set. Use `canvas.execute-requirement` with the current `expectedRevision`; unchanged repeat execution additionally requires `confirmedUnchanged=true`. Execution uses the same frozen Requirement TaskScope as the GUI and fails while another Agent task is busy.
7. Use `canvas.import-skill -SkillPath <user-approved-SKILL.md>` when the user asks to bring a chosen Skill onto the active canvas. The CLI reads that file locally and sends only its Markdown plus basename; naimage validates its frontmatter and creates a Skill-backed reusable requirement node that uses the normal requirement connections and TaskScope execution path. An exact re-import selects the existing node. If its instructions were edited locally, re-import returns `exact:false` and `conflict:"locally-modified"`, focuses the existing node, and preserves the local text.
8. Use `requirement-library.list` to inspect the installation-local personal Requirement template library. Save an existing current Requirement with `requirement-library.save`, carrying its exact Requirement revision and active project ID; omit `templateId` for a new template, or pass both `templateId` and `expectedTemplateRevision` for a compare-and-set overwrite. Use `requirement-library.use` with the exact listed template revision to create a normal Requirement node, optionally with ordered SOURCE/REFERENCE bindings and canvas revision guard. It never executes the Requirement or spends image quota. Delete only with the exact template revision and explicit `confirmed=true`; deleting a template never removes existing canvas nodes.
9. Use `canvas.export-image` for a user-authorized local conversion of one canvas asset to PNG, JPEG, WebP, AVIF, or TIFF. Generated assets may originally be PNG, JPEG, or WebP; export validates the decoded bytes instead of trusting the filename. It opens the native Save dialog and never accepts an arbitrary destination path from command JSON; conversion does not call an image model or spend image quota. A recorded remote-backed asset is downloaded only through naimage's public-HTTP(S), redirect-validated managed path. Treat an export error as a failed command; only an explicit `canceled: true` result is a successful no-op.
10. Use `agent.goal` for one instruction applied to an explicitly frozen SOURCE set. Pass exact `sourceNodeIds` when the user chose a subset; omit them only when the user truly authorized every eligible SOURCE image container. Set `operationsPerAsset` to the exact number of operations requested for each eligible asset. The command is a strict two-stage operation: first send prompt, sourceNodeIds, and operationsPerAsset without `confirmed=true`, present the returned `snapshot`, `counts`, and billing estimate to the user, and wait for explicit confirmation. Only then repeat those exact values with `confirmed=true` and `expectedSnapshotHash` set to that preview's exact `snapshot.snapshotHash`. This cryptographically random value expires after ten minutes, is bound to the complete preview request, frozen TaskScope, billing quote, project, conversation, and issuing surface, and is consumed by the first execution attempt before any busy or live-scope checks. Never infer confirmation, change the source list or operation count, substitute a prompt, cross boundaries, or replay a canceled, expired, used, or failed hash; request a fresh preview instead.
11. Use `commerce.compose-set` for a structured cross-border listing-set plan. Pass the exact SOURCE node IDs plus a generate/translate plan. The plan may include per-slot prompts, per-locale prompts, and `saveTarget: "requirement" | "skill"` with `reusableName` when the user wants a reusable canvas node. Use either `languageCodes` or `targetLocales`, never both; every code must be one of the schema's registered commerce languages. Invalid or conflicting language input fails before plugin composition, Goal preview, or provider dispatch. naimage normalizes the plan, derives operationsPerAsset from the real SOURCE bindings, composes the deterministic Agent prompt, and then uses the same Goal preview/confirmation ledger; it is not a shortcut around `agent.goal`. Preview first and show the composition, request counts, skipped inputs, billing estimate, and reusable-node intent. Store the returned top-level `confirmationArgs`, then after explicit authorization spread that object unchanged and add only `confirmed: true` plus `expectedSnapshotHash` from the same preview. `composition.normalizedPlan` is read-only quote information and `composition.plan` is its compatibility alias; never use either one to reconstruct confirmation input. Any plan/source/save-target change requires a fresh preview. The reusable node is created only after Goal dispatch is accepted; a canceled or rejected confirmation creates nothing.
12. While a task is running, `agent.chat` is text-only: it keeps the frozen TaskScope, ignores no IDs, rejects any supplied `sourceNodeIds`, and returns after the steer is accepted. Use `agent.steer` for explicit SOURCE/REFERENCE changes without ending the parent run. Its `taskScopeMode` shorthand keeps, replaces, appends, or clears frozen attachments; for independent control, pass `sourceMode` and `referenceMode` (`keep | replace | merge | clear`) with matching canvas node IDs. Every supplied node ID must exist when the command is accepted: never expect naimage to silently discard stale IDs and execute the remaining subset. Replace/merge requires at least one corresponding node ID; use `clear` to remove attachments. Use `agent.pause`, `agent.resume`, or `agent.stop` only when their distinct control semantics are intended, and treat any rejected control operation as a failed command rather than inferring state from the UI.
13. Re-read `canvas.state` after a mutating command and report the actual result. It is the authoritative source for canonical relations, Requirement bindings/signatures/revisions, container/layout membership, and lock/busy state. It never returns managed asset paths or automation credentials.
14. Require explicit user authorization before confirmed `agent.goal` or `commerce.compose-set` execution, `canvas.clear`, `canvas.delete-selected`, deleting a personal Requirement template, overwriting a project name, or exporting/deleting user assets.

Pass command arguments as compact JSON:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.state
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 agent.chat -ArgsJson '{"prompt":"生成三张暖黄色跨境电商主图"}' -TimeoutSeconds 900
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 agent.steer -ArgsJson '{"prompt":"保留商品，把背景改为暖黄色"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 agent.steer -ArgsJson '{"prompt":"改用这张商品图继续","taskScopeMode":"replace-source","sourceNodeIds":["SOURCE_NODE_ID"]}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 agent.steer -ArgsJson '{"prompt":"追加新的商品角度并保留现有原图","taskScopeMode":"merge-source","sourceNodeIds":["SOURCE_NODE_B"]}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 agent.steer -ArgsJson '{"prompt":"追加这两张风格参考后重新规划","taskScopeMode":"merge-reference","referenceNodeIds":["REF_NODE_A","REF_NODE_B"]}'
```

Mutate the current graph with the project and canvas revision from the latest `canvas.state` response:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.group -ArgsJson '{"nodeIds":["IMAGE_A","IMAGE_B"],"primaryId":"IMAGE_A","expectedProjectId":"PROJECT_ID","expectedCanvasRevision":42}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.connect -ArgsJson '{"edges":[{"sourceId":"IMAGE_A","targetId":"REQ_A","relationType":"referenced","inputRole":"source"},{"sourceId":"IMAGE_B","targetId":"REQ_A","relationType":"referenced","inputRole":"reference"}],"expectedProjectId":"PROJECT_ID","expectedCanvasRevision":43}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.update-requirement -ArgsJson '{"nodeId":"REQ_A","expectedRevision":3,"patch":{"text":"Keep the product identity and use the reference lighting."},"expectedProjectId":"PROJECT_ID","expectedCanvasRevision":44}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.execute-requirement -ArgsJson '{"nodeId":"REQ_A","expectedRevision":4,"expectedProjectId":"PROJECT_ID"}' -TimeoutSeconds 900
```

Reuse a personal Requirement template without executing it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 requirement-library.list
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 requirement-library.save -ArgsJson '{"nodeId":"REQ_A","expectedRequirementRevision":4,"expectedProjectId":"PROJECT_ID"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 requirement-library.use -ArgsJson '{"templateId":"reqtpl-0123456789abcdef0123456789abcdef","expectedTemplateRevision":1,"inputBindings":[{"nodeId":"IMAGE_A","role":"source"}],"expectedProjectId":"PROJECT_ID","expectedCanvasRevision":45}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 requirement-library.delete -ArgsJson '{"templateId":"reqtpl-0123456789abcdef0123456789abcdef","expectedTemplateRevision":1,"confirmed":true}'
```

Preview a Goal, show its frozen scope to the user, then execute only after explicit confirmation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 agent.goal -ArgsJson '{"prompt":"Create two marketplace-ready variants for the selected product sources","sourceNodeIds":["SOURCE_A","SOURCE_B"],"operationsPerAsset":2}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 agent.goal -ArgsJson '{"prompt":"Create two marketplace-ready variants for the selected product sources","sourceNodeIds":["SOURCE_A","SOURCE_B"],"operationsPerAsset":2,"confirmed":true,"expectedSnapshotHash":"GOAL_SNAPSHOT_HASH_FROM_PREVIEW"}' -TimeoutSeconds 900
```

Preview a structured commerce set, show its full quote, save its `confirmationArgs`, then confirm by copying that object exactly and adding only the confirmation fields:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.compose-set -ArgsJson '{"sourceNodeIds":["SOURCE_A","SOURCE_B"],"plan":{"mode":"generate","setSize":2,"slots":[{"id":"hero","title":"Hero image","prompt":"Keep the exact product identity and create a clean white-background hero composition."},{"id":"detail","title":"Detail image","prompt":"Show only real visible material and construction details."}],"languageCodes":["en-US","de-DE"],"saveTarget":"requirement","reusableName":"Marketplace listing-set requirement"}}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.compose-set -ArgsJson '{"sourceNodeIds":["SOURCE_A","SOURCE_B"],"plan":{"mode":"generate","setSize":2,"slots":[{"id":"hero","title":"Hero image","prompt":"Keep the exact product identity and create a clean white-background hero composition."},{"id":"detail","title":"Detail image","prompt":"Show only real visible material and construction details."}],"languageCodes":["en-US","de-DE"],"saveTarget":"requirement","reusableName":"Marketplace listing-set requirement"},"confirmed":true,"expectedSnapshotHash":"GOAL_SNAPSHOT_HASH_FROM_PREVIEW"}' -TimeoutSeconds 900
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.compose-set -ArgsJson '{"sourceNodeIds":["SOURCE_A","SOURCE_B"],"plan":{"mode":"translate","targetLocales":[{"code":"en-US","prompt":"Use concise US marketplace wording while preserving brands, model numbers, numbers, and units."},{"code":"ja-JP","prompt":"Use natural concise Japanese commerce wording with readable line breaks."}],"translatePrompt":"Translate only visibly present text and preserve the product and factual claims.","saveTarget":"skill","reusableName":"Marketplace localization skill"}}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.compose-set -ArgsJson '{"sourceNodeIds":["SOURCE_A","SOURCE_B"],"plan":{"mode":"translate","targetLocales":[{"code":"en-US","prompt":"Use concise US marketplace wording while preserving brands, model numbers, numbers, and units."},{"code":"ja-JP","prompt":"Use natural concise Japanese commerce wording with readable line breaks."}],"translatePrompt":"Translate only visibly present text and preserve the product and factual claims.","saveTarget":"skill","reusableName":"Marketplace localization skill"},"confirmed":true,"expectedSnapshotHash":"GOAL_SNAPSHOT_HASH_FROM_PREVIEW"}' -TimeoutSeconds 900
```

Import a user-approved `SKILL.md` without putting its absolute path in command JSON or the project:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.import-skill -SkillPath 'C:\path\to\SKILL.md' -ArgsJson '{"x":240,"y":180}'
```

Export one canvas image with a native destination picker and local conversion:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.export-image -ArgsJson '{"nodeId":"IMAGE_NODE_ID","assetIndex":0,"format":"webp"}'
```

Read [references/commands.md](references/commands.md) for command schemas and response fields.

## Safety

- Never read, print, copy, or persist `.naimage-connection.json` or the automation endpoint token.
- Never edit naimage project files directly while the app is running. Use the CLI so renderer state and persistence stay synchronized.
- Import only a `SKILL.md` the user selected or placed in task scope. The first import boundary is one Markdown file up to 256 KiB with at most 24,000 instruction characters; sibling `scripts/`, `references/`, and `assets/` are not copied yet.
- Personal library entries are installation-local Requirement templates, not tool nodes or executable workflows. `requirement-library.use` creates a normal Requirement and must never be treated as implicit authorization to execute it.
- Treat returned local asset paths as user data. Do not modify source images outside naimage-managed project storage.
- `canvas.export-image` must remain user-authorized and native-picker mediated. Never claim that local format conversion spends image quota or regenerates the image.
- Concurrent exports to the same destination are serialized. If another operation creates the target after the Save dialog closes, naimage requires a fresh overwrite confirmation; never bypass that confirmation or retry as though the first export succeeded.
- Never bypass a rejected remote-backed asset by opening or downloading its raw URL. Localhost, private, link-local, reserved, mixed-DNS, and unsafe redirect targets are intentionally blocked before export.
- Goal mode respects the configured concurrency limit and starts with a serial probe of 1-2 distinct SOURCE images, preferring different containers when available. Renderer windows share one Main-process Goal admission controller: queued probes take priority over new ramp waves, and admitted Goals fairly share the frozen process capacity. Expansion starts only after requests, persisted assets, and result validation all succeed; protected failures open a cross-Goal circuit.
- Goal confirmation is prompt-bound and one-time. A changed prompt, stale canvas, different project/conversation, failed consumption, or replay must produce zero new dispatch and requires a new preview plus explicit user confirmation.
- For `commerce.compose-set`, never confirm from `composition.normalizedPlan` or `composition.plan`; only the unchanged returned `confirmationArgs` matches the Main-process confirmation fingerprint. Unknown language codes and simultaneous `languageCodes`/`targetLocales` input must remain zero-dispatch failures.
- Probe and circuit-breaker safeguards prevent only undispatched work. Provider requests already accepted may still finish and incur charges even after pause, stop, or circuit break.
- A bounded transport retry pauses every new ramp wave until the request settles. Closing a Renderer does not release its reservation until the real provider Promise drains. Process-wide admission is not a cost guarantee; requests already accepted upstream may still be charged.
- A pending CLI command belongs to the Renderer that accepted it. If that Renderer closes or crashes, the command fails immediately and its undispatched Agent work is canceled; wait for a ready Renderer before retrying instead of leaving duplicate commands running.
- Retry a `renderer not ready` response briefly; do not start duplicate app processes repeatedly.
