import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const {
  windowsInstallerArtifactName,
  windowsLegacyInstallerArtifactName
} = require(join(projectRoot, "runtime", "access-variant.cjs"));
const packageMetadata = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const version = String(packageMetadata.version || "").trim();
const releaseDir = join(projectRoot, "release");
const policyPath = join(projectRoot, "dist", "sparkai-access-policy.json");
const variants = Object.freeze({
  "dual-access": {
    accountOnly: "0",
    artifact: windowsInstallerArtifactName(version, "dual-access")
  },
  "sparkapi-account": {
    accountOnly: "1",
    artifact: windowsInstallerArtifactName(version, "sparkapi-account")
  }
});

function resolvePnpmInvocation() {
  const direct = String(process.env.npm_execpath || "").trim();
  if (direct.endsWith("pnpm.cjs") && existsSync(direct)) return { command: process.execPath, prefix: [direct] };
  if (process.platform !== "win32") return { command: "pnpm", prefix: [] };
  const located = spawnSync("where.exe", ["pnpm.cmd"], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
  for (const wrapper of String(located.stdout || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const cli = join(dirname(wrapper), "node_modules", "pnpm", "bin", "pnpm.cjs");
    if (existsSync(cli)) return { command: process.execPath, prefix: [cli] };
  }
  throw new Error("找不到可由 Node 直接执行的 pnpm.cjs。");
}

const pnpm = resolvePnpmInvocation();

async function run(command, args, environment = {}) {
  const code = await new Promise((resolveExit, rejectExit) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...environment }
    });
    child.on("error", rejectExit);
    child.on("exit", (value) => resolveExit(value ?? 1));
  });
  if (code !== 0) throw new Error(`${basename(command)} ${args.join(" ")} exited with code ${code}.`);
}

function variantEnvironment(variant) {
  return {
    SPARKAI_ACCESS_VARIANT: variant,
    SPARKAI_ACCOUNT_ONLY: variants[variant].accountOnly
  };
}

function verifyBuiltPolicy(variant) {
  if (!existsSync(policyPath)) throw new Error(`构建未生成接入策略：${policyPath}`);
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  if (policy.variant !== variant) throw new Error(`构建策略不匹配：期望 ${variant}，实际 ${policy.variant || "unknown"}。`);
  if (policy.customApiAccess !== (variant === "dual-access")) throw new Error(`构建策略的 customApiAccess 与 ${variant} 不一致。`);
}

function verifyVariantArtifact(variant) {
  const target = join(releaseDir, variants[variant].artifact);
  if (!existsSync(target)) throw new Error(`Windows 安装包不存在：${target}`);
  if (dirname(target) !== releaseDir) throw new Error("拒绝将接入变体安装包写到 release 目录之外。");
  const legacyArtifact = join(releaseDir, windowsLegacyInstallerArtifactName(version));
  if (existsSync(legacyArtifact)) throw new Error(`旧公开安装包名仍然泄漏到 release：${legacyArtifact}`);
  const bytes = readFileSync(target);
  return {
    variant,
    path: target,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

const packageRequested = process.argv.includes("--package");
const bundleEnforced = process.argv.includes("--enforce-bundle");
const requestedVariant = String(process.argv.find((value) => value.startsWith("--variant=")) || "").split("=").slice(1).join("=");
const requestedVariants = process.argv.includes("--both")
  ? ["dual-access", "sparkapi-account"]
  : [requestedVariant || "dual-access"];
for (const variant of requestedVariants) {
  if (!variants[variant]) throw new Error(`未知接入变体：${variant}`);
}

if (packageRequested) {
  await run(pnpm.command, [...pnpm.prefix, "run", "test:access-variant"]);
  await run(pnpm.command, [...pnpm.prefix, "run", "release:assets"]);
}

const outputs = [];
for (const variant of requestedVariants) {
  const environment = variantEnvironment(variant);
  await run(pnpm.command, [...pnpm.prefix, "run", "build"], environment);
  verifyBuiltPolicy(variant);
  if (!packageRequested) continue;
  if (bundleEnforced) await run(pnpm.command, [...pnpm.prefix, "run", "test:bundle"], environment);
  await run(process.execPath, [join(projectRoot, "scripts", "release", "build-windows.mjs"), "--nsis"], environment);
  outputs.push(verifyVariantArtifact(variant));
}

console.log(JSON.stringify({ packageRequested, bundleEnforced, variants: requestedVariants, outputs }, null, 2));
