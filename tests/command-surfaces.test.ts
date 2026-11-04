// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandSurfaces,
  AboutDialog,
  CommandButton,
} from "../packages/renderer/src/command-surfaces.js";
import { Dialog } from "../packages/renderer/src/layers.js";
import { CommandController } from "../packages/renderer/src/command-controller.js";
import {
  type AboutInformation,
  type CommandBridge,
  type CommandIntent,
  type CommandSnapshot,
  message,
  interfaceZooms,
} from "../packages/contracts/src/index.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let densityDescriptor: PropertyDescriptor | undefined;
const imageObservers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
const mediaQueries: { listeners: Set<() => void> }[] = [];
function density(value: number) {
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value });
}

beforeEach(() => {
  densityDescriptor = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  density(1);
  imageObservers.length = 0;
  mediaQueries.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      constructor(readonly callback: () => void) {
        imageObservers.push(this);
      }
      observe() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const record = { listeners: new Set<() => void>() };
      mediaQueries.push(record);
      return {
        media: query,
        matches: true,
        addEventListener: (_: string, listener: () => void) => record.listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => record.listeners.delete(listener),
      };
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (densityDescriptor) Object.defineProperty(window, "devicePixelRatio", densityDescriptor);
});
const info: AboutInformation = {
  product: "Ohtia",
  version: "0.0.0-dev.1.2",
  build: "sha256:abc123",
  platform: "linux",
  architecture: "x86-64",
  copyright: "Copyright (c) 2026 Adrian Mastronardi & Mónica Pené",
  license: "MIT License\nSynthetic notice fixture",
  notices: [
    { component: "React", license: "MIT" },
    { component: "IBM Plex Sans", license: "OFL-1.1" },
  ],
};
async function render(node: Parameters<Root["render"]>[0]) {
  await act(async () => root.render(node));
}
async function click(element: Element) {
  await act(async () => (element as HTMLElement).click());
}
function button(text: string, scope: ParentNode = container) {
  return [...scope.querySelectorAll("button")].find((node) => node.textContent === text)!;
}
function harness(platform: "linux" | "win32" | "darwin" = "linux") {
  let listener: ((intent: CommandIntent) => void) | undefined;
  let sequence = 0;
  const dispose = vi.fn();
  const snapshots: CommandSnapshot[] = [];
  const bridge: CommandBridge = {
    context: vi.fn(async () => ({ windowGeneration: "window-1", platform })),
    publish: vi.fn(async (snapshot) => {
      snapshots.push(snapshot);
      return true;
    }),
    onIntent: vi.fn((next) => {
      listener = next;
      return dispose;
    }),
    about: vi.fn(async () => info),
    copyVersionInformation: vi.fn(async () => true),
    windowAction: vi.fn(async () => ({ status: "completed" as const })),
    perform: vi.fn(async () => true),
    openLink: vi.fn(async () => true),
  };
  return {
    bridge,
    snapshots,
    dispose,
    send: (command: CommandIntent["command"]) =>
      listener?.({ windowGeneration: "window-1", source: "native", sequence: ++sequence, command }),
  };
}
describe("local Help and About composition", () => {
  it("opens offline help/about through the same native and contextual registry and restores dialog focus", async () => {
    const test = harness();
    await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
    expect(
      test.snapshots.at(-1)!.entries.find((entry) => entry.id === "window.new")!.reason,
    ).toBeUndefined();
    const about = button("About Ohtia");
    await act(async () => about.focus());
    await click(about);
    let dialog = container.querySelector(".about-dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.querySelector("h1")!.textContent).toBe("Ohtia");
    expect(dialog.textContent).toContain(info.version);
    expect(dialog.textContent).toContain("Linux · x86-64");
    expect(dialog.querySelector("img")!.getAttribute("width")).toBe("128");
    expect(dialog.querySelector("img")!.alt).toBe("");
    expect(test.bridge.about).toHaveBeenCalledOnce();
    await click(button("Third-party notices", dialog));
    expect(dialog.querySelector("ul[aria-label]")!.getAttribute("tabindex")).toBe("0");
    expect(dialog.textContent).toContain("React · MIT");
    await click(button("Copy version information", dialog));
    expect(test.bridge.copyVersionInformation).toHaveBeenCalledWith("en-US");
    expect(dialog.querySelector(".about-copied")!.textContent).toBe("Copied");
    expect(document.activeElement).toBe(dialog.querySelector("[data-close]"));
    await click(button("Close", dialog));
    expect(document.activeElement).toBe(about);
    await act(async () => test.send("help.open"));
    dialog = container.querySelector(".help-dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.textContent).toContain(message("en-US", "help.capabilities"));
    const shortcuts = button("Keyboard shortcuts", dialog);
    expect(shortcuts.getAttribute("aria-disabled")).not.toBe("true");
    await click(dialog.querySelector('a[href*="docs/index"]')!);
    expect(test.bridge.openLink).toHaveBeenCalledWith("documentation");
    await click(button("Close", dialog));
    await render(h(CommandSurfaces, { bridge: test.bridge, locale: "ko-KR" }));
    await act(async () => test.send("about.open"));
    expect(container.querySelector(".about-dialog")!.textContent).toContain("시스템");
    expect(test.bridge.about).toHaveBeenCalledTimes(2);
  });
  it("keeps failed copy inline, never announces success early and revokes a closed dialog's late callbacks", async () => {
    const test = harness();
    let finish!: (value: boolean) => void;
    vi.mocked(test.bridge.copyVersionInformation).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
    await click(button("About Ohtia"));
    const dialog = container.querySelector(".about-dialog")!;
    await click(button("Copy version information", dialog));
    expect(dialog.textContent).not.toContain("Copied");
    await act(async () => finish(false));
    expect(dialog.querySelector('[role="alert"]')!.textContent).toContain("copy it manually");
    expect(dialog.hasAttribute("open")).toBe(true);
    await click(button("Copy version information", dialog));
    await click(button("Close", dialog));
    await click(button("About Ohtia"));
    await act(async () => finish(true));
    expect(container.querySelector(".about-dialog")!.textContent).not.toContain("Copied");
    await render(null);
    expect(test.dispose).toHaveBeenCalledOnce();
  });
  it("does not reopen dismissed About on delayed metadata and reports controlled load/transport failures", async () => {
    const test = harness();
    let finish!: (value: AboutInformation) => void;
    vi.mocked(test.bridge.about).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
    await click(button("About Ohtia"));
    await click(button("Close", container.querySelector(".about-dialog")!));
    await act(async () => finish(info));
    expect(container.querySelector("dialog[open]")).toBeNull();
    vi.mocked(test.bridge.about).mockRejectedValueOnce(new Error("synthetic private detail"));
    await click(button("About Ohtia"));
    expect(container.querySelector('.about-dialog [role="alert"]')!.textContent).toBe(
      message("en-US", "about.loadFailed"),
    );
    expect(container.textContent).not.toContain("synthetic private detail");
    await click(button("Close", container.querySelector(".about-dialog")!));
    vi.mocked(test.bridge.openLink).mockResolvedValueOnce(false);
    await click(button("Ohtia help"));
    await click(container.querySelector(".help-dialog a")!);
    expect(container.textContent).toContain(message("en-US", "command.failed"));
    await render(null);
    vi.mocked(test.bridge.context).mockRejectedValueOnce(new Error("unavailable"));
    await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(
      message("en-US", "command.failed"),
    );
  });
  it("publishes focused editing/composition state and keeps the Help/About registry stable through locale changes", async () => {
    const test = harness();
    await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
    const input = document.createElement("textarea");
    document.body.append(input);
    await act(async () => input.focus());
    expect(
      test.snapshots.at(-1)!.entries.find((entry) => entry.id === "edit.undo")!.reason,
    ).toBeUndefined();
    await act(async () =>
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    expect(test.snapshots.at(-1)!.entries.find((entry) => entry.id === "about.open")!.reason).toBe(
      "composing",
    );
    await act(async () => test.send("about.open"));
    expect(container.querySelector("dialog[open]")).toBeNull();
    await act(async () =>
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
    );
    await act(async () => test.send("about.open"));
    expect(container.querySelector("dialog[open]")).not.toBeNull();
    await render(h(CommandSurfaces, { bridge: test.bridge, locale: "es-AR" }));
    expect(test.bridge.context).toHaveBeenCalledOnce();
    expect(input.value).toBe("");
    expect(container.querySelector(".about-dialog")!.textContent).toContain("Versión");
    await render(null);
    const count = test.snapshots.length;
    await act(async () => input.focus());
    expect(test.snapshots).toHaveLength(count);
  });
  it("renders the controlled hidden/static/manuscript decoration contract without reserving an image slot", async () => {
    const props = {
      open: true,
      locale: "en-US" as const,
      info,
      copy: { phase: "idle" as const, attempt: 0 },
      onCopy: vi.fn(),
      onClose: vi.fn(),
      onOpenLink: vi.fn(),
    };
    for (const extra of [
      { decoration: "hidden" as const },
      { decoration: "animated" as const, manuscriptVisible: true },
    ]) {
      await render(h(AboutDialog, { ...props, ...extra }));
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("h1")!.textContent).toBe("Ohtia");
      expect(container.textContent).toContain(info.build);
    }
    await render(h(AboutDialog, { ...props, decoration: "static" }));
    expect(container.querySelectorAll("img")).toHaveLength(1);
    await render(h(AboutDialog, { ...props, open: false }));
    expect(container.querySelector("dialog")!.hasAttribute("open")).toBe(false);
  });
});

it("registers the consumer handler inventory and coalesces publication while one snapshot is pending", async () => {
  const test = harness();
  const accepted: ((value: boolean) => void)[] = [];
  vi.mocked(test.bridge.publish).mockImplementation((snapshot) => {
    test.snapshots.push(snapshot);
    return new Promise((resolve) => {
      accepted.push(resolve);
    });
  });
  let controller!: import("../packages/renderer/src/command-controller.js").CommandController;
  const run = vi.fn(() => true);
  const disposed = vi.fn();
  const ids = [
    "settings.open",
    "zoom.increase",
    "zoom.decrease",
    "zoom.reset",
    "theme.system",
    "theme.light",
    "theme.dark",
    "panels.explorer",
    "panels.documents",
    "panels.chat",
    "document.focus",
    "layout.reset",
  ] as const;
  const registerHandlers = (registry: typeof controller) => {
    controller = registry;
    const remove = ids.map((id) => registry.register(id, { state: () => ({}), run }));
    return () => {
      remove.forEach((dispose) => dispose());
      disposed();
    };
  };
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US", registerHandlers }));
  expect(test.bridge.publish).toHaveBeenCalledOnce();
  await act(async () => {
    for (let i = 0; i < 50; i++) controller.changed();
  });
  expect(test.bridge.publish).toHaveBeenCalledOnce();
  await act(async () => accepted[0](true));
  expect(test.bridge.publish).toHaveBeenCalledTimes(2);
  expect(test.snapshots[1].revision).toBe(controller.snapshot().revision);
  for (const id of ids)
    await act(async () => {
      test.send(id);
    });
  expect(run).toHaveBeenCalledTimes(ids.length);
  await click(button("Ohtia help"));
  await click(button("Keyboard shortcuts", container.querySelector(".help-dialog")!));
  expect(container.querySelector(".shortcuts-dialog[open]")).not.toBeNull();
  expect(run).toHaveBeenCalledTimes(ids.length);
  await render(null);
  await act(async () => accepted[1](true));
  expect(disposed).toHaveBeenCalledOnce();
  expect(test.dispose).toHaveBeenCalledOnce();
  expect(await controller.invoke("window.new")).toEqual({ status: "revoked" });
});

it("keeps publication, native action and copy transport failures controlled in their current surface", async () => {
  const test = harness();
  vi.mocked(test.bridge.publish).mockResolvedValueOnce(false);
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
  expect(container.textContent).toContain(message("en-US", "command.failed"));
  vi.mocked(test.bridge.perform).mockRejectedValueOnce(new Error("private transport detail"));
  await act(async () => test.send("window.fullscreen"));
  expect(container.textContent).not.toContain("private transport detail");
  await click(button("About Ohtia"));
  vi.mocked(test.bridge.copyVersionInformation).mockRejectedValueOnce(
    new Error("clipboard transport"),
  );
  await click(button("Copy version information", container.querySelector(".about-dialog")!));
  expect(container.querySelector('.about-dialog [role="alert"]')!.textContent).toContain(
    message("en-US", "about.copyFailed"),
  );
  vi.mocked(test.bridge.openLink).mockRejectedValueOnce(new Error("link transport"));
  await click(container.querySelector(".about-dialog a")!);
  expect(container.querySelector(".about-dialog")!.textContent).toContain(
    message("en-US", "command.failed"),
  );
});

it("announces native version-copy outcomes in Help and the workspace without changing focus", async () => {
  const test = harness();
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
  await act(async () => test.send("version.copy"));
  expect(container.querySelector(":scope > .about-copied")!.textContent).toBe("Copied");
  await click(button("Ohtia help"));
  const help = container.querySelector(".help-dialog")!;
  const before = document.activeElement;
  await act(async () => test.send("version.copy"));
  expect(help.querySelector(".about-copied")!.textContent).toBe("Copied");
  expect(document.activeElement).toBe(before);
  vi.mocked(test.bridge.copyVersionInformation).mockResolvedValueOnce(false);
  await act(async () => test.send("version.copy"));
  expect(help.querySelector('[role="alert"]')!.textContent).toContain(
    message("en-US", "about.copyOutsideFailed"),
  );
  expect(document.activeElement).toBe(before);
  await click(button("Close", help));
  vi.mocked(test.bridge.copyVersionInformation).mockResolvedValueOnce(false);
  await act(async () => test.send("version.copy"));
  expect(container.querySelector(":scope > .command-danger")!.textContent).toContain(
    message("en-US", "about.copyOutsideFailed"),
  );
});

it.each(["resolve", "reject"] as const)(
  "settles pending About metadata after a locale change: %s",
  async (outcome) => {
    const test = harness();
    let resolve!: (value: AboutInformation) => void;
    let reject!: (error: Error) => void;
    vi.mocked(test.bridge.about).mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
    await click(button("About Ohtia"));
    await render(h(CommandSurfaces, { bridge: test.bridge, locale: "es-AR" }));
    await act(async () => {
      if (outcome === "resolve") resolve(info);
      else reject(new Error("synthetic failure"));
    });
    const about = container.querySelector(".about-dialog")!;
    expect(about.hasAttribute("open")).toBe(true);
    expect(test.bridge.about).toHaveBeenCalledOnce();
    expect(about.textContent).not.toContain(message("es-AR", "about.loading"));
    if (outcome === "resolve") {
      expect(about.textContent).toContain(info.version);
      expect(about.textContent).toContain("Versión");
    } else
      expect(about.querySelector('[role="alert"]')!.textContent).toBe(
        message("es-AR", "about.loadFailed"),
      );
  },
);

it("resets removed composition targets and distinguishes native mutable and read-only text targets", async () => {
  const test = harness();
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
  const entry = (id: string) => test.snapshots.at(-1)!.entries.find((entry) => entry.id === id)!;
  const input = document.createElement("input");
  input.readOnly = true;
  document.body.append(input);
  await act(async () => input.focus());
  expect(entry("edit.copy").reason).toBeUndefined();
  expect(entry("edit.paste").reason).toBe("no_edit_target");
  input.readOnly = false;
  await act(async () =>
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
  );
  expect(entry("help.open").reason).toBe("composing");
  expect(entry("application.quit").reason).toBeUndefined();
  await act(async () => input.remove());
  expect(entry("help.open").reason).toBeUndefined();
  const range = document.createElement("input");
  range.type = "range";
  document.body.append(range);
  await act(async () => range.focus());
  expect(entry("edit.copy").reason).toBe("no_edit_target");
});

it("closes Help and restores its origin before invoking a modal-aware consumer shortcuts dialog", async () => {
  const test = harness();
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
  const origin = button("Ohtia help");
  await act(async () => origin.focus());
  await click(origin);
  const action = button("Keyboard shortcuts", container.querySelector(".help-dialog")!);
  expect(action.getAttribute("aria-disabled")).not.toBe("true");
  await click(action);
  expect(container.querySelector(".help-dialog[open]")).toBeNull();
  expect(container.querySelector(".shortcuts-dialog[open]")).not.toBeNull();
  await click(container.querySelector(".shortcuts-dialog [data-close]")!);
  expect(document.activeElement).toBe(origin);
});

it("exposes the plus key in the ARIA shortcut grammar and keeps the collapsed disclosure target present", async () => {
  const controller = new CommandController(
    { windowGeneration: "aria-fixture", platform: "linux" },
    "en-US",
  );
  controller.register("zoom.increase", { state: () => ({}), run: () => true });
  await render(
    h(CommandButton, { id: "zoom.increase", controller, locale: "en-US", onInvoke: vi.fn() }),
  );
  expect(container.querySelector("button")!.getAttribute("aria-keyshortcuts")).toBe(
    "Control+Plus Control+=",
  );
  await render(
    h(AboutDialog, {
      open: true,
      locale: "en-US",
      info,
      copy: { phase: "idle", attempt: 0 },
      onCopy: vi.fn(),
      onClose: vi.fn(),
      onOpenLink: vi.fn(),
    }),
  );
  const disclosure = button("Third-party notices");
  expect(
    document.getElementById(disclosure.getAttribute("aria-controls")!)!.hasAttribute("hidden"),
  ).toBe(true);
});

it("keeps metadata while rejecting copy feedback for a superseded locale", async () => {
  const test = harness();
  let finish!: (ok: boolean) => void;
  vi.mocked(test.bridge.copyVersionInformation).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
  await click(button("About Ohtia"));
  await click(button("Copy version information", container.querySelector(".about-dialog")!));
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "es-AR" }));
  await act(async () => finish(true));
  const about = container.querySelector(".about-dialog")!;
  expect(about.textContent).toContain(info.version);
  expect(about.querySelector(".about-copied")).toBeNull();
  expect(test.bridge.copyVersionInformation).toHaveBeenCalledWith("en-US");
  await click(button(message("es-AR", "command.version.copy"), about));
  expect(test.bridge.copyVersionInformation).toHaveBeenLastCalledWith("es-AR");
  expect(about.querySelector(".about-copied")!.textContent).toBe(message("es-AR", "about.copied"));
});

it("revokes a replaced composition without letting its late copy clear the current busy state", async () => {
  const first = harness(),
    next = harness();
  let finishOld!: (ok: boolean) => void, finishNew!: (ok: boolean) => void;
  vi.mocked(first.bridge.copyVersionInformation).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  vi.mocked(next.bridge.context).mockResolvedValue({
    windowGeneration: "window-2",
    platform: "linux",
  });
  vi.mocked(next.bridge.copyVersionInformation).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishNew = resolve;
      }),
  );
  await render(h(CommandSurfaces, { bridge: first.bridge, locale: "en-US" }));
  await click(button("About Ohtia"));
  await click(button("Copy version information", container.querySelector(".about-dialog")!));
  await render(h(CommandSurfaces, { bridge: next.bridge, locale: "en-US" }));
  expect(container.querySelector("dialog[open]")).toBeNull();
  await click(button("About Ohtia"));
  const about = container.querySelector(".about-dialog")!;
  const copy = button("Copy version information", about);
  await click(copy);
  await act(async () => finishOld(true));
  expect(copy.getAttribute("aria-disabled")).toBe("true");
  expect(about.querySelector(".about-copied")).toBeNull();
  await act(async () => finishNew(true));
  expect(copy.getAttribute("aria-disabled")).not.toBe("true");
  expect(about.querySelector(".about-copied")!.textContent).toBe("Copied");
});

it("selects the approved rendition at the actual physical-width threshold and follows density/size changes", async () => {
  let width = 128;
  vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ width, height: width }) as DOMRect,
  );
  const props = {
    open: true,
    locale: "en-US" as const,
    info,
    copy: { phase: "idle" as const, attempt: 0 },
    onCopy: vi.fn(),
    onClose: vi.fn(),
    onOpenLink: vi.fn(),
  };
  density(4);
  await render(h(AboutDialog, props));
  const image = () => container.querySelector("img")!;
  expect(image().getAttribute("src")).toBe("/branding/illustration.png");
  const change = async (ratio: number) => {
    const listeners = [...mediaQueries.at(-1)!.listeners];
    await act(async () => {
      density(ratio);
      listeners.forEach((listener) => listener());
    });
  };
  await change(8);
  expect(image().getAttribute("src")).toBe("/branding/illustration.svg");
  await act(async () => {
    width = 64;
    imageObservers[0].callback();
  });
  expect(image().getAttribute("src")).toBe("/branding/illustration.png");
  await act(async () => {
    width = 64.01;
    imageObservers[0].callback();
  });
  expect(image().getAttribute("src")).toBe("/branding/illustration.svg");
  await change(4);
  expect(image().getAttribute("src")).toBe("/branding/illustration.png");
  expect(mediaQueries.flatMap((record) => [...record.listeners])).toHaveLength(1);
  const late = [...mediaQueries.at(-1)!.listeners];
  await render(null);
  expect(imageObservers[0].disconnect).toHaveBeenCalledOnce();
  expect(mediaQueries.flatMap((record) => [...record.listeners])).toHaveLength(0);
  const queries = mediaQueries.length;
  await act(async () => {
    imageObservers[0].callback();
    late.forEach((listener) => listener());
  });
  expect(mediaQueries).toHaveLength(queries);
});

it("closes from the top button without treating a mouse event as a handoff intent", async () => {
  const test = harness();
  let controller!: CommandController;
  const registerHandlers = (value: CommandController) => {
    controller = value;
    return () => {};
  };
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US", registerHandlers }));
  await click(button("About Ohtia"));
  const invoke = vi.spyOn(controller, "invoke");
  await click(container.querySelector(".about-dialog [data-close]")!);
  expect(container.querySelector("dialog[open]")).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it("preserves a live composition target across registry replacement and clears it when removed", async () => {
  const first = harness(),
    next = harness();
  await render(h(CommandSurfaces, { bridge: first.bridge, locale: "en-US" }));
  const input = document.createElement("textarea");
  document.body.append(input);
  await act(async () => {
    input.focus();
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  });
  await render(h(CommandSurfaces, { bridge: next.bridge, locale: "en-US" }));
  const reason = () =>
    next.snapshots.at(-1)!.entries.find((entry) => entry.id === "help.open")!.reason;
  expect(reason()).toBe("composing");
  await act(async () => input.remove());
  expect(reason()).toBeUndefined();
});

it("opens the native application menu below its actual button and restores focus after dismissal", async () => {
  const test = harness();
  let dismissed!: (result: import("@ohtia/contracts").WindowCommandResult) => void;
  vi.mocked(test.bridge.windowAction).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        dismissed = resolve;
      }),
  );
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
  const menu = button("Application menu");
  menu.getBoundingClientRect = () => ({ left: 8, bottom: 48 }) as DOMRect;
  expect(menu.getAttribute("aria-haspopup")).toBe("menu");
  expect(menu.getAttribute("aria-keyshortcuts")).toBe("F10");
  await click(menu);
  expect(test.bridge.windowAction).toHaveBeenCalledWith({
    intent: expect.objectContaining({ command: "menu.open", source: "renderer" }),
    anchor: { x: 8, y: 48 },
  });
  await act(async () => {
    button("Ohtia help").focus();
  });
  await act(async () => dismissed({ status: "completed", menuDismissed: true }));
  expect(document.activeElement).toBe(menu);
  vi.mocked(test.bridge.windowAction).mockResolvedValueOnce({ status: "failed" });
  await click(menu);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    message("en-US", "command.failed"),
  );
});
it("retains dialog focus after a menu-selected command and leaves the macOS system menu with its owner", async () => {
  const test = harness();
  let dismissed!: (result: import("@ohtia/contracts").WindowCommandResult) => void;
  vi.mocked(test.bridge.windowAction).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        dismissed = resolve;
      }),
  );
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
  await click(button("Application menu"));
  await act(async () => {
    test.send("about.open");
  });
  const active = document.activeElement;
  await act(async () => dismissed({ status: "completed", menuDismissed: true }));
  expect(document.activeElement).toBe(active);
  const mac = harness();
  vi.mocked(mac.bridge.context).mockResolvedValue({
    windowGeneration: "mac-window",
    platform: "darwin",
  });
  await render(h(CommandSurfaces, { bridge: mac.bridge, locale: "en-US" }));
  expect(
    [...container.querySelectorAll("button")].some(
      (value) => value.textContent === "Application menu",
    ),
  ).toBe(false);
  expect(mac.snapshots.at(-1)?.entries.find((entry) => entry.id === "menu.open")?.reason).toBe(
    "handler_missing",
  );
});

it("lets focused surfaces consume menu keys and cancels lone Alt on chords, pointers, composition and blur", async () => {
  const { bridge } = harness();
  await render(h(CommandSurfaces, { bridge, locale: "en-US" }));
  const target = button(message("en-US", "command.menu.open"));
  const key = async (type: string, value: KeyboardEventInit) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...value }));
    });
  };
  const consume = (event: Event) => event.preventDefault();
  target.addEventListener("keydown", consume);
  await key("keydown", { key: "F10", code: "F10" });
  await key("keydown", { key: "Alt", code: "AltLeft", altKey: true });
  await key("keyup", { key: "Alt", code: "AltLeft" });
  expect(bridge.windowAction).not.toHaveBeenCalled();
  target.removeEventListener("keydown", consume);
  const stop = (event: Event) => event.stopPropagation();
  target.addEventListener("keydown", stop);
  await key("keydown", { key: "F10", code: "F10" });
  target.removeEventListener("keydown", stop);
  await key("keydown", { key: "F10", code: "F10" });
  expect(bridge.windowAction).toHaveBeenCalledTimes(1);
  await key("keydown", { key: "Alt", code: "AltLeft", altKey: true });
  await key("keyup", { key: "Alt", code: "AltLeft" });
  expect(bridge.windowAction).toHaveBeenCalledTimes(2);
  for (const cancel of [
    () => target.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    () => window.dispatchEvent(new Event("blur")),
    () => target.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    () =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "x", code: "KeyX", bubbles: true })),
  ]) {
    await key("keydown", { key: "Alt", code: "AltLeft", altKey: true });
    await act(async () => {
      cancel();
    });
    await key("keyup", { key: "Alt", code: "AltLeft" });
    await act(async () => {
      target.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
  }
  for (const value of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { repeat: true },
    { isComposing: true },
    { altKey: true },
  ])
    await key("keydown", { key: "F10", code: "F10", ...value });
  await key("keydown", { key: "Alt", code: "AltRight", altKey: true });
  await key("keyup", { key: "Alt", code: "AltRight" });
  expect(bridge.windowAction).toHaveBeenCalledTimes(2);
});

it("preserves the editable surface's focus when a native popup command is selected", async () => {
  const test = harness();
  let finish!: (value: import("@ohtia/contracts").WindowCommandResult) => void;
  vi.mocked(test.bridge.windowAction).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
  const input = document.createElement("input");
  container.append(input);
  await act(async () => {
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F10", code: "F10", bubbles: true, cancelable: true }),
    );
  });
  expect(test.bridge.windowAction).toHaveBeenCalledOnce();
  await act(async () => finish({ status: "completed", menuDismissed: false }));
  expect(document.activeElement).toBe(input);
});

it.each(["window.new", "menu.open"] as const)(
  "shows the controlled failure for rejected %s transport",
  async (command) => {
    const test = harness();
    vi.mocked(test.bridge.windowAction).mockRejectedValueOnce(
      new Error("Synthetic private transport detail"),
    );
    await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
    await click(
      button(
        message("en-US", command === "menu.open" ? "command.menu.open" : "command.window.new"),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      message("en-US", "command.failed"),
    );
    expect(container.textContent).not.toContain("Synthetic private transport detail");
  },
);
it("keeps the editable target through primary pointer activation of the native menu", async () => {
  const test = harness();
  vi.mocked(test.bridge.windowAction).mockResolvedValueOnce({
    status: "completed",
    menuDismissed: false,
  });
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
  const input = document.createElement("input");
  input.value = "Selected text";
  container.append(input);
  const menu = button(message("en-US", "command.menu.open"));
  await act(async () => {
    input.focus();
    input.setSelectionRange(0, 8);
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    menu.dispatchEvent(down);
    // Model the browser focus default, which JSDOM does not implement for pointer dispatch.
    if (!down.defaultPrevented) menu.focus();
    menu.click();
  });
  expect(
    test.snapshots.at(-1)?.entries.find((entry) => entry.id === "edit.paste")?.reason,
  ).toBeUndefined();
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(8);
});

it("does not announce a late transport rejection from a replaced command lease", async () => {
  const first = harness();
  let reject!: (reason: Error) => void;
  vi.mocked(first.bridge.windowAction).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await render(h(CommandSurfaces, { bridge: first.bridge, locale: "en-US" }));
  await click(button(message("en-US", "command.window.new")));
  const next = harness();
  await render(h(CommandSurfaces, { bridge: next.bridge, locale: "en-US" }));
  await act(async () => reject(new Error("Synthetic old transport detail")));
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("keeps deliberate menu revocation silent without stealing replacement focus", async () => {
  const test = harness();
  vi.mocked(test.bridge.windowAction).mockResolvedValueOnce({ status: "revoked" });
  await render(h(CommandSurfaces, { bridge: test.bridge, locale: "en-US" }));
  const input = document.createElement("input");
  container.append(input);
  await act(async () => input.focus());
  await click(button(message("en-US", "command.menu.open")));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(document.activeElement).toBe(input);
});

it("invalidates command feedback when its current availability changes without a new activation", async () => {
  const test = harness();
  let busy = true;
  let registry!: CommandController;
  const register = (controller: CommandController) => {
    registry = controller;
    return controller.register("zoom.increase", {
      state: () => (busy ? { reason: "busy" } : {}),
      run: () => true,
    });
  };
  await render(
    h(CommandSurfaces, { bridge: test.bridge, locale: "en-US", registerHandlers: register }),
  );
  await act(async () => test.send("zoom.increase"));
  expect(container.querySelector(".command-unavailable")?.textContent).toBe(
    message("en-US", "command.reason.busy"),
  );
  await act(async () => {
    busy = false;
    registry.changed();
  });
  expect(container.querySelector(".command-unavailable")).toBeNull();
  await act(async () => {
    busy = true;
    registry.changed();
  });
  expect(container.querySelector(".command-unavailable")).toBeNull();
});

it.each(["help.open", "about.open", "settings.open"] as const)(
  "preserves child composition and its fallback focus when the %s trigger disappears",
  async (command) => {
    const test = harness();
    const fallback = document.createElement("a");
    fallback.href = "#workspace";
    fallback.textContent = "Skip to workspace";
    document.body.prepend(fallback);
    let showTrigger = true;
    const props: Parameters<typeof CommandSurfaces>[0] = {
      bridge: test.bridge,
      locale: "en-US",
      returnFocusRef: { current: fallback },
      children: (registry) =>
        showTrigger &&
        h("button", { onClick: () => void registry?.invoke(command) }, "Open synthetic surface"),
      renderSettings: (open, close, _platform, _feedback, returnFocusRef) =>
        h(Dialog, {
          open,
          title: "Synthetic Settings",
          closeLabel: "Close",
          onClose: close,
          returnFocusRef,
          children: "Synthetic settings controls",
        }),
    };
    await render(h(CommandSurfaces, props));
    expect(container.querySelector(".command-entry-actions")).toBeNull();
    const trigger = button("Open synthetic surface");
    await act(async () => trigger.focus());
    await click(trigger);
    expect(container.querySelectorAll("dialog[open]")).toHaveLength(1);
    showTrigger = false;
    await render(h(CommandSurfaces, props));
    expect(trigger.isConnected).toBe(false);
    await click(container.querySelector("dialog[open] [data-close]")!);
    expect(container.querySelector("dialog[open]")).toBeNull();
    expect(document.activeElement).toBe(fallback);
    fallback.remove();
  },
);

describe("macOS command-wheel routing", () => {
  const wheel = async (
    options: WheelEventInit = {},
    native: { momentum?: boolean; ticks?: number; missing?: boolean } = {},
  ) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -120,
      metaKey: true,
      ...options,
    });
    // Controlled Blink fields; these tests do not establish native wheel delivery.
    if (!native.missing)
      Object.defineProperties(event, {
        wheelDeltaY: {
          value: Math.trunc(
            ((native.ticks ?? -(options.deltaY ?? -120) / 120) * 120) / window.devicePixelRatio,
          ),
        },
        momentum: { value: native.momentum ?? false },
      });
    await act(async () => document.body.dispatchEvent(event));
    return event;
  };
  it.each(["linux", "win32", "darwin"] as const)(
    "owns Cmd+wheel only in the macOS composition (%s)",
    async (platform) => {
      const test = harness(platform);
      const increase = vi.fn(() => true);
      const decrease = vi.fn(() => true);
      await render(
        h(CommandSurfaces, {
          bridge: test.bridge,
          locale: "en-US",
          registerHandlers: (registry) => {
            const disposals = [
              registry.register("zoom.increase", { state: () => ({}), run: increase }),
              registry.register("zoom.decrease", { state: () => ({}), run: decrease }),
            ];
            return () => disposals.forEach((dispose) => dispose());
          },
        }),
      );
      expect((await wheel()).defaultPrevented).toBe(platform === "darwin");
      expect((await wheel({ deltaY: 120 })).defaultPrevented).toBe(platform === "darwin");
      expect(increase).toHaveBeenCalledTimes(platform === "darwin" ? 1 : 0);
      expect(decrease).toHaveBeenCalledTimes(platform === "darwin" ? 1 : 0);
      for (const options of [
        { metaKey: false },
        { ctrlKey: true },
        { altKey: true },
        { shiftKey: true },
        { deltaY: 0 },
      ])
        expect((await wheel(options)).defaultPrevented).toBe(false);
      await act(async () =>
        document.body.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
      );
      expect((await wheel()).defaultPrevented).toBe(false);
      await act(async () =>
        document.body.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
      );
      await render(null);
      expect((await wheel()).defaultPrevented).toBe(false);
      expect(increase).toHaveBeenCalledTimes(platform === "darwin" ? 1 : 0);
    },
  );
  it.each([1, 1.1, 2, 2.5, 4])(
    "accumulates fractions at density %s without turning a burst into four zoom steps",
    async (value) => {
      density(value);
      const test = harness("darwin");
      const increase = vi.fn(() => true);
      await render(
        h(CommandSurfaces, {
          bridge: test.bridge,
          locale: "en-US",
          registerHandlers: (registry) =>
            registry.register("zoom.increase", { state: () => ({}), run: increase }),
        }),
      );
      await wheel({ deltaY: -30 });
      expect(increase).not.toHaveBeenCalled();
      for (let index = 0; index < 3; index++) await wheel({ deltaY: -30 });
      expect(increase).toHaveBeenCalledOnce();
      await wheel();
      expect(increase).toHaveBeenCalledTimes(2);
    },
  );
  it.each([...new Set(interfaceZooms.flatMap((percent) => [percent / 100, percent / 50]))])(
    "preserves long whole-notch sequences at admitted density %s",
    async (value) => {
      density(value);
      const test = harness("darwin");
      const increase = vi.fn(() => true);
      const decrease = vi.fn(() => true);
      await render(
        h(CommandSurfaces, {
          bridge: test.bridge,
          locale: "en-US",
          registerHandlers: (registry) => {
            const dispose = [
              registry.register("zoom.increase", { state: () => ({}), run: increase }),
              registry.register("zoom.decrease", { state: () => ({}), run: decrease }),
            ];
            return () => dispose.forEach((stop) => stop());
          },
        }),
      );
      for (let index = 0; index < 128; index++) await wheel();
      expect(increase).toHaveBeenCalledTimes(128);
      await act(async () => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" })));
      for (let index = 0; index < 128; index++) await wheel({ deltaY: 120 });
      expect(decrease).toHaveBeenCalledTimes(128);
    },
  );
  it("ignores momentum, resets partial gestures and uses native tick direction", async () => {
    const test = harness("darwin");
    const increase = vi.fn(() => true);
    const decrease = vi.fn(() => true);
    await render(
      h(CommandSurfaces, {
        bridge: test.bridge,
        locale: "en-US",
        registerHandlers: (registry) => {
          const dispose = [
            registry.register("zoom.increase", { state: () => ({}), run: increase }),
            registry.register("zoom.decrease", { state: () => ({}), run: decrease }),
          ];
          return () => dispose.forEach((stop) => stop());
        },
      }),
    );
    expect((await wheel({}, { momentum: true })).defaultPrevented).toBe(false);
    expect((await wheel({}, { missing: true })).defaultPrevented).toBe(false);
    expect((await wheel({}, { ticks: Number.NaN })).defaultPrevented).toBe(false);
    const prevented = (event: Event) => event.preventDefault();
    document.body.addEventListener("wheel", prevented, { passive: false });
    expect((await wheel()).defaultPrevented).toBe(true);
    document.body.removeEventListener("wheel", prevented);
    expect(increase).not.toHaveBeenCalled();
    for (const reset of [
      async () => {
        await act(async () => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" })));
      },
      async () => {
        await act(async () => window.dispatchEvent(new Event("blur")));
      },
      async () => {
        await wheel({}, { momentum: true });
      },
      async () => {
        await wheel({ metaKey: false });
      },
    ]) {
      await wheel({ deltaY: -30 });
      await reset();
      await wheel({ deltaY: -30 });
      expect(increase).not.toHaveBeenCalled();
      await reset();
    }
    // A zero-displacement synthetic end cannot replay a notch or clear its fraction.
    await wheel({ deltaY: -30 });
    await wheel({ deltaY: 0 }, { ticks: 1 });
    await wheel({ deltaY: -30 });
    expect(increase).toHaveBeenCalledOnce();
    await wheel({ deltaY: -30 }, { ticks: -1 });
    expect(decrease).toHaveBeenCalledOnce();
  });
  it("rejects a pending notch without replay and replaces the disposed owner", async () => {
    let finish!: (value: boolean) => void;
    let busy = false;
    const increase = vi.fn(() => {
      busy = true;
      return new Promise<boolean>((resolve) => {
        finish = resolve;
      });
    });
    const mount = async () => {
      const test = harness("darwin");
      await render(
        h(CommandSurfaces, {
          bridge: test.bridge,
          locale: "en-US",
          registerHandlers: (registry) =>
            registry.register("zoom.increase", {
              state: () => (busy ? { reason: "busy" } : {}),
              run: increase,
            }),
        }),
      );
    };
    await mount();
    await wheel();
    expect(increase).toHaveBeenCalledOnce();
    await wheel();
    expect(increase).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(message("en-US", "command.reason.busy"));
    await act(async () => {
      busy = false;
      finish(true);
    });
    expect(increase).toHaveBeenCalledOnce();
    await render(null);
    await mount();
    await wheel();
    expect(increase).toHaveBeenCalledTimes(2);
    await act(async () => {
      busy = false;
      finish(true);
    });
  });
});
