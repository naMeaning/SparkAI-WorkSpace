export type RequirementTemplateVariable = {
  key: string;
  label: string;
  required?: boolean;
} & (
  | { type: "text"; maxLength?: number; default?: string }
  | { type: "enum"; options: string[]; default?: string }
  | { type: "number"; min?: number; max?: number; step?: number; default?: number }
  | { type: "image"; role?: "source" | "reference" }
);
export type RequirementTemplateFact = { text: string; source: "user" | "assumption" };
export type RequirementTemplateCriterion = RequirementTemplateFact & {
  criterionId: string;
  kind: "visual" | "source_consistency";
  slotIds?: string[];
  sourceVariables?: string[];
};
export type RequirementTemplateAcceptance = {
  goal?: RequirementTemplateFact;
  usage?: RequirementTemplateFact;
  slots: { slotId: string; label: string; source: "user" | "assumption" }[];
  preserve: RequirementTemplateCriterion[];
  adjustable: RequirementTemplateCriterion[];
  conditions: RequirementTemplateCriterion[];
  fileRules?: { formats?: string[]; width?: number; height?: number; minWidth?: number; minHeight?: number; alpha?: "any" | "required" | "forbidden" };
};
export type RequirementTemplate = {
  version: 2;
  variables: RequirementTemplateVariable[];
  scenario?: string;
  materialNotes?: string;
  styleNotes?: string;
  acceptance?: RequirementTemplateAcceptance;
};
export type RequirementTemplateImageBinding = { key: string; nodeId: string; role: "source" | "reference" };
export type RequirementTemplateSnapshot = {
  templateId: string;
  revision: number;
  fingerprint: string;
  variableValues: Record<string, string | number>;
};
export type RequirementTemplateApplication = {
  text: string;
  creationRequirements?: RequirementTemplateAcceptance;
  imageBindings: RequirementTemplateImageBinding[];
  unboundImages: RequirementTemplateVariable[];
  templateSnapshot: RequirementTemplateSnapshot;
};
export type RequirementTemplateDraft = Omit<RequirementTemplateApplication, "text" | "templateSnapshot">;
export const REQUIREMENT_TEMPLATE_LIMITS: Readonly<{ variables: number; text: number; value: number; options: number; slots: number; criteria: number }>;
export function reusableRequirementText(value: unknown, maximum?: number): string;
export function normalizeRequirementTemplate(value: unknown, body?: string): RequirementTemplate;
export function requirementTemplateFingerprint(value: unknown): string;
export function normalizeRequirementTemplateSnapshot(value: unknown): RequirementTemplateSnapshot | undefined;
export function normalizeRequirementTemplateDraft(value: unknown): RequirementTemplateDraft | undefined;
export function reusableRequirementTemplateFromTask(value: unknown): { title: string; text: string; template: RequirementTemplate };
export function expandRequirementTemplate(entry: { version: 1 | 2; id?: string; revision?: number; text?: string; template?: RequirementTemplate }, options?: {
  expectedTemplateRevision?: number;
  variableValues?: Record<string, string | number>;
  imageBindings?: RequirementTemplateImageBinding[];
}): RequirementTemplateApplication;
