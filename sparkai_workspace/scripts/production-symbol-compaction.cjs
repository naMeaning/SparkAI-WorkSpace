const { readFileSync, readdirSync, statSync } = require("node:fs");
const { createRequire } = require("node:module");
const { extname, join, relative, resolve } = require("node:path");
const ts = require("typescript");

const requireFromVite = createRequire(require.resolve("vite"));
const postcss = requireFromVite("postcss");

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const PROTECTED_TEXT_EXTENSIONS = new Set([".cjs", ".css", ".html", ".js", ".json", ".jsx", ".mjs", ".ts", ".tsx"]);
const CLASS_MIN_LENGTH = 8;
const CUSTOM_PROPERTY_MIN_LENGTH = 8;
const KEYFRAME_MIN_LENGTH = 8;
const CSS_IDENTIFIER = "[_a-zA-Z0-9-]";
const SHORT_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function filesRecursively(directory) {
  if (!directory || !statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(path) : [path];
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenPattern(value, prefix = "") {
  return prefix
    ? new RegExp(`${prefix}${escapeRegExp(value)}(?!${CSS_IDENTIFIER})`, "g")
    : new RegExp(`(?<!${CSS_IDENTIFIER})${escapeRegExp(value)}(?!${CSS_IDENTIFIER})`, "g");
}

function replaceTokenMap(value, replacements, prefix = "", replacementPrefix = prefix) {
  let next = String(value);
  for (const [source, target] of replacements) {
    next = next.replace(tokenPattern(source, prefix), `${replacementPrefix}${target}`);
  }
  return next;
}

function balancedExpression(value, openIndex, openCharacter, closeCharacter) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === openCharacter) depth += 1;
    else if (character === closeCharacter && --depth === 0) return value.slice(openIndex + 1, index);
  }
  return value.slice(openIndex + 1);
}

function dynamicClassExpressions(value) {
  const expressions = [];
  const balancedCalls = /(?:\bclassName\s*=\s*|\bclassName\s*:\s*|\bjoinClassNames\s*|\.classList\.(?:add|remove|toggle|replace)\s*|\.setAttribute\(\s*["']class["']\s*,\s*)([({])/g;
  for (const match of value.matchAll(balancedCalls)) {
    const openCharacter = match[1];
    const openIndex = Number(match.index) + match[0].lastIndexOf(openCharacter);
    expressions.push(balancedExpression(value, openIndex, openCharacter, openCharacter === "{" ? "}" : ")"));
  }
  for (const match of value.matchAll(/\bclassName\s*=\s*(`[^`]*`|[^;\n]+)/g)) expressions.push(match[1]);
  return expressions;
}

function dynamicClassFragments(codeSources) {
  const prefixes = new Set();
  const suffixes = new Set();
  for (const source of codeSources) {
    for (const value of dynamicClassExpressions(String(source.code))) {
      for (const match of value.matchAll(/([_a-zA-Z][_a-zA-Z0-9-]*[-_])\$\{/g)) {
        if (match[1].length >= 3) prefixes.add(match[1]);
      }
      for (const match of value.matchAll(/["'`]([_a-zA-Z][_a-zA-Z0-9-]*[-_])["'`]\s*\+/g)) {
        if (match[1].length >= 3) prefixes.add(match[1]);
      }
      for (const match of value.matchAll(/\+\s*["'`]([-_][_a-zA-Z0-9-]*)["'`]/g)) {
        if (match[1].length >= 3) suffixes.add(match[1]);
      }
    }
  }
  return { prefixes, suffixes };
}

function withoutModuleSpecifiers(code) {
  return String(code).replace(
    /((?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["'])([^"']+)(["'])/g,
    "$1__NAIMAGE_MODULE_SPECIFIER__$3"
  );
}

function fallbackStringLiteralText(code) {
  const source = String(code);
  const literals = [];
  for (let index = 0; index < source.length;) {
    if (source[index] === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index < 0) break;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    const quote = source[index];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      index += 1;
      continue;
    }
    let literal = "";
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === "\\" && index + 1 < source.length) {
        literal += source[index + 1];
        index += 2;
        continue;
      }
      if (character === quote) {
        index += 1;
        break;
      }
      literal += character;
      index += 1;
    }
    literals.push(literal);
  }
  return literals.join("\n");
}

function codeStringLiteralText(code, filePath = "source.tsx") {
  const extension = extname(filePath).toLowerCase();
  if (!CODE_EXTENSIONS.has(extension)) return fallbackStringLiteralText(code);
  const scriptKind = extension === ".tsx"
    ? ts.ScriptKind.TSX
    : extension === ".jsx"
      ? ts.ScriptKind.JSX
      : extension === ".js"
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, String(code), ts.ScriptTarget.Latest, false, scriptKind);
  const literals = [];
  const visit = (node) => {
    if (
      ts.isStringLiteralLike(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail ||
      node.kind === ts.SyntaxKind.RegularExpressionLiteral
    ) {
      literals.push(String(node.text || ""));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals.join("\n");
}

function shortSymbol(index) {
  let value = Math.max(0, Number(index) || 0);
  let result = "";
  do {
    result = SHORT_ALPHABET[value % SHORT_ALPHABET.length] + result;
    value = Math.floor(value / SHORT_ALPHABET.length) - 1;
  } while (value >= 0);
  return result;
}

function allocateShortNames(symbols, reserved, decorate = (value) => value) {
  const replacements = new Map();
  let cursor = 0;
  for (const symbol of symbols) {
    let candidate = "";
    do candidate = decorate(shortSymbol(cursor++));
    while (reserved.has(candidate));
    reserved.add(candidate);
    replacements.set(symbol, candidate);
  }
  return replacements;
}

function collectCssInventory(cssSources) {
  const classCounts = new Map();
  const customPropertyCounts = new Map();
  const keyframeCounts = new Map();
  const animationValues = [];
  for (const source of cssSources) {
    const root = postcss.parse(source.code, { from: source.filePath });
    root.walkRules((rule) => {
      for (const match of String(rule.selector || "").matchAll(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g)) {
        classCounts.set(match[1], (classCounts.get(match[1]) || 0) + 1);
      }
    });
    for (const match of String(source.code).matchAll(/(--[_a-zA-Z][_a-zA-Z0-9-]*)/g)) {
      customPropertyCounts.set(match[1], (customPropertyCounts.get(match[1]) || 0) + 1);
    }
    root.walkAtRules((atRule) => {
      if (!/keyframes$/i.test(String(atRule.name || ""))) return;
      const name = String(atRule.params || "").trim().split(/\s+/, 1)[0];
      if (name) keyframeCounts.set(name, (keyframeCounts.get(name) || 0) + 1);
    });
    root.walkDecls((declaration) => {
      if (/^animation(?:-name)?$/i.test(String(declaration.prop || ""))) {
        animationValues.push(String(declaration.value || ""));
      }
    });
  }
  return { animationValues, classCounts, customPropertyCounts, keyframeCounts };
}

function buildSymbolPlan({ cssSources, codeSources, protectedSources = [] }) {
  const { animationValues, classCounts, customPropertyCounts, keyframeCounts } = collectCssInventory(cssSources);
  const codeText = codeSources.map((source) => withoutModuleSpecifiers(source.code)).join("\n");
  const protectedText = protectedSources.map((source) => source.code).join("\n");
  const dynamicFragments = dynamicClassFragments(codeSources.map((source) => ({
    ...source,
    code: withoutModuleSpecifiers(source.code)
  })));
  const classLiteralText = codeSources.map((source) => (
    codeStringLiteralText(withoutModuleSpecifiers(source.code), source.filePath)
  )).join("\n");
  const classCodeOccurrences = new Map();
  for (const match of classLiteralText.matchAll(/[_a-zA-Z][_a-zA-Z0-9-]*/g)) {
    classCodeOccurrences.set(match[0], (classCodeOccurrences.get(match[0]) || 0) + 1);
  }
  const protectedSymbol = (symbol) => protectedText.includes(symbol);
  const animationReferences = new Set([...keyframeCounts.keys()].filter((symbol) => (
    animationValues.some((value) => tokenPattern(symbol).test(value)) || classLiteralText.includes(symbol)
  )));
  const referencedCustomProperties = new Set(cssSources.flatMap((source) => (
    [...String(source.code).matchAll(/var\(\s*(--[_a-zA-Z][_a-zA-Z0-9-]*)/g)].map((match) => match[1])
  )));
  const dynamicClass = (symbol) => (
    [...dynamicFragments.prefixes].some((fragment) => symbol.startsWith(fragment)) ||
    [...dynamicFragments.suffixes].some((fragment) => symbol.endsWith(fragment))
  );
  const retiredClasses = new Set([...classCounts.keys()].filter((symbol) => (
    !classCodeOccurrences.has(symbol) &&
    !protectedSymbol(symbol) &&
    !dynamicClass(symbol)
  )));
  const retiredCustomProperties = new Set([...customPropertyCounts.keys()].filter((symbol) => (
    !referencedCustomProperties.has(symbol) &&
    !classLiteralText.includes(symbol) &&
    !protectedSymbol(symbol)
  )));
  const retiredKeyframes = new Set([...keyframeCounts.keys()].filter((symbol) => (
    !animationReferences.has(symbol) && !protectedSymbol(symbol)
  )));
  const classCandidates = [...classCounts]
    .filter(([symbol]) => (
      symbol.length >= CLASS_MIN_LENGTH &&
      symbol.includes("-") &&
      !protectedSymbol(symbol) &&
      classCodeOccurrences.get(symbol) > 0 &&
      !dynamicClass(symbol)
    ))
    .sort((left, right) => {
      const leftWeight = (left[1] + classCodeOccurrences.get(left[0])) * left[0].length;
      const rightWeight = (right[1] + classCodeOccurrences.get(right[0])) * right[0].length;
      return rightWeight - leftWeight || left[0].localeCompare(right[0]);
    })
    .map(([symbol]) => symbol);
  const customPropertyCandidates = [...customPropertyCounts]
    .filter(([symbol]) => symbol.length >= CUSTOM_PROPERTY_MIN_LENGTH && !protectedSymbol(symbol))
    .sort((left, right) => (
      right[1] * right[0].length - left[1] * left[0].length || left[0].localeCompare(right[0])
    ))
    .map(([symbol]) => symbol);
  const keyframeCandidates = [...keyframeCounts]
    .filter(([symbol]) => (
      symbol.length >= KEYFRAME_MIN_LENGTH &&
      animationReferences.has(symbol) &&
      !protectedSymbol(symbol)
    ))
    .sort((left, right) => {
      const leftOccurrences = animationValues.filter((value) => tokenPattern(left[0]).test(value)).length;
      const rightOccurrences = animationValues.filter((value) => tokenPattern(right[0]).test(value)).length;
      return rightOccurrences * right[0].length - leftOccurrences * left[0].length || left[0].localeCompare(right[0]);
    })
    .map(([symbol]) => symbol);
  const classes = allocateShortNames(classCandidates, new Set(classCounts.keys()));
  const customProperties = allocateShortNames(
    customPropertyCandidates,
    new Set(customPropertyCounts.keys()),
    (value) => `--${value}`
  );
  const keyframes = allocateShortNames(keyframeCandidates, new Set(keyframeCounts.keys()));
  return {
    classes,
    customProperties,
    keyframes,
    retiredClasses,
    retiredCustomProperties,
    retiredKeyframes,
    inventory: {
      classes: classCounts.size,
      customProperties: customPropertyCounts.size,
      compactedClasses: classes.size,
      compactedCustomProperties: customProperties.size,
      compactedKeyframes: keyframes.size,
      retiredClasses: retiredClasses.size,
      retiredCustomProperties: retiredCustomProperties.size,
      retiredKeyframes: retiredKeyframes.size,
      keyframes: keyframeCounts.size
    }
  };
}

function splitSelectorList(selector) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  let escaped = false;
  const value = String(selector || "");
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function selectorUsesRetiredClass(selector, retiredClasses) {
  for (const match of String(selector).matchAll(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g)) {
    if (retiredClasses.has(match[1])) return true;
  }
  return false;
}

const ROOT_SELECTOR_FAMILIES = Object.freeze([
  {
    left: ":root.glass-theme-active",
    right: ":root[data-glass-theme]",
    merged: ":root[data-glass-theme]"
  },
  {
    left: ':root[data-theme="dark"]',
    right: ":root.theme-dark",
    merged: ':root[data-theme="dark"]'
  },
  {
    left: ':root[data-glass-reduce-motion="true"]',
    right: ":root.glass-reduce-motion",
    merged: ':root[data-glass-reduce-motion="true"]'
  },
  {
    left: ':root[data-glass-noise="off"]',
    right: ":root.glass-no-noise",
    merged: ':root[data-glass-noise="off"]'
  }
]);

function compactEquivalentRootSelectors(selector) {
  let selectors = splitSelectorList(selector);
  for (const family of ROOT_SELECTOR_FAMILIES) {
    const sidesBySuffix = new Map();
    selectors.forEach((candidate, index) => {
      const side = candidate.startsWith(family.left)
        ? "left"
        : candidate.startsWith(family.right)
          ? "right"
          : "";
      if (!side) return;
      const prefix = side === "left" ? family.left : family.right;
      const suffix = candidate.slice(prefix.length);
      const entry = sidesBySuffix.get(suffix) || {};
      entry[side] = index;
      sidesBySuffix.set(suffix, entry);
    });
    const replacements = new Map();
    const removed = new Set();
    for (const [suffix, entry] of sidesBySuffix) {
      if (!Number.isInteger(entry.left) || !Number.isInteger(entry.right)) continue;
      const retainedIndex = Math.min(entry.left, entry.right);
      const removedIndex = Math.max(entry.left, entry.right);
      replacements.set(retainedIndex, `${family.merged}${suffix}`);
      removed.add(removedIndex);
    }
    selectors = selectors.flatMap((candidate, index) => (
      removed.has(index) ? [] : [replacements.get(index) || candidate]
    ));
  }
  return selectors.join(",");
}

function declarationCoverage(rule) {
  if (!Array.isArray(rule.nodes) || rule.nodes.some((node) => node.type !== "decl" && node.type !== "comment")) return null;
  const declarations = rule.nodes.filter((node) => node.type === "decl");
  if (!declarations.length) return null;
  return new Set(declarations.map((declaration) => `${declaration.prop}\u0000${declaration.important ? "important" : "normal"}`));
}

function discardFullyOverriddenRules(container) {
  if (!Array.isArray(container.nodes)) return;
  const laterCoverage = new Map();
  for (let index = container.nodes.length - 1; index >= 0; index -= 1) {
    const node = container.nodes[index];
    if (node.type !== "rule") continue;
    const coverage = declarationCoverage(node);
    if (!coverage) continue;
    const key = String(node.selector || "");
    const later = laterCoverage.get(key);
    if (later) {
      node.walkDecls((declaration) => {
        const property = `${declaration.prop}\u0000${declaration.important ? "important" : "normal"}`;
        if (later.has(property)) declaration.remove();
      });
      if (!node.nodes?.some((child) => child.type === "decl")) {
        node.remove();
        continue;
      }
    }
    const remainingCoverage = declarationCoverage(node);
    if (!remainingCoverage) continue;
    if (!later) laterCoverage.set(key, new Set(remainingCoverage));
    else for (const property of remainingCoverage) later.add(property);
  }
  for (const node of [...(container.nodes || [])]) {
    if (node.type === "atrule" && !/keyframes$/i.test(String(node.name || ""))) discardFullyOverriddenRules(node);
  }
}

function declarationSignature(rule) {
  if (!Array.isArray(rule.nodes) || !rule.nodes.length || rule.nodes.some((node) => node.type !== "decl")) return "";
  return rule.nodes.map((declaration) => (
    `${declaration.prop}\u0000${declaration.value}\u0000${declaration.important ? "important" : "normal"}`
  )).join("\u0001");
}

function mergeAdjacentEquivalentRules(container) {
  if (!Array.isArray(container.nodes)) return;
  for (const node of [...container.nodes]) {
    if (node.type === "atrule" && !/keyframes$/i.test(String(node.name || ""))) mergeAdjacentEquivalentRules(node);
  }
  let previous = null;
  for (const node of [...container.nodes]) {
    if (node.type !== "rule") {
      previous = null;
      continue;
    }
    if (previous?.type === "rule" && previous.selector === node.selector) {
      for (const child of [...(node.nodes || [])]) previous.append(child);
      node.remove();
      continue;
    }
    const previousSignature = previous?.type === "rule" ? declarationSignature(previous) : "";
    const signature = declarationSignature(node);
    if (previousSignature && signature === previousSignature) {
      previous.selector = `${previous.selector},${node.selector}`;
      node.remove();
      continue;
    }
    previous = node;
  }
}

function discardExactDuplicateDeclarations(root) {
  root.walkRules((rule) => {
    const seen = new Set();
    for (const node of [...(rule.nodes || [])].reverse()) {
      if (node.type !== "decl") continue;
      const signature = `${node.prop}\u0000${node.value}\u0000${node.important ? "important" : "normal"}`;
      if (seen.has(signature)) node.remove();
      else seen.add(signature);
    }
  });
}

function discardEmptyContainers(root) {
  root.walkRules((rule) => {
    if (!rule.nodes?.some((node) => node.type !== "comment")) rule.remove();
  });
  let removed = true;
  while (removed) {
    removed = false;
    root.walkAtRules((atRule) => {
      if (Array.isArray(atRule.nodes) && !atRule.nodes.some((node) => node.type !== "comment")) {
        atRule.remove();
        removed = true;
      }
    });
  }
}

function optimizeCssRoot(root, plan) {
  root.walkAtRules((atRule) => {
    if (!/keyframes$/i.test(String(atRule.name || ""))) return;
    const name = String(atRule.params || "").trim().split(/\s+/, 1)[0];
    if (plan.retiredKeyframes?.has(name)) atRule.remove();
  });
  root.walkRules((rule) => {
    if (/keyframes$/i.test(String(rule.parent?.name || ""))) return;
    const selectors = splitSelectorList(rule.selector);
    const retained = selectors.filter((selector) => !selectorUsesRetiredClass(selector, plan.retiredClasses));
    if (!retained.length) rule.remove();
    else rule.selector = compactEquivalentRootSelectors(retained.join(","));
  });
  root.walkDecls((declaration) => {
    if (plan.retiredCustomProperties.has(declaration.prop)) declaration.remove();
  });
  root.walkAtRules("property", (atRule) => {
    if (plan.retiredCustomProperties.has(String(atRule.params || "").trim())) atRule.remove();
  });
  discardFullyOverriddenRules(root);
  mergeAdjacentEquivalentRules(root);
  discardExactDuplicateDeclarations(root);
  discardEmptyContainers(root);
  return root;
}

function transformCssRoot(root, plan) {
  optimizeCssRoot(root, plan);
  root.walkRules((rule) => {
    rule.selector = replaceTokenMap(rule.selector, plan.classes, "\\.", ".");
    rule.selector = replaceTokenMap(rule.selector, plan.customProperties);
  });
  root.walkDecls((declaration) => {
    declaration.prop = replaceTokenMap(declaration.prop, plan.customProperties);
    declaration.value = replaceTokenMap(declaration.value, plan.customProperties);
    declaration.value = replaceTokenMap(declaration.value, plan.keyframes || new Map());
  });
  root.walkAtRules((atRule) => {
    atRule.params = replaceTokenMap(atRule.params, plan.customProperties);
    if (/keyframes$/i.test(String(atRule.name || ""))) {
      atRule.params = replaceTokenMap(atRule.params, plan.keyframes || new Map());
    }
  });
  return root;
}

function transformCss(code, plan, filePath = "styles.css") {
  const root = postcss.parse(String(code), { from: filePath });
  transformCssRoot(root, plan);
  return root.toString();
}

function optimizeBundledCss(code, filePath = "bundle.css") {
  const root = postcss.parse(String(code), { from: filePath });
  root.walkRules((rule) => {
    if (!/keyframes$/i.test(String(rule.parent?.name || ""))) {
      rule.selector = compactEquivalentRootSelectors(rule.selector);
    }
  });
  discardFullyOverriddenRules(root);
  mergeAdjacentEquivalentRules(root);
  discardExactDuplicateDeclarations(root);
  discardEmptyContainers(root);
  return root.toString();
}

function createPostcssSymbolCompactionPlugin(plan) {
  return {
    postcssPlugin: "naimage-production-symbol-compaction",
    Once(root) {
      transformCssRoot(root, plan);
    }
  };
}
createPostcssSymbolCompactionPlugin.postcss = true;

function transformCode(code, plan, filePath = "source.tsx") {
  const moduleSpecifiers = [];
  let protectedCode = String(code).replace(
    /((?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["'])([^"']+)(["'])/g,
    (_match, open, specifier, close) => {
      const token = `__NAIMAGE_MODULE_SPECIFIER_${moduleSpecifiers.length}__`;
      moduleSpecifiers.push(specifier);
      return `${open}${token}${close}`;
    }
  );
  protectedCode = replaceTokenMap(protectedCode, plan.classes);
  protectedCode = replaceTokenMap(protectedCode, plan.customProperties);
  protectedCode = replaceTokenMap(protectedCode, plan.keyframes || new Map());
  return protectedCode.replace(/__NAIMAGE_MODULE_SPECIFIER_(\d+)__/g, (_match, index) => moduleSpecifiers[Number(index)]);
}

function readSource(filePath) {
  return { filePath, code: readFileSync(filePath, "utf8") };
}

function buildProductionSymbolPlan(projectRoot) {
  const root = resolve(projectRoot);
  const sourceRoot = join(root, "src");
  const sourceFiles = filesRecursively(sourceRoot);
  const cssSources = sourceFiles.filter((filePath) => extname(filePath).toLowerCase() === ".css").map(readSource);
  const codeSources = sourceFiles.filter((filePath) => CODE_EXTENSIONS.has(extname(filePath).toLowerCase())).map(readSource);
  for (const runtimePath of [join(root, "index.html"), join(root, "public", "glass-theme-bootstrap.js")]) {
    if (statSync(runtimePath, { throwIfNoEntry: false })?.isFile()) codeSources.push(readSource(runtimePath));
  }
  const protectedPaths = [
    join(root, "electron-main.cjs"),
    join(root, "preload.cjs"),
    join(root, "agent-runtime.cjs"),
    join(root, "scripts", "product-performance-gate.mjs"),
    ...filesRecursively(join(root, "scripts", "release"))
  ].filter((filePath) => statSync(filePath, { throwIfNoEntry: false })?.isFile());
  const protectedSources = protectedPaths.map(readSource);
  return buildSymbolPlan({ cssSources, codeSources, protectedSources });
}

function createProductionSymbolCompactionPlugin(projectRoot) {
  const root = resolve(projectRoot);
  const normalizedSourceRoot = `${join(root, "src").replace(/\\/g, "/")}/`;
  const plan = buildProductionSymbolPlan(root);
  return {
    name: "naimage-production-symbol-compaction",
    apply: "build",
    enforce: "pre",
    buildStart() {
      this.info(`[symbol-compaction] ${plan.inventory.compactedClasses}/${plan.inventory.classes} classes, ${plan.inventory.compactedCustomProperties}/${plan.inventory.customProperties} custom properties, ${plan.inventory.compactedKeyframes}/${plan.inventory.keyframes} keyframes`);
    },
    transform(code, id) {
      const cleanId = String(id).split("?", 1)[0];
      if (!cleanId.replace(/\\/g, "/").startsWith(normalizedSourceRoot)) return null;
      const extension = extname(cleanId).toLowerCase();
      if (extension === ".css") return null;
      if (CODE_EXTENSIONS.has(extension)) return { code: transformCode(code, plan, cleanId), map: null };
      return null;
    },
    transformIndexHtml(html) {
      let next = replaceTokenMap(html, plan.classes);
      next = replaceTokenMap(next, plan.customProperties);
      next = replaceTokenMap(next, plan.keyframes);
      return next;
    },
    generateBundle(_outputOptions, bundle) {
      let savedBytes = 0;
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".css")) continue;
        const source = typeof asset.source === "string" ? asset.source : Buffer.from(asset.source).toString("utf8");
        const optimized = optimizeBundledCss(source, asset.fileName);
        savedBytes += Buffer.byteLength(source) - Buffer.byteLength(optimized);
        asset.source = optimized;
      }
      if (savedBytes > 0) this.info(`[css-compaction] removed ${savedBytes} bytes after bundle assembly`);
    },
    api: { plan }
  };
}

module.exports = {
  buildProductionSymbolPlan,
  buildSymbolPlan,
  createPostcssSymbolCompactionPlugin,
  createProductionSymbolCompactionPlugin,
  optimizeBundledCss,
  transformCode,
  transformCss
};
