import { writeFileSync } from "node:fs";

export async function capturePngScreenshot(client, params = {}, timeoutMs = 15000, { missingData = "throw" } = {}) {
  const result = await client.send("Page.captureScreenshot", { format: "png", ...params }, timeoutMs);
  if (!result?.data && missingData === "null") return null;
  return Buffer.from(missingData === "empty" ? result?.data || "" : result.data, "base64");
}

export async function capturePngScreenshotToFile(client, filePath, params = {}, timeoutMs = 15000) {
  const buffer = await capturePngScreenshot(client, params, timeoutMs);
  writeFileSync(filePath, buffer);
  return filePath;
}
