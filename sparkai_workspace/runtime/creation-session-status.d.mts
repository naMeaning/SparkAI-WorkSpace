import type { CreationAcceptanceResult, CreationSessionSnapshot } from "../src/creation-session";
export function creationResultStatus(result: CreationAcceptanceResult): {
  generated: string; saved: string; local: string; ai: string; decision: string;
  localStatus?: "passed" | "failed" | "stale";
  aiStatus?: "pass" | "revise" | "uncertain" | "stale";
};
export function creationSessionSummary(session: CreationSessionSnapshot): {
  targetCount: number; savedCount: number; pendingCheckCount: number; doubtCount: number; adoptedCount: number; text: string;
};
