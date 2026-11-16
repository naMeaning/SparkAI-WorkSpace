# Sparkvas Recipe Contract v1

**Status**: Phase 1 pure contract implemented. Main persistence, Recipe execution, Studio, Registry and Electron/React integration are not implemented by this contract batch.

**Owners**: `runtime/skill-contract.cjs`, `runtime/tool-contract.cjs`, `runtime/recipe-contract.cjs`, `runtime/recipe-graph.cjs`, `runtime/recipe-run-contract.cjs` and their `.d.mts` mirrors.

**Evidence**: `scripts/skill-contract-selftest.cjs`, `scripts/tool-contract-selftest.cjs` and `scripts/recipe-contract-selftest.cjs`. All three suites use fixtures only and make zero real model requests.

## 1. Scope And Invariants

Sparkvas has two authoring surfaces over one Project:

- **Canvas** is the primary result surface: images, videos, image containers, Requirement nodes and provenance relations.
- **Studio** is the second authoring surface: a semantic Recipe graph that can be edited and run. It shares the same Project, selection, TaskScope, assets, session and provenance as Canvas.

The v1 contract enforces these boundaries:

1. A Recipe is a directed acyclic graph. Cycles, self-edges, dangling endpoints, duplicate endpoints and unconnected required inputs are rejected.
2. Only semantic nodes are allowed: `Input`, `Brief`, `Skill`, `Transform`, `Tool`, `Review`, `Output`. Low-level ComfyUI/model operator graphs are not part of this schema.
3. A Skill is declarative content. It cannot carry an entry point, script, executable dependency or arbitrary permission request.
4. A Tool is an executable adapter owned by the application. v1 accepts only `builtin` and `controlled-adapter` distributions; Registry payloads cannot install third-party executable code.
5. Recipe dependencies and node references pin exact SemVer, ID and content hash.
6. Every Recipe document, Skill manifest, Tool manifest and Run has a canonical SHA-256 identity. Silent content changes fail validation.
7. A Run freezes the Recipe version/hash, input asset identities, permission snapshot and idempotency scope before execution.
8. Unknown or disconnected submissions are never automatically resent.
9. Public DTOs do not contain API keys, cookies, bearer tokens, absolute paths, file URLs, signed URLs, internal entry IDs or provider-private references.

## 2. Common Conventions

### 2.1 Schema And Versioning

- All four top-level documents use `schemaVersion: 1` in this batch.
- `version` and `minAppVersion` are exact SemVer strings, for example `1.0.0`; ranges and floating tags are not accepted.
- A Recipe pins one exact version and one content hash for each Skill/Tool dependency.
- A Run pins `recipeVersion` and `recipeHash`; later Recipe edits do not alter an existing Run.

### 2.2 Stable IDs

| Entity | Rule | Example |
| --- | --- | --- |
| Skill | `skill.<publisher>.<slug>` | `skill.sparkvas.product-hero` |
| Tool | `tool.<publisher>.<slug>` | `tool.sparkvas.image-generation` |
| Recipe | `recipe.<publisher>.<slug>` | `recipe.sparkvas.beauty-crossborder-set` |
| Run | `run.<lowercase UUID>` | `run.00000000-0000-4000-8000-000000000001` |
| Recipe step | `step.<lowercase-kebab>` | `step.render` |
| Recipe edge | `edge.<lowercase-kebab>` | `edge.hero-render` |

`publisher` and `slug` are 1–40 lowercase alphanumeric/hyphen characters, start and end with an alphanumeric character, and contain no dot. A resource ID is at most 86 characters.

Slot and port IDs use lowercase kebab-case. Within a Skill, `slotId` and `parameterId` are unique. Within a Tool or Recipe node, `portId` is unique. `stepId` and `edgeId` are unique across the document.

### 2.3 Canonical Hashes

- Hash format: `sha256:` followed by exactly 64 lowercase hexadecimal characters.
- Material: the normalized document with `contentHash` removed. For a Run, the scope hash uses only the frozen scope fields described below.
- JSON canonicalization recursively sorts object keys, preserves array order and omits `undefined` values.
- Hash text is the SHA-256 of the UTF-8 canonical JSON without extra whitespace.
- `seal*` helpers produce a hash; `parse*` helpers recompute it. A declared hash that does not match is rejected.
- Run scope normalization sorts input asset identities by `slotId` and permission Tool records by `toolId`; permission value arrays are sorted. Reordering equivalent arrays therefore does not change `scopeHash`.

### 2.4 Port Data Types

`asset`, `image`, `video`, `text`, `brief`, `review`, `bundle`, `any`.

Ports connect only when their data types match or either side is `any`. v1 has no coercion, union type or implicit conversion.

### 2.5 Public Values

Public text and node configuration reject Windows/UNC absolute paths, `file:` URLs and common signed-URL parameters. Public JSON keys reject credential-shaped names such as `apiKey`, `authorization`, `cookie`, `password`, `secret`, `entryId` and `fmemId`.

Node `config` is limited to six nesting levels, 64 array items, 64 object keys and 4000 characters per string. Provider credentials, local file locations and internal continuation references belong to Main-owned state, never to a public Recipe document.

## 3. SkillManifest v1

### 3.1 Fields

| Field | Required | Contract |
| --- | --- | --- |
| `schemaVersion` | yes | Must be `1`. |
| `id` | yes | `skill.<publisher>.<slug>`. |
| `name` | yes | 1–120 characters. |
| `description` | yes | 1–2000 characters. |
| `version` | yes | Exact SemVer. |
| `minAppVersion` | yes | Exact SemVer. |
| `license` | yes | 1–80 characters. |
| `instructions` | yes | Declarative text, 1–24,000 characters. No executable field. |
| `inputSlots` | yes | 1–16 objects: `slotId`, `label`, `dataType`, `required`. `required` defaults to `true`. |
| `parameters` | no | At most 32 objects: `parameterId`, `label`, `type`, `required`, optional `defaultValue`, optional `values`. |
| `examples` | no | At most 12 objects: `title`, optional `description`. |
| `limitations` | no | At most 24 unique strings, each at most 500 characters. |
| `tags` | no | At most 16 unique strings, each at most 40 characters. |
| `contentHash` | yes | Canonical hash of the normalized manifest without `contentHash`. |

Parameter types are `string`, `number`, `boolean` and `enum`. Enum parameters require 1–32 unique `values`; only enum parameters may declare `values`. Enum defaults must be one of those values.

Executable or permission-shaped fields such as `entrypoint`, `script`, `permissions`, `process`, `network` and `env` are unknown fields and are rejected.

### 3.2 Example

The hash below is a placeholder until `sealSkillManifest()` computes it. The rest is a valid structural example.

```json
{
  "schemaVersion": 1,
  "id": "skill.sparkvas.product-hero",
  "name": "商品主图导演",
  "description": "把商品主图转换为可审阅的跨境套图步骤。",
  "version": "1.0.0",
  "minAppVersion": "1.0.9",
  "license": "CC-BY-4.0",
  "instructions": "保留商品外形、材质和标识，只调整场景与光线。",
  "inputSlots": [
    { "slotId": "product", "label": "商品母图", "dataType": "image", "required": true }
  ],
  "parameters": [
    {
      "parameterId": "aspect",
      "label": "画幅",
      "type": "enum",
      "required": true,
      "values": ["1:1", "4:5"],
      "defaultValue": "1:1"
    }
  ],
  "examples": [{ "title": "香水方形主图" }],
  "limitations": ["不改变商品结构"],
  "tags": ["commerce", "beauty"],
  "contentHash": "sha256:<64 lowercase hex>"
}
```

## 4. ToolManifest v1

### 4.1 Fields

| Field | Required | Contract |
| --- | --- | --- |
| `schemaVersion` | yes | Must be `1`. |
| `id` | yes | `tool.<publisher>.<slug>`. |
| `name`, `description`, `license` | yes | Same public-text limits as Skill. |
| `version`, `minAppVersion` | yes | Exact SemVer. |
| `distribution` | yes | `builtin` or `controlled-adapter` only. |
| `adapter` | yes | `image-generation`, `video-generation`, `comfyui`, `scientific-runner`, `mcp` or `language-model`. |
| `inputSlots` | yes | 1–16 input ports: `portId`, `label`, `dataType`, `required`. |
| `outputSlots` | yes | 1–16 output ports: `portId`, `label`, `dataType`. |
| `permissions` | yes | All five scopes below must be present. |
| `limitations` | no | At most 24 unique strings. |
| `tags` | no | At most 16 unique strings. |
| `contentHash` | yes | Canonical hash without `contentHash`. |

No `entrypoint`, executable path, installer URL, script or arbitrary command is part of the manifest. A Tool implementation is supplied by the application adapter identified by `adapter`.

### 4.2 Permission Scopes

Every scope is an array of 1–8 unique values. `none` must be alone.

| Scope | Allowed values |
| --- | --- |
| `network` | `none`, `loopback`, `lan`, `public` |
| `filesystem` | `none`, `project-read`, `project-write`, `managed-read`, `managed-write` |
| `process` | `none`, `managed-runner` |
| `models` | `none`, `image-generation`, `video-generation`, `language-model` |
| `mcp` | `none`, `approved-servers` |

Permission arrays are sorted during normalization so semantically identical grants produce the same hash.

### 4.3 Example

```json
{
  "schemaVersion": 1,
  "id": "tool.sparkvas.image-generation",
  "name": "内置图片生成",
  "description": "调用现有受管图片执行链，不把凭据暴露给 Recipe。",
  "version": "1.0.0",
  "minAppVersion": "1.0.9",
  "license": "UNLICENSED",
  "distribution": "builtin",
  "adapter": "image-generation",
  "inputSlots": [
    { "portId": "source", "label": "来源图片", "dataType": "image", "required": true },
    { "portId": "prompt", "label": "生成要求", "dataType": "text", "required": true }
  ],
  "outputSlots": [
    { "portId": "result", "label": "图片成果", "dataType": "image" }
  ],
  "permissions": {
    "network": ["public"],
    "filesystem": ["managed-read", "managed-write"],
    "process": ["none"],
    "models": ["image-generation"],
    "mcp": ["none"]
  },
  "limitations": ["不接收任意脚本"],
  "tags": ["builtin", "image"],
  "contentHash": "sha256:<64 lowercase hex>"
}
```

## 5. RecipeDocument v1

### 5.1 Fields

| Field | Required | Contract |
| --- | --- | --- |
| `schemaVersion` | yes | Must be `1`. |
| `id` | yes | `recipe.<publisher>.<slug>`. |
| `name`, `description`, `license` | yes | Public text; limits are 120, 2000 and 80 characters. |
| `version`, `minAppVersion` | yes | Exact SemVer. |
| `dependencies` | yes | 1–64 unique Skill/Tool pins: `kind`, `id`, `version`, `contentHash`. One version per dependency ID. |
| `inputSlots` | yes | 1–16 `slotId`/`label`/`dataType`/`required` objects. |
| `outputContract` | yes | `schemaVersion: 1` plus 1–16 output slots. |
| `nodes` | yes | 1–128 semantic nodes. |
| `edges` | yes | Up to 512 edges: `edgeId`, `fromStepId`, `fromPortId`, `toStepId`, `toPortId`. |
| `tags` | no | At most 24 unique strings. |
| `contentHash` | yes | Canonical hash without `contentHash`. |

A Skill or Tool node's `ref` must exactly match a declared dependency. Every declared dependency must be used by at least one node. Unused or undeclared pins fail validation.

### 5.2 Node Rules

| Node type | Input ports | Output ports | Additional rule |
| --- | --- | --- | --- |
| `Input` | none | at least 1 | Each output port maps to one Recipe input slot with the same ID and type. |
| `Brief` | none | at least 1 | Acts as a source of brief/text material. |
| `Skill` | at least 1 | at least 1 | Must reference a declared `skill` dependency. |
| `Transform` | at least 1 | at least 1 | Semantic transformation; no external dependency required. |
| `Tool` | at least 1 | at least 1 | Must reference a declared `tool` dependency. |
| `Review` | at least 1 | at least 1 | Human/AI review gate; not a raw model operator. |
| `Output` | at least 1 | none | Every input port maps to one `outputContract` slot with the same ID and type. |

Only Skill and Tool nodes may carry `ref`. A node has unique port IDs. Node `config` is optional public JSON and is included in the document hash.

### 5.3 Graph Rules

- The graph must contain at least one `Input` and at least one `Output`.
- Every node must be reachable from an `Input` or `Brief`.
- Every node must have a path to an `Output`.
- Every required input port has exactly one incoming edge.
- A node cannot connect to itself.
- Duplicate edge IDs and duplicate source/target port endpoints are rejected.
- Connected port data types must be compatible.
- Fan-in is one edge per input port in v1.
- Topological order is stable and follows node declaration order when multiple steps are ready.

Validation can run in complete mode (default) or incomplete-authoring mode. Incomplete mode still checks IDs, ports, types and cycles but may defer required-connection and reachability checks.

An omitted input-port `required` value means `true`, including when `validateRecipeGraph()` is called directly instead of through `parseRecipeDocument()`.

### 5.4 Example

Minimal complete graph: `Input -> Skill -> Tool -> Output`.

```json
{
  "schemaVersion": 1,
  "id": "recipe.sparkvas.beauty-crossborder-set",
  "name": "跨境美妆套图",
  "description": "从一张商品图生成可审阅的商品主图。",
  "version": "1.0.0",
  "minAppVersion": "1.0.9",
  "license": "CC-BY-4.0",
  "dependencies": [
    {
      "kind": "skill",
      "id": "skill.sparkvas.product-hero",
      "version": "1.0.0",
      "contentHash": "sha256:<skill hash>"
    },
    {
      "kind": "tool",
      "id": "tool.sparkvas.image-generation",
      "version": "1.0.0",
      "contentHash": "sha256:<tool hash>"
    }
  ],
  "inputSlots": [
    { "slotId": "product", "label": "商品图", "dataType": "image", "required": true }
  ],
  "outputContract": {
    "schemaVersion": 1,
    "outputs": [
      { "slotId": "result", "label": "商品主图", "dataType": "image", "required": true }
    ]
  },
  "nodes": [
    {
      "stepId": "step.input",
      "type": "Input",
      "title": "商品图",
      "inputPorts": [],
      "outputPorts": [
        { "portId": "product", "label": "商品图", "dataType": "image" }
      ]
    },
    {
      "stepId": "step.hero",
      "type": "Skill",
      "title": "商品主图导演",
      "ref": {
        "kind": "skill",
        "id": "skill.sparkvas.product-hero",
        "version": "1.0.0",
        "contentHash": "sha256:<skill hash>"
      },
      "inputPorts": [
        { "portId": "product", "label": "商品图", "dataType": "image", "required": true }
      ],
      "outputPorts": [
        { "portId": "image", "label": "构图", "dataType": "image" }
      ]
    },
    {
      "stepId": "step.render",
      "type": "Tool",
      "title": "生成图片",
      "ref": {
        "kind": "tool",
        "id": "tool.sparkvas.image-generation",
        "version": "1.0.0",
        "contentHash": "sha256:<tool hash>"
      },
      "inputPorts": [
        { "portId": "source", "label": "来源", "dataType": "image", "required": true }
      ],
      "outputPorts": [
        { "portId": "result", "label": "成果", "dataType": "image" }
      ]
    },
    {
      "stepId": "step.output",
      "type": "Output",
      "title": "交付",
      "inputPorts": [
        { "portId": "result", "label": "商品主图", "dataType": "image", "required": true }
      ],
      "outputPorts": []
    }
  ],
  "edges": [
    {
      "edgeId": "edge.input-hero",
      "fromStepId": "step.input",
      "fromPortId": "product",
      "toStepId": "step.hero",
      "toPortId": "product"
    },
    {
      "edgeId": "edge.hero-render",
      "fromStepId": "step.hero",
      "fromPortId": "image",
      "toStepId": "step.render",
      "toPortId": "source"
    },
    {
      "edgeId": "edge.render-output",
      "fromStepId": "step.render",
      "fromPortId": "result",
      "toStepId": "step.output",
      "toPortId": "result"
    }
  ],
  "tags": ["beauty", "commerce"],
  "contentHash": "sha256:<recipe hash>"
}
```

## 6. RecipeRun v1

### 6.1 Frozen Identity

A Run records:

| Field | Contract |
| --- | --- |
| `schemaVersion` | `1`. |
| `runId` | Stable `run.<uuid>` identity. |
| `recipeId`, `recipeVersion`, `recipeHash` | Exact frozen Recipe identity. |
| `projectId`, optional `conversationId` | Stable public IDs; never paths. |
| `requestedBy` | `user`, `agent` or `cli`. |
| `status` | Run state below. |
| `createdAt`, `updatedAt` | Canonical ISO-8601 UTC timestamps. |
| `inputAssetIdentity` | 1–32 entries: `slotId`, `assetId`, `occurrenceId`, `contentHash`. |
| `permissionSnapshot` | `schemaVersion: 1`, `approvedBy: "user"`, `approvedAt`, and sorted Tool permission records. |
| `steps` | 1–128 Step records. |
| `outputs` | Up to 32 output assets. |
| `error` | Optional terminal/step error. |
| `scopeHash` | Hash of the frozen execution scope. |
| `idempotencyKey` | Hash of `runId + scopeHash`. |

`scopeHash` material is exactly:

```text
schemaVersion, recipeId, recipeVersion, recipeHash, projectId,
inputAssetIdentity, permissionSnapshot
```

`idempotencyKey` material is exactly `{ schemaVersion: 1, runId, scopeHash }`. Changing inputs, permissions, Recipe identity or Project changes `scopeHash`; the Run cannot silently reuse the new scope under its old idempotency key.

`validateRecipeRunAgainstRecipe(run, recipe)` verifies that a sealed Run conforms to a sealed Recipe. It checks the frozen `recipeId`/`recipeVersion`/`recipeHash`, required and declared input slots, declared output slots, executable step coverage, and permission records for every pinned Tool. Input/Brief/Output nodes do not own Run steps; every `Skill`, `Transform`, `Tool` and `Review` node does. A succeeded Run must include every declared output slot.

### 6.2 Statuses

Run status: `queued`, `running`, `waiting_approval`, `paused`, `succeeded`, `failed`, `cancelled`, `interrupted`.

Step status: `pending`, `ready`, `running`, `waiting_approval`, `succeeded`, `failed`, `cancelled`, `interrupted`.

Step submission state: `not_submitted`, `prepared`, `submitted`, `accepted`, `unknown`.

Run transitions:

| From | Allowed to |
| --- | --- |
| `queued` | `running`, `cancelled`, `interrupted` |
| `running` | `waiting_approval`, `paused`, `succeeded`, `failed`, `cancelled`, `interrupted` |
| `waiting_approval` | `running`, `failed`, `cancelled`, `interrupted` |
| `paused` | `running`, `failed`, `cancelled`, `interrupted` |
| `interrupted` | `queued`, `running`, `failed`, `cancelled` |
| terminal states | none |

A `queued` Run contains only `pending` steps. A `succeeded` Run has at least one output, all steps succeeded and no terminal error. A `failed` Run has a top-level or step error.

### 6.3 Retry And Recovery

`recipeStepRetryDisposition()` defines the only v1 retry policy:

| Step state | Disposition |
| --- | --- |
| Failed/interrupted with `not_submitted` or `prepared` | `allowed` |
| Failed/interrupted with `submitted` or `accepted` | `reconcile` |
| Any step with `unknown` submission | `blocked` |
| Any non-failed/non-interrupted step | `not_retryable` |

`reconcile` means query the existing operation/receipt before any new submission. `blocked` means stop and require reconciliation of the ambiguous external state. Neither disposition authorizes automatic resend.

An `unknown` step cannot carry a `retryable: true` error, and a top-level retryable error cannot coexist with any unknown step. Such documents fail validation rather than presenting an unsafe retry invitation.

### 6.4 Outputs And Errors

- Output kinds are `image`, `video` and `bundle`.
- Output identity is `slotId`, `assetId`, `occurrenceId`, `contentHash`, `kind` and `mimeType`.
- Run output kinds map to Recipe output slot types: `image`→`image`, `video`→`video`, `bundle`→`bundle`; `asset` and `any` accept all three asset kinds. `text`, `brief` and `review` outputs are not represented by the asset-only `RecipeRun.outputs` v1 channel.
- `image` requires an `image/*` MIME type; `video` requires `video/*`.
- Step outputs use the same kind/type mapping against the owning Recipe node's output ports.
- Optional `width`, `height` and `durationMs` must be non-negative safe integers with dimensions at least one.
- Asset identity contains stable public IDs and content hashes, not paths.
- Error categories: `input`, `dependency`, `permission`, `execution`, `network`, `cancelled`, `unknown`.
- Error codes are stable uppercase identifiers. Messages are bounded public text and have no paths or credentials.

Example Run skeleton:

```json
{
  "schemaVersion": 1,
  "runId": "run.00000000-0000-4000-8000-000000000001",
  "recipeId": "recipe.sparkvas.beauty-crossborder-set",
  "recipeVersion": "1.0.0",
  "recipeHash": "sha256:<recipe hash>",
  "projectId": "project-001",
  "requestedBy": "user",
  "status": "succeeded",
  "createdAt": "2026-11-16T00:00:00.000Z",
  "updatedAt": "2026-11-16T00:00:05.000Z",
  "inputAssetIdentity": [
    {
      "slotId": "product",
      "assetId": "asset-001",
      "occurrenceId": "occurrence-001",
      "contentHash": "sha256:<asset hash>"
    }
  ],
  "permissionSnapshot": {
    "schemaVersion": 1,
    "approvedBy": "user",
    "approvedAt": "2026-11-16T00:00:02.000Z",
    "tools": [
      {
        "toolId": "tool.sparkvas.image-generation",
        "version": "1.0.0",
        "contentHash": "sha256:<tool hash>",
        "permissions": {
          "network": ["public"],
          "filesystem": ["managed-read", "managed-write"],
          "process": ["none"],
          "models": ["image-generation"],
          "mcp": ["none"]
        }
      }
    ]
  },
  "steps": [
    {
      "stepId": "step.render",
      "status": "succeeded",
      "submissionState": "accepted",
      "attempt": 1,
      "startedAt": "2026-11-16T00:00:02.000Z",
      "finishedAt": "2026-11-16T00:00:04.000Z",
      "operationId": "operation-001",
      "outputs": []
    }
  ],
  "outputs": [
    {
      "slotId": "result",
      "assetId": "asset-002",
      "occurrenceId": "occurrence-002",
      "contentHash": "sha256:<output hash>",
      "kind": "image",
      "mimeType": "image/png",
      "width": 2048,
      "height": 2048
    }
  ],
  "scopeHash": "sha256:<frozen scope hash>",
  "idempotencyKey": "sha256:<idempotency hash>"
}
```

## 7. Pure Module Surface

### Skill

`parseSkillManifest`, `normalizeSkillManifest`, `skillContentHash`, `sealSkillManifest`.

### Tool

`parseToolPermissions`, `parseToolManifest`, `normalizeToolManifest`, `toolContentHash`, `sealToolManifest`.

### Recipe graph and document

`validateRecipeGraph`, `topologicalRecipeSteps`, `parseRecipeDocument`, `normalizeRecipeDocument`, `recipeContentHash`, `sealRecipeDocument`.

### Run

`recipeRunScopeHash`, `recipeRunIdempotencyKey`, `sealRecipeRun`, `parseRecipeRun`, `normalizeRecipeRun`, `validateRecipeRunAgainstRecipe`, `canTransitionRecipeRunStatus`, `recipeStepRetryDisposition`, `canRetryRecipeStep`.

All modules are Node CommonJS with `.d.mts` type mirrors. They do not import Electron, React, network clients, model providers or persistence.

## 8. Explicit Non-Goals Of This Batch

- No Recipe Store, Run service, scheduling, retries or cancellation IPC.
- No Studio UI or Canvas-to-Studio round trip.
- No Agent draft/modify/repair tool.
- No GitHub Registry, Marketplace, download, installation, permission prompt or rollback.
- No real image, video or language-model requests.
- No migration of `package.json.productName`, executable name, App ID, installer identity, user-data directory or updater protocol.

Those boundaries remain for Phase 2 onward.

## 9. Verification

```powershell
corepack pnpm run test:skill-contract
corepack pnpm run test:tool-contract
corepack pnpm run test:recipe-contract
corepack pnpm run test:contract-types
```

Expected evidence: all three runtime suites exit `0`, each prints its individual checks, and the final JSON reports `realModelRequests: 0`. The declaration suite compiles every `.d.mts` mirror with `tsconfig.contracts.json`; these mirrors are intentionally outside the application `tsconfig.json` include set.
