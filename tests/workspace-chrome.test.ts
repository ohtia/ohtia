// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "../packages/renderer/src/workspace.js";
import { WorkspaceChrome } from "../packages/renderer/src/workspace-chrome.js";
import { CommandController } from "../packages/renderer/src/command-controller.js";
import { LayoutPreferences } from "../packages/renderer/src/layout-preferences.js";
import {
  failure,
  message,
  type FoundationPort,
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
it("composes real registry surfaces and announces failed layout persistence once through the shared claim", async () => {
  const { port, fail, saved } = store();
  fail(failure("service_unavailable"));
  const stop = vi.fn();
  const bridge = {
    context: async () => ({ windowGeneration: "window-composition", platform: "linux" as const }),
    publish: async () => true,
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
