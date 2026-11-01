import {
  decodeAppearanceChange,
  decodeLocaleChange,
  type LocaleSnapshot,
  decodeText,
  encodeEnvelope,
  failure,
  isIdentifier,
  policyId,
  portLimits,
  type AppearanceRecord,
  type FoundationPort,
  type FoundationStatus,
  type Identity,
  type Operation,
  type OperationInputs,
  type OperationOutputs,
  type Outcome,
  type PortCall,
  type PortEvent,
  type Request,
  type Subscription,
  utf8Size,
} from "@ohtia/contracts";
import { assertPreloadIsolation, type PreloadEnvironment } from "./isolation.js";

/** Private composition dependencies; never expose this transport through contextBridge. */
export interface PortTransport {
  send(compactJson: string): void;
  listen(receive: (compactJson: unknown) => void): () => void;
}
export interface PortClock {
  after(milliseconds: number, callback: () => void): () => void;
}
export interface PortSession {
  readonly windowGeneration: string;
  readonly serviceGeneration: string;
  /** Trusted composition supplies fresh, non-repeating opaque identifiers. */
  nextId(): string;
}
interface Pending {
  readonly request: Request;
  readonly finish: (outcome: Outcome<unknown>) => void;
  stopTimer(): void;
}
interface Stream {
  readonly id: string;
  readonly topic: "status" | "appearance" | "locale";
  readonly listener: (
    notice: Outcome<FoundationStatus | AppearanceRecord | LocaleSnapshot>,
  ) => void;
  readonly queue: { readonly event: PortEvent; readonly bytes: number }[];
  bytes: number;
  sequence: number;
  revision: number;
  active: boolean;
  stopDrain: (() => void) | undefined;
}
function identity(request: Identity, other: Identity): boolean {
  return (
    request.requestId === other.requestId &&
    request.operationId === other.operationId &&
    request.operation === other.operation &&
    request.windowGeneration === other.windowGeneration &&
    request.serviceGeneration === other.serviceGeneration
  );
}

/** Named bridge implementation with deterministic clock/transport injection. No IPC is installed. */
export function createFoundationPort(
  environment: PreloadEnvironment,
  transport: PortTransport,
  clock: PortClock,
  session: PortSession,
): { readonly port: FoundationPort; dispose(): void } {
  assertPreloadIsolation(environment);
  if (!isIdentifier(session.windowGeneration) || !isIdentifier(session.serviceGeneration))
    throw new Error("Invalid trusted port generation.");
  // Capture the admitted generation, rather than retaining mutable caller configuration.
  const generations = {
    windowGeneration: session.windowGeneration,
    serviceGeneration: session.serviceGeneration,
  };
  const pending = new Map<string, Pending>();
  const streams = new Map<string, Stream>();
  let disposed = false;
  function send(value: unknown): boolean {
    const encoded = encodeEnvelope(value);
    if (!encoded.ok) return false;
    try {
      transport.send(encoded.value);
      return true;
    } catch {
      return false;
    }
  }
  function cancel(request: Request): void {
    send({
      protocol: request.protocol,
      policy: request.policy,
      kind: "cancel",
      requestId: request.requestId,
      operationId: request.operationId,
      operation: request.operation,
      windowGeneration: request.windowGeneration,
      serviceGeneration: request.serviceGeneration,
    });
  }
  function close(stream: Stream, notify: boolean): void {
    if (!streams.delete(stream.id)) return;
    stream.stopDrain?.();
    stream.queue.length = 0;
    stream.bytes = 0;
    send({
      protocol: 1,
      policy: policyId,
      kind: "unsubscribe",
      ...generations,
      subscriptionId: stream.id,
    });
    if (notify) {
      for (const entry of [...pending.values()]) {
        if (
          (entry.request.operation === "status.subscribe" ||
            entry.request.operation === "appearance.subscribe" ||
            entry.request.operation === "locale.subscribe") &&
          entry.request.payload.subscriptionId === stream.id
        )
          settle(entry, failure("sequence_gap"));
      }
      try {
        stream.listener(failure("sequence_gap"));
      } catch {
        /* Consumer errors never escape a transport callback. */
      }
    }
  }
  function settle(entry: Pending, outcome: Outcome<unknown>): void {
    if (!pending.delete(entry.request.requestId)) return;
    entry.stopTimer();
    entry.finish(outcome);
  }
  function invalidResponse(
    code:
      | "invalid_service_result"
      | "unsupported_version"
      | "policy_mismatch" = "invalid_service_result",
  ): void {
    for (const entry of [...pending.values()])
      settle(
        entry,
        failure(
          entry.request.operation === "appearance.replace" ||
            entry.request.operation === "locale.replace"
            ? "uncertain"
            : code,
        ),
      );
    for (const stream of [...streams.values()]) close(stream, true);
  }
  function enqueue(event: PortEvent, bytes: number): void {
    const stream = streams.get(event.subscriptionId);
    if (!stream) return;
    if (
      !stream.active ||
      stream.topic !== event.topic ||
      event.sequence !== stream.sequence + 1 ||
      ((event.topic === "appearance" || event.topic === "locale") &&
        (event.topic === "locale" ? event.payload.record.revision : event.payload.revision) <=
          stream.revision) ||
      stream.queue.length >= portLimits.event_queue_items ||
      stream.bytes + bytes > portLimits.event_queue_bytes
    ) {
      close(stream, true);
      return;
    }
    stream.sequence = event.sequence;
    if (event.topic === "appearance" || event.topic === "locale")
      stream.revision =
        event.topic === "locale" ? event.payload.record.revision : event.payload.revision;
    stream.queue.push({ event, bytes });
    stream.bytes += bytes;
    stream.stopDrain ??= clock.after(0, () => {
      stream.stopDrain = undefined;
      while (streams.has(stream.id) && stream.queue.length) {
        const item = stream.queue.shift();
        if (!item) break;
        stream.bytes -= item.bytes;
        try {
          stream.listener({ ok: true, value: item.event.payload });
        } catch {
          close(stream, false);
        }
      }
    });
  }
  const stopListening = transport.listen((raw) => {
    if (disposed) return;
    const decoded = decodeText(raw);
    if (!decoded.ok) {
      invalidResponse(
        decoded.error.code === "unsupported_version" || decoded.error.code === "policy_mismatch"
          ? decoded.error.code
          : "invalid_service_result",
      );
      return;
    }
    const message = decoded.value;
    if (
      message.windowGeneration !== generations.windowGeneration ||
      message.serviceGeneration !== generations.serviceGeneration
    )
      return;
    if (message.kind === "event") {
      // Encoded events have already passed strict UTF-8 bounds; count their complete wire bytes.
      enqueue(message, utf8Size(raw as string));
      return;
    }
    if (message.kind !== "result") {
      invalidResponse();
      return;
    }
    const entry = pending.get(message.requestId);
    if (!entry) return; // Late/duplicate acknowledgements cannot revive disposed calls.
    if (!identity(entry.request, message)) {
      settle(
        entry,
        failure(
          entry.request.operation === "appearance.replace" ||
            entry.request.operation === "locale.replace"
            ? "uncertain"
            : "invalid_service_result",
        ),
      );
      return;
    }
    if (message.payload.ok) {
      if (
        (entry.request.operation === "appearance.replace" ||
          entry.request.operation === "locale.replace") &&
        (message.operation !== entry.request.operation ||
          message.payload.value.revision !== entry.request.payload.expectedRevision + 1 ||
          message.payload.value.value !== entry.request.payload.value)
      ) {
        settle(entry, failure("uncertain"));
        return;
      }
      if (
        entry.request.operation === "status.subscribe" ||
        entry.request.operation === "appearance.subscribe" ||
        entry.request.operation === "locale.subscribe"
      ) {
        const id = entry.request.payload.subscriptionId;
        if ((message.payload.value as { subscriptionId: string }).subscriptionId !== id) {
          settle(entry, failure("invalid_service_result"));
          const stream = streams.get(id);
          if (stream) close(stream, true);
          return;
        }
        const stream = streams.get(id);
        if (stream) stream.active = true;
      }
    } else if (
      entry.request.operation === "status.subscribe" ||
      entry.request.operation === "appearance.subscribe" ||
      entry.request.operation === "locale.subscribe"
    ) {
      const stream = streams.get(entry.request.payload.subscriptionId);
      if (stream) close(stream, false);
    }
    settle(entry, message.payload);
  });
  function call<K extends Operation>(
    operation: K,
    payload: OperationInputs[K],
    operationId?: string,
  ): PortCall<OperationOutputs[K]> {
    function rejected(
      code: "disposed" | "busy" | "invalid_message",
    ): PortCall<OperationOutputs[K]> {
      return { result: Promise.resolve(failure(code)), cancel() {} };
    }
    if (disposed) return rejected("disposed");
    if (pending.size >= portLimits.pending_per_window) return rejected("busy");
    const request = {
      protocol: 1,
      policy: policyId,
      kind: "request",
      ...generations,
      requestId: session.nextId(),
      operationId: operationId ?? session.nextId(),
      operation,
      payload,
    } as Request;
    const encoded = encodeEnvelope(request);
    if (!encoded.ok || pending.has(request.requestId)) return rejected("invalid_message");
    let entry: Pending;
    const result = new Promise<Outcome<OperationOutputs[K]>>((resolve) => {
      entry = {
        request,
        finish: (outcome) => {
          resolve(outcome as Outcome<OperationOutputs[K]>);
        },
        stopTimer() {},
      };
      pending.set(request.requestId, entry);
      entry.stopTimer = clock.after(portLimits.request_deadline_ms, () => {
        settle(
          entry,
          failure(
            operation === "appearance.replace" || operation === "locale.replace"
              ? "uncertain"
              : "timeout",
          ),
        );
        cancel(request);
        if (
          operation === "status.subscribe" ||
          operation === "appearance.subscribe" ||
          operation === "locale.subscribe"
        ) {
          const stream = streams.get((payload as { subscriptionId: string }).subscriptionId);
          if (stream) close(stream, false);
        }
      });
      try {
        transport.send(encoded.value);
      } catch {
        settle(
          entry,
          failure(
            operation === "appearance.replace" || operation === "locale.replace"
              ? "uncertain"
              : "service_unavailable",
          ),
        );
      }
    });
    return {
      result,
      cancel() {
        if (!pending.has(request.requestId)) return;
        settle(
          entry,
          failure(
            operation === "appearance.replace" || operation === "locale.replace"
              ? "uncertain"
              : "cancelled",
          ),
        );
        cancel(request);
      },
    };
  }
  function subscribe(
    topic: "status" | "appearance" | "locale",
    listener: Stream["listener"],
  ): Subscription {
    if (disposed || streams.size >= portLimits.subscriptions_per_window)
      return { ready: Promise.resolve(failure(disposed ? "disposed" : "busy")), dispose() {} };
    const id = session.nextId();
    if (!isIdentifier(id) || streams.has(id))
      return { ready: Promise.resolve(failure("invalid_message")), dispose() {} };
    const stream: Stream = {
      id,
      topic,
      listener,
      queue: [],
      bytes: 0,
      sequence: 0,
      revision: -1,
      active: false,
      stopDrain: undefined,
    };
    streams.set(id, stream);
    const opening = call(
      topic === "status"
        ? "status.subscribe"
        : topic === "locale"
          ? "locale.subscribe"
          : "appearance.subscribe",
      {
        subscriptionId: id,
      },
    );
    void opening.result.then((outcome) => {
      if (!outcome.ok) close(stream, false);
    });
    return {
      ready: opening.result,
      dispose() {
        opening.cancel();
        close(stream, false);
      },
    };
  }
  const port: FoundationPort = Object.freeze<FoundationPort>({
    readStatus: () => call("status.read", {}),
    readLocale: () => call("locale.read", {}),
    replaceLocale: (change, expectedServiceGeneration) => {
      const decoded = decodeLocaleChange(change);
      if (!decoded.ok) return { result: Promise.resolve(decoded), cancel() {} };
      // Reject before transport if the selector's snapshot belongs to a replaced service.
      if (
        expectedServiceGeneration !== undefined &&
        expectedServiceGeneration !== generations.serviceGeneration
      )
        return { result: Promise.resolve(failure("service_unavailable")), cancel() {} };
      return call(
        "locale.replace",
        { expectedRevision: decoded.value.expectedRevision, value: decoded.value.value },
        decoded.value.operationId,
      );
    },
    readLocaleReceipt: (operationId) => call("locale.receipt", { targetOperationId: operationId }),
    subscribeLocale: (listener) => subscribe("locale", listener as Stream["listener"]),
    readAppearance: () => call("appearance.read", {}),
    replaceAppearance: (change) => {
      const decoded = decodeAppearanceChange(change);
      if (!decoded.ok) return { result: Promise.resolve(decoded), cancel() {} };
      return call(
        "appearance.replace",
        { expectedRevision: decoded.value.expectedRevision, value: decoded.value.value },
        decoded.value.operationId,
      );
    },
    readAppearanceReceipt: (operationId) =>
      call("appearance.receipt", { targetOperationId: operationId }),
    subscribeStatus: (listener) => subscribe("status", listener as Stream["listener"]),
    subscribeAppearance: (listener) => subscribe("appearance", listener as Stream["listener"]),
  });
  return {
    port,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopListening();
      for (const stream of [...streams.values()]) close(stream, false);
      for (const entry of [...pending.values()]) {
        cancel(entry.request);
        settle(
          entry,
          failure(
            entry.request.operation === "appearance.replace" ||
              entry.request.operation === "locale.replace"
              ? "uncertain"
              : "disposed",
          ),
        );
      }
    },
  };
}
