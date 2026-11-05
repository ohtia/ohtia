// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openWorkspaceSettings } from "../tooling/command-workspace.mjs";
import { ApplicationRoot } from "../packages/renderer/src/application-root.js";
import { harness, call, deferred } from "./fixtures/settings.js";
import { createFoundationPort } from "../packages/preload/src/foundation-port.js";
import { rejectedEnvelopes } from "./fixtures/port-corpus.js";
import { decodeText, encodeEnvelope, policyId, type Request } from "@ohtia/contracts";
import {
  failure,
  message,
  type DesktopBridge,
  type CommandIntent,
  type CommandSnapshot,
  type LayoutRecord,
  type LayoutChange,
} from "@ohtia/contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement, width: number;
let resize: (() => void)[];
const disposals: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  width = 1280;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  resize = [];
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.closest("[hidden]")) return new DOMRect(0, 0, 0, 0);
    if (this.matches('.foundation-titlebar [data-workspace-command="menu.open"]'))
      return new DOMRect(42, 0, 32, 48);
    if (this.matches('.workspace [data-workspace-command="menu.open"]'))
      return new DOMRect(12, 0, 32, 48);
    return new DOMRect(0, 0, this.classList.contains("workspace") ? width : 128, 800);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  disposals.splice(0).forEach((stop) => stop());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  const settings = harness();
  disposals.push(() => settings.controller.dispose());
  let layout: LayoutRecord = { schemaVersion: 1, revision: 0, source: "default", value: null };
  let receive: (intent: CommandIntent) => void = () => {};
  let sequence = 0;
  let published: CommandSnapshot;
  const unsubscribe = vi.fn();
  const localeStop = vi.fn();
  const port = {
    ...settings.port,
    readStatus: vi.fn(() =>
      call({
        ok: true,
        value: {
          service: "ready",
          artifact: "development",
          engine: "verified",
          interfaceLocale: "en-US",
        },
      }),
    ),
    readLocale: vi.fn(() =>
      call({
        ok: true,
        value: {
          serviceGeneration: "service-1",
          record: { schemaVersion: 1, revision: 0, value: "system", source: "default" },
          effectiveLocale: "en-US",
          systemLocale: "en-US",
        },
      }),
    ),
    subscribeLocale: vi.fn(() => ({
      ready: Promise.resolve({ ok: true, value: { subscriptionId: "locale-1" } }),
      dispose: localeStop,
    })),
    readLayout: vi.fn(() => call({ ok: true, value: layout })),
    replaceLayout: vi.fn((change: LayoutChange) => {
      layout = {
        schemaVersion: 1,
        revision: layout.revision + 1,
        source: "saved",
        value: change.value,
      };
      return call({ ok: true, value: layout });
    }),
    readLayoutReceipt: vi.fn(() => call({ ok: true, value: { state: "not_found" } })),
    claimLayoutFailureNotice: vi.fn(() => call({ ok: true, value: { announce: true } })),
    applyZoom: vi.fn(() =>
      call({
        ok: true,
        value: {
          applied: true,
          percent: settings.current.zoom.value,
          revision: settings.current.zoom.revision,
        },
      }),
    ),
  };
  const bridge = {
    foundation: port,
    bootstrap: {
      read: vi.fn(async () => ({ version: 1, locale: "en-US", state: "storage_ready" })),
      retryService: vi.fn(),
      openStorage: vi.fn(),
      restoreCheckpoint: vi.fn(),
      exit: vi.fn(),
      newWindow: vi.fn(),
    },
    commands: {
      context: vi.fn(async () => ({ platform: "linux", windowGeneration: "root-window" })),
      publish: vi.fn(async (snapshot: CommandSnapshot) => {
        published = snapshot;
        return true;
      }),
      onIntent: vi.fn((listener: typeof receive) => {
        receive = listener;
        return unsubscribe;
      }),
      windowAction: vi.fn(async () => ({ status: "completed" })),
      perform: vi.fn(async () => true),
      copyVersionInformation: vi.fn(async () => true),
      about: vi.fn(async () => ({
        product: "Ohtia",
        version: "synthetic",
        build: "synthetic",
        platform: "linux",
        architecture: "x86-64",
        copyright: "Synthetic",
        license: "MIT",
        notices: [],
      })),
      openLink: vi.fn(async () => true),
    },
  } as unknown as DesktopBridge;
  return {
    settings,
    bridge,
    port,
    unsubscribe,
    localeStop,
    entry: (id: string) => published.entries.find((entry) => entry.id === id),
    async intent(command: CommandIntent["command"]) {
      await act(async () =>
        receive({
          windowGeneration: "root-window",
          source: "native",
          sequence: ++sequence,
          command,
        }),
      );
    },
  };
}
async function click(selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  await act(async () => element!.click());
}
async function mount(t: ReturnType<typeof fixture>) {
  await act(async () => root.render(h(ApplicationRoot, { bridge: t.bridge })));
}

describe("integrated application authority", () => {
  it("keeps the open Settings dialog, input focus and reading position when storage becomes available in another window", async () => {
    const t = fixture();
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
      version: 1,
      locale: "en-US",
      state: "pending_create",
    });
    await mount(t);
    await t.intent("settings.open");
    const dialog = container.querySelector<HTMLDialogElement>(".settings-dialog[open]")!;
    const language = dialog.querySelector<HTMLSelectElement>("select")!;
    const content = dialog.querySelector<HTMLElement>(".settings-content")!;
    await act(async () => {
      content.scrollTop = 45;
      language.focus();
    });
    expect(document.activeElement).toBe(language);
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
      version: 1,
      locale: "en-US",
      state: "storage_ready",
    });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.querySelector(".settings-dialog[open]")).toBe(dialog);
    expect(document.activeElement).toBe(language);
    expect(content.scrollTop).toBe(45);
    expect(t.port.readLayout).toHaveBeenCalledOnce();
  });

  it("opens Settings after the bootstrap launcher disappears at the driver's stable-click boundary", async () => {
    const t = fixture();
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
      version: 1,
      locale: "en-US",
      state: "pending_create",
    });
    await mount(t);
    const legacySelector = '[data-bootstrap-surface] [data-command-id="settings.open"] button';
    const legacy = container.querySelector<HTMLElement>(legacySelector)!;
    expect(legacy.closest("[hidden]")).toBeNull();
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
      version: 1,
      locale: "en-US",
      state: "storage_ready",
    });
    expect((await t.bridge.bootstrap.read()).state).toBe("storage_ready");
    expect(container.querySelector(".application-workspace")).toBeNull();
    const stableClick = deferred<void>();
    // A controlled page adapter releases actionability after the actual renderer handoff.
    const queuedClick = (selector: string) => {
      const locator = {
        first: () => locator,
        click: async () => {
          await stableClick.promise;
          const target = [
            ...container.querySelectorAll<HTMLElement>(selector.replaceAll(":visible", "")),
          ].find((element) => !element.closest("[hidden], [inert]"));
          if (!target) throw new Error("No visible Settings trigger after renderer handoff");
          await act(async () => target.click());
        },
      };
      return locator;
    };
    const page = {
      locator: queuedClick,
      getByRole: (role: string, options: { name: string; exact: boolean }) => {
        expect(role).toBe("button");
        expect(options).toEqual({ name: message("en-US", "command.settings.open"), exact: true });
        return queuedClick(legacySelector);
      },
    };
    const opening = openWorkspaceSettings(page);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(legacy.closest("[hidden]")).not.toBeNull();
    expect(container.querySelector(".application-workspace")?.hasAttribute("hidden")).toBe(false);
    stableClick.resolve();
    await opening;
    expect(container.querySelector(".settings-dialog[open]")).not.toBeNull();
  });

  it("composes the real bounded port with corpus failures, old generations and fresh-ID stream recovery without disturbing private input", async () => {
    const t = fixture();
    let receive: (text: unknown) => void = () => {};
    const requests: Request[] = [];
    const activeTimers = new Set<ReturnType<typeof setTimeout>>();
    let id = 0;
    const disconnected = vi.fn();
    const send = (value: unknown) => {
      const encoded = encodeEnvelope(value);
      expect(encoded.ok, JSON.stringify(value)).toBe(true);
      if (encoded.ok) receive(encoded.value);
    };
    const client = createFoundationPort(
      { contextIsolated: true, sandboxed: true },
      {
        listen(listener) {
          receive = listener;
          return disconnected;
        },
        send(text) {
          const decoded = decodeText(text);
          expect(decoded.ok).toBe(true);
          if (!decoded.ok || decoded.value.kind !== "request") return;
          const request = decoded.value;
          requests.push(request);
          const result = (() => {
            switch (request.operation) {
              case "status.read":
                return t.port.readStatus().result;
              case "locale.read":
                return t.port.readLocale().result;
              case "presentation.read":
                return t.port.readPresentation().result;
              case "layout.read":
                return t.port.readLayout().result;
              case "zoom.apply":
                return t.port.applyZoom().result;
              case "locale.subscribe":
              case "presentation.subscribe":
                return Promise.resolve({ ok: true, value: request.payload });
              default:
                throw new Error(`Unexpected root operation: ${request.operation}`);
            }
          })();
          void result.then((payload) => send({ ...request, kind: "result", payload }));
        },
      },
      {
        after(milliseconds, callback) {
          const timer = setTimeout(() => {
            activeTimers.delete(timer);
            callback();
          }, milliseconds);
          activeTimers.add(timer);
          return () => {
            clearTimeout(timer);
            activeTimers.delete(timer);
          };
        },
      },
      {
        windowGeneration: "root-window",
        serviceGeneration: "service-1",
        nextId: () => `root-${++id}`,
      },
    );
    disposals.push(client.dispose);
    await act(async () =>
      root.render(h(ApplicationRoot, { bridge: { ...t.bridge, foundation: client.port } })),
    );
    const welcome = container.querySelector(".workspace-welcome")!;
    expect(container.querySelectorAll(".application-workspace .workspace-title-row")).toHaveLength(
      1,
    );
    const input = document.createElement("textarea");
    input.value = "Synthetic private input 연구";
    welcome.append(input);
    await act(async () => {
      input.focus();
      input.setSelectionRange(2, 8);
    });
    for (const name of ["unsupported protocol", "wrong numeric policy"]) {
      await act(async () =>
        receive(JSON.stringify(rejectedEnvelopes.find((entry) => entry.name === name)!.value)),
      );
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("Synthetic private input 연구");
    }
    const subscription = requests
      .filter((request) => request.operation === "presentation.subscribe")
      .at(-1)!;
    const event = {
      protocol: 1,
      policy: policyId,
      kind: "event",
      windowGeneration: "root-window",
      serviceGeneration: "service-1",
      subscriptionId: subscription.payload.subscriptionId,
      sequence: 1,
      topic: "presentation",
      payload: t.settings.current,
    };
    await act(async () =>
      send({
        ...event,
        serviceGeneration: "retired-service",
        payload: { ...t.settings.current, serviceGeneration: "retired-service" },
      }),
    );
    const before = requests.length;
    await act(async () => send({ ...event, sequence: 2 }));
    const renewed = requests
      .slice(before)
      .filter((request) => request.operation === "presentation.subscribe");
    expect(renewed).toHaveLength(1);
    expect(renewed[0].payload.subscriptionId).not.toBe(subscription.payload.subscriptionId);
    expect(requests.filter((request) => request.operation.endsWith(".replace"))).toHaveLength(0);
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(8);
    expect(container.querySelector(".workspace-welcome")).toBe(welcome);
    await act(async () => root.unmount());
    client.dispose();
    expect(disconnected).toHaveBeenCalledOnce();
    expect(activeTimers.size).toBe(0);
    root = createRoot(container);
  }, 60000);

  it("shares one layout between chrome, Settings, rail and narrow entries while wiring actual commands and confirmed presentation", async () => {
    const t = fixture();
    await mount(t);
    expect(t.port.readLayout).toHaveBeenCalledOnce();
    const welcome = container.querySelector(".workspace-welcome")!;
    expect(welcome.textContent).toContain("Welcome to Ohtia");
    expect(container.querySelector(".workspace textarea, .research-specimen")).toBeNull();
    await click('.workspace-explorer-footer [data-workspace-command="settings.open"]');
    expect(container.querySelectorAll("dialog[open]")).toHaveLength(1);
    const checkboxes = container.querySelectorAll<HTMLInputElement>(
      '.settings-dialog input[type="checkbox"]',
    );
    await act(async () => checkboxes[2].click());
    expect(container.querySelector('[data-workspace-panel="chat"]')?.hasAttribute("hidden")).toBe(
      true,
    );
    await act(async () => {
      width = 320;
      resize.forEach((notify) => notify());
    });
    await click(".settings-dialog [data-close]");
    expect(document.activeElement).toBe(container.querySelector(".workspace-skip"));
    await act(async () => {
      width = 1280;
      resize.forEach((notify) => notify());
    });
    await t.intent("layout.reset");
    expect(container.querySelector('[data-workspace-panel="chat"]')?.hasAttribute("hidden")).toBe(
      false,
    );
    await t.intent("panels.explorer");
    const railSettings = container.querySelector<HTMLButtonElement>(
      '.workspace-rail [data-workspace-command="settings.open"]',
    )!;
    await act(async () =>
      railSettings.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })),
    );
    await act(async () => railSettings.focus());
    expect(railSettings.isConnected).toBe(true);
    await click('.workspace-rail [data-workspace-command="settings.open"]');
    expect(container.querySelector(".settings-dialog[open]")).not.toBeNull();
    expect(checkboxes[0].checked).toBe(false);
    await click(".settings-dialog [data-close]");
    await act(async () => {
      width = 600;
      resize.forEach((notify) => notify());
    });
    await click('.workspace-narrow-row [data-workspace-command="settings.open"]');
    await click(".settings-dialog [data-close]");
    await t.intent("theme.dark");
    expect(t.port.replaceAppearance).toHaveBeenCalledOnce();
    await t.intent("zoom.increase");
    expect(container.querySelector('[data-workspace-command="zoom.reset"]')?.textContent).toContain(
      "110%",
    );
    await act(async () =>
      t.settings.notify({
        ok: true,
        value: {
          ...t.settings.current,
          character: { schemaVersion: 1, revision: 1, source: "saved", value: "hidden" },
          zoom: { schemaVersion: 1, revision: 2, source: "saved", value: 125 },
        },
      }),
    );
    expect(container.querySelector(".workspace-welcome img")).toBeNull();
    expect(container.querySelector(".workspace-welcome")).toBe(welcome);
    await t.intent("about.open");
    expect(container.querySelector(".about-dialog .about-character")).toBeNull();
    await click(".about-dialog [data-close]");
    await t.intent("window.new");
    await t.intent("menu.open");
    expect(t.bridge.commands.windowAction).toHaveBeenCalledTimes(2);
    expect(t.bridge.bootstrap.newWindow).not.toHaveBeenCalled();
    await t.intent("palette.open");
    expect(container.querySelector(".command-palette[open] [role=combobox]")).not.toBeNull();
    await click(".command-palette [data-close]");
    await t.intent("shortcuts.open");
    expect(container.querySelector(".shortcuts-dialog[open]")).not.toBeNull();
    expect(t.port.readLayout).toHaveBeenCalledOnce();
  }, 60000);

  it("retains an uncertain mutation across close/reopen and reconciles the original receipt without a second write", async () => {
    const t = fixture();
    await mount(t);
    const pending = deferred<ReturnType<typeof failure>>();
    t.port.replaceCharacter.mockImplementationOnce(
      () => ({ result: pending.promise, cancel: vi.fn() }) as never,
    );
    await t.intent("settings.open");
    await click('.settings-dialog input[type="radio"][value="hidden"]');
    const id = t.port.replaceCharacter.mock.calls[0][0].operationId;
    await click(".settings-dialog [data-close]");
    await act(async () => pending.resolve(failure("uncertain")));
    expect(t.port.readCharacterReceipt).toHaveBeenCalledWith(id);
    const saved = {
      schemaVersion: 1 as const,
      revision: 1,
      source: "saved" as const,
      value: "hidden" as const,
    };
    t.port.readCharacterReceipt.mockReturnValue(
      call({
        ok: true,
        value: { state: "recorded", outcome: { ok: true, value: saved } },
      }) as never,
    );
    await act(async () =>
      t.settings.notify({ ok: true, value: { ...t.settings.current, character: saved } }),
    );
    await t.intent("settings.open");
    const check = [
      ...container.querySelectorAll<HTMLButtonElement>(".settings-dialog button"),
    ].find((button) => button.textContent === "Check")!;
    expect(check).toBeDefined();
    await act(async () => check.click());
    expect(t.port.replaceCharacter).toHaveBeenCalledOnce();
    expect(t.port.readCharacterReceipt.mock.calls.every(([operation]) => operation === id)).toBe(
      true,
    );
    expect(container.querySelector(".workspace-welcome img")).toBeNull();
  });

  it("keeps the window layout and mounted content through service recovery and disposes every owned subscription", async () => {
    const t = fixture();
    await mount(t);
    await t.intent("panels.chat");
    await t.intent("document.focus");
    expect(t.entry("document.focus")?.checked).toBe(true);
    const welcome = container.querySelector(".workspace-welcome");
    await t.intent("settings.open");
    const modalFocus = document.activeElement;
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
      version: 1,
      locale: "en-US",
      state: "retry_required",
    });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.querySelector(".application-workspace")?.hasAttribute("hidden")).toBe(true);
    await act(async () => resize.forEach((notify) => notify()));
    expect(document.activeElement).toBe(modalFocus);
    const layoutWrites = t.port.replaceLayout.mock.calls.length;
    await click('.settings-dialog input[type="checkbox"]');
    expect(t.port.replaceLayout).toHaveBeenCalledTimes(layoutWrites);
    await click(".settings-dialog [data-close]");
    expect(document.activeElement).toBe(
      container.querySelector('[data-command-id="settings.open"] button'),
    );
    for (const command of [
      "panels.explorer",
      "layout.reset",
      "document.focus",
      "zoom.increase",
      "theme.dark",
    ] as const) {
      expect(t.entry(command)?.reason).toBe("busy");
      await t.intent(command);
    }
    expect(t.port.replaceLayout).toHaveBeenCalledTimes(layoutWrites);
    expect(t.port.adjustZoom).not.toHaveBeenCalled();
    expect(t.port.replaceAppearance).not.toHaveBeenCalled();
    vi.mocked(t.bridge.commands.windowAction).mockResolvedValue({
      status: "completed",
      menuDismissed: true,
    });
    const menu = container.querySelector<HTMLButtonElement>(
      '.foundation-titlebar [data-workspace-command="menu.open"]',
    )!;
    await act(async () => menu.click());
    expect(t.bridge.commands.windowAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchor: { x: 42, y: 48 } }),
    );
    expect(document.activeElement).toBe(menu);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F10", code: "F10", bubbles: true }),
      );
    });
    expect(t.bridge.commands.windowAction).toHaveBeenCalledTimes(2);
    expect(t.bridge.commands.windowAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchor: { x: 42, y: 48 } }),
    );
    expect(document.activeElement).toBe(menu);
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
      version: 1,
      locale: "en-US",
      state: "storage_ready",
    });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    await act(async () => resize.forEach((notify) => notify()));
    expect(document.activeElement).toBe(container.querySelector(".workspace-skip"));
    expect(t.entry("document.focus")?.checked).toBe(true);
    await t.intent("document.focus");
    expect(
      container.querySelector('[data-workspace-panel="explorer"]')?.hasAttribute("hidden"),
    ).toBe(false);
    expect(container.querySelector(".workspace-welcome")).toBe(welcome);
    expect(container.querySelector('[data-workspace-panel="chat"]')?.hasAttribute("hidden")).toBe(
      true,
    );
    // Retire incarnation A with a read pending, then deliver it while B owns private input.
    const late = deferred<unknown>();
    t.port.readPresentation.mockReturnValueOnce({ result: late.promise, cancel: vi.fn() } as never);
    await act(async () => t.settings.notify(failure("sequence_gap")));
    await act(async () => root.unmount());
    expect(t.unsubscribe).toHaveBeenCalledOnce();
    expect(t.localeStop).toHaveBeenCalled();
    expect(t.settings.stop).toHaveBeenCalled();
    const calls = t.port.readStatus.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(t.port.readStatus).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
    const other = fixture();
    await act(async () =>
      root.render(
        h(ApplicationRoot, {
          key: "B",
          bridge: { ...other.bridge, foundation: t.bridge.foundation },
        }),
      ),
    );
    const current = container.querySelector(".workspace-welcome")!;
    current.setAttribute("data-incarnation", "B");
    const input = document.createElement("textarea");
    input.value = "Incarnation B private buffer";
    current.append(input);
    await act(async () => {
      input.focus();
      input.setSelectionRange(3, 8);
    });
    const committed = {
      ...t.settings.current,
      character: {
        schemaVersion: 1 as const,
        revision: 1,
        source: "saved" as const,
        value: "hidden" as const,
      },
    };
    await act(async () => {
      t.settings.notify({ ok: true, value: committed });
      late.resolve({ ok: true, value: committed });
    });
    expect(container.querySelector(".workspace-welcome")).toBe(current);
    expect(document.activeElement).toBe(input);
    expect([input.value, input.selectionStart, input.selectionEnd]).toEqual([
      "Incarnation B private buffer",
      3,
      8,
    ]);
    await act(async () => root.render(h(ApplicationRoot, { key: "A-again", bridge: t.bridge })));
    expect(container.querySelector(".workspace-welcome")).not.toBe(welcome);
    expect(container.querySelector(".workspace-welcome img")).toBeNull();
    expect(t.port.replaceCharacter).not.toHaveBeenCalled();
  }, 60000);
});
