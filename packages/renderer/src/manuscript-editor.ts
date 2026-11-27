import {
  manuscriptFormat,
  type CanonicalManuscript,
  type ManuscriptLine,
  type ManuscriptSection,
} from "@ohtia/contracts";
import { serializeManuscript } from "@ohtia/domain";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Schema, type Node as EditorNode } from "prosemirror-model";
import { EditorState, Plugin, TextSelection, type Command } from "prosemirror-state";
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
      toDOM: () => ["br"],
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

function editorPlugins(retired: () => ReadonlySet<string>) {
  return [
    history(),
    keymap({ "Mod-z": undo, "Shift-Mod-z": redo, "Mod-y": redo }),
    keymap({
      Enter: (state, dispatch, view) =>
        enterHeading(state, dispatch, view) ||
        startTitle(state, dispatch) ||
        endHeading(state, dispatch),
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

export interface ManuscriptEditor {
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
  onChange: (document: CanonicalManuscript) => void,
  onHeading: (heading: string | undefined) => void,
  retired: () => ReadonlySet<string> = () => new Set(),
): ManuscriptEditor {
  const plugins = editorPlugins(retired);
  const view = new EditorView(container, {
    state: stateFrom(document, plugins),
    attributes: { role: "textbox", "aria-multiline": "true", "aria-label": label },
    dispatchTransaction(transaction) {
      const next = view.state.apply(transaction);
      view.updateState(next);
      if (transaction.docChanged) onChange(readEditor(next.doc, document.draftId));
      if (transaction.docChanged || transaction.selectionSet) onHeading(headingAtCursor(next));
    },
  });
  return {
    replace(next) {
      const held = serializeManuscript(readEditor(view.state.doc, document.draftId), {
        draftId: document.draftId,
      });
      const incoming = serializeManuscript(next, { draftId: document.draftId });
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
      view.destroy();
    },
  };
}
