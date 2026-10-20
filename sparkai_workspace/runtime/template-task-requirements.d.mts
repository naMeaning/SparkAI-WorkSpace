import type { AgentTaskScope } from "../src/core";
import type { RequirementTemplateDraft } from "./requirement-template-contract.mjs";
export function templateTaskRequirements(draft: RequirementTemplateDraft | undefined, scope: AgentTaskScope): Record<string, unknown> | undefined;
