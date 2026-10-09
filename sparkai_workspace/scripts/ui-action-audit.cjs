"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const buttonNames = new Set(["button", "ButtonBase", "ActionButton", "IconActionButton", "SegmentButton", "MenuItem"]);
const actions = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith(".tsx")) inspect(file);
  }
}
function inspect(file) {
  const content = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(source);
      if (buttonNames.has(name)) {
        const attrs = node.attributes.properties;
        const handler = attrs.filter(attr => ts.isJsxAttribute(attr) && /^(onClick|onPointerDown|onMouseDown|onKeyDown)$/.test(attr.name.getText(source)));
        const spread = attrs.some(ts.isJsxSpreadAttribute);
        const type = attrs.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "type")?.initializer?.getText(source);
        let form;
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === "form") { form = parent; break; }
        }
        const formId = attrs.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "form")?.initializer?.getText(source)?.replace(/^['"]|['"]$/g, "");
        const linkedForm = formId && new RegExp(`<form\\s[\\s\\S]*?id=["']${formId}["'][\\s\\S]*?onSubmit=`).test(content);
        const submit = type === '"submit"' && (linkedForm || form?.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "onSubmit"));
        const disabled = attrs.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "disabled");
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        actions.push({ file: path.relative(root, file).replaceAll("\\", "/"), line: line + 1, component: name, binding: handler.length ? handler.map(attr => attr.getText(source)).join(" ").slice(0, 300) : submit ? "form.onSubmit" : spread ? "forwarded props (owner review)" : disabled ? "disabled (owner review)" : "UNBOUND", excerpt: node.getText(source).slice(0, 260) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
walk(path.join(root, "src"));
// The independent Agent uses DOM listeners rather than React props.
const nativeFile = path.join(root, "agent-window-renderer.js");
const nativeText = fs.readFileSync(nativeFile, "utf8");
const nativeSource = ts.createSourceFile(nativeFile, nativeText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const aliases = new Map();
const listeners = new Map();
const dynamicButtons = [];
function elementId(node) {
  if (ts.isIdentifier(node)) return aliases.get(node.text) || node.text;
  if (ts.isCallExpression(node) && node.expression.getText(nativeSource) === "document.getElementById" && ts.isStringLiteral(node.arguments[0])) return node.arguments[0].text;
}
function visitNative(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
    const id = elementId(node.initializer);
    if (id) aliases.set(node.name.text, id);
    if (["element", "document.createElement"].includes(node.initializer.expression.getText(nativeSource)) && node.initializer.arguments[0]?.text === "button") dynamicButtons.push(node);
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "addEventListener" && ["click", "submit"].includes(node.arguments[0]?.text)) {
    const owner = elementId(node.expression.expression);
    if (owner) listeners.set(`${owner}:${node.arguments[0].text}`, node.getText(nativeSource).slice(0, 300));
  }
  ts.forEachChild(node, visitNative);
}
visitNative(nativeSource);
const html = fs.readFileSync(path.join(root, "agent-window.html"), "utf8");
for (const match of html.matchAll(/<button\b([^>]*)>/g)) {
  const id = match[1].match(/\bid="([^"]+)"/)?.[1];
  const before = html.slice(0, match.index);
  const formStart = before.lastIndexOf("<form");
  const formId = formStart > before.lastIndexOf("</form>") ? before.slice(formStart).match(/\bid="([^"]+)"/)?.[1] : "";
  const binding = listeners.get(`${id}:click`) || (/\btype="submit"/.test(match[1]) && listeners.get(`${formId}:submit`));
  actions.push({ file: "agent-window.html", line: before.split("\n").length, component: "button", binding: binding || "UNBOUND", excerpt: match[0] });
}
for (const node of dynamicButtons) {
  actions.push({ file: "agent-window-renderer.js", line: nativeSource.getLineAndCharacterOfPosition(node.getStart()).line + 1, component: "dynamic button", binding: listeners.get(`${node.name.text}:click`) || "UNBOUND", excerpt: node.getText(nativeSource) });
}
const report = { generatedAt: new Date().toISOString(), staticOnly: true, total: actions.length, unbound: actions.filter(action => action.binding === "UNBOUND"), delegated: actions.filter(action => action.binding.includes("owner review")), actions };
const target = path.join(root, ".diagnostics", "ui-action-audit.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ total: report.total, unbound: report.unbound, delegatedCount: report.delegated.length, report: target })}\n`);
if (report.unbound.length) process.exitCode = 1;
