// @vitest-environment jsdom
import { createHash, randomUUID } from "node:crypto";
import { TextEncoder } from "node:util";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  failure,
  manuscriptFormat,
  splitText,
  type CanonicalManuscript,
  type FoundationPort,
  type ManuscriptRevision,
  type ManuscriptWriteResult,
  type Outcome,
  type ResearchOutputs,
} from "@ohtia/contracts";
import { parseManuscript, serializeManuscript } from "@ohtia/domain";
import {
  ManuscriptDrafts,
  ManuscriptView,
  useManuscripts,
  type ManuscriptContent,
  type ManuscriptJump,
} from "../packages/renderer/src/manuscript-view.js";
import { ProjectCollections } from "../packages/renderer/src/project-controller.js";
import { call, deferred } from "./fixtures/settings.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const projectId = "019a8000-0000-7000-8000-000000000300";
const draftId = "019a8000-0000-7000-8000-000000000301";
const id = (n: number) => `019a8000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId, subscriptionId: "scope-1" };
const date = "2026-11-17T10:00:00.000Z";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const original: CanonicalManuscript = {
  format: manuscriptFormat,
  draftId,
  title: { id: "sec_title", text: "Care networks" },
  paragraphs: [
    {
      id: "blk_one",
      lines: [
        { text: "Opening paragraph.", breakAfter: "hard" },
        { text: "Second line.", breakAfter: null },
      ],
    },
    {
      id: "blk_two",
      lines: [
        { text: "Framework text", breakAfter: "soft" },
        { text: "continues.", breakAfter: null },
      ],
    },
    { id: "blk_three", lines: [{ text: "Method text.", breakAfter: null }] },
  ],
  sections: [
    { id: "sec_intro", text: "Introduction", level: 2, beforeParagraph: 0 },
    { id: "sec_frame", text: "Framework", level: 2, beforeParagraph: 1 },
    { id: "sec_method", text: "Method", level: 3, beforeParagraph: 2 },
  ],
};

function edited(text: string, base: CanonicalManuscript = original): CanonicalManuscript {
  return {
    ...base,
    paragraphs: [
      ...base.paragraphs,
      { id: `blk_${String(base.paragraphs.length + 1)}`, lines: [{ text, breakAfter: null }] },
    ],
  };
}

function serialized(document: CanonicalManuscript) {
  const result = serializeManuscript(document, { draftId });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}

function parsed(text: string) {
  const result = parseManuscript(text, { draftId });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}

function revision(n: number, parent: string | null, text: string): ManuscriptRevision {
  return {
    projectId,
    draftId,
    revisionId: id(n),
    parentRevisionId: parent,
    restorationOriginId: null,
    language: "en-GB",
    createdAt: date,
    saveReason: parent ? "manual" : "initial",
    contentSha256: sha(text),
    authorKind: "researcher",
    recordingActor: "utility",
  };
}

/** Fake port that implements only the manuscript operations used by the view. */
function manuscriptPort(initial: CanonicalManuscript = original) {
  const text = serialized(initial);
  const state = { text, revision: revision(500, null, text), next: 501 };
  const receipts = new Map<string, ManuscriptWriteResult>();
  const commit = (
    operationId: string,
    input: Parameters<FoundationPort["saveManuscript"]>[1],
  ): Outcome<ManuscriptWriteResult> => {
    if (typeof input.markdown !== "string") return failure("invalid_message");
    if (input.expectedRevisionId !== state.revision.revisionId)
      return {
        ok: true,
        value: {
          resultId: id(state.next + 100),
          manuscriptChange: { kind: "conflict", revision: state.revision },
        },
      };
    state.text = input.markdown;
    state.revision = revision(state.next++, input.expectedRevisionId, input.markdown);
    const result: ManuscriptWriteResult = {
      resultId: id(state.next + 200),
      manuscriptChange: { kind: "committed", revision: state.revision },
    };
    receipts.set(operationId, result);
    return { ok: true, value: result };
  };
  const port = {
    listManuscripts: vi.fn((_input: Parameters<FoundationPort["listManuscripts"]>[0]) =>
      call({
        ok: true as const,
        value: {
          projectId,
          manuscripts: [{ draftId, title: "Thesis", currentRevisionId: state.revision.revisionId }],
          next: null,
        },
      }),
    ),
    readManuscript: vi.fn(
      (
        _input: Parameters<FoundationPort["readManuscript"]>[0],
      ): ReturnType<FoundationPort["readManuscript"]> =>
        call<ResearchOutputs["manuscript.read"]>({
          ok: true,
          value: { revision: state.revision, markdown: state.text },
        }),
    ),
    readManuscriptPart: vi.fn(
      (
        _input: Parameters<FoundationPort["readManuscriptPart"]>[0],
      ): ReturnType<FoundationPort["readManuscriptPart"]> => call(failure("record_not_found")),
    ),
    saveManuscript: vi.fn(
      (
        operationId: string,
        input: Parameters<FoundationPort["saveManuscript"]>[1],
      ): ReturnType<FoundationPort["saveManuscript"]> => call(commit(operationId, input)),
    ),
    stageManuscriptPart: vi.fn(() =>
      call({ ok: true as const, value: { accepted: true as const } }),
    ),
    readManuscriptReceipt: vi.fn(
      ({
        operationId,
      }: Parameters<FoundationPort["readManuscriptReceipt"]>[0]): ReturnType<
        FoundationPort["readManuscriptReceipt"]
      > =>
        call({
          ok: true,
          value: { projectId, operationId, receipt: receipts.get(operationId) ?? null },
        }),
    ),
    createManuscript: vi.fn(),
  };
  const content = (): ManuscriptContent => ({
    revision: state.revision,
    document: parsed(state.text),
  });
  return { port, state, commit, content, foundation: port as unknown as FoundationPort };
}

let root: Root, container: HTMLDivElement;
let drafts: ManuscriptDrafts;
let onCommit: ReturnType<typeof vi.fn>;
let onOutline: ReturnType<typeof vi.fn>;
let onWriting: ReturnType<typeof vi.fn>;
let onSaveForClose: ReturnType<typeof vi.fn>;
const rangeMethods = ["getClientRects", "getBoundingClientRect"] as const;
let rangeOriginals: Partial<Record<(typeof rangeMethods)[number], unknown>>;
let scrollIntoViewOriginal: unknown;

beforeEach(() => {
  vi.stubGlobal("crypto", {
    randomUUID,
    subtle: {
      digest: async (_algorithm: string, bytes: Uint8Array) =>
        Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer,
    },
  });
  vi.stubGlobal("TextEncoder", TextEncoder);
  // Lay blocks out at 100px intervals inside the scrolled document viewport.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const block = this.dataset.manuscriptBlock;
    const surface = this.closest(".workspace-manuscript");
    const viewport = this.closest<HTMLElement>(".workspace-document-tabs");
    if (block && surface && viewport) {
      const index = [...surface.querySelectorAll("[data-manuscript-block]")].indexOf(this);
      return new DOMRect(0, index * 100 - viewport.scrollTop, 600, 100);
    }
    return new DOMRect(0, 0, 600, 400);
  });
  rangeOriginals = {};
  for (const method of rangeMethods) {
    rangeOriginals[method] = Object.getOwnPropertyDescriptor(Range.prototype, method);
    Object.defineProperty(Range.prototype, method, {
      configurable: true,
      value:
        method === "getClientRects"
          ? () => Object.assign([], { item: () => null })
          : () => new DOMRect(0, 0, 0, 0),
    });
  }
  scrollIntoViewOriginal = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  drafts = new ManuscriptDrafts();
  onCommit = vi.fn();
  onOutline = vi.fn();
  onWriting = vi.fn();
  onSaveForClose = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  for (const method of rangeMethods) {
    const descriptor = rangeOriginals[method] as PropertyDescriptor | undefined;
    if (descriptor) Object.defineProperty(Range.prototype, method, descriptor);
    else delete (Range.prototype as unknown as Record<string, unknown>)[method];
  }
  if (scrollIntoViewOriginal)
    Object.defineProperty(
      Element.prototype,
      "scrollIntoView",
      scrollIntoViewOriginal as PropertyDescriptor,
    );
  else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type ViewProps = Parameters<typeof ManuscriptView>[0];

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function view(port: FoundationPort, props: Partial<ViewProps> = {}) {
  await act(async () =>
    root.render(
      h(
        "div",
        { className: "workspace-document-tabs" },
        h(ManuscriptView, {
          locale: "en-US",
          scope,
          waitingForCollection: false,
          canPresent: true,
          port,
          manuscript: { draftId, title: "Thesis", currentRevisionId: id(500) },
          visible: true,
          onCommit,
          onOutline,
          jump: undefined,
          drafts,
          onWriting,
          onSaveForClose,
          ...props,
        }),
      ),
    ),
  );
  await settle();
}

const viewport = () => container.querySelector<HTMLElement>(".workspace-document-tabs")!;
const article = () => container.querySelector<HTMLElement>("article.workspace-manuscript")!;
const status = () =>
  container.querySelector(":scope > div > .workspace-manuscript-status")?.textContent;
const footerStatus = () =>
  container.querySelector<HTMLElement>(".workspace-manuscript-footer [role=status]")!;
const textbox = () => container.querySelector<HTMLElement>("[role=textbox]");
function button(name: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === name,
  );
}
const modeButton = () =>
  container.querySelector<HTMLButtonElement>(".workspace-manuscript-actions button")!;
async function press(name: string) {
  const target = button(name);
  expect(target, name).toBeDefined();
  await act(async () => {
    target!.focus();
    target!.click();
  });
  await settle();
}
async function seed(document: CanonicalManuscript, base: ManuscriptContent) {
  await act(async () => {
    drafts.set(draftId, { base, document });
  });
}

describe("manuscript view reading", () => {
  it("announces loading and then renders the full revision with its headings, breaks and language", async () => {
    const { foundation, port, state } = manuscriptPort();
    const read = deferred<Outcome<ResearchOutputs["manuscript.read"]>>();
    port.readManuscript.mockImplementationOnce(() => ({ result: read.promise, cancel() {} }));
    await view(foundation);
    expect(status()).toBe("Loading…");
    expect(container.querySelector("article")).toBeNull();
    await act(async () =>
      read.resolve({ ok: true, value: { revision: state.revision, markdown: state.text } }),
    );
    await settle();
    expect(port.readManuscript).toHaveBeenCalledWith({ ...scope, draftId, revisionId: null });
    expect(status()).toBe("");
    expect(button("Try again")).toBeUndefined();
    expect(article().getAttribute("lang")).toBe("en-GB");
    expect(
      [...article().children].map((node) => [node.tagName, node.getAttribute("data-type")]),
    ).toEqual([
      ["H1", "type.doc.title"],
      ["H2", "type.doc.h2"],
      ["P", "type.doc.body"],
      ["H2", "type.doc.h2"],
      ["P", "type.doc.body"],
      ["H3", "type.doc.h3"],
      ["P", "type.doc.body"],
    ]);
    const [first, second] = [...article().querySelectorAll("p")];
    expect(first?.querySelector("br")).not.toBeNull();
    expect(first?.textContent).toBe("Opening paragraph.Second line.");
    expect(second?.textContent).toBe("Framework text continues.");
    expect(onCommit).toHaveBeenLastCalledWith(state.revision);
    expect(onOutline).toHaveBeenLastCalledWith(draftId, original.sections, undefined, "en-GB");
    expect(footerStatus().textContent).toBe("Saved");
    expect(modeButton().textContent).toBe("Edit");
  });

  it("assembles a multipart revision and refuses parts that do not match the revision", async () => {
    const { foundation, port, state } = manuscriptPort();
    const parts = splitText(state.text, 64);
    const descriptor = {
      source: state.revision.revisionId,
      parts: parts.length,
      bytes: Buffer.byteLength(state.text),
      sha256: sha(state.text),
    };
    let tampered = false;
    port.readManuscript.mockImplementation(() =>
      call({ ok: true, value: { revision: state.revision, markdown: descriptor } }),
    );
    port.readManuscriptPart.mockImplementation(({ index, revisionId }) =>
      call({
        ok: true,
        value: {
          projectId,
          draftId,
          revisionId,
          index,
          text: tampered && index === 1 ? parts[0]!.toUpperCase() : parts[index - 1]!,
        },
      }),
    );
    await view(foundation);
    expect(parts.length).toBeGreaterThan(1);
    expect(port.readManuscriptPart).toHaveBeenCalledTimes(parts.length);
    expect(port.readManuscriptPart).toHaveBeenLastCalledWith({
      ...scope,
      draftId,
      revisionId: state.revision.revisionId,
      index: parts.length,
    });
    expect(article().querySelector("h1")?.textContent).toBe("Care networks");

    tampered = true;
    await view(foundation, {
      manuscript: { draftId, title: "Thesis", currentRevisionId: id(499) },
    });
    expect(status()).toBe("Could not open the manuscript.");
    tampered = false;
    port.readManuscriptPart.mockImplementationOnce(() => call(failure("record_not_found")));
    await press("Try again");
    expect(status()).toBe("Manuscripts are unavailable.");
  });

  it("reports failed and unavailable reads with a Try again that reads the revision again", async () => {
    const { foundation, port } = manuscriptPort();
    port.readManuscript.mockImplementationOnce(() => call(failure("storage_failed")));
    await view(foundation);
    expect(status()).toBe("Could not open the manuscript.");
    expect(container.querySelector("article")).toBeNull();
    port.readManuscript.mockImplementationOnce(() => call(failure("record_not_found")));
    await press("Try again");
    expect(status()).toBe("Manuscripts are unavailable.");
    port.readManuscript.mockImplementationOnce(() => ({
      result: Promise.reject(new Error("bridge closed")),
      cancel() {},
    }));
    await press("Try again");
    expect(status()).toBe("Could not open the manuscript.");
    await press("Try again");
    expect(port.readManuscript).toHaveBeenCalledTimes(4);
    expect(status()).toBe("");
    expect(button("Try again")).toBeUndefined();
    expect(article().querySelector("h1")?.textContent).toBe("Care networks");
  });

  it("explains that a manuscript without text has no text yet", async () => {
    const { foundation } = manuscriptPort({
      format: manuscriptFormat,
      draftId,
      title: null,
      paragraphs: [],
    });
    await view(foundation);
    expect(article().textContent).toBe("This manuscript has no text yet.");
    expect(article().querySelector(".workspace-manuscript-status")?.getAttribute("lang")).toBe(
      "en-US",
    );
  });

  it("without a verified scope waits for the collection or presents only a retained revision", async () => {
    const { foundation, port, state } = manuscriptPort();
    await view(foundation, { scope: undefined, waitingForCollection: true });
    expect(status()).toBe("Loading…");
    expect(button("Try again")).toBeUndefined();
    await view(foundation, { scope: undefined, waitingForCollection: false });
    expect(status()).toBe("Manuscripts are unavailable.");
    expect(port.readManuscript).not.toHaveBeenCalled();

    await view(foundation);
    expect(article()).not.toBeNull();
    await view(foundation, { scope: undefined, waitingForCollection: true });
    expect(status()).toBe("");
    expect(container.querySelector("section")?.hasAttribute("inert")).toBe(false);
    onOutline.mockClear();
    await view(foundation, { scope: undefined, canPresent: false });
    expect(status()).toBe("Manuscripts are unavailable.");
    expect(container.querySelector("section")?.hasAttribute("inert")).toBe(true);
    expect(onOutline).toHaveBeenLastCalledWith(draftId, [], undefined, "en-GB");
    expect(onCommit).toHaveBeenLastCalledWith(null);
    expect(port.readManuscript).toHaveBeenCalledTimes(1);
    expect(state.revision.revisionId).toBe(id(500));
  });

  it("follows the reading heading while scrolling and jumps to a requested heading", async () => {
    const { foundation } = manuscriptPort();
    await view(foundation);
    const scroll = async (top: number) => {
      viewport().scrollTop = top;
      await act(async () => viewport().dispatchEvent(new Event("scroll")));
    };
    await scroll(350);
    expect(onOutline).toHaveBeenLastCalledWith(draftId, original.sections, "sec_frame", "en-GB");
    expect(container.querySelector("nav")?.textContent).toContain("Framework");
    await scroll(0);
    expect(onOutline).toHaveBeenLastCalledWith(draftId, original.sections, undefined, "en-GB");
    // Scroll events from nested content do not move the reading position.
    viewport().scrollTop = 520;
    await act(async () =>
      container
        .querySelector(".workspace-panel-scroll")!
        .dispatchEvent(new Event("scroll", { bubbles: true })),
    );
    expect(onOutline).toHaveBeenLastCalledWith(draftId, original.sections, undefined, "en-GB");
    viewport().scrollTop = 0;

    const jump: ManuscriptJump = { draftId, headingId: "sec_method" };
    await view(foundation, { jump });
    expect(viewport().scrollTop).toBe(500);
    expect(document.activeElement?.textContent).toBe("Method");
    expect(onOutline).toHaveBeenLastCalledWith(draftId, original.sections, "sec_method", "en-GB");
    // The jump's own scroll notification does not recompute the heading.
    await act(async () => viewport().dispatchEvent(new Event("scroll")));
    expect(onOutline).toHaveBeenLastCalledWith(draftId, original.sections, "sec_method", "en-GB");
    // The same request is applied once.
    viewport().scrollTop = 0;
    await view(foundation, { jump });
    expect(viewport().scrollTop).toBe(0);
  });

  it("reports the presented revision only while visible", async () => {
    const { foundation, state } = manuscriptPort();
    await view(foundation);
    expect(onCommit).toHaveBeenLastCalledWith(state.revision);
    await view(foundation, { visible: false });
    expect(onCommit).toHaveBeenLastCalledWith(null);
    await view(foundation);
    expect(onCommit).toHaveBeenLastCalledWith(state.revision);
  });
});

describe("manuscript editing and saving", () => {
  it("switches between Preview and Edit in place, keeping pending text and the reading position", async () => {
    const { foundation, content } = manuscriptPort();
    await view(foundation);
    viewport().scrollTop = 250;
    await press("Edit");
    expect(article().hidden).toBe(true);
    expect(textbox()).not.toBeNull();
    expect(textbox()?.getAttribute("aria-label")).toBe("Manuscript");
    expect(viewport().scrollTop).toBe(250);
    expect(onWriting).toHaveBeenLastCalledWith(true);
    expect(modeButton().textContent).toBe("Preview");
    expect(container.querySelector(".workspace-manuscript-footer span")?.textContent).toBe("Edit");

    await seed(edited("Pending sentence."), content());
    expect(footerStatus().textContent).toBe("Unsaved changes");
    expect(footerStatus().dataset.pending).toBe("true");
    expect(onSaveForClose).toHaveBeenLastCalledWith(expect.any(Function));

    viewport().scrollTop = 250;
    await press("Preview");
    expect(article().hidden).toBe(false);
    expect(viewport().scrollTop).toBe(250);
    expect(onWriting).toHaveBeenLastCalledWith(false);
    expect(article().textContent).toContain("Pending sentence.");
    expect(drafts.get(draftId)?.document).toEqual(edited("Pending sentence."));
    await press("Edit");
    expect(textbox()?.textContent).toContain("Opening paragraph.");
  });

  it("records editor changes as pending work for the document", async () => {
    const { foundation, state } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    const editor = textbox()!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? "Pasted " : ""),
      },
    });
    await act(async () => editor.dispatchEvent(paste));
    const work = drafts.get(draftId);
    expect(work?.base.revision).toBe(state.revision);
    expect(work?.document.title?.text).toContain("Pasted");
    expect(footerStatus().textContent).toBe("Unsaved changes");
    expect(button("Save")).toBeDefined();
  });

  it("does not report pending work for entering Edit or for text restored to its saved form", async () => {
    const { foundation } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    expect(drafts.pending).toBe(false);
    expect(footerStatus().textContent).not.toBe("Unsaved changes");
    const editor = textbox()!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? "Pasted " : ""),
      },
    });
    await act(async () => editor.dispatchEvent(paste));
    expect(drafts.pending).toBe(true);
    const undo = new KeyboardEvent("keydown", {
      key: "z",
      keyCode: 90,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => editor.dispatchEvent(undo));
    expect(undo.defaultPrevented).toBe(true);
    expect(drafts.pending).toBe(false);
    expect(button("Save")).toBeUndefined();
  });

  it("saves the whole document against its base revision, confirms it and keeps focus in the toolbar", async () => {
    const { foundation, port, state, content } = manuscriptPort();
    await view(foundation);
    const document = edited("Saved sentence.");
    await seed(document, content());
    await press("Save");
    expect(port.saveManuscript).toHaveBeenCalledOnce();
    const [operationId, input] = port.saveManuscript.mock.calls[0]!;
    expect(operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(input).toEqual({
      ...scope,
      draftId,
      expectedRevisionId: id(500),
      saveReason: "manual",
      markdown: serialized(document),
    });
    expect(port.readManuscriptReceipt).not.toHaveBeenCalled();
    expect(drafts.pending).toBe(false);
    expect(footerStatus().textContent).toBe("Manuscript saved.");
    expect(button("Save")).toBeUndefined();
    expect(button("Discard changes")).toBeUndefined();
    expect(globalThis.document.activeElement).toBe(modeButton());
    expect(onSaveForClose).toHaveBeenLastCalledWith(undefined);
    expect(onCommit).toHaveBeenLastCalledWith(state.revision);
    expect(article().textContent).toContain("Saved sentence.");

    const reread = deferred<Outcome<ResearchOutputs["manuscript.read"]>>();
    port.readManuscript.mockImplementationOnce(() => ({ result: reread.promise, cancel() {} }));
    await view(foundation, {
      manuscript: { draftId, title: "Thesis", currentRevisionId: state.revision.revisionId },
    });
    expect(port.readManuscript).toHaveBeenCalledTimes(2);
    expect(status()).toBe("");
    expect(footerStatus().textContent).toBe("Manuscript saved.");
    await act(async () =>
      reread.resolve({ ok: true, value: { revision: state.revision, markdown: state.text } }),
    );
    await settle();
    expect(article().textContent).toContain("Saved sentence.");
  });

  it("keeps newer pending text over the newly saved base when it changes during the save", async () => {
    const { foundation, port, state, content, commit } = manuscriptPort();
    await view(foundation);
    await seed(edited("First version."), content());
    const save = deferred<Outcome<ManuscriptWriteResult>>();
    let submitted: [string, Parameters<FoundationPort["saveManuscript"]>[1]] | undefined;
    port.saveManuscript.mockImplementationOnce((operationId, input) => {
      submitted = [operationId, input];
      return { result: save.promise, cancel() {} };
    });
    await press("Save");
    expect(footerStatus().textContent).toBe("Saving…");
    expect(button("Save")?.disabled).toBe(true);
    const inFlight = drafts.get(draftId)!;
    expect(inFlight.request).toBeDefined();
    await act(async () => {
      drafts.set(draftId, { ...inFlight, document: edited("Second version.") });
    });
    await act(async () => save.resolve(commit(...submitted!)));
    await settle();
    const kept = drafts.get(draftId);
    expect(kept?.document).toEqual(edited("Second version."));
    expect(kept?.base.revision).toEqual(state.revision);
    expect(kept?.base.document).toEqual(edited("First version."));
    expect(kept?.request).toBeUndefined();
    expect(footerStatus().textContent).toBe("Unsaved changes");
    expect(article().textContent).toContain("Second version.");

    await press("Save");
    expect(port.saveManuscript).toHaveBeenLastCalledWith(expect.any(String), {
      ...scope,
      draftId,
      expectedRevisionId: id(501),
      saveReason: "manual",
      markdown: serialized(edited("Second version.")),
    });
    expect(drafts.pending).toBe(false);
    expect(footerStatus().textContent).toBe("Manuscript saved.");
  });

  it("keeps text undone while a save is being prepared as pending over the saved version", async () => {
    const { foundation, port, state, content } = manuscriptPort();
    await view(foundation);
    const base = content();
    await press("Edit");
    const editor = textbox()!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? "Pasted " : ""),
      },
    });
    await act(async () => editor.dispatchEvent(paste));
    const pasted = drafts.get(draftId)!.document;
    const hashing = deferred<ArrayBuffer>();
    vi.stubGlobal("crypto", { randomUUID, subtle: { digest: () => hashing.promise } });
    await act(async () => button("Save")!.click());
    // Undo back to the saved text before the save request exists.
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          keyCode: 90,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(drafts.pending).toBe(true);
    await act(async () =>
      hashing.resolve(
        Uint8Array.from(createHash("sha256").update(serialized(pasted)).digest()).buffer,
      ),
    );
    await settle();
    expect(port.saveManuscript).toHaveBeenCalledOnce();
    const kept = drafts.get(draftId);
    expect(kept?.request).toBeUndefined();
    expect(kept?.base.revision).toEqual(state.revision);
    expect(kept?.base.document).toEqual(pasted);
    expect(serialized(kept!.document)).toBe(serialized(base.document));
    expect(footerStatus().textContent).toBe("Unsaved changes");
  });

  it("does not keep text undone during a failed save as pending work", async () => {
    const { foundation, port } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    const editor = textbox()!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? "Pasted " : ""),
      },
    });
    await act(async () => editor.dispatchEvent(paste));
    const pasted = drafts.get(draftId)!.document;
    const hashing = deferred<ArrayBuffer>();
    vi.stubGlobal("crypto", { randomUUID, subtle: { digest: () => hashing.promise } });
    port.saveManuscript.mockImplementationOnce(() => call(failure("storage_failed")));
    await act(async () => button("Save")!.click());
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          keyCode: 90,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(drafts.pending).toBe(true);
    await act(async () =>
      hashing.resolve(
        Uint8Array.from(createHash("sha256").update(serialized(pasted)).digest()).buffer,
      ),
    );
    await settle();
    expect(port.saveManuscript).toHaveBeenCalledOnce();
    expect(drafts.pending).toBe(false);
    expect(button("Save")).toBeUndefined();
    expect(footerStatus().textContent).toBe("Could not save the manuscript.");
  });

  it("clears an earlier save failure when the text returns to its saved form", async () => {
    const { foundation, port } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    const editor = textbox()!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? "Pasted " : ""),
      },
    });
    await act(async () => editor.dispatchEvent(paste));
    port.saveManuscript.mockImplementationOnce(() => call(failure("storage_failed")));
    await press("Save");
    expect(footerStatus().textContent).toBe("Could not save the manuscript.");
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          keyCode: 90,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(drafts.pending).toBe(false);
    expect(footerStatus().textContent).not.toBe("Could not save the manuscript.");
    expect(button("Save")).toBeUndefined();
  });

  it("keeps the text and reports a conflict when the saved manuscript changed", async () => {
    const { foundation, port, state, content } = manuscriptPort();
    await view(foundation);
    const base = content();
    await seed(edited("Conflicting sentence."), base);
    state.revision = revision(600, id(500), state.text);
    await press("Save");
    expect(port.saveManuscript).toHaveBeenCalledOnce();
    expect(footerStatus().textContent).toBe("The saved manuscript changed. Your edits are kept.");
    expect(drafts.get(draftId)).toEqual({ base, document: edited("Conflicting sentence.") });
    expect(button("Save")?.disabled).toBe(false);
    expect(button("Discard changes")?.disabled).toBe(false);
    expect(article().textContent).toContain("Conflicting sentence.");
  });

  it("keeps the text after a refused save and holds a rejected bridge call as unconfirmed", async () => {
    const { foundation, port, content } = manuscriptPort();
    await view(foundation);
    const base = content();
    await seed(edited("Unsaved sentence."), base);
    port.saveManuscript.mockImplementationOnce(() => call(failure("storage_failed")));
    await press("Save");
    expect(footerStatus().textContent).toBe("Could not save the manuscript.");
    expect(drafts.get(draftId)).toEqual({ base, document: edited("Unsaved sentence.") });
    expect(drafts.canDiscard).toBe(true);
    expect(button("Save")).toBeDefined();

    port.saveManuscript.mockImplementationOnce(() => ({
      result: Promise.reject(new Error("bridge closed")),
      cancel() {},
    }));
    // A rejected bridge call has an unknown outcome, so the request is held for reconciliation.
    await press("Save");
    expect(footerStatus().textContent).toBe(
      "The save is unconfirmed. Check it before saving again.",
    );
    expect(drafts.get(draftId)?.request).toBeDefined();
    expect(drafts.canDiscard).toBe(false);
  });

  it("holds an unconfirmed save for reconciliation and completes it from the original receipt", async () => {
    const { foundation, port, state, content, commit } = manuscriptPort();
    await view(foundation);
    const document = edited("Unconfirmed sentence.");
    await seed(document, content());
    port.saveManuscript.mockImplementationOnce((operationId, input) => {
      commit(operationId, input);
      return call(failure("save_uncertain"));
    });
    await press("Save");
    expect(footerStatus().textContent).toBe(
      "The save is unconfirmed. Check it before saving again.",
    );
    const held = drafts.get(draftId)!;
    expect(held.request?.text).toBe(serialized(document));
    expect(held.request?.intent).toEqual({
      kind: "save",
      draftId,
      expectedRevisionId: id(500),
      saveReason: "manual",
      contentSha256: sha(serialized(document)),
    });
    expect(drafts.canDiscard).toBe(false);
    expect(button("Save")).toBeUndefined();
    expect(button("Try again")?.disabled).toBe(false);
    expect(button("Discard changes")?.disabled).toBe(true);

    await press("Try again");
    expect(port.readManuscriptReceipt).toHaveBeenCalledWith({
      ...scope,
      operationId: held.request!.operationId,
      intent: held.request!.intent,
    });
    expect(port.saveManuscript).toHaveBeenCalledOnce();
    expect(drafts.pending).toBe(false);
    expect(footerStatus().textContent).toBe("Manuscript saved.");
    expect(onCommit).toHaveBeenLastCalledWith(state.revision);
  });

  it("resubmits the original request when no receipt exists for an unconfirmed save", async () => {
    const { foundation, port, content } = manuscriptPort();
    await view(foundation);
    const document = edited("Retried sentence.");
    await seed(document, content());
    port.saveManuscript.mockImplementationOnce(() => call(failure("timed_out")));
    await press("Save");
    const request = drafts.get(draftId)!.request!;
    expect(footerStatus().textContent).toBe(
      "The save is unconfirmed. Check it before saving again.",
    );

    port.readManuscriptReceipt.mockImplementationOnce(() => call(failure("service_unavailable")));
    await press("Try again");
    expect(port.saveManuscript).toHaveBeenCalledOnce();
    expect(drafts.get(draftId)?.request).toBe(request);
    port.readManuscriptReceipt.mockImplementationOnce(() => ({
      result: Promise.reject(new Error("bridge closed")),
      cancel() {},
    }));
    await press("Try again");
    expect(port.saveManuscript).toHaveBeenCalledOnce();
    expect(drafts.get(draftId)?.request).toBe(request);
    expect(footerStatus().textContent).toBe(
      "The save is unconfirmed. Check it before saving again.",
    );

    await press("Try again");
    expect(port.readManuscriptReceipt).toHaveBeenCalledTimes(3);
    expect(port.saveManuscript).toHaveBeenCalledTimes(2);
    expect(port.saveManuscript.mock.calls[1]).toEqual([
      request.operationId,
      {
        ...scope,
        draftId,
        expectedRevisionId: id(500),
        saveReason: "manual",
        markdown: request.text,
      },
    ]);
    expect(drafts.pending).toBe(false);
    expect(footerStatus().textContent).toBe("Manuscript saved.");
  });

  it("refuses an invalid document without calling the port", async () => {
    const { foundation, port, content } = manuscriptPort();
    await view(foundation);
    await seed(edited(" padded text "), content());
    await press("Save");
    expect(port.saveManuscript).not.toHaveBeenCalled();
    expect(port.stageManuscriptPart).not.toHaveBeenCalled();
    expect(footerStatus().textContent).toBe("Check the manuscript text before saving.");
    expect(drafts.get(draftId)?.request).toBeUndefined();
    expect(drafts.pending).toBe(true);
  });

  it("discards pending work and returns focus to the mode toggle", async () => {
    const { foundation, port, content } = manuscriptPort();
    await view(foundation);
    await seed(edited("Discarded sentence."), content());
    expect(article().textContent).toContain("Discarded sentence.");
    await press("Discard changes");
    expect(drafts.pending).toBe(false);
    expect(article().textContent).not.toContain("Discarded sentence.");
    expect(footerStatus().textContent).toBe("Saved");
    expect(document.activeElement).toBe(modeButton());
    expect(port.saveManuscript).not.toHaveBeenCalled();
  });
});

describe("manuscript editing across modes", () => {
  async function pasteText(text: string) {
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? text : ""),
      },
    });
    await act(async () => textbox()!.dispatchEvent(paste));
  }
  async function choose(crumb: string, heading: string) {
    const trigger = [...container.querySelectorAll<HTMLButtonElement>("nav button")].find(
      (node) => node.textContent === crumb,
    )!;
    await act(async () => trigger.click());
    const option = [...container.querySelectorAll<HTMLElement>("[role=option]")].find(
      (node) => node.textContent === heading,
    )!;
    expect(option, heading).toBeDefined();
    await act(async () => option.click());
  }

  it("jumps to a heading chosen from the breadcrumbs in Preview and in Edit", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const { foundation } = manuscriptPort();
    await view(foundation);
    await choose("Manuscript", "Framework");
    expect(viewport().scrollTop).toBe(300);
    expect(document.activeElement?.textContent).toBe("Framework");
    expect(onOutline).toHaveBeenLastCalledWith(draftId, original.sections, "sec_frame", "en-GB");

    viewport().scrollTop = 0;
    await press("Edit");
    await choose("Manuscript", "Introduction");
    expect(viewport().scrollTop).toBe(100);
    expect(textbox()?.contains(document.activeElement)).toBe(true);
    expect(onOutline).toHaveBeenLastCalledWith(draftId, original.sections, "sec_intro", "en-GB");
  });

  it("resumes shared pending work and an unconfirmed request in a remounted view", async () => {
    const { foundation, port, content } = manuscriptPort();
    await view(foundation);
    await seed(edited("Held sentence."), content());
    port.saveManuscript.mockImplementationOnce(() => call(failure("outcome_unknown")));
    await press("Save");
    const request = drafts.get(draftId)!.request!;
    await act(async () => root.render(null));
    await view(foundation);
    expect(footerStatus().textContent).toBe(
      "The save is unconfirmed. Check it before saving again.",
    );
    expect(button("Try again")).toBeDefined();
    expect(button("Discard changes")?.disabled).toBe(true);
    expect(article().textContent).toContain("Held sentence.");

    await press("Edit");
    expect(textbox()?.textContent).toContain("Held sentence.");
    await pasteText("More ");
    const work = drafts.get(draftId)!;
    expect(work.request).toBe(request);
    expect(work.document).not.toEqual(edited("Held sentence."));
    expect(footerStatus().textContent).toBe(
      "The save is unconfirmed. Check it before saving again.",
    );
  });

  it("clears the saved confirmation on the next edit and restores committed text after Discard", async () => {
    const { foundation, content } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    await seed(edited("Confirmed sentence."), content());
    await press("Save");
    expect(footerStatus().textContent).toBe("Manuscript saved.");
    await pasteText("Draft ");
    expect(footerStatus().textContent).toBe("Unsaved changes");
    expect(textbox()?.textContent).toContain("Draft ");
    await press("Discard changes");
    expect(drafts.pending).toBe(false);
    expect(footerStatus().textContent).toBe("Saved");
    expect(textbox()?.textContent).not.toContain("Draft ");
    expect(textbox()?.textContent).toContain("Confirmed sentence.");
    expect(document.activeElement).toBe(modeButton());
  });
});

describe("manuscript edit lock", () => {
  async function pasteText(text: string) {
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? text : ""),
      },
    });
    await act(async () => textbox()!.dispatchEvent(paste));
    return paste;
  }

  it("while locked disables the mode toggle, Save and Discard and makes the editor read-only until unlocked", async () => {
    const { foundation, port } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    await pasteText("Pending ");
    expect(footerStatus().textContent).toBe("Unsaved changes");
    const pending = drafts.get(draftId)!.document;

    await view(foundation, { locked: true });
    expect(modeButton().textContent).toBe("Preview");
    expect(modeButton().disabled).toBe(true);
    expect(button("Save")?.disabled).toBe(true);
    expect(button("Discard changes")?.disabled).toBe(true);
    expect(textbox()?.getAttribute("contenteditable")).toBe("false");
    const refused = await pasteText("Late ");
    expect(refused.defaultPrevented).toBe(false);
    expect(drafts.get(draftId)!.document).toBe(pending);
    await act(async () => button("Save")!.click());
    await settle();
    expect(port.saveManuscript).not.toHaveBeenCalled();
    expect(drafts.pending).toBe(true);

    await view(foundation, { locked: false });
    expect(modeButton().disabled).toBe(false);
    expect(button("Save")?.disabled).toBe(false);
    expect(button("Discard changes")?.disabled).toBe(false);
    expect(textbox()?.getAttribute("contenteditable")).toBe("true");
    await pasteText("More ");
    expect(drafts.get(draftId)!.document).not.toEqual(pending);
    expect(textbox()?.textContent).toContain("More ");
    await press("Save");
    expect(port.saveManuscript).toHaveBeenCalledOnce();
    expect(drafts.pending).toBe(false);
  });

  it("disables the Edit toggle in Preview while locked", async () => {
    const { foundation } = manuscriptPort();
    await view(foundation, { locked: true });
    expect(modeButton().textContent).toBe("Edit");
    expect(modeButton().disabled).toBe(true);
    await act(async () => modeButton().click());
    expect(textbox()).toBeNull();
    expect(article().hidden).toBe(false);
  });

  it("mounts the editor read-only when it first appears while locked", async () => {
    const { foundation } = manuscriptPort();
    await view(foundation, { visible: false });
    await press("Edit");
    expect(textbox()).toBeNull();
    await view(foundation, { visible: true, locked: true });
    expect(textbox()?.getAttribute("contenteditable")).toBe("false");
    await pasteText("Late ");
    expect(drafts.pending).toBe(false);
    await view(foundation, { visible: true, locked: false });
    expect(textbox()?.getAttribute("contenteditable")).toBe("true");
    await pasteText("Now ");
    expect(drafts.pending).toBe(true);
  });

  // Chromium moves focus off a control the lock disables at its next rendering update; jsdom never
  // does and cannot blur a disabled control, so the tests apply that focus fixup after locking.
  const dropFocus = async () => {
    await act(async () => {
      const element = document.activeElement as (HTMLElement & { disabled?: boolean }) | null;
      if (!element) return;
      const disabled = element.disabled === true;
      if (disabled) element.disabled = false;
      element.blur();
      if (disabled) element.disabled = true;
    });
    expect(document.activeElement).toBe(document.body);
  };

  it("returns focus to the mode toggle after a lock is released", async () => {
    const { foundation } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    await act(async () => modeButton().focus());
    expect(document.activeElement).toBe(modeButton());
    await view(foundation, { locked: true });
    expect(modeButton().disabled).toBe(true);
    await dropFocus();
    await view(foundation, { locked: false });
    expect(modeButton().textContent).toBe("Preview");
    expect(document.activeElement).toBe(modeButton());
  });

  it("returns focus to Save after a lock is released", async () => {
    const { foundation } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    await pasteText("Pending ");
    await act(async () => button("Save")!.focus());
    expect(document.activeElement).toBe(button("Save"));
    await view(foundation, { locked: true });
    expect(button("Save")!.disabled).toBe(true);
    await dropFocus();
    await view(foundation, { locked: false });
    expect(document.activeElement).toBe(button("Save"));
  });

  it("returns focus to the editor after a lock is released when the editor had it", async () => {
    const { foundation } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    await act(async () => textbox()!.focus());
    expect(document.activeElement).toBe(textbox());
    await view(foundation, { locked: true });
    await dropFocus();
    await view(foundation, { locked: false });
    expect(document.activeElement).toBe(textbox());
  });

  it("does not return focus that had already left the view when the lock began", async () => {
    const { foundation } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    await act(async () => modeButton().focus());
    await dropFocus();
    await view(foundation, { locked: true });
    await view(foundation, { locked: false });
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus where the researcher moved it during a lock", async () => {
    const { foundation } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    await view(foundation, { locked: true });
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    await act(async () => elsewhere.focus());
    await view(foundation, { locked: false });
    expect(document.activeElement).toBe(elsewhere);
  });

  it("does not move focus when a lock is applied or when an unlocked view rerenders", async () => {
    const { foundation } = manuscriptPort();
    await view(foundation);
    await press("Edit");
    await dropFocus();
    await view(foundation, { locked: false });
    expect(document.activeElement).toBe(document.body);
    await view(foundation, { locked: true });
    expect(document.activeElement).toBe(document.body);
  });
});

describe("manuscript drafts", () => {
  it("tracks pending work per draft and refuses discarding a held save request", () => {
    const store = new ManuscriptDrafts();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    const { content } = manuscriptPort();
    const base = content();
    expect([store.pending, store.count, store.canDiscard]).toEqual([false, 0, true]);
    store.set(draftId, { base, document: edited("One.") });
    store.set(id(302), { base, document: edited("Two.") });
    expect([store.pending, store.count, store.canDiscard]).toEqual([true, 2, true]);
    expect(store.get(id(302))?.document).toEqual(edited("Two."));
    expect(listener).toHaveBeenCalledTimes(2);
    const request = {
      operationId: id(900),
      intent: {
        kind: "save" as const,
        draftId,
        expectedRevisionId: id(500),
        saveReason: "manual" as const,
        contentSha256: "0".repeat(64),
      },
      text: "",
    };
    store.set(draftId, { base, document: edited("One."), request });
    expect(store.canDiscard).toBe(false);
    store.discard();
    expect(store.count).toBe(2);
    expect(listener).toHaveBeenCalledTimes(3);
    store.set(draftId, undefined);
    expect([store.count, store.canDiscard, store.get(draftId)]).toEqual([1, true, undefined]);
    store.discard();
    expect([store.pending, store.count]).toEqual([false, 0]);
    expect(listener).toHaveBeenCalledTimes(5);
    stop();
    store.set(draftId, { base, document: edited("Three.") });
    expect(listener).toHaveBeenCalledTimes(5);
  });
});

describe("project manuscript list", () => {
  type Notice = Parameters<Parameters<ProjectCollections["observeMemory"]>[0]>[0];
  function collectionsFor(initial: { subscriptionId?: string; status?: string } = {}) {
    let state = {
      scope: { projectId, conversationId: null },
      status: initial.status ?? "ready",
      researchScopeReady: initial.subscriptionId !== undefined,
      researchSubscriptionId: initial.subscriptionId ?? null,
    };
    const listeners = new Set<() => void>();
    const observers = new Set<(notice: Notice) => void>();
    const history = { snapshot: () => ({ projectId: null }), subscribe: () => () => {} };
    const collections = new ProjectCollections({
      snapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      history,
      switchConversation() {},
      observe: (listener: (notice: Notice) => void) => {
        observers.add(listener);
        return () => observers.delete(listener);
      },
    } as unknown as ConstructorParameters<typeof ProjectCollections>[0]);
    return {
      collections,
      update(next: Partial<typeof state>) {
        state = { ...state, ...next };
        for (const listener of listeners) listener();
      },
      notify(notice: Notice) {
        for (const observer of observers) observer(notice);
      },
    };
  }
  let latest: ReturnType<typeof useManuscripts> | undefined;
  function Probe(props: {
    port: Parameters<typeof useManuscripts>[0];
    collections: ProjectCollections | undefined;
    project: string | undefined;
    enabled: boolean;
    confirmed: boolean;
  }) {
    latest = useManuscripts(
      props.port,
      props.collections,
      props.project,
      props.enabled,
      props.confirmed,
    );
    return null;
  }
  async function probe(props: Parameters<typeof Probe>[0]) {
    await act(async () => root.render(h(Probe, props)));
    await settle();
    return latest!;
  }
  const summary = (n: number) => ({
    draftId: id(n),
    title: `Draft ${String(n)}`,
    currentRevisionId: id(n + 50),
  });

  it("lists every page for the confirmed project scope and reloads on its manuscript changes", async () => {
    const { foundation, port } = manuscriptPort();
    port.listManuscripts.mockImplementation(({ after }) =>
      call({
        ok: true,
        value: {
          projectId,
          manuscripts: after ? [summary(312)] : [summary(311)],
          next: after ? null : id(311),
        },
      }),
    );
    const source = collectionsFor({ subscriptionId: "scope-1" });
    const props = {
      port: foundation,
      collections: source.collections,
      project: projectId,
      enabled: true,
      confirmed: true,
    };
    const result = await probe(props);
    expect(port.listManuscripts.mock.calls.map(([input]) => input)).toEqual([
      { ...scope, after: null },
      { ...scope, after: id(311) },
    ]);
    expect(result.status).toBe("ready");
    expect(result.rows).toEqual([summary(311), summary(312)]);
    expect(result.scope).toEqual(scope);
    expect(result.verifiedScope).toBe(result.scope);
    expect(result.canPresent).toBe(true);

    await act(async () =>
      source.notify({
        ok: true,
        value: { kind: "changed", record: "manuscript", id: id(399), revision: 2 },
      } as Notice),
    );
    expect(port.listManuscripts).toHaveBeenCalledTimes(2);
    await act(async () =>
      source.notify({
        ok: true,
        value: { kind: "changed", record: "manuscript", id: projectId, revision: 3 },
      } as Notice),
    );
    await settle();
    expect(port.listManuscripts).toHaveBeenCalledTimes(4);

    await act(async () => latest!.retry());
    await settle();
    expect(port.listManuscripts).toHaveBeenCalledTimes(6);

    await act(async () => source.update({ researchSubscriptionId: "scope-2" }));
    await settle();
    expect(latest!.scope).toEqual({ projectId, subscriptionId: "scope-2" });
    expect(port.listManuscripts).toHaveBeenLastCalledWith({
      projectId,
      subscriptionId: "scope-2",
      after: id(311),
    });
    expect(latest!.verifiedScope).toEqual({ projectId, subscriptionId: "scope-2" });
  });

  it("reports failed, unavailable and interrupted lists while keeping rows already admitted", async () => {
    const { foundation, port } = manuscriptPort();
    const source = collectionsFor({ subscriptionId: "scope-1" });
    const props = {
      port: foundation,
      collections: source.collections,
      project: projectId,
      enabled: true,
      confirmed: true,
    };
    port.listManuscripts.mockImplementationOnce(() => call(failure("storage_failed")));
    expect((await probe(props)).status).toBe("failed");
    expect(latest!.rows).toEqual([]);
    expect(latest!.canPresent).toBe(false);

    await act(async () => latest!.retry());
    await settle();
    expect(latest!.status).toBe("ready");
    const rows = latest!.rows;
    expect(rows).toHaveLength(1);

    port.listManuscripts.mockImplementationOnce(() => call(failure("project_in_setup")));
    await act(async () => latest!.retry());
    await settle();
    expect(latest!.status).toBe("unavailable");
    expect(latest!.rows).toBe(rows);
    expect(latest!.canPresent).toBe(true);

    port.listManuscripts.mockImplementationOnce(() => ({
      result: Promise.reject(new Error("bridge closed")),
      cancel() {},
    }));
    await act(async () => latest!.retry());
    await settle();
    expect(latest!.status).toBe("failed");
    expect(latest!.rows).toBe(rows);

    const pending = deferred<Outcome<ResearchOutputs["manuscript.list"]>>();
    const cancel = vi.fn();
    port.listManuscripts.mockImplementationOnce(() => ({ result: pending.promise, cancel }));
    await act(async () => latest!.retry());
    expect(latest!.status).toBe("loading");
    await act(async () => root.render(null));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("stays unavailable until the project is enabled, confirmed and its research scope is ready", async () => {
    const { foundation, port } = manuscriptPort();
    const source = collectionsFor({ status: "loading" });
    const base = {
      port: foundation,
      collections: source.collections,
      project: projectId,
      enabled: true,
      confirmed: true,
    };
    expect((await probe({ ...base, enabled: false })).status).toBe("unavailable");
    expect((await probe({ ...base, confirmed: false })).status).toBe("unavailable");
    expect((await probe({ ...base, port: undefined })).status).toBe("unavailable");
    const waiting = await probe(base);
    expect(waiting.status).toBe("loading");
    expect(waiting.scope).toBeUndefined();
    await act(async () => source.update({ status: "failed" }));
    expect(latest!.status).toBe("unavailable");
    expect(port.listManuscripts).not.toHaveBeenCalled();
    expect((await probe({ ...base, collections: undefined })).status).toBe("unavailable");
    expect(latest!.rows).toEqual([]);
  });
});
