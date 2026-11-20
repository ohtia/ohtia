// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openWorkspaceSettings,
  resetWorkspaceLayoutFromPalette,
} from "../tooling/command-workspace.mjs";
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
  type ProjectRecord,
  type Outcome,
  type ResearchOutputs,
  type ResearchScope,
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
    listProjects: vi.fn(() => call({ ok: true, value: { items: [], next: null, hasMore: false } })),
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
      readExitState: async () => null,
      onExitState: () => () => {},
      chooseExit: async () => true,
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
    system: { readMotion: () => "unknown", subscribeMotion: () => () => {} },
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

  it("waits for the palette reset command while an actual layout save is pending", async () => {
    vi.useRealTimers();
    const t = fixture();
    await mount(t);
    const save = deferred<Awaited<ReturnType<typeof t.port.replaceLayout>["result"]>>();
    const replace = t.port.replaceLayout.getMockImplementation()!;
    let saved!: Awaited<ReturnType<typeof t.port.replaceLayout>["result"]>;
    t.port.replaceLayout.mockImplementationOnce((change) => {
      const call = replace(change);
      void call.result.then((value) => {
        saved = value;
      });
      return { ...call, result: save.promise };
    });
    await t.intent("panels.explorer");
    await t.intent("palette.open");
    const palette = container.querySelector<HTMLDialogElement>(".command-palette[open]")!;
    const input = palette.querySelector<HTMLInputElement>('[role="combobox"]')!;
    const fill = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const press = async (key: string) => {
      await act(async () =>
        input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
      );
    };
    await fill(message("en-US", "command.layout.reset"));
    expect(palette.querySelector('[id$="-layout.reset"]')?.getAttribute("aria-disabled")).toBe(
      "true",
    );
    // The old immediate Enter is correctly ignored while the preference authority is busy.
    await press("Enter");
    expect(palette.open).toBe(true);
    expect(t.port.replaceLayout).toHaveBeenCalledOnce();
    const waiting = deferred<void>();
    const observations: { enabled: boolean }[] = [];
    const enter = vi.fn(press);
    const page = {
      evaluate: async (callback: () => { enabled: boolean }) => {
        const observed = callback();
        observations.push(observed);
        // A second read proves the driver processed the first busy result and kept waiting.
        if (observations.length === 2) waiting.resolve();
        return observed;
      },
      locator: (selector: string) => {
        expect(selector).toBe(".command-palette[open]");
        return {
          getByRole: (role: string) => {
            expect(role).toBe("combobox");
            return { fill, press: enter };
          },
          count: async () => container.querySelectorAll(selector).length,
        };
      },
    };
    const resetting = resetWorkspaceLayoutFromPalette(page, "en-US");
    await waiting.promise;
    expect(observations.map((observed) => observed.enabled)).toEqual([false, false]);
    expect(enter).not.toHaveBeenCalled();
    expect(palette.open).toBe(true);
    await act(async () => save.resolve(saved));
    await resetting;
    expect(enter).toHaveBeenCalledExactlyOnceWith("Enter");
    expect(container.querySelector(".command-palette[open]")).toBeNull();
    expect(
      container.querySelector('[data-workspace-panel="explorer"]')?.hasAttribute("hidden"),
    ).toBe(false);
    expect(t.port.replaceLayout).toHaveBeenCalledTimes(2);
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

it.each(["welcome", "context", "palette", "shortcut", "menu"] as const)(
  "starts project.new from %s through the same registry and focuses the safe dialog action",
  async (entry) => {
    const t = fixture();
    Object.assign(t.port, {
      readConnection: vi.fn(() => call({ ok: true, value: { state: "expired" } })),
      createProject: vi.fn(),
    });
    await mount(t);
    expect(t.entry("conversation.new")?.reason).toBe("no_project");
    if (entry === "welcome")
      await click('.workspace-welcome [data-workspace-command="project.new"]');
    else if (entry === "context")
      await click('.workspace-title-row [data-workspace-command="project.new"]');
    else if (entry === "palette") {
      await t.intent("palette.open");
      expect(container.querySelector('[role="option"]')?.id).toContain("project.new");
      await click('[role="option"][id$="project.new"]');
    } else await t.intent("project.new");
    const dialog = container.querySelector<HTMLDialogElement>(".new-project-dialog[open]")!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Connect an AI service to set up a project");
    expect(dialog.textContent).not.toContain("ChatGPT");
    expect(document.activeElement).toBe(dialog.querySelector("[data-close]"));
    expect(
      (t.port as unknown as { createProject: ReturnType<typeof vi.fn> }).createProject,
    ).not.toHaveBeenCalled();
    await act(async () =>
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent === "Open Connections")!
        .click(),
    );
    expect(container.querySelector(".settings-dialog[open]")).not.toBeNull();
  },
);

it("opens a newly created setup project, reveals a hidden chat and preserves its scope across bootstrap polling", async () => {
  const t = fixture();
  const projectId = "019a8000-0000-7000-8000-000000000101",
    conversationId = "019a8000-0000-7000-8000-000000000102";
  const project = {
    id: projectId,
    projectType: "thesis",
    title: null,
    documentLanguage: null,
    isDevelopment: false,
    setupConfirmedAt: null,
    lastOpenedAt: "2026-11-17T10:00:00.000Z",
    createdAt: "2026-11-17T10:00:00Z",
    updatedAt: "2026-11-17T10:00:00Z",
  };
  Object.assign(t.port, {
    readConnection: vi.fn(() => call({ ok: true, value: { state: "connected" } })),
    createProject: vi.fn(() => call({ ok: true, value: { resultId: projectId } })),
    listProjects: () =>
      call({ ok: true, value: { items: [{ ...project }], next: null, hasMore: false } }),
    listConversations: () =>
      call({ ok: true, value: { items: [{ id: conversationId }], next: null, hasMore: false } }),
    subscribeResearch: () => ({
      ready: Promise.resolve({ ok: true, value: { subscriptionId: "research-1" } }),
      dispose() {},
    }),
    readPauses: () => call({ ok: true, value: { revision: 1, restart: 0, usage: [] } }),
    readConversations: () =>
      call({
        ok: true,
        value: {
          items: [
            {
              id: conversationId,
              projectId,
              title: null,
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
              revision: 1,
              agentId: "virgilio",
              latestAt: project.createdAt,
              ownerRevision: 1,
              ownerPosition: null,
              latestPrefix: "",
              latestTruncated: false,
              latestLanguage: null,
              status: null,
              latestReplyTaskId: null,
              runningTask: null,
            },
          ],
          remaining: [],
        },
      }),
    listTimelineBefore: () => call({ ok: true, value: { items: [], next: null, hasMore: false } }),
    readDestination: () => call({ ok: true, value: { destination: null } }),
  });
  await mount(t);
  await t.intent("panels.chat");
  expect(container.querySelector(".workspace-chat")?.hasAttribute("hidden")).toBe(true);
  await click('.workspace-welcome [data-workspace-command="project.new"]');
  expect(container.querySelector(".workspace-chat")?.hasAttribute("hidden")).toBe(false);
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe(
    "New thesis · Setting up",
  );
  expect(container.querySelector(".workspace-explorer")?.textContent).toContain(
    "Sources and documents aren’t available in this version.",
  );
  expect(container.querySelector(".conversation-empty")?.textContent).toContain(
    "Tell Virgilio about your thesis",
  );
  expect(container.querySelector(".conversation-empty .voice-label")).toBeNull();
  expect(
    container.querySelector('.workspace-chat [aria-label="Rename conversation"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('.workspace-chat [aria-label="Show conversation history"]'),
  ).toBeNull();
  expect(container.querySelector('.workspace-chat [aria-label="New conversation"]')).toBeNull();
  expect(t.entry("conversation.new")?.reason).toBe("project_in_setup");
  expect(document.activeElement).toBe(container.querySelector("textarea"));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe(
    "New thesis · Setting up",
  );
  Object.assign(project, {
    title: "Redes de cuidado",
    documentLanguage: "es-AR",
    setupConfirmedAt: project.createdAt,
  });
  vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
    version: 1,
    locale: "en-US",
    state: "storage_ready",
    openConversation: { projectId, conversationId },
  });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(container.querySelector(".project-selector-button bdi")?.getAttribute("lang")).toBe(
    "es-AR",
  );
  const titleTooltip = container.querySelector(".workspace-context-tooltip")!;
  await act(async () => titleTooltip.dispatchEvent(new Event("pointerover", { bubbles: true })));
  expect(
    titleTooltip.querySelector('[role="tooltip"]')?.closest("[lang]")?.getAttribute("lang"),
  ).toBe("es-AR");
});

it("announces a creation failure with its description, preserves the open workspace and retries the same operation", async () => {
  const t = fixture(),
    createProject = vi.fn(() => call(failure("storage_failed")));
  Object.assign(t.port, {
    readConnection: () => call({ ok: true, value: { state: "connected" } }),
    createProject,
  });
  await mount(t);
  const trigger = container.querySelector<HTMLButtonElement>(
    '.workspace-title-row [data-workspace-command="project.new"]',
  )!;
  await act(async () => trigger.focus());
  await act(async () => trigger.click());
  const dialog = container.querySelector<HTMLDialogElement>('dialog[role="alertdialog"][open]')!;
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain("Ohtia couldn’t create the project");
  expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe(
    "Nothing was created, and your other projects are safe.",
  );
  expect(document.activeElement).toBe(dialog.querySelector("[data-close]"));
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe(
    "No project open",
  );
  await act(async () =>
    [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Try again")!.click(),
  );
  expect(createProject).toHaveBeenCalledTimes(2);
  expect(createProject.mock.calls[1]).toEqual(createProject.mock.calls[0]);
  await act(async () => dialog.querySelector<HTMLButtonElement>("[data-close]")!.click());
  expect(document.activeElement).toBe(trigger);
});

it("retains a creation failure while Settings owns the modal and shows it after Settings closes", async () => {
  const t = fixture(),
    pending = deferred<ReturnType<typeof failure>>();
  Object.assign(t.port, {
    readConnection: () => call({ ok: true, value: { state: "connected" } }),
    createProject: () => ({ result: pending.promise, cancel() {} }),
  });
  await mount(t);
  await t.intent("project.new");
  await t.intent("settings.open");
  const settings = container.querySelector<HTMLDialogElement>(".settings-dialog[open]")!;
  expect(settings).not.toBeNull();
  await act(async () => {
    pending.resolve(failure("storage_failed"));
    await Promise.resolve();
  });
  expect(settings.open).toBe(true);
  expect(container.querySelector(".new-project-error[open]")).toBeNull();
  await act(async () => settings.querySelector<HTMLButtonElement>("[data-close]")!.click());
  const failureDialog = container.querySelector<HTMLDialogElement>(".new-project-error[open]")!;
  expect(failureDialog).not.toBeNull();
  expect(failureDialog.textContent).toContain(
    "Nothing was created, and your other projects are safe.",
  );
  expect(document.activeElement).toBe(failureDialog.querySelector("[data-close]"));
});

it.each(["confirmed", "failed"] as const)(
  "withholds unknown project state while reading and after a %s outcome",
  async (outcome) => {
    const t = fixture();
    const project: ProjectRecord = {
      id: "019a8000-0000-7000-8000-000000000101",
      projectType: "thesis",
      title: "Redes de cuidado",
      documentLanguage: "es-AR",
      isDevelopment: false,
      setupConfirmedAt: "2026-11-17T10:00:00Z",
      lastOpenedAt: "2026-11-17T10:00:00.000Z",
      createdAt: "2026-11-17T10:00:00Z",
      updatedAt: "2026-11-17T10:00:00Z",
    };
    const conversationId = "019a8000-0000-7000-8000-000000000102";
    const pending = deferred<Outcome<ResearchOutputs["project.list"]>>();
    Object.assign(t.port, {
      listProjects: () => ({ result: pending.promise, cancel: vi.fn() }),
      readPauses: () => call({ ok: true, value: { revision: 1, restart: 0, usage: [] } }),
      readConversations: () =>
        call({
          ok: true,
          value: {
            items: [
              {
                id: conversationId,
                projectId: project.id,
                title: null,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                revision: 1,
                agentId: "virgilio",
                latestAt: project.createdAt,
                ownerRevision: 1,
                ownerPosition: null,
                latestPrefix: "",
                latestTruncated: false,
                latestLanguage: null,
                status: null,
                latestReplyTaskId: null,
                runningTask: null,
              },
            ],
            remaining: [],
          },
        }),
      listTimelineBefore: () =>
        call({ ok: true, value: { items: [], next: null, hasMore: false } }),
      readDestination: () => call({ ok: true, value: { destination: null } }),
    });
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
      version: 1,
      locale: "en-US",
      state: "storage_ready",
      openConversation: { projectId: project.id, conversationId },
    });
    await mount(t);
    expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe("Loading…");
    expect(container.querySelector(".workspace-setup")).toBeNull();
    expect(container.querySelector(".conversation-state")?.textContent).toContain(
      "Loading conversation",
    );
    await act(async () =>
      pending.resolve(
        outcome === "confirmed"
          ? { ok: true, value: { items: [project], next: null, hasMore: false } }
          : failure("storage_failed"),
      ),
    );
    if (outcome === "confirmed") {
      expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe(
        project.title,
      );
      expect(container.querySelector(".workspace-setup")?.textContent).toContain(
        "The Navigator isn’t available in this version",
      );
    } else {
      expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe(
        message("en-US", "project.loadFailed"),
      );
      expect(container.querySelector(".workspace-setup")).toBeNull();
      expect(container.querySelector(".conversation-state [role=alert]")).not.toBeNull();
      expect(container.querySelector(".conversation-state button")?.textContent).toBe(
        message("en-US", "conversation.reload"),
      );
    }
  },
);

function raceFixture() {
  const t = fixture();
  const ids = [101, 201, 301].map((n) => `019a8000-0000-7000-8000-${String(n).padStart(12, "0")}`);
  const rows = ids.map((id, n) => ({
    id,
    projectType: "thesis",
    title: `Project ${n + 1}`,
    documentLanguage: "en-US",
    isDevelopment: false,
    setupConfirmedAt: "2026-11-17T10:00:00.000Z",
    createdAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
    lastOpenedAt: "2026-11-17T10:00:00.000Z",
  }));
  Object.assign(t.port, {
    readConnection: vi.fn(() => call({ ok: true, value: { state: "connected" } })),
    listProjects: () => call({ ok: true, value: { items: rows, next: null, hasMore: false } }),
    listConversations: ({ projectId }: { projectId: string }) =>
      call({ ok: true, value: { items: [{ id: projectId }], next: null, hasMore: false } }),
    subscribeResearch: () => ({
      ready: Promise.resolve({ ok: true, value: { subscriptionId: "research-1" } }),
      dispose() {},
    }),
    readPauses: () => call({ ok: true, value: { revision: 1, restart: 0, usage: [] } }),
    readConversations: ({ ids: wanted }: { ids: string[] }) =>
      call({
        ok: true,
        value: {
          items: wanted.map((id) => ({
            id,
            projectId: id,
            title: null,
            createdAt: rows[0].createdAt,
            updatedAt: rows[0].updatedAt,
            revision: 1,
            agentId: "virgilio",
            latestAt: rows[0].createdAt,
            ownerRevision: 1,
            ownerPosition: null,
            latestPrefix: "",
            latestTruncated: false,
            latestLanguage: null,
            status: null,
            latestReplyTaskId: null,
            runningTask: null,
          })),
          remaining: [],
        },
      }),
    listTimelineBefore: () => call({ ok: true, value: { items: [], next: null, hasMore: false } }),
    readDestination: () => call({ ok: true, value: { destination: null } }),
  });
  vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
    version: 1,
    locale: "en-US",
    state: "storage_ready",
    navigateConversation: { projectId: ids[2], conversationId: ids[2], revision: 1 },
    openConversation: { projectId: ids[0], conversationId: ids[0] },
  });
  return { ...t, ids };
}
async function selectRaceProject(n: number) {
  await click("[role=combobox]");
  await act(async () => {
    (document.querySelectorAll("[role=option]")[n] as HTMLElement).click();
  });
}
it("keeps a later project selection when an earlier creation completes", async () => {
  const t = raceFixture();
  const pending = deferred<Outcome<{ resultId: string }>>();
  Object.assign(t.port, {
    createProject: vi.fn(() => ({ result: pending.promise, cancel: vi.fn() })),
  });
  await mount(t);
  await t.intent("project.new");
  await selectRaceProject(1);
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe("Project 2");
  await act(async () => pending.resolve({ ok: true, value: { resultId: t.ids[2] } }));
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe("Project 2");
});
it("ignores delayed bootstrap acknowledgements after A to B to A while preserving explicit development navigation", async () => {
  const t = raceFixture();
  await mount(t);
  await selectRaceProject(1);
  await selectRaceProject(0);
  vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
    version: 1,
    locale: "en-US",
    state: "storage_ready",
    openConversation: { projectId: t.ids[1], conversationId: t.ids[1] },
  });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe("Project 1");
  vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
    version: 1,
    locale: "en-US",
    state: "storage_ready",
    openConversation: { projectId: t.ids[1], conversationId: t.ids[1] },
    navigateConversation: { projectId: t.ids[1], conversationId: t.ids[1], revision: 2 },
  });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe("Project 2");
  await selectRaceProject(0);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe("Project 1");
});

it.each([true, false])(
  "reconnects the selected conversation after recovery with an old acknowledgement (storage loss observed: %s)",
  async (observeLoss) => {
    const t = raceFixture();
    const pending = deferred<Outcome<{ subscriptionId: string }>>();
    const acknowledgement = { projectId: t.ids[0], conversationId: t.ids[0] };
    const selected = { projectId: t.ids[1], conversationId: t.ids[1] };
    const ready = (serviceGeneration: string, scope = acknowledgement) => ({
      version: 1 as const,
      locale: "en-US" as const,
      state: "storage_ready" as const,
      serviceGeneration,
      openConversation: scope,
    });
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue(ready("service-a"));
    let recovered = false;
    const subscribeResearch = vi.fn((scope: ResearchScope) => ({
      ready:
        scope.projectId === selected.projectId && !recovered
          ? pending.promise
          : Promise.resolve({ ok: true as const, value: { subscriptionId: "research-1" } }),
      dispose: vi.fn(),
    }));
    const openProject = vi.fn(() => call({ ok: true, value: { resultId: selected.projectId } }));
    Object.assign(t.port, { subscribeResearch, openProject });
    await mount(t);
    await selectRaceProject(1);
    expect(subscribeResearch).toHaveBeenLastCalledWith(selected, expect.any(Function));
    await act(async () => pending.resolve(failure("service_unavailable")));
    expect(container.querySelector(".conversation-status-scroll")?.textContent).toContain(
      message("en-US", "conversation.unavailable"),
    );
    if (observeLoss) {
      vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
        version: 1,
        locale: "en-US",
        state: "storage_failed",
      });
      await act(async () => vi.advanceTimersByTimeAsync(1000));
    }
    recovered = true;
    const previousCalls = subscribeResearch.mock.calls.length;
    const openingWrites = openProject.mock.calls.length;
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue(ready("service-b"));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(subscribeResearch).toHaveBeenCalledTimes(previousCalls + 1);
    expect(subscribeResearch).toHaveBeenLastCalledWith(selected, expect.any(Function));
    expect(openProject).toHaveBeenCalledTimes(openingWrites);
    expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe("Project 2");
    expect(container.querySelector(".conversation-timeline")).not.toBeNull();
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue(ready("service-b", selected));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(subscribeResearch).toHaveBeenCalledTimes(previousCalls + 1);
  },
);

it("opens history in the chat panel, restores its draft, and reveals a lazy conversation from the registry", async () => {
  const t = raceFixture();
  const projectId = t.ids[0]!;
  const createdAt = "2026-11-17T10:00:00.000Z";
  const otherId = "019a8000-0000-7000-8000-000000000111";
  const rows = [projectId, otherId].map((id, index) => ({
    id,
    projectId,
    title: index ? "Second interview" : "First interview",
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    latestAt: createdAt,
    ownerRevision: 1,
    ownerPosition: null,
    latestPrefix: "Synthetic evidence",
    latestLanguage: null,
    latestTruncated: false,
    status: null,
    agentId: "virgilio" as const,
    runningTask: null,
    latestReplyTaskId: null,
  }));
  const confirmedRename = deferred<Outcome<{ resultId: string }>>();
  const renameConversation = vi
    .fn()
    .mockReturnValueOnce(call(failure("storage_failed")))
    .mockReturnValueOnce({ result: confirmedRename.promise, cancel() {} });
  const firstPage = deferred<Outcome<ResearchOutputs["conversation.list"]>>();
  const saved = deferred<Outcome<{ resultId: string }>>();
  const startedId = "019a8000-0000-7000-8000-000000000120";
  const startConversation = vi.fn(() => ({ result: saved.promise, cancel() {} }));
  Object.assign(t.port, {
    readConversations: ({ projectId: project, ids }: { projectId: string; ids: string[] }) =>
      call({
        ok: true,
        value: {
          items: ids.flatMap((id) =>
            project === projectId
              ? rows.filter((row) => row.id === id)
              : [{ ...rows[0], id, projectId: project }],
          ),
          remaining: [],
        },
      }),
    listConversations: vi
      .fn(({ projectId: project }: { projectId: string }) =>
        call({
          ok: true,
          value: {
            items: project === projectId ? [...rows].reverse() : [{ id: project }],
            next: null,
            hasMore: false,
          },
        }),
      )
      .mockReturnValueOnce({ result: firstPage.promise, cancel() {} }),
    startConversation,
    renameConversation,
  });
  await mount(t);
  const selector = (name: string) => `.workspace-chat button[aria-label="${name}"]`;
  const header = () =>
    container.querySelector(".workspace-chat .workspace-panel-heading")?.textContent;
  const writeDraft = async (text: string) => {
    const input = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  expect(header()).toBe("First interview");
  expect(
    [...container.querySelectorAll(".workspace-chat-heading button")]
      .slice(0, 3)
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Rename conversation", "Show conversation history", "New conversation"]);
  await click(selector("Rename conversation"));
  const rename = container.querySelector<HTMLInputElement>(
    'input[aria-label="Conversation name"]',
  )!;
  expect(document.activeElement).toBe(rename);
  await act(async () => {
    rename.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    rename.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
    );
  });
  expect(renameConversation).not.toHaveBeenCalled();
  await act(async () => {
    rename.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    rename.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(renameConversation).toHaveBeenCalledOnce();
  expect(container.querySelector(".chat-rename-notice [role=alert]")?.textContent).toContain(
    "Your name is still in the field",
  );
  await act(async () => {
    rename.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(header()).toBe("First interview");
  expect(document.activeElement).toBe(container.querySelector(selector("Rename conversation")));
  await click(selector("Rename conversation"));
  await act(async () => {
    container
      .querySelector('input[aria-label="Conversation name"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(renameConversation).toHaveBeenCalledTimes(2);
  const documents = container.querySelector<HTMLElement>(
    ".workspace-documents .workspace-panel-scroll",
  )!;
  await act(async () => documents.focus());
  await act(async () => confirmedRename.resolve({ ok: true, value: { resultId: projectId } }));
  expect(document.activeElement).toBe(documents);
  await writeDraft("A private draft");
  await click(selector("Show conversation history"));
  expect(header()).toBe("Conversations");
  expect(document.activeElement).toBe(container.querySelector(selector("Return to conversation")));
  expect(container.querySelector(".chat-conversation")?.hasAttribute("hidden")).toBe(true);
  expect(container.querySelector(".chat-history-view [aria-busy=true]")).not.toBeNull();
  const loading = container.querySelector('[data-history-loading][role="status"]')!;
  expect(loading.closest("[aria-busy=true]")).toBeNull();
  expect(loading.textContent).toBe("Loading conversations…");
  await act(async () =>
    firstPage.resolve({
      ok: true,
      value: { items: [...rows].reverse(), next: null, hasMore: false },
    }),
  );
  expect(container.querySelector(".chat-history-row[aria-current=true]")?.textContent).toContain(
    "First interview",
  );
  await t.intent("panels.chat");
  expect(container.querySelector(".workspace-chat")?.hasAttribute("hidden")).toBe(true);
  await t.intent("panels.chat");
  expect(header()).toBe("Conversations");
  await click(".chat-history-row");
  expect(header()).toBe("Second interview");
  expect(container.querySelector("textarea")?.value).toBe("");
  await click(selector("Show conversation history"));
  await act(async () => {
    [...container.querySelectorAll<HTMLButtonElement>(".chat-history-row")]
      .find((row) => row.textContent?.includes("First interview"))!
      .click();
  });
  expect(header()).toBe("First interview");
  expect(container.querySelector("textarea")?.value).toBe("A private draft");
  await t.intent("panels.chat");
  await t.intent("conversation.new");
  expect(header()).toBe("New conversation");
  expect(container.querySelector(selector("Rename conversation"))).toBeNull();
  expect(container.querySelector(".workspace-chat")?.hasAttribute("hidden")).toBe(false);
  expect(container.querySelector(".conversation-empty")?.textContent).toBe(
    "Ask Virgilio about your thesis.",
  );
  expect(document.activeElement).toBe(container.querySelector("textarea"));
  expect(startConversation).not.toHaveBeenCalled();

  await writeDraft("Draft for the pending conversation");
  await selectRaceProject(1);
  await selectRaceProject(0);
  expect(header()).toBe("New conversation");
  expect(container.querySelector("textarea")?.value).toBe("Draft for the pending conversation");

  await click(selector(message("en-US", "composer.send")));
  expect(startConversation).toHaveBeenCalledOnce();
  await selectRaceProject(1);
  rows.push({ ...rows[0]!, id: startedId, title: "Conversation saved in background" });
  await act(async () => saved.resolve({ ok: true, value: { resultId: startedId } }));
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe("Project 2");
  await selectRaceProject(0);
  expect(header()).toBe("Conversation saved in background");
  expect(container.querySelector("textarea")?.value).toBe("");
});
