import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "package.json",
  "pnpm-workspace.yaml",
  "services/sparkai-extension/package.json",
  "services/sparkai-extension/src/main.mjs",
  "services/sparkai-extension/src/license-service.mjs",
  "services/sparkai-extension/src/image-task-service.mjs",
  "services/sparkai-extension/test/extension.test.mjs",
  "deploy/sparkai-extension/Dockerfile",
  "deploy/sparkai-extension/compose.yaml",
  "deploy/sparkai-extension/Caddyfile.example"
];
for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) throw new Error(`Missing SparkAI extension file: ${file}`);
}

const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const expectedScripts = {
  dev: "pnpm --filter @sparkai/extension dev",
  start: "pnpm --filter @sparkai/extension start",
  build: "pnpm --filter @sparkai/extension build",
  test: "pnpm --filter @sparkai/extension test",
  check: "node scripts/check.mjs"
};
for (const [name, value] of Object.entries(expectedScripts)) {
  if (rootPackage.scripts?.[name] !== value) throw new Error(`Root script ${name} must target @sparkai/extension.`);
}
for (const value of Object.values(rootPackage.scripts || {})) {
  if (/ai-gateway|new-api|crm-api/i.test(value)) throw new Error(`Active root script still targets legacy stack: ${value}`);
}

const extensionPackage = JSON.parse(readFileSync(join(root, "services/sparkai-extension/package.json"), "utf8"));
if (extensionPackage.name !== "@sparkai/extension") throw new Error("Unexpected extension package name.");
if (!String(extensionPackage.engines?.node || "").includes("24")) throw new Error("SparkAI extension must require Node.js 24 for node:sqlite.");

const caddy = readFileSync(join(root, "deploy/sparkai-extension/Caddyfile.example"), "utf8");
for (const route of ["/api/naimage/license", "/v1/image-tasks"]) {
  if (!caddy.includes(route)) throw new Error(`Caddy example missing extension route: ${route}`);
}
if (!caddy.includes("reverse_proxy 127.0.0.1:3000")) throw new Error("Caddy example must preserve the stock New API catch-all.");

console.log("SparkAI extension workspace structure verified. Legacy New API/CRM sources are not active root entry points.");
