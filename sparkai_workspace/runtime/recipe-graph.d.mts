export type RecipeNodeType = "Input" | "Brief" | "Skill" | "Transform" | "Tool" | "Review" | "Output";
export type RecipePortDataType = "asset" | "image" | "video" | "text" | "brief" | "review" | "bundle" | "any";
export type RecipeGraphError = { path: string; code: string; message: string };
export type RecipeGraphPort = { portId: string; dataType: RecipePortDataType; required?: boolean };
export type RecipeGraphNode = {
  stepId: string;
  type: RecipeNodeType;
  inputPorts: RecipeGraphPort[];
  outputPorts: RecipeGraphPort[];
};
export type RecipeGraphEdge = {
  edgeId: string;
  fromStepId: string;
  fromPortId: string;
  toStepId: string;
  toPortId: string;
};
export type RecipeGraph = {
  inputSlots: Array<{ slotId: string; dataType: RecipePortDataType }>;
  outputContract: { outputs: Array<{ slotId: string; dataType: RecipePortDataType }> };
  nodes: RecipeGraphNode[];
  edges: RecipeGraphEdge[];
};
export type RecipeGraphValidation = {
  ok: boolean;
  errors: RecipeGraphError[];
  order?: string[];
};
export const RECIPE_NODE_TYPES: readonly RecipeNodeType[];
export function portsCompatible(fromType: string, toType: string): boolean;
export function validateRecipeGraph(recipe: unknown, options?: { requireComplete?: boolean }): RecipeGraphValidation;
export function topologicalRecipeSteps(recipe: unknown): string[] | undefined;
