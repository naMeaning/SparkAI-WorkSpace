import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDevMainConfig } from "./dev-main.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("buildDevMainConfig uses in-memory CRM storage by default", () => {
  const config = buildDevMainConfig({});

  assert.equal(config.crmStorage, "memory");
  assert.equal(config.crmScript, "dev:memory");
  assert.equal(config.shouldMigrateCrm, false);
  assert.equal("CRM_DATABASE_URL" in config.crmEnv, false);
  assert.equal(config.frontendPort, "17862");
  assert.equal(config.frontendDevUrl, "http://127.0.0.1:17862");
  assert.equal(config.frontendEnv.VITE_REACT_APP_SERVER_URL, "http://127.0.0.1:17860");
  assert.equal(config.frontendEnv.RSBUILD_DEV_SERVER_PORT, "17862");
  assert.equal(config.gatewayEnv.AI_GATEWAY_FRONTEND_DEV_SERVER, "true");
});

test("buildDevMainConfig supports explicit MySQL CRM storage with local defaults", () => {
  const config = buildDevMainConfig({
    CRM_DEV_STORAGE: "mysql"
  });

  assert.equal(config.crmStorage, "mysql");
  assert.equal(config.crmScript, "dev");
  assert.equal(config.shouldMigrateCrm, true);
  assert.equal(config.crmEnv.CRM_DATABASE_URL, "mysql://root@127.0.0.1:3306/ai_native_crm");
  assert.equal(config.crmEnv.CRM_DATABASE_NAME, "ai_native_crm");
});

test("buildDevMainConfig selects MySQL CRM storage when CRM_DATABASE_URL is provided", () => {
  const config = buildDevMainConfig({
    CRM_DATABASE_URL: "mysql://crm_user:pass@127.0.0.1:3306/custom_crm",
    CRM_DATABASE_NAME: "custom_crm"
  });

  assert.equal(config.crmStorage, "mysql");
  assert.equal(config.crmScript, "dev");
  assert.equal(config.crmEnv.CRM_DATABASE_URL, "mysql://crm_user:pass@127.0.0.1:3306/custom_crm");
  assert.equal(config.crmEnv.CRM_DATABASE_NAME, "custom_crm");
});

test("buildDevMainConfig rejects unknown CRM storage modes", () => {
  assert.throws(
    () => buildDevMainConfig({ CRM_DEV_STORAGE: "sqlite" }),
    /CRM_DEV_STORAGE must be memory or mysql/
  );
});

test("buildDevMainConfig supports custom frontend dev server port", () => {
  const config = buildDevMainConfig({
    NAIMAGE_SERVER_PORT: "19060",
    NAIMAGE_WEB_PORT: "19062"
  });

  assert.equal(config.newApiBaseUrl, "http://127.0.0.1:19060");
  assert.equal(config.frontendPort, "19062");
  assert.equal(config.frontendDevUrl, "http://127.0.0.1:19062");
  assert.equal(config.frontendEnv.VITE_REACT_APP_SERVER_URL, "http://127.0.0.1:19060");
  assert.equal(config.frontendEnv.RSBUILD_DEV_SERVER_PORT, "19062");
});

test("buildDevMainConfig supports canonical NAIMAGE local environment configuration", () => {
  const config = buildDevMainConfig({
    NAIMAGE_SERVER_PORT: "19160",
    NAIMAGE_WEB_PORT: "19162",
    NAIMAGE_SERVER_DATA_DIR: "naimage-data",
    NAIMAGE_WEB_URL: "http://127.0.0.1:19163"
  });

  assert.equal(config.gatewayPort, "19160");
  assert.equal(config.frontendPort, "19162");
  assert.equal(config.gatewayDataDir, "naimage-data");
  assert.equal(config.frontendDevUrl, "http://127.0.0.1:19163");
  assert.equal(config.gatewayEnv.NAIMAGE_SERVER_PORT, "19160");
});

test("New API web dev server defaults to the local gateway and CRM hot-reload port", () => {
  const source = readFileSync(
    join(repoRoot, "services", "ai-gateway", "new-api", "web", "default", "rsbuild.config.ts"),
    "utf8"
  );

  assert.match(source, /'http:\/\/127\.0\.0\.1:17860'/);
  assert.match(source, /RSBUILD_DEV_SERVER_PORT/);
  assert.match(source, /17862/);
  assert.match(source, /strictPort:\s*true/);
});
