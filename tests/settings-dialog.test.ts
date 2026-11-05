// @vitest-environment jsdom
import { act, createElement as h, useSyncExternalStore, useState, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  message,
  supportedLocales,
  failure,
  staleRevision,
  type FoundationPort,
  type InterfaceLocale,
  type Outcome,
  type SavedPresentationRecord,
  type InterfaceZoom,
} from "@ohtia/contracts";
import { SettingsDialog } from "../packages/renderer/src/settings-dialog.js";
import { LanguageController } from "../packages/renderer/src/language-controller.js";
import {
  WorkspaceController,
  type WorkspaceState,
} from "../packages/renderer/src/workspace-controller.js";
import { LayoutPreferences } from "../packages/renderer/src/layout-preferences.js";
import { harness, call, deferred } from "./fixtures/settings.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
const disposals: (() => void)[] = [];
const media = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => {
    let value = media.get(query);
    if (!value) {
      value = { matches: false, listeners: new Set() };
      media.set(query, value);
    }
    return {
      get matches() {
        return value!.matches;
      },
      addEventListener: (_: string, listener: () => void) => value!.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => value!.listeners.delete(listener),
    };
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  disposals.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  media.clear();
});
async function mount(locale: InterfaceLocale = "en-US") {
  const t = harness();
  const localeSnapshot = {
    serviceGeneration: "service-1",
    record: { schemaVersion: 1, revision: 0, source: "default", value: "system" },
    effectiveLocale: "en-US",
    systemLocale: "en-GB",
  };
  const port = {
    ...t.port,
    readLocale: () => call({ ok: true, value: localeSnapshot }),
    subscribeLocale: () => ({
      ready: Promise.resolve({ ok: true, value: { subscriptionId: "locale" } }),
      dispose: vi.fn(),
    }),
    readLayout: () =>
      call({ ok: true, value: { schemaVersion: 1, revision: 0, source: "default", value: null } }),
    replaceLayout: (change: { expectedRevision: number; value: unknown }) =>
      call({
        ok: true,
        value: {
          schemaVersion: 1,
          revision: change.expectedRevision + 1,
          value: change.value,
          source: "saved",
        },
      }),
  } as unknown as FoundationPort;
  const language = new LanguageController(
    port,
    () => {},
    () => "language-operation",
  );
  let notifyWorkspace: (state: WorkspaceState) => void = () => {};
  const workspace = new WorkspaceController(
    new LayoutPreferences(port, () => "layout-operation", vi.fn()),
    1280,
    false,
    (state) => {
      notifyWorkspace(state);
    },
  );
  disposals.push(() => {
    t.controller.dispose();
    language.dispose();
    workspace.dispose();
  });
  await t.controller.refresh();
  await language.refresh();
  await workspace.initialize();
  const onClose = vi.fn();
  function View({
    open,
    workspaceState,
    available,
  }: {
    open: boolean;
    workspaceState?: WorkspaceState;
    available: boolean;
  }) {
    const [liveState, setLiveState] = useState(workspace.state);
    useEffect(() => {
      notifyWorkspace = setLiveState;
      return () => {
        notifyWorkspace = () => {};
      };
    }, []);
    return h(SettingsDialog, {
      open,
      onClose,
      locale,
      port,
      available,
      language,
      controller: t.controller,
      workspace,
      workspaceState: workspaceState ?? liveState,
      platform: "linux",
    });
  }
  const render = async (open = true, workspaceState?: WorkspaceState, available = true) => {
    await act(async () => root.render(h(View, { open, workspaceState, available })));
  };
  await render();
  return { ...t, workspace, render, onClose, foundationPort: port };
}
async function click(selector: string) {
  await act(async () => container.querySelector<HTMLElement>(selector)!.click());
}
describe("compact Settings dialog", () => {
  it.each(supportedLocales)(
    "renders all controls and autonyms in %s without untranslated placeholders",
    async (locale) => {
      await mount(locale);
      expect(container.querySelector("dialog[open]")).not.toBeNull();
      expect(container.querySelectorAll("select option")).toHaveLength(26);
      expect(container.querySelector('option[value="ko-KR"]')?.getAttribute("lang")).toBe("ko-KR");
      expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(6);
      expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
      expect(container.textContent).toContain(message(locale, "settings.immediate"));
      expect(container.textContent).not.toContain("{setting}");
      expect(container.querySelector('button[type="submit"]')).toBeNull();
    },
  );
  it("applies immediate choices, character visibility and system appearance without moving focus", async () => {
    const t = await mount();
    await click('input[value="hidden"]');
    expect(t.port.replaceCharacter).toHaveBeenCalledOnce();
    expect(container.querySelector(".settings-character-preview img")).toBeNull();
    expect(container.querySelector(".settings-character-preview")?.textContent).toContain(
      "Symbol only",
    );
    const system = media.get("(prefers-color-scheme: dark)")!;
    await act(async () => {
      system.matches = true;
      system.listeners.forEach((listener) => listener());
    });
    expect(container.textContent).toContain("Now: dark");
    const motion = media.get("(prefers-reduced-motion: reduce)")!;
    await act(async () => {
      motion.matches = true;
      motion.listeners.forEach((listener) => listener());
    });
    await click('input[value="animated"]');
    expect(container.textContent).toContain(message("en-US", "settings.reducedMotion"));
    expect(container.querySelector(".settings-character-preview img")?.getAttribute("width")).toBe(
      "96",
    );
  });
  it("keeps zoom bounds focusable and explains pending, uncertain, rejected and conflict states", async () => {
    const t = await mount();
    await click(".settings-zoom-actions button:last-child");
    expect(container.textContent).toContain("Already at actual size");
    t.port.adjustZoom.mockReturnValueOnce(call(failure("uncertain")) as never);
    await click('.settings-zoom-actions button[aria-label="Increase zoom"]');
    expect(container.textContent).toContain(message("en-US", "settings.zoomPending"));
    const check = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Check",
    )!;
    await act(async () => check.click());
    expect(t.port.readZoomReceipt).toHaveBeenCalledWith("operation-1");
    t.port.replaceCharacter.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await click('input[value="static"]');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Characters could not be saved",
    );
    const retry = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Try again",
    )!;
    await act(async () => retry.click());
    expect(t.port.replaceCharacter).toHaveBeenCalledTimes(2);
    t.port.replaceAppearance.mockReturnValueOnce(call(staleRevision(0)) as never);
    await click('input[value="dark"]');
    expect(container.textContent).toContain("Another window saved Appearance");
    await act(async () => {
      t.notify({
        ok: true,
        value: {
          ...t.current,
          zoom: { schemaVersion: 1, source: "saved", revision: 2, value: 400 },
        },
      });
    });
    const increase = container.querySelector<HTMLButtonElement>(
      '.settings-zoom-actions button[aria-label="Increase zoom"]',
    )!;
    expect(increase.getAttribute("aria-disabled")).toBe("true");
    expect(increase.disabled).toBe(false);
  });
  it("uses the originating layout controller, protects its last panel and restores the trigger on close", async () => {
    const trigger = document.createElement("button");
    document.body.prepend(trigger);
    trigger.focus();
    const t = await mount();
    await click('input[type="checkbox"]');
    await t.render();
    expect(t.workspace.state.preference.visible.explorer).toBe(false);
    await act(async () => {
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[2]!.click();
    });
    await t.render();
    expect(container.textContent).toContain(message("en-US", "command.reason.last_panel"));
    await click('input[type="checkbox"]:checked');
    expect(container.querySelector(".settings-zoom")?.textContent).not.toContain(
      message("en-US", "command.reason.last_panel"),
    );
    await t.render(false);
    expect(document.activeElement).toBe(trigger);
    expect([...media.values()].every((value) => value.listeners.size === 0)).toBe(true);
  });
});

describe("layout save notices", () => {
  it("distinguishes failure, conflict and uncertainty without describing an unknown write as failed", async () => {
    const t = await mount();
    const remember = vi.spyOn(t.workspace, "rememberLayout").mockResolvedValue(true);
    const reconcile = vi.spyOn(t.workspace, "reconcilePreferences").mockResolvedValue(undefined);
    const original = t.workspace.state.preference;
    await t.render(true, {
      ...t.workspace.state,
      persistence: { save: { state: "rejected", error: failure("storage_failed").error } },
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      message("en-US", "settings.layoutNotRemembered"),
    );
    const retry = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Try again",
    )!;
    await act(async () => retry.click());
    expect(remember).toHaveBeenCalledOnce();
    await t.render(true, {
      ...t.workspace.state,
      persistence: { save: { state: "conflicting", error: staleRevision(2).error } },
    });
    expect(container.textContent).toContain(message("en-US", "settings.layoutConflict"));
    await t.render(true, {
      ...t.workspace.state,
      persistence: { save: { state: "uncertain", operationId: "layout-original" } },
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain(
      "It is not yet known whether Workspace layout was saved",
    );
    expect(reconcile).toHaveBeenCalledOnce();
    expect(t.workspace.state.preference).toEqual(original);
  });
});

describe("Settings command composition", () => {
  it("opens one modal through the registry and shares confirmed character and zoom state with consumers", async () => {
    const { SettingsSurfaces } = await import("../packages/renderer/src/settings-surfaces.js");
    const t = harness();
    let receive: (intent: unknown) => void = () => {};
    const published: import("@ohtia/contracts").CommandSnapshot[] = [];
    const localeSnapshot = {
      serviceGeneration: "service-1",
      record: { schemaVersion: 1, revision: 0, value: "system", source: "default" },
      effectiveLocale: "en-US",
      systemLocale: "en-US",
    };
    const port = {
      ...t.port,
      readLocale: () => call({ ok: true, value: localeSnapshot }),
      subscribeLocale: () => ({
        ready: Promise.resolve({ ok: true, value: { subscriptionId: "language" } }),
        dispose: vi.fn(),
      }),
      readLayout: () =>
        call({
          ok: true,
          value: { schemaVersion: 1, revision: 0, source: "default", value: null },
        }),
      replaceLayout: vi.fn(() => call(failure("storage_failed"))),
      claimLayoutFailureNotice: vi.fn(() => call({ ok: true, value: { announce: true } })),
      applyZoom: vi.fn(() =>
        call({
          ok: true,
          value: {
            revision: t.current.zoom.revision,
            percent: t.current.zoom.value,
            applied: true,
          },
        }),
      ),
    } as unknown as FoundationPort;
    const bridge = {
      context: async () => ({ windowGeneration: "window-1", platform: "linux" }),
      publish: async (snapshot: import("@ohtia/contracts").CommandSnapshot) => {
        published.push(snapshot);
        return true;
      },
      onIntent: (listener: typeof receive) => {
        receive = listener;
        return vi.fn();
      },
      about: vi.fn(),
      copyVersionInformation: vi.fn(),
      perform: vi.fn(),
      openLink: vi.fn(),
    } as unknown as import("@ohtia/contracts").CommandBridge;
    await act(async () =>
      root.render(
        h(SettingsSurfaces, { port, bridge, locale: "en-US", available: true, onLocale: vi.fn() }),
      ),
    );
    const intent = async (command: string, sequence: number) => {
      await act(async () =>
        receive({ windowGeneration: "window-1", source: "native", sequence, command }),
      );
    };
    vi.mocked(bridge.about).mockResolvedValue({
      product: "Ohtia",
      version: "synthetic",
      build: "synthetic",
      platform: "linux",
      architecture: "x86-64",
      copyright: "Synthetic",
      license: "MIT",
      notices: [],
    });
    for (const command of ["help.open", "about.open"]) {
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(`[data-command-id="${command}"] button`)!
          .click(),
      );
      expect(container.querySelector("dialog[open] .settings-feedback > button")).toBeNull();
      expect(
        container.querySelector("dialog[open] .settings-feedback")?.hasAttribute("hidden"),
      ).toBe(true);
      await click("dialog[open] [data-close]");
    }
    vi.mocked(bridge.about).mockClear();
    await intent("settings.open", 1);
    expect(container.querySelectorAll("dialog[open]")).toHaveLength(1);
    expect(container.querySelector("dialog[open]")?.textContent).toContain(
      "Accessibility and appearance",
    );
    await intent("zoom.increase", 2);
    expect(t.port.adjustZoom).toHaveBeenCalledWith(expect.any(String), "increase", "service-1");
    await intent("theme.dark", 3);
    expect(t.port.replaceAppearance).toHaveBeenCalledWith(
      expect.objectContaining({ value: "dark" }),
      "service-1",
    );
    expect(document.documentElement.dataset.appearance).toBeUndefined();
    await intent("about.open", 4);
    expect(bridge.about).not.toHaveBeenCalled();
    expect(published.at(-1)?.entries.find((entry) => entry.id === "theme.dark")?.checked).toBe(
      true,
    );
    await click("dialog[open] [data-close]");
    expect(container.querySelectorAll("dialog[open]")).toHaveLength(0);
    expect(document.activeElement).toBe(container.querySelector(".command-entry-actions button"));
    await act(async () => {
      t.notify({
        ok: true,
        value: {
          ...t.current,
          character: { schemaVersion: 1, revision: 1, source: "saved", value: "hidden" },
        },
      });
    });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    await act(async () =>
      t.notify({
        ok: true,
        value: {
          ...t.current,
          zoom: { schemaVersion: 1, revision: 2, source: "saved", value: 100 },
        },
      }),
    );
    await intent("zoom.reset", 5);
    expect(container.textContent).toContain(message("en-US", "command.reason.actual_size"));
    t.port.adjustZoom.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await intent("zoom.increase", 6);
    expect(container.querySelector("dialog[open]")).toBeNull();
    expect(container.querySelector(".settings-feedback")?.textContent).toContain(
      "could not be saved",
    );
    t.port.replaceAppearance.mockReturnValueOnce(call(failure("uncertain")) as never);
    await intent("theme.light", 7);
    expect(container.querySelector(".settings-feedback")?.textContent).toContain("not yet known");
    await act(async () =>
      t.notify({ ok: true, value: { ...t.current, serviceGeneration: "service-2" } }),
    );
    const check = [
      ...container.querySelectorAll<HTMLButtonElement>(".settings-feedback button"),
    ].find((button) => button.textContent === "Check")!;
    await act(async () => check.click());
    expect(
      published.at(-1)?.entries.find((entry) => entry.id === "theme.light")?.reason,
    ).toBeUndefined();
    await intent("theme.light", 8);
    expect(t.port.replaceAppearance).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: "light" }),
      "service-2",
    );
    t.port.adjustZoom.mockReturnValueOnce(call(failure("uncertain")) as never);
    await intent("zoom.increase", 9);
    await act(async () =>
      t.notify({ ok: true, value: { ...t.current, serviceGeneration: "service-3" } }),
    );
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>(".settings-feedback button")]
        .find((button) => button.textContent === "Check")!
        .click(),
    );
    expect(
      published.at(-1)?.entries.find((entry) => entry.id === "zoom.increase")?.reason,
    ).toBeUndefined();
    await intent("zoom.increase", 10);
    expect(t.port.adjustZoom).toHaveBeenLastCalledWith(expect.any(String), "increase", "service-3");
    await intent("settings.open", 11);
    // Native factor/readback can reach 100 before the originating receipt settles.
    const completion = deferred<Outcome<SavedPresentationRecord<InterfaceZoom>>>();
    t.port.adjustZoom.mockReturnValueOnce({ result: completion.promise, cancel: vi.fn() } as never);
    await intent("zoom.decrease", 12);
    await act(async () =>
      t.notify({
        ok: true,
        value: {
          ...t.current,
          zoom: { schemaVersion: 1, revision: 5, source: "saved", value: 100 },
        },
      }),
    );
    expect(container.querySelector(".settings-zoom output")?.textContent).toBe("100%");
    expect(published.at(-1)?.entries.find((entry) => entry.id === "zoom.reset")?.reason).toBe(
      "busy",
    );
    expect(published.at(-1)?.entries.find((entry) => entry.id === "zoom.increase")?.reason).toBe(
      "busy",
    );
    await intent("zoom.reset", 13);
    expect(container.querySelector("dialog[open]")?.textContent).not.toContain(
      message("en-US", "command.reason.actual_size"),
    );
    await act(async () =>
      completion.resolve({
        ok: true,
        value: t.current.zoom as SavedPresentationRecord<InterfaceZoom>,
      }),
    );
    expect(published.at(-1)?.entries.find((entry) => entry.id === "zoom.reset")?.reason).toBe(
      "actual_size",
    );
    expect(
      published.at(-1)?.entries.find((entry) => entry.id === "zoom.increase")?.reason,
    ).toBeUndefined();
    await intent("zoom.reset", 15);
    expect(container.querySelector("dialog[open]")?.textContent).toContain(
      message("en-US", "command.reason.actual_size"),
    );
    await click("dialog[open] [data-close]");
    await intent("help.open", 16);
    expect(container.querySelector("dialog[open] .settings-feedback > button")).toBeNull();
    expect(container.querySelector("dialog[open] .settings-feedback")?.hasAttribute("hidden")).toBe(
      true,
    );
    t.port.replaceAppearance.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await intent("theme.dark", 17);
    expect(container.querySelector("dialog[open]")?.textContent).toContain(
      "Appearance could not be saved",
    );
    const helpAnchor = container.querySelector<HTMLButtonElement>(
      "dialog[open] .settings-feedback > button",
    )!;
    const retryInHelp = [
      ...container.querySelectorAll<HTMLButtonElement>("dialog[open] button"),
    ].find((button) => button.textContent === "Try again")!;
    await act(async () => {
      retryInHelp.focus();
      retryInHelp.click();
    });
    expect(document.activeElement).toBe(helpAnchor);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("dialog[open] [data-close]")!.focus(),
    );
    expect(container.querySelector("dialog[open] .settings-feedback > button")).toBeNull();
    expect(container.querySelector("dialog[open] .settings-feedback")?.hasAttribute("hidden")).toBe(
      true,
    );
    t.port.adjustZoom.mockReturnValueOnce(call(staleRevision(5)) as never);
    await intent("zoom.increase", 18);
    const chooseInHelp = [
      ...container.querySelectorAll<HTMLButtonElement>("dialog[open] button"),
    ].find((button) => button.textContent === "Choose again")!;
    await act(async () => chooseInHelp.click());
    expect(container.querySelectorAll("dialog[open]")).toHaveLength(1);
    expect(container.querySelector("dialog[open]")?.classList.contains("settings-dialog")).toBe(
      true,
    );
    expect(document.activeElement?.closest(".settings-zoom")).not.toBeNull();
    await click("dialog[open] [data-close]");
    t.port.readPresentation.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await intent("theme.light", 19);
    expect(container.querySelector(".settings-feedback")?.textContent).toContain(
      message("en-US", "settings.readFailed"),
    );
    const writes = t.port.replaceAppearance.mock.calls.length;
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>(".settings-feedback button")]
        .find((button) => button.textContent === message("en-US", "refresh"))!
        .click(),
    );
    expect(t.port.replaceAppearance).toHaveBeenCalledTimes(writes);
    expect(document.activeElement).toBe(container.querySelector(".command-entry-actions button"));
    vi.mocked(port.applyZoom).mockReturnValueOnce(
      call({ ok: true, value: { revision: 6, percent: 110, applied: false } }),
    );
    await intent("zoom.increase", 20);
    expect(container.querySelector(".settings-feedback")?.textContent).toContain(
      "was saved, but could not be applied",
    );
    const zoomWrites = t.port.adjustZoom.mock.calls.length;
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>(".settings-feedback button")]
        .find((button) => button.textContent === "Apply again")!
        .click(),
    );
    expect(t.port.adjustZoom).toHaveBeenCalledTimes(zoomWrites);
    expect(document.activeElement).toBe(container.querySelector(".command-entry-actions button"));
    expect(container.querySelector(".settings-feedback")?.textContent).not.toContain(
      "was saved, but could not be applied",
    );
    t.port.adjustZoom.mockReturnValueOnce(call(failure("busy")) as never);
    await intent("zoom.increase", 21);
    expect(container.querySelector(".settings-feedback")?.textContent).toContain(
      message("en-US", "settings.zoomUnavailable"),
    );
    const busyWrites = t.port.adjustZoom.mock.calls.length;
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>(".settings-feedback button")]
        .find((button) => button.textContent === "Check")!
        .click(),
    );
    expect(t.port.adjustZoom).toHaveBeenCalledTimes(busyWrites);
    expect(document.activeElement).toBe(container.querySelector(".command-entry-actions button"));
    t.port.adjustZoom.mockReturnValueOnce(call(staleRevision(t.current.zoom.revision)) as never);
    await intent("zoom.increase", 22);
    const windowChoose = [
      ...container.querySelectorAll<HTMLButtonElement>(".command-window-feedback button"),
    ].find((button) => button.textContent === "Choose again")!;
    await act(async () => {
      windowChoose.focus();
      windowChoose.click();
    });
    expect(document.activeElement?.closest(".settings-zoom")).not.toBeNull();
    expect(windowChoose.isConnected).toBe(true);
    await click("dialog[open] [data-close]");
    expect(document.activeElement).toBe(windowChoose);
    await act(async () =>
      t.notify({
        ok: true,
        value: {
          ...t.current,
          zoom: { schemaVersion: 1, revision: 7, source: "saved", value: 125 },
        },
      }),
    );
    expect(document.activeElement).toBe(container.querySelector(".command-entry-actions button"));
    await act(async () =>
      t.notify({
        ok: true,
        value: {
          ...t.current,
          zoom: { schemaVersion: 1, revision: 8, source: "saved", value: 100 },
        },
      }),
    );
    await intent("zoom.reset", 23);
    expect(container.querySelector(".command-unavailable")?.textContent).toContain(
      message("en-US", "command.reason.actual_size"),
    );
    await act(async () =>
      t.notify({
        ok: true,
        value: {
          ...t.current,
          zoom: { schemaVersion: 1, revision: 9, source: "saved", value: 125 },
        },
      }),
    );
    expect(container.querySelector(".command-unavailable")).toBeNull();
    await act(async () =>
      t.notify({
        ok: true,
        value: {
          ...t.current,
          zoom: { schemaVersion: 1, revision: 10, source: "saved", value: 100 },
        },
      }),
    );
    expect(container.querySelector(".command-unavailable")).toBeNull();
    await intent("settings.open", 24);
    await intent("zoom.reset", 25);
    expect(container.querySelector("dialog[open] .command-unavailable")).not.toBeNull();
    await click('dialog[open] .settings-zoom-actions button[aria-label="Increase zoom"]');
    expect(container.querySelector(".command-unavailable")).toBeNull();
    expect(container.querySelector("dialog[open] output")?.textContent).toBe("110%");
    await click("dialog[open] [data-close]");
    t.port.adjustZoom.mockReturnValueOnce(call(staleRevision(t.current.zoom.revision)) as never);
    await intent("zoom.increase", 26);
    const resolvedTrigger = [
      ...container.querySelectorAll<HTMLButtonElement>(".command-window-feedback button"),
    ].find((button) => button.textContent === "Choose again")!;
    await act(async () => {
      resolvedTrigger.focus();
      resolvedTrigger.click();
    });
    await click('dialog[open] .settings-zoom-actions button[aria-label="Increase zoom"]');
    expect(resolvedTrigger.isConnected).toBe(false);
    await click("dialog[open] [data-close]");
    expect(document.activeElement).toBe(container.querySelector(".command-entry-actions button"));
    await intent("settings.open", 27);
    await click('dialog[open] input[type="checkbox"]');
    expect(container.querySelector(".layout-memory-feedback")?.textContent).toContain(
      message("en-US", "settings.layoutNotRemembered"),
    );
    await click("dialog[open] [data-close]");
    const dismissLayout = container.querySelector<HTMLButtonElement>(
      ".layout-memory-feedback button",
    )!;
    await act(async () => {
      dismissLayout.focus();
      dismissLayout.click();
    });
    expect(dismissLayout.isConnected).toBe(false);
    expect(document.activeElement).toBe(container.querySelector(".command-entry-actions button"));
    expect(container.querySelector(".layout-memory-feedback p")).toBeNull();
    disposals.push(() => t.controller.dispose());
  }, 60000);
});

it("explains zoom endpoints and retries a failed display without another preference write", async () => {
  const t = await mount();
  await act(async () => {
    t.notify({
      ok: true,
      value: { ...t.current, zoom: { schemaVersion: 1, revision: 1, value: 75, source: "saved" } },
    });
  });
  await click('.settings-zoom-actions button[aria-label="Decrease zoom"]');
  expect(container.textContent).toContain("Already at minimum (75%)");
  await act(async () => {
    t.notify({
      ok: true,
      value: { ...t.current, zoom: { schemaVersion: 1, revision: 2, value: 400, source: "saved" } },
    });
  });
  await click('.settings-zoom-actions button[aria-label="Increase zoom"]');
  expect(container.textContent).toContain("Already at maximum (400%)");
  t.apply.mockRejectedValueOnce(new Error("display failed"));
  await click('input[value="dark"]');
  expect(container.textContent).toContain(
    "Appearance was saved, but could not be applied in this window",
  );
  const apply = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Apply again",
  )!;
  await act(async () => apply.click());
  expect(t.port.replaceAppearance).toHaveBeenCalledTimes(1);
  t.port.readPresentation.mockReturnValueOnce(call(failure("storage_failed")) as never);
  await act(async () => t.controller.refresh());
  expect(container.textContent).toContain(message("en-US", "settings.readFailed"));
  await act(async () => t.controller.refresh());
  expect(container.textContent).not.toContain(message("en-US", "settings.readFailed"));
});

it("does not call a fallback a saved preference when its first display application fails", async () => {
  const t = await mount();
  t.apply.mockRejectedValueOnce(new Error("display unavailable"));
  await act(async () => t.controller.applyAgain("zoom"));
  expect(container.textContent).toContain("Interface zoom could not be applied in this window");
  expect(container.textContent).not.toContain("Interface zoom was saved");
  expect(t.port.replaceZoom).not.toHaveBeenCalled();
});

it("uses the vector character when its rendered pixel density exceeds the licensed PNG and disposes view listeners on close", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 6 });
  try {
    const t = await mount();
    expect(container.querySelector(".settings-character-preview img")?.getAttribute("src")).toBe(
      "/branding/illustration.svg",
    );
    await t.render(false);
    expect(container.querySelector(".settings-character-preview img")).toBeNull();
    expect([...media.values()].every((value) => value.listeners.size === 0)).toBe(true);
  } finally {
    if (descriptor) Object.defineProperty(window, "devicePixelRatio", descriptor);
  }
});

it("clears a zoom endpoint reason after authoritative changes and a new dialog lifetime", async () => {
  const t = await mount();
  await click(".settings-zoom-actions button:last-child");
  expect(container.querySelector(".settings-zoom")?.textContent).toContain(
    "Already at actual size",
  );
  await act(async () =>
    t.notify({
      ok: true,
      value: { ...t.current, zoom: { schemaVersion: 1, source: "saved", revision: 1, value: 75 } },
    }),
  );
  expect(container.querySelector(".settings-zoom")?.textContent).not.toContain(
    "Already at actual size",
  );
  await click('.settings-zoom-actions button[aria-label="Decrease zoom"]');
  expect(container.querySelector(".settings-zoom")?.textContent).toContain("Already at minimum");
  await t.render(false);
  await t.render();
  expect(container.querySelector(".settings-zoom")?.textContent).not.toContain(
    "Already at minimum",
  );
});

it("keeps accessible group names stable and returns conflict focus to the originating setting", async () => {
  const t = await mount();
  await click('input[value="dark"]');
  const group = container.querySelector<HTMLElement>('[role="radiogroup"]')!;
  expect(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent).toBe(
    "Appearance",
  );
  for (const value of ["system", "static"]) {
    const control = container.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
    expect(
      document.getElementById(control.getAttribute("aria-describedby")!)?.textContent,
    ).not.toBe("");
  }
  t.port.replaceCharacter.mockReturnValueOnce(call(staleRevision(0)) as never);
  await click('input[value="hidden"]');
  const choose = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Choose again",
  )!;
  await act(async () => choose.click());
  expect((document.activeElement as HTMLInputElement).name).toContain("character");
});
it("does not describe unavailable service controls as a pending zoom mutation", async () => {
  const t = await mount();
  await t.render(true, undefined, false);
  expect(t.controller.snapshot().settings.zoom.phase).toBe("idle");
  expect(container.textContent).toContain(message("en-US", "settings.unavailable"));
  expect(container.querySelector(".settings-zoom")?.textContent).not.toContain(
    message("en-US", "settings.zoomPending"),
  );
});

it("keeps recovery focus in its setting when actions or a passive update remove the notice", async () => {
  const t = await mount();
  const activate = async (label: string) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("dialog[open] button")].find(
      (node) => node.textContent === label,
    )!;
    await act(async () => {
      button.focus();
      button.click();
    });
    expect((document.activeElement as HTMLInputElement).name).toContain("character");
  };
  t.port.replaceCharacter.mockReturnValueOnce(call(failure("storage_failed")) as never);
  await click('input[value="hidden"]');
  await activate("Try again");
  t.apply.mockRejectedValueOnce(new Error("Character application failed"));
  await click('input[value="static"]');
  await activate("Apply again");
  t.port.replaceCharacter.mockReturnValueOnce(call(failure("uncertain")) as never);
  await click('input[value="animated"]');
  t.port.readCharacterReceipt.mockReturnValueOnce(
    call({
      ok: true,
      value: {
        state: "recorded",
        outcome: {
          ok: true,
          value: {
            schemaVersion: 1,
            source: "saved",
            revision: t.current.character.revision + 1,
            value: "animated",
          },
        },
      },
    }) as never,
  );
  await activate("Check");
  await act(async () =>
    t.notify({
      ok: true,
      value: {
        ...t.current,
        character: { schemaVersion: 1, revision: 3, source: "saved", value: "animated" },
      },
    }),
  );
  t.port.replaceCharacter.mockReturnValueOnce(call(staleRevision(4)) as never);
  t.port.readPresentation.mockReturnValueOnce(
    call({
      ok: true,
      value: {
        ...t.current,
        character: { schemaVersion: 1, revision: 4, source: "saved", value: "static" },
      },
    }) as never,
  );
  await click('input[value="hidden"]');
  const choose = [...container.querySelectorAll<HTMLButtonElement>("dialog[open] button")].find(
    (node) => node.textContent === "Choose again",
  )!;
  await act(async () => choose.focus());
  await act(async () =>
    t.notify({
      ok: true,
      value: {
        ...t.current,
        character: { schemaVersion: 1, revision: 10, source: "saved", value: "hidden" },
      },
    }),
  );
  expect((document.activeElement as HTMLInputElement).name).toContain("character");
  expect((document.activeElement as HTMLInputElement).value).toBe("hidden");
});

it("returns window recovery focus to its persistent Settings entry", async () => {
  const { SettingsFeedback } = await import("../packages/renderer/src/settings-notices.js");
  const entry = document.createElement("div");
  entry.className = "command-entry-actions";
  const trigger = document.createElement("button");
  trigger.textContent = "Settings";
  entry.append(trigger);
  document.body.prepend(entry);
  const t = harness();
  disposals.push(() => t.controller.dispose());
  await t.controller.refresh();
  t.port.replaceCharacter.mockReturnValueOnce(call(failure("storage_failed")) as never);
  await t.controller.choose("character", "hidden");
  function Feedback() {
    const state = useSyncExternalStore(t.controller.subscribe, t.controller.snapshot);
    return h(SettingsFeedback, {
      state,
      controller: t.controller,
      locale: "en-US",
      inDialog: false,
      onChooseAgain: vi.fn(),
      onOpenSettings: vi.fn(),
    });
  }
  await act(async () => root.render(h(Feedback)));
  const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Try again",
  )!;
  await act(async () => {
    retry.focus();
    retry.click();
  });
  expect(document.activeElement).toBe(trigger);
  expect(t.controller.snapshot().settings.character.phase).toBe("confirmed");
  entry.remove();
});

it.each(["rejected", "uncertain"] as const)(
  "retains layout group focus through real %s recovery",
  async (phase) => {
    const t = await mount();
    const replace = vi.spyOn(t.foundationPort, "replaceLayout");
    replace.mockReturnValueOnce(
      call(failure(phase === "rejected" ? "storage_failed" : "uncertain")),
    );
    await act(async () => {
      await t.workspace.rememberLayout();
    });
    expect(t.workspace.state.persistence.save.state).toBe(phase);
    if (phase === "uncertain") {
      const change = replace.mock.calls[0]![0];
      t.foundationPort.readLayoutReceipt = vi.fn(() =>
        call({
          ok: true,
          value: {
            state: "recorded",
            outcome: {
              ok: true,
              value: {
                schemaVersion: 1,
                revision: 1,
                source: "saved",
                value: change.value,
              },
            },
          },
        }),
      );
    }
    const recovery = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === (phase === "rejected" ? "Try again" : "Check"),
    )!;
    await act(async () => {
      recovery.focus();
      recovery.click();
    });
    expect(t.workspace.state.persistence.save.state).toBe("confirmed");
    expect(recovery.isConnected).toBe(false);
    expect(document.activeElement?.closest('section[id$="-layout-controls"]')).not.toBeNull();
    expect(document.activeElement?.tagName).toBe("INPUT");
    expect(replace).toHaveBeenCalledTimes(phase === "rejected" ? 2 : 1);
  },
);

it("preserves a recovery target when a null-target blur retains the same active element", async () => {
  const t = await mount();
  t.port.replaceCharacter.mockReturnValueOnce(call(staleRevision(1)) as never);
  await click('input[value="static"]');
  const choose = [...container.querySelectorAll<HTMLButtonElement>("dialog[open] button")].find(
    (button) => button.textContent === "Choose again",
  )!;
  await act(async () => {
    choose.focus();
    choose.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
  });
  expect(document.activeElement).toBe(choose);
  await act(async () =>
    t.notify({
      ok: true,
      value: {
        ...t.current,
        character: {
          schemaVersion: 1,
          revision: 2,
          value: "hidden",
          source: "saved",
        },
      },
    }),
  );
  expect(document.activeElement).toBe(container.querySelector('input[value="hidden"]'));
});

it("retains modal recovery ownership through deactivation-shaped blur and releases it on real departure", async () => {
  const { SettingsFeedback } = await import("../packages/renderer/src/settings-notices.js");
  const t = harness();
  disposals.push(() => t.controller.dispose());
  await t.controller.refresh();
  t.port.replaceCharacter.mockReturnValueOnce(call(staleRevision(1)) as never);
  await t.controller.choose("character", "static");
  function Feedback() {
    const state = useSyncExternalStore(t.controller.subscribe, t.controller.snapshot);
    return h(
      "dialog",
      { open: true },
      h(SettingsFeedback, {
        state,
        controller: t.controller,
        locale: "en-US",
        inDialog: true,
        onChooseAgain: vi.fn(),
        onOpenSettings: vi.fn(),
      }),
      h("button", { id: "leave-feedback" }, "Close"),
    );
  }
  await act(async () => root.render(h(Feedback)));
  const choose = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Choose again",
  )!;
  const anchor = container.querySelector<HTMLButtonElement>(".settings-feedback > button")!;
  await act(async () => {
    choose.focus();
    choose.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
  });
  await act(async () =>
    t.notify({
      ok: true,
      value: {
        ...t.current,
        character: { schemaVersion: 1, revision: 2, value: "hidden", source: "saved" },
      },
    }),
  );
  expect(document.activeElement).toBe(anchor);
  expect(anchor.isConnected).toBe(true);
  await act(async () => container.querySelector<HTMLButtonElement>("#leave-feedback")!.focus());
  expect(container.querySelector(".settings-feedback > button")).toBeNull();
});
