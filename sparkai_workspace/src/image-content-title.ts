import type { ImageAsset, ImageCollection } from "./core";

const IMAGE_CONTENT_TITLE_MAX_LENGTH = 48;
const GENERIC_IMAGE_TITLE = /^(?:(?:[A-Z]\d*|N\d+)\s*[·•]\s*)?(?:(?:Goal\s*)?(?:生图|生成图片|图片成果|Agent\s*成果|图像编辑|元素替换|多款设计|AI\s*抠图|AI\s*重绘|批量图片组|连续系列|图片组|分层\s*PNG|图层\s*[^：:]+|generated\s*image|image\s*result|image\s*group|batch\s*images?)|方案\s*\d+|图片\s*\d+|成果)(?:失败|failed)?(?:\s*[：:].*)?$/i;
const PROMPT_METADATA_LINE = /^(?:tool|operation|mode|model|ratio|resolution|size|quality|count|returned|referenceImages|editImage|maskImage|outputFormat|outputCompression|background|moderation|inputFidelity|layerId|layerRole|layerGroupId|assetIndex|error)\s*:/i;

const SUBJECT_LABELS = [
  "品牌主题",
  "画面主体",
  "核心主体",
  "品牌",
  "主体",
  "主题",
  "产品",
  "人物",
  "角色",
  "场景",
  "brand theme",
  "brand",
  "subject",
  "theme",
  "product",
  "character",
  "scene",
] as const;

const PURPOSE_LABELS = [
  "作品类型",
  "成果类型",
  "用途",
  "目的",
  "类型",
  "purpose",
  "use",
  "deliverable",
  "format",
] as const;

type GeneratedImageContentPresentationInput = {
  title?: string;
  existingTitle?: string;
  prompt?: string;
  assets?: readonly ImageAsset[];
  existingAssets?: readonly ImageAsset[];
  collection?: ImageCollection;
  existingCollection?: ImageCollection;
};

export type GeneratedImageContentPresentation = {
  title: string;
  assets: ImageAsset[];
  collection?: ImageCollection;
};

function clipTitle(value: string, maximum = IMAGE_CONTENT_TITLE_MAX_LENGTH) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function comparableText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function cleanTitleCandidate(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[`*_#]+/g, "")
    .replace(/^[\s\-–—:：|·•]+|[\s\-–—:：|·•]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function usefulExistingTitle(value: unknown, prompt: string) {
  const title = cleanTitleCandidate(value);
  if (!title || title.length > IMAGE_CONTENT_TITLE_MAX_LENGTH || GENERIC_IMAGE_TITLE.test(title)) return "";
  const titleComparable = comparableText(title);
  const promptComparable = comparableText(prompt);
  if (titleComparable.length >= 12 && promptComparable.length >= 12) {
    const nearFullPrompt = titleComparable.length >= 24
      && titleComparable.length >= promptComparable.length * 0.8
      && (promptComparable.startsWith(titleComparable) || titleComparable.startsWith(promptComparable));
    if (titleComparable === promptComparable || nearFullPrompt) return "";
  }
  return title;
}

function promptLines(prompt: string) {
  return String(prompt || "")
    .normalize("NFKC")
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/```/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+]\s+|#{1,6}\s*)/, "").trim())
    .filter(Boolean);
}

function labelledPromptValues(prompt: string) {
  const values = new Map<string, string>();
  for (const line of promptLines(prompt)) {
    const match = line.match(/^([^：:]{1,24})[：:]\s*(.+)$/);
    if (!match) continue;
    const key = match[1].replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const value = match[2].trim();
    if (value && !values.has(key)) values.set(key, value);
  }
  return values;
}

function firstLabelValue(values: Map<string, string>, labels: readonly string[]) {
  for (const label of labels) {
    const value = values.get(label.toLocaleLowerCase());
    if (value) return value;
  }
  return "";
}

function cleanSubjectPhrase(value: string) {
  const sentence = cleanTitleCandidate(value).split(/[。；;!?！？]/, 1)[0] || "";
  const parts = sentence.split(/[，,]/).map((part) => cleanTitleCandidate(part)).filter(Boolean);
  if (!parts.length) return "";
  let subject = parts[0];
  const identity = parts[1] || "";
  if (identity && subject.length <= 18 && identity.length <= 22 && /(?:AI|助手|平台|品牌|产品|人物|角色|系列|studio|assistant|platform|brand|product)/i.test(identity)) {
    subject = `${subject} · ${identity.replace(/\s+的\s+/g, " ")}`;
  }
  return clipTitle(subject, 30);
}

function cleanPurposePhrase(value: string) {
  let purpose = cleanTitleCandidate(value).split(/[。；;!?！？]/, 1)[0] || "";
  purpose = purpose
    .replace(/^面向.{1,36}?的/, "")
    .replace(/^用于.{1,36}?(?:的|，|,)/, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .trim();
  return clipTitle(purpose, 34);
}

function cleanPromptLead(value: string) {
  let lead = cleanTitleCandidate(value)
    .replace(/^(?:prompt|提示词)\s*[：:]\s*/i, "")
    .replace(/^(?:请(?:你)?(?:帮我)?|帮我)?\s*(?:生成|创建|制作|设计|绘制|输出)\s*(?:一张|一个|一幅|一组|一套)?\s*/i, "")
    .replace(/^(?:generate|create|design|draw|render)\s+(?:a|an|the)?\s*/i, "")
    .trim();
  lead = lead.split(/[。；;!?！？]/, 1)[0] || lead;
  return clipTitle(lead);
}

function derivedImageContentTitle(prompt: string) {
  const values = labelledPromptValues(prompt);
  const subject = cleanSubjectPhrase(firstLabelValue(values, SUBJECT_LABELS));
  const purpose = cleanPurposePhrase(firstLabelValue(values, PURPOSE_LABELS));
  if (subject && purpose && !comparableText(subject).includes(comparableText(purpose))) {
    return clipTitle(`${subject} · ${purpose}`);
  }
  if (subject || purpose) return clipTitle(subject || purpose);

  const lines = promptLines(prompt);
  for (const line of lines) {
    if (PROMPT_METADATA_LINE.test(line)) continue;
    const lead = cleanPromptLead(line);
    if (lead) return lead;
  }
  return "图片成果";
}

export function imageContentSummaryTitle(title: unknown, prompt: unknown) {
  const promptText = String(prompt || "").trim();
  return usefulExistingTitle(title, promptText) || derivedImageContentTitle(promptText);
}

function existingCollectionItem(collection: ImageCollection | undefined, item: ImageCollection["items"][number], index: number) {
  if (!collection) return undefined;
  return collection.items.find((candidate) => candidate.id === item.id)
    ?? collection.items.find((candidate) => Number(candidate.requestIndex) === Number(item.requestIndex))
    ?? collection.items[index];
}

function disambiguateTitles(titles: string[], indexes: number[]) {
  const totals = new Map<string, number>();
  for (const title of titles) {
    const key = comparableText(title);
    totals.set(key, (totals.get(key) || 0) + 1);
  }
  return titles.map((title, index) => {
    if ((totals.get(comparableText(title)) || 0) <= 1) return title;
    const suffix = ` · ${indexes[index] || index + 1}`;
    return `${clipTitle(title, IMAGE_CONTENT_TITLE_MAX_LENGTH - suffix.length)}${suffix}`;
  });
}

export function normalizeGeneratedImageContentPresentation(
  input: GeneratedImageContentPresentationInput,
): GeneratedImageContentPresentation {
  const prompt = String(input.prompt || "").trim();
  const existingCollectionTitle = usefulExistingTitle(input.existingCollection?.name, prompt);
  const existingNodeTitle = usefulExistingTitle(input.existingTitle, prompt);
  const incomingCollectionTitle = usefulExistingTitle(input.collection?.name, prompt);
  const incomingNodeTitle = usefulExistingTitle(input.title, prompt);
  const title = existingCollectionTitle || existingNodeTitle || incomingCollectionTitle || incomingNodeTitle || derivedImageContentTitle(prompt);
  const sourceAssets = (input.assets || []).map((asset) => ({ ...asset }));

  if (!input.collection) {
    const titles = sourceAssets.map((asset, index) => {
      const assetPrompt = asset.prompt || asset.revisedPrompt || prompt;
      const existingAssetTitle = usefulExistingTitle(input.existingAssets?.[index]?.title, assetPrompt);
      return existingAssetTitle || imageContentSummaryTitle(asset.title, assetPrompt);
    });
    const disambiguated = disambiguateTitles(titles, sourceAssets.map((asset, index) => Number(asset.index || index + 1)));
    return {
      title,
      assets: sourceAssets.map((asset, index) => ({ ...asset, title: disambiguated[index] })),
    };
  }

  const items = input.collection.items.map((item, index) => {
    const assetIndex = Number.isInteger(Number(item.assetIndex)) && Number(item.assetIndex) > 0
      ? Number(item.assetIndex) - 1
      : -1;
    const asset = assetIndex >= 0 ? sourceAssets[assetIndex] : undefined;
    const existingItem = existingCollectionItem(input.existingCollection, item, index);
    const existingAsset = assetIndex >= 0 ? input.existingAssets?.[assetIndex] : undefined;
    const itemPrompt = item.prompt || asset?.prompt || asset?.revisedPrompt || prompt;
    const itemTitle = usefulExistingTitle(existingItem?.title, itemPrompt)
      || usefulExistingTitle(existingAsset?.title, itemPrompt)
      || usefulExistingTitle(item.title, itemPrompt)
      || usefulExistingTitle(asset?.title, itemPrompt)
      || derivedImageContentTitle(itemPrompt);
    return { ...item, title: itemTitle };
  });
  const itemTitles = disambiguateTitles(
    items.map((item) => item.title || "图片成果"),
    items.map((item, index) => Number(item.requestIndex || index + 1)),
  );
  const normalizedItems = items.map((item, index) => ({ ...item, title: itemTitles[index] }));
  const assets = sourceAssets.map((asset, assetIndex) => {
    const item = normalizedItems.find((candidate) => Number(candidate.assetIndex) === assetIndex + 1);
    if (item?.title) return { ...asset, title: item.title };
    const assetPrompt = asset.prompt || asset.revisedPrompt || prompt;
    return { ...asset, title: imageContentSummaryTitle(asset.title, assetPrompt) };
  });

  return {
    title,
    assets,
    collection: {
      ...input.collection,
      name: title,
      items: normalizedItems,
    },
  };
}
