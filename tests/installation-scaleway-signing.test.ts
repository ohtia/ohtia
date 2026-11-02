import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockS3 } from "./fixtures/signing-store";
import { afterEach, describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import {
  ScalewaySigningStore,
  ScalewaySigningSecrets,
} from "../tooling/installation-signing-scaleway.mjs";
import {
  canonical,
  hash,
  SigningDeadline,
  withSigningDeadline,
} from "../tooling/installation-authority.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true });
});
function directory() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-s3-fixture-"));
  roots.push(p);
  return p;
}
function store(client = new MockS3()) {
  return new ScalewaySigningStore({
    ingress: "fixture-ingress",
    retained: "fixture-retained",
    client,
  });
}
const versions = Object.fromEntries(
  ["rpm", "rpm_passphrase", "catalog", "catalog_passphrase"].map((n, i) => [
    n,
    { secret_id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`, revision: 2 },
  ]),
);
function secrets(fetcher: typeof fetch, selected = versions) {
  return new ScalewaySigningSecrets({
    token: async () => "synthetic-test-token",
    versions: selected,
    fetcher,
  });
}

describe("Scaleway signer provider contracts", () => {
  it("pins the S3 endpoint and disables automatic mutation retries", async () => {
    const s = new ScalewaySigningStore({
      ingress: "fixture-ingress",
      retained: "fixture-retained",
      credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
    });
    expect(
      () => new ScalewaySigningStore({ ingress: "fixture-ingress", retained: "fixture-retained" }),
    ).toThrow("policy_refused");
    expect(s.client).toBeInstanceOf(S3Client);
    expect(await s.client.config.maxAttempts()).toBe(1);
    expect(await s.client.config.region()).toBe("fr-par");
    expect((await s.client.config.endpoint()).hostname).toBe("s3.fr-par.scw.cloud");
    s.client.destroy();
    expect(
      () => new ScalewaySigningStore({ ingress: "same-bucket", retained: "same-bucket" }),
    ).toThrow();
  });
  it("retains one conditional winner across two backend instances", async () => {
    const mock = new MockS3(),
      a = store(mock),
      b = store(mock),
      id = "a".repeat(64);
    const rows = await Promise.all([
      a.cas(id, null, { state: "signing", actor: 1 }),
      b.cas(id, null, { state: "signing", actor: 2 }),
    ]);
    expect(rows.filter(Boolean)).toHaveLength(1);
    expect(await a.read(id)).toEqual(rows.find(Boolean));
    expect(
      mock.calls
        .filter((c) => c.name === "PutObjectCommand")
        .every((c) => c.input.IfNoneMatch === "*"),
    ).toBe(true);
    expect(mock.calls.some((c) => /Delete|List/.test(c.name))).toBe(false);
  });
  it("preserves a committed marker after a lost write response", async () => {
    const mock = new MockS3(),
      s = store(mock),
      id = "a".repeat(64);
    mock.afterPut = true;
    await expect(s.cas(id, null, { state: "signing" })).rejects.toThrow("authority_unavailable");
    expect((await s.read(id)).state).toBe("signing");
    expect(await s.cas(id, null, { state: "admitted" })).toBeNull();
  });
  it("refuses a malformed or broken retained journal chain", async () => {
    const mock = new MockS3(),
      s = store(mock),
      id = "a".repeat(64);
    mock.objects.set(`fixture-retained/journal/${id}/000.json`, Buffer.from("{"));
    await expect(s.read(id)).rejects.toThrow("signing_uncertain");
    mock.objects.set(
      `fixture-retained/journal/${id}/000.json`,
      canonical({ revision: 0, previous: "forged" }),
    );
    await expect(s.read(id)).rejects.toThrow("signing_uncertain");
  });
  it("copies exact ingress bytes into retained objects without changing the input", async () => {
    const mock = new MockS3(),
      s = store(mock),
      bytes = Buffer.from("synthetic package"),
      ref = { sha256: hash(bytes), bytes: bytes.length };
    mock.objects.set(`fixture-ingress/objects/${ref.sha256}`, bytes);
    const target = path.join(directory(), "copy");
    await s.copyObject(ref, target);
    expect(fs.readFileSync(target)).toEqual(bytes);
    expect(await s.putObject(target, ref)).toEqual(ref);
    expect(await s.readBytes(ref, 100)).toEqual(bytes);
    expect(mock.objects.get(`fixture-ingress/objects/${ref.sha256}`)).toEqual(bytes);
    expect(mock.objects.get(`fixture-retained/objects/${ref.sha256}`)).toEqual(bytes);
  });
  it("refuses retained object tampering and conflicting token bindings", async () => {
    const mock = new MockS3(),
      s = store(mock),
      bytes = canonical({ fixture: true }),
      ref = await s.putBytes(bytes);
    mock.objects.set(`fixture-retained/objects/${ref.sha256}`, Buffer.alloc(bytes.length));
    await expect(s.readBytes(ref, 100)).rejects.toThrow("contract_refused");
    await s.bindToken("fixture-jti", "a".repeat(64), 1000);
    await s.bindToken("fixture-jti", "a".repeat(64), 1000);
    await expect(s.bindToken("fixture-jti", "b".repeat(64), 1000)).rejects.toThrow(
      "authentication_refused",
    );
  });
  it("signs upload tickets for only the exact object and immutable bounded headers", async () => {
    const mock = new MockS3();
    const s = new ScalewaySigningStore({
      ingress: "fixture-ingress",
      retained: "fixture-retained",
      client: mock,
      credentials: {},
      clock: () => 1000,
      presign: async (
        _client: unknown,
        cmd: { input: Record<string, unknown> },
        options: { expiresIn: number; signableHeaders: Set<string> },
      ) => {
        expect(options.expiresIn).toBe(300);
        expect([...options.signableHeaders]).toEqual([
          "content-length",
          "if-none-match",
          "x-amz-checksum-sha256",
        ]);
        expect(cmd.input.IfNoneMatch).toBe("*");
        expect(cmd.input.ContentLength).toBe(10);
        expect(cmd.input.ChecksumSHA256).toBe(
          Buffer.from("a".repeat(64), "hex").toString("base64"),
        );
        return `https://${cmd.input.Bucket}.s3.fr-par.scw.cloud/${cmd.input.Key}?fixture=true`;
      },
    });
    const t = await s.uploadTicket({ sha256: "a".repeat(64), bytes: 10 });
    expect(t.expires_at_ms).toBe(301000);
    s.presign = async () => "https://attacker.invalid/object";
    await expect(s.uploadTicket({ sha256: "a".repeat(64), bytes: 10 })).rejects.toThrow(
      "policy_refused",
    );
  });
  it("produces a genuine offline SDK signature bound to length and conditional creation", async () => {
    const s = new ScalewaySigningStore({
      ingress: "fixture-ingress",
      retained: "fixture-retained",
      credentials: { accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" },
    });
    const ticket = await s.uploadTicket({ sha256: "a".repeat(64), bytes: 10 });
    const headers = new URL(ticket.url).searchParams.get("X-Amz-SignedHeaders");
    expect(headers?.split(";")).toContain("content-length");
    expect(headers?.split(";")).toContain("if-none-match");
    expect(headers?.split(";")).toContain("x-amz-checksum-sha256");
    expect(new URL(ticket.url).searchParams.get("X-Amz-Expires")).toBe("300");
    s.client.destroy();
  });
  it("uses one shared deadline across slow successful journal reads", async () => {
    const mock = new MockS3(),
      s = store(mock),
      id = "a".repeat(64);
    let previous: any = null;
    for (let revision = 0; revision < 10; revision++) {
      const row = { revision, previous: previous ? hash(canonical(previous)) : null };
      mock.objects.set(
        `fixture-retained/journal/${id}/${String(revision).padStart(3, "0")}.json`,
        canonical(row),
      );
      previous = row;
    }
    const original = mock.send.bind(mock);
    mock.send = async (cmd) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return original(cmd);
    };
    await expect(withSigningDeadline(new SigningDeadline(65), () => s.read(id))).rejects.toThrow(
      "authority_unavailable",
    );
    expect(mock.calls.length).toBeLessThan(10);
  });
  it("issues downloads only for the exact retained object and rejects missing or wrong lengths", async () => {
    const mock = new MockS3(),
      ref = { sha256: "a".repeat(64), bytes: 10 };
    const s = new ScalewaySigningStore({
      ingress: "fixture-ingress",
      retained: "fixture-retained",
      client: mock,
      presign: async (_client: unknown, cmd: any) =>
        `https://${cmd.input.Bucket}.s3.fr-par.scw.cloud/${cmd.input.Key}?fixture=true`,
    });
    mock.objects.set(`fixture-retained/objects/${ref.sha256}`, Buffer.alloc(10));
    expect((await s.downloadTicket(ref)).url).toContain(
      `fixture-retained.s3.fr-par.scw.cloud/objects/${ref.sha256}`,
    );
    await expect(s.downloadTicket({ ...ref, bytes: 9 })).rejects.toThrow();
    await expect(s.downloadTicket({ ...ref, sha256: "b".repeat(64) })).rejects.toThrow();
  });
  it("retrieves only explicit Secret Manager revisions and returns fresh secret buffers", async () => {
    const requests: string[] = [];
    const provider = secrets(async (url, options) => {
      requests.push(String(url));
      expect(options?.redirect).toBe("error");
      expect(options?.headers).toEqual({ "X-Auth-Token": "synthetic-test-token" });
      const id = String(url).split("/").at(-4);
      return new Response(
        JSON.stringify({
          secret_id: id,
          revision: 2,
          type: "opaque",
          data: Buffer.from("fixture-secret").toString("base64"),
        }),
      );
    });
    const first = await provider.catalog(),
      second = await provider.catalog();
    expect(
      requests.every(
        (r) =>
          r.startsWith("https://api.scaleway.com/secret-manager/v1beta1/regions/fr-par/secrets/") &&
          r.endsWith("/versions/2/access"),
      ),
    ).toBe(true);
    expect(first.key).toEqual(Buffer.from("fixture-secret"));
    first.key.fill(0);
    first.passphrase.fill(0);
    expect(second.key.toString()).toBe("fixture-secret");
    second.key.fill(0);
    second.passphrase.fill(0);
  });
  it("rejects mutable version aliases, wrong secret identities and invalid base64", async () => {
    const bad = structuredClone(versions);
    bad.rpm.revision = "latest" as never;
    expect(() => secrets(fetch, bad)).toThrow();
    for (const override of [
      { secret_id: "wrong" },
      { revision: 3 },
      { data: "!" },
      { type: "basic_credentials" },
    ]) {
      const provider = secrets(
        async () =>
          new Response(
            JSON.stringify({ ...versions.rpm, type: "opaque", data: "YQ==", ...override }),
          ),
      );
      await expect(provider.rpm()).rejects.toThrow(
        "data" in override ? "policy_refused" : "contract_refused",
      );
    }
  });
  it("bounds a stalled Secret Manager body before returning any material", async () => {
    const provider = new ScalewaySigningSecrets({
      token: async () => "fixture",
      versions,
      deadline: () => new SigningDeadline(20),
      fetcher: async () =>
        new Response(
          new ReadableStream({
            pull() {
              return new Promise(() => {});
            },
          }),
        ),
    });
    await expect(provider.catalog()).rejects.toThrow("authority_unavailable");
  });
  it("refuses unavailable and oversized provider responses without leaking their content", async () => {
    const unavailable = secrets(
      async () => new Response("private backend message", { status: 403 }),
    );
    await expect(unavailable.catalog()).rejects.toThrow("authority_unavailable");
    const large = secrets(async () => new Response(Buffer.alloc(262145)));
    await expect(large.catalog()).rejects.toThrow("size_refused");
  });
});
