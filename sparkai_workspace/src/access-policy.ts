import type { AppSettings } from "./core";

export type AppAccessPolicy = Readonly<{
  schemaVersion: 1;
  variant: "dual-access" | "sparkapi-account";
  customApiAccess: boolean;
  accountBaseUrlLocked: boolean;
  officialAccountBaseUrl: string;
}>;

declare const __SPARKAI_ACCESS_POLICY__: AppAccessPolicy;

export const appAccessPolicy: AppAccessPolicy = Object.freeze(__SPARKAI_ACCESS_POLICY__);

export function enforceRendererAccessPolicy(settings: AppSettings): AppSettings {
  if (!appAccessPolicy.accountBaseUrlLocked) return settings;
  return {
    ...settings,
    accessMode: "account",
    accountBaseUrl: appAccessPolicy.officialAccountBaseUrl,
    relayBaseUrl: "",
    updateBaseUrl: appAccessPolicy.officialAccountBaseUrl
  };
}
