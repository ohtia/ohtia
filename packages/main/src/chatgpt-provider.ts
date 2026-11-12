import { randomUUID } from "node:crypto";
import {
  type ConnectionReason,
  type DiagnosticEvent,
  type ProviderModel,
  portLimits,
} from "@ohtia/contracts";
import type {
  CredentialStore,
  CredentialRead,
  CredentialWrite,
  StoredSession,
} from "./credential-store.js";
import type { ProviderAdapter, SignInResult } from "./provider-adapter.js";
import {
  browserSignIn,
  chatGPTEndpoints,
  object,
  nonempty,
  providerJSON,
  displayEmail,
  verifyIdentity,
  type ProviderFetch,
} from "./chatgpt-sign-in.js";

interface Registration {
  readonly host: string;
  readonly client: string;
  readonly sub: string;
  readonly email: string;
}
interface Session {
  readonly client: string;
  readonly sub: string;
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
  readonly scopes: string;
}
const revoked = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);
const rejected = (): SignInResult => ({ state: "error", reason: "sign_in_rejected" });
function decode<T>(text: string, check: (value: unknown) => value is T): T | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return check(value) ? value : undefined;
  } catch {
    return;
  }
}
function registration(value: unknown): value is Registration {
  return (
    object(value) &&
    /^urn:uuid:[0-9a-f-]{36}$/.test(String(value.host)) &&
    nonempty(value.client) &&
    value.client !== "dynamic_agent_client" &&
    nonempty(value.sub) &&
    displayEmail(value.email)
  );
}
function session(value: unknown): value is Session {
  return (
    object(value) &&
    nonempty(value.client) &&
    nonempty(value.sub) &&
    nonempty(value.access) &&
    nonempty(value.refresh) &&
    typeof value.expires === "number" &&
    Number.isFinite(value.expires) &&
    typeof value.scopes === "string"
  );
}
function tokens(
  value: unknown,
  identity: Pick<Registration, "client" | "sub">,
  previous?: Session,
): Session {
  if (
    !object(value) ||
    !nonempty(value.access_token) ||
    !nonempty(value.refresh_token) ||
    typeof value.token_type !== "string" ||
    value.token_type.toLowerCase() !== "bearer" ||
    typeof value.expires_in !== "number" ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    (value.scope !== undefined && typeof value.scope !== "string")
  )
    throw new Error("Invalid token response.");
  const expires = Date.now() + value.expires_in * 1000;
  if (!Number.isFinite(expires)) throw new Error("Invalid token expiry.");
  return {
    client: identity.client,
    sub: identity.sub,
    access: value.access_token,
    refresh: value.refresh_token,
    expires,
    scopes: typeof value.scope === "string" ? value.scope : (previous?.scopes ?? ""),
  };
}
function stored(value: Session): StoredSession {
  return {
    credential: JSON.stringify(value),
    reason: value.scopes.split(/\s+/).includes("chatgpt.tokens.use.direct")
      ? null
      : "plan_use_not_allowed",
  };
}
/** One main-process owner; the only persistent account email is in chatgpt-registration. */
export class ChatGPTProvider implements ProviderAdapter {
  readonly declaration = {
    id: "chatgpt",
    version: "1.0.0",
    signInModes: ["provider_login"] as const,
    capabilities: {
      text: false,
      attachments: false,
      structuredOutput: false,
      streaming: false,
      tools: false,
      interruption: false,
      resumption: false,
      modelSelection: true,
      effortSelection: false,
      usageReporting: false,
    },
    connection: {
      id: "chatgpt",
      displayName: "ChatGPT",
      kind: "subscription" as const,
      usageUrl: "https://chatgpt.com/settings/usage",
    },
  };
  private registration: Registration | undefined;
  private current: Session | undefined;
  private currentEmail: string | null = null;
  private sessionReason: StoredSession["reason"] = null;
  private host = `urn:uuid:${randomUUID()}`;
  private queue: Promise<unknown> = Promise.resolve();
  private renewal: Promise<void> | undefined;
  private publication: Promise<CredentialWrite> | undefined;
  private reading: Promise<CredentialRead<StoredSession>> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private disposed = false;
  private dirty = false;
  private invalidated: "expired" | "sign_in_rejected" | undefined;
  private pendingRestore:
    | {
        readonly registration: Registration | undefined;
        readonly session: StoredSession | undefined;
      }
    | undefined;
  private renewalEnabled = true;
  private network = new AbortController();
  private readonly listeners = new Set<
    (state: "connected" | "expired" | "error", reason: ConnectionReason | null) => void
  >();
  private readonly request: ProviderFetch;
  constructor(
    private readonly options: {
      readonly store: CredentialStore;
      readonly openBrowser: (url: string) => Promise<void>;
      readonly completedText: () => string;
      readonly request?: ProviderFetch;
      readonly diagnostic?: (event: DiagnosticEvent) => void;
    },
  ) {
    this.request = options.request ?? fetch;
  }
  private active(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
  private signInActive(signal: AbortSignal): boolean {
    return !this.disposed && !signal.aborted;
  }
  private keptSession(value: Session): StoredSession {
    return { ...stored(value), reason: this.sessionReason ?? stored(value).reason };
  }
  private readOnce(
    work: () => Promise<CredentialRead<StoredSession>>,
  ): Promise<CredentialRead<StoredSession>> {
    this.reading ??= work().finally(() => {
      this.reading = undefined;
    });
    return this.reading;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  private emit(state: "connected" | "expired" | "error", reason: ConnectionReason | null): void {
    if (!this.disposed && this.renewalEnabled)
      for (const listener of this.listeners) listener(state, reason);
  }
  private async restorePending(): Promise<CredentialWrite> {
    const target = this.pendingRestore;
    if (!target) return { status: "stored" };
    const session = target.session
      ? await this.options.store.writeSession(target.session)
      : await this.options.store.deleteSession();
    const registration = target.registration
      ? await this.options.store.write("chatgpt-registration", JSON.stringify(target.registration))
      : await this.options.store.delete("chatgpt-registration");
    if (session.status === "unavailable" || registration.status === "unavailable")
      return { status: "unavailable" };
    if (this.pendingRestore === target) {
      this.pendingRestore = undefined;
      this.dirty = false;
    }
    return { status: "stored" };
  }
  private async clearInvalidated(): Promise<CredentialWrite> {
    const state = this.invalidated;
    if (!state) return { status: "stored" };
    const deleted = await this.options.store.deleteSession();
    const removed =
      state === "sign_in_rejected"
        ? await this.options.store.delete("chatgpt-registration")
        : { status: "stored" as const };
    if (state === "sign_in_rejected" && removed.status === "stored") this.registration = undefined;
    if (deleted.status === "unavailable" || removed.status === "unavailable") {
      this.emit("error", "store_unavailable");
      return { status: "unavailable" };
    }
    this.invalidated = undefined;
    this.emit(state === "expired" ? "expired" : "error", state === "expired" ? null : state);
    return { status: "stored" };
  }
  onStateChange(
    listener: (state: "connected" | "expired" | "error", reason: ConnectionReason | null) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async cancelSignIn(): Promise<CredentialWrite> {
    this.renewalEnabled = false;
    clearTimeout(this.timer);
    try {
      await this.publication;
      return { status: this.pendingRestore ? "unavailable" : "stored" };
    } catch {
      return { status: "unavailable" };
    }
  }
  accountEmail(): string | null {
    return this.current ? this.currentEmail : null;
  }
  lastAccountEmail(): string | null {
    return this.registration?.email ?? null;
  }
  readonly credentials = {
    read: (): Promise<CredentialRead<StoredSession>> =>
      this.readOnce(() =>
        this.serial(async () => {
          if (this.pendingRestore) {
            const repaired = await this.restorePending();
            if (repaired.status === "unavailable") return { status: "unavailable" };
          }
          if (this.invalidated) {
            const cleared = await this.clearInvalidated();
            if (cleared.status === "unavailable") return { status: "unavailable" };
          }
          const reg = await this.options.store.read("chatgpt-registration");
          if (reg.status === "unavailable") return { status: "unavailable" };
          this.registration = reg.status === "stored" ? decode(reg.value, registration) : undefined;
          if (this.registration) this.host = this.registration.host;
          const result = await this.options.store.readSession();
          if (result.status !== "stored") {
            if (result.status !== "unavailable") {
              this.current = undefined;
              this.currentEmail = null;
              clearTimeout(this.timer);
            }
            return result;
          }
          const value = decode(result.value.credential, session);
          if (
            !value ||
            !this.registration ||
            value.client !== this.registration.client ||
            value.sub !== this.registration.sub
          ) {
            this.current = undefined;
            this.currentEmail = null;
            clearTimeout(this.timer);
            return { status: "unusable" };
          }
          if (this.dirty && this.current) {
            const latest = this.keptSession(this.current);
            const saved = await this.options.store.writeSession(latest);
            if (saved.status === "unavailable") return { status: "unavailable" };
            this.dirty = false;
            this.schedule();
            return { status: "stored", value: latest };
          }
          this.currentEmail =
            this.current?.client === value.client && this.current.sub === value.sub
              ? (this.currentEmail ?? this.registration.email)
              : this.registration.email;
          this.current = value;
          this.sessionReason = result.value.reason;
          this.schedule();
          return result;
        }),
      ),
    write: (value: StoredSession): Promise<CredentialWrite> =>
      this.serial(async () => {
        if (this.pendingRestore) {
          const repaired = await this.restorePending();
          if (repaired.status === "unavailable") return repaired;
        }
        const next = decode(value.credential, session);
        if (
          !next ||
          next.client !== this.registration?.client ||
          next.sub !== this.registration.sub
        )
          return { status: "unavailable" };
        const result = await this.options.store.writeSession(value);
        if (result.status === "stored") {
          this.current = next;
          this.sessionReason = value.reason;
          this.schedule();
        }
        return result;
      }),
    delete: (): Promise<CredentialWrite> => {
      this.generation++;
      this.network.abort();
      this.network = new AbortController();
      clearTimeout(this.timer);
      this.current = undefined;
      this.currentEmail = null;
      this.renewalEnabled = false;
      this.dirty = false;
      if (this.pendingRestore) this.pendingRestore = { ...this.pendingRestore, session: undefined };
      return this.serial(() =>
        this.pendingRestore ? this.restorePending() : this.options.store.deleteSession(),
      );
    },
  };
  async connect(
    signal: AbortSignal,
    options?: { readonly new_registration?: boolean },
  ): Promise<SignInResult> {
    // A renewal already in flight must still retain its rotated token until replacement commits.
    clearTimeout(this.timer);
    this.renewalEnabled = false;
    const before = this.registration;
    const first = !before || options?.new_registration === true;
    const host = before?.host ?? this.host;
    try {
      const attempt = await browserSignIn({
        client: first ? "dynamic_agent_client" : before.client,
        host,
        first,
        signal,
        completedText: this.options.completedText(),
        openBrowser: this.options.openBrowser,
      });
      const callback = attempt.callback;
      if (callback.has("error"))
        return {
          state: "error",
          reason:
            callback.get("error") === "access_denied" ? "plan_use_not_allowed" : "sign_in_rejected",
        };
      const code = callback.get("code");
      const client = callback.get("client_id") ?? (first ? null : before.client);
      if (
        !client ||
        client === "dynamic_agent_client" ||
        (!first && client !== before.client) ||
        !nonempty(code) ||
        callback.getAll("code").length !== 1 ||
        callback.getAll("client_id").length > 1
      )
        return rejected();
      const response = await this.request(chatGPTEndpoints.token, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(portLimits.connection_probe_ms)]),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client,
          code,
          code_verifier: attempt.verifier,
          redirect_uri: attempt.redirect,
          resource: chatGPTEndpoints.resource,
        }),
      });
      if (!response.ok) return rejected();
      const body = await providerJSON(response);
      if (!object(body) || !nonempty(body.id_token)) return rejected();
      const identity = await verifyIdentity(
        body.id_token,
        client,
        attempt.nonce,
        this.request,
        AbortSignal.any([signal, AbortSignal.timeout(portLimits.connection_probe_ms)]),
      );
      if (!first && identity.sub !== before.sub) return rejected();
      if (!this.signInActive(signal)) return rejected();
      const next: Registration = {
        host,
        client,
        sub: identity.sub,
        email: first ? identity.email : before.email,
      };
      const nextSession = tokens(body, next);
      const value = stored(nextSession);
      const publish = async (): Promise<CredentialWrite> => {
        // Let any old renewal publish its latest rotating token before a rollback can retain it.
        await this.renewal;
        return this.serial(async (): Promise<CredentialWrite> => {
          if (!this.signInActive(signal)) return { status: "unavailable" };
          this.generation++;
          this.network.abort();
          this.network = new AbortController();
          clearTimeout(this.timer);
          const previousRegistration = this.registration;
          const old = this.current;
          // OS stores have no multi-entry transaction. Pair tokens with their client/subject and
          // roll back interrupted publication; startup rejects every mismatched pair.
          const saved = await this.options.store.writeSession(value);
          let published = false;
          if (saved.status === "stored" && this.signInActive(signal)) {
            const written = await this.options.store.write(
              "chatgpt-registration",
              JSON.stringify(next),
            );
            published = written.status === "stored";
          }
          if (!published || !this.signInActive(signal)) {
            this.pendingRestore = {
              registration: previousRegistration,
              session: old ? this.keptSession(old) : undefined,
            };
            await this.restorePending();
            if (old && this.signInActive(signal)) {
              this.renewalEnabled = true;
              this.schedule();
            }
            return { status: "unavailable" };
          }
          this.registration = next;
          this.invalidated = undefined;
          this.pendingRestore = undefined;
          this.renewalEnabled = true;
          this.current = nextSession;
          this.currentEmail = identity.email;
          this.sessionReason = value.reason;
          this.dirty = false;
          this.schedule();
          return { status: "stored" };
        });
      };
      const persist = (): Promise<CredentialWrite> => {
        const pending = publish();
        this.publication = pending;
        return pending.finally(() => {
          if (this.publication === pending) this.publication = undefined;
        });
      };
      return value.reason
        ? { state: "error", reason: value.reason, session: value, persist, resetModels: first }
        : { state: "connected", session: value, persist, resetModels: first };
    } catch {
      return rejected();
    }
  }
  private schedule(delay?: number): void {
    clearTimeout(this.timer);
    if (!this.current || !this.renewalEnabled || this.disposed) return;
    const due = this.current.expires - 60000;
    this.timer = setTimeout(
      () => {
        void this.renew();
      },
      delay ?? Math.max(1000, Math.min(2147483647, due - Date.now())),
    );
    this.timer.unref();
  }
  /** All consumers share this renewal, using only main's current replacement token. */
  renew(): Promise<void> {
    if (this.renewal) return this.renewal;
    const generation = this.generation;
    const value = this.current;
    if (!value || !this.renewalEnabled || this.disposed) return Promise.resolve();
    const signal = AbortSignal.any([
      this.network.signal,
      AbortSignal.timeout(portLimits.connection_probe_ms),
    ]);
    this.options.diagnostic?.({ event_name: "ohtia.connection.renewal_started" });
    const work = async () => {
      try {
        const response = await this.request(chatGPTEndpoints.token, {
          method: "POST",
          redirect: "error",
          signal,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: value.client,
            refresh_token: value.refresh,
            resource: chatGPTEndpoints.resource,
          }),
        });
        if (response.status >= 500) {
          this.schedule(30000);
          return;
        }
        const body = await providerJSON(response);
        if (!this.active(generation)) return;
        if (!response.ok) {
          const code = object(body) ? body.error : undefined;
          if (typeof code === "string" && (revoked.has(code) || code === "invalid_client")) {
            await this.serial(async () => {
              if (!this.active(generation)) return;
              this.current = undefined;
              this.currentEmail = null;
              clearTimeout(this.timer);
              this.dirty = false;
              if (this.pendingRestore)
                this.pendingRestore = {
                  registration:
                    code === "invalid_client" ? undefined : this.pendingRestore.registration,
                  session: undefined,
                };
              this.invalidated = code === "invalid_client" ? "sign_in_rejected" : "expired";
              await this.clearInvalidated();
            });
          } else this.schedule(30000);
          return;
        }
        const next = tokens(body, value, value);
        await this.serial(async () => {
          if (!this.active(generation)) return;
          const replacement = this.keptSession(next);
          if (this.pendingRestore)
            this.pendingRestore = { ...this.pendingRestore, session: replacement };
          const saved = this.pendingRestore
            ? await this.restorePending()
            : await this.options.store.writeSession(replacement);
          if (!this.active(generation)) return;
          // Retain the latest rotated token even if the keyring fails; never reuse its predecessor.
          this.current = next;
          this.sessionReason = replacement.reason;
          this.dirty = saved.status !== "stored";
          if (saved.status !== "stored") this.emit("error", "store_unavailable");
          else {
            const reason = replacement.reason;
            this.emit(reason ? "error" : "connected", reason);
          }
          this.schedule();
        });
      } catch {
        if (this.active(generation)) this.schedule(30000);
      }
    };
    this.renewal = work().finally(() => {
      this.renewal = undefined;
    });
    return this.renewal;
  }
  async probe(_session: StoredSession, signal: AbortSignal): Promise<readonly ProviderModel[]> {
    if (this.current && this.current.expires <= Date.now()) await this.renew();
    const value = this.current;
    if (
      this.sessionReason !== null ||
      !value ||
      !value.scopes.split(/\s+/).includes("chatgpt.tokens.use.direct")
    )
      throw new Error("Sign-in unavailable.");
    const response = await this.request(chatGPTEndpoints.models, {
      signal,
      redirect: "error",
      headers: { Authorization: `Bearer ${value.access}` },
    });
    if (!response.ok) throw new Error("Models unavailable.");
    const body = await providerJSON(response);
    if (!object(body) || !Array.isArray(body.models)) throw new Error("Invalid model list.");
    const models: ProviderModel[] = [];
    for (const model of body.models as unknown[]) {
      if (!object(model)) throw new Error("Invalid model.");
      if (model.visibility !== "list") continue;
      if (!nonempty(model.slug) || !nonempty(model.display_name)) throw new Error("Invalid model.");
      models.push({ id: model.slug, name: model.display_name });
    }
    return models;
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.network.abort();
    clearTimeout(this.timer);
    this.listeners.clear();
  }
}
