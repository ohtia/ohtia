import { Fragment as MarkdownFragment, memo, useMemo, type ReactNode } from "react";
import { fromMarkdown, type CompileContext } from "mdast-util-from-markdown";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { isExternalMessageLink, message, type InterfaceLocale } from "@ohtia/contracts";
import { LucideGlyph } from "./iconography.js";
import { Tooltip } from "./layers.js";
import { clippedText } from "./text-preview.js";
import "./message-markdown.css";

type Root = ReturnType<typeof fromMarkdown>;
// Use the parser’s own node union, including the table extension’s type augmentation.
type Node = Parameters<CompileContext["enter"]>[0];
type Block = Root["children"][number];

type LiteralMessage = {
  text: string;
  restore(value: string): string;
  original(start: number, end: number): string;
  definition(identifier: string, start: number): boolean;
  table(start: number): boolean;
  origin(type: string, start: number, end: number): boolean;
};

/** Bound every recursive pass while retaining excessive nesting as readable source. */
function withinMarkdownDepth(tree: Node): boolean {
  const pending = [{ node: tree, depth: 0 }];
  for (let entry = pending.pop(); entry; entry = pending.pop()) {
    if (entry.depth > 12) return false;
    if ("children" in entry.node)
      for (const child of entry.node.children)
        pending.push({ node: child, depth: entry.depth + 1 });
  }
  return true;
}
function plainMessage(source: string): LiteralMessage {
  const text = "OHTIAPLAINMESSAGE";
  return {
    text,
    restore: (value) => (value === text ? source : value),
    original: () => source,
    definition: () => false,
    table: () => false,
    origin: () => false,
  };
}

/** Unsupported notation stays literal without consuming supported container structure. */
function literalNotation(source: string): LiteralMessage {
  const initial = fromMarkdown(source, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
  if (!withinMarkdownDepth(initial)) return plainMessage(source);
  const occupied = new Set(
    [
      ...source
        .toLowerCase()
        .toUpperCase()
        .matchAll(/OHTIALITERAL(\d+)TOKEN/g),
    ].map((match) => match[1]),
  );
  const literals: string[] = [];
  type Range = { start: number; end: number };
  const literalSources: Range[] = [];
  const lineStarts = [0];
  for (
    let newline = source.indexOf("\n");
    newline >= 0;
    newline = source.indexOf("\n", newline + 1)
  )
    lineStarts.push(newline + 1);
  function lineRange(offset: number): Range {
    let low = 0;
    let high = lineStarts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((lineStarts[middle] ?? source.length + 1) <= offset) low = middle + 1;
      else high = middle;
    }
    return {
      start: lineStarts[Math.max(0, low - 1)] ?? 0,
      end: low < lineStarts.length ? (lineStarts[low] ?? source.length + 1) - 1 : source.length,
    };
  }
  const lookahead = { characters: 0, exhausted: false };
  const maximumLookaheadCharacters = source.length * 4;
  const originalDefinitionStarts = new Set<number>();
  const originalTables = new Set<number>();
  const originalNodes = new Set<string>();
  const blockSeparators: (Range & { text: string })[] = [];
  const contexts: (Range & { indent: number; quotes: number })[] = [];
  const opaqueRanges: Range[] = [];
  const boundaries: Range[] = [];
  const sourceDefinitions = new Map<string, Range & { url: string }>();
  const referenceSuffixes: (Range & { identifier: string; referenceStart: number })[] = [];
  const noteLabel = String.raw`\[\^(?:\\[^\s]|[^\s[\]\\])+\]`;
  const noteMarker = new RegExp(`^${noteLabel}`);
  function labelEnd(node: { children: readonly Node[] }, start: number, end: number): number {
    const contentEnd = node.children.at(-1)?.position?.end.offset ?? start + 1;
    const close = source.indexOf("]", contentEnd);
    return close < 0 || close >= end ? end : close + 1;
  }
  const inlineRanges: (Range & { table: boolean })[] = [];
  const flows: (Range & { indent: number; quotes: number; paragraph: boolean })[] = [];
  const columns = (text: string) => {
    let count = 0;
    for (const char of text) count += char === "\t" ? 4 - (count % 4) : 1;
    return count;
  };
  function collectLiteralRanges(
    node: Node,
    indent = 0,
    quotes = 0,
    previous?: Node,
    block = false,
  ): void {
    // Markdown can decode references/escapes into an otherwise absent source token.
    for (const value of Object.values(node)) {
      if (typeof value !== "string") continue;
      for (const match of value
        .toLowerCase()
        .toUpperCase()
        .matchAll(/OHTIALITERAL(\d+)TOKEN/g))
        occupied.add(match[1]);
    }
    if (node.type === "blockquote") quotes++;
    if (node.type === "listItem" && node.position) {
      const first = source.slice(node.position.start.offset);
      const marker = /^(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(first);
      if (marker?.[1]) {
        const width = marker[0].length - marker[1].length;
        const start = node.position.start.offset ?? 0;
        const preceding = source.slice(lineRange(start).start, start);
        const base = columns(preceding) + width;
        const padding = columns(preceding + marker[0]) - base;
        indent = base + (padding <= 4 ? padding : 1);
      }
    }
    if (node.position) {
      const range = {
        start: node.position.start.offset ?? 0,
        end: node.position.end.offset ?? source.length,
      };
      originalNodes.add(`${node.type}:${String(range.start)}:${String(range.end)}`);
      if (block && previous) {
        const before = source.slice(lineRange(range.start).start, range.start);
        blockSeparators.push({ start: range.start, end: range.start, text: "\n" + before });
      }
      contexts.push({ ...range, indent, quotes });
      if (["paragraph", "heading", "tableCell"].includes(node.type))
        inlineRanges.push({ ...range, table: node.type === "tableCell" });
      if (node.type === "paragraph" || node.type === "definition")
        flows.push({ ...range, indent, quotes, paragraph: node.type === "paragraph" });
      if (["code", "inlineCode", "image", "imageReference", "html"].includes(node.type))
        opaqueRanges.push(range);
      if (node.type === "definition" && !noteMarker.test(source.slice(range.start, range.end))) {
        opaqueRanges.push(range);
        originalDefinitionStarts.add(range.start);
        if (!sourceDefinitions.has(node.identifier))
          sourceDefinitions.set(node.identifier, { ...range, url: node.url });
      }
      if (node.type === "table") originalTables.add(range.start);
      if (node.type === "link" || node.type === "linkReference" || node.type === "table")
        boundaries.push(range);
      if (node.type === "link") {
        const label =
          source[range.start] === "[" ? labelEnd(node, range.start, range.end) : range.start;
        opaqueRanges.push({ start: label, end: range.end });
      }
      if (node.type === "linkReference") {
        if (node.referenceType === "full") {
          const label = labelEnd(node, range.start, range.end);
          opaqueRanges.push({ start: label, end: range.end });
        } else {
          referenceSuffixes.push({
            start: node.referenceType === "collapsed" ? range.end - 2 : range.end,
            end: range.end,
            referenceStart: range.start,
            identifier: node.identifier,
          });
        }
      }
    }
    if ("children" in node)
      node.children.forEach((child, index, children) => {
        collectLiteralRanges(
          child,
          indent,
          quotes,
          children[index - 1],
          ["root", "blockquote", "listItem"].includes(node.type),
        );
      });
  }
  collectLiteralRanges(initial);
  let nonce = 0;
  while (occupied.has(String(nonce))) nonce++;
  const prefix = `OHTIALITERAL${String(nonce)}TOKEN`;
  opaqueRanges.sort((a, b) => a.start - b.start || b.end - a.end);
  boundaries.push(...opaqueRanges);
  boundaries.sort((a, b) => a.start - b.start || b.end - a.end);
  /** Only whitespace, quote markers and list markers may precede a definition. */
  function containerPrefix(text: string): boolean {
    let index = 0;
    while (index < text.length) {
      const char = text[index] ?? "";
      if (char === " " || char === "\t" || char === ">") {
        index++;
        continue;
      }
      let end = index;
      if (["-", "+", "*"].includes(char)) end++;
      else {
        while (/\d/.test(text[end] ?? "")) end++;
        if (end === index || end - index > 9 || ![".", ")"].includes(text[end] ?? "")) return false;
        end++;
      }
      if (text[end] !== " " && text[end] !== "\t") return false;
      index = end + 1;
    }
    return true;
  }
  function quotePrefix(
    line: string,
    depth: number,
  ): { index: number; columns: number } | undefined {
    let index = 0;
    let remaining = 0;
    for (let count = 0; count < depth; count++) {
      while (line[index] === " " || line[index] === "\t") index++;
      if (line[index] !== ">") return;
      index++;
      remaining = 0;
      if (line[index] === " " || line[index] === "\t") {
        if (line[index] === "\t") remaining = 3 - (columns(line.slice(0, index)) % 4);
        index++;
      }
    }
    return { index, columns: columns(line.slice(0, index)) - remaining };
  }
  function containerOffset(line: string, depth: number, indent: number): number {
    const prefix = quotePrefix(line, depth) ?? { index: 0, columns: 0 };
    const leading = /^[ \t]*/.exec(line.slice(prefix.index))?.[0] ?? "";
    const base = Math.max(0, indent - prefix.columns);
    let keep = 0;
    while (
      keep < leading.length &&
      columns(line.slice(0, prefix.index + keep)) - prefix.columns < base
    )
      keep++;
    return prefix.index + keep;
  }
  let flowIndex = 0;
  const flowAt = (offset: number) => {
    while ((flows[flowIndex]?.end ?? Infinity) <= offset) flowIndex++;
    const flow = flows[flowIndex];
    return flow && flow.start <= offset ? flow : undefined;
  };
  const token = (text: string, start: number) => {
    literalSources.push({ start, end: start + text.length });
    return `%<%${prefix}${String(literals.push(text) - 1)}END%>%`;
  };
  /** Keep punctuation flanking and internal whitespace/quotes without exposing body syntax. */
  function protectLiteral(text: string, start: number): string {
    const first = text.search(/\S/u);
    const last = /\s*$/u.exec(text)?.index ?? text.length;
    let cursor = 0;
    let output = "";
    for (const match of text.matchAll(/\s+|["']/gu)) {
      const end = match.index + match[0].length;
      if (match[0] !== '"' && match[0] !== "'" && (match.index < first || end > last)) continue;
      if (match.index > cursor) output += token(text.slice(cursor, match.index), start + cursor);
      output += match[0];
      cursor = end;
    }
    if (cursor < text.length || !output) output += token(text.slice(cursor), start + cursor);
    return output;
  }
  /** Retain enclosing quote/list syntax outside each line's literal body. */
  function literalSpan(value: string, start: number): string {
    const flow = flowAt(start);
    const depth = flow?.quotes ?? 0;
    const indent = flow?.indent ?? 0;
    let lineOffset = start;
    return value
      .split("\n")
      .map((line, index) => {
        const lineStart = lineOffset;
        lineOffset += line.length + 1;
        if (index === 0) return protectLiteral(line, lineStart);
        const offset = containerOffset(line, depth, indent);
        return line.slice(0, offset) + protectLiteral(line.slice(offset), lineStart + offset);
      })
      .join("\n");
  }
  function footnote(
    start: number,
    initialEnd: number,
    before: string,
  ): { end: number; text: string } {
    const depth = before.match(/>/g)?.length ?? 0;
    const indent = flowAt(start)?.indent ?? 0;
    let end = initialEnd;
    let scan = end;
    let blank = false;
    const marker = noteMarker.exec(source.slice(start, initialEnd))?.[0] ?? "";
    const bodyLines = [source.slice(start + marker.length + 1, initialEnd).replace(/^[ \t]*/, "")];
    let paragraphOpen: boolean | undefined;
    function finalParagraph(text: string): Extract<Node, { type: "paragraph" }> | undefined {
      if (text.length > maximumLookaheadCharacters - lookahead.characters) {
        lookahead.exhausted = true;
        return;
      }
      lookahead.characters += text.length;
      let node: Node | undefined = fromMarkdown(text, {
        extensions: [gfmTable()],
        mdastExtensions: [gfmTableFromMarkdown()],
      });
      while (
        node &&
        ["root", "blockquote", "list", "listItem"].includes(node.type) &&
        "children" in node
      )
        node = node.children.at(-1);
      return node?.type === "paragraph" ? node : undefined;
    }
    function continuesParagraph(line: string): boolean {
      if (/^[\s|:=\-]+$/u.test(line) && /[=\-]/.test(line)) {
        const body = bodyLines.join("\n");
        const paragraph = finalParagraph(body + "\n" + line);
        return (
          paragraph !== undefined &&
          (paragraph.position?.start.offset ?? Infinity) < body.length + 1
        );
      }
      return finalParagraph("x\n" + line)?.position?.start.offset === 0;
    }
    const lines = [protectLiteral(source.slice(start, initialEnd), start)];
    let pending: string[] = [];
    while (scan < source.length) {
      const lineStart = scan + 1;
      const newline = source.indexOf("\n", lineStart);
      const lineEnd = newline < 0 ? source.length : newline;
      const line = source.slice(lineStart, lineEnd);
      const prefix = quotePrefix(line, depth);
      const quote = prefix?.index ?? 0;
      const body = line.slice(quote);
      if (!body.trim()) {
        if (!prefix) break;
        blank = true;
        pending.push(line);
        scan = lineEnd;
        continue;
      }
      const leading = /^[ \t]*/.exec(body)?.[0] ?? "";
      const consumed = prefix?.columns ?? 0;
      const base = Math.max(0, indent - consumed);
      const indentation = columns(line.slice(0, quote) + leading) - consumed;
      const continuation = prefix !== undefined && indentation >= base + 4;
      const logical =
        " ".repeat(Math.max(0, indentation - base - (continuation ? 4 : 0))) +
        body.slice(leading.length);
      if (!continuation && !blank && paragraphOpen === undefined)
        paragraphOpen = finalParagraph(bodyLines.join("\n")) !== undefined;
      const remainsParagraph = !blank && paragraphOpen === true && continuesParagraph(logical);
      if (!continuation && !remainsParagraph) break;
      bodyLines.push(...pending.map(() => ""), logical);
      paragraphOpen = remainsParagraph ? true : undefined;
      // Keep list indentation outside the literal, and body formatting inside it.
      let keep = 0;
      let keptColumns = columns(line.slice(0, quote)) - consumed;
      while (keep < leading.length && keptColumns < base) {
        keep++;
        keptColumns = columns(line.slice(0, quote + keep)) - consumed;
      }
      lines.push(
        ...pending,
        line.slice(0, quote + keep) + protectLiteral(body.slice(keep), lineStart + quote + keep),
      );
      pending = [];
      blank = false;
      end = lineEnd;
      scan = lineEnd;
    }
    return { end, text: lines.join("\n") };
  }
  const notation =
    /\$\$[\s\S]*?\$\$|\$(?!\s)(?:\\[^\n]|[^\\\n$])*?(?<!\s)\$(?!\d)|\\\((?:(?!\\\()[\s\S])*?\\\)|\\\[(?:(?!\\\[)[\s\S])*?\\\]|~~[^~]+~~/;
  // Skip escaped dollar runs before the full-body alternative can rescan their suffixes.
  const escapedDollar = /(?<escapedDollar>(?<!\\)(?:\\\\)*\\\$)/;
  const pattern = new RegExp(
    `${escapedDollar.source}|${noteLabel}:[^\\n]*|${noteLabel}|${notation.source}`,
    "g",
  );
  let codeIndex = 0;
  let boundaryIndex = 0;
  let inlineIndex = 0;
  const replacements: (Range & { text: string; synthetic?: boolean })[] = [];
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const start = match.index;
    let value = match[0];
    if (match.groups?.["escapedDollar"] !== undefined) continue;
    const rescan =
      start +
      (value.startsWith("\\[") || (value.startsWith("$") && !value.startsWith("$$")) ? 1 : 2);
    if (
      value.startsWith("$") ||
      value.startsWith("~~") ||
      value.startsWith("\\(") ||
      value.startsWith("\\[")
    ) {
      let backslashes = 0;
      for (let index = start - 1; index >= 0 && source[index] === "\\"; index--) backslashes++;
      if (backslashes % 2 === 1) {
        pattern.lastIndex = start + 1;
        continue;
      }
    }
    while ((opaqueRanges[codeIndex]?.end ?? Infinity) <= start) codeIndex++;
    const code = opaqueRanges[codeIndex];
    if (code && start >= code.start) {
      pattern.lastIndex = code.end;
      continue;
    }
    while ((boundaries[boundaryIndex]?.end ?? Infinity) <= start) boundaryIndex++;
    let crossing = false;
    for (let index = boundaryIndex; index < boundaries.length; index++) {
      const boundary = boundaries[index];
      if (!boundary || boundary.start >= pattern.lastIndex) break;
      if (boundary.end <= start) continue;
      const encloses = start <= boundary.start && pattern.lastIndex >= boundary.end;
      const contained = start > boundary.start && pattern.lastIndex < boundary.end;
      if (!encloses && !contained) {
        crossing = true;
        break;
      }
    }
    if (crossing) {
      pattern.lastIndex = rescan;
      continue;
    }
    while ((inlineRanges[inlineIndex]?.end ?? Infinity) <= start) inlineIndex++;
    const inline = inlineRanges[inlineIndex];
    const before = source.slice(lineRange(start).start, start);
    const display = value.startsWith("$$") || value.startsWith("\\[");
    const close = pattern.lastIndex - 2;
    const closingLine = lineRange(close);
    const closingPrefix = source.slice(closingLine.start, close);
    const afterOpen = source.slice(start + 2, lineRange(start).end);
    const afterClose = source.slice(pattern.lastIndex, closingLine.end);
    const displayBlock =
      display &&
      containerPrefix(before) &&
      !afterOpen.trim() &&
      containerPrefix(closingPrefix) &&
      !afterClose.trim();
    const inlineNotation =
      (display && !displayBlock) ||
      value.startsWith("~~") ||
      (value.startsWith("$") && !value.startsWith("$$")) ||
      value.startsWith("\\(");
    const displayInTable =
      inline?.table === true && (value.startsWith("$$") || value.startsWith("\\["));
    if (inlineNotation || displayInTable) {
      if (!inline || start < inline.start || pattern.lastIndex > inline.end) {
        pattern.lastIndex = rescan;
        continue;
      }
    }
    let protectedText: string;
    const marker = noteMarker.exec(value)?.[0];
    if (marker && value[marker.length] === ":" && containerPrefix(before)) {
      const note = footnote(start, pattern.lastIndex, before);
      if (lookahead.exhausted) return plainMessage(source);
      pattern.lastIndex = note.end;
      protectedText = note.text;
    } else {
      if (marker) {
        pattern.lastIndex = start + marker.length;
        value = marker;
      }
      protectedText = literalSpan(value, start);
    }
    replacements.push({ start, end: pattern.lastIndex, text: protectedText });
  }
  for (const separator of blockSeparators) {
    if (
      !replacements.some(
        (replacement) => replacement.start <= separator.start && replacement.end > separator.start,
      )
    )
      replacements.push({ ...separator, synthetic: true });
  }
  const aliases: string[] = [];
  const aliasNames = new Map<string, string>();
  for (const suffix of referenceSuffixes) {
    const affected = replacements.some(
      (replacement) => replacement.start > suffix.referenceStart && replacement.end <= suffix.start,
    );
    const definition = sourceDefinitions.get(suffix.identifier);
    if (
      !affected ||
      !definition ||
      replacements.some(
        (replacement) => replacement.start <= definition.start && replacement.end >= definition.end,
      )
    )
      continue;
    let alias = aliasNames.get(suffix.identifier);
    if (!alias) {
      alias = `${prefix}REFERENCE${String(aliases.length)}END`;
      aliasNames.set(suffix.identifier, alias);
      // Decode once in the final parser, preserving ampersands, escapes and whitespace exactly.
      const destination = definition.url.replace(
        /[&<>\\\s]/gu,
        (character) => `&#${String(character.codePointAt(0))};`,
      );
      aliases.push(`[${alias}]: <${destination}>`);
    }
    replacements.push({
      start: suffix.start,
      end: suffix.end,
      text: `[${alias}]`,
      synthetic: true,
    });
  }
  replacements.sort((a, b) => a.start - b.start || a.end - b.end);
  const aliasPrefix = aliases.length ? aliases.join("\n\n") + "\n\n" : "";
  const aliasIds = new Set([...aliasNames.values()].map((name) => name.toUpperCase()));
  const restorePattern = new RegExp(`%<%${prefix}(\\d+)END%>%`, "g");
  type Segment = Range & { original: Range; copied: boolean };
  const segments: Segment[] = [];
  let generated = aliasPrefix.length;
  const output: string[] = [];
  function append(value: string, start: number, end: number, copied: boolean): void {
    output.push(value);
    if (value.length)
      segments.push({
        start: generated,
        end: generated + value.length,
        original: { start, end },
        copied,
      });
    generated += value.length;
  }
  let cursor = 0;
  for (const replacement of replacements) {
    if (replacement.start < cursor) return plainMessage(source);
    append(source.slice(cursor, replacement.start), cursor, replacement.start, true);
    let original = replacement.start;
    let position = 0;
    for (const match of replacement.text.matchAll(restorePattern)) {
      const range = literalSources[Number(match[1])];
      if (!range) return plainMessage(source);
      const gap = replacement.text.slice(position, match.index);
      if (gap !== source.slice(original, range.start)) return plainMessage(source);
      append(gap, original, range.start, true);
      append(match[0], range.start, range.end, false);
      original = range.end;
      position = match.index + match[0].length;
    }
    const tail = replacement.text.slice(position);
    const synthetic = replacement.synthetic === true;
    if (!synthetic && tail !== source.slice(original, replacement.end)) return plainMessage(source);
    append(tail, original, replacement.end, !synthetic);
    cursor = replacement.end;
  }
  append(source.slice(cursor), cursor, source.length, true);
  function originalOffset(offset: number, end = false): number {
    if (offset <= aliasPrefix.length) return 0;
    let low = 0;
    let high = segments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((segments[middle]?.end ?? Infinity) < offset) low = middle + 1;
      else high = middle;
    }
    const segment = segments[low];
    if (!segment) return source.length;
    if (offset === segment.end) return segment.original.end;
    if (offset <= segment.start) return segment.original.start;
    return segment.copied
      ? segment.original.start + offset - segment.start
      : end
        ? segment.original.end
        : segment.original.start;
  }
  return {
    text: aliasPrefix + output.join(""),
    restore: (value) =>
      value.replace(restorePattern, (_, index: string) => literals[Number(index)] ?? ""),
    original: (start, end) => {
      const first = originalOffset(start);
      const last = originalOffset(end, true);
      let context: { indent: number; quotes: number } = { indent: 0, quotes: 0 };
      for (let index = contexts.length - 1; index >= 0; index--) {
        const candidate = contexts[index];
        if (candidate && candidate.start <= first && candidate.end >= last) {
          context = candidate;
          break;
        }
      }
      return source
        .slice(first, last)
        .split("\n")
        .map((line, index) =>
          index === 0 ? line : line.slice(containerOffset(line, context.quotes, context.indent)),
        )
        .join("\n");
    },
    definition: (identifier, start) =>
      aliasIds.has(identifier.toUpperCase()) ||
      (sourceDefinitions.has(identifier) && originalDefinitionStarts.has(originalOffset(start))),
    table: (start) => originalTables.has(originalOffset(start)),
    origin: (type, start, end) =>
      originalNodes.has(
        `${type}:${String(originalOffset(start))}:${String(originalOffset(end, true))}`,
      ),
  };
}

function parseMessage(text: string) {
  // CommonMark treats LF, CRLF and CR alike; the stored text stays untouched.
  const source = text.replace(/\r\n?/g, "\n");
  let literal = literalNotation(source);
  let tree = fromMarkdown(literal.text, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
  if (!withinMarkdownDepth(tree)) {
    literal = plainMessage(source);
    tree = fromMarkdown(literal.text);
  }
  return { ...literal, tree };
}

function messagePlainText(source: string): string {
  const parsed = parseMessage(source);
  function text(node: Node): string {
    switch (node.type) {
      case "definition":
        return "";
      case "break":
      case "thematicBreak":
        return " ";
    }
    if ("value" in node) return parsed.restore(node.value);
    if ("children" in node) {
      const separate = ["root", "blockquote", "list", "listItem", "table", "tableRow"].includes(
        node.type,
      );
      return node.children.map(text).join(separate ? " " : "");
    }
    return "";
  }
  return text(parsed.tree)
    .replace(/[\s\p{White_Space}]+/gu, " ")
    .trim();
}

export function conversationPreview(prefix: string, truncated: boolean): string {
  const plain = Array.from(messagePlainText(prefix));
  const limit = 120;
  return plain.slice(0, limit).join("") + (plain.length > limit || truncated ? "…" : "");
}

export function sourceQuotation(source: string, limit: number): string {
  const plain = messagePlainText(source);
  const prefix = clippedText(plain, limit);
  return prefix === undefined ? plain : prefix + "…";
}

/** A closed React element mapping. No HTML renderer, sanitizer or remote resource resolver. */
export const MessageMarkdown = memo(function MessageMarkdown({
  text,
  locale,
  language,
  openExternalLink,
}: {
  readonly text: string;
  readonly locale: InterfaceLocale;
  readonly language?: string | undefined;
  readonly openExternalLink: (url: string) => Promise<boolean>;
}) {
  const parsed = useMemo(() => parseMessage(text), [text]);
  const definitions = new Map<string, string>();
  function collectDefinitions(node: Node): void {
    if (
      node.type === "definition" &&
      parsed.definition(node.identifier, node.position?.start.offset ?? 0) &&
      !definitions.has(node.identifier)
    )
      definitions.set(node.identifier, parsed.restore(node.url));
    if ("children" in node) node.children.forEach(collectDefinitions);
  }
  collectDefinitions(parsed.tree);
  const raw = (node: Node) =>
    parsed.original(
      node.position?.start.offset ?? 0,
      node.position?.end.offset ?? parsed.text.length,
    );
  // Block children use fragments, keeping lists and tables valid HTML.
  const blocks = (nodes: readonly Node[], block = false) =>
    nodes.map((node, index) => (
      <MarkdownFragment key={index}>{render(node, block)}</MarkdownFragment>
    ));
  function link(label: ReactNode, url: string): ReactNode {
    if (!isExternalMessageLink(url)) return label;
    let address: string;
    try {
      address = new URL(url).href;
      if (!isExternalMessageLink(address)) return label;
    } catch {
      return label;
    }
    return (
      <Tooltip label={address} className="message-link-tooltip">
        <a
          href={url}
          onClick={(event) => {
            event.preventDefault();
            void openExternalLink(url).catch(() => false);
          }}
          onAuxClick={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            void openExternalLink(url).catch(() => false);
          }}
        >
          {label}
          <span
            className="message-external-icon"
            role="img"
            lang={locale}
            aria-label={message(locale, "conversation.opensInBrowser")}
          >
            <LucideGlyph name="external-link" size={16} />
          </span>
        </a>
      </Tooltip>
    );
  }
  function render(node: Node, block: boolean): ReactNode {
    if (
      [
        "link",
        "linkReference",
        "emphasis",
        "strong",
        "inlineCode",
        "heading",
        "thematicBreak",
        "html",
      ].includes(node.type) &&
      !parsed.origin(
        node.type,
        node.position?.start.offset ?? 0,
        node.position?.end.offset ?? parsed.text.length,
      )
    )
      return block ? (
        <p className="message-literal">{raw(node)}</p>
      ) : (
        <span className="message-literal">{raw(node)}</span>
      );
    switch (node.type) {
      case "text":
        return parsed.restore(node.value);
      case "paragraph":
        return <p>{blocks(node.children)}</p>;
      case "heading":
        return (
          <p className="message-heading">
            <strong>{blocks(node.children)}</strong>
          </p>
        );
      case "emphasis":
        return <em>{blocks(node.children)}</em>;
      case "strong":
        return <strong>{blocks(node.children)}</strong>;
      case "inlineCode":
        return <code>{parsed.restore(node.value)}</code>;
      case "code":
        return (
          <div
            className="message-code-box"
            tabIndex={0}
            role="region"
            lang={locale}
            aria-label={message(locale, "conversation.codeBlock")}
          >
            <pre lang={language ?? ""}>
              <code>{parsed.restore(node.value)}</code>
            </pre>
          </div>
        );
      case "blockquote":
        return <blockquote>{blocks(node.children, true)}</blockquote>;
      case "list":
        return node.ordered ? (
          <ol start={node.start ?? 1}>{blocks(node.children)}</ol>
        ) : (
          <ul>{blocks(node.children)}</ul>
        );
      case "listItem":
        return <li>{blocks(node.children, true)}</li>;
      case "break":
        return <br />;
      case "thematicBreak":
        return <hr />;
      case "link":
        return link(blocks(node.children), parsed.restore(node.url));
      case "linkReference": {
        const url = definitions.get(node.identifier);
        return url === undefined ? raw(node) : link(blocks(node.children), url);
      }
      case "definition":
        return parsed.definition(node.identifier, node.position?.start.offset ?? 0) ? null : (
          <p className="message-literal">{raw(node)}</p>
        );
      case "table":
        if (!parsed.table(node.position?.start.offset ?? 0))
          return <p className="message-literal">{raw(node)}</p>;
        return (
          <div
            className="message-table-box"
            tabIndex={0}
            role="region"
            lang={locale}
            aria-label={message(locale, "conversation.table")}
          >
            <table lang={language ?? ""}>
              <thead>{tableRow(node.children[0], true, node.align)}</thead>
              <tbody>
                {node.children.slice(1).map((row, index) => (
                  <MarkdownFragment key={index}>
                    {tableRow(row, false, node.align)}
                  </MarkdownFragment>
                ))}
              </tbody>
            </table>
          </div>
        );
      // Images, HTML and any future parser node are text, never active elements.
      default:
        return block ? (
          <p className="message-literal">{raw(node)}</p>
        ) : (
          <span className="message-literal">{raw(node)}</span>
        );
    }
  }
  function plainText(node: Node): string {
    if ("value" in node) return parsed.restore(node.value);
    return "children" in node ? node.children.map(plainText).join("") : "";
  }
  function tableRow(
    row: Extract<Block, { type: "table" }>["children"][number] | undefined,
    header: boolean,
    align: readonly ("left" | "right" | "center" | null)[] | null | undefined,
  ) {
    if (!row) return null;
    const Cell = header ? "th" : "td";
    return (
      <tr>
        {row.children.map((cell, index) => (
          <Cell
            key={index}
            scope={header ? "col" : undefined}
            className={
              /\d/.test(plainText(cell)) && /^\s*[+-]?[\d.,%]+\s*$/.test(plainText(cell))
                ? "message-number"
                : `message-align-${align?.[index] ?? "left"}`
            }
          >
            {blocks(cell.children)}
          </Cell>
        ))}
      </tr>
    );
  }
  return (
    <div className="message-markdown" lang={language ?? ""}>
      {blocks(parsed.tree.children, true)}
    </div>
  );
});
