import type { AgentTaskScope, TaskAssetReference } from "../src/core";
export function bindProjectContextMaterials(scope: AgentTaskScope, materials: (TaskAssetReference & { assetIndex?: number })[], role?: "source" | "reference"): AgentTaskScope;
