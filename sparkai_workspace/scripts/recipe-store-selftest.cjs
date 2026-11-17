"use strict";

const assert = require("node:assert/strict");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const {
  BUILTIN_RECIPE_ID,
  createRecipeStore,
  builtinRecipeCatalog,
} = require("../desktop/recipe-store.cjs");

const root = path.join(__dirname, "..");
const runDir = path.join(root, ".diagnostics", `recipe-store-${Date.now().toString(36)}`);
const projectDir = path.join(runDir, "project");
mkdirSync(projectDir, { recursive: true });

const checks = [];
function check(name, operation) {
  operation();
  checks.push(name);
}

const project = {
  id: "recipe-store-project",
  name: "Recipe Store Fixture",
  path: projectDir,
};
const store = createRecipeStore({
  projectFor: projectId => projectId === project.id ? project : null,
  metaDir: ".naimage",
});

check("seeds the project-owned built-in Recipe index and document", () => {
  const result = store.list(project.id);
  assert.equal(result.revision, 1);
  assert.equal(result.recipes.length, 1);
  assert.equal(result.recipes[0].id, BUILTIN_RECIPE_ID);
  assert.equal(result.recipes[0].outputSlots.length, 6);
  assert.ok(result.recipes[0].outputSlots.every(slot => slot.defaultDirection));
  assert.equal(existsSync(path.join(projectDir, ".naimage", "recipes", "recipes.json")), true);
  assert.equal(existsSync(path.join(projectDir, ".naimage", "recipes", `${BUILTIN_RECIPE_ID}.json`)), true);
  assert.equal(existsSync(path.join(projectDir, ".naimage", "recipes", "recipes.json.tmp")), false);
});

check("returns a sealed Recipe that matches the built-in semantic graph", () => {
  const recipe = store.get(project.id);
  const catalog = builtinRecipeCatalog();
  assert.equal(recipe.id, BUILTIN_RECIPE_ID);
  assert.equal(recipe.version, "1.0.0");
  assert.equal(recipe.contentHash, catalog.recipe.contentHash);
  assert.deepEqual(recipe.outputContract.outputs.map(slot => slot.slotId), [
    "hero", "lifestyle", "detail", "model", "packaging", "social",
  ]);
  assert.equal(recipe.nodes.filter(node => node.type === "Tool").length, 6);
  assert.equal(recipe.nodes.some(node => /ComfyNode|ComfyUI|workflow/i.test(node.type)), false);
});

check("keeps the index revision stable on repeated reads", () => {
  const before = readFileSync(path.join(projectDir, ".naimage", "recipes", "recipes.json"), "utf8");
  const first = store.list(project.id);
  const second = store.list(project.id);
  const after = readFileSync(path.join(projectDir, ".naimage", "recipes", "recipes.json"), "utf8");
  assert.equal(first.revision, second.revision);
  assert.equal(before, after);
});

check("fails closed on a tampered Recipe document", () => {
  const recipePath = path.join(projectDir, ".naimage", "recipes", `${BUILTIN_RECIPE_ID}.json`);
  const original = readFileSync(recipePath, "utf8");
  const tampered = JSON.parse(original);
  tampered.description = "tampered";
  writeFileSync(recipePath, JSON.stringify(tampered, null, 2), "utf8");
  assert.throws(() => store.get(project.id), error => error.code === "RECIPE_DOCUMENT_INVALID");
  writeFileSync(recipePath, original, "utf8");
});

check("rejects unknown Recipes instead of inventing a fallback", () => {
  assert.throws(
    () => store.get(project.id, "recipe.sparkvas.missing"),
    error => error.code === "RECIPE_NOT_FOUND",
  );
});

process.stdout.write(`${JSON.stringify({
  ok: true,
  checks: checks.length,
  recipeHash: builtinRecipeCatalog().recipe.contentHash,
  runDir,
})}\n`);
