import type {
  ProviderDeclaration,
  ProviderModel,
  ConnectionReason,
  KeyCheckReason,
  ProviderEventBody,
  ProviderRequestData,
  ProviderToolCall,
  LateUsageReport,
  LateUsageDecision,
} from "@ohtia/contracts";
import type { CredentialStore, StoredSession, CredentialWrite } from "./credential-store.js";
export type SignInResult = {
  /** A validated new account registration invalidates any prior account model catalog. */
  readonly resetModels?: boolean;
  /** Persist the validated registration and session together inside main. */
  readonly persist?: () => Promise<CredentialWrite>;
} & (
  | { readonly state: "connected"; readonly session: StoredSession }
  | { readonly state: "disconnected"; readonly reason: "sign_in_timeout" }
  | {
      readonly state: "error";
      readonly reason: Exclude<
        ConnectionReason,
        "sign_in_timeout" | "store_unavailable" | KeyCheckReason
      > | null;
      readonly session?: StoredSession;
    }
);
/** Raw streamed arguments stay inside main until successful completion. */
export type AdapterEvent =
  | ProviderEventBody
  | {
      readonly type: "tool_start";
      readonly id: string;
      readonly namespace: string | null;
      readonly name: string;
    }
  | { readonly type: "tool_arguments"; readonly id: string; readonly text: string }
  | { readonly type: "tool_end"; readonly id: string; readonly arguments?: string };
export interface BufferedToolCall extends ProviderToolCall {
  complete: boolean;
}
/** What the dispatcher lends an adapter for one attempt; sequencing and forwarding stay its own. */
export interface ProviderRequestControl {
  /**
   * The last guard before the body leaves: false means nothing may be sent, and the dispatcher has
   * already produced the attempt's result. The adapter calls it once, after attaching the credential.
   */
  release(fingerprint?: string): boolean;
  /** Present only for adapters that can settle usage after their transport closes. */
  reportLateUsage?(report: LateUsageReport): Promise<LateUsageDecision>;
  /** Forward one provider event; the first `result` ends the attempt and later events are dropped. */
  emit(event: AdapterEvent): void;
  /** Aborted by an interrupt or by the end of the data-service generation that dispatched it. */
  readonly signal: AbortSignal;
}
/**
 * The request lifecycle of ADR-0026: start (prepare, then send), interrupt (the control's signal)
 * and query (the dispatcher's record). Resume is part of the contract only when the declaration's
 * `resumption` capability is true; an adapter that declares it false never resumes or emulates it.
 */
export interface ProviderRequests {
  /** Renew an expired session once, never sending a request. */
  prepare(signal: AbortSignal): Promise<"ready" | "rejected" | "temporary">;
  /** Attach the credential, call `release`, send and emit one result. Resolve only after the
   * connection has closed, including interruption and transport-error paths. */
  send(request: ProviderRequestData, control: ProviderRequestControl): Promise<void>;
}
/** The adapter remains inside main. Neither sessions nor store access belong on the application port. */
export type ApiKeyCheck =
  | {
      readonly models: readonly ProviderModel[];
      /** When the checked key stops working, for services whose keys can expire. */
      readonly expiresAt?: string;
    }
  | { readonly reason: KeyCheckReason };
export interface ProviderAdapter {
  readonly declaration: ProviderDeclaration;
  /** Delegate to one CredentialStore serialization boundary; no adapter-owned persistence fallback. */
  readonly credentials: {
    read(): ReturnType<CredentialStore["readSession"]>;
    write(session: StoredSession): ReturnType<CredentialStore["writeSession"]>;
    delete(): ReturnType<CredentialStore["deleteSession"]>;
  };
  connect(
    signal: AbortSignal,
    options?: { readonly new_registration?: boolean },
  ): Promise<SignInResult>;
  readonly apiKey?: {
    check(key: string, signal: AbortSignal): Promise<ApiKeyCheck>;
    save(key: string, checked?: { readonly expiresAt?: string }): Promise<CredentialWrite>;
    connectedAt(): string | undefined;
    expiresAt?(): string | undefined;
  };
  /** Cancel only the pending sign-in, preserving any previously validated session. */
  cancelSignIn?(): Promise<CredentialWrite>;
  accountEmail?(): string | null;
  accountFingerprint?(): string | undefined;
  lastAccountEmail?(): string | null;
  onStateChange?(
    listener: (state: "connected" | "expired" | "error", reason: ConnectionReason | null) => void,
  ): () => void;
  dispose?(): void;
  probe(session: StoredSession, signal: AbortSignal): Promise<readonly ProviderModel[]>;
  /** Present when the declaration's `text` capability is true. */
  readonly requests?: ProviderRequests;
}
