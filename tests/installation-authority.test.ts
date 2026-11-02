import fs from "node:fs";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { SignJWT, exportJWK } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonical,
  decode,
  hash,
  SigningError,
  DeterministicSigningRefusal,
  OidcAuthority,
  githubReaders,
  GitSourceAuthority,
  GitHubBuildAuthority,
  SigningDeadline,
  withSigningDeadline,
  command,
  signingLimits,
  trustedPolicy,
  verifyBuildResult,
} from "../tooling/installation-authority.mjs";
import {
  SigningService,
  FileSigningStore,
  CryptoSigningWorker,
  fileReference,
  keyId,
  validateRequest,
  verifyReceipt,
  rpmBodyIdentity,
} from "../tooling/installation-signer.mjs";
import { prepareSigningRequest, loadSignedCatalogs } from "../tooling/installation-signing.mjs";
import { ScalewaySigningStore } from "../tooling/installation-signing-scaleway.mjs";
import { MockS3 } from "./fixtures/signing-store";
import { localSigningServer, LocalSigningClient } from "../tooling/installation-signing-http.mjs";

const NOW = 1790000000000;
const catalogKey = generateKeyPairSync("ed25519");
const issuer = generateKeyPairSync("rsa", { modulusLength: 2048 });
const roots: string[] = [];
const policy = () => ({
  schema_version: 1,
  enabled: true,
  repository_id: "1431132416",
  owner_id: "346940169",
  audience: "ohtia-signing:local",
  environment: "ohtia-signing",
  caller_workflow: ".github/workflows/installation-signing.yml",
  signing_workflow: { workflow: ".github/workflows/signing-worker.yml", sha: "c".repeat(40) },
  build_workflow: { workflow: ".github/workflows/signing-build.yml", sha: "d".repeat(40) },
  source_anchor: "e".repeat(40),
  source_signers: [{ principal: "fixture@example.invalid", public_key: "ssh-ed25519 AAAA" }],
  catalog_public_key: catalogKey.publicKey.export({ format: "pem", type: "spki" }).toString(),
  rpm_primary: "1".repeat(40),
  rpm_subkey: "2".repeat(40),
  deployment: {
    provider: "scaleway-serverless-containers",
    region: "fr-par",
    container_id: "12345678-1234-1234-1234-123456789abc",
    image_digest: "sha256:" + "f".repeat(64),
  },
});
function root() {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-authority-test-")));
  fs.chmodSync(r, 0o700);
  roots.push(r);
  return r;
}
function request(operation = "deb-bind", artifact = "fixture-deb") {
  const input = Buffer.from("synthetic package bytes\n"),
    proof = canonical({ fixture_only: true });
  return {
    schema_version: 1,
    operation,
    subject: {
      kind: "qualification",
      id: "fixture-subject",
      repository: "ohtia/ohtia",
      application_version: "0.0.0-dev.100.1",
      source_commit: "a".repeat(40),
      source_tree: "b".repeat(40),
    },
    execution: {
      workflow: ".github/workflows/installation-signing.yml",
      workflow_sha: "a".repeat(40),
      run_id: 200,
      attempt: 1,
      job_id: 300,
      invocation: "fixture-signing",
    },
    artifact_id: artifact,
    input: { sha256: hash(input), bytes: input.length },
    build_proof: { sha256: hash(proof), bytes: proof.length },
    catalog_bindings: [] as unknown[],
  };
}
function artifact(r = request()) {
  return {
    id: r.artifact_id,
    target: "linux-x64",
    profile: r.operation === "rpm-sign" ? "fedora-44" : "debian-13",
    format: r.operation === "rpm-sign" ? "rpm" : "deb",
    native_version: "0.0.0~dev.100.1-1",
    source_commit: r.subject.source_commit,
    source_tree: r.subject.source_tree,
    inputs_sha256: "9".repeat(64),
    sha256: r.input.sha256,
    bytes: r.input.bytes,
    build_execution: {
      workflow: ".github/workflows/signing-build.yml",
      workflow_sha: "d".repeat(40),
      run_id: 100,
      attempt: 1,
      job_id: 101,
      invocation: "fixture-build",
    },
  };
}
function claims(r = request()) {
  return {
    iss: "https://token.actions.githubusercontent.com",
    aud: "ohtia-signing:local",
    sub: "repo:ohtia/ohtia:environment:ohtia-signing",
    repository: "ohtia/ohtia",
    repository_id: "1431132416",
    repository_owner_id: "346940169",
    ref: "refs/heads/main",
    event_name: "workflow_dispatch",
    runner_environment: "github-hosted",
    environment: "ohtia-signing",
    sha: r.subject.source_commit,
    workflow_sha: r.subject.source_commit,
    workflow_ref: "ohtia/ohtia/.github/workflows/installation-signing.yml@refs/heads/main",
    job_workflow_ref: "ohtia/ohtia/.github/workflows/signing-worker.yml@" + "c".repeat(40),
    job_workflow_sha: "c".repeat(40),
    run_id: String(r.execution.run_id),
    run_attempt: "1",
    check_run_id: "400",
    jti: "fixture-token",
    iat: NOW / 1000 - 1,
    nbf: NOW / 1000 - 1,
    exp: NOW / 1000 + 120,
  };
}
async function token(r = request(), overrides = {}) {
  return new SignJWT({ ...claims(r), ...overrides })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "fixture-issuer" })
    .sign(issuer.privateKey);
}
async function authority(r = request(), overrides = {}) {
  const jwk = await exportJWK(issuer.publicKey);
  return new OidcAuthority(policy(), {
    jwks: async () =>
      Buffer.from(JSON.stringify({ keys: [{ ...jwk, kid: "fixture-issuer", alg: "RS256" }] })),
    clock: () => NOW,
    job: async () => ({
      id: 300,
      run_id: 200,
      run_attempt: 1,
      head_sha: r.subject.source_commit,
      status: "in_progress",
      check_run_url: "https://api.github.com/repos/ohtia/ohtia/check-runs/400",
      ...overrides,
    }),
  });
}
class MemoryStore {
  objects = new Map<string, Buffer>();
  journal = new Map<string, any>();
  tokens = new Map<string, string>();
  object(id: string) {
    return this.objects.get(id);
  }
  async objectSize(id: string) {
    return this.objects.get(id)?.length;
  }
  async putBytes(bytes: Buffer) {
    const ref = { sha256: hash(bytes), bytes: bytes.length };
    this.objects.set(ref.sha256, Buffer.from(bytes));
    return ref;
  }
  async putObject(file: string, ref: any) {
    expect(await fileReference(file)).toEqual(ref);
    return this.putBytes(fs.readFileSync(file));
  }
  async readBytes(ref: any, maximum: number) {
    const value = this.objects.get(ref.sha256);
    if (
      !value ||
      value.length !== ref.bytes ||
      value.length > maximum ||
      hash(value) !== ref.sha256
    )
      throw new SigningError("contract_refused");
    return Buffer.from(value);
  }
  async copyObject(ref: any, file: string) {
    fs.writeFileSync(file, await this.readBytes(ref, 1073741824), { flag: "wx", mode: 0o600 });
  }
  async read(id: string) {
    return structuredClone(this.journal.get(id) ?? null);
  }
  async cas(id: string, prior: any, value: any) {
    const old = this.journal.get(id);
    if ((old?.revision ?? -1) !== (prior?.revision ?? -1)) return null;
    const row = { ...structuredClone(value), revision: (prior?.revision ?? -1) + 1 };
    this.journal.set(id, row);
    return structuredClone(row);
  }
  async bindToken(jti: string, id: string) {
    const old = this.tokens.get(jti);
    if (old && old !== id) throw new SigningError("authentication_refused");
    this.tokens.set(jti, id);
  }
}
async function fixture(r = request(), suppliedStore?: any) {
  const store = suppliedStore ?? new MemoryStore();
  await store.putBytes(Buffer.from("synthetic package bytes\n"));
  await store.putBytes(canonical({ fixture_only: true }));
  const calls = { sign: 0, build: 0, source: 0 };
  const worker = new CryptoSigningWorker(policy(), {
    clock: () => NOW,
    keys: {
      catalog: async () => ({
        key: Buffer.from(catalogKey.privateKey.export({ format: "pem", type: "pkcs8" })),
        passphrase: Buffer.alloc(0),
      }),
    },
  });
  const original = worker.receiptSign.bind(worker);
  worker.receiptSign = async (b: Buffer, options: any) => {
    const value = await original(b, options);
    calls.sign++;
    return value;
  };
  const service = new SigningService(policy(), {
    store,
    caller: await authority(r),
    clock: () => NOW,
    admit: async () => true,
    source: {
      inspect: async () => {
        calls.source++;
        return { fixture_only: true };
      },
    },
    build: {
      verify: async () => {
        calls.build++;
        return artifact(r);
      },
    },
    worker,
  });
  return { service, store, calls, worker, token: await token(r), r };
}
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

describe("fixed signing authority readers", () => {
  it("keeps the optional API token out of public issuer-key requests", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const readers = githubReaders({
      token: "synthetic-read-only-token",
      fetcher: async (url, options) => {
        calls.push({ url: String(url), headers: options.headers });
        return new Response(String(url).includes("jwks") ? '{"keys":[]}' : '{"id":300}');
      },
    });
    await readers.jwks();
    await readers.job(300);
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[1].headers.Authorization).toBe("Bearer synthetic-read-only-token");
    expect(calls.map((c) => c.url)).toEqual([
      "https://token.actions.githubusercontent.com/.well-known/jwks",
      "https://api.github.com/repos/ohtia/ohtia/actions/jobs/300",
    ]);
  });
});

describe("external signing contracts", () => {
  it("requires exact canonical JSON and rejects duplicate keys and unsafe integers", () => {
    expect(decode(canonical(request()))).toEqual(request());
    for (const b of [
      Buffer.from('{"a":1,"a":2}\n'),
      Buffer.from('{ "a":1}\n'),
      Buffer.from('{"a":9007199254740992}\n'),
      Buffer.from('{"a":-0}\n'),
      Buffer.from([0xff]),
    ])
      expect(() => decode(b)).toThrow();
  });
  it("keeps build and signing executions distinct without changing the development version", () => {
    const r = request();
    expect(validateRequest(canonical(r))).toEqual(r);
    expect(r.execution.run_id).not.toBe(artifact(r).build_execution.run_id);
  });
  it("refuses unknown fields public subjects oversized inputs and caller-selected keys", () => {
    for (const change of [
      (r: any) => (r.key = "arbitrary"),
      (r: any) => (r.subject.kind = "candidate"),
      (r: any) => (r.input.bytes = 1073741825),
      (r: any) => (r.subject.application_version = "1.0.0"),
      (r: any) => (r.operation = "raw-sign"),
    ]) {
      const r = request();
      change(r);
      expect(() => validateRequest(canonical(r))).toThrow();
    }
  });
  it("does not deserialize policy or key overrides from request data", () => {
    const p = policy();
    expect(trustedPolicy(p)).toEqual(p);
    expect(Object.isFrozen(trustedPolicy(p).signing_workflow)).toBe(true);
    expect(() => trustedPolicy({ ...p, verifier: "caller.js" })).toThrow();
  });
});

describe("signer GitHub OIDC authority", () => {
  it("verifies a real fixture RSA JWT and binds the actual job identity", async () => {
    const r = request(),
      a = await authority(r);
    expect((await a.verify(await token(r), r)).execution).toEqual(r.execution);
  });
  it.each([
    "repository_id",
    "repository_owner_id",
    "ref",
    "event_name",
    "runner_environment",
    "environment",
    "sha",
    "workflow_sha",
    "workflow_ref",
    "job_workflow_sha",
    "job_workflow_ref",
    "run_id",
    "run_attempt",
    "check_run_id",
    "sub",
  ])("refuses changed signed claim %s", async (name) => {
    const r = request(),
      a = await authority(r);
    await expect(a.verify(await token(r, { [name]: "wrong" }), r)).rejects.toThrow(
      "authentication_refused",
    );
  });
  it("refuses expired future unsigned and wrong-audience tokens", async () => {
    const r = request(),
      a = await authority(r);
    for (const t of [
      await token(r, { exp: NOW / 1000 }),
      await token(r, { nbf: NOW / 1000 + 1 }),
      await token(r, { aud: "other" }),
      "e30.e30.invalid",
    ])
      await expect(a.verify(t, r)).rejects.toThrow("authentication_refused");
  });
  it("refuses a job from another attempt or another check run", async () => {
    const r = request();
    for (const wrong of [
      { run_attempt: 2 },
      { check_run_url: "https://api.github.com/repos/ohtia/ohtia/check-runs/401" },
      { status: "completed" },
    ])
      await expect((await authority(r, wrong)).verify(await token(r), r)).rejects.toThrow(
        "authentication_refused",
      );
  });
  it("denies disabled policy even with a valid caller token", async () => {
    const p = policy();
    p.enabled = false;
    const a = new OidcAuthority(p, {
      jwks: async () => Buffer.alloc(0),
      job: async () => null,
      clock: () => NOW,
    });
    await expect(a.verify(await token(), request())).rejects.toThrow("policy_refused");
  });
});

describe("immutable signing operations", () => {
  it("binds an unchanged DEB and authenticates a domain-separated receipt", async () => {
    const f = await fixture();
    const b = canonical(f.r);
    await f.service.create(f.token, b);
    const done = await f.service.execute(f.token, hash(b), b);
    expect(done.state).toBe("sealed");
    expect(done.result).toEqual(f.r.input);
    const bytes = await f.store.readBytes(done.receipt, 65536),
      sig = await f.store.readBytes(done.receipt_signature, 64);
    expect(verifyReceipt(bytes, sig, policy()).signer).toEqual({ mechanism: "none", id: null });
    expect(verify(null, bytes, catalogKey.publicKey, sig)).toBe(false);
  });
  it("returns the identical sealed bytes after a retry and process reconstruction", async () => {
    const f = await fixture(),
      b = canonical(f.r);
    await f.service.create(f.token, b);
    const first = await f.service.execute(f.token, hash(b), b);
    const second = await f.service.execute(f.token, hash(b), b);
    expect(second).toEqual(first);
    expect(f.calls.sign).toBe(1);
  });
  it("never lets a new request ID replace a sealed immutable artifact", async () => {
    const f = await fixture(),
      b = canonical(f.r);
    await f.service.create(f.token, b);
    await f.service.execute(f.token, hash(b), b);
    const changed = structuredClone(f.r);
    changed.input.sha256 = "0".repeat(64);
    await expect(
      f.service.create(await token(changed, { jti: "another" }), canonical(changed)),
    ).rejects.toThrow("request_conflict");
  });
  it("binds a token identifier to its original request", async () => {
    const f = await fixture();
    await f.service.create(f.token, canonical(f.r));
    const r = structuredClone(f.r);
    r.artifact_id = "another";
    await expect(f.service.create(f.token, canonical(r))).rejects.toThrow("authentication_refused");
  });
  it("refuses unsigned or substituted build metadata before using a private key", async () => {
    const f = await fixture(),
      b = canonical(f.r);
    f.service.build = { verify: async () => ({ ...artifact(f.r), sha256: "0".repeat(64) }) };
    await f.service.create(f.token, b);
    await expect(f.service.execute(f.token, hash(b), b)).rejects.toThrow("policy_refused");
    expect(f.calls.sign).toBe(0);
  });
  it("refuses a build execution masquerading as the signing job", async () => {
    const f = await fixture(),
      b = canonical(f.r);
    const a = artifact(f.r);
    a.build_execution.job_id = f.r.execution.job_id;
    f.service.build = { verify: async () => a };
    await f.service.create(f.token, b);
    await expect(f.service.execute(f.token, hash(b), b)).rejects.toThrow("policy_refused");
    expect(f.calls.sign).toBe(0);
  });
  it("admits at most one concurrent execution of an immutable request", async () => {
    const f = await fixture(),
      b = canonical(f.r);
    await f.service.create(f.token, b);
    const results = await Promise.allSettled([
      f.service.execute(f.token, hash(b), b),
      f.service.execute(f.token, hash(b), b),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.calls.sign).toBe(1);
  });
  it("quarantines a post-signature failure and refuses automatic re-signing", async () => {
    const f = await fixture(),
      b = canonical(f.r);
    f.worker.receiptSign = async (_bytes: Buffer, options: any) => {
      await options.beforeSign();
      f.calls.sign++;
      throw new Error("synthetic settled-write loss");
    };
    await f.service.create(f.token, b);
    await expect(f.service.execute(f.token, hash(b), b)).rejects.toThrow("signing_uncertain");
    await expect(f.service.execute(f.token, hash(b), b)).rejects.toThrow("signing_uncertain");
    expect(f.calls.sign).toBe(1);
    expect((await f.service.status(f.token, hash(b), b)).state).toBe("uncertain");
  });
  it("rechecks revocation before releasing a completed signing result", async () => {
    const f = await fixture(),
      b = canonical(f.r);
    await f.service.create(f.token, b);
    await f.service.execute(f.token, hash(b), b);
    f.service.admit = async () => false;
    await expect(f.service.status(f.token, hash(b), b)).rejects.toThrow("policy_refused");
  });
  it("refuses altered input bytes before any signing call", async () => {
    const f = await fixture(),
      b = canonical(f.r);
    f.store.objects.set(f.r.input.sha256, Buffer.from("altered input"));
    await f.service.create(f.token, b);
    await expect(f.service.execute(f.token, hash(b), b)).rejects.toThrow();
    expect(f.calls.sign).toBe(0);
  });
  it("has no implicit operational authority when a live gate is absent", async () => {
    const f = await fixture();
    const s = new SigningService(policy(), { store: f.store, caller: f.service.caller });
    await expect(s.create(f.token, canonical(f.r))).rejects.toThrow("policy_refused");
  });
});

// Native fixtures include interpreter startup and scheduler contention; service deadlines stay independently enforced.
const linuxIt = (name: string, operation: () => unknown) =>
  it.skipIf(process.platform !== "linux")(name, operation, signingLimits.subprocess_ms);
describe("local durable signer backend", () => {
  linuxIt(
    "bounds retained journal and token files before following or reading filesystem entries",
    async () => {
      const dir = root(),
        store = new FileSigningStore(dir),
        id = "a".repeat(64),
        tokenId = "retained-file-fixture";
      await store.cas(id, null, { state: "admitted" });
      await store.bindToken(tokenId, id, 1000);
      const entries = [
        {
          file: path.join(dir, "journal", id, "000.json"),
          operation: `await store.read(${JSON.stringify(id)})`,
        },
        {
          file: path.join(dir, "tokens", hash(Buffer.from(tokenId))),
          operation: `await store.bindToken(${JSON.stringify(tokenId)},${JSON.stringify(id)},1000)`,
        },
      ];
      for (const entry of entries) {
        const original = fs.readFileSync(entry.file),
          outside = path.join(root(), "other-entry");
        fs.writeFileSync(outside, original, { mode: 0o600 });
        for (const kind of ["oversized", "symlink", "hardlink", "fifo"]) {
          fs.unlinkSync(entry.file);
          if (kind === "oversized")
            fs.writeFileSync(entry.file, Buffer.alloc(signingLimits.request_bytes + 1), {
              mode: 0o600,
            });
          if (kind === "symlink") fs.symlinkSync(outside, entry.file);
          if (kind === "hardlink") fs.linkSync(outside, entry.file);
          if (kind === "fifo") execFileSync("/usr/bin/mkfifo", ["--mode=600", entry.file]);
          const module = new URL("../tooling/installation-signer.mjs", import.meta.url).href;
          const code = `import {FileSigningStore} from ${JSON.stringify(module)}; const store=new FileSigningStore(${JSON.stringify(dir)});try{${entry.operation};console.log("unexpected acceptance")}catch(error){console.log(error.code)}`;
          expect(
            (
              await command(process.execPath, ["--input-type=module", "-e", code], {
                timeout: 5000,
              })
            ).toString(),
          ).toBe("signing_uncertain\n");
        }
        fs.unlinkSync(entry.file);
        fs.writeFileSync(entry.file, original, { mode: 0o600 });
      }
    },
  );
  linuxIt(
    "publishes one-link immutable objects across independent concurrent writers",
    async () => {
      const dir = root(),
        store = new FileSigningStore(dir),
        data = Buffer.from("concurrent immutable fixture"),
        ref = { sha256: hash(data), bytes: data.length };
      const module = new URL("../tooling/installation-signer.mjs", import.meta.url).href;
      const code = `import{FileSigningStore}from ${JSON.stringify(module)};await new FileSigningStore(${JSON.stringify(dir)}).putBytes(Buffer.from("concurrent immutable fixture"));`;
      await Promise.all([
        command(process.execPath, ["--input-type=module", "-e", code]),
        command(process.execPath, ["--input-type=module", "-e", code]),
      ]);
      expect(fs.statSync(store.object(ref.sha256)).nlink).toBe(1);
      expect(await new FileSigningStore(dir).readBytes(ref, 1000)).toEqual(data);
    },
  );
  linuxIt("retains an exclusive journal across independent backend instances", async () => {
    const dir = root(),
      a = new FileSigningStore(dir),
      b = new FileSigningStore(dir),
      id = "a".repeat(64);
    const results = await Promise.all([
      a.cas(id, null, { state: "admitted" }),
      b.cas(id, null, { state: "admitted" }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await new FileSigningStore(dir).read(id)).state).toBe("admitted");
  });
  linuxIt("refuses torn journal data without reusing its revision", async () => {
    const dir = root(),
      a = new FileSigningStore(dir),
      id = "b".repeat(64);
    await a.cas(id, null, { state: "signing" });
    fs.writeFileSync(path.join(dir, "journal", id, "001.json"), "{");
    await expect(a.read(id)).rejects.toThrow();
    expect(fs.readFileSync(path.join(dir, "journal", id, "000.json"), "utf8")).toContain(
      '"signing"',
    );
  });
  linuxIt("streams exact fixture objects without changing original files", async () => {
    const dir = root(),
      store = new FileSigningStore(dir),
      file = path.join(dir, "input");
    fs.writeFileSync(file, "synthetic", { mode: 0o600 });
    const ref = await fileReference(file);
    await store.putObject(file, ref);
    expect(await store.readBytes(ref, 100)).toEqual(Buffer.from("synthetic"));
    await expect(store.readBytes({ ...ref, sha256: "c".repeat(64) }, 100)).rejects.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("synthetic");
  });
  linuxIt("exercises the loopback API client with exact upload and result tickets", async () => {
    const f = await fixture(),
      dir = root(),
      store = new FileSigningStore(dir);
    f.service.store = store;
    const input = path.join(dir, "input"),
      proof = path.join(dir, "proof");
    fs.writeFileSync(input, "synthetic package bytes\n");
    fs.writeFileSync(proof, canonical({ fixture_only: true }));
    const server = await localSigningServer(f.service, { clock: () => NOW });
    try {
      const client = new LocalSigningClient(server.origin, { token: async () => f.token });
      const result = await client.run(f.r, { input, proof });
      expect(result.state).toBe("sealed");
      const dest = path.join(dir, "download");
      await client.download(result.result, dest);
      expect(fs.readFileSync(dest)).toEqual(fs.readFileSync(input));
      expect(() => client.transferUrl("http://attacker.invalid/file")).toThrow();
    } finally {
      await server.close();
    }
  });
});

describe("independent source history admission", () => {
  function graph() {
    const dir = root();
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Synthetic fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Synthetic fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    };
    const git = (...args: string[]) =>
      execFileSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", ...args], {
        cwd: dir,
        env,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    git("init", "--initial-branch=main");
    fs.writeFileSync(path.join(dir, "source"), "anchor\n");
    git("add", "source");
    git("-c", "commit.gpgsign=false", "commit", "-m", "Synthetic anchor");
    const anchor = git("rev-parse", "HEAD");
    const privateKey = path.join(dir, "fixture-key");
    execFileSync("/usr/bin/ssh-keygen", ["-t", "ed25519", "-N", "", "-f", privateKey], {
      stdio: "pipe",
    });
    const publicKey = fs
      .readFileSync(privateKey + ".pub", "utf8")
      .split(" ")
      .slice(0, 2)
      .join(" ");
    const p = policy();
    p.source_anchor = anchor;
    p.source_signers = [{ principal: "fixture@example.invalid", public_key: publicKey }];
    function commit(name: string, file = name) {
      fs.writeFileSync(path.join(dir, file), name + "\n");
      git("add", file);
      git(
        "-c",
        "gpg.format=ssh",
        "-c",
        `user.signingkey=${privateKey}`,
        "-c",
        "commit.gpgsign=true",
        "commit",
        "-m",
        name,
      );
      return git("rev-parse", "HEAD");
    }
    return { dir, git, p, commit, anchor };
  }
  linuxIt(
    "admits a bounded signed expansion beyond the former incidental object-output limit",
    async () => {
      const f = graph(),
        directory = path.join(f.dir, "synthetic-objects");
      fs.mkdirSync(directory);
      for (let i = 0; i < 6400; i++)
        fs.writeFileSync(path.join(directory, `file-${i}.txt`), `fixture-${i}\n`);
      f.git("add", "synthetic-objects");
      const source = f.commit("many-objects");
      expect(
        (
          await new GitSourceAuthority(f.p, { repository: f.dir }).inspect(
            source,
            f.git("rev-parse", "HEAD^{tree}"),
          )
        ).records,
      ).toHaveLength(1);
    },
  );
  linuxIt("admits real personally signed commits and reproducible clean merges", async () => {
    const f = graph();
    f.git("checkout", "-b", "left");
    f.commit("left");
    f.git("checkout", "main");
    f.commit("right");
    f.git("-c", "commit.gpgsign=false", "merge", "--no-ff", "left", "-m", "Synthetic clean merge");
    const source = f.git("rev-parse", "HEAD"),
      tree = f.git("rev-parse", "HEAD^{tree}");
    const result = await new GitSourceAuthority(f.p, { repository: f.dir }).inspect(source, tree);
    expect(result.records.map((r: any) => r.kind).sort()).toEqual([
      "clean-merge",
      "personal-signature",
      "personal-signature",
    ]);
  });
  linuxIt(
    "refuses an unsigned source mutation despite matching branch and tree fields",
    async () => {
      const f = graph();
      fs.writeFileSync(path.join(f.dir, "source"), "unreviewed\n");
      f.git("add", "source");
      f.git("-c", "commit.gpgsign=false", "commit", "-m", "Synthetic unsigned mutation");
      await expect(
        new GitSourceAuthority(f.p, { repository: f.dir }).inspect(
          f.git("rev-parse", "HEAD"),
          f.git("rev-parse", "HEAD^{tree}"),
        ),
      ).rejects.toThrow("policy_refused");
    },
  );
  linuxIt("refuses a forged merge tree and an unknown personal key", async () => {
    const f = graph();
    f.git("checkout", "-b", "left");
    const left = f.commit("left");
    f.git("checkout", "main");
    const right = f.commit("right");
    const evilTree = f.git("rev-parse", `${left}^{tree}`);
    const forged = execFileSync(
      "/usr/bin/git",
      [
        "-c",
        "commit.gpgsign=false",
        "commit-tree",
        evilTree,
        "-p",
        left,
        "-p",
        right,
        "-m",
        "Synthetic forged merge",
      ],
      {
        cwd: f.dir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_NAME: "fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        },
        encoding: "utf8",
      },
    ).trim();
    await expect(
      new GitSourceAuthority(f.p, { repository: f.dir }).inspect(forged, evilTree),
    ).rejects.toThrow("policy_refused");
    const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" });
    const ssh = Buffer.concat([
      Buffer.from([0, 0, 0, 11]),
      Buffer.from("ssh-ed25519"),
      Buffer.from([0, 0, 0, 32]),
      other.subarray(-32),
    ]).toString("base64");
    f.p.source_signers[0].public_key = "ssh-ed25519 " + ssh;
    await expect(
      new GitSourceAuthority(f.p, { repository: f.dir }).inspect(
        right,
        f.git("rev-parse", `${right}^{tree}`),
      ),
    ).rejects.toThrow("policy_refused");
  });
  linuxIt(
    "reuses authenticated prefix records without trusting caller-supplied cache flags",
    async () => {
      const f = graph(),
        records = new Map();
      const source = f.commit("first"),
        tree = f.git("rev-parse", "HEAD^{tree}");
      const cache = {
        get: async (k: string) => records.get(k),
        put: async (k: string, v: any) => {
          records.set(k, structuredClone(v));
        },
      };
      const a = new GitSourceAuthority(f.p, { repository: f.dir, cache });
      expect((await a.inspect(source, tree)).records).toHaveLength(1);
      expect((await a.inspect(source, tree)).records).toHaveLength(0);
      const next = f.commit("second");
      expect((await a.inspect(next, f.git("rev-parse", "HEAD^{tree}"))).records).toHaveLength(1);
    },
  );
  linuxIt(
    "uses authenticated persistent prefixes through the real Git source authority",
    async () => {
      const f = graph(),
        source = f.commit("authenticated cache"),
        tree = f.git("rev-parse", "HEAD^{tree}");
      const store = new FileSigningStore(root());
      const worker = new CryptoSigningWorker(f.p, {
        clock: () => NOW,
        keys: {
          catalog: async () => ({
            key: Buffer.from(catalogKey.privateKey.export({ format: "pem", type: "pkcs8" })),
            passphrase: Buffer.alloc(0),
          }),
        },
      });
      const authority = new GitSourceAuthority(f.p, {
        repository: f.dir,
        cache: store.sourceCache(f.p, worker),
      });
      expect((await authority.inspect(source, tree)).records).toHaveLength(1);
      expect((await authority.inspect(source, tree)).records).toHaveLength(0);
    },
  );
});

describe("authenticated build provenance binding", () => {
  function result(r = request(), a = artifact(r)) {
    return {
      signature: {
        certificate: {
          issuer: "https://token.actions.githubusercontent.com",
          sourceRepositoryURI: "https://github.com/ohtia/ohtia",
          sourceRepositoryIdentifier: "1431132416",
          sourceRepositoryOwnerIdentifier: "346940169",
          sourceRepositoryDigest: r.subject.source_commit,
          sourceRepositoryRef: "refs/heads/main",
          runnerEnvironment: "github-hosted",
          buildTrigger: "workflow_dispatch",
          buildSignerURI:
            "https://github.com/ohtia/ohtia/.github/workflows/signing-build.yml@" + "d".repeat(40),
          buildSignerDigest: "d".repeat(40),
          runInvocationURI: "https://github.com/ohtia/ohtia/actions/runs/100/attempts/1",
        },
      },
      verifiedTimestamps: [{ type: "Tlog", timestamp: "synthetic fixture only" }],
      statement: {
        predicateType: "https://slsa.dev/provenance/v1",
        subject: [{ digest: { sha256: r.input.sha256 } }],
        predicate: { buildDefinition: { externalParameters: { ohtia: a } } },
      },
    };
  }
  it("executes the attestation adapter contract and independently requires a successful build job", async () => {
    const r = request(),
      a = artifact(r),
      calls: string[][] = [];
    let job = {
      id: a.build_execution.job_id,
      run_id: a.build_execution.run_id,
      run_attempt: a.build_execution.attempt,
      head_sha: r.subject.source_commit,
      status: "completed",
      conclusion: "success",
    };
    const verifier = new GitHubBuildAuthority(policy(), {
      job: async () => job,
      runner: async (_program: string, args: string[]) => {
        calls.push(args);
        return Buffer.from(JSON.stringify([{ verificationResult: result(r, a) }]));
      },
    });
    const proof = { schema_version: 1, artifact: a, bundle: "synthetic verified-bundle fixture" };
    expect(await verifier.verify(path.join(root(), "not-executed"), proof, r)).toEqual(a);
    expect(calls[0]).toContain("--deny-self-hosted-runners");
    expect(calls[0]).toContain("--signer-digest");
    expect(calls[0]).not.toContain("--no-public-good");
    job = { ...job, status: "in_progress" };
    await expect(verifier.verify(path.join(root(), "not-executed"), proof, r)).rejects.toThrow(
      "authority_unavailable",
    );
    job = { ...job, status: "completed", conclusion: "failure" };
    await expect(verifier.verify(path.join(root(), "not-executed"), proof, r)).rejects.toThrow(
      "policy_refused",
    );
    const malformed = new GitHubBuildAuthority(policy(), {
      runner: async () => Buffer.from("not JSON"),
      job: async () => job,
    });
    await expect(malformed.verify(path.join(root(), "not-executed"), proof, r)).rejects.toThrow();
  });
  it("binds a verified attestation certificate to the fixed builder source and input manifest", () => {
    const r = request(),
      a = artifact(r);
    expect(verifyBuildResult(result(r, a), r, policy(), a)).toBe(true);
  });
  it.each([
    "sourceRepositoryIdentifier",
    "sourceRepositoryOwnerIdentifier",
    "sourceRepositoryDigest",
    "buildSignerDigest",
    "runInvocationURI",
    "runnerEnvironment",
  ])("refuses an authenticated proof from a different %s", (field) => {
    const r = request(),
      a = artifact(r),
      proof = result(r, a);
    (proof.signature.certificate as any)[field] = "wrong";
    expect(() => verifyBuildResult(proof, r, policy(), a)).toThrow("policy_refused");
  });
  it("does not treat a verified certificate as permission for a different artifact or caller predicate", () => {
    const r = request(),
      a = artifact(r),
      proof = result(r, a);
    proof.statement.predicate.buildDefinition.externalParameters.ohtia = {
      ...a,
      inputs_sha256: "0".repeat(64),
    };
    expect(() => verifyBuildResult(proof, r, policy(), a)).toThrow("policy_refused");
    proof.statement.predicate.buildDefinition.externalParameters.ohtia = a;
    proof.statement.subject[0].digest.sha256 = "0".repeat(64);
    expect(() => verifyBuildResult(proof, r, policy(), a)).toThrow("policy_refused");
  });
});

describe("catalog signing over sealed private package bytes", () => {
  async function signedCatalogFixture(suppliedStore?: any) {
    const f = await fixture(request(), suppliedStore),
      bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    const sealed = await f.service.execute(f.token, hash(bytes), bytes);
    const r = request("catalog-sign", null as any);
    const binding = {
      artifact_id: f.r.artifact_id,
      request_id: sealed.request_id,
      ...sealed.result,
      format: "deb",
    };
    r.catalog_bindings = [binding];
    const a = artifact(f.r);
    const catalog = {
      schema_version: 1,
      key_id: keyId(policy().catalog_public_key),
      sequence: 1,
      issued_ms: NOW - 1,
      expires_ms: NOW + 60000,
      candidate: a.inputs_sha256,
      source_sha: r.subject.source_commit,
      version: r.subject.application_version,
      channels: ["preview"],
      notes_sha256: "8".repeat(64),
      packages: [
        {
          target: a.target,
          profile: a.profile,
          format: a.format,
          filename: "fixture.deb",
          bytes: sealed.result.bytes,
          sha256: sealed.result.sha256,
          native_version: a.native_version,
          schema: { source_min: 0, source_max: 2, target: 2 },
          queued_work_version: null,
        },
      ],
    };
    const input = canonical(catalog),
      proof = canonical({ schema_version: 1, bindings: r.catalog_bindings });
    r.input = await f.store.putBytes(input);
    r.build_proof = await f.store.putBytes(proof);
    return { ...f, r, input, catalog, token: await token(r, { jti: "catalog-token" }) };
  }
  it("signs the exact existing catalog format only after independent package binding", async () => {
    const f = await signedCatalogFixture(),
      bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    const result = await f.service.execute(f.token, hash(bytes), bytes);
    const sig = await f.store.readBytes(result.result, 64);
    expect(verify(null, f.input, catalogKey.publicKey, sig)).toBe(true);
  });
  it("round-trips both existing catalog producer and consumer with authenticated input-closure bindings", async () => {
    const dir = root(),
      build = path.join(dir, "build"),
      prepared = path.join(dir, "requests"),
      publicKey = path.join(dir, "public.pem");
    fs.mkdirSync(build);
    fs.writeFileSync(publicKey, policy().catalog_public_key);
    const inputs = { source_sha: "a".repeat(40), files: { "fixture.txt": "b".repeat(64) } };
    const contracts = {
      versions: ["0.0.0-dev.100.1", "0.0.0-dev.100.2"],
      target_schema: 2,
      migration_manifest_sha256: "c".repeat(64),
    };
    const cell = { target: "linux-x64", profile: "debian-13", formats: ["deb"] };
    for (const [name, value] of Object.entries({ inputs, contracts, cell }))
      fs.writeFileSync(path.join(build, `${name}.json`), canonical(value));
    for (const attempt of [1, 2]) {
      const packages = path.join(build, `build-${attempt}/packages`);
      fs.mkdirSync(packages, { recursive: true });
      fs.writeFileSync(
        path.join(packages, `fixture-${attempt}.deb`),
        `authenticated fixture ${attempt}`,
      );
    }
    const candidate = hash(canonical({ inputs, contracts }));
    await prepareSigningRequest(
      build,
      prepared,
      publicKey,
      keyId(policy().catalog_public_key),
      1,
      NOW,
    );
    for (const attempt of [1, 2]) {
      const r = request("deb-bind", `fixture-deb-${attempt}`);
      r.subject.application_version = contracts.versions[attempt - 1];
      const f = await fixture(r);
      r.input = await f.store.putBytes(
        fs.readFileSync(path.join(build, `build-${attempt}/packages/fixture-${attempt}.deb`)),
      );
      f.service.build.verify = async () => ({
        ...artifact(r),
        native_version: r.subject.application_version.replace("-", "~") + "-1",
        inputs_sha256: candidate,
        build_execution: { ...artifact(r).build_execution, attempt },
      });
      let bytes = canonical(r);
      await f.service.create(f.token, bytes);
      const bound = await f.service.execute(f.token, hash(bytes), bytes);
      const catalog = {
        ...r,
        operation: "catalog-sign",
        artifact_id: null,
        catalog_bindings: [
          {
            artifact_id: r.artifact_id,
            request_id: bound.request_id,
            ...bound.result,
            format: "deb",
          },
        ],
      };
      catalog.input = await f.store.putBytes(
        fs.readFileSync(path.join(prepared, `catalog-${attempt}.json`)),
      );
      catalog.build_proof = await f.store.putBytes(
        canonical({ schema_version: 1, bindings: catalog.catalog_bindings }),
      );
      const t = await token(catalog, { jti: `existing-catalog-${attempt}` });
      bytes = canonical(catalog);
      await f.service.create(t, bytes);
      const signed = await f.service.execute(t, hash(bytes), bytes);
      fs.writeFileSync(
        path.join(prepared, `catalog-${attempt}.sig`),
        await f.store.readBytes(signed.result, 64),
      );
    }
    expect(
      (
        await loadSignedCatalogs(build, prepared, publicKey, keyId(policy().catalog_public_key), {
          now: NOW,
        })
      ).catalogs,
    ).toHaveLength(2);
  });
  it("retains catalog bytes and build proof after simulated ingress cleanup", async () => {
    const client = new MockS3(),
      store = new ScalewaySigningStore({
        ingress: "fixture-ingress",
        retained: "fixture-retained",
        client,
      });
    const f = await signedCatalogFixture(store);
    for (const ref of [f.r.input, f.r.build_proof]) {
      const key = `objects/${ref.sha256}`;
      client.objects.set(`fixture-ingress/${key}`, client.objects.get(`fixture-retained/${key}`)!);
      client.objects.delete(`fixture-retained/${key}`);
    }
    const bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    await f.service.execute(f.token, hash(bytes), bytes);
    for (const key of [...client.objects.keys()])
      if (key.startsWith("fixture-ingress/")) client.objects.delete(key);
    expect(await store.readBytes(f.r.input, 65536)).toEqual(f.input);
    expect(await store.readBytes(f.r.build_proof, 2097152)).toEqual(
      canonical({ schema_version: 1, bindings: f.r.catalog_bindings }),
    );
    expect((await f.service.status(f.token, hash(bytes), bytes)).state).toBe("sealed");
  });
  it("retries the same catalog identity after its package binding becomes sealed", async () => {
    const f = await signedCatalogFixture(),
      original = request(),
      key = f.service.identity(original),
      state = f.store.journal.get(key);
    f.store.journal.set(key, { ...state, state: "admitted" });
    const bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "authority_unavailable",
    );
    expect(f.store.journal.get(f.service.identity(f.r)).state).toBe("admitted");
    f.store.journal.set(key, state);
    expect((await f.service.execute(f.token, hash(bytes), bytes)).state).toBe("sealed");
  });
  it("does not quarantine a catalog identity for an unreadable sibling journal", async () => {
    const f = await signedCatalogFixture(),
      sibling = f.service.identity(request()),
      read = f.store.read.bind(f.store);
    let unreadable = true;
    f.store.read = async (id: string) => {
      if (unreadable && id === sibling) throw new SigningError("signing_uncertain");
      return read(id);
    };
    const bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "authority_unavailable",
    );
    expect(f.store.journal.get(f.service.identity(f.r)).state).toBe("admitted");
    expect(f.calls.sign).toBe(1);
    unreadable = false;
    expect((await f.service.execute(f.token, hash(bytes), bytes)).state).toBe("sealed");
  });
  it("refuses duplicate native package identities even when both independent bindings are sealed", async () => {
    const f = await signedCatalogFixture(),
      second = request("deb-bind", "second-deb");
    second.input = await f.store.putBytes(Buffer.from("different authenticated DEB bytes"));
    f.service.build.verify = async (_input: unknown, _proof: unknown, r: any) => artifact(r);
    const t = await token(second, { jti: "second-deb-token" }),
      bytes = canonical(second);
    await f.service.create(t, bytes);
    const sealed = await f.service.execute(t, hash(bytes), bytes);
    f.r.catalog_bindings.push({
      artifact_id: second.artifact_id,
      request_id: sealed.request_id,
      ...sealed.result,
      format: "deb",
    });
    f.catalog.packages.push({ ...f.catalog.packages[0], ...sealed.result, filename: "second.deb" });
    f.r.input = await f.store.putBytes(canonical(f.catalog));
    f.r.build_proof = await f.store.putBytes(
      canonical({ schema_version: 1, bindings: f.r.catalog_bindings }),
    );
    const requestBytes = canonical(f.r);
    await f.service.create(f.token, requestBytes);
    await expect(f.service.execute(f.token, hash(requestBytes), requestBytes)).rejects.toThrow(
      "policy_refused",
    );
    expect(f.calls.sign).toBe(2);
  });
  it("refuses mismatched catalog bytes or an unsealed binding before signing", async () => {
    const f = await signedCatalogFixture();
    f.catalog.packages[0].sha256 = "0".repeat(64);
    f.r.input = await f.store.putBytes(canonical(f.catalog));
    const bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow("policy_refused");
    expect(f.calls.sign).toBe(1);
  });
  it("rejects dangerous filenames schema omissions and a public channel", async () => {
    for (const change of [
      (c: any) => (c.packages[0].filename = "../bad.deb"),
      (c: any) => delete c.packages[0].schema,
      (c: any) => (c.channels = ["stable"]),
    ]) {
      const f = await signedCatalogFixture();
      change(f.catalog);
      f.r.input = await f.store.putBytes(canonical(f.catalog));
      const bytes = canonical(f.r);
      await f.service.create(f.token, bytes);
      await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow();
      expect(f.calls.sign).toBe(1);
    }
  });
});

describe("signer retained-state integrity", () => {
  linuxIt("authenticates source-prefix records against private-storage tampering", async () => {
    const dir = root(),
      store = new FileSigningStore(dir),
      p = policy();
    const worker = new CryptoSigningWorker(p, {
      keys: {
        catalog: async () => ({
          key: Buffer.from(catalogKey.privateKey.export({ format: "pem", type: "pkcs8" })),
          passphrase: Buffer.alloc(0),
        }),
      },
    });
    const cache = store.sourceCache(p, worker),
      record = {
        commit: "a".repeat(40),
        tree: "b".repeat(40),
        policy_sha256: hash(canonical(p)),
        kind: "personal-signature",
      };
    await cache.put("prefix", record);
    expect(await cache.get("prefix")).toEqual(record);
    const id = hash(canonical({ kind: "verified-source", key: "prefix" })),
      file = path.join(dir, "journal", id, "000.json"),
      row = decode(fs.readFileSync(file));
    row.record.tree = "c".repeat(40);
    fs.writeFileSync(file, canonical(row));
    await expect(cache.get("prefix")).rejects.toThrow("policy_refused");
  });
  linuxIt("allows exactly one writer across separate Node processes", async () => {
    const dir = root(),
      id = "f".repeat(64);
    const script = `import{FileSigningStore}from ${JSON.stringify(new URL("../tooling/installation-signer.mjs", import.meta.url).href)};const s=new FileSigningStore(process.argv[1]);process.stdout.write(JSON.stringify(Boolean(await s.cas(process.argv[2],null,{state:'admitted'}))));`;
    const { execFile } = await import("node:child_process");
    const run = () =>
      new Promise<string>((resolve, reject) =>
        execFile(
          process.execPath,
          ["--input-type=module", "-e", script, dir, id],
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        ),
      );
    const results = await Promise.all([run(), run()]);
    expect(results.sort()).toEqual(["false", "true"]);
    expect((await new FileSigningStore(dir).read(id)).state).toBe("admitted");
  });
  it("rejects a catalog key replacement and malformed authenticated receipts", async () => {
    const other = generateKeyPairSync("ed25519");
    const worker = new CryptoSigningWorker(policy(), {
      keys: {
        catalog: async () => ({
          key: Buffer.from(other.privateKey.export({ format: "pem", type: "pkcs8" })),
          passphrase: Buffer.alloc(0),
        }),
      },
    });
    await expect(worker.catalogSign(Buffer.from("fixture"))).rejects.toThrow("policy_refused");
    const malformed = canonical({ kind: "ohtia-signing-receipt" }),
      sig = sign(
        null,
        Buffer.concat([Buffer.from("ohtia-signing-receipt-v1\0"), malformed]),
        catalogKey.privateKey,
      );
    expect(() => verifyReceipt(malformed, sig, policy())).toThrow();
  });
  it("distinguishes an unavailable authority from an invalid caller", async () => {
    const a = new OidcAuthority(policy(), {
      jwks: async () => {
        throw new SigningError("authority_unavailable");
      },
      job: async () => null,
      clock: () => NOW,
    });
    await expect(a.verify(await token(), request())).rejects.toThrow("authority_unavailable");
  });
  linuxIt("compares the exact RPM body while excluding only the signature header", async () => {
    const dir = root(),
      file = path.join(dir, "fixture.rpm"),
      lead = Buffer.alloc(96),
      sig = Buffer.alloc(16),
      main = Buffer.alloc(16);
    lead.writeUInt32BE(0xedabeedb);
    sig.writeUInt32BE(0x8eade801);
    main.writeUInt32BE(0x8eade801);
    fs.writeFileSync(
      file,
      Buffer.concat([lead, sig, main, Buffer.from("synthetic compressed payload")]),
    );
    const first = await rpmBodyIdentity(file);
    const signedHeader = Buffer.alloc(24);
    signedHeader.writeUInt32BE(0x8eade801);
    signedHeader.writeUInt32BE(8, 12);
    fs.writeFileSync(
      file,
      Buffer.concat([lead, signedHeader, main, Buffer.from("synthetic compressed payload")]),
    );
    expect(await rpmBodyIdentity(file)).toEqual(first);
    fs.appendFileSync(file, "changed");
    expect(await rpmBodyIdentity(file)).not.toEqual(first);
  });
});

describe("signer uncertainty and alias refusal", () => {
  it("does not let a new subject label reuse an already bound application version", async () => {
    const f = await fixture();
    await f.service.create(f.token, canonical(f.r));
    const alias = structuredClone(f.r);
    alias.subject.id = "another-label";
    await expect(
      f.service.create(await token(alias, { jti: "alias-token" }), canonical(alias)),
    ).rejects.toThrow("request_conflict");
  });
  it("refuses a token replay against another admitted request", async () => {
    const f = await fixture(),
      other = request("deb-bind", "another-artifact");
    await f.service.create(f.token, canonical(f.r));
    await f.service.create(await token(other, { jti: "second-token" }), canonical(other));
    await expect(
      f.service.status(f.token, hash(canonical(other)), canonical(other)),
    ).rejects.toThrow("authentication_refused");
  });
  it("reconciles an observed sealed write without producing another receipt signature", async () => {
    const f = await fixture(),
      bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    const cas = f.store.cas.bind(f.store);
    let failed = false;
    f.store.cas = async (id, prior, value) => {
      const written = await cas(id, prior, value);
      if (value.state === "sealed" && !failed) {
        failed = true;
        throw new Error("synthetic response lost after storage commit");
      }
      return written;
    };
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "signing_uncertain",
    );
    const resumed = await f.service.execute(f.token, hash(bytes), bytes);
    expect(resumed.state).toBe("sealed");
    expect(f.calls.sign).toBe(1);
  });
  it("does not release a storage-substituted result through status or create retry", async () => {
    const f = await fixture(),
      bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    await f.service.execute(f.token, hash(bytes), bytes);
    const key = f.service.identity(f.r);
    f.store.journal.get(key).result = { sha256: "0".repeat(64), bytes: 1 };
    await expect(f.service.status(f.token, hash(bytes), bytes)).rejects.toThrow(
      "signing_uncertain",
    );
    await expect(f.service.create(f.token, bytes)).rejects.toThrow("signing_uncertain");
  });
  it("records an RPM result under its final digest and refuses aliases of the unsigned input", async () => {
    const r = request("rpm-sign", "fixture-rpm"),
      f = await fixture(r),
      bytes = canonical(r);
    f.worker.rpmSign = async (input: string, dir: string, _artifact: unknown, options: any) => {
      await options.beforeSign();
      const file = path.join(dir, "signed-fixture.rpm");
      fs.writeFileSync(
        file,
        Buffer.concat([fs.readFileSync(input), Buffer.from("synthetic signature")]),
      );
      return { file, verification: { fixture_only: true } };
    };
    await f.service.create(f.token, bytes);
    const done = await f.service.execute(f.token, hash(bytes), bytes);
    expect(done.result.sha256).not.toBe(r.input.sha256);
    const alias = request("rpm-sign", "another-rpm");
    await f.service.create(await token(alias, { jti: "other-rpm" }), canonical(alias));
    f.service.build = { verify: async () => artifact(alias) };
    await expect(
      f.service.execute(
        await token(alias, { jti: "other-rpm" }),
        hash(canonical(alias)),
        canonical(alias),
      ),
    ).rejects.toThrow("signing_uncertain");
  });
  it("does not publish a result when authority is revoked during receipt signing", async () => {
    const f = await fixture(),
      bytes = canonical(f.r),
      original = f.worker.receiptSign.bind(f.worker);
    f.worker.receiptSign = async (b: Buffer, options: any) => {
      const signature = await original(b, options);
      f.service.admit = async () => false;
      return signature;
    };
    await f.service.create(f.token, bytes);
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "signing_uncertain",
    );
    expect(f.store.journal.get(f.service.identity(f.r)).state).toBe("uncertain");
  });
});

describe("bounded signer execution", () => {
  it("refuses future issue times and non-JWT token types", async () => {
    const a = await authority(),
      r = request();
    await expect(a.verify(await token(r, { iat: NOW / 1000 + 1 }), r)).rejects.toThrow(
      "authentication_refused",
    );
    const wrongType = await new SignJWT(claims(r))
      .setProtectedHeader({ alg: "RS256", typ: "other", kid: "fixture-issuer" })
      .sign(issuer.privateKey);
    await expect(a.verify(wrongType, r)).rejects.toThrow("authentication_refused");
  });
  it("does not seal a signature that completes after its operation deadline", async () => {
    const f = await fixture(),
      bytes = canonical(f.r);
    let expired = false;
    const deadline = new SigningDeadline(),
      check = deadline.check.bind(deadline);
    deadline.check = (code = "authority_unavailable") => {
      if (expired) throw new SigningError(code);
      check(code);
    };
    f.service.deadline = () => deadline;
    const original = f.worker.receiptSign.bind(f.worker);
    f.worker.receiptSign = async (b: Buffer, options: any) => {
      const signature = await original(b, options);
      expired = true;
      return signature;
    };
    await f.service.create(f.token, bytes);
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "signing_uncertain",
    );
    expect(f.store.journal.get(f.service.identity(f.r)).state).toBe("uncertain");
  });
});

describe("signer review regressions", () => {
  it("settles already-authorized bytes after caller-token expiry and retrieves them with a fresh token", async () => {
    const f = await fixture(),
      bytes = canonical(f.r),
      original = f.worker.receiptSign.bind(f.worker);
    let expired = false;
    const caller = f.service.caller;
    f.service.caller = {
      verify: async (t: string, r: any) => {
        if (expired && t === f.token) throw new SigningError("authentication_refused");
        return caller.verify(t, r);
      },
    };
    f.worker.receiptSign = async (b: Buffer, options: any) => {
      const signature = await original(b, options);
      expired = true;
      return signature;
    };
    await f.service.create(f.token, bytes);
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "authentication_refused",
    );
    expect(f.store.journal.get(f.service.identity(f.r)).state).toBe("sealed");
    await expect(f.service.status(f.token, hash(bytes), bytes)).rejects.toThrow(
      "authentication_refused",
    );
    const fresh = await token(f.r, { jti: "refreshed-after-seal" });
    expect((await f.service.status(fresh, hash(bytes), bytes)).state).toBe("sealed");
    expect(f.calls.sign).toBe(1);
  });
  it("retries a pre-signing key outage without consuming a signing marker", async () => {
    const f = await fixture(),
      bytes = canonical(f.r),
      keys = f.worker.keys.catalog;
    let unavailable = true;
    f.worker.keys.catalog = async () => {
      if (unavailable) throw new SigningError("authority_unavailable");
      return keys();
    };
    await f.service.create(f.token, bytes);
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "authority_unavailable",
    );
    expect(f.store.journal.get(f.service.identity(f.r)).state).toBe("admitted");
    expect(f.calls.sign).toBe(0);
    unavailable = false;
    expect((await f.service.execute(f.token, hash(bytes), bytes)).state).toBe("sealed");
    expect(f.calls.sign).toBe(1);
  });
  it("retains original input and raw proof through the complete service over S3", async () => {
    const client = new MockS3(),
      store = new ScalewaySigningStore({
        ingress: "fixture-ingress",
        retained: "fixture-retained",
        client,
      });
    const f = await fixture();
    f.service.store = store;
    for (const ref of [f.r.input, f.r.build_proof])
      client.objects.set(`fixture-ingress/objects/${ref.sha256}`, f.store.objects.get(ref.sha256)!);
    const bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    await f.service.execute(f.token, hash(bytes), bytes);
    for (const key of [...client.objects.keys()])
      if (key.startsWith("fixture-ingress/")) client.objects.delete(key);
    expect(await store.readBytes(f.r.input, 1000)).toEqual(
      Buffer.from("synthetic package bytes\n"),
    );
    expect(await store.readBytes(f.r.build_proof, 2097152)).toEqual(
      canonical({ fixture_only: true }),
    );
    expect((await f.service.status(f.token, hash(bytes), bytes)).state).toBe("sealed");
  });
  it("keeps missing uploads and temporarily unsealed bindings retryable before signing", async () => {
    const client = new MockS3(),
      store = new ScalewaySigningStore({
        ingress: "fixture-ingress",
        retained: "fixture-retained",
        client,
      });
    const f = await fixture();
    f.service.store = store;
    const bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "authority_unavailable",
    );
    expect((await store.read(f.service.identity(f.r))).state).toBe("admitted");
    for (const ref of [f.r.input, f.r.build_proof])
      client.objects.set(`fixture-ingress/objects/${ref.sha256}`, f.store.objects.get(ref.sha256)!);
    expect((await f.service.execute(f.token, hash(bytes), bytes)).state).toBe("sealed");
  });
  it("marks only explicit deterministic native refusals as failed", async () => {
    const f = await fixture(request("rpm-sign", "fixture-rpm")),
      bytes = canonical(f.r);
    f.worker.rpmSign = async () => {
      throw new DeterministicSigningRefusal("policy_refused");
    };
    await f.service.create(f.token, bytes);
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow("policy_refused");
    expect(f.store.journal.get(f.service.identity(f.r)).state).toBe("failed");
    expect(f.calls.sign).toBe(0);
  });
  it("refuses taking an RPM key when the total budget cannot reserve cleanup", async () => {
    const f = await fixture(request("rpm-sign", "fixture-rpm"));
    let keyReads = 0;
    f.worker.keys.rpm = async () => {
      keyReads++;
      throw new Error("must not read");
    };
    await expect(
      f.worker.rpmSign("/unused", root(), artifact(f.r), {
        deadline: new SigningDeadline(signingLimits.subprocess_ms - 1),
      }),
    ).rejects.toThrow("authority_unavailable");
    expect(keyReads).toBe(0);
  });
  it("resumes the same DEB identity after a deadline expires before its receipt signature", async () => {
    const f = await fixture(),
      bytes = canonical(f.r),
      put = f.store.putObject.bind(f.store),
      deadline = new SigningDeadline();
    let expired = false;
    const check = deadline.check.bind(deadline);
    deadline.check = (code = "authority_unavailable") => {
      if (expired) throw new SigningError(code);
      check(code);
    };
    f.service.deadline = () => deadline;
    f.store.putObject = async (...args: any[]) => {
      const value = await put(...args);
      expired = true;
      return value;
    };
    await f.service.create(f.token, bytes);
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "authority_unavailable",
    );
    expect(f.store.journal.get(f.service.identity(f.r)).state).toBe("admitted");
    expect(f.calls.sign).toBe(0);
    expired = false;
    f.store.putObject = put;
    expect((await f.service.execute(f.token, hash(bytes), bytes)).state).toBe("sealed");
    expect(f.calls.sign).toBe(1);
  });
  it("preserves an own signing marker after a committed write loses its acknowledgement", async () => {
    const f = await fixture(),
      bytes = canonical(f.r),
      cas = f.store.cas.bind(f.store);
    let lose = true;
    await f.service.create(f.token, bytes);
    f.store.cas = async (id: string, prior: any, value: any) => {
      const row = await cas(id, prior, value);
      if (lose && value.state === "signing" && row) {
        lose = false;
        throw new SigningError("authority_unavailable");
      }
      return row;
    };
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "authority_unavailable",
    );
    expect(f.store.journal.get(f.service.identity(f.r)).state).toBe("signing");
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "signing_uncertain",
    );
    expect(f.calls.sign).toBe(0);
  });
  it("refuses a substituted admitted envelope before using any signing key", async () => {
    const f = await fixture(),
      bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    f.store.journal.get(f.service.identity(f.r)).request.input.sha256 = "0".repeat(64);
    await expect(f.service.execute(f.token, hash(bytes), bytes)).rejects.toThrow(
      "signing_uncertain",
    );
    expect(f.calls.sign).toBe(0);
  });
  it("reports malformed issuer key metadata as unavailable rather than invalid caller authority", async () => {
    const r = request(),
      signed = await token(r);
    const publicJwk = { ...(await exportJWK(issuer.publicKey)), kid: "fixture-issuer" };
    for (const metadata of [
      null,
      [],
      { keys: [] },
      { keys: [null] },
      { keys: [7] },
      { keys: [{ kty: "RSA", kid: "fixture-issuer", n: "invalid", e: "invalid" }] },
      ...[
        { use: null },
        { use: "" },
        { alg: "" },
        { alg: null },
        { key_ops: [] },
        { key_ops: "verify" },
        { ext: null },
      ].map((override) => ({ keys: [{ ...publicJwk, ...override }] })),
    ]) {
      const a = new OidcAuthority(policy(), {
        clock: () => NOW,
        jwks: async () => Buffer.from(JSON.stringify(metadata)),
        job: async () => ({}),
      });
      await expect(a.verify(signed, r)).rejects.toThrow("authority_unavailable");
    }
  });
  it("accepts valid optional JOSE verification metadata", async () => {
    const r = request(),
      a = await authority(r),
      publicJwk = {
        ...(await exportJWK(issuer.publicKey)),
        kid: "fixture-issuer",
        alg: "RS256",
        use: "sig",
        key_ops: ["verify"],
        ext: false,
      };
    a.jwks = async () => Buffer.from(JSON.stringify({ keys: [publicJwk] }));
    expect((await a.verify(await token(r), r)).source_commit).toBe(r.subject.source_commit);
  });

  it("preserves a real authority transport outage as unavailable", async () => {
    const readers = githubReaders({
      fetcher: async () => {
        throw new Error("synthetic connection reset");
      },
    });
    await expect(readers.jwks()).rejects.toThrow("authority_unavailable");
  });
  linuxIt(
    "contains ordinary descendants on timeout and output overflow without signaling a reused PID",
    async () => {
      for (const overflow of [false, true]) {
        const marker = path.join(root(), "owned-process.json");
        const code = `const fs=require("node:fs"),cp=require("node:child_process"); const child=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});const v=fs.readFileSync("/proc/"+child.pid+"/stat","utf8").split(") ").at(-1).split(" ");fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:child.pid,birth:v[19]}));${overflow ? 'process.stdout.write("x".repeat(1024));' : ""}setInterval(()=>{},1000);`;
        await expect(
          command(process.execPath, ["-e", code], { timeout: 5000, maximum: 32 }),
        ).rejects.toThrow(overflow ? "size_refused" : "authority_unavailable");
        const owned = JSON.parse(fs.readFileSync(marker, "utf8"));
        const ceased = () => {
          try {
            const v = fs
              .readFileSync(`/proc/${owned.pid}/stat`, "utf8")
              .split(") ")
              .at(-1)!
              .split(" ");
            return v[19] !== owned.birth || v[0] === "Z";
          } catch (e: any) {
            if (e.code === "ENOENT") return true;
            throw e;
          }
        };
        for (let i = 0; i < 20 && !ceased(); i++)
          await new Promise((resolve) => setTimeout(resolve, 10));
        expect(ceased()).toBe(true);
      }
    },
  );
  linuxIt("keeps the server alive after a retained download stream fails", async () => {
    const f = await fixture(undefined, new FileSigningStore(root())),
      bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    await f.service.execute(f.token, hash(bytes), bytes);
    const server = await localSigningServer(f.service);
    let mock: any;
    try {
      const status = await fetch(`${server.origin}/v1/requests/${hash(bytes)}`, {
        headers: { Authorization: `Bearer ${f.token}` },
      });
      const value = await status.json();
      mock = vi.spyOn(fs, "createReadStream").mockReturnValueOnce(
        new Readable({
          read() {
            this.destroy(new Error("synthetic read failure"));
          },
        }) as any,
      );
      await fetch(value.result.url)
        .then((r) => r.arrayBuffer())
        .catch(() => undefined);
      mock.mockRestore();
      mock = undefined;
      expect(
        (
          await fetch(`${server.origin}/v1/requests/${hash(bytes)}`, {
            headers: { Authorization: `Bearer ${f.token}` },
          })
        ).status,
      ).toBe(200);
    } finally {
      mock?.mockRestore();
      await server.close();
    }
  });
  linuxIt("returns a stable conflict for uncertain HTTP state", async () => {
    const f = await fixture();
    f.service.store = new FileSigningStore(root());
    await f.service.store.putBytes(Buffer.from("synthetic package bytes\n"));
    await f.service.store.putBytes(canonical({ fixture_only: true }));
    const bytes = canonical(f.r);
    await f.service.create(f.token, bytes);
    const state = await f.service.store.read(f.service.identity(f.r));
    await f.service.store.cas(f.service.identity(f.r), state, {
      ...state,
      state: "uncertain",
      code: "signing_uncertain",
    });
    const server = await localSigningServer(f.service);
    try {
      const result = await fetch(`${server.origin}/v1/requests/${hash(bytes)}`, {
        headers: { Authorization: `Bearer ${f.token}` },
      });
      expect(result.status).toBe(409);
      expect(await result.json()).toEqual({ schema_version: 1, code: "signing_uncertain" });
      const create = await fetch(`${server.origin}/v1/requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${f.token}` },
        body: bytes,
      });
      expect(create.status).toBe(409);
    } finally {
      await server.close();
    }
  });
  linuxIt(
    "reuses retained result tickets across repeated status reads without exhausting capacity",
    async () => {
      const f = await fixture();
      f.service.store = new FileSigningStore(root());
      await f.service.store.putBytes(Buffer.from("synthetic package bytes\n"));
      await f.service.store.putBytes(canonical({ fixture_only: true }));
      const bytes = canonical(f.r);
      await f.service.create(f.token, bytes);
      await f.service.execute(f.token, hash(bytes), bytes);
      const server = await localSigningServer(f.service);
      try {
        let first: unknown;
        for (let i = 0; i < 50; i++) {
          const response = await fetch(`${server.origin}/v1/requests/${hash(bytes)}`, {
            headers: { Authorization: `Bearer ${f.token}` },
          });
          expect(response.status).toBe(200);
          const value = await response.json();
          if (!first) first = value;
          else expect(value).toEqual(first);
        }
        const response = await fetch(`${server.origin}/v1/requests`, {
          method: "POST",
          headers: { Authorization: `Bearer ${f.token}` },
          body: bytes,
        });
        expect(response.status).toBe(200);
        expect((await response.json()).uploads).toEqual([]);
      } finally {
        await server.close();
      }
    },
  );
});

describe("native RPM identity admission", () => {
  function nativeFixture(epoch: string | null, afterEpoch: string | null = null) {
    const directory = root(),
      input = path.join(directory, "input.rpm"),
      lead = Buffer.alloc(96),
      signature = Buffer.alloc(16),
      main = Buffer.alloc(16),
      p = policy();
    lead.writeUInt32BE(0xedabeedb);
    signature.writeUInt32BE(0x8eade801);
    main.writeUInt32BE(0x8eade801);
    fs.writeFileSync(
      input,
      Buffer.concat([lead, signature, main, Buffer.from("synthetic payload")]),
    );
    const stateFile = path.join(directory, "native-fixture.json");
    fs.writeFileSync(stateFile, JSON.stringify({ epoch, afterEpoch, signs: 0, cleanup: 0 }));
    // Substitute native tool I/O while exercising the actual worker and signing boundary.
    const helper = `#!${process.execPath}
const fs=require("node:fs"),path=require("node:path"),args=process.argv.slice(2),name=path.basename(process.argv[1]);
const file=path.join(process.env.HOME,"native-fixture.json"),state=JSON.parse(fs.readFileSync(file));
if(name==="gpg" && args.includes("--list-secret-keys")) {
 const row=(kind,marker)=>{const v=Array(16).fill("");v[0]=kind;v[14]=marker;return v.join(":")};
 fs.writeSync(1,[row("sec","#"),"fpr:::::::::${p.rpm_primary}:",row("ssb","+"),"fpr:::::::::${p.rpm_subkey}:","grp:::::::::${"A".repeat(40)}:"].join("\\n")+"\\n");
} else if(name==="gpg" && args.includes("--export")) fs.writeSync(1,"synthetic public key");
else if(name==="rpm" && args.includes("--queryformat")) {
 const q=args[args.indexOf("--queryformat")+1],version="0.0.0~dev.123.1";
 const values={NAME:"ohtia-quality",EPOCHNUM:state.signs && state.afterEpoch!==null?state.afterEpoch:(state.epoch??"0"),VERSION:version,RELEASE:"1",ARCH:"x86_64"};
 fs.writeSync(1,q.replace(/%\\{([A-Z]+)\\}/g,(_m,key)=>values[key]??"(none)"));
} else if(name==="rpmsign") {state.signs++;fs.writeFileSync(file,JSON.stringify(state));}
else if(name==="rpmkeys" && args.includes("--checksig")) fs.writeSync(1,"${p.rpm_primary}: OK\\n");
else if(name==="gpgconf") {state.cleanup++;fs.writeFileSync(file,JSON.stringify(state));}
else if(name==="preset" || (name==="gpg" && args.includes("--import"))) fs.readFileSync(0);
`;
    const tools: Record<string, string> = {};
    for (const name of ["gpg", "gpgconf", "preset", "rpmsign", "rpmkeys", "rpm"]) {
      tools[name] = path.join(directory, name);
      fs.writeFileSync(tools[name], helper, { mode: 0o700 });
    }
    const key = Buffer.from("synthetic key"),
      passphrase = Buffer.from("synthetic passphrase");
    const worker = new CryptoSigningWorker(p, {
      tools,
      keys: { rpm: async () => ({ key, passphrase }) },
    });
    return {
      directory,
      input,
      key,
      passphrase,
      worker,
      state: () => JSON.parse(fs.readFileSync(stateFile, "utf8")),
      artifact: { native_version: "0.0.0~dev.123.1-1", target: "linux-x64" },
    };
  }
  linuxIt("refuses nonzero normalized RPM epochs before any signing effect", async () => {
    for (const epoch of ["1", "4294967295"]) {
      const f = nativeFixture(epoch),
        before = await fileReference(f.input),
        start = vi.fn();
      await expect(
        f.worker.rpmSign(f.input, f.directory, f.artifact, { beforeSign: start }),
      ).rejects.toThrow("policy_refused");
      expect(start).not.toHaveBeenCalled();
      expect(f.state()).toMatchObject({ signs: 0, cleanup: 1 });
      expect(await fileReference(f.input)).toEqual(before);
      expect(f.key.every((v) => v === 0) && f.passphrase.every((v) => v === 0)).toBe(true);
    }
  });
  linuxIt(
    "accepts absent or zero RPM epochs without changing receipt identity fields",
    async () => {
      for (const epoch of [null, "0"]) {
        const f = nativeFixture(epoch),
          start = vi.fn();
        const result = await f.worker.rpmSign(f.input, f.directory, f.artifact, {
          beforeSign: start,
        });
        expect(start).toHaveBeenCalledTimes(1);
        expect(f.state()).toMatchObject({ signs: 1, cleanup: 1 });
        expect(result.verification).toMatchObject({
          native_version: f.artifact.native_version,
          architecture: "x86_64",
        });
      }
    },
  );
  linuxIt("rejects an epoch change after the private signing boundary", async () => {
    const f = nativeFixture("0", "1"),
      start = vi.fn();
    await expect(
      f.worker.rpmSign(f.input, f.directory, f.artifact, { beforeSign: start }),
    ).rejects.toThrow("operation_failed");
    expect(start).toHaveBeenCalledTimes(1);
    expect(f.state()).toMatchObject({ signs: 1, cleanup: 1 });
  });
});

describe("guarded native subprocess lifetime", () => {
  function identity(pid: number) {
    const row = fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").at(-1)!.split(" ");
    return { pid, birth: row[19] };
  }
  function ceased(owned: { pid: number; birth: string }) {
    try {
      const row = fs.readFileSync(`/proc/${owned.pid}/stat`, "utf8").split(") ").at(-1)!.split(" ");
      return row[19] !== owned.birth || row[0] === "Z";
    } catch (e: any) {
      if (e.code === "ENOENT") return true;
      throw e;
    }
  }
  function signalOwned(owned: { pid: number; birth: string }) {
    // A pidfd pins the exact process; birth checks are observations, never signal targets.
    execFileSync(fileURLToPath(new URL("../.tooling/python/bin/python3", import.meta.url)), [
      "-c",
      `import os,signal,json,sys
v=json.loads(sys.argv[1])
try:
 fd=os.pidfd_open(v["pid"])
except ProcessLookupError:
 sys.exit(0)
try:
 try:
  with open("/proc/"+str(v["pid"])+"/stat") as stream: row=stream.read().rsplit(") ",1)[1].split()
 except FileNotFoundError:
  sys.exit(0)
 if row[19]==v["birth"]: signal.pidfd_send_signal(fd,signal.SIGKILL)
finally:
 os.close(fd)
`,
      JSON.stringify(owned),
    ]);
  }
  const nativeScript = (
    marker: string,
  ) => `const fs=require("node:fs"),cp=require("node:child_process");
const snapshot=pid=>({pid,birth:fs.readFileSync("/proc/"+pid+"/stat","utf8").split(") ").at(-1).split(" ")[19]});
const descendant=cp.spawn(process.execPath,["-e","setTimeout(()=>{},8000)"],{stdio:"ignore"});
const supervisor=process.ppid,others=fs.readFileSync("/proc/"+supervisor+"/task/"+supervisor+"/children","utf8").trim().split(/\\s+/).map(Number).filter(pid=>pid && pid!==process.pid);
fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({native:snapshot(process.pid),descendant:snapshot(descendant.pid),supervisor:snapshot(supervisor),watchdog:others[0]?snapshot(others[0]):null}));
setTimeout(()=>{},8000);`;
  async function waitMarker(marker: string) {
    for (let i = 0; i < 150 && !fs.existsSync(marker); i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(fs.existsSync(marker)).toBe(true);
    return JSON.parse(fs.readFileSync(marker, "utf8"));
  }
  async function assertCeased(owned: { pid: number; birth: string }[]) {
    for (let i = 0; i < 80 && owned.some((v) => !ceased(v)); i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(owned.every(ceased)).toBe(true);
  }
  linuxIt("terminates native children and grandchildren when either guard is killed", async () => {
    for (const role of ["supervisor", "watchdog"]) {
      const marker = path.join(root(), "owned.json");
      const pending = command(process.execPath, ["-e", nativeScript(marker)], {
        timeout: 10000,
      }).then(
        () => null,
        (e) => e,
      );
      let owned: any;
      try {
        owned = await waitMarker(marker);
        expect(owned[role]).toBeTruthy();
        const killedAt = performance.now();
        signalOwned(owned[role]);
        // Observe cessation well before either the native lifetime or guard deadline.
        await assertCeased(
          [owned.native, owned.descendant, owned.supervisor, owned.watchdog].filter(Boolean),
        );
        expect(performance.now() - killedAt).toBeLessThan(1000);
        expect(await pending).toMatchObject({ code: "authority_unavailable" });
      } finally {
        if (owned) for (const v of Object.values(owned)) if (v) signalOwned(v as any);
        await pending;
      }
    }
  });
  linuxIt("contains the native process group after its controller dies", async () => {
    const marker = path.join(root(), "owned.json");
    const source = `import{command}from${JSON.stringify(new URL("../tooling/installation-authority.mjs", import.meta.url).href)};await command(process.execPath,["-e",${JSON.stringify(nativeScript(marker))}],{timeout:10000});`;
    const controller = spawn(process.execPath, ["--input-type=module", "-e", source], {
      stdio: "ignore",
    });
    const controllerIdentity = identity(controller.pid!);
    let owned: any;
    try {
      owned = await waitMarker(marker);
      signalOwned(controllerIdentity);
      await assertCeased([owned.native, owned.descendant, owned.supervisor, owned.watchdog]);
    } finally {
      signalOwned(controllerIdentity);
      if (owned) for (const v of Object.values(owned)) if (v) signalOwned(v as any);
    }
  });
  linuxIt("starts no native operation if the watchdog cannot arm", async () => {
    const marker = path.join(root(), "unexpected-native.json");
    const preload = "if(process.argv[2]==='watchdog')process.exit(1)";
    await expect(
      command(
        process.execPath,
        ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)},"unexpected")`],
        {
          timeout: 2000,
          env: { NODE_OPTIONS: "--import=data:text/javascript," + encodeURIComponent(preload) },
        },
      ),
    ).rejects.toThrow("authority_unavailable");
    expect(fs.existsSync(marker)).toBe(false);
  });
  linuxIt(
    "preserves binary standard input and output and refuses native spawn failure",
    async () => {
      const bytes = Buffer.from([0, 255, 10, 13, 128, 1]);
      expect(
        await command(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
          stdin: bytes,
          timeout: 3000,
        }),
      ).toEqual(bytes);
      await expect(
        command(path.join(root(), "missing-executable"), [], { timeout: 2000 }),
      ).rejects.toThrow("authority_unavailable");
    },
  );
});

describe("native helper availability classification", () => {
  linuxIt("classifies guard timeout independently of the controller timer ordering", async () => {
    const original = globalThis.setTimeout;
    const delayed = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementationOnce(((fn: any, delay: number, ...args: any[]) =>
        original(fn, delay + 1000, ...args)) as any);
    try {
      await expect(
        command(process.execPath, ["-e", "setTimeout(()=>{},2000)"], { timeout: 200 }),
      ).rejects.toThrow("authority_unavailable");
    } finally {
      delayed.mockRestore();
    }
    await expect(
      command(process.execPath, ["-e", "process.exit(1)"], { timeout: 2000 }),
    ).rejects.toThrow("operation_failed");
  });
  linuxIt("survives descriptor exhaustion without an unhandled spawn error or timer", async () => {
    const source = `import fs from "node:fs";import{command,SigningError}from${JSON.stringify(new URL("../tooling/installation-authority.mjs", import.meta.url).href)};
const fds=[];try{while(true)fds.push(fs.openSync("/dev/null","r"))}catch{};
let outcome;try{await command(process.execPath,["-e",""],{timeout:100})}catch(e){outcome={isSigningError:e instanceof SigningError,code:e.code}}finally{for(const fd of fds)fs.closeSync(fd)}
await new Promise(r=>setTimeout(r,400));console.log(JSON.stringify(outcome));`;
    const launcher =
      'import os,resource,sys;resource.setrlimit(resource.RLIMIT_NOFILE,(64,64));os.execv(sys.argv[1],[sys.argv[1],"--input-type=module","-e",sys.argv[2]])';
    const output = execFileSync(
      fileURLToPath(new URL("../.tooling/python/bin/python3", import.meta.url)),
      ["-c", launcher, process.execPath, source],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(JSON.parse(output)).toEqual({ isSigningError: true, code: "authority_unavailable" });
  });
});
