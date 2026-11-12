import {
  CredentialStore,
  credentialService,
  type CredentialAccount,
  type CredentialEntry,
} from "./credential-store.js";
import type { RuntimeContext } from "@ohtia/contracts";

interface NativeKeyring {
  readonly AsyncEntry: new (
    service: string,
    account: CredentialAccount,
    options: { linux: { store: "secret-service" } },
  ) => CredentialEntry;
}
/** Main alone loads the native addon, after native context admission and broker ownership. */
export async function nativeCredentialStore(
  context: RuntimeContext,
  userData: string,
  load: () => Promise<NativeKeyring> = () => import("@napi-rs/keyring"),
): Promise<CredentialStore> {
  let keyring: NativeKeyring | undefined;
  try {
    keyring = await load();
  } catch {
    /* A missing native dependency leaves connections unavailable, not local work. */
  }
  return new CredentialStore({
    platform: process.platform,
    service: credentialService(context),
    userData,
    entry: (service, account) => {
      if (!keyring) throw new Error("Credential store unavailable.");
      return new keyring.AsyncEntry(service, account, { linux: { store: "secret-service" } });
    },
  });
}
