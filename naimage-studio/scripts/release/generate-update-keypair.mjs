import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const privateKeyPath = join(projectRoot, "config", "release-signing-private.pem");
const publicKeyPath = join(projectRoot, "build", "update-public-key.pem");
const force = process.argv.includes("--force");

if (!force && existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
  console.log(JSON.stringify({ generated: false, privateKeyPath, publicKeyPath }, null, 2));
  process.exit(0);
}

const pair = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});
mkdirSync(dirname(privateKeyPath), { recursive: true });
mkdirSync(dirname(publicKeyPath), { recursive: true });
writeFileSync(privateKeyPath, pair.privateKey, { encoding: "utf8", mode: 0o600 });
writeFileSync(publicKeyPath, pair.publicKey, "utf8");
console.log(JSON.stringify({ generated: true, privateKeyPath, publicKeyPath }, null, 2));
