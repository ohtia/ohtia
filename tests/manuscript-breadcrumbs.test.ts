// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManuscriptBreadcrumbs } from "../packages/renderer/src/manuscript-breadcrumbs.js";
import {
  foldableBranches,
  manuscriptBranches,
  manuscriptPath,
  manuscriptSubtree,
} from "../packages/renderer/src/manuscript-outline.js";
import { message, type ManuscriptSection } from "../packages/contracts/src/index.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
const section = (id: string, text: string, level: ManuscriptSection["level"], before: number) =>
  ({ id, text, level, beforeParagraph: before }) satisfies ManuscriptSection;
const outline: readonly ManuscriptSection[] = [
  section("intro", "Introducción", 2, 0),
  section("method", "Método", 3, 2),
  section("sample", "Muestra", 4, 4),
  section("ethics", "Ética", 3, 6),
  section("results", "Resultados", 2, 8),
  section("discussion", "Discusión", 2, 10),
];

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(
  props: Partial<{
    headings: readonly ManuscriptSection[];
    current: string | undefined;
    language: string | null;
    onChoose: (id: string) => void;
  }> = {},
) {
  const onChoose = props.onChoose ?? vi.fn();
  const element = () =>
    h(ManuscriptBreadcrumbs, {
      headings: props.headings ?? outline,
      current: "current" in props ? props.current : "sample",
      locale: "en-US",
      language: "language" in props ? (props.language ?? null) : "es-AR",
      onChoose,
    });
  await act(async () => root.render(element()));
  return { onChoose, rerender: () => act(async () => root.render(element())) };
}
const segments = () => [...container.querySelectorAll<HTMLButtonElement>(".manuscript-crumb")];
const segment = (label: string) => {
  const found = segments().find((button) => button.textContent === label);
  if (!found) throw new Error(`Missing segment ${label}`);
  return found;
};
const search = () => container.querySelector<HTMLInputElement>('input[role="combobox"]');
const options = () => [...container.querySelectorAll<HTMLLIElement>('[role="option"]')];
const optionText = () => options().map((option) => option.querySelector("bdi")?.textContent);
const selected = () =>
  options()
    .filter((option) => option.getAttribute("aria-selected") === "true")
    .map((option) => option.querySelector("bdi")?.textContent);
async function press(target: Element, key: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  await act(async () => target.dispatchEvent(event));
  return event;
}
async function click(target: Element) {
  await act(async () => (target as HTMLElement).click());
}
async function type(value: string) {
  const input = search();
  if (!input) throw new Error("Missing search field");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("manuscript breadcrumbs", () => {
  it("shows Manuscript followed by every ancestor of the current heading", async () => {
    await render();
    const nav = container.querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe(message("en-US", "manuscript.location"));
    expect(segments().map((button) => button.textContent)).toEqual([
      message("en-US", "manuscript.collection"),
      "Introducción",
      "Método",
      "Muestra",
    ]);
    expect(segments().map((button) => button.getAttribute("aria-current"))).toEqual([
      null,
      null,
      null,
      "location",
    ]);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });

  it("shows only Manuscript when there is no current heading", async () => {
    await render({ current: undefined });
    expect(segments().map((button) => button.textContent)).toEqual([
      message("en-US", "manuscript.collection"),
    ]);
    expect(segments()[0]?.getAttribute("aria-current")).toBe("location");
  });

  it("shows only Manuscript when the current heading is not in the outline", async () => {
    await render({ current: "missing" });
    expect(segments()).toHaveLength(1);
  });

  it("renders nothing for a manuscript without headings", async () => {
    await render({ headings: [], current: undefined });
    expect(container.querySelector("nav")).toBeNull();
  });

  it("declares the interface locale for Manuscript and the revision language for headings", async () => {
    await render();
    expect(segments().map((button) => button.querySelector("bdi")?.getAttribute("lang"))).toEqual([
      "en-US",
      "es-AR",
      "es-AR",
      "es-AR",
    ]);
    await click(segment(message("en-US", "manuscript.collection")));
    expect(
      options().every((option) => option.querySelector("bdi")?.getAttribute("lang") === "es-AR"),
    ).toBe(true);
  });

  it("declares an unknown revision language as an empty lang on segments and options", async () => {
    await render({ language: null });
    expect(segments().map((button) => button.querySelector("bdi")?.getAttribute("lang"))).toEqual([
      "en-US",
      "",
      "",
      "",
    ]);
    await click(segment("Método"));
    expect(options().map((option) => option.querySelector("bdi")?.getAttribute("lang"))).toEqual([
      "",
      "",
      "",
    ]);
  });

  it("lists every heading in document order with indentation from the Manuscript segment", async () => {
    await render();
    const trigger = segment(message("en-US", "manuscript.collection"));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBeNull();
    await click(trigger);
    const dialog = container.querySelector('[role="dialog"]');
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(dialog?.id);
    expect(dialog?.getAttribute("aria-label")).toBe(message("en-US", "manuscript.collection"));
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(optionText()).toEqual([
      "Introducción",
      "Método",
      "Muestra",
      "Ética",
      "Resultados",
      "Discusión",
    ]);
    expect(
      options().map((option) => option.querySelector('[aria-hidden="true"]')?.textContent?.length),
    ).toEqual([0, 3, 6, 3, 0, 0]);
    expect(document.activeElement).toBe(search());
  });

  it("lists the segment's level and its descendants and marks the current heading active", async () => {
    await render();
    await click(segment("Método"));
    expect(optionText()).toEqual(["Método", "Muestra", "Ética"]);
    expect(selected()).toEqual(["Muestra"]);
    const active = options().find((option) => option.getAttribute("aria-selected") === "true");
    expect(search()?.getAttribute("aria-activedescendant")).toBe(active?.id);
    expect(search()?.getAttribute("aria-controls")).toBe(
      container.querySelector('[role="listbox"]')?.id,
    );
  });

  it("lists a top-level segment's sibling chapters and their descendants", async () => {
    await render({ current: "results" });
    await click(segment("Resultados"));
    expect(optionText()).toEqual([
      "Introducción",
      "Método",
      "Muestra",
      "Ética",
      "Resultados",
      "Discusión",
    ]);
    expect(selected()).toEqual(["Resultados"]);
  });

  it("starts on the first option when there is no current heading", async () => {
    await render({ current: undefined });
    await click(segments()[0] as HTMLButtonElement);
    expect(selected()).toEqual(["Introducción"]);
    expect(search()?.getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
  });

  it("filters choices ignoring case and diacritics", async () => {
    await render();
    await click(segment(message("en-US", "manuscript.collection")));
    await type("  ETICA ");
    expect(optionText()).toEqual(["Ética"]);
    expect(selected()).toEqual(["Ética"]);
    await type("discusion");
    expect(optionText()).toEqual(["Discusión"]);
    await type("");
    expect(optionText()).toHaveLength(6);
    expect(selected()).toEqual(["Introducción"]);
  });

  it("shows an empty list and ignores Enter when nothing matches the filter", async () => {
    const { onChoose } = await render();
    await click(segment(message("en-US", "manuscript.collection")));
    await type("zzz");
    expect(options()).toHaveLength(0);
    expect(search()?.getAttribute("aria-activedescendant")).toBeNull();
    await press(search() as HTMLInputElement, "Enter");
    await press(search() as HTMLInputElement, "ArrowDown");
    expect(onChoose).not.toHaveBeenCalled();
    expect(search()).not.toBeNull();
  });

  it("moves the active option with the up and down arrows and wraps at both ends", async () => {
    await render();
    await click(segment("Método"));
    const input = search() as HTMLInputElement;
    const down = await press(input, "ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    expect(selected()).toEqual(["Ética"]);
    await press(input, "ArrowDown");
    expect(selected()).toEqual(["Método"]);
    await press(input, "ArrowUp");
    expect(selected()).toEqual(["Ética"]);
    await press(input, "ArrowUp");
    await press(input, "ArrowUp");
    expect(selected()).toEqual(["Método"]);
  });

  it("scrolls the active option into view when it changes", async () => {
    const scrolled: string[] = [];
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.textContent.trim());
    };
    try {
      await render();
      await click(segment("Método"));
      await press(search() as HTMLInputElement, "ArrowDown");
      expect(scrolled).toEqual(["Muestra", "Ética"]);
    } finally {
      if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original);
      else delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("chooses the active heading with Enter and closes the picker", async () => {
    const { onChoose } = await render();
    await click(segment("Método"));
    await press(search() as HTMLInputElement, "ArrowDown");
    const enter = await press(search() as HTMLInputElement, "Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("ethics");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("ignores picker keys while an input method is composing", async () => {
    const { onChoose } = await render();
    await click(segment("Método"));
    await press(search() as HTMLInputElement, "Enter", { isComposing: true });
    await press(search() as HTMLInputElement, "Escape", { isComposing: true });
    expect(onChoose).not.toHaveBeenCalled();
    expect(search()).not.toBeNull();
  });

  it("closes with Escape and returns focus to the segment", async () => {
    const { onChoose } = await render();
    const trigger = segment("Método");
    await click(trigger);
    const escape = await press(search() as HTMLInputElement, "Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("chooses a heading by clicking its option without moving focus on pointer down", async () => {
    const { onChoose } = await render();
    await click(segment(message("en-US", "manuscript.collection")));
    const option = options()[4] as HTMLLIElement;
    const down = new Event("pointerdown", { bubbles: true, cancelable: true });
    await act(async () => option.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    expect(search()).not.toBeNull();
    await click(option);
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("results");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("toggles the picker closed when its segment is clicked again", async () => {
    await render();
    const trigger = segment("Introducción");
    await click(trigger);
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await click(trigger);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens only one picker at a time", async () => {
    await render();
    await click(segment("Introducción"));
    await click(segment("Muestra"));
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(segment("Introducción").getAttribute("aria-expanded")).toBe("false");
    expect(segment("Muestra").getAttribute("aria-expanded")).toBe("true");
    expect(optionText()).toEqual(["Muestra"]);
  });

  it("opens a closed segment's picker with the down or up arrow", async () => {
    await render();
    const trigger = segment("Introducción");
    const down = await press(trigger, "ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await press(search() as HTMLInputElement, "Escape");
    await press(trigger, "ArrowUp");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await press(search() as HTMLInputElement, "Escape");
    const other = await press(trigger, "Enter");
    expect(other.defaultPrevented).toBe(false);
  });

  it("dismisses the picker on pointer down outside the breadcrumbs", async () => {
    await render();
    await click(segment("Introducción"));
    await act(async () =>
      container
        .querySelector('[role="listbox"]')
        ?.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("stops listening for outside pointer down once the picker closes", async () => {
    const remove = vi.spyOn(document, "removeEventListener");
    await render();
    await click(segment("Introducción"));
    await press(search() as HTMLInputElement, "Escape");
    expect(remove.mock.calls.some(([type]) => type === "pointerdown")).toBe(true);
  });

  it("closes the picker when focus leaves the breadcrumbs", async () => {
    await render();
    const outside = document.createElement("button");
    document.body.append(outside);
    await click(segment("Introducción"));
    await act(async () => segment("Método").focus());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => outside.focus());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("moves focus between segments with the left and right arrows", async () => {
    await render();
    const [first, second, third, last] = segments() as [
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLButtonElement,
    ];
    first.focus();
    const right = await press(first, "ArrowRight");
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(second);
    await press(second, "ArrowRight");
    await press(third, "ArrowRight");
    expect(document.activeElement).toBe(last);
    const end = await press(last, "ArrowRight");
    expect(end.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(last);
    await press(last, "ArrowLeft");
    expect(document.activeElement).toBe(third);
    first.focus();
    const start = await press(first, "ArrowLeft");
    expect(start.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("reverses segment arrows in a right-to-left layout", async () => {
    await render();
    const nav = container.querySelector("nav") as HTMLElement;
    nav.style.direction = "rtl";
    const [first, second] = segments() as [HTMLButtonElement, HTMLButtonElement];
    first.focus();
    await press(first, "ArrowLeft");
    expect(document.activeElement).toBe(second);
    await press(second, "ArrowRight");
    expect(document.activeElement).toBe(first);
  });

  it("ignores segment arrows with modifiers", async () => {
    await render();
    const [first] = segments() as [HTMLButtonElement];
    first.focus();
    for (const modifier of ["altKey", "ctrlKey", "metaKey", "isComposing"] as const) {
      const event = await press(first, "ArrowRight", { [modifier]: true });
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(first);
    }
  });

  it("moves an open picker to the neighbouring segment from an empty search field", async () => {
    await render();
    await click(segment("Método"));
    await press(search() as HTMLInputElement, "ArrowLeft");
    expect(segment("Método").getAttribute("aria-expanded")).toBe("false");
    expect(segment("Introducción").getAttribute("aria-expanded")).toBe("true");
    expect(optionText()).toEqual([
      "Introducción",
      "Método",
      "Muestra",
      "Ética",
      "Resultados",
      "Discusión",
    ]);
    expect(document.activeElement).toBe(search());
    await press(search() as HTMLInputElement, "ArrowRight");
    expect(segment("Método").getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps left and right arrows for text editing in a search field with a query", async () => {
    await render();
    await click(segment("Método"));
    await type("mu");
    const event = await press(search() as HTMLInputElement, "ArrowLeft");
    expect(event.defaultPrevented).toBe(false);
    expect(segment("Método").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(search());
  });

  it("ignores other keys on the breadcrumb navigation", async () => {
    await render();
    const [first] = segments() as [HTMLButtonElement];
    first.focus();
    const event = await press(first, "Home");
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first);
  });

  it("ignores segment arrows from outside any segment", async () => {
    await render();
    const list = container.querySelector("nav ol") as HTMLElement;
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      const event = await press(list, key);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("updates the path when the current heading changes", async () => {
    const onChoose = vi.fn();
    await render({ current: "sample", onChoose });
    await render({ current: "discussion", onChoose });
    expect(segments().map((button) => button.textContent)).toEqual([
      message("en-US", "manuscript.collection"),
      "Discusión",
    ]);
  });
});

describe("manuscript outline", () => {
  it("nests headings by level and keeps document order", () => {
    const branches = manuscriptBranches(outline);
    expect(branches.map(({ heading }) => heading.id)).toEqual(["intro", "results", "discussion"]);
    expect(branches[0]?.children.map(({ heading }) => heading.id)).toEqual(["method", "ethics"]);
    expect(branches[0]?.children[0]?.children.map(({ heading }) => heading.id)).toEqual(["sample"]);
    expect(manuscriptSubtree(branches).map(({ heading, depth }) => [heading.id, depth])).toEqual([
      ["intro", 0],
      ["method", 1],
      ["sample", 2],
      ["ethics", 1],
      ["results", 0],
      ["discussion", 0],
    ]);
  });

  it("returns the path to a heading with each level's siblings", () => {
    const branches = manuscriptBranches(outline);
    const path = manuscriptPath(branches, "sample");
    expect(path.map(({ heading }) => heading.id)).toEqual(["intro", "method", "sample"]);
    expect(path[0]?.siblings).toBe(branches);
    expect(path[1]?.siblings.map(({ heading }) => heading.id)).toEqual(["method", "ethics"]);
    expect(manuscriptPath(branches, "missing")).toEqual([]);
  });

  it("treats a heading deeper than its predecessor's child level as that predecessor's child", () => {
    const branches = manuscriptBranches([
      section("a", "A", 4, 0),
      section("b", "B", 2, 1),
      section("c", "C", 5, 2),
    ]);
    expect(branches.map(({ heading }) => heading.id)).toEqual(["a", "b"]);
    expect(branches[1]?.children.map(({ heading }) => heading.id)).toEqual(["c"]);
  });

  it("lists every heading with children as foldable in document order", () => {
    expect(foldableBranches(manuscriptBranches(outline))).toEqual(["intro", "method"]);
  });

  it("lists no foldable headings for a flat outline", () => {
    const flat = [section("a", "A", 2, 0), section("b", "B", 2, 1), section("c", "C", 3, 2)];
    expect(foldableBranches(manuscriptBranches(flat.slice(0, 2)))).toEqual([]);
    expect(foldableBranches(manuscriptBranches([]))).toEqual([]);
    expect(foldableBranches(manuscriptBranches(flat))).toEqual(["b"]);
  });
});
