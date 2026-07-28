# naimage automation commands

## Contents

- Status and inspection
- Projects
- Canvas
- Agent
- Images and containers
- Responses and errors

Invoke commands with `scripts/naimage.ps1 <command> -ArgsJson '<json>'`.

## Status and inspection

- `status`: Check the local authenticated bridge and renderer readiness. No arguments.
- `app.state`: Return active project, conversation, Agent status, selection, viewport, node summaries, and recent messages.
- `canvas.state`: Return active project, viewport, selection, and all current canvas node summaries.

## Projects

- `project.list`: List projects and the active project ID.
- `project.switch`: `{ "id": "project-id" }`.
- `project.create`: `{ "name": "Project name" }`.
- `project.rename`: `{ "name": "New name" }`; renames the active project.

## Canvas

- `canvas.select`: `{ "ids": ["node-id"], "primaryId": "node-id" }`; use an empty array to clear selection.
- `canvas.fit`: Fit all current results into view.
- `canvas.clear`: `{ "mode": "failed" | "all", "confirmed": true }`; `confirmed` is required for `all` after explicit user authorization.
- `canvas.delete-selected`: `{ "confirmed": true }`; delete the selected nodes only after explicit user authorization.
- `canvas.create-container`: `{ "x": 180, "y": 160, "role": "source" | "reference" }`. Omit `role` for a normal image container.
- `canvas.import`: `{ "paths": ["C:\\path\\image.png"], "targetContainerId": "optional-node-id", "x": 240, "y": 180 }`. Paths are copied into the active project before use.

## Agent

- `agent.chat`: `{ "prompt": "task", "sourceNodeIds": ["optional-node-id"] }`. Waits for the current Agent turn to settle and returns the final visible state.
- `agent.stop`: Stop the active turn.
- `agent.new-conversation`: Start a new conversation without clearing canvas results.

## Images and containers

For complex generation, editing, variants, cutout, redraw, and layer work, select the intended source nodes and use `agent.chat`. The naimage Agent preserves provenance and creates final result nodes through the same runtime as the GUI.

## Responses and errors

Successful output is JSON with `ok: true` and `result`. Failures are JSON with `ok: false` and `error`. A `rendererReady: false` status means the app is still loading; retry after a short delay. Do not expose endpoint authorization data in logs or user-visible output.
