"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { spawn: spawnProcess } = require("node:child_process");
const { createReadStream } = require("node:fs");
const {
  access,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} = require("node:fs/promises");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");

const schema = require("../plugins/scientific-figure-schema.json");
const {
  normalizeScientificFigurePlan,
  scientificFigurePlanIssues
} = require("../runtime/scientific-figure-plan.cjs");

const JOURNAL_VERSION = 1;
const REGISTRY_VERSION = 1;
const OUTPUT_MIME = Object.freeze({
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".py": "text/x-python",
  ".r": "text/x-r-source",
  ".json": "application/json",
  ".md": "text/markdown",
  ".txt": "text/plain"
});
const TASK_STATES = new Set(["prepared", "running", "ready", "failed", "cancelled", "interrupted"]);
const DATA_EXTENSIONS = new Set(schema.dataExtensions);
const OUTPUT_EXTENSIONS = new Set(Object.keys(OUTPUT_MIME));
const MAX_DELIMITED_RECORD_CHARS = 4 * 1024 * 1024;

class ScientificRunnerError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ScientificRunnerError";
    this.code = code;
    if (details && typeof details === "object") this.details = details;
  }
}

function cleanText(value, maximum = 4_096) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function safeSegment(value, fallback = "item") {
  const result = cleanText(value, 180)
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, 88);
  return result && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result) ? result : `_${result || fallback}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function readPrefix(filePath, length) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function validateScientificOutputFile(filePath, extension, size) {
  if (!Number.isFinite(size) || size <= 0) {
    throw new ScientificRunnerError("SCIENTIFIC_OUTPUT_EMPTY", `科研输出 ${path.basename(filePath)} 为空文件。`);
  }
  const normalizedExtension = String(extension || "").toLowerCase();
  if (normalizedExtension === ".png") {
    const prefix = await readPrefix(filePath, 24);
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (prefix.length < 24 || !prefix.subarray(0, 8).equals(signature) || prefix.toString("ascii", 12, 16) !== "IHDR") {
      throw new ScientificRunnerError("SCIENTIFIC_OUTPUT_SIGNATURE_INVALID", `科研输出 ${path.basename(filePath)} 不是有效 PNG。`);
    }
    const width = prefix.readUInt32BE(16);
    const height = prefix.readUInt32BE(20);
    if (!width || !height || width > 100_000 || height > 100_000) {
      throw new ScientificRunnerError("SCIENTIFIC_OUTPUT_DIMENSIONS_INVALID", `科研输出 ${path.basename(filePath)} 的 PNG 尺寸无效。`);
    }
    return { width, height };
  }
  if (normalizedExtension === ".tif" || normalizedExtension === ".tiff") {
    const prefix = await readPrefix(filePath, 4);
    const littleEndian = prefix.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00]));
    const bigEndian = prefix.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]));
    if (!littleEndian && !bigEndian) {
      throw new ScientificRunnerError("SCIENTIFIC_OUTPUT_SIGNATURE_INVALID", `科研输出 ${path.basename(filePath)} 不是有效 TIFF。`);
    }
    return {};
  }
  if (normalizedExtension === ".pdf") {
    const prefix = await readPrefix(filePath, 5);
    if (prefix.toString("ascii") !== "%PDF-") {
      throw new ScientificRunnerError("SCIENTIFIC_OUTPUT_SIGNATURE_INVALID", `科研输出 ${path.basename(filePath)} 不是有效 PDF。`);
    }
    return {};
  }
  if (normalizedExtension === ".svg") {
    const source = await readFile(filePath, "utf8");
    const knownMatplotlibDoctype = /<!DOCTYPE\s+svg\s+PUBLIC\s+"-\/\/W3C\/\/DTD SVG 1\.1\/\/EN"\s+"http:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd"\s*>/i;
    const sanitizedSource = source.replace(knownMatplotlibDoctype, "");
    if (!/<svg(?:\s|>)/i.test(sanitizedSource) || /<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|<\?xml-stylesheet|@import\b/i.test(sanitizedSource)) {
      throw new ScientificRunnerError("SCIENTIFIC_SVG_UNSAFE", `科研输出 ${path.basename(filePath)} 包含不安全的 SVG 内容。`);
    }
    if (/\son[a-z]+\s*=/i.test(sanitizedSource)) {
      throw new ScientificRunnerError("SCIENTIFIC_SVG_UNSAFE", `科研输出 ${path.basename(filePath)} 包含 SVG 事件处理器。`);
    }
    if (/\b(?:href|xlink:href)\s*=\s*["']\s*(?!#|data:image\/(?:png|jpeg|jpg|webp);base64,)[^"']+/i.test(sanitizedSource)) {
      throw new ScientificRunnerError("SCIENTIFIC_SVG_EXTERNAL_RESOURCE", `科研输出 ${path.basename(filePath)} 引用了外部资源。`);
    }
    if (/url\(\s*["']?\s*(?!#|data:image\/(?:png|jpeg|jpg|webp);base64,)[^)]+/i.test(sanitizedSource)) {
      throw new ScientificRunnerError("SCIENTIFIC_SVG_EXTERNAL_RESOURCE", `科研输出 ${path.basename(filePath)} 包含外部 CSS 资源。`);
    }
    return sanitizedSource === source ? {} : { sanitizedText: sanitizedSource };
  }
  if (normalizedExtension === ".json") {
    try {
      JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      throw new ScientificRunnerError("SCIENTIFIC_OUTPUT_JSON_INVALID", `科研输出 ${path.basename(filePath)} 不是有效 JSON。`);
    }
  }
  return {};
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(fallback);
    throw new ScientificRunnerError("SCIENTIFIC_JOURNAL_INVALID", "科研任务记录已损坏，未执行任何任务。", { file: path.basename(filePath) });
  }
}

function parseDelimitedRow(text, delimiter) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else if (cell.length < 4_096) {
        cell += character;
      }
    } else if (character === '"' && !cell) {
      quoted = true;
    } else if (character === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (cell.length < 4_096) {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

async function inspectDelimitedFile(filePath, extension) {
  const delimiter = extension === ".tsv" ? "\t" : ",";
  const input = createReadStream(filePath);
  const decoder = new StringDecoder("utf8");
  let recordText = "";
  let inQuotedField = false;
  let quotePending = false;
  let atFieldStart = true;
  let header = null;
  let rowCount = 0;
  const sampleRows = [];

  const consume = (rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!header && !line.trim()) return;
    if (!header) {
      const parsed = parseDelimitedRow(line.replace(/^\uFEFF/, ""), delimiter).map((item) => item.trim());
      if (!parsed.length || parsed.length > schema.limits.maxFieldsPerSource) {
        throw new ScientificRunnerError("SCIENTIFIC_DATA_COLUMNS_INVALID", `科研数据字段数必须在 1–${schema.limits.maxFieldsPerSource} 之间。`);
      }
      if (parsed.some((item) => !item || item.length > schema.limits.maxFieldLength)) {
        throw new ScientificRunnerError("SCIENTIFIC_DATA_HEADER_INVALID", "字段名不能为空，且不能超过 160 个字符。请先整理表头。 ");
      }
      const normalized = parsed.map((item) => item.toLocaleLowerCase());
      if (new Set(normalized).size !== normalized.length) {
        throw new ScientificRunnerError("SCIENTIFIC_DATA_HEADER_DUPLICATE", "数据表包含重复字段名，请重命名后重新导入。");
      }
      header = parsed;
      return;
    }
    if (!line.trim()) return;
    rowCount += 1;
    if (sampleRows.length >= schema.limits.maxSampleRows) return;
    const cells = parseDelimitedRow(line, delimiter);
    const sample = {};
    header.forEach((field, index) => {
      sample[field] = cleanText(cells[index], schema.limits.maxSampleCellLength);
    });
    sampleRows.push(sample);
  };

  const append = (character) => {
    recordText += character;
    if (recordText.length > MAX_DELIMITED_RECORD_CHARS) {
      throw new ScientificRunnerError("SCIENTIFIC_DATA_RECORD_TOO_LARGE", "科研数据包含超过 4 MiB 的单行记录，请先拆分异常单元格。");
    }
  };

  const consumeChunk = (text) => {
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (inQuotedField) {
        if (quotePending) {
          if (character === '"') {
            append(character);
            quotePending = false;
            continue;
          }
          inQuotedField = false;
          quotePending = false;
          index -= 1;
          continue;
        }
        append(character);
        if (character === '"') quotePending = true;
        continue;
      }
      if (character === '"' && atFieldStart) {
        append(character);
        inQuotedField = true;
        quotePending = false;
        atFieldStart = false;
      } else if (character === delimiter) {
        append(character);
        atFieldStart = true;
      } else if (character === "\n") {
        consume(recordText);
        recordText = "";
        atFieldStart = true;
      } else {
        append(character);
        atFieldStart = false;
      }
    }
  };

  try {
    for await (const chunk of input) {
      consumeChunk(decoder.write(chunk));
    }
    consumeChunk(decoder.end());
    if (quotePending) {
      quotePending = false;
      inQuotedField = false;
    }
    if (inQuotedField) {
      throw new ScientificRunnerError("SCIENTIFIC_DATA_QUOTE_UNTERMINATED", "科研数据包含未闭合的引号字段，请修复 CSV/TSV 后重新导入。");
    }
    if (recordText) consume(recordText);
  } finally {
    input.destroy();
  }
  if (!header) throw new ScientificRunnerError("SCIENTIFIC_DATA_EMPTY", "数据文件没有可识别的表头。");
  return { delimiter, fields: header, rowCount, columnCount: header.length, sampleRows };
}

function normalizeDataRecord(value, projectId) {
  const source = value && typeof value === "object" ? value : {};
  const id = cleanText(source.id, 80).toLowerCase();
  const contentHash = cleanText(source.contentHash, 64).toLowerCase();
  const relativePath = cleanText(source.relativePath, 1_000).replace(/\\/g, "/");
  if (!/^scientific-data-[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(contentHash) || !/^\.naimage\/scientific\/data\/[a-z0-9._-]+$/i.test(relativePath)) return null;
  return {
    id,
    projectId,
    sourceName: safeSegment(source.sourceName, "data"),
    contentHash,
    size: Math.max(0, Math.floor(Number(source.size) || 0)),
    rowCount: Math.max(0, Math.floor(Number(source.rowCount) || 0)),
    columnCount: Math.max(0, Math.floor(Number(source.columnCount) || 0)),
    fields: (Array.isArray(source.fields) ? source.fields : []).map((item) => cleanText(item, schema.limits.maxFieldLength)).filter(Boolean).slice(0, schema.limits.maxFieldsPerSource),
    delimiter: source.delimiter === "\t" ? "\t" : ",",
    relativePath,
    importedAt: cleanText(source.importedAt, 80)
  };
}

function publicDataSource(item) {
  return {
    id: item.id,
    sourceName: item.sourceName,
    contentHash: item.contentHash,
    size: item.size,
    rowCount: item.rowCount,
    columnCount: item.columnCount,
    fields: [...item.fields],
    delimiter: item.delimiter
  };
}

function normalizeOutput(value) {
  const source = value && typeof value === "object" ? value : {};
  const relativePath = cleanText(source.relativePath, 1_000).replace(/\\/g, "/");
  const contentHash = cleanText(source.contentHash, 64).toLowerCase();
  if (!relativePath || !/^[a-f0-9]{64}$/.test(contentHash)) return null;
  return {
    outputId: cleanText(source.outputId, 80),
    kind: ["panel", "figure", "script", "log", "qa", "source-data"].includes(source.kind) ? source.kind : "figure",
    format: cleanText(source.format, 16).toLowerCase(),
    name: safeSegment(source.name, "output"),
    relativePath,
    assetUrl: cleanText(source.assetUrl, 8_192),
    mimeType: cleanText(source.mimeType, 120),
    size: Math.max(0, Math.floor(Number(source.size) || 0)),
    contentHash,
    panelId: cleanText(source.panelId, 80) || undefined,
    width: Number.isFinite(Number(source.width)) ? Math.max(1, Math.floor(Number(source.width))) : undefined,
    height: Number.isFinite(Number(source.height)) ? Math.max(1, Math.floor(Number(source.height))) : undefined
  };
}

function normalizeTask(value, projectId) {
  const source = value && typeof value === "object" ? value : {};
  const taskId = cleanText(source.taskId, 80).toLowerCase();
  if (!/^scientific-task-[a-f0-9]{32}$/.test(taskId) || source.projectId !== projectId) return null;
  const plan = normalizeScientificFigurePlan(source.plan);
  const state = TASK_STATES.has(source.state) ? source.state : "failed";
  return {
    taskId,
    projectId,
    workflowId: plan.workflowId,
    planHash: plan.planHash,
    requirementNodeId: cleanText(source.requirementNodeId, 160) || undefined,
    requirementRevision: Number.isInteger(Number(source.requirementRevision)) ? Math.max(1, Number(source.requirementRevision)) : undefined,
    backend: plan.backend,
    state,
    progress: Math.max(0, Math.min(100, Math.floor(Number(source.progress) || 0))),
    createdAt: cleanText(source.createdAt, 80),
    updatedAt: cleanText(source.updatedAt, 80),
    startedAt: cleanText(source.startedAt, 80) || undefined,
    finishedAt: cleanText(source.finishedAt, 80) || undefined,
    error: cleanText(source.error, 2_000) || undefined,
    exitCode: Number.isInteger(Number(source.exitCode)) ? Number(source.exitCode) : undefined,
    scriptHash: /^[a-f0-9]{64}$/.test(cleanText(source.scriptHash, 64).toLowerCase()) ? cleanText(source.scriptHash, 64).toLowerCase() : undefined,
    outputs: (Array.isArray(source.outputs) ? source.outputs : []).map(normalizeOutput).filter(Boolean).slice(0, schema.limits.maxOutputFiles),
    plan
  };
}

function publicTask(task) {
  return task ? structuredClone(task) : null;
}

function pythonRunnerSource() {
  return String.raw`from __future__ import annotations
import json, math, pathlib, socket, sys
socket.socket = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("Network access is disabled for scientific rendering"))
socket.create_connection = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("Network access is disabled for scientific rendering"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent
PLAN = json.loads((ROOT / "plan.json").read_text(encoding="utf-8"))
RUNTIME = json.loads((ROOT / "runtime.json").read_text(encoding="utf-8"))
OUT = ROOT / "output"
OUT.mkdir(exist_ok=True)

def frame_for(panel):
    frames = []
    for source_id in panel.get("sourceBindings", []):
        item = RUNTIME["sources"].get(source_id)
        if not item:
            continue
        frames.append(pd.read_csv(ROOT / item["path"], sep=item["delimiter"]))
    if not frames:
        raise ValueError("Panel has no readable managed data source")
    return pd.concat(frames, ignore_index=True, sort=False) if len(frames) > 1 else frames[0]

def numeric(series, field):
    values = pd.to_numeric(series, errors="coerce")
    if values.notna().sum() == 0:
        raise ValueError(f"Field {field!r} has no numeric values")
    return values

def draw(ax, panel):
    frame = frame_for(panel)
    chart = panel["chartType"]
    x = panel.get("xField", "")
    ys = panel.get("yFields", [])
    group = panel.get("groupField", "")
    if x and x not in frame.columns: raise ValueError(f"Unknown x field: {x}")
    for field in ys:
        if field not in frame.columns: raise ValueError(f"Unknown y field: {field}")
    if group and group not in frame.columns: raise ValueError(f"Unknown group field: {group}")
    if chart == "scatter":
        for y in ys:
            ax.scatter(numeric(frame[x], x), numeric(frame[y], y), s=18, alpha=.78, label=y)
    elif chart == "line":
        order = frame.sort_values(x)
        for y in ys:
            ax.plot(order[x], numeric(order[y], y), marker="o", markersize=2.5, linewidth=1.25, label=y)
    elif chart == "bar":
        grouped = frame.groupby(x, dropna=False)[ys].mean(numeric_only=True)
        grouped.plot(kind="bar", ax=ax, width=.78)
    elif chart == "box":
        values = [numeric(frame[y], y).dropna().to_numpy() for y in ys]
        ax.boxplot(values, labels=ys, showfliers=False)
    elif chart == "violin":
        values = [numeric(frame[y], y).dropna().to_numpy() for y in ys]
        ax.violinplot(values, showmeans=True, showextrema=True)
        ax.set_xticks(range(1, len(ys) + 1), ys)
    elif chart == "histogram":
        ax.hist(numeric(frame[x], x).dropna(), bins="auto", alpha=.82)
    elif chart == "heatmap":
        matrix = frame[ys].apply(pd.to_numeric, errors="coerce").dropna(how="all").head(2000).to_numpy()
        image = ax.imshow(matrix, aspect="auto", interpolation="nearest", cmap="viridis")
        ax.figure.colorbar(image, ax=ax, fraction=.046, pad=.04)
        ax.set_xticks(range(len(ys)), ys, rotation=45, ha="right")
    else:
        raise ValueError(f"Unsupported chart type for data runner: {chart}")
    ax.set_title(panel.get("title") or panel.get("label") or "Panel", loc="left", fontweight="semibold")
    if x and chart not in ("box", "violin", "heatmap"): ax.set_xlabel(x)
    ax.spines[["top", "right"]].set_visible(False)
    handles, labels = ax.get_legend_handles_labels()
    if labels: ax.legend(frameon=False, fontsize=7)

def save_figure(fig, stem, formats):
    for fmt in formats:
        kwargs = {"bbox_inches": "tight", "facecolor": "white"}
        if fmt in ("png", "tiff"): kwargs["dpi"] = PLAN["dimensions"]["dpi"]
        fig.savefig(OUT / f"{stem}.{fmt}", format=fmt, **kwargs)

plt.rcParams.update({
    "font.family": "sans-serif", "font.sans-serif": ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "Arial Unicode MS", "DejaVu Sans"],
    "axes.unicode_minus": False, "font.size": 8, "axes.linewidth": .7,
    "xtick.major.width": .7, "ytick.major.width": .7, "figure.facecolor": "white",
    "axes.facecolor": "white", "savefig.facecolor": "white"
})
panels = PLAN["panels"]
columns = min(3, max(1, math.ceil(math.sqrt(len(panels)))))
rows = math.ceil(len(panels) / columns)
width = PLAN["dimensions"]["widthMm"] / 25.4
height = PLAN["dimensions"]["heightMm"] / 25.4
figure, axes = plt.subplots(rows, columns, figsize=(width, height), squeeze=False)
for index, panel in enumerate(panels):
    draw(axes.flat[index], panel)
    panel_figure, panel_axis = plt.subplots(figsize=(max(2.4, width / columns), max(2.2, height / rows)))
    draw(panel_axis, panel)
    panel_figure.tight_layout()
    panel_figure.savefig(OUT / f"panel-{panel['id']}.png", dpi=min(PLAN["dimensions"]["dpi"], 600), bbox_inches="tight", facecolor="white")
    plt.close(panel_figure)
for axis in axes.flat[len(panels):]: axis.set_visible(False)
figure.suptitle(PLAN["researchClaim"], fontsize=9, y=.995)
figure.tight_layout()
figure.savefig(OUT / "figure-preview.png", dpi=min(PLAN["dimensions"]["dpi"], 300), bbox_inches="tight", facecolor="white")
save_figure(figure, "figure", PLAN["outputFormats"])
plt.close(figure)
(OUT / "qa.json").write_text(json.dumps({
    "planHash": PLAN["planHash"], "backend": "python", "panels": len(panels),
    "statement": "No statistical significance, sample size or biological conclusion was inferred by the renderer.",
    "heatmapLimit": "Heatmap previews show at most 2000 source rows; source data is unchanged."
}, ensure_ascii=False, indent=2), encoding="utf-8")
`;
}

function rString(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

function rVector(values) {
  return `c(${values.map(rString).join(", ")})`;
}

function rRunnerSource(plan, sourceFiles) {
  const panels = plan.panels.map((panel) => {
    const sourceId = panel.sourceBindings[0];
    const source = sourceFiles[sourceId];
    return `list(id=${rString(panel.id)}, label=${rString(panel.label || panel.id)}, title=${rString(panel.title || panel.label || panel.id)}, chart=${rString(panel.chartType)}, file=${rString(source?.path || "")}, delimiter=${rString(source?.delimiter || ",")}, x=${rString(panel.xField)}, ys=${rVector(panel.yFields)}, group=${rString(panel.groupField)})`;
  });
  const formats = rVector(plan.outputFormats);
  return `options(repos = NULL, warn = 1)\nSys.setenv(http_proxy="http://127.0.0.1:9", https_proxy="http://127.0.0.1:9", HTTP_PROXY="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9")\nsuppressPackageStartupMessages(library(ggplot2))\nroot <- normalizePath(dirname(commandArgs(trailingOnly=FALSE)[grep("--file=", commandArgs(trailingOnly=FALSE))][1]), winslash="/", mustWork=TRUE)\nroot <- sub("^--file=", "", root)\nout <- file.path(root, "output")\ndir.create(out, showWarnings=FALSE, recursive=TRUE)\npanels <- list(${panels.join(",\n")})\nformats <- ${formats}\nwidth <- ${Number(plan.dimensions.widthMm) / 25.4}\nheight <- ${Number(plan.dimensions.heightMm) / 25.4}\ndpi <- ${Number(plan.dimensions.dpi)}\nmake_plot <- function(panel) {\n  if (!nzchar(panel$file)) stop("Panel has no managed data source")\n  data <- read.table(file.path(root, panel$file), header=TRUE, sep=panel$delimiter, check.names=FALSE, quote="\\\"", comment.char="", fileEncoding="UTF-8-BOM")\n  if (!panel$x %in% names(data) && nzchar(panel$x)) stop(paste("Unknown x field:", panel$x))\n  if (length(panel$ys) && any(!panel$ys %in% names(data))) stop("Unknown y field")\n  chart <- panel$chart\n  if (chart == "scatter") {\n    p <- ggplot(data, aes_string(x=panel$x, y=panel$ys[[1]])) + geom_point(size=1.4, alpha=.78)\n  } else if (chart == "line") {\n    p <- ggplot(data, aes_string(x=panel$x, y=panel$ys[[1]], group=if(nzchar(panel$group)) panel$group else 1)) + geom_line(linewidth=.45) + geom_point(size=.8)\n  } else if (chart == "bar") {\n    p <- ggplot(data, aes_string(x=panel$x, y=panel$ys[[1]])) + stat_summary(fun=mean, geom="col", width=.76)\n  } else if (chart == "box") {\n    p <- ggplot(data, aes_string(x=if(nzchar(panel$x)) panel$x else "factor(1)", y=panel$ys[[1]])) + geom_boxplot(outlier.shape=NA, width=.6)\n  } else if (chart == "violin") {\n    p <- ggplot(data, aes_string(x=if(nzchar(panel$x)) panel$x else "factor(1)", y=panel$ys[[1]])) + geom_violin(trim=FALSE, fill="#8FBBD9")\n  } else if (chart == "histogram") {\n    p <- ggplot(data, aes_string(x=panel$x)) + geom_histogram(bins=30, fill="#4D7EA8", color="white", linewidth=.2)\n  } else if (chart == "heatmap") {\n    limited <- head(data[panel$ys], 2000); limited$.row <- seq_len(nrow(limited)); long <- reshape(limited, varying=panel$ys, v.names="value", timevar="field", times=panel$ys, direction="long")\n    p <- ggplot(long, aes(x=field, y=.row, fill=value)) + geom_tile() + scale_fill_viridis_c()\n  } else stop(paste("Unsupported chart type:", chart))\n  p + labs(title=panel$title) + theme_classic(base_size=8) + theme(plot.title=element_text(face="bold", hjust=0), legend.position="none")\n}\nplots <- lapply(panels, make_plot)\nfor (i in seq_along(plots)) ggsave(file.path(out, paste0("panel-", panels[[i]]$id, ".png")), plots[[i]], width=max(2.4, width/2), height=max(2.2, height/2), dpi=min(dpi,600), bg="white")\ndraw_all <- function() {\n  grid::grid.newpage(); columns <- min(3, max(1, ceiling(sqrt(length(plots))))); rows <- ceiling(length(plots)/columns); layout <- grid::grid.layout(rows, columns); grid::pushViewport(grid::viewport(layout=layout));\n  for (i in seq_along(plots)) { row <- ceiling(i/columns); column <- ((i-1) %% columns)+1; print(plots[[i]], vp=grid::viewport(layout.pos.row=row, layout.pos.col=column)) }\n}\npng(file.path(out, "figure-preview.png"), width=width, height=height, units="in", res=min(dpi,300), bg="white")\ndraw_all(); dev.off()\nfor (fmt in formats) {\n  target <- file.path(out, paste0("figure.", fmt))\n  if (fmt == "png") png(target, width=width, height=height, units="in", res=dpi, bg="white") else if (fmt == "tiff") tiff(target, width=width, height=height, units="in", res=dpi, compression="lzw", bg="white") else if (fmt == "pdf") pdf(target, width=width, height=height, useDingbats=FALSE) else if (fmt == "svg") svg(target, width=width, height=height, bg="white")\n  draw_all(); dev.off()\n}\nwriteLines('${JSON.stringify({ statement: "No statistical significance, sample size or biological conclusion was inferred by the renderer." }).replace(/'/g, "\\'")}', file.path(out, "qa.json"), useBytes=TRUE)\n`;
}

function stripQuotedLiterals(source) {
  let result = "";
  let quote = "";
  let escaped = false;
  for (const character of source) {
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      result += " ";
    } else if (character === '"' || character === "'") {
      quote = character;
      result += " ";
    } else result += character;
  }
  return result;
}

function auditTrustedScript(source, backend) {
  const inspected = stripQuotedLiterals(source);
  const forbidden = backend === "python"
    ? [/\bsubprocess\b/i, /\bos\.system\b/i, /\beval\s*\(/i, /\bexec\s*\(/i, /\brequests\b/i, /\burllib\b/i]
    : [/\bsystem2?\s*\(/i, /\bshell\s*\(/i, /\bdownload\.file\s*\(/i, /\burl\s*\(/i, /\bsocketConnection\s*\(/i];
  const match = forbidden.find((pattern) => pattern.test(inspected));
  if (match) throw new ScientificRunnerError("SCIENTIFIC_SCRIPT_AUDIT_FAILED", "受信任绘图脚本未通过安全审计，任务未执行。", { rule: String(match) });
}

function boundedLog(value) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value || "");
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(-256 * 1_024);
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = options.spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    options.onSpawn(child);
    const timer = setTimeout(() => {
      child.kill();
      if (!settled) reject(new ScientificRunnerError("SCIENTIFIC_RUN_TIMEOUT", "科研绘图执行超时，进程已终止。"));
      settled = true;
    }, options.timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout = boundedLog(stdout + chunk.toString("utf8")); });
    child.stderr?.on("data", (chunk) => { stderr = boundedLog(stderr + chunk.toString("utf8")); });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new ScientificRunnerError("SCIENTIFIC_RUNTIME_UNAVAILABLE", `无法启动 ${options.backend === "python" ? "Python" : "R"}：${error.message}`, { backend: options.backend }));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code: Number.isInteger(code) ? code : -1, signal, stdout, stderr });
    });
  });
}

function runnerEnvironment(tempDir) {
  const allowed = ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "LANG", "LC_ALL"];
  const env = Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
  return {
    ...env,
    TEMP: tempDir,
    TMP: tempDir,
    MPLCONFIGDIR: path.join(tempDir, "matplotlib"),
    PYTHONNOUSERSITE: "1",
    http_proxy: "http://127.0.0.1:9",
    https_proxy: "http://127.0.0.1:9",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    NO_PROXY: ""
  };
}

function createScientificRunnerService(options = {}) {
  const {
    assetUrlFor = () => "",
    getProjectById,
    projectMetaDirName = ".naimage",
    projectRelativePath,
    readProjectList,
    resolveProjectRelativePath,
    onTaskChanged = () => {},
    log = () => {},
    now = () => new Date().toISOString(),
    spawn = spawnProcess,
    pythonCommand = process.env.NAIMAGE_SCIENTIFIC_PYTHON || "python",
    rCommand = process.env.NAIMAGE_SCIENTIFIC_R || "Rscript"
  } = options;
  if (![getProjectById, projectRelativePath, readProjectList, resolveProjectRelativePath].every((item) => typeof item === "function")) {
    throw new TypeError("scientific runner project services are required");
  }
  const active = new Map();
  const locks = new Map();
  let disposed = false;

  function withLock(projectId, operation) {
    const previous = locks.get(projectId) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    const queued = current.finally(() => {
      if (locks.get(projectId) === queued) locks.delete(projectId);
    });
    locks.set(projectId, queued);
    return current;
  }

  function projectForId(projectIdValue) {
    const projectId = cleanText(projectIdValue, 160);
    const list = readProjectList();
    const project = projectId ? getProjectById(projectId, list) : null;
    if (!project?.path) throw new ScientificRunnerError("PROJECT_NOT_FOUND", "目标项目不存在或已被移除。", { projectId });
    return project;
  }

  function roots(project) {
    const metaRoot = path.join(path.resolve(project.path), projectMetaDirName, "scientific");
    return {
      metaRoot,
      dataDir: path.join(metaRoot, "data"),
      dataRegistryPath: path.join(metaRoot, "data-registry.json"),
      taskDir: path.join(metaRoot, "tasks"),
      journalPath: path.join(metaRoot, "task-journal.json"),
      outputDir: path.join(path.resolve(project.path), "output", "scientific")
    };
  }

  async function readDataRegistry(project) {
    const file = roots(project).dataRegistryPath;
    const source = await readJson(file, { version: REGISTRY_VERSION, revision: 0, updatedAt: "", items: [] });
    return {
      version: REGISTRY_VERSION,
      revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
      updatedAt: cleanText(source.updatedAt, 80),
      items: (Array.isArray(source.items) ? source.items : []).map((item) => normalizeDataRecord(item, project.id)).filter(Boolean).slice(-200)
    };
  }

  async function writeDataRegistry(project, registry) {
    await writeJsonAtomic(roots(project).dataRegistryPath, registry);
  }

  async function readJournal(project) {
    const source = await readJson(roots(project).journalPath, { version: JOURNAL_VERSION, revision: 0, updatedAt: "", tasks: [] });
    return {
      version: JOURNAL_VERSION,
      revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
      updatedAt: cleanText(source.updatedAt, 80),
      tasks: (Array.isArray(source.tasks) ? source.tasks : []).map((item) => normalizeTask(item, project.id)).filter(Boolean).slice(-schema.limits.maxJournalTasks)
    };
  }

  async function writeJournal(project, journal) {
    await writeJsonAtomic(roots(project).journalPath, journal);
  }

  async function updateTask(project, taskId, updater) {
    return withLock(project.id, async () => {
      const journal = await readJournal(project);
      const index = journal.tasks.findIndex((item) => item.taskId === taskId);
      if (index < 0) throw new ScientificRunnerError("SCIENTIFIC_TASK_NOT_FOUND", "科研绘图任务不存在。", { taskId });
      const next = normalizeTask(updater(structuredClone(journal.tasks[index])), project.id);
      if (!next) throw new ScientificRunnerError("SCIENTIFIC_TASK_INVALID", "科研任务状态更新无效。");
      journal.tasks[index] = next;
      journal.revision += 1;
      journal.updatedAt = now();
      await writeJournal(project, journal);
      onTaskChanged(publicTask(next));
      return next;
    });
  }

  async function importData({ expectedProjectId, sourcePath } = {}) {
    if (disposed) throw new ScientificRunnerError("SCIENTIFIC_RUNNER_CLOSED", "科研绘图服务正在关闭。");
    const project = projectForId(expectedProjectId);
    const filePath = path.resolve(cleanText(sourcePath, 32_767));
    const extension = path.extname(filePath).toLowerCase();
    if (!DATA_EXTENSIONS.has(extension)) throw new ScientificRunnerError("SCIENTIFIC_DATA_FORMAT_UNSUPPORTED", "只支持 CSV、TSV 或 TXT 数据文件。");
    const sourceStat = await lstat(filePath).catch(() => null);
    if (!sourceStat?.isFile() || sourceStat.isSymbolicLink()) throw new ScientificRunnerError("SCIENTIFIC_DATA_FILE_INVALID", "请选择普通数据文件，不能导入目录或符号链接。");
    if (sourceStat.size <= 0 || sourceStat.size > schema.limits.maxDataFileBytes) {
      throw new ScientificRunnerError("SCIENTIFIC_DATA_TOO_LARGE", "数据文件必须大于 0 B 且不超过 64 MiB。", { size: sourceStat.size });
    }
    const contentHash = await hashFile(filePath);
    const id = `scientific-data-${contentHash.slice(0, 32)}`;
    const targetDir = roots(project).dataDir;
    const targetName = `${id}${extension === ".txt" ? ".csv" : extension}`;
    const targetPath = path.join(targetDir, targetName);
    await mkdir(targetDir, { recursive: true });
    await copyFile(filePath, targetPath);
    const inspected = await inspectDelimitedFile(targetPath, extension);
    const item = {
      id,
      projectId: project.id,
      sourceName: safeSegment(path.basename(filePath), "data"),
      contentHash,
      size: sourceStat.size,
      rowCount: inspected.rowCount,
      columnCount: inspected.columnCount,
      fields: inspected.fields,
      delimiter: inspected.delimiter,
      relativePath: projectRelativePath(project.path, targetPath).replace(/\\/g, "/"),
      importedAt: now()
    };
    await withLock(project.id, async () => {
      const registry = await readDataRegistry(project);
      const index = registry.items.findIndex((candidate) => candidate.id === id);
      if (index >= 0) registry.items[index] = item;
      else registry.items.push(item);
      registry.items = registry.items.slice(-200);
      registry.revision += 1;
      registry.updatedAt = now();
      await writeDataRegistry(project, registry);
    });
    return { ok: true, dataSource: publicDataSource(item), sampleRows: inspected.sampleRows };
  }

  async function listData(projectIdValue) {
    const project = projectForId(projectIdValue);
    const registry = await readDataRegistry(project);
    return registry.items.map(publicDataSource);
  }

  async function validatePlanData(project, plan) {
    const registry = await readDataRegistry(project);
    const byId = new Map(registry.items.map((item) => [item.id, item]));
    const selected = {};
    for (const requested of plan.dataSources) {
      const item = byId.get(requested.id);
      if (!item || item.contentHash !== requested.contentHash) {
        throw new ScientificRunnerError("SCIENTIFIC_DATA_STALE", `数据源“${requested.sourceName}”不存在或内容已变化，请重新选择。`, { dataSourceId: requested.id });
      }
      const resolved = resolveProjectRelativePath(project.path, item.relativePath);
      if (!resolved) throw new ScientificRunnerError("SCIENTIFIC_DATA_PATH_INVALID", "科研数据不在当前项目受管目录内。", { dataSourceId: item.id });
      selected[item.id] = { item, sourcePath: resolved };
    }
    return selected;
  }

  async function collectOutputs(project, task, taskRoot, scriptName, result) {
    const generatedDir = path.join(taskRoot, "output");
    const entries = await readdir(generatedDir, { withFileTypes: true }).catch(() => []);
    const files = entries.filter((entry) => entry.isFile() && OUTPUT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
    if (!files.some((entry) => /^figure(?:-preview)?\.(?:png|tiff|svg|pdf)$/i.test(entry.name))) {
      throw new ScientificRunnerError("SCIENTIFIC_OUTPUT_MISSING", "绘图进程结束但没有生成计划中的论文图。", { exitCode: result.code });
    }
    await writeFile(path.join(taskRoot, "run-log.txt"), `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}\n`, "utf8");
    const finalRoot = path.join(roots(project).outputDir, safeSegment(task.workflowId, "workflow"), task.taskId);
    await mkdir(finalRoot, { recursive: true });
    const support = [scriptName, "plan.json", "qa.json", "run-log.txt"];
    const candidates = [
      ...files.map((entry) => ({ name: entry.name, source: path.join(generatedDir, entry.name) })),
      ...support.flatMap((name) => [{ name, source: name === "qa.json" ? path.join(generatedDir, name) : path.join(taskRoot, name) }])
    ];
    const unique = [...new Map(candidates.map((item) => [item.name.toLowerCase(), item])).values()];
    if (unique.length > schema.limits.maxOutputFiles) throw new ScientificRunnerError("SCIENTIFIC_OUTPUT_LIMIT", "科研任务生成的文件数量超过安全上限。");
    let total = 0;
    const outputs = [];
    for (const candidate of unique) {
      const sourceStat = await lstat(candidate.source).catch(() => null);
      if (!sourceStat?.isFile() || sourceStat.isSymbolicLink()) continue;
      if (sourceStat.size > schema.limits.maxOutputFileBytes) throw new ScientificRunnerError("SCIENTIFIC_OUTPUT_TOO_LARGE", `输出文件 ${candidate.name} 超过 64 MiB。`);
      total += sourceStat.size;
      if (total > schema.limits.maxOutputTotalBytes) throw new ScientificRunnerError("SCIENTIFIC_OUTPUT_TOTAL_LIMIT", "科研任务输出总量超过 256 MiB。");
      const extension = path.extname(candidate.name).toLowerCase();
      const inspection = await validateScientificOutputFile(candidate.source, extension, sourceStat.size);
      const targetPath = path.join(finalRoot, safeSegment(candidate.name, "output"));
      if (typeof inspection.sanitizedText === "string") await writeFile(targetPath, inspection.sanitizedText, "utf8");
      else await copyFile(candidate.source, targetPath);
      const targetStat = await stat(targetPath);
      const contentHash = await hashFile(targetPath);
      const panelMatch = candidate.name.match(/^panel-(.+)\.png$/i);
      const kind = panelMatch
        ? "panel"
        : extension === ".py" || extension === ".r"
          ? "script"
          : /^figure(?:-preview)?\.(?:png|tiff|svg|pdf)$/i.test(candidate.name)
            ? "figure"
            : candidate.name === "qa.json" ? "qa" : "log";
      outputs.push({
        outputId: `scientific-output-${contentHash.slice(0, 32)}`,
        kind,
        format: extension.replace(/^\./, ""),
        name: candidate.name,
        relativePath: projectRelativePath(project.path, targetPath).replace(/\\/g, "/"),
        assetUrl: assetUrlFor(targetPath),
        mimeType: OUTPUT_MIME[extension] || "application/octet-stream",
        size: targetStat.size,
        contentHash,
        ...(inspection.width && inspection.height ? { width: inspection.width, height: inspection.height } : {}),
        ...(panelMatch ? { panelId: panelMatch[1] } : {})
      });
    }
    return outputs;
  }

  async function renderTask(payload = {}) {
    if (disposed) throw new ScientificRunnerError("SCIENTIFIC_RUNNER_CLOSED", "科研绘图服务正在关闭。");
    const project = projectForId(payload.expectedProjectId);
    const plan = normalizeScientificFigurePlan(payload.plan);
    const issues = scientificFigurePlanIssues(plan, { forRender: true });
    if (issues.length) throw new ScientificRunnerError("SCIENTIFIC_PLAN_INCOMPLETE", `科研图计划尚不能执行：${issues.join("；")}。`, { issues });
    const data = await validatePlanData(project, plan);
    const taskId = `scientific-task-${randomBytes(16).toString("hex")}`;
    const taskRoot = path.join(roots(project).taskDir, taskId);
    const inputDir = path.join(taskRoot, "input");
    const outputDir = path.join(taskRoot, "output");
    const tempDir = path.join(taskRoot, "temp");
    await Promise.all([mkdir(inputDir, { recursive: true }), mkdir(outputDir, { recursive: true }), mkdir(tempDir, { recursive: true })]);
    const sourceFiles = {};
    for (const [sourceId, selected] of Object.entries(data)) {
      const extension = path.extname(selected.sourcePath).toLowerCase() || ".csv";
      const fileName = `${sourceId}${extension}`;
      await copyFile(selected.sourcePath, path.join(inputDir, fileName));
      sourceFiles[sourceId] = { path: `input/${fileName}`, delimiter: selected.item.delimiter };
    }
    await writeFile(path.join(taskRoot, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    await writeFile(path.join(taskRoot, "runtime.json"), `${JSON.stringify({ sources: sourceFiles }, null, 2)}\n`, "utf8");
    const backend = plan.backend;
    const scriptName = backend === "python" ? "figure.py" : "figure.R";
    const script = backend === "python" ? pythonRunnerSource() : rRunnerSource(plan, sourceFiles);
    auditTrustedScript(script, backend);
    await writeFile(path.join(taskRoot, scriptName), script, "utf8");
    const timestamp = now();
    const task = {
      taskId,
      projectId: project.id,
      workflowId: plan.workflowId,
      planHash: plan.planHash,
      requirementNodeId: cleanText(payload.requirementNodeId, 160) || undefined,
      requirementRevision: Number.isInteger(Number(payload.expectedRequirementRevision)) ? Number(payload.expectedRequirementRevision) : undefined,
      backend,
      state: "prepared",
      progress: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      scriptHash: sha256(script),
      outputs: [],
      plan
    };
    await withLock(project.id, async () => {
      const journal = await readJournal(project);
      journal.tasks.push(task);
      journal.tasks = journal.tasks.slice(-schema.limits.maxJournalTasks);
      journal.revision += 1;
      journal.updatedAt = timestamp;
      await writeJournal(project, journal);
    });
    onTaskChanged(publicTask(task));
    await updateTask(project, taskId, (current) => ({ ...current, state: "running", progress: 12, startedAt: now(), updatedAt: now() }));
    const timeoutMs = Math.max(10_000, Math.min(schema.limits.maxTimeoutMs, Math.floor(Number(payload.timeoutMs) || schema.limits.defaultTimeoutMs)));
    const command = backend === "python" ? pythonCommand : rCommand;
    const args = backend === "python" ? ["-I", "-B", "-u", scriptName] : ["--vanilla", scriptName];
    try {
      const result = await runCommand(command, args, {
        backend,
        cwd: taskRoot,
        env: runnerEnvironment(tempDir),
        timeoutMs,
        spawn,
        onSpawn(child) { active.set(taskId, { child, projectId: project.id }); }
      });
      active.delete(taskId);
      const current = await getTask(project.id, taskId);
      if (current?.state === "cancelled") return current;
      if (result.code !== 0) {
        const error = cleanText(result.stderr || result.stdout || `${backend} exited with code ${result.code}`, 2_000);
        throw new ScientificRunnerError("SCIENTIFIC_RUN_FAILED", `科研绘图执行失败：${error}`, { backend, exitCode: result.code });
      }
      const outputs = await collectOutputs(project, task, taskRoot, scriptName, result);
      const ready = await updateTask(project, taskId, (currentTask) => ({
        ...currentTask,
        state: "ready",
        progress: 100,
        finishedAt: now(),
        updatedAt: now(),
        exitCode: 0,
        outputs,
        plan: { ...currentTask.plan, status: "rendered", taskId }
      }));
      log(`ready project=${project.id} task=${taskId} backend=${backend} outputs=${outputs.length}`);
      return publicTask(ready);
    } catch (error) {
      active.delete(taskId);
      const current = await getTask(project.id, taskId).catch(() => null);
      if (current?.state === "cancelled") return current;
      await updateTask(project, taskId, (currentTask) => ({
        ...currentTask,
        state: error?.code === "SCIENTIFIC_RUN_TIMEOUT" ? "failed" : "failed",
        progress: currentTask.progress,
        finishedAt: now(),
        updatedAt: now(),
        error: cleanText(error instanceof Error ? error.message : error, 2_000),
        exitCode: Number.isInteger(error?.details?.exitCode) ? error.details.exitCode : undefined,
        plan: { ...currentTask.plan, status: "failed", taskId }
      }));
      throw error;
    }
  }

  async function listTasks(projectIdValue) {
    const project = projectForId(projectIdValue);
    return (await readJournal(project)).tasks.map(publicTask).reverse();
  }

  async function getTask(projectIdValue, taskIdValue) {
    const project = projectForId(projectIdValue);
    const taskId = cleanText(taskIdValue, 80).toLowerCase();
    return publicTask((await readJournal(project)).tasks.find((item) => item.taskId === taskId));
  }

  async function cancelTask(projectIdValue, taskIdValue) {
    const project = projectForId(projectIdValue);
    const taskId = cleanText(taskIdValue, 80).toLowerCase();
    const task = await getTask(project.id, taskId);
    if (!task) throw new ScientificRunnerError("SCIENTIFIC_TASK_NOT_FOUND", "科研绘图任务不存在。", { taskId });
    if (!active.has(taskId) && !["prepared", "running"].includes(task.state)) return task;
    active.get(taskId)?.child?.kill();
    active.delete(taskId);
    return publicTask(await updateTask(project, taskId, (current) => ({ ...current, state: "cancelled", finishedAt: now(), updatedAt: now(), error: undefined })));
  }

  async function exportTask({ expectedProjectId, taskId, destinationParent } = {}) {
    const project = projectForId(expectedProjectId);
    const task = await getTask(project.id, taskId);
    if (!task || task.state !== "ready" || !task.outputs.length) throw new ScientificRunnerError("SCIENTIFIC_TASK_NOT_READY", "科研图尚未完成，不能导出。");
    const parent = path.resolve(cleanText(destinationParent, 32_767));
    const target = path.join(parent, safeSegment(`SparkAI-${task.workflowId}-${task.taskId.slice(-8)}`, "scientific-figure"));
    await mkdir(target, { recursive: false });
    let count = 0;
    try {
      for (const output of task.outputs) {
        const source = resolveProjectRelativePath(project.path, output.relativePath);
        if (!source) throw new ScientificRunnerError("SCIENTIFIC_OUTPUT_PATH_INVALID", "科研图输出不在当前项目受管目录内。");
        await copyFile(source, path.join(target, safeSegment(output.name, "output")));
        count += 1;
      }
    } catch (error) {
      await rm(target, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return { ok: true, exported: true, folderName: path.basename(target), fileCount: count };
  }

  async function recoverAll() {
    const projects = Array.isArray(readProjectList()?.projects) ? readProjectList().projects : [];
    let interrupted = 0;
    for (const projectRecord of projects) {
      const project = projectForId(projectRecord.id);
      await withLock(project.id, async () => {
        const journal = await readJournal(project);
        let changed = false;
        journal.tasks = journal.tasks.map((task) => {
          if (task.state !== "prepared" && task.state !== "running") return task;
          interrupted += 1;
          changed = true;
          return { ...task, state: "interrupted", updatedAt: now(), finishedAt: now(), error: "应用在科研任务运行期间关闭；任务未自动重试，以避免重复执行。" };
        });
        if (changed) {
          journal.revision += 1;
          journal.updatedAt = now();
          await writeJournal(project, journal);
        }
      });
    }
    return { projects: projects.length, interrupted };
  }

  async function dispose() {
    disposed = true;
    const activeTasks = [...active.entries()];
    activeTasks.forEach(([, record]) => record.child?.kill());
    active.clear();
    for (const [taskId, record] of activeTasks) {
      const project = projectForId(record.projectId);
      await updateTask(project, taskId, (task) => ({ ...task, state: "interrupted", updatedAt: now(), finishedAt: now(), error: "应用关闭，科研任务已安全中断；不会自动重复执行。" })).catch(() => {});
    }
  }

  return { cancelTask, dispose, exportTask, getTask, importData, listData, listTasks, recoverAll, renderTask };
}

module.exports = {
  ScientificRunnerError,
  createScientificRunnerService,
  inspectDelimitedFile,
  normalizeDataRecord,
  normalizeTask,
  publicDataSource,
  validateScientificOutputFile
};
