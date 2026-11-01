import { randomUUID } from "node:crypto";
import {
  decodeText,
  decodeLocaleSnapshot,
  decodeChildDiagnostic,
  type DiagnosticEvent,
  decodeStorageNotice,
  isInterfaceLocale,
  type InterfaceLocale,
  type LocaleSnapshot,
  type StorageNotice,
  encodeEnvelope,
  failure,
  isIdentifier,
  portLimits,
  type Request,
  type Envelope,
} from "@ohtia/contracts";

export interface SupervisedChild {
  send(message: string): void;
  kill(): void;
  messages(listener: (message: unknown) => void): void;
  exited(listener: () => void): void;
}
interface Work {
  readonly request: Request;
  readonly deliver: (text: string) => void;
  readonly release: () => void;
  readonly releaseSubscription: () => void;
}
function key(window: string, request: string): string {
  return `${window}/${request}`;
}
function sameRequest(a: Request, b: Extract<Envelope, { kind: "result" }>): boolean {
  return (
    a.requestId === b.requestId &&
    a.operationId === b.operationId &&
    a.windowGeneration === b.windowGeneration &&
    a.serviceGeneration === b.serviceGeneration &&
    a.operation === b.operation
  );
}
/** One child, one generation. A signal never releases accepted capacity; an exit receipt does. */
export class ServiceSupervisor {
  private readonly pending = new Map<string, Work>();
  private readonly correlations = new WeakMap<Work, string>();
  private readonly streams = new Map<string, Work>();
  private readonly deadlines = new Map<string, ReturnType<typeof setTimeout>>();
  private storageReported = false;
  private ready = false;
  private stopped = false;
  private faulted = false;
  private requestedStop = false;
  private readonly startup: ReturnType<typeof setTimeout>;
  private readonly terminationTimers = new Set<ReturnType<typeof setTimeout>>();
  private stopping: Promise<boolean> | undefined;
  private readonly exitWaiters = new Set<(ceased: boolean) => void>();
  constructor(
    private readonly child: SupervisedChild,
    readonly generation: string,
    private readonly changed: (state: "ready" | "unavailable", requestedStop?: boolean) => void,
    private readonly storageChanged?: (notice: StorageNotice) => void,
    private storageAdmitting = false,
    private readonly diagnostic?: (
      event: DiagnosticEvent | undefined,
      correlation?: string,
    ) => void,
    private readonly localeChanged?: (snapshot: LocaleSnapshot) => void,
  ) {
    if (!isIdentifier(generation)) throw new Error("Invalid service generation.");
    child.messages((message) => {
      this.receive(message);
    });
    child.exited(() => {
      this.didExit();
    });
    this.startup = setTimeout(() => {
      this.fault();
    }, portLimits.service_start_ms);
  }
  activateStorage(locale: InterfaceLocale): boolean {
    if (!this.available || !this.storageReported || !isInterfaceLocale(locale)) return false;
    try {
      this.child.send(
        JSON.stringify({ kind: "activate_storage", generation: this.generation, locale }),
      );
      return true;
    } catch {
      this.fault();
      return false;
    }
  }
  setSystemLocale(locale: InterfaceLocale): boolean {
    if (!this.available || !isInterfaceLocale(locale)) return false;
    try {
      this.child.send(
        JSON.stringify({ kind: "system_locale", generation: this.generation, locale }),
      );
      return true;
    } catch {
      this.fault();
      return false;
    }
  }
  get available(): boolean {
    return this.ready && !this.stopped && !this.faulted;
  }
  get recoveryRequired(): boolean {
    return this.faulted;
  }
  get ceased(): boolean {
    return this.stopped;
  }
  dispatch(work: Work): void {
    if (!this.available || this.storageAdmitting) {
      this.reject(work);
      return;
    }
    const id = key(work.request.windowGeneration, work.request.requestId);
    this.pending.set(id, work);
    this.correlations.set(work, randomUUID());
    this.deadlines.set(
      id,
      setTimeout(() => {
        this.fault();
      }, portLimits.request_deadline_ms),
    );
    if (
      work.request.operation === "status.subscribe" ||
      work.request.operation === "appearance.subscribe" ||
      work.request.operation === "locale.subscribe"
    )
      this.streams.set(
        key(work.request.windowGeneration, work.request.payload.subscriptionId),
        work,
      );
    if (!this.send(work.request)) this.fault();
  }
  control(envelope: Envelope): void {
    if (envelope.kind !== "cancel" && envelope.kind !== "unsubscribe") return;
    if (envelope.serviceGeneration !== this.generation || this.stopped) return;
    if (envelope.kind === "cancel") {
      const work = this.pending.get(key(envelope.windowGeneration, envelope.requestId));
      if (
        !work ||
        work.request.operationId !== envelope.operationId ||
        work.request.operation !== envelope.operation
      )
        return;
    } else if (!this.streams.has(key(envelope.windowGeneration, envelope.subscriptionId))) return;
    if (!this.send(envelope)) this.fault();
  }
  disposeWindow(windowGeneration: string): void {
    for (const work of this.streams.values()) {
      if (
        work.request.windowGeneration !== windowGeneration ||
        (work.request.operation !== "status.subscribe" &&
          work.request.operation !== "appearance.subscribe" &&
          work.request.operation !== "locale.subscribe")
      )
        continue;
      this.control({
        protocol: 1,
        policy: work.request.policy,
        kind: "unsubscribe",
        windowGeneration,
        serviceGeneration: this.generation,
        subscriptionId: work.request.payload.subscriptionId,
      });
    }
    for (const work of this.pending.values())
      if (work.request.windowGeneration === windowGeneration) {
        const request = work.request;
        this.control({
          protocol: request.protocol,
          policy: request.policy,
          kind: "cancel",
          requestId: request.requestId,
          operationId: request.operationId,
          windowGeneration: request.windowGeneration,
          serviceGeneration: request.serviceGeneration,
          operation: request.operation,
        });
      }
  }
  private send(value: unknown): boolean {
    const encoded = encodeEnvelope(value);
    if (!encoded.ok) return false;
    try {
      this.child.send(encoded.value);
      return true;
    } catch {
      return false;
    }
  }
  private reject(work: Work): void {
    const encoded = encodeEnvelope({
      ...work.request,
      kind: "result",
      payload: failure("service_unavailable"),
    });
    if (encoded.ok) work.deliver(encoded.value);
    work.release();
    work.releaseSubscription();
  }
  private receive(input: unknown): void {
    if (this.stopped || this.faulted) return;
    // Private lifecycle acknowledgements are fixed-size and never forwarded to a renderer.
    if (
      typeof input === "string" &&
      input === JSON.stringify({ kind: "ready", generation: this.generation })
    ) {
      if (this.ready) {
        this.fault();
        return;
      }
      clearTimeout(this.startup);
      this.ready = true;
      this.changed("ready");
      return;
    }
    if (typeof input === "string" && input.length < portLimits.message_bytes) {
      try {
        const ack: unknown = JSON.parse(input);
        if (ack && typeof ack === "object" && "kind" in ack && ack.kind === "diagnostic") {
          this.diagnostic?.(decodeChildDiagnostic(input, this.generation));
          return;
        }
        const storage = decodeStorageNotice(ack);
        if (storage) {
          if (
            !this.ready ||
            this.storageReported ||
            storage.generation !== this.generation ||
            !this.storageChanged
          ) {
            this.fault();
            return;
          }
          this.storageReported = true;
          this.storageAdmitting = false;
          this.storageChanged(storage);
          return;
        }
        if (ack && typeof ack === "object") {
          const value = ack as Record<string, unknown>;
          if (
            value.kind === "stream_disposed" &&
            Object.keys(value).sort().join(",") ===
              "generation,kind,subscriptionId,windowGeneration" &&
            value.generation === this.generation &&
            isIdentifier(value.windowGeneration) &&
            isIdentifier(value.subscriptionId)
          ) {
            const id = key(value.windowGeneration, value.subscriptionId);
            this.streams.get(id)?.releaseSubscription();
            this.streams.delete(id);
            return;
          }
        }
      } catch {
        /* Application decoder below controls all other input. */
      }
    }
    if (typeof input === "string" && input.length < portLimits.message_bytes) {
      try {
        const notice: unknown = JSON.parse(input);
        if (
          notice &&
          typeof notice === "object" &&
          "kind" in notice &&
          notice.kind === "locale_changed" &&
          "generation" in notice &&
          "snapshot" in notice &&
          notice.generation === this.generation &&
          Object.keys(notice).sort().join(",") === "generation,kind,snapshot"
        ) {
          const snapshot = decodeLocaleSnapshot(notice.snapshot);
          if (!snapshot || snapshot.serviceGeneration !== this.generation || !this.ready) {
            this.fault();
            return;
          }
          this.localeChanged?.(snapshot);
          return;
        }
      } catch {
        /* The ordinary peer decoder rejects other input. */
      }
    }
    const decoded = decodeText(input);
    if (!decoded.ok) {
      this.fault();
      return;
    }
    const value = decoded.value;
    if (value.serviceGeneration !== this.generation) return;
    if (!this.ready) {
      this.fault();
      return;
    }
    if (value.kind === "result") {
      const id = key(value.windowGeneration, value.requestId);
      const work = this.pending.get(id);
      if (!work) return;
      if (!sameRequest(work.request, value)) {
        this.fault();
        return;
      }
      if (value.operation === "locale.read" && value.payload.ok)
        this.localeChanged?.(value.payload.value);
      if (value.operation === "appearance.replace") {
        const outcome = value.payload;
        if (outcome.ok)
          this.diagnostic?.({ event_name: "ohtia.appearance.saved" }, this.correlations.get(work));
        else if (outcome.error.code === "uncertain")
          this.diagnostic?.(
            { event_name: "ohtia.appearance.uncertain", error_code: "uncertain" },
            this.correlations.get(work),
          );
        else if (
          [
            "storage_failed",
            "stale_revision",
            "operation_conflict",
            "service_unavailable",
          ].includes(outcome.error.code)
        )
          this.diagnostic?.(
            {
              event_name: "ohtia.appearance.failed",
              error_code: outcome.error.code as
                "storage_failed" | "stale_revision" | "operation_conflict" | "service_unavailable",
            },
            this.correlations.get(work),
          );
      }
      this.pending.delete(id);
      const deadline = this.deadlines.get(id);
      if (deadline) clearTimeout(deadline);
      this.deadlines.delete(id);
      if (!value.payload.ok) {
        work.releaseSubscription();
        if (
          work.request.operation === "status.subscribe" ||
          work.request.operation === "appearance.subscribe" ||
          work.request.operation === "locale.subscribe"
        )
          this.streams.delete(
            key(work.request.windowGeneration, work.request.payload.subscriptionId),
          );
      }
      work.release();
      work.deliver(input as string);
      return;
    }
    if (value.kind === "event") {
      const work = this.streams.get(key(value.windowGeneration, value.subscriptionId));
      if (
        !work ||
        (value.topic === "status"
          ? work.request.operation !== "status.subscribe"
          : value.topic === "locale"
            ? work.request.operation !== "locale.subscribe"
            : work.request.operation !== "appearance.subscribe")
      ) {
        this.fault();
        return;
      }
      if (value.topic === "locale") this.localeChanged?.(value.payload);
      work.deliver(input as string);
      return;
    }
    this.fault();
  }
  private fault(): void {
    if (this.faulted || this.stopped) return;
    this.faulted = true;
    this.ready = false;
    clearTimeout(this.startup);
    this.changed("unavailable");
    try {
      this.child.kill();
    } catch {
      /* Capacity remains quarantined without exit evidence. */
    }
  }
  private didExit(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.startup);
    for (const timer of this.terminationTimers) clearTimeout(timer);
    this.terminationTimers.clear();
    for (const work of this.pending.values()) {
      const encoded = encodeEnvelope({
        ...work.request,
        kind: "result",
        payload: failure(
          work.request.operation === "appearance.replace" ||
            work.request.operation === "locale.replace" ||
            work.request.operation === "layout.replace"
            ? "uncertain"
            : "service_unavailable",
        ),
      });
      if (encoded.ok) work.deliver(encoded.value);
      work.release();
      work.releaseSubscription();
    }
    for (const work of this.streams.values()) work.releaseSubscription();
    this.pending.clear();
    for (const timer of this.deadlines.values()) clearTimeout(timer);
    this.deadlines.clear();
    this.streams.clear();
    this.changed("unavailable", this.requestedStop);
    for (const waiter of this.exitWaiters) waiter(true);
    this.exitWaiters.clear();
  }
  /** The child creates no descendants; native acceptance separately observes Electron's complete tree. */
  stop(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(true);
    if (this.stopping) return this.stopping;
    this.ready = false;
    this.faulted = true;
    this.requestedStop = true;
    clearTimeout(this.startup);
    this.changed("unavailable", true);
    const attempt = new Promise<boolean>((resolve) => {
      const finish = (ceased: boolean) => {
        clearTimeout(grace);
        clearTimeout(total);
        this.terminationTimers.delete(grace);
        this.terminationTimers.delete(total);
        this.exitWaiters.delete(finish);
        resolve(ceased);
      };
      const grace = setTimeout(() => {
        try {
          this.child.kill();
        } catch {
          /* Keep waiting for cessation. */
        }
      }, portLimits.shutdown_grace_ms);
      const total = setTimeout(() => {
        finish(false);
      }, portLimits.shutdown_total_ms);
      this.terminationTimers.add(grace);
      this.terminationTimers.add(total);
      this.exitWaiters.add(finish);
      try {
        this.child.send(JSON.stringify({ kind: "shutdown", generation: this.generation }));
      } catch {
        // The bounded grace timer still attempts termination; uncertainty retains capacity.
      }
    });
    this.stopping = attempt;
    void attempt.then(() => {
      if (this.stopping === attempt) this.stopping = undefined;
    });
    return attempt;
  }
}

/** Re-admit recovery after cessation; a quit or another retry may supersede the wait. */
export async function recoverService(
  service: ServiceSupervisor,
  admitted: () => boolean,
  restart: () => void,
): Promise<"ready" | "cancelled" | "uncertain"> {
  if (!admitted()) return "cancelled";
  if (service.recoveryRequired && !service.ceased && !(await service.stop()))
    return admitted() ? "uncertain" : "cancelled";
  if (!admitted()) return "cancelled";
  if (service.ceased) restart();
  return "ready";
}
