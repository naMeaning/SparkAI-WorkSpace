import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig } from "./config.mjs";
import { openDatabase } from "./database.mjs";
import { createExtensionHttpServer, closeServer, listen } from "./http-server.mjs";
import { ImageTaskService } from "./image-task-service.mjs";
import { LicenseService } from "./license-service.mjs";

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });
const database = openDatabase(join(config.dataDir, "sparkai-extension.sqlite"));
const licenseService = new LicenseService({ database, hashSecret: config.hashSecret });
const imageTaskService = new ImageTaskService({
  database,
  hashSecret: config.hashSecret,
  resultsDir: join(config.dataDir, "image-task-results"),
  upstreamBaseUrl: config.newApiUpstream,
  concurrency: config.imageConcurrency,
  timeoutMs: config.imageTimeoutMs,
  maxResultBytes: config.maxResultBytes,
  retentionHours: config.taskRetentionHours
});
await imageTaskService.initialize();
const server = createExtensionHttpServer({ config, licenseService, imageTaskService });
const address = await listen(server, config);
console.log(`SparkAI extension listening on ${typeof address === "object" ? `${address.address}:${address.port}` : String(address)}`);
console.log(`Image tasks forward to ${config.newApiUpstream} through the private upstream route.`);

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`SparkAI extension stopping signal=${signal}`);
  await closeServer(server).catch(() => undefined);
  await imageTaskService.shutdown();
  database.close();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}
