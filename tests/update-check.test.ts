import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeEnvelope,
  decodeUpdateStateNotice,
  isUpdateState,
  portLimits,
  utf8Size,
  type UpdateStateNotice,
} from "../packages/contracts/src/index.js";
import { UpdateBroker } from "../packages/main/src/update-broker.js";
import {
  latestReleaseUrl,
  newerFinal,
  noteParts,
  parseRelease,
  requestLatestRelease,
  type LatestRelease,
} from "../packages/main/src/update-check.js";
import { createStatusService } from "../packages/utility/dist/index.js";
import { preUpdateCheckSql } from "../tooling/storage-legacy-consultation-fixture.mjs";
import { request } from "./fixtures/port-corpus.js";
import { storageFixture as fixture } from "./fixtures/storage.js";

type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;
const servers: http.Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
async function serve(handler: Handler) {
  const seen: http.IncomingMessage[] = [];
  const server = http.createServer((incoming, response) => {
    seen.push(incoming);
    handler(incoming, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const requester = requestLatestRelease(
    (url, options) => http.request(url, options),
    `http://127.0.0.1:${port}/repos/ohtia/ohtia/releases/latest`,
  );
  return { requester, seen };
}
function release(tag: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tag_name: tag,
    draft: false,
    prerelease: false,
    body: "## Changes\r\n\r\n- <b>Faster</b> start",
    assets: [{ name: "Ohtia.deb", uploader: { login: "someone" } }],
    ...extra,
  });
}
const json =
  (body: string): Handler =>
  (_incoming, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(body);
  };
function broker(
  installedVersion: string,
  result: LatestRelease | Promise<LatestRelease>,
  permitted = true,
) {
  const notices: UpdateStateNotice[] = [];
  const requester = vi.fn((_signal: AbortSignal) => Promise.resolve(result));
  const updates = new UpdateBroker({
    installedVersion,
    permitted,
    requester,
    publish: (notice) => notices.push(notice),
  });
  return { updates, requester, notices };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("SPEC-001-040 latest-release request against a local server", () => {
  it("asks once with only the documented GET headers and reads a newer final version", async () => {
    const { requester, seen } = await serve(json(release("v0.3.0")));
    const result = await requester(new AbortController().signal);
    expect(result).toEqual({
      ok: true,
      version: "0.3.0",
      notes: "## Changes\r\n\r\n- <b>Faster</b> start",
    });
    expect(seen).toHaveLength(1);
    const incoming = seen[0]!;
    expect(incoming.method).toBe("GET");
    expect(incoming.url).toBe("/repos/ohtia/ohtia/releases/latest");
    expect(incoming.headers.accept).toBe("application/vnd.github+json");
    expect(incoming.headers["user-agent"]).toBe("Ohtia");
    expect(incoming.headers.cookie).toBeUndefined();
    expect(incoming.headers.authorization).toBeUndefined();
    expect(incoming.headers["content-length"]).toBeUndefined();
    expect(latestReleaseUrl).toBe("https://api.github.com/repos/ohtia/ohtia/releases/latest");
  });
  it("yields a notice only for a newer final version, never for equal, older or prerelease", async () => {
    for (const [tag, extra, expected] of [
      ["v0.3.0", {}, "0.3.0"],
      ["v0.2.0", {}, null],
      ["v0.1.9", {}, null],
      ["v0.3.0-rc.1", {}, "prerelease"],
      ["v0.3.0", { prerelease: true }, "prerelease"],
    ] as const) {
      const { requester } = await serve(json(release(tag, extra)));
      const result = await requester(new AbortController().signal);
      const { updates, notices } = broker("0.2.0", result);
      updates.startup(true);
      await flush();
      expect(result.ok).toBe(true);
      if (expected === "prerelease") expect(result).toMatchObject({ version: null });
      expect(notices.at(-1)?.state).toMatchObject({ check: "checked", failure: null });
      expect(notices.at(-1)?.state.available?.version ?? null).toBe(
        expected === "0.3.0" ? "0.3.0" : null,
      );
    }
    expect(newerFinal("0.10.0", "0.9.9")).toBe(true);
    expect(newerFinal("1.0.0", "0.99.99")).toBe(true);
    expect(newerFinal("0.2.10", "0.2.9")).toBe(true);
    expect(newerFinal("0.2.0", "0.2.0")).toBe(false);
    expect(newerFinal("0.2.0", "0.2.0-dev.1.1")).toBe(false);
  });
  it("reports a malformed, oversized, refused or slow response as a controlled failure", async () => {
    const malformed = await serve(json("{"));
    expect(await malformed.requester(new AbortController().signal)).toEqual({
      ok: false,
      failure: "invalid_response",
    });
    for (const body of [
      "[]",
      JSON.stringify({ tag_name: "latest", draft: false, prerelease: false, body: "" }),
      JSON.stringify({ tag_name: "v1.0.0", draft: false, prerelease: false, body: 4 }),
      JSON.stringify({ tag_name: "v1.0.0", prerelease: false, body: "" }),
    ])
      expect(parseRelease(Buffer.from(body))).toEqual({ ok: false, failure: "invalid_response" });
    expect(parseRelease(Uint8Array.from([0x7b, 0xff, 0x7d]))).toEqual({
      ok: false,
      failure: "invalid_response",
    });
    const declared = await serve((_incoming, response) => {
      response.writeHead(200, {
        "Content-Length": String(portLimits.update_check_response_bytes + 1),
      });
      response.write("{");
    });
    expect(await declared.requester(new AbortController().signal)).toEqual({
      ok: false,
      failure: "too_large",
    });
    const streamed = await serve((_incoming, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(release("v0.3.0", { body: "x".repeat(portLimits.update_check_response_bytes) }));
    });
    expect(await streamed.requester(new AbortController().signal)).toEqual({
      ok: false,
      failure: "too_large",
    });
    const refused = await serve((_incoming, response) => {
      response.writeHead(403);
      response.end("{}");
    });
    expect(await refused.requester(new AbortController().signal)).toEqual({
      ok: false,
      failure: "network",
    });
    const redirected = await serve((_incoming, response) => {
      response.writeHead(302, { Location: "https://example.invalid/" });
      response.end();
    });
    expect(await redirected.requester(new AbortController().signal)).toEqual({
      ok: false,
      failure: "network",
    });
    const slow = await serve(() => {
      /* Accept the request and never answer. */
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = slow.requester(new AbortController().signal);
    // vi.waitFor would advance the fake clock; poll on real immediates instead.
    while (slow.seen.length === 0) await flush();
    vi.advanceTimersByTime(portLimits.update_check_ms - 1);
    let settled: unknown;
    void pending.then((value) => (settled = value));
    await flush();
    expect(settled).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(await pending).toEqual({ ok: false, failure: "timeout" });
    expect(portLimits.update_check_ms).toBe(10000);
    expect(portLimits.update_check_response_bytes).toBe(262144);
  });
  it("fails without a request for an aborted signal, a refused open or an out-of-range version", async () => {
    const open = vi.fn(() => {
      throw new Error("refused");
    });
    const controller = new AbortController();
    controller.abort();
    expect(await requestLatestRelease(open)(controller.signal)).toEqual({
      ok: false,
      failure: "network",
    });
    expect(open).not.toHaveBeenCalled();
    expect(await requestLatestRelease(open)(new AbortController().signal)).toEqual({
      ok: false,
      failure: "network",
    });
    expect(open).toHaveBeenCalledOnce();
    expect(parseRelease(Buffer.from(release("v99999999999999999999.0.0")))).toEqual({
      ok: false,
      failure: "invalid_response",
    });
    expect(parseRelease(Buffer.from(release("v0.3.0", { body: null })))).toEqual({
      ok: true,
      version: "0.3.0",
      notes: "",
    });
  });
  it("reports a response that fails while its body arrives", async () => {
    const broken = await serve((_incoming, response) => {
      response.writeHead(200, { "Content-Length": "1000" });
      response.write("{");
      setImmediate(() => response.socket?.destroy());
    });
    expect(await broken.requester(new AbortController().signal)).toEqual({
      ok: false,
      failure: "network",
    });
  });
  it("stops the exchange when the application aborts it", async () => {
    const slow = await serve(() => {});
    const controller = new AbortController();
    const pending = slow.requester(controller.signal);
    await vi.waitFor(() => expect(slow.seen).toHaveLength(1));
    controller.abort();
    expect(await pending).toEqual({ ok: false, failure: "network" });
  });
});

describe("SPEC-001-040 update broker", () => {
  it("makes no startup request when the saved preference is disabled; the manual check still runs", async () => {
    const { updates, requester, notices } = broker("0.2.0", {
      ok: true,
      version: "0.3.0",
      notes: "",
    });
    updates.startup(false);
    updates.startup(true);
    await flush();
    expect(requester).not.toHaveBeenCalled();
    expect(updates.state).toEqual({
      installedVersion: "0.2.0",
      check: "idle",
      failure: null,
      available: null,
    });
    expect(updates.check()).toMatchObject({ check: "checking" });
    await flush();
    expect(requester).toHaveBeenCalledTimes(1);
    expect(notices.map((notice) => notice.sequence)).toEqual([1, 2]);
    expect(notices.at(-1)?.state).toEqual({
      installedVersion: "0.2.0",
      check: "checked",
      failure: null,
      available: { version: "0.3.0", notes: [], notesTruncated: false },
    });
  });
  it("keeps a failed startup check silent and reports a failed manual check", async () => {
    for (const failure of ["timeout", "network", "invalid_response", "too_large"] as const) {
      const startup = broker("0.2.0", { ok: false, failure });
      startup.updates.startup(true);
      await flush();
      expect(startup.updates.state).toMatchObject({ check: "idle", failure: null });
      expect(startup.notices.every((notice) => notice.state.check !== "failed")).toBe(true);
      const manual = broker("0.2.0", { ok: false, failure });
      manual.updates.check();
      await flush();
      expect(manual.updates.state).toMatchObject({ check: "failed", failure });
    }
    const rejected = broker("0.2.0", Promise.reject(new Error("transport")));
    rejected.updates.check();
    await flush();
    expect(rejected.updates.state).toMatchObject({ check: "failed", failure: "network" });
  });
  it("joins a running startup check so its failure reaches the manual caller", async () => {
    let resolve: ((value: LatestRelease) => void) | undefined;
    const { updates, requester } = broker(
      "0.2.0",
      new Promise<LatestRelease>((done) => (resolve = done)),
    );
    updates.startup(true);
    expect(updates.check()).toMatchObject({ check: "checking" });
    resolve?.({ ok: false, failure: "timeout" });
    await flush();
    expect(requester).toHaveBeenCalledTimes(1);
    expect(updates.state).toMatchObject({ check: "failed", failure: "timeout" });
  });
  it("keeps the last found version through a later failure and clears it after a current check", async () => {
    let next: LatestRelease = { ok: true, version: "0.3.0", notes: "Notes" };
    const updates = new UpdateBroker({
      installedVersion: "0.2.0",
      permitted: true,
      requester: () => Promise.resolve(next),
      publish: () => {},
    });
    updates.check();
    await flush();
    next = { ok: false, failure: "network" };
    updates.check();
    await flush();
    expect(updates.state).toMatchObject({
      check: "failed",
      available: { version: "0.3.0", notes: ["Notes"] },
    });
    next = { ok: true, version: "0.2.0", notes: "" };
    updates.check();
    await flush();
    expect(updates.state).toMatchObject({ check: "checked", available: null });
  });
  it("never asks in development, qualification or a build without a final version", async () => {
    for (const [version, permitted] of [
      ["0.2.0", false],
      ["0.3.0-dev.42.1", true],
    ] as const) {
      const { updates, requester, notices } = broker(
        version,
        { ok: true, version: "9.0.0", notes: "" },
        permitted,
      );
      updates.startup(true);
      expect(updates.check()).toEqual({
        installedVersion: version,
        check: "unavailable",
        failure: null,
        available: null,
      });
      await flush();
      expect(requester).not.toHaveBeenCalled();
      expect(notices).toEqual([]);
    }
  });
  it("answers update.read and update.check through valid port results", async () => {
    const { updates } = broker("0.2.0", { ok: true, version: "0.3.0", notes: "" });
    const delivered: string[] = [];
    const release = vi.fn();
    expect(
      updates.handle({
        request: request({ operation: "update.check" }),
        deliver: (text) => delivered.push(text),
        release,
      }),
    ).toBe(true);
    expect(updates.handle({ request: request(), deliver: () => {}, release })).toBe(false);
    await flush();
    updates.handle({
      request: request({ operation: "update.read", requestId: "request-2" }),
      deliver: (text) => delivered.push(text),
      release,
    });
    expect(release).toHaveBeenCalledTimes(2);
    const results = delivered.map((text) => decodeEnvelope(JSON.parse(text)));
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(results[0]).toMatchObject({
      value: {
        kind: "result",
        payload: { ok: true, value: { sequence: 1, state: { check: "checking" } } },
      },
    });
    expect(results[1]).toMatchObject({
      value: {
        payload: {
          value: { sequence: 2, state: { check: "checked", available: { version: "0.3.0" } } },
        },
      },
    });
  });
  it("stops a running check on disposal without publishing its late result", async () => {
    let signal: AbortSignal | undefined;
    let resolve: ((value: LatestRelease) => void) | undefined;
    const notices: UpdateStateNotice[] = [];
    const updates = new UpdateBroker({
      installedVersion: "0.2.0",
      permitted: true,
      requester: (aborted) => {
        signal = aborted;
        return new Promise((done) => (resolve = done));
      },
      publish: (notice) => notices.push(notice),
    });
    updates.startup(true);
    updates.dispose();
    expect(signal?.aborted).toBe(true);
    resolve?.({ ok: true, version: "0.3.0", notes: "" });
    await flush();
    expect(notices.map((notice) => notice.state.check)).toEqual(["checking"]);
    expect(updates.check()).toMatchObject({ check: "checking" });
    const late = broker("0.2.0", { ok: true, version: "0.3.0", notes: "" });
    late.updates.dispose();
    late.updates.startup(true);
    expect(late.requester).not.toHaveBeenCalled();
    expect(late.notices).toEqual([]);
  });
});

describe("SPEC-001-040 release notes as port-sized inert text", () => {
  it("keeps markup literal and splits at code points within both byte bounds", () => {
    expect(noteParts("<script>alert(1)</script>\r\n**bold**")).toEqual({
      notes: ["<script>alert(1)</script>\n**bold**"],
      notesTruncated: false,
    });
    expect(noteParts("")).toEqual({ notes: [], notesTruncated: false });
    for (const text of [
      "é".repeat(5000),
      "한".repeat(3000) + "🙂".repeat(1500),
      '"\\\n'.repeat(4000),
      "\u0001".repeat(4000),
      "a".repeat(portLimits.string_bytes) + "b",
      "\ud800 lone \udc00",
    ]) {
      const { notes, notesTruncated } = noteParts(text);
      expect(utf8Size(JSON.stringify(notes))).toBeLessThanOrEqual(portLimits.update_notes_bytes);
      for (const part of notes) {
        expect(part.length).toBeGreaterThan(0);
        expect(utf8Size(part)).toBeLessThanOrEqual(portLimits.string_bytes);
      }
      const joined = notes.join("");
      const expected = text
        .replace(/\r\n?/g, "\n")
        .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "�");
      expect(expected.startsWith(joined)).toBe(true);
      expect(notesTruncated).toBe(joined !== expected);
      expect(
        isUpdateState({
          installedVersion: "0.2.0",
          check: "checked",
          failure: null,
          available: { version: "0.3.0", notes, notesTruncated },
        }),
      ).toBe(true);
    }
    expect(noteParts("x".repeat(20000)).notesTruncated).toBe(true);
    expect(portLimits.update_notes_bytes).toBe(16384);
  });
  it("admits only coherent update states and sequenced notices", () => {
    const state = { installedVersion: "0.2.0", check: "idle", failure: null, available: null };
    expect(isUpdateState(state)).toBe(true);
    expect(isUpdateState({ ...state, check: "failed", failure: null })).toBe(false);
    expect(isUpdateState({ ...state, failure: "timeout" })).toBe(false);
    expect(
      isUpdateState({
        ...state,
        check: "unavailable",
        available: { version: "0.3.0", notes: [], notesTruncated: false },
      }),
    ).toBe(false);
    expect(
      isUpdateState({
        ...state,
        available: { version: "0.3.0-rc.1", notes: [], notesTruncated: false },
      }),
    ).toBe(false);
    expect(
      isUpdateState({
        ...state,
        available: { version: "0.3.0", notes: [""], notesTruncated: false },
      }),
    ).toBe(false);
    expect(decodeUpdateStateNotice({ sequence: 2, state })).toEqual({ sequence: 2, state });
    expect(decodeUpdateStateNotice({ sequence: -1, state })).toBeUndefined();
    expect(decodeUpdateStateNotice({ sequence: 1, state, extra: true })).toBeUndefined();
  });
});

describe("SPEC-001-040 startup preference through the settings store", () => {
  it("is enabled by default, persists a change across restart and keeps its receipts", async () => {
    const { store } = fixture();
    await store.open();
    expect(await store.readUpdateCheck()).toEqual({
      ok: true,
      value: { schemaVersion: 1, revision: 0, value: true, source: "default" },
    });
    const command = { operationId: "disable-1", expectedRevision: 0, value: false };
    const saved = await store.replaceUpdateCheck(command);
    expect(saved).toEqual({
      ok: true,
      value: { schemaVersion: 1, revision: 1, value: false, source: "saved" },
    });
    await store.close();
    await store.open();
    expect(await store.readUpdateCheck()).toEqual(saved);
    expect(await store.replaceUpdateCheck(command)).toEqual(saved);
    expect(await store.replaceUpdateCheck({ ...command, value: true })).toMatchObject({
      error: { code: "operation_conflict" },
    });
    expect(
      await store.replaceUpdateCheck({ ...command, operationId: "stale-1", value: true }),
    ).toMatchObject({ error: { code: "stale_revision", parameters: { currentRevision: 1 } } });
    expect(await store.readUpdateCheckReceipt("disable-1")).toEqual({
      ok: true,
      value: { state: "recorded", outcome: saved },
    });
    expect(await store.readUpdateCheckReceipt("stale-1")).toMatchObject({
      value: { state: "recorded", outcome: { error: { code: "stale_revision" } } },
    });
    expect(await store.readUpdateCheckReceipt("unknown-1")).toEqual({
      ok: true,
      value: { state: "not_found" },
    });
    expect(
      await store.replaceUpdateCheck({
        operationId: "invalid-1",
        expectedRevision: 1,
        value: "yes" as unknown as boolean,
      }),
    ).toMatchObject({ error: { code: "invalid_message" } });
  });
  it("reads an unreadable saved value as disabled without rewriting it", async () => {
    const { store, raw } = fixture();
    await store.open();
    await store.replaceUpdateCheck({ operationId: "enable-1", expectedRevision: 0, value: true });
    await store.close();
    const db = raw();
    db.prepare("UPDATE application_preferences SET value='maybe' WHERE key='update_check'").run();
    db.close();
    await store.open();
    expect(await store.readUpdateCheck()).toEqual({
      ok: true,
      value: { schemaVersion: 1, revision: 1, value: false, source: "invalid_fallback" },
    });
    await store.close();
    const again = raw();
    expect(
      again
        .prepare("SELECT value FROM application_preferences WHERE key='update_check'")
        .pluck()
        .get(),
    ).toBe("maybe");
    again.close();
    await store.open();
    expect(
      await store.replaceUpdateCheck({ operationId: "repair-1", expectedRevision: 1, value: true }),
    ).toMatchObject({ ok: true, value: { revision: 2, value: true, source: "saved" } });
  });
  it("refuses work before opening and reports storage failures without a write", async () => {
    const { store, raw } = fixture();
    const change = { operationId: "off-1", expectedRevision: 0, value: false };
    for (const outcome of [
      await store.readUpdateCheck(),
      await store.readUpdateCheckReceipt("off-1"),
      await store.replaceUpdateCheck(change),
    ])
      expect(outcome).toEqual({
        ok: false,
        error: { code: "service_unavailable", nextAction: "retry_later", parameters: {} },
      });
    await store.open();
    expect(await store.readUpdateCheckReceipt("not an id")).toMatchObject({
      error: { code: "invalid_message" },
    });
    // Admission loss on the given assert call of one operation.
    const loseAdmission = (call: number) => {
      let calls = 0;
      return vi.spyOn(store as unknown as { assert(): void }, "assert").mockImplementation(() => {
        if (++calls === call) throw new Error("admission lost");
      });
    };
    let failing = loseAdmission(1);
    expect(await store.readUpdateCheck()).toMatchObject({ error: { code: "storage_failed" } });
    failing.mockRestore();
    await store.close();
    await store.open();
    failing = loseAdmission(1);
    expect(await store.readUpdateCheckReceipt("off-1")).toMatchObject({
      error: { code: "storage_failed" },
    });
    failing.mockRestore();
    await store.close();
    await store.open();
    failing = loseAdmission(2);
    expect(await store.replaceUpdateCheck(change)).toMatchObject({
      error: { code: "storage_failed" },
    });
    failing.mockRestore();
    await store.close();
    const db = raw();
    expect(db.prepare("SELECT count(*) FROM update_check_receipts").pluck().get()).toBe(0);
    expect(
      db
        .prepare("SELECT count(*) FROM application_preferences WHERE key='update_check'")
        .pluck()
        .get(),
    ).toBe(0);
    db.close();
  });
  it("upgrades a revision 36 store while preserving its other preferences", async () => {
    const { store, raw } = fixture();
    await store.open();
    await store.replaceAppearance({ operationId: "dark-1", expectedRevision: 0, value: "dark" });
    await store.close();
    const db = raw();
    db.exec(preUpdateCheckSql);
    expect(db.pragma("user_version", { simple: true })).toBe(36);
    db.close();
    await store.open();
    const upgraded = raw();
    expect(upgraded.pragma("user_version", { simple: true })).toBe(37);
    upgraded.close();
    expect(await store.readAppearance()).toMatchObject({ ok: true, value: { value: "dark" } });
    expect(await store.readUpdateCheck()).toMatchObject({ ok: true, value: { source: "default" } });
  });
  it("serves the three preference operations through the data service", async () => {
    const { store } = fixture();
    await store.open();
    const messages: Record<string, any>[] = [];
    const peer = createStatusService(
      "service-1",
      "en-US",
      (text) => messages.push(JSON.parse(text)),
      store,
    );
    peer.activate("en-US");
    peer.receive(
      JSON.stringify(
        request({
          operation: "updateCheck.replace",
          operationId: "off-1",
          payload: { expectedRevision: 0, value: false },
        }),
      ),
    );
    peer.receive(
      JSON.stringify(request({ operation: "updateCheck.read", requestId: "request-2" })),
    );
    peer.receive(
      JSON.stringify(
        request({
          operation: "updateCheck.receipt",
          requestId: "request-3",
          payload: { targetOperationId: "off-1" },
        }),
      ),
    );
    await peer.drain();
    const results = messages.filter((message) => message.kind === "result");
    expect(results.map((message) => message.operation)).toEqual([
      "updateCheck.replace",
      "updateCheck.read",
      "updateCheck.receipt",
    ]);
    for (const message of results) expect(decodeEnvelope(message).ok).toBe(true);
    expect(results[1]!.payload).toEqual({
      ok: true,
      value: { schemaVersion: 1, revision: 1, value: false, source: "saved" },
    });
    expect(results[2]!.payload).toMatchObject({
      ok: true,
      value: { state: "recorded", outcome: { ok: true, value: { value: false } } },
    });
  });
});
