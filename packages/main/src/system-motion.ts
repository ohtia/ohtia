import net from "node:net";
import type { SystemMotion } from "@ohtia/contracts";

/** ADR-0047: bounded observation of the desktop portal's reduced-motion setting. */
export const portalMotion = {
  destination: "org.freedesktop.portal.Desktop",
  path: "/org/freedesktop/portal/desktop",
  interface: "org.freedesktop.portal.Settings",
  namespace: "org.freedesktop.appearance",
  key: "reduced-motion",
} as const;
const bus = {
  destination: "org.freedesktop.DBus",
  path: "/org/freedesktop/DBus",
  interface: "org.freedesktop.DBus",
} as const;
export const systemMotionLimits = { connect_ms: 2000, message_bytes: 65536, depth: 32 } as const;

/** Returns the first Unix-socket entry of a D-Bus server address; other transports are unused. */
export function sessionBusPath(address: string | undefined): string | undefined {
  if (!address) return;
  for (const entry of address.split(";")) {
    const colon = entry.indexOf(":");
    if (colon <= 0 || entry.slice(0, colon) !== "unix") continue;
    const parameters = new Map<string, string>();
    for (const item of entry.slice(colon + 1).split(",")) {
      const equals = item.indexOf("=");
      if (equals > 0) parameters.set(item.slice(0, equals), item.slice(equals + 1));
    }
    let value: string;
    try {
      value = decodeURIComponent(parameters.get("path") ?? parameters.get("abstract") ?? "");
    } catch {
      continue;
    }
    if (!value || value.includes("\0")) continue;
    if (parameters.has("path")) {
      if (value.startsWith("/")) return value;
    } else return `\0${value}`;
  }
  return;
}

export type BusValue =
  | number
  | bigint
  | boolean
  | string
  | readonly BusValue[]
  | { readonly signature: string; readonly value: BusValue };
export interface BusMessage {
  readonly type: number;
  readonly serial: number;
  readonly fields: ReadonlyMap<number, BusValue>;
  readonly signature: string;
  readonly body: readonly BusValue[];
}
export const messageTypes = { call: 1, reply: 2, error: 3, signal: 4 } as const;
const field = {
  path: 1,
  interface: 2,
  member: 3,
  error: 4,
  replySerial: 5,
  destination: 6,
  sender: 7,
  signature: 8,
} as const;

/** Splits a signature into single complete types, rejecting malformed or excessively nested input. */
export function completeTypes(signature: string, depth = 0): string[] {
  const types: string[] = [];
  let index = 0;
  const one = (level: number): void => {
    if (level > systemMotionLimits.depth) throw new Error("Nesting limit.");
    const code = signature[index++];
    if (code === undefined) throw new Error("Truncated signature.");
    if ("ybnqiuxtdsogvh".includes(code)) return;
    if (code === "a") {
      if (signature[index] === "{") {
        index++;
        const key = signature[index++];
        if (key === undefined || !"ybnqiuxtdsog".includes(key))
          throw new Error("Invalid dictionary key.");
        one(level + 1);
        if (signature[index++] !== "}") throw new Error("Unclosed dictionary.");
        return;
      }
      one(level + 1);
      return;
    }
    if (code === "(") {
      if (signature[index] === ")") throw new Error("Empty structure.");
      while (signature[index] !== ")") {
        if (index >= signature.length) throw new Error("Unclosed structure.");
        one(level + 1);
      }
      index++;
      return;
    }
    throw new Error("Unsupported type.");
  };
  while (index < signature.length) {
    const start = index;
    one(depth);
    types.push(signature.slice(start, index));
  }
  return types;
}
function alignment(code: string): number {
  if ("ybgv".includes(code)) return code === "b" ? 4 : 1;
  if ("nq".includes(code)) return 2;
  if ("xtd({".includes(code)) return 8;
  return 4;
}

class Reader {
  offset = 0;
  constructor(
    private readonly view: DataView,
    private readonly little: boolean,
    private readonly end: number,
  ) {}
  align(size: number): void {
    const next = Math.ceil(this.offset / size) * size;
    if (next > this.end) throw new Error("Truncated padding.");
    for (; this.offset < next; this.offset++)
      if (this.view.getUint8(this.offset) !== 0) throw new Error("Nonzero padding.");
  }
  private need(size: number): void {
    if (this.offset + size > this.end) throw new Error("Truncated value.");
  }
  private text(size: number): string {
    this.need(size + 1);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, size);
    if (this.view.getUint8(this.offset + size) !== 0 || bytes.includes(0))
      throw new Error("Invalid string.");
    this.offset += size + 1;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  value(type: string, depth = 0): BusValue {
    if (depth > systemMotionLimits.depth * 2) throw new Error("Nesting limit.");
    const code = type[0] ?? "";
    this.align(alignment(code));
    switch (code) {
      case "y":
        this.need(1);
        return this.view.getUint8(this.offset++);
      case "b": {
        const value = this.uint32();
        if (value > 1) throw new Error("Invalid boolean.");
        return value === 1;
      }
      case "n":
      case "q": {
        this.need(2);
        const value =
          code === "n"
            ? this.view.getInt16(this.offset, this.little)
            : this.view.getUint16(this.offset, this.little);
        this.offset += 2;
        return value;
      }
      case "i":
      case "h":
      case "u": {
        this.need(4);
        const value =
          code === "i"
            ? this.view.getInt32(this.offset, this.little)
            : this.view.getUint32(this.offset, this.little);
        this.offset += 4;
        return value;
      }
      case "x":
      case "t":
      case "d": {
        this.need(8);
        const value =
          code === "x"
            ? this.view.getBigInt64(this.offset, this.little)
            : code === "t"
              ? this.view.getBigUint64(this.offset, this.little)
              : this.view.getFloat64(this.offset, this.little);
        this.offset += 8;
        return value;
      }
      case "s":
      case "o":
        return this.text(this.uint32());
      case "g":
        this.need(1);
        return this.text(this.view.getUint8(this.offset++));
      case "v": {
        this.need(1);
        const signature = this.text(this.view.getUint8(this.offset++));
        const [inner, ...rest] = completeTypes(signature, depth);
        if (inner === undefined || rest.length) throw new Error("Invalid variant.");
        return { signature, value: this.value(inner, depth + 1) };
      }
      case "a": {
        const size = this.uint32();
        if (size > 67108864) throw new Error("Array limit.");
        const element = type.slice(1);
        this.align(alignment(element[0] ?? ""));
        const stop = this.offset + size;
        if (stop > this.end) throw new Error("Truncated array.");
        const values: BusValue[] = [];
        while (this.offset < stop) values.push(this.value(element, depth + 1));
        if (this.offset !== stop) throw new Error("Array overrun.");
        return values;
      }
      default:
        // completeTypes admitted the signature, so the remaining codes are structures and entries.
        return completeTypes(type.slice(1, -1), depth).map((item) => this.value(item, depth + 1));
    }
  }
  uint32(): number {
    this.need(4);
    const value = this.view.getUint32(this.offset, this.little);
    this.offset += 4;
    return value;
  }
}

/** Returns the complete message length once its fixed header is available. */
export function messageLength(bytes: Uint8Array): number | undefined {
  if (bytes.length < 16) return;
  const little = bytes[0] === 0x6c;
  if (!little && bytes[0] !== 0x42) throw new Error("Invalid endianness.");
  if (bytes[3] !== 1) throw new Error("Unsupported protocol version.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const body = view.getUint32(4, little);
  const fields = view.getUint32(12, little);
  const total = Math.ceil((16 + fields) / 8) * 8 + body;
  if (total > systemMotionLimits.message_bytes) throw new Error("Message limit.");
  return total;
}
export function decodeMessage(bytes: Uint8Array): BusMessage {
  const length = messageLength(bytes);
  if (length === undefined || length !== bytes.length) throw new Error("Invalid length.");
  const little = bytes[0] === 0x6c;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = bytes[1] ?? 0;
  const serial = view.getUint32(8, little);
  if (type < 1 || type > 4 || serial === 0) throw new Error("Invalid header.");
  const reader = new Reader(view, little, bytes.length);
  reader.offset = 12;
  const entries = reader.value("a(yv)");
  const fields = new Map<number, BusValue>();
  // The fixed `a(yv)` signature yields a byte code and a decoded variant for every entry.
  for (const [code, variant] of entries as readonly (readonly [number, { value: BusValue }])[]) {
    if (fields.has(code)) throw new Error("Duplicate header field.");
    fields.set(code, variant.value);
  }
  reader.align(8);
  const signatureField = fields.get(field.signature);
  const signature = typeof signatureField === "string" ? signatureField : "";
  const body: BusValue[] = [];
  for (const item of completeTypes(signature)) body.push(reader.value(item));
  if (reader.offset !== bytes.length) throw new Error("Trailing body bytes.");
  return { type, serial, fields, signature, body };
}

class Writer {
  private readonly bytes: number[] = [];
  get length(): number {
    return this.bytes.length;
  }
  align(size: number): void {
    while (this.bytes.length % size) this.bytes.push(0);
  }
  byte(value: number): void {
    this.bytes.push(value & 0xff);
  }
  uint32(value: number): void {
    this.align(4);
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24);
  }
  setUint32(offset: number, value: number): void {
    this.bytes.splice(
      offset,
      4,
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      value >>> 24,
    );
  }
  string(value: string, signature = false): void {
    const encoded = new TextEncoder().encode(value);
    if (encoded.includes(0)) throw new Error("Invalid string.");
    if (signature) this.byte(encoded.length);
    else this.uint32(encoded.length);
    this.bytes.push(...encoded, 0);
  }
  done(): Buffer {
    return Buffer.from(this.bytes);
  }
}
export interface OutgoingMessage {
  readonly type: number;
  readonly serial: number;
  readonly path?: string;
  readonly interface?: string;
  readonly member?: string;
  readonly destination?: string;
  readonly sender?: string;
  readonly replySerial?: number;
  readonly error?: string;
  /** Body values: strings, plus variants holding a string or an unsigned integer for test peers. */
  readonly body?: readonly (string | { readonly variant: string | number })[];
}
/** Encodes the small little-endian messages this observer sends (and controlled peers return). */
export function encodeMessage(message: OutgoingMessage): Buffer {
  const signature = (message.body ?? [])
    .map((item) => (typeof item === "string" ? "s" : "v"))
    .join("");
  const body = new Writer();
  for (const item of message.body ?? []) {
    if (typeof item === "string") body.string(item);
    else {
      body.string(typeof item.variant === "string" ? "s" : "u", true);
      if (typeof item.variant === "string") body.string(item.variant);
      else body.uint32(item.variant);
    }
  }
  const bodyBytes = body.done();
  const header = new Writer();
  for (const value of [0x6c, message.type, 0, 1]) header.byte(value);
  header.uint32(bodyBytes.length);
  header.uint32(message.serial);
  header.uint32(0);
  const start = header.length;
  const add = (code: number, type: "o" | "s" | "u" | "g", value: string | number) => {
    header.align(8);
    header.byte(code);
    header.string(type, true);
    if (type === "u") header.uint32(value as number);
    else header.string(value as string, type === "g");
  };
  if (message.path) add(field.path, "o", message.path);
  if (message.interface) add(field.interface, "s", message.interface);
  if (message.member) add(field.member, "s", message.member);
  if (message.error) add(field.error, "s", message.error);
  if (message.replySerial !== undefined) add(field.replySerial, "u", message.replySerial);
  if (message.destination) add(field.destination, "s", message.destination);
  if (message.sender) add(field.sender, "s", message.sender);
  if (signature) add(field.signature, "g", signature);
  header.setUint32(12, header.length - start);
  header.align(8);
  return Buffer.concat([header.done(), bodyBytes]);
}

export interface MotionSocket {
  write(data: Uint8Array): unknown;
  destroy(): unknown;
  on(event: "connect" | "error" | "close", listener: () => void): unknown;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
}
export interface SystemMotionHost {
  readonly address: string | undefined;
  readonly uid: number;
  connect(path: string): MotionSocket;
  after(ms: number, callback: () => void): () => void;
}
export const nativeSystemMotionHost = (): SystemMotionHost => ({
  address: process.env.DBUS_SESSION_BUS_ADDRESS,
  uid: process.getuid?.() ?? -1,
  connect: (path) => net.createConnection({ path }),
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return () => {
      clearTimeout(timer);
    };
  },
});
const quote = (value: string) => `'${value}'`;
const settingMatch = [
  "type='signal'",
  `sender=${quote(portalMotion.destination)}`,
  `interface=${quote(portalMotion.interface)}`,
  "member='SettingChanged'",
  `path=${quote(portalMotion.path)}`,
  `arg0=${quote(portalMotion.namespace)}`,
  `arg1=${quote(portalMotion.key)}`,
].join(",");
const ownerMatch = [
  "type='signal'",
  `sender=${quote(bus.destination)}`,
  `interface=${quote(bus.interface)}`,
  "member='NameOwnerChanged'",
  `path=${quote(bus.path)}`,
  `arg0=${quote(portalMotion.destination)}`,
].join(",");

/** Portal value `1` requests reduced motion; other unsigned values mean no preference. */
export function motionFromPortal(value: BusValue | undefined): SystemMotion {
  if (!value || typeof value !== "object" || !("signature" in value) || value.signature !== "u")
    return "unknown";
  return value.value === 1 ? "reduce" : "no_preference";
}

/**
 * Reads and follows one portal setting over the session bus. Every failure leaves the
 * observation unknown, so Chromium's own media query remains the only system input.
 */
export class SystemMotionObserver {
  private state: SystemMotion = "unknown";
  private socket: MotionSocket | undefined;
  private buffer = Buffer.alloc(0);
  private serial = 0;
  private authenticated = false;
  private owner: string | undefined;
  private read: number | undefined;
  private setup = new Set<number>();
  private cancelDeadline: (() => void) | undefined;
  private disposed = false;
  constructor(
    private readonly host: SystemMotionHost,
    private readonly changed: (value: SystemMotion) => void,
  ) {}
  get value(): SystemMotion {
    return this.state;
  }
  start(): void {
    if (this.socket || this.disposed) return;
    const path = sessionBusPath(this.host.address);
    if (!path || !Number.isInteger(this.host.uid) || this.host.uid < 0) return;
    let socket: MotionSocket;
    try {
      socket = this.host.connect(path);
    } catch {
      return;
    }
    this.socket = socket;
    this.cancelDeadline = this.host.after(systemMotionLimits.connect_ms, () => {
      if (!this.authenticated) this.fail();
    });
    socket.on("connect", () => {
      if (this.socket !== socket) return;
      const uid = Buffer.from(String(this.host.uid), "ascii").toString("hex");
      socket.write(Buffer.from(`\0AUTH EXTERNAL ${uid}\r\n`, "ascii"));
    });
    socket.on("data", (chunk) => {
      if (this.socket !== socket) return;
      try {
        this.receive(chunk);
      } catch {
        this.fail();
      }
    });
    socket.on("error", () => {
      if (this.socket === socket) this.fail();
    });
    socket.on("close", () => {
      if (this.socket === socket) this.fail();
    });
  }
  dispose(): void {
    this.disposed = true;
    this.close();
  }
  private close(): void {
    this.cancelDeadline?.();
    this.cancelDeadline = undefined;
    const socket = this.socket;
    this.socket = undefined;
    try {
      socket?.destroy();
    } catch {
      /* The observation is already unavailable. */
    }
  }
  private fail(): void {
    this.close();
    this.publish("unknown");
  }
  private publish(value: SystemMotion): void {
    if (this.disposed || value === this.state) return;
    this.state = value;
    this.changed(value);
  }
  private send(message: Omit<OutgoingMessage, "type" | "serial">): number {
    const serial = ++this.serial;
    this.socket?.write(encodeMessage({ ...message, type: messageTypes.call, serial }));
    return serial;
  }
  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.authenticated) {
      // After authentication, messageLength bounds each message instead of the whole buffer.
      if (this.buffer.length > systemMotionLimits.message_bytes) throw new Error("Buffer limit.");
      const end = this.buffer.indexOf("\r\n");
      if (end < 0) return;
      const line = this.buffer.subarray(0, end).toString("ascii");
      this.buffer = this.buffer.subarray(end + 2);
      if (!/^OK [0-9a-fA-F]{32}$/.test(line)) throw new Error("Authentication refused.");
      this.authenticated = true;
      this.cancelDeadline?.();
      this.cancelDeadline = undefined;
      this.socket?.write(Buffer.from("BEGIN\r\n", "ascii"));
      this.setup.add(this.send({ ...bus, member: "Hello" }));
      this.setup.add(this.send({ ...bus, member: "AddMatch", body: [settingMatch] }));
      this.setup.add(this.send({ ...bus, member: "AddMatch", body: [ownerMatch] }));
      this.readSetting();
    }
    for (;;) {
      const length = messageLength(this.buffer);
      if (length === undefined || this.buffer.length < length) return;
      const message = decodeMessage(this.buffer.subarray(0, length));
      this.buffer = this.buffer.subarray(length);
      this.dispatch(message);
      if (!this.socket) return;
    }
  }
  private readSetting(): void {
    this.read = this.send({
      destination: portalMotion.destination,
      path: portalMotion.path,
      interface: portalMotion.interface,
      member: "ReadOne",
      body: [portalMotion.namespace, portalMotion.key],
    });
  }
  private dispatch(message: BusMessage): void {
    const replySerial = message.fields.get(field.replySerial);
    const sender = message.fields.get(field.sender);
    if (message.type === messageTypes.reply || message.type === messageTypes.error) {
      if (typeof replySerial !== "number") return;
      if (this.setup.delete(replySerial)) {
        if (message.type === messageTypes.error) throw new Error("Bus setup refused.");
        return;
      }
      if (replySerial !== this.read) return;
      this.read = undefined;
      if (message.type === messageTypes.error || typeof sender !== "string") {
        this.owner = undefined;
        this.publish("unknown");
        return;
      }
      // Later signals from this sender are ordered after the reply that established its value.
      this.owner = sender;
      this.publish(message.signature === "v" ? motionFromPortal(message.body[0]) : "unknown");
      return;
    }
    if (message.type !== messageTypes.signal) return;
    const member = message.fields.get(field.member);
    const path = message.fields.get(field.path);
    const iface = message.fields.get(field.interface);
    if (
      sender === bus.destination &&
      member === "NameOwnerChanged" &&
      path === bus.path &&
      iface === bus.interface &&
      message.signature === "sss" &&
      message.body[0] === portalMotion.destination
    ) {
      const next = message.body[2];
      if (next === this.owner) return;
      this.owner = undefined;
      this.read = undefined;
      this.publish("unknown");
      if (typeof next === "string" && next) this.readSetting();
      return;
    }
    if (
      this.owner !== undefined &&
      sender === this.owner &&
      member === "SettingChanged" &&
      path === portalMotion.path &&
      iface === portalMotion.interface &&
      message.signature === "ssv" &&
      message.body[0] === portalMotion.namespace &&
      message.body[1] === portalMotion.key
    )
      this.publish(motionFromPortal(message.body[2]));
  }
}
