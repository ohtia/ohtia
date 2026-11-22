import { isResearchMutation } from "@ohtia/contracts";
import type { ConnectionManager } from "./connection-manager.js";
import { RequestBudget } from "./port-admission.js";
import { randomUUID } from "node:crypto";
import {
  decodeText,
  dataServiceExitReason,
  decodeApplicationExit,
  type ApplicationExitState,
  decodeEnvelope,
  decodeDevelopmentReport,
  decodeProviderDispatch,
  decodeLateUsageReceipt,
  type LateUsageReceipt,
  decodeProviderInterrupt,
  decodeServiceWake,
  type ServiceWakeMessage,
  decodeModelListRefresh,
  type ModelListRefreshMessage,
  type DevelopmentReportMessage,
  type ProviderDispatchMessage,
  type ProviderInterruptMessage,
  decodeLocaleSnapshot,
  decodePresentationSnapshot,
  type PresentationSnapshot,
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
  providerDispatchBytes,
  policyId,
  type Operation,
  type OperationInputs,
  type OperationOutputs,
  type Outcome,
  type AppearanceRecord,
  type Request,
  type Envelope,
} from "@ohtia/contracts";

export interface SupervisedChild {
  send(message: string): void;
  kill(): void;
  messages(listener: (message: unknown) => void): void;
  exited(listener: (code?: number) => void): void;
}
/** Main's receivers for the provider messages of this generation's data service. */
export interface ProviderChannel {
  exitState?(state: ApplicationExitState): void;
  wakeReviewed?(message: ServiceWakeMessage): void;
  refreshModels?(message: ModelListRefreshMessage): void;
  dispatch(message: ProviderDispatchMessage): void;
  interrupt(message: ProviderInterruptMessage): void;
  report?(message: DevelopmentReportMessage): void;
  usageReceipt?(message: LateUsageReceipt): void;
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
type ServiceFault = Extract<DiagnosticEvent, { event_name: "ohtia.service.faulted" }>["error_code"];

/** One child, one generation. A signal never releases accepted capacity; an exit receipt does. */
export class ServiceSupervisor {
  private readonly modelRefreshes = new Map<string, string>();
  private readonly pending = new Map<string, Work>();
  private readonly correlations = new WeakMap<Work, string>();
  private readonly streams = new Map<string, Work>();
  private readonly deadlines = new Map<string, ReturnType<typeof setTimeout>>();
  private storageReported = false;
  private ready = false;
  private stopped = false;
  private unavailableCause: ServiceFault | "requested_stop" | undefined;
  private requestedStop = false;
  private readonly startup: ReturnType<typeof setTimeout>;
  private readonly terminationTimers = new Set<ReturnType<typeof setTimeout>>();
  private stopping: Promise<boolean> | undefined;
  private stoppingAdmitted: (() => boolean) | undefined;
  private cancelStopping: (() => void) | undefined;
  private shutdownDrain: Promise<void> | undefined;
  private shutdownDrained = false;
  private shutdownSent = false;
  private systemShutdown = false;
  private stopDiagnosticForwarded = false;
  private provider: ProviderChannel | undefined;
  private readonly pendingWakes: { text: string; message: ServiceWakeMessage }[] = [];
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
    private readonly presentationChanged?: (snapshot: PresentationSnapshot) => void,
    private readonly appearanceChanged?: (record: AppearanceRecord) => void,
    private readonly requestBudget = new RequestBudget(),
    private readonly beforeShutdown?: () => Promise<void>,
  ) {
    if (!isIdentifier(generation)) throw new Error("Invalid service generation.");
    child.messages((message) => {
      this.receive(message);
    });
    child.exited((code) => {
      this.didExit(code);
    });
    this.startup = setTimeout(() => {
      this.fault("startup_timeout");
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
      this.fault("channel_write_failed");
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
      this.fault("channel_write_failed");
      return false;
    }
  }
  connectProvider(channel: ProviderChannel): void {
    this.provider = channel;
  }
  /** Keep ordered wake reviews within the shared channel's pending bound, including startup. */
  postWake(text: string): boolean {
    const wake = decodeServiceWake(text);
    if (!wake || wake.generation !== this.generation || this.stopped || this.unavailableCause)
      return false;
    if (this.pendingWakes.length >= portLimits.pending_global) {
      this.fault("wake_queue_full");
      return false;
    }
    this.pendingWakes.push({ text, message: wake });
    return !this.ready || this.postProvider(text);
  }
  /** Post a provider event or development action; a channel failure ends this generation. */
  postProvider(text: string): boolean {
    if (!this.available) return false;
    try {
      this.child.send(text);
      return true;
    } catch {
      this.fault("channel_write_failed");
      return false;
    }
  }
  get available(): boolean {
    return this.ready && !this.stopped && !this.unavailableCause;
  }
  get recoveryRequired(): boolean {
    return this.unavailableCause !== undefined;
  }
  get ceased(): boolean {
    return this.stopped;
  }
  /** Trusted broker calls share the bounded peer, decoders and pending work inventory. */
  request<K extends Operation>(
    operation: K,
    payload: OperationInputs[K],
    operationId = randomUUID(),
  ): Promise<Outcome<OperationOutputs[K]>> {
    if (this.pending.size >= portLimits.pending_global) return Promise.resolve(failure("busy"));
    return new Promise((resolve) => {
      const request = {
        protocol: 1,
        policy: policyId,
        kind: "request",
        requestId: randomUUID(),
        operationId,
        windowGeneration: this.generation,
        serviceGeneration: this.generation,
        operation,
        payload,
      };
      const decoded = decodeEnvelope(request);
      if (!decoded.ok || decoded.value.kind !== "request") {
        resolve(failure("invalid_message"));
        return;
      }
      const reservation = this.requestBudget.reserveBroker();
      if (!reservation.ok) {
        resolve(reservation);
        return;
      }
      this.dispatch({
        request: decoded.value,
        release: reservation.value,
        releaseSubscription() {},
        deliver: (text) => {
          const result = decodeText(text);
          resolve(
            result.ok && result.value.kind === "result" && result.value.operation === operation
              ? (result.value.payload as Outcome<OperationOutputs[K]>)
              : failure("invalid_service_result"),
          );
        },
      });
    });
  }
  reportConnections(manager: ConnectionManager): boolean {
    if (!this.available) return false;
    try {
      for (const connection of manager.ids()) {
        const full = manager.snapshot(connection);
        if (!full) continue;
        const account = manager.account(connection);
        const report = manager.modelListReport(connection);
        const currentList =
          report && full.model_list_revision !== null && report.fingerprint === account.fingerprint;
        const snapshot = {
          connection_kind: account.kind,
          ...(account.fingerprint ? { account_fingerprint: account.fingerprint } : {}),
          ...(account.revision ? { account_revision: account.revision } : {}),
          connection: full.connection,
          state: full.state,
          reason: full.reason,
          probing: full.probing,
          probe_id: full.probe_id,
          model_list_revision: currentList ? full.model_list_revision : null,
          model_count: currentList ? full.model_count : 0,
          ...(currentList ? { model_report_id: report.id, model_read_at: report.date } : {}),
        };
        const refresh_id = this.modelRefreshes.get(connection);
        this.child.send(
          JSON.stringify({
            kind: "connection_state",
            generation: this.generation,
            snapshot,
            ...(refresh_id ? { refresh_id } : {}),
          }),
        );
        if (refresh_id && !snapshot.probing && this.modelRefreshes.get(connection) === refresh_id)
          this.modelRefreshes.delete(connection);
        if (snapshot.model_list_revision === null) continue;
        let cursor = 0;
        for (;;) {
          const page = manager.listModels({
            connection,
            model_list_revision: snapshot.model_list_revision,
            cursor,
            count: 128,
          });
          if (!page.ok) return false;
          this.child.send(
            JSON.stringify({
              kind: "connection_models",
              generation: this.generation,
              page: page.value,
            }),
          );
          cursor = page.value.nextCursor;
          if (!page.value.hasMore) break;
        }
      }
      return true;
    } catch {
      this.fault("channel_write_failed");
      return false;
    }
  }
  dispatch(work: Work): void {
    // Defense in depth: no future composition may forward a credential-bearing connection action.
    if (work.request.operation.startsWith("connection.")) {
      this.reject(work);
      return;
    }
    if (!this.available || this.storageAdmitting) {
      this.reject(work);
      return;
    }
    if (this.pending.size >= portLimits.pending_global) {
      this.reject(work, "busy");
      return;
    }
    const id = key(work.request.windowGeneration, work.request.requestId);
    this.pending.set(id, work);
    this.correlations.set(work, randomUUID());
    this.deadlines.set(
      id,
      setTimeout(() => {
        const encoded = encodeEnvelope({
          ...work.request,
          kind: "result",
          payload: failure(isResearchMutation(work.request.operation) ? "uncertain" : "timeout"),
        });
        if (encoded.ok) work.deliver(encoded.value);
        this.fault("request_timeout");
      }, portLimits.request_deadline_ms),
    );
    if (
      work.request.operation === "status.subscribe" ||
      work.request.operation === "appearance.subscribe" ||
      work.request.operation === "locale.subscribe" ||
      work.request.operation === "research.subscribe" ||
      work.request.operation === "presentation.subscribe"
    )
      this.streams.set(
        key(work.request.windowGeneration, work.request.payload.subscriptionId),
        work,
      );
    this.send(work.request);
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
    this.send(envelope);
  }
  disposeWindow(windowGeneration: string): void {
    if (!this.stopped) {
      try {
        this.child.send(
          JSON.stringify({
            kind: "research_window_closed",
            generation: this.generation,
            windowGeneration,
          }),
        );
      } catch {
        this.fault("channel_write_failed");
      }
    }
    for (const work of this.streams.values()) {
      if (
        work.request.windowGeneration !== windowGeneration ||
        (work.request.operation !== "status.subscribe" &&
          work.request.operation !== "appearance.subscribe" &&
          work.request.operation !== "locale.subscribe" &&
          work.request.operation !== "research.subscribe" &&
          work.request.operation !== "presentation.subscribe")
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
  private send(value: unknown): void {
    const encoded = encodeEnvelope(value);
    if (!encoded.ok) {
      this.fault("protocol_rejected");
      return;
    }
    try {
      this.child.send(encoded.value);
    } catch {
      this.fault("channel_write_failed");
    }
  }
  private reject(work: Work, code: "busy" | "service_unavailable" = "service_unavailable"): void {
    const encoded = encodeEnvelope({
      ...work.request,
      kind: "result",
      payload: failure(code),
    });
    if (encoded.ok) work.deliver(encoded.value);
    work.release();
    work.releaseSubscription();
  }
  private receive(input: unknown): void {
    if (this.stopped) return;
    if (this.unavailableCause) {
      // Shutdown denies work first; only its final catalog event may cross that boundary.
      if (this.requestedStop && this.shutdownDrained && !this.stopDiagnosticForwarded) {
        const event = decodeChildDiagnostic(input, this.generation);
        if (event?.event_name === "ohtia.service.stopped") {
          this.stopDiagnosticForwarded = true;
          this.diagnostic?.(event);
        }
      }
      return;
    }
    const exit = decodeApplicationExit(input);
    if (exit?.kind === "application_exit_state" && exit.generation === this.generation) {
      this.provider?.exitState?.(exit);
      return;
    }
    // Private lifecycle acknowledgements are fixed-size and never forwarded to a renderer.
    if (
      typeof input === "string" &&
      input === JSON.stringify({ kind: "ready", generation: this.generation })
    ) {
      if (this.ready) {
        this.fault("protocol_rejected");
        return;
      }
      clearTimeout(this.startup);
      this.ready = true;
      for (const wake of [...this.pendingWakes]) if (!this.postProvider(wake.text)) return;
      this.changed("ready");
      return;
    }
    const wake = decodeServiceWake(input);
    if (wake) {
      if (wake.generation !== this.generation) return;
      if (!this.ready) {
        this.fault("protocol_rejected");
        return;
      }
      const expected = this.pendingWakes[0]?.message;
      if (
        !expected ||
        wake.suspendedAt !== expected.suspendedAt ||
        wake.resumedAt !== expected.resumedAt ||
        wake.asleepMs !== expected.asleepMs
      )
        return;
      this.pendingWakes.shift();
      // Even identical timestamp pairs represent two observations when posted twice.
      if (this.pendingWakes.length === 0) this.provider?.wakeReviewed?.(wake);
      return;
    }
    if (typeof input === "string" && input.length <= providerDispatchBytes) {
      // Versioned provider messages; a malformed one falls through to the peer decoder's fault.
      const dispatch = decodeProviderDispatch(input, this.generation);
      const interrupt = dispatch ? undefined : decodeProviderInterrupt(input, this.generation);
      const report =
        dispatch || interrupt ? undefined : decodeDevelopmentReport(input, this.generation);
      const refresh =
        dispatch || interrupt || report
          ? undefined
          : decodeModelListRefresh(input, this.generation);
      const usageReceipt =
        dispatch || interrupt || report || refresh
          ? undefined
          : decodeLateUsageReceipt(input, this.generation);
      if (dispatch || interrupt || report || refresh || usageReceipt) {
        if (!this.ready) {
          this.fault("protocol_rejected");
          return;
        }
        if (dispatch) this.provider?.dispatch(dispatch);
        else if (interrupt) this.provider?.interrupt(interrupt);
        else if (report) this.provider?.report?.(report);
        else if (usageReceipt) this.provider?.usageReceipt?.(usageReceipt);
        else if (refresh) {
          this.modelRefreshes.set(refresh.connection, refresh.refresh_id);
          this.provider?.refreshModels?.(refresh);
        }
        return;
      }
    }
    if (typeof input === "string" && input.length < portLimits.message_bytes) {
      try {
        const ack: unknown = JSON.parse(input);
        if (ack && typeof ack === "object" && "kind" in ack && ack.kind === "diagnostic") {
          this.diagnostic?.(decodeChildDiagnostic(input, this.generation));
          return;
        }
        if (ack && typeof ack === "object" && "kind" in ack && ack.kind === "appearance_changed") {
          const notice = ack as Record<string, unknown>;
          // Validate the record with the existing closed result decoder.
          const encoded = encodeEnvelope({
            protocol: 1,
            policy: policyId,
            kind: "result",
            requestId: "appearance-notice",
            operationId: "appearance-notice",
            windowGeneration: this.generation,
            serviceGeneration: this.generation,
            operation: "appearance.read",
            payload: { ok: true, value: notice.record },
          });
          const record = encoded.ok ? decodeText(encoded.value) : undefined;
          if (
            Object.keys(notice).sort().join(",") !== "generation,kind,record" ||
            notice.generation !== this.generation ||
            !this.ready ||
            !record?.ok ||
            record.value.kind !== "result" ||
            record.value.operation !== "appearance.read" ||
            !record.value.payload.ok
          ) {
            this.fault("protocol_rejected");
            return;
          }
          this.appearanceChanged?.(record.value.payload.value);
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
            this.fault("protocol_rejected");
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
            this.fault("protocol_rejected");
            return;
          }
          this.localeChanged?.(snapshot);
          return;
        }
      } catch {
        /* The ordinary peer decoder rejects other input. */
      }
    }
    if (typeof input === "string" && input.length < portLimits.message_bytes) {
      let notice: unknown;
      try {
        notice = JSON.parse(input);
      } catch {
        /* Envelope decoder handles malformed input. */
      }
      if (
        notice &&
        typeof notice === "object" &&
        (notice as { kind?: unknown }).kind === "presentation_changed"
      ) {
        const fields = notice as Record<string, unknown>;
        const snapshot = decodePresentationSnapshot(fields.snapshot);
        if (
          Object.keys(fields).sort().join(",") !== "generation,kind,snapshot" ||
          fields.generation !== this.generation ||
          snapshot?.serviceGeneration !== this.generation ||
          !this.ready
        ) {
          this.fault("protocol_rejected");
          return;
        }
        this.presentationChanged?.(snapshot);
        return;
      }
    }
    const decoded = decodeText(input);
    if (!decoded.ok) {
      this.fault("protocol_rejected");
      return;
    }
    const value = decoded.value;
    if (value.serviceGeneration !== this.generation) return;
    if (!this.ready) {
      this.fault("protocol_rejected");
      return;
    }
    if (value.kind === "result") {
      const id = key(value.windowGeneration, value.requestId);
      const work = this.pending.get(id);
      if (!work) return;
      if (!sameRequest(work.request, value)) {
        this.fault("protocol_rejected");
        return;
      }
      if (value.operation === "appearance.read" && value.payload.ok)
        this.appearanceChanged?.(value.payload.value);
      if (value.operation === "presentation.read" && value.payload.ok)
        this.presentationChanged?.(value.payload.value);
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
          work.request.operation === "locale.subscribe" ||
          work.request.operation === "research.subscribe" ||
          work.request.operation === "presentation.subscribe"
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
        (value.topic === "research"
          ? work.request.operation !== "research.subscribe"
          : value.topic === "presentation"
            ? work.request.operation !== "presentation.subscribe"
            : value.topic === "status"
              ? work.request.operation !== "status.subscribe"
              : value.topic === "locale"
                ? work.request.operation !== "locale.subscribe"
                : work.request.operation !== "appearance.subscribe")
      ) {
        this.fault("protocol_rejected");
        return;
      }
      if (value.topic === "presentation") this.presentationChanged?.(value.payload);
      if (value.topic === "locale") this.localeChanged?.(value.payload);
      work.deliver(input as string);
      return;
    }
    this.fault("protocol_rejected");
  }
  private fault(code: ServiceFault): void {
    if (this.unavailableCause || this.stopped) return;
    this.unavailableCause = code;
    this.ready = false;
    clearTimeout(this.startup);
    this.diagnostic?.({ event_name: "ohtia.service.faulted", error_code: code }, this.generation);
    this.changed("unavailable");
    try {
      this.child.kill();
    } catch {
      /* Capacity remains quarantined without exit evidence. */
    }
  }
  private didExit(code: number | undefined): void {
    if (this.stopped) return;
    if (this.unavailableCause !== "requested_stop")
      this.diagnostic?.(
        {
          event_name: "ohtia.service.child_exited",
          error_code: dataServiceExitReason(code),
        },
        this.generation,
      );
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
          isResearchMutation(work.request.operation) ||
            work.request.operation === "appearance.replace" ||
            work.request.operation === "limits.replace" ||
            work.request.operation === "locale.replace" ||
            work.request.operation === "layout.replace" ||
            work.request.operation === "bounds.replace" ||
            work.request.operation === "character.replace" ||
            work.request.operation === "sourceQuote.replace" ||
            work.request.operation === "entryText.replace" ||
            work.request.operation === "zoom.replace" ||
            work.request.operation === "zoom.commit" ||
            work.request.operation === "zoom.adjust"
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
  /** An OS shutdown can supersede an ordinary quit while the data-service queue drains. */
  markSystemShutdown(): void {
    this.systemShutdown = true;
    if (!this.shutdownSent || this.stopped) return;
    try {
      this.child.send(
        JSON.stringify({ kind: "shutdown", generation: this.generation, orderly: false }),
      );
    } catch {
      /* The existing stop deadline still owns cessation. */
    }
  }
  /** Deny new work, prove owned transport closure, then request the store's final write. */
  stop(
    admitted: () => boolean = () => true,
    orderly: () => boolean = () => true,
  ): Promise<boolean> {
    if (!admitted()) return Promise.resolve(false);
    if (this.stopped && (!this.beforeShutdown || this.shutdownDrained))
      return Promise.resolve(true);
    if (this.stopping) {
      if (this.stoppingAdmitted?.()) return this.stopping;
      // A new quit owns its own budget; retain closure evidence, not the expired caller.
      this.cancelStopping?.();
    }
    this.stoppingAdmitted = admitted;
    if (!this.stopped) {
      this.ready = false;
      this.unavailableCause ??= "requested_stop";
      this.requestedStop = true;
      clearTimeout(this.startup);
      // Main closes this generation's transports here. No later permit can enter receive().
      this.changed("unavailable", true);
    }
    const attempt = new Promise<boolean>((resolve) => {
      let finished = false;
      let childExited = this.stopped;
      let terminationRequested = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const finish = (ceased: boolean) => {
        if (finished) return;
        if (ceased && !this.shutdownDrained) {
          childExited = true;
          return;
        }
        finished = true;
        if (grace) {
          clearTimeout(grace);
          this.terminationTimers.delete(grace);
        }
        clearTimeout(total);
        this.exitWaiters.delete(finish);
        resolve(ceased);
      };
      this.cancelStopping = () => {
        finish(false);
      };
      const terminate = () => {
        if (this.stopped || terminationRequested) return;
        try {
          this.child.kill();
          terminationRequested = true;
        } catch {
          /* Keep waiting for cessation. */
        }
      };
      // A child exit must not cancel the deadline for still-unproven provider closure.
      const total = setTimeout(() => {
        terminate();
        finish(false);
      }, portLimits.shutdown_total_ms);
      if (!childExited) this.exitWaiters.add(finish);
      const sendShutdown = () => {
        if (finished) return;
        if (!admitted()) {
          finish(false);
          return;
        }
        if (childExited || this.stopped) {
          finish(true);
          return;
        }
        grace = setTimeout(terminate, portLimits.shutdown_grace_ms);
        this.terminationTimers.add(grace);
        try {
          this.child.send(
            JSON.stringify({
              kind: "shutdown",
              generation: this.generation,
              orderly: orderly() && !this.systemShutdown,
            }),
          );
          this.shutdownSent = true;
        } catch {
          /* The bounded grace timer still attempts termination. */
        }
      };
      const drain = this.beforeShutdown;
      if (drain && !this.shutdownDrained) {
        this.shutdownDrain ??= Promise.resolve()
          .then(drain)
          .then(() => {
            this.shutdownDrained = true;
          });
        void this.shutdownDrain.then(sendShutdown, () => {
          finish(false);
        });
      } else {
        this.shutdownDrained = true;
        sendShutdown();
      }
    });
    this.stopping = attempt;
    void attempt.then(() => {
      if (this.stopping === attempt) {
        this.stopping = undefined;
        this.stoppingAdmitted = undefined;
        this.cancelStopping = undefined;
      }
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
