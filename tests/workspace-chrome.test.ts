// @vitest-environment jsdom
import { createHash, randomUUID } from "node:crypto";
import { TextEncoder as NodeTextEncoder } from "node:util";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "../packages/renderer/src/workspace.js";
import { WorkspaceChrome } from "../packages/renderer/src/workspace-chrome.js";
import { ProjectExplorer } from "../packages/renderer/src/project-explorer.js";
import type { useManuscripts } from "../packages/renderer/src/manuscript-view.js";
import { CommandController } from "../packages/renderer/src/command-controller.js";
import { ProjectCollections } from "../packages/renderer/src/project-controller.js";
import { ConversationController } from "../packages/renderer/src/conversation-controller.js";
import { LayoutPreferences } from "../packages/renderer/src/layout-preferences.js";
import {
  commandDefinitions,
  failure,
  message,
  type FoundationPort,
  type ProjectRecord,
  type ManuscriptCloseCommand,
  type ManuscriptLockRequest,
  type ManuscriptRevision,
  type ManuscriptWriteResult,
  type LayoutChange,
  type LayoutRecord,
  type SavedLayoutRecord,
  type Outcome,
} from "../packages/contracts/src/index.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement, commands: CommandController;
let width: number, coarse: boolean;
let observers: { target?: Element; callback: () => void; disconnect: ReturnType<typeof vi.fn> }[];
let mediaListeners: Set<() => void>;
const call = <T>(value: T) => ({ result: Promise.resolve(value), cancel() {} });
function store(initial?: LayoutRecord) {
  let record: LayoutRecord = initial ?? {
    schemaVersion: 1,
    revision: 0,
    source: "missing",
    value: null,
  };
  const saved: LayoutChange[] = [];
  let outcome: Outcome<SavedLayoutRecord> | undefined;
  let claimed = false;
  const announce = vi.fn();
  const port: Pick<
    FoundationPort,
    "readLayout" | "replaceLayout" | "readLayoutReceipt" | "claimLayoutFailureNotice"
  > = {
    readLayout: vi.fn(() => call({ ok: true as const, value: record })),
    replaceLayout: vi.fn((change) => {
      saved.push(change);
      record = {
        schemaVersion: 1,
        revision: record.revision + 1,
        source: "saved",
        value: change.value,
      };
      return call(outcome ?? { ok: true as const, value: record as SavedLayoutRecord });
    }),
    readLayoutReceipt: vi.fn(() =>
      call({ ok: true as const, value: { state: "not_found" as const } }),
    ),
    claimLayoutFailureNotice: vi.fn(() => {
      const announce = !claimed;
      claimed = true;
      return call({ ok: true as const, value: { announce } });
    }),
  };
  const preferences = new LayoutPreferences(port, () => `operation-${saved.length}`, announce);
  return {
    port,
    preferences,
    saved,
    announce,
    fail: (value: Outcome<SavedLayoutRecord>) => {
      outcome = value;
    },
  };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  width = 1280;
  coarse = false;
  observers = [];
  mediaListeners = new Set();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("workspace") ? width : 128;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, 0, this.classList.contains("workspace") ? width : 128, 800);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      constructor(readonly callback: () => void) {
        observers.push(this);
      }
      target?: Element;
      observe(target: Element) {
        this.target = target;
      }
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return coarse;
      },
      addEventListener: (_: string, cb: () => void) => mediaListeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => mediaListeners.delete(cb),
    })),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  commands = new CommandController(
    { windowGeneration: "chrome-window", platform: "linux" },
    "en-US",
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  commands.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(
  preferences: LayoutPreferences,
  extra: Partial<Parameters<typeof WorkspaceChrome>[0]> = {},
) {
  await act(async () =>
    root.render(
      h(WorkspaceChrome, {
        preferences,
        commands,
        locale: "en-US",
        windowInsets: { start: 0, end: 0 },
        ...extra,
      }),
    ),
  );
}
function button(name: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
}
async function click(name: string) {
  await act(async () =>
    (
      button(name) ??
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (node) => node.textContent === name,
      )!
    ).click(),
  );
}
async function invoke(id: Parameters<CommandController["invoke"]>[0]) {
  await act(async () => {
    await commands.invoke(id);
  });
}
async function viewport(value: number) {
  width = value;
  await act(async () =>
    observers.find((item) => item.target?.classList.contains("workspace"))!.callback(),
  );
}
function widths() {
  return [...container.querySelectorAll<HTMLElement>("[data-workspace-panel]")]
    .filter((p) => !p.hidden)
    .map((p) => Number.parseInt(p.style.inlineSize));
}
function splitter(index = 0) {
  return container.querySelectorAll<HTMLElement>("[role=separator]")[index]!;
}
async function key(element: HTMLElement, key: string, shiftKey = false, isComposing = false) {
  await act(async () =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, isComposing, bubbles: true }),
    ),
  );
}

describe("workspace chrome composition", () => {
  it("renders truthful first-run states, fixed Navigator, command names and real availability", async () => {
    const { preferences } = store();
    await render(preferences);
    expect(widths()).toEqual([256, 656, 360]);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.textContent).toContain("No project open");
    expect(container.textContent).toContain(message("en-US", "workspace.chatEmpty"));
    expect(container.querySelector("textarea, input, [role=combobox]")).toBeNull();
    expect(container.querySelector("[role=tab]")?.getAttribute("aria-selected")).toBe("true");
    expect(button("Open Settings").getAttribute("aria-disabled")).toBe("true");
    expect(button("Hide chat").getAttribute("aria-keyshortcuts")).toBe("Control+Shift+3");
    expect(button("Application menu").getAttribute("aria-haspopup")).toBe("menu");
    expect(button("Application menu").getAttribute("aria-keyshortcuts")).toBe("F10");
    expect(
      [...container.querySelectorAll("button")].some((b) => b.textContent === "Reset layout"),
    ).toBe(false);
    const settings = vi.fn(() => true);
    let stop!: () => void;
    await act(async () => {
      stop = commands.register("settings.open", { state: () => ({}), run: settings });
    });
    await act(async () => commands.changed());
    await click("Open Settings");
    expect(settings).toHaveBeenCalledOnce();
    await act(async () => stop());
  });
  it("keeps only Settings with its shortcut hint in the explorer footer, with or without a project", async () => {
    const { preferences } = store();
    const footer = () => {
      const node = container.querySelector(".workspace-explorer-footer")!;
      return {
        commands: [...node.querySelectorAll<HTMLButtonElement>("button")].map(
          (control) => control.dataset.workspaceCommand,
        ),
        hints: [...node.querySelectorAll("kbd")].map((key) => key.textContent),
      };
    };
    const hint = commandDefinitions.find((entry) => entry.id === "settings.open")!.shortcuts[
      commands.context.platform
    ][0];
    await render(preferences);
    expect(footer()).toEqual({ commands: ["settings.open"], hints: [hint] });
    const date = "2026-11-27T10:00:00.000Z";
    await render(preferences, {
      projectScope: "019a8000-0000-7000-8000-000000000445",
      project: {
        id: "019a8000-0000-7000-8000-000000000445",
        projectType: "thesis",
        title: "Thesis",
        documentLanguage: "en-US",
        subtitle: null,
        titleRevision: 1,
        setupConfirmedAt: date,
        isDevelopment: false,
        createdAt: date,
        updatedAt: date,
        lastOpenedAt: date,
      },
    });
    expect(container.textContent).not.toContain("No project open");
    expect(footer()).toEqual({ commands: ["settings.open"], hints: [hint] });
    expect(container.querySelector('[data-workspace-command="help.open"]')).toBeNull();
  });
  it("preserves mounted panels, scroll and focus across hide/reopen, focus mode and narrow reflow", async () => {
    const { preferences, saved } = store();
    await render(preferences);
    const chat = container.querySelector<HTMLElement>(".workspace-chat")!;
    const scroll = chat.querySelector<HTMLElement>(".workspace-panel-scroll")!;
    scroll.scrollTop = 70;
    await act(async () => scroll.focus());
    await invoke("panels.chat");
    expect(chat.hidden).toBe(true);
    expect(chat.hasAttribute("inert")).toBe(true);
    expect(button("Open chat")).toBe(document.activeElement);
    await invoke("panels.chat");
    expect(chat).toBe(container.querySelector(".workspace-chat"));
    expect(scroll.scrollTop).toBe(70);
    expect(chat.querySelector("h2")).toBe(document.activeElement);
    const writes = saved.length;
    await invoke("document.focus");
    expect(widths()).toEqual([1240]);
    expect(button("Return to previous layout")).toBe(document.activeElement);
    await invoke("document.focus");
    expect(widths()).toEqual([256, 656, 360]);
    expect(saved).toHaveLength(writes);
    await act(async () => scroll.focus());
    await viewport(600);
    expect(commands.entry("document.focus").reason).toBe("wide_layout");
    expect(widths()).toEqual([600]);
    expect(chat.hidden).toBe(false);
    expect(container.querySelector(".workspace-rail")).toBeNull();
    expect(container.querySelector("[role=separator]")).toBeNull();
    await click("Documents");
    expect(container.querySelector(".workspace-documents h2")).toBe(document.activeElement);
    await viewport(1280);
    expect(widths()).toEqual([256, 656, 360]);
    expect(saved).toHaveLength(writes);
    await act(async () => button("Hide chat").focus());
    await viewport(600);
    expect(button("Chat")).toBe(document.activeElement);
    await viewport(1280);
    expect(button("Hide chat")).toBe(document.activeElement);
    await act(async () => button("Expand document").focus());
    await viewport(600);
    expect(button("Documents")).toBe(document.activeElement);
    await act(async () => button("Settings…").focus());
    await viewport(1280);
    expect(
      container.querySelector(
        '.workspace-explorer-footer [data-workspace-command="settings.open"]',
      ),
    ).toBe(document.activeElement);
  });
  it("enforces the last-panel rule, reset and seven visibility combinations without disposing content", async () => {
    const { preferences } = store();
    await render(preferences);
    for (const mask of [1, 2, 3, 4, 5, 6, 7]) {
      await invoke("layout.reset");
      for (const [index, panel] of (["explorer", "documents", "chat"] as const).entries())
        if (!(mask & (1 << index))) await invoke(`panels.${panel}`);
      expect(
        [...container.querySelectorAll("h1")].filter((node) => !node.closest("[hidden], [inert]")),
      ).toHaveLength(1);
      expect(container.querySelectorAll("[data-workspace-panel]:not([hidden])").length).toBe(
        mask.toString(2).split("1").length - 1,
      );
    }
    await invoke("document.focus");
    expect(button("Hide documents").getAttribute("aria-disabled")).toBe("true");
    await click("Hide documents");
    expect(container.querySelector(".workspace-attention")?.textContent).toContain(
      "At least one panel",
    );
    await invoke("panels.explorer");
    expect(button("Expand document")).toBeTruthy();
    await viewport(320);
    await click("Chat");
    await invoke("layout.reset");
    expect(container.querySelector(".workspace-documents")?.hasAttribute("hidden")).toBe(false);
  });
  it("binds separator values, width alternatives and the documented Enter/double-click pair reset", async () => {
    const { preferences, saved } = store();
    await render(preferences);
    await key(splitter(1), "ArrowLeft");
    expect(widths()).toEqual([256, 640, 376]);
    await key(splitter(1), "ArrowLeft", true);
    expect(widths()).toEqual([256, 576, 440]);
    await key(splitter(1), "Home");
    expect(widths()).toEqual([256, 320, 696]);
    await key(splitter(1), "End");
    expect(widths()).toEqual([256, 736, 280]);
    expect(splitter(1).getAttribute("aria-valuetext")).toContain("Documents 736 px, Chat 280 px");
    await key(splitter(1), "Enter");
    expect(widths()).toEqual([256, 656, 360]);
    await click("Reduce width of Documents");
    expect(widths()).toEqual([256, 640, 376]);
    await act(async () => splitter(1).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(widths()).toEqual([256, 656, 360]);
    const count = saved.length;
    await key(splitter(), "ArrowRight", false, true);
    expect(saved).toHaveLength(count);
    await viewport(1024);
    await invoke("layout.reset");
    await key(splitter(), "End");
    expect(widths()).toEqual([416, 320, 280]);
    await key(splitter(), "Enter");
    expect(widths()).toEqual([200, 536, 280]);
    await click("Increase width of Chat");
    expect(widths()).toEqual([200, 520, 296]);
    await click("Reduce width of Project contents");
    expect(widths()).toEqual([200, 520, 296]);
    coarse = true;
    await viewport(1280);
    await invoke("document.focus");
    expect(container.querySelector<HTMLElement>(".workspace-rail")?.style.inlineSize).toBe("48px");
  });
  it("keeps no-project text and controls through locale/theme/decoration changes and controlled zoom", async () => {
    const { preferences, saved } = store();
    await render(preferences);
    const panel = container.querySelector(".workspace-documents");
    document.documentElement.dataset.appearance = "dark";
    await render(preferences, {
      locale: "ko-KR",
      decoration: "hidden",
      zoom: 125,
      windowInsets: { start: 12, end: 138 },
    });
    expect(container.querySelector(".workspace").getAttribute("lang")).toBe("ko-KR");
    expect(container.querySelector(".about-character")).toBeNull();
    expect(container.querySelector(".workspace-documents")).toBe(panel);
    expect(container.textContent).toContain("125%");
    expect(saved).toHaveLength(0);
    commands.dispose();
    commands = new CommandController({ windowGeneration: "mac", platform: "darwin" }, "en-US");
    await render(preferences, { windowInsets: { start: 76, end: 0 } });
    expect(container.querySelector('[aria-label="Application menu"]')).toBeNull();
    expect(
      container.querySelector<HTMLElement>(".workspace-title-row")?.style.marginInlineStart,
    ).toContain("76px");
    await render(preferences, { zoom: 100 });
    expect(container.querySelector('[aria-label^="Interface zoom"]')).toBeNull();
  });
  it("retains visible focus when zoom, separators and sizing controls disappear", async () => {
    const { preferences } = store();
    await render(preferences, { zoom: 125 });
    const zoom = container.querySelector<HTMLButtonElement>(
      '[data-workspace-command="zoom.reset"]',
    )!;
    await act(async () => zoom.focus());
    await render(preferences, { zoom: 100 });
    expect(button("Fold project contents")).toBe(document.activeElement);
    await render(preferences, { zoom: 125 });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-workspace-command="zoom.reset"]')!.focus(),
    );
    await viewport(600);
    expect(
      container.querySelector('.workspace-narrow-row [data-workspace-command="zoom.reset"]'),
    ).toBe(document.activeElement);
    await viewport(1280);
    await act(async () => splitter(1).focus());
    await viewport(600);
    expect(button("Documents")).toBe(document.activeElement);
    await viewport(1280);
    await act(async () => splitter().focus());
    await invoke("panels.explorer");
    expect(button("Open project contents")).toBe(document.activeElement);
    await invoke("panels.explorer");
    await act(async () => button("Increase width of Documents").focus());
    await viewport(600);
    expect(button("Documents")).toBe(document.activeElement);
  });
  it("preserves welcome focus, floors fractional widths and clears obsolete last-panel feedback", async () => {
    const { preferences } = store();
    await render(preferences);
    const welcome = container.querySelector<HTMLButtonElement>(
      '.workspace-welcome [data-workspace-command="settings.open"]',
    )!;
    await act(async () => welcome.focus());
    await viewport(1023.64);
    expect(container.querySelector(".workspace")?.getAttribute("data-mode")).toBe("narrow");
    expect(widths()).toEqual([1023]);
    expect(document.activeElement).toBe(welcome);
    await viewport(1280);
    expect(document.activeElement).toBe(welcome);
    await invoke("document.focus");
    await click("Hide documents");
    expect(container.querySelector(".workspace-attention")).not.toBeNull();
    await invoke("document.focus");
    expect(container.querySelector(".workspace-attention")).toBeNull();
    await invoke("document.focus");
    await click("Hide documents");
    await viewport(600);
    expect(container.querySelector(".workspace-attention")).toBeNull();
    for (const name of ["Contents", "Chat", "Documents"]) {
      await click(name);
      const headings = [...container.querySelectorAll("h1")].filter(
        (node) => !node.closest("[hidden], [inert]"),
      );
      expect(headings).toHaveLength(1);
      await act(async () => container.querySelector<HTMLAnchorElement>(".workspace-skip")!.click());
      expect(document.activeElement?.tagName).toBe("H2");
      expect(document.activeElement?.closest("[hidden], [inert]")).toBeNull();
    }
  });
  it("retains rail control focus through registry reset without a mode change", async () => {
    const { preferences } = store();
    await render(preferences);
    await invoke("document.focus");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '.workspace-rail [data-workspace-command="settings.open"]',
        )!
        .focus(),
    );
    await invoke("layout.reset");
    expect(
      container.querySelector(
        '.workspace-explorer-footer [data-workspace-command="settings.open"]',
      ),
    ).toBe(document.activeElement);
    await invoke("panels.explorer");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '.workspace-rail [data-workspace-command="panels.explorer"]',
        )!
        .focus(),
    );
    await invoke("layout.reset");
    expect(button("Fold project contents")).toBe(document.activeElement);
  });
  it("exposes layout failure, uncertainty and original-receipt reconciliation without resubmission", async () => {
    const { preferences, fail, port, saved, announce } = store();
    fail(failure("uncertain"));
    await render(preferences);
    await invoke("panels.chat");
    expect(container.textContent).toContain("not yet known");
    expect(splitter().getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(splitter().getAttribute("aria-describedby")!)?.textContent).toBe(
      message("en-US", "command.reason.busy"),
    );
    const size = button("Increase width of Documents");
    expect(document.getElementById(size.getAttribute("aria-describedby")!)?.textContent).toBe(
      message("en-US", "command.reason.busy"),
    );
    await click("Check"); // Check is a native text button, not a command control.
    expect(port.readLayoutReceipt).toHaveBeenCalledOnce();
    expect(saved).toHaveLength(1);
    expect(announce).not.toHaveBeenCalled();
  });
  it("does not steal modal focus or react to late initialization after disposal", async () => {
    const first = store();
    let resolve!: (value: Outcome<LayoutRecord>) => void;
    vi.mocked(first.port.readLayout).mockReturnValue({
      result: new Promise((done) => {
        resolve = done;
      }),
      cancel() {},
    });
    await render(first.preferences);
    const dialog = document.createElement("dialog");
    dialog.open = true;
    const input = document.createElement("input");
    dialog.append(input);
    document.body.append(dialog);
    input.focus();
    await viewport(600);
    expect(document.activeElement).toBe(input);
    const second = store();
    await render(second.preferences);
    await act(async () =>
      resolve({
        ok: true,
        value: {
          schemaVersion: 1,
          revision: 1,
          source: "saved",
          value: {
            version: 1,
            visible: { explorer: true, documents: false, chat: false },
            preferredWidths: { explorer: 256, documents: 656, chat: 360 },
          },
        },
      }),
    );
    expect(container.querySelector(".workspace-documents")?.hasAttribute("hidden")).toBe(false);
    expect(
      observers.filter((item) => item.target?.classList.contains("workspace"))[0]!.disconnect,
    ).toHaveBeenCalled();
    dialog.remove();
    const composingField = document.createElement("input");
    container.querySelector(".workspace-documents")!.append(composingField);
    await act(async () =>
      composingField.dispatchEvent(new Event("compositionstart", { bubbles: true })),
    );
    expect(commands.entry("panels.chat").reason).toBe("composing");
    await act(async () => composingField.remove());
    expect(commands.entry("panels.chat").reason).toBeUndefined();

    await act(async () => document.dispatchEvent(new Event("compositionstart", { bubbles: true })));
    expect((await commands.invoke("panels.chat")).status).toBe("unavailable");
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(commands.entry("panels.chat").reason).toBeUndefined();
  });
});

async function pointer(element: HTMLElement, type: string, x: number, id = 1, primary = true) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: primary } });
  await act(async () => element.dispatchEvent(event));
}
it("captures only the initiating pointer and releases locks on every cancellation route", async () => {
  const { preferences, saved } = store();
  await render(preferences);
  let captured: number | undefined;
  HTMLElement.prototype.setPointerCapture = vi.fn((id: number) => {
    captured = id;
  });
  HTMLElement.prototype.hasPointerCapture = vi.fn((id: number) => captured === id);
  HTMLElement.prototype.releasePointerCapture = vi.fn(() => {
    captured = undefined;
  });
  document.body.style.cursor = "crosshair";
  document.body.style.userSelect = "text";
  await pointer(splitter(), "pointerdown", 256, 2, false);
  expect(captured).toBeUndefined();
  for (const route of [
    "escape",
    "pointercancel",
    "blur",
    "window-blur",
    "viewport",
    "visibility",
    "lostcapture",
  ]) {
    const target = splitter();
    const count = saved.length;
    await pointer(target, "pointerdown", 256);
    await pointer(target, "pointermove", 300, 9);
    expect(widths()).toEqual([256, 656, 360]);
    await pointer(target, "pointermove", 300);
    expect(widths()).toEqual([300, 612, 360]);
    expect(document.body.style.userSelect).toBe("none");
    if (route === "escape") await key(target, "Escape");
    else if (route === "viewport") await viewport(1280);
    else if (route === "visibility") {
      await invoke("document.focus");
      await invoke("document.focus");
    } else if (route === "window-blur")
      await act(async () => window.dispatchEvent(new Event("blur")));
    else if (route === "blur")
      await act(async () => target.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    else
      await pointer(target, route === "lostcapture" ? "lostpointercapture" : "pointercancel", 300);
    expect(widths(), route).toEqual([256, 656, 360]);
    expect(saved).toHaveLength(count);
    expect(captured).toBeUndefined();
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
  }
  await pointer(splitter(), "pointerdown", 256);
  await pointer(splitter(), "pointermove", 288);
  await pointer(splitter(), "pointerup", 288, 9);
  expect(saved).toHaveLength(0);
  await pointer(splitter(), "pointerup", 288);
  expect(widths()).toEqual([288, 624, 360]);
  expect(saved).toHaveLength(1);
  await pointer(splitter(), "pointerdown", 288);
  await pointer(splitter(), "pointermove", 310);
  await act(async () => root.unmount());
  expect(captured).toBeUndefined();
  expect(document.body.style.userSelect).toBe("text");
  root = createRoot(container);
});
it("keeps a drag started on either separator while focus leaves the other one", async () => {
  const { preferences, saved } = store();
  await render(preferences);
  let captured: number | undefined;
  HTMLElement.prototype.setPointerCapture = vi.fn((id: number) => {
    captured = id;
  });
  HTMLElement.prototype.hasPointerCapture = vi.fn((id: number) => captured === id);
  HTMLElement.prototype.releasePointerCapture = vi.fn(() => {
    captured = undefined;
  });
  const order: string[] = [];
  for (const index of [0, 1]) {
    splitter(index).addEventListener("pointerdown", () => order.push(`pointerdown:${index}`));
    splitter(index).addEventListener("focusout", () => order.push(`focusout:${index}`));
    splitter(index).addEventListener("focusin", () => order.push(`focusin:${index}`));
  }
  const drags: [number, number, number, number[]][] = [
    [1, 0, 256, [240, 672, 360]],
    [0, 1, 912, [240, 656, 376]],
  ];
  for (const [focused, dragged, x, expected] of drags) {
    act(() => splitter(focused).focus());
    order.length = 0;
    await pointer(splitter(dragged), "pointerdown", x);
    expect(order).toEqual([`pointerdown:${dragged}`, `focusout:${focused}`, `focusin:${dragged}`]);
    expect(document.activeElement).toBe(splitter(dragged));
    expect(captured).toBe(1);
    expect(document.body.style.userSelect).toBe("none");
    await pointer(splitter(dragged), "pointermove", x - 16);
    expect(widths()).toEqual(expected);
    await pointer(splitter(dragged), "pointerup", x - 16);
    expect(widths()).toEqual(expected);
    expect(captured).toBeUndefined();
  }
  expect(saved).toHaveLength(2);
  await pointer(splitter(0), "pointerdown", 240);
  await pointer(splitter(0), "pointermove", 270);
  expect(widths()).toEqual([270, 626, 376]);
  act(() => splitter(1).focus());
  expect(widths()).toEqual([240, 656, 376]);
  expect(captured).toBeUndefined();
  expect(document.body.style.userSelect).not.toBe("none");
  expect(saved).toHaveLength(2);
});
it("composes real registry surfaces and announces failed layout persistence once through the shared claim", async () => {
  const { port, fail, saved } = store();
  fail(failure("service_unavailable"));
  const stop = vi.fn();
  const bridge = {
    context: async () => ({ windowGeneration: "window-composition", platform: "linux" as const }),
    publish: async () => true,
    readExitState: async () => null,
    onExitState: () => () => {},
    chooseExit: async () => true,
    onIntent: () => stop,
    about: async () => {
      throw new Error("Synthetic unavailable metadata");
    },
    windowAction: async () => ({ status: "unavailable", reason: "handler_missing" }),
    perform: async () => false,
    copyVersionInformation: async () => false,
    openLink: async () => false,
  };
  await act(async () =>
    root.render(
      h(Workspace, {
        port: port as FoundationPort,
        commandBridge: bridge,
        locale: "en-US",
        windowInsets: { start: 0, end: 0 },
      }),
    ),
  );
  expect(document.documentElement.lang).toBe("en-US");
  await click("Hide chat");
  expect(container.querySelector(".workspace-danger")?.textContent).toContain(
    "could not be remembered",
  );
  await click("Dismiss");
  expect(container.querySelector(".workspace-danger")).toBeNull();
  await click("Open chat");
  expect(container.querySelector(".workspace-danger")).toBeNull();
  expect(saved).toHaveLength(2);
  await click("About Ohtia");
  expect(container.querySelector("dialog[open]")?.textContent).toContain(
    message("en-US", "about.loadFailed"),
  );
  await act(async () => root.unmount());
  expect(stop).toHaveBeenCalledOnce();
  root = createRoot(container);
});

it("places chat width actions beside its heading before content and preserves resizing across narrow reflow", async () => {
  const { preferences, saved } = store();
  await render(preferences, { chat: h("p", null, "Synthetic conversation") });
  const panel = container.querySelector<HTMLElement>(".workspace-chat")!;
  const heading = panel.querySelector<HTMLElement>(".workspace-chat-heading")!;
  const scroll = panel.querySelector<HTMLElement>(".workspace-panel-scroll")!;
  expect(heading.querySelectorAll("[data-workspace-size=chat]")).toHaveLength(2);
  expect(panel.querySelector(":scope > .workspace-sizing")).toBeNull();
  expect(heading.compareDocumentPosition(scroll) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  await click(
    message("en-US", "workspace.increase", { panel: message("en-US", "command.panels.chat") }),
  );
  expect(widths()).toEqual([256, 640, 376]);
  expect(saved).toHaveLength(1);
  await viewport(320);
  expect(panel.querySelectorAll("[data-workspace-size=chat]")).toHaveLength(0);
  await viewport(1280);
  expect(heading.querySelectorAll("[data-workspace-size=chat]")).toHaveLength(2);
});

it("keeps hidden chat and layout preferences unchanged when switching existing projects", async () => {
  const { preferences, saved } = store();
  const focus = vi.fn();
  await render(preferences, {
    projectScope: "A",
    revealProjectChat: false,
    onComposerFocus: focus,
  });
  await invoke("panels.chat");
  const writes = saved.length;
  await render(preferences, {
    projectScope: "B",
    revealProjectChat: false,
    onComposerFocus: focus,
  });
  await render(preferences, {
    projectScope: "A",
    revealProjectChat: false,
    onComposerFocus: focus,
  });
  expect(container.querySelector<HTMLElement>(".workspace-chat")!.hidden).toBe(true);
  expect(saved).toHaveLength(writes);
  expect(focus).not.toHaveBeenCalled();
});

it("opens one fixed project memory tab and preserves manual tab activation", async () => {
  const settings = store();
  const projectScope = "019a8000-0000-7000-8000-000000000235";
  const props = {
    projectScope,
    chat: h("p", null, "Current conversation"),
    memory: h("p", null, "Saved memory"),
  };
  await render(settings.preferences, props);
  expect(container.querySelectorAll("[role=tab]")).toHaveLength(1);
  await click("Project memory");
  const memoryTab = container.querySelector<HTMLButtonElement>("[role=tab][aria-selected=true]")!;
  expect(memoryTab.textContent).toBe("Project memory");
  expect(document.activeElement).toBe(memoryTab);
  const navigator = container.querySelector<HTMLButtonElement>("[role=tab][aria-selected=false]")!;
  await act(async () =>
    memoryTab.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })),
  );
  expect(document.activeElement).toBe(navigator);
  expect(memoryTab.getAttribute("aria-selected")).toBe("true");
  await act(async () => navigator.click());
  expect(navigator.getAttribute("aria-selected")).toBe("true");
  expect(container.querySelector("[role=tabpanel]:not([hidden])")?.textContent).not.toContain(
    "Saved memory",
  );
  await render(settings.preferences, { ...props, memoryRequest: 1 });
  expect(memoryTab.getAttribute("aria-selected")).toBe("true");
  expect(container.querySelectorAll("[role=tab]")).toHaveLength(2);
  expect(container.textContent).toContain("Current conversation");
  expect(container.textContent).toContain("Sources and documents");
  await act(async () => navigator.click());
  await render(settings.preferences, {
    ...props,
    projectScope: "019a8000-0000-7000-8000-000000000236",
    memoryRequest: 2,
  });
  expect(container.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe(
    "Project memory",
  );
  await render(settings.preferences, { ...props, memoryRequest: 1 });
  expect(container.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Navigator");
});

it("opens one manuscript surface without exposing extra records as tabs", async () => {
  const projectId = "019a8000-0000-7000-8000-000000000231";
  const otherProject = "019a8000-0000-7000-8000-000000000232";
  const draftId = "019a8000-0000-7000-8000-000000000241";
  const currentRevisionId = "019a8000-0000-7000-8000-000000000242";
  const summaries = [
    { draftId, title: "Working manuscript", currentRevisionId },
    {
      draftId: "019a8000-0000-7000-8000-000000000243",
      title: "Reference manuscript",
      currentRevisionId,
    },
  ];
  const date = "2026-11-17T10:00:00.000Z";
  const project = (id: string): ProjectRecord => ({
    id,
    projectType: "thesis",
    title: "Thesis",
    documentLanguage: "en-US",
    subtitle: null,
    titleRevision: 1,
    setupConfirmedAt: date,
    isDevelopment: false,
    createdAt: date,
    updatedAt: date,
    lastOpenedAt: date,
  });
  const settings = store();
  const collectionSource = new ConversationController({} as FoundationPort);
  let scope = projectId;
  let subscription = 1;
  const collections = new ProjectCollections({
    ...collectionSource,
    snapshot: () => ({
      ...collectionSource.snapshot(),
      scope: { projectId: scope, conversationId: null },
      researchSubscriptionId: `scope-${subscription}`,
      researchScopeReady: true,
      status: "ready",
    }),
    switchConversation() {},
  });
  const manuscriptPort = {
    listManuscripts: ({ projectId: selected }: { projectId: string }) =>
      call({
        ok: true,
        value: {
          projectId: selected,
          manuscripts: selected === projectId ? summaries : [],
          next: null,
        },
      }),
    readManuscript: vi.fn(() => call(failure("record_not_found"))),
  } as unknown as FoundationPort;
  const show = async (id: string) => {
    if (scope !== id) subscription++;
    scope = id;
    await render(settings.preferences, {
      projectScope: id,
      project: project(id),
      collections,
      memory: h("p", null, "Saved project memory"),
      manuscriptPort,
    });
  };
  const surface = () => container.querySelector(".workspace-manuscript-surface");
  await show(projectId);
  await click("Project memory");
  await click("Manuscript");
  expect(surface()?.hasAttribute("hidden")).toBe(false);
  expect(manuscriptPort.readManuscript).toHaveBeenCalledWith({
    projectId,
    subscriptionId: "scope-1",
    draftId,
    revisionId: null,
  });
  expect(container.textContent).not.toContain("Reference manuscript");
  expect([...container.querySelectorAll("[role=tab]")].map((button) => button.textContent)).toEqual(
    ["Navigator", "Manuscript", "Project memory"],
  );
  const manuscriptTab = container.querySelector<HTMLButtonElement>(
    '[role="tab"][aria-selected="true"]',
  );
  expect(manuscriptTab?.textContent).toBe("Manuscript");
  expect(manuscriptTab?.getAttribute("aria-controls")).toBe(surface()?.id);
  await key(manuscriptTab as HTMLButtonElement, "ArrowLeft");
  const navigator = container.querySelector<HTMLButtonElement>('[role="tablist"] [role="tab"]');
  expect(document.activeElement).toBe(navigator);
  expect(manuscriptTab?.getAttribute("aria-selected")).toBe("true");
  await act(async () => navigator?.click());
  expect(surface()?.hasAttribute("hidden")).toBe(true);
  expect(container.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Navigator");
  await show(otherProject);
  await click("Manuscript");
  expect(surface()?.textContent).toContain("Create manuscript");
  expect(manuscriptPort.readManuscript).toHaveBeenCalledTimes(1);
  collectionSource.dispose();
});

it("orders the explorer and folds or reveals the manuscript index without moving the document", async () => {
  const projectId = "019a8000-0000-7000-8000-000000000251";
  const date = "2026-11-17T10:00:00.000Z";
  const project: ProjectRecord = {
    id: projectId,
    projectType: "thesis",
    title: "Thesis",
    documentLanguage: "en-US",
    subtitle: null,
    titleRevision: 1,
    setupConfirmedAt: date,
    isDevelopment: false,
    createdAt: date,
    updatedAt: date,
    lastOpenedAt: date,
  };
  const collectionSource = new ConversationController({} as FoundationPort);
  const collections = new ProjectCollections({
    ...collectionSource,
    snapshot: () => ({
      ...collectionSource.snapshot(),
      scope: { projectId, conversationId: null },
      researchSubscriptionId: "scope-1",
      researchScopeReady: true,
      status: "ready",
    }),
    switchConversation() {},
  });
  const scope = { projectId, subscriptionId: "scope-1" };
  const manuscripts = {
    status: "ready",
    rows: [
      {
        draftId: "019a8000-0000-7000-8000-000000000261",
        title: "Thesis",
        currentRevisionId: "019a8000-0000-7000-8000-000000000262",
      },
    ],
    scope,
    verifiedScope: scope,
    retry: vi.fn(),
  } as unknown as ReturnType<typeof useManuscripts>;
  const headings = [
    { id: "sec_intro", text: "Introduction", level: 2, beforeParagraph: 0 },
    { id: "sec_frame", text: "Framework", level: 2, beforeParagraph: 1 },
    { id: "sec_care", text: "Care economy", level: 3, beforeParagraph: 1 },
    { id: "sec_networks", text: "Community networks", level: 4, beforeParagraph: 2 },
    { id: "sec_method", text: "Method", level: 2, beforeParagraph: 3 },
    { id: "sec_cases", text: "Case selection", level: 3, beforeParagraph: 3 },
  ] as const;
  const openManuscript = vi.fn();
  const scrolled = vi.fn(function (this: Element) {
    return this;
  });
  Element.prototype.scrollIntoView = scrolled as unknown as Element["scrollIntoView"];
  try {
    await act(async () => {
      root.render(
        h(ProjectExplorer, {
          collections,
          project,
          locale: "en-US",
          memoryAvailable: true,
          memorySelected: false,
          openMemory() {},
          revealChat() {},
          manuscripts,
          manuscriptSelected: true,
          headings,
          activeHeading: "sec_networks",
          headingLanguage: "ko-KR",
          openManuscript,
        }),
      );
    });
    const explorer = container.querySelector<HTMLElement>(".project-explorer")!;
    const [main, materials] = [...explorer.querySelectorAll<HTMLElement>(":scope > ul")];
    expect([...main!.children].map((item) => item.firstElementChild?.textContent)).toEqual([
      "Manuscript",
      "Project memory",
    ]);
    expect(materials!.classList.contains("project-explorer-materials")).toBe(true);
    expect([...materials!.children].map((item) => item.firstElementChild?.textContent)).toEqual([
      "Sources and documents",
      "Conversations",
    ]);
    const rootRow = explorer.querySelector(".manuscript-outline-root")!;
    expect(
      [...rootRow.querySelectorAll("button")].map(
        (button) => button.getAttribute("aria-label") ?? button.textContent,
      ),
    ).toEqual([
      "Manuscript",
      "Show current position",
      "Fold all",
      "Toggle the outline for Manuscript",
    ]);
    const heading = (text: string) =>
      [...explorer.querySelectorAll<HTMLButtonElement>(".manuscript-outline-heading")].find(
        (button) => button.textContent === text,
      )!;
    const disclosure = (text: string) =>
      explorer.querySelector<HTMLButtonElement>(`[aria-label="Toggle the outline for ${text}"]`)!;
    const current = () => explorer.querySelector('[aria-current="location"]')?.textContent;
    expect(current()).toBe("Community networks");
    expect(heading("Community networks").querySelector("bdi")?.getAttribute("lang")).toBe("ko-KR");
    expect(
      ["Introduction", "Framework", "Care economy", "Method", "Case selection"].map(
        (text) => heading(text).dataset.emphasis,
      ),
    ).toEqual(["true", "true", "true", "true", undefined]);

    await act(async () =>
      rootRow.querySelector<HTMLButtonElement>('[aria-label="Fold all"]')!.click(),
    );
    expect(
      ["Framework", "Care economy", "Method"].map((text) => disclosure(text).ariaExpanded),
    ).toEqual(["false", "false", "false"]);
    expect(disclosure("Manuscript").getAttribute("aria-expanded")).toBe("true");
    expect(heading("Care economy").closest("[hidden]")).not.toBeNull();
    expect(current()).toBe("Framework");

    await act(async () => disclosure("Manuscript").click());
    expect(current()).toBe("Manuscript");
    await act(async () =>
      rootRow.querySelector<HTMLButtonElement>('[aria-label="Show current position"]')!.click(),
    );
    expect(disclosure("Manuscript").getAttribute("aria-expanded")).toBe("true");
    expect(
      ["Framework", "Care economy", "Method"].map((text) => disclosure(text).ariaExpanded),
    ).toEqual(["true", "true", "false"]);
    expect(current()).toBe("Community networks");
    expect(heading("Community networks").closest("[hidden]")).toBeNull();
    expect(scrolled).toHaveBeenLastCalledWith({ block: "nearest" });
    expect(scrolled.mock.contexts.at(-1)).toBe(heading("Community networks"));
    expect(openManuscript).not.toHaveBeenCalled();

    await act(async () => heading("Care economy").click());
    expect(openManuscript).toHaveBeenCalledWith("sec_care");
  } finally {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
  collectionSource.dispose();
});

describe("workspace chrome manuscript close guard", () => {
  const projectId = "019a8000-0000-7000-8000-000000000271";
  const draftId = "019a8000-0000-7000-8000-000000000272";
  const date = "2026-11-17T10:00:00.000Z";
  const project: ProjectRecord = {
    id: projectId,
    projectType: "thesis",
    title: "Thesis",
    documentLanguage: "en-US",
    subtitle: null,
    titleRevision: 1,
    setupConfirmedAt: date,
    isDevelopment: false,
    createdAt: date,
    updatedAt: date,
    lastOpenedAt: date,
  };
  const source = `---\nohtia_draft_format: ohtia-markdown-v1\nohtia_draft_id: draft_${draftId}\n---\n\n# Care networks {#sec_title}\n\n::: {#blk_one .ohtia-block}\nOpening paragraph.\n:::\n`;
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const revision = (n: number, parent: string | null, text: string): ManuscriptRevision => ({
    projectId,
    draftId,
    revisionId: `019a8000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    parentRevisionId: parent,
    restorationOriginId: null,
    language: "en-GB",
    createdAt: date,
    saveReason: parent ? "manual" : "initial",
    contentSha256: sha(text),
    authorKind: "researcher",
    recordingActor: "utility",
  });
  let restoreEditorGeometry: (() => void) | undefined;
  afterEach(() => {
    restoreEditorGeometry?.();
    restoreEditorGeometry = undefined;
  });

  async function manuscriptChrome(
    options: { readonly empty?: boolean; readonly listFailures?: readonly string[] } = {},
  ) {
    vi.stubGlobal("crypto", {
      randomUUID,
      subtle: {
        digest: async (_algorithm: string, bytes: Uint8Array) =>
          Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer,
      },
    });
    vi.stubGlobal("TextEncoder", NodeTextEncoder);
    // ProseMirror measures ranges and scrolls the selection; jsdom implements neither.
    const descriptors = {
      rects: Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects"),
      rect: Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect"),
      scroll: Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView"),
    };
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => Object.assign([], { item: () => null }),
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(0, 0, 0, 0),
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: () => {},
    });
    restoreEditorGeometry = () => {
      for (const [target, name, descriptor] of [
        [Range.prototype, "getClientRects", descriptors.rects],
        [Range.prototype, "getBoundingClientRect", descriptors.rect],
        [Element.prototype, "scrollIntoView", descriptors.scroll],
      ] as const) {
        if (descriptor) Object.defineProperty(target, name, descriptor);
        else delete (target as unknown as Record<string, unknown>)[name];
      }
    };
    const state = { text: source, revision: revision(500, null, source), next: 501 };
    let exists = !options.empty;
    const port = {
      listManuscripts: vi.fn(() =>
        call({
          ok: true as const,
          value: {
            projectId,
            manuscripts: exists
              ? [{ draftId, title: "Thesis", currentRevisionId: state.revision.revisionId }]
              : [],
            next: null,
          },
        }),
      ),
      readManuscript: vi.fn(() =>
        call({ ok: true as const, value: { revision: state.revision, markdown: state.text } }),
      ),
      saveManuscript: vi.fn(
        (_operationId: string, input: Parameters<FoundationPort["saveManuscript"]>[1]) => {
          state.text = input.markdown as string;
          state.revision = revision(state.next++, input.expectedRevisionId, state.text);
          return call<ManuscriptWriteResult>({
            ok: true,
            value: {
              resultId: "019a8000-0000-7000-8000-000000000999",
              manuscriptChange: { kind: "committed", revision: state.revision },
            },
          });
        },
      ),
      stageManuscriptPart: vi.fn(),
      readManuscriptReceipt: vi.fn(),
      readManuscriptPart: vi.fn(),
      createManuscript: vi.fn(
        (_operationId: string, _input: Parameters<FoundationPort["createManuscript"]>[1]) => {
          exists = true;
          return call<ManuscriptWriteResult>({
            ok: true,
            value: {
              resultId: "019a8000-0000-7000-8000-000000000998",
              manuscriptChange: { kind: "committed", revision: state.revision },
            },
          });
        },
      ),
    };
    for (const code of options.listFailures ?? [])
      port.listManuscripts.mockImplementationOnce(() =>
        call(failure(code as Parameters<typeof failure>[0])),
      );
    let requestClose: ((command: ManuscriptCloseCommand) => void) | undefined;
    let requestLock: ((request: ManuscriptLockRequest) => void) | undefined;
    const lifecycle = {
      perform: vi.fn(async (_command: string) => true),
      setManuscriptPending: vi.fn(async (_pending: boolean) => true),
      onManuscriptClose: vi.fn((listener: (command: ManuscriptCloseCommand) => void) => {
        requestClose = listener;
        return () => {
          requestClose = undefined;
        };
      }),
      onManuscriptLock: vi.fn((listener: (request: ManuscriptLockRequest) => void) => {
        requestLock = listener;
        return () => {
          requestLock = undefined;
        };
      }),
      confirmManuscriptLock: vi.fn(async (_id: string, _pending: boolean) => true),
    };
    const collectionSource = new ConversationController({} as FoundationPort);
    const collections = new ProjectCollections({
      ...collectionSource,
      snapshot: () => ({
        ...collectionSource.snapshot(),
        scope: { projectId, conversationId: null },
        researchSubscriptionId: "scope-1",
        researchScopeReady: true,
        status: "ready",
      }),
      switchConversation() {},
    });
    const settings = store();
    await render(settings.preferences, {
      projectScope: projectId,
      project,
      collections,
      manuscriptPort: port as unknown as FoundationPort,
      manuscriptLifecycle: lifecycle,
    });
    const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button")];
    const named = (name: string, scope: ParentNode = container) =>
      [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
        (node) => node.textContent === name,
      );
    async function open() {
      const tab = buttons().find(
        (node) => node.getAttribute("role") === "tab" && node.textContent === "Manuscript",
      )!;
      await act(async () => tab.click());
      await settle();
    }
    async function edit() {
      await open();
      await act(async () => named("Edit")!.click());
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", {
        value: {
          types: ["text/plain"],
          getData: (type: string) => (type === "text/plain" ? "New " : ""),
        },
      });
      await act(async () => container.querySelector("[role=textbox]")!.dispatchEvent(paste));
    }
    const dialog = () => container.querySelector<HTMLDialogElement>("dialog[open]");
    const close = async (command: ManuscriptCloseCommand) => {
      await act(async () => requestClose?.(command));
      await settle();
    };
    const lock = async (request: ManuscriptLockRequest) => {
      await act(async () => requestLock?.(request));
      await settle();
    };
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return {
      port,
      lifecycle,
      state,
      open,
      edit,
      dialog,
      close,
      lock,
      unload,
      named,
      settle,
      collectionSource,
    };
  }

  it("reports pending manuscript text and protects unload only while it is pending", async () => {
    const t = await manuscriptChrome();
    await t.settle();
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[false]]);
    expect(t.lifecycle.onManuscriptClose).toHaveBeenCalledOnce();
    expect(t.unload()).toBe(false);
    await t.edit();
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[false], [true]]);
    expect(t.unload()).toBe(true);
    await act(async () => t.named("Discard changes")!.click());
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[false], [true], [false]]);
    expect(t.unload()).toBe(false);
    t.collectionSource.dispose();
  });

  it("resends a refused pending report until main accepts it, without waiting for focus", async () => {
    const t = await manuscriptChrome();
    await t.settle();
    // An exit that is stopping services refuses renderer commands by rejecting them.
    t.lifecycle.setManuscriptPending.mockImplementationOnce(async () => {
      throw new Error("Command sender admission refused.");
    });
    await t.edit();
    await t.settle();
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[false], [true]]);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1100)));
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[false], [true], [true]]);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1100)));
    expect(t.lifecycle.setManuscriptPending).toHaveBeenCalledTimes(3);
    t.collectionSource.dispose();
  });

  it("reports each pending change in order while an earlier report is outstanding", async () => {
    const t = await manuscriptChrome();
    await t.edit();
    await t.settle();
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[false], [true]]);
    const cleared = Promise.withResolvers<boolean>();
    t.lifecycle.setManuscriptPending.mockImplementationOnce(() => cleared.promise);
    const textbox = container.querySelector<HTMLElement>("[role=textbox]")!;
    const keys = (init: KeyboardEventInit) =>
      act(async () => {
        textbox.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "z",
            keyCode: 90,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
            ...init,
          }),
        );
      });
    // Undo returns to the saved text while that report is still outstanding; redo restores the edit.
    await keys({});
    await keys({ shiftKey: true });
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[false], [true], [false], [true]]);
    await act(async () => cleared.resolve(true));
    await t.settle();
    expect(t.lifecycle.setManuscriptPending).toHaveBeenCalledTimes(4);
    expect(t.named("Save")).toBeDefined();
    t.collectionSource.dispose();
  });

  it("asks before closing with pending text, focusing Keep open, and keeps the text when kept open", async () => {
    const t = await manuscriptChrome();
    await t.edit();
    await t.close("window.close");
    const dialog = t.dialog()!;
    expect(dialog.querySelector("h2")?.textContent).toBe("Unsaved changes");
    expect(dialog.textContent).toContain(
      "Save or discard the pending manuscript changes before closing.",
    );
    expect([...dialog.querySelectorAll(".actions button")].map((node) => node.textContent)).toEqual(
      ["Keep open", "Discard and close", "Save and close"],
    );
    expect(document.activeElement).toBe(t.named("Keep open", dialog));
    await act(async () => t.named("Keep open", dialog)!.click());
    expect(t.dialog()).toBeNull();
    expect(t.lifecycle.perform).not.toHaveBeenCalled();
    expect(t.named("Save")).toBeDefined();
    expect(container.querySelector("[role=textbox]")?.textContent).toContain("New ");
    t.collectionSource.dispose();
  });

  it("continues a close requested during a save once that save clears the pending text", async () => {
    const t = await manuscriptChrome();
    await t.edit();
    const saving = Promise.withResolvers<void>();
    const commit = t.port.saveManuscript.getMockImplementation()!;
    t.port.saveManuscript.mockImplementationOnce((operationId, input) => ({
      result: saving.promise.then(() => commit(operationId, input).result),
      cancel() {},
    }));
    await act(async () => t.named("Save")!.click());
    await t.close("window.close");
    expect(t.dialog()).not.toBeNull();
    expect(t.lifecycle.perform).not.toHaveBeenCalled();
    await act(async () => saving.resolve());
    await t.settle();
    expect(t.dialog()).toBeNull();
    expect(t.lifecycle.setManuscriptPending).toHaveBeenLastCalledWith(false);
    expect(t.lifecycle.perform).toHaveBeenCalledExactlyOnceWith("window.close");
    // A later edit does not revive the completed request.
    await act(async () => t.named("Preview")!.click());
    await t.edit();
    expect(t.dialog()).toBeNull();
    expect(t.lifecycle.perform).toHaveBeenCalledOnce();
    t.collectionSource.dispose();
  });

  it("discards pending text and then performs the requested close", async () => {
    const t = await manuscriptChrome();
    await t.edit();
    await t.close("application.quit");
    await act(async () => t.named("Discard and close", t.dialog()!)!.click());
    await t.settle();
    expect(t.lifecycle.setManuscriptPending).toHaveBeenLastCalledWith(false);
    expect(t.lifecycle.perform).toHaveBeenCalledExactlyOnceWith("application.quit");
    expect(t.dialog()).toBeNull();
    expect(t.named("Save")).toBeUndefined();
    expect(t.port.saveManuscript).not.toHaveBeenCalled();
    t.collectionSource.dispose();
  });

  it("saves pending text and then performs the requested close", async () => {
    const t = await manuscriptChrome();
    await t.edit();
    await t.close("window.close");
    await act(async () => t.named("Save and close", t.dialog()!)!.click());
    await t.settle();
    expect(t.port.saveManuscript).toHaveBeenCalledOnce();
    expect(t.state.text).toContain("New ");
    expect(t.lifecycle.perform).toHaveBeenCalledExactlyOnceWith("window.close");
    expect(t.dialog()).toBeNull();
    t.collectionSource.dispose();
  });

  it("keeps the text and the window open when saving for close fails", async () => {
    const t = await manuscriptChrome();
    await t.edit();
    t.port.saveManuscript.mockImplementationOnce(() => call(failure("storage_failed")));
    await t.close("window.close");
    await act(async () => t.named("Save and close", t.dialog()!)!.click());
    await t.settle();
    expect(t.lifecycle.perform).not.toHaveBeenCalled();
    expect(t.dialog()).toBeNull();
    expect(container.textContent).toContain("Could not save the manuscript.");
    expect(t.named("Save")).toBeDefined();
    t.collectionSource.dispose();
  });

  it("continues a close request directly when nothing is pending", async () => {
    const t = await manuscriptChrome();
    await t.open();
    t.lifecycle.setManuscriptPending.mockClear();
    await t.close("window.close");
    expect(t.dialog()).toBeNull();
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[false]]);
    expect(t.lifecycle.perform).toHaveBeenCalledExactlyOnceWith("window.close");
    t.lifecycle.setManuscriptPending.mockResolvedValueOnce(false);
    await t.close("application.quit");
    expect(t.lifecycle.perform).toHaveBeenCalledOnce();
    t.collectionSource.dispose();
  });

  it("locks the manuscript for a quit and confirms that nothing is pending, then unlocks it", async () => {
    const t = await manuscriptChrome();
    await t.open();
    await act(async () => t.named("Edit")!.click());
    const textbox = () => container.querySelector<HTMLElement>("[role=textbox]")!;
    expect(t.lifecycle.onManuscriptLock).toHaveBeenCalledOnce();
    expect(t.lifecycle.confirmManuscriptLock).not.toHaveBeenCalled();
    await t.lock({ locked: true, id: "lock-1" });
    expect(textbox().getAttribute("contenteditable")).toBe("false");
    expect(t.named("Preview")!.disabled).toBe(true);
    expect(t.lifecycle.confirmManuscriptLock.mock.calls).toEqual([["lock-1", false]]);
    await t.lock({ locked: false });
    expect(textbox().getAttribute("contenteditable")).toBe("true");
    expect(t.named("Preview")!.disabled).toBe(false);
    expect(t.lifecycle.confirmManuscriptLock).toHaveBeenCalledOnce();
    t.collectionSource.dispose();
  });

  it("confirms a lock with pending text and confirms each new lock again", async () => {
    const t = await manuscriptChrome();
    await t.edit();
    await t.lock({ locked: true, id: "lock-1" });
    expect(t.named("Save")!.disabled).toBe(true);
    expect(t.named("Discard changes")!.disabled).toBe(true);
    expect(t.lifecycle.confirmManuscriptLock.mock.calls).toEqual([["lock-1", true]]);
    await t.lock({ locked: false });
    expect(t.named("Save")!.disabled).toBe(false);
    await act(async () => t.named("Discard changes")!.click());
    await t.lock({ locked: true, id: "lock-2" });
    expect(t.lifecycle.confirmManuscriptLock.mock.calls).toEqual([
      ["lock-1", true],
      ["lock-2", false],
    ]);
    t.collectionSource.dispose();
  });

  it("counts a composition in progress as pending text when confirming a lock", async () => {
    const t = await manuscriptChrome();
    await t.open();
    await act(async () => t.named("Edit")!.click());
    const textbox = container.querySelector<HTMLElement>("[role=textbox]")!;
    await act(async () =>
      textbox.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    await t.lock({ locked: true, id: "lock-1" });
    await t.lock({ locked: false });
    await act(async () =>
      textbox.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
    );
    await t.lock({ locked: true, id: "lock-2" });
    expect(t.lifecycle.confirmManuscriptLock.mock.calls).toEqual([
      ["lock-1", true],
      ["lock-2", false],
    ]);
    t.collectionSource.dispose();
  });

  it("keeps the manuscript locked when confirming the lock is rejected", async () => {
    const t = await manuscriptChrome();
    await t.open();
    await act(async () => t.named("Edit")!.click());
    // An unhandled rejection would fail the Vitest run.
    t.lifecycle.confirmManuscriptLock.mockImplementationOnce(async () => {
      throw new Error("Command sender admission refused.");
    });
    await t.lock({ locked: true, id: "lock-1" });
    expect(t.lifecycle.confirmManuscriptLock).toHaveBeenCalledExactlyOnceWith("lock-1", false);
    expect(container.querySelector("[role=textbox]")?.getAttribute("contenteditable")).toBe(
      "false",
    );
    t.collectionSource.dispose();
  });

  it("still locks the manuscript when the bridge cannot confirm a lock", async () => {
    const t = await manuscriptChrome();
    await t.open();
    await act(async () => t.named("Edit")!.click());
    const { confirmManuscriptLock } = t.lifecycle;
    Reflect.deleteProperty(t.lifecycle, "confirmManuscriptLock");
    await t.lock({ locked: true, id: "lock-1" });
    expect(container.querySelector("[role=textbox]")?.getAttribute("contenteditable")).toBe(
      "false",
    );
    expect(confirmManuscriptLock).not.toHaveBeenCalled();
    t.collectionSource.dispose();
  });

  it("ignores a composition outside the manuscript when confirming a lock and continuing a close", async () => {
    const t = await manuscriptChrome();
    await t.open();
    await act(async () => t.named("Edit")!.click());
    // A text field elsewhere in the window, such as a chat composer.
    const composer = document.createElement("textarea");
    container.append(composer);
    await act(async () =>
      composer.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    await t.lock({ locked: true, id: "lock-1" });
    expect(t.lifecycle.confirmManuscriptLock.mock.calls).toEqual([["lock-1", false]]);
    await t.lock({ locked: false });
    t.lifecycle.setManuscriptPending.mockClear();
    await t.close("application.quit");
    expect(t.dialog()).toBeNull();
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[false]]);
    expect(t.lifecycle.perform).toHaveBeenCalledExactlyOnceWith("application.quit");
    composer.remove();
    t.collectionSource.dispose();
  });

  it("ignores a composition in another field of the manuscript view, such as the heading filter", async () => {
    const t = await manuscriptChrome();
    await t.open();
    await act(async () => t.named("Edit")!.click());
    const filter = document.createElement("input");
    container.querySelector(".workspace-manuscript-view")!.append(filter);
    await act(async () =>
      filter.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    await t.lock({ locked: true, id: "lock-1" });
    expect(t.lifecycle.confirmManuscriptLock.mock.calls).toEqual([["lock-1", false]]);
    filter.remove();
    t.collectionSource.dispose();
  });

  it("counts a manuscript composition that the lock itself ends as pending text", async () => {
    const t = await manuscriptChrome();
    await t.open();
    await act(async () => t.named("Edit")!.click());
    const textbox = container.querySelector<HTMLElement>("[role=textbox]")!;
    await act(async () =>
      textbox.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    // Chromium may end the composition when the lock makes the editor read-only.
    t.lifecycle.confirmManuscriptLock.mockImplementationOnce(async () => true);
    await act(async () => {
      t.lifecycle.onManuscriptLock.mock.calls.at(-1)![0]({ locked: true, id: "lock-ime" });
      textbox.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    await t.settle();
    expect(t.lifecycle.confirmManuscriptLock.mock.calls).toEqual([["lock-ime", true]]);
    t.collectionSource.dispose();
  });

  it("ends a manuscript composition when focus leaves the editor without a compositionend", async () => {
    const t = await manuscriptChrome();
    await t.open();
    await act(async () => t.named("Edit")!.click());
    const textbox = container.querySelector<HTMLElement>("[role=textbox]")!;
    await act(async () =>
      textbox.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    t.lifecycle.setManuscriptPending.mockClear();
    await t.close("application.quit");
    await t.settle();
    expect(t.lifecycle.perform).not.toHaveBeenCalled();
    // Focus moving within the editor keeps the composition.
    await act(async () =>
      textbox.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: textbox })),
    );
    await t.settle();
    expect(t.lifecycle.perform).not.toHaveBeenCalled();
    await act(async () =>
      textbox.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null })),
    );
    await t.settle();
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[false]]);
    expect(t.lifecycle.perform).toHaveBeenCalledExactlyOnceWith("application.quit");
    t.collectionSource.dispose();
  });

  it("holds a quit requested during a manuscript composition and continues it once the composition ends with nothing pending", async () => {
    const t = await manuscriptChrome();
    await t.open();
    await act(async () => t.named("Edit")!.click());
    const textbox = container.querySelector<HTMLElement>("[role=textbox]")!;
    await act(async () =>
      textbox.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    t.lifecycle.setManuscriptPending.mockClear();
    await t.close("application.quit");
    await t.settle();
    expect(t.dialog()).toBeNull();
    expect(t.lifecycle.setManuscriptPending).not.toHaveBeenCalled();
    expect(t.lifecycle.perform).not.toHaveBeenCalled();
    await act(async () =>
      textbox.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
    );
    await t.settle();
    expect(t.dialog()).toBeNull();
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[false]]);
    expect(t.lifecycle.perform).toHaveBeenCalledExactlyOnceWith("application.quit");
    await t.settle();
    expect(t.lifecycle.perform).toHaveBeenCalledOnce();
    t.collectionSource.dispose();
  });

  it("asks about unsaved changes when a composition that held a quit records text", async () => {
    const t = await manuscriptChrome();
    await t.open();
    await act(async () => t.named("Edit")!.click());
    const textbox = container.querySelector<HTMLElement>("[role=textbox]")!;
    await act(async () =>
      textbox.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    t.lifecycle.setManuscriptPending.mockClear();
    await t.close("application.quit");
    expect(t.lifecycle.perform).not.toHaveBeenCalled();
    // The composed text reaches the drafts as the composition finishes, in the same task.
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? "Composed " : ""),
      },
    });
    await act(async () => {
      textbox.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      textbox.dispatchEvent(paste);
    });
    await t.settle();
    expect(t.dialog()?.querySelector("h2")?.textContent).toBe("Unsaved changes");
    expect(t.lifecycle.setManuscriptPending.mock.calls).toEqual([[true]]);
    expect(t.lifecycle.perform).not.toHaveBeenCalled();
    expect(textbox.textContent).toContain("Composed ");
    t.collectionSource.dispose();
  });

  it("creates the primary manuscript after reporting a failed creation", async () => {
    const t = await manuscriptChrome({ empty: true });
    await t.open();
    expect(container.textContent).toContain("No manuscripts yet.");
    t.port.createManuscript.mockImplementationOnce(() => call(failure("storage_failed")));
    await act(async () => t.named("Create manuscript")!.click());
    await t.settle();
    expect(container.textContent).toContain("Could not create the manuscript.");
    expect(t.port.createManuscript).toHaveBeenCalledWith(`primary-manuscript-${projectId}`, {
      projectId,
      subscriptionId: "scope-1",
      title: "Thesis",
    });
    t.port.createManuscript.mockImplementationOnce(() => ({
      result: Promise.reject(new Error("bridge closed")),
      cancel() {},
    }));
    await act(async () => t.named("Create manuscript")!.click());
    await t.settle();
    expect(container.textContent).toContain("Could not create the manuscript.");
    await act(async () => t.named("Create manuscript")!.click());
    await t.settle();
    expect(t.port.createManuscript).toHaveBeenCalledTimes(3);
    expect(container.textContent).not.toContain("Could not create the manuscript.");
    expect(container.querySelector("article.workspace-manuscript h1")?.textContent).toBe(
      "Care networks",
    );
    expect(container.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe(
      "Manuscript",
    );
    t.collectionSource.dispose();
  });

  it("shows explorer list failures with a Try again that keeps focus on the Manuscript entry", async () => {
    const t = await manuscriptChrome({ listFailures: ["storage_failed", "project_in_setup"] });
    await t.settle();
    const entry = () =>
      container.querySelector<HTMLButtonElement>(".manuscript-outline-root button")!;
    const item = () => entry().closest("li")!;
    expect(item().textContent).toContain("Could not load the manuscript list.");
    await act(async () => t.named("Try again", item())!.click());
    await t.settle();
    expect(document.activeElement).toBe(entry());
    expect(item().textContent).toContain("Manuscripts are unavailable.");
    await act(async () => t.named("Try again", item())!.click());
    await t.settle();
    expect(item().querySelector("[role=status]")?.textContent).toBe("");
    expect(t.named("Try again", item())).toBeUndefined();
    t.collectionSource.dispose();
  });
});
