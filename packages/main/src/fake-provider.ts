import { randomUUID } from "node:crypto";
import { accountFingerprint } from "./account-fingerprint.js";
import type { ProviderModel } from "@ohtia/contracts";
import type { CredentialStore, StoredSession } from "./credential-store.js";
import type { ProviderAdapter, ProviderRequests, SignInResult } from "./provider-adapter.js";
/** Synthetic only. This module must never enter an installed/qualification artifact. */
export function createFakeProvider(
  options: {
    readonly kind?: "subscription" | "api_key";
    readonly models?: readonly ProviderModel[];
    readonly connect?: (signal: AbortSignal) => Promise<SignInResult>;
    readonly probe?: (signal: AbortSignal) => Promise<readonly ProviderModel[]>;
    readonly credentials?: ProviderAdapter["credentials"];
    readonly prepare?: ProviderRequests["prepare"];
    readonly send?: ProviderRequests["send"];
    /** Send the first text and hold the reply open until the request's signal aborts. */
    readonly holdReply?: boolean;
  } = {},
): ProviderAdapter {
  let instance: string | undefined;
  const currentFingerprint = () => (instance ? accountFingerprint("fake", instance) : undefined);
  let session: StoredSession | undefined;
  return {
    declaration: {
      id: "fake",
      version: "1.0.0",
      signInModes: [options.kind === "api_key" ? "api_key" : "provider_login"],
      capabilities: {
        text: true,
        attachments: false,
        structuredOutput: false,
        streaming: true,
        tools: true,
        interruption: true,
        resumption: false,
        modelSelection: true,
        effortSelection: false,
        usageReporting: true,
        late_usage: "reported",
      },
      connection: {
        id: "fake",
        displayName: "Fake",
        kind: options.kind ?? "subscription",
        usageUrl: null,
      },
    },
    accountFingerprint: currentFingerprint,
    credentials: options.credentials ?? {
      read: () =>
        Promise.resolve(session ? { status: "stored", value: session } : { status: "absent" }),
      write: (value) => {
        if (value !== session) instance = randomUUID();
        session = value;
        return Promise.resolve({ status: "stored" });
      },
      delete: () => {
        session = undefined;
        instance = undefined;
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
    requests: {
      prepare: options.prepare ?? (() => Promise.resolve("ready")),
      send: (request, control) => {
        const bound = { ...control, release: () => control.release(currentFingerprint()) };
        if (options.send) return options.send(request, bound);
        return sendDefault(bound);
      },
    },
    probe: (_session, signal) =>
      options.probe?.(signal) ??
      Promise.resolve(options.models ?? [{ id: "fake-model", name: "Fake model" }]),
  };
  function sendDefault(control: Parameters<ProviderRequests["send"]>[1]): Promise<void> {
    if (!control.release()) return Promise.resolve();
    control.emit({ type: "started", provider_request_id: null, model: null });
    if (options.holdReply) {
      control.emit({ type: "text", text: "Synthetic " });
      return new Promise<void>((resolve) => {
        control.signal.addEventListener("abort", () => {
          resolve();
        });
      });
    }
    control.emit({ type: "text", text: "Synthetic reply." });
    control.emit({ type: "result", result: { status: "completed" } });
    return Promise.resolve();
  }
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
