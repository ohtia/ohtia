import { randomUUID } from "node:crypto";
import {
  encodeEnvelope,
  failure,
  staleRevision,
  policyId,
  portLimits,
  isProviderDeclaration,
  isProviderModel,
  type ConnectionSnapshot,
  type ConnectionEvent,
  type ConnectionState,
  type ConnectionReason,
  type ModelPage,
  type ModelPageInput,
  type Outcome,
  type ProviderModel,
  type DiagnosticEvent,
} from "@ohtia/contracts";
import type { CredentialRead, StoredSession } from "./credential-store.js";
import type { ProviderAdapter, SignInResult } from "./provider-adapter.js";

interface Connection {
  readonly adapter: ProviderAdapter;
  state: ConnectionState;
  reason: ConnectionReason | null;
  initialized: boolean;
  storeUnavailable: boolean;
  deleteFailed: boolean;
  probeWork: boolean;
  generation: number;
  action: AbortController | undefined;
  signInTimer: ReturnType<typeof setTimeout> | undefined;
  probe:
    | {
        readonly id: string;
        readonly abort: AbortController;
        readonly timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  lastProbe: string | null;
  models: readonly ProviderModel[] | undefined;
  revision: number;
}
// Reserve the largest legal envelope identities, so every stored entry fits in a real page.
const largestId = "x".repeat(portLimits.identifier_bytes);
export function modelPageFits(page: ModelPage): boolean {
  return encodeEnvelope({
    protocol: 1,
    policy: policyId,
    kind: "result",
    requestId: largestId,
    operationId: largestId,
    windowGeneration: largestId,
    serviceGeneration: largestId,
    operation: "connection.listModels",
    payload: { ok: true, value: page },
  }).ok;
}
/** Main's sole connection authority. Every late adapter completion must still hold its generation. */
export class ConnectionManager {
  private readonly connections = new Map<string, Connection>();
  private readonly listeners = new Set<(event: ConnectionEvent) => void>();
  private disposed = false;
  private readonly adapterStops: (() => void)[] = [];
  constructor(
    adapters: readonly ProviderAdapter[],
    private readonly diagnostic?: (event: DiagnosticEvent) => void,
  ) {
    for (const adapter of adapters) {
      if (!isProviderDeclaration(adapter.declaration))
        throw new Error("Invalid provider declaration.");
      const id = adapter.declaration.connection.id;
      if (this.connections.has(id)) throw new Error("Duplicate connection declaration.");
      this.connections.set(id, {
        adapter,
        state: "disconnected",
        reason: null,
        initialized: false,
        storeUnavailable: false,
        deleteFailed: false,
        probeWork: false,
        generation: 0,
        action: undefined,
        signInTimer: undefined,
        probe: undefined,
        lastProbe: null,
        models: undefined,
        revision: 0,
      });
      const stop = adapter.onStateChange?.((state, reason) => {
        const c = this.connections.get(id);
        if (!c || this.disposed || c.state === "connecting") return;
        c.state = state;
        c.reason = reason;
        c.initialized = true;
        c.storeUnavailable = reason === "store_unavailable";
        this.diagnostic?.(
          state === "connected"
            ? { event_name: "ohtia.connection.renewed" }
            : state === "expired"
              ? { event_name: "ohtia.connection.expired" }
              : {
                  event_name: "ohtia.connection.failed",
                  error_code: reason ?? "connection_failed",
                },
        );
        this.emit(id);
      });
      if (stop) this.adapterStops.push(stop);
    }
  }
  /** Fake is deliberately absent from the graphical connection inventory. */
  declarations() {
    return [...this.connections.values()]
      .map((c) => c.adapter.declaration)
      .filter((d) => d.connection.id !== "fake");
  }
  ids(): readonly string[] {
    return [...this.connections.keys()];
  }
  subscribe(listener: (event: ConnectionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  snapshot(id: string): ConnectionSnapshot | undefined {
    const c = this.connections.get(id);
    return c
      ? {
          connection: id,
          state: c.storeUnavailable || c.deleteFailed ? "error" : c.state,
          reason: c.storeUnavailable || c.deleteFailed ? "store_unavailable" : c.reason,
          display_name: c.adapter.declaration.connection.displayName,
          account_email:
            c.state === "connected" && !c.storeUnavailable
              ? (c.adapter.accountEmail?.() ?? null)
              : null,
          last_account_email: c.storeUnavailable ? null : (c.adapter.lastAccountEmail?.() ?? null),
          probing: !!c.probe,
          probe_id: c.probe?.id ?? c.lastProbe,
          model_list_revision: c.models === undefined ? null : c.revision,
          model_count: c.models?.length ?? 0,
        }
      : undefined;
  }
  private isDisposed(): boolean {
    return this.disposed;
  }
  private requireSnapshot(id: string): ConnectionSnapshot {
    const snapshot = this.snapshot(id);
    if (!snapshot) throw new Error("Missing declared connection.");
    return snapshot;
  }
  private emit(id: string, outcome?: "listed" | "unreachable"): void {
    if (this.disposed) return;
    const snapshot = this.snapshot(id);
    if (!snapshot) return;
    const event: ConnectionEvent = outcome
      ? { ...snapshot, kind: "probe_result", outcome }
      : { ...snapshot, kind: "state" };
    for (const listener of this.listeners) listener(event);
  }
  async read(id: string): Promise<Outcome<ConnectionSnapshot>> {
    const c = this.connections.get(id);
    if (!c || this.disposed) return failure("invalid_message");
    const generation = c.generation;
    const stored = await c.adapter.credentials.read();
    if (this.isDisposed()) return failure("disposed");
    if (generation !== c.generation) return { ok: true, value: this.requireSnapshot(id) };
    const before = JSON.stringify(this.snapshot(id));
    this.reconcileCredentials(c, stored);
    if (before !== JSON.stringify(this.snapshot(id))) this.emit(id);
    this.diagnostic?.({ event_name: "ohtia.connection.read" });
    return { ok: true, value: this.requireSnapshot(id) };
  }
  private reconcileCredentials(c: Connection, stored: CredentialRead<StoredSession>): void {
    if (stored.status === "unavailable") c.storeUnavailable = true;
    else {
      c.storeUnavailable = false;
      if (!c.initialized || (c.state === "error" && c.reason === "store_unavailable")) {
        c.initialized = true;
        c.state =
          stored.status === "stored"
            ? stored.value.reason
              ? "error"
              : "connected"
            : stored.status === "unusable"
              ? "expired"
              : "disconnected";
        c.reason = stored.status === "stored" ? stored.value.reason : null;
      } else if (
        stored.status === "stored" &&
        c.state === "connected" &&
        stored.value.reason !== null
      ) {
        c.state = "error";
        c.reason = stored.value.reason;
      } else if (stored.status === "unusable" && c.reason === null && c.state !== "connecting") {
        c.state = "expired";
      } else if (stored.status === "absent" && c.state === "connected") {
        c.state = "disconnected";
        c.reason = null;
      }
    }
  }
  connect(
    id: string,
    options?: { readonly new_registration?: boolean },
  ): Outcome<ConnectionSnapshot> {
    const c = this.connections.get(id);
    if (!c || this.disposed) return failure("invalid_message");
    if (!c.storeUnavailable && (c.state === "connected" || c.state === "connecting"))
      return { ok: true, value: this.requireSnapshot(id) };
    this.cancelProbe(id, c);
    this.clearSignIn(c);
    c.action?.abort();
    const action = new AbortController();
    c.action = action;
    const generation = ++c.generation;
    if (c.adapter.declaration.connection.kind === "subscription") {
      c.signInTimer = setTimeout(() => {
        if (!this.current(c, generation)) return;
        c.generation++;
        c.action?.abort();
        c.action = undefined;
        c.signInTimer = undefined;
        c.state = "disconnected";
        c.reason = "sign_in_timeout";
        c.storeUnavailable = false;
        const cancelledGeneration = c.generation;
        void c.adapter
          .cancelSignIn?.()
          .then((result) => {
            if (this.current(c, cancelledGeneration) && result.status === "unavailable")
              this.setUnavailable(id, c);
          })
          .catch(() => {
            if (this.current(c, cancelledGeneration)) this.setUnavailable(id, c);
          });
        this.diagnostic?.({ event_name: "ohtia.connection.failed", error_code: "sign_in_timeout" });
        this.emit(id);
      }, portLimits.sign_in_wait_ms);
    }
    c.deleteFailed = false;
    c.state = "connecting";
    c.reason = null;
    c.storeUnavailable = false;
    c.initialized = true;
    this.emit(id);
    this.diagnostic?.({ event_name: "ohtia.connection.connect" });
    // Start after the immediate result is sent; browser sign-in is never a port request lifetime.
    void Promise.resolve()
      .then(async () => {
        const available = await c.adapter.credentials.read();
        if (!this.current(c, generation)) return;
        if (available.status === "unavailable") {
          this.setUnavailable(id, c, true);
          return;
        }
        let result: SignInResult;
        try {
          result = await c.adapter.connect(action.signal, options);
        } catch {
          result = { state: "error", reason: null };
        }
        if (!this.current(c, generation)) return;
        const session = "session" in result ? result.session : undefined;
        if (session) {
          // Persistent reasons are owned by the kept session, never inferred from a diagnostic.
          const kept = {
            credential: session.credential,
            reason: result.state === "error" ? result.reason : null,
          };
          const written = await (result.persist
            ? result.persist()
            : c.adapter.credentials.write(kept));
          if (!this.current(c, generation)) return;
          if (written.status === "unavailable") {
            this.setUnavailable(id, c, true);
            return;
          }
          c.storeUnavailable = false;
          if (result.resetModels) {
            c.models = undefined;
            c.lastProbe = null;
          }
        }
        this.clearSignIn(c);
        c.state = result.state;
        c.reason = result.state === "connected" ? null : result.reason;
        c.action = undefined;
        this.diagnostic?.(
          result.state === "connected"
            ? { event_name: "ohtia.connection.connected" }
            : {
                event_name: "ohtia.connection.failed",
                error_code: result.reason ?? "connection_failed",
              },
        );
        this.emit(id);
      })
      .catch(() => {
        if (this.current(c, generation)) this.setUnavailable(id, c, true);
      });
    return { ok: true, value: this.requireSnapshot(id) };
  }
  private clearSignIn(c: Connection): void {
    clearTimeout(c.signInTimer);
    c.signInTimer = undefined;
  }
  private current(c: Connection, generation: number): boolean {
    return !this.disposed && c.generation === generation;
  }
  private setUnavailable(id: string, c: Connection, connectFailed = false): void {
    if (connectFailed) {
      this.clearSignIn(c);
      c.action?.abort();
      c.state = "disconnected";
      c.reason = null;
      c.initialized = false;
      c.action = undefined;
    }
    c.storeUnavailable = true;
    this.diagnostic?.({ event_name: "ohtia.connection.failed", error_code: "store_unavailable" });
    this.emit(id);
  }
  async disconnect(id: string): Promise<Outcome<ConnectionSnapshot>> {
    const c = this.connections.get(id);
    if (!c || this.disposed) return failure("invalid_message");
    if (
      !c.storeUnavailable &&
      !c.deleteFailed &&
      c.initialized &&
      c.state === "disconnected" &&
      c.reason === null
    )
      return { ok: true, value: this.requireSnapshot(id) };
    const cancellingSignIn = c.state === "connecting" && c.adapter.cancelSignIn !== undefined;
    this.clearSignIn(c);
    c.action?.abort();
    c.action = undefined;
    const generation = ++c.generation;
    // Revoke task admission before an OS unlock or deletion can wait.
    c.state = "disconnected";
    c.reason = null;
    c.storeUnavailable = false;
    c.initialized = true;
    // Clear the prior failure before publishing this action; a failed delete reopens the retry.
    c.deleteFailed = false;
    this.cancelProbe(id, c);
    this.emit(id);
    const deleted = await (cancellingSignIn && c.adapter.cancelSignIn
      ? c.adapter.cancelSignIn()
      : c.adapter.credentials.delete());
    if (!this.current(c, generation)) return { ok: true, value: this.requireSnapshot(id) };
    if (deleted.status === "unavailable") {
      c.deleteFailed = !cancellingSignIn;
      this.setUnavailable(id, c);
    } else this.diagnostic?.({ event_name: "ohtia.connection.disconnect" });
    return { ok: true, value: this.requireSnapshot(id) };
  }
  probe(id: string): Outcome<ConnectionSnapshot> {
    const c = this.connections.get(id);
    if (!c || this.disposed) return failure("invalid_message");
    if (c.probe) return { ok: true, value: this.requireSnapshot(id) };
    const abort = new AbortController();
    const probeId = randomUUID();
    const finish = (outcome: "listed" | "unreachable", models?: readonly ProviderModel[]) => {
      if (this.disposed || c.probe?.id !== probeId) return;
      clearTimeout(c.probe.timer);
      c.probe = undefined;
      c.lastProbe = probeId;
      if (outcome === "listed" && !this.storeModels(id, models)) outcome = "unreachable";
      abort.abort();
      this.diagnostic?.(
        outcome === "listed"
          ? { event_name: "ohtia.connection.probe_listed" }
          : { event_name: "ohtia.connection.probe_unreachable", error_code: "probe_unreachable" },
      );
      this.emit(id, outcome);
    };
    c.probe = {
      id: probeId,
      abort,
      timer: setTimeout(() => {
        finish("unreachable");
      }, portLimits.connection_probe_ms),
    };
    this.emit(id);
    void Promise.resolve()
      .then(async () => {
        // A timed-out native lookup may still be waiting for an OS prompt. Do not queue another.
        if (c.probeWork) {
          finish("unreachable");
          return;
        }
        c.probeWork = true;
        try {
          const stored = await c.adapter.credentials.read();
          if (c.probe?.id !== probeId || this.disposed) return;
          if (stored.status === "unavailable") {
            this.setUnavailable(id, c);
            finish("unreachable");
            return;
          }
          this.reconcileCredentials(c, stored);
          if (c.state !== "connected" || stored.status !== "stored" || stored.value.reason) {
            finish("unreachable");
            return;
          }
          try {
            finish("listed", await c.adapter.probe(stored.value, abort.signal));
          } catch {
            finish("unreachable");
          }
        } finally {
          c.probeWork = false;
        }
      })
      .catch(() => {
        finish("unreachable");
      });
    return { ok: true, value: this.requireSnapshot(id) };
  }
  private cancelProbe(id: string, c: Connection): void {
    if (!c.probe) return;
    clearTimeout(c.probe.timer);
    c.probe.abort.abort();
    c.lastProbe = c.probe.id;
    c.probe = undefined;
    this.emit(id, "unreachable");
  }
  storeModels(id: string, input: unknown): boolean {
    const c = this.connections.get(id);
    if (!c || this.disposed || c.revision === Number.MAX_SAFE_INTEGER) return false;
    // Construct an exact projection; provider metadata and arbitrary errors never cross the port.
    const models: ProviderModel[] = [];
    const revision = c.revision + 1;
    if (!Array.isArray(input)) return false;
    try {
      for (const model of input) {
        if (!isProviderModel(model)) return false;
        const copy = { id: model.id, name: model.name };
        if (
          !modelPageFits({
            connection: id,
            model_list_revision: revision,
            models: [copy],
            nextCursor: input.length,
            hasMore: true,
          })
        )
          return false;
        models.push(Object.freeze(copy));
      }
    } catch {
      return false;
    }
    c.models = Object.freeze(models);
    c.revision = revision;
    return true;
  }
  listModels(input: ModelPageInput): Outcome<ModelPage> {
    const c = this.connections.get(input.connection);
    if (
      !c ||
      this.disposed ||
      !Number.isSafeInteger(input.cursor) ||
      input.cursor < 0 ||
      !Number.isSafeInteger(input.count) ||
      input.count < 1 ||
      input.count > 128
    )
      return failure("invalid_message");
    if (input.model_list_revision !== c.revision || c.models === undefined)
      return staleRevision(c.models === undefined ? 0 : c.revision);
    if (input.cursor > c.models.length) return failure("invalid_message");
    const models: ProviderModel[] = [];
    let next = input.cursor;
    for (const model of c.models.slice(input.cursor, input.cursor + input.count)) {
      const page = {
        connection: input.connection,
        model_list_revision: c.revision,
        models: [...models, model],
        nextCursor: next + 1,
        hasMore: next + 1 < c.models.length,
      };
      if (!modelPageFits(page)) break;
      models.push(model);
      next++;
    }
    return {
      ok: true,
      value: {
        connection: input.connection,
        model_list_revision: c.revision,
        models,
        nextCursor: next,
        hasMore: next < c.models.length,
      },
    };
  }
  dispose(): void {
    this.disposed = true;
    for (const stop of this.adapterStops) stop();
    for (const c of this.connections.values()) {
      this.clearSignIn(c);
      c.adapter.dispose?.();
      c.action?.abort();
      if (c.probe) {
        clearTimeout(c.probe.timer);
        c.probe.abort.abort();
      }
    }
    this.listeners.clear();
  }
}
