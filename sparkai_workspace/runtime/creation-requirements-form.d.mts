import type { CreationCriterion, CreationRequirements, CreationRequirementsBody, CreationSlot, CreationText } from "../src/creation-session";
export type CreationRequirementsDraft = {
  goal: CreationText; usage: CreationText; slots: CreationSlot[]; preserve: CreationCriterion[]; adjustable: CreationCriterion[]; conditions: CreationCriterion[];
  formats: string; width: string; height: string; minWidth: string; minHeight: string; alpha: "any" | "required" | "forbidden";
};
export function creationLines(value: string): string[];
export function newCreationRowId(): string;
export function creationRequirementsDraft(value?: CreationRequirements | null): CreationRequirementsDraft;
export function creationRequirementsFromDraft(draft: CreationRequirementsDraft): CreationRequirementsBody;
export function creationDraftSignature(draft: CreationRequirementsDraft): string;
