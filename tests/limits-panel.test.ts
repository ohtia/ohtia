// @vitest-environment jsdom
import { act, createRef, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  failure,
  message,
  supportedLocales,
  type InterfaceLocale,
  type FoundationPort,
  type ExecutionLimitsRecord,
} from "@ohtia/contracts";
import { LimitsFeedback, LimitsPanel } from "../packages/renderer/src/limits-panel.js";
import { LimitsController } from "../packages/renderer/src/limits-controller.js";
import { call, deferred } from "./fixtures/settings.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
const controllers: LimitsController[] = [];
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  controllers.splice(0).forEach((c) => c.dispose());
  container.remove();
});
async function mount(locale: InterfaceLocale = "en-US", available = true) {
  let current: ExecutionLimitsRecord = {
    serviceGeneration: "first",
    revision: 2,
    max_concurrent_inference: 10,
    running: 0,
  };
  const port = {
    readExecutionLimits: vi.fn(() => call({ ok: true as const, value: current })),
    replaceExecutionLimits: vi.fn((change: { value: number }) => {
      current = {
        ...current,
        revision: current.revision + 1,
        max_concurrent_inference: change.value,
      };
      return call({ ok: true as const, value: current });
    }),
    readExecutionLimitsReceipt: vi.fn(() =>
      call({ ok: true as const, value: { state: "not_found" as const } }),
    ),
  };
  let n = 0;
  const controller = new LimitsController(port as unknown as FoundationPort, () => `save-${++n}`);
  controllers.push(controller);
  const render = (lang = locale, storageAvailable = available) =>
    root.render(
      h(LimitsPanel, {
        controller,
        locale: lang,
        available: storageAvailable,
        connections: [
          { id: "chatgpt", name: "ChatGPT", kind: "subscription", limit: 3 },
          { id: "openai_api", name: "OpenAI", kind: "api_key" },
        ],
      }),
    );
  await act(async () => {
    render();
  });
  const input = () => container.querySelector<HTMLInputElement>("input")!;
  const type = async (text: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input(),
        text,
      );
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  const enter = () =>
    act(async () =>
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
  return {
    controller,
    port,
    input,
    type,
    enter,
    render,
    set current(next: ExecutionLimitsRecord) {
      current = next;
    },
    get current() {
      return current;
    },
  };
}
describe("simultaneous work field", () => {
  it.each(["0", "51", "1.5", "text", ""])(
    "keeps invalid input %j out of storage and associates the range notice",
    async (text) => {
      const f = await mount();
      await f.type(text);
      await f.enter();
      expect(f.port.replaceExecutionLimits).not.toHaveBeenCalled();
      expect(f.input().getAttribute("aria-invalid")).toBe("true");
      const notice = container.querySelector('[role="alert"]')!;
      expect(notice.textContent).toContain(
        "Enter a whole number from 1 to 50. The saved value, 10, is kept.",
      );
      expect(f.input().getAttribute("aria-describedby")).toContain(notice.id);
      expect(notice.querySelector("button,a")).toBeNull();
    },
  );
  it("saves on Enter and blur, retains focus, and never saves on a keystroke", async () => {
    const f = await mount();
    f.input().focus();
    await f.type("2");
    expect(f.port.replaceExecutionLimits).not.toHaveBeenCalled();
    await f.enter();
    expect(f.port.replaceExecutionLimits).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(f.input());
    expect(container.textContent).toContain("Saved");
    await f.type("3");
    await act(async () => f.input().blur());
    expect(f.port.replaceExecutionLimits).toHaveBeenCalledTimes(2);
    await f.enter();
    expect(f.port.replaceExecutionLimits).toHaveBeenCalledTimes(2);
  });
  it("does not commit Enter during IME composition or remount private input when language changes", async () => {
    const f = await mount();
    const input = f.input();
    input.focus();
    await act(async () =>
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    await f.type("2");
    await f.enter();
    expect(f.port.replaceExecutionLimits).not.toHaveBeenCalled();
    await act(async () =>
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
    );
    await act(async () => f.render("de-DE"));
    expect(f.input()).toBe(input);
    expect(f.input().value).toBe("2");
    await f.enter();
    expect(f.port.replaceExecutionLimits).toHaveBeenCalledOnce();
  });
  it("names each connected service in the right kind, uses the declared cap and updates live running help", async () => {
    const f = await mount();
    expect(container.textContent).toContain(
      "More replies at once can use more of your ChatGPT plan at the same time.",
    );
    expect(container.textContent).toContain(
      "More replies at once can spend your OpenAI key’s credit faster.",
    );
    expect(container.textContent).toContain("ChatGPT allows at most 3 replies at a time.");
    await f.type("1");
    await f.enter();
    f.current = { ...f.current, running: 4 };
    await act(() => f.controller.refresh());
    expect(container.textContent).toContain(
      "4 replies are running. New ones will wait until none are running.",
    );
    expect(container.textContent).not.toContain("ChatGPT allows");
    f.current = { ...f.current, running: 1 };
    await act(() => f.controller.refresh());
    expect(container.textContent).not.toContain("New ones will wait");
  });
  it("shows saving, rejected, uncertain and read failure recovery with actions outside notice boxes", async () => {
    const f = await mount();
    const pending = deferred<ReturnType<typeof failure>>();
    f.port.replaceExecutionLimits.mockReturnValueOnce({
      result: pending.promise,
      cancel() {},
    } as never);
    await f.type("2");
    await f.enter();
    expect(container.textContent).toContain("Saving");
    await act(async () => root.render(null));
    await act(async () => f.render());
    expect(f.input().value).toBe("2");
    await act(async () => pending.resolve(failure("storage_failed")));
    expect(container.textContent).toContain(
      message("en-US", "settings.rejected", {
        setting: message("en-US", "limits.field"),
        value: "10",
      }),
    );
    expect(container.querySelector('[role="alert"] button')).toBeNull();
    await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
    expect(f.port.replaceExecutionLimits).toHaveBeenCalledTimes(2);
    f.port.replaceExecutionLimits.mockReturnValueOnce(call(failure("uncertain")) as never);
    await f.type("3");
    await f.enter();
    expect(container.textContent).toContain(
      message("en-US", "settings.uncertain", { setting: message("en-US", "limits.field") }),
    );
    const check = [...container.querySelectorAll("button")].find((b) => b.textContent === "Check")!;
    await act(async () => check.click());
    expect(f.port.replaceExecutionLimits).toHaveBeenCalledTimes(3);
    f.port.readExecutionLimits.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await act(() => f.controller.refresh());
    expect(container.textContent).toContain(message("en-US", "settings.readFailed"));
    expect(container.querySelectorAll('[role="alert"] button,[role="status"] button')).toHaveLength(
      0,
    );
    f.current = {
      ...f.current,
      serviceGeneration: "second",
      revision: 1,
      max_concurrent_inference: 4,
    };
    const refresh = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === message("en-US", "refresh"),
    )!;
    await act(async () => refresh.click());
    expect(container.textContent).toContain(message("en-US", "settings.language.recovered"));
    const retry = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === message("en-US", "settings.language.tryAgain"),
    )!;
    await act(async () => retry.click());
    expect(f.input().value).toBe("3");
    f.input().focus();
    f.current = { ...f.current, revision: f.current.revision + 1, max_concurrent_inference: 5 };
    await act(() => f.controller.refresh());
    expect(f.input().value).toBe("5");
    expect(document.activeElement).toBe(f.input());
    expect(container.textContent).toContain(
      message("en-US", "settings.changed", {
        setting: message("en-US", "limits.field"),
        value: "5",
      }),
    );
  });
  it("defers reads while unavailable and suppresses unusable read recovery", async () => {
    const f = await mount("en-US", false);
    expect(f.port.readExecutionLimits).not.toHaveBeenCalled();
    expect(f.input().disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    f.port.readExecutionLimits.mockReturnValueOnce(call(failure("service_unavailable")) as never);
    await act(async () => f.render("en-US", true));
    expect(container.textContent).toContain(message("en-US", "settings.readFailed"));
    await act(async () => f.render("en-US", false));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    await act(async () => f.render("en-US", true));
    expect(f.input().disabled).toBe(false);
  });
  it.each(["Enter", "blur"])(
    "accepts %s while the post-receipt read is delayed",
    async (trigger) => {
      const f = await mount();
      f.port.replaceExecutionLimits.mockReturnValueOnce(call(failure("uncertain")) as never);
      await f.type("2");
      await f.enter();
      f.current = { ...f.current, revision: 3, max_concurrent_inference: 2 };
      f.port.readExecutionLimitsReceipt.mockReturnValueOnce(
        call({
          ok: true,
          value: {
            state: "recorded",
            serviceGeneration: "first",
            outcome: { ok: true, value: f.current },
          },
        }) as never,
      );
      const read = deferred<{ ok: true; value: ExecutionLimitsRecord }>();
      f.port.readExecutionLimits.mockReturnValueOnce({
        result: read.promise,
        cancel() {},
      } as never);
      let check!: Promise<void>;
      await act(async () => {
        check = f.controller.check();
      });
      expect(f.input().readOnly).toBe(false);
      expect(container.textContent).toContain("Saved");
      f.input().focus();
      await f.type("3");
      expect(container.textContent).not.toContain("Saved");
      if (trigger === "Enter") await f.enter();
      else await act(async () => f.input().blur());
      expect(f.port.replaceExecutionLimits).toHaveBeenCalledTimes(2);
      expect(f.port.replaceExecutionLimits).toHaveBeenLastCalledWith(
        { operationId: "save-2", value: 3 },
        "first",
      );
      await act(async () => {
        read.resolve({
          ok: true,
          value: { ...f.current, revision: 3, max_concurrent_inference: 2 },
        });
        await check;
      });
      expect(f.input().value).toBe("3");
      await f.type("51");
      await f.enter();
      expect(container.textContent).not.toContain("Saved");
      expect(f.input().getAttribute("aria-invalid")).toBe("true");
    },
  );
  it("restores the visible workspace fallback after window recovery instead of hidden bootstrap commands", async () => {
    const f = await mount();
    f.port.replaceExecutionLimits.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await f.type("2");
    await f.enter();
    const fallback = createRef<HTMLAnchorElement>();
    await act(async () =>
      root.render(
        h(
          "div",
          null,
          h(
            "div",
            { className: "command-entry-actions", hidden: true },
            h("button", null, "Hidden bootstrap"),
          ),
          h("a", { href: "#workspace", ref: fallback }, "Workspace"),
          h(LimitsFeedback, {
            controller: f.controller,
            locale: "en-US",
            available: true,
            inDialog: false,
            onOpenSettings() {},
            returnFocusRef: fallback,
          }),
        ),
      ),
    );
    const action = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>(".limits-feedback button")].find(
        (button) => button.textContent === label,
      )!;
    await act(async () => {
      const retry = action("Try again");
      retry.focus();
      retry.click();
    });
    expect(document.activeElement).toBe(fallback.current);
    expect(f.port.replaceExecutionLimits).toHaveBeenCalledTimes(2);
    f.port.replaceExecutionLimits.mockReturnValueOnce(call(failure("uncertain")) as never);
    await act(() => f.controller.choose(3));
    f.current = { ...f.current, revision: 4, max_concurrent_inference: 3 };
    f.port.readExecutionLimitsReceipt.mockReturnValueOnce(
      call({
        ok: true,
        value: {
          state: "recorded",
          serviceGeneration: "first",
          outcome: { ok: true, value: f.current },
        },
      }) as never,
    );
    await act(async () => {
      const check = action("Check");
      check.focus();
      check.click();
    });
    expect(document.activeElement).toBe(fallback.current);
    expect(f.port.readExecutionLimitsReceipt).toHaveBeenLastCalledWith("save-3");
    expect(f.port.replaceExecutionLimits).toHaveBeenCalledTimes(3);
  });
  it.each(supportedLocales)(
    "has a named number field, described help and all messages in %s",
    async (locale) => {
      const f = await mount(locale);
      const label = container.querySelector("label")!;
      expect(label.htmlFor).toBe(f.input().id);
      expect(label.textContent).toBe(message(locale, "limits.field"));
      expect(f.input().min).toBe("1");
      expect(f.input().max).toBe("50");
      expect(f.input().step).toBe("1");
      expect(container.querySelector("h3")?.textContent).toBe(message(locale, "limits.section"));
      expect(document.getElementById(f.input().getAttribute("aria-describedby")!)).toBeTruthy();
      expect(container.textContent).not.toMatch(/\{[^}]+\}/);
    },
  );
});
