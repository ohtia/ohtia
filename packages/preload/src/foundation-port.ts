import { decodeExecutionLimitsChange } from "@ohtia/contracts";
import {
  type ConnectionEvent,
  type ResearchEvent,
  type ResearchScope,
  isResearchMutation,
  isResearchOperation,
  researchResultMatches,
  decodeAppearanceChange,
  decodePresentationChange,
  type PresentationSnapshot,
  decodeLocaleChange,
  type LocaleSnapshot,
  decodeLayoutChange,
  sameWorkspaceLayout,
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
  readonly connection?: string;
  readonly topic: "status" | "appearance" | "locale" | "presentation" | "connection" | "research";
  readonly listener: (
    notice: Outcome<
      | FoundationStatus
      | AppearanceRecord
      | LocaleSnapshot
      | PresentationSnapshot
      | ConnectionEvent
      | ResearchEvent
    >,
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
          (entry.request.operation === "connection.subscribe" ||
            entry.request.operation === "status.subscribe" ||
            entry.request.operation === "appearance.subscribe" ||
            entry.request.operation === "locale.subscribe" ||
            entry.request.operation === "research.subscribe" ||
            entry.request.operation === "presentation.subscribe") &&
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
          isResearchMutation(entry.request.operation) ||
            entry.request.operation === "appearance.replace" ||
            entry.request.operation === "limits.replace" ||
            entry.request.operation === "locale.replace" ||
            entry.request.operation === "layout.replace" ||
            entry.request.operation === "character.replace" ||
            entry.request.operation === "zoom.replace" ||
            entry.request.operation === "zoom.adjust"
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
      (event.topic === "connection" && event.payload.connection !== stream.connection) ||
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
          isResearchMutation(entry.request.operation) ||
            entry.request.operation === "appearance.replace" ||
            entry.request.operation === "limits.replace" ||
            entry.request.operation === "locale.replace" ||
            entry.request.operation === "layout.replace" ||
            entry.request.operation === "character.replace" ||
            entry.request.operation === "zoom.replace" ||
            entry.request.operation === "zoom.adjust"
            ? "uncertain"
            : "invalid_service_result",
        ),
      );
      return;
    }
    if (message.payload.ok) {
      if (
        isResearchOperation(entry.request.operation) &&
        !researchResultMatches(
          entry.request.operation,
          entry.request.payload,
          message.payload.value,
        )
      ) {
        settle(entry, failure("invalid_service_result"));
        return;
      }
      if (
        entry.request.operation.startsWith("connection.") &&
        message.operation === entry.request.operation &&
        entry.request.operation !== "connection.subscribe"
      ) {
        const value = message.payload.value as { connection: string };
        const input = entry.request.payload as { connection: string };
        if (value.connection !== input.connection) {
          settle(entry, failure("invalid_service_result"));
          return;
        }
      }
      if (entry.request.operation === "connection.listModels") {
        const value = message.payload.value as OperationOutputs["connection.listModels"];
        const input = entry.request.payload;
        if (
          value.model_list_revision !== input.model_list_revision ||
          value.models.length > input.count ||
          value.nextCursor !== input.cursor + value.models.length ||
          (value.hasMore && value.models.length === 0)
        ) {
          settle(entry, failure("invalid_service_result"));
          return;
        }
      }
      if (
        entry.request.operation === "limits.replace" &&
        (message.operation !== "limits.replace" ||
          message.payload.value.max_concurrent_inference !== entry.request.payload.value)
      ) {
        settle(entry, failure("uncertain"));
        return;
      }
      if (
        (entry.request.operation === "appearance.replace" ||
          entry.request.operation === "locale.replace" ||
          entry.request.operation === "character.replace" ||
          entry.request.operation === "zoom.replace") &&
        (message.operation !== entry.request.operation ||
          message.payload.value.revision !== entry.request.payload.expectedRevision + 1 ||
          message.payload.value.value !== entry.request.payload.value)
      ) {
        settle(entry, failure("uncertain"));
        return;
      }
      if (
        entry.request.operation === "layout.replace" &&
        (message.operation !== "layout.replace" ||
          message.payload.value.revision !== entry.request.payload.expectedRevision + 1 ||
          !sameWorkspaceLayout(message.payload.value.value, entry.request.payload.value))
      ) {
        settle(entry, failure("uncertain"));
        return;
      }
      if (
        entry.request.operation === "connection.subscribe" ||
        entry.request.operation === "status.subscribe" ||
        entry.request.operation === "appearance.subscribe" ||
        entry.request.operation === "locale.subscribe" ||
        entry.request.operation === "research.subscribe" ||
        entry.request.operation === "presentation.subscribe"
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
      entry.request.operation === "connection.subscribe" ||
      entry.request.operation === "status.subscribe" ||
      entry.request.operation === "appearance.subscribe" ||
      entry.request.operation === "locale.subscribe" ||
      entry.request.operation === "research.subscribe" ||
      entry.request.operation === "presentation.subscribe"
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
            isResearchMutation(operation) ||
              operation === "appearance.replace" ||
              operation === "limits.replace" ||
              operation === "locale.replace" ||
              operation === "layout.replace" ||
              operation === "character.replace" ||
              operation === "zoom.replace" ||
              operation === "zoom.adjust"
              ? "uncertain"
              : "timeout",
          ),
        );
        cancel(request);
        if (
          operation === "connection.subscribe" ||
          operation === "status.subscribe" ||
          operation === "appearance.subscribe" ||
          operation === "locale.subscribe" ||
          operation === "research.subscribe" ||
          operation === "presentation.subscribe"
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
            isResearchMutation(operation) ||
              operation === "appearance.replace" ||
              operation === "limits.replace" ||
              operation === "locale.replace" ||
              operation === "layout.replace" ||
              operation === "character.replace" ||
              operation === "zoom.replace" ||
              operation === "zoom.adjust"
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
            isResearchMutation(operation) ||
              operation === "appearance.replace" ||
              operation === "limits.replace" ||
              operation === "locale.replace" ||
              operation === "layout.replace" ||
              operation === "character.replace" ||
              operation === "zoom.replace" ||
              operation === "zoom.adjust"
              ? "uncertain"
              : "cancelled",
          ),
        );
        cancel(request);
      },
    };
  }
  function subscribe(
    topic: "status" | "appearance" | "locale" | "presentation" | "connection" | "research",
    listener: Stream["listener"],
    connection?: string,
    scope?: ResearchScope,
  ): Subscription {
    if (disposed || streams.size >= portLimits.subscriptions_per_window)
      return { ready: Promise.resolve(failure(disposed ? "disposed" : "busy")), dispose() {} };
    const id = session.nextId();
    if (!isIdentifier(id) || streams.has(id))
      return { ready: Promise.resolve(failure("invalid_message")), dispose() {} };
    const stream: Stream = {
      id,
      ...(connection === undefined ? {} : { connection }),
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
      topic === "research"
        ? "research.subscribe"
        : topic === "connection"
          ? "connection.subscribe"
          : topic === "presentation"
            ? "presentation.subscribe"
            : topic === "status"
              ? "status.subscribe"
              : topic === "locale"
                ? "locale.subscribe"
                : "appearance.subscribe",
      {
        subscriptionId: id,
        ...scope,
        ...(connection === undefined ? {} : { connection }),
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
    createProject: (id) => call("project.create", {}, id),
    openProject: (id, input) => call("project.open", input, id),
    confirmProjectSetup: (id, input) => call("project.confirmSetup", input, id),
    rejectProjectSetup: (id, input) => call("project.rejectSetup", input, id),
    startConversation: (id, input) => call("conversation.start", input, id),
    renameConversation: (id, input) => call("conversation.rename", input, id),
    stopConversation: (id, input) => call("conversation.stop", input, id),
    readPauses: () => call("pause.read", {}),
    acceptHandoff: (id, input) => call("handoff.accept", input, id),
    declineHandoff: (id, input) => call("handoff.decline", input, id),
    returnHandoff: (id, input) => call("handoff.return", input, id),
    listHandoffSelection: (input) => call("handoff.selection", input),
    cancelPlan: (id, input) => call("plan.cancel", input, id),
    acceptPlan: (id, input) => call("plan.accept", input, id),
    declinePlan: (id, input) => call("plan.decline", input, id),
    readPlan: (input) => call("plan.read", input),
    listPlanEvents: (input) => call("planEvent.list", input),
    finishPlan: (id, input) => call("plan.finish", input, id),
    acceptConsultation: (id, input) => call("consultation.accept", input, id),
    declineConsultation: (id, input) => call("consultation.decline", input, id),
    tryAgainContribution: (id, input) => call("contribution.tryAgain", input, id),
    startAgainContribution: (id, input) => call("contribution.startAgain", input, id),
    tryAgainSynthesis: (id, input) => call("synthesis.tryAgain", input, id),
    tryAgainTask: (id, input) => call("task.tryAgain", input, id),
    startAgainTask: (id, input) => call("task.startAgain", input, id),
    resumeUsagePause: (id, input) => call("usagePause.resume", input, id),
    continueAllTasks: (id) => call("task.continueAll", {}, id),
    stopTask: (id, input) => call("task.stop", input, id),
    readDestination: (input) => call("destination.read", input),
    appendMessage: (id, input) => call("message.append", input, id),
    listProjects: (input) => call("project.list", input),
    listConversations: (input) => call("conversation.list", input),
    readConversations: (input) => call("conversation.read", input),
    listTimelineBefore: (input) => call("timeline.listBefore", input),
    readTimeline: (input) => call("timeline.read", input),
    sendTextPart: (id, input) => call("text.part", input, id),
    readTextPart: (input) => call("text.readPart", input),
    readReplyParts: (input) => call("reply.readParts", input),
    subscribeResearch: (scope, listener) =>
      subscribe("research", listener as Stream["listener"], undefined, scope),

    readConnection: (connection) => call("connection.read", { connection }),
    connectConnection: (connection, options) =>
      call("connection.connect", { connection, ...options }),
    disconnectConnection: (connection) => call("connection.disconnect", { connection }),
    probeConnection: (connection) => call("connection.probe", { connection }),
    listConnectionModels: (input) => call("connection.listModels", input),
    subscribeConnection: (connection, listener) =>
      subscribe("connection", listener as Stream["listener"], connection),
    readPresentation: () => call("presentation.read", {}),
    subscribePresentation: (listener) => subscribe("presentation", listener as Stream["listener"]),
    replaceCharacter: (change, expectedServiceGeneration) => {
      if (
        expectedServiceGeneration !== undefined &&
        expectedServiceGeneration !== generations.serviceGeneration
      )
        return { result: Promise.resolve(failure("service_unavailable")), cancel() {} };
      const decoded = decodePresentationChange("character", change);
      return decoded.ok
        ? call(
            "character.replace",
            { expectedRevision: decoded.value.expectedRevision, value: decoded.value.value },
            decoded.value.operationId,
          )
        : { result: Promise.resolve(decoded), cancel() {} };
    },
    readCharacterReceipt: (id) => call("character.receipt", { targetOperationId: id }),
    replaceZoom: (change, expectedServiceGeneration) => {
      if (
        expectedServiceGeneration !== undefined &&
        expectedServiceGeneration !== generations.serviceGeneration
      )
        return { result: Promise.resolve(failure("service_unavailable")), cancel() {} };
      const decoded = decodePresentationChange("zoom", change);
      return decoded.ok
        ? call(
            "zoom.replace",
            { expectedRevision: decoded.value.expectedRevision, value: decoded.value.value },
            decoded.value.operationId,
          )
        : { result: Promise.resolve(decoded), cancel() {} };
    },
    adjustZoom: (id, intent, expectedServiceGeneration) =>
      expectedServiceGeneration !== undefined &&
      expectedServiceGeneration !== generations.serviceGeneration
        ? { result: Promise.resolve(failure("service_unavailable")), cancel() {} }
        : call("zoom.adjust", { intent }, id),
    readZoomReceipt: (id) => call("zoom.receipt", { targetOperationId: id }),
    applyZoom: () => call("zoom.apply", {}),
    claimLayoutFailureNotice: () => call("layout.failureNotice", {}),
    readLayout: () => call("layout.read", {}),
    replaceLayout: (change) => {
      const decoded = decodeLayoutChange(change);
      if (!decoded.ok) return { result: Promise.resolve(decoded), cancel() {} };
      return call(
        "layout.replace",
        { expectedRevision: decoded.value.expectedRevision, value: decoded.value.value },
        decoded.value.operationId,
      );
    },
    readLayoutReceipt: (operationId) => call("layout.receipt", { targetOperationId: operationId }),
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
    readExecutionLimits: () => call("limits.read", {}),
    replaceExecutionLimits: (change, expectedServiceGeneration) => {
      const decoded = decodeExecutionLimitsChange(change);
      if (!decoded.ok) return { result: Promise.resolve(decoded), cancel() {} };
      if (
        expectedServiceGeneration !== undefined &&
        expectedServiceGeneration !== generations.serviceGeneration
      )
        return { result: Promise.resolve(failure("service_unavailable")), cancel() {} };
      return call("limits.replace", { value: decoded.value.value }, decoded.value.operationId);
    },
    readExecutionLimitsReceipt: (id) => call("limits.receipt", { targetOperationId: id }),
    readAppearance: () => call("appearance.read", {}),
    replaceAppearance: (change, expectedServiceGeneration) => {
      if (
        expectedServiceGeneration !== undefined &&
        expectedServiceGeneration !== generations.serviceGeneration
      )
        return { result: Promise.resolve(failure("service_unavailable")), cancel() {} };
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
            isResearchMutation(entry.request.operation) ||
              entry.request.operation === "appearance.replace" ||
              entry.request.operation === "limits.replace" ||
              entry.request.operation === "locale.replace" ||
              entry.request.operation === "layout.replace" ||
              entry.request.operation === "character.replace" ||
              entry.request.operation === "zoom.replace" ||
              entry.request.operation === "zoom.adjust"
              ? "uncertain"
              : "disposed",
          ),
        );
      }
    },
  };
}
