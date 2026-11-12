// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  message,
  supportedLocales,
  staleRevision,
  failure,
  type FoundationPort,
  type ConnectionSnapshot,
  type ConnectionEvent,
  type Outcome,
  type ModelPage,
} from "@ohtia/contracts";
import { ConnectionsPanel } from "../packages/renderer/src/connections-panel.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});
const initial: ConnectionSnapshot = {
  connection: "chatgpt",
  display_name: "Synthetic service",
  account_email: null,
  last_account_email: null,
  state: "disconnected",
  reason: null,
  probing: false,
  probe_id: null,
  model_list_revision: null,
  model_count: 0,
};
async function mount(
  snapshot: Partial<ConnectionSnapshot> = {},
  locale: (typeof supportedLocales)[number] = "en-US",
  initialTimeout = false,
) {
  let current = { ...initial, ...snapshot };
  let receive!: (notice: Outcome<ConnectionEvent>) => void;
  const call = <T>(value: Outcome<T>) => ({ result: Promise.resolve(value), cancel: vi.fn() });
  const dispose = vi.fn();
  const connect = vi.fn(() => call({ ok: true, value: current }));
  const disconnect = vi.fn(() => call({ ok: true, value: current }));
  const probe = vi.fn(() => call({ ok: true, value: current }));
  const list = vi.fn(() =>
    call<ModelPage>({
      ok: true,
      value: {
        connection: "chatgpt",
        model_list_revision: 1,
        models: [],
        nextCursor: 0,
        hasMore: false,
      },
    }),
  );
  const read = vi.fn(() => call<ConnectionSnapshot>({ ok: true, value: current }));
  if (initialTimeout)
    read.mockImplementationOnce(() => call<ConnectionSnapshot>(failure("timeout")));
  const listeners: (typeof receive)[] = [];
  const subscribe = vi.fn((_id: string, listener: typeof receive) => {
    receive = listener;
    listeners.push(listener);
    return {
      ready: Promise.resolve({
        ok: true,
        value: { subscriptionId: `synthetic-${listeners.length}` },
      }),
      dispose,
    };
  });
  const port = {
    readConnection: read,
    subscribeConnection: subscribe,
    connectConnection: connect,
    disconnectConnection: disconnect,
    probeConnection: probe,
    listConnectionModels: list,
  } as unknown as FoundationPort;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(createElement(ConnectionsPanel, { port, locale, available: true })),
  );
  return {
    container,
    port,
    connect,
    disconnect,
    probe,
    list,
    dispose,
    read,
    subscribe,
    listeners,
    root,
    async event(change: Partial<ConnectionSnapshot> = {}, result?: "listed" | "unreachable") {
      current = { ...current, ...change };
      await act(async () =>
        receive({
          ok: true,
          value: result
            ? { ...current, kind: "probe_result", outcome: result }
            : { ...current, kind: "state" },
        }),
      );
    },
    async click(label: string) {
      const button = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.startsWith(label),
      );
      expect(button).toBeDefined();
      await act(async () => button!.click());
    },
  };
}
it.each(supportedLocales)(
  "renders subscription actions and browser names from the %s catalog",
  async (locale) => {
    const f = await mount({}, locale);
    expect(f.container.textContent).toContain(message(locale, "connection.title"));
    await f.click(message(locale, "connection.signIn", { service: "Synthetic service" }));
    expect(f.connect).toHaveBeenCalledWith("chatgpt", undefined);
    expect(f.container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      message(locale, "connection.browserIcon"),
    );
    expect(f.container.textContent).not.toMatch(/\{(?:service|email)\}/);
  },
);
it.each([
  { state: "disconnected", reason: null },
  { state: "disconnected", reason: "sign_in_timeout" },
  { state: "expired", reason: null },
  { state: "error", reason: "sign_in_rejected" },
] as const)(
  "shows remembered account and secondary registration in $state/$reason",
  async (state) => {
    const f = await mount({ ...state, last_account_email: "one@example.test" });
    expect(f.container.textContent).toContain("Last account: one@example.test");
    await f.click("Sign in as one@example.test");
    expect(f.connect).toHaveBeenLastCalledWith("chatgpt", undefined);
    await f.click("Sign in with another account");
    expect(f.connect).toHaveBeenLastCalledWith("chatgpt", { new_registration: true });
    expect(
      f.container.querySelectorAll(".connection-notice button,.connection-notice a"),
    ).toHaveLength(0);
  },
);
it("keeps Allow plan use primary and hides another-account when there is no saved registration", async () => {
  const f = await mount({ state: "error", reason: "plan_use_not_allowed" });
  expect(f.container.querySelectorAll("button")).toHaveLength(1);
  await f.click("Allow plan use");
  expect(f.connect).toHaveBeenCalledWith("chatgpt", undefined);
  await f.event({ last_account_email: "one@example.test" });
  expect(f.container.textContent).toContain("Last account: one@example.test");
  expect(f.container.querySelectorAll("button")).toHaveLength(2);
});
it("shows the keyring explanation without remembered account controls", async () => {
  const f = await mount({
    state: "error",
    reason: "store_unavailable",
    last_account_email: "unavailable@example.test",
  });
  expect(f.container.textContent).toContain("GNOME Keyring or KWallet");
  expect(f.container.textContent).not.toContain("unavailable@example.test");
  expect(f.container.querySelectorAll("button")).toHaveLength(1);
  expect(f.container.querySelector(".connection-attention svg")).not.toBeNull();
});
it("cancels a browser wait and restores focus when sign-out removes its button", async () => {
  const f = await mount({ state: "connecting", last_account_email: "one@example.test" });
  expect(f.container.textContent).toContain(
    "Finish signing in to Synthetic service in your browser.",
  );
  await f.click("Cancel sign-in");
  expect(f.disconnect).toHaveBeenCalledWith("chatgpt");
  await f.event({ state: "connected" });
  expect(f.container.textContent).toContain("Connected · one@example.test");
  expect(f.container.textContent).not.toContain("Sign in as");
  const signOut = f.container.querySelectorAll("button")[1]!;
  signOut.focus();
  await f.event({ state: "disconnected" });
  expect(document.activeElement?.textContent).toContain("Sign in as one@example.test");
});
it("announces testing and reads all model pages in order, restarting a stale revision", async () => {
  const f = await mount({ state: "connected", last_account_email: "one@example.test" });
  const announcements = f.container.querySelector(".connection-feedback")!;
  expect(announcements.textContent).toBe("");
  expect(announcements.getAttribute("role")).toBe("status");
  await f.click("Test connection");
  expect(f.probe).toHaveBeenCalledWith("chatgpt");
  await f.event({ probing: true, probe_id: "probe" });
  expect(f.container.querySelector('[role="status"]')?.textContent).toContain("Connected");
  expect(f.container.textContent).toContain("Testing the connection with Synthetic service…");
  const call = <T>(value: Outcome<T>) => ({ result: Promise.resolve(value), cancel: vi.fn() });
  f.list.mockImplementationOnce(() => call(staleRevision(2)));
  f.list.mockImplementationOnce(() =>
    call({
      ok: true,
      value: {
        connection: "chatgpt",
        model_list_revision: 2,
        models: [{ id: "first", name: "First" }],
        nextCursor: 1,
        hasMore: true,
      },
    }),
  );
  f.list.mockImplementationOnce(() =>
    call({
      ok: true,
      value: {
        connection: "chatgpt",
        model_list_revision: 2,
        models: [{ id: "second", name: "Second" }],
        nextCursor: 2,
        hasMore: false,
      },
    }),
  );
  await f.event({ probing: false, model_list_revision: 1, model_count: 2 }, "listed");
  expect(f.list.mock.calls).toHaveLength(3);
  expect(f.container.textContent).toContain("Models: First and Second");
  expect(f.container.textContent).toContain("Your Synthetic service sign-in works.");
  expect(f.container.textContent).toContain("The first reply will show it.");
  expect(f.container.querySelectorAll(".connection-info button,.connection-info a")).toHaveLength(
    0,
  );
  await f.event({}, "unreachable");
  expect(f.container.querySelector(".connection-feedback")).toBe(announcements);
  expect(announcements.textContent).toContain("Your sign-in is kept");
});
it("disposes subscriptions and pending model reads on unmount", async () => {
  const f = await mount({ state: "connected" });
  const cancel = vi.fn();
  f.list.mockImplementationOnce(() => ({ result: new Promise(() => {}), cancel }));
  await f.event({ probe_id: "probe", model_list_revision: 1 }, "listed");
  await act(async () => f.root.unmount());
  roots.splice(roots.indexOf(f.root), 1);
  expect(f.dispose).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
});

it("reenables controls after an availability change cancels a pending action", async () => {
  const f = await mount();
  f.connect.mockImplementationOnce(() => ({ result: new Promise(() => {}), cancel: vi.fn() }));
  await f.click("Sign in with Synthetic service");
  expect(f.container.querySelector("button")?.getAttribute("aria-disabled")).toBe("true");
  await act(async () =>
    f.root.render(
      createElement(ConnectionsPanel, { port: f.port, locale: "en-US", available: false }),
    ),
  );
  await act(async () =>
    f.root.render(
      createElement(ConnectionsPanel, { port: f.port, locale: "en-US", available: true }),
    ),
  );
  expect(f.container.querySelector("button")?.getAttribute("aria-disabled")).toBe("false");
});

it("uses the active session email in a connected row and the remembered email after sign-out", async () => {
  const f = await mount({
    state: "connected",
    account_email: "updated@example.test",
    last_account_email: "one@example.test",
  });
  expect(f.container.textContent).toContain("Connected · updated@example.test");
  expect(f.container.textContent).not.toContain("one@example.test");
  await f.event({ state: "disconnected", account_email: null });
  expect(f.container.textContent).toContain("Last account: one@example.test");
});

it("recovers a terminated stream with a fresh subscription and authoritative read", async () => {
  const f = await mount({ state: "connected", account_email: "one@example.test" });
  const obsolete = f.listeners[0]!;
  await act(async () => obsolete(failure("sequence_gap")));
  expect(f.container.querySelector("button")?.getAttribute("aria-disabled")).toBe("true");
  await f.click("Retry");
  expect(f.dispose).toHaveBeenCalledOnce();
  expect(f.subscribe).toHaveBeenCalledTimes(2);
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.container.querySelector("button")?.getAttribute("aria-disabled")).toBe("false");
  await act(async () => obsolete(failure("sequence_gap")));
  expect(f.container.querySelector("button")?.getAttribute("aria-disabled")).toBe("false");
  await f.event({ state: "disconnected", account_email: null });
  expect(f.container.textContent).toContain("Not connected");
  expect(f.connect).not.toHaveBeenCalled();
});

it("retries an initial read timeout even when the eventual disconnected snapshot never changed", async () => {
  const f = await mount({}, "en-US", true);
  expect(f.container.textContent).toContain("Retry");
  f.container.querySelector("button")!.focus();
  await f.click("Retry");
  expect(f.subscribe).toHaveBeenCalledTimes(2);
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.container.textContent).toContain("Not connected");
  expect(document.activeElement?.textContent).toContain("Sign in with Synthetic service");
  expect(f.connect).not.toHaveBeenCalled();
});

it("keeps failed recovery explicitly retryable without a subscription loop", async () => {
  const f = await mount({}, "en-US", true);
  f.read.mockImplementationOnce(() => ({
    result: Promise.resolve(failure("timeout")),
    cancel: vi.fn(),
  }));
  await f.click("Retry");
  expect(f.subscribe).toHaveBeenCalledTimes(2);
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.container.textContent).toContain("Retry");
  await f.click("Retry");
  expect(f.subscribe).toHaveBeenCalledTimes(3);
  expect(f.container.textContent).toContain("Sign in with Synthetic service");
  expect(f.connect).not.toHaveBeenCalled();
});

it("restores focus when a reason-only update removes the other-account action", async () => {
  const f = await mount({
    state: "error",
    reason: "plan_use_not_allowed",
    last_account_email: "one@example.test",
  });
  const another = [...f.container.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("Sign in with another account"),
  )!;
  another.focus();
  await f.event({ reason: "store_unavailable", last_account_email: null });
  expect(another.isConnected).toBe(false);
  expect(document.activeElement).toBe(f.container.querySelector("button"));
  expect(document.activeElement?.textContent).toContain("Sign in with Synthetic service");
});

it("keeps terminal failure visible through a late action reply and a pending recovery read", async () => {
  const f = await mount();
  let actionReply!: (value: Outcome<ConnectionSnapshot>) => void;
  f.connect.mockImplementationOnce(() => ({
    result: new Promise((resolve) => {
      actionReply = resolve;
    }),
    cancel: vi.fn(),
  }));
  await f.click("Sign in with Synthetic service");
  await act(async () => f.listeners[0]!(failure("sequence_gap")));
  await act(async () => actionReply({ ok: true, value: { ...initial, state: "connecting" } }));
  expect(f.container.textContent).toContain("Retry");
  expect(f.container.querySelector("button")?.getAttribute("aria-disabled")).toBe("true");
  let recoveryReply!: (value: Outcome<ConnectionSnapshot>) => void;
  f.read.mockImplementationOnce(() => ({
    result: new Promise((resolve) => {
      recoveryReply = resolve;
    }),
    cancel: vi.fn(),
  }));
  await f.click("Retry");
  expect(f.container.textContent).toContain("Retry");
  expect(f.container.querySelector("button")?.getAttribute("aria-disabled")).toBe("true");
  await act(async () => recoveryReply({ ok: true, value: { ...initial, state: "connecting" } }));
  expect(f.container.textContent).not.toContain("Retry");
  expect(f.container.querySelector("button")?.textContent).toBe("Cancel sign-in");
  await f.event({ state: "connected", account_email: "one@example.test" });
  expect(f.container.textContent).toContain("Connected · one@example.test");
  expect(f.connect).toHaveBeenCalledOnce();
});

it("does not restore stale Retry focus after the researcher moves elsewhere", async () => {
  const f = await mount({}, "en-US", true);
  f.read.mockImplementationOnce(() => ({
    result: Promise.resolve(failure("timeout")),
    cancel: vi.fn(),
  }));
  f.container.querySelector("button")!.focus();
  await f.click("Retry");
  const elsewhere = document.createElement("input");
  document.body.append(elsewhere);
  elsewhere.focus();
  await f.event({ state: "connected", account_email: "one@example.test" });
  expect(document.activeElement).toBe(elsewhere);
  expect(f.container.textContent).toContain("Connected · one@example.test");
});
