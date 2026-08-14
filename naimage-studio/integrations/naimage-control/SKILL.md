---
name: naimage-control
description: Control the local SparkAI WorkSpace desktop app through its authenticated automation CLI. Use when an agent needs to inspect or operate SparkAI WorkSpace workspace domains, projects, canvas nodes, image containers, SKU product catalogs, social content plans and publish packages, managed scientific datasets and figures, platform exports, selections, conversations, image/video generation, imports, or Agent tasks; also use for requests such as “在 SparkAI WorkSpace 里生成图片”, “制作小红书图文”, “制作抖音短视频”, “制作科研图”, “切换到科研工作台”, “查看画布”, “选择或删除节点”, “切换项目”, “让 SparkAI WorkSpace Agent 完成任务”, or legacy references to naimage/nimage.
---

# SparkAI WorkSpace Control

Use the bundled PowerShell CLI. Resolve paths relative to this Skill directory.

## Workflow

1. Run `scripts/naimage.ps1 status` before issuing a command. The script starts SparkAI WorkSpace when necessary.
2. Run `canvas.state` or `project.list` before changing existing work.
   Use `workspace.domain.list` to discover the four canonical workspaces, `workspace.domain.get` to inspect the active project, and `workspace.domain.set` with the latest `expectedProjectId` to switch its capability projection. Switching a domain must not remount the canvas, clear selection, interrupt a task, call a model, or incur charges. Pass `workspaceDomain` to `project.create` when the user wants a specific initial workspace; otherwise it inherits the current domain.
3. Prefer `agent.chat` for natural-language image work; use direct canvas commands for deterministic project and selection operations. When the user explicitly chooses an output frame, pass `ratio` (`1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `21:9`, `9:21`, or `4:5`) and `resolution` (`1K`, `2K`, or `4K`) to `agent.chat` or `agent.goal`. These fields apply one image output specification to the instruction; resolution controls delivery pixels and is separate from the image model's quality tier. Omit both fields when the user wants the app defaults.
4. For graph mutations, carry `activeProjectId` from `canvas.state` as `expectedProjectId`. Also carry its latest `canvasRevision` as `expectedCanvasRevision` whenever the command supports it. A mismatch is a failed compare-and-set operation: re-read state and re-plan the whole mutation; never retry a stale subset. `canvas.select` is strict too: every ID and `primaryId` must exist, and `primaryId` must be included in `ids`.
5. Use `canvas.connect` and `canvas.disconnect` with complete exact `edges` arrays. Requirement targets accept multiple ordered SOURCE/REFERENCE bindings; ordinary targets keep one parent and require `replaceExisting=true` to replace it. The whole batch validates before one commit, including every Requirement input in cycle detection. Use `canvas.group`, `canvas.dissolve`, and `canvas.nudge` only with the full explicit node/container set; stale, locked, empty, layered, or unsupported members fail the whole command rather than shrinking to a valid subset.
6. Use `canvas.create-requirement` to create without executing. Use `canvas.update-requirement` with the current Requirement `revision`; its `patch.inputBindings`, when present, replaces the complete ordered binding set. Use `canvas.execute-requirement` with the current `expectedRevision`; unchanged repeat execution additionally requires `confirmedUnchanged=true`. Execution uses the same frozen Requirement TaskScope as the GUI and fails while another Agent task is busy.
7. Use `canvas.import-skill -SkillPath <user-approved-SKILL.md>` when the user asks to bring a chosen Skill onto the active canvas. The CLI reads that file locally and sends only its Markdown plus basename; naimage validates its frontmatter and creates a Skill-backed reusable requirement node that uses the normal requirement connections and TaskScope execution path. An exact re-import selects the existing node. If its instructions were edited locally, re-import returns `exact:false` and `conflict:"locally-modified"`, focuses the existing node, and preserves the local text.
8. Use `canvas.import-video` only for local MP4, WebM, MOV, or M4V files the user explicitly selected or placed in task scope. naimage validates the file boundary, copies accepted bytes into the active project's managed video library, and creates one independent playback result node per accepted file. This command imports existing media only: it does not call Seedance or any other video model, does not report generation progress, and does not incur video-generation charges.
9. Use `canvas.generate-video` only after the user explicitly requests one video and pass the latest `activeProjectId` as `expectedProjectId` plus `confirmed:true`. The command uses the current default video model unless `model` is supplied, creates one canvas node, and returns after the upstream task is accepted or its creation result becomes known; it does not wait for rendering. SparkAI WorkSpace journals the local task before POST, resumes polling after restart, and never automatically recreates an ambiguous POST. Treat `ambiguous:true` as a terminal creation uncertainty and do not issue a replacement command unless the user has independently confirmed that the upstream did not create or charge for it.
10. Use `requirement-library.list` to inspect the installation-local personal Requirement template library. Save an existing current Requirement with `requirement-library.save`, carrying its exact Requirement revision and active project ID; omit `templateId` for a new template, or pass both `templateId` and `expectedTemplateRevision` for a compare-and-set overwrite. Use `requirement-library.use` with the exact listed template revision to create a normal Requirement node, optionally with ordered SOURCE/REFERENCE bindings and canvas revision guard. It never executes the Requirement or spends image quota. Delete only with the exact template revision and explicit `confirmed=true`; deleting a template never removes existing canvas nodes.
11. Use `commerce.catalog.list` before changing the project-local SKU product catalog, and carry its exact `catalogRevision` plus the current `expectedProjectId` into every write. Use `commerce.catalog.upsert` for a complete product aggregate, including variants, SKUs, and optional `brandStyle`; existing rows require their stable IDs and exact product revision. An enabled brand style may lock the font family, HEX color palette, Logo rule, model identity, product appearance, and visual language. Assign `kind:"brand"` assets with role `logo`, `packaging`, or `style-reference` at product, variant, or SKU ownership; future Commerce Goals freeze the highest-priority applicable references per SOURCE and reject stale canvas locators before provider dispatch. `commerce.catalog.assign` also requires the latest canvas revision and accepts only authoritative `nodeId + assetIndex` pairs. It never accepts paths, URLs, blobs, or caller-supplied asset identities. Use `commerce.catalog.review` to mark one or more generated `result-*` links as `candidate`, `approved`, or `rejected`; pass the current catalog and product revisions once, because naimage processes `linkIds` in order and advances both revisions between links. `commerce.catalog.remove` only removes one material/result relation, and `commerce.catalog.delete` archives a product with `confirmed=true`; none of these operations delete canvas nodes or image files. Any catalog, product, project, or canvas revision conflict requires a fresh read and re-plan instead of a blind retry.
12. Use `commerce.export.preview` with the exact project and catalog revision before packaging. Choose `amazon` or `aliexpress`, JPEG or PNG, and an explicit product/SKU scope when the user selected a subset. Approved results are the default; set `includeCandidates=true` only when requested. Treat missing files, changed hashes, and decode failures as blockers. Use `commerce.export.package` only after that scope is authorized and pass `confirmed=true`; it rechecks the catalog and files, opens a native directory picker, never accepts a destination path, and atomically publishes SKU folders plus a relative-path manifest. A canceled picker is a successful no-op.
13. Use `canvas.export-image` for a user-authorized local conversion of one canvas asset to an explicit PNG, JPEG, WebP, AVIF, or TIFF format. Generated assets may originally be PNG, JPEG, or WebP; export validates the decoded bytes instead of trusting the filename. It opens a single-format native Save dialog rooted at the active project's `exports/images` directory, rejects a final target outside that project, and never accepts an arbitrary destination path from command JSON; conversion does not call an image model or spend image quota. A recorded remote-backed asset is downloaded only through naimage's public-HTTP(S), redirect-validated managed path. Treat an export error as a failed command; only an explicit `canceled: true` result is a successful no-op.
14. Use `social.xiaohongshu.plan` or `social.douyin.plan` to create a structured, reusable Requirement without calling a model or spending quota. Carry the current project and canvas revisions and the exact optional SOURCE node IDs. Execute only after the user asks with the matching `social.*.execute` command and current Requirement revision; that invocation authorizes the planned image requests and, for Douyin, one independent journaled video request. The result reports planned request counts, observed dispatch, possible charges, and ambiguous video creation. Inspect Douyin recovery with `social.douyin.status`; never replace an ambiguous task automatically. Export with `social.*.export`, exact Requirement revision and `confirmed=true`; the native directory picker is mandatory and command JSON never accepts a destination path.
15. Use `agent.goal` for one instruction applied to an explicitly frozen SOURCE set. Pass exact `sourceNodeIds` when the user chose a subset; omit them only when the user truly authorized every eligible SOURCE image container. Set `operationsPerAsset` to the exact number of operations requested for each eligible asset. Invoking the command is the user's explicit execution authorization and may incur upstream image charges; do not ask for a second fee confirmation and do not add `confirmed` or `expectedSnapshotHash`. naimage internally builds the complete preview, frozen TaskScope and billing quote, issues and immediately consumes a one-time receipt, rechecks canvas drift, and returns the frozen request/billing/probe/concurrency metadata with the result. Never infer authorization for a command the user did not request or change the source list, operation count, or prompt after invocation.
16. Use `commerce.compose-set` for a structured cross-border listing-set plan. Pass the exact SOURCE node IDs plus a generate/translate plan. Set `platformTemplateId` to `general`, `amazon`, or `aliexpress`; omitting it uses the general template, while explicit `slots` override the selected template one image at a time. Unknown template IDs fail before plugin composition or dispatch. The plan may also include per-locale prompts and `saveTarget: "requirement" | "skill"` with `reusableName` when the user wants a reusable canvas node. For translation, use `translationItems` only for image-specific overrides: every item must contain the zero-based `sourceIndex` in the exact `sourceNodeIds` expansion order, one selected `localeCode`, and a non-empty `prompt`; duplicate SOURCE-language cells, unselected languages, and out-of-range indices fail before dispatch. Use either `languageCodes` or `targetLocales`, never both; every code must be one of the schema's registered commerce languages. Invalid or conflicting input fails before plugin composition, the internal Goal preview, or provider dispatch. Invoking the command is explicit authorization for the composed image requests and may incur upstream charges; naimage normalizes the plan, derives operationsPerAsset from the real SOURCE bindings, builds and consumes the same internal one-time Goal authorization, then dispatches without a second fee dialog. When a SOURCE mother image has one unambiguous active `master` relation in the project SKU catalog, the destination is frozen per SOURCE binding and completed results are automatically filed after session persistence; ambiguity or Catalog mutation returns a warning while keeping generated images on the canvas. Probe-first admission, progressive ramp-up, circuit protection, and duplicate-dispatch protection remain active. The reusable node is created only after Goal dispatch is accepted.
17. Use `commerce.template.list` to inspect the installation-local structured listing-set template market. Built-in Amazon and AliExpress entries are read-only. Use `commerce.template.save` for a source-neutral generate/translate plan: source-specific translation cells, canvas save targets, and local paths are never persisted. Omit `templateId` for a new personal entry. A same-name create returns `TEMPLATE_NAME_CONFLICT`; use `conflictPolicy:"copy"` to create an automatically numbered copy, or re-read the library and pass `conflictPolicy:"overwrite"` together with the exact personal `templateId` and `expectedTemplateRevision`. Never overwrite from stale conflict details. `commerce.template.import` opens a native picker and always creates a numbered personal copy when the imported name already exists. `commerce.template.export` opens a native Save dialog; pass the exact revision for a personal entry. Delete only a personal entry with its exact revision and `confirmed=true`; existing canvas Requirements, Skills, and generated results remain intact.
18. Use `commerce.catalog.compare` after a fresh catalog read to list retained A/B groups for the current project, optionally narrowed to one product. A group contains at least two distinct results with the same product ownership, SOURCE relation, slot/index, locale, and role; different Commerce runs remain comparable. Use `commerce.catalog.select` with the exact returned Catalog revision, Product revision, group key, and winner link ID. Selection atomically marks the winner approved and its retained siblings rejected in one catalog write. It never deletes result links, provenance, canvas nodes, or managed image files. On any revision conflict, re-read and let the user choose again from the recomputed group.
19. While a task is running, `agent.chat` is text-only: it keeps the frozen TaskScope, ignores no IDs, rejects any supplied `sourceNodeIds`, and returns after the steer is accepted. Use `agent.steer` for explicit SOURCE/REFERENCE changes without ending the parent run. Its `taskScopeMode` shorthand keeps, replaces, appends, or clears frozen attachments; for independent control, pass `sourceMode` and `referenceMode` (`keep | replace | merge | clear`) with matching canvas node IDs. Every supplied node ID must exist when the command is accepted: never expect naimage to silently discard stale IDs and execute the remaining subset. Replace/merge requires at least one corresponding node ID; use `clear` to remove attachments. Use `agent.pause`, `agent.resume`, or `agent.stop` only when their distinct control semantics are intended, and treat any rejected control operation as a failed command rather than inferring state from the UI.
20. Re-read `canvas.state` after a mutating command and report the actual result. It is the authoritative source for canonical relations, Requirement bindings/signatures/revisions, container/layout membership, and lock/busy state. It never returns managed asset paths or automation credentials.
21. Require explicit user authorization before invoking `canvas.generate-video`, `social.*.execute`, `agent.goal` or `commerce.compose-set`, clearing or deleting canvas data, deleting or archiving catalog/template records, selecting an A/B winner, overwriting a project name, or exporting/deleting user assets. A requested video/social/Goal/commerce invocation itself is authorization for its upstream charges; do not request a second fee confirmation.
22. Use `research.data.import` to open the native picker for one user-selected CSV/TSV/TXT file, then `research.data.list` to obtain its managed ID, content hash and bounded field summary. Use `research.figure.plan` with the latest project/canvas revision to create a normal Scientific Requirement without executing code, calling a model or producing charges. A saved plan must explicitly choose exactly one backend (`python` or `r`) and may bind only listed managed data IDs. Invoke `research.figure.render` only when the user asks to render that exact Requirement and carry its current Requirement and canvas revisions. SparkAI WorkSpace runs only a trusted generated script, never caller-supplied code, never installs packages or changes backend, and lands PNG previews only if the project, canvas and Requirement remain unchanged. A revision failure after rendering means outputs remain managed and discoverable through `research.figure.status`, but no canvas success may be claimed. Export only through `research.figure.export` with `confirmed=true` and the native directory picker; cancel only the requested prepared/running task with `research.figure.cancel` and `confirmed=true`.
23. Use `canvas.rename-image-collections` after a fresh `canvas.state` read to rename one or more current image groups. Pass only collection IDs, the active project ID, and (when available) the latest canvas revision; names are NFKC-normalized, Windows-safe, limited to 80 characters, and deterministically de-duplicated. The mutation updates the node title, `imageCollection.name`, and `imageContainerSpec.collection.name` together, and a failed batch makes no partial change.
24. Use `canvas.replace-image-collection-item` only for a completed result collection and a replacement asset already managed by a current project node. Identify the original slot with `itemId` or its one-based `requestIndex`, and identify the replacement with `replacementNodeId` plus zero-based `replacementAssetIndex`; never pass a local path. The original stays in its slot only as a recorded replacement relationship and is copied into one independent `collectionRole:"defects"` node with `sourceCollectionId`/`defectOfNodeId`, `replacesItemId`, and `defectReason`. All requests validate before commit, and replaying the same replacement is an idempotent no-op.
25. Use `canvas.export-image-collections` only after the user explicitly confirms the selected collection IDs and output format (`png`, `jpeg`, `webp`, `avif`, or `tiff`). Main re-reads the active project session, checks that every completed asset is project-managed, computes image/slot/failure counts and an estimated byte total, and publishes each group below `exports/image-groups/` with stable request-slot filenames and an `image-group.json` manifest containing group, prompt, asset, replacement, defect, format, and actual-byte metadata. Export uses a content-bound preview token, local conversion, staging, and atomic publication; command JSON never accepts a destination path. Use the GUI “打开图片组文件夹” entry to open a previously exported group; Main resolves the folder from the current project and collection IDs and returns a clear not-exported error when no manifest exists.

Pass command arguments as compact JSON:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.state
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 workspace.domain.list
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 workspace.domain.set -ArgsJson '{"domain":"commerce","expectedProjectId":"PROJECT_ID"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 project.create -ArgsJson '{"name":"Amazon launch","workspaceDomain":"commerce"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 agent.chat -ArgsJson '{"prompt":"生成三张暖黄色跨境电商主图","ratio":"1:1","resolution":"2K"}' -TimeoutSeconds 900
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

Manage a project-local SKU product catalog without exposing file paths:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.catalog.list -ArgsJson '{"expectedProjectId":"PROJECT_ID"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.catalog.upsert -ArgsJson '{"expectedProjectId":"PROJECT_ID","expectedCatalogRevision":0,"product":{"title":"Travel mug","productCode":"SPU-001","brand":"North","brandStyle":{"enabled":true,"fontFamily":"Inter, Arial, sans-serif","colors":["#0B1F33","#F4C430"],"logoUsage":"Keep the original logo artwork, wording, colors and proportions.","productAppearance":"Keep body geometry, finish and printed markings unchanged.","visualStyle":"Clean premium product photography with restrained typography."},"platforms":["amazon","aliexpress"],"variants":[{"title":"Black 500ml","optionValues":[{"name":"Color","value":"Black"}]}],"skus":[{"skuCode":"MUG-BLK-500","platforms":["amazon"],"variantIndex":0}]}}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.catalog.assign -ArgsJson '{"expectedProjectId":"PROJECT_ID","expectedCatalogRevision":1,"expectedCanvasRevision":45,"productId":"product-0123456789abcdef0123456789abcdef","expectedProductRevision":1,"kind":"master","ownerType":"sku","ownerId":"sku-0123456789abcdef0123456789abcdef","role":"primary","assets":[{"nodeId":"IMAGE_A","assetIndex":0}]}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.catalog.assign -ArgsJson '{"expectedProjectId":"PROJECT_ID","expectedCatalogRevision":2,"expectedCanvasRevision":45,"productId":"product-0123456789abcdef0123456789abcdef","expectedProductRevision":2,"kind":"brand","ownerType":"sku","ownerId":"sku-0123456789abcdef0123456789abcdef","role":"logo","assets":[{"nodeId":"BRAND_LOGO","assetIndex":0}]}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.catalog.review -ArgsJson '{"expectedProjectId":"PROJECT_ID","expectedCatalogRevision":12,"productId":"product-0123456789abcdef0123456789abcdef","expectedProductRevision":4,"linkIds":["result-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","result-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],"state":"approved"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.export.preview -ArgsJson '{"expectedProjectId":"PROJECT_ID","expectedCatalogRevision":12,"platform":"amazon","format":"jpeg","skuIds":["sku-0123456789abcdef0123456789abcdef"]}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.export.package -ArgsJson '{"expectedProjectId":"PROJECT_ID","expectedCatalogRevision":12,"platform":"amazon","format":"jpeg","skuIds":["sku-0123456789abcdef0123456789abcdef"],"confirmed":true}'
```

Reuse structured listing-set templates and select a retained A/B winner:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.template.list
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.template.save -ArgsJson '{"title":"Amazon summer set","description":"Reusable seven-image listing plan","plan":{"mode":"generate","platformTemplateId":"amazon","slots":[{"id":"hero","title":"Hero","prompt":"Keep the exact product on a pure white background."}]}}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.template.export -ArgsJson '{"templateId":"commerce-builtin-amazon"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.catalog.compare -ArgsJson '{"expectedProjectId":"PROJECT_ID","productId":"product-0123456789abcdef0123456789abcdef"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.catalog.select -ArgsJson '{"expectedProjectId":"PROJECT_ID","expectedCatalogRevision":14,"productId":"product-0123456789abcdef0123456789abcdef","expectedProductRevision":6,"groupKey":"comparison-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","winnerLinkId":"result-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'
```

Execute an explicitly authorized Goal. The result includes its frozen request and billing metadata:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 agent.goal -ArgsJson '{"prompt":"Create two marketplace-ready variants for the selected product sources","sourceNodeIds":["SOURCE_A","SOURCE_B"],"operationsPerAsset":2,"ratio":"1:1","resolution":"2K"}'
```

Execute an explicitly authorized structured commerce set:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.compose-set -ArgsJson '{"sourceNodeIds":["SOURCE_A","SOURCE_B"],"plan":{"mode":"generate","platformTemplateId":"amazon","languageCodes":["en-US"],"saveTarget":"requirement","reusableName":"Amazon standard listing-set requirement"}}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.compose-set -ArgsJson '{"sourceNodeIds":["SOURCE_A","SOURCE_B"],"plan":{"mode":"generate","platformTemplateId":"aliexpress","slots":[{"id":"cover","title":"商品首图","prompt":"保持商品身份准确，制作干净的方形速卖通首图。"},{"id":"detail","title":"细节材质","prompt":"展示来源中真实可见的结构和材质细节。"}],"saveTarget":"skill","reusableName":"AliExpress customized listing-set skill"}}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 commerce.compose-set -ArgsJson '{"sourceNodeIds":["SOURCE_A","SOURCE_B"],"plan":{"mode":"translate","targetLocales":[{"code":"en-US","prompt":"Use concise US marketplace wording while preserving brands, model numbers, numbers, and units."},{"code":"ja-JP","prompt":"Use natural concise Japanese commerce wording with readable line breaks."}],"translationItems":[{"sourceIndex":0,"localeCode":"en-US","prompt":"Translate only the top title; retain the lower dimensions and units."},{"sourceIndex":1,"localeCode":"ja-JP","prompt":"Preserve the technical packaging copy and do not add badges."}],"translatePrompt":"Translate only visibly present text and preserve the product and factual claims.","saveTarget":"skill","reusableName":"Marketplace localization skill"}}'
```

Create, execute, inspect, and export social Requirements through the same canvas and task paths as the GUI:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 social.xiaohongshu.plan -ArgsJson '{"expectedProjectId":"PROJECT_ID","expectedCanvasRevision":42,"sourceNodeIds":["SOURCE_A"],"brief":"制作通勤防晒经验图文","contentKind":"experience-share","ratio":"3:4","cardCount":7}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 social.xiaohongshu.execute -ArgsJson '{"expectedProjectId":"PROJECT_ID","nodeId":"REQUIREMENT_ID","expectedRevision":1}' -TimeoutSeconds 900
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 social.xiaohongshu.export -ArgsJson '{"expectedProjectId":"PROJECT_ID","nodeId":"REQUIREMENT_ID","expectedRevision":2,"confirmed":true}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 social.douyin.plan -ArgsJson '{"expectedProjectId":"PROJECT_ID","expectedCanvasRevision":43,"sourceNodeIds":["SOURCE_A"],"brief":"制作新品咖啡杯展示短视频","format":"product-showcase","durationSeconds":30,"shotCount":6}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 social.douyin.execute -ArgsJson '{"expectedProjectId":"PROJECT_ID","nodeId":"REQUIREMENT_ID","expectedRevision":1}' -TimeoutSeconds 900
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 social.douyin.status -ArgsJson '{"expectedProjectId":"PROJECT_ID","nodeId":"REQUIREMENT_ID"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 social.douyin.export -ArgsJson '{"expectedProjectId":"PROJECT_ID","nodeId":"REQUIREMENT_ID","expectedRevision":2,"confirmed":true}'
```

Import managed research data, create a non-executing Scientific Requirement, then render and export its trusted outputs:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 research.data.import -ArgsJson '{"expectedProjectId":"PROJECT_ID"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 research.data.list -ArgsJson '{"expectedProjectId":"PROJECT_ID"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 research.figure.plan -ArgsJson '{"expectedProjectId":"PROJECT_ID","expectedCanvasRevision":42,"backend":"python","figureType":"statistical-chart","researchClaim":"处理组随时间呈现更高的测量值，不在此处推断显著性。","dataSourceIds":["scientific-data-0123456789abcdef0123456789abcdef"],"panels":[{"id":"panel-a","label":"A","chartType":"line","sourceBindings":["scientific-data-0123456789abcdef0123456789abcdef"],"xField":"time","yFields":["control","treated"]}]}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 research.figure.render -ArgsJson '{"expectedProjectId":"PROJECT_ID","expectedCanvasRevision":43,"nodeId":"REQUIREMENT_ID","expectedRevision":1,"timeoutMs":120000}' -TimeoutSeconds 360
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 research.figure.status -ArgsJson '{"expectedProjectId":"PROJECT_ID","nodeId":"REQUIREMENT_ID"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 research.figure.export -ArgsJson '{"expectedProjectId":"PROJECT_ID","taskId":"scientific-task-0123456789abcdef0123456789abcdef","confirmed":true}'
```

Import a user-approved `SKILL.md` without putting its absolute path in command JSON or the project:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.import-skill -SkillPath 'C:\path\to\SKILL.md' -ArgsJson '{"x":240,"y":180}'
```

Import user-authorized local videos as managed playback result nodes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.import-video -ArgsJson '{"paths":["C:\\path\\hero.mp4","C:\\path\\detail.webm"],"x":240,"y":180}'
```

Create one explicitly authorized asynchronous video task and return immediately after creation is resolved:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.generate-video -ArgsJson '{"prompt":"Slow orbit around the exact product on a clean studio pedestal.","seconds":5,"aspectRatio":"16:9","resolution":"720p","expectedProjectId":"PROJECT_ID","confirmed":true}' -TimeoutSeconds 180
```

Export one canvas image with a native destination picker and local conversion:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.export-image -ArgsJson '{"nodeId":"IMAGE_NODE_ID","assetIndex":0,"format":"webp"}'
```

Rename, repair, and export managed image groups:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.rename-image-collections -ArgsJson '{"requests":[{"collectionId":"COLLECTION_ID","name":"商品主图"}],"expectedProjectId":"PROJECT_ID","expectedCanvasRevision":45}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.replace-image-collection-item -ArgsJson '{"requests":[{"sourceCollectionId":"COLLECTION_ID","requestIndex":2,"replacementNodeId":"REPLACEMENT_NODE_ID","replacementAssetIndex":0,"defectReason":"原图主体有瑕疵"}],"expectedProjectId":"PROJECT_ID","expectedCanvasRevision":46}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 canvas.export-image-collections -ArgsJson '{"collectionIds":["COLLECTION_ID"],"expectedProjectId":"PROJECT_ID","format":"png","confirmed":true}'
```

The collection export writes below the active project only. It does not accept or trust a caller-supplied folder, and a folder-opening request for a group that has not been exported is an explicit failure rather than a fabricated success.

Read [references/commands.md](references/commands.md) for command schemas and response fields.

## MCP server

`scripts/naimage-mcp.mjs` exposes every command in the same `references/commands.schema.json` as MCP tools and forwards calls to the authenticated loopback bridge. It does not implement a second canvas, Agent, billing, or persistence path. Configure an MCP client to start it with Node from this installed Skill directory:

```json
{
  "command": "node",
  "args": ["ABSOLUTE_SKILL_PATH/scripts/naimage-mcp.mjs"]
}
```

The server starts SparkAI WorkSpace from the installed connection metadata when necessary, keeps the endpoint token in memory, and never writes it to MCP output. Use `tools/list` to discover current commands instead of maintaining a separate tool list.

## Development debugging

The `debug.*` commands are read-only or tightly bounded development helpers. They are available only in a source checkout or AIDebug run; packaged production builds reject them by default.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 debug.runtime-state
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 debug.renderer-logs -ArgsJson '{"limit":100}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 debug.inspect-command -ArgsJson '{"name":"agent.goal"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/naimage.ps1 debug.run-targeted-test -ArgsJson '{"testName":"test:mcp-wrapper","timeoutMs":60000}'
```

`debug.run-targeted-test` accepts only the schema allowlist, runs from the repository root without a shell, removes credential-like environment variables, and returns bounded redacted output. `debug.capture-window` always writes to the diagnostic directory and accepts no destination path. Use these commands for evidence gathering; they do not authorize code edits, deletion, package installation, model calls, or mutation of user project assets.

## Safety

- Never read, print, copy, or persist `.naimage-connection.json` or the automation endpoint token.
- Never treat MCP as a second business implementation. GUI, CLI, and MCP must continue to invoke the same shared command registry and production Renderer/Main actions.
- Never attempt to enable `debug.*` in a packaged production build, add arbitrary shell/path arguments, or use debug output to expose credentials, cookies, signed URLs, or absolute user asset paths.
- Never edit naimage project files directly while the app is running. Use the CLI so renderer state and persistence stay synchronized.
- Treat a workspace domain as a view and capability projection over the same project, canvas, session, assets, TaskScope, and Agent Runtime. Never create a parallel project state or claim that switching domains starts, stops, or bills a task.
- Import only a `SKILL.md` the user selected or placed in task scope. The first import boundary is one Markdown file up to 256 KiB with at most 24,000 instruction characters; sibling `scripts/`, `references/`, and `assets/` are not copied yet.
- Personal library entries are installation-local Requirement templates, not tool nodes or executable workflows. `requirement-library.use` creates a normal Requirement and must never be treated as implicit authorization to execute it.
- Treat returned local asset paths as user data. Do not modify source images outside naimage-managed project storage.
- `canvas.import-video` may read only the exact local files the user authorized. Never scan sibling folders, modify the sources, claim that import invokes `doubao-seedance-2-0-260128`, or report video-generation charges/progress/results. The current command only copies validated media into project-managed storage.
- `canvas.generate-video` creates exactly one provider task per invocation. Never loop it speculatively, automatically replace an `ambiguous:true` result, or use Chat Completions as a video fallback. A task with a remote ID is recovered by polling its journal entry; only safe status/download GETs may retry automatically.
- `social.*.plan` is non-billing and only creates a normal Requirement. `social.*.execute` is the explicit billing boundary: preserve its exact workflow identity and Requirement revision, and never turn a stale or ambiguous response into a second execution. Douyin video creation must keep the stable workflow idempotency key and independent video journal. `social.*.export` must remain native-picker mediated and accept no destination path.
- Scientific data stays in the active project's managed registry; never ask `research.data.import` to scan a directory or smuggle an absolute path into command JSON. `research.figure.plan` is non-executing. `research.figure.render` must preserve the selected Python/R backend for generation, preview, export and QA, must not invent data or statistics, and must never retry a completed local run merely because canvas landing encountered a revision conflict. Scientific status must not expose absolute paths, executable credentials or full data tables.
- `canvas.export-image` must remain user-authorized and native-picker mediated. Never claim that local format conversion spends image quota or regenerates the image.
- Ordinary `canvas.export-image` and Photoshop PSD export are separate UI/IPC paths. A normal PNG/JPEG/WebP/AVIF/TIFF export must never change PSD state or invoke a PSD worker implicitly; PSD export must not alter the ordinary export target or configuration.
- Image-group rename/replace/export commands accept project and node/asset identities only. Never expose an absolute path, signed URL, credential, or unmanaged asset locator to an Agent, CLI, MCP response, or project manifest.
- `commerce.export.package` must remain user-authorized and native-directory-picker mediated. Never add a destination path argument, bypass an integrity blocker, include rejected results, or mutate a managed source image.
- Concurrent exports to the same destination are serialized. If another operation creates the target after the Save dialog closes, naimage requires a fresh overwrite confirmation; never bypass that confirmation or retry as though the first export succeeded.
- Never bypass a rejected remote-backed asset by opening or downloading its raw URL. Localhost, private, link-local, reserved, mixed-DNS, and unsafe redirect targets are intentionally blocked before export.
- Goal mode respects the configured concurrency limit and starts with a serial probe of 1-2 distinct SOURCE images, preferring different containers when available. Renderer windows share one Main-process Goal admission controller: queued probes take priority over new ramp waves, and admitted Goals fairly share the frozen process capacity. Expansion starts only after requests, persisted assets, and result validation all succeed; protected failures open a cross-Goal circuit.
- Goal authorization remains prompt-bound and one-time internally. A changed prompt, stale canvas, different project/conversation, failed receipt consumption, or replay must produce zero provider dispatch.
- For `commerce.compose-set`, unknown language codes and simultaneous `languageCodes`/`targetLocales` input must remain zero-dispatch failures. The normalized plan and exact SOURCE boundary are frozen before dispatch.
- Probe and circuit-breaker safeguards prevent only undispatched work. Provider requests already accepted may still finish and incur charges even after pause, stop, or circuit break.
- A bounded transport retry pauses every new ramp wave until the request settles. Closing a Renderer does not release its reservation until the real provider Promise drains. Process-wide admission is not a cost guarantee; requests already accepted upstream may still be charged.
- A pending CLI command belongs to the Renderer that accepted it. If that Renderer closes or crashes, the command fails immediately and its undispatched Agent work is canceled; wait for a ready Renderer before retrying instead of leaving duplicate commands running.
- Retry a `renderer not ready` response briefly; do not start duplicate app processes repeatedly.
