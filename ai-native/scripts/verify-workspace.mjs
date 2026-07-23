import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "pnpm-workspace.yaml",
  "scripts/check.mjs",
  "scripts/dev-main.mjs",
  "scripts/diagnostics/crm-ui-audit.mjs",
  "services/ai-gateway/package.json",
  "services/ai-gateway/server.cjs",
  "services/ai-gateway/diagnostics/server-check.mjs",
  "services/ai-gateway/new-api/go.mod",
  "services/ai-gateway/new-api/web/default/package.json",
  "services/crm-api/package.json",
  "services/crm-api/tsconfig.json",
  "packages/shared/package.json",
  "packages/crm-contracts/package.json",
  "packages/crm-contracts/tsconfig.json"
];

const forbiddenPaths = [
  "apps",
  "services/ai-gateway/启动iiimageServer.exe",
  "services/ai-gateway/启动naimageServer.exe",
  "services/ai-gateway/AIDEBUG",
  "services/ai-gateway/AIDEBUG/诊断iiimageServer.cmd",
  "services/ai-gateway/AIDEBUG/诊断naimageServer.cmd",
  "scripts/setup.ps1",
  "scripts/start.ps1",
  "scripts/setup.mjs",
  "scripts/start.mjs"
];

const expectedPackages = new Map([
  ["services/ai-gateway/package.json", "@ai-native/ai-gateway"],
  ["services/crm-api/package.json", "@ai-native/crm-api"],
  ["packages/shared/package.json", "@ai-native/shared"],
  ["packages/crm-contracts/package.json", "@ai-native/crm-contracts"]
]);

const requiredRootScripts = [
  "verify:workspace",
  "dev",
  "dev:main",
  "start",
  "build",
  "build:main",
  "check",
  "dev:gateway",
  "build:gateway",
  "diagnostics:gateway",
  "diagnostics:crm-ui",
  "smoke:gateway",
  "crm:check"
];

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) {
    fail(`Missing required workspace file: ${file}`);
  }
}

for (const file of forbiddenPaths) {
  if (existsSync(path.join(root, file))) {
    fail(`Unexpected workspace path exists: ${file}`);
  }
}

const workspace = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
for (const pattern of ["services/*", "packages/*"]) {
  if (!workspace.includes(pattern)) {
    fail(`pnpm-workspace.yaml missing pattern: ${pattern}`);
  }
}
if (workspace.includes("apps/*")) {
  fail("pnpm-workspace.yaml must use services/* and packages/* workspace groups");
}

const rootPackage = readJson("package.json");
if (rootPackage.packageManager && !String(rootPackage.packageManager).startsWith("pnpm@")) {
  fail("Root packageManager must use pnpm");
}
if (!rootPackage.engines?.node || !rootPackage.engines?.pnpm) {
  fail("Root package.json must declare Node and pnpm engines");
}
if (rootPackage.scripts?.dev !== "pnpm run dev:main") {
  fail("Root dev script must start the unified main stack");
}
if (rootPackage.scripts?.start !== "pnpm run dev:main") {
  fail("Root start script must start the unified main stack");
}
if (rootPackage.scripts?.build !== "pnpm run build:main") {
  fail("Root build script must build the unified main product");
}
if (rootPackage.scripts?.["build:main"] !== "pnpm run build:gateway") {
  fail("Root build:main script must build the gateway/New API product");
}
if (rootPackage.scripts?.check !== "node scripts/check.mjs") {
  fail("Root check script must point to scripts/check.mjs");
}
for (const script of requiredRootScripts) {
  if (!rootPackage.scripts?.[script]) {
    fail(`Root package.json missing script: ${script}`);
  }
}
for (const script of Object.keys(rootPackage.scripts || {})) {
  if (!requiredRootScripts.includes(script)) {
    fail(`Unexpected root script: ${script}`);
  }
}

const gatewayPackage = readJson("services/ai-gateway/package.json");
const gatewayServer = readFileSync(path.join(root, "services/ai-gateway/server.cjs"), "utf8");
if (gatewayPackage.scripts?.diagnostics !== "node diagnostics/server-check.mjs") {
  fail("AI gateway diagnostics script must point to diagnostics/server-check.mjs");
}
if (!gatewayServer.includes('"--linker", "isolated"')) {
  fail("AI gateway must install New API web dependencies with Bun isolated linker");
}

const crmApiPackage = readJson("services/crm-api/package.json");
if (crmApiPackage.dependencies?.["@ai-native/crm-contracts"] !== "workspace:*") {
  fail("CRM API must consume CRM contracts through workspace dependency");
}
if (crmApiPackage.dependencies?.["@ai-native/shared"] !== "workspace:*") {
  fail("CRM API must consume shared helpers through workspace dependency");
}
if (crmApiPackage.scripts?.["dev:memory"] !== "tsx src/scripts/dev-memory.ts") {
  fail("CRM API must keep the embedded memory dev entry for dev:main");
}
if (crmApiPackage.scripts?.check !== "pnpm run typecheck && pnpm run test") {
  fail("CRM API check script must typecheck and test TypeScript sources");
}
const requiredCrmApiScripts = [
  "dev",
  "dev:memory",
  "start",
  "migrate",
  "smoke:real",
  "test",
  "typecheck",
  "check"
];
for (const script of requiredCrmApiScripts) {
  if (!crmApiPackage.scripts?.[script]) {
    fail(`CRM API package.json missing script: ${script}`);
  }
}
for (const script of Object.keys(crmApiPackage.scripts || {})) {
  if (!requiredCrmApiScripts.includes(script)) {
    fail(`Unexpected CRM API script: ${script}`);
  }
}

const crmContractsPackage = readJson("packages/crm-contracts/package.json");
if (crmContractsPackage.exports?.["."] !== "./src/index.ts") {
  fail("CRM contracts must export the TypeScript source entry");
}
if (crmContractsPackage.scripts?.check !== "pnpm run typecheck && pnpm run test") {
  fail("CRM contracts check script must typecheck and test TypeScript contracts");
}

for (const [file, expectedName] of expectedPackages) {
  const pkg = readJson(file);
  if (pkg.name !== expectedName) {
    fail(`${file} expected package name ${expectedName}, found ${pkg.name || "<missing>"}`);
  }
}

console.log("Unified workspace structure verified.");
