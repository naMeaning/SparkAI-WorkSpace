export type AutomationCommandErrorDetails = Record<string, unknown>;

export class AutomationCommandError extends Error {
  readonly code: string;
  readonly details?: AutomationCommandErrorDetails;

  constructor(code: string, message: string, details?: AutomationCommandErrorDetails) {
    super(message);
    this.name = "AutomationCommandError";
    this.code = String(code || "AUTOMATION_COMMAND_FAILED");
    this.details = details;
  }
}

export function automationCommandError(
  code: string,
  message: string,
  details?: AutomationCommandErrorDetails,
): AutomationCommandError {
  return new AutomationCommandError(code, message, details);
}

export function automationErrorPayload(error: unknown): {
  error: string;
  code?: string;
  details?: AutomationCommandErrorDetails;
} {
  if (error instanceof AutomationCommandError) {
    return {
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  if (error && typeof error === "object") {
    const source = error as { message?: unknown; code?: unknown; details?: unknown };
    const message = typeof source.message === "string" ? source.message : String(error);
    const code = typeof source.code === "string" && source.code.trim() ? source.code.trim() : undefined;
    const details = source.details && typeof source.details === "object" && !Array.isArray(source.details)
      ? source.details as AutomationCommandErrorDetails
      : undefined;
    return { error: message, ...(code ? { code } : {}), ...(details ? { details } : {}) };
  }
  return { error: String(error) };
}
