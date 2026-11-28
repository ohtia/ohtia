import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeEnvelope,
  isConnectionEvent,
  isConnectionSnapshot,
  policyId,
  portLimits,
  type ConnectionEvent,
  type DiagnosticEvent,
} from "../packages/contracts/src/index.js";
import { connect } from "node:net";
import { ConnectionBroker } from "../packages/main/src/connection-broker.js";
import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { CredentialStore } from "../packages/main/src/credential-store.js";
import {
  OpenRouterProvider,
  openrouterConnectionId as openrouter,
} from "../packages/main/src/openrouter-provider.js";
import {
  authorization,
  authorizationUrl,
  pkceChallenge,
  waitForCallback,
} from "../packages/main/src/openrouter-sign-in.js";
import type { KeySignIn, ProviderAdapter } from "../packages/main/src/provider-adapter.js";
import { transportFailure, type ProviderTransport } from "../packages/main/src/provider-https.js";

const pasted = "sk-or-v1-synthetic-openrouter-key";
const signedIn = "sk-or-v1-synthetic-signed-in-key";
const code = "synthetic-authorization-code";
const expiry = "2026-12-04T10:00:00.000Z";
const completed = "You can close this tab and return to Ohtia.";

const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const action of cleanup.splice(0).reverse()) action();
});

function keyInfo() {
  return Response.json({ data: { label: "sk-or-v1-syn…key", expires_at: expiry } });
}
function models() {
  return Response.json({
    data: [
      {
        id: "moonshotai/kimi-k3.1-pro",
        name: "Synthetic Kimi",
        architecture: { output_modalities: ["text"], tokenizer: "Other" },
        supported_parameters: ["tools"],
        expiration_date: null,
        endpoints: ["/api/v1/chat/completions"],
      },
    ],
    total_count: 1,
  });
}
function exchanged(key: unknown = signedIn) {
  return Response.json({ key, user_id: "user_synthetic" });
}
type Handler = (body: Record<string, unknown>) => Response | Promise<Response>;

/** A real loopback listener, a fake OpenRouter behind the transport and a browser that is told where to go. */
function harness(entries = new Map<string, string>()) {
  const diagnostics: DiagnosticEvent[] = [];
  const events: ConnectionEvent[] = [];
  const opened: URL[] = [];
  const exchanges: Record<string, unknown>[] = [];
  const store = new CredentialStore({
    service: "Synthetic",
    userData: "/unused",
    platform: "linux",
    entry: (_service, account) => ({
      getPassword: async () => entries.get(account) ?? null,
      setPassword: async (value) => {
        entries.set(account, value);
      },
      deleteCredential: async () => entries.delete(account),
    }),
  });
  const routes: { exchange: Handler; key: () => Response | Promise<Response> } = {
    exchange: () => exchanged(),
    key: keyInfo,
  };
  const send = vi.fn<ProviderTransport>(async (outgoing, release) => {
    const url = new URL(outgoing.url);
    expect(url.origin).toBe("https://openrouter.ai");
    if (url.pathname === "/api/v1/auth/keys") {
      expect(outgoing.headers).toEqual({ "Content-Type": "application/json" });
      if (!release()) throw transportFailure(false);
      const body = JSON.parse(outgoing.body!) as Record<string, unknown>;
      exchanges.push(body);
      return routes.exchange(body);
    }
    expect(outgoing.body).toBeUndefined();
    if (!release()) throw transportFailure(false);
    return url.pathname === "/api/v1/key" ? routes.key() : models();
  });
  let browser!: (url: URL) => void;
  const visited = new Promise<URL>((resolve) => (browser = resolve));
  const provider = new OpenRouterProvider({
    store,
    transport: send,
    model: () => undefined,
    refresh: () => {},
    openBrowser: async (url) => {
      opened.push(new URL(url));
      browser(new URL(url));
    },
    completedText: () => completed,
  });
  const manager = new ConnectionManager([provider], (event) => diagnostics.push(event));
  manager.subscribe((event) => events.push(event));
  cleanup.push(() => manager.dispose());
  return {
    provider,
    manager,
    entries,
    send,
    routes,
    events,
    diagnostics,
    opened,
    exchanges,
    visited,
    snapshot: () => manager.snapshot(openrouter)!,
    /** Request the callback as the browser would, returning the listener's status. */
    async callback(search: string, init?: RequestInit) {
      const url = await visited;
      const callback = new URL(url.searchParams.get("callback_url")!);
      const response = await fetch(`${callback.origin}${callback.pathname}${search}`, init);
      return { status: response.status, text: await response.text() };
    },
    state: async () => (await visited).searchParams.get("state")!,
    async paste() {
      manager.connect(openrouter, { key: pasted });
      await vi.waitFor(() => expect(manager.snapshot(openrouter)?.checking_key).toBeUndefined());
    },
    settled: () =>
      vi.waitFor(() => expect(manager.snapshot(openrouter)?.signing_in).toBeUndefined()),
  };
}

describe("OpenRouter authorization address", () => {
  it("matches the PKCE test vector of RFC 7636", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("carries exactly the six parameters, with fresh values on every attempt", () => {
    const first = authorization();
    const second = authorization();
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first.challenge).toBe(pkceChallenge(first.verifier));
    expect(second.verifier).not.toBe(first.verifier);
    expect(second.state).not.toBe(first.state);
    const url = new URL(authorizationUrl(43_210, first));
    expect(`${url.origin}${url.pathname}`).toBe("https://openrouter.ai/auth");
    expect([...url.searchParams]).toEqual([
      ["callback_url", "http://127.0.0.1:43210/callback"],
      ["code_challenge", first.challenge],
      ["code_challenge_method", "S256"],
      ["state", first.state],
      ["key_label", "Ohtia"],
      ["expiration", "7-days"],
    ]);
  });

  it("declares the sign-in and starts it only from the connect action without a key", () => {
    const h = harness();
    expect(h.provider.declaration.signInModes).toEqual(["api_key", "provider_login"]);
    expect(h.manager.connect(openrouter, { new_registration: true })).toMatchObject({ ok: false });
    expect(h.manager.connect(openrouter)).toMatchObject({
      ok: true,
      value: { state: "connecting", signing_in: true },
    });
    // A second press, or a pasted key while the sign-in waits, starts nothing else.
    expect(h.manager.connect(openrouter)).toMatchObject({ value: { signing_in: true } });
    expect(h.manager.connect(openrouter, { key: pasted })).toMatchObject({
      value: { signing_in: true },
    });
    expect(h.opened.length).toBeLessThanOrEqual(1);
  });

  it("opens a fresh address for each attempt", async () => {
    const h = harness();
    h.manager.connect(openrouter);
    const first = await h.visited;
    h.manager.cancelSignIn(openrouter);
    const again = harness(h.entries);
    again.manager.connect(openrouter);
    const second = await again.visited;
    expect(second.searchParams.get("state")).not.toBe(first.searchParams.get("state"));
    expect(second.searchParams.get("code_challenge")).not.toBe(
      first.searchParams.get("code_challenge"),
    );
  });
});

describe("OpenRouter callback listener", () => {
  it("listens on 127.0.0.1, answers other paths and methods with 404 and keeps waiting", async () => {
    const h = harness();
    h.manager.connect(openrouter);
    const callback = new URL((await h.visited).searchParams.get("callback_url")!);
    expect(callback.hostname).toBe("127.0.0.1");
    const base = `http://127.0.0.1:${callback.port}`;
    expect((await fetch(`${base}/favicon.ico`)).status).toBe(404);
    expect((await fetch(`${base}/auth/callback`)).status).toBe(404);
    expect((await fetch(`${base}/callback`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}/callback`, { method: "HEAD" })).status).toBe(404);
    expect(h.snapshot().signing_in).toBe(true);
    const state = await h.state();
    expect(await h.callback(`?code=${code}&state=${state}`)).toEqual({
      status: 200,
      text: completed,
    });
    await h.settled();
    // It closed after the callback it accepted.
    await expect(fetch(`${base}/callback`)).rejects.toThrow();
  });

  it("never exchanges a code with a missing or different state, and keeps waiting", async () => {
    const h = harness();
    h.manager.connect(openrouter);
    const state = await h.state();
    expect((await h.callback(`?code=${code}`)).status).toBe(400);
    expect((await h.callback(`?code=${code}&state=other`)).status).toBe(400);
    expect((await h.callback(`?code=${code}&state=${state}&state=${state}`)).status).toBe(400);
    expect((await h.callback(`?state=${state}`)).status).toBe(400);
    expect((await h.callback(`?error=access_denied`)).status).toBe(400);
    expect(h.exchanges).toEqual([]);
    expect(h.snapshot()).toMatchObject({ state: "connecting", signing_in: true, reason: null });
    h.manager.cancelSignIn(openrouter);
  });

  it("ends at once without a reason when OpenRouter returns without parameters (Deny)", async () => {
    const h = harness();
    await h.paste();
    const before = h.manager.account(openrouter).fingerprint;
    h.manager.connect(openrouter);
    expect(h.snapshot()).toMatchObject({ state: "connected", signing_in: true });
    expect(await h.callback("")).toEqual({ status: 200, text: completed });
    await h.settled();
    expect(h.snapshot()).toMatchObject({ state: "connected", reason: null });
    expect(h.snapshot().unkept_key).toBeUndefined();
    expect(h.manager.account(openrouter).fingerprint).toBe(before);
    expect(h.exchanges).toEqual([]);
  });

  it("returns a disconnected connection to disconnected after Deny", async () => {
    const h = harness();
    h.manager.connect(openrouter);
    await h.callback("");
    await h.settled();
    expect(h.snapshot()).toMatchObject({ state: "disconnected", reason: null });
    expect(h.entries.size).toBe(0);
  });

  it("rejects a listener that cannot open the browser", async () => {
    const values = authorization();
    await expect(
      waitForCallback({
        values,
        signal: new AbortController().signal,
        completedText: completed,
        openBrowser: () => Promise.reject(new Error("No browser.")),
      }),
    ).rejects.toThrow("Browser hand-off failed.");
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      waitForCallback({
        values,
        signal: aborted.signal,
        completedText: completed,
        openBrowser: () => Promise.resolve(),
      }),
    ).rejects.toThrow("Sign-in cancelled.");
  });
});

describe("OpenRouter key exchange", () => {
  it("exchanges the code once, checks the key and stores it with a new instance", async () => {
    const h = harness();
    await h.paste();
    const before = h.manager.account(openrouter).fingerprint;
    const pastedInstance = (
      JSON.parse(h.entries.get("openrouter-api-key")!) as { instance: string }
    ).instance;
    h.manager.connect(openrouter);
    const visited = await h.visited;
    await h.callback(`?code=${code}&state=${await h.state()}`);
    await h.settled();
    expect(h.exchanges).toEqual([
      {
        code,
        code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        code_challenge_method: "S256",
      },
    ]);
    expect(pkceChallenge(h.exchanges[0]!.code_verifier as string)).toBe(
      visited.searchParams.get("code_challenge"),
    );
    expect(h.snapshot()).toMatchObject({ state: "connected", reason: null, expires_at: expiry });
    const stored = JSON.parse(h.entries.get("openrouter-api-key")!) as {
      key: string;
      instance: string;
    };
    expect(stored.key).toBe(signedIn);
    expect(stored.instance).not.toBe(pastedInstance);
    expect(h.manager.account(openrouter).fingerprint).not.toBe(before);
    // The exchange, the key check and the model list: one request each after the paste.
    expect(h.send.mock.calls.map(([request]) => new URL(request.url).pathname).slice(2)).toEqual([
      "/api/v1/auth/keys",
      "/api/v1/key",
      "/api/v1/models/user",
    ]);
  });

  it("is still connected after Ohtia restarts", async () => {
    const h = harness();
    h.manager.connect(openrouter);
    await h.callback(`?code=${code}&state=${await h.state()}`);
    await h.settled();
    const restarted = harness(h.entries);
    expect(await restarted.manager.read(openrouter)).toMatchObject({
      ok: true,
      value: { state: "connected", expires_at: expiry },
    });
    expect(restarted.provider.requests).toBeDefined();
  });

  it("gives sign_in_rejected for an expired or reused code and keeps the previous key", async () => {
    const h = harness();
    await h.paste();
    h.routes.exchange = () => Response.json({ error: { code: 403 } }, { status: 403 });
    h.manager.connect(openrouter);
    await h.callback(`?code=${code}&state=${await h.state()}`);
    await h.settled();
    expect(h.snapshot()).toMatchObject({ state: "connected", reason: "sign_in_rejected" });
    expect(h.snapshot().unkept_key).toBeUndefined();
    expect(JSON.parse(h.entries.get("openrouter-api-key")!)).toMatchObject({ key: pasted });
    expect(isConnectionSnapshot(h.snapshot())).toBe(true);
  });

  it("notes a key that OpenRouter returned when its check fails", async () => {
    const h = harness();
    h.routes.key = () => new Response(null, { status: 401 });
    h.manager.connect(openrouter);
    await h.callback(`?code=${code}&state=${await h.state()}`);
    await h.settled();
    expect(h.snapshot()).toMatchObject({
      state: "disconnected",
      reason: "key_rejected",
      unkept_key: true,
    });
    expect(h.entries.size).toBe(0);
  });

  it("notes a possible key when the exchange is cut after its request left", async () => {
    const h = harness();
    h.routes.exchange = () => {
      throw transportFailure(true);
    };
    h.manager.connect(openrouter);
    await h.callback(`?code=${code}&state=${await h.state()}`);
    await h.settled();
    expect(h.snapshot()).toMatchObject({
      state: "disconnected",
      reason: "sign_in_rejected",
      unkept_key: true,
    });
  });

  it("notes a 200 whose body has no usable key", async () => {
    const h = harness();
    h.routes.exchange = () => exchanged(42);
    h.manager.connect(openrouter);
    await h.callback(`?code=${code}&state=${await h.state()}`);
    await h.settled();
    expect(h.snapshot()).toMatchObject({ reason: "sign_in_rejected", unkept_key: true });
  });

  it("keeps the key, the code, the verifier and user_id out of every event and diagnostic", async () => {
    const h = harness();
    h.manager.connect(openrouter);
    await h.callback(`?code=${code}&state=${await h.state()}`);
    await h.settled();
    const verifier = h.exchanges[0]!.code_verifier as string;
    const visible = JSON.stringify([h.events, h.diagnostics, h.snapshot()]);
    for (const secret of [signedIn, code, verifier, "user_synthetic"])
      expect(visible).not.toContain(secret);
    expect(h.entries.get("openrouter-api-key")).not.toContain("user_synthetic");
    expect(h.entries.get("openrouter-api-key")).not.toContain(code);
    expect(h.events.every((event) => isConnectionEvent(event))).toBe(true);
  });
});

describe("Cancel sign-in", () => {
  it("ends the wait and keeps the previous key and state", async () => {
    const h = harness();
    await h.paste();
    h.manager.connect(openrouter);
    await h.visited;
    expect(h.manager.cancelSignIn(openrouter)).toMatchObject({
      ok: true,
      value: { state: "connected", reason: null },
    });
    expect(h.snapshot().signing_in).toBeUndefined();
    expect(h.snapshot().unkept_key).toBeUndefined();
    expect(JSON.parse(h.entries.get("openrouter-api-key")!)).toMatchObject({ key: pasted });
    expect(h.diagnostics.map((event) => event.event_name)).toContain(
      "ohtia.connection.cancel_sign_in",
    );
  });

  it("aborts the exchange, stores nothing and notes the key OpenRouter may have created", async () => {
    const h = harness();
    let exchange!: (response: Response) => void;
    h.routes.exchange = () => new Promise<Response>((resolve) => (exchange = resolve));
    h.manager.connect(openrouter);
    await h.callback(`?code=${code}&state=${await h.state()}`);
    await vi.waitFor(() => expect(exchange).toBeDefined());
    h.manager.cancelSignIn(openrouter);
    exchange(exchanged());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.snapshot()).toMatchObject({ state: "disconnected", reason: null, unkept_key: true });
    expect(h.entries.size).toBe(0);
  });

  it("aborts the key check and stores nothing", async () => {
    const h = harness();
    let check!: (response: Response) => void;
    h.routes.key = () => new Promise<Response>((resolve) => (check = resolve));
    h.manager.connect(openrouter);
    await h.callback(`?code=${code}&state=${await h.state()}`);
    await vi.waitFor(() => expect(check).toBeDefined());
    h.manager.cancelSignIn(openrouter);
    check(keyInfo());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.snapshot()).toMatchObject({ state: "disconnected", unkept_key: true });
    expect(h.entries.size).toBe(0);
  });

  it("does nothing once the key is being written", async () => {
    const h = harness();
    let write!: () => void;
    const save = h.provider.apiKey.save;
    h.provider.apiKey.save = async (...args) => {
      await new Promise<void>((resolve) => (write = resolve));
      return save(...args);
    };
    h.manager.connect(openrouter);
    await h.callback(`?code=${code}&state=${await h.state()}`);
    await vi.waitFor(() => expect(write).toBeDefined());
    expect(h.manager.cancelSignIn(openrouter)).toMatchObject({ value: { signing_in: true } });
    write();
    await h.settled();
    expect(h.snapshot()).toMatchObject({ state: "connected", reason: null });
    expect(h.diagnostics.map((event) => event.event_name)).not.toContain(
      "ohtia.connection.cancel_sign_in",
    );
  });

  it("has no effect without a pending sign-in and is a valid port operation", () => {
    const h = harness();
    expect(h.manager.cancelSignIn(openrouter)).toMatchObject({
      ok: true,
      value: { state: "disconnected" },
    });
    expect(h.manager.cancelSignIn("unknown")).toMatchObject({ ok: false });
    const request = (payload: unknown) =>
      decodeEnvelope({
        protocol: 1,
        policy: policyId,
        kind: "request",
        requestId: "request-1",
        operationId: "operation-1",
        windowGeneration: "window-1",
        serviceGeneration: "service-1",
        operation: "connection.cancelSignIn",
        payload,
      }).ok;
    expect(request({ connection: openrouter })).toBe(true);
    expect(request({ connection: openrouter, key: pasted })).toBe(false);
  });
});

type Mutable = {
  -readonly [K in keyof ProviderAdapter]: ProviderAdapter[K];
} & {
  apiKey: {
    -readonly [K in keyof NonNullable<ProviderAdapter["apiKey"]>]: NonNullable<
      ProviderAdapter["apiKey"]
    >[K];
  };
  credentials: {
    -readonly [K in keyof ProviderAdapter["credentials"]]: ProviderAdapter["credentials"][K];
  };
};
/** An adapter whose sign-in the test settles, to drive the manager's time limit and phases. */
function stubbed(customize?: (adapter: Mutable) => void) {
  let settle!: (result: KeySignIn) => void;
  let signal!: AbortSignal;
  let sent!: () => void;
  const store = new Map<string, string>();
  const adapter = {
    declaration: {
      id: "openrouter",
      version: "1.0.0",
      signInModes: ["api_key", "provider_login"],
      capabilities: {
        text: false,
        attachments: false,
        structuredOutput: false,
        streaming: false,
        tools: false,
        interruption: false,
        resumption: false,
        modelSelection: true,
        effortSelection: false,
        usageReporting: false,
        late_usage: "none",
      },
      connection: {
        id: "openrouter",
        displayName: "OpenRouter",
        kind: "api_key",
        usageUrl: null,
      },
    },
    credentials: {
      read: async () =>
        store.has("key")
          ? { status: "stored", value: { credential: store.get("key")!, reason: null } }
          : { status: "absent" },
      write: async () => ({ status: "unavailable" }),
      delete: async () => ({ status: "stored" }),
    },
    connect: async () => ({ state: "error", reason: null }),
    probe: async () => [],
    apiKey: {
      check: async () => ({ models: [] }),
      save: async (key: string) => {
        store.set("key", key);
        return { status: "stored" };
      },
      connectedAt: () => undefined,
      signIn: (given: AbortSignal, onSent: () => void) =>
        new Promise<KeySignIn>((resolve) => {
          settle = resolve;
          signal = given;
          sent = onSent;
        }),
    },
  } as unknown as Mutable;
  customize?.(adapter);
  const manager = new ConnectionManager([adapter]);
  cleanup.push(() => manager.dispose());
  return {
    manager,
    store,
    settle: (result: KeySignIn) => settle(result),
    signal: () => signal,
    sent: () => sent(),
    snapshot: () => manager.snapshot("openrouter")!,
  };
}

describe("OpenRouter sign-in time limit", () => {
  it("ends with sign_in_timeout after sign_in_wait_ms and aborts the wait", async () => {
    vi.useFakeTimers();
    const s = stubbed();
    s.manager.connect("openrouter");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(portLimits.sign_in_wait_ms - 1);
    expect(s.snapshot().signing_in).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.signal().aborted).toBe(true);
    expect(s.snapshot()).toMatchObject({ state: "disconnected", reason: "sign_in_timeout" });
    expect(s.snapshot().unkept_key).toBeUndefined();
    expect(isConnectionSnapshot(s.snapshot())).toBe(true);
    // A late result of the aborted attempt changes nothing.
    s.settle({ status: "key", key: signedIn });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.store.size).toBe(0);
  });

  it("notes a possible key when the time limit ends an exchange already sent", async () => {
    vi.useFakeTimers();
    const s = stubbed();
    s.manager.connect("openrouter");
    await vi.advanceTimersByTimeAsync(0);
    s.sent();
    await vi.advanceTimersByTimeAsync(portLimits.sign_in_wait_ms);
    expect(s.snapshot()).toMatchObject({ reason: "sign_in_timeout", unkept_key: true });
  });

  it("clears the note when the researcher starts again or disconnects", async () => {
    const s = stubbed();
    s.manager.connect("openrouter");
    await vi.waitFor(() => expect(s.signal()).toBeDefined());
    s.settle({ status: "rejected", unkept: true });
    await vi.waitFor(() => expect(s.snapshot().unkept_key).toBe(true));
    s.manager.connect("openrouter");
    expect(s.snapshot().unkept_key).toBeUndefined();
    s.manager.cancelSignIn("openrouter");
    expect(s.snapshot().unkept_key).toBeUndefined();
  });
});

describe("OpenRouter sign-in edge cases", () => {
  it("validates the sign-in fields of a snapshot", () => {
    const base = {
      connection: "openrouter",
      reason: null,
      display_name: "OpenRouter",
      account_email: null,
      last_account_email: null,
      probing: false,
      probe_id: null,
      model_list_revision: null,
      model_count: 0,
    };
    for (const state of ["connecting", "connected", "expired"])
      expect(isConnectionSnapshot({ ...base, state, signing_in: true })).toBe(true);
    expect(isConnectionSnapshot({ ...base, state: "disconnected", signing_in: false })).toBe(true);
    expect(isConnectionSnapshot({ ...base, state: "disconnected", signing_in: true })).toBe(false);
    expect(
      isConnectionSnapshot({
        ...base,
        state: "error",
        reason: "store_unavailable",
        signing_in: true,
      }),
    ).toBe(true);
    expect(isConnectionSnapshot({ ...base, state: "connecting", signing_in: "yes" })).toBe(false);
    expect(isConnectionSnapshot({ ...base, state: "disconnected", unkept_key: true })).toBe(true);
    expect(isConnectionSnapshot({ ...base, state: "disconnected", unkept_key: 1 })).toBe(false);
  });

  it("refuses the sign-in on a key connection that cannot sign in", () => {
    const plain = stubbed((adapter) => {
      delete adapter.apiKey.signIn;
    });
    expect(plain.manager.connect("openrouter")).toMatchObject({ ok: false });
  });

  it("answers a request with an unparseable address with 404 and keeps waiting", async () => {
    const h = harness();
    h.manager.connect(openrouter);
    const callback = new URL((await h.visited).searchParams.get("callback_url")!);
    const status = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(callback.port), "127.0.0.1", () => {
        socket.end("GET //[ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
      });
      let text = "";
      socket.on("data", (chunk) => (text += String(chunk)));
      socket.on("end", () => resolve(text.split("\r\n")[0]!));
      socket.on("error", reject);
    });
    expect(status).toBe("HTTP/1.1 404 Not Found");
    expect(h.snapshot().signing_in).toBe(true);
    h.manager.cancelSignIn(openrouter);
  });

  it("closes a listener that is cancelled before it starts listening", async () => {
    const abort = new AbortController();
    const opened = vi.fn(() => Promise.resolve());
    const waiting = waitForCallback({
      values: authorization(),
      signal: abort.signal,
      completedText: completed,
      openBrowser: opened,
    });
    abort.abort();
    await expect(waiting).rejects.toThrow("Sign-in cancelled.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(opened).not.toHaveBeenCalled();
  });

  it("gives sign_in_rejected without browser support or when the exchange body cannot be read", async () => {
    const bare = new OpenRouterProvider({
      store: {} as never,
      model: () => undefined,
      refresh: () => {},
    });
    expect(await bare.apiKey.signIn(new AbortController().signal, () => {})).toEqual({
      status: "rejected",
      unkept: false,
    });
    const h = harness();
    h.routes.exchange = () => new Response("not json", { status: 200 });
    h.manager.connect(openrouter);
    await h.callback(`?code=${code}&state=${await h.state()}`);
    await h.settled();
    expect(h.snapshot()).toMatchObject({ reason: "sign_in_rejected", unkept_key: true });
  });

  it("keeps the previous state when the keyring is unavailable, the write fails or the sign-in throws", async () => {
    const unavailable = stubbed((adapter) => {
      adapter.credentials.read = async () => ({ status: "unavailable" });
    });
    unavailable.manager.connect("openrouter");
    await vi.waitFor(() => expect(unavailable.snapshot().signing_in).toBeUndefined());
    expect(unavailable.snapshot()).toMatchObject({ state: "error", reason: "store_unavailable" });

    const unwritten = stubbed((adapter) => {
      adapter.apiKey.save = async () => ({ status: "unavailable" });
    });
    unwritten.manager.connect("openrouter");
    await vi.waitFor(() => expect(unwritten.signal()).toBeDefined());
    unwritten.settle({ status: "key", key: signedIn });
    await vi.waitFor(() => expect(unwritten.snapshot().signing_in).toBeUndefined());
    expect(unwritten.snapshot()).toMatchObject({ reason: "store_unavailable", unkept_key: true });

    const thrown = stubbed((adapter) => {
      adapter.apiKey.signIn = () => Promise.reject(new Error("Synthetic failure."));
    });
    thrown.manager.connect("openrouter");
    await vi.waitFor(() => expect(thrown.snapshot().signing_in).toBeUndefined());
    expect(thrown.snapshot()).toMatchObject({ state: "disconnected", reason: "sign_in_rejected" });
  });

  it("routes connection.cancelSignIn through the broker", async () => {
    const h = harness();
    h.manager.connect(openrouter);
    await h.visited;
    const broker = new ConnectionBroker(h.manager);
    const deliver = vi.fn();
    broker.handle({
      request: {
        protocol: 1,
        policy: policyId,
        kind: "request",
        requestId: "request-1",
        operationId: "operation-1",
        windowGeneration: "window-1",
        serviceGeneration: "service-1",
        operation: "connection.cancelSignIn",
        payload: { connection: openrouter },
      } as never,
      deliver,
      release: () => {},
      releaseSubscription: () => {},
    });
    await vi.waitFor(() => expect(deliver).toHaveBeenCalled());
    expect(h.snapshot().signing_in).toBeUndefined();
    broker.dispose();
  });
});

describe("OpenRouter sign-in after review", () => {
  it("keeps snapshots valid when the keyring fails during the wait and clears the failure after a stored key", async () => {
    let available = true;
    const s = stubbed((adapter) => {
      const read = adapter.credentials.read;
      adapter.credentials.read = () =>
        available ? read() : Promise.resolve({ status: "unavailable" });
    });
    s.manager.connect("openrouter");
    await vi.waitFor(() => expect(s.signal()).toBeDefined());
    available = false;
    const read = await s.manager.read("openrouter");
    expect(read).toMatchObject({
      ok: true,
      value: { state: "error", reason: "store_unavailable", signing_in: true },
    });
    expect(isConnectionSnapshot(read.ok && read.value)).toBe(true);
    // Test connection waits for the sign-in instead of reading the store under it.
    expect(s.manager.probe("openrouter")).toMatchObject({ value: { probing: false } });
    available = true;
    s.settle({ status: "key", key: signedIn });
    await vi.waitFor(() => expect(s.snapshot().signing_in).toBeUndefined());
    expect(s.snapshot()).toMatchObject({ state: "connected", reason: null });
  });

  it("clears the note when disconnecting a disconnected row", async () => {
    const s = stubbed();
    s.manager.connect("openrouter");
    await vi.waitFor(() => expect(s.signal()).toBeDefined());
    s.sent();
    s.manager.cancelSignIn("openrouter");
    expect(s.snapshot()).toMatchObject({ state: "disconnected", unkept_key: true });
    const result = await s.manager.disconnect("openrouter");
    expect(result.ok && result.value.unkept_key).toBeFalsy();
    expect(s.snapshot().unkept_key).toBeUndefined();
  });

  it("keeps an expired key's explanation after Cancel and Deny", async () => {
    let report!: Parameters<NonNullable<ProviderAdapter["onStateChange"]>>[0];
    const s = stubbed((adapter) => {
      adapter.onStateChange = (listener) => {
        report = listener;
        return () => {};
      };
    });
    report("expired", "key_needs_workspace");
    expect(s.snapshot()).toMatchObject({ state: "expired", reason: "key_needs_workspace" });
    s.manager.connect("openrouter");
    expect(s.snapshot()).toMatchObject({ state: "expired", reason: null, signing_in: true });
    await vi.waitFor(() => expect(s.signal()).toBeDefined());
    s.manager.cancelSignIn("openrouter");
    expect(s.snapshot()).toMatchObject({ state: "expired", reason: "key_needs_workspace" });
    const before = s.signal();
    s.manager.connect("openrouter");
    await vi.waitFor(() => expect(s.signal()).not.toBe(before));
    s.settle({ status: "denied" });
    await vi.waitFor(() => expect(s.snapshot().signing_in).toBeUndefined());
    expect(s.snapshot()).toMatchObject({ state: "expired", reason: "key_needs_workspace" });
  });

  it("keeps a connected row valid when its stored key disappears during the wait", async () => {
    const s = stubbed();
    s.store.set("key", pasted);
    await s.manager.read("openrouter");
    expect(s.snapshot().state).toBe("connected");
    s.manager.connect("openrouter");
    await vi.waitFor(() => expect(s.signal()).toBeDefined());
    s.store.clear();
    const read = await s.manager.read("openrouter");
    expect(read).toMatchObject({ ok: true, value: { state: "connecting", signing_in: true } });
    expect(isConnectionSnapshot(read.ok && read.value)).toBe(true);
    s.manager.cancelSignIn("openrouter");
    expect(s.snapshot()).toMatchObject({ state: "disconnected", reason: null });
  });

  it("keeps a keyring failure seen during the wait after a rejection", async () => {
    let available = true;
    const s = stubbed((adapter) => {
      const read = adapter.credentials.read;
      adapter.credentials.read = () =>
        available ? read() : Promise.resolve({ status: "unavailable" });
    });
    s.store.set("key", pasted);
    await s.manager.read("openrouter");
    s.manager.connect("openrouter");
    await vi.waitFor(() => expect(s.signal()).toBeDefined());
    available = false;
    await s.manager.read("openrouter");
    s.settle({ status: "rejected", unkept: false });
    await vi.waitFor(() => expect(s.snapshot().signing_in).toBeUndefined());
    expect(s.snapshot()).toMatchObject({ state: "error", reason: "store_unavailable" });
    expect(s.manager.account("openrouter").fingerprint).toBeUndefined();
  });
});
