import { Fragment, useState, type ReactNode } from "react";
import { Clipboard } from "lucide-react";

import { ButtonBase } from "./ui";

function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
  return Promise.resolve();
}

function MarkdownCodeBlock({ language, text }: { language: string; text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await copyTextToClipboard(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-head">
        <span>{language}</span>
        <ButtonBase type="button" onClick={copy} title="复制代码">
          <Clipboard size={13} />
          {copied ? "已复制" : "复制"}
        </ButtonBase>
      </div>
      <pre><code>{text}</code></pre>
    </div>
  );
}

function safeLinkHref(value: string) {
  const href = String(value || "").trim();
  return /^(?:https?:\/\/|mailto:)/i.test(href) ? href : "";
}

function renderInline(source: string, keyPrefix: string): ReactNode[] {
  const value = String(source || "");
  const tokens = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of value.matchAll(tokens)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(value.slice(cursor, index));
    const key = `${keyPrefix}-${tokenIndex}`;
    tokenIndex += 1;
    if (match[1] !== undefined) {
      nodes.push(<code key={key}>{match[1]}</code>);
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const href = safeLinkHref(match[3]);
      nodes.push(href
        ? <a key={key} href={href} target="_blank" rel="noreferrer">{renderInline(match[2], `${key}-link`)}</a>
        : <Fragment key={key}>{renderInline(match[2], `${key}-label`)}</Fragment>);
    } else if (match[4] !== undefined || match[5] !== undefined) {
      const text = match[4] ?? match[5] ?? "";
      nodes.push(<strong key={key}>{renderInline(text, `${key}-strong`)}</strong>);
    } else {
      const text = match[6] ?? match[7] ?? "";
      nodes.push(<em key={key}>{renderInline(text, `${key}-em`)}</em>);
    }
    cursor = index + match[0].length;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes.length ? nodes : [value];
}

function isHorizontalRule(line: string) {
  const compact = line.trim().replace(/\s+/g, "");
  return /^(?:\*{3,}|-{3,}|_{3,})$/.test(compact);
}

function blockKind(line: string) {
  if (/^\s*```/.test(line)) return "fence";
  if (/^\s{0,3}#{1,6}\s+/.test(line)) return "heading";
  if (/^\s{0,3}>\s?/.test(line)) return "quote";
  if (/^\s*[-+*]\s+/.test(line)) return "unordered-list";
  if (/^\s*\d+[.)]\s+/.test(line)) return "ordered-list";
  if (isHorizontalRule(line)) return "rule";
  return "paragraph";
}

function renderMarkdownBlocks(content: string) {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const kind = blockKind(line);
    const key = `md-${blocks.length}`;
    if (kind === "fence") {
      const language = line.replace(/^\s*```/, "").trim().split(/\s+/)[0] || "text";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<MarkdownCodeBlock key={key} language={language} text={body.join("\n")} />);
      continue;
    }

    if (kind === "heading") {
      const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      const level = Math.min(6, Math.max(1, match?.[1].length ?? 2));
      const text = match?.[2] ?? line;
      const Heading = `h${level}` as keyof JSX.IntrinsicElements;
      blocks.push(<Heading key={key}>{renderInline(text, `${key}-heading`)}</Heading>);
      index += 1;
      continue;
    }

    if (kind === "rule") {
      blocks.push(<hr key={key} />);
      index += 1;
      continue;
    }

    if (kind === "quote") {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={key}><p>{renderInline(quoteLines.join(" ").trim(), `${key}-quote`)}</p></blockquote>);
      continue;
    }

    if (kind === "unordered-list" || kind === "ordered-list") {
      const ordered = kind === "ordered-list";
      const matcher = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/;
      const items: string[] = [];
      while (index < lines.length) {
        const match = matcher.exec(lines[index]);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      const children = items.map((item, itemIndex) => (
        <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}-item`)}</li>
      ));
      blocks.push(ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && blockKind(lines[index]) === "paragraph") {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={key}>{renderInline(paragraphLines.join(" "), `${key}-paragraph`)}</p>);
  }

  return blocks;
}

export default function RichMarkdownMessage({ content }: { content: string }) {
  return <>{renderMarkdownBlocks(content)}</>;
}
