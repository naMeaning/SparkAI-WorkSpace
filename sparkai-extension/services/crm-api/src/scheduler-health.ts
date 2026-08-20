import type { CrmSchedulerHealthDto } from "@ai-native/crm-contracts";

export interface SchedulerController<T> {
  start(): void;
  stop(): void;
  runNow(): Promise<T | null>;
  snapshot(): CrmSchedulerHealthDto;
}

interface SchedulerControllerOptions<T> {
  name: string;
  intervalMinutes: number;
  run: () => Promise<T>;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return "scheduler_run_failed";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "scheduler run failed");
}

export function createSchedulerController<T>({
  name,
  intervalMinutes,
  run
}: SchedulerControllerOptions<T>): SchedulerController<T> {
  const enabled = intervalMinutes > 0;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastStartedAt: string | null = null;
  let lastSuccessAt: string | null = null;
  let lastFailureAt: string | null = null;
  let lastErrorCode = "";
  let lastErrorMessage = "";

  const runNow = async (): Promise<T | null> => {
    if (running) return null;
    running = true;
    lastStartedAt = new Date().toISOString();
    try {
      const result = await run();
      lastSuccessAt = new Date().toISOString();
      lastErrorCode = "";
      lastErrorMessage = "";
      return result;
    } catch (error) {
      lastFailureAt = new Date().toISOString();
      lastErrorCode = errorCode(error);
      lastErrorMessage = errorMessage(error);
      throw error;
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (!enabled || timer) return;
      timer = setInterval(() => {
        void runNow().catch((error) => {
          console.error(`CRM scheduler ${name} failed`, error);
        });
      }, intervalMinutes * 60 * 1000);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    runNow,
    snapshot() {
      return {
        enabled,
        intervalMinutes,
        running,
        lastStartedAt,
        lastSuccessAt,
        lastFailureAt,
        lastErrorCode,
        lastErrorMessage
      };
    }
  };
}
