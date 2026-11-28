// @vitest-environment jsdom
import { createHash, randomUUID } from "node:crypto";
import { TextEncoder } from "node:util";
import {
  ProjectMemoryDrafts,
  ProjectMemoryView,
} from "../packages/renderer/src/project-memory-view.js";
import { conversationPreview } from "../packages/renderer/src/message-markdown.js";
import { splitText } from "@ohtia/contracts";
import { ActivityController } from "../packages/renderer/src/activity-controller.js";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openWorkspaceSettings,
  resetWorkspaceLayoutFromPalette,
} from "../tooling/command-workspace.mjs";
import { PendingProjectWork } from "../packages/renderer/src/pending-project-work.js";
import { ApplicationRoot } from "../packages/renderer/src/application-root.js";
import { harness, call, deferred } from "./fixtures/settings.js";
import { createFoundationPort } from "../packages/preload/src/foundation-port.js";
import { rejectedEnvelopes } from "./fixtures/port-corpus.js";
import { decodeText, encodeEnvelope, policyId, type Request } from "@ohtia/contracts";
import {
  encodeProfileContent,
  failure,
  message,
  type DesktopBridge,
  type CommandIntent,
  type CommandSnapshot,
  type ConnectionEvent,
  type LayoutRecord,
  type LayoutChange,
  type ProjectSummary,
  type ProfileReadResult,
  type ProfileReceiptResult,
  type ProfileSaveResult,
  type ConversationSummary,
  type ResearchEvent,
  type FoundationPort,
  type ManagedStoreLocation,
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
    listManuscripts: ({ projectId }: { projectId: string }) =>
      call({ ok: true, value: { projectId, manuscripts: [], next: null } }),
    listProjects: vi.fn(() => call({ ok: true, value: { items: [], next: null, hasMore: false } })),
    readManagedStoreLocation: vi.fn(() =>
      call<ManagedStoreLocation>({
        ok: true,
        value: { state: "unavailable", reason: "pending_create" },
      }),
    ),
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
    diagnostics: {
      readPage: vi.fn(async () => ({ status: "unavailable" })),
      deleteLogs: vi.fn(async () => ({ status: "unavailable" })),
      bundle: vi.fn(async () => ({ status: "unavailable" })),
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
  it.each([
    ["anthropic_api_key", "Anthropic"],
    ["openai_api_key", "OpenAI"],
  ])("offers %s key entry through the default application Settings", async (id, service) => {
    const t = fixture();
    const snapshot = (connection: string, state: ConnectionEvent["state"]) => ({
      connection,
      display_name: connection === id ? service : "ChatGPT",
      state,
      reason: null,
      probing: false,
      probe_id: null,
      model_list_revision: null,
      model_count: 0,
      account_email: null,
      last_account_email: null,
    });
    const readConnection = vi.fn((connection: string) =>
      call({ ok: true, value: snapshot(connection, "disconnected") }),
    );
    const listeners = new Map<string, (event: Outcome<ConnectionEvent>) => void>();
    Object.assign(t.port, {
      readConnection,
      subscribeConnection: (
        connection: string,
        listener: (event: Outcome<ConnectionEvent>) => void,
      ) => {
        listeners.set(connection, listener);
        return {
          ready: Promise.resolve({ ok: true, value: { subscriptionId: "connections" } }),
          dispose() {},
        };
      },
    });
    await mount(t);
    await t.intent("settings.open");
    const dialog = container.querySelector(".settings-dialog[open]")!;
    await act(async () =>
      [...dialog.querySelectorAll<HTMLButtonElement>(".settings-pages button")]
        .find(({ textContent }) => textContent === "AI services")!
        .click(),
    );
    const add = [...dialog.querySelectorAll("button")].find(
      ({ textContent }) => textContent === "Add " + service + " API key",
    );
    expect(readConnection).toHaveBeenCalledWith(id);
    expect(add).toBeDefined();
    await act(async () => add!.click());
    const field = dialog.querySelector<HTMLInputElement>('input[type="password"]');
    expect(field?.labels?.[0]?.textContent).toBe(service + " API key");
    expect(document.activeElement).toBe(field);
    const limits = dialog.querySelector(".limits-panel")!;
    const cost = "More replies at once can spend your " + service + " key’s credit faster.";
    const plan = "More replies at once can use more of your ChatGPT plan at the same time.";
    expect(limits.textContent).not.toContain(cost);
    const notify = (connection: string, state: ConnectionEvent["state"]) =>
      act(async () =>
        listeners.get("*")?.({
          ok: true,
          value: { ...snapshot(connection, state), kind: "state" },
        }),
      );
    await notify(id, "connected");
    expect(limits.textContent).toContain(cost);
    expect(limits.textContent).not.toContain(plan);
    await notify("chatgpt", "connected");
    expect(limits.textContent).toContain(cost);
    expect(limits.textContent).toContain(plan);
    await notify(id, "disconnected");
    expect(limits.textContent).not.toContain(cost);
    expect(limits.textContent).toContain(plan);
  });

  it("loads diagnostics when the Settings page opens during graphical bootstrap", async () => {
    const t = fixture();
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
      version: 1,
      locale: "en-US",
      state: "pending_create",
    });
    await mount(t);
    await t.intent("settings.open");
    expect(t.bridge.diagnostics.readPage).not.toHaveBeenCalled();
    await click('.settings-pages button[id$="-section-diagnostics-nav"]');
    expect(t.bridge.diagnostics.readPage).toHaveBeenCalledExactlyOnceWith({ slot: 0 });
    expect(container.querySelector(".diagnostics-panel")?.textContent).toContain(
      "The log could not be read.",
    );
  });

  it("confirms each diagnostic deletion and keeps deletion and refresh feedback independent", async () => {
    const t = fixture();
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
      version: 1,
      locale: "en-US",
      state: "pending_create",
    });
    const present = {
      status: "ready",
      entries: [
        { time: "2026-01-01T00:00:00.000Z", severity: "INFO", event: "ohtia.application.started" },
      ],
      invalid: 0,
      unsupported: 0,
    } as const;
    const read = vi.mocked(t.bridge.diagnostics.readPage).mockResolvedValue(present);
    const remove = vi.mocked(t.bridge.diagnostics.deleteLogs);
    const first = Promise.withResolvers<Awaited<ReturnType<typeof remove>>>();
    remove
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error("synthetic lost reply"))
      .mockResolvedValueOnce({ status: "ready", deleted: 1 })
      .mockResolvedValueOnce({ status: "busy" })
      .mockResolvedValueOnce({ status: "unavailable" });
    await mount(t);
    await t.intent("settings.open");
    const diagnostics = '.settings-pages button[id$="-section-diagnostics-nav"]';
    await click(diagnostics);
    const panel = container.querySelector(".diagnostics-panel")!;
    const trigger = panel.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    const refresh = panel.querySelector<HTMLButtonElement>(".diagnostics-actions button")!;
    const confirm = () => panel.querySelector<HTMLButtonElement>(".primitive-destructive")!;
    await act(async () => trigger.click());
    const cancel = panel.querySelector<HTMLButtonElement>('[role="group"] button')!;
    expect(document.activeElement).toBe(cancel);
    expect(panel.textContent).toContain("Your research data and history will be kept.");
    await act(async () => cancel.click());
    expect(document.activeElement).toBe(trigger);
    expect(remove).not.toHaveBeenCalled();
    await act(async () => trigger.click());
    trigger.focus();
    await act(async () =>
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.activeElement).toBe(trigger);
    expect(panel.closest("dialog")?.open).toBe(true);
    expect(confirm()).toBeNull();
    expect(remove).not.toHaveBeenCalled();

    await act(async () => trigger.click());
    await act(async () => {
      confirm().click();
      confirm().click();
      trigger.click();
      refresh.click();
    });
    expect(document.activeElement).toBe(trigger);
    expect(remove).toHaveBeenCalledExactlyOnceWith({ confirmed: true });
    expect(panel.textContent).toContain("Deleting diagnostic logs");
    await act(async () => {
      trigger.click();
      refresh.click();
    });
    expect(confirm()).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValueOnce({ status: "unavailable" });
    await act(async () => first.resolve({ status: "incomplete", deleted: 2 }));
    expect(panel.textContent).toContain("Diagnostic log deletion did not finish.");
    expect(panel.textContent).toContain("Diagnostic files removed: 2.");
    expect(panel.textContent).toContain("The log could not be read.");
    await act(async () => refresh.click());
    expect(panel.textContent).toContain("Diagnostic files removed: 2.");
    expect(panel.querySelector("code")?.textContent).toBe("ohtia.application.started");
    expect(remove).toHaveBeenCalledTimes(1);

    await act(async () => trigger.click());
    await act(async () => confirm().click());
    expect(panel.textContent).toContain("The deletion outcome could not be confirmed.");
    expect(panel.textContent).not.toContain("synthetic lost reply");
    await act(async () => refresh.click());
    expect(remove).toHaveBeenCalledTimes(2);
    expect(panel.querySelector("code")?.textContent).toBe("ohtia.application.started");

    await act(async () => trigger.click());
    await act(async () => confirm().click());
    expect(panel.textContent).toContain("Diagnostic files removed: 1.");
    await click('.settings-pages button[id$="-appearance-nav"]');
    await click(diagnostics);
    const reopened = container.querySelector(".diagnostics-panel")!;
    expect(reopened.textContent).toContain("Diagnostic files removed: 1.");
    expect(remove).toHaveBeenCalledTimes(3);
    await act(async () =>
      reopened.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click(),
    );
    await act(async () =>
      reopened.querySelector<HTMLButtonElement>(".primitive-destructive")!.click(),
    );
    expect(reopened.textContent).toContain("The logs are busy.");
    await act(async () =>
      reopened.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click(),
    );
    await act(async () =>
      reopened.querySelector<HTMLButtonElement>(".primitive-destructive")!.click(),
    );
    expect(reopened.textContent).toContain("Diagnostic log deletion is unavailable.");
    expect(reopened.textContent).not.toContain("Diagnostic files removed:");
  });

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

  it("inspects the managed location only on its page and discards a reply from older admission", async () => {
    const t = fixture();
    const first = deferred<Outcome<ManagedStoreLocation>>();
    const cancelFirst = vi.fn();
    const directory = "/home/Synthetic <research>/ohtia";
    t.port.readManagedStoreLocation
      .mockReturnValueOnce({ result: first.promise, cancel: cancelFirst })
      .mockReturnValueOnce(call({ ok: true, value: { state: "unavailable", reason: "missing" } }))
      .mockReturnValueOnce(call({ ok: true, value: { state: "available", directory } }));
    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
      version: 1,
      locale: "en-US",
      state: "storage_ready",
      serviceGeneration: "initial",
    });
    await mount(t);
    await t.intent("settings.open");
    expect(t.port.readManagedStoreLocation).not.toHaveBeenCalled();
    const nav = [...container.querySelectorAll<HTMLButtonElement>(".settings-pages button")].find(
      (button) => button.textContent === message("en-US", "location"),
    )!;
    await act(async () => nav.click());
    const content = container.querySelector<HTMLElement>(".settings-page:not([hidden])")!;
    expect(content.textContent).toContain(message("en-US", "settings.storage.checking"));

    vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
      version: 1,
      locale: "en-US",
      state: "storage_ready",
      serviceGeneration: "replacement",
    });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(cancelFirst).toHaveBeenCalledOnce();
    await act(async () =>
      first.resolve({ ok: true, value: { state: "available", directory: "/old/ohtia" } }),
    );
    expect(content.querySelector("bdi")).toBeNull();
    expect(content.textContent).toContain(message("en-US", "settings.storage.locatorMissing"));

    const check = content.querySelector("button")!;
    await act(async () => {
      check.focus();
      check.click();
    });
    expect(content.querySelector("bdi")?.textContent).toBe(directory);
    expect(content.textContent).toContain(message("en-US", "settings.storage.sensitivity"));
    expect(document.activeElement).toBe(check);
    for (const [result, key] of [
      [failure("busy"), "command.reason.busy"],
      [failure("timeout"), "settings.storage.unavailable"],
      [
        { ok: true, value: { state: "unavailable", reason: "location_display_unavailable" } },
        "settings.storage.unavailable",
      ],
      [
        { ok: true, value: { state: "unavailable", reason: "pending_create" } },
        "settings.storage.openData",
      ],
      [
        { ok: true, value: { state: "unavailable", reason: "located" } },
        "settings.storage.openData",
      ],
      [{ ok: true, value: { state: "unavailable", reason: "path_rejected" } }, "path_rejected"],
    ] as const) {
      t.port.readManagedStoreLocation.mockReturnValueOnce(call(result));
      await act(async () => check.click());
      expect(content.querySelector("[role=status]")?.textContent).toBe(message("en-US", key));
      expect(content.querySelector(".managed-store-directory")).toBeNull();
      expect(document.activeElement).toBe(check);
    }
    expect(t.bridge.bootstrap.restoreCheckpoint).not.toHaveBeenCalled();
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
        .find((button) => button.textContent === "Open AI services")!
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
    titleRevision: 1,
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
    const project: ProjectSummary = {
      needsAttention: false,
      id: "019a8000-0000-7000-8000-000000000101",
      projectType: "thesis",
      title: "Redes de cuidado",
      titleRevision: 1,
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
    subtitle: null,
    titleRevision: 1,
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

it("browses scoped project collections through late reads, retry and pagination", async () => {
  const t = raceFixture();
  const [a, b, c] = t.ids as [string, string, string];
  const names = ["한글로 쓴 연구 제목", "A".repeat(120), "Research notes — ملاحظات علمية"];
  const date = "2026-11-17T10:00:00.000Z";
  const row = (projectId: string, id: string, title: string): ConversationSummary => ({
    id,
    projectId,
    title,
    createdAt: date,
    updatedAt: date,
    revision: 1,
    agentId: "virgilio",
    latestAt: date,
    ownerRevision: 1,
    ownerPosition: null,
    latestPrefix: "",
    latestTruncated: false,
    latestLanguage: null,
    status: null,
    latestReplyTaskId: null,
    runningTask: null,
  });
  const rows = [
    row(b, b, "Current conversation"),
    ...Array.from({ length: 50 }, (_, n) =>
      row(
        b,
        `019a8000-0000-7000-8000-${String(200 - n).padStart(12, "0")}`,
        `Conversation ${n + 1}`,
      ),
    ),
  ];
  const late = deferred<Outcome<ResearchOutputs["conversation.list"]>>();
  let firstAttempt = true;
  let failSecondPage = true;
  let failEmptyProject = true;
  function page(
    items: ConversationSummary[],
    next: { latestAt: string; id: string } | null = null,
  ) {
    return call({ ok: true, value: { items, next, hasMore: next !== null } });
  }
  const listConversations = vi.fn(
    ({ projectId, cursor, count }: Parameters<FoundationPort["listConversations"]>[0]) => {
      if (projectId === a) {
        if (count > 1 && failEmptyProject) {
          failEmptyProject = false;
          return call(failure("storage_failed"));
        }
        return page([]);
      }
      if (count === 1) return page([row(projectId, projectId, "Current conversation")]);
      if (projectId === c) return call(failure("service_unavailable"));
      if (firstAttempt) {
        firstAttempt = false;
        return { result: late.promise, cancel() {} };
      }
      if (!cursor) return page(rows.slice(0, 50), { latestAt: date, id: rows[49]!.id });
      if (failSecondPage) {
        failSecondPage = false;
        return call(failure("storage_failed"));
      }
      return page(rows.slice(50));
    },
  );
  Object.assign(t.port, {
    listProjects: () =>
      call({
        ok: true,
        value: {
          items: t.ids.map((id, n) => ({
            id,
            projectType: "thesis",
            title: names[n],
            documentLanguage: ["ko-KR", "en-US", "en-US"][n],
            isDevelopment: false,
            setupConfirmedAt: date,
            createdAt: date,
            updatedAt: date,
            lastOpenedAt: date,
          })),
          next: null,
          hasMore: false,
        },
      }),
    listConversations,
    readConversations: ({ projectId, ids }: Parameters<FoundationPort["readConversations"]>[0]) =>
      call({
        ok: true,
        value: {
          items: ids.map(
            (id) =>
              rows.find((item) => item.id === id) ?? row(projectId, id, "Current conversation"),
          ),
          remaining: [],
        },
      }),
    listMemory: () =>
      call({
        ok: true,
        value: { projectId: b, entries: [], next: null, active: 0, bytes: 0, revision: 0 },
      }),
    readConnection: () => call({ ok: true, value: { state: "disconnected" } }),
  });
  vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
    version: 1,
    locale: "en-US",
    state: "storage_ready",
    openConversation: { projectId: b, conversationId: b },
  });
  await mount(t);
  const explorer = container.querySelector(".project-explorer")!;
  const button = (label: string) => {
    const element = [...explorer.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) =>
        [...candidate.childNodes]
          .filter(
            (node) => !(node instanceof Element && node.getAttribute("aria-hidden") === "true"),
          )
          .map((node) => node.textContent)
          .join("") === label,
    );
    expect(element, label).toBeDefined();
    return element!;
  };
  const press = async (label: string) => {
    const target = button(label);
    await act(async () => {
      target.focus();
      target.click();
    });
  };
  const title = () => explorer.querySelector(".project-explorer-title bdi");
  const current = () => explorer.querySelector('[aria-current="true"] bdi')?.textContent;
  expect(title()?.textContent).toBe(names[1]);
  expect(current()).toBeUndefined();
  await press("Conversations");
  expect(explorer.textContent).toContain("Loading conversations…");
  await selectRaceProject(0);
  expect(title()?.textContent).toBe(names[0]);
  await press("Conversations");
  expect(explorer.querySelector('[role="alert"]')?.textContent).toContain("couldn’t load");
  await press("Reload conversations");
  expect(document.activeElement).toBe(button("Conversations"));
  expect(explorer.textContent).toContain("No conversations yet.");
  await selectRaceProject(1);
  expect(current()).toBe("Current conversation");
  await act(async () =>
    late.resolve({
      ok: true,
      value: { items: [row(b, b, "Stale response")], next: null, hasMore: false },
    }),
  );
  expect(explorer.textContent).not.toContain("Stale response");
  await press("Sources and documents");
  expect(button("Sources and documents").getAttribute("aria-expanded")).toBe("false");
  expect(button("Conversations").getAttribute("aria-expanded")).toBe("true");
  await press("Load older conversations");
  expect(explorer.querySelector('[role="alert"]')?.textContent).toContain("couldn’t load older");
  expect(current()).toBe("Current conversation");
  await press("Load older conversations");
  expect(document.activeElement).toBe(button("Conversations"));
  expect(current()).toBe("Current conversation");
  await press("Conversation 50");
  expect(current()).toBe("Conversation 50");
  await press("Project memory");
  expect(
    container.querySelector('[role="tabpanel"]:not([hidden]) .project-memory')?.textContent,
  ).toContain("Nothing saved yet");
  expect(current()).toBe("Conversation 50");
  await selectRaceProject(2);
  expect(title()?.textContent).toBe(names[2]);
  await press("Conversations");
  expect(explorer.textContent).toContain("Conversations are unavailable");
  expect(explorer.textContent).not.toContain("Conversation 50");
  expect(button("Sources and documents").getAttribute("aria-expanded")).toBe("true");
});

it("guards the real composer across a failed send and A to B to A", async () => {
  const register = vi.spyOn(PendingProjectWork.prototype, "register");
  const t = raceFixture();
  const failedAppend = deferred<Outcome<{ resultId: string }>>();
  const appendMessage = vi.fn(() => ({ result: failedAppend.promise, cancel() {} }));
  Object.assign(t.port, { appendMessage });

  const currentRegistration = () => ({
    registry: register.mock.contexts.at(-1) as PendingProjectWork,
    lease: register.mock.calls.at(-1)![0],
  });
  const evaluate = () => {
    const { registry, lease } = currentRegistration();
    return registry.evaluate(lease);
  };

  await mount(t);
  const origin = currentRegistration();
  expect(origin.lease.projectId).toBe(t.ids[0]);
  expect(await evaluate()).toMatchObject({ status: "safe_to_detach" });
  const draft = "Retained after a failed send";
  const input = container.querySelector("textarea")!;
  await act(async () => {
    const value = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    value.call(input, draft);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const approved = await evaluate();
  if (approved.status !== "safe_to_detach") throw new Error("Expected unsent text to be retained.");
  expect(approved.isCurrent()).toBe(true);
  expect(appendMessage).not.toHaveBeenCalled();
  await click(`.workspace-chat button[aria-label="${message("en-US", "composer.send")}"]`);
  expect(appendMessage).toHaveBeenCalledOnce();
  expect(approved.isCurrent()).toBe(false);
  expect(await evaluate()).toEqual({ status: "pending_confirmation" });

  await selectRaceProject(1);
  expect(await evaluate()).toMatchObject({ status: "safe_to_detach" });
  await selectRaceProject(0);
  expect(origin.lease.isCurrent()).toBe(false);
  expect(await origin.registry.evaluate(origin.lease)).toEqual({ status: "keep_open" });
  expect(await evaluate()).toEqual({ status: "pending_confirmation" });
  await act(async () => failedAppend.resolve(failure("storage_failed")));
  expect(container.querySelector("textarea")?.value).toBe(draft);
  expect(await evaluate()).toMatchObject({ status: "safe_to_detach" });
});

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

it("marks only history rows with unseen replies and clears a row when its chat is viewed", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const t = raceFixture();
  const projectId = t.ids[0]!;
  const interviews = "019a8000-0000-7000-8000-000000000111";
  const references = "019a8000-0000-7000-8000-000000000112";
  const createdAt = "2026-11-17T10:00:00.000Z";
  const rows = (
    [
      { id: references, title: "References", status: null },
      { id: interviews, title: "Interviews", status: "attention" },
      { id: projectId, title: "Overview", status: null },
    ] as const
  ).map((row): ConversationSummary => ({
    ...row,
    projectId,
    createdAt,
    updatedAt: createdAt,
    latestAt: createdAt,
    revision: 1,
    ownerRevision: 1,
    ownerPosition: null,
    latestPrefix: "",
    latestLanguage: null,
    latestTruncated: false,
    agentId: "virgilio",
    runningTask: null,
    latestReplyTaskId: null,
  }));
  let receive: (event: Outcome<ResearchEvent>) => void = () => {};
  Object.assign(t.port, {
    subscribeResearch: (_scope: ResearchScope, listener: typeof receive) => {
      receive = listener;
      return {
        ready: Promise.resolve({ ok: true, value: { subscriptionId: "history-activity" } }),
        dispose() {},
      };
    },
    readConversations: ({ ids }: { ids: readonly string[] }) =>
      call({
        ok: true,
        value: { items: rows.filter((row) => ids.includes(row.id)), remaining: [] },
      }),
    listConversations: () => call({ ok: true, value: { items: rows, next: null, hasMore: false } }),
    listProjectAttention: () =>
      call({ ok: true, value: { items: [projectId], next: null, hasMore: false, revision: 1 } }),
  });

  await mount(t);
  const show = '[aria-label^="Show conversation history"]';
  const back = '[aria-label="Return to conversation"]';
  const row = (title: string) =>
    [...container.querySelectorAll<HTMLButtonElement>(".chat-history-row")].find(
      (item) => item.querySelector(".chat-history-title")?.textContent === title,
    )!;
  const mark = (title: string) => row(title).querySelector('[data-status="unread"]')?.textContent;
  const finish = (conversationId: string) =>
    act(async () =>
      receive({
        ok: true,
        value: { kind: "replyFinished", projectId, conversationId, agentId: "virgilio" },
      }),
    );
  const count = () => container.querySelector(`${show} .activity-badge-new`)?.textContent;

  await finish(interviews);
  expect(count()).toBe("1");
  await click(show);
  expect(mark("Interviews")).toBe("New reply");
  expect(mark("Overview")).toBeUndefined();
  expect(mark("References")).toBeUndefined();
  expect(row("Interviews").querySelector('[data-status="attention"]')?.textContent).toBe(
    "Needs your attention",
  );

  await finish(references);
  await finish(interviews);
  expect(mark("References")).toBe("New reply");
  expect(mark("Interviews")).toBe("New replies");
  expect(
    [...container.querySelectorAll(".chat-history-title")].map((title) => title.textContent),
  ).toEqual(["References", "Interviews", "Overview"]);
  await click(back);
  expect(count()).toBe("2");
  await click(show);

  await act(async () => row("Interviews").click());
  expect(count()).toBe("1");
  await click(show);
  expect(mark("Interviews")).toBeUndefined();
  expect(mark("References")).toBe("New reply");
  expect(row("Interviews").querySelector('[data-status="attention"]')?.textContent).toBe(
    "Needs your attention",
  );
});

it("keeps hidden chat closed and groups reply announcements by window and conversation", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const t = raceFixture();
  const projectId = t.ids[0]!;
  const otherProject = t.ids[1]!;
  const otherConversation = "019a8000-0000-7000-8000-000000000111";
  let receive: (event: Outcome<ResearchEvent>) => void = () => {};
  Object.assign(t.port, {
    subscribeResearch: (_scope: unknown, listener: typeof receive) => {
      receive = listener;
      return {
        ready: Promise.resolve({ ok: true, value: { subscriptionId: "activity" } }),
        dispose() {},
      };
    },
  });
  vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
    version: 1,
    locale: "en-US",
    state: "storage_ready",
    openConversation: { projectId, conversationId: projectId },
  });
  await mount(t);
  const chatButton = container.querySelector<HTMLButtonElement>(
    '[data-workspace-command="panels.chat"]',
  )!;
  expect(chatButton.getAttribute("aria-expanded")).toBe("true");
  await act(async () => chatButton.click());
  const finish = (project: string, conversationId: string) =>
    receive({
      ok: true,
      value: { kind: "replyFinished", projectId: project, conversationId, agentId: "virgilio" },
    });
  await act(async () => {
    finish(projectId, projectId);
    finish(projectId, otherConversation);
    finish(projectId, otherConversation);
    finish(otherProject, otherProject);
  });
  expect(chatButton.getAttribute("aria-expanded")).toBe("false");
  expect(chatButton.getAttribute("aria-label")).toBe("Open chat, 3 new replies");
  expect(chatButton.querySelector(".activity-badge-new")?.textContent).toBe("3");
  await act(async () => vi.advanceTimersByTimeAsync(1999));
  expect(container.textContent).not.toContain("3 new replies");
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(container.querySelector(".foundation-window > [role=status]")?.textContent).toBe(
    "3 new replies",
  );

  width = 800;
  await act(async () => resize.forEach((notify) => notify()));
  const segment = container.querySelector<HTMLButtonElement>(
    '.workspace-selector [data-workspace-command="panels.chat"]',
  )!;
  expect(segment.getAttribute("aria-label")).toBe("Chat, 3 new replies");
  expect(segment.getAttribute("aria-pressed")).toBe("false");
  await act(async () => segment.click());
  const history = container.querySelector<HTMLButtonElement>(
    '[aria-label^="Show conversation history"]',
  )!;
  expect(history.getAttribute("aria-label")).toBe("Show conversation history, 1 with new replies");
  expect(history.querySelector(".activity-badge-new")?.textContent).toBe("1");

  vi.mocked(document.hasFocus).mockReturnValue(false);
  await act(async () => {
    window.dispatchEvent(new Event("blur"));
    finish(projectId, projectId);
  });
  const documents = container.querySelector<HTMLButtonElement>(
    '.workspace-selector [data-workspace-command="panels.documents"]',
  )!;
  await act(async () => documents.click());
  expect(segment.querySelector(".activity-badge-new")?.textContent).toBe("3");
  await act(async () => segment.click());
  vi.mocked(document.hasFocus).mockReturnValue(true);
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => documents.click());
  expect(segment.querySelector(".activity-badge-new")?.textContent).toBe("2");

  await act(async () => segment.click());
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    finish(projectId, projectId);
    documents.click();
  });
  expect(segment.querySelector(".activity-badge-new")?.textContent).toBe("3");
  visibility.mockReturnValue("visible");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    segment.click();
  });
  await act(async () => documents.click());
  expect(segment.querySelector(".activity-badge-new")?.textContent).toBe("2");
});

it("restarts a mixed-revision attention read and reloads the selector after a sequence gap", async () => {
  const t = raceFixture();
  const [projectId, first, second] = t.ids as [string, string, string];
  let receive: (event: Outcome<ResearchEvent>) => void = () => {};
  let revision = 1;
  const listProjectAttention = vi.fn(({ cursor }: { cursor: string | null }) => {
    const result =
      revision === 1
        ? { items: [first], next: first, hasMore: true, revision: revision++ }
        : revision === 2 && !cursor
          ? { items: [second], next: null, hasMore: false, revision }
          : { items: [], next: null, hasMore: false, revision };
    return call({ ok: true, value: result });
  });
  Object.assign(t.port, {
    listProjectAttention,
    subscribeResearch: (_scope: unknown, listener: typeof receive) => {
      receive = listener;
      return {
        ready: Promise.resolve({ ok: true, value: { subscriptionId: "activity" } }),
        dispose() {},
      };
    },
  });
  vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
    version: 1,
    locale: "en-US",
    state: "storage_ready",
    openConversation: { projectId, conversationId: projectId },
  });
  await mount(t);
  expect(listProjectAttention.mock.calls.map(([{ cursor }]) => cursor)).toEqual([
    null,
    first,
    null,
  ]);
  const selector = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  expect(selector.getAttribute("aria-label")).toBe("Current project");
  expect(selector.textContent).toBe("Project 1. Another project needs your attention.");
  await act(async () => selector.click());
  const marked = [...document.querySelectorAll('[role="option"]')].filter((row) =>
    row.textContent?.includes("Needs your attention"),
  );
  expect(marked.map((row) => row.querySelector("bdi")?.textContent)).toEqual(["Project 3"]);
  await act(async () =>
    receive({
      ok: true,
      value: { kind: "attentionRaised", source: "plan" },
    }),
  );
  expect(container.querySelector(".foundation-window > [role=alert]")?.textContent).toBe(
    "A plan needs your attention.",
  );
  revision = 3;
  await act(async () => receive(failure("sequence_gap")));
  expect(listProjectAttention).toHaveBeenLastCalledWith({ cursor: null, count: 128 });
  expect(selector.getAttribute("aria-label")).toBe("Current project");
  expect(selector.querySelector(".activity-badge")).toBeNull();
});

it("retries an incomplete conversation-attention snapshot at the same project revision", async () => {
  const {
    ids: [projectId, conversationId],
  } = raceFixture();
  const listProjectAttention = vi.fn(() =>
    call({ ok: true, value: { items: [projectId], next: null, hasMore: false, revision: 5 } }),
  );
  const listConversations = vi
    .fn()
    .mockReturnValueOnce(call(failure("storage_failed")))
    .mockReturnValue(
      call({
        ok: true,
        value: { items: [{ id: conversationId, status: "attention" }], next: null, hasMore: false },
      }),
    );
  const activity = new ActivityController({
    listProjectAttention,
    listConversations,
  } as unknown as FoundationPort);
  disposals.push(() => activity.dispose());
  activity.open({ projectId: projectId!, conversationId: null });
  activity.ready();
  await vi.advanceTimersByTimeAsync(0);
  expect(activity.snapshot().chat.attention).toBe(1);
  expect(activity.snapshot().history.attention).toBe(0);
  await vi.advanceTimersByTimeAsync(250);
  expect(listProjectAttention).toHaveBeenCalledTimes(2);
  expect(activity.snapshot().history.attention).toBe(1);
  activity.event({ kind: "projectAttention", revision: 5 });
  await vi.advanceTimersByTimeAsync(250);
  expect(listProjectAttention).toHaveBeenCalledTimes(2);
});

it("keeps unread row snapshots independent between windows and across project switches", () => {
  const { ids } = raceFixture();
  const [projectId, otherProjectId] = ids;
  const conversationId = "019a8000-0000-7000-8000-000000000111";
  const first = new ActivityController({} as FoundationPort);
  const second = new ActivityController({} as FoundationPort);
  disposals.push(
    () => first.dispose(),
    () => second.dispose(),
  );
  const finish = (activity: ActivityController, project: string, conversation: string) =>
    activity.event({
      kind: "replyFinished",
      projectId: project,
      conversationId: conversation,
      agentId: "virgilio",
    });
  first.open({ projectId: projectId!, conversationId: null });
  second.open({ projectId: projectId!, conversationId: null });
  finish(first, projectId!, conversationId);
  finish(second, projectId!, conversationId);
  const previous = first.snapshot().unreadReplies;
  finish(first, projectId!, conversationId);
  expect(first.snapshot().unreadReplies.get(conversationId)).toBe(2);
  expect(previous.get(conversationId)).toBe(1);
  expect(second.snapshot().unreadReplies.get(conversationId)).toBe(1);

  first.open({ projectId: projectId!, conversationId });
  first.presentation(true, false);
  expect(first.snapshot().unreadReplies.get(conversationId)).toBe(2);
  first.presentation(true, true);
  expect(first.snapshot().unreadReplies.size).toBe(0);
  expect(second.snapshot().unreadReplies.get(conversationId)).toBe(1);

  finish(second, projectId!, conversationId);
  second.open({ projectId: otherProjectId!, conversationId: null });
  finish(second, otherProjectId!, otherProjectId!);
  finish(second, otherProjectId!, otherProjectId!);
  expect(second.snapshot().history.replies).toBe(1);
  expect([...second.snapshot().unreadReplies]).toEqual([[otherProjectId, 2]]);
  second.open({ projectId: projectId!, conversationId: null });
  expect(second.snapshot().history.replies).toBe(1);
  expect([...second.snapshot().unreadReplies]).toEqual([[conversationId, 2]]);
});

it("does not include the previous project's replies in the next project's announcement", async () => {
  const { ids } = raceFixture();
  const activity = new ActivityController({} as FoundationPort);
  disposals.push(() => activity.dispose());
  const finish = (projectId: string) => {
    activity.open({ projectId, conversationId: null });
    activity.event({
      kind: "replyFinished",
      projectId,
      conversationId: projectId,
      agentId: "virgilio",
    });
  };
  finish(ids[0]!);
  await vi.advanceTimersByTimeAsync(1000);
  finish(ids[1]!);
  await vi.advanceTimersByTimeAsync(1000);
  expect(activity.snapshot().replyAnnouncement).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1000);
  expect(activity.snapshot().replyAnnouncement).toMatchObject({ count: 1 });
  activity.open({ projectId: ids[0]!, conversationId: null });
  expect(activity.snapshot().chat.replies).toBe(1);
});

it("opens project memory from chat and navigates to a source message in its own conversation", async () => {
  const t = raceFixture();
  const projectId = t.ids[0]!;
  const otherConversation = "019a8000-0000-7000-8000-000000000234";
  const textId = "019a8000-0000-7000-8000-000000000235";
  const sourceId = "019a8000-0000-7000-8000-000000000236";
  const entryId = "019a8000-0000-7000-8000-000000000237";
  const date = "2026-11-21T12:00:00.000Z";
  const entryPrefix = "Archive  records\n" + "😀".repeat(271);
  expect(Array.from(entryPrefix)).toHaveLength(288);
  const entryText = entryPrefix + " remaining";
  let entryVersion = 1;
  let entryKind = "decision";
  let entryState = "active";
  let receive: (notice: Outcome<ResearchEvent>) => void = () => {};
  const listMemory = vi.fn(() =>
    call({
      ok: true,
      value: {
        projectId,
        revision: entryVersion,
        active: entryState === "active" ? 1 : 0,
        bytes: 140,
        next: null,
        entries: [
          {
            id: entryId,
            number: entryVersion,
            kind: entryKind,
            text: entryText,
            state: entryState,
            change: "added",
            author: "virgilio",
            originalAuthor: "virgilio",
            date,
            source: {
              messageId: sourceId,
              conversationId: otherConversation,
              prefix: "🧪".repeat(280),
              truncated: false,
            },
          },
        ],
      },
    }),
  );
  const addMemory = vi.fn(() => call({ ok: true, value: { resultId: entryId } }));
  Object.assign(t.port, {
    listMemory,
    addMemory,
    subscribeResearch: (_scope: ResearchScope, listener: typeof receive) => {
      receive = listener;
      return {
        ready: Promise.resolve({ ok: true, value: { subscriptionId: "memory-limits" } }),
        dispose() {},
      };
    },
    readMemoryHistory: () =>
      call({
        ok: true,
        value: {
          entryId,
          versions: [
            {
              number: 1,
              kind: "decision",
              text: entryText,
              state: "active",
              change: "added",
              author: "virgilio",
              date,
            },
          ],
          next: null,
        },
      }),
    listTimelineBefore: ({ conversationId }: { conversationId: string }) =>
      call({
        ok: true,
        value: {
          next: null,
          hasMore: false,
          items: [
            {
              kind: "message",
              rank: 1,
              revision: 1,
              position: 1,
              authorKind: "researcher",
              agentId: null,
              taskId: null,
              language: null,
              ending: null,
              id: conversationId === projectId ? textId : sourceId,
              content: conversationId === projectId ? "My work." : "🧪".repeat(280),
            },
          ],
        },
      }),
    readConversations: ({ ids }: { ids: string[] }) =>
      call({
        ok: true,
        value: {
          remaining: [],
          items: ids.map((id) => ({
            id,
            projectId,
            title: id === otherConversation ? "Municipal records" : "Working conversation",
            createdAt: date,
            updatedAt: date,
            latestAt: date,
            revision: 1,
            ownerRevision: 1,
            agentId: "virgilio",
            ownerPosition: null,
            latestPrefix: "",
            latestTruncated: false,
            latestLanguage: null,
            status: null,
            latestReplyTaskId: null,
            runningTask: null,
          })),
        },
      }),
  });
  vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
    version: 1,
    locale: "en-US",
    state: "storage_ready",
    openConversation: { projectId, conversationId: projectId },
  });
  await mount(t);
  await click('.workspace-chat [aria-label="Add memory entry…"]');
  const memory = container.querySelector<HTMLElement>("#project-memory")!;
  expect(document.activeElement).toBe(memory.querySelector("textarea"));
  expect(memory.querySelector("textarea")?.value).toBe("My work.");
  expect(memory.querySelector("select")?.value).toBe("decision");
  let displayedText = memory.querySelector(".memory-entry .memory-text")!;
  expect(displayedText.textContent).toBe(entryPrefix + "…");
  const expand = memory.querySelector<HTMLButtonElement>(".memory-entry button[aria-expanded]")!;
  expect(expand.textContent).toBe("Show full entry text");
  expect(expand.getAttribute("aria-controls")).toBe(displayedText.id);
  await act(async () => {
    expand.focus();
    expand.click();
  });
  expect(displayedText.textContent).toBe(entryText);
  expect(expand.textContent).toBe("Show less");
  expect(expand.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(expand);
  await act(async () => expand.click());
  expect(displayedText.textContent).toBe(entryPrefix + "…");
  await act(async () => expand.click());
  const publishEntryVersion = () => {
    receive({
      ok: true,
      value: { kind: "changed", record: "memory", id: projectId, revision: ++entryVersion },
    });
  };
  await act(async () => publishEntryVersion());
  expect(listMemory.mock.calls.length).toBeGreaterThan(1);
  expect(document.activeElement).toBe(expand);
  expect(expand.getAttribute("aria-expanded")).toBe("false");
  expect(displayedText.textContent).toBe(entryPrefix + "…");
  await act(async () => {
    entryKind = "focus";
    publishEntryVersion();
  });
  const relocated = memory.querySelector(".memory-entry .memory-text")!;
  expect(relocated).not.toBe(displayedText);
  displayedText = relocated;
  expect(displayedText.closest(".memory-group")?.querySelector("h2")?.textContent).toBe("Focus");
  expect(document.activeElement).toBe(displayedText);
  await act(async () => {
    memory.querySelector<HTMLButtonElement>(".memory-entry button[aria-expanded]")?.focus();
  });

  expect(memory.querySelector("q")?.textContent).toBe("🧪".repeat(144) + "…");
  await act(async () =>
    t.settings.notify({
      ok: true,
      value: {
        ...t.settings.current,
        sourceQuote: { schemaVersion: 1, revision: 1, value: 0, source: "saved" },
      },
    }),
  );
  expect(memory.querySelector("q")?.textContent).toBe("🧪".repeat(280));
  expect(displayedText.textContent).toBe(entryPrefix + "…");
  await act(async () =>
    t.settings.notify({
      ok: true,
      value: {
        ...t.settings.current,
        entryText: { schemaVersion: 1, revision: 1, value: 0, source: "saved" },
      },
    }),
  );
  expect(displayedText.textContent).toBe(entryText);
  expect(memory.querySelector(".memory-entry button[aria-expanded]")).toBeNull();
  expect(document.activeElement).toBe(displayedText);
  expect(memory.querySelector("q")?.textContent).toBe("🧪".repeat(280));
  expect(memory.querySelector("textarea")?.value).toBe("My work.");
  expect(memory.querySelector("select")?.value).toBe("decision");
  await click('#project-memory button[type="submit"]');
  expect(addMemory).toHaveBeenCalledWith(expect.any(String), {
    projectId,
    kind: "decision",
    text: "My work.",
    sourceMessageId: textId,
  });
  await act(async () =>
    t.settings.notify({
      ok: true,
      value: {
        ...t.settings.current,
        entryText: {
          schemaVersion: 1,
          revision: 2,
          value: Array.from(entryText).length,
          source: "saved",
        },
      },
    }),
  );
  expect(displayedText.textContent).toBe(entryText);
  expect(memory.querySelector(".memory-entry button[aria-expanded]")).toBeNull();
  await act(async () =>
    t.settings.notify({
      ok: true,
      value: {
        ...t.settings.current,
        entryText: { schemaVersion: 1, revision: 3, value: 12, source: "saved" },
      },
    }),
  );
  expect(displayedText.textContent).toBe("Archive  rec…");
  const action = (name: string) =>
    Array.from(memory.querySelectorAll("button")).find((button) => button.textContent === name)!;
  await act(async () => action("Show entry history").click());
  expect(memory.querySelector(".memory-history .memory-text")?.textContent).toBe(entryText);
  await act(async () => action("Edit entry").click());
  expect(memory.querySelector("textarea")?.value).toBe(entryText);
  await act(async () => action("Discard changes").click());
  await click("#project-memory a");
  expect(container.querySelector(".workspace-chat h2")?.textContent).toContain("Municipal records");
  expect(document.activeElement?.id).toBe(`message-${sourceId}`);
  expect(container.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe(
    "Project memory",
  );
  await act(async () => {
    memory.querySelector<HTMLButtonElement>(".memory-entry button[aria-expanded]")?.focus();
    entryState = "withdrawn";
    publishEntryVersion();
  });
  expect(memory.querySelector(".memory-entry")).toBeNull();
  expect(document.activeElement).toBe(memory.querySelector(".project-memory-tools > button"));
});

it("loads the full scoped message, recovers a failed quote and discards an obsolete source read", async () => {
  const currentProject = "project-1";
  const otherProject = "project-2";
  const oldSource = "source-1";
  const newSource = "source-2";
  const conversationId = "conversation-1";
  const markup = "**😀🧪**   " + "x".repeat(9000) + "   final text";
  const parts = splitText(markup);
  const descriptor = {
    source: `message_${oldSource}`,
    bytes: Buffer.byteLength(markup),
    sha256: createHash("sha256").update(markup).digest("hex"),
    parts: parts.length,
  };
  vi.stubGlobal("crypto", {
    subtle: {
      digest: (_algorithm: string, input: Uint8Array) =>
        Promise.resolve(Uint8Array.from(createHash("sha256").update(input).digest()).buffer),
    },
  });
  const timeline: ResearchOutputs["timeline.read"] = {
    items: [
      {
        id: oldSource,
        kind: "message",
        rank: 1,
        revision: 1,
        position: 1,
        authorKind: "researcher",
        agentId: null,
        taskId: null,
        language: null,
        ending: null,
        content: descriptor,
      },
    ],
    remaining: [],
  };
  const readTimeline = vi.fn(() => call({ ok: true, value: timeline }));
  const readTextPart = vi.fn(({ index }: { index: number }) =>
    call({ ok: true, value: { text: parts[index - 1]! } }),
  );
  readTextPart.mockReturnValueOnce(call(failure("service_unavailable")) as never);
  const listMemory = vi.fn(({ projectId }: { projectId: string }) =>
    call({
      ok: true,
      value: {
        projectId,
        revision: 1,
        active: 1,
        next: null,
        bytes: 1,
        entries: [
          {
            id: "entry",
            number: 1,
            kind: "decision",
            text: "The memory entry is fully visible.",
            state: "active",
            change: "added",
            author: "researcher",
            originalAuthor: "researcher",
            date: "2026-11-21T12:00:00.000Z",
            source:
              projectId === currentProject
                ? {
                    messageId: oldSource,
                    conversationId,
                    prefix: markup.slice(0, 1024),
                    truncated: true,
                  }
                : {
                    messageId: newSource,
                    conversationId: "other-conversation",
                    prefix: "Current source",
                    truncated: false,
                  },
          },
        ],
      },
    }),
  );
  const port = { listMemory, readTimeline, readTextPart } as unknown as FoundationPort;
  const drafts = new ProjectMemoryDrafts();
  const observe = () => () => {};
  const goToMessage = vi.fn();
  const render = async (projectId: string, limit: number) => {
    await act(async () =>
      root.render(
        h(ProjectMemoryView, {
          key: projectId,
          projectId,
          locale: "en-US",
          port,
          drafts,
          observe,
          goToMessage,
          sourceQuoteLength: limit,
          entryTextLength: 288,
          draftRequest: undefined,
        }),
      ),
    );
  };
  await render(currentProject, 0);
  expect(container.querySelector(".memory-source q")).toBeNull();
  expect(container.querySelector(".memory-source [role=alert]")?.textContent).toContain(
    "couldn’t load",
  );
  expect(container.querySelector(".memory-source a")?.getAttribute("href")).toBe(
    `#message-${oldSource}`,
  );
  await click(".memory-source button");
  expect(container.querySelector("q")?.textContent).toBe(
    "😀🧪 " + "x".repeat(9000) + " final text",
  );
  expect(readTimeline).toHaveBeenLastCalledWith({ conversationId, ids: [oldSource] });
  expect(readTextPart).toHaveBeenCalledTimes(parts.length + 1);
  expect(container.querySelector(".memory-text")?.textContent).toBe(
    "The memory entry is fully visible.",
  );

  await render(currentProject, 1200);
  expect(Array.from(container.querySelector("q")!.textContent!)).toHaveLength(1201);
  expect(container.querySelector("q")?.textContent).toMatch(/^😀🧪 x+…$/u);
  await render(currentProject, 1);
  expect(container.querySelector("q")?.textContent).toBe("😀…");
  expect(conversationPreview(markup, false)).toBe("😀🧪 " + "x".repeat(117) + "…");
  expect(readTimeline).toHaveBeenCalledTimes(2);

  const late = deferred<Outcome<ResearchOutputs["timeline.read"]>>();
  const cancel = vi.fn();
  await render(otherProject, 0);
  readTimeline.mockReturnValueOnce({ result: late.promise, cancel } as never);
  await render(currentProject, 0);
  expect(container.querySelector(".memory-source [role=status]")?.textContent).toBe(
    "Loading source quotation…",
  );
  await click(".memory-source a");
  expect(goToMessage).toHaveBeenCalledWith(
    expect.objectContaining({ messageId: oldSource, conversationId }),
  );
  await render(otherProject, 0);
  expect(cancel).toHaveBeenCalledOnce();
  await act(async () => late.resolve({ ok: true, value: timeline }));
  expect(container.querySelector("q")?.textContent).toBe("Current source");
  expect(container.querySelector(".memory-source a")?.getAttribute("href")).toBe(
    `#message-${newSource}`,
  );
  expect(readTextPart).toHaveBeenCalledTimes(parts.length + 1);
});

it("renames by keyboard after IME and shows a committed title through refresh failure", async () => {
  const t = raceFixture();
  const title = "연구 제목 " + "A".repeat(120) + " مراجعة";
  const rename = vi.fn<FoundationPort["renameProject"]>((_operation, input) =>
    call({
      ok: true,
      value: {
        resultId: input.projectId,
        titleChange: { title: input.title, subtitle: input.subtitle, titleRevision: 2 },
      },
    }),
  );
  let observe: ((event: Outcome<ResearchEvent>) => void) | undefined;
  const subscribe = t.port.subscribeResearch;
  Object.assign(t.port, {
    subscribeResearch: (scope: ResearchScope, listener: NonNullable<typeof observe>) => {
      observe = listener;
      return subscribe(scope, listener);
    },
    renameProject: rename,
    readProject: () => call(failure("storage_failed")),
  });
  await mount(t);
  const trigger = container.querySelector<HTMLButtonElement>(
    '[data-workspace-command="project.rename"]',
  )!;
  await act(async () => trigger.focus());
  await act(async () => trigger.click());
  let input = container.querySelector<HTMLInputElement>("dialog[open] input")!;
  expect(document.activeElement === input).toBe(true);
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  expect(document.activeElement === trigger).toBe(true);
  expect(rename).not.toHaveBeenCalled();
  await act(async () => trigger.click());
  input = container.querySelector<HTMLInputElement>("dialog[open] input")!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, " leading space");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(rename).not.toHaveBeenCalled();
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        isComposing: true,
      }),
    );
    set.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  });
  expect(rename).not.toHaveBeenCalled();
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true }),
    );
  });
  expect(rename).toHaveBeenCalledExactlyOnceWith(expect.any(String), {
    projectId: t.ids[0],
    title,
    subtitle: null,
    expectedTitleRevision: 1,
  });
  expect(document.activeElement === trigger).toBe(true);
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe(title);
  expect(container.querySelector(".project-rename-refresh [role=status]")?.textContent).toBe(
    message("en-US", "project.rename.refreshFailed"),
  );
  expect(container.querySelector("dialog[open]")).toBeNull();
  const reload = container.querySelector<HTMLButtonElement>(".project-rename-refresh button")!;
  const previousNotice = container.querySelector(".project-rename-refresh [role=status] span");
  await act(async () => {
    reload.focus();
    reload.click();
  });
  expect(document.activeElement === reload).toBe(true);
  expect(
    container.querySelector(".project-rename-refresh [role=status] span") !== previousNotice,
  ).toBe(true);

  await act(async () => trigger.click());
  const editing = container.querySelector<HTMLInputElement>("dialog[open] input")!;
  Object.assign(t.port, { readTimeline: () => call(failure("storage_failed")) });
  await act(async () =>
    observe?.({
      ok: true,
      value: { kind: "changed", record: "timeline", id: t.ids[1]!, revision: 2 },
    }),
  );
  const action = container.querySelector<HTMLButtonElement>("dialog[open] .primitive-primary")!;
  expect(action.getAttribute("aria-disabled")).toBe("false");
  rename.mockReturnValueOnce(call(failure("uncertain")));
  await act(async () => action.click());
  expect(container.querySelector("dialog[open] [role=status]")?.textContent).toContain(
    message("en-US", "project.rename.uncertain"),
  );
  await act(async () => observe?.(failure("service_unavailable")));
  const dialog = container.querySelector<HTMLDialogElement>("dialog[open]")!;
  expect(dialog.querySelector("input")?.value).toBe(title);
  const status = dialog.querySelector("[role=status]")?.textContent;
  expect(status).toContain(message("en-US", "project.rename.unavailable"));
  expect(status).toContain(message("en-US", "project.rename.uncertain"));
  const save = dialog.querySelector<HTMLButtonElement>(".primitive-primary")!;
  expect(save.getAttribute("aria-disabled")).toBe("true");
  await act(async () => {
    save.click();
    editing.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  expect(rename).toHaveBeenCalledTimes(2);
});

it("refreshes the selected thesis after a title read failure without replaying the event", async () => {
  const t = raceFixture();
  let observe: ((event: Outcome<ResearchEvent>) => void) | undefined;
  const subscribe = t.port.subscribeResearch;
  const timestamp = "2026-11-17T10:00:00.000Z";
  const projectId = t.ids[0]!;
  const later = {
    id: projectId,
    projectType: "thesis" as const,
    title: "Title from another window",
    titleRevision: 2,
    documentLanguage: "en-US",
    isDevelopment: false,
    setupConfirmedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
  };
  const readProject = vi
    .fn<FoundationPort["readProject"]>()
    .mockImplementationOnce(() => {
      throw new Error("Synthetic read transport failure");
    })
    .mockReturnValueOnce(call({ ok: true, value: later }));
  Object.assign(t.port, {
    subscribeResearch: (scope: ResearchScope, listener: NonNullable<typeof observe>) => {
      observe = listener;
      return subscribe(scope, listener);
    },
    readProject,
  });
  await mount(t);
  await act(async () =>
    observe?.({
      ok: true,
      value: { kind: "changed", record: "projectTitle", id: t.ids[1]!, revision: 2 },
    }),
  );
  expect(readProject).not.toHaveBeenCalled();
  await act(async () =>
    observe?.({
      ok: true,
      value: { kind: "changed", record: "projectTitle", id: projectId, revision: 2 },
    }),
  );
  expect(readProject).toHaveBeenCalledExactlyOnceWith({ projectId });
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe("Project 1");
  const retry = container.querySelector<HTMLButtonElement>(".project-rename-refresh button")!;
  expect(retry).not.toBeNull();
  await act(async () => {
    retry.focus();
    retry.click();
  });
  expect(readProject).toHaveBeenCalledTimes(2);
  expect(readProject.mock.calls[1]).toEqual([{ projectId }]);
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe(
    "Title from another window",
  );
  expect(container.querySelector(".project-rename-refresh")).toBeNull();
  expect(document.activeElement === container.querySelector(".project-selector-button")).toBe(true);

  readProject.mockReturnValueOnce(call(failure("storage_failed")));
  await act(async () =>
    observe?.({
      ok: true,
      value: { kind: "changed", record: "projectTitle", id: projectId, revision: 3 },
    }),
  );
  const background = deferred<Outcome<typeof later>>();
  readProject.mockReturnValueOnce({ result: background.promise, cancel() {} });
  const coalesced = container.querySelector<HTMLButtonElement>(".project-rename-refresh button")!;
  await act(async () => {
    coalesced.focus();
    observe?.({
      ok: true,
      value: { kind: "changed", record: "projectTitle", id: projectId, revision: 4 },
    });
  });
  await act(async () => coalesced.click());
  expect(readProject).toHaveBeenCalledTimes(4);
  await act(async () =>
    background.resolve({
      ok: true,
      value: { ...later, title: "Background title", titleRevision: 4 },
    }),
  );
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe(
    "Background title",
  );
  expect(container.querySelector(".project-rename-refresh")).toBeNull();
  expect(document.activeElement === container.querySelector(".project-selector-button")).toBe(true);

  readProject.mockReturnValueOnce(call(failure("storage_failed")));
  await act(async () =>
    observe?.({
      ok: true,
      value: { kind: "changed", record: "projectTitle", id: projectId, revision: 5 },
    }),
  );
  expect(container.querySelector(".project-rename-refresh")).not.toBeNull();
  Object.assign(t.port, {
    listProjects: () =>
      call({
        ok: true,
        value: {
          items: [{ ...later, title: "Caught-up title", titleRevision: 5, needsAttention: false }],
          next: null,
          hasMore: false,
        },
      }),
  });
  await act(async () =>
    observe?.({
      ok: true,
      value: { kind: "changed", record: "project", id: t.ids[1]!, revision: 1 },
    }),
  );
  expect(container.querySelector(".project-selector-button bdi")?.textContent).toBe(
    "Caught-up title",
  );
  expect(container.querySelector(".project-rename-refresh")).toBeNull();
  expect(readProject).toHaveBeenCalledTimes(5);
});

it("retains only the revalidated project manuscript across scopes and renders the exact saved revision", async () => {
  const t = raceFixture();
  const [a, b] = t.ids;
  const id = (n: number) => `019a8000-0000-7000-8000-${String(n).padStart(12, "0")}`;
  const first = { draftId: id(402), title: "Saved workspace label", currentRevisionId: id(502) };
  const second = { draftId: id(403), title: "Second manuscript", currentRevisionId: id(503) };
  const firstText = `---\nohtia_draft_format: ohtia-markdown-v1\nohtia_draft_id: draft_${first.draftId}\n---\n\n# 연구 제목 {#sec_heading}\n\n::: {#blk_body .ohtia-block}\n문단 하나  \n새 줄\n이어지는 줄\n:::\n`;
  const chunks = splitText(firstText);
  const date = "2026-11-17T10:00:00.000Z";
  const stale = deferred<Outcome<ResearchOutputs["manuscript.list"]>>();
  let held = false;
  let removed = false;
  let failedList = true;
  let failedPart = true;
  let subscription = 0;
  let observer: ((notice: Outcome<ResearchEvent>) => void) | undefined;
  const aborted = vi.fn();
  const listManuscripts = vi.fn(
    ({ projectId, after }: Parameters<FoundationPort["listManuscripts"]>[0]) => {
      if (projectId === b)
        return call({ ok: true, value: { projectId, manuscripts: [], next: null } });
      if (failedList) {
        failedList = false;
        return call(failure("storage_failed"));
      }
      if (held) return { result: stale.promise, cancel: aborted };
      const manuscripts = removed || after ? [second] : [first];
      return call({
        ok: true,
        value: { projectId, manuscripts, next: removed || after ? null : first.draftId },
      });
    },
  );
  const readManuscript = vi.fn(
    ({ projectId, draftId }: Parameters<FoundationPort["readManuscript"]>[0]) => {
      const record = draftId === first.draftId ? first : second;
      const source =
        draftId === first.draftId
          ? firstText
          : `---\nohtia_draft_format: ohtia-markdown-v1\nohtia_draft_id: draft_${draftId}\n---\n`;
      const sha256 = createHash("sha256").update(source).digest("hex");
      const markdown =
        draftId === first.draftId
          ? {
              source: record.currentRevisionId,
              parts: chunks.length,
              bytes: Buffer.byteLength(source),
              sha256,
            }
          : source;
      return call({
        ok: true,
        value: {
          markdown,
          revision: {
            projectId,
            draftId,
            revisionId: record.currentRevisionId,
            language: "ko-KR",
            contentSha256: sha256,
            parentRevisionId: null,
            restorationOriginId: null,
            createdAt: date,
            saveReason: "initial",
            authorKind: "researcher",
            recordingActor: "utility",
          },
        },
      });
    },
  );
  const readManuscriptPart = vi.fn(
    ({
      projectId,
      draftId,
      revisionId,
      index,
    }: Parameters<FoundationPort["readManuscriptPart"]>[0]) => {
      if (failedPart) {
        failedPart = false;
        return call(failure("storage_failed"));
      }
      return call({
        ok: true,
        value: { projectId, draftId, revisionId, index, text: chunks[index - 1] },
      });
    },
  );
  vi.stubGlobal("crypto", {
    randomUUID,
    subtle: {
      digest: async (_algorithm: string, bytes: Uint8Array) =>
        Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer,
    },
  });
  vi.stubGlobal("TextEncoder", TextEncoder);
  Object.assign(t.port, {
    listManuscripts,
    readManuscript,
    readManuscriptPart,
    subscribeResearch: (_scope: ResearchScope, listener: typeof observer) => {
      observer = listener;
      return {
        ready: Promise.resolve({ ok: true, value: { subscriptionId: `scope-${++subscription}` } }),
        dispose: vi.fn(),
      };
    },
  });
  await mount(t);
  const workspace = container.querySelector(".workspace")!;
  const buttons = (scope: Element) => [...scope.querySelectorAll<HTMLButtonElement>("button")];
  const manuscripts = () => {
    const trigger = buttons(workspace).find((button) => button.textContent === "Manuscript")!;
    return trigger.closest("li")!;
  };
  const tab = (name: string) =>
    buttons(workspace).find(
      (button) => button.getAttribute("role") === "tab" && button.textContent === name,
    );
  const article = () => workspace.querySelector("article.workspace-manuscript");
  const surface = () => workspace.querySelector(".workspace-manuscript-surface")!;
  async function press(scope: Element, name: string) {
    const button = buttons(scope).find(
      (entry) => entry.textContent === name || entry.getAttribute("aria-label") === name,
    );
    expect(button, name).toBeDefined();
    await act(async () => {
      button!.focus();
      button!.click();
    });
  }
  expect(manuscripts().textContent).toContain("Could not load the manuscript list.");
  await press(manuscripts(), "Try again");
  expect(listManuscripts).toHaveBeenLastCalledWith({
    projectId: a,
    after: first.draftId,
    subscriptionId: "scope-1",
  });
  await press(manuscripts(), "Manuscript");
  expect(surface().textContent).toContain("Could not open the manuscript.");
  expect(article()).toBeNull();
  await press(surface(), "Try again");
  expect(article()?.getAttribute("lang")).toBe("ko-KR");
  expect(article()?.querySelector("h1")?.textContent).toBe("연구 제목");
  expect(article()?.querySelector("p br")).not.toBeNull();
  expect(article()?.querySelector("p")?.textContent).toBe("문단 하나새 줄 이어지는 줄");
  expect(tab(first.title)).toBeUndefined();
  expect(tab(second.title)).toBeUndefined();
  expect(readManuscript.mock.calls.every(([input]) => input.draftId === first.draftId)).toBe(true);
  held = true;
  await act(async () =>
    observer?.({ ok: true, value: { kind: "changed", record: "manuscript", id: b, revision: 3 } }),
  );
  expect(listManuscripts).toHaveBeenCalledTimes(3);
  await act(async () =>
    observer?.({ ok: true, value: { kind: "changed", record: "manuscript", id: a, revision: 4 } }),
  );
  expect(manuscripts().textContent).toContain("Loading…");
  await act(async () =>
    observer?.({ ok: true, value: { kind: "changed", record: "manuscript", id: a, revision: 5 } }),
  );
  expect(aborted).toHaveBeenCalledOnce();
  await selectRaceProject(1);
  expect(manuscripts().textContent).toContain("No manuscripts yet.");
  expect(tab(first.title)).toBeUndefined();
  expect(tab("Navigator")?.getAttribute("aria-selected")).toBe("true");
  removed = true;
  held = false;
  await selectRaceProject(0);
  await act(async () =>
    stale.resolve({ ok: true, value: { projectId: a!, manuscripts: [first], next: null } }),
  );
  expect(tab(first.title)).toBeUndefined();
  expect(tab(second.title)).toBeUndefined();
  expect(tab("Navigator")?.getAttribute("aria-selected")).toBe("true");
  expect(readManuscript.mock.calls.every(([input]) => input.projectId === a)).toBe(true);
  width = 600;
  await act(async () => resize.forEach((observe) => observe()));
  await press(workspace, message("en-US", "workspace.contents"));
  await press(manuscripts(), "Manuscript");
  expect(surface().hasAttribute("hidden")).toBe(false);
  expect(surface().textContent).toContain("This manuscript has no text yet.");
  const retained = article();
  expect(retained).not.toBeNull();
  const current = await t.bridge.bootstrap.read();
  const readsBeforeRecovery = readManuscript.mock.calls.length;
  vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({ ...current, state: "storage_failed" });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(article()).toBe(retained);
  expect(retained?.closest(".workspace-manuscript-view")?.hasAttribute("inert")).toBe(true);
  expect(retained?.closest(".application-workspace")?.hasAttribute("hidden")).toBe(true);
  expect(readManuscript).toHaveBeenCalledTimes(readsBeforeRecovery);
  vi.mocked(t.bridge.bootstrap.read).mockResolvedValue({
    ...current,
    serviceGeneration: "replacement",
  });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(retained?.closest(".application-workspace")?.hasAttribute("hidden")).toBe(false);
  expect(article()).toBe(retained);
  expect(retained?.closest(".workspace-manuscript-view")?.hasAttribute("inert")).toBe(false);
  expect(readManuscript.mock.calls.length).toBeGreaterThan(readsBeforeRecovery);
  failedList = true;
  await act(async () => observer?.(failure("sequence_gap")));
  expect(manuscripts().textContent).toContain("Could not load the manuscript list.");
  expect(article()).toBe(retained);
  expect(retained?.closest(".workspace-manuscript-view")?.hasAttribute("inert")).toBe(false);
  const panelStatus = retained
    ?.closest(".workspace-manuscript-surface")
    ?.querySelector('[role="status"]');
  expect(panelStatus?.textContent).toBe("");
  await press(manuscripts(), "Try again");
  expect(manuscripts().textContent).not.toContain("Could not load the manuscript list.");
  expect(article()).toBe(retained);
}, 60000);
function profileHelpers() {
  const button = (root: ParentNode, label: string) => {
    const match = [...root.querySelectorAll("button")].find(
      (node) => (node.getAttribute("aria-label") ?? node.textContent) === label,
    );
    if (!match) throw new Error(`Missing button: ${label}`);
    return match;
  };
  const activate = async (node: HTMLElement) =>
    act(async () => {
      node.focus();
      node.click();
    });
  const press = async (node: HTMLElement, key: string) =>
    act(async () => node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  const change = async (
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    value: string,
  ) =>
    act(async () => {
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
      set.call(input, value);
      input.dispatchEvent(
        new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
      );
    });
  const choose = async (field: Element, state: string) =>
    activate(field.querySelector<HTMLInputElement>(`input[type="radio"][value="${state}"]`)!);
  return { button, activate, press, change, choose };
}

it("opens one scoped profile tab from the explorer index and section links while preserving pending input", async () => {
  const t = raceFixture();
  const registrations = vi.spyOn(PendingProjectWork.prototype, "register");
  const read = vi.fn(({ projectId }: { projectId: string }) =>
    call({ ok: true, value: { projectId, profile: null } }),
  );
  const save = vi.fn(() => call(failure("storage_failed")));
  Object.assign(t.port, { readThesisProfile: read, saveThesisProfile: save });
  await mount(t);
  const { button, activate, press, choose } = profileHelpers();
  const workspace = container.querySelector(".workspace")!;
  const explorer = workspace.querySelector(".project-explorer")!;
  const title = message("en-US", "profile.title");
  // The explorer reads the saved profile to count each section's unanswered fields.
  expect(read).toHaveBeenLastCalledWith({
    projectId: t.ids[0],
    subscriptionId: "research-1",
    revisionId: null,
  });
  const entries = [
    ...explorer.querySelectorAll(".manuscript-outline-root, .project-explorer-control"),
  ];
  expect(entries[0]?.textContent).toBe(title);
  expect(entries[0]?.querySelector("svg")).not.toBeNull();
  const index = (section: string) =>
    [...explorer.querySelectorAll<HTMLButtonElement>(".profile-index-row")].find(
      (row) =>
        row.firstElementChild?.textContent ===
        message("en-US", `profile.section.${section}` as never),
    )!;
  expect(index("research").textContent).toContain("8 unanswered");
  expect(index("prior_work").textContent).toContain("6 unanswered");
  const disclosure = button(explorer, message("en-US", "profile.toggleSections"));
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  await activate(disclosure);
  expect(
    explorer.querySelector(`#${disclosure.getAttribute("aria-controls")}`)?.hasAttribute("hidden"),
  ).toBe(true);
  await activate(disclosure);

  await activate(button(explorer, title));
  const tab = button(workspace.querySelector('[role="tablist"]')!, title);
  expect(document.activeElement).toBe(tab);
  const article = workspace.querySelector(".thesis-profile")!;
  expect(article.querySelector("h2")?.textContent).toBe("Project 1");
  expect(article.textContent).toContain(message("en-US", "profile.unset"));
  expect(article.textContent).toContain(message("en-US", "profile.noSubtitle"));
  expect(article.textContent).toContain("0 known");
  expect(article.textContent).toContain("34 unanswered");

  const schedule = () => article.querySelector('[data-profile-section="schedule"]')!;
  await activate(button(article, "Edit Schedule"));
  const deadline = () => schedule().querySelector('[data-profile-field="deadline"]')!;
  expect(document.activeElement).toBe(deadline().querySelector("input:checked"));
  expect(button(article, "Edit Research").disabled).toBe(false);
  await choose(deadline(), "unknown");
  expect(button(article, "Edit Research").disabled).toBe(true);
  await activate(button(schedule(), "Save"));
  expect(save).toHaveBeenCalledTimes(1);
  expect(article.textContent).toContain(message("en-US", "profile.saveFailed"));
  expect(deadline().querySelector<HTMLInputElement>("input:checked")?.value).toBe("unknown");

  const navigator = button(workspace.querySelector('[role="tablist"]')!, "Navigator");
  await activate(tab);
  await press(tab, "Home");
  expect(document.activeElement).toBe(navigator);
  await press(navigator, "End");
  expect(document.activeElement).toBe(tab);
  await activate(navigator);
  await activate(button(workspace, "Open profile research"));
  expect(document.activeElement).toBe(
    article.querySelector('[data-profile-section="research"] h3'),
  );
  expect(index("research").getAttribute("aria-current")).toBe("location");
  await activate(index("schedule"));
  expect(document.activeElement).toBe(schedule().querySelector("h3"));
  expect(index("schedule").getAttribute("aria-current")).toBe("location");
  expect(index("research").getAttribute("aria-current")).toBeNull();
  expect(workspace.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1);
  expect(workspace.querySelectorAll(".thesis-profile")).toHaveLength(1);

  await selectRaceProject(1);
  expect(workspace.querySelector(".thesis-profile")).toBeNull();
  await selectRaceProject(0);
  const returned = workspace.querySelector(".thesis-profile")!;
  expect(
    returned.querySelector<HTMLInputElement>('[data-profile-field="deadline"] input:checked')
      ?.value,
  ).toBe("unknown");

  const [lease] = registrations.mock.calls.at(-1)!;
  const guard = registrations.mock.contexts.at(-1) as PendingProjectWork;
  const first = deferred<Awaited<ReturnType<PendingProjectWork["evaluate"]>>>();
  await act(async () => {
    void guard.evaluate(lease).then(first.resolve);
  });
  let dialog = document.querySelector("dialog[open]")!;
  expect(dialog.textContent).toContain(message("en-US", "profile.leavePrompt"));
  await activate(button(dialog, "Keep editing"));
  expect(await first.promise).toEqual({ status: "keep_open" });
  const second = deferred<Awaited<ReturnType<PendingProjectWork["evaluate"]>>>();
  await act(async () => {
    void guard.evaluate(lease).then(second.resolve);
  });
  dialog = document.querySelector("dialog[open]")!;
  await activate(button(dialog, "Save and continue"));
  expect(dialog.textContent).toContain(message("en-US", "profile.leaveFailed"));
  await activate(button(dialog, "Discard and continue"));
  expect(await second.promise).toMatchObject({ status: "safe_to_detach" });
  expect(returned.querySelector('[data-profile-field="deadline"] input')).toBeNull();
});

it("reads and edits attributed profile sections, milestones and amounts with localized controls", async () => {
  const t = raceFixture();
  const origin = { kind: "researcher_statement" } as const;
  const savedProfile = encodeProfileContent({
    schemaVersion: 2,
    fields: {
      deadline: { state: "known", value: "2027-02-02", origin },
      milestones: {
        state: "known",
        items: [
          {
            state: "known",
            value: { title: "Submit draft", date: "2027-02-02", done: false },
            origin,
          },
          {
            state: "known",
            value: { title: "Ethics form", date: "2026-01-15", done: false },
            origin,
          },
          { state: "known", value: { title: "Pilot interview", done: true }, origin },
        ],
      },
      weekly_availability_minutes: { state: "known", value: 45, origin },
      decisions: {
        state: "known",
        items: [
          {
            state: "known",
            value: "Existing decision",
            origin: {
              kind: "artifact_version",
              artifact: "conversation_message",
              id: t.ids[1]!,
              revision: 1,
            },
          },
        ],
      },
      topic: {
        state: "known",
        value: "Existing topic",
        origin: {
          kind: "adopted_proposal",
          producer: "virgilio",
          attemptId: t.ids[1]!,
          proposalId: t.ids[2]!,
        },
      },
      goals: { state: "known", items: [] },
      autonomy: { state: "inapplicable" },
    },
  });
  const profileRevision = (revision: number) => ({
    revision,
    revisionId: t.ids[revision % t.ids.length]!,
    previousRevisionId: revision > 1 ? t.ids[(revision - 1) % t.ids.length]! : null,
    changedFields: ["deadline", "milestones"] as const,
  });
  // Another window's revision 2 changes the same milestone that this window edits.
  const competingProfile = savedProfile.replace(
    '"title":"Submit draft"',
    '"title":"Competing draft"',
  );
  const readVersion = (projectId: string, revision: number) =>
    call<ProfileReadResult>({
      ok: true,
      value: {
        projectId,
        profile: {
          ...profileRevision(revision),
          content: revision >= 2 ? competingProfile : savedProfile,
        },
      },
    });
  const read = vi.fn(({ projectId }: { projectId: string }) => readVersion(projectId, 1));
  const save = vi.fn(() => call(failure("storage_failed")));
  const receipt = vi.fn(({ projectId, operationId }: { projectId: string; operationId: string }) =>
    call<ProfileReceiptResult>({
      ok: true,
      value: {
        projectId,
        operationId,
        receipt: {
          resultId: profileRevision(3).revisionId,
          profileChange: { projectId, revision: profileRevision(3) },
        },
      },
    }),
  );
  let receive: ((notice: Outcome<ResearchEvent>) => void) | undefined;
  read.mockReturnValueOnce(call(failure("storage_failed")));
  Object.assign(t.port, {
    subscribeResearch: (_scope: ResearchScope, listener: typeof receive) => {
      receive = listener;
      return {
        ready: Promise.resolve({ ok: true, value: { subscriptionId: "research-1" } }),
        dispose() {},
      };
    },
    readThesisProfile: read,
    saveThesisProfile: save,
    readThesisProfileReceipt: receipt,
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T12:00:00"));
  try {
    await mount(t);
    const { button, activate, change, choose } = profileHelpers();
    await activate(button(container.querySelector(".project-explorer")!, "Research profile"));
    const profile = container.querySelector(".thesis-profile")!;
    expect(profile.textContent).toContain(message("en-US", "profile.readFailed"));
    await activate(button(profile, message("en-US", "taskNotice.tryAgain")));
    expect(profile.textContent).toContain("Revision 1");
    const section = (id: string) => profile.querySelector(`[data-profile-section="${id}"]`)!;
    const field = (id: string) => profile.querySelector(`[data-profile-field="${id}"]`)!;
    expect(field("deadline").textContent).toContain("Feb 2, 2027");
    const milestones = [...field("milestones").querySelectorAll("li")];
    expect(milestones.map((row) => row.textContent)).toEqual([
      expect.not.stringMatching(/Date passed|Done/),
      expect.stringContaining("Date passed"),
      expect.stringContaining("Done"),
    ]);
    expect(milestones[2]?.dataset.done).toBe("true");
    expect(field("weekly_availability_minutes").textContent).toContain("45");
    expect(field("decisions").textContent).toContain("Conversation message");
    expect(field("topic").textContent).toContain("Adopted proposal");
    expect(field("goals").textContent).toContain("No items recorded");
    expect(field("autonomy").textContent).toContain("Does not apply");
    expect(field("tools").textContent).toContain("Unanswered");
    expect(section("requirements").textContent).toContain("Thesis language");
    expect(section("requirements").textContent).toContain("en-US");
    expect(section("prior_work").textContent).toContain("References you already have");
    expect(profile.textContent).toContain("6 known");

    await activate(button(profile, "Edit Prior work"));
    const bibliography = () => field("bibliography");
    expect(bibliography().textContent).toContain(message("en-US", "profile.help.bibliography"));
    await choose(bibliography(), "known");
    await activate(button(bibliography(), "Add item"));
    expect(document.activeElement).toBe(bibliography().querySelector("textarea"));
    await change(bibliography().querySelector("textarea")!, "Researcher-reported reference");
    await change(bibliography().querySelector('select[id$="-source"]')!, "described_material");
    await change(
      bibliography().querySelector("label textarea")!,
      "Draft bibliography from supervisor",
    );
    expect(field("decisions").querySelector('select[id$="-source"]')).toBeNull();
    await change(field("decisions").querySelector("textarea")!, "Written by the researcher");
    expect(
      field("decisions").querySelector<HTMLSelectElement>('select[id$="-source"]')?.value,
    ).toBe("researcher_statement");
    await activate(
      button(
        bibliography(),
        "Remove Bibliography · Item 1".replace("Bibliography", "References you already have"),
      ),
    );
    expect(bibliography().querySelector("textarea")).toBeNull();
    await activate(button(section("prior_work"), "Discard changes"));
    expect(document.activeElement).toBe(button(profile, "Edit Prior work"));
    expect(field("decisions").textContent).toContain("Existing decision");

    await activate(button(profile, "Edit Schedule"));
    const minutes = field("weekly_availability_minutes").querySelector<HTMLInputElement>(
      'input[type="text"]',
    )!;
    await change(minutes, "-1");
    await activate(button(section("schedule"), "Save"));
    expect(document.activeElement).toBe(minutes);
    expect(minutes.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(minutes.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toContain("Check the value and its origin");
    await change(minutes, "0");
    const dates = () =>
      field("milestones").querySelectorAll<HTMLInputElement>('input[type="date"]');
    await change(dates()[0]!, "2027-03-02");
    const done = field("milestones").querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(done.checked).toBe(false);
    await activate(done);
    expect(done.checked).toBe(true);

    read.mockReturnValueOnce(readVersion(t.ids[0]!, 2));
    await act(async () =>
      receive?.({
        ok: true,
        value: { kind: "changed", record: "profile", id: t.ids[0]!, revision: 2 },
      }),
    );
    expect(profile.textContent).toContain(message("en-US", "profile.conflict"));
    expect(profile.textContent).toContain("Revision 1");
    read.mockReturnValueOnce(readVersion(t.ids[0]!, 2));
    await activate(button(profile, message("en-US", "profile.compare")));
    expect(profile.textContent).toContain("Revision 2");
    expect(dates()[0]?.value).toBe("2027-03-02");
    const compare = field("milestones").querySelector(".profile-saved-compare");
    expect(compare?.textContent).toContain("Saved value");
    expect(compare?.textContent).toContain("Competing draft");
    expect(field("milestones").querySelector("textarea")?.value).toBe("Submit draft");
    save.mockReturnValueOnce(call(failure("uncertain")));
    await activate(button(section("schedule"), "Save"));
    expect(profile.textContent).toContain(message("en-US", "profile.uncertain"));
    read.mockReturnValueOnce(call(failure("storage_failed")));
    await activate(button(profile, message("en-US", "profile.checkSave")));
    expect(receipt).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(profile.textContent).toContain("Revision 3");
    expect(profile.textContent).toContain(message("en-US", "profile.refreshFailed"));
    expect(section("schedule").querySelector('input[type="date"]')).toBeNull();
    read.mockReturnValueOnce(readVersion(t.ids[0]!, 3));
    await activate(button(profile, message("en-US", "taskNotice.tryAgain")));
    expect(read).toHaveBeenLastCalledWith(
      expect.objectContaining({ revisionId: profileRevision(3).revisionId }),
    );
    expect(profile.textContent).toContain(message("en-US", "profile.saved"));
  } finally {
    vi.useRealTimers();
  }
});

it("opens the rename form from the profile header and shows a saved subtitle", async () => {
  const t = raceFixture();
  Object.assign(t.port, {
    readThesisProfile: ({ projectId }: { projectId: string }) =>
      call({ ok: true, value: { projectId, profile: null } }),
  });
  await mount(t);
  const { button, activate } = profileHelpers();
  await activate(button(container.querySelector(".project-explorer")!, "Research profile"));
  const profile = container.querySelector(".thesis-profile")!;
  const add = button(profile, message("en-US", "profile.addSubtitle"));
  await activate(add);
  let dialog = document.querySelector("dialog[open]")!;
  const [titleInput, subtitleInput] = dialog.querySelectorAll("input");
  expect(titleInput?.value).toBe("Project 1");
  expect(subtitleInput?.value).toBe("");
  expect(document.activeElement).toBe(subtitleInput);
  await activate(button(dialog, message("en-US", "dialog.close")));
  expect(document.activeElement).toBe(add);
  await activate(button(profile, message("en-US", "profile.changeTitle")));
  dialog = document.querySelector("dialog[open]")!;
  expect(document.activeElement).toBe(dialog.querySelector("input"));
});

it("keeps active profile input and a submitted save across conversation observation replacement", async () => {
  const t = raceFixture();
  const projectId = t.ids[0]!;
  const savedContent = encodeProfileContent({
    schemaVersion: 2,
    fields: {
      discipline: { state: "known", value: "Geography", origin: { kind: "researcher_statement" } },
    },
  });
  const revision = {
    revision: 1,
    revisionId: t.ids[1]!,
    previousRevisionId: null,
    changedFields: ["discipline"] as const,
  };
  const pending = deferred<Outcome<ProfileSaveResult>>();
  const cancel = vi.fn();
  const save = vi.fn(() => ({ result: pending.promise, cancel }));
  const receipt = vi.fn();
  let receive: ((event: Outcome<ResearchEvent>) => void) | undefined;
  let opening: ReturnType<typeof deferred<Outcome<{ subscriptionId: string }>>> | undefined;
  const subscribe = vi.fn((_scope: ResearchScope, listener: typeof receive) => {
    receive = listener;
    return {
      ready: opening
        ? opening.promise
        : Promise.resolve({ ok: true, value: { subscriptionId: "initial" } }),
      dispose() {},
    };
  });
  const read = vi.fn(
    ({ projectId, revisionId }: { projectId: string; revisionId: string | null }) =>
      call<ProfileReadResult>({
        ok: true,
        value: { projectId, profile: revisionId ? { ...revision, content: savedContent } : null },
      }),
  );
  Object.assign(t.port, {
    subscribeResearch: subscribe,
    readThesisProfile: read,
    saveThesisProfile: save,
    readThesisProfileReceipt: receipt,
  });
  await mount(t);
  const { button, activate, choose } = profileHelpers();
  const workspace = container.querySelector(".workspace")!;
  await activate(button(workspace.querySelector(".project-explorer")!, "Research profile"));
  await activate(button(workspace.querySelector('[role="tablist"]')!, "Navigator"));
  await activate(button(workspace, "Open profile research"));
  const profile = workspace.querySelector(".thesis-profile")!;
  await activate(button(profile, "Edit Research"));
  const field = profile.querySelector('[data-profile-field="discipline"]')!;
  await choose(field, "known");
  const editor = field.querySelector("textarea")!;
  opening = deferred();
  await act(async () => {
    editor.focus();
    receive?.(failure("sequence_gap"));
  });
  expect(document.activeElement).toBe(editor);
  expect(profile.querySelector<HTMLFieldSetElement>(".profile-editor-fields")?.disabled).toBe(
    false,
  );
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    set.call(editor, "Geography");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(editor.value).toBe("Geography");
  expect(profile.querySelector(".primitive-primary")?.getAttribute("aria-disabled")).toBe("true");
  await act(async () => opening?.resolve({ ok: true, value: { subscriptionId: "recovered" } }));
  await activate(button(profile, "Save"));
  expect(save).toHaveBeenCalledOnce();
  expect(save).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ subscriptionId: "recovered" }),
  );

  opening = deferred();
  await click('.workspace-chat [data-workspace-command="conversation.new"]');
  expect(subscribe).toHaveBeenLastCalledWith(
    { projectId, conversationId: null },
    expect.any(Function),
  );
  await act(async () =>
    opening?.resolve({ ok: true, value: { subscriptionId: "new-conversation" } }),
  );
  expect(cancel).not.toHaveBeenCalled();
  expect(editor.isConnected).toBe(true);
  expect(editor.value).toBe("Geography");
  await act(async () =>
    pending.resolve({
      ok: true,
      value: { resultId: revision.revisionId, profileChange: { projectId, revision } },
    }),
  );
  expect(cancel).not.toHaveBeenCalled();
  expect(receipt).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledOnce();
  expect(profile.textContent).toContain("Revision 1");
  expect(read).toHaveBeenLastCalledWith({
    projectId,
    subscriptionId: "new-conversation",
    revisionId: revision.revisionId,
  });
});
