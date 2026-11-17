"use strict";

const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const { parseRecipeDocument, sealRecipeDocument } = require("../runtime/recipe-contract.cjs");
const { sealSkillManifest } = require("../runtime/skill-contract.cjs");
const { sealToolManifest } = require("../runtime/tool-contract.cjs");

const BUILTIN_RECIPE_ID = "recipe.sparkvas.beauty-product-hero";
const RECIPE_INDEX_SCHEMA_VERSION = 1;
const RECIPE_INDEX_FILE = "recipes.json";

const OUTPUT_SLOTS = Object.freeze([
  { slotId: "hero", label: "主视觉", defaultDirection: "干净高级的棚拍主视觉，完整展示产品正面与包装识别点" },
  { slotId: "lifestyle", label: "生活方式场景", defaultDirection: "真实生活方式场景，柔和自然光，产品处于自然使用环境" },
  { slotId: "detail", label: "质感特写", defaultDirection: "近距离质感特写，突出材质、光泽、纹理与包装细节" },
  { slotId: "model", label: "模特使用场景", defaultDirection: "克制可信的模特使用场景，保留产品外观与包装比例" },
  { slotId: "packaging", label: "包装与礼盒", defaultDirection: "完整包装与礼盒陈列，适合跨境商品详情页" },
  { slotId: "social", label: "社媒方图", defaultDirection: "适合社媒信息流的方图构图，主体明确，留出安全边距" },
]);

function buildBuiltinRecipeCatalog() {
  const skill = sealSkillManifest({
    schemaVersion: 1,
    id: "skill.sparkvas.beauty-product-hero",
    name: "Beauty 商品主视觉",
    description: "保持产品外观、包装文字与品牌识别，规划六类跨境商品视觉。",
    version: "1.0.0",
    minAppVersion: "1.0.9",
    license: "UNLICENSED",
    instructions: "把受管商品图作为唯一产品依据。不得自行替换产品结构、包装文字、品牌标识、颜色关系或关键材质；只允许改变摄影场景、光线、构图和展示方式。",
    inputSlots: [{ slotId: "product", label: "商品母图", dataType: "image", required: true }],
    parameters: [],
    examples: [{ title: "美妆商品六视图" }],
    limitations: ["不生成视频", "不生成未在母图中出现的产品", "包装文字以输入图为准"],
    tags: ["beauty", "commerce", "builtin"],
  });
  if (!skill) throw new Error("Built-in Beauty skill manifest is invalid.");

  const tool = sealToolManifest({
    schemaVersion: 1,
    id: "tool.sparkvas.image-generation",
    name: "受管图片生成",
    description: "通过当前 Main 图片执行服务生成一张受管图片成果。",
    version: "1.0.0",
    minAppVersion: "1.0.9",
    license: "UNLICENSED",
    distribution: "builtin",
    adapter: "image-generation",
    inputSlots: [
      { portId: "source", label: "商品母图", dataType: "image", required: true },
      { portId: "prompt", label: "画面要求", dataType: "text", required: true },
    ],
    outputSlots: [{ portId: "result", label: "图片成果", dataType: "image" }],
    permissions: {
      network: ["public"],
      filesystem: ["managed-read", "managed-write"],
      process: ["none"],
      models: ["image-generation"],
      mcp: ["none"],
    },
    limitations: ["每次只生成一个受管图片槽位", "未知提交不会自动重发"],
    tags: ["builtin", "image"],
  });
  if (!tool) throw new Error("Built-in image-generation tool manifest is invalid.");

  const toolRef = { kind: "tool", id: tool.id, version: tool.version, contentHash: tool.contentHash };
  const toolNodes = OUTPUT_SLOTS.map((slot) => ({
    stepId: `step.render-${slot.slotId}`,
    type: "Tool",
    title: slot.label,
    ref: toolRef,
    inputPorts: [
      { portId: "source", label: "商品母图", dataType: "image", required: true },
      { portId: "prompt", label: "画面要求", dataType: "text", required: true },
    ],
    outputPorts: [{ portId: slot.slotId, label: slot.label, dataType: "image" }],
  }));

  const recipeDraft = {
    schemaVersion: 1,
    id: BUILTIN_RECIPE_ID,
    name: "Beauty 商品六视图",
    description: "从一张受管商品图生成主视觉、生活方式、质感特写、模特、包装和社媒六张套图。",
    version: "1.0.0",
    minAppVersion: "1.0.9",
    license: "UNLICENSED",
    dependencies: [
      { kind: "skill", id: skill.id, version: skill.version, contentHash: skill.contentHash },
      { kind: "tool", id: tool.id, version: tool.version, contentHash: tool.contentHash },
    ],
    inputSlots: [{ slotId: "product", label: "商品母图", dataType: "image", required: true }],
    outputContract: {
      schemaVersion: 1,
      outputs: OUTPUT_SLOTS.map((slot) => ({
        slotId: slot.slotId,
        label: slot.label,
        dataType: "image",
        required: true,
      })),
    },
    nodes: [
      {
        stepId: "step.input",
        type: "Input",
        title: "商品母图",
        inputPorts: [],
        outputPorts: [{ portId: "product", label: "商品母图", dataType: "image" }],
      },
      {
        stepId: "step.brief",
        type: "Brief",
        title: "运行设置",
        inputPorts: [],
        outputPorts: [
          { portId: "brief", label: "场景文案", dataType: "brief" },
          { portId: "prompt", label: "画面要求", dataType: "text" },
        ],
      },
      {
        stepId: "step.hero",
        type: "Skill",
        title: "Beauty 商品主视觉",
        ref: { kind: "skill", id: skill.id, version: skill.version, contentHash: skill.contentHash },
        inputPorts: [
          { portId: "product", label: "商品母图", dataType: "image", required: true },
          { portId: "brief", label: "场景文案", dataType: "brief", required: true },
        ],
        outputPorts: [{ portId: "image", label: "产品约束", dataType: "image" }],
      },
      ...toolNodes,
      {
        stepId: "step.output",
        type: "Output",
        title: "六张套图",
        inputPorts: OUTPUT_SLOTS.map((slot) => ({
          portId: slot.slotId,
          label: slot.label,
          dataType: "image",
          required: true,
        })),
        outputPorts: [],
      },
    ],
    edges: [
      { edgeId: "edge.input-skill-hero", fromStepId: "step.input", fromPortId: "product", toStepId: "step.hero", toPortId: "product" },
      { edgeId: "edge.brief-skill-hero", fromStepId: "step.brief", fromPortId: "brief", toStepId: "step.hero", toPortId: "brief" },
      ...OUTPUT_SLOTS.flatMap((slot) => [
        {
          edgeId: `edge.skill-render-${slot.slotId}`,
          fromStepId: "step.hero",
          fromPortId: "image",
          toStepId: `step.render-${slot.slotId}`,
          toPortId: "source",
        },
        {
          edgeId: `edge.brief-render-${slot.slotId}`,
          fromStepId: "step.brief",
          fromPortId: "prompt",
          toStepId: `step.render-${slot.slotId}`,
          toPortId: "prompt",
        },
        {
          edgeId: `edge.render-${slot.slotId}-output`,
          fromStepId: `step.render-${slot.slotId}`,
          fromPortId: slot.slotId,
          toStepId: "step.output",
          toPortId: slot.slotId,
        },
      ]),
    ],
    tags: ["beauty", "commerce", "builtin"],
  };

  const recipe = sealRecipeDocument(recipeDraft);
  if (!recipe) {
    const diagnostic = parseRecipeDocument({ ...recipeDraft, contentHash: `sha256:${"0".repeat(64)}` });
    throw new Error(`Built-in Beauty product-hero recipe is invalid: ${JSON.stringify(diagnostic.errors.slice(0, 12))}`);
  }
  return Object.freeze({ skill, tool, recipe, outputSlots: OUTPUT_SLOTS });
}

const BUILTIN_CATALOG = buildBuiltinRecipeCatalog();

function builtinRecipeCatalog() {
  return JSON.parse(JSON.stringify(BUILTIN_CATALOG));
}

function builtinToolManifest() {
  return JSON.parse(JSON.stringify(BUILTIN_CATALOG.tool));
}

function defaultAtomicJsonWrite(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

function strictJsonRead(filePath, errorCode, message) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw Object.assign(new Error(message), { code: errorCode, cause: error });
  }
}

function recipeSummary(recipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    version: recipe.version,
    contentHash: recipe.contentHash,
    builtin: true,
    inputSlots: recipe.inputSlots.map((slot) => ({ ...slot })),
    outputSlots: recipe.outputContract.outputs.map((slot) => ({
      ...slot,
      defaultDirection: OUTPUT_SLOTS.find((item) => item.slotId === slot.slotId)?.defaultDirection || "",
    })),
  };
}

function createRecipeStore(options = {}) {
  const {
    projectFor,
    metaDir = ".naimage",
    writeJson = defaultAtomicJsonWrite,
  } = options;
  if (typeof projectFor !== "function") throw new Error("RecipeStore requires projectFor.");
  if (typeof writeJson !== "function") throw new Error("RecipeStore requires an atomic JSON writer.");

  function paths(projectId) {
    const project = projectFor(String(projectId || ""));
    if (!project?.path) {
      throw Object.assign(new Error("当前项目不存在，无法读取 Recipe。"), { code: "PROJECT_NOT_FOUND" });
    }
    const root = path.join(path.resolve(project.path), metaDir, "recipes");
    return {
      project,
      root,
      index: path.join(root, RECIPE_INDEX_FILE),
      recipe: path.join(root, `${BUILTIN_RECIPE_ID}.json`),
    };
  }

  function validateIndex(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        value.schemaVersion !== RECIPE_INDEX_SCHEMA_VERSION || !Array.isArray(value.recipes)) {
      throw Object.assign(new Error("Recipe 索引无法读取；未执行 Recipe。"), { code: "RECIPE_INDEX_INVALID" });
    }
    return value;
  }

  function seed(projectId) {
    const locations = paths(projectId);
    const recipe = builtinRecipeCatalog().recipe;
    let index;
    if (existsSync(locations.index)) {
      index = validateIndex(strictJsonRead(locations.index, "RECIPE_INDEX_INVALID", "Recipe 索引无法读取；未执行 Recipe。"));
    } else {
      index = {
        schemaVersion: RECIPE_INDEX_SCHEMA_VERSION,
        revision: 0,
        recipes: [],
      };
    }

    let writeRecipe = !existsSync(locations.recipe);
    if (!writeRecipe) {
      const parsed = parseRecipeDocument(strictJsonRead(locations.recipe, "RECIPE_DOCUMENT_INVALID", "Recipe 文件无法读取；未执行 Recipe。"));
      if (!parsed.ok) {
        throw Object.assign(new Error("Recipe 文件损坏或版本不兼容；未执行 Recipe。"), {
          code: "RECIPE_DOCUMENT_INVALID",
          details: parsed.errors.slice(0, 8),
        });
      }
      writeRecipe = parsed.value.id !== recipe.id ||
        parsed.value.version !== recipe.version ||
        parsed.value.contentHash !== recipe.contentHash;
    }
    if (writeRecipe) writeJson(locations.recipe, recipe);

    const summary = recipeSummary(recipe);
    const current = index.recipes.find((item) => item?.id === recipe.id);
    const indexChanged = !current || JSON.stringify(current) !== JSON.stringify(summary);
    if (indexChanged) {
      index = {
        schemaVersion: RECIPE_INDEX_SCHEMA_VERSION,
        revision: Math.max(0, Number(index.revision) || 0) + 1,
        updatedAt: new Date().toISOString(),
        recipes: [summary],
      };
      writeJson(locations.index, index);
    }
    return { ...locations, recipeDocument: recipe, index, summary };
  }

  function list(projectId) {
    const seeded = seed(projectId);
    return {
      revision: Math.max(0, Number(seeded.index.revision) || 0),
      recipes: seeded.index.recipes.filter((item) => item?.id === seeded.recipeDocument.id).map((item) => JSON.parse(JSON.stringify(item))),
    };
  }

  function get(projectId, recipeId = BUILTIN_RECIPE_ID) {
    if (String(recipeId || "") !== BUILTIN_RECIPE_ID) {
      throw Object.assign(new Error("本批只提供内置 Beauty product-hero Recipe。"), { code: "RECIPE_NOT_FOUND" });
    }
    const seeded = seed(projectId);
    const parsed = parseRecipeDocument(strictJsonRead(seeded.recipe, "RECIPE_DOCUMENT_INVALID", "Recipe 文件无法读取。"));
    if (!parsed.ok) {
      throw Object.assign(new Error("Recipe 文件损坏；未执行 Recipe。"), { code: "RECIPE_DOCUMENT_INVALID", details: parsed.errors.slice(0, 8) });
    }
    return JSON.parse(JSON.stringify(parsed.value));
  }

  function contentDigest(projectId, recipeId = BUILTIN_RECIPE_ID) {
    const recipe = get(projectId, recipeId);
    return `sha256:${createHash("sha256").update(JSON.stringify(recipe)).digest("hex")}`;
  }

  return {
    builtinRecipeId: BUILTIN_RECIPE_ID,
    list,
    get,
    contentDigest,
  };
}

module.exports = {
  BUILTIN_RECIPE_ID,
  createRecipeStore,
  builtinRecipeCatalog,
  builtinToolManifest,
};
