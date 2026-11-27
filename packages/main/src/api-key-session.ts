import { accountFingerprint } from "./account-fingerprint.js";
import type { ApiKeyAccount, CredentialStore, StoredApiKey } from "./credential-store.js";
import type { ProviderAdapter } from "./provider-adapter.js";

/** Main's current native key and account identity for one API-key connection. */
export class ApiKeySession {
  private stored: StoredApiKey | undefined;
  private expired: string | undefined;
  private listener: Parameters<NonNullable<ProviderAdapter["onStateChange"]>>[0] | undefined;
  constructor(
    private readonly store: CredentialStore,
    private readonly account: ApiKeyAccount,
    private readonly connection: string,
  ) {}
  readonly credentials: ProviderAdapter["credentials"] = {
    read: async () => {
      const result = await this.store.readApiKey(this.account);
      this.stored = result.status === "stored" ? result.value : undefined;
      if (result.status !== "stored") return result;
      if (result.value.instance === this.expired) return { status: "unusable" };
      return { status: "stored", value: { credential: result.value.key, reason: null } };
    },
    write: () => Promise.resolve({ status: "unavailable" }),
    delete: async () => {
      const result = await this.store.deleteApiKey(this.account);
      if (result.status === "stored") this.stored = undefined;
      return result;
    },
  };
  readonly connect: ProviderAdapter["connect"] = () =>
    Promise.resolve({ state: "error", reason: null });
  readonly onStateChange: NonNullable<ProviderAdapter["onStateChange"]> = (listener) => {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  };
  readonly accountFingerprint = () =>
    this.stored && accountFingerprint(this.connection, this.stored.instance);
  readonly connectedAt = () => this.stored?.connectedAt;
  readonly expiresAt = () => this.stored?.expiresAt;
  readonly save = async (key: string, expiresAt?: string) => {
    const result = await this.store.writeApiKey(this.account, key, expiresAt);
    if (result.status !== "stored") return { status: "unavailable" } as const;
    this.stored = result.value;
    this.expired = undefined;
    return { status: "stored" } as const;
  };
  /** Keep a newly read expiry for `value`, only while it is still the stored key. */
  async updateExpiry(value: StoredApiKey, expiresAt: string | undefined): Promise<void> {
    if (!this.isCurrent(value) || value.expiresAt === expiresAt) return;
    // The row shows what the service reported even if the store keeps the earlier date:
    // the dates are presentation metadata, and the next check writes them again.
    await this.store.updateApiKeyExpiry(this.account, value.instance, expiresAt);
    if (this.stored?.instance !== value.instance) return;
    const { key, instance, connectedAt } = this.stored;
    this.stored = {
      key,
      instance,
      ...(connectedAt ? { connectedAt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
  }
  current(): StoredApiKey | undefined {
    return this.stored?.instance === this.expired ? undefined : this.stored;
  }
  isCurrent(value: StoredApiKey): boolean {
    return this.current()?.instance === value.instance;
  }
  expire(value: StoredApiKey, reason: "key_needs_workspace" | null): void {
    if (!this.isCurrent(value)) return;
    this.expired = value.instance;
    this.listener?.("expired", reason);
  }
}
