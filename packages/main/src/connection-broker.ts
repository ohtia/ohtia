import {
  encodeEnvelope,
  failure,
  policyId,
  portLimits,
  type Request,
  type Envelope,
  type Outcome,
  type ConnectionSnapshot,
  type ModelPage,
  type DiagnosticEvent,
} from "@ohtia/contracts";
import { ConnectionManager } from "./connection-manager.js";
interface Work {
  readonly request: Request;
  deliver(text: string): void;
  release(): void;
  releaseSubscription(): void;
}
/** Uses PortAdmission's existing slots. Connection requests never enter ServiceSupervisor.dispatch. */
export class ConnectionBroker {
  private readonly streams = new Map<
    string,
    { work: Work; connection: string; sequence: number }
  >();
  private readonly stop: () => void;
  constructor(
    readonly manager: ConnectionManager,
    private readonly diagnostic?: (event: DiagnosticEvent) => void,
  ) {
    this.stop = manager.subscribe((event) => {
      for (const stream of this.streams.values()) {
        if (stream.connection !== event.connection) continue;
        this.deliver(stream.work, {
          protocol: 1,
          policy: policyId,
          kind: "event",
          windowGeneration: stream.work.request.windowGeneration,
          serviceGeneration: stream.work.request.serviceGeneration,
          subscriptionId: (stream.work.request.payload as { subscriptionId: string })
            .subscriptionId,
          sequence: ++stream.sequence,
          topic: "connection",
          payload: event,
        });
      }
    });
  }
  handle(work: Work): boolean {
    const request = work.request;
    if (!request.operation.startsWith("connection.")) return false;
    let replied = false;
    const reply = (payload: unknown) => {
      if (replied) return;
      replied = true;
      this.deliver(work, { ...request, kind: "result", payload });
    };
    const finish = (
      outcome: Outcome<ConnectionSnapshot | ModelPage | { subscriptionId: string }>,
    ) => {
      reply(outcome);
      work.release();
      if (!outcome.ok || request.operation !== "connection.subscribe") work.releaseSubscription();
    };
    switch (request.operation) {
      case "connection.subscribe": {
        this.diagnostic?.({ event_name: "ohtia.connection.subscribe" });
        if (!this.manager.snapshot(request.payload.connection)) {
          finish(failure("invalid_message"));
          break;
        }
        const key = `${request.windowGeneration}/${request.payload.subscriptionId}`;
        this.streams.set(key, { work, connection: request.payload.connection, sequence: 0 });
        finish({ ok: true, value: { subscriptionId: request.payload.subscriptionId } });
        break;
      }
      case "connection.connect":
        finish(this.manager.connect(request.payload.connection));
        break;
      case "connection.probe":
        finish(this.manager.probe(request.payload.connection));
        break;
      case "connection.listModels":
        this.diagnostic?.({ event_name: "ohtia.connection.list_models" });
        finish(this.manager.listModels(request.payload));
        break;
      case "connection.read":
      case "connection.disconnect": {
        const deadline = setTimeout(() => {
          reply(failure("timeout"));
        }, portLimits.request_deadline_ms);
        const result =
          request.operation === "connection.read"
            ? this.manager.read(request.payload.connection)
            : this.manager.disconnect(request.payload.connection);
        void result
          .then(finish, () => {
            finish(failure("service_unavailable"));
          })
          .finally(() => {
            clearTimeout(deadline);
          });
        break;
      }
    }
    return true;
  }
  private deliver(work: Work, value: unknown): void {
    const encoded = encodeEnvelope(value);
    if (encoded.ok) work.deliver(encoded.value);
  }
  control(envelope: Envelope): boolean {
    if (envelope.kind === "cancel") return envelope.operation.startsWith("connection.");
    if (envelope.kind !== "unsubscribe") return false;
    const key = `${envelope.windowGeneration}/${envelope.subscriptionId}`;
    const stream = this.streams.get(key);
    if (!stream || stream.work.request.serviceGeneration !== envelope.serviceGeneration)
      return false;
    stream.work.releaseSubscription();
    this.streams.delete(key);
    return true;
  }
  disposeWindow(generation: string): void {
    for (const [key, stream] of this.streams)
      if (stream.work.request.windowGeneration === generation) {
        stream.work.releaseSubscription();
        this.streams.delete(key);
      }
  }
  dispose(): void {
    this.stop();
    for (const stream of this.streams.values()) stream.work.releaseSubscription();
    this.streams.clear();
    this.manager.dispose();
  }
}
