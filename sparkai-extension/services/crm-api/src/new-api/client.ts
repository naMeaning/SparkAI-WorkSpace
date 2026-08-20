import type { CrmConfig, NewApiClient, NewApiUser } from "../types.js";

type FetchImpl = (input: URL, init?: RequestInit) => Promise<Response>;
type NewApiConfig = Pick<CrmConfig, "newApiBaseUrl" | "newApiAdminUserId" | "newApiAdminAccessToken">;

interface RequestOptions {
  method?: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
}

interface NewApiEnvelope<T> {
  success?: boolean;
  message?: string;
  data: T;
}

function assertServiceAuth(config: NewApiConfig): void {
  if (!config?.newApiAdminUserId || !config?.newApiAdminAccessToken) {
    throw new Error("new-api service auth is not configured");
  }
}

function buildUrl(baseUrl: string, path: string, query: Record<string, unknown> = {}): URL {
  const url = new URL(path, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function readNewApiResponse<T>(response: Response): Promise<NewApiEnvelope<T>> {
  const text = await response.text();
  const body = text ? JSON.parse(text) as NewApiEnvelope<T> : { data: null as T };
  if (!response.ok) {
    throw new Error(`new-api request failed status=${response.status} body=${text.slice(0, 300)}`);
  }
  if (body && body.success === false) {
    throw new Error(`new-api error: ${body.message || "unknown"}`);
  }
  return body;
}

export function createNewApiClient(config: NewApiConfig, fetchImpl: FetchImpl = globalThis.fetch): NewApiClient {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }
  const baseUrl = config.newApiBaseUrl;

  async function request<T>(path: string, options: RequestOptions = {}): Promise<NewApiEnvelope<T>> {
    assertServiceAuth(config);
    const response = await fetchImpl(buildUrl(baseUrl, path, options.query), {
      method: options.method || "GET",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.newApiAdminAccessToken}`,
        "New-Api-User": String(config.newApiAdminUserId),
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    return readNewApiResponse(response);
  }

  return {
    async getUser(newApiUserId: number) {
      const body = await request<NewApiUser>(`/api/user/${newApiUserId}`);
      return body.data;
    },

    async manageUserQuota({ newApiUserId, mode, value }) {
      return request("/api/user/manage", {
        method: "POST",
        body: {
          id: newApiUserId,
          action: "add_quota",
          mode,
          value
        }
      });
    },

    async listTopups({ page = 1, pageSize = 20, keyword = "" } = {}) {
      const body = await request<unknown>("/api/user/topup", {
        query: { p: page, page_size: pageSize, keyword }
      });
      return body.data;
    },

    async listConsumeLogs({ page = 1, pageSize = 20, username = "", startTimestamp = "", endTimestamp = "" } = {}) {
      const body = await request<unknown>("/api/log/", {
        query: {
          p: page,
          page_size: pageSize,
          type: 2,
          username,
          start_timestamp: startTimestamp,
          end_timestamp: endTimestamp
        }
      });
      return body.data;
    }
  };
}
