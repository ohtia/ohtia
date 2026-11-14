import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fakeChatGPT,
  sse,
  streamResponse,
  syntheticReply,
  completedUsage,
} from "./fixtures/chatgpt.js";
import { conformanceRequest, dispatchThrough } from "./fixtures/provider-conformance.js";
import {
  classifyStatus,
  errorCode,
  forbiddenResponseFields,
  nodeResponsesTransport,
  isTransportFailure,
  reportedUsage,
  responsesEndpoint,
} from "../packages/main/src/chatgpt-responses.js";
import { chatGPTEndpoints } from "../packages/main/src/chatgpt-sign-in.js";
import type { ProviderEvent } from "@ohtia/contracts";

const fixtures: ReturnType<typeof fakeChatGPT>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.manager.dispose();
  vi.useRealTimers();
});
async function signedIn(options?: Parameters<typeof fakeChatGPT>[0]) {
  const f = fakeChatGPT(options);
  fixtures.push(f);
  expect(await f.login()).toMatchObject({ state: "connected" });
  return f;
}
function result(events: readonly ProviderEvent[]) {
  const last = events.at(-1);
  expect(last?.type).toBe("result");
  expect(events.filter((event) => event.type === "result")).toHaveLength(1);
  return last?.type === "result" ? last.result : undefined;
}
function text(events: readonly ProviderEvent[]): string {
  return events
    .filter((event) => event.type === "text")
    .map((event) => event.text)
    .join("");
}
function refreshes(f: ReturnType<typeof fakeChatGPT>): number {
  return f.requests.filter(
    (request) =>
      request.url === chatGPTEndpoints.token && request.body?.get("grant_type") === "refresh_token",
  ).length;
}

describe("ChatGPT requests over the Responses API", () => {
  it("keeps server order while selecting visible models after an earlier hidden entry", async () => {
    const f = await signedIn();
    f.models = {
      models: [
        { slug: "hidden-first", display_name: "Hidden", visibility: "hide" },
        { slug: "visible-first", display_name: "Visible first", visibility: "list" },
        { slug: "visible-second", display_name: "Visible second", visibility: "list" },
      ],
    };
    f.manager.refreshModels("chatgpt", true);
    await vi.waitFor(() => {
      expect(f.manager.snapshot("chatgpt")?.probing).toBe(false);
    });
    const snapshot = f.manager.snapshot("chatgpt")!;
    expect(
      f.manager.listModels({
        connection: "chatgpt",
        model_list_revision: snapshot.model_list_revision!,
        cursor: 0,
        count: 20,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        models: [
          { id: "visible-first", name: "Visible first" },
          { id: "visible-second", name: "Visible second" },
        ],
      },
    });
  });
  it("sends only Ohtia's instructions and input with store false and stream true", async () => {
    const f = await signedIn();
    f.responses = (request) =>
      streamResponse(syntheticReply, {
        signal: request.signal,
        headers: { "x-request-id": "req_synthetic-1" },
      });
    const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
    expect(f.responseRequests).toHaveLength(1);
    const [sent] = f.responseRequests;
    expect(sent!.body).toEqual({
      model: "first",
      instructions: "Synthetic conformance instructions.",
      input: [{ role: "user", content: "Synthetic conformance message." }],
      store: false,
      stream: true,
    });
    for (const field of forbiddenResponseFields) expect(sent!.body).not.toHaveProperty(field);
    expect(sent!.headers.Authorization).toMatch(/^Bearer access-one-/);
    expect(events).toEqual([
      { sequence: 1, type: "started", provider_request_id: "req_synthetic-1", model: "first" },
      { sequence: 2, type: "text", text: "Synthetic " },
      { sequence: 3, type: "text", text: "reply." },
      {
        sequence: 4,
        type: "usage",
        usage: { input_tokens: 41, cached_input_tokens: 0, output_tokens: 7, reasoning_tokens: 3 },
      },
      { sequence: 5, type: "result", result: { status: "completed" } },
    ]);
    // Nothing main forwards to the data service carries the credential.
    expect(JSON.stringify(events)).not.toMatch(/access-one|refresh-one/);
  });

  it.each([
    [401, { detail: "synthetic-private-detail" }, "connection_expired", "connected", true],
    [403, { detail: "synthetic-private-detail" }, "not_eligible", "connected", false],
    [503, { detail: "synthetic-private-detail" }, "provider_unavailable", "connected", false],
    [403, "subscription_sharing_user_not_eligible", "not_eligible", "connected", false],
    [429, "subscription_sharing_usage_limit_exceeded", "usage_limit_reached", "connected", false],
    [503, "subscription_sharing_usage_unavailable", "provider_unavailable", "connected", false],
    [503, "subscription_sharing_user_unavailable", "provider_unavailable", "connected", false],
    [400, "subscription_sharing_unsupported_capability", "request_rejected", "connected", false],
    [403, "subscription_sharing_route_not_supported", "request_rejected", "connected", false],
    [401, "subscription_sharing_invalid_user", "connection_expired", "connected", true],
    [403, "chatpass_v2_scope_not_authorized", "request_rejected", "error", false],
    [403, "chatpass_v2_invalid_authorization_context", "request_rejected", "error", false],
    [404, "synthetic_unknown_code", "request_rejected", "connected", false],
    [429, "synthetic_unknown_code", "provider_unavailable", "connected", false],
    [500, "synthetic_unknown_code", "provider_unavailable", "connected", false],
    [502, { detail: "synthetic-private-detail" }, "provider_unavailable", "connected", false],
  ] as const)(
    "maps a %i %j before the stream to %s without repeating the request",
    async (status, error, reason, state, renews) => {
      const f = await signedIn();
      const before = refreshes(f);
      f.responses = () =>
        Response.json(
          typeof error === "string"
            ? { error: { code: error, message: "synthetic-private" } }
            : error,
          { status },
        );
      const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
      expect(result(events)).toEqual({ status: "failed", reason, dispatched: true });
      expect(f.responseRequests).toHaveLength(1);
      await vi.waitFor(() => {
        expect(refreshes(f) - before).toBe(renews ? 1 : 0);
      });
      await vi.waitFor(() => {
        expect(f.manager.snapshot("chatgpt")).toMatchObject({
          state,
          reason: state === "error" ? "sign_in_rejected" : null,
        });
      });
      expect(JSON.stringify([events, f.diagnostics])).not.toMatch(/synthetic-private/);
    },
  );

  it("keeps a rejected grant's reason with the session across a restart until a new sign-in", async () => {
    const f = await signedIn();
    f.responses = () =>
      Response.json({ error: { code: "chatpass_v2_scope_not_authorized" } }, { status: 403 });
    await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
    await vi.waitFor(() => {
      expect(f.manager.snapshot("chatgpt")).toMatchObject({
        state: "error",
        reason: "sign_in_rejected",
      });
    });
    const restarted = fakeChatGPT({ entries: f.entries });
    fixtures.push(restarted);
    expect(await restarted.manager.read("chatgpt")).toMatchObject({
      value: { state: "error", reason: "sign_in_rejected" },
    });
    // A request after the restart sends nothing: the connection is not connected.
    const events = await dispatchThrough(
      restarted.manager,
      restarted.adapter,
      conformanceRequest("chatgpt"),
    );
    expect(result(events)).toEqual({
      status: "failed",
      reason: "connection_expired",
      dispatched: false,
    });
    expect(restarted.responseRequests).toHaveLength(0);
    // A new grant replaces the rejected one.
    expect(await restarted.login()).toMatchObject({ state: "connected", reason: null });
  });

  it.each([
    [
      "response.failed",
      [sse({ type: "response.failed", response: { error: { code: "server_error" } } })],
      { status: "failed", reason: "provider_error", dispatched: true },
    ],
    [
      "response.failed with a plan limit",
      [
        sse({
          type: "response.failed",
          response: { error: { code: "subscription_sharing_usage_limit_exceeded" } },
        }),
      ],
      { status: "failed", reason: "usage_limit_reached", dispatched: true },
    ],
    [
      "response.incomplete",
      [sse({ type: "response.incomplete", response: { incomplete_details: { reason: "x" } } })],
      { status: "failed", reason: "provider_error", dispatched: true },
    ],
    [
      "an error event",
      [sse({ type: "error", code: "server_error", message: "synthetic-private" })],
      { status: "failed", reason: "provider_error", dispatched: true },
    ],
    [
      "an unparsable event",
      ["data: {synthetic not json\n\n"],
      { status: "failed", reason: "invalid_output", dispatched: true },
    ],
    [
      "an event without a type",
      [`data: ${JSON.stringify({ delta: "x" })}\n\n`],
      { status: "failed", reason: "invalid_output", dispatched: true },
    ],
    [
      "a delta that is not text",
      [sse({ type: "response.output_text.delta", delta: 42 })],
      { status: "failed", reason: "invalid_output", dispatched: true },
    ],
    ["an end without a final event", [], { status: "uncertain", reason: "connection_lost" }],
  ] as const)(
    "ends a stream with %s and keeps the text received before it",
    async (_, tail, expected) => {
      const f = await signedIn();
      f.responses = (request) =>
        streamResponse(
          [
            sse({ type: "response.created", response: { model: "first" } }),
            sse({ type: "response.output_text.delta", delta: "Partial text" }),
            ...tail,
          ],
          { signal: request.signal },
        );
      const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
      expect(text(events)).toBe("Partial text");
      expect(result(events)).toEqual(expected);
      expect(JSON.stringify(events)).not.toMatch(/synthetic-private/);
      // The response is closed, never read past its end.
      expect(f.responseRequests[0]!.signal?.aborted).toBe(true);
    },
  );

  it("closes the response after unparsable output even while the stream stays open", async () => {
    const f = await signedIn();
    f.responses = (request) =>
      streamResponse(
        [sse({ type: "response.output_text.delta", delta: "Kept" }), "data: [broken\n\n"],
        { open: true, signal: request.signal },
      );
    const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
    expect(text(events)).toBe("Kept");
    expect(result(events)).toMatchObject({ reason: "invalid_output" });
    expect(f.responseRequests[0]!.signal?.aborted).toBe(true);
  });

  it("marks a connection dropped after the request left as uncertain", async () => {
    const f = await signedIn();
    f.responses = (request) =>
      streamResponse([sse({ type: "response.output_text.delta", delta: "Half" })], {
        drop: true,
        signal: request.signal,
      });
    const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
    expect(text(events)).toBe("Half");
    expect(result(events)).toEqual({ status: "uncertain", reason: "connection_lost" });
  });

  it.each(["ENOTFOUND", "ECONNREFUSED", "ERR_TLS_CERT_ALTNAME_INVALID"])(
    "marks a connection that never opened (%s) as not dispatched",
    async (code) => {
      const f = await signedIn();
      f.connectFailure = code;
      const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
      expect(result(events)).toEqual({
        status: "failed",
        reason: "provider_unavailable",
        dispatched: false,
      });
      expect(f.responseRequests).toHaveLength(0);
    },
  );
  it("marks a connection lost after the request left as uncertain", async () => {
    const f = await signedIn();
    f.responses = () => {
      throw Object.assign(new Error("x"), { code: "ECONNRESET" });
    };
    const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
    expect(result(events)).toEqual({ status: "uncertain", reason: "connection_lost" });
  });
  it("refuses a permit that a slow connection setup aged past two seconds, sending nothing", async () => {
    const f = await signedIn();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    let open!: () => void;
    f.connecting = new Promise((resolve) => {
      open = resolve;
    });
    const running = dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
    await vi.waitFor(() => {
      expect(f.adapter.requests).toBeDefined();
    });
    vi.setSystemTime(Date.now() + 2500);
    open();
    expect(result(await running)).toEqual({
      status: "failed",
      reason: "permit_expired",
      dispatched: false,
    });
    expect(f.responseRequests).toHaveLength(0);
  });

  it("records only reported usage and leaves the rest unknown", () => {
    expect(reportedUsage(undefined)).toBeUndefined();
    expect(reportedUsage({ output_tokens: 5 })).toEqual({
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: 5,
      reasoning_tokens: null,
    });
    expect(reportedUsage({ ...completedUsage, input_tokens: -1 })).toMatchObject({
      input_tokens: null,
    });
    expect(classifyStatus(418, undefined)).toEqual({ reason: "request_rejected" });
    expect(responsesEndpoint).toBe("https://api.openai.com/v1/responses");
  });
});

describe("ChatGPT session renewal before dispatch", () => {
  async function expiredSession(options: { refreshError?: string; refreshStatus?: number }) {
    const f = await signedIn();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    if (options.refreshError) f.refreshError = options.refreshError;
    if (options.refreshStatus) f.refreshStatus = options.refreshStatus;
    return f;
  }
  it("shares one renewal across three concurrent requests without losing their session", async () => {
    const f = await expiredSession({});
    let release!: () => void;
    f.delayRefresh = new Promise((resolve) => {
      release = resolve;
    });
    const before = refreshes(f);
    const requests = [1, 2, 3].map((index) =>
      dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt", `parallel-${index}`)),
    );
    await vi.waitFor(() => {
      expect(refreshes(f) - before).toBe(1);
    });
    release();
    const outcomes = await Promise.all(requests);
    expect(outcomes.map(result)).toEqual([
      { status: "completed" },
      { status: "completed" },
      { status: "completed" },
    ]);
    expect(refreshes(f) - before).toBe(1);
    expect(f.responseRequests).toHaveLength(3);
    expect(f.responseRequests.map((request) => request.headers.Authorization)).toEqual([
      "Bearer access-one-2",
      "Bearer access-one-2",
      "Bearer access-one-2",
    ]);
  });
  it("renews an expired session once and sends with the replacement", async () => {
    const f = await expiredSession({});
    const before = refreshes(f);
    const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
    expect(result(events)).toEqual({ status: "completed" });
    expect(refreshes(f) - before).toBe(1);
    expect(f.responseRequests[0]!.headers.Authorization).toMatch(/^Bearer access-one-2$/);
  });
  it.each([
    ["invalid_grant", "expired", null],
    ["refresh_token_reused", "expired", null],
    ["invalid_client", "error", "sign_in_rejected"],
  ] as const)(
    "sends nothing when OpenAI rejects the renewal with %s",
    async (code, state, reason) => {
      const f = await expiredSession({ refreshError: code });
      const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
      expect(result(events)).toEqual({
        status: "failed",
        reason: "connection_expired",
        dispatched: false,
      });
      expect(f.responseRequests).toHaveLength(0);
      expect(f.manager.snapshot("chatgpt")).toMatchObject({ state, reason });
    },
  );
  it("sends nothing and keeps the connection after a temporary renewal failure", async () => {
    const f = await expiredSession({ refreshStatus: 503 });
    const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
    expect(result(events)).toEqual({
      status: "failed",
      reason: "provider_unavailable",
      dispatched: false,
    });
    expect(f.responseRequests).toHaveLength(0);
    expect(f.manager.snapshot("chatgpt")).toMatchObject({ state: "connected", reason: null });
  });
  it("refuses a permit that a slow renewal aged past two seconds before the body leaves", async () => {
    const f = await expiredSession({});
    let release!: () => void;
    f.delayRefresh = new Promise((resolve) => {
      release = resolve;
    });
    const running = dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
    await vi.waitFor(() => {
      expect(refreshes(f)).toBe(1);
    });
    vi.setSystemTime(Date.now() + 2500);
    release();
    const events = await running;
    expect(result(events)).toEqual({
      status: "failed",
      reason: "permit_expired",
      dispatched: false,
    });
    expect(f.responseRequests).toHaveLength(0);
    // The renewal itself completed, so the connection stays usable.
    expect(f.manager.snapshot("chatgpt")?.state).toBe("connected");
  });
});

describe("the Node transport's release guard", () => {
  async function listening(server: net.Server): Promise<number> {
    server.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    return (server.address() as net.AddressInfo).port;
  }
  const transport = nodeResponsesTransport((url, options) => http.request(url, options));
  const request = (port: number) => ({
    url: `http://127.0.0.1:${String(port)}/v1/responses`,
    headers: { Authorization: "Bearer synthetic-access", "Content-Type": "application/json" },
    body: '{"model":"first"}',
    signal: new AbortController().signal,
  });
  it("releases on an established connection, then writes the request and streams the reply", async () => {
    const seen: string[] = [];
    const server = http.createServer((incoming, outgoing) => {
      let body = "";
      incoming.on("data", (chunk: Buffer) => (body += chunk.toString()));
      incoming.on("end", () => {
        seen.push(`request ${String(incoming.headers.authorization)} ${body}`);
        outgoing.writeHead(200, { "Content-Type": "text/event-stream", "x-request-id": "req_1" });
        outgoing.end("data: {}\n\n");
      });
    });
    const port = await listening(server);
    try {
      const response = await transport(request(port), () => {
        seen.push("release");
        return true;
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBe("req_1");
      expect(await response.text()).toBe("data: {}\n\n");
      expect(seen).toEqual(["release", 'request Bearer synthetic-access {"model":"first"}']);
    } finally {
      server.close();
    }
  });
  it("sends no request byte when the guard refuses on an open connection", async () => {
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      socket.on("data", (chunk) => received.push(chunk));
    });
    const port = await listening(server);
    try {
      let released = 0;
      const failure = await transport(request(port), () => {
        released++;
        return false;
      }).catch((error: unknown) => error);
      expect(isTransportFailure(failure) && failure.sent).toBe(false);
      expect(isTransportFailure(failure)).toBe(true);
      expect(released).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(Buffer.concat(received).byteLength).toBe(0);
    } finally {
      server.close();
    }
  });
  it("never releases when the connection cannot open, and knows a later loss was sent", async () => {
    const closed = net.createServer();
    const port = await listening(closed);
    await new Promise((resolve) => closed.close(resolve));
    const release = vi.fn(() => true);
    const refused = await transport(request(port), release).catch((error: unknown) => error);
    expect(refused).toMatchObject({ sent: false });
    expect(release).not.toHaveBeenCalled();
    const resetting = http.createServer((incoming) => {
      incoming.socket.destroy();
    });
    const resetPort = await listening(resetting);
    try {
      const lost = await transport(request(resetPort), () => true).catch((error: unknown) => error);
      expect(lost).toMatchObject({ sent: true });
    } finally {
      resetting.close();
    }
  });
});

it("records a rejected grant even after a renewal rotated the session's token", async () => {
  const f = await signedIn();
  f.responses = async () => {
    await f.adapter.renew();
    return Response.json({ error: { code: "chatpass_v2_scope_not_authorized" } }, { status: 403 });
  };
  const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
  expect(result(events)).toEqual({
    status: "failed",
    reason: "request_rejected",
    dispatched: true,
  });
  await vi.waitFor(() => {
    expect(f.manager.snapshot("chatgpt")).toMatchObject({
      state: "error",
      reason: "sign_in_rejected",
    });
  });
});

describe("Responses stream parsing edges", () => {
  async function run(pieces: readonly string[], options: { body?: boolean } = {}) {
    const f = await signedIn();
    f.responses = (request) =>
      options.body === false
        ? new Response(null, { status: 200 })
        : streamResponse(pieces, { signal: request.signal });
    return dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
  }
  it("accepts field lines, comments and data without a space, and ignores empty deltas", async () => {
    const events = await run([
      ": a comment\nid: 1\nretry: 10\n\n",
      `data:${JSON.stringify({ type: "response.in_progress" })}\n\n`,
      sse({ type: "response.output_text.delta", delta: "" }),
      sse({ type: "response.output_text.delta", delta: "Text" }),
      // A final event without its closing blank line still ends the stream.
      `data: ${JSON.stringify({ type: "response.completed", response: {} })}`,
    ]);
    expect(events[0]).toMatchObject({ type: "started", model: null });
    expect(text(events)).toBe("Text");
    expect(events.some((event) => event.type === "usage")).toBe(false);
    expect(result(events)).toEqual({ status: "completed" });
  });
  it.each([
    ["an unknown field line", ["unknown: x\n\n"]],
    ["a completed event without its response", [sse({ type: "response.completed" })]],
    ["bytes that are not UTF-8", []],
    ["an unfinished trailing event that cannot parse", ["data: {broken"]],
  ] as const)("fails with invalid output on %s", async (label, pieces) => {
    const f = await signedIn();
    f.responses = (request) =>
      label === "bytes that are not UTF-8"
        ? new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([0x64, 0x61, 0x74, 0x61, 0x3a, 0xff, 0xfe]));
                controller.close();
              },
            }),
          )
        : streamResponse(pieces, { signal: request.signal });
    const events = await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
    expect(result(events)).toEqual({
      status: "failed",
      reason: "invalid_output",
      dispatched: true,
    });
  });
  it("fails with invalid output when one event exceeds its bound", async () => {
    const events = await run([`data: ${"x".repeat(4 * 1024 * 1024 + 1)}`]);
    expect(result(events)).toEqual({
      status: "failed",
      reason: "invalid_output",
      dispatched: true,
    });
  });
  it("reads nested error codes and failures without a response, and a reply without a body", async () => {
    expect(
      result(
        await run([
          sse({ type: "error", error: { code: "subscription_sharing_user_not_eligible" } }),
        ]),
      ),
    ).toMatchObject({ reason: "not_eligible" });
    expect(result(await run([sse({ type: "response.failed" })]))).toMatchObject({
      reason: "provider_error",
    });
    expect(result(await run([], { body: false }))).toEqual({
      status: "uncertain",
      reason: "connection_lost",
    });
  });
  it("reads error codes only from bounded JSON bodies", async () => {
    expect(await errorCode(new Response(null, { status: 400 }))).toBeUndefined();
    expect(await errorCode(new Response("not json", { status: 400 }))).toBeUndefined();
    expect(
      await errorCode(Response.json({ error: { code: "synthetic" } }, { status: 400 }), 4),
    ).toBeUndefined();
    expect(await errorCode(Response.json({ error: { code: "synthetic" } }))).toBe("synthetic");
  });
});

describe("ChatGPT request guards inside the adapter", () => {
  it("sends nothing without a usable session and treats an unknown renewal error as temporary", async () => {
    const f = fakeChatGPT();
    fixtures.push(f);
    const emitted: unknown[] = [];
    await f.adapter.requests.send(conformanceRequest("chatgpt"), {
      release: () => true,
      emit: (event) => emitted.push(event),
      signal: new AbortController().signal,
    });
    expect(emitted).toEqual([
      {
        type: "result",
        result: { status: "failed", reason: "connection_expired", dispatched: false },
      },
    ]);
    const g = await signedIn();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    g.refreshError = "synthetic_unknown";
    expect(await g.adapter.requests.prepare(new AbortController().signal)).toBe("temporary");
  });
  it("reports an unavailable store when a rejected grant cannot be kept", async () => {
    const f = await signedIn();
    f.failWrite = "chatgpt-session";
    f.responses = () =>
      Response.json(
        { error: { code: "chatpass_v2_invalid_authorization_context" } },
        { status: 403 },
      );
    await dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
    await vi.waitFor(() => {
      expect(f.manager.snapshot("chatgpt")).toMatchObject({
        state: "error",
        reason: "store_unavailable",
      });
    });
  });
});

describe("the Node transport's connection states", () => {
  it("waits for the TLS handshake, or releases at once on an already connected socket", async () => {
    const { EventEmitter } = await import("node:events");
    for (const encrypted of [true, false]) {
      const order: string[] = [];
      const socket = Object.assign(new EventEmitter(), { encrypted, connecting: false });
      const outgoing = Object.assign(new EventEmitter(), {
        end: () => order.push("end"),
        destroy: () => order.push("destroy"),
      });
      const transport = nodeResponsesTransport(() => outgoing as unknown as http.ClientRequest);
      const pending = transport(
        {
          url: "https://api.openai.com/v1/responses",
          headers: {},
          body: "{}",
          signal: new AbortController().signal,
        },
        () => {
          order.push("release");
          return true;
        },
      );
      outgoing.emit("socket", socket);
      if (encrypted) {
        expect(order).toEqual([]);
        socket.emit("secureConnect");
      }
      expect(order).toEqual(["release", "end"]);
      const incoming = Object.assign(new (await import("node:stream")).PassThrough(), {
        statusCode: 204,
        headers: { "x-request-id": "req_2", "set-cookie": ["a", "b"] },
      });
      outgoing.emit("response", incoming);
      const response = await pending;
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
  it("uses Node's HTTPS client by default and never releases when it cannot connect", async () => {
    const closed = net.createServer();
    closed.listen(0, "127.0.0.1");
    await new Promise((resolve) => closed.once("listening", resolve));
    const port = (closed.address() as net.AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const release = vi.fn(() => true);
    const failure = await nodeResponsesTransport()(
      {
        url: `https://127.0.0.1:${String(port)}/v1/responses`,
        headers: {},
        body: "{}",
        signal: new AbortController().signal,
      },
      release,
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({ sent: false });
    expect(release).not.toHaveBeenCalled();
  });
});

it("sends nothing when the researcher signs out while the connection is opening", async () => {
  const f = await signedIn();
  let open!: () => void;
  f.connecting = new Promise((resolve) => {
    open = resolve;
  });
  const running = dispatchThrough(f.manager, f.adapter, conformanceRequest("chatgpt"));
  await vi.waitFor(() => {
    expect(open).toBeTypeOf("function");
  });
  await f.manager.disconnect("chatgpt");
  open();
  expect(result(await running)).toEqual({
    status: "failed",
    reason: "connection_expired",
    dispatched: false,
  });
  expect(f.responseRequests).toHaveLength(0);
});
