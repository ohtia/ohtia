import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemMotion } from "../packages/contracts/src/index.js";
import {
  SystemMotionObserver,
  completeTypes,
  decodeMessage,
  encodeMessage,
  messageLength,
  messageTypes,
  motionFromPortal,
  nativeSystemMotionHost,
  portalMotion,
  sessionBusPath,
  systemMotionLimits,
  type BusMessage,
  type OutgoingMessage,
  type SystemMotionHost,
} from "../packages/main/src/system-motion.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const field = (message: BusMessage, code: number) => message.fields.get(code);

/** A controlled session-bus peer on a real Unix socket; it implements only the observed calls. */
async function bus(
  options: {
    readonly auth?: "ok" | "rejected" | "silent";
    readonly value?: number | "missing" | "string";
    readonly owner?: string;
    readonly refuseMatch?: boolean;
  } = {},
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-bus-"));
  const socketPath = path.join(directory, "bus");
  const calls: BusMessage[] = [];
  const authLines: string[] = [];
  const state = { value: options.value ?? 1, owner: options.owner ?? ":1.7", serial: 100 };
  let peer: net.Socket | undefined;
  const server = net.createServer((socket) => {
    peer = socket;
    socket.on("error", () => {
      /* The observer may close first; the controlled peer has no further obligations. */
    });
    let buffer = Buffer.alloc(0);
    let binary = false;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (!binary) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.subarray(0, end).toString("latin1");
        buffer = buffer.subarray(end + 2);
        authLines.push(line);
        if (line.startsWith("\0AUTH")) {
          if (options.auth === "rejected") socket.write("REJECTED EXTERNAL\r\n");
          else if (options.auth !== "silent") socket.write(`OK ${"a".repeat(32)}\r\n`);
        } else if (line === "BEGIN") binary = true;
      }
      for (;;) {
        const length = messageLength(buffer);
        if (length === undefined || buffer.length < length) return;
        const call = decodeMessage(buffer.subarray(0, length));
        buffer = buffer.subarray(length);
        calls.push(call);
        answer(socket, call);
      }
    });
  });
  const send = (message: Omit<OutgoingMessage, "serial">) => {
    peer?.write(encodeMessage({ ...message, serial: ++state.serial }));
  };
  function answer(socket: net.Socket, call: BusMessage) {
    const member = field(call, 3);
    const reply = { replySerial: call.serial, destination: ":1.42" };
    if (member === "Hello")
      send({ ...reply, type: messageTypes.reply, sender: "org.freedesktop.DBus", body: [":1.42"] });
    else if (member === "AddMatch")
      send(
        options.refuseMatch
          ? {
              ...reply,
              type: messageTypes.error,
              sender: "org.freedesktop.DBus",
              error: "org.freedesktop.DBus.Error.MatchRuleInvalid",
              body: ["refused"],
            }
          : { ...reply, type: messageTypes.reply, sender: "org.freedesktop.DBus" },
      );
    else if (member === "ReadOne") {
      if (state.value === "missing")
        send({
          ...reply,
          type: messageTypes.error,
          sender: state.owner,
          error: "org.freedesktop.portal.Error.NotFound",
          body: ["Requested setting not found"],
        });
      else
        send({
          ...reply,
          type: messageTypes.reply,
          sender: state.owner,
          body: [{ variant: state.value === "string" ? "reduce" : state.value }],
        });
    }
    void socket;
  }
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  cleanups.push(async () => {
    peer?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    socketPath,
    calls,
    authLines,
    state,
    connected: () => peer !== undefined,
    closed: () => peer?.destroyed ?? false,
    disconnect: () => peer?.destroy(),
    raw: (bytes: Buffer) => peer?.write(bytes),
    setting(value: number | string, sender = state.owner, key: string = portalMotion.key) {
      send({
        type: messageTypes.signal,
        sender,
        path: portalMotion.path,
        interface: portalMotion.interface,
        member: "SettingChanged",
        body: [portalMotion.namespace, key, { variant: value }],
      });
    },
    owner(next: string) {
      const previous = state.owner;
      state.owner = next;
      send({
        type: messageTypes.signal,
        sender: "org.freedesktop.DBus",
        path: "/org/freedesktop/DBus",
        interface: "org.freedesktop.DBus",
        member: "NameOwnerChanged",
        body: [portalMotion.destination, previous, next],
      });
    },
  };
}
function observe(
  socketPath: string,
  overrides: Partial<SystemMotionHost> = {},
): { observer: SystemMotionObserver; seen: SystemMotion[]; deadlines: (() => void)[] } {
  const seen: SystemMotion[] = [];
  const deadlines: (() => void)[] = [];
  const observer = new SystemMotionObserver(
    {
      address: `unix:path=${socketPath},guid=${"0".repeat(32)}`,
      uid: 1000,
      connect: (target) => net.createConnection({ path: target }),
      after: (_ms, callback) => {
        deadlines.push(callback);
        return () => {
          const index = deadlines.indexOf(callback);
          if (index >= 0) deadlines.splice(index, 1);
        };
      },
      ...overrides,
    },
    (value) => seen.push(value),
  );
  cleanups.push(() => {
    observer.dispose();
  });
  observer.start();
  return { observer, seen, deadlines };
}

// Windows has no file-backed Unix socket peer here; the observer itself runs only on Linux.
const posix = it.runIf(process.platform !== "win32");
describe("desktop portal reduced-motion observer", () => {
  posix(
    "authenticates, installs both matches before reading and follows ordered live changes",
    async () => {
      const b = await bus();
      const o = observe(b.socketPath);
      await until(() => o.observer.value === "reduce", "startup value");
      expect(b.authLines[0]).toBe(`\0AUTH EXTERNAL ${Buffer.from("1000").toString("hex")}`);
      expect(b.calls.map((call) => field(call, 3))).toEqual([
        "Hello",
        "AddMatch",
        "AddMatch",
        "ReadOne",
      ]);
      expect(b.calls[1]?.body[0]).toContain("arg1='reduced-motion'");
      expect(b.calls[2]?.body[0]).toContain("member='NameOwnerChanged'");
      const read = b.calls[3]!;
      expect([field(read, 6), field(read, 1), field(read, 2)]).toEqual([
        portalMotion.destination,
        portalMotion.path,
        portalMotion.interface,
      ]);
      expect(read.body).toEqual([portalMotion.namespace, portalMotion.key]);
      expect(o.deadlines).toHaveLength(0);
      b.setting(0);
      await until(() => o.observer.value === "no_preference", "live no preference");
      b.setting(1);
      await until(() => o.observer.value === "reduce", "live reduce");
      b.setting(7);
      await until(() => o.observer.value === "no_preference", "unknown value as no preference");
      b.setting("reduce");
      await until(() => o.observer.value === "unknown", "invalid variant type");
      expect(o.seen).toEqual(["reduce", "no_preference", "reduce", "no_preference", "unknown"]);
    },
  );
  posix(
    "ignores other senders and keys and adopts a replacement portal through a fresh read",
    async () => {
      const b = await bus({ value: 0 });
      const o = observe(b.socketPath);
      await until(() => o.observer.value === "no_preference", "startup value");
      b.setting(1, ":1.99");
      b.setting(1, b.state.owner, "color-scheme");
      b.setting(0);
      b.state.value = 1;
      b.owner(":1.8");
      await until(() => o.observer.value === "reduce", "replacement value");
      b.setting(0, ":1.7");
      b.setting(1);
      b.setting(0);
      await until(() => o.observer.value === "no_preference", "replacement signal");
      expect(o.seen).toEqual(["no_preference", "unknown", "reduce", "no_preference"]);
      expect(b.calls.filter((call) => field(call, 3) === "ReadOne")).toHaveLength(2);
    },
  );
  posix("keeps an unsupported setting unknown until a portal owner provides it", async () => {
    const b = await bus({ value: "missing" });
    const o = observe(b.socketPath);
    await until(() => b.calls.some((call) => field(call, 3) === "ReadOne"), "read");
    b.setting(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(o.observer.value).toBe("unknown");
    expect(o.seen).toEqual([]);
    b.state.value = 1;
    b.owner(":1.9");
    await until(() => o.observer.value === "reduce", "new owner value");
    b.owner("");
    await until(() => o.observer.value === "unknown", "portal exit");
  });
  posix.each([
    ["rejected authentication", { auth: "rejected" as const }],
    ["a refused match rule", { refuseMatch: true }],
  ])("reports %s as unknown and closes the connection", async (_name, options) => {
    const b = await bus(options);
    const o = observe(b.socketPath);
    await until(() => b.closed(), "closed connection");
    expect(o.observer.value).toBe("unknown");
    expect(b.calls.some((call) => field(call, 3) === "ReadOne")).toBe(options.refuseMatch === true);
  });
  posix("bounds a silent handshake and an oversized message, then publishes unknown", async () => {
    const silent = await bus({ auth: "silent" });
    const first = observe(silent.socketPath);
    await until(() => first.deadlines.length === 1 && silent.connected(), "pending handshake");
    first.deadlines[0]!();
    await until(() => silent.closed(), "deadline closure");
    const b = await bus();
    const o = observe(b.socketPath);
    await until(() => o.observer.value === "reduce", "startup value");
    const header = Buffer.alloc(16);
    header.write("l", 0, "latin1");
    header.writeUInt8(messageTypes.signal, 1);
    header.writeUInt8(1, 3);
    header.writeUInt32LE(systemMotionLimits.message_bytes, 4);
    header.writeUInt32LE(9, 8);
    b.raw(header);
    await until(() => o.observer.value === "unknown", "oversized message");
    expect(b.closed()).toBe(true);
  });
  posix("publishes unknown when the bus disconnects and stays silent after disposal", async () => {
    const b = await bus();
    const o = observe(b.socketPath);
    await until(() => o.observer.value === "reduce", "startup value");
    b.disconnect();
    await until(() => o.observer.value === "unknown", "disconnection");
    const c = await bus();
    const d = observe(c.socketPath);
    await until(() => d.observer.value === "reduce", "second startup");
    d.observer.dispose();
    c.setting(0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(d.seen).toEqual(["reduce"]);
  });
  it("starts no connection without a usable Unix bus address or account identity", () => {
    let attempts = 0;
    for (const host of [
      { address: undefined, uid: 1000 },
      { address: "tcp:host=localhost,port=1", uid: 1000 },
      { address: "unix:path=/run/user/1000/bus", uid: -1 },
    ]) {
      const observer = new SystemMotionObserver(
        {
          ...host,
          connect: () => {
            attempts++;
            throw new Error("unexpected connection");
          },
          after: () => () => {},
        },
        () => {},
      );
      observer.start();
      expect(observer.value).toBe("unknown");
    }
    expect(attempts).toBe(0);
  });
});

describe("D-Bus wire handling", () => {
  it.each([
    ["unix:path=/run/user/1000/bus", "/run/user/1000/bus"],
    ["unix:path=/run/user/1000/bus,guid=0123", "/run/user/1000/bus"],
    ["tcp:host=localhost;unix:path=/tmp/a%20b", "/tmp/a b"],
    ["unix:abstract=/tmp/dbus-1,guid=0", "\0/tmp/dbus-1"],
    ["unix:path=relative/bus", undefined],
    ["unix:path=%ZZ", undefined],
    ["unix:tmpdir=/tmp", undefined],
    ["unix:path=/tmp/a%00b", undefined],
    ["", undefined],
  ])("resolves %j to the first usable Unix socket", (address, expected) => {
    expect(sessionBusPath(address)).toBe(expected);
  });
  it("round-trips the observer's messages and maps portal values by the specification", () => {
    const encoded = encodeMessage({
      type: messageTypes.signal,
      serial: 5,
      sender: ":1.7",
      path: portalMotion.path,
      interface: portalMotion.interface,
      member: "SettingChanged",
      body: [portalMotion.namespace, portalMotion.key, { variant: 1 }],
    });
    expect(messageLength(encoded)).toBe(encoded.length);
    const decoded = decodeMessage(encoded);
    expect(decoded.signature).toBe("ssv");
    expect(decoded.body[2]).toEqual({ signature: "u", value: 1 });
    expect(motionFromPortal(decoded.body[2])).toBe("reduce");
    expect(motionFromPortal({ signature: "u", value: 0 })).toBe("no_preference");
    expect(motionFromPortal({ signature: "u", value: 2 })).toBe("no_preference");
    expect(motionFromPortal({ signature: "s", value: "1" })).toBe("unknown");
    expect(motionFromPortal(undefined)).toBe("unknown");
  });
  it("rejects malformed frames, padding, signatures and excessive nesting", () => {
    const valid = encodeMessage({
      type: messageTypes.reply,
      serial: 3,
      replySerial: 1,
      sender: ":1.7",
      body: [{ variant: 1 }],
    });
    const endian = Buffer.from(valid);
    endian[0] = 0x41;
    expect(() => messageLength(endian)).toThrow();
    const version = Buffer.from(valid);
    version[3] = 2;
    expect(() => messageLength(version)).toThrow();
    expect(() => decodeMessage(valid.subarray(0, valid.length - 1))).toThrow();
    const serial = Buffer.from(valid);
    serial.writeUInt32LE(0, 8);
    expect(() => decodeMessage(serial)).toThrow();
    const padding = Buffer.from(valid);
    const headerEnd = Math.ceil((16 + padding.readUInt32LE(12)) / 8) * 8;
    if (headerEnd > 16 + padding.readUInt32LE(12)) {
      padding[headerEnd - 1] = 1;
      expect(() => decodeMessage(padding)).toThrow();
    }
    expect(messageLength(valid.subarray(0, 15))).toBeUndefined();
    expect(completeTypes("sa{sv}(iu)")).toEqual(["s", "a{sv}", "(iu)"]);
    for (const signature of ["a", "(", "()", "a{vs}", "(i", "z", `${"a".repeat(40)}y`])
      expect(() => completeTypes(signature)).toThrow();
  });
});

/** Test-side little-endian marshaller for every type the decoder admits. */
class Marshal {
  readonly bytes: number[] = [];
  pad(size: number): void {
    while (this.bytes.length % size) this.bytes.push(0);
  }
  private put(size: number, write: (view: DataView) => void): void {
    this.pad(size);
    const view = new DataView(new ArrayBuffer(size));
    write(view);
    this.bytes.push(...new Uint8Array(view.buffer));
  }
  value(type: string, value: unknown): this {
    const code = type[0];
    if (code === "y") this.bytes.push(value as number);
    else if (code === "b") this.put(4, (view) => view.setUint32(0, Number(value), true));
    else if (code === "u" || code === "h")
      this.put(4, (view) => view.setUint32(0, value as number, true));
    else if (code === "i") this.put(4, (view) => view.setInt32(0, value as number, true));
    else if (code === "n") this.put(2, (view) => view.setInt16(0, value as number, true));
    else if (code === "q") this.put(2, (view) => view.setUint16(0, value as number, true));
    else if (code === "x") this.put(8, (view) => view.setBigInt64(0, value as bigint, true));
    else if (code === "t") this.put(8, (view) => view.setBigUint64(0, value as bigint, true));
    else if (code === "d") this.put(8, (view) => view.setFloat64(0, value as number, true));
    else if (code === "s" || code === "o") {
      const encoded = Buffer.from(value as string | Buffer);
      this.value("u", encoded.length);
      this.bytes.push(...encoded, 0);
    } else if (code === "g") {
      const encoded = Buffer.from(value as string);
      this.bytes.push(encoded.length, ...encoded, 0);
    } else if (code === "v") {
      const variant = value as { signature: string; value: unknown };
      this.value("g", variant.signature).value(variant.signature, variant.value);
    } else if (code === "a") {
      this.value("u", 0);
      const at = this.bytes.length - 4;
      const element = type.slice(1);
      this.pad("xtd({".includes(element[0] ?? "") ? 8 : 1);
      const begin = this.bytes.length;
      for (const item of value as unknown[]) this.value(element, item);
      const length = this.bytes.length - begin;
      this.bytes.splice(at, 4, ...new Uint8Array(new Uint32Array([length]).buffer));
    } else {
      this.pad(8);
      completeTypes(type.slice(1, -1)).forEach((item, index) =>
        this.value(item, (value as unknown[])[index]),
      );
    }
    return this;
  }
}
function frame(options: {
  readonly fields?: readonly (readonly [number, string, unknown])[];
  readonly signature?: string;
  readonly body?: readonly number[];
  readonly serial?: number;
  readonly type?: number;
}): Buffer {
  const header = new Marshal();
  header.bytes.push(0x6c, options.type ?? messageTypes.signal, 0, 1);
  const body = options.body ?? [];
  header.value("u", body.length).value("u", options.serial ?? 1);
  const fields = [...(options.fields ?? [])];
  if (options.signature !== undefined) fields.push([8, "g", options.signature]);
  header.value(
    "a(yv)",
    fields.map(([code, signature, value]) => [code, { signature, value }]),
  );
  header.pad(8);
  return Buffer.from([...header.bytes, ...body]);
}
const body = (parts: readonly (readonly [string, unknown])[]) => {
  const writer = new Marshal();
  for (const [type, value] of parts) writer.value(type, value);
  return writer.bytes;
};

describe("D-Bus decoding coverage", () => {
  it("decodes every admitted basic and container type at its alignment", () => {
    const nested = { signature: "v", value: { signature: "s", value: "inner" } };
    const decoded = decodeMessage(
      frame({
        fields: [
          [1, "o", "/synthetic/path"],
          [3, "s", "Synthetic"],
          [5, "u", 7],
        ],
        signature: "ybnqiuxtdsoghva{sv}(iu)ad",
        body: body([
          ["y", 200],
          ["b", true],
          ["n", -2],
          ["q", 65535],
          ["i", -70000],
          ["u", 4000000000],
          ["x", -5n],
          ["t", 18446744073709551615n],
          ["d", 1.5],
          ["s", "text"],
          ["o", "/object"],
          ["g", "a{sv}"],
          ["h", 3],
          ["v", nested],
          ["a{sv}", [["key", { signature: "u", value: 1 }]]],
          ["(iu)", [-1, 2]],
          ["ad", [0.25, -0.5]],
        ]),
      }),
    );
    expect(decoded.fields.get(1)).toBe("/synthetic/path");
    expect(decoded.fields.get(5)).toBe(7);
    expect(decoded.body).toEqual([
      200,
      true,
      -2,
      65535,
      -70000,
      4000000000,
      -5n,
      18446744073709551615n,
      1.5,
      "text",
      "/object",
      "a{sv}",
      3,
      { signature: "v", value: { signature: "s", value: "inner" } },
      [["key", { signature: "u", value: 1 }]],
      [-1, 2],
      [0.25, -0.5],
    ]);
  });
  it.each([
    ["an invalid boolean", "b", body([["u", 2]]), /boolean/],
    ["an embedded NUL", "s", body([["s", "a\0b"]]), /string/],
    ["invalid UTF-8", "s", body([["s", Buffer.from([0xff])]]), /./],
    ["a truncated value", "u", [], /Truncated value/],
    ["truncated padding", "yu", [1], /Truncated padding/],
    ["nonzero padding", "yu", [1, 9, 0, 0, 5, 0, 0, 0], /Nonzero padding/],
    [
      "a multi-type variant",
      "v",
      body([
        ["g", "ii"],
        ["i", 1],
        ["i", 2],
      ]),
      /variant/,
    ],
    ["an excessive array", "ay", body([["u", 0x5000000]]), /Array limit/],
    [
      "a truncated array",
      "ay",
      body([
        ["u", 8],
        ["y", 1],
      ]),
      /Truncated array/,
    ],
    [
      "an element crossing its array",
      "au",
      body([
        ["u", 2],
        ["u", 1],
      ]),
      /overrun/,
    ],
    ["trailing body bytes", "y", [1, 2], /Trailing/],
  ])("rejects %s", (_name, signature, bytes, error) => {
    expect(() => decodeMessage(frame({ signature, body: bytes }))).toThrow(error);
  });
  it("rejects deep variants, duplicate fields, invalid headers and NUL in encoded strings", () => {
    let deep: unknown = { signature: "u", value: 1 };
    for (let level = 0; level < 70; level++) deep = { signature: "v", value: deep };
    expect(() => decodeMessage(frame({ signature: "v", body: body([["v", deep]]) }))).toThrow(
      /Nesting/,
    );
    expect(() =>
      decodeMessage(
        frame({
          fields: [
            [3, "s", "A"],
            [3, "s", "B"],
          ],
        }),
      ),
    ).toThrow(/Duplicate/);
    expect(() => decodeMessage(frame({ serial: 0 }))).toThrow(/header/);
    expect(() => decodeMessage(frame({ type: 5 }))).toThrow(/header/);
    const big = Buffer.from(frame({}));
    big[0] = 0x42;
    big.writeUInt32BE(8, 4);
    // A big-endian peer's header lengths are read in its declared byte order.
    expect(messageLength(big)).toBe(24);
  });
  it("refuses to encode a string that D-Bus cannot carry", () => {
    expect(() => encodeMessage({ type: messageTypes.call, serial: 1, member: "a\0b" })).toThrow(
      /string/,
    );
  });
});

class FakeSocket extends EventEmitter {
  readonly written: Buffer[] = [];
  destroyed = false;
  write(data: Uint8Array): boolean {
    this.written.push(Buffer.from(data));
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}
function fakeObserver(
  options: { connect?: () => FakeSocket; changed?: (value: SystemMotion) => void } = {},
) {
  const sockets: FakeSocket[] = [];
  const seen: SystemMotion[] = [];
  const observer = new SystemMotionObserver(
    {
      address: "unix:path=/run/synthetic/bus",
      uid: 1000,
      connect:
        options.connect ??
        (() => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        }),
      after: () => () => {},
    },
    (value) => {
      seen.push(value);
      options.changed?.(value);
    },
  );
  return { observer, sockets, seen };
}
const ready = (socket: FakeSocket) => {
  socket.emit("connect");
  socket.emit("data", Buffer.from(`OK ${"b".repeat(32)}\r\n`));
};
const readReply = (value: number, sender = ":1.7") =>
  encodeMessage({
    type: messageTypes.reply,
    serial: 50,
    replySerial: 4,
    sender,
    body: [{ variant: value }],
  });

describe("session-bus observer state machine", () => {
  it("connects once, survives a refused connection and accepts a split authentication line", () => {
    const refused = fakeObserver({
      connect: () => {
        throw new Error("synthetic connect failure");
      },
    });
    refused.observer.start();
    expect(refused.observer.value).toBe("unknown");
    const h = fakeObserver();
    h.observer.start();
    h.observer.start();
    expect(h.sockets).toHaveLength(1);
    const socket = h.sockets[0]!;
    socket.emit("connect");
    socket.emit("data", Buffer.from("OK bbbb"));
    expect(socket.written.some((chunk) => chunk.toString("latin1") === "BEGIN\r\n")).toBe(false);
    socket.emit("data", Buffer.from(`${"b".repeat(28)}\r\n`));
    expect(socket.written.some((chunk) => chunk.toString("latin1") === "BEGIN\r\n")).toBe(true);
    h.observer.dispose();
    h.observer.start();
    expect(h.sockets).toHaveLength(1);
  });
  it("ignores calls, unmatched replies and an unchanged owner while applying the current read", () => {
    const h = fakeObserver();
    h.observer.start();
    const socket = h.sockets[0]!;
    ready(socket);
    socket.emit(
      "data",
      Buffer.concat([
        encodeMessage({ type: messageTypes.call, serial: 40, member: "Introspect" }),
        encodeMessage({ type: messageTypes.reply, serial: 41, sender: ":1.7" }),
        encodeMessage({ type: messageTypes.reply, serial: 42, replySerial: 99, sender: ":1.7" }),
        readReply(1),
        encodeMessage({
          type: messageTypes.signal,
          serial: 43,
          sender: "org.freedesktop.DBus",
          path: "/org/freedesktop/DBus",
          interface: "org.freedesktop.DBus",
          member: "NameOwnerChanged",
          body: [portalMotion.destination, "", ":1.7"],
        }),
      ]),
    );
    expect(h.seen).toEqual(["reduce"]);
    expect(socket.destroyed).toBe(false);
  });
  it("stops parsing when a listener disposes it and ignores events from a replaced socket", () => {
    const disposing = fakeObserver({
      changed: () => {
        disposing.observer.dispose();
      },
    });
    disposing.observer.start();
    const first = disposing.sockets[0]!;
    ready(first);
    first.emit("data", Buffer.concat([readReply(1), readReply(0)]));
    expect(disposing.seen).toEqual(["reduce"]);
    expect(first.destroyed).toBe(true);
    const h = fakeObserver();
    h.observer.start();
    const socket = h.sockets[0]!;
    ready(socket);
    socket.emit("data", readReply(1));
    socket.emit("error");
    expect(h.seen).toEqual(["reduce", "unknown"]);
    socket.emit("connect");
    socket.emit("data", readReply(1));
    socket.emit("error");
    socket.emit("close");
    expect(h.seen).toEqual(["reduce", "unknown"]);
    expect(socket.written.filter((chunk) => chunk.includes("AUTH"))).toHaveLength(1);
  });
  it("accepts an uppercase server GUID and a large burst of small authenticated messages", () => {
    const h = fakeObserver();
    h.observer.start();
    const socket = h.sockets[0]!;
    socket.emit("connect");
    socket.emit("data", Buffer.from(`OK ${"B".repeat(32)}\r\n`));
    const small = encodeMessage({
      type: messageTypes.signal,
      serial: 60,
      sender: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus",
      member: "NameAcquired",
      body: [":1.42"],
    });
    const burst = Buffer.concat([
      ...Array.from(
        { length: Math.ceil(systemMotionLimits.message_bytes / small.length) + 1 },
        () => small,
      ),
      readReply(1),
    ]);
    expect(burst.length).toBeGreaterThan(systemMotionLimits.message_bytes);
    socket.emit("data", burst);
    expect(socket.destroyed).toBe(false);
    expect(h.observer.value).toBe("reduce");
  });
  it("bounds unauthenticated input without a line ending", () => {
    const h = fakeObserver();
    h.observer.start();
    const socket = h.sockets[0]!;
    socket.emit("connect");
    socket.emit("data", Buffer.alloc(systemMotionLimits.message_bytes + 1, 0x41));
    expect(socket.destroyed).toBe(true);
    expect(h.observer.value).toBe("unknown");
  });
});

describe("native observer host", () => {
  it("reads the session address and account and arms an unreferenced, cancellable timer", async () => {
    vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/synthetic/bus");
    cleanups.push(() => {
      vi.unstubAllEnvs();
    });
    const host = nativeSystemMotionHost();
    expect(host.address).toBe("unix:path=/run/synthetic/bus");
    expect(host.uid).toBe(process.getuid?.() ?? -1);
    const fired = await new Promise<boolean>((resolve) => {
      host.after(1, () => {
        resolve(true);
      });
    });
    expect(fired).toBe(true);
    const cancelled = vi.fn();
    host.after(1, cancelled)();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancelled).not.toHaveBeenCalled();
    const socket = host.connect(path.join(os.tmpdir(), "ohtia-absent-bus", "bus")) as net.Socket;
    await new Promise<void>((resolve) => {
      socket.on("error", () => {
        resolve();
      });
    });
    socket.destroy();
  });
});
