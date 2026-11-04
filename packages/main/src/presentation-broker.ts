import { randomUUID } from "node:crypto";
import {
  decodeText,
  encodeEnvelope,
  failure,
  nextInterfaceZoom,
  type InterfaceZoom,
  type PresentationSnapshot,
  type PresentationRecord,
  type Request,
  type Outcome,
  type Operation,
  type OperationInputs,
  type OperationOutputs,
} from "@ohtia/contracts";
import type { ServiceSupervisor } from "./service-supervisor.js";

type Work = Parameters<ServiceSupervisor["dispatch"]>[0];
export interface ZoomTarget {
  setZoomFactor(factor: number): void;
  getZoomFactor(): number;
}
/** Application-wide admission and confirmed rendering. A view lifetime never owns this lock. */
export class PresentationBroker {
  private current: { generation: string; record: PresentationRecord<InterfaceZoom> } | undefined;
  private unresolved: { operationId: string; generation: string; uncertain: boolean } | undefined;
  private reconciliation: { operationId: string; generation: string } | undefined;
  constructor(private readonly targets: () => readonly ZoomTarget[]) {}
  accept(snapshot: PresentationSnapshot): void {
    if (
      this.current?.generation === snapshot.serviceGeneration &&
      snapshot.zoom.revision < this.current.record.revision
    )
      return;
    this.acceptZoom(snapshot.serviceGeneration, snapshot.zoom);
  }
  private acceptZoom(generation: string, record: PresentationRecord<InterfaceZoom>): void {
    if (this.current?.generation === generation && record.revision < this.current.record.revision)
      return;
    this.current = { generation, record };
    for (const target of this.targets()) this.apply(target);
  }
  apply(target: ZoomTarget): OperationOutputs["zoom.apply"] {
    const record = this.current?.record;
    const percent = record?.value ?? 100;
    let applied = false;
    try {
      if (Math.abs(target.getZoomFactor() - percent / 100) > 0.000001)
        target.setZoomFactor(percent / 100);
      applied = Math.abs(target.getZoomFactor() - percent / 100) <= 0.000001;
    } catch {
      /* Save success remains distinct from this target's rendering failure. */
    }
    return { revision: record?.revision ?? 0, percent, applied };
  }
  private request<K extends Operation>(
    service: ServiceSupervisor,
    origin: Request,
    operation: K,
    payload: OperationInputs[K],
    operationId: string = randomUUID(),
  ): Promise<Outcome<OperationOutputs[K]>> {
    return new Promise((resolve) => {
      service.dispatch({
        request: { ...origin, requestId: randomUUID(), operationId, operation, payload } as Request,
        release() {},
        releaseSubscription() {},
        deliver: (text) => {
          const result = decodeText(text);
          if (
            operation === "zoom.replace" &&
            result.ok &&
            result.value.kind === "result" &&
            result.value.operation === "zoom.replace" &&
            result.value.payload.ok
          ) {
            const expected = payload as OperationInputs["zoom.replace"];
            const record = result.value.payload.value;
            if (
              record.value !== expected.value ||
              record.revision !== expected.expectedRevision + 1
            ) {
              resolve(failure("uncertain"));
              return;
            }
          }
          if (
            operation === "zoom.commit" &&
            result.ok &&
            result.value.kind === "result" &&
            result.value.operation === "zoom.commit" &&
            result.value.payload.ok
          ) {
            const expected = payload as OperationInputs["zoom.commit"];
            const record = result.value.payload.value;
            if (
              record.revision !== expected.expectedRevision + 1 ||
              record.value !== expected.value
            ) {
              // Relative replay may return an older result, but only its original durable receipt can establish it.
              if (
                record.revision > expected.expectedRevision ||
                (this.current &&
                  this.current.generation === origin.serviceGeneration &&
                  this.current.record.revision === record.revision &&
                  this.current.record.value !== record.value)
              ) {
                resolve(failure("uncertain"));
                return;
              }
              const replay = result.value.payload as Outcome<OperationOutputs[K]>;
              void this.request(service, origin, "zoom.receipt", {
                targetOperationId: operationId,
              }).then(
                (receipt) => {
                  if (
                    receipt.ok &&
                    receipt.value.state === "recorded" &&
                    receipt.value.outcome.ok &&
                    receipt.value.outcome.value.revision === record.revision &&
                    receipt.value.outcome.value.value === record.value
                  )
                    resolve(replay);
                  else resolve(failure("uncertain"));
                },
                () => {
                  resolve(failure("uncertain"));
                },
              );
              return;
            }
          }
          resolve(
            result.ok && result.value.kind === "result" && result.value.operation === operation
              ? (result.value.payload as Outcome<OperationOutputs[K]>)
              : failure(
                  operation === "zoom.commit" || operation === "zoom.replace"
                    ? "uncertain"
                    : "invalid_service_result",
                ),
          );
        },
      });
    });
  }
  private reconcile(service: ServiceSupervisor): void {
    const lock = this.unresolved;
    if (
      !lock ||
      !lock.uncertain ||
      (this.reconciliation &&
        this.reconciliation.operationId === lock.operationId &&
        this.reconciliation.generation === service.generation)
    )
      return;
    const check = { operationId: lock.operationId, generation: service.generation };
    this.reconciliation = check;
    void service
      .request("zoom.receipt", { targetOperationId: lock.operationId })
      .then((receipt) => {
        if (this.unresolved !== lock || service.generation !== check.generation) return;
        if (
          receipt.ok &&
          (receipt.value.state === "recorded" ||
            (receipt.value.state === "not_found" && lock.generation !== check.generation))
        )
          this.unresolved = undefined;
      })
      .catch(() => {
        /* Unknown receipt state preserves application-wide admission. */
      })
      .finally(() => {
        if (this.reconciliation === check) this.reconciliation = undefined;
      });
  }
  initialize(service: ServiceSupervisor): void {
    void service.request("presentation.read", {}).then((snapshot) => {
      if (snapshot.ok) this.accept(snapshot.value);
    });
    this.reconcile(service);
  }
  /** Returns false for operations whose existing service dispatch remains unchanged. */
  handle(work: Work, service: ServiceSupervisor, target: ZoomTarget): boolean {
    const request = work.request;
    if (request.operation === "zoom.receipt") {
      service.dispatch({
        ...work,
        deliver: (text) => {
          const result = decodeText(text);
          if (
            result.ok &&
            result.value.kind === "result" &&
            result.value.operation === "zoom.receipt" &&
            result.value.payload.ok &&
            this.unresolved?.operationId === request.payload.targetOperationId &&
            (result.value.payload.value.state === "recorded" ||
              (result.value.payload.value.state === "not_found" &&
                this.unresolved.generation !== service.generation))
          )
            this.unresolved = undefined;
          work.deliver(text);
        },
      });
      return true;
    }
    if (
      request.operation !== "zoom.adjust" &&
      request.operation !== "zoom.replace" &&
      request.operation !== "zoom.apply"
    )
      return false;
    const reply = (payload: unknown) => {
      const encoded = encodeEnvelope({ ...request, kind: "result", payload });
      work.release();
      work.releaseSubscription();
      if (encoded.ok) work.deliver(encoded.value);
    };
    if (request.operation !== "zoom.apply" && this.unresolved) {
      reply(failure("busy"));
      this.reconcile(service);
      return true;
    }
    const lock = {
      operationId: request.operationId,
      generation: service.generation,
      uncertain: false,
    };
    if (request.operation !== "zoom.apply") this.unresolved = lock;
    void (async () => {
      if (request.operation === "zoom.apply") {
        this.reconcile(service);
        const snapshot = await this.request(service, request, "presentation.read", {});
        if (!snapshot.ok) {
          reply(snapshot);
          return;
        }
        this.accept(snapshot.value);
        reply({ ok: true, value: this.apply(target) });
        return;
      }
      let outcome: Outcome<OperationOutputs["zoom.replace"]>;
      if (request.operation === "zoom.adjust") {
        const snapshot = await this.request(service, request, "presentation.read", {});
        if (!snapshot.ok) {
          if (this.unresolved === lock) this.unresolved = undefined;
          reply(
            failure(
              snapshot.error.code === "preference_invalid"
                ? "preference_invalid"
                : "service_unavailable",
            ),
          );
          return;
        }
        this.accept(snapshot.value);
        const record = snapshot.value.zoom;
        // The broker selects the latest committed revision and percentage at admission.
        outcome = await this.request(
          service,
          request,
          "zoom.commit",
          {
            expectedRevision: record.revision,
            value: nextInterfaceZoom(record.value, request.payload.intent),
            intent: request.payload.intent,
          },
          request.operationId,
        );
      } else
        outcome = await this.request(
          service,
          request,
          "zoom.replace",
          request.payload,
          request.operationId,
        );
      if (outcome.ok) this.acceptZoom(service.generation, outcome.value);
      else if (outcome.error.code === "uncertain") lock.uncertain = true;
      if ((outcome.ok || outcome.error.code !== "uncertain") && this.unresolved === lock)
        this.unresolved = undefined;
      reply(outcome);
    })().catch(() => {
      lock.uncertain = true;
      reply(failure("uncertain"));
    });
    return true;
  }
}
