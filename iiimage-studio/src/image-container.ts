/**
 * Compatibility facade for the canonical image-container domain.
 *
 * New code should import from the owning module directly:
 * - image-container-spec.ts: persisted spec sanitization and compatibility
 * - image-container-graph.ts: topology synchronization and canvas projection
 * - task-result-layout.ts: frozen TaskScope result planning and mutation
 */

export {
  applyImageContainerCompatibility,
  containerBoundarySummary,
  imageContainerKindForNode,
  imageContainerSpecForNode,
  nodeUsesImageContainer,
  sanitizeImageContainerSpec,
} from "./image-container-spec.ts";

export {
  deriveImageLayoutGroupsFromContainerSpecs,
  flattenImageContainerBindings,
  mergeLegacyImageLayoutGroups,
  sanitizeImageContainerGraph,
  synchronizeImageContainerSpecs,
} from "./image-container-graph.ts";

export { planTaskResultLayout } from "./task-result-layout.ts";
export type {
  TaskResultLayoutPartition,
  TaskResultLayoutPlan,
} from "./task-result-layout.ts";
