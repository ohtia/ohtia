import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { copyMessage, openExternalMessageLink } from "../packages/main/src/message-actions.js";
import { failure, splitText, utf8Size } from "../packages/contracts/src/index.js";
import type { ServiceSupervisor } from "../packages/main/src/service-supervisor.js";
const id = "019a8000-0000-7000-8000-000000000001";
const conversation = "019a8000-0000-7000-8000-000000000002";
function harness(text = "Original **message**") {
  const parts = splitText(text);
  const content =
    utf8Size(text) <= 4096
      ? text
      : {
          source: `message_${id}`,
          parts: parts.length,
          bytes: utf8Size(text),
          sha256: createHash("sha256").update(text).digest("hex"),
        };
  const request = vi.fn(async (operation, input) =>
    operation === "timeline.read"
      ? { ok: true, value: { items: [{ kind: "message", id, content }], remaining: [] } }
      : { ok: true, value: { text: parts[input.index - 1] } },
  );
  const clipboard = { writeText: vi.fn(), readText: vi.fn(() => text) };
  const diagnostic = vi.fn();
  const service = { request } as unknown as Pick<ServiceSupervisor, "request">;
  const run = (current = () => true, messageId: unknown = id, conversationId = conversation) =>
    copyMessage(messageId, conversationId, service, clipboard, current, diagnostic);
  return { run, request, clipboard, diagnostic, content };
}
describe("message broker effects", () => {
  it.each(["\n", "\r\n", "\r"])(
    "copies multipart original line endings without presentation normalization: %j",
    async (ending) => {
      const text = `First${ending}**Second**${ending}`.repeat(1000);
      const h = harness(text);
      expect(await h.run()).toBe(true);
      expect(h.clipboard.writeText).toHaveBeenCalledWith(text);
      expect(h.clipboard.readText).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "https://example.org/p?q=1#x",
    "http://example.org",
    "mailto:research@example.org",
    "HTTPS://EXAMPLE.ORG",
  ])("opens an admitted WHATWG address %s", async (url) => {
    const open = vi.fn(async () => {});
    const log = vi.fn();
    expect(await openExternalMessageLink(url, open, log)).toBe(true);
    expect(open).toHaveBeenCalledWith(new URL(url).href);
    expect(log.mock.calls).toEqual([["ohtia.message.link_opened"]]);
  });
  it.each([
    "javascript:alert(1)",
    "file:///private/data",
    "data:text/html,hi",
    "//example.org",
    " https://example.org",
    "https://[",
    "https://example.org/" + "한".repeat(1400),
    {},
    null,
  ])("refuses a direct hostile or invalid destination %j", async (url) => {
    const open = vi.fn(async () => {});
    const log = vi.fn();
    expect(await openExternalMessageLink(url, open, log)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([["ohtia.message.link_refused"]]);
  });
  it("admits 4,096 bytes, refuses 4,097 and contains external browser failures", async () => {
    const prefix = "https://example.org/";
    const url = prefix + "a".repeat(4096 - prefix.length);
    const open = vi.fn(async () => {});
    expect(await openExternalMessageLink(url, open)).toBe(true);
    expect(await openExternalMessageLink(url + "a", open)).toBe(false);
    expect(
      await openExternalMessageLink(url, async () => {
        throw new Error("private URL");
      }),
    ).toBe(false);
  });
  it("bounds the normalized address as well as the received UTF-8 string", async () => {
    const open = vi.fn(async () => {});
    expect(await openExternalMessageLink("https://example.org/" + "é".repeat(700), open)).toBe(
      false,
    );
    expect(open).not.toHaveBeenCalled();
    const url = "https://example.org/" + "é".repeat(679) + "ab";
    expect(utf8Size(new URL(url).href)).toBe(4096);
    expect(await openExternalMessageLink(url, open)).toBe(true);
  });
  it.each([
    ["short", "Original **message**"],
    ["long Unicode", "한글🙂**raw**\n".repeat(1500)],
    ["single-part boundary", "x".repeat(4096)],
  ])("copies exact saved %s text after readback", async (_label, text) => {
    const h = harness(text);
    expect(await h.run()).toBe(true);
    expect(h.request).toHaveBeenCalledWith("timeline.read", {
      conversationId: conversation,
      ids: [id],
    });
    expect(h.clipboard.writeText).toHaveBeenCalledWith(text);
    expect(h.clipboard.readText).toHaveBeenCalledOnce();
    expect(h.request.mock.calls.filter(([op]) => op === "text.readPart")).toHaveLength(
      utf8Size(text) > 4096 ? splitText(text).length : 0,
    );
    expect(h.diagnostic.mock.calls).toEqual([["ohtia.message.copied"]]);
  });
  it.each(["missing", "task", "wrong-id", "remaining", "failed", "clipboard", "readback", "throw"])(
    "fails safely for %s without reporting success",
    async (problem) => {
      const h = harness();
      if (problem === "missing")
        h.request.mockResolvedValue({ ok: true, value: { items: [], remaining: [] } } as never);
      if (problem === "task")
        h.request.mockResolvedValue({
          ok: true,
          value: { items: [{ kind: "task", id }], remaining: [] },
        } as never);
      if (problem === "wrong-id")
        h.request.mockResolvedValue({
          ok: true,
          value: { items: [{ kind: "message", id: conversation, content: "bad" }], remaining: [] },
        } as never);
      if (problem === "remaining")
        h.request.mockResolvedValue({ ok: true, value: { items: [], remaining: [id] } } as never);
      if (problem === "failed") h.request.mockResolvedValue(failure("record_not_found") as never);
      if (problem === "throw") h.request.mockRejectedValue(new Error("private response"));
      if (problem === "clipboard")
        h.clipboard.writeText.mockImplementation(() => {
          throw new Error("clipboard denied");
        });
      if (problem === "readback") h.clipboard.readText.mockReturnValue("another app changed it");
      expect(await h.run()).toBe(false);
      expect(h.diagnostic.mock.calls).toEqual([["ohtia.message.copy_failed"]]);
      if (!["clipboard", "readback"].includes(problem))
        expect(h.clipboard.writeText).not.toHaveBeenCalled();
    },
  );
  it.each(["part-failed", "bytes", "sha256"])("refuses corrupt long text: %s", async (problem) => {
    const h = harness("🙂한글".repeat(3000));
    if (problem === "part-failed")
      h.request
        .mockResolvedValueOnce({
          ok: true,
          value: { items: [{ kind: "message", id, content: h.content }], remaining: [] },
        } as never)
        .mockResolvedValue(failure("storage_failed") as never);
    else if (typeof h.content !== "string")
      Object.assign(
        h.content,
        problem === "bytes" ? { bytes: h.content.bytes + 1 } : { sha256: "0".repeat(64) },
      );
    expect(await h.run()).toBe(false);
    expect(h.clipboard.writeText).not.toHaveBeenCalled();
  });
  it("rejects malformed identifiers and revokes delayed reads when scope changes", async () => {
    const h = harness();
    expect(await h.run(() => true, "bad space")).toBe(false);
    expect(await h.run(() => true, id, "bad space")).toBe(false);
    expect(await h.run(() => false)).toBe(false);
    expect(h.request).not.toHaveBeenCalled();
    let current = true;
    h.request.mockImplementationOnce(async () => {
      current = false;
      return {
        ok: true,
        value: { items: [{ kind: "message", id, content: "private" }], remaining: [] },
      };
    });
    expect(await h.run(() => current)).toBe(false);
    expect(h.clipboard.writeText).not.toHaveBeenCalled();
  });
  it.each(["short", "multipart"])(
    "refuses revoked %s copy authority before its next effect",
    async (size) => {
      const h = harness(size === "short" ? "Original **message**" : "long".repeat(2000));
      const current = vi
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValue(false);
      expect(await h.run(current)).toBe(false);
      expect(h.request.mock.calls.map(([operation]) => operation)).toEqual(["timeline.read"]);
      expect(h.clipboard.writeText).not.toHaveBeenCalled();
      expect(h.clipboard.readText).not.toHaveBeenCalled();
      expect(h.diagnostic.mock.calls).toEqual([["ohtia.message.copy_failed"]]);
    },
  );
  it("revokes a long-text read between parts and refuses stale clipboard confirmation", async () => {
    const h = harness("long".repeat(2000));
    let checks = 0;
    expect(await h.run(() => ++checks < 4)).toBe(false);
    expect(h.clipboard.writeText).not.toHaveBeenCalled();
    const short = harness();
    let current = true;
    short.clipboard.writeText.mockImplementation(() => {
      current = false;
    });
    expect(await short.run(() => current)).toBe(false);
    expect(short.clipboard.readText).not.toHaveBeenCalled();
  });
});
