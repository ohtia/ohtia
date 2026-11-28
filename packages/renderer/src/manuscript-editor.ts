import {
  manuscriptFormat,
  manuscriptLimits,
  type CanonicalManuscript,
  type ManuscriptDiagnostic,
  type ManuscriptLine,
  type ManuscriptResult,
  type ManuscriptSection,
} from "@ohtia/contracts";
import { serializeManuscript } from "@ohtia/domain";
import { baseKeymap, splitBlock } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keydownHandler, keymap } from "prosemirror-keymap";
import { Fragment, Schema, Slice, type Node as EditorNode } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, TextSelection, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

const schema = new Schema({
  nodes: {
    doc: { content: "document_block+" },
    paragraph: {
      group: "document_block",
      content: "inline*",
      attrs: { id: { default: null } },
      parseDOM: [{ tag: "p" }],
      toDOM: (node) => [
        "p",
        { "data-manuscript-block": node.attrs.id as string | null, "data-type": "type.doc.body" },
        0,
      ],
    },
    heading: {
      group: "document_block",
      content: "text*",
      defining: true,
      attrs: { id: { default: null }, level: { default: 2 } },
      // Clipboard content gets fresh identities; the title rule below demotes a pasted title.
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${String(level)}`, attrs: { level } })),
      toDOM: (node) => {
        const level = Number(node.attrs.level);
        return [
          `h${String(level)}`,
          {
            "data-manuscript-block": node.attrs.id as string | null,
            "data-type": manuscriptHeadingType(level),
          },
          0,
        ];
      },
    },
    text: { group: "inline" },
    line_break: {
      inline: true,
      group: "inline",
      selectable: false,
      attrs: { kind: { default: "hard" } },
      parseDOM: [{ tag: "br" }],
      toDOM: (node) => ["br", { "data-manuscript-break": node.attrs.kind as string }],
    },
  },
});

export function manuscriptHeadingType(level: number) {
  return level === 1 ? "type.doc.title" : `type.doc.h${String(Math.min(level, 5))}`;
}

type ManuscriptBlock =
  | NonNullable<CanonicalManuscript["title"]>
  | CanonicalManuscript["paragraphs"][number]
  | ManuscriptSection;

/** Traverse canonical order without exposing the editor library's document model. */
export function manuscriptBlocks(document: CanonicalManuscript): ManuscriptBlock[] {
  const blocks: ManuscriptBlock[] = document.title ? [document.title] : [];
  const sections = document.sections ?? [];
  let section = 0;
  for (let index = 0; index <= document.paragraphs.length; index++) {
    let heading = sections[section];
    while (heading?.beforeParagraph === index) {
      blocks.push(heading);
      section++;
      heading = sections[section];
    }
    const paragraph = document.paragraphs[index];
    if (paragraph) blocks.push(paragraph);
  }
  return blocks;
}

function identity(node: EditorNode): string {
  return (node.type.name === "heading" ? "sec_" : "blk_") + crypto.randomUUID();
}

function stateFrom(document: CanonicalManuscript, plugins: Plugin[]) {
  const nodes = manuscriptBlocks(document).map((block) => {
    if ("text" in block) {
      return schema.node(
        "heading",
        { id: block.id, level: "level" in block ? block.level : 1 },
        schema.text(block.text),
      );
    }
    const lines = block.lines.flatMap((line) => [
      schema.text(line.text),
      ...(line.breakAfter ? [schema.node("line_break", { kind: line.breakAfter })] : []),
    ]);
    return schema.node("paragraph", { id: block.id }, lines);
  });
  // The trailing writing line has its own identity so identity repair never changes a clean document.
  nodes.push(schema.node("paragraph", { id: `blk_${crypto.randomUUID()}` }));
  return EditorState.create({ doc: schema.node("doc", null, nodes), plugins });
}

function readEditor(doc: EditorNode, draftId: string): CanonicalManuscript {
  let title: CanonicalManuscript["title"] = null;
  const paragraphs: CanonicalManuscript["paragraphs"][number][] = [];
  const sections: ManuscriptSection[] = [];
  doc.forEach((node) => {
    const id = String(node.attrs.id);
    if (node.type.name === "heading") {
      const { textContent: text } = node;
      // An emptied heading carries no researcher text; omitting it keeps the document valid.
      if (!text) return;
      if (node.attrs.level === 1) title = { id, text };
      else
        sections.push({
          id,
          text,
          level: node.attrs.level as ManuscriptSection["level"],
          beforeParagraph: paragraphs.length,
        });
    } else if (node.content.size > 0) {
      const lines: ManuscriptLine[] = [];
      let text = "";
      node.forEach((child) => {
        if (child.isText) text += child.text ?? "";
        else {
          lines.push({ text, breakAfter: child.attrs.kind as "soft" | "hard" });
          text = "";
        }
      });
      lines.push({ text, breakAfter: null });
      paragraphs.push({ id, lines });
    }
  });
  return {
    format: manuscriptFormat,
    draftId,
    title,
    paragraphs,
    ...(sections.length && { sections }),
  };
}

const enterHeading: Command = (state, dispatch, view) => {
  if (view?.composing || !state.selection.empty) return false;
  const { $from } = state.selection;
  if ($from.parent.type.name !== "paragraph" || $from.parentOffset !== $from.parent.content.size)
    return false;
  const marker = /^(#{1,6})[ ]+([^ ].*[^ ]|[^ ])$/.exec($from.parent.textContent);
  const hashes = marker?.[1];
  const text = marker?.[2];
  if (!hashes || !text) return false;
  const level = hashes.length;
  if (level === 1 && $from.before() !== 0) return false;
  if (level > 2) {
    let previousLevel = 1;
    state.doc.forEach((node, position) => {
      if (
        position < $from.before() &&
        node.type.name === "heading" &&
        typeof node.attrs.level === "number"
      )
        previousLevel = node.attrs.level;
    });
    if (level > previousLevel + 1) return false;
  }
  const heading = schema.node("heading", { level }, schema.text(text));
  const paragraph = schema.node("paragraph");
  const start = $from.before();
  const change = state.tr.replaceWith(start, $from.after(), [heading, paragraph]);
  dispatch?.(
    change
      .setSelection(TextSelection.create(change.doc, start + heading.nodeSize + 1))
      .scrollIntoView(),
  );
  return true;
};

/** The title stays the first block, so Enter at its start only removes a selection. */
const startTitle: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (
    $from.parent.type.name !== "heading" ||
    $from.parent.attrs.level !== 1 ||
    $from.parentOffset !== 0 ||
    $from.parent.content.size === 0
  )
    return false;
  if (!state.selection.empty) dispatch?.(state.tr.deleteSelection().scrollIntoView());
  return true;
};

const endHeading: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (
    !state.selection.empty ||
    $from.parent.type.name !== "heading" ||
    $from.parentOffset !== $from.parent.content.size
  )
    return false;
  const position = $from.after();
  const change = state.tr.insert(position, schema.node("paragraph"));
  dispatch?.(change.setSelection(TextSelection.create(change.doc, position + 1)).scrollIntoView());
  return true;
};

/** Preserve block identity and replace separator spaces on an interior split. */
const splitParagraph: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if (
    $from.parent.type.name !== "paragraph" ||
    !$from.sameParent($to) ||
    $to.parentOffset === $to.parent.content.size
  )
    return false;

  if ($from.parentOffset === 0) {
    // The existing text stays in its block when Enter inserts an empty paragraph above it.
    const position = $from.before();
    const paragraph = schema.node("paragraph");
    const change = state.tr.deleteSelection().insert(position, paragraph);
    dispatch?.(
      change
        .setSelection(TextSelection.create(change.doc, position + paragraph.nodeSize + 1))
        .scrollIntoView(),
    );
    return true;
  }

  return splitBlock(
    state,
    dispatch &&
      ((change) => {
        const { $from: right } = change.selection;
        if (change.doc.childCount === state.doc.childCount + 1) {
          const left = change.doc.maybeChild(right.index(0) - 1);
          const trailing = / +$/.exec(left?.lastChild?.text ?? "")?.[0].length ?? 0;
          const leading = /^ +/.exec(right.parent.firstChild?.text ?? "")?.[0].length ?? 0;
          if (leading) change.delete(right.pos, right.pos + leading);
          const leftEnd = right.pos - 2;
          if (trailing) change.delete(leftEnd - trailing, leftEnd);
        }
        dispatch(change);
      }),
  );
};

/** Keep one leading title and unique, unretired unit identities. */
function repairIdentities(state: EditorState, unavailable: ReadonlySet<string>) {
  const seen = new Set<string>();
  const transaction = state.tr;
  let preceded = false;
  state.doc.forEach((node, position) => {
    const heading = node.type.name === "heading";
    // Only a title with no text or heading before it stays the title; a split or pasted later one keeps its text as a paragraph.
    if (heading && node.attrs.level === 1 && preceded) {
      transaction.setNodeMarkup(position, schema.nodes.paragraph, {
        id: `blk_${crypto.randomUUID()}`,
      });
      return;
    }
    if (heading || node.content.size > 0) preceded = true;
    const id: unknown = node.attrs.id;
    const prefix = heading ? "sec_" : "blk_";
    // Undo can restore a unit removed by an earlier save; the store refuses retired identities.
    if (typeof id === "string" && id.startsWith(prefix) && !seen.has(id) && !unavailable.has(id))
      seen.add(id);
    else transaction.setNodeMarkup(position, undefined, { ...node.attrs, id: identity(node) });
  });
  return transaction.docChanged ? transaction : null;
}

const historyBindings = { "Mod-z": undo, "Shift-Mod-z": redo, "Mod-y": redo };
const handleHistoryKey = keydownHandler(historyBindings);

function editorPlugins(retired: () => ReadonlySet<string>) {
  return [
    history(),
    keymap(historyBindings),
    keymap({
      Enter: (state, dispatch, view) =>
        enterHeading(state, dispatch, view) ||
        startTitle(state, dispatch) ||
        endHeading(state, dispatch) ||
        splitParagraph(state, dispatch),
    }),
    keymap(baseKeymap),
    new Plugin({
      appendTransaction(transactions, _old, state) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        return repairIdentities(state, retired());
      },
    }),
  ];
}

export interface ManuscriptClipboardRefusal {
  readonly diagnostic: ManuscriptDiagnostic;
  /** Original text representations for recovery. Other formats stay on the system clipboard. */
  readonly text: string;
  readonly html: string;
}

interface ManuscriptEditorOptions {
  readonly language: string | null;
  readonly onPasteRefused?: (refusal: ManuscriptClipboardRefusal) => void;
}

type ClipboardText = Omit<ManuscriptClipboardRefusal, "diagnostic">;
const clipboardMeta = new PluginKey("manuscriptClipboard");

function clipboardBlock(element: Element): EditorNode | null {
  const tag = element.localName;
  const level = /^h[1-6]$/.test(tag) ? Number(tag[1]) : null;
  if (tag !== "p" && level === null) return null;

  const content: EditorNode[] = [];
  for (const child of element.childNodes) {
    if (child instanceof Text) {
      if (child.data) content.push(schema.text(child.data));
    } else if (level === null && child instanceof HTMLBRElement) {
      const kind = child.getAttribute("data-manuscript-break") === "soft" ? "soft" : "hard";
      content.push(schema.node("line_break", { kind }));
    } else {
      return null;
    }
  }
  return level === null
    ? schema.node("paragraph", null, content)
    : schema.node("heading", { level }, content);
}

interface ParsedClipboard {
  readonly slice: Slice;
  readonly table?: true;
  readonly inlineText?: string;
}

function tableLinesSlice(lines: readonly string[]): ParsedClipboard {
  const content = lines.flatMap((line, index) => [
    ...(index ? [schema.node("line_break", { kind: "hard" })] : []),
    schema.text(line),
  ]);
  // Use a complete paragraph to keep the table separate from its surrounding text.
  return {
    slice: new Slice(Fragment.from(schema.node("paragraph", null, content)), 0, 0),
    table: true,
  };
}

function plainClipboardSlice(text: string): ParsedClipboard | null {
  if (!text) return null;
  const lines = text.split(/\r\n?|\n/, manuscriptLimits.paragraphCount + 2);
  if (lines.length > manuscriptLimits.paragraphCount + 1) return null;
  const rows = lines.at(-1) === "" ? lines.slice(0, -1) : lines;
  // Recognise the line layout only; the pasted Markdown remains literal researcher text.
  if (
    /^\|(?: *:?-{3,}:? *\|)+$/.test(rows[1] ?? "") &&
    rows.every((row) => row.startsWith("|") && row.endsWith("|"))
  )
    return tableLinesSlice(rows);
  if (lines.length === 1)
    return { slice: new Slice(Fragment.from(schema.text(text)), 0, 0), inlineText: text };
  return {
    slice: Slice.maxOpen(
      Fragment.fromArray(
        lines.map((line) => schema.node("paragraph", null, line ? schema.text(line) : undefined)),
      ),
    ),
  };
}

function presentationText(node: ChildNode): boolean {
  return (
    node instanceof Text ||
    (node instanceof HTMLSpanElement &&
      !node.childElementCount &&
      Array.from(node.attributes).every((attribute) => ["class", "style"].includes(attribute.name)))
  );
}

const typographyStyles = new Set([
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
]);

function collapsesWhitespace(node: ChildNode): boolean {
  return (
    !(node instanceof HTMLElement) ||
    (Array.from(node.attributes).every(({ name }) => ["style", "lang", "dir"].includes(name)) &&
      Array.from(node.style).every((style) => typographyStyles.has(style)))
  );
}

function literalClipboardText(node: ChildNode | undefined, text: string): boolean {
  if (!text) return false;
  const normalized = text.replace(/\r\n?/g, "\n");
  if (node instanceof HTMLDivElement) {
    // Syntax-highlighted code can arrive as a div per line and presentation spans per token.
    const rows = clipboardChildren(node);
    return (
      rows.every(
        (row) =>
          row instanceof HTMLDivElement && Array.from(row.childNodes).every(presentationText),
      ) && rows.map((row) => row.textContent).join("\n") === normalized
    );
  }
  if (!node) return false;
  const source = node.textContent ?? "";
  if (
    presentationText(node) ||
    (node instanceof HTMLParagraphElement && Array.from(node.childNodes).every(presentationText))
  ) {
    // HTML source line wrapping is presentation whitespace when the plain version agrees.
    return (
      source === normalized ||
      ([node, ...Array.from(node.childNodes)].every(collapsesWhitespace) &&
        source.replace(/[ \t\r\n\f]+/g, " ").replace(/^ | $/g, "") === normalized)
    );
  }
  if (!(node instanceof HTMLElement) || source !== normalized) return false;
  // Source-code copies can add presentation spans around the same literal text.
  return (
    (node.localName === "pre" || node.localName === "code") &&
    Array.from(node.querySelectorAll("*")).every((child) =>
      ["code", "span"].includes(child.localName),
    )
  );
}

function clipboardChildren(node: ParentNode): ChildNode[] {
  return Array.from(node.childNodes).filter(
    (child) =>
      !(child instanceof Comment) &&
      !(child instanceof Text && !child.data.trim()) &&
      !(child instanceof HTMLMetaElement && child.hasAttribute("charset")),
  );
}

function tableClipboardSlice(root: ChildNode | undefined): ParsedClipboard | null {
  // Browser selections can include a presentation wrapper around the complete table.
  while (root instanceof HTMLElement && ["div", "span"].includes(root.localName)) {
    const children = clipboardChildren(root);
    if (children.length !== 1) return null;
    root = children[0];
  }
  if (!(root instanceof HTMLTableElement) || root.caption || root.tFoot) return null;
  if (root.rows.length < 2 || root.rows.length > manuscriptLimits.paragraphCount) return null;

  const width = root.rows[0]?.cells.length ?? 0;
  if (!width) return null;
  const lines: string[] = [];
  for (const [index, row] of Array.from(root.rows).entries()) {
    if (row.cells.length !== width) return null;
    const cells: string[] = [];
    for (const cell of row.cells) {
      if (
        cell.localName !== (index === 0 ? "th" : "td") ||
        cell.rowSpan !== 1 ||
        cell.colSpan !== 1 ||
        Array.from(cell.querySelectorAll("*")).some(
          (element) => element.localName !== "span" && element.localName !== "code",
        )
      )
        return null;
      // In normal HTML flow, cell indentation and line wrapping are presentation whitespace.
      const text = cell.textContent.replace(/[ \t\r\n\f]+/g, " ").trim();
      cells.push(text.replace(/[\\|]/g, "\\$&"));
    }
    lines.push(`| ${cells.join(" | ")} |`);
    if (index === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
  }

  return tableLinesSlice(lines);
}

function clipboardSlice(document: Document, { text, html }: ClipboardText): ParsedClipboard | null {
  if (!html) return plainClipboardSlice(text);

  // Template content is inert. Read only the supported structure and never import its attributes
  // as editor identity or mount any source elements in the live document.
  const template = document.createElement("template");
  template.innerHTML = html;
  const children = clipboardChildren(template.content);
  if (children.length === 1) {
    const first = children[0];
    if (literalClipboardText(first, text)) return plainClipboardSlice(text);
    const table = tableClipboardSlice(first);
    if (table) return table;
  }

  const blocks: EditorNode[] = [];
  let openness: RegExpExecArray | null = null;
  for (const child of children) {
    if (
      !(child instanceof HTMLElement) ||
      blocks.length > manuscriptLimits.paragraphCount + manuscriptLimits.sectionCount
    )
      return null;
    const block = clipboardBlock(child);
    if (!block) return null;
    if (!blocks.length) {
      // Our schema only needs one level of openness. Never accept source context or attributes.
      openness = /^([01]) ([01]) \[\]$/.exec(child.getAttribute("data-pm-slice") ?? "");
    }
    blocks.push(block);
  }
  if (!blocks.length) return null;
  const content = Fragment.fromArray(blocks);
  if (openness) return { slice: new Slice(content, Number(openness[1]), Number(openness[2])) };
  return {
    slice: blocks.some((block) => block.type.name === "heading")
      ? new Slice(content, 0, 0)
      : Slice.maxOpen(content),
  };
}

function paste(
  view: EditorView,
  event: ClipboardEvent,
  plain: boolean,
  composing: boolean,
  refuse: (clipboard: ClipboardText, code: ManuscriptDiagnostic["code"]) => void,
) {
  if (!view.editable) return false;
  const transfer = event.clipboardData;
  const text = transfer?.getData("text/plain") ?? "";
  const html = transfer?.getData("text/html") ?? "";
  const clipboard = { text, html };
  const source = plain && text ? { text, html: "" } : clipboard;
  event.preventDefault();
  // HTML tags and entities can expand valid text considerably. Cap parsing work before reading DOM.
  if (
    text.length > manuscriptLimits.documentBytes ||
    source.html.length > manuscriptLimits.documentBytes * 8
  ) {
    refuse(clipboard, "document-limit");
    return true;
  }
  const parsed =
    composing || transfer?.files.length ? null : clipboardSlice(view.dom.ownerDocument, source);
  if (!parsed) {
    refuse(clipboard, "unsupported-construct");
    return true;
  }
  const { slice, table, inlineText } = parsed;
  const { $from, $to, empty } = view.state.selection;
  // An open paragraph is fitted into the surrounding text. A title cannot accept a line break.
  if (
    $from.parent.type.name === "heading" &&
    slice.openStart > 0 &&
    slice.content.firstChild?.content.size !== slice.content.firstChild?.textContent.length
  ) {
    refuse(clipboard, "unsupported-construct");
    return true;
  }
  const change = view.state.tr;
  if (table && empty && $from.parent.content.size) {
    const position = $from.after();
    change.insert(position, slice.content);
    change.setSelection(TextSelection.near(change.doc.resolve(position + slice.content.size), -1));
  } else {
    // The canonical profile cannot store ASCII spaces at a block edge. When replacing all
    // of a block with one text fragment, keep the text and leave any edge spaces on the clipboard.
    const trimmed = inlineText?.replace(/^ +| +$/g, "");
    if (
      trimmed &&
      trimmed !== inlineText &&
      $from.sameParent($to) &&
      $from.parentOffset === 0 &&
      $to.parentOffset === $from.parent.content.size
    )
      change.insertText(trimmed);
    else change.replaceSelection(slice);
  }
  view.dispatch(
    change
      .setMeta(clipboardMeta, clipboard)
      .setMeta("paste", true)
      .setMeta("uiEvent", "paste")
      .scrollIntoView(),
  );
  return true;
}

const invalidTextReservation = Fragment.from(schema.text("x".repeat(manuscriptLimits.textBytes)));

function reserveInvalidText(node: EditorNode, draftId: string): EditorNode {
  if (!node.content.size) return node;
  // Validate heading text independently of its surrounding hierarchy.
  const unit =
    node.type.name === "heading"
      ? schema.node("heading", { ...node.attrs, level: 1 }, node.content)
      : node;
  const document = readEditor(schema.node("doc", null, [unit]), draftId);
  if (serializeManuscript(document, { draftId }).ok) return node;

  // The size of a repaired value is unknown. Reserve the full canonical text allowance,
  // including any escaping and break overhead that the original text might eventually require.
  return node.copy(invalidTextReservation);
}

/** Check a paste in a working document with an earlier canonical refusal. */
function pendingPasteDiagnostic(previous: EditorNode, next: EditorNode, draftId: string) {
  const encoder = new TextEncoder();
  const bytes = (doc: EditorNode) => encoder.encode(doc.textContent).byteLength;
  if (bytes(next) > Math.max(bytes(previous), manuscriptLimits.documentBytes)) {
    return { code: "document-limit", location: { kind: "document" } } as const;
  }

  // Structural sharing identifies untouched blocks. Keep valid units in full so their canonical
  // bytes count toward the limit. An unchanged invalid edit must not mask a new error.
  const untouched = new Set<EditorNode>();
  previous.forEach((node) => untouched.add(node));
  const blocks: EditorNode[] = [];
  next.forEach((node) => {
    blocks.push(untouched.has(node) ? reserveInvalidText(node, draftId) : node);
  });
  const projection = readEditor(next.copy(Fragment.fromArray(blocks)), draftId);
  const result = serializeManuscript(projection, { draftId });
  return result.ok ? undefined : result.diagnostic;
}

export interface ManuscriptEditor {
  /** Read the current working AST, including input that the canonical codec refused. */
  read(): CanonicalManuscript;
  /** Report whether the native editor is currently composing text. */
  isComposing(): boolean;
  /** Replace the editor content unless it already holds the same canonical text. */
  replace(document: CanonicalManuscript): void;
  /** Reissue identities that a newly acknowledged base has retired. */
  refreshIdentities(): void;
  /** Lock or unlock typing; the content, selection and undo history stay as they are. */
  setEditable(editable: boolean): void;
  focus(): void;
  jump(id: string): void;
  destroy(): void;
}

function headingAtCursor(state: EditorState): string | undefined {
  const index = Math.min(state.selection.$head.index(0), state.doc.childCount - 1);
  for (let position = index; position >= 0; position--) {
    const node = state.doc.child(position);
    const level: unknown = node.attrs.level;
    const id: unknown = node.attrs.id;
    if (
      node.type.name === "heading" &&
      typeof level === "number" &&
      level > 1 &&
      typeof id === "string"
    )
      return id;
  }
  return undefined;
}

export function mountManuscriptEditor(
  container: HTMLElement,
  document: CanonicalManuscript,
  label: string,
  onChange: (document: CanonicalManuscript, result: ManuscriptResult<string>) => void,
  onHeading: (heading: string | undefined) => void,
  retired: () => ReadonlySet<string> = () => new Set(),
  options: ManuscriptEditorOptions = { language: null },
): ManuscriptEditor {
  const plugins = editorPlugins(retired);
  const { draftId } = document;
  const refuse = (clipboard: ClipboardText, code: ManuscriptDiagnostic["code"]) =>
    options.onPasteRefused?.({
      ...clipboard,
      diagnostic: { code, location: { kind: "document" } },
    });
  let pastePlain = false;
  let compositionBlurred = false;
  const composing = (view: EditorView) => !compositionBlurred && view.composing;
  const view = new EditorView(container, {
    state: stateFrom(document, plugins),
    clipboardTextSerializer: (slice) =>
      slice.content.textBetween(0, slice.content.size, "\n\n", "\n"),
    attributes: {
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": label,
      lang: options.language ?? "",
    },
    handleDOMEvents: {
      keydown: (view, event) => {
        pastePlain =
          event.key.toLowerCase() === "v" && event.shiftKey && (event.ctrlKey || event.metaKey);
        // Chromium can deliver the commit key after compositionend with key code 229.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        if (composing(view) || event.isComposing || event.keyCode === 229) return true;
        // ProseMirror can retain a finished composition after blur until the next pointer
        // event. Keyboard refocus must still give the manuscript history its shortcuts.
        if (
          compositionBlurred &&
          view.composing &&
          view.editable &&
          handleHistoryKey(view, event)
        ) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      keyup() {
        pastePlain = false;
        return false;
      },
      compositionstart() {
        compositionBlurred = false;
        return false;
      },
      blur() {
        pastePlain = false;
        // Some native input methods commit without a compositionend event when focus leaves.
        compositionBlurred = true;
        return false;
      },
      paste(view, event) {
        const plain = pastePlain;
        pastePlain = false;
        return paste(view, event, plain, composing(view), refuse);
      },
    },
    dispatchTransaction(transaction) {
      const next = view.state.apply(transaction);
      const clipboard = transaction.getMeta(clipboardMeta) as ClipboardText | undefined;
      const working = transaction.docChanged ? readEditor(next.doc, draftId) : undefined;
      const result = working && serializeManuscript(working, { draftId });
      if (clipboard && result && !result.ok) {
        const previous = view.state.doc;
        const before = serializeManuscript(readEditor(previous, draftId), { draftId });
        const diagnostic = before.ok
          ? result.diagnostic
          : pendingPasteDiagnostic(previous, next.doc, draftId);
        if (diagnostic) {
          options.onPasteRefused?.({ ...clipboard, diagnostic });
          return;
        }
      }
      view.updateState(next);
      if (working && result) onChange(working, result);
      if (transaction.docChanged || transaction.selectionSet) onHeading(headingAtCursor(next));
    },
  });
  return {
    read: () => readEditor(view.state.doc, draftId),
    isComposing: () => composing(view),
    replace(next) {
      const held = serializeManuscript(readEditor(view.state.doc, draftId), { draftId });
      const incoming = serializeManuscript(next, { draftId });
      // Keep the cursor and undo history when a save confirms the text already shown.
      if (held.ok && incoming.ok && held.value === incoming.value) return;
      const from = view.state.selection.$head;
      const id: unknown = from.parent.attrs.id;
      let updated = stateFrom(next, plugins);
      if (typeof id === "string") {
        updated.doc.forEach((node, position) => {
          if (node.attrs.id === id)
            updated = updated.apply(
              updated.tr.setSelection(
                TextSelection.create(
                  updated.doc,
                  position + 1 + Math.min(from.parentOffset, node.content.size),
                ),
              ),
            );
        });
      }
      view.updateState(updated);
      onHeading(headingAtCursor(updated));
    },
    setEditable(editable) {
      view.setProps({ editable: () => editable });
    },
    refreshIdentities() {
      const repair = repairIdentities(view.state, retired());
      if (repair) view.dispatch(repair.setMeta("addToHistory", false));
    },
    focus() {
      view.focus();
    },
    jump(id) {
      let target: number | undefined;
      view.state.doc.forEach((node, position) => {
        if (node.attrs.id === id) target = position + 1;
      });
      if (target === undefined) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)));
      view.focus();
    },
    destroy() {
      compositionBlurred = true;
      view.destroy();
    },
  };
}
