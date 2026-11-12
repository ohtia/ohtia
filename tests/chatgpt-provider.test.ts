import { providerConformance } from "./fixtures/provider-conformance.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeChatGPT } from "./fixtures/chatgpt.js";
import { chatGPTEndpoints, providerJSON } from "../packages/main/src/chatgpt-sign-in.js";
import { ChatGPTProvider } from "../packages/main/src/chatgpt-provider.js";
import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { ServiceSupervisor } from "../packages/main/src/service-supervisor.js";
import { credentialService } from "../packages/main/src/credential-store.js";
import {
  portLimits,
  isConnectionSnapshot,
  decodeConnectionReport,
  type RuntimeContext,
} from "@ohtia/contracts";
const fixtures: ReturnType<typeof fakeChatGPT>[] = [];
const roots: string[] = [];
function fixture(options?: Parameters<typeof fakeChatGPT>[0]) {
  const f = fakeChatGPT(options);
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.manager.dispose();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

providerConformance("ChatGPT", (options = {}) => {
  const f = fixture();
  const open = f.browser.getMockImplementation()!;
  f.browser.mockImplementation(async (url) => {
    await open(url);
    await f.callback();
  });
  if (options.connect)
    Object.assign(f.adapter, {
      connect: options.connect,
      credentials: createFakeProvider().credentials,
    });
  if (options.probe)
    Object.assign(f.adapter, {
      probe: (_session: unknown, signal: AbortSignal) => options.probe!(signal),
    });
  if (options.credentials) Object.assign(f.adapter, { credentials: options.credentials });
  return f.adapter;
});

describe("ChatGPT sign-in", () => {
  it("declares subscription metadata and stores validated registration separately from restartable session", async () => {
    const f = fixture();
    expect(f.adapter.declaration.connection).toEqual({
      id: "chatgpt",
      displayName: "ChatGPT",
      kind: "subscription",
      usageUrl: "https://chatgpt.com/settings/usage",
    });
    expect(await f.manager.read("chatgpt")).toMatchObject({
      value: { state: "disconnected", last_account_email: null },
    });
    expect(await f.login()).toMatchObject({
      state: "connected",
      display_name: "ChatGPT",
      last_account_email: "one@example.test",
    });
    expect(isConnectionSnapshot(f.manager.snapshot("chatgpt"))).toBe(true);
    const reg = JSON.parse(f.registration!);
    expect(reg).toMatchObject({
      client: "client-one",
      sub: "subject-one",
      email: "one@example.test",
    });
    expect(reg.host).toMatch(/^urn:uuid:/);
    expect(JSON.stringify(await f.store.readSession())).not.toContain("one@example.test");
    expect(JSON.stringify(f.diagnostics)).not.toMatch(
      /example.test|access-one|refresh-one|synthetic-code/,
    );
    const restarted = new ChatGPTProvider({
      store: f.store,
      openBrowser: async () => {},
      completedText: () => "Done",
    });
    const manager = new ConnectionManager([restarted]);
    expect(await manager.read("chatgpt")).toMatchObject({
      value: { state: "connected", last_account_email: "one@example.test" },
    });
    manager.dispose();
    await f.manager.disconnect("chatgpt");
    expect(await f.store.readSession()).toEqual({ status: "absent" });
    expect(f.registration).toBe(JSON.stringify(reg));
    const authorization = await f.begin();
    expect(authorization.searchParams.get("client_id")).toBe("client-one");
    expect(authorization.searchParams.has("agent_name_hint")).toBe(false);
    expect(authorization.searchParams.get("ext_agent_host_id")).toBe(reg.host);
    await f.callback({ error: "access_denied" });
    await f.wait();
    expect(f.manager.snapshot("chatgpt")).toMatchObject({
      state: "error",
      reason: "plan_use_not_allowed",
      last_account_email: reg.email,
    });
  });
  it("binds only IPv4 loopback and varies fresh 32-byte state, nonce and S256 verifier each attempt", async () => {
    const f = fixture();
    const first = await f.begin();
    expect(first.origin + first.pathname).toBe(chatGPTEndpoints.authorize);
    const p = first.searchParams;
    expect(p.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    for (const k of ["state", "nonce"])
      expect(Buffer.from(p.get(k)!, "base64url")).toHaveLength(32);
    expect(p.get("client_id")).toBe("dynamic_agent_client");
    expect(p.get("agent_name_hint")).toBe("Ohtia");
    expect(p.get("scope")).toBe(
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    );
    expect(p.get("code_challenge_method")).toBe("S256");
    await f.callback();
    await f.wait();
    const exchange = f.requests.find(
      (r) => r.body?.get("grant_type") === "authorization_code",
    )!.body!;
    expect(exchange.get("redirect_uri")).toBe(p.get("redirect_uri"));
    expect(exchange.get("resource")).toBe(chatGPTEndpoints.resource);
    expect(exchange.get("client_id")).toBe("client-one");
    expect(Buffer.from(exchange.get("code_verifier")!, "base64url")).toHaveLength(32);
    expect(createHash("sha256").update(exchange.get("code_verifier")!).digest("base64url")).toBe(
      p.get("code_challenge"),
    );
    await f.manager.disconnect("chatgpt");
    const next = await f.begin();
    for (const k of ["state", "nonce", "code_challenge"])
      expect(next.searchParams.get(k)).not.toBe(p.get(k));
    await f.manager.disconnect("chatgpt");
  });
  it("rejects bad paths and state without consuming the wait and consumes a callback once", async () => {
    const f = fixture();
    await f.begin();
    expect((await f.callback({}, "/other")).status).toBe(404);
    expect((await f.callback({ state: "wrong" })).status).toBe(400);
    const missing = new URL(f.authorization.searchParams.get("redirect_uri")!);
    expect((await fetch(missing)).status).toBe(400);
    expect(f.manager.snapshot("chatgpt")?.state).toBe("connecting");
    expect(f.requests).toHaveLength(0);
    const success = await f.callback();
    expect(await success.text()).toBe("You can close this tab and return to Ohtia.");
    await f.wait();
    await expect(f.callback()).rejects.toThrow();
    expect(f.requests.filter((r) => r.url === chatGPTEndpoints.token)).toHaveLength(1);
  });
  it.each(["access_denied", "server_error"])(
    "handles callback %s without exchanging or storing",
    async (error) => {
      const f = fixture();
      await f.begin();
      await f.callback({ error });
      await f.wait();
      expect(f.requests).toHaveLength(0);
      expect(f.entries.size).toBe(0);
      expect(f.manager.snapshot("chatgpt")).toMatchObject({
        state: "error",
        reason: error === "access_denied" ? "plan_use_not_allowed" : "sign_in_rejected",
      });
    },
  );
  it.each([
    "signature",
    "issuer",
    "audience",
    "expiration",
    "nonce",
    "subject",
    "email",
    "exchange",
    "client",
  ])("rejects an invalid %s without storing", async (invalid) => {
    const f = fixture();
    if (invalid === "signature") f.badSignature = true;
    if (invalid === "issuer") f.claims = { iss: "https://attacker.example" };
    if (invalid === "audience") f.claims = { aud: "another-client" };
    if (invalid === "expiration") f.claims = { exp: 1 };
    if (invalid === "nonce") f.claims = { nonce: "another-nonce" };
    if (invalid === "subject") f.claims = { sub: "" };
    if (invalid === "email") f.claims = { email: "" };
    if (invalid === "exchange") f.exchangeFailure = true;
    await f.begin();
    await f.callback(invalid === "client" ? { client_id: "" } : {});
    await f.wait();
    expect(f.manager.snapshot("chatgpt")).toMatchObject({
      state: "error",
      reason: "sign_in_rejected",
      last_account_email: null,
    });
    expect(f.entries.size).toBe(0);
  });
  it("requires an issued first client and rejects a returning client or identity change", async () => {
    const f = fixture();
    await f.begin();
    const url = new URL(f.authorization.searchParams.get("redirect_uri")!);
    url.search = new URLSearchParams({
      state: f.authorization.searchParams.get("state")!,
      code: "synthetic",
    }).toString();
    await fetch(url);
    await f.wait();
    expect(f.entries.size).toBe(0);
    await f.login();
    await f.manager.disconnect("chatgpt");
    const old = f.registration;
    await f.begin();
    await f.callback({ client_id: "other" });
    await f.wait();
    expect(f.registration).toBe(old);
    f.claims = { sub: "attacker" };
    await f.login();
    expect(f.registration).toBe(old);
    expect(f.manager.snapshot("chatgpt")?.reason).toBe("sign_in_rejected");
  });
  it("keeps a valid identity without plan permission and probes no models", async () => {
    const f = fixture();
    f.scope = "openid email";
    expect(await f.login()).toMatchObject({
      state: "error",
      reason: "plan_use_not_allowed",
      last_account_email: "one@example.test",
    });
    expect(await f.store.readSession()).toMatchObject({
      value: { reason: "plan_use_not_allowed" },
    });
    f.manager.probe("chatgpt");
    await vi.waitFor(() => {
      expect(f.manager.snapshot("chatgpt")?.probing).toBe(false);
    });
    expect(f.requests.some((r) => r.url === chatGPTEndpoints.models)).toBe(false);
  });
  it("cancels and times out with a closed listener and keeps the previous registration", async () => {
    const f = fixture();
    await f.login();
    await f.manager.disconnect("chatgpt");
    const old = f.registration;
    await f.begin(true);
    const redirect = f.authorization.searchParams.get("redirect_uri")!;
    await f.manager.disconnect("chatgpt");
    expect(f.manager.snapshot("chatgpt")).toMatchObject({ state: "disconnected", reason: null });
    await expect(fetch(redirect)).rejects.toThrow();
    expect(f.registration).toBe(old);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = f.begin(true);
    await vi.advanceTimersByTimeAsync(60);
    await pending;
    await vi.advanceTimersByTimeAsync(portLimits.sign_in_wait_ms);
    expect(f.manager.snapshot("chatgpt")).toMatchObject({
      state: "disconnected",
      reason: "sign_in_timeout",
      last_account_email: "one@example.test",
    });
    expect(f.registration).toBe(old);
    await expect(f.callback()).rejects.toThrow();
  });
  it.each(["denied", "exchange", "token"])(
    "preserves the old account after another-account %s failure",
    async (failure) => {
      const f = fixture();
      await f.login();
      await f.manager.disconnect("chatgpt");
      const old = f.registration;
      f.account = "two";
      if (failure === "exchange") f.exchangeFailure = true;
      if (failure === "token") f.badSignature = true;
      await f.begin(true);
      expect(f.authorization.searchParams.get("client_id")).toBe("dynamic_agent_client");
      await f.callback(failure === "denied" ? { error: "access_denied" } : {});
      await f.wait();
      expect(f.registration).toBe(old);
      const next = await f.begin();
      expect(next.searchParams.get("client_id")).toBe("client-one");
    },
  );
  it("replaces one validated account while preserving its host, then uses only the new client and tokens", async () => {
    const f = fixture();
    await f.login();
    const old = JSON.parse(f.registration!);
    await f.manager.disconnect("chatgpt");
    f.account = "two";
    await f.login(true);
    expect(JSON.parse(f.registration!)).toEqual({
      ...old,
      client: "client-two",
      sub: "subject-two",
      email: "two@example.test",
    });
    expect(f.manager.snapshot("chatgpt")?.last_account_email).toBe("two@example.test");
    await f.adapter.renew();
    expect(f.requests.at(-1)?.body?.get("client_id")).toBe("client-two");
    await f.manager.disconnect("chatgpt");
    expect((await f.begin()).searchParams.get("client_id")).toBe("client-two");
  });
  it("fails before browser hand-off when the keyring or unlock is unavailable", async () => {
    const f = fixture();
    f.unavailable = true;
    f.manager.connect("chatgpt");
    await vi.waitFor(() => {
      expect(f.manager.snapshot("chatgpt")?.reason).toBe("store_unavailable");
    });
    expect(f.browser).not.toHaveBeenCalled();
    expect(f.entries.size).toBe(0);
    expect(f.manager.snapshot("chatgpt")?.last_account_email).toBeNull();
  });
});

describe("ChatGPT renewal and probes", () => {
  it.each([
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
    "invalid_client",
  ])("maps renewal %s without leaking the provider error", async (code) => {
    const f = fixture();
    await f.login();
    const old = f.registration;
    f.refreshError = code;
    await f.adapter.renew();
    expect(await f.store.readSession()).toEqual({ status: "absent" });
    expect(f.registration).toBe(code === "invalid_client" ? undefined : old);
    expect(f.manager.snapshot("chatgpt")).toMatchObject(
      code === "invalid_client"
        ? { state: "error", reason: "sign_in_rejected", last_account_email: null }
        : { state: "expired", reason: null, last_account_email: "one@example.test" },
    );
  });
  it("shares concurrent renewals, persists each rotation immediately and does not reread the store", async () => {
    const f = fixture();
    await f.login();
    const reads = f.accesses.length;
    const a = f.adapter.renew();
    const b = f.adapter.renew();
    expect(a).toBe(b);
    await a;
    expect(f.accesses.length).toBe(reads + 1);
    expect(JSON.stringify(await f.store.readSession())).toContain("refresh-one-2");
    await f.adapter.renew();
    expect(f.requests.at(-1)?.body?.get("refresh_token")).toBe("refresh-one-2");
    expect(JSON.stringify(await f.store.readSession())).toContain("refresh-one-3");
  });
  it.each([500, 503])("keeps session and connected state on temporary HTTP %s", async (status) => {
    const f = fixture();
    await f.login();
    const old = await f.store.readSession();
    f.refreshStatus = status;
    await f.adapter.renew();
    expect(await f.store.readSession()).toEqual(old);
    expect(f.manager.snapshot("chatgpt")?.state).toBe("connected");
  });
  it("never resurrects a session when sign-out races an in-flight renewal", async () => {
    const f = fixture();
    await f.login();
    let release!: () => void;
    f.delayRefresh = new Promise((resolve) => {
      release = resolve;
    });
    const renewal = f.adapter.renew();
    await f.manager.disconnect("chatgpt");
    release();
    await renewal;
    expect(await f.store.readSession()).toEqual({ status: "absent" });
    expect(f.manager.snapshot("chatgpt")?.state).toBe("disconnected");
  });
  it("lists only visible models in provider order and keeps the session after an unreachable probe", async () => {
    const f = fixture();
    await f.login();
    f.manager.probe("chatgpt");
    await vi.waitFor(() => {
      expect(f.manager.snapshot("chatgpt")?.probing).toBe(false);
    });
    expect(
      f.manager.listModels({
        connection: "chatgpt",
        model_list_revision: 1,
        cursor: 0,
        count: 128,
      }),
    ).toMatchObject({
      value: {
        models: [
          { id: "first", name: "First" },
          { id: "second", name: "Second" },
        ],
      },
    });
    const old = await f.store.readSession();
    f.models = {};
    f.manager.probe("chatgpt");
    await vi.waitFor(() => {
      expect(f.manager.snapshot("chatgpt")?.probing).toBe(false);
    });
    expect(await f.store.readSession()).toEqual(old);
    expect(f.manager.snapshot("chatgpt")?.state).toBe("connected");
  });
  it("bounds a chunked provider body before parsing", async () => {
    await expect(providerJSON(new Response("x".repeat(4 * 1024 * 1024 + 1)))).rejects.toThrow(
      "bound",
    );
  });
  it("projects no remembered email, registration or session onto the private data-service channel", async () => {
    const f = fixture();
    await f.login();
    const sent: string[] = [];
    let exited: () => void = () => {};
    const supervisor = new ServiceSupervisor(
      {
        send: (text: string) => {
          sent.push(text);
        },
        kill: () => {},
        messages: () => {},
        exited: (listener: () => void) => {
          exited = listener;
        },
      } as never,
      "synthetic-generation",
      () => {},
    );
    // Reuse the real projection after supplying only its existing readiness precondition.
    Object.defineProperty(supervisor, "available", { value: true });
    expect(supervisor.reportConnections(f.manager)).toBe(true);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join("")).not.toMatch(
      /example.test|last_account_email|account_email|client-one|refresh-one|access-one/,
    );
    for (const text of sent)
      expect(decodeConnectionReport(text, "synthetic-generation")).toBeDefined();
    exited();
    await supervisor.stop();
    expect(
      decodeConnectionReport(
        JSON.stringify({
          kind: "connection_state",
          generation: "synthetic-generation",
          snapshot: f.manager.snapshot("chatgpt"),
        }),
        "synthetic-generation",
      ),
    ).toBeUndefined();
  });
  it("isolates two development roots from each other and the installed service even with a development override", async () => {
    const entries = new Map<string, string>();
    const context = (mode: "development" | "installed", root: string) =>
      ({ mode, configuration_root: `${root}/settings` }) as RuntimeContext;
    const first = credentialService(context("development", "/one"));
    const second = credentialService(context("development", "/two"));
    expect(first).not.toBe(second);
    const a = fixture({ entries, service: first });
    const b = fixture({ entries, service: second });
    b.account = "two";
    await Promise.all([a.login(), b.login()]);
    await Promise.all([a.adapter.renew(), b.adapter.renew()]);
    await a.manager.disconnect("chatgpt");
    expect(await b.store.readSession()).toMatchObject({ status: "stored" });
    vi.stubEnv("OHTIA_DEVELOPMENT_ROOT", "/ignored-development-root");
    const installed = credentialService(context("installed", "/ignored-development-root"));
    expect(installed).toBe("Ohtia");
    const c = fixture({ entries, service: installed });
    await c.login();
    await c.adapter.renew();
    await c.manager.disconnect("chatgpt");
    expect(c.accesses.every((key) => key.startsWith("Ohtia/"))).toBe(true);
    expect(await b.store.readSession()).toMatchObject({ status: "stored" });
  });
  it("distinguishes a missing Windows session file from a corrupted file after restart", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-chatgpt-test-"));
    roots.push(root);
    const f = fixture({ platform: "win32", userData: root });
    await f.login();
    const file = path.join(root, "provider-sessions.enc");
    fs.writeFileSync(file, "corrupted");
    expect(await f.manager.read("chatgpt")).toMatchObject({
      value: { state: "expired", last_account_email: "one@example.test" },
    });
    fs.unlinkSync(file);
    const next = fixture({ platform: "win32", userData: root, entries: f.entries });
    expect(await next.manager.read("chatgpt")).toMatchObject({
      value: { state: "disconnected", last_account_email: "one@example.test" },
    });
  });
});

it("renews automatically near expiry without a caller and retains the newest token after a persistence outage", async () => {
  const f = fixture();
  await f.login();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await f.adapter.credentials.read();
  await vi.advanceTimersByTimeAsync(3540000);
  expect(JSON.stringify(await f.store.readSession())).toContain("refresh-one-2");
  f.failWrite = "chatgpt-session";
  await f.adapter.renew();
  expect(f.manager.snapshot("chatgpt")?.reason).toBe("store_unavailable");
  f.failWrite = "";
  expect(await f.manager.read("chatgpt")).toMatchObject({
    value: { state: "connected", reason: null, account_email: "one@example.test" },
  });
  expect(JSON.stringify(await f.store.readSession())).toContain("refresh-one-3");
  await f.adapter.renew();
  expect(f.requests.at(-1)?.body?.get("refresh_token")).toBe("refresh-one-3");
});
it("keeps the previous registration and rolls back the session when account publication fails", async () => {
  const f = fixture();
  await f.login();
  const reg = f.registration;
  await f.manager.disconnect("chatgpt");
  f.account = "two";
  f.failWrite = "chatgpt-registration";
  await f.login(true);
  expect(f.registration).toBe(reg);
  expect(await f.store.readSession()).toEqual({ status: "absent" });
  expect(f.manager.snapshot("chatgpt")?.reason).toBe("store_unavailable");
});
it("keeps the session and connected state after a network renewal failure", async () => {
  const f = fixture();
  await f.login();
  const old = await f.store.readSession();
  f.request.mockRejectedValueOnce(new Error("synthetic-private-network-detail"));
  await f.adapter.renew();
  expect(await f.store.readSession()).toEqual(old);
  expect(f.manager.snapshot("chatgpt")?.state).toBe("connected");
  expect(JSON.stringify(f.diagnostics)).not.toContain("synthetic-private-network-detail");
});
it("keeps a first-use timeout disconnected without creating a remembered registration", async () => {
  const f = fixture();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const pending = f.begin();
  await vi.advanceTimersByTimeAsync(60);
  await pending;
  await vi.advanceTimersByTimeAsync(portLimits.sign_in_wait_ms);
  expect(f.manager.snapshot("chatgpt")).toMatchObject({
    state: "disconnected",
    reason: "sign_in_timeout",
    last_account_email: null,
  });
  expect(f.entries.size).toBe(0);
  await expect(f.callback()).rejects.toThrow();
});
it("does not consume a callback for a POST or duplicated state parameter", async () => {
  const f = fixture();
  await f.begin();
  const url = new URL(f.authorization.searchParams.get("redirect_uri")!);
  url.search = new URLSearchParams({
    state: f.authorization.searchParams.get("state")!,
  }).toString();
  expect((await fetch(url, { method: "POST" })).status).toBe(400);
  url.searchParams.append("state", url.searchParams.get("state")!);
  expect((await fetch(url)).status).toBe(400);
  expect(f.requests).toHaveLength(0);
  await f.callback();
  await f.wait();
  expect(f.manager.snapshot("chatgpt")?.state).toBe("connected");
});

it.each([{ alg: "none" }, { alg: "HS256" }, { kid: "unknown" }, { crit: ["unrecognized"] }])(
  "rejects unsupported identity header %j",
  async (header) => {
    const f = fixture();
    f.tokenHeader = header;
    await f.login();
    expect(f.manager.snapshot("chatgpt")).toMatchObject({
      state: "error",
      reason: "sign_in_rejected",
    });
    expect(f.entries.size).toBe(0);
  },
);
it.each([{ nbf: 99999999999 }, { iat: 99999999999 }, { aud: ["client-one", "another-client"] }])(
  "rejects identity claims outside the accepted context %j",
  async (claims) => {
    const f = fixture();
    f.claims = claims;
    await f.login();
    expect(f.manager.snapshot("chatgpt")?.reason).toBe("sign_in_rejected");
    expect(f.entries.size).toBe(0);
  },
);
it("uses only the fixed JWKS source even when the JWT header names an untrusted key URL", async () => {
  const f = fixture();
  f.tokenHeader = {
    jku: "https://untrusted.example/keys",
    x5u: "https://untrusted.example/certificate",
  };
  await f.login();
  expect(f.manager.snapshot("chatgpt")?.state).toBe("connected");
  expect(f.requests.every((r) => Object.values(chatGPTEndpoints).includes(r.url))).toBe(true);
});

it("cancels another-account sign-in without deleting the previously validated session or resuming it", async () => {
  const f = fixture();
  f.scope = "openid email";
  await f.login();
  const old = await f.store.readSession();
  const reg = f.registration;
  await f.begin(true);
  await f.manager.disconnect("chatgpt");
  expect(await f.store.readSession()).toEqual(old);
  expect(f.registration).toBe(reg);
  const requests = f.requests.length;
  await f.adapter.renew();
  expect(f.requests).toHaveLength(requests);
  expect(f.manager.snapshot("chatgpt")).toMatchObject({ state: "disconnected", reason: null });
});
it("times out another-account sign-in without changing a kept session", async () => {
  const f = fixture();
  f.scope = "openid email";
  await f.login();
  const old = await f.store.readSession();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const pending = f.begin(true);
  await vi.advanceTimersByTimeAsync(60);
  await pending;
  await vi.advanceTimersByTimeAsync(portLimits.sign_in_wait_ms);
  expect(f.manager.snapshot("chatgpt")?.reason).toBe("sign_in_timeout");
  expect(await f.store.readSession()).toEqual(old);
});
it("rolls back a validated replacement when cancellation arrives during persistence", async () => {
  const f = fixture();
  f.scope = "openid email";
  await f.login();
  const old = await f.store.readSession();
  const reg = f.registration;
  const original = f.store.writeSession.bind(f.store);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = vi.spyOn(f.store, "writeSession").mockImplementationOnce(async (value) => {
    await wait;
    return original(value);
  });
  f.account = "two";
  await f.begin(true);
  await f.callback();
  await vi.waitFor(() => {
    expect(write).toHaveBeenCalled();
  });
  const cancellation = f.manager.disconnect("chatgpt");
  release();
  expect(await cancellation).toMatchObject({ value: { state: "disconnected", reason: null } });
  await f.adapter.credentials.read();
  expect(await f.store.readSession()).toEqual(old);
  expect(f.registration).toBe(reg);
  expect(f.manager.snapshot("chatgpt")?.state).toBe("disconnected");
});

it.each(["plan_use_not_allowed", "sign_in_rejected"] as const)(
  "preserves the kept-session reason %s across successful renewal",
  async (reason) => {
    const f = fixture();
    await f.login();
    const current = await f.store.readSession();
    expect(current.status).toBe("stored");
    if (current.status !== "stored") throw new Error("Missing synthetic session.");
    await f.adapter.credentials.write({ ...current.value, reason });
    await f.manager.read("chatgpt");
    await f.adapter.renew();
    expect(await f.store.readSession()).toMatchObject({ value: { reason } });
    expect(f.manager.snapshot("chatgpt")).toMatchObject({ state: "error", reason });
    f.failWrite = "chatgpt-session";
    await f.adapter.renew();
    f.failWrite = "";
    expect(await f.manager.read("chatgpt")).toMatchObject({ value: { state: "error", reason } });
  },
);

it("shows the returning session's validated email without rewriting the remembered registration", async () => {
  const f = fixture();
  await f.login();
  const reg = f.registration;
  await f.manager.disconnect("chatgpt");
  f.claims = { email: "updated@example.test" };
  await f.login();
  expect(f.manager.snapshot("chatgpt")).toMatchObject({
    account_email: "updated@example.test",
    last_account_email: "one@example.test",
  });
  await f.manager.read("chatgpt");
  expect(f.manager.snapshot("chatgpt")?.account_email).toBe("updated@example.test");
  expect(f.registration).toBe(reg);
  expect(JSON.stringify(await f.store.readSession())).not.toContain("updated@example.test");
  await f.manager.disconnect("chatgpt");
  expect(f.manager.snapshot("chatgpt")).toMatchObject({
    account_email: null,
    last_account_email: "one@example.test",
  });
});
it("rejects a control-bearing email before it can exceed escaped public snapshot bounds", async () => {
  const f = fixture();
  f.claims = { email: "\u0000".repeat(4096) };
  await f.login();
  expect(f.manager.snapshot("chatgpt")?.reason).toBe("sign_in_rejected");
  expect(f.entries.size).toBe(0);
});

it("retains an in-flight rotation when another-account sign-in is cancelled without reconnecting", async () => {
  const f = fixture();
  f.scope = "openid email";
  await f.login();
  let release!: () => void;
  f.delayRefresh = new Promise((resolve) => {
    release = resolve;
  });
  const renewal = f.adapter.renew();
  await f.begin(true);
  await f.manager.disconnect("chatgpt");
  release();
  await renewal;
  expect(JSON.stringify(await f.store.readSession())).toContain("refresh-one-2");
  expect(f.manager.snapshot("chatgpt")).toMatchObject({ state: "disconnected", reason: null });
});
it("publishes a validated replacement only after the old-account renewal finishes", async () => {
  const f = fixture();
  f.scope = "openid email";
  await f.login();
  let release!: () => void;
  f.delayRefresh = new Promise((resolve) => {
    release = resolve;
  });
  const renewal = f.adapter.renew();
  f.account = "two";
  f.scope = "chatgpt.tokens.use.direct";
  await f.begin(true);
  await f.callback();
  expect(f.manager.snapshot("chatgpt")?.state).toBe("connecting");
  release();
  await renewal;
  await f.wait();
  expect(JSON.stringify(await f.store.readSession())).toContain("refresh-two-2");
  expect(f.manager.snapshot("chatgpt")).toMatchObject({
    state: "connected",
    account_email: "two@example.test",
    last_account_email: "two@example.test",
  });
});
it.each(["http", "shape", "empty_body"])(
  "rejects an unavailable or malformed JWKS response: %s",
  async (failure) => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (url, init) => {
      if (String(url) !== chatGPTEndpoints.keys) return original(url, init);
      return failure === "http"
        ? Response.json({}, { status: 503 })
        : failure === "shape"
          ? Response.json({})
          : new Response(null);
    });
    await f.login();
    expect(f.manager.snapshot("chatgpt")).toMatchObject({
      state: "error",
      reason: "sign_in_rejected",
      last_account_email: null,
    });
    expect(f.entries.size).toBe(0);
  },
);
it("closes the listener and stores nothing when the system browser hand-off fails", async () => {
  const f = fixture();
  f.browser.mockRejectedValueOnce(new Error("Synthetic private browser failure."));
  f.manager.connect("chatgpt");
  await vi.waitFor(() => {
    expect(f.manager.snapshot("chatgpt")?.reason).toBe("sign_in_rejected");
  });
  const url = new URL(f.browser.mock.calls[0][0]);
  await expect(fetch(url.searchParams.get("redirect_uri")!)).rejects.toThrow();
  expect(f.entries.size).toBe(0);
  expect(f.requests).toHaveLength(0);
  expect(JSON.stringify(f.diagnostics)).not.toContain("Synthetic private browser failure");
});
it.each(["corrupt", "invalid_shape", "another_account"])(
  "never uses a session with an unusable registration/session pair: %s",
  async (invalid) => {
    const f = fixture();
    await f.login();
    if (invalid === "another_account") {
      const previous = JSON.parse(f.registration!);
      await f.store.write(
        "chatgpt-registration",
        JSON.stringify({
          ...previous,
          client: "client-two",
          sub: "subject-two",
          email: "two@example.test",
        }),
      );
    } else
      await f.store.writeSession({
        credential: invalid === "corrupt" ? "not-json" : JSON.stringify({ client: "client-one" }),
        reason: null,
      });
    expect(await f.manager.read("chatgpt")).toMatchObject({
      value: { state: "expired", account_email: null },
    });
    f.manager.probe("chatgpt");
    await vi.waitFor(() => {
      expect(f.manager.snapshot("chatgpt")?.probing).toBe(false);
    });
    expect(f.requests.some((request) => request.url === chatGPTEndpoints.models)).toBe(false);
  },
);
it.each(["http", "entry", "name"])(
  "keeps the session and previous models after a failed provider model response: %s",
  async (invalid) => {
    const f = fixture();
    await f.login();
    const session = await f.store.readSession();
    expect(f.manager.storeModels("chatgpt", [{ id: "prior", name: "Prior" }])).toBe(true);
    if (invalid === "http") {
      const original = f.request.getMockImplementation()!;
      f.request.mockImplementation(async (url, init) =>
        String(url) === chatGPTEndpoints.models
          ? Response.json({}, { status: 503 })
          : original(url, init),
      );
    } else
      f.models = {
        models: [
          invalid === "entry" ? null : { visibility: "list", slug: "valid", display_name: "" },
        ],
      };
    const events: unknown[] = [];
    f.manager.subscribe((event) => {
      events.push(event);
    });
    f.manager.probe("chatgpt");
    await vi.waitFor(() => {
      expect(f.manager.snapshot("chatgpt")?.probing).toBe(false);
    });
    expect(events.at(-1)).toMatchObject({
      kind: "probe_result",
      outcome: "unreachable",
      model_list_revision: 1,
    });
    expect(await f.store.readSession()).toEqual(session);
    expect(
      f.manager.listModels({
        connection: "chatgpt",
        model_list_revision: 1,
        cursor: 0,
        count: 128,
      }),
    ).toMatchObject({ value: { models: [{ id: "prior", name: "Prior" }] } });
  },
);

it("times out from connect while native credential availability is still waiting and opens no late browser", async () => {
  const f = fixture();
  let release!: (value: { status: "absent" }) => void;
  const pending = new Promise<{ status: "absent" }>((resolve) => {
    release = resolve;
  });
  vi.spyOn(f.store, "read").mockImplementationOnce(() => pending);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  f.manager.connect("chatgpt");
  await vi.advanceTimersByTimeAsync(portLimits.sign_in_wait_ms);
  expect(f.manager.snapshot("chatgpt")).toMatchObject({
    state: "disconnected",
    reason: "sign_in_timeout",
  });
  expect(f.browser).not.toHaveBeenCalled();
  release({ status: "absent" });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.browser).not.toHaveBeenCalled();
  expect(f.entries.size).toBe(0);
});
it("keeps the connect deadline through an accepted callback and an unanswered token exchange", async () => {
  const f = fixture();
  const original = f.request.getMockImplementation()!;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.request.mockImplementationOnce(async (url, init) => {
    await wait;
    return original(url, init);
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const pending = f.begin();
  await vi.advanceTimersByTimeAsync(60);
  await pending;
  await f.callback();
  await vi.advanceTimersByTimeAsync(portLimits.sign_in_wait_ms);
  expect(f.manager.snapshot("chatgpt")).toMatchObject({
    state: "disconnected",
    reason: "sign_in_timeout",
  });
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.entries.size).toBe(0);
  await expect(f.callback()).rejects.toThrow();
});
it("accepts a returning callback without client_id using the exact stored registration", async () => {
  const f = fixture();
  await f.login();
  const registration = f.registration;
  await f.manager.disconnect("chatgpt");
  const authorization = await f.begin();
  const callback = new URL(authorization.searchParams.get("redirect_uri")!);
  callback.search = new URLSearchParams({
    state: authorization.searchParams.get("state")!,
    code: "synthetic-returning-code",
  }).toString();
  await fetch(callback);
  await f.wait();
  expect(f.manager.snapshot("chatgpt")?.state).toBe("connected");
  expect(f.registration).toBe(registration);
  expect(
    f.requests
      .filter((request) => request.url === chatGPTEndpoints.token)
      .at(-1)
      ?.body?.get("client_id"),
  ).toBe("client-one");
});

it("discards the previous account catalog only after a validated replacement is saved", async () => {
  const f = fixture();
  await f.login();
  f.manager.probe("chatgpt");
  await vi.waitFor(() => {
    expect(f.manager.snapshot("chatgpt")?.probing).toBe(false);
  });
  await f.manager.disconnect("chatgpt");
  f.account = "two";
  f.exchangeFailure = true;
  await f.login(true);
  expect(f.manager.snapshot("chatgpt")?.model_list_revision).toBe(1);
  f.exchangeFailure = false;
  await f.login(true);
  expect(f.manager.snapshot("chatgpt")).toMatchObject({
    state: "connected",
    account_email: "two@example.test",
    model_list_revision: null,
    model_count: 0,
    probe_id: null,
  });
  expect(
    f.manager.listModels({ connection: "chatgpt", model_list_revision: 1, cursor: 0, count: 128 }),
  ).toMatchObject({
    ok: false,
    error: { code: "stale_revision", parameters: { currentRevision: 0 } },
  });
  f.models = { models: [{ slug: "third", display_name: "Third", visibility: "list" }] };
  f.manager.probe("chatgpt");
  await vi.waitFor(() => {
    expect(f.manager.snapshot("chatgpt")?.probing).toBe(false);
  });
  expect(
    f.manager.listModels({ connection: "chatgpt", model_list_revision: 2, cursor: 0, count: 128 }),
  ).toMatchObject({ value: { models: [{ id: "third", name: "Third" }] } });
});

it.each(["invalid_grant", "invalid_client"])(
  "retries failed revocation cleanup and restores its actual state: %s",
  async (code) => {
    const f = fixture();
    await f.login();
    f.refreshError = code;
    if (code === "invalid_client")
      vi.spyOn(f.store, "delete").mockResolvedValueOnce({ status: "unavailable" });
    else vi.spyOn(f.store, "deleteSession").mockResolvedValueOnce({ status: "unavailable" });
    await f.adapter.renew();
    expect(f.manager.snapshot("chatgpt")).toMatchObject({
      state: "error",
      reason: "store_unavailable",
    });
    expect(await f.manager.read("chatgpt")).toMatchObject({
      value: {
        state: code === "invalid_client" ? "error" : "expired",
        reason: code === "invalid_client" ? "sign_in_rejected" : null,
        last_account_email: code === "invalid_client" ? null : "one@example.test",
      },
    });
    expect(await f.store.readSession()).toEqual({ status: "absent" });
  },
);

it("finishes an old rotation before saving a new account and rolls back to its latest token on failure", async () => {
  const f = fixture();
  await f.login();
  f.failWrite = "chatgpt-session";
  await f.adapter.renew();
  f.failWrite = "";
  const request = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (...args) => {
    const response = await request(...args);
    if (
      !(args[1]?.body instanceof URLSearchParams) ||
      args[1].body.get("grant_type") !== "refresh_token"
    )
      return response;
    return Response.json({
      ...((await response.json()) as object),
      access_token: "latest-prior-access",
      refresh_token: "latest-prior-token",
    });
  });
  let release!: () => void;
  f.delayRefresh = new Promise((resolve) => {
    release = resolve;
  });
  const renewal = f.adapter.renew();
  await vi.waitFor(() => {
    expect(f.requests.at(-1)?.body?.get("grant_type")).toBe("refresh_token");
  });
  await f.begin(true);
  f.account = "two";
  f.failWrite = "chatgpt-registration";
  await f.callback();
  expect(f.manager.snapshot("chatgpt")?.state).toBe("connecting");
  release();
  await renewal;
  await f.wait();
  expect(f.registration).toContain("client-one");
  expect(JSON.stringify(await f.store.readSession())).toContain("latest-prior-token");
  f.failWrite = "";
  expect(await f.manager.read("chatgpt")).toMatchObject({
    value: { state: "connected", reason: null },
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await f.adapter.credentials.read();
  const requests = f.requests.length;
  await vi.advanceTimersByTimeAsync(3540000);
  expect(f.requests.length).toBeGreaterThan(requests);
  expect(f.requests.at(-1)?.body?.get("refresh_token")).toBe("latest-prior-token");
  expect(f.manager.snapshot("chatgpt")?.state).toBe("connected");
});

it("accepts the case-insensitive OAuth bearer token type", async () => {
  const f = fixture();
  const request = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (...args) => {
    const response = await request(...args);
    if (String(args[0]) !== chatGPTEndpoints.token) return response;
    return Response.json({ ...((await response.json()) as object), token_type: "bearer" });
  });
  expect(await f.login()).toMatchObject({ state: "connected" });
});

it.each(["recover", "sign_out", "revoked"])(
  "retains and repairs the trusted pair when storage also fails during rollback: %s",
  async (action) => {
    const f = fixture();
    await f.login();
    f.failWrite = "chatgpt-session";
    await f.adapter.renew();
    f.failWrite = "";
    const registration = f.registration;
    vi.spyOn(f.store, "write").mockImplementationOnce(async () => {
      f.unavailable = true;
      return { status: "unavailable" };
    });
    f.account = "two";
    await f.login(true);
    expect(f.manager.snapshot("chatgpt")?.reason).toBe("store_unavailable");
    if (action === "recover") {
      await f.adapter.renew();
      expect(f.requests.at(-1)?.body?.get("refresh_token")).toBe("refresh-one-2");
    }
    f.unavailable = false;
    expect(JSON.stringify(await f.store.readSession())).toContain("client-two");
    if (action === "sign_out") {
      expect(await f.manager.disconnect("chatgpt")).toMatchObject({
        value: { state: "disconnected", reason: null },
      });
      expect(await f.manager.read("chatgpt")).toMatchObject({
        value: { state: "disconnected", last_account_email: "one@example.test" },
      });
      expect(await f.store.readSession()).toEqual({ status: "absent" });
    } else if (action === "revoked") {
      f.refreshError = "invalid_grant";
      await f.adapter.renew();
      expect(await f.manager.read("chatgpt")).toMatchObject({
        value: { state: "expired", last_account_email: "one@example.test" },
      });
      expect(await f.store.readSession()).toEqual({ status: "absent" });
    } else {
      expect(await f.manager.read("chatgpt")).toMatchObject({
        value: { state: "connected", account_email: "one@example.test" },
      });
      expect(JSON.stringify(await f.store.readSession())).toContain("refresh-two-4");
      await f.adapter.renew();
      expect(f.requests.at(-1)?.body?.get("refresh_token")).toBe("refresh-two-4");
    }
    expect(f.registration).toBe(registration);
  },
);

async function pausedPublication(previous: boolean, clock = false) {
  const f = fixture();
  if (previous) {
    f.scope = "openid email";
    await f.login();
  }
  const registration = f.registration;
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const published = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const write = f.store.write.bind(f.store);
  vi.spyOn(f.store, "write").mockImplementationOnce(async (...args) => {
    const saved = await write(...args);
    f.unavailable = true;
    reached();
    await gate;
    return saved;
  });
  f.account = "two";
  f.scope = "chatgpt.tokens.use.direct";
  if (clock) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const flow = (async () => {
    await f.begin(true);
    await f.callback();
  })();
  if (clock) await vi.advanceTimersByTimeAsync(60);
  await published;
  return { f, registration, release, flow };
}

it.each([true, false])(
  "reports failed cancellation cleanup before repairing a published registration, previous account: %s",
  async (previous) => {
    const { f, registration, release, flow } = await pausedPublication(previous);
    let acknowledged = false;
    const cancelled = f.manager.disconnect("chatgpt");
    void cancelled.then(() => {
      acknowledged = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(acknowledged).toBe(false);
    release();
    expect(await cancelled).toMatchObject({
      value: { state: "error", reason: "store_unavailable", last_account_email: null },
    });
    await flow;
    expect(f.manager.snapshot("chatgpt")?.reason).toBe("store_unavailable");
    f.unavailable = false;
    expect(await f.manager.read("chatgpt")).toMatchObject({
      value: {
        state: "disconnected",
        reason: null,
        last_account_email: previous ? "one@example.test" : null,
      },
    });
    expect(f.registration).toBe(registration);
    if (previous) expect(JSON.stringify(await f.store.readSession())).toContain("client-one");
    else expect(await f.store.readSession()).toEqual({ status: "absent" });
  },
);

it("reports failed timeout cleanup and restores its timeout message after storage repair", async () => {
  const { f, registration, release, flow } = await pausedPublication(true, true);
  await vi.advanceTimersByTimeAsync(portLimits.sign_in_wait_ms);
  expect(f.manager.snapshot("chatgpt")).toMatchObject({
    state: "disconnected",
    reason: "sign_in_timeout",
  });
  release();
  await flow;
  await vi.waitFor(() => {
    expect(f.manager.snapshot("chatgpt")?.reason).toBe("store_unavailable");
  });
  f.unavailable = false;
  expect(await f.manager.read("chatgpt")).toMatchObject({
    value: {
      state: "disconnected",
      reason: "sign_in_timeout",
      last_account_email: "one@example.test",
    },
  });
  expect(f.registration).toBe(registration);
  expect(JSON.stringify(await f.store.readSession())).toContain("client-one");
});
