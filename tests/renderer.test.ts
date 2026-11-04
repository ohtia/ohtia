// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearancePanel } from "../packages/renderer/src/appearance-panel.js";
import {
  message,
  type FoundationPort,
  type BootstrapSnapshot,
} from "../packages/contracts/src/index.js";

const mounted = vi.hoisted(() => [] as Root[]);
vi.mock("react-dom/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...original,
    createRoot: (...args: Parameters<typeof createRoot>) => {
      const root = original.createRoot(...args);
      mounted.push(root);
      return root;
    },
  };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function call<T>(value: T) {
  return { result: Promise.resolve(value), cancel: vi.fn() };
}
function record(value = "system", revision = 0) {
  return { schemaVersion: 1, value, revision, source: "saved" };
}
function port() {
  return {
    readAppearance: vi.fn(() => call({ ok: true, value: record() })),
    replaceAppearance: vi.fn(() => call({ ok: true, value: record("dark", 1) })),
    readAppearanceReceipt: vi.fn(() => call({ ok: true, value: { state: "absent" } })),
  };
}
async function mount(component: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(component);
  });
  return container;
}
async function click(container: HTMLElement, key: Parameters<typeof message>[1]) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === message("en-US", key),
  );
  expect(button, key).toBeDefined();
  await act(async () => {
    button!.click();
  });
}
async function choose(container: HTMLElement, value: string) {
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(async () => {
  await act(async () => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  delete document.documentElement.dataset.appearance;
});

describe("appearance user decisions", () => {
  it("keeps a dirty choice across polling and saves once with the displayed revision", async () => {
    const service = port();
    const element = await mount(
      createElement(AppearancePanel, {
        port: service as unknown as FoundationPort,
        locale: "en-US",
        available: true,
      }),
    );
    expect(element.querySelector("select")?.value).toBe("system");
    await choose(element, "dark");
    service.readAppearance.mockImplementation(() => call({ ok: true, value: record("light", 2) }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(element.querySelector("select")?.value).toBe("dark");
    await click(element, "save");
    expect(service.replaceAppearance).toHaveBeenCalledOnce();
    expect(service.replaceAppearance.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: 0,
      value: "dark",
    });
    expect(element.textContent).toContain(message("en-US", "saved"));
    expect(document.documentElement.dataset.appearance).toBeUndefined();
    await click(element, "save");
    expect(service.replaceAppearance).toHaveBeenCalledOnce();
  });
  it.each(["stale_revision", "storage_failed"])(
    "retains input and focuses the error after %s",
    async (code) => {
      const service = port();
      service.replaceAppearance.mockImplementation(
        () => call({ ok: false, error: { code } }) as never,
      );
      const element = await mount(
        createElement(AppearancePanel, {
          port: service as unknown as FoundationPort,
          locale: "en-US",
          available: true,
        }),
      );
      await choose(element, "dark");
      await click(element, "save");
      expect(element.querySelector("select")?.value).toBe("dark");
      expect(document.activeElement).toBe(element.querySelector('[role="alert"]'));
      expect(element.textContent).toContain(
        message("en-US", code === "stale_revision" ? "refresh_preference" : "save_failed"),
      );
      await click(element, "refresh");
      expect(element.querySelector("select")?.value).toBe("dark");
    },
  );
  it.each(["pending", "absent", "recorded-success", "recorded-failure", "receipt-failure"])(
    "reconciles an uncertain save through %s without replay",
    async (state) => {
      const service = port();
      service.replaceAppearance.mockImplementation(
        () => call({ ok: false, error: { code: "uncertain" } }) as never,
      );
      service.readAppearanceReceipt.mockImplementation(
        () =>
          call(
            state === "receipt-failure"
              ? { ok: false, error: { code: "service_unavailable" } }
              : {
                  ok: true,
                  value: state.startsWith("recorded")
                    ? {
                        state: "recorded",
                        outcome:
                          state === "recorded-success"
                            ? { ok: true, value: record("dark", 1) }
                            : { ok: false, error: { code: "stale_revision" } },
                      }
                    : { state },
                },
          ) as never,
      );
      const element = await mount(
        createElement(AppearancePanel, {
          port: service as unknown as FoundationPort,
          locale: "en-US",
          available: true,
        }),
      );
      await choose(element, "dark");
      await click(element, "save");
      expect(element.querySelector("select")?.disabled).toBe(true);
      const operation = service.replaceAppearance.mock.calls[0]?.[0];
      await click(element, "save");
      expect(service.replaceAppearance).toHaveBeenCalledOnce();
      await click(element, "check_save");
      expect(service.readAppearanceReceipt).toHaveBeenCalledWith(operation.operationId);
      expect(service.replaceAppearance).toHaveBeenCalledOnce();
      expect(element.querySelector("select")?.disabled).toBe(
        state === "pending" || state === "receipt-failure",
      );
      expect(element.querySelector("select")?.value).toBe("dark");
    },
  );
  it("blocks mutation while unavailable and reports a failed revision refresh", async () => {
    const service = port();
    const element = await mount(
      createElement(AppearancePanel, {
        port: service as unknown as FoundationPort,
        locale: "en-US",
        available: false,
      }),
    );
    await choose(element, "light");
    await click(element, "save");
    await click(element, "refresh");
    expect(service.replaceAppearance).not.toHaveBeenCalled();
    expect(service.readAppearance).toHaveBeenCalledOnce();
    await act(async () => {
      mounted[0].render(
        createElement(AppearancePanel, {
          port: service as unknown as FoundationPort,
          locale: "en-US",
          available: true,
        }),
      );
    });
    service.readAppearance.mockImplementation(
      () => call({ ok: false, error: { code: "service_unavailable" } }) as never,
    );
    await click(element, "refresh");
    expect(element.textContent).toContain(message("en-US", "save_failed"));
  });
  it("retains a dirty choice through recovery without overriding the broker's CSS theme", async () => {
    const service = port();
    const props = { port: service as unknown as FoundationPort, locale: "en-US" as const };
    const element = await mount(createElement(AppearancePanel, { ...props, available: true }));
    await choose(element, "dark");
    await act(async () => {
      mounted[0].render(createElement(AppearancePanel, { ...props, available: false }));
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(element.querySelector("select")?.value).toBe("dark");
    expect(document.documentElement.dataset.appearance).toBeUndefined();
    expect(element.textContent).toContain(message("en-US", "status_unavailable"));
    expect(service.replaceAppearance).not.toHaveBeenCalled();
    await act(async () => {
      mounted[0].render(createElement(AppearancePanel, { ...props, available: true }));
    });
    await click(element, "save");
    expect(service.replaceAppearance).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.appearance).toBeUndefined();
  });
  it("ignores a completion after unmount and cancels its outstanding read", async () => {
    let resolve: (value: unknown) => void = () => {};
    const cancel = vi.fn();
    const service = port();
    service.readAppearance.mockImplementation(
      () =>
        ({
          result: new Promise((done) => {
            resolve = done;
          }),
          cancel,
        }) as never,
    );
    await mount(
      createElement(AppearancePanel, {
        port: service as unknown as FoundationPort,
        locale: "en-US",
        available: true,
      }),
    );
    const root = mounted.pop()!;
    await act(async () => {
      root.unmount();
      resolve({ ok: true, value: record("dark") });
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.appearance).toBeUndefined();
  });
});

it("runs the status-window recovery actions with preserved focus and a shared locale", async () => {
  let snapshot: BootstrapSnapshot = { version: 1, locale: "en-US", state: "pending_create" };
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const foundation = {
    ...port(),
    readPresentation: () =>
      call({
        ok: true,
        value: {
          serviceGeneration: "service-1",
          appearance: { schemaVersion: 1, revision: 0, source: "default", value: "system" },
          character: { schemaVersion: 1, revision: 0, source: "default", value: "animated" },
          zoom: { schemaVersion: 1, revision: 0, source: "default", value: 100 },
        },
      }),
    subscribePresentation: () => ({
      ready: Promise.resolve({ ok: true, value: { subscriptionId: "presentation-test" } }),
      dispose() {},
    }),
    readLayout: () =>
      call({ ok: true, value: { schemaVersion: 1, revision: 0, value: null, source: "default" } }),
    applyZoom: () => call({ ok: true, value: { revision: 0, percent: 100, applied: true } }),
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
    subscribeLocale: () => ({
      ready: Promise.resolve({ ok: true, value: { subscriptionId: "locale-test" } }),
      dispose() {},
    }),
    readStatus: vi.fn(() => call({ ok: true, value: { service: "ready" } })),
  };
  const bootstrap = {
    read: vi.fn(async () => snapshot),
    openStorage: vi.fn(async () => {
      snapshot = { ...snapshot, state: "storage_ready", locale: "ko-KR" };
      return snapshot;
    }),
    retryService: vi.fn(async () => snapshot),
    newWindow: vi.fn(async () => snapshot),
    exit: vi.fn(async () => snapshot),
    restoreCheckpoint: vi.fn(async () => {
      snapshot = { ...snapshot, state: "retry_required" };
      return snapshot;
    }),
  };
  const commands = {
    context: vi.fn(async () => ({ windowGeneration: "renderer-window", platform: "linux" })),
    publish: vi.fn(async () => true),
    onIntent: vi.fn(
      (_listener: (intent: import("@ohtia/contracts").CommandIntent) => void) => () => {},
    ),
    windowAction: vi.fn(async () => ({ status: "unavailable", reason: "window_limit" })),
    perform: vi.fn(async () => true),
    copyVersionInformation: vi.fn(async () => true),
    about: vi.fn(),
    openLink: vi.fn(async () => false),
  };
  Object.defineProperty(window, "ohtia", {
    value: { foundation, bootstrap, commands },
    configurable: true,
  });
  const container = document.createElement("div");
  container.id = "root";
  document.body.append(container);
  await act(async () => {
    await import("../packages/renderer/src/desktop.js");
  });
  expect(container.querySelector(".foundation-titlebar h1")?.textContent).toContain("Ohtia");
  expect(container.querySelector("main h1")).toBeNull();
  expect(
    container.querySelector('.foundation-titlebar [data-workspace-command="menu.open"]'),
  ).not.toBeNull();
  expect(document.documentElement.lang).toBe("en-US");
  expect(container.textContent).toContain(message("en-US", "open_storage"));
  foundation.readLocale.mockImplementationOnce(
    () => call({ ok: false, error: { code: "storage_failed" } }) as never,
  );
  await click(container, "open_storage");
  expect(bootstrap.openStorage).toHaveBeenCalledOnce();
  expect(foundation.readLocale).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(container.querySelector(".workspace-skip"));
  expect(document.documentElement.lang).toBe("ko-KR");
  expect(container.textContent).toContain(message("ko-KR", "intro"));
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === message("ko-KR", "command.settings.open"))!
      .click();
  });
  expect(container.textContent).toContain(message("ko-KR", "settings.language.readFailed"));
  const refreshLanguage = container.querySelector<HTMLButtonElement>(
    '[aria-labelledby="language-title"] button',
  )!;
  await act(async () => {
    refreshLanguage.click();
  });
  expect(container.querySelector(".foundation-titlebar h1")?.textContent).toContain("Ohtia");
  expect(container.querySelector(".workspace-welcome h1")?.textContent).toBe(
    message("en-US", "workspace.welcome"),
  );
  expect(
    container.querySelector('.foundation-titlebar [data-workspace-command="menu.open"]'),
  ).not.toBeNull();
  expect(document.documentElement.lang).toBe("en-US");
  expect(container.textContent).toContain(message("en-US", "intro"));
  snapshot = { ...snapshot, locale: "ko-KR" };
  await act(async () =>
    commands.onIntent.mock.calls.at(-1)![0]({
      windowGeneration: "renderer-window",
      source: "native",
      sequence: 1,
      command: "window.new",
    }),
  );
  expect(container.querySelector(".foundation-titlebar h1")?.textContent).toContain("Ohtia");
  expect(container.querySelector(".workspace-welcome h1")?.textContent).toBe(
    message("en-US", "workspace.welcome"),
  );
  expect(
    container.querySelector('.foundation-titlebar [data-workspace-command="menu.open"]'),
  ).not.toBeNull();
  expect(document.documentElement.lang).toBe("en-US");
  expect(container.textContent).toContain(message("en-US", "intro"));
  snapshot = { ...snapshot, locale: "en-US" };
  expect(bootstrap.newWindow).not.toHaveBeenCalled();
  expect(commands.windowAction).toHaveBeenCalledOnce();
  expect(container.textContent).toContain(message("en-US", "command.reason.window_limit"));
  await act(async () => {
    container.querySelector<HTMLButtonElement>("dialog[open] [data-close]")!.click();
  });
  snapshot = { ...snapshot, state: "recovery_required" };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(container.querySelector('[role="alert"]')).toBe(document.activeElement);
  await click(container, "restore_checkpoint");
  expect(bootstrap.restoreCheckpoint).toHaveBeenCalledOnce();
  bootstrap.retryService.mockRejectedValueOnce(new Error("synthetic failure"));
  await click(container, "retry");
  expect(container.textContent).toContain(message("en-US", "startup_failed"));
  await click(container, "retry");
  await click(container, "command.settings.open");
  const focusedControl = container.querySelector("select")!;
  await act(async () => {
    focusedControl.focus();
  });
  snapshot = { ...snapshot, state: "storage_ready", notice: "locale_fallback" };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(document.activeElement).toBe(focusedControl);
  await click(container, "command.application.quit");
  expect(commands.perform).toHaveBeenCalledWith("application.quit");
  expect(bootstrap.exit).not.toHaveBeenCalled();
  await act(async () =>
    container.querySelector<HTMLButtonElement>("dialog[open] [data-close]")!.click(),
  );
  commands.about.mockResolvedValue({
    product: "Ohtia",
    version: "synthetic",
    build: "synthetic",
    platform: "linux",
    architecture: "x86-64",
    copyright: "Synthetic",
    license: "MIT",
    notices: [],
  });
  const nativeIntent = commands.onIntent.mock.calls.at(-1)![0];
  for (const [index, command] of (
    ["help.open", "about.open", "settings.open"] as const
  ).entries()) {
    await act(async () => {
      (document.activeElement as HTMLElement).blur();
      expect(document.activeElement).toBe(document.body);
      nativeIntent({
        windowGeneration: "renderer-window",
        source: "native",
        sequence: 100 + index,
        command,
      });
    });
    expect(container.querySelector("dialog[open]")).not.toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>("dialog[open] [data-close]")!.click(),
    );
    expect(document.activeElement).toBe(container.querySelector(".workspace-skip"));
  }
  snapshot = { ...snapshot, state: "storage_opening" };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  const calls = bootstrap.retryService.mock.calls.length;
  await click(container, "retry");
  expect(bootstrap.retryService.mock.calls.length).toBe(calls);
}, 60000);
