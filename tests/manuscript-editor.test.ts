// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  manuscriptFormat,
  type CanonicalManuscript,
  type ManuscriptParagraph,
  type ManuscriptSection,
  type ManuscriptResult,
} from "@ohtia/contracts";
import {
  manuscriptBlocks,
  manuscriptHeadingType,
  mountManuscriptEditor,
  type ManuscriptEditor,
  type ManuscriptClipboardRefusal,
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
let validations: ManuscriptResult<string>[];
let refusals: ManuscriptClipboardRefusal[];
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
  validations = [];
  refusals = [];
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
    (next, result) => {
      changes.push(next);
      validations.push(result);
    },
    (heading) => headings.push(heading),
    retired,
    { language: "ko-KR", onPasteRefused: (refusal) => refusals.push(refusal) },
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

function paste(data: Record<string, string>, files: readonly File[] = []) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files, getData: (type: string) => data[type] ?? "" },
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
    expect(element.lang).toBe("ko-KR");
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

  it("keeps the original paragraph identity when Enter adds a paragraph before it", () => {
    const original = manuscript([paragraph(firstId, line("First"))]);
    const view = mount(original);
    caret(textNode(block(firstId)), 0);
    key("Enter");
    expect(view.read()).toEqual(original);
    const inserted = block(firstId).previousElementSibling;
    expect(inserted?.tagName).toBe("P");
    expect(inserted?.getAttribute("data-manuscript-block")).not.toBe(firstId);
    expect(block(firstId).contains(document.getSelection()?.anchorNode ?? null)).toBe(true);

    caret(inserted!, 0);
    paste({ "text/plain": "New" });
    expect(view.read().paragraphs[0]?.lines).toEqual([line("New")]);
    expect(view.read().paragraphs[1]).toEqual(original.paragraphs[0]);
    expect(validations.at(-1)?.ok).toBe(true);
  });

  it.each([5, 6, 7])("replaces separator spaces with a paragraph break at offset %i", (offset) => {
    const original = manuscript([paragraph(firstId, line("First  Second"))]);
    const view = mount(original);
    caret(textNode(block(firstId)), offset);
    key("Enter");
    const split = view.read();
    expect(texts(split)).toEqual(["First", "Second"]);
    expect(split.paragraphs[0]?.id).toBe(firstId);
    expect(validations.at(-1)?.ok).toBe(true);
    expect(document.getSelection()?.anchorOffset).toBe(0);

    undoKey();
    expect(view.read()).toEqual(original);
    key("Z", { ctrlKey: true, shiftKey: true, keyCode: 90 });
    expect(view.read()).toEqual(split);
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

  it("ignores typing, paste and Enter while locked and resumes with its selection and undo history", () => {
    const view = mount(manuscript([paragraph(firstId, line("Hello"))]));
    caretAtEnd(firstId);
    paste({ "text/plain": " world" });
    expect(texts(latest())).toEqual(["Hello world"]);
    const reported = changes.length;
    view.setEditable(false);
    expect(surface().getAttribute("contenteditable")).toBe("false");
    expect(paste({ "text/plain": "X" }).defaultPrevented).toBe(false);
    expect(key("Enter").defaultPrevented).toBe(false);
    expect(key("a").defaultPrevented).toBe(false);
    expect(undoKey().defaultPrevented).toBe(false);
    expect(changes).toHaveLength(reported);
    expect(block(firstId).textContent).toBe("Hello world");
    view.setEditable(true);
    expect(surface().getAttribute("contenteditable")).toBe("true");
    paste({ "text/plain": "!" });
    expect(texts(latest())).toEqual(["Hello world!"]);
    // The edit made before the lock and the one after it share an undo step.
    expect(undoKey().defaultPrevented).toBe(true);
    expect(texts(latest())).toEqual(["Hello"]);
  });

  it("preserves the first paragraph identity through merge undo and redo", () => {
    mount(manuscript([paragraph(firstId, line("First")), paragraph(secondId, line("Second"))]));
    editor?.jump(secondId);
    expect(key("Backspace", { keyCode: 8 }).defaultPrevented).toBe(true);
    expect(latest().paragraphs).toEqual([paragraph(firstId, line("FirstSecond"))]);
    undoKey();
    expect(latest().paragraphs.map(({ id }) => id)).toEqual([firstId, secondId]);
    key("z", { ctrlKey: true, shiftKey: true, keyCode: 90 });
    expect(latest().paragraphs).toEqual([paragraph(firstId, line("FirstSecond"))]);
  });

  it("returns canonical validation and leaves rejected rich or oversized paste recoverable", () => {
    const original = manuscript([paragraph(firstId, line("Keep"))]);
    const view = mount(original);
    select(firstId, 0, 4);
    const html = "<table><tr><td>Research</td></tr></table>";
    expect(paste({ "text/html": html, "text/plain": "Research" }).defaultPrevented).toBe(true);
    expect(refusals).toEqual([
      {
        html,
        text: "Research",
        diagnostic: { code: "unsupported-construct", location: { kind: "document" } },
      },
    ]);
    expect(view.read()).toEqual(original);
    paste({ "text/plain": "File" }, [new File(["File"], "draft.txt")]);
    expect(refusals.at(-1)?.diagnostic.code).toBe("unsupported-construct");
    const largeHtml = "<p>" + "x".repeat(1024 * 1024) + "</p>";
    paste({ "text/html": largeHtml });
    expect(refusals.at(-1)?.diagnostic.code).toBe("document-limit");
    const huge = "x".repeat(131073);
    paste({ "text/plain": huge });
    expect(refusals.at(-1)).toMatchObject({ text: huge, diagnostic: { code: "document-limit" } });
    const long = "한".repeat(3000);
    paste({ "text/plain": long });
    expect(refusals.at(-1)).toMatchObject({ text: long, diagnostic: { code: "text-limit" } });
    const manyLines = "text\n".repeat(258);
    paste({ "text/plain": manyLines });
    expect(refusals.at(-1)).toMatchObject({
      text: manyLines,
      diagnostic: { code: "unsupported-construct" },
    });
    expect(view.read()).toEqual(original);
    expect(changes).toHaveLength(0);
    paste({ "text/plain": "연구" });
    expect(latest().paragraphs).toEqual([paragraph(firstId, line("연구"))]);
    expect(validations.at(-1)).toMatchObject({ ok: true, value: expect.stringContaining("연구") });
    undoKey();
    expect(view.read()).toEqual(original);
    select(firstId, 0, 4);
    key("V", { ctrlKey: true, shiftKey: true });
    paste({ "text/html": html, "text/plain": "Research" });
    expect(view.read().paragraphs).toEqual([paragraph(firstId, line("Research"))]);
    key("V", { ctrlKey: true, shiftKey: true });
    surface().dispatchEvent(new KeyboardEvent("keyup", { key: "V", bubbles: true }));
    paste({ "text/html": html, "text/plain": "Ignored" });
    expect(refusals.at(-1)?.text).toBe("Ignored");
    expect(view.read().paragraphs).toEqual([paragraph(firstId, line("Research"))]);

    surface().dispatchEvent(new Event("paste", { bubbles: true, cancelable: true }));
    expect(refusals.at(-1)).toMatchObject({
      text: "",
      html: "",
      diagnostic: { code: "unsupported-construct" },
    });
    const metadata = '<meta charset="utf-8">';
    paste({ "text/html": metadata, "text/plain": "Recoverable" });
    expect(refusals.at(-1)).toMatchObject({ text: "Recoverable", html: metadata });
  });

  it("pastes into another paragraph while an invalid edit is still pending", async () => {
    const view = mount(
      manuscript([paragraph(firstId, line("First")), paragraph(secondId, line("Second"))]),
    );
    caretAtEnd(firstId);
    textNode(block(firstId)).appendData(" ");
    await vi.waitFor(() => expect(validations.at(-1)).toMatchObject({ ok: false }));
    caretAtEnd(secondId);
    paste({ "text/plain": " text" });
    expect(refusals).toHaveLength(0);
    expect(view.read().paragraphs).toEqual([
      paragraph(firstId, line("First ")),
      paragraph(secondId, line("Second text")),
    ]);
    expect(validations.at(-1)).toMatchObject({ ok: false });

    const held = view.read();
    for (const [data, code] of [
      [{ "text/plain": "tab\ttext" }, "invalid-text"],
      [{ "text/plain": "한".repeat(3000) }, "text-limit"],
      [{ "text/html": "<h4>Skipped level</h4>" }, "invalid-ast"],
    ] as const) {
      caretAtEnd(secondId);
      paste(data);
      expect(refusals.at(-1)?.diagnostic.code).toBe(code);
      expect(view.read()).toEqual(held);
    }

    const large = Array.from({ length: 16 }, (_, index) =>
      paragraph(`blk_large-${String(index)}`, line("a".repeat(8000))),
    );
    view.replace(manuscript(large));
    caretAtEnd("blk_large-0");
    textNode(block("blk_large-0")).appendData(" ");
    await vi.waitFor(() => expect(view.read().paragraphs[0]?.lines[0]?.text).toHaveLength(8001));
    const nearLimit = view.read();
    caret(trailing(), 0);
    paste({ "text/plain": "b".repeat(3000) });
    expect(refusals.at(-1)?.diagnostic.code).toBe("document-limit");
    expect(view.read()).toEqual(nearLimit);
  });

  it("pastes multiline plain text and preserves explicit and ordinary breaks in copied paragraphs", () => {
    const view = mount(manuscript([], { id: titleId, text: "Title" }));
    view.jump(titleId);
    paste({ "text/html": "<p>one<br>two</p>" });
    expect(refusals.at(-1)?.diagnostic.code).toBe("unsupported-construct");
    paste({
      "text/html":
        '<meta charset="utf-8"><!--StartFragment--><h1 data-pm-slice="1 1 []" data-manuscript-block="sec_foreign">New</h1>',
    });
    expect(view.read().title).toEqual({ id: titleId, text: "NewTitle" });
    caret(trailing(), 0);
    paste({ "text/plain": "One\r\n\r\nTwo" });
    expect(texts(latest())).toEqual(["# NewTitle", "One", "Two"]);
    const [first, second] = latest().paragraphs;
    expect(first?.id).not.toBe(second?.id);
    caretAtEnd(second!.id);
    paste({ "text/html": '<p> three<br data-manuscript-break="soft">four<br>five</p>' });
    expect(latest().paragraphs[1]?.lines).toEqual([
      line("Two three", "soft"),
      line("four", "hard"),
      line("five"),
    ]);
  });

  it("preserves soft and hard line breaks in the plain text clipboard", () => {
    mount(
      manuscript([paragraph(firstId, line("One", "soft"), line("Two", "hard"), line("Three"))]),
    );
    surface().focus();
    document.getSelection()?.selectAllChildren(block(firstId));
    document.dispatchEvent(new Event("selectionchange"));
    const transfer = new Map<string, string>();
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", {
      value: {
        clearData: () => transfer.clear(),
        setData: (type: string, value: string) => transfer.set(type, value),
      },
    });
    surface().dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    expect(transfer.get("text/plain")).toBe("One\nTwo\nThree");
    expect(transfer.get("text/html")).toContain('data-manuscript-break="soft"');
    expect(transfer.get("text/html")).toContain('data-manuscript-break="hard"');
  });

  it("pastes ordinary browser prose with source line wrapping and indentation", () => {
    const view = mount(manuscript([]));
    caret(trailing(), 0);
    paste({ "text/plain": "One Two", "text/html": "<p>\n  One\n  Two\n</p>" });
    caretAtEnd(view.read().paragraphs[0]!.id);
    key("Enter");
    caret(trailing(), 0);
    paste({
      "text/plain": "Three Four",
      "text/html": '<span style="color: red">Three\n  Four</span>',
    });
    expect(texts(view.read())).toEqual(["One Two", "Three Four"]);
    expect(validations.at(-1)?.ok).toBe(true);
    expect(refusals).toEqual([]);
    const preformatted = '<p><span style="white-space: pre">Five\n  Six</span></p>';
    paste({ "text/plain": "Five Six", "text/html": preformatted });
    expect(refusals.at(-1)).toMatchObject({ text: "Five Six", html: preformatted });
    expect(texts(view.read())).toEqual(["One Two", "Three Four"]);
  });

  it("pastes matching code wrappers as literal Markdown and keeps rich structures recoverable", () => {
    const view = mount(manuscript([]));
    const table = [
      "| Operating system | x86-64 (`x64` / `amd64`) | ARM64 (`arm64` / `aarch64`) |",
      "| ---------------- | ------------------------ | --------------------------- |",
      "| Windows          | Required                 | Optional                    |",
      "| macOS            | Optional, Intel          | Required, Apple Silicon     |",
      "| Linux            | Required                 | Required                    |",
    ];
    const text = table.join("\n");
    const html = `<pre><code><span>${text}</span></code></pre>`;
    paste({ "text/plain": text, "text/html": html });
    expect(view.read().paragraphs.map(({ lines }) => lines)).toEqual([
      table.map((row, index) => line(row, index === table.length - 1 ? null : "hard")),
    ]);
    expect(validations.at(-1)?.ok).toBe(true);
    const held = view.read();
    paste({ "text/plain": text, "text/html": "<table><tr><td>Windows</td></tr></table>" });
    paste({ "text/plain": "Different text", "text/html": html });
    paste({ "text/plain": "Windows", "text/html": "<pre><a>Windows</a></pre>" });
    expect(refusals).toHaveLength(3);
    expect(view.read()).toEqual(held);
  });

  it("pastes line-wrapped Markdown straight into a focused heading without changing it", () => {
    const original = manuscript([], { id: titleId, text: "Title" });
    const view = mount(original);
    view.focus();
    const rows = [
      "| Operating system | x86-64 (`x64` / `amd64`) | ARM64 (`arm64` / `aarch64`) |",
      "| ---------------- | ------------------------ | --------------------------- |",
      "| Windows          | Required                 | Optional                    |",
      "| macOS            | Optional, Intel          | Required, Apple Silicon     |",
      "| Linux            | Required                 | Required                    |",
    ];
    const html = `<div style="white-space: pre">${rows
      .map(
        (row) =>
          `<div><span style="color: black">${row.slice(0, 20)}</span><span>${row.slice(20)}</span></div>`,
      )
      .join("")}</div>`;
    const text = rows.join("\n");
    paste({ "text/html": html, "text/plain": text });
    expect(refusals).toEqual([]);
    expect(view.read().title).toEqual(original.title);
    const [table] = view.read().paragraphs;
    expect(table?.lines).toEqual(
      rows.map((row, index) => line(row, index === rows.length - 1 ? null : "hard")),
    );
    expect(validations.at(-1)?.ok).toBe(true);
    const different = text.replace("Windows", "Other");
    paste({ "text/html": html, "text/plain": different });
    expect(refusals.at(-1)?.text).toBe(different);
    expect(view.read().paragraphs).toEqual([table]);
  });

  it("pastes a rendered table as literal Markdown with one explicit line per row", () => {
    const view = mount(manuscript([paragraph(firstId, line("Before and after"))]));
    caret(textNode(block(firstId)), "Before".length);
    const html = `<meta charset="utf-8"><div><table>
      <thead><tr><th>Operating system</th><th>x86-64 (<code>x64</code> / <code>amd64</code>)</th><th>ARM64 (<code>arm64</code> / <code>aarch64</code>)</th></tr></thead>
      <tbody><tr><td>Windows</td><td>Required</td><td>Optional</td></tr>
      <tr><td>macOS</td><td>Optional, Intel</td><td>Required, Apple Silicon</td></tr>
      <tr><td>Linux</td><td>Required</td><td>Required</td></tr></tbody></table></div>`;
    const text = "Operating system\t x86-64\tARM64\nWindows\tRequired\tOptional";
    paste({ "text/html": html, "text/plain": text });
    expect(refusals).toEqual([]);
    const [before, table] = view.read().paragraphs;
    expect(before).toEqual(paragraph(firstId, line("Before and after")));
    expect(table?.lines).toEqual([
      line("| Operating system | x86-64 (x64 / amd64) | ARM64 (arm64 / aarch64) |", "hard"),
      line("| --- | --- | --- |", "hard"),
      line("| Windows | Required | Optional |", "hard"),
      line("| macOS | Optional, Intel | Required, Apple Silicon |", "hard"),
      line("| Linux | Required | Required |"),
    ]);
    expect(validations.at(-1)?.ok).toBe(true);
    const held = view.read();

    const merged = html.replace(
      "<td>Required</td><td>Optional</td>",
      '<td colspan="2">Required</td>',
    );
    paste({ "text/html": merged, "text/plain": text });
    expect(refusals.at(-1)?.html).toBe(merged);
    expect(view.read()).toEqual(held);
  });

  it("pastes Hangul from browser selections in a title and a paragraph", () => {
    const view = mount(
      manuscript([paragraph(firstId, line("Body"))], { id: titleId, text: "Title" }),
    );
    const html = '<p><span style="color: black"> 한글 </span></p>';
    const clipboard = { "text/plain": " 한글 ", "text/html": html };
    select(titleId, 0, 5);
    paste(clipboard);
    expect(view.read().title).toEqual({ id: titleId, text: "한글" });
    select(firstId, 0, 4);
    paste(clipboard);
    expect(view.read().paragraphs).toEqual([paragraph(firstId, line("한글"))]);
    expect(validations.at(-1)?.ok).toBe(true);

    caret(textNode(block(firstId)), 1);
    paste({ "text/plain": " 글 " });
    expect(view.read().paragraphs).toEqual([paragraph(firstId, line("한 글 글"))]);
    expect(validations.at(-1)?.ok).toBe(true);
    expect(refusals).toEqual([]);
  });

  it("undoes and redoes after keyboard refocus when a native composition missed its end event", () => {
    const view = mount(manuscript([paragraph(firstId, line("First"))]));
    caretAtEnd(firstId);
    paste({ "text/plain": "한글" });
    expect(view.read().paragraphs).toEqual([paragraph(firstId, line("First한글"))]);
    surface().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    surface().blur();
    view.focus();
    expect(undoKey().defaultPrevented).toBe(true);
    expect(view.read().paragraphs).toEqual([paragraph(firstId, line("First"))]);
    expect(key("Z", { ctrlKey: true, shiftKey: true, keyCode: 90 }).defaultPrevented).toBe(true);
    expect(view.read().paragraphs).toEqual([paragraph(firstId, line("First한글"))]);
  });

  it("keeps native commit keys available and exposes current working text", () => {
    const original = manuscript([paragraph(firstId, line("First"))]);
    const view = mount(original);
    caretAtEnd(firstId);
    expect(view.isComposing()).toBe(false);
    expect(key("Enter", { isComposing: true }).defaultPrevented).toBe(false);
    expect(key("Enter", { keyCode: 229 }).defaultPrevented).toBe(false);
    expect(changes).toHaveLength(0);
    expect(view.read()).toEqual(original);
    key("Enter");
    expect(changes).toEqual([original]);
    surface().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(view.isComposing()).toBe(true);
    expect(key("Enter").defaultPrevented).toBe(false);
    paste({ "text/plain": "Pending" });
    expect(refusals.at(-1)?.text).toBe("Pending");
    expect(view.read()).toEqual(original);
    surface().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(view.isComposing()).toBe(false);
    surface().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    surface().blur();
    expect(view.isComposing()).toBe(false);
    caretAtEnd(firstId);
    paste({ "text/plain": " text" });
    expect(view.read().paragraphs).toEqual([paragraph(firstId, line("First text"))]);

    surface().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(view.isComposing()).toBe(true);
    surface().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.isComposing()).toBe(false);
    paste({ "text/plain": " again" });
    expect(view.read().paragraphs).toEqual([paragraph(firstId, line("First text again"))]);
  });

  it("removes the editor when destroyed", () => {
    const view = mount(manuscript([paragraph(firstId)]));
    view.destroy();
    editor = undefined;
    expect(container.querySelector("[contenteditable]")).toBeNull();
  });
});
