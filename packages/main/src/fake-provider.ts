import type { ProviderModel } from "@ohtia/contracts";
import type { CredentialStore, StoredSession } from "./credential-store.js";
import type { ProviderAdapter, SignInResult } from "./provider-adapter.js";
/** Synthetic only. This module must never enter an installed/qualification artifact. */
export function createFakeProvider(
  options: {
    readonly models?: readonly ProviderModel[];
    readonly connect?: (signal: AbortSignal) => Promise<SignInResult>;
    readonly probe?: (signal: AbortSignal) => Promise<readonly ProviderModel[]>;
    readonly credentials?: ProviderAdapter["credentials"];
  } = {},
): ProviderAdapter {
  let session: StoredSession | undefined;
  return {
    declaration: {
      id: "fake",
      version: "1.0.0",
      signInModes: ["provider_login"],
      capabilities: {
        text: true,
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
      connection: { id: "fake", displayName: "Fake", kind: "subscription", usageUrl: null },
    },
    credentials: options.credentials ?? {
      read: () =>
        Promise.resolve(session ? { status: "stored", value: session } : { status: "absent" }),
      write: (value) => {
        session = value;
        return Promise.resolve({ status: "stored" });
      },
      delete: () => {
        session = undefined;
        return Promise.resolve({ status: "stored" });
      },
    },
    connect:
      options.connect ??
      (() =>
        Promise.resolve({
          state: "connected",
          session: { credential: "synthetic-session", reason: null },
        })),
    probe: (_session, signal) =>
      options.probe?.(signal) ??
      Promise.resolve(options.models ?? [{ id: "fake-model", name: "Fake model" }]),
  };
}

/** Main-inspector-only native check, restricted to this checkout and a fixed synthetic value. */
export function credentialAcceptance(store: CredentialStore) {
  const credential = "ohtia-native-synthetic-session:" + "s".repeat(4096);
  return async (action: unknown): Promise<{ readonly status: string }> => {
    if (!["write", "read", "delete", "unavailable"].includes(action as string))
      return { status: "rejected" };
    const current = await store.readSession();
    if (action === "unavailable")
      return { status: current.status === "unavailable" ? "confirmed" : "failed" };
    if (action === "write") {
      // Never replace a researcher's kept session, including an unusable one.
      if (current.status !== "absent") return { status: "refused" };
      return store.writeSession({ credential, reason: null });
    }
    if (
      current.status !== "stored" ||
      current.value.credential !== credential ||
      current.value.reason !== null
    )
      return { status: "refused" };
    if (action === "read") return { status: "confirmed" };
    const deleted = await store.deleteSession();
    return {
      status:
        deleted.status === "stored" && (await store.readSession()).status === "absent"
          ? "confirmed"
          : "failed",
    };
  };
}
