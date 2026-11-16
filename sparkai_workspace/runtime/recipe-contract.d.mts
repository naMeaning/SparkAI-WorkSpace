import type { RecipeNodeType, RecipePortDataType } from "./recipe-graph.mjs";

export type RecipeContractError = { path: string; code: string; message: string };
export type RecipeDependency = {
  kind: "skill" | "tool";
  id: string;
  version: string;
  contentHash: string;
};
export type RecipeSlot = {
  slotId: string;
  label: string;
  dataType: RecipePortDataType;
  required: boolean;
};
export type RecipeNodeRef = RecipeDependency;
export type RecipeNodeInputPort = { portId: string; label: string; dataType: RecipePortDataType; required: boolean };
export type RecipeNodeOutputPort = { portId: string; label: string; dataType: RecipePortDataType };
export type RecipeNode = {
  stepId: string;
  type: RecipeNodeType;
  title: string;
  ref?: RecipeNodeRef;
  inputPorts: RecipeNodeInputPort[];
  outputPorts: RecipeNodeOutputPort[];
  config?: Record<string, unknown>;
};
export type RecipeEdge = {
  edgeId: string;
  fromStepId: string;
  fromPortId: string;
  toStepId: string;
  toPortId: string;
};
export type RecipeOutputContract = {
  schemaVersion: 1;
  outputs: RecipeSlot[];
};
export type RecipeDocument = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  minAppVersion: string;
  license: string;
  dependencies: RecipeDependency[];
  inputSlots: RecipeSlot[];
  outputContract: RecipeOutputContract;
  nodes: RecipeNode[];
  edges: RecipeEdge[];
  tags: string[];
  contentHash: string;
};
export type RecipeDocumentValidation = { ok: boolean; errors: RecipeContractError[]; value?: RecipeDocument };
export const RECIPE_SCHEMA_VERSION: 1;
export const RECIPE_LIMITS: Readonly<{
  maxDescription: number;
  maxDependencies: number;
  maxInputSlots: number;
  maxOutputSlots: number;
  maxNodes: number;
  maxEdges: number;
  maxTags: number;
}>;
export function parseRecipeDocument(value: unknown, options?: { requireComplete?: boolean }): RecipeDocumentValidation;
export function normalizeRecipeDocument(value: unknown, options?: { requireComplete?: boolean }): RecipeDocument | undefined;
export function recipeContentHash(value: unknown): string;
export function sealRecipeDocument(value: unknown, options?: { requireComplete?: boolean }): RecipeDocument | undefined;
