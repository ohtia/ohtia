import type { ProviderDeclaration, ProviderModel, ConnectionReason } from "@ohtia/contracts";
import type { CredentialStore, StoredSession } from "./credential-store.js";
export type SignInResult =
  | { readonly state: "connected"; readonly session: StoredSession }
  | { readonly state: "disconnected"; readonly reason: "sign_in_timeout" }
  | {
      readonly state: "error";
      readonly reason: Exclude<ConnectionReason, "sign_in_timeout" | "store_unavailable"> | null;
      readonly session?: StoredSession;
    };
/** The adapter remains inside main. Neither sessions nor store access belong on the application port. */
export interface ProviderAdapter {
  readonly declaration: ProviderDeclaration;
  /** Delegate to one CredentialStore serialization boundary; no adapter-owned persistence fallback. */
  readonly credentials: {
    read(): ReturnType<CredentialStore["readSession"]>;
    write(session: StoredSession): ReturnType<CredentialStore["writeSession"]>;
    delete(): ReturnType<CredentialStore["deleteSession"]>;
  };
  connect(signal: AbortSignal): Promise<SignInResult>;
  probe(session: StoredSession, signal: AbortSignal): Promise<readonly ProviderModel[]>;
}
