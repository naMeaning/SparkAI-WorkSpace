import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { corsHeadersForResponse, fail, httpError, readJsonBody } from "../http.js";
import type { CrmConfig, CrmRepository, CrmUserContext } from "../types.js";

const attachmentContentTypes: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/pdf": ".pdf"
};

function uploadBodyLimit(maxBytes: number): number {
  return Math.max(1024 * 1024, Math.ceil(maxBytes * 1.5) + 4096);
}

function parseAttachmentBody(body: Record<string, unknown>, maxBytes: number): {
  buffer: Buffer;
  contentType: string;
  extension: string;
} {
  const contentType = String(body.contentType || "").trim().toLowerCase();
  const dataBase64 = String(body.dataBase64 || "").trim();
  if (!contentType || !dataBase64 || !attachmentContentTypes[contentType]) {
    throw httpError("CRM attachment is invalid", 400, "crm_attachment_invalid");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
    throw httpError("CRM attachment base64 is invalid", 400, "crm_attachment_invalid");
  }
  const buffer = Buffer.from(dataBase64, "base64");
  if (buffer.byteLength <= 0) {
    throw httpError("CRM attachment is empty", 400, "crm_attachment_invalid");
  }
  if (buffer.byteLength > maxBytes) {
    throw httpError("CRM attachment is too large", 413, "crm_attachment_too_large");
  }
  return {
    buffer,
    contentType,
    extension: attachmentContentTypes[contentType]
  };
}

function attachmentFileName(extension: string): string {
  return `${randomBytes(16).toString("hex")}${extension}`;
}

function safeAttachmentPath(storageDir: string, fileName: string): string {
  const safeName = basename(fileName);
  if (safeName !== fileName || !/^[a-f0-9]{32}\.(png|jpg|webp|pdf)$/.test(safeName)) {
    throw httpError("CRM attachment was not found", 404, "crm_attachment_not_found");
  }
  return join(storageDir, safeName);
}

function contentTypeForAttachment(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  for (const [contentType, configuredExtension] of Object.entries(attachmentContentTypes)) {
    if (extension === configuredExtension) return contentType;
  }
  return "application/octet-stream";
}

export async function uploadAttachmentRoute({
  req,
  config,
  context,
  repository
}: {
  req: IncomingMessage;
  config: Pick<CrmConfig, "attachmentStorageDir" | "attachmentMaxBytes">;
  context: CrmUserContext;
  repository: Pick<CrmRepository, "insertAuditLog">;
}) {
  const body = await readJsonBody(req, uploadBodyLimit(config.attachmentMaxBytes));
  const attachment = parseAttachmentBody(body, config.attachmentMaxBytes);
  const fileName = attachmentFileName(attachment.extension);
  await mkdir(config.attachmentStorageDir, { recursive: true });
  await writeFile(join(config.attachmentStorageDir, fileName), attachment.buffer, { flag: "wx" });
  const uploaded = {
    url: `/crm/attachments/${fileName}`,
    fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.buffer.byteLength
  };
  await repository.insertAuditLog({
    operatorCrmUserId: context.crmUserId,
    targetType: "attachment",
    targetId: fileName,
    action: "attachment.upload",
    reason: "CRM evidence attachment uploaded",
    before: null,
    after: uploaded
  });
  return uploaded;
}

export async function writeAttachmentResponse({
  res,
  config,
  fileName
}: {
  res: ServerResponse;
  config: Pick<CrmConfig, "attachmentStorageDir">;
  fileName: string;
}): Promise<void> {
  const filePath = safeAttachmentPath(config.attachmentStorageDir, decodeURIComponent(fileName));
  let info;
  try {
    info = await stat(filePath);
  } catch {
    fail(res, 404, "crm_attachment_not_found");
    return;
  }
  res.writeHead(200, {
    "content-type": contentTypeForAttachment(fileName),
    "content-length": String(info.size),
    "cache-control": "private, no-store",
    ...corsHeadersForResponse(res)
  });
  res.end(await readFile(filePath));
}
