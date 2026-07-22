import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const targetArg = process.argv.find((item) => item.startsWith("--target="));
const targetRoot = resolve(targetArg?.split("=").slice(1).join("=") || join(homedir(), "Desktop", "IMAGE"));
const dryRun = process.argv.includes("--dry-run");
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const categoryPriority = { historical: 1, layered: 2, "final-posters": 3 };

function normalizedPath(filePath) {
  return resolve(filePath).replaceAll("\\", "/");
}

function isPathInside(candidate, root) {
  const relation = relative(resolve(root), resolve(candidate));
  return relation === "" || (!relation.startsWith("..") && !relation.includes(":"));
}

function walkFiles(rootPath) {
  if (!existsSync(rootPath)) return [];
  const files = [];
  const pending = [resolve(rootPath)];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  return files;
}

function isImageFile(filePath) {
  return imageExtensions.has(extname(filePath).toLowerCase());
}

function isManagedImageOutput(filePath) {
  const normalized = normalizedPath(filePath).toLowerCase();
  return normalized.includes("/output/imagegen/") && !normalized.includes("/output/imagegen/imports/");
}

function reportUsesLiveImage(reportPath) {
  if (!existsSync(reportPath)) return false;
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    return report?.liveImage === true || report?.mode === "direct-live-image-tool";
  } catch {
    return false;
  }
}

function diagnosticProjectRoots(runPath) {
  const roots = [];
  for (const entry of readdirSync(runPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/config/i.test(entry.name)) continue;
    const projectsPath = join(runPath, entry.name, "projects");
    if (existsSync(projectsPath)) roots.push(projectsPath);
  }
  return roots;
}

function collectSources() {
  const sources = [];
  const showcaseRoot = join(repoRoot, "showcase");
  for (const filePath of walkFiles(showcaseRoot)) {
    if (isImageFile(filePath)) sources.push({ filePath, sourceType: "showcase" });
  }

  const projectRoot = join(repoRoot, "config", "projects");
  for (const filePath of walkFiles(projectRoot)) {
    if (isImageFile(filePath) && isManagedImageOutput(filePath)) {
      sources.push({ filePath, sourceType: "project-output" });
    }
  }

  const diagnosticsRoot = join(repoRoot, ".diagnostics", "electron");
  if (existsSync(diagnosticsRoot)) {
    for (const runEntry of readdirSync(diagnosticsRoot, { withFileTypes: true })) {
      if (!runEntry.isDirectory()) continue;
      const runPath = join(diagnosticsRoot, runEntry.name);
      if (!reportUsesLiveImage(join(runPath, "report.json"))) continue;
      for (const configRoot of diagnosticProjectRoots(runPath)) {
        for (const filePath of walkFiles(configRoot)) {
          if (isImageFile(filePath) && isManagedImageOutput(filePath)) {
            sources.push({ filePath, sourceType: "live-diagnostic", diagnosticRun: runEntry.name });
          }
        }
      }
    }
  }
  return sources;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function categoryFor(source) {
  if (source.sourceType === "showcase") return "final-posters";
  const normalized = normalizedPath(source.filePath).toLowerCase();
  if (
    normalized.includes("/layers/") ||
    normalized.includes("/cutout/") ||
    normalized.includes("/redraw/") ||
    normalized.includes("/masks/") ||
    /(?:^|[-_])(layer|layers|recomposed|transparent|mask)(?:[-_.]|$)/i.test(basename(source.filePath))
  ) {
    return "layered";
  }
  return "historical";
}

function safeFileName(value) {
  const sanitized = String(value || "image")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return sanitized || "image";
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

async function main() {
  const sourceEntries = collectSources();
  const byHash = new Map();
  for (const source of sourceEntries) {
    let fileStat;
    try {
      fileStat = statSync(source.filePath);
    } catch {
      continue;
    }
    if (!fileStat.isFile() || fileStat.size <= 0) continue;
    const hash = sha256(source.filePath);
    const category = categoryFor(source);
    const existing = byHash.get(hash);
    if (!existing) {
      byHash.set(hash, {
        hash,
        category,
        representative: source.filePath,
        bytes: fileStat.size,
        sources: [{ ...source, category }]
      });
      continue;
    }
    existing.sources.push({ ...source, category });
    if (categoryPriority[category] > categoryPriority[existing.category]) {
      existing.category = category;
      existing.representative = source.filePath;
      existing.bytes = fileStat.size;
    }
  }

  const records = [];
  const reservedDestinations = new Map();
  for (const item of [...byHash.values()].sort((left, right) => {
    const categoryOrder = categoryPriority[right.category] - categoryPriority[left.category];
    return categoryOrder || left.representative.localeCompare(right.representative, "zh-CN");
  })) {
    let metadata = {};
    try {
      metadata = await sharp(item.representative).metadata();
    } catch {
      metadata = {};
    }
    const originalName = safeFileName(basename(item.representative));
    const extension = extname(originalName).toLowerCase() || extname(item.representative).toLowerCase() || ".png";
    const stem = safeFileName(originalName.slice(0, Math.max(0, originalName.length - extension.length)) || "image");
    let archiveName = item.category === "final-posters"
      ? `${stem}${extension}`
      : `${item.hash.slice(0, 10)}-${stem}${extension}`;
    let archiveRelative = join(item.category, archiveName);
    const destinationKey = archiveRelative.toLowerCase();
    if (reservedDestinations.has(destinationKey) && reservedDestinations.get(destinationKey) !== item.hash) {
      archiveName = `${stem}-${item.hash.slice(0, 10)}${extension}`;
      archiveRelative = join(item.category, archiveName);
    }
    reservedDestinations.set(archiveRelative.toLowerCase(), item.hash);
    const destinationPath = join(targetRoot, archiveRelative);
    if (!dryRun) {
      mkdirSync(dirname(destinationPath), { recursive: true });
      let shouldCopy = true;
      if (existsSync(destinationPath)) {
        try {
          shouldCopy = sha256(destinationPath) !== item.hash;
        } catch {
          shouldCopy = true;
        }
      }
      if (shouldCopy) copyFileSync(item.representative, destinationPath);
    }
    records.push({
      archivePath: archiveRelative.replaceAll("\\", "/"),
      category: item.category,
      sha256: item.hash,
      bytes: item.bytes,
      width: Number(metadata.width || 0),
      height: Number(metadata.height || 0),
      format: String(metadata.format || extension.slice(1)),
      hasAlpha: Boolean(metadata.hasAlpha),
      sources: item.sources.map((source) => ({
        path: relative(repoRoot, source.filePath).replaceAll("\\", "/"),
        sourceType: source.sourceType,
        diagnosticRun: source.diagnosticRun || ""
      }))
    });
  }

  const counts = Object.fromEntries(
    ["final-posters", "historical", "layered"].map((category) => [
      category,
      records.filter((record) => record.category === category).length
    ])
  );
  const expectedArchivePaths = new Set(
    records.map((record) => normalizedPath(join(targetRoot, record.archivePath)).toLowerCase())
  );
  const staleArchiveImages = Object.keys(categoryPriority).flatMap((category) => {
    const categoryRoot = resolve(targetRoot, category);
    if (!isPathInside(categoryRoot, targetRoot)) {
      throw new Error(`Refusing to inspect archive category outside target root: ${categoryRoot}`);
    }
    return walkFiles(categoryRoot).filter((filePath) => (
      isImageFile(filePath) && !expectedArchivePaths.has(normalizedPath(filePath).toLowerCase())
    ));
  });
  if (!dryRun) {
    for (const filePath of staleArchiveImages) {
      if (!isPathInside(filePath, targetRoot)) {
        throw new Error(`Refusing to prune archive file outside target root: ${filePath}`);
      }
      rmSync(filePath, { force: true });
    }
  }
  const manifest = {
    archiveVersion: 1,
    generatedAt: new Date().toISOString(),
    repoRoot,
    targetRoot,
    dryRun,
    sourcePolicy: [
      "showcase/**/*",
      "config/projects/**/output/imagegen/**/* excluding imports",
      ".diagnostics/electron runs with report.liveImage=true, output/imagegen/**/* excluding imports",
      "SHA-256 deduplicated; source files are copied and never moved"
    ],
    candidateSourceCount: sourceEntries.length,
    uniqueImageCount: records.length,
    prunedImageCount: dryRun ? 0 : staleArchiveImages.length,
    staleImageCount: staleArchiveImages.length,
    counts,
    items: records
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const markdown = [
    "# IIimage Studio 图片成果归档",
    "",
    `生成时间：${manifest.generatedAt}`,
    "",
    "原文件仅复制、不移动；所有内容按 SHA-256 去重。诊断目录只收录明确标记 `liveImage=true` 的真实图片运行，导入参考图与 mock 夹具不进入归档。",
    "",
    "## 汇总",
    "",
    "| 分类 | 数量 |",
    "| --- | ---: |",
    `| final-posters | ${counts["final-posters"]} |`,
    `| historical | ${counts.historical} |`,
    `| layered | ${counts.layered} |`,
    `| 合计 | ${records.length} |`,
    "",
    "## 文件清单",
    "",
    "| 归档文件 | 尺寸 | Alpha | 来源数 | SHA-256 |",
    "| --- | --- | --- | ---: | --- |",
    ...records.map((record) => `| ${markdownCell(record.archivePath)} | ${record.width || "?"}×${record.height || "?"} | ${record.hasAlpha ? "是" : "否"} | ${record.sources.length} | ${record.sha256.slice(0, 16)} |`),
    ""
  ].join("\n");
  if (!dryRun) {
    mkdirSync(targetRoot, { recursive: true });
    writeFileSync(join(targetRoot, "manifest.json"), manifestJson, "utf8");
    writeFileSync(join(targetRoot, "manifest.md"), markdown, "utf8");
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    dryRun,
    targetRoot,
    candidateSourceCount: sourceEntries.length,
    uniqueImageCount: records.length,
    staleImageCount: staleArchiveImages.length,
    prunedImageCount: dryRun ? 0 : staleArchiveImages.length,
    counts
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
