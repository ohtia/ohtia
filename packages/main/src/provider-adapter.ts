import type { InferenceRequests } from "./provider-requests.js";
import type { ProviderDeclaration, ProviderModel, ConnectionReason } from "@ohtia/contracts";
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
      readonly reason: Exclude<ConnectionReason, "sign_in_timeout" | "store_unavailable"> | null;
      readonly session?: StoredSession;
    }
);
/** The adapter remains inside main. Neither sessions nor store access belong on the application port. */
export interface ProviderAdapter {
  readonly declaration: ProviderDeclaration;
  readonly requests?: InferenceRequests;
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
  /** Cancel only the pending sign-in, preserving any previously validated session. */
  cancelSignIn?(): Promise<CredentialWrite>;
  accountEmail?(): string | null;
  lastAccountEmail?(): string | null;
  onStateChange?(
    listener: (state: "connected" | "expired" | "error", reason: ConnectionReason | null) => void,
  ): () => void;
  dispose?(): void;
  probe(session: StoredSession, signal: AbortSignal): Promise<readonly ProviderModel[]>;
}
