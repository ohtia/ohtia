import {
  isResearchId,
  isUnicodeText,
  utf8Size,
  manuscriptFormat,
  manuscriptLimits,
  type CanonicalManuscript,
  type ManuscriptDiagnostic,
  type ManuscriptLine,
  type ManuscriptParagraph,
  type ManuscriptResult,
  type ManuscriptSection,
} from "@ohtia/contracts";

export interface ManuscriptIdentity {
  readonly draftId: string;
  /** IDs unavailable in this revision context, such as retired IDs or IDs claimed by another draft. */
  readonly unavailableIds?: ReadonlySet<string>;
}

type DiagnosticLocation = ManuscriptDiagnostic["location"];

const documentLocation = { kind: "document" } as const;
const titleLocation = { kind: "title" } as const;
const formatKey = "ohtia_draft_format: ";
const idKey = "ohtia_draft_id: draft_";
const blockClose = ":::";
const blockOpen = /^::: \{#([^ ]*) \.ohtia-block\}$/;
const titleEnd = " {#";
const forbiddenControl = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const textLineControl = /[\u0000-\u001f\u007f]/;
const idSuffix = /^[a-z0-9-]+$/;
const paragraphMarker = /^(?:[>#|:]|[-+*](?= |$)|[0-9]+[.)](?= |$)|=(?==|$)|--|-(?=[:|])|~~|\+-)/;
const inlineSyntax =
  /[\\`[$@]|\{(?=[#.:=])|&(?=#|[A-Za-z][A-Za-z0-9]*;)|<(?=[!?]|[A-Za-z][A-Za-z0-9+.-]*:)|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])|(?<! )\*|\*(?! )/gu;
const inlineToken = new RegExp(String.raw`\\([!-/:-@[-\x60{-~])|${inlineSyntax.source}`, "gu");

const Refusal = class extends Error {
  constructor(readonly diagnostic: ManuscriptDiagnostic) {
    super(diagnostic.code);
  }
};

function refuse(code: ManuscriptDiagnostic["code"], location: DiagnosticLocation): never {
  throw new Refusal({ code, location: { ...location } });
}

function checked<T>(operation: () => T): ManuscriptResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, diagnostic: error.diagnostic };
    throw error;
  }
}

function draftIdentity(
  value: unknown,
  identity: ManuscriptIdentity,
  at: DiagnosticLocation,
): string {
  if (!isResearchId(value)) refuse("invalid-id", at);
  if (value !== identity.draftId) refuse("foreign-draft", at);
  return value;
}

function admitId(
  value: unknown,
  prefix: "sec_" | "blk_",
  identity: ManuscriptIdentity,
  seen: Set<string>,
  at: DiagnosticLocation,
): string {
  if (
    typeof value !== "string" ||
    value.length > manuscriptLimits.documentBytes ||
    !value.startsWith(prefix) ||
    !idSuffix.test(value.slice(prefix.length))
  ) {
    refuse("invalid-id", at);
  }
  if (seen.has(value)) refuse("duplicate-id", at);
  if (identity.unavailableIds?.has(value)) refuse("unavailable-id", at);
  seen.add(value);
  return value;
}

function textBytes(value: string, at: DiagnosticLocation): number {
  if (value.length > manuscriptLimits.textBytes) refuse("text-limit", at);
  const length = utf8Size(value);
  if (length > manuscriptLimits.textBytes) refuse("text-limit", at);
  return length;
}

function edgeSpaces(value: string): boolean {
  return value.startsWith(" ") || value.endsWith(" ");
}

function hasUnescapedClosingHash(value: string): boolean {
  if (!value.endsWith("#")) return false;
  let offset = value.length - 2;
  while (value[offset] === "\\") offset--;
  return (value.length - 2 - offset) % 2 === 0;
}

function decodeText(raw: string, at: DiagnosticLocation, title = false): string {
  if (!raw || edgeSpaces(raw)) refuse("unsupported-construct", at);
  if (title ? hasUnescapedClosingHash(raw) : paragraphMarker.test(raw)) {
    refuse("unsupported-construct", at);
  }
  return raw.replace(inlineToken, (_token: string, literal: string | undefined) => {
    if (literal === undefined) refuse("unsupported-construct", at);
    return literal;
  });
}

function encodeText(value: unknown, at: DiagnosticLocation): string {
  if (typeof value !== "string" || !value) refuse("invalid-ast", at);
  if (!isUnicodeText(value) || textLineControl.test(value)) refuse("invalid-text", at);
  textBytes(value, at);
  if (edgeSpaces(value)) refuse("unsupported-construct", at);
  const encoded = value.replace(inlineSyntax, "\\$&");
  if (at.kind === "title" || at.kind === "section") {
    let end = encoded.length;
    while (encoded[end - 1] === "#") end--;
    return encoded.slice(0, end) + "\\#".repeat(encoded.length - end);
  }
  return encoded.replace(
    paragraphMarker,
    (marker) => `${marker.slice(0, -1)}\\${marker.slice(-1)}`,
  );
}

function sourceText(source: string): string {
  if (source.length > manuscriptLimits.documentBytes) refuse("document-limit", documentLocation);
  if (!isUnicodeText(source)) refuse("invalid-text", documentLocation);
  if (utf8Size(source) > manuscriptLimits.documentBytes) refuse("document-limit", documentLocation);
  return source;
}

class Lines {
  private offset = 0;
  number = 1;

  constructor(private readonly source: string) {}

  // Every line has an LF, including the final one.
  *read(): Generator<string, void> {
    while (this.offset < this.source.length) {
      const end = this.source.indexOf("\n", this.offset);
      const line = this.source.slice(this.offset, end);
      this.offset = end + 1;
      yield line;
      this.number++;
    }
  }
}

function readDocument(source: string, identity: ManuscriptIdentity): CanonicalManuscript {
  if (forbiddenControl.test(source) || (source.length > 0 && !source.endsWith("\n"))) {
    refuse("invalid-text", documentLocation);
  }
  const lines = new Lines(source);
  const reader = lines.read();
  const at = () => ({ kind: "line", number: lines.number }) as const;
  if (reader.next().value !== "---") refuse("invalid-header", at());
  const version = reader.next().value;
  if (version === undefined || !/^ohtia_draft_format: [a-z0-9-]+$/.test(version)) {
    refuse("invalid-header", at());
  }
  if (version !== formatKey + manuscriptFormat) refuse("invalid-version", at());
  const headerId = reader.next().value;
  if (headerId === undefined || !headerId.startsWith(idKey)) refuse("invalid-header", at());
  const draftId = draftIdentity(headerId.slice(idKey.length), identity, at());
  if (reader.next().value !== "---") refuse("invalid-header", at());

  const seen = new Set<string>();
  let title: CanonicalManuscript["title"] = null;
  const paragraphs: ManuscriptParagraph[] = [];
  const sections: ManuscriptSection[] = [];
  let current = reader.next().value;
  while (current !== undefined) {
    if (current === "---") refuse("invalid-header", at());
    if (current !== "") refuse("unsupported-construct", at());
    current = reader.next().value;
    if (current === undefined) refuse("unsupported-construct", at());
    if (current === "---") refuse("invalid-header", at());
    const heading = /^(#{1,6}) /.exec(current);
    if (heading) {
      const level = heading[0].length - 1;
      if (level === 1 && (title || paragraphs.length > 0 || sections.length > 0))
        refuse("unsupported-construct", at());
      if (level > (sections.at(-1)?.level ?? 1) + 1) refuse("unsupported-construct", at());
      if (level !== 1 && sections.length >= manuscriptLimits.sectionCount)
        refuse("section-limit", at());
      const end = current.lastIndexOf(titleEnd);
      if (end < 2 || !current.endsWith("}")) refuse("unsupported-construct", at());
      const id = admitId(current.slice(end + titleEnd.length, -1), "sec_", identity, seen, at());
      const raw = current.slice(heading[0].length, end);
      textBytes(raw, at());
      const text = decodeText(raw, at(), true);
      if (level === 1) title = { id, text };
      else
        sections.push({
          id,
          text,
          level: level as ManuscriptSection["level"],
          beforeParagraph: paragraphs.length,
        });
    } else {
      const block = blockOpen.exec(current);
      if (block === null) refuse("unsupported-construct", at());
      if (paragraphs.length === manuscriptLimits.paragraphCount) refuse("paragraph-limit", at());
      const id = admitId(block[1], "blk_", identity, seen, at());
      const body: ManuscriptLine[] = [];
      let size = 0;
      current = reader.next().value;
      while (current !== undefined && current !== blockClose) {
        const location = at();
        size += textBytes(current, location) + (body.length === 0 ? 0 : 1);
        if (size > manuscriptLimits.textBytes) refuse("text-limit", location);
        const explicit = current.endsWith("  ");
        const raw = explicit ? current.slice(0, -2) : current;
        const text = decodeText(raw, location);
        current = reader.next().value;
        if (explicit && current === blockClose) refuse("unsupported-construct", location);
        body.push({
          text,
          breakAfter: explicit ? "hard" : current === blockClose ? null : "soft",
        });
      }
      if (current !== blockClose || body.length === 0) refuse("unsupported-construct", at());
      paragraphs.push({ id, lines: body });
    }
    current = reader.next().value;
  }
  return {
    format: manuscriptFormat,
    draftId,
    title,
    paragraphs,
    ...(sections.length > 0 && { sections }),
  };
}

/** Parse the exact retained text while preserving the caller's input on refusal. */
export function parseManuscript(
  source: string,
  identity: ManuscriptIdentity,
): ManuscriptResult<CanonicalManuscript> {
  return checked(() => readDocument(sourceText(source), identity));
}

function hasShape(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor;
    })
  );
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function element(items: readonly unknown[], index: number): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(items, String(index));
  return descriptor && "value" in descriptor ? (descriptor.value as unknown) : undefined;
}

function writeParagraph(lines: readonly unknown[], at: DiagnosticLocation): string {
  // A nonempty line takes at least one byte, with one more byte between lines.
  if (lines.length > (manuscriptLimits.textBytes + 1) / 2) refuse("text-limit", at);
  const body: string[] = [];
  let size = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = element(lines, index);
    if (!hasShape(line, ["text", "breakAfter"])) refuse("invalid-ast", at);
    const last = index === lines.length - 1;
    if (
      last ? line.breakAfter !== null : line.breakAfter !== "soft" && line.breakAfter !== "hard"
    ) {
      refuse("invalid-ast", at);
    }
    const encoded = encodeText(line.text, at) + (line.breakAfter === "hard" ? "  " : "");
    size += textBytes(encoded, at) + (last ? 0 : 1);
    if (size > manuscriptLimits.textBytes) refuse("text-limit", at);
    body.push(encoded);
  }
  return body.join("\n");
}

function writeDocument(input: unknown, identity: ManuscriptIdentity): string {
  if (
    !hasShape(input, ["format", "draftId", "title", "paragraphs"]) &&
    !hasShape(input, ["format", "draftId", "title", "paragraphs", "sections"])
  ) {
    refuse("invalid-ast", documentLocation);
  }
  if (input.format !== manuscriptFormat) refuse("invalid-version", documentLocation);
  const draftId = draftIdentity(input.draftId, identity, documentLocation);
  const { title, paragraphs, sections = [] } = input;
  if (!isList(paragraphs) || !isList(sections)) refuse("invalid-ast", documentLocation);
  if (sections.length > manuscriptLimits.sectionCount) refuse("section-limit", documentLocation);
  if (paragraphs.length > manuscriptLimits.paragraphCount + 1)
    refuse("paragraph-limit", documentLocation);

  const header = `---\n${formatKey}${manuscriptFormat}\n${idKey}${draftId}\n---\n`;
  const parts = [header];
  const seen = new Set<string>();
  let size = utf8Size(header);
  function append(part: string, at: DiagnosticLocation) {
    size += utf8Size(part);
    if (size > manuscriptLimits.documentBytes) refuse("document-limit", at);
    parts.push(part);
  }
  if (title !== null) {
    if (!hasShape(title, ["id", "text"])) refuse("invalid-ast", titleLocation);
    const id = admitId(title.id, "sec_", identity, seen, titleLocation);
    const encoded = encodeText(title.text, titleLocation);
    textBytes(encoded, titleLocation);
    append(`\n# ${encoded} {#${id}}\n`, titleLocation);
  }
  let paragraphCount = 0;
  let sectionIndex = 0;
  let priorLevel = 1;
  for (let index = 0; index <= paragraphs.length; index++) {
    while (sectionIndex < sections.length) {
      const at = { kind: "section", number: sectionIndex + 1 } as const;
      const section = element(sections, sectionIndex);
      if (
        !hasShape(section, ["id", "text", "level", "beforeParagraph"]) ||
        typeof section.beforeParagraph !== "number" ||
        !Number.isInteger(section.beforeParagraph) ||
        section.beforeParagraph < index ||
        section.beforeParagraph > paragraphs.length ||
        typeof section.level !== "number" ||
        !Number.isInteger(section.level) ||
        section.level < 2 ||
        section.level > 6 ||
        section.level > priorLevel + 1
      )
        refuse("invalid-ast", at);
      if (section.beforeParagraph > index) break;
      const id = admitId(section.id, "sec_", identity, seen, at);
      const encoded = encodeText(section.text, at);
      textBytes(encoded, at);
      append(
        `
${"#".repeat(section.level)} ${encoded} {#${id}}
`,
        at,
      );
      priorLevel = section.level;
      sectionIndex++;
    }
    if (index === paragraphs.length) break;
    const at = { kind: "paragraph", number: index + 1 } as const;
    const paragraph = element(paragraphs, index);
    if (!hasShape(paragraph, ["id", "lines"]) || !isList(paragraph.lines)) {
      refuse("invalid-ast", at);
    }
    const id = admitId(paragraph.id, "blk_", identity, seen, at);
    if (paragraph.lines.length === 0) continue;
    paragraphCount++;
    if (paragraphCount > manuscriptLimits.paragraphCount) refuse("paragraph-limit", at);
    const body = writeParagraph(paragraph.lines, at);
    append(`\n::: {#${id} .ohtia-block}\n${body}\n${blockClose}\n`, at);
  }
  return parts.join("");
}

/** Validate a working AST and serialize it without changing its text or allocating identities. */
export function serializeManuscript(
  input: unknown,
  identity: ManuscriptIdentity,
): ManuscriptResult<string> {
  return checked(() => writeDocument(input, identity));
}
