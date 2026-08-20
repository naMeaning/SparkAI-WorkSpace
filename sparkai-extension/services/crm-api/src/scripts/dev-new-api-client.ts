import { createNewApiClient } from "../new-api/client.js";
import type { CrmConfig, NewApiClient } from "../types.js";

type DevNewApiConfig = Pick<
  CrmConfig,
  "newApiBaseUrl" | "newApiAdminUserId" | "newApiAdminAccessToken"
>;

type FetchImpl = (input: URL, init?: RequestInit) => Promise<Response>;

function createSimulatedNewApiClient(): NewApiClient {
  return {
    async getUser(newApiUserId) {
      return {
        id: newApiUserId,
        username: `newapi_${newApiUserId}`,
        quota: 100000000
      };
    },
    async manageUserQuota() {
      return { ok: true, simulated: true };
    },
    async listTopups() {
      return { items: [], total: 0 };
    },
    async listConsumeLogs() {
      return { items: [], total: 0 };
    }
  };
}

export function createDevNewApiClient(
  config: DevNewApiConfig,
  fetchImpl: FetchImpl = globalThis.fetch
): NewApiClient {
  if (config.newApiAdminUserId && config.newApiAdminAccessToken) {
    return createNewApiClient(config, fetchImpl);
  }
  return createSimulatedNewApiClient();
}
