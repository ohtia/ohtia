import fs from "node:fs";
import path from "node:path";
import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import type { RuntimeContext, ConnectionReason } from "@ohtia/contracts";

export const credentialAccounts = [
  "chatgpt-session",
  "chatgpt-session-key",
  "chatgpt-registration",
  "anthropic-api-key",
  "openai-api-key",
] as const;
export type CredentialAccount = (typeof credentialAccounts)[number];
export interface StoredSession {
  readonly credential: string;
  readonly reason: Extract<ConnectionReason, "plan_use_not_allowed" | "sign_in_rejected"> | null;
}
export type CredentialRead<T> =
  | { readonly status: "stored"; readonly value: T }
  | { readonly status: "absent" | "unusable" | "unavailable" };
export type CredentialWrite = { readonly status: "stored" | "unavailable" };
/** Native implementation is injected only by main; tests supply an isolated synthetic store. */
export interface CredentialEntry {
  getPassword(): Promise<string | null>;
  setPassword(value: string): Promise<void>;
  deleteCredential(): Promise<boolean>;
}
export type CredentialEntryFactory = (
  service: string,
  account: CredentialAccount,
) => CredentialEntry;
export function credentialService(context: RuntimeContext): string {
  if (context.mode !== "development") return "Ohtia";
  // The runtime admission owns canonicalization and ownership, before the single-instance lock.
  const root = path.dirname(context.configuration_root);
  return `Ohtia Development ${createHash("sha256").update(root, "utf8").digest("hex").slice(0, 16)}`;
}
function decodeSession(text: string): StoredSession | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const v = value as Record<string, unknown>;
    if (
      Object.keys(v).sort().join(",") !== "credential,reason" ||
      typeof v.credential !== "string" ||
      !v.credential ||
      (v.reason !== null && v.reason !== "plan_use_not_allowed" && v.reason !== "sign_in_rejected")
    )
      return;
    return { credential: v.credential, reason: v.reason };
  } catch {
    return;
  }
}
/** One broker, serialized native/file operations, and no weak or session-only persistence fallback. */
export class CredentialStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly sessionFile: string;
  constructor(
    private readonly options: {
      readonly platform: string;
      readonly service: string;
      readonly userData: string;
      readonly entry: CredentialEntryFactory;
    },
  ) {
    this.sessionFile = path.join(options.userData, "provider-sessions.enc");
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  private entry(account: CredentialAccount): CredentialEntry {
    return this.options.entry(this.options.service, account);
  }
  read(
    account: Exclude<CredentialAccount, "chatgpt-session" | "chatgpt-session-key">,
  ): Promise<CredentialRead<string>> {
    return this.serial(async () => {
      try {
        const value = await this.entry(account).getPassword();
        return value === null ? { status: "absent" } : { status: "stored", value };
      } catch {
        return { status: "unavailable" };
      }
    });
  }
  write(
    account: Exclude<CredentialAccount, "chatgpt-session" | "chatgpt-session-key">,
    value: string,
  ): Promise<CredentialWrite> {
    return this.serial(async () => {
      try {
        await this.entry(account).setPassword(value);
        return { status: "stored" };
      } catch {
        return { status: "unavailable" };
      }
    });
  }
  delete(
    account: Exclude<CredentialAccount, "chatgpt-session" | "chatgpt-session-key">,
  ): Promise<CredentialWrite> {
    return this.serial(async () => {
      try {
        await this.entry(account).deleteCredential();
        return { status: "stored" };
      } catch {
        return { status: "unavailable" };
      }
    });
  }
  readSession(): Promise<CredentialRead<StoredSession>> {
    return this.serial(async () => {
      try {
        let text: string;
        if (this.options.platform === "win32") {
          // Always consult the store, even for a missing file: unavailability is rediscovered.
          const encodedKey = await this.entry("chatgpt-session-key").getPassword();
          let bytes: Buffer;
          try {
            bytes = await fs.promises.readFile(this.sessionFile);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
            return { status: "unavailable" };
          }
          if (
            encodedKey === null ||
            !/^[0-9a-f]{64}$/.test(encodedKey) ||
            bytes.length < 29 ||
            bytes[0] !== 1
          )
            return { status: "unusable" };
          try {
            const decipher = createDecipheriv(
              "aes-256-gcm",
              Buffer.from(encodedKey, "hex"),
              bytes.subarray(1, 13),
            );
            decipher.setAuthTag(bytes.subarray(-16));
            // No decrypted byte is decoded or returned before authentication succeeds.
            text = Buffer.concat([
              decipher.update(bytes.subarray(13, -16)),
              decipher.final(),
            ]).toString("utf8");
          } catch {
            return { status: "unusable" };
          }
        } else {
          const value = await this.entry("chatgpt-session").getPassword();
          if (value === null) return { status: "absent" };
          text = value;
        }
        const session = decodeSession(text);
        return session ? { status: "stored", value: session } : { status: "unusable" };
      } catch {
        return { status: "unavailable" };
      }
    });
  }
  writeSession(session: StoredSession): Promise<CredentialWrite> {
    return this.serial(async () => {
      let temporary: string | undefined;
      try {
        const text = JSON.stringify(session);
        if (!decodeSession(text)) return { status: "unavailable" };
        if (this.options.platform !== "win32")
          await this.entry("chatgpt-session").setPassword(text);
        else {
          const entry = this.entry("chatgpt-session-key");
          let encodedKey = await entry.getPassword();
          if (encodedKey === null) {
            encodedKey = randomBytes(32).toString("hex");
            await entry.setPassword(encodedKey);
          }
          if (!/^[0-9a-f]{64}$/.test(encodedKey)) return { status: "unavailable" };
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", Buffer.from(encodedKey, "hex"), iv);
          const bytes = Buffer.concat([
            Buffer.from([1]),
            iv,
            cipher.update(text, "utf8"),
            cipher.final(),
            cipher.getAuthTag(),
          ]);
          await fs.promises.mkdir(this.options.userData, { recursive: true, mode: 0o700 });
          temporary = path.join(this.options.userData, `.provider-sessions-${randomUUID()}.tmp`);
          const file = await fs.promises.open(temporary, "wx", 0o600);
          try {
            await file.writeFile(bytes);
            await file.sync();
          } finally {
            await file.close();
          }
          await fs.promises.rename(temporary, this.sessionFile);
        }
        return { status: "stored" };
      } catch {
        return { status: "unavailable" };
      } finally {
        if (temporary) await fs.promises.unlink(temporary).catch(() => {});
      }
    });
  }
  deleteSession(): Promise<CredentialWrite> {
    return this.serial(async () => {
      try {
        if (this.options.platform === "win32") {
          // Keep the key: a later sign-in reuses this checkout's entry.
          await this.entry("chatgpt-session-key").getPassword();
          await fs.promises.unlink(this.sessionFile).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          });
        } else await this.entry("chatgpt-session").deleteCredential();
        return { status: "stored" };
      } catch {
        return { status: "unavailable" };
      }
    });
  }
  drain(): Promise<unknown> {
    return this.queue;
  }
}
