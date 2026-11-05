// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CommandSurfaces } from "../packages/renderer/src/command-surfaces.js";
import { paletteCommands, shortcutLabel } from "../packages/renderer/src/command-discovery.js";
import { CommandController } from "../packages/renderer/src/command-controller.js";
import {
  commandDefinitions,
  componentShortcutDefinitions,
  supportedLocales,
  message,
  type CommandBridge,
  type CommandId,
  type CommandIntent,
  type CommandPlatform,
  type CommandSnapshot,
} from "../packages/contracts/src/index.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
let origin: HTMLTextAreaElement;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  origin = document.createElement("textarea");
  origin.value = "Researcher draft 연구 초안";
  document.body.append(origin, host);
  root = createRoot(host);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const render = async (node: Parameters<Root["render"]>[0]) => {
  await act(async () => root.render(node));
};
const key = async (element: Element, key: string, options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => element.dispatchEvent(event));
  return event;
};
const input = () => host.querySelector<HTMLInputElement>('[role="combobox"]')!;
async function query(value: string) {
  const element = input();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const option = (id: CommandId) => host.querySelector<HTMLElement>(`[role=option][id$="-${id}"]`)!;
function harness(platform: CommandPlatform = "linux") {
  let send: (intent: CommandIntent) => void = () => {};
  let sequence = 0;
  let registry!: CommandController;
  const snapshots: CommandSnapshot[] = [];
  const dispose = vi.fn();
  const bridge: CommandBridge = {
    context: async () => ({ windowGeneration: "origin-window", platform }),
    publish: async (snapshot) => {
      snapshots.push(snapshot);
      return true;
    },
    onIntent: (listener) => {
      send = listener;
      return dispose;
    },
    about: vi.fn(),
    windowAction: vi.fn(async () => ({ status: "completed" as const })),
    perform: vi.fn(async () => true),
    copyVersionInformation: vi.fn(async () => true),
    openLink: vi.fn(async () => true),
  };
  const registerHandlers = (controller: CommandController) => {
    registry = controller;
    return () => {};
  };
  return {
    bridge,
    snapshots,
    dispose,
    registerHandlers,
    get registry() {
      return registry;
    },
    send: (command: CommandId) =>
      send({ windowGeneration: "origin-window", source: "native", sequence: ++sequence, command }),
    open: async () => {
      await act(async () => {
        origin.focus();
        send({
          windowGeneration: "origin-window",
          source: "native",
          sequence: ++sequence,
          command: "palette.open",
        });
      });
    },
  };
}

describe("command discovery", () => {
  it("filters accented and Korean labels and groups by substring, preserving registry order within each group", () => {
    expect(paletteCommands("fr-FR", "EDITION").map((command) => command.id)).toEqual(
      commandDefinitions.filter((command) => command.group === "edit").map((command) => command.id),
    );
    expect(
      paletteCommands("es-AR", "APARIENCIA").some((command) => command.id === "theme.dark"),
    ).toBe(true);
    expect(paletteCommands("ko-KR", "확대").map((command) => command.id)).toContain(
      "zoom.increase",
    );
    expect(paletteCommands("ko-KR", "화").map((command) => command.id)).not.toContain(
      "zoom.increase",
    );
    expect(paletteCommands("ko-KR", "확대").map((command) => command.id)).toContain(
      "zoom.increase",
    );
    expect(paletteCommands("en-US", "zzzzzz")).toEqual([]);
  });
  it.each(["win32", "linux", "darwin"] as const)(
    "shows exact registry options, reasons and %s bindings with origin edit availability",
    async (platform) => {
      const test = harness(platform);
      await render(h(CommandSurfaces, { ...test, locale: "en-US" }));
      await test.open();
      expect(document.activeElement).toBe(input());
      expect(host.querySelectorAll('[role="option"]')).toHaveLength(commandDefinitions.length);
      expect(input().getAttribute("aria-controls")).toBe(
        host.querySelector('[role="listbox"]')!.id,
      );
      expect(option("settings.open").getAttribute("aria-disabled")).toBe("true");
      expect(option("settings.open").textContent).toContain(
        message("en-US", "command.reason.handler_missing"),
      );
      expect(option("edit.paste").getAttribute("aria-disabled")).toBe("false");
      expect(option("help.open").getAttribute("aria-disabled")).toBe("false");
      expect(test.snapshots.at(-1)!.entries.find((entry) => entry.id === "help.open")!.reason).toBe(
        "modal_open",
      );
      expect(option("palette.open").textContent).toContain(
        platform === "darwin" ? "Cmd+Shift+P" : "Ctrl+Shift+P",
      );
      expect(option("zoom.increase").getAttribute("aria-keyshortcuts")).toBe(
        platform === "darwin" ? "Meta+Plus Meta+=" : "Control+Plus Control+=",
      );
      expect(option("menu.open").getAttribute("aria-keyshortcuts")).toBe(
        platform === "darwin" ? null : "F10",
      );
      await key(input(), "Escape");
      expect(document.activeElement).toBe(origin);
      expect(origin.value).toBe("Researcher draft 연구 초안");
      // A non-editable origin must not borrow the palette input's editing capability.
      const trigger = host.querySelector<HTMLButtonElement>("button")!;
      await act(async () => {
        trigger.focus();
        test.send("palette.open");
      });
      expect(option("edit.paste").getAttribute("aria-disabled")).toBe("true");
    },
  );
  it("navigates unavailable options, handles empty results, resets queries and respects composition", async () => {
    const test = harness();
    await render(h(CommandSurfaces, { ...test, locale: "en-US" }));
    await test.open();
    const initial = input().getAttribute("aria-activedescendant");
    await key(input(), "ArrowUp");
    await key(input(), "ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe(initial);
    await query("No such command <b>연구</b>");
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
    expect(host.querySelector('.palette-empty[role="status"]')!.textContent).toBe(
      "No command matches «No such command <b>연구</b>».",
    );
    expect(host.querySelector('.palette-empty[role="status"] b')).toBeNull();
    await key(input(), "ArrowDown");
    await key(input(), "Enter");
    await query("Ohtia help");
    await act(async () =>
      input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    const active = input().getAttribute("aria-activedescendant");
    await key(input(), "Enter");
    await key(input(), "ArrowDown", { isComposing: true });
    expect(input().getAttribute("aria-activedescendant")).toBe(active);
    expect(host.querySelector(".command-palette[open]")).not.toBeNull();
    await act(async () =>
      input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
    );
    await key(input(), "Enter", { isComposing: true });
    await key(input(), "Enter", { keyCode: 229 });
    await key(input(), "Enter", { repeat: true });
    expect(host.querySelector(".help-dialog[open]")).toBeNull();
    await key(input(), "Escape");
    await test.open();
    expect(input().value).toBe("");
  });
  it.each(["Enter", "NumpadEnter"])(
    "keeps Korean IME confirmation on %s separate from the next command activation",
    async (code) => {
      const test = harness("win32");
      const run = vi.fn(async () => true);
      await render(h(CommandSurfaces, { ...test, locale: "ko-KR" }));
      await act(async () => {
        test.registry.register("settings.open", { state: () => ({}), run });
      });
      await test.open();
      await act(async () =>
        input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
      );
      await query("설정");
      // Windows emits both keydowns before either keyup for one physical IME confirmation.
      await key(input(), "Process", { code, keyCode: 229, isComposing: true });
      await act(async () =>
        input().dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true, data: "정" }),
        ),
      );
      await key(input(), "Enter", { code, keyCode: 13 });
      expect(run).not.toHaveBeenCalled();
      await key(input(), "Enter", { code, repeat: true });
      await act(async () =>
        input().dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true })),
      );
      await key(input(), "Enter", { code });
      expect(run).not.toHaveBeenCalled();
      expect(input().value).toBe("설정");
      expect(document.activeElement).toBe(input());
      expect(host.querySelector(".command-palette[open]")).not.toBeNull();
      await act(async () => {
        input().dispatchEvent(new KeyboardEvent("keyup", { key: "Process", code, bubbles: true }));
        input().dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code, bubbles: true }));
      });
      await key(input(), "Enter", { code });
      expect(run).toHaveBeenCalledOnce();
      expect(host.querySelector(".command-palette[open]")).toBeNull();
      expect(document.activeElement).toBe(origin);
    },
  );
  it.each([" ", "Escape", "a"])(
    "allows a deliberate Enter after composition ends with %j",
    async (commitKey) => {
      const test = harness();
      await render(h(CommandSurfaces, { ...test, locale: "en-US" }));
      await test.open();
      await query("Ohtia help");
      await act(async () =>
        input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
      );
      await key(input(), commitKey, { isComposing: true });
      await act(async () =>
        input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
      );
      await key(input(), "Enter");
      expect(host.querySelector(".help-dialog[open]")).not.toBeNull();
    },
  );
  it.each(["pointer", "blur", "window blur", "reopen"])(
    "allows explicit activation after IME confirmation and %s without observing its keyup",
    async (gesture) => {
      const test = harness();
      await render(h(CommandSurfaces, { ...test, locale: "en-US" }));
      await test.open();
      await query("Ohtia help");
      await act(async () =>
        input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
      );
      await key(input(), "Enter", { code: "Enter" });
      await act(async () =>
        input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
      );
      if (gesture === "pointer") {
        await act(async () => option("help.open").click());
      } else {
        if (gesture === "window blur") {
          await act(async () => window.dispatchEvent(new Event("blur")));
        } else if (gesture === "blur") {
          await act(async () => {
            host.querySelector<HTMLButtonElement>(".command-palette button")!.focus();
            input().focus();
          });
        } else {
          await key(input(), "Escape");
          await test.open();
          await query("Ohtia help");
        }
        await key(input(), "Enter");
      }
      expect(host.querySelector(".help-dialog[open]")).not.toBeNull();
    },
  );
  it("updates late availability, refuses disabled activation and closes before exactly one invocation in the origin context", async () => {
    const test = harness();
    await render(h(CommandSurfaces, { ...test, locale: "en-US" }));
    let busy = true;
    let finish!: (value: boolean) => void;
    const run = vi.fn(
      (execution: Parameters<Parameters<CommandController["register"]>[1]["run"]>[0]) => {
        expect(host.querySelector("dialog[open]")).toBeNull();
        expect(document.activeElement).toBe(origin);
        expect(execution.context.windowGeneration).toBe("origin-window");
        return new Promise<boolean>((resolve) => {
          finish = resolve;
        });
      },
    );
    let unregister!: () => void;
    await act(async () => {
      unregister = test.registry.register("layout.reset", {
        state: () => (busy ? { reason: "busy" } : {}),
        run,
      });
    });
    await test.open();
    await query("Reset layout");
    await key(input(), "Enter");
    await act(async () => option("layout.reset").click());
    expect(run).not.toHaveBeenCalled();
    await act(async () => {
      busy = false;
      test.registry.changed();
    });
    expect(option("layout.reset").getAttribute("aria-disabled")).toBe("false");
    await act(async () => {
      option("layout.reset").click();
      option("layout.reset").click();
    });
    expect(run).toHaveBeenCalledOnce();
    await render(null);
    unregister();
    await act(async () => finish(true));
    expect(test.dispose).toHaveBeenCalledOnce();
    expect(await test.registry.invoke("palette.open")).toEqual({ status: "revoked" });
  });
  it("hands off to another dialog and restores the original target after that dialog closes", async () => {
    const test = harness();
    await render(h(CommandSurfaces, { ...test, locale: "en-US" }));
    await test.open();
    await query("Keyboard shortcuts");
    await key(input(), "Enter");
    expect(host.querySelector(".command-palette[open]")).toBeNull();
    expect(host.querySelector(".shortcuts-dialog[open]")).not.toBeNull();
    await key(host.querySelector(".shortcuts-dialog")!, "Escape");
    expect(document.activeElement).toBe(origin);
  });
  it("refuses modal conflicts and stale deliveries without opening a second surface", async () => {
    const test = harness();
    await render(h(CommandSurfaces, { ...test, locale: "en-US" }));
    const other = document.createElement("dialog");
    document.body.append(other);
    await act(async () => {
      other.showModal();
    });
    await test.open();
    expect(host.querySelector(".command-palette[open]")).toBeNull();
    expect(
      test.snapshots.at(-1)!.entries.find((entry) => entry.id === "palette.open")!.reason,
    ).toBe("modal_open");
    await act(async () => other.remove());
    await test.open();
    await act(async () => test.send("shortcuts.open"));
    expect(host.querySelectorAll("dialog[open]")).toHaveLength(1);
    expect(host.querySelector(".command-palette[open]")).not.toBeNull();
    expect(
      await test.registry.receive({
        windowGeneration: "other-window",
        source: "native",
        sequence: 999,
        command: "palette.open",
      }),
    ).toEqual({ status: "stale_context" });
  });
  it.each(["win32", "linux", "darwin"] as const)(
    "generates the %s shortcuts table from every bound command and declared scoped key",
    async (platform) => {
      const test = harness(platform);
      await render(h(CommandSurfaces, { ...test, locale: "en-US" }));
      expect(host.querySelector(".shortcuts-dialog")).toBeNull();
      await act(async () => test.send("shortcuts.open"));
      const expected = [
        ...commandDefinitions.filter((command) => command.shortcuts[platform].length),
        ...componentShortcutDefinitions,
      ];
      expect(host.querySelectorAll("[data-shortcut-id]")).toHaveLength(expected.length);
      for (const command of expected) {
        const row = host.querySelector(`[data-shortcut-id="${command.id}"]`)!;
        expect(row.querySelector("th")!.textContent).toBe(message("en-US", command.label));
        expect([...row.querySelectorAll("kbd")].map((key) => key.textContent)).toEqual(
          command.shortcuts[platform].map(shortcutLabel),
        );
      }
      expect(host.querySelectorAll('th[scope="rowgroup"]')).toHaveLength(5);
      expect(
        [...host.querySelectorAll('[data-shortcut-id="separator.step"] kbd')].map(
          (key) => key.textContent,
        ),
      ).toEqual(["←", "→"]);
      expect(host.querySelector('[data-shortcut-id="dialogs.close"] kbd')!.textContent).toBe("Esc");
      await key(host.querySelector(".shortcuts-dialog")!, "Escape");
      expect(host.querySelector(".shortcuts-dialog")).toBeNull();
    },
  );
  it.each(supportedLocales)(
    "renders both surfaces and preserves input through a live switch to %s",
    async (locale) => {
      const test = harness();
      await render(h(CommandSurfaces, { ...test, locale: "en-US" }));
      await test.open();
      await query("연구");
      const target = input();
      await render(h(CommandSurfaces, { ...test, locale }));
      expect(input()).toBe(target);
      expect(input().value).toBe("연구");
      expect(document.activeElement).toBe(target);
      expect(input().getAttribute("aria-label")).toBe(message(locale, "palette.input"));
      await query("");
      expect(host.querySelectorAll('[role="option"]')).toHaveLength(commandDefinitions.length);
      await key(input(), "Escape");
      await act(async () => test.send("shortcuts.open"));
      expect(host.querySelector(".shortcuts-table")!.textContent).toContain(
        message(locale, "shortcuts.separator.reset"),
      );
    },
  );
});

it.each(["palette.open", "shortcuts.open"] as const)(
  "keeps failed and refused command feedback inspectable in %s",
  async (command) => {
    const test = harness();
    await render(
      h(CommandSurfaces, {
        ...test,
        locale: "en-US",
        renderFeedback: () => h("div", { className: "settings-feedback", hidden: true }),
      }),
    );
    await act(async () => {
      origin.focus();
      test.send(command);
    });
    const dialog = () => host.querySelector("dialog[open]")!;
    vi.mocked(test.bridge.perform).mockResolvedValueOnce(false);
    await act(async () => test.send("window.fullscreen"));
    const feedback = dialog().querySelector<HTMLElement>(".discovery-feedback-scroll")!;
    expect(feedback.tabIndex).toBe(0);
    expect(feedback.getAttribute("role")).toBe("region");
    expect(feedback.getAttribute("aria-label")).toBe(message("en-US", "command.feedback"));

    expect(dialog().querySelector('[role="alert"]')!.textContent).toBe(
      message("en-US", "command.failed"),
    );
    await act(async () => test.send("help.open"));
    expect(dialog().querySelector(".command-unavailable")!.textContent).toBe(
      message("en-US", "command.reason.modal_open"),
    );
    expect(host.querySelectorAll("dialog[open]")).toHaveLength(1);
    vi.mocked(test.bridge.copyVersionInformation).mockResolvedValueOnce(false);
    await act(async () => test.send("version.copy"));
    expect(dialog().textContent).toContain(message("en-US", "about.copyOutsideFailed"));
    await act(async () => test.send("version.copy"));
    expect(dialog().querySelector(".about-copied")!.textContent).toBe(
      message("en-US", "about.copied"),
    );

    await key(dialog(), "Escape");
    expect(document.activeElement).toBe(origin);
  },
);
