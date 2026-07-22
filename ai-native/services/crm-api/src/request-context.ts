import { AsyncLocalStorage } from "node:async_hooks";

export interface CrmRequestContext {
  requestIp: string;
  userAgent: string;
}

const requestContextStorage = new AsyncLocalStorage<CrmRequestContext>();

export function runWithCrmRequestContext<T>(context: CrmRequestContext, work: () => T): T {
  return requestContextStorage.run(context, work);
}

export function getCrmRequestContext(): CrmRequestContext | null {
  return requestContextStorage.getStore() || null;
}
