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
    expect(document.documentElement.dataset.appearance).toBe("dark");
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
  const foundation = {
    ...port(),
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
  Object.defineProperty(window, "ohtia", { value: { foundation, bootstrap }, configurable: true });
  const container = document.createElement("div");
  container.id = "root";
  document.body.append(container);
  await act(async () => {
    await import("../packages/renderer/src/desktop.js");
  });
  expect(document.documentElement.lang).toBe("en-US");
  expect(container.textContent).toContain(message("en-US", "open_storage"));
  foundation.readLocale.mockImplementationOnce(
    () => call({ ok: false, error: { code: "storage_failed" } }) as never,
  );
  await click(container, "open_storage");
  expect(bootstrap.openStorage).toHaveBeenCalledOnce();
  expect(foundation.readLocale).toHaveBeenCalledOnce();
  expect(document.activeElement?.id).toBe("location-state");
  expect(document.documentElement.lang).toBe("ko-KR");
  expect(container.textContent).toContain(message("ko-KR", "intro"));
  expect(container.textContent).toContain(message("ko-KR", "settings.language.readFailed"));
  const refreshLanguage = container.querySelector<HTMLButtonElement>(
    '[aria-labelledby="language-title"] button',
  )!;
  await act(async () => {
    refreshLanguage.click();
  });
  expect(document.documentElement.lang).toBe("en-US");
  expect(container.textContent).toContain(message("en-US", "intro"));
  snapshot = { ...snapshot, locale: "ko-KR" };
  await click(container, "new_window");
  expect(document.documentElement.lang).toBe("en-US");
  expect(container.textContent).toContain(message("en-US", "intro"));
  snapshot = { ...snapshot, locale: "en-US" };
  expect(bootstrap.newWindow).toHaveBeenCalledOnce();
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
  const focusedControl = container.querySelector("select")!;
  focusedControl.focus();
  snapshot = { ...snapshot, state: "storage_ready", notice: "locale_fallback" };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(document.activeElement).toBe(focusedControl);
  await click(container, "exit");
  expect(bootstrap.exit).toHaveBeenCalledOnce();
  snapshot = { ...snapshot, state: "storage_opening" };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  const calls = bootstrap.retryService.mock.calls.length;
  await click(container, "retry");
  expect(bootstrap.retryService.mock.calls.length).toBe(calls);
});
