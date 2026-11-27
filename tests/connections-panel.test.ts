// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentPreferenceTargets,
  message,
  openaiApiKeyConnection,
  supportedLocales,
  staleRevision,
  failure,
  type FoundationPort,
  type ConnectionSnapshot,
  type ConnectionEvent,
  type Outcome,
  type ModelPage,
  type AgentPreferences,
  type ProviderModelPageInput,
  type ReplaceAgentPreference,
  type ProjectLink,
} from "@ohtia/contracts";
import {
  AgentsSettings,
  FirstModelChoice,
  ModelListRefresh,
  useAgentSettings,
} from "../packages/renderer/src/agents-settings.js";
import { ConnectionsPanel } from "../packages/renderer/src/connections-panel.js";
import { windowConnectionSubscription } from "../packages/renderer/src/connection-subscription.js";
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
  kind: "subscription" | "api_key" = "subscription",
  openLink?: (link: ProjectLink) => void,
) {
  let current = { ...initial, ...snapshot };
  let receive!: (notice: Outcome<ConnectionEvent>) => void;
  const call = <T>(value: Outcome<T>) => ({ result: Promise.resolve(value), cancel: vi.fn() });
  const dispose = vi.fn();
  const connect = vi.fn(() => call({ ok: true, value: current }));
  const replaceKey = vi.fn(() => call({ ok: true, value: current }));
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
    replaceConnectionKey: replaceKey,
    disconnectConnection: disconnect,
    probeConnection: probe,
    listConnectionModels: list,
  } as unknown as FoundationPort;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(ConnectionsPanel, {
        port,
        locale,
        available: true,
        kind,
        connection: current.connection,
        ...(openLink ? { openLink } : {}),
      }),
    ),
  );
  return {
    container,
    port,
    connect,
    replaceKey,
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

it("confirms the first default model inline with the complete stored catalog", async () => {
  const snapshot = {
    ...initial,
    state: "connected" as const,
    model_count: 2,
    model_list_revision: 1,
  };
  let preferences: AgentPreferences = {
    preferences: [],
    lists: [
      {
        connection: "chatgpt",
        kind: "subscription",
        count: 2,
        list_revision: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  const models = [
    { id: "first", name: "First model" },
    { id: "second", name: "Second model" },
  ];
  const call = <T>(value: T) => ({
    result: Promise.resolve({ ok: true as const, value }),
    cancel() {},
  });
  const select = vi.fn(
    (input: ProviderModelPageInput): ReturnType<FoundationPort["listProviderModels"]> =>
      call({
        connection: input.connection,
        list_revision: 1,
        models: [models[input.cursor]!],
        nextCursor: input.cursor + 1,
        hasMore: input.cursor === 0,
      }),
  );
  const replace = vi.fn(
    (
      _operation: string,
      choice: ReplaceAgentPreference,
    ): ReturnType<FoundationPort["replaceAgentPreference"]> => {
      preferences = {
        ...preferences,
        preferences: [
          {
            target: "default",
            revision: 1,
            connection: choice.connection,
            model: choice.model,
            modelName: "First model",
            effort: null,
            inherit: false,
            source: choice.source,
            seedPending: false,
          },
        ],
      };
      return call({ resultId: "019a8000-0000-7000-8000-000000000001" });
    },
  );
  let receiptAvailable = false;
  const port = {
    listAgentPreferences: (operationId?: string) =>
      operationId && !receiptAvailable
        ? { result: Promise.resolve(failure("service_unavailable")), cancel() {} }
        : call(operationId ? { ...preferences, receipt: "not_found" } : preferences),
    listProviderModels: select,
    replaceAgentPreference: replace,
    readConnection: () => call(snapshot),
    subscribeConnection: () => ({
      ready: Promise.resolve({ ok: true, value: { subscriptionId: "test" } }),
      dispose() {},
    }),
  } as unknown as FoundationPort;
  function Host() {
    const settings = useAgentSettings(port, true);
    return createElement(ConnectionsPanel, {
      port,
      available: true,
      locale: "en-US",
      renderAfterState: (value) =>
        createElement(FirstModelChoice, {
          port,
          settings,
          locale: "en-US",
          showConnected: false,
          snapshot: value,
        }),
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const readFailure = failure("storage_failed");
  select.mockImplementationOnce(() => ({ result: Promise.resolve(readFailure), cancel() {} }));
  await act(async () => {
    root.render(createElement(Host));
  });
  const retry = () => container.querySelector<HTMLButtonElement>(".agent-choice-feedback button")!;
  const repeat = Promise.withResolvers<typeof readFailure>();
  select.mockImplementationOnce(() => ({ result: repeat.promise, cancel() {} }));
  await act(async () => {
    retry().focus();
    retry().click();
  });
  expect(document.activeElement).toBe(container.querySelector(".connection-actions button"));
  await act(async () => {
    repeat.resolve(readFailure);
  });
  expect(document.activeElement).toBe(container.querySelector(".connection-actions button"));
  select.mockClear();
  await act(async () => retry().click());
  const group = container.querySelector<HTMLElement>('[role="group"]')!;
  expect(group.querySelector("h4")?.textContent).toBe(
    "Which default model should your agents use?",
  );
  const selector = group.querySelector("select")!;
  expect(document.activeElement).toBe(selector);
  expect([...selector.options].map(({ text }) => text)).toEqual(["First model", "Second model"]);
  expect(selector.value).toBe("first");
  const actions = group.closest(".connection-row")?.querySelector(".connection-actions");
  expect(actions?.textContent).toContain("Test connection");
  expect(group.compareDocumentPosition(actions!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(select.mock.calls.map(([input]) => input.cursor)).toEqual([0, 1]);
  expect(replace).not.toHaveBeenCalled();
  replace.mockImplementationOnce(() => ({
    result: Promise.resolve(failure("uncertain")),
    cancel() {},
  }));
  const submit = group.querySelector("button")!;
  await act(async () => submit.click());
  expect(submit.getAttribute("aria-disabled")).toBe("true");
  await act(async () => submit.click());
  expect(replace).toHaveBeenCalledOnce();
  receiptAvailable = true;
  const button = (label: string) =>
    [...group.querySelectorAll("button")].find((node) => node.textContent === label)!;
  await act(async () => button("Check").click());
  await act(async () => button("Try again").click());
  expect(replace).toHaveBeenCalledTimes(2);
  expect(replace).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({
      connection: "chatgpt",
      model: "first",
      source: "first_connection",
    }),
  );
  expect(container.querySelector('[role="group"]')).toBeNull();
});

it("shows the OpenAI catalog date and refreshes account age on both settings surfaces", async () => {
  const { id: connection, displayName } = openaiApiKeyConnection;
  const updatedAt = "2026-11-22T12:00:00.000Z";
  const snapshot = {
    ...initial,
    connection,
    display_name: displayName,
    state: "connected" as const,
    model_count: 1,
    model_list_revision: 1,
  };
  const result = <T>(value: T) => ({
    result: Promise.resolve({ ok: true as const, value }),
    cancel() {},
  });
  const port = {
    listAgentPreferences: () =>
      result({
        preferences: [],
        lists: [{ connection, kind: "api_key", count: 1, list_revision: 1, updatedAt }],
      }),
    listProviderModels: () =>
      result({
        connection,
        list_revision: 1,
        nextCursor: 1,
        hasMore: false,
        models: [{ id: "gpt-6-astra", name: "GPT-6 Astra", origin: "catalog" }],
      }),
  } as unknown as FoundationPort;
  function Host() {
    const settings = useAgentSettings(port, true);
    return createElement(
      "div",
      null,
      createElement(FirstModelChoice, {
        port,
        settings,
        snapshot,
        locale: "en-GB",
        showConnected: false,
      }),
      createElement(ModelListRefresh, {
        port,
        settings,
        locale: "en-GB",
        service: openaiApiKeyConnection,
        snapshot,
      }),
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(updatedAt));
    await act(async () => root.render(createElement(Host)));
    const selector = container.querySelector("select")!;
    expect(selector.value).toBe("gpt-6-astra");
    const description = document.getElementById(selector.getAttribute("aria-describedby")!);
    expect(description?.textContent).toContain("Models Ohtia hasn’t checked yet aren’t listed.");
    const source =
      "Model details from Ohtia’s catalog (checked 9 Nov 2026). Availability from your OpenAI account, updated ";
    const origins = [...container.querySelectorAll("p")].filter((line) =>
      line.textContent?.startsWith(source),
    );
    expect(origins).toHaveLength(2);
    expect(description?.contains(origins[0]!)).toBe(true);
    const previous = origins[0]?.textContent;
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(origins[0]?.textContent).not.toBe(previous);
    expect(origins.map((line) => line.textContent?.slice(source.length))).toEqual([
      expect.stringContaining("2 min"),
      expect.stringContaining("2 min"),
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("shares and recovers the window connection stream across observers", async () => {
  const listeners: ((result: Outcome<ConnectionEvent>) => void)[] = [];
  const dispose = vi.fn();
  const upstream = vi.fn(
    (_connection: string, listener: (result: Outcome<ConnectionEvent>) => void) => {
      listeners.push(listener);
      return {
        ready: Promise.resolve({ ok: true as const, value: { subscriptionId: "window" } }),
        dispose,
      };
    },
  );
  const subscribe = windowConnectionSubscription({
    subscribeConnection: upstream,
  } as unknown as FoundationPort);
  const panel = vi.fn();
  const conversation = vi.fn();
  const first = subscribe("chatgpt", panel);
  const second = subscribe("chatgpt", conversation);
  expect(upstream).toHaveBeenCalledOnce();
  expect(upstream).toHaveBeenCalledWith("*", expect.any(Function));
  await first.ready;
  listeners[0]!(failure("sequence_gap"));
  expect(panel).toHaveBeenCalledWith(failure("sequence_gap"));
  expect(conversation).toHaveBeenCalledWith(failure("sequence_gap"));
  first.dispose();
  const retry = subscribe("chatgpt", panel);
  await retry.ready;
  expect(upstream).toHaveBeenCalledTimes(2);
  const update = { ok: true as const, value: { ...initial, kind: "state" as const } };
  listeners[1]!(update);
  expect(panel).toHaveBeenLastCalledWith(update);
  expect(conversation).toHaveBeenLastCalledWith(update);
  second.dispose();
  retry.dispose();
  expect(dispose).toHaveBeenCalledTimes(2);
});

it("waits for a model choice before changing the service for an agent", async () => {
  const services = [
    { id: "chatgpt", displayName: "ChatGPT", kind: "subscription", usageUrl: null },
    { id: "anthropic", displayName: "Anthropic", kind: "api_key", usageUrl: null },
  ] as const;
  const snapshots = {
    chatgpt: {
      ...initial,
      display_name: "ChatGPT",
      state: "connected" as const,
      account_email: "researcher@example.org",
      model_list_revision: 1,
      model_count: 1,
    },
    anthropic: {
      ...initial,
      connection: "anthropic",
      display_name: "Anthropic",
      state: "connected" as const,
      model_list_revision: 1,
      model_count: 1,
    },
  };
  const defaultChoice = {
    target: "default",
    revision: 1,
    connection: "chatgpt",
    model: "first",
    modelName: "First model",
    effort: null,
    inherit: false,
    source: "researcher",
    seedPending: false,
  } as const;
  const listDate = "2026-01-01T00:00:00.000Z";
  let preferences: AgentPreferences = {
    preferences: [defaultChoice],
    lists: services.map(({ id, kind }) => ({
      connection: id,
      kind,
      count: 1,
      list_revision: 1,
      updatedAt: listDate,
    })),
  };
  const call = <T>(value: T) => ({
    result: Promise.resolve({ ok: true as const, value }),
    cancel() {},
  });
  const acknowledgement = Promise.withResolvers<{ ok: true; value: { resultId: string } }>();
  const replace = vi.fn(
    (
      _operation: string,
      choice: ReplaceAgentPreference,
    ): ReturnType<FoundationPort["replaceAgentPreference"]> => {
      preferences = {
        ...preferences,
        preferences: [
          defaultChoice,
          {
            ...choice,
            revision: choice.expectedRevision + 1,
            modelName: choice.inherit
              ? null
              : choice.model === "basic"
                ? "Basic model"
                : "Other model",
            seedPending: false,
          },
        ],
      };
      return { result: acknowledgement.promise, cancel() {} };
    },
  );
  const listAgentPreferences = vi.fn((): ReturnType<FoundationPort["listAgentPreferences"]> =>
    call(preferences),
  );
  const pendingRead = Promise.withResolvers<Outcome<AgentPreferences>>();
  const changedRead = Promise.withResolvers<Outcome<AgentPreferences>>();
  type Target = ReplaceAgentPreference["target"];
  let notify: ((target?: Target, revision?: number) => void) | undefined;
  const observe = (listener: NonNullable<typeof notify>) => {
    notify = (target, revision) => {
      const row = preferences.preferences.find((item) => item.target === target);
      listener(target, revision ?? row?.revision);
    };
    return () => {
      notify = undefined;
    };
  };
  const probe = vi.fn((connection: string) =>
    connection === "anthropic"
      ? call(snapshots.anthropic)
      : { result: Promise.resolve(failure("service_unavailable")), cancel() {} },
  );
  const port = {
    listAgentPreferences,
    replaceAgentPreference: replace,
    listProviderModels: (input: ProviderModelPageInput) => {
      if (input.connection === "anthropic" && input.list_revision === 1)
        return { result: Promise.resolve(staleRevision(2)), cancel() {} };
      const models =
        input.connection === "chatgpt"
          ? [{ id: "first", name: "First model", effortSupport: "unknown" }]
          : [
              {
                id: "other",
                name: "Other model",
                effortSupport: "supported",
                effortLevels: [{ name: "high", supported: true }],
              },
              { id: "basic", name: "Basic model", effortSupport: "unsupported" },
              {
                id: "supported",
                name: "Supported model",
                effortSupport: "supported",
                effortLevels: [{ name: "high", supported: true }],
              },
            ];
      return call({
        connection: input.connection,
        list_revision: input.list_revision,
        nextCursor: models.length,
        hasMore: false,
        models,
      });
    },
    probeConnection: probe,
    subscribeConnection: () => ({
      ready: Promise.resolve({ ok: true, value: { subscriptionId: "test" } }),
      dispose() {},
    }),
  } as unknown as FoundationPort;
  function Host({
    probeResults,
  }: {
    probeResults?: Record<string, Extract<ConnectionEvent, { kind: "probe_result" }>>;
  }) {
    const settings = useAgentSettings(port, true, observe);
    return createElement(
      "div",
      null,
      createElement(AgentsSettings, {
        port,
        settings,
        locale: "en-US",
        connections: services,
        snapshots,
        recoveryFocusId: "agents-page",
      }),
      ...services.map((service) =>
        createElement(ModelListRefresh, {
          key: service.id,
          port,
          settings,
          locale: "en-US",
          service,
          snapshot: snapshots[service.id],
          probeResult: probeResults?.[service.id],
        }),
      ),
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(Host));
  });
  const josefa = container.querySelector<HTMLElement>('[data-agent-row="josefa"]')!;
  const summary = () => josefa.querySelector(".agent-summary")?.textContent;
  expect(summary()).toBe("Default · ChatGPT · First model");
  const change = josefa.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  expect(change.textContent).toBe("Change");
  expect(change.getAttribute("aria-label")).toBe("Change model for Josefa");
  expect(change.getAttribute("aria-expanded")).toBe("false");
  const choices = document.getElementById(change.getAttribute("aria-controls")!)!;
  expect(choices.hidden).toBe(true);
  await act(async () => {
    change.focus();
    change.click();
  });
  expect(change.getAttribute("aria-expanded")).toBe("true");
  expect(choices.hidden).toBe(false);
  expect(document.activeElement).toBe(change);
  const [service, model, effort] = [...josefa.querySelectorAll("select")];
  expect(model!.selectedOptions[0]?.textContent).toBe("Default · ChatGPT · First model");
  expect(effort!.disabled).toBe(true);
  await act(async () => {
    service!.value = "anthropic";
    service!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(model!.selectedOptions[0]?.textContent).toBe("Choose a model");
  expect(josefa.textContent).toContain("Choose a model first.");
  expect(replace).not.toHaveBeenCalled();
  await act(async () => {
    model!.value = "other";
    model!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(replace).toHaveBeenCalledExactlyOnceWith(
    expect.any(String),
    expect.objectContaining({
      target: "josefa",
      connection: "anthropic",
      model: "other",
      inherit: false,
    }),
  );
  expect(model!.selectedOptions[0]?.textContent).toBe("Other model");
  expect(model!.getAttribute("aria-disabled")).toBe("true");
  const read = (result: Promise<Outcome<AgentPreferences>>) => ({
    result,
    cancel() {},
  });
  listAgentPreferences
    .mockImplementationOnce(() => read(pendingRead.promise))
    .mockImplementationOnce(() => read(changedRead.promise));
  await act(async () => {
    acknowledgement.resolve({
      ok: true,
      value: { resultId: "019a8000-0000-7000-8000-000000000001" },
    });
  });
  await act(async () => {
    notify?.("josefa");
  });
  await act(async () => {
    pendingRead.resolve({ ok: true, value: preferences });
  });
  expect(model!.selectedOptions[0]?.textContent).toBe("Other model");
  expect(model!.getAttribute("aria-disabled")).toBe("true");
  await act(async () => {
    changedRead.resolve({ ok: true, value: preferences });
  });
  expect(summary()).toBe("Anthropic · API key · Other model");
  expect(model!.getAttribute("aria-disabled")).toBeNull();
  expect(effort!.disabled).toBe(false);
  expect([...effort!.options].map(({ text }) => text)).toEqual(["Model default", "high"]);

  listAgentPreferences.mockImplementationOnce(() => ({
    result: Promise.resolve(failure("service_unavailable")),
    cancel() {},
  }));
  await act(async () => {
    effort!.value = "high";
    effort!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(replace).toHaveBeenCalledTimes(2);
  expect(effort!.value).toBe("high");
  expect(effort!.getAttribute("aria-disabled")).toBe("true");
  expect(josefa.textContent).toContain("Saved");
  expect(josefa.textContent).not.toContain("not yet known");
  const retryRead = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  const beforeReset = preferences.preferences.find(({ target }) => target === "josefa")!;
  preferences = {
    ...preferences,
    preferences: [
      defaultChoice,
      { ...beforeReset, revision: beforeReset.revision + 1, effort: null },
    ],
  };
  await act(async () => retryRead!.click());
  expect(effort!.getAttribute("aria-disabled")).toBeNull();
  expect(effort!.value).toBe("");
  expect(josefa.textContent).not.toContain("Another window changed Effort for Josefa");
  expect(replace).toHaveBeenCalledTimes(2);
  await act(async () => {
    effort!.value = "high";
    effort!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(effort!.value).toBe("high");

  await act(async () => {
    model!.value = "basic";
    model!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(replace).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({
      model: "basic",
      effort: null,
    }),
  );
  expect(effort!.disabled).toBe(true);
  expect(josefa.textContent).toContain("This model doesn’t support effort levels.");

  const refresh = (name: string) =>
    [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Refresh " + name + " model list"),
    )!;
  await act(async () => refresh("ChatGPT").click());
  expect(probe).toHaveBeenCalledWith("chatgpt");
  expect(container.textContent).toContain(
    "Ohtia couldn’t update the model list. Your choices are kept.",
  );
  await act(async () => refresh("Anthropic").click());
  expect(probe).toHaveBeenCalledWith("anthropic");
  expect(container.textContent).toContain("Updating the model list from Anthropic…");
  expect(refresh("Anthropic").getAttribute("aria-disabled")).toBe("true");
  await act(async () => {
    root.render(
      createElement(Host, {
        probeResults: {
          anthropic: { ...snapshots.anthropic, kind: "probe_result", outcome: "listed" },
        },
      }),
    );
  });
  expect(refresh("Anthropic").getAttribute("aria-disabled")).toBeNull();
  expect(model!.value).toBe("basic");

  const chooseModel = (choice: string) =>
    act(async () => {
      model!.value = choice;
      model!.dispatchEvent(new Event("change", { bubbles: true }));
    });
  const chooseAction = (label: string) =>
    [...josefa.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;
  replace.mockImplementationOnce(() => ({
    result: Promise.resolve(failure("record_not_found")),
    cancel() {},
  }));
  await chooseModel(":default");
  expect(model!.value).toBe("basic");
  expect(josefa.querySelector('[role="alert"]')?.textContent).toContain("Basic model");
  await act(async () => chooseAction("Try again").click());
  expect(model!.selectedOptions[0]?.textContent).toBe("Default · ChatGPT · First model");
  expect(replace).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({
      model: null,
      connection: null,
      inherit: true,
    }),
  );

  replace.mockImplementationOnce(() => ({
    result: Promise.resolve(staleRevision(5)),
    cancel() {},
  }));
  await chooseModel("first");
  expect(josefa.textContent).toContain("Another window saved Model for Josefa meanwhile.");
  await act(async () => chooseAction("Choose again").click());
  expect(document.activeElement).toBe(model);
  expect(model!.value).toBe(":default");

  const own = preferences.preferences.find((row) => row.target === "josefa")!;
  preferences = {
    ...preferences,
    preferences: [
      defaultChoice,
      {
        ...own,
        revision: own.revision + 1,
        model: "basic",
        modelName: "Basic model",
        inherit: false,
        connection: "anthropic",
      },
    ],
  };
  await act(async () => {
    notify?.("josefa");
  });
  expect(josefa.textContent).toContain(
    "Another window changed Service for Josefa to Anthropic · API key.",
  );
  expect(model!.value).toBe("basic");

  const currentRead = Promise.withResolvers<Outcome<AgentPreferences>>();
  listAgentPreferences.mockImplementationOnce(() => read(currentRead.promise));
  await chooseModel("other");
  const savedLocally = preferences.preferences.find((row) => row.target === "josefa")!;
  preferences = {
    ...preferences,
    preferences: [
      defaultChoice,
      { ...savedLocally, revision: savedLocally.revision + 1, effort: "high" },
    ],
  };
  await act(async () => {
    notify?.("josefa");
  });
  expect(josefa.textContent).toContain("Another window changed Effort for Josefa to high.");
  await act(async () => {
    currentRead.resolve({ ok: true, value: preferences });
  });
  const reported = preferences.preferences.find(({ target }) => target === "josefa")!;
  preferences = {
    ...preferences,
    preferences: [defaultChoice, { ...reported, revision: reported.revision + 1, effort: null }],
  };
  await act(async () => {
    notify?.();
  });
  expect(josefa.textContent).not.toContain("Another window changed Effort for Josefa");

  const updateFromWindow = async (next: Partial<AgentPreferences["preferences"][number]>) => {
    const row = preferences.preferences.find(({ target }) => target === "josefa")!;
    preferences = {
      ...preferences,
      preferences: [defaultChoice, { ...row, ...next, revision: row.revision + 1 }],
    };
    await act(async () => {
      notify?.("josefa");
    });
  };
  await updateFromWindow({
    inherit: true,
    connection: null,
    model: null,
    modelName: null,
    effort: null,
  });
  await updateFromWindow({
    inherit: false,
    connection: "chatgpt",
    model: "first",
    modelName: "First model",
  });
  expect(josefa.textContent).toContain("Another window changed Model for Josefa to First model.");
  await updateFromWindow({ inherit: true, connection: null, model: null, modelName: null });
  expect(josefa.textContent).toContain(
    "Another window changed Model for Josefa to Default · ChatGPT · First model.",
  );

  const delayedDefault = Promise.withResolvers<Outcome<AgentPreferences>>();
  listAgentPreferences.mockImplementationOnce(() => read(delayedDefault.promise));
  const old = preferences;
  await act(async () => {
    notify?.("default", 2);
  });
  const inherited = preferences.preferences.find(({ target }) => target === "josefa")!;
  preferences = {
    ...preferences,
    preferences: [
      { ...defaultChoice, revision: 2, model: "other-default", modelName: "New default" },
      {
        ...inherited,
        revision: inherited.revision + 1,
        connection: "chatgpt",
        model: "first",
        modelName: "First model",
        inherit: false,
      },
    ],
  };
  await act(async () => {
    notify?.("josefa");
  });
  expect(container.textContent).toContain(
    "Another window changed Default model to ChatGPT · New default.",
  );
  expect(josefa.textContent).toContain("Another window changed Model for Josefa to First model.");
  await act(async () => {
    delayedDefault.resolve({ ok: true, value: old });
  });
  expect(container.textContent).toContain(
    "Another window changed Default model to ChatGPT · New default.",
  );

  const agent = preferences.preferences.find(({ target }) => target === "josefa")!;
  const newDefault = {
    ...defaultChoice,
    revision: 3,
    connection: "anthropic",
    model: "other",
    modelName: "Other model",
  };
  const inheriting = {
    ...agent,
    revision: agent.revision + 1,
    connection: null,
    model: null,
    modelName: null,
    inherit: true,
    effort: null,
  };
  preferences = { ...preferences, preferences: [newDefault, inheriting] };
  await act(async () => {
    notify?.();
  });
  preferences = {
    ...preferences,
    preferences: [
      { ...newDefault, revision: 4, model: "supported", modelName: "Supported model" },
      { ...inheriting, revision: inheriting.revision + 1, effort: "high" },
    ],
  };
  await act(async () => {
    notify?.("josefa");
  });
  expect(josefa.textContent).toContain("Another window changed Effort for Josefa to high.");
  expect(josefa.textContent).not.toContain(
    "Another window changed Model for Josefa to Default · Anthropic · Supported model.",
  );
  const last = preferences.preferences.find(({ target }) => target === "josefa")!;
  const announced = last.revision + 1;
  preferences = {
    ...preferences,
    preferences: [preferences.preferences[0]!, { ...last, revision: announced + 1, effort: null }],
  };
  await act(async () => {
    notify?.("josefa", announced);
  });
  expect(josefa.textContent).not.toContain("Another window changed Effort for Josefa");

  const ownModel = {
    ...last,
    revision: announced + 2,
    connection: "chatgpt",
    model: "first",
    modelName: "First model",
    inherit: false,
    effort: null,
  };
  preferences = { ...preferences, preferences: [ownModel] };
  await act(async () => {
    notify?.();
  });
  preferences = {
    ...preferences,
    preferences: [
      {
        ...ownModel,
        revision: ownModel.revision + 1,
        connection: null,
        model: null,
        modelName: null,
        inherit: true,
      },
    ],
  };
  await act(async () => {
    notify?.("josefa", ownModel.revision + 1);
  });
  expect(josefa.textContent).toContain(
    "Another window changed Model for Josefa to Use the default.",
  );
});

it("clears an API key on Escape and sends the masked value only on form submit", async () => {
  const f = await mount({ connection: "anthropic_api_key" }, "en-US", false, "api_key");
  const add = "Add Synthetic service API key";
  await f.click(add);
  const field = f.container.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(document.activeElement).toBe(field);
  expect(f.container.textContent).not.toContain(add);
  field.value = "synthetic-discard";
  await act(async () =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );
  expect(field.value).toBe("");
  expect(f.connect).not.toHaveBeenCalled();
  expect(document.activeElement?.textContent).toBe(add);
  await f.click(add);
  const key = f.container.querySelector<HTMLInputElement>('input[type="password"]')!;
  key.value = "synthetic-submit";
  const feedback = f.container.querySelector(".connection-feedback")!;
  const actions = key.closest(".connection-actions")!;
  f.connect.mockReturnValueOnce({
    result: Promise.resolve({
      ok: true,
      value: {
        ...initial,
        connection: "anthropic_api_key",
        state: "connecting",
        checking_key: true,
      },
    }),
    cancel: vi.fn(),
  });
  await act(async () => key.form!.requestSubmit());
  expect(f.connect).toHaveBeenCalledExactlyOnceWith("anthropic_api_key", {
    key: "synthetic-submit",
  });
  expect(key.value).toBe("");
  expect(f.container.querySelector('input[type="password"]')).toBeNull();
  expect(f.container.querySelector(".connection-feedback")).toBe(feedback);
  expect(feedback.getAttribute("role")).toBe("status");
  expect(feedback.textContent).toContain("Checking the key with Synthetic service…");
  expect(document.activeElement).toBe(actions);
  await f.event({ state: "disconnected", checking_key: false, reason: "key_not_permitted" });
  expect(feedback.textContent).not.toContain("Checking the key");
  expect(document.activeElement?.textContent).toBe(add);
  expect(f.container.querySelector('[role="alert"]')?.textContent).toContain(
    "Synthetic service didn’t let this key see its models.",
  );
});
it("keeps focus outside the key-entry row when a check finishes", async () => {
  const f = await mount({ connection: "anthropic_api_key" }, "en-US", false, "api_key");
  const outside = document.createElement("button");
  outside.textContent = "Outside Settings";
  document.body.append(outside);
  await f.click("Add Synthetic service API key");
  const key = f.container.querySelector<HTMLInputElement>('input[type="password"]')!;
  key.value = "synthetic-submit";
  f.connect.mockReturnValueOnce({
    result: Promise.resolve({
      ok: true,
      value: {
        ...initial,
        connection: "anthropic_api_key",
        state: "connecting",
        checking_key: true,
      },
    }),
    cancel: vi.fn(),
  });
  await act(async () => key.form!.requestSubmit());
  outside.focus();
  await f.event({ state: "disconnected", checking_key: false, reason: "key_rejected" });
  expect(f.container.querySelector('[role="alert"]')?.textContent).toContain("rejected this key");
  expect(document.activeElement).toBe(outside);

  await f.event({ state: "connected", reason: null });
  const test = [...f.container.querySelectorAll("button")].find(
    (button) => button.textContent === "Test connection",
  )!;
  test.focus();
  await f.event({ state: "expired" });
  expect(f.container.textContent).toContain("Synthetic service no longer accepts this key.");
  expect(document.activeElement?.textContent).toBe("Replace key");

  await f.event({ state: "connected" });
  await f.click("Replace key");
  const openField = f.container.querySelector<HTMLInputElement>('input[type="password"]')!;
  openField.value = "synthetic-unsent";
  await f.event({ state: "expired" });
  expect(document.activeElement).toBe(openField);
  expect(openField.value).toBe("synthetic-unsent");
  outside.focus();
  await f.event({ state: "connected" });
  expect(document.activeElement).toBe(outside);
  expect(f.replaceKey).not.toHaveBeenCalled();
});
it.each(["anthropic_api_key", "openai_api_key"])(
  "keeps %s disconnect confirmation inline and places initial focus on Keep connection",
  async (connection) => {
    const f = await mount(
      {
        connection,
        state: "connected",
        connected_at: "2026-11-22T10:00:00.000Z",
      },
      "en-US",
      false,
      "api_key",
    );
    expect(f.container.textContent).toContain(
      "Synthetic service · API key · Connected Nov 22, 2026",
    );
    await f.click("Disconnect Synthetic service");
    const group = f.container.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-labelledby")).toBeTruthy();
    expect(group.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Keep connection");
    expect(f.container.querySelector("dialog")).toBeNull();
    await f.click("Keep connection");
    expect(f.disconnect).not.toHaveBeenCalled();
    await f.click("Replace key");
    const field = f.container.querySelector<HTMLInputElement>('input[type="password"]')!;
    field.value = "synthetic-replacement";
    await act(async () => field.form!.requestSubmit());
    expect(f.replaceKey).toHaveBeenCalledExactlyOnceWith(connection, "synthetic-replacement");
    expect(field.value).toBe("");
    await f.click("Disconnect Synthetic service");
    await f.click("Disconnect Synthetic service");
    expect(f.disconnect).toHaveBeenCalledExactlyOnceWith(connection);
  },
);

describe("OpenRouter group", () => {
  const openrouter = { connection: "openrouter", display_name: "OpenRouter" } as const;
  it.each([
    ["disconnected", {}],
    ["connected", { state: "connected", connected_at: "2026-11-26T10:00:00.000Z" }],
    ["expired", { state: "expired" }],
  ] as const)("shows the privacy line and its four links when %s", async (_state, snapshot) => {
    const openLink = vi.fn();
    const f = await mount({ ...openrouter, ...snapshot }, "en-US", false, "api_key", openLink);
    const line = f.container.querySelector(".connection-privacy")!;
    expect(line.querySelector("p")?.textContent).toBe(
      "OpenRouter applies the privacy settings, guardrails, plugins and observability destinations of the account and workspace this key belongs to. They decide which models and providers receive your messages, what OpenRouter adds to them or removes from them, and where it sends copies.",
    );
    const links = [...line.querySelectorAll("a")];
    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute("href")])).toEqual([
      ["OpenRouter privacy settings", "https://openrouter.ai/settings/privacy"],
      ["OpenRouter plugins", "https://openrouter.ai/settings/plugins"],
      ["OpenRouter observability", "https://openrouter.ai/settings/observability"],
      ["Check usage", "https://openrouter.ai/settings/credits"],
    ]);
    for (const link of links)
      expect(link.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
        "opens in your browser",
      );
    await act(async () => {
      for (const link of links) link.click();
    });
    expect(openLink.mock.calls).toEqual([
      ["openrouterPrivacy"],
      ["openrouterPlugins"],
      ["openrouterObservability"],
      ["openrouterUsage"],
    ]);
  });

  it("shows the expiry beside the connection date in the interface locale", async () => {
    const connected = {
      ...openrouter,
      state: "connected",
      connected_at: "2026-11-26T10:00:00.000Z",
      expires_at: "2026-12-03T10:00:00.000Z",
    } as const;
    const english = await mount(connected, "en-US", false, "api_key");
    expect(english.container.querySelector(".connection-state")?.textContent).toBe(
      "OpenRouter · API key · Connected Nov 26, 2026 · Expires Dec 3, 2026",
    );
    const german = await mount(connected, "de-DE", false, "api_key");
    expect(german.container.querySelector(".connection-state")?.textContent).toBe(
      "OpenRouter · API-Schlüssel · Verbunden seit 26.11.2026 · Läuft ab am 03.12.2026",
    );
  });

  it("shows no privacy line for the other services", async () => {
    for (const connection of ["chatgpt", "anthropic_api_key", "openai_api_key"]) {
      const f = await mount(
        { connection },
        "en-US",
        false,
        connection === "chatgpt" ? "subscription" : "api_key",
      );
      expect(f.container.querySelector(".connection-privacy")).toBeNull();
    }
  });
});

it("offers no connected service that sends no request in an agent's Service select", async () => {
  const call = <T>(value: T) => ({
    result: Promise.resolve({ ok: true as const, value }),
    cancel() {},
  });
  const services = [
    { id: "chatgpt", displayName: "ChatGPT", kind: "subscription", usageUrl: null },
    {
      id: "openrouter",
      displayName: "OpenRouter",
      kind: "api_key",
      usageUrl: "https://openrouter.ai/settings/credits",
    },
  ] as const;
  const snapshots = Object.fromEntries(
    services.map(({ id, displayName }) => [
      id,
      { ...initial, connection: id, display_name: displayName, state: "connected" as const },
    ]),
  );
  const preferences: AgentPreferences = {
    preferences: agentPreferenceTargets.map((target) => ({
      target,
      revision: 1,
      connection: null,
      model: null,
      modelName: null,
      effort: null,
      inherit: target !== "default",
      source: "researcher",
      seedPending: false,
    })),
    lists: [],
  };
  const port = {
    listAgentPreferences: () => call(preferences),
    replaceAgentPreference: () => ({
      result: Promise.resolve(failure("storage_failed")),
      cancel() {},
    }),
  } as unknown as FoundationPort;
  const observe = () => () => {};
  function Host() {
    const settings = useAgentSettings(port, true, observe);
    return createElement(AgentsSettings, {
      port,
      settings,
      locale: "en-US",
      connections: services,
      snapshots,
      recoveryFocusId: "agents-page",
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(createElement(Host)));
  const select = container.querySelector<HTMLSelectElement>('[data-agent-service="default"]')!;
  expect([...select.options].map((option) => option.value)).toEqual(["", "chatgpt"]);
});

describe("agent rows in Settings › Agents", () => {
  const call = <T>(value: T) => ({
    result: Promise.resolve({ ok: true as const, value }),
    cancel() {},
  });
  const services = [
    { id: "chatgpt", displayName: "ChatGPT", kind: "subscription", usageUrl: null },
    { id: "anthropic", displayName: "Anthropic", kind: "api_key", usageUrl: null },
  ] as const;
  const connected = (connection: string, display_name: string) => ({
    ...initial,
    connection,
    display_name,
    state: "connected" as const,
    account_email: connection === "chatgpt" ? "researcher@example.org" : null,
    model_list_revision: 1,
    model_count: 1,
  });
  const snapshots = {
    chatgpt: connected("chatgpt", "ChatGPT"),
    anthropic: connected("anthropic", "Anthropic"),
  };
  const row = (target: AgentPreferences["preferences"][number]["target"], fields: object) =>
    ({
      target,
      revision: 1,
      connection: null,
      model: null,
      modelName: null,
      effort: null,
      inherit: true,
      source: "researcher",
      seedPending: false,
      ...fields,
    }) as AgentPreferences["preferences"][number];
  const defaultRow = row("default", {
    connection: "chatgpt",
    model: "first",
    modelName: "First model",
    inherit: false,
  });
  function render(
    initialPreferences: AgentPreferences["preferences"],
    options: {
      openAgent?: "virgilio" | "josefa" | { current: "virgilio" | "josefa" | undefined };
      replace?: FoundationPort["replaceAgentPreference"];
    } = {},
  ) {
    let preferences: AgentPreferences = {
      preferences: initialPreferences,
      lists: services.map(({ id, kind }) => ({
        connection: id,
        kind,
        count: 1,
        list_revision: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
    };
    let notify: ((target?: string, revision?: number) => void) | undefined;
    // A stable observer, like the window's research subscription, keeps the hook's effect still.
    const observe = (listener: (target?: never, revision?: number) => void) => {
      notify = listener as (target?: string, revision?: number) => void;
      return () => {
        notify = undefined;
      };
    };
    const port = {
      listAgentPreferences: () => call(preferences),
      replaceAgentPreference:
        options.replace ??
        (() => ({ result: Promise.resolve(failure("storage_failed")), cancel() {} })),
      listProviderModels: (input: ProviderModelPageInput) => {
        const models =
          input.connection === "chatgpt"
            ? [{ id: "first", name: "First model", effortSupport: "unknown" }]
            : [
                {
                  id: "opus",
                  name: "Claude Opus 5.5",
                  effortSupport: "supported",
                  effortLevels: [{ name: "high", supported: true }],
                },
              ];
        return call({
          connection: input.connection,
          list_revision: input.list_revision,
          nextCursor: models.length,
          hasMore: false,
          models,
        });
      },
    } as unknown as FoundationPort;
    function Host({ open }: { open: boolean }) {
      const settings = useAgentSettings(port, true, observe);
      return open
        ? createElement(AgentsSettings, {
            port,
            settings,
            locale: "en-US",
            connections: services,
            snapshots,
            recoveryFocusId: "agents-page",
            openAgent:
              typeof options.openAgent === "object" ? options.openAgent.current : options.openAgent,
          })
        : null;
    }
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    roots.push(root);
    return {
      container,
      mount: (open = true) => act(async () => root.render(createElement(Host, { open }))),
      update: async (next: AgentPreferences["preferences"], target?: string) => {
        preferences = { ...preferences, preferences: next };
        const revision = next.find((item) => item.target === target)?.revision;
        await act(async () => notify?.(target, revision));
      },
      agent: (target: string) => {
        const element = container.querySelector<HTMLElement>(`[data-agent-row="${target}"]`)!;
        const button = element.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
        return {
          element,
          button,
          summary: () => element.querySelector(".agent-summary")?.textContent,
          choices: () => document.getElementById(button.getAttribute("aria-controls")!)!,
        };
      },
    };
  }

  it("keeps the default open and lists each agent once, in order, as a closed summary row", async () => {
    const t = render([
      defaultRow,
      row("josefa", {
        connection: "anthropic",
        model: "opus",
        modelName: "Claude Opus 5.5",
        effort: "high",
        inherit: false,
      }),
    ]);
    await t.mount();
    const rows = [...t.container.querySelectorAll<HTMLElement>("[data-agent-row]")];
    expect(rows.map((element) => element.dataset.agentRow)).toEqual(
      agentPreferenceTargets.filter((target) => target !== "default"),
    );
    expect(t.container.querySelector(".agent-rows > h3")?.textContent).toBe("Each agent");
    const defaults = t.container.querySelector<HTMLElement>(".agent-settings > .agent-choice")!;
    expect(defaults.querySelector("h3")?.textContent).toBe("Default model");
    expect(defaults.querySelectorAll("select")).toHaveLength(3);
    expect(defaults.querySelector("button[aria-expanded]")).toBeNull();
    const virgilio = t.agent("virgilio");
    expect(virgilio.element.querySelector(".voice-label svg")).not.toBeNull();
    expect(virgilio.summary()).toBe("Default · ChatGPT · First model");
    expect(virgilio.button.getAttribute("aria-expanded")).toBe("false");
    expect(virgilio.choices().hidden).toBe(true);
    expect(t.agent("josefa").summary()).toBe("Anthropic · API key · Claude Opus 5.5 · high");
    await act(async () => {
      virgilio.button.focus();
      virgilio.button.click();
    });
    expect(virgilio.button.getAttribute("aria-expanded")).toBe("true");
    expect(t.agent("josefa").button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      virgilio.button.click();
    });
    expect(virgilio.button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(virgilio.button);
    await act(async () => {
      virgilio.button.click();
    });
    await t.mount(false);
    await t.mount(true);
    expect(t.agent("virgilio").button.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a row without a usable model open until the researcher closes it after a choice", async () => {
    const t = render([row("default", {}), row("josefa", {})]);
    await t.mount();
    const josefa = t.agent("josefa");
    expect(josefa.summary()).toBe("Choose a model");
    expect(josefa.button.getAttribute("aria-expanded")).toBe("true");
    expect(josefa.button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      josefa.button.click();
    });
    expect(josefa.button.getAttribute("aria-expanded")).toBe("true");
    await t.update([defaultRow, row("josefa", { revision: 2 })]);
    expect(josefa.summary()).toBe("Default · ChatGPT · First model");
    expect(josefa.button.getAttribute("aria-disabled")).toBeNull();
    expect(josefa.button.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      josefa.button.click();
    });
    expect(josefa.button.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a row whose save was rejected and keeps it open", async () => {
    const t = render([defaultRow, row("josefa", {})]);
    await t.mount();
    const josefa = t.agent("josefa");
    await act(async () => {
      josefa.button.click();
    });
    const model = josefa.element.querySelectorAll("select")[1]!;
    await act(async () => {
      model.value = "first";
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(josefa.element.querySelector('[role="alert"]')).not.toBeNull();
    expect(josefa.button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      josefa.button.click();
    });
    expect(josefa.button.getAttribute("aria-expanded")).toBe("true");
  });

  it("starts with the row of the agent a notice named open", async () => {
    const t = render([defaultRow, row("josefa", {})], { openAgent: "josefa" });
    await t.mount();
    expect(t.agent("josefa").button.getAttribute("aria-expanded")).toBe("true");
    expect(t.agent("virgilio").button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      t.agent("josefa").button.click();
    });
    expect(t.agent("josefa").button.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows another window's change on a closed row", async () => {
    const t = render([defaultRow, row("josefa", {})]);
    await t.mount();
    const josefa = t.agent("josefa");
    expect(josefa.button.getAttribute("aria-expanded")).toBe("false");
    await t.update(
      [
        defaultRow,
        row("josefa", {
          revision: 2,
          connection: "anthropic",
          model: "opus",
          modelName: "Claude Opus 5.5",
          inherit: false,
        }),
      ],
      "josefa",
    );
    const notice = josefa.element.querySelector<HTMLElement>(".connection-info")!;
    expect(notice.textContent).toContain("Another window changed");
    expect(notice.closest("[hidden]")).toBeNull();
    expect(josefa.button.getAttribute("aria-expanded")).toBe("false");
    expect(josefa.summary()).toBe("Anthropic · API key · Claude Opus 5.5");
  });

  it("judges availability by the confirmed choice while another service is drafted", async () => {
    const t = render([defaultRow, row("virgilio", {})]);
    await t.mount();
    const virgilio = t.agent("virgilio");
    await act(async () => {
      virgilio.button.click();
    });
    const service = virgilio.element.querySelectorAll("select")[0]!;
    await act(async () => {
      service.value = "anthropic";
      service.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(virgilio.button.getAttribute("aria-disabled")).toBeNull();
    expect(virgilio.summary()).toBe("Default · ChatGPT · First model");
    await act(async () => {
      virgilio.button.click();
    });
    expect(virgilio.button.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a row open when its confirmed model is missing from the loaded list", async () => {
    const t = render([
      defaultRow,
      row("josefa", {
        connection: "anthropic",
        model: "retired",
        modelName: "Retired model",
        inherit: false,
      }),
    ]);
    await t.mount();
    const josefa = t.agent("josefa");
    expect(josefa.summary()).toBe("Anthropic · API key · Retired model");
    expect(josefa.button.getAttribute("aria-expanded")).toBe("true");
    expect(josefa.button.getAttribute("aria-disabled")).toBe("true");
  });

  it("summarizes an inherited effort override and an unlisted service as its selects name them", async () => {
    const t = render([
      defaultRow,
      row("virgilio", { effort: "high" }),
      row("josefa", {
        connection: "retired_service",
        model: "m",
        modelName: "Model M",
        inherit: false,
      }),
    ]);
    await t.mount();
    expect(t.agent("virgilio").summary()).toBe("Default · ChatGPT · First model · high");
    expect(t.agent("josefa").summary()).toBe("Model M");
  });

  it("keeps a requested row open after the request moves to another target", async () => {
    const request: { current: "virgilio" | "josefa" | undefined } = { current: "josefa" };
    const t = render([defaultRow], { openAgent: request });
    await t.mount();
    expect(t.agent("josefa").button.getAttribute("aria-expanded")).toBe("true");
    request.current = undefined;
    await t.mount();
    expect(t.agent("josefa").button.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      t.agent("josefa").button.click();
    });
    expect(t.agent("josefa").button.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a row with a missing confirmed model forced open while another service is drafted", async () => {
    const t = render([
      defaultRow,
      row("josefa", {
        connection: "anthropic",
        model: "retired",
        modelName: "Retired model",
        inherit: false,
      }),
    ]);
    await t.mount();
    const josefa = t.agent("josefa");
    expect(josefa.button.getAttribute("aria-disabled")).toBe("true");
    const service = josefa.element.querySelectorAll("select")[0]!;
    await act(async () => {
      service.value = "chatgpt";
      service.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(josefa.button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      josefa.button.click();
    });
    expect(josefa.button.getAttribute("aria-expanded")).toBe("true");
  });

  it("judges a changed confirmed choice afresh and lets a recovered row close", async () => {
    const missing = row("josefa", {
      connection: "anthropic",
      model: "retired",
      modelName: "Retired model",
      inherit: false,
    });
    const t = render([defaultRow, missing]);
    await t.mount();
    const josefa = t.agent("josefa");
    expect(josefa.button.getAttribute("aria-disabled")).toBe("true");
    await t.update(
      [
        defaultRow,
        {
          ...missing,
          revision: 2,
          connection: "retired_service",
          model: "m",
          modelName: "Model M",
        },
      ],
      "josefa",
    );
    expect(josefa.summary()).toBe("Model M");
    expect(josefa.button.getAttribute("aria-disabled")).toBeNull();
    expect(josefa.button.getAttribute("aria-expanded")).toBe("true");
    await t.update(
      [defaultRow, { ...missing, revision: 3, model: "opus", modelName: "Claude Opus 5.5" }],
      "josefa",
    );
    expect(josefa.button.getAttribute("aria-disabled")).toBeNull();
    await act(async () => {
      josefa.button.click();
    });
    expect(josefa.button.getAttribute("aria-expanded")).toBe("false");
  });
});
