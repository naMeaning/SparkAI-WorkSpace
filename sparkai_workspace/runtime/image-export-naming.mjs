export function cleanExportFilenamePart(value, fallback) {
  const normalized = String(value || "").normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim();
  return (normalized || fallback).slice(0, 100).replace(/[. ]+$/g, "") || fallback;
}

export function exportFilenameTemplateError(template) {
  if (!String(template || "").trim()) return "请输入命名模板。";
  const allowed = new Set(["title", "index", "asset", "group", "request"]);
  for (const match of String(template).matchAll(/\{([^{}]+)\}/g)) {
    if (!allowed.has(String(match[1] || "").toLowerCase())) return "命名模板只支持 {title}、{index}、{asset}、{group} 和 {request}。";
  }
  return "";
}

export function renderExportFilename(template, source, index) {
  const pattern = String(template || "{title}-{index}");
  const error = exportFilenameTemplateError(pattern);
  if (error) throw new Error(error);
  const title = cleanExportFilenamePart(source.title, "图片");
  const sequence = String(index + 1).padStart(3, "0");
  const values = { title, index: sequence, request: sequence,
    asset: cleanExportFilenamePart(source.assetId || source.key, `asset-${index + 1}`),
    group: cleanExportFilenamePart(source.groupName || title, "图片组") };
  return cleanExportFilenamePart(pattern.replace(/\{([^{}]+)\}/g, (_match, token) => values[token.toLowerCase()] || ""), `${title}-${sequence}`);
}
