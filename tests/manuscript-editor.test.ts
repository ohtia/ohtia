// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  manuscriptFormat,
  type CanonicalManuscript,
  type ManuscriptParagraph,
  type ManuscriptSection,
} from "@ohtia/contracts";
import {
  manuscriptBlocks,
  manuscriptHeadingType,
  mountManuscriptEditor,
  type ManuscriptEditor,
} from "../packages/renderer/src/manuscript-editor.js";

const draftId = "01a14fbd-d779-7014-a580-95cd6274b134";
const titleId = "sec_0000000-title";
const firstId = "blk_0000000-first";
const secondId = "blk_0000000-second";
const chapterId = "sec_0000000-chapter";
const sectionId = "sec_0000000-section";
const label = "Manuscript";

function paragraph(id: string, ...lines: ManuscriptParagraph["lines"]): ManuscriptParagraph {
  return { id, lines: lines.length ? lines : [{ text: id, breakAfter: null }] };
}

function line(text: string, breakAfter: "soft" | "hard" | null = null) {
  return { text, breakAfter };
}

function manuscript(
  paragraphs: readonly ManuscriptParagraph[],
  title: CanonicalManuscript["title"] = null,
  sections?: readonly ManuscriptSection[],
): CanonicalManuscript {
  return {
    format: manuscriptFormat,
    draftId,
    title,
    paragraphs: [...paragraphs],
    ...(sections && { sections: [...sections] }),
  };
}

let container: HTMLDivElement;
let editor: ManuscriptEditor | undefined;
let changes: CanonicalManuscript[];
let headings: (string | undefined)[];
const restore: (() => void)[] = [];

function patch<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  restore.push(() => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  });
}

beforeEach(() => {
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  patch(Range.prototype, "getClientRects", rects);
  patch(Range.prototype, "getBoundingClientRect", rect as () => DOMRect);
  patch(Element.prototype, "getClientRects", rects);
  patch(Element.prototype, "scrollIntoView", () => undefined);
  patch(document, "elementFromPoint", () => null);
  container = document.createElement("div");
  document.body.append(container);
  changes = [];
  headings = [];
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  container.remove();
  for (const undo of restore.splice(0).reverse()) undo();
});

function mount(document: CanonicalManuscript, retired?: () => ReadonlySet<string>) {
  editor = mountManuscriptEditor(
    container,
    document,
    label,
    (next) => changes.push(next),
    (heading) => headings.push(heading),
    retired,
  );
  return editor;
}

function surface(): HTMLElement {
  const element = container.querySelector<HTMLElement>("[contenteditable]");
  if (!element) throw new Error("The editor surface is missing.");
  return element;
}

function block(id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-manuscript-block="${id}"]`);
  if (!element) throw new Error(`Block ${id} is missing.`);
  return element;
}

function textNode(element: Node): Text {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!(node instanceof Text)) throw new Error("The block has no text.");
  return node;
}

/** Place the DOM caret, as a click would, and let the editor read it. */
function caret(node: Node, offset: number) {
  surface().focus();
  const selection = document.getSelection();
  selection?.collapse(node, offset);
  document.dispatchEvent(new Event("selectionchange"));
}

function caretAtEnd(id: string) {
  const text = textNode(block(id));
  caret(text, text.length);
}

function key(name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: name,
    keyCode: name === "Enter" ? 13 : name.toUpperCase().charCodeAt(0),
    bubbles: true,
    cancelable: true,
    ...init,
  });
  surface().dispatchEvent(event);
  return event;
}

function paste(data: Record<string, string>) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => data[type] ?? "" },
  });
  surface().dispatchEvent(event);
  return event;
}

function latest(): CanonicalManuscript {
  const document = changes.at(-1);
  if (!document) throw new Error("The editor reported no change.");
  return document;
}

function texts(document: CanonicalManuscript) {
  return manuscriptBlocks(document).map((item) =>
    "text" in item
      ? `${"level" in item ? "#".repeat(item.level) : "#"} ${item.text}`
      : item.lines.map((entry) => entry.text).join("/"),
  );
}

function trailing(): HTMLElement {
  const last = surface().lastElementChild;
  if (!(last instanceof HTMLElement) || last.textContent) throw new Error("No empty last block.");
  return last;
}

function select(id: string, from: number, to: number) {
  const text = textNode(block(id));
  surface().focus();
  document.getSelection()?.setBaseAndExtent(text, from, text, to);
  document.dispatchEvent(new Event("selectionchange"));
}

const undoKey = () => key("z", { ctrlKey: true, keyCode: 90 });

describe("manuscript block order", () => {
  it("lists the title, sections and paragraphs in canonical order", () => {
    const sections: ManuscriptSection[] = [
      { id: "sec_a", text: "A", level: 2, beforeParagraph: 0 },
      { id: "sec_b", text: "B", level: 2, beforeParagraph: 1 },
      { id: "sec_c", text: "C", level: 3, beforeParagraph: 1 },
      { id: "sec_d", text: "D", level: 2, beforeParagraph: 2 },
    ];
    const document = manuscript(
      [paragraph(firstId), paragraph(secondId)],
      { id: titleId, text: "Title" },
      sections,
    );
    expect(manuscriptBlocks(document).map((item) => item.id)).toEqual([
      titleId,
      "sec_a",
      firstId,
      "sec_b",
      "sec_c",
      secondId,
      "sec_d",
    ]);
    expect(manuscriptBlocks(manuscript([paragraph(firstId)])).map((item) => item.id)).toEqual([
      firstId,
    ]);
  });

  it("maps level one to the title type and caps deeper levels at h5", () => {
    expect([1, 2, 3, 4, 5, 6].map(manuscriptHeadingType)).toEqual([
      "type.doc.title",
      "type.doc.h2",
      "type.doc.h3",
      "type.doc.h4",
      "type.doc.h5",
      "type.doc.h5",
    ]);
  });
});

describe("manuscript editor", () => {
  it("renders identified blocks in an accessible multiline textbox", () => {
    mount(
      manuscript([paragraph(firstId), paragraph(secondId)], { id: titleId, text: "Title" }, [
        { id: chapterId, text: "Chapter", level: 2, beforeParagraph: 1 },
        { id: sectionId, text: "Section", level: 6, beforeParagraph: 2 },
      ]),
    );
    const element = surface();
    expect(element.getAttribute("role")).toBe("textbox");
    expect(element.getAttribute("aria-multiline")).toBe("true");
    expect(element.getAttribute("aria-label")).toBe(label);
    const rendered = [...element.querySelectorAll("[data-manuscript-block]")].map((node) => [
      node.tagName,
      node.getAttribute("data-manuscript-block"),
      node.getAttribute("data-type"),
      node.textContent,
    ]);
    expect(rendered).toEqual([
      ["H1", titleId, "type.doc.title", "Title"],
      ["P", firstId, "type.doc.body", firstId],
      ["H2", chapterId, "type.doc.h2", "Chapter"],
      ["P", secondId, "type.doc.body", secondId],
      ["H6", sectionId, "type.doc.h5", "Section"],
      ["P", expect.stringMatching(/^blk_[0-9a-f-]+$/), "type.doc.body", ""],
    ]);
    expect(trailing().tagName).toBe("P");
    // Identity repair has nothing to change in a freshly loaded document.
    editor?.refreshIdentities();
    expect(changes).toEqual([]);
  });

  it("reports soft and hard line breaks unchanged after an edit", () => {
    const lines = [line("one", "soft"), line("two", "hard"), line("three")];
    const original = manuscript([paragraph(firstId, ...lines)], { id: titleId, text: "Title" });
    mount(original);
    expect(block(firstId).querySelectorAll("br")).toHaveLength(2);
    caretAtEnd(titleId);
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(latest()).toEqual(original);
  });

  it("converts a typed level-two Markdown heading into a chapter on Enter", () => {
    mount(manuscript([paragraph(firstId)], { id: titleId, text: "Title" }));
    caret(trailing(), 0);
    paste({ "text/plain": "## Chapter" });
    changes.length = 0;
    expect(key("Enter").defaultPrevented).toBe(true);
    const chapter = surface().querySelector("h2");
    expect(chapter?.textContent).toBe("Chapter");
    expect(chapter?.getAttribute("data-type")).toBe("type.doc.h2");
    expect(chapter?.nextElementSibling?.tagName).toBe("P");
    expect(chapter?.nextElementSibling?.textContent).toBe("");
    expect(changes).toHaveLength(1);
    const [section] = latest().sections ?? [];
    expect(section).toMatchObject({ text: "Chapter", level: 2, beforeParagraph: 1 });
    expect(section?.id).toMatch(/^sec_[0-9a-f-]+$/);
    expect(texts(latest())).toEqual(["# Title", firstId, "## Chapter"]);
    paste({ "text/plain": "Body" });
    expect(texts(latest())).toEqual(["# Title", firstId, "## Chapter", "Body"]);
  });

  it("accepts a Markdown heading one level below the previous heading", () => {
    mount(
      manuscript([paragraph(firstId, line("### Section"))], { id: titleId, text: "Title" }, [
        { id: chapterId, text: "Chapter", level: 2, beforeParagraph: 0 },
      ]),
    );
    caretAtEnd(firstId);
    key("Enter");
    expect(latest().sections).toEqual([
      { id: chapterId, text: "Chapter", level: 2, beforeParagraph: 0 },
      expect.objectContaining({ text: "Section", level: 3, beforeParagraph: 0 }),
    ]);
  });

  it("turns a Markdown title marker in the first block into the title", () => {
    mount(manuscript([paragraph(firstId, line("# Thesis"))]));
    caretAtEnd(firstId);
    key("Enter");
    expect(latest().title).toEqual({
      id: expect.stringMatching(/^sec_/) as string,
      text: "Thesis",
    });
    expect(latest().paragraphs).toEqual([]);
  });

  it("refuses heading levels that skip a level and title markers after the first block", () => {
    mount(
      manuscript([paragraph(firstId, line("### Deep")), paragraph(secondId, line("# Late"))], {
        id: titleId,
        text: "Title",
      }),
    );
    caretAtEnd(firstId);
    key("Enter");
    expect(latest().sections).toBeUndefined();
    expect(texts(latest())).toEqual(["# Title", "### Deep", "# Late"]);
    expect(block(firstId).nextElementSibling?.tagName).toBe("P");
    caretAtEnd(secondId);
    key("Enter");
    expect(latest().sections).toBeUndefined();
    expect(latest().title).toEqual({ id: titleId, text: "Title" });
    expect(texts(latest())).toEqual(["# Title", "### Deep", "# Late"]);
    expect(surface().querySelectorAll("h1, h2, h3")).toHaveLength(1);
  });

  it("splits ordinary paragraphs and selections on Enter", () => {
    mount(
      manuscript([paragraph(firstId, line("Plain text")), paragraph(secondId, line("#hashtag"))]),
    );
    caretAtEnd(firstId);
    key("Enter");
    expect(texts(latest())).toEqual(["Plain text", "#hashtag"]);
    expect(block(firstId).nextElementSibling?.textContent).toBe("");
    caretAtEnd(secondId);
    key("Enter");
    expect(latest().sections).toBeUndefined();
    select(firstId, 0, "Plain ".length);
    key("Enter");
    expect(texts(latest())).toEqual(["text", "#hashtag"]);
    expect(latest().title).toBeNull();
  });

  it("inserts an empty paragraph after a heading when Enter is pressed at its end", () => {
    mount(
      manuscript([paragraph(firstId)], { id: titleId, text: "Title" }, [
        { id: chapterId, text: "Chapter", level: 2, beforeParagraph: 0 },
      ]),
    );
    caretAtEnd(chapterId);
    expect(key("Enter").defaultPrevented).toBe(true);
    const inserted = block(chapterId).nextElementSibling;
    expect(inserted?.tagName).toBe("P");
    expect(inserted?.textContent).toBe("");
    expect(inserted?.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
    paste({ "text/plain": "Opening" });
    expect(texts(latest())).toEqual(["# Title", "## Chapter", "Opening", firstId]);
  });

  it("keeps both parts of the title when Enter splits it", () => {
    mount(manuscript([paragraph(firstId)], { id: titleId, text: "AlphaBeta" }));
    caret(textNode(block(titleId)), 5);
    key("Enter");
    const document = latest();
    expect(document.title).toEqual({ id: titleId, text: "Alpha" });
    expect(document.paragraphs[0]).toEqual({
      id: expect.stringMatching(/^blk_[0-9a-f-]+$/) as string,
      lines: [line("Beta")],
    });
    expect(document.paragraphs.slice(1)).toEqual([paragraph(firstId)]);
    expect(surface().querySelectorAll("h1")).toHaveLength(1);
  });

  it("keeps the title first and unchanged when Enter is pressed at its start", () => {
    mount(manuscript([paragraph(firstId)], { id: titleId, text: "AlphaBeta" }));
    caret(textNode(block(titleId)), 0);
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(changes).toEqual([]);
    expect(surface().firstElementChild?.tagName).toBe("H1");
    expect(surface().firstElementChild?.textContent).toBe("AlphaBeta");
    expect(surface().querySelectorAll("h1")).toHaveLength(1);
  });

  it("removes a selection that starts at the title on Enter without splitting the title", () => {
    mount(manuscript([paragraph(firstId)], { id: titleId, text: "AlphaBeta" }));
    const title = textNode(block(titleId));
    surface().focus();
    document.getSelection()?.setBaseAndExtent(title, 0, title, 5);
    document.dispatchEvent(new Event("selectionchange"));
    expect(key("Enter").defaultPrevented).toBe(true);
    const document_ = latest();
    expect(document_.title).toEqual({ id: titleId, text: "Beta" });
    expect(document_.paragraphs).toEqual([paragraph(firstId)]);
    expect(surface().firstElementChild?.tagName).toBe("H1");
  });

  it("keeps pasted chapters as sections with fresh identities", () => {
    mount(
      manuscript([paragraph(firstId)], { id: titleId, text: "Title" }, [
        { id: chapterId, text: "Existing", level: 2, beforeParagraph: 1 },
      ]),
    );
    caret(trailing(), 0);
    paste({
      "text/html": `<h2 data-manuscript-block="${chapterId}">Chapter</h2><p data-manuscript-block="${firstId}">Body</p>`,
    });
    const document = latest();
    expect(texts(document)).toEqual(["# Title", firstId, "## Existing", "## Chapter", "Body"]);
    const pasted = document.sections?.[1];
    expect(pasted).toMatchObject({ text: "Chapter", level: 2, beforeParagraph: 1 });
    expect(pasted?.id).toMatch(/^sec_[0-9a-f-]+$/);
    const ids = manuscriptBlocks(document).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 3)).toEqual([titleId, firstId, chapterId]);
    expect(document.paragraphs[1]?.id).toMatch(/^blk_[0-9a-f-]+$/);
  });

  it("keeps a pasted title after the first block as paragraph text", () => {
    mount(manuscript([paragraph(firstId)], { id: titleId, text: "Title" }));
    caret(trailing(), 0);
    paste({ "text/html": "<h1>Pasted</h1>" });
    const document = latest();
    expect(document.title).toEqual({ id: titleId, text: "Title" });
    expect(document.sections).toBeUndefined();
    expect(texts(document)).toEqual(["# Title", firstId, "Pasted"]);
    expect(document.paragraphs[1]?.id).toMatch(/^blk_[0-9a-f-]+$/);
    expect(surface().querySelectorAll("h1")).toHaveLength(1);
  });

  it("omits emptied headings from the reported document", () => {
    mount(
      manuscript([paragraph(firstId)], { id: titleId, text: "Title" }, [
        { id: chapterId, text: "Chapter", level: 2, beforeParagraph: 0 },
      ]),
    );
    select(chapterId, 0, "Chapter".length);
    key("Backspace", { keyCode: 8 });
    expect(latest()).toEqual(manuscript([paragraph(firstId)], { id: titleId, text: "Title" }));
    select(titleId, 0, "Title".length);
    key("Backspace", { keyCode: 8 });
    expect(latest()).toEqual(manuscript([paragraph(firstId)]));
    expect(block(titleId).tagName).toBe("H1");
  });

  it("replaces duplicate identities created by splitting blocks", () => {
    mount(
      manuscript([paragraph(firstId, line("FirstHalf"))], { id: titleId, text: "Title" }, [
        { id: chapterId, text: "ChapterOne", level: 2, beforeParagraph: 0 },
      ]),
    );
    caret(textNode(block(chapterId)), "Chapter".length);
    key("Enter");
    const sections = latest().sections ?? [];
    expect(sections.map((section) => section.text)).toEqual(["Chapter", "One"]);
    expect(sections[0]?.id).toBe(chapterId);
    expect(sections[1]?.id).toMatch(/^sec_[0-9a-f-]+$/);
    expect(sections[1]?.id).not.toBe(chapterId);
    caret(textNode(block(firstId)), "First".length);
    key("Enter");
    const [first, second] = latest().paragraphs;
    expect(first).toEqual({ id: firstId, lines: [line("First")] });
    expect(second?.lines).toEqual([line("Half")]);
    expect(second?.id).toMatch(/^blk_[0-9a-f-]+$/);
    expect(second?.id).not.toBe(firstId);
  });

  it("reissues retired identities that an undo brings back", () => {
    const retired = new Set<string>();
    mount(
      manuscript([paragraph(firstId, line("First")), paragraph(secondId, line("Second"))]),
      () => retired,
    );
    const start = textNode(block(firstId));
    const end = textNode(block(secondId));
    surface().focus();
    document.getSelection()?.setBaseAndExtent(start, start.length, end, end.length);
    document.dispatchEvent(new Event("selectionchange"));
    key("Backspace", { keyCode: 8 });
    expect(latest().paragraphs).toEqual([{ id: firstId, lines: [line("First")] }]);
    // A save retires the removed paragraph's identity.
    retired.add(secondId);
    expect(undoKey().defaultPrevented).toBe(true);
    const [first, second] = latest().paragraphs;
    expect(first).toEqual({ id: firstId, lines: [line("First")] });
    expect(second?.lines).toEqual([line("Second")]);
    expect(second?.id).toMatch(/^blk_[0-9a-f-]+$/);
    expect(second?.id).not.toBe(secondId);
    expect(container.querySelector(`[data-manuscript-block="${secondId}"]`)).toBeNull();
  });

  it("reissues identities retired by a newer base without an edit or an undo step", () => {
    const retired = new Set<string>();
    mount(
      manuscript([paragraph(firstId, line("First")), paragraph(secondId, line("Second"))]),
      () => retired,
    );
    // A save acknowledged after an undo restored the paragraph retires its identity.
    retired.add(secondId);
    editor?.refreshIdentities();
    const [first, second] = latest().paragraphs;
    expect(first).toEqual({ id: firstId, lines: [line("First")] });
    expect(second?.lines).toEqual([line("Second")]);
    expect(second?.id).toMatch(/^blk_[0-9a-f-]+$/);
    expect(second?.id).not.toBe(secondId);
    const repaired = latest();
    undoKey();
    expect(latest()).toBe(repaired);
    editor?.refreshIdentities();
    expect(latest()).toBe(repaired);
  });

  it("reports the nearest chapter or section at or above the cursor", () => {
    const third = "blk_0000000-third";
    mount(
      manuscript(
        [paragraph(firstId), paragraph(secondId), paragraph(third)],
        { id: titleId, text: "Title" },
        [
          { id: chapterId, text: "Chapter", level: 2, beforeParagraph: 1 },
          { id: sectionId, text: "Section", level: 3, beforeParagraph: 2 },
        ],
      ),
    );
    const at = (id: string) => {
      caret(textNode(block(id)), 1);
      return headings.at(-1);
    };
    expect(at(secondId)).toBe(chapterId);
    expect(at(firstId)).toBeUndefined();
    expect(at(chapterId)).toBe(chapterId);
    expect(at(third)).toBe(sectionId);
    expect(at(titleId)).toBeUndefined();
  });

  it("keeps the selection and undo history when replaced with the text it holds", () => {
    const view = mount(manuscript([paragraph(firstId, line("Hello"))]));
    caretAtEnd(firstId);
    paste({ "text/plain": " world" });
    const held = latest();
    expect(texts(held)).toEqual(["Hello world"]);
    const reported = headings.length;
    view.replace(structuredClone(held));
    expect(headings).toHaveLength(reported);
    expect(undoKey().defaultPrevented).toBe(true);
    expect(texts(latest())).toEqual(["Hello"]);
    caret(textNode(block(firstId)), 2);
    view.replace(structuredClone(latest()));
    paste({ "text/plain": "X" });
    expect(texts(latest())).toEqual(["HeXllo"]);
  });

  it("replaces different text and keeps the cursor in the block with the same identity", () => {
    const view = mount(manuscript([paragraph(firstId, line("Hello")), paragraph(secondId)]));
    caret(textNode(block(firstId)), 3);
    const before = changes.length;
    view.replace(
      manuscript(
        [paragraph(firstId, line("Changed")), paragraph(secondId)],
        {
          id: titleId,
          text: "New title",
        },
        [{ id: chapterId, text: "Chapter", level: 2, beforeParagraph: 0 }],
      ),
    );
    expect(changes).toHaveLength(before);
    expect(block(titleId).textContent).toBe("New title");
    expect(block(firstId).textContent).toBe("Changed");
    expect(headings.at(-1)).toBe(chapterId);
    paste({ "text/plain": "X" });
    expect(texts(latest())).toEqual(["# New title", "## Chapter", "ChaXnged", secondId]);
    expect(undoKey().defaultPrevented).toBe(true);
    expect(texts(latest())).toEqual(["# New title", "## Chapter", "Changed", secondId]);
  });

  it("replaces content without a matching block and leaves the cursor in the document", () => {
    const view = mount(manuscript([paragraph(firstId, line("Hello"))]));
    caret(trailing(), 0);
    view.replace(manuscript([paragraph(secondId, line("Other"))]));
    expect(container.querySelector(`[data-manuscript-block="${firstId}"]`)).toBeNull();
    expect(block(secondId).textContent).toBe("Other");
    caretAtEnd(secondId);
    view.replace(manuscript([paragraph(firstId, line("Again"))]));
    expect(block(firstId).textContent).toBe("Again");
    expect(headings.at(-1)).toBeUndefined();
  });

  it("jumps to a block by identity and focuses the editor", () => {
    const view = mount(manuscript([paragraph(firstId), paragraph(secondId, line("Second"))]));
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      outside.focus();
      const reported = headings.length;
      view.jump("blk_0000000-missing");
      expect(document.activeElement).toBe(outside);
      expect(headings).toHaveLength(reported);
      view.jump(secondId);
      expect(document.activeElement).toBe(surface());
      paste({ "text/plain": "X" });
      expect(texts(latest())).toEqual([firstId, "XSecond"]);
      outside.focus();
      view.focus();
      expect(document.activeElement).toBe(surface());
    } finally {
      outside.remove();
    }
  });

  it("removes the editor when destroyed", () => {
    const view = mount(manuscript([paragraph(firstId)]));
    view.destroy();
    editor = undefined;
    expect(container.querySelector("[contenteditable]")).toBeNull();
  });
});
