import { ConnectionManager } from "../packages/main/src/connection-manager.js";
import { createFakeProvider } from "../packages/main/src/fake-provider.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  CredentialStore,
  credentialService,
  type CredentialEntryFactory,
} from "../packages/main/src/credential-store.js";
import type { RuntimeContext } from "../packages/contracts/src/index.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(platform: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-credential-test-"));
  roots.push(root);
  const entries = new Map<string, string>();
  let unavailable = false;
  const calls: string[] = [];
  const entry: CredentialEntryFactory = (service, account) => {
    const key = `${service}/${account}`;
    const check = () => {
      calls.push(key);
      if (unavailable) throw new Error("synthetic-provider-secret-error");
    };
    return {
      getPassword: () => {
        check();
        return Promise.resolve(entries.get(key) ?? null);
      },
      setPassword: (value) => {
        check();
        entries.set(key, value);
        return Promise.resolve();
      },
      deleteCredential: () => {
        check();
        return Promise.resolve(entries.delete(key));
      },
    };
  };
  const options = { platform, service: "Ohtia Development synthetic", userData: root, entry };
  return {
    root,
    entries,
    calls,
    options,
    store: new CredentialStore(options),
    fail: (value: boolean) => {
      unavailable = value;
    },
  };
}
const session = { credential: "synthetic-token-".repeat(1000), reason: null };
describe("main credential storage", () => {
  it.each(["darwin", "linux"])(
    "stores the entire %s session and reason in the native entry across restart",
    async (platform) => {
      const f = fixture(platform);
      const value = { ...session, reason: "plan_use_not_allowed" as const };
      expect(await f.store.readSession()).toEqual({ status: "absent" });
      expect(await f.store.writeSession(value)).toEqual({ status: "stored" });
      expect(await new CredentialStore(f.options).readSession()).toEqual({
        status: "stored",
        value,
      });
      expect(fs.readdirSync(f.root)).toEqual([]);
      expect(f.calls.every((key) => key.endsWith("/chatgpt-session"))).toBe(true);
      expect(await f.store.deleteSession()).toEqual({ status: "stored" });
      expect(await f.store.readSession()).toEqual({ status: "absent" });
    },
  );
  it("encrypts long Windows sessions, reuses the key after restart and uses fresh IVs", async () => {
    const f = fixture("win32");
    const file = path.join(f.root, "provider-sessions.enc");
    expect(await f.store.readSession()).toEqual({ status: "absent" });
    expect(await f.store.writeSession(session)).toEqual({ status: "stored" });
    const first = fs.readFileSync(file);
    const key = [...f.entries.values()][0];
    expect(first[0]).toBe(1);
    expect(first.includes(Buffer.from(session.credential))).toBe(false);
    expect(key).toHaveLength(64);
    const restarted = new CredentialStore(f.options);
    expect(await restarted.readSession()).toEqual({ status: "stored", value: session });
    expect(await restarted.writeSession(session)).toEqual({ status: "stored" });
    const second = fs.readFileSync(file);
    expect(second.subarray(1, 13)).not.toEqual(first.subarray(1, 13));
    expect([...f.entries.values()][0]).toBe(key);
    expect(fs.readdirSync(f.root)).toEqual(["provider-sessions.enc"]);
    await restarted.deleteSession();
    expect(fs.existsSync(file)).toBe(false);
    expect(await restarted.readSession()).toEqual({ status: "absent" });
  });
  it.each(["ciphertext", "tag", "version", "truncated", "missing-key"])(
    "rejects a Windows %s fault without returning plaintext",
    async (fault) => {
      const f = fixture("win32");
      await f.store.writeSession(session);
      const file = path.join(f.root, "provider-sessions.enc");
      const manager = new ConnectionManager([
        createFakeProvider({
          credentials: {
            read: () => f.store.readSession(),
            write: (value) => f.store.writeSession(value),
            delete: () => f.store.deleteSession(),
          },
        }),
      ]);
      expect(await manager.read("fake")).toMatchObject({ value: { state: "connected" } });
      let bytes = fs.readFileSync(file);
      if (fault === "ciphertext") bytes[13] = bytes[13]! ^ 1;
      if (fault === "tag") bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      if (fault === "version") bytes[0] = 2;
      if (fault === "truncated") bytes = bytes.subarray(0, 28);
      if (fault === "missing-key") f.entries.clear();
      fs.writeFileSync(file, bytes);
      expect(await new CredentialStore(f.options).readSession()).toEqual({ status: "unusable" });
      expect(await manager.read("fake")).toMatchObject({
        value: { state: "expired", reason: null },
      });
      manager.dispose();
    },
  );
  it.each(["linux", "darwin", "win32"])(
    "reports a missing or cancelled %s store as unavailable and stores nothing",
    async (platform) => {
      const f = fixture(platform);
      f.fail(true);
      expect(await f.store.readSession()).toEqual({ status: "unavailable" });
      expect(await f.store.writeSession(session)).toEqual({ status: "unavailable" });
      expect(await f.store.deleteSession()).toEqual({ status: "unavailable" });
      expect(await f.store.read("chatgpt-registration")).toEqual({ status: "unavailable" });
      expect(await f.store.write("anthropic-api-key", "synthetic-key")).toEqual({
        status: "unavailable",
      });
      expect(await f.store.delete("openai-api-key")).toEqual({ status: "unavailable" });
      expect(f.entries.size).toBe(0);
      expect(fs.readdirSync(f.root)).toEqual([]);
      f.fail(false);
      expect(await f.store.readSession()).toEqual({ status: "absent" });
    },
  );
  it("stores and removes only the named registration and API-key entries", async () => {
    const f = fixture("linux");
    for (const account of [
      "chatgpt-registration",
      "anthropic-api-key",
      "openai-api-key",
    ] as const) {
      expect(await f.store.read(account)).toEqual({ status: "absent" });
      expect(await f.store.write(account, "synthetic-secret")).toEqual({ status: "stored" });
      expect(await f.store.read(account)).toEqual({ status: "stored", value: "synthetic-secret" });
      expect(await f.store.delete(account)).toEqual({ status: "stored" });
      expect(await f.store.read(account)).toEqual({ status: "absent" });
    }
    await f.store.drain();
    expect(f.entries.size).toBe(0);
  });
  it("serializes a delayed write before deletion so a disconnected session cannot reappear", async () => {
    const f = fixture("win32");
    const writing = f.store.writeSession(session);
    const deleting = f.store.deleteSession();
    await Promise.all([writing, deleting]);
    expect(await f.store.readSession()).toEqual({ status: "absent" });
  });
  it("isolates development checkouts from one another and the installed service", () => {
    const root = path.resolve("synthetic-checkout/.ohtia-dev");
    const context = {
      mode: "development",
      configuration_root: path.join(root, "configuration"),
    } as RuntimeContext;
    expect(credentialService(context)).toBe(
      `Ohtia Development ${createHash("sha256").update(root).digest("hex").slice(0, 16)}`,
    );
    expect(
      credentialService({
        ...context,
        configuration_root: path.join(root, "other", "configuration"),
      }),
    ).not.toBe(credentialService(context));
    expect(credentialService({ ...context, mode: "installed" } as RuntimeContext)).toBe("Ohtia");
    expect(credentialService({ ...context, mode: "qualification" } as RuntimeContext)).toBe(
      "Ohtia",
    );
  });
});

describe("native credential boundary", () => {
  it("pins Secret Service and the admitted namespace when creating native entries", async () => {
    const entries: unknown[] = [];
    const { nativeCredentialStore } = await import("../packages/main/src/native-credentials.js");
    const f = fixture("linux");
    const store = await nativeCredentialStore({ mode: "installed" } as RuntimeContext, f.root, () =>
      Promise.resolve({
        AsyncEntry: class {
          constructor(...args: unknown[]) {
            entries.push(args);
          }
          getPassword() {
            return Promise.resolve(null);
          }
          setPassword() {
            return Promise.resolve();
          }
          deleteCredential() {
            return Promise.resolve(false);
          }
        },
      }),
    );
    expect(await store.read("openai-api-key")).toEqual({ status: "absent" });
    expect(entries).toEqual([["Ohtia", "openai-api-key", { linux: { store: "secret-service" } }]]);
  });
  it("keeps a missing native dependency as store unavailability", async () => {
    const { nativeCredentialStore } = await import("../packages/main/src/native-credentials.js");
    const f = fixture("linux");
    const store = await nativeCredentialStore({ mode: "installed" } as RuntimeContext, f.root, () =>
      Promise.reject(new Error("synthetic-native-dependency-failure")),
    );
    expect(await store.readSession()).toEqual({ status: "unavailable" });
    expect(await store.writeSession(session)).toEqual({ status: "unavailable" });
  });
  it("runs fixed native acceptance actions without replacing an existing session", async () => {
    const { credentialAcceptance } = await import("../packages/main/src/fake-provider.js");
    const f = fixture("linux");
    const check = credentialAcceptance(f.store);
    expect(await check("invalid")).toEqual({ status: "rejected" });
    expect(await check("read")).toEqual({ status: "refused" });
    expect(await check("write")).toEqual({ status: "stored" });
    expect(await credentialAcceptance(new CredentialStore(f.options))("read")).toEqual({
      status: "confirmed",
    });
    expect(await check("write")).toEqual({ status: "refused" });
    expect(await check("delete")).toEqual({ status: "confirmed" });
    expect(await check("unavailable")).toEqual({ status: "failed" });
    await f.store.writeSession(session);
    expect(await check("delete")).toEqual({ status: "refused" });
    f.fail(true);
    expect(await check("unavailable")).toEqual({ status: "confirmed" });
  });
});

it("keeps a temporarily unreadable Windows session unavailable without classifying it as expired", async () => {
  const { vi } = await import("vitest");
  const f = fixture("win32");
  await f.store.writeSession(session);
  const original = fs.readFileSync(path.join(f.root, "provider-sessions.enc"));
  const read = vi
    .spyOn(fs.promises, "readFile")
    .mockRejectedValueOnce(Object.assign(new Error("synthetic-denied-read"), { code: "EACCES" }));
  try {
    expect(await f.store.readSession()).toEqual({ status: "unavailable" });
  } finally {
    read.mockRestore();
  }
  expect(fs.readFileSync(path.join(f.root, "provider-sessions.enc"))).toEqual(original);
  expect(await f.store.readSession()).toEqual({ status: "stored", value: session });
});
