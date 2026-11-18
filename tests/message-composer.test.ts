// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerController } from "../packages/renderer/src/composer-controller.js";
import { ExitDialog } from "../packages/renderer/src/exit-dialog.js";
import { MessageComposer } from "../packages/renderer/src/message-composer.js";
import {
  failure,
  message,
  supportedLocales,
  type FoundationPort,
  type Outcome,
  type ResearchResult,
  type ProviderDeclaration,
} from "../packages/contracts/src/index.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const projectId = "019a8000-0000-7000-8000-000000000001";
const conversationId = "019a8000-0000-7000-8000-000000000002";
const resultId = "019a8000-0000-7000-8000-000000000003";
const scope = { projectId, conversationId };
const success: Outcome<ResearchResult> = { ok: true, value: { resultId } };
const call = <T>(value: T) => ({ result: Promise.resolve(value), cancel() {} });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const result = new Promise<T>((done) => {
    resolve = done;
  });
  return { result, resolve, cancel() {} };
}
async function harness(declaration?: ProviderDeclaration["connection"], ready = true) {
  let id = 0;
  const append = vi.fn(() => call(success));
  const stop = vi.fn(() => call(success));
  const part = vi.fn(() => call({ ok: true as const, value: { accepted: true as const } }));
  const destination = vi.fn(() =>
    call({
      ok: true as const,
      value: {
        destination: {
          operation: "development_test",
          maxAttemptDurationMs: 600_000,
          connection: declaration?.id ?? "chatgpt",
        },
      },
    }),
  );
  const readConnection = vi.fn(() =>
    call({
      ok: true as const,
      value: {
        state: "connected",
        account_email: "researcher@example.org",
        last_account_email: null,
      },
    }),
  );
  const port = {
    appendMessage: append,
    stopConversation: stop,
    sendTextPart: part,
    readDestination: destination,
    readConnection,
  } as unknown as FoundationPort;
  const controller = new ComposerController(
    port,
    () => `intent-${++id}`,
    declaration ? [declaration] : undefined,
  );
  controller.open(scope);
  controllers.push(controller);
  if (ready) await controller.refreshDestination();
  return { controller, append, stop, part, destination, readConnection };
}
const controllers: ComposerController[] = [];
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 1;
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  controllers.splice(0).forEach((controller) => controller.dispose());
  container.remove();
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    for (let n = 0; n < 10; n++) await Promise.resolve();
  });
}
async function render(
  controller: ComposerController,
  locale: (typeof supportedLocales)[number] = "en-US",
) {
  await act(async () => root.render(h(MessageComposer, { controller, locale })));
}
it("sends on Enter, preserves Shift+Enter and does not send Enter during Korean composition or keycode 229", async () => {
  const f = await harness();
  f.controller.edit("한글 mixed text");
  await render(f.controller);
  const input = container.querySelector("textarea")!;
  for (const event of [
    new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
    new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true }),
  ])
    await act(async () => input.dispatchEvent(event));
  await act(async () =>
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
  );
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(f.append).not.toHaveBeenCalled();
  await act(async () =>
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
  );
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(f.append).toHaveBeenCalledTimes(1);
  expect(f.append.mock.calls[0]).toEqual([
    "intent-1",
    { conversationId, content: "한글 mixed text" },
  ]);
});
it("keeps an over-limit paste whole, counts Unicode code points and describes the input and disabled Send", async () => {
  const f = await harness();
  await render(f.controller);
  const pasted = "😀".repeat(20_001);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? pasted : "<b>ignored</b>") },
  });
  await act(async () => container.querySelector("textarea")!.dispatchEvent(event));
  expect(f.controller.snapshot().text).toBe(pasted);
  expect(container.querySelector(".composer-counter .primitive-announcement")?.textContent).toBe(
    "20,001 of 20,000 characters",
  );
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Remove 1 character");
  expect(
    container.querySelector('button[aria-label="Send message"]')?.getAttribute("aria-disabled"),
  ).toBe("true");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click(),
  );
  expect(f.append).not.toHaveBeenCalled();
  await act(async () => f.controller.edit(pasted + "👩‍🔬"));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Remove 4 characters");
});
it.each(["\r\n", "\r", "\n"])(
  "matches textarea line endings when pasting %j and clears only the saved prefix",
  async (newline) => {
    const f = await harness();
    const saved = deferred<Outcome<ResearchResult>>();
    f.append.mockReturnValue(saved);
    f.controller.edit("Start selected end");
    await render(f.controller);
    const input = container.querySelector("textarea")!;
    input.setSelectionRange(6, 14);
    const frames: (() => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => `one${newline}two${newline}` },
    });
    await act(async () => input.dispatchEvent(event));
    frames.splice(0).forEach((callback) => callback());
    const submitted = "Start one\ntwo\n end";
    expect(f.controller.snapshot().text).toBe(submitted);
    expect(input.value).toBe(submitted);
    expect([input.selectionStart, input.selectionEnd]).toEqual([14, 14]);
    await act(async () => f.controller.send());
    expect(f.append).toHaveBeenCalledWith("intent-1", { conversationId, content: submitted });
    await act(async () => f.controller.edit(input.value + "newer"));
    await act(async () => saved.resolve(success));
    expect(f.controller.snapshot().text).toBe("newer");
    expect(input.value).toBe("newer");
  },
);
it("uploads 20,000 emoji points without cutting, retries all parts once and reuses one operation identity", async () => {
  const f = await harness();
  f.append
    .mockReturnValueOnce(call(failure("parts_incomplete")))
    .mockReturnValueOnce(call(success));
  f.controller.edit("😀".repeat(20_000));
  f.controller.send();
  await vi.waitFor(() => expect(f.controller.snapshot().saving).toBe(false));
  expect(f.append).toHaveBeenCalledTimes(2);
  const parts = f.part.mock.calls as unknown as [
    string,
    { text: string; index: number; count: number },
  ][];
  const count = parts[0]![1].count;
  expect(parts).toHaveLength(count * 2);
  expect(
    parts
      .slice(0, count)
      .map(([, part]) => part.text)
      .join(""),
  ).toBe("😀".repeat(20_000));
  expect(new Set(parts.map(([id]) => id))).toEqual(new Set(["intent-1"]));
  expect(f.controller.snapshot().text).toBe("");
});
it.each([
  "uncertain",
  "timeout",
  "cancelled",
  "disposed",
  "invalid_service_result",
  "storage_failed",
  "message_invalid",
  "project_in_setup",
  "parts_incomplete",
  "pending_limit_reached",
  "input_too_large",
] as const)(
  "preserves text and the correct notice after %s; editing invalidates retry identity",
  async (code) => {
    const f = await harness();
    f.append.mockReturnValue(call(failure(code)));
    f.controller.edit("  exact text\n");
    await act(async () => {
      f.controller.send();
    });
    await settle();
    expect(f.controller.snapshot().text).toBe("  exact text\n");
    expect(f.controller.snapshot().notice).toBe(
      code === "pending_limit_reached"
        ? "pendingLimit"
        : code === "input_too_large"
          ? "inputTooLarge"
          : ["uncertain", "timeout", "cancelled", "disposed", "invalid_service_result"].includes(
                code,
              )
            ? "uncertain"
            : "failed",
    );
    await render(f.controller);
    expect(container.querySelector('button[aria-label="Send message"]')).not.toBeNull();
    const first = f.append.mock.calls[0] as unknown as [string];
    await act(async () => {
      f.controller.send();
    });
    await settle();
    expect((f.append.mock.calls.at(-1) as unknown as [string])[0]).toBe(first[0]);
    await act(async () => {
      f.controller.edit("changed");
      f.controller.send();
    });
    await settle();
    expect((f.append.mock.calls.at(-1) as unknown as [string])[0]).not.toBe(first[0]);
  },
);
it.each([success, failure("storage_failed"), failure("uncertain")])(
  "binds Stop to a pending long save and stops once after its result %#",
  async (outcome) => {
    const f = await harness();
    const saved = deferred<Outcome<ResearchResult>>();
    const stopped = deferred<Outcome<ResearchResult>>();
    f.append.mockReturnValue(saved);
    f.stop.mockReturnValue(stopped);
    f.controller.edit("😀".repeat(20_000));
    f.controller.send();
    await vi.waitFor(() => expect(f.append).toHaveBeenCalledOnce());
    await render(f.controller);
    await act(async () => {
      f.controller.requestStop();
      f.controller.requestStop();
    });
    expect(f.stop).not.toHaveBeenCalled();
    expect(container.querySelector(".composer-reason")?.textContent).toBe(
      "Wait until the replies stop.",
    );
    expect(
      container.querySelector('button[aria-label="Stop replies"]')?.getAttribute("aria-disabled"),
    ).toBe("true");
    await act(async () => saved.resolve(outcome));
    await settle();
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.stop.mock.calls[0]).toEqual(["intent-2", { conversationId }]);
    await act(async () => stopped.resolve(success));
    expect(f.controller.snapshot().stopping).toBe(false);
    expect(f.controller.snapshot().text).toBe(outcome.ok ? "" : "😀".repeat(20_000));
  },
);
it("prevents a double send during a slow confirmation and removes only the submitted prefix", async () => {
  const f = await harness();
  const saved = deferred<Outcome<ResearchResult>>();
  f.append.mockReturnValue(saved);
  f.controller.edit("first");
  f.controller.send();
  f.controller.send();
  await settle();
  expect(f.append).toHaveBeenCalledOnce();
  f.controller.edit("first and newer");
  saved.resolve(success);
  await settle();
  expect(f.controller.snapshot().text).toBe(" and newer");
  const second = deferred<Outcome<ResearchResult>>();
  f.append.mockReturnValue(second);
  f.controller.edit("original");
  f.controller.send();
  f.controller.edit("edited original");
  second.resolve(success);
  await settle();
  expect(f.controller.snapshot().text).toBe("edited original");
});
it("keeps drafts and delayed outcomes in their original conversation and erases them on disposal", async () => {
  const f = await harness();
  const saved = deferred<Outcome<ResearchResult>>();
  f.append.mockReturnValue(saved);
  f.controller.edit("A");
  f.controller.send();
  f.controller.open({ projectId, conversationId: resultId });
  f.controller.edit("B");
  saved.resolve(success);
  await settle();
  expect(f.controller.snapshot().text).toBe("B");
  f.controller.open(scope);
  expect(f.controller.snapshot().text).toBe("");
  f.controller.open({ projectId, conversationId: resultId });
  expect(f.controller.snapshot().text).toBe("B");
});
it.each([false, true])(
  "keeps Stop disabled until its result and terminal state in either order: terminal first %s",
  async (terminalFirst) => {
    const f = await harness();
    const stopped = deferred<Outcome<ResearchResult>>();
    f.stop.mockReturnValue(stopped);
    f.controller.running(true);
    f.controller.requestStop();
    if (terminalFirst) f.controller.running(false);
    else {
      stopped.resolve(success);
      await settle();
    }
    expect(f.controller.snapshot().stopping).toBe(true);
    if (terminalFirst) {
      stopped.resolve(success);
      await settle();
    } else f.controller.running(false);
    expect(f.controller.snapshot().stopping).toBe(false);
  },
);
it("retries an unconfirmed Stop with its original identity and keeps the failure outside its action", async () => {
  const f = await harness();
  f.stop.mockReturnValueOnce(call(failure("uncertain"))).mockReturnValueOnce(call(success));
  f.controller.running(true);
  f.controller.requestStop();
  await settle();
  await render(f.controller);
  expect(container.querySelector(".composer-stop-error [role=status] button")).toBeNull();
  expect(container.querySelector(".composer-reason")?.textContent).toBe(
    "Wait until the replies stop.",
  );
  expect(
    container.querySelector('button[aria-label="Stop replies"]')?.getAttribute("aria-disabled"),
  ).toBe("true");
  await act(async () => {
    f.controller.running(false);
    f.controller.retryStop();
    f.controller.retryStop();
  });
  await settle();
  expect(f.stop).toHaveBeenCalledTimes(2);
  expect(f.stop.mock.calls[0]).toEqual(f.stop.mock.calls[1]);
});
it.each(["subscription", "api_key"] as const)(
  "shows %s metadata from its declaration and connection read for existing and new conversations",
  async (kind) => {
    const f = await harness({ id: "fake", displayName: "Fake service", kind, usageUrl: null });
    await f.controller.refreshDestination();
    await render(f.controller);
    expect(container.querySelector(".composer-destination")?.textContent).toBe(
      kind === "subscription"
        ? "To Fake service (researcher@example.org)"
        : "To Fake service · API key",
    );
    expect(f.destination.mock.calls[0]).toEqual([{ projectId, conversationId }]);
    await act(async () => {
      f.controller.open({ projectId, conversationId: null });
      await f.controller.refreshDestination();
    });
    expect(f.destination.mock.calls.at(-1)).toEqual([{ projectId, agentId: "virgilio" }]);
  },
);
it("asks before reuse, focuses the footer close button and only replaces with explicit confirmation", async () => {
  const f = await harness();
  f.controller.edit("private draft");
  await render(f.controller);
  await act(async () => f.controller.reuse("reused"));
  const dialog = container.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  expect(document.activeElement?.textContent).toBe("Close dialog");
  expect(dialog.querySelectorAll("button")).toHaveLength(2);
  expect(dialog.querySelector("button")?.querySelector("svg")).not.toBeNull();
  await act(async () => dialog.querySelector<HTMLButtonElement>("button")!.click());
  expect(f.controller.snapshot().text).toBe("private draft");
  await act(async () => f.controller.reuse("reused"));
  await act(async () =>
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent === "Replace text")!
      .click(),
  );
  expect(f.controller.snapshot().text).toBe("reused");
});
it.each(supportedLocales)(
  "renders plural counts and all states in %s with the specified order",
  async (locale) => {
    const f = await harness();
    await f.controller.refreshDestination();
    f.controller.edit("😀".repeat(20_002));
    await render(f.controller, locale);
    const children = [...container.querySelector(".message-composer")!.children].map(
      (item) => item.className,
    );
    expect(children.slice(0, 4)).toEqual([
      "composer-box",
      "composer-counter",
      "conversation-notice attention",
      "composer-destination",
    ]);
    expect(message(locale, "composer.counter", { used: 1, max: 2 })).not.toContain("plural");
    expect(message(locale, "composer.remove", { excess: 1 })).not.toContain("plural");
    await act(async () => f.controller.edit(" \n\t"));
    expect(
      container.querySelector('button[aria-disabled="true"]')?.getAttribute("aria-describedby"),
    ).toBeTruthy();
  },
);

it("keeps pending-save Stop available when newer input exceeds the message limit", async () => {
  const f = await harness();
  const saved = deferred<Outcome<ResearchResult>>();
  f.append.mockReturnValue(saved);
  f.controller.edit("Question");
  f.controller.send();
  await render(f.controller);
  await act(async () => f.controller.edit("x".repeat(20_001)));
  const stop = container.querySelector<HTMLButtonElement>('button[aria-label="Stop replies"]')!;
  expect(stop.getAttribute("aria-disabled")).toBe("false");
  expect(stop.getAttribute("aria-describedby")).toBeNull();
  expect(container.querySelector("textarea")?.getAttribute("aria-describedby")).toContain("notice");
  await act(async () => stop.click());
  await act(async () => saved.resolve(success));
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.controller.snapshot().text).toBe("x".repeat(20_001));
});

it("ignores superseded destination reads and hides undeclared destinations", async () => {
  const f = await harness();
  f.readConnection.mockClear();
  const first = deferred<Outcome<{ destination: null }>>();
  f.destination.mockReturnValueOnce(first as never);
  const old = f.controller.refreshDestination();
  f.destination.mockReturnValueOnce(call({ ok: true, value: { destination: null } }) as never);
  await f.controller.refreshDestination();
  first.resolve({ ok: true, value: { destination: null } });
  await old;
  expect(f.controller.snapshot().destination).toBeNull();
  f.destination.mockReturnValueOnce(
    call({
      ok: true,
      value: {
        destination: {
          operation: "development_test",
          maxAttemptDurationMs: 600_000,
          connection: "undeclared",
        },
      },
    }),
  );
  await f.controller.refreshDestination();
  expect(f.controller.snapshot().destination).toBeNull();
  expect(f.readConnection).not.toHaveBeenCalled();
});
it("retains text when a text-part upload fails or the port throws before its result", async () => {
  const f = await harness();
  f.part.mockReturnValueOnce(call(failure("busy")) as never);
  f.controller.edit("😀".repeat(20_000));
  f.controller.send();
  await vi.waitFor(() => expect(f.controller.snapshot().saving).toBe(false));
  expect(f.append).not.toHaveBeenCalled();
  expect(f.controller.snapshot().notice).toBe("failed");
  expect(f.controller.snapshot().text).toBe("😀".repeat(20_000));
  f.append.mockImplementationOnce(() => {
    throw new Error("Unconfirmed transport outcome");
  });
  f.controller.edit("Another message");
  f.controller.send();
  await settle();
  expect(f.controller.snapshot().notice).toBe("uncertain");
  expect(f.controller.snapshot().text).toBe("Another message");
});
it("shows unknown account identity explicitly when a subscription has no stored email", async () => {
  const f = await harness();
  f.readConnection.mockReturnValueOnce(
    call({
      ok: true,
      value: { state: "connected", account_email: null, last_account_email: null },
    }) as never,
  );
  await f.controller.refreshDestination();
  await render(f.controller);
  expect(container.querySelector(".composer-destination")?.textContent).toContain(
    "ChatGPT (Unknown)",
  );
});
it("handles native text input, resize observation and clicking Send while retaining text until confirmation", async () => {
  const f = await harness();
  const saved = deferred<Outcome<ResearchResult>>();
  f.append.mockReturnValue(saved);
  const observed: Element[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(element: Element) {
        observed.push(element);
      }
      disconnect() {
        disconnect();
      }
    },
  );
  await act(async () =>
    root.render(
      h(
        "div",
        { className: "conversation-view" },
        h(MessageComposer, { controller: f.controller, locale: "en-US" }),
      ),
    ),
  );
  const input = container.querySelector("textarea")!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Native input 한글",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(f.controller.snapshot().text).toBe("Native input 한글");
  expect(observed).toContain(input.closest(".conversation-view"));
  expect(disconnect).toHaveBeenCalled();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click(),
  );
  expect(f.append).toHaveBeenCalledOnce();
  expect(input.value).toBe("Native input 한글");
  expect(container.querySelector('button[aria-label="Stop replies"]')).not.toBeNull();
  await act(async () => saved.resolve(success));
  expect(input.value).toBe("");
});

it("keeps Send blocked while destination metadata is pending and permits it only after disclosure", async () => {
  const f = await harness(undefined, false);
  const pending = deferred<Outcome<{ destination: null }>>();
  f.destination.mockReturnValueOnce(pending as never);
  f.controller.edit("Keep this draft");
  const reading = f.controller.refreshDestination();
  await render(f.controller);
  const send = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
  expect(send.getAttribute("aria-disabled")).toBe("true");
  expect(container.querySelector(".composer-reason")?.textContent).toBe(
    "Reading the message destination…",
  );
  await act(async () => {
    send.click();
    f.controller.send();
  });
  expect(f.append).not.toHaveBeenCalled();
  expect(f.controller.snapshot().text).toBe("Keep this draft");
  await act(async () => {
    pending.resolve({ ok: true, value: { destination: null } });
    await reading;
  });
  expect(send.getAttribute("aria-disabled")).toBe("false");
  await act(async () => send.click());
  expect(f.append).toHaveBeenCalledOnce();
});
it.each(["destination", "account", "throw"])(
  "retains the draft, exposes refresh and keeps Stop available after a %s read failure",
  async (source) => {
    const f = await harness();
    f.controller.edit("Unsent draft");
    if (source === "destination")
      f.destination.mockReturnValueOnce(call(failure("storage_failed")) as never);
    else if (source === "account")
      f.readConnection.mockReturnValueOnce(call(failure("storage_failed")) as never);
    else
      f.destination.mockImplementationOnce(() => {
        throw new Error("Read unavailable");
      });
    await f.controller.refreshDestination();
    await render(f.controller);
    expect(f.controller.snapshot().destinationStatus).toBe("failed");
    expect(f.controller.snapshot().destination).toBeNull();
    expect(container.querySelector(".composer-destination-error")?.textContent).toContain(
      "Refresh before sending it.",
    );
    await act(async () => f.controller.send());
    expect(f.append).not.toHaveBeenCalled();
    expect(f.controller.snapshot().text).toBe("Unsent draft");
    const refresh = container.querySelector<HTMLButtonElement>(
      ".composer-destination-error button",
    )!;
    expect(refresh.textContent).toBe("Refresh destination");
    await act(async () => refresh.click());
    expect(f.controller.snapshot().destinationStatus).toBe("ready");
    expect(
      container.querySelector('button[aria-label="Send message"]')?.getAttribute("aria-disabled"),
    ).toBe("false");
    await act(async () => {
      f.controller.running(true);
      f.controller.edit("");
    });
    f.destination.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await act(async () => f.controller.refreshDestination());
    const stop = container.querySelector<HTMLButtonElement>('button[aria-label="Stop replies"]')!;
    expect(stop.getAttribute("aria-disabled")).toBe("false");
    await act(async () => stop.click());
    expect(f.stop).toHaveBeenCalledOnce();
  },
);
it("cancels destination reads on navigation and disposal without leaking their late results", async () => {
  const f = await harness();
  const first = { ...deferred<Outcome<{ destination: null }>>(), cancel: vi.fn() };
  f.destination.mockReturnValueOnce(first as never);
  const reading = f.controller.refreshDestination();
  f.controller.open({ projectId, conversationId: resultId });
  expect(first.cancel).toHaveBeenCalledOnce();
  first.resolve({ ok: true, value: { destination: null } });
  await reading;
  expect(f.controller.snapshot().destinationStatus).toBe("loading");
  const account = { ...deferred<Outcome<never>>(), cancel: vi.fn() };
  f.readConnection.mockReturnValueOnce(account as never);
  const next = f.controller.refreshDestination();
  await settle();
  f.controller.dispose();
  expect(account.cancel).toHaveBeenCalledOnce();
  account.resolve(failure("cancelled"));
  await next;
});
it("does not announce an old send when returning to a conversation", async () => {
  const f = await harness();
  f.controller.edit("Message A");
  f.controller.send();
  await settle();
  expect(f.controller.snapshot().announcement).toBe(1);
  f.controller.open({ projectId, conversationId: resultId });
  f.controller.open(scope);
  await render(f.controller);
  expect(f.controller.snapshot().announcement).toBe(0);
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("");
});
it("leaves text and selection intact when pasting an image without plain text", async () => {
  const f = await harness();
  f.controller.edit("Keep selected text");
  await render(f.controller);
  const input = container.querySelector("textarea")!;
  input.setSelectionRange(5, 13);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => "" } });
  await act(async () => input.dispatchEvent(event));
  expect(input.value).toBe("Keep selected text");
  expect([input.selectionStart, input.selectionEnd]).toEqual([5, 13]);
});
it("gives exit confirmation one footer Close with its x, initial focus and cancellation guard", async () => {
  const onChoose = vi.fn();
  await act(async () =>
    root.render(
      h(ExitDialog, {
        state: { operationId: "exit-1", phase: "confirm", running: 2, failed: false },
        locale: "en-US",
        onChoose,
      }),
    ),
  );
  const dialog = container.querySelector("dialog")!;
  const closes = [...dialog.querySelectorAll("button")].filter(
    (b) => b.textContent === "Close dialog",
  );
  expect(closes).toHaveLength(1);
  const close = closes[0]!;
  expect(close.closest(".primitive-dialog-footer")).not.toBeNull();
  expect(close.querySelector("svg")).not.toBeNull();
  expect(dialog.querySelector(".primitive-dialog-header button")).toBeNull();
  expect(document.activeElement).toBe(close);
  await act(async () => close.click());
  expect(onChoose).toHaveBeenLastCalledWith("close");
  onChoose.mockClear();
  await act(async () =>
    root.render(
      h(ExitDialog, {
        state: { operationId: "exit-1", phase: "cancelling", running: 2, failed: false },
        locale: "en-US",
        onChoose,
      }),
    ),
  );
  expect(close.getAttribute("aria-disabled")).toBe("true");
  expect(close.getAttribute("aria-description")).toBe(message("en-US", "exit.cancelling"));
  await act(async () => close.click());
  expect(onChoose).not.toHaveBeenCalled();
});

it.each(["loading", "failed"] as const)(
  "preserves empty and over-limit Send descriptions while destination is %s",
  async (status) => {
    const f = await harness(undefined, false);
    if (status === "failed") f.controller.destinationUnavailable();
    await render(f.controller);
    const send = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
    const described = () => document.getElementById(send.getAttribute("aria-describedby")!)!;
    expect(described().textContent).toBe("Write a message to send it.");
    expect(described().className).toBe("primitive-announcement");
    expect(container.querySelector(".composer-reason")).toBeNull();
    await act(async () => f.controller.edit("x".repeat(20_001)));
    expect(described().textContent).toContain("Remove 1 character");
    expect(described().className).toContain("conversation-notice");
    expect(container.querySelector(".composer-reason")).toBeNull();
  },
);
it("rechecks disclosure before sending after a previously confirmed destination changes", async () => {
  const f = await harness();
  f.controller.edit("Next message");
  const pending = deferred<Outcome<{ destination: null }>>();
  f.destination.mockReturnValueOnce(pending as never);
  const reading = f.controller.refreshDestination();
  expect(f.controller.snapshot().destinationStatus).toBe("loading");
  f.controller.send();
  expect(f.append).not.toHaveBeenCalled();
  f.controller.destinationUnavailable();
  pending.resolve({ ok: true, value: { destination: null } });
  await reading;
  expect(f.controller.snapshot().destinationStatus).toBe("failed");
  f.controller.send();
  expect(f.append).not.toHaveBeenCalled();
  await f.controller.refreshDestination();
  f.controller.send();
  await settle();
  expect(f.append).toHaveBeenCalledOnce();
});

it("preserves a completed destination when unrelated conversation synchronization fails", async () => {
  const f = await harness();
  const destination = f.controller.snapshot().destination;
  f.controller.destinationUnavailable();
  expect(f.controller.snapshot().destinationStatus).toBe("ready");
  expect(f.controller.snapshot().destination).toBe(destination);
});

it("does not initiate destination work or recovery after disposal", async () => {
  const f = await harness();
  f.destination.mockClear();
  f.controller.dispose();
  await f.controller.refreshDestination();
  expect(f.destination).not.toHaveBeenCalled();
});

it("uses disconnected and globally paused destination variants for each connection kind", async () => {
  for (const kind of ["subscription", "api_key"] as const) {
    const f = await harness({
      id: "chatgpt",
      displayName: "Synthetic service",
      kind,
      usageUrl: null,
    });
    f.readConnection.mockReturnValueOnce(
      call({
        ok: true,
        value: { state: "disconnected", account_email: null, last_account_email: null },
      }) as never,
    );
    await f.controller.refreshDestination();
    await render(f.controller);
    expect(container.querySelector(".composer-destination")?.textContent).toBe(
      "Synthetic service isn’t connected. Messages will wait until you connect.",
    );
    await f.controller.refreshDestination();
    await act(async () =>
      f.controller.pauses({
        revision: 2,
        restart: 0,
        usage: [{ connection: "chatgpt", count: 12 }],
      }),
    );
    expect(container.querySelector(".composer-destination")?.textContent).toContain(
      kind === "subscription" ? "plan limit reached" : "no credit or spending limit reached",
    );
    await act(async () => f.controller.pauses({ revision: 3, restart: 0, usage: [] }));
    expect(container.querySelector(".composer-destination")?.textContent).not.toContain("paused");
  }
});

it("disables the composer Stop while another window's cancellation is observed", async () => {
  const f = await harness();
  f.controller.running(true, true);
  await render(f.controller);
  expect(container.querySelector(".composer-action")?.getAttribute("aria-disabled")).toBe("true");
  expect(container.querySelector(".composer-reason")?.textContent).toBe(
    "Wait until the replies stop.",
  );
  await act(async () => f.controller.running(false, false));
  expect(container.querySelector(".composer-reason")).toBeNull();
});

it("keeps confirmed-project guidance editable and retains a pending-limit rejection with its attention notice", async () => {
  const f = await harness();
  f.controller.setup(true, []);
  f.controller.edit("Please suggest a next research action.");
  f.append.mockReturnValueOnce(call(failure("pending_limit_reached")));
  await render(f.controller);
  const input = container.querySelector("textarea")!;
  expect(input.disabled).toBe(false);
  expect(input.getAttribute("aria-label")).toBe(
    message("en-US", "composer.placeholder", { agent: "Virgilio" }),
  );
  expect(container.textContent).not.toContain(message("en-US", "setup.composerDisabled"));
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  await settle();
  expect(f.append).toHaveBeenCalledOnce();
  expect(input.value).toBe("Please suggest a next research action.");
  const notice = container.querySelector(".conversation-notice.attention")!;
  expect(notice.textContent).toBe(message("en-US", "composer.pendingLimit"));
  expect(notice.getAttribute("role")).toBe("status");
  expect(notice.querySelector("button, a")).toBeNull();
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  await settle();
  expect(f.append).toHaveBeenCalledTimes(2);
  expect(input.value).toBe("");
});

it.each(["pending_limit_reached", "storage_failed", "uncertain"] as const)(
  "keeps a new conversation draft and operation identity when start returns %s",
  async (code) => {
    const h = await harness();
    const start = vi
      .fn<FoundationPort["startConversation"]>()
      .mockReturnValueOnce(call(failure(code)))
      .mockReturnValueOnce(call(success));
    const adopted = vi.fn();
    const controller = new ComposerController(
      {
        startConversation: start,
        readDestination: h.destination,
        readConnection: h.readConnection,
      } as unknown as FoundationPort,
      () => "one-start",
      undefined,
      undefined,
      adopted,
    );
    controllers.push(controller);
    controller.open({ projectId, conversationId: null });
    await controller.refreshDestination();
    expect(h.destination).toHaveBeenLastCalledWith({ projectId, agentId: "virgilio" });
    controller.edit("First message");
    expect(start).not.toHaveBeenCalled();
    controller.send();
    await settle();
    expect(controller.snapshot()).toMatchObject({
      text: "First message",
      notice:
        code === "pending_limit_reached"
          ? "pendingLimit"
          : code === "uncertain"
            ? "uncertain"
            : "failed",
    });
    expect(adopted).not.toHaveBeenCalled();
    controller.send();
    await settle();
    expect(start.mock.calls).toEqual([
      ["one-start", { projectId, content: "First message" }],
      ["one-start", { projectId, content: "First message" }],
    ]);
    expect(adopted).toHaveBeenCalledWith({ projectId, conversationId: resultId }, true);
    controller.open({ projectId, conversationId: resultId });
    expect(controller.snapshot().text).toBe("");
  },
);
