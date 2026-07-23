"use strict";

const {
  imagePromptQualities,
  normalizeImageToolFrame,
  parseImageRatioValue,
  parseImageSizeValue
} = require("./image-frame.cjs");

function createImageBatchNormalization(options = {}) {
  const { cleanOneLine, stripPastedBlockMarkers } = options;
  const imageBatchPlaceholderPattern = /^(?:temp(?:orary)?(?:\s+(?:item|image|prompt))?|placeholder\d*|unused|not\s*used|n\/?a|none|todo|tbd|string|prompt|example|sample|test(?:\s+item)?|待填写|未使用|不使用|无需|无|空|占位(?:符|项|图片|提示词)?|临时(?:项|图片|提示词)?|测试项)$/i;

  function isImageBatchPlaceholder(value = "") {
    return imageBatchPlaceholderPattern.test(String(value || "").trim());
  }

  function comparableSingleItemField(name, value) {
    if (value === undefined || value === null || value === "") return "";
    if (name === "ratio") return parseImageRatioValue(value)?.ratio || String(value).trim();
    if (name === "resolution") return String(value).trim().toUpperCase();
    if (name === "quality") return String(value).trim().toLowerCase();
    if (name === "size") {
      const parsed = parseImageSizeValue(value);
      return parsed ? `${parsed.width}x${parsed.height}` : String(value).trim().toLowerCase();
    }
    return String(value).trim();
  }

  function normalizedVisualPrompt(value = "") {
    return stripPastedBlockMarkers(value)
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, "")
      .trim();
  }

  function resolveCompatibleSinglePrompt(topPrompt = "", itemPrompt = "") {
    if (!topPrompt) return itemPrompt;
    if (!itemPrompt) return topPrompt;
    const normalizedTop = normalizedVisualPrompt(topPrompt);
    const normalizedItem = normalizedVisualPrompt(itemPrompt);
    if (normalizedTop === normalizedItem) return topPrompt.length >= itemPrompt.length ? topPrompt : itemPrompt;
    if (normalizedTop.includes(normalizedItem) || normalizedItem.includes(normalizedTop)) {
      return normalizedTop.length >= normalizedItem.length ? topPrompt : itemPrompt;
    }
    throw new Error("image_gen 的顶层 prompt 与唯一有效 items.prompt 表达了不同画面，无法无损确定应使用哪一个。");
  }

  function normalizeSingleImageItemCompatibility(args = {}) {
    if (args.items === undefined) return { ...args };
    if (args.items === null || args.items === "") return { ...args, items: undefined };
    const sourceItems = Array.isArray(args.items)
      ? args.items
      : args.items && typeof args.items === "object"
        ? [args.items]
        : [args.items];
    const usableItems = sourceItems.filter((item, index) => {
      if (typeof item === "string" && isImageBatchPlaceholder(item)) return false;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`image_gen items[${index}] 必须是对象。`);
      }
      const itemPrompt = stripPastedBlockMarkers(item.prompt ?? "");
      return Boolean(itemPrompt && !isImageBatchPlaceholder(itemPrompt));
    });
    if (usableItems.length === 0) {
      return { ...args, items: undefined };
    }
    if (usableItems.length > 1) {
      if (usableItems.length > 10) throw new Error("image_gen items 最多包含 10 个有效项。");
      return { ...args, count: usableItems.length, items: usableItems };
    }

    const item = usableItems[0];

    const topPrompt = stripPastedBlockMarkers(args.prompt ?? "");
    const itemPrompt = stripPastedBlockMarkers(item.prompt ?? "");
    if (!topPrompt && !itemPrompt) throw new Error("image_gen 缺少可用的单图 prompt。");
    const prompt = resolveCompatibleSinglePrompt(topPrompt, itemPrompt);
    const requestedCount = Number(args.count);
    const preserveRepeatedCount = sourceItems.length === 1 && Number.isSafeInteger(requestedCount) && requestedCount >= 2 && requestedCount <= 10;

    const normalized = {
      ...args,
      prompt,
      count: preserveRepeatedCount ? requestedCount : 1,
      items: undefined
    };
    for (const field of ["ratio", "resolution", "quality", "size"]) {
      const topValue = args[field];
      const itemValue = item[field];
      if ((topValue === undefined || topValue === null || topValue === "") && itemValue !== undefined && itemValue !== null && itemValue !== "") {
        normalized[field] = itemValue;
        continue;
      }
      if (
        topValue !== undefined && topValue !== null && topValue !== "" &&
        itemValue !== undefined && itemValue !== null && itemValue !== "" &&
        comparableSingleItemField(field, topValue) !== comparableSingleItemField(field, itemValue)
      ) {
        throw new Error(`image_gen count=1 的顶层 ${field} 与 items[0].${field} 不一致；请只保留顶层参数。`);
      }
    }
    return normalized;
  }

  function normalizeImageBatchItems(args = {}, settings = {}) {
    const source = Array.isArray(args.items) ? args.items : [];
    return source
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const prompt = stripPastedBlockMarkers(item.prompt || "");
        if (!prompt || isImageBatchPlaceholder(prompt)) return null;
        const frame = normalizeImageToolFrame({
          ...args,
          ...item,
          prompt,
          model: item.model || args.model
        }, settings);
        const rawTitle = cleanOneLine(item.title || "", 100);
        return {
          title: rawTitle && !isImageBatchPlaceholder(rawTitle) ? rawTitle : "",
          prompt,
          ratio: frame.ratio,
          resolution: frame.resolution,
          size: frame.size,
          quality: imagePromptQualities.has(String(item.quality || "").trim()) ? String(item.quality).trim() : args.quality ?? settings.imageQuality ?? "auto"
        };
      })
      .filter(Boolean)
      .map((item, index) => ({ ...item, title: item.title || `方案 ${index + 1}` }));
  }

  return {
    normalizeImageBatchItems,
    normalizeSingleImageItemCompatibility
  };
}

module.exports = {
  createImageBatchNormalization
};
