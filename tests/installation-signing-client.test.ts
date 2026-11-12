import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonical,
  hash,
  SigningDeadline,
  SigningError,
} from "../tooling/installation-authority.mjs";
import {
  ProductionSigningClient,
  signingClientConfiguration,
  signingClientEnvironmentConfiguration,
  signingResourceBindingsHash,
} from "../tooling/installation-signing-client.mjs";
import { fileReference } from "../tooling/installation-signer.mjs";
import { catalogBytes } from "../tooling/update-admission.mjs";
import {
  freshSigningToken,
  privateSigningCampaign,
  qualificationControl,
  packageRequest,
  qualificationNotes,
  signingContext,
} from "../tooling/installation-signing-worker.mjs";
const NOW = 1790000000000;
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});
const dir = () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-private-client-"));
  roots.push(p);
  return p;
};
function fixture() {
  const root = dir(),
    keys = generateKeyPairSync("ed25519");
  const policy = {
    schema_version: 1,
    enabled: true,
    repository_id: "1431132416",
    owner_id: "346940169",
    audience: "ohtia:installation-signing",
    environment: "installation-signing",
    caller_workflow: ".github/workflows/installation-signing.yml",
    signing_workflow: { workflow: ".github/workflows/signing-worker.yml", sha: "c".repeat(40) },
    build_workflow: { workflow: ".github/workflows/signing-build.yml", sha: "d".repeat(40) },

    catalog_public_key: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    rpm_primary: "1".repeat(40),
    rpm_subkey: "2".repeat(40),
    deployment: {
      provider: "scaleway-serverless-containers",
      region: "fr-par",
      container_id: "12345678-1234-1234-1234-123456789abc",
      image_digest: "sha256:" + "f".repeat(64),
    },
  };
  const inputBytes = Buffer.from("synthetic unsigned package\n"),
    proofBytes = canonical({ synthetic: true });
  const ref = (b: Buffer) => ({ sha256: hash(b), bytes: b.length });
  const request = {
    schema_version: 1,
    operation: "deb-bind",
    subject: {
      kind: "qualification",
      id: "synthetic-subject",
      repository: "ohtia/ohtia",
      application_version: "0.0.0-dev.100.1",
      source_commit: "a".repeat(40),
      source_tree: "b".repeat(40),
    },
    execution: {
      workflow: policy.caller_workflow,
      workflow_sha: "a".repeat(40),
      run_id: 100,
      attempt: 1,
      job_id: 300,
      invocation: "worker-300",
    },
    artifact_id: "fixture-deb",
    input: ref(inputBytes),
    build_proof: ref(proofBytes),
    catalog_bindings: [],
  };
  const id = hash(canonical(request));
  const receipt = {
    schema_version: 1,
    kind: "ohtia-signing-receipt",
    request_id: id,
    operation: request.operation,
    subject: request.subject,
    execution: request.execution,
    deployment: { ...policy.deployment, invocation: "11111111-1111-1111-1111-111111111111" },
    policy_sha256: hash(canonical(policy)),
    source_gate_proof_sha256: "3".repeat(64),
    build_proof_sha256: request.build_proof.sha256,
    input: request.input,
    output: request.input,
    signer: { mechanism: "none", id: null },
    verification_proof_sha256: "4".repeat(64),
    sealed_at_ms: NOW,
  };
  const rb = canonical(receipt),
    sig = sign(
      null,
      Buffer.concat([Buffer.from("ohtia-signing-receipt-v1\0"), rb]),
      keys.privateKey,
    );
  const objects = new Map([
    [hash(rb), rb],
    [hash(sig), sig],
    [hash(inputBytes), inputBytes],
    [hash(proofBytes), proofBytes],
  ]);
  const cfg = {
    origin: "https://fixture.functions.fnc.fr-par.scw.cloud",
    buckets: { ingress: "fixture-ingress", retained: "fixture-retained" },
    policy,
  };
  const ticket = (r: any, upload: boolean) => ({
    url: `https://${upload ? cfg.buckets.ingress : cfg.buckets.retained}.s3.fr-par.scw.cloud/objects/${r.sha256}?fixture=private`,
    expires_at_ms: NOW + 300000,
  });
  const decorated = (r: any) => ({ ...r, ...ticket(r, false) });
  const sealed = {
    schema_version: 1,
    request_id: id,
    state: "sealed",
    code: null,
    receipt: decorated(ref(rb)),
    receipt_signature: decorated(ref(sig)),
    result: decorated(request.input),
  };
  const calls: any[] = [];
  let tokens = 0;
  const fetcher = async (url: any, init: any = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(url);
    if (u.origin !== cfg.origin) {
      expect(init.headers?.Authorization).toBeUndefined();
      expect(init.headers?.["X-Auth-Token"]).toBeUndefined();
      const digest = u.pathname.slice("/objects/".length);
      if (init.method === "PUT") {
        const chunks: Buffer[] = [];
        for await (const x of init.body) chunks.push(Buffer.from(x));
        const b = Buffer.concat(chunks);
        expect(hash(b)).toBe(digest);
        expect(init.headers["If-None-Match"]).toBe("*");
        objects.set(digest, b);
        return new Response(null, { status: 200 });
      }
      return new Response(objects.get(digest), { status: 200 });
    }
    expect(init.headers["X-Auth-Token"]).toBe("fixture-invoker");
    expect(init.headers.Authorization).toMatch(/^Bearer fixture-token-/);
    if (u.pathname === "/v1/requests")
      return new Response(
        canonical({
          schema_version: 1,
          request_id: id,
          state: "admitted",
          uploads: [
            { role: "input", ...ticket(request.input, true) },
            { role: "build_proof", ...ticket(request.build_proof, true) },
          ],
        }),
        { status: 202 },
      );
    return new Response(canonical(sealed), { status: 200 });
  };
  const make = (override: any = {}) =>
    new ProductionSigningClient(cfg, {
      invokeToken: "fixture-invoker",
      token: async () => `fixture-token-${++tokens}`,
      fetcher,
      clock: () => NOW,
      sleep: async () => {},
      ...override,
    });
  const input = path.join(root, "input"),
    proof = path.join(root, "proof");
  fs.writeFileSync(input, inputBytes);
  fs.writeFileSync(proof, proofBytes);
  return {
    root,
    keys,
    policy,
    cfg,
    request,
    id,
    receipt,
    rb,
    sig,
    objects,
    ticket,
    sealed,
    calls,
    fetcher,
    make,
    input,
    proof,
    output: path.join(root, "sealed"),
  };
}
describe("private signing client", () => {
  it("uses two service credentials without forwarding either to exact-object transfers and verifies receipts", async () => {
    const f = fixture();
    const result = await f
      .make()
      .run(f.request, { input: f.input, proof: f.proof, output: f.output });
    expect(result.request_id).toBe(f.id);
    expect(result.reference).toEqual(f.request.input);
    expect(await fileReference(result.files.result)).toEqual(f.request.input);
    const service = f.calls.filter((x) => new URL(x.url).origin === f.cfg.origin);
    expect(service.every((x) => x.init.redirect === "error")).toBe(true);
    expect(new Set(service.map((x) => x.init.headers.Authorization)).size).toBe(service.length);
    if (process.platform !== "win32") expect(fs.statSync(f.output).mode & 0o777).toBe(0o700);
  });
  it("retrieves an already sealed identity without uploading or executing again", async () => {
    const f = fixture();
    const client = f.make({
      fetcher: async (url: any, init: any) => {
        if (new URL(url).origin === f.cfg.origin && new URL(url).pathname === "/v1/requests")
          return new Response(
            canonical({ schema_version: 1, request_id: f.id, state: "sealed", uploads: [] }),
            { status: 200 },
          );
        expect(init?.method).not.toBe("PUT");
        expect(new URL(url).pathname.endsWith("/execute")).toBe(false);
        return f.fetcher(url, init);
      },
    });
    expect(
      (await client.run(f.request, { input: f.input, proof: f.proof, output: f.output }))
        .request_id,
    ).toBe(f.id);
  });
  it("reads retained status after an ambiguous execute instead of repeating a signing effect", async () => {
    const f = fixture();
    let executions = 0,
      reads = 0;
    const client = f.make({
      fetcher: async (url: any, init: any) => {
        if (new URL(url).pathname.endsWith("/execute")) {
          executions++;
          throw new Error("synthetic connection lost");
        }
        if (new URL(url).origin === f.cfg.origin && init?.method === "GET") reads++;
        return f.fetcher(url, init);
      },
    });
    await client.run(f.request, { input: f.input, proof: f.proof, output: f.output });
    expect(executions).toBe(1);
    expect(reads).toBe(1);
  });
  it("bounds transient retries while retaining exact request bytes and fresh authentication", async () => {
    const f = fixture();
    let calls = 0;
    const bodies: Buffer[] = [];
    const client = f.make({
      fetcher: async (url: any, init: any) => {
        calls++;
        bodies.push(Buffer.from(init.body));
        return calls < 3
          ? new Response("busy", { status: 503 })
          : new Response(canonical({ synthetic: true }), { status: 200 });
      },
    });
    const bytes = canonical(f.request);
    await client.call("/v1/requests", { method: "POST", bytes, deadline: new SigningDeadline() });
    expect(calls).toBe(3);
    expect(bodies.every((b) => b.equals(bytes))).toBe(true);
    calls = 0;
    const broken = f.make({
      fetcher: async () => {
        calls++;
        throw new Error("network");
      },
    });
    await expect(
      broken.call("/v1/requests", { method: "POST", bytes, deadline: new SigningDeadline() }),
    ).rejects.toThrow("authority_unavailable");
    expect(calls).toBe(3);
  });
  it("never retries a denial conflict uncertain state or an exhausted deadline", async () => {
    for (const [status, code] of [
      [403, "policy_refused"],
      [409, "request_conflict"],
      [409, "signing_uncertain"],
      [422, "contract_refused"],
    ] as const) {
      const f = fixture();
      let calls = 0;
      const client = f.make({
        fetcher: async () => {
          calls++;
          return new Response(canonical({ schema_version: 1, code }), { status });
        },
      });
      await expect(
        client.call("/v1/requests", {
          method: "POST",
          bytes: canonical(f.request),
          deadline: new SigningDeadline(),
        }),
      ).rejects.toThrow(code);
      expect(calls).toBe(1);
    }
    const f = fixture();
    let calls = 0;
    const client = f.make({
      fetcher: async () => {
        calls++;
        throw new Error("network");
      },
    });
    const deadline = new SigningDeadline();
    deadline.end = 0;
    await expect(
      client.call("/v1/requests", { method: "POST", bytes: canonical(f.request), deadline }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it("refuses substituted origin object digest credentials path and expired capabilities before fetch", () => {
    const f = fixture(),
      client = f.make();
    const valid = f.ticket(f.request.input, true);
    for (const url of [
      "http://fixture-ingress.s3.fr-par.scw.cloud/objects/" + f.request.input.sha256,
      "https://evil.invalid/objects/" + f.request.input.sha256,
      "https://user@fixture-ingress.s3.fr-par.scw.cloud/objects/" + f.request.input.sha256,
      valid.url.replace(f.request.input.sha256, "0".repeat(64)),
      valid.url.replace("/objects/", "/else/"),
    ])
      expect(() => client.ticket({ ...valid, url }, f.request.input, true)).toThrow();
    expect(() => client.ticket({ ...valid, expires_at_ms: NOW }, f.request.input, true)).toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it("refuses malformed response identities duplicate upload roles and unbounded metadata without keeping outputs", async () => {
    for (const kind of ["id", "duplicate", "size"]) {
      const f = fixture();
      const client = f.make({
        fetcher: async () =>
          new Response(
            kind === "size"
              ? Buffer.alloc(65537)
              : canonical({
                  schema_version: 1,
                  request_id: kind === "id" ? "0".repeat(64) : f.id,
                  state: "admitted",
                  uploads: [
                    { role: "input", ...f.ticket(f.request.input, true) },
                    { role: "input", ...f.ticket(f.request.input, true) },
                  ],
                }),
            { status: 202 },
          ),
      });
      await expect(
        client.run(f.request, { input: f.input, proof: f.proof, output: f.output }),
      ).rejects.toThrow();
      expect(fs.existsSync(f.output)).toBe(false);
    }
  });
  it("refuses changed sealed bytes or a forged receipt and removes partial private output", async () => {
    for (const kind of ["bytes", "receipt"]) {
      const f = fixture();
      if (kind === "bytes") f.objects.set(f.request.input.sha256, Buffer.from("wrong bytes"));
      else f.objects.set(hash(f.sig), Buffer.alloc(64));
      await expect(
        f
          .make({
            fetcher: async (url: any, init: any) =>
              kind === "bytes" &&
              new URL(url).origin !== f.cfg.origin &&
              init?.method !== "PUT" &&
              new URL(url).pathname.endsWith(f.request.input.sha256)
                ? new Response("wrong bytes", { status: 200 })
                : f.fetcher(url, init),
          })
          .run(f.request, { input: f.input, proof: f.proof, output: f.output }),
      ).rejects.toThrow();
      expect(fs.existsSync(f.output)).toBe(false);
    }
  });
  it("does not treat a create-only upload collision as authority to change the request identity", async () => {
    const f = fixture();
    const client = f.make({
      fetcher: async (url: any, init: any) =>
        init?.method === "PUT" ? new Response(null, { status: 412 }) : f.fetcher(url, init),
    });
    const result = await client.run(f.request, {
      input: f.input,
      proof: f.proof,
      output: f.output,
    });
    expect(result.request_id).toBe(f.id);
    const executed = f.calls.find((x) => x.url.endsWith("/execute"));
    expect(JSON.parse(executed.init.body).request_id).toBe(f.id);
  });
  it("loads resource locators from repository variables without accepting a tracked fallback or a policy override", () => {
    const f = fixture();
    const { schema_version, enabled, signing_workflow, ...policy } = f.policy;
    const template = {
      schema_version,
      enabled,
      service_origin: null,
      buckets: null,
      policy,
      resource_bindings_sha256: signingResourceBindingsHash({
        service_origin: f.cfg.origin,
        buckets: f.cfg.buckets,
      }),
    };
    const environment = {
      SCW_SIGNING_SERVICE_ORIGIN: f.cfg.origin,
      SCW_SIGNING_INGRESS_BUCKET: f.cfg.buckets.ingress,
      SCW_SIGNING_RETAINED_BUCKET: f.cfg.buckets.retained,
      SCW_SIGNING_SOURCE_ANCHOR: "9".repeat(40),
    };
    const loaded = signingClientEnvironmentConfiguration(
      template,
      signing_workflow.sha,
      environment,
    );
    expect(loaded.origin).toBe(f.cfg.origin);
    expect(loaded.buckets).toEqual(f.cfg.buckets);
    expect(loaded.policy).not.toHaveProperty("source_anchor");
    expect(loaded.policy).not.toHaveProperty("source_signers");
    for (const changed of [
      { ...environment, SCW_SIGNING_SERVICE_ORIGIN: "https://other-tenant.fnc.fr-par.scw.cloud" },
      { ...environment, SCW_SIGNING_INGRESS_BUCKET: "another-valid-bucket" },
      { ...environment, SCW_SIGNING_INGRESS_BUCKET: "1invalid-bucket" },
      {
        ...environment,
        SCW_SIGNING_SERVICE_ORIGIN: "https://" + "a".repeat(500) + ".fnc.fr-par.scw.cloud",
      },
    ])
      expect(() =>
        signingClientEnvironmentConfiguration(template, signing_workflow.sha, changed),
      ).toThrow();
    for (const commitment of [null, "0".repeat(64), undefined])
      expect(() =>
        signingClientEnvironmentConfiguration(
          { ...template, resource_bindings_sha256: commitment },
          signing_workflow.sha,
          environment,
        ),
      ).toThrow();
    expect(() =>
      signingClientEnvironmentConfiguration(template, signing_workflow.sha, {}),
    ).toThrow();
    expect(() =>
      signingClientEnvironmentConfiguration(
        { ...template, service_origin: f.cfg.origin },
        signing_workflow.sha,
        environment,
      ),
    ).toThrow();
    expect(() =>
      signingClientEnvironmentConfiguration(
        { ...template, enabled: false },
        signing_workflow.sha,
        environment,
      ),
    ).toThrow();
    expect(() =>
      signingClientEnvironmentConfiguration(template, signing_workflow.sha, {
        ...environment,
        SCW_SIGNING_RETAINED_BUCKET: environment.SCW_SIGNING_INGRESS_BUCKET,
      }),
    ).toThrow();
  });
  it("keeps disabled or incomplete immutable configuration ineligible for invocation", () => {
    const f = fixture();
    const { schema_version, enabled, signing_workflow, ...template } = f.policy;
    const valid = {
      schema_version: 1,
      enabled: true,
      service_origin: f.cfg.origin,
      buckets: f.cfg.buckets,
      policy: template,
    };
    expect(signingClientConfiguration(valid, "c".repeat(40)).policy).toEqual(f.policy);
    for (const value of [
      { schema_version: 1, enabled: false, service_origin: null, buckets: null, policy: null },
      { ...valid, service_origin: "https://evil.invalid" },
      { ...valid, policy: { ...template, signing_workflow } },
      { ...valid, buckets: { ingress: "same", retained: "same" } },
    ])
      expect(() => signingClientConfiguration(value, "c".repeat(40))).toThrow();
  });
});

describe("retained signing recovery", () => {
  it("recovers a sealed result with fresh authentication after execute authorization expires", async () => {
    const f = fixture();
    let executes = 0,
      reads = 0;
    const client = f.make({
      fetcher: async (url: any, init: any) => {
        if (new URL(url).pathname.endsWith("/execute")) {
          executes++;
          return new Response(canonical({ schema_version: 1, code: "authentication_refused" }), {
            status: 403,
          });
        }
        if (new URL(url).origin === f.cfg.origin && init?.method === "GET") reads++;
        return f.fetcher(url, init);
      },
    });
    await client.run(f.request, { input: f.input, proof: f.proof, output: f.output });
    expect(executes).toBe(1);
    expect(reads).toBe(1);
  });
  it("does not retry a denied effect even when a subsequent read remains admitted", async () => {
    const f = fixture();
    let executes = 0;
    const client = f.make({
      fetcher: async (url: any, init: any) => {
        if (new URL(url).pathname.endsWith("/execute")) {
          executes++;
          return new Response(canonical({ schema_version: 1, code: "authentication_refused" }), {
            status: 403,
          });
        }
        if (new URL(url).origin === f.cfg.origin && init?.method === "GET")
          return new Response(
            canonical({
              ...f.sealed,
              state: "admitted",
              receipt: null,
              receipt_signature: null,
              result: null,
            }),
            { status: 202 },
          );
        return f.fetcher(url, init);
      },
    });
    await expect(
      client.run(f.request, { input: f.input, proof: f.proof, output: f.output }),
    ).rejects.toThrow("authentication_refused");
    expect(executes).toBe(1);
  });
  it("polls an existing signing effect without uploading or executing and refuses state regression", async () => {
    for (const state of ["sealed", "admitted"]) {
      const f = fixture();
      let reads = 0;
      const client = f.make({
        fetcher: async (url: any, init: any) => {
          expect(init?.method).not.toBe("PUT");
          expect(new URL(url).pathname.endsWith("/execute")).toBe(false);
          if (new URL(url).origin === f.cfg.origin) {
            if (init?.method === "POST")
              return new Response(
                canonical({
                  schema_version: 1,
                  request_id: f.id,
                  state: "signing",
                  uploads: [
                    { role: "input", ...f.ticket(f.request.input, true) },
                    { role: "build_proof", ...f.ticket(f.request.build_proof, true) },
                  ],
                }),
                { status: 202 },
              );
            reads++;
            return new Response(canonical({ ...f.sealed, state }), { status: 200 });
          }
          return f.fetcher(url, init);
        },
      });
      const result = client.run(f.request, { input: f.input, proof: f.proof, output: f.output });
      if (state === "sealed") await result;
      else await expect(result).rejects.toThrow("signing_uncertain");
      expect(reads).toBe(1);
    }
  });
  it("refuses a status regression after execute acknowledges that signing started", async () => {
    const f = fixture();
    let executes = 0;
    const client = f.make({
      fetcher: async (url: any, init: any) => {
        if (new URL(url).pathname.endsWith("/execute")) {
          executes++;
          return new Response(
            canonical({
              ...f.sealed,
              state: "signing",
              receipt: null,
              receipt_signature: null,
              result: null,
            }),
            { status: 202 },
          );
        }
        if (new URL(url).origin === f.cfg.origin && init?.method === "GET")
          return new Response(
            canonical({
              ...f.sealed,
              state: "admitted",
              receipt: null,
              receipt_signature: null,
              result: null,
            }),
            { status: 202 },
          );
        return f.fetcher(url, init);
      },
    });
    await expect(
      client.run(f.request, { input: f.input, proof: f.proof, output: f.output }),
    ).rejects.toThrow("signing_uncertain");
    expect(executes).toBe(1);
  });
  it("rejects a cryptographically forged receipt even when transfer digests match", async () => {
    const f = fixture(),
      forged = Buffer.alloc(64);
    const ref = { sha256: hash(forged), bytes: 64 };
    f.objects.set(ref.sha256, forged);
    f.sealed.receipt_signature = { ...ref, ...f.ticket(ref, false) };
    await expect(
      f.make().run(f.request, { input: f.input, proof: f.proof, output: f.output }),
    ).rejects.toThrow();
    expect(fs.existsSync(f.output)).toBe(false);
  });
  it("rechecks capability expiry before a transfer retry", async () => {
    const f = fixture();
    let now = NOW,
      calls = 0;
    const client = f.make({
      clock: () => now,
      sleep: async () => {
        now += 300001;
      },
      fetcher: async () => {
        calls++;
        return new Response(null, { status: 503 });
      },
    });
    await expect(
      client.upload(
        f.ticket(f.request.input, true),
        f.input,
        f.request.input,
        new SigningDeadline(),
      ),
    ).rejects.toThrow("policy_refused");
    expect(calls).toBe(1);
  });
});
function workerFixture(target = "linux-x64", profile = "debian-13") {
  const f = fixture();
  const { schema_version, enabled, signing_workflow, ...template } = f.policy;
  const configuration = {
    schema_version: 1,
    enabled: true,
    service_origin: f.cfg.origin,
    buckets: f.cfg.buckets,
    policy: template,
  };
  const context = {
    run: 100,
    attempt: 1,
    job: 300,
    source: "a".repeat(40),
    main: "a".repeat(40),
    worker: "c".repeat(40),
    selection: `${target}-${profile}`,
  };
  const run = {
    id: 100,
    run_attempt: 1,
    head_sha: context.source,
    head_branch: "main",
    event: "workflow_dispatch",
    path: f.policy.caller_workflow,
    created_at: new Date(NOW).toISOString().replace(".000Z", "Z"),
  };
  const closure = {
    inputs: { source_sha: context.source },
    contracts: {
      versions: ["0.0.0-dev.100.1", "0.0.0-dev.100.2"],
      target_schema: 5,
      migration_manifest_sha256: "f".repeat(64),
    },
  };
  const format = profile === "fedora-44" ? "rpm" : "deb";
  const manifest = {
    id: `ohtia-${target}-${profile.replaceAll(".", "-")}-${format}`,
    target,
    profile,
    format,
    native_version: "0.0.0~dev.100.1-1",
    source_commit: context.source,
    source_tree: "b".repeat(40),
    inputs_sha256: hash(canonical(closure)),
    ...f.request.input,
    build_execution: {
      workflow: f.policy.build_workflow.workflow,
      workflow_sha: f.policy.build_workflow.sha,
      run_id: 100,
      attempt: 1,
      job_id: 200,
      invocation: "attestor-200",
    },
  };
  const proofDirectory = path.join(f.root, "proof-data");
  fs.mkdirSync(proofDirectory);
  fs.copyFileSync(f.input, path.join(proofDirectory, `package.${format}`));
  const write = () => {
    for (const [name, value] of Object.entries({
      "manifest.json": manifest,
      "closure.json": closure,
      "build-proof.json": {
        schema_version: 1,
        artifact: manifest,
        bundle: "synthetic proof; not a hosted attestation",
      },
    }))
      fs.writeFileSync(path.join(proofDirectory, name), canonical(value));
  };
  write();
  return {
    ...f,
    configuration,
    context,
    run,
    closure,
    manifest,
    proofDirectory,
    write,
    outputDirectory: path.join(f.root, "campaign"),
  };
}
function workerEnvironment() {
  return {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: "ohtia/ohtia",
    GITHUB_REPOSITORY_ID: "1431132416",
    GITHUB_REPOSITORY_OWNER_ID: "346940169",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_SHA: "a".repeat(40),
    SOURCE_COMMIT: "a".repeat(40),
    SIGNING_RECIPE_SHA: "c".repeat(40),
    SIGNING_RECIPE_REF: `ohtia/ohtia/.github/workflows/signing-worker.yml@${"c".repeat(40)}`,
    GITHUB_RUN_ID: "100",
    GITHUB_RUN_ATTEMPT: "1",
    SIGNING_JOB_ID: "300",
    SIGNING_SELECTION: "linux-x64-debian-13",
    ACTIONS_ID_TOKEN_REQUEST_URL:
      "https://fixture.actions.githubusercontent.com/token?api-version=2",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-issuer-request-token",
  };
}
describe("fixed private signing worker", () => {
  it("derives immutable qualification metadata from the authenticated run and captured source contracts", () => {
    const f = workerFixture();
    const first = qualificationControl(f.run, f.context, f.closure, NOW),
      later = qualificationControl(f.run, f.context, f.closure, NOW + 6 * 86400000);
    expect(first).toEqual(later);
    expect(first.sequence).toBe(1);
    expect(first.expires_ms - first.issued_ms).toBe(7 * 86400000);
    expect(first.notes_sha256).toBe(hash(Buffer.from(qualificationNotes)));
    for (const run of [
      { ...f.run, id: 101 },
      { ...f.run, run_attempt: 2 },
      { ...f.run, head_sha: "0".repeat(40) },
      { ...f.run, path: ".github/workflows/other.yml" },
    ])
      expect(() => qualificationControl(run, f.context, f.closure, NOW)).toThrow();
    expect(() => qualificationControl(f.run, f.context, f.closure, NOW + 7 * 86400000)).toThrow();
    expect(() =>
      qualificationControl(
        f.run,
        f.context,
        { ...f.closure, contracts: { ...f.closure.contracts, versions: ["1.0.0", "2.0.0"] } },
        NOW,
      ),
    ).toThrow();
  });
  it("keeps historical package source separate from the main workflow and run", () => {
    const env = workerEnvironment();
    env.SOURCE_COMMIT = "f".repeat(40);
    const context = signingContext(env);
    expect(context.source).toBe("f".repeat(40));
    expect(context.main).toBe(env.GITHUB_SHA);
    const f = workerFixture();
    f.context.source = context.source;
    f.manifest.source_commit = context.source;
    f.closure.inputs.source_sha = context.source;
    const request = packageRequest(f.manifest, { sha256: "d".repeat(64), bytes: 100 }, f.context);
    expect(request.subject.source_commit).toBe(context.source);
    expect(request.execution.workflow_sha).toBe(context.main);
    expect(qualificationControl(f.run, f.context, f.closure, NOW).version).toBe("0.0.0-dev.100.1");
  });
  it("checks the actual job workflow identity and fresh directly issued OIDC claims", async () => {
    const f = workerFixture(),
      env = workerEnvironment();
    env.SOURCE_COMMIT = "f".repeat(40);
    const context = signingContext(env);
    expect(context.source).not.toBe(context.main);
    const claims = {
      iss: "https://token.actions.githubusercontent.com",
      aud: f.policy.audience,
      repository_id: f.policy.repository_id,
      repository_owner_id: f.policy.owner_id,
      sha: context.main,
      ref: "refs/heads/main",
      event_name: "workflow_dispatch",
      runner_environment: "github-hosted",
      environment: f.policy.environment,
      run_id: "100",
      run_attempt: "1",
      check_run_id: "300",
      workflow_sha: context.main,
      workflow_ref: `ohtia/ohtia/${f.policy.caller_workflow}@refs/heads/main`,
      job_workflow_ref: env.SIGNING_RECIPE_REF,
      job_workflow_sha: context.worker,
    };
    const fetcher = async (url: any, init: any) => {
      expect(new URL(url).searchParams.get("audience")).toBe(f.policy.audience);
      expect(init.headers).toEqual({ Authorization: "Bearer synthetic-issuer-request-token" });
      expect(init.redirect).toBe("error");
      return new Response(
        JSON.stringify({
          value: `synthetic.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic`,
        }),
      );
    };
    expect(await freshSigningToken(env, f.policy, context, { fetcher })).toMatch(/^synthetic/);
    for (const key of [
      "sha",
      "workflow_sha",
      "check_run_id",
      "run_attempt",
      "job_workflow_sha",
      "environment",
      "aud",
    ]) {
      const old = (claims as any)[key];
      (claims as any)[key] = "wrong";
      await expect(freshSigningToken(env, f.policy, context, { fetcher })).rejects.toThrow(
        "authentication_refused",
      );
      (claims as any)[key] = old;
    }
    await expect(
      freshSigningToken(
        { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: "https://evil.invalid" },
        f.policy,
        context,
        {
          fetcher: async () => {
            throw new Error("must not fetch");
          },
        },
      ),
    ).rejects.toThrow("authentication_refused");
    expect(() =>
      signingContext({
        ...env,
        SIGNING_RECIPE_REF: env.SIGNING_RECIPE_REF.replace(context.worker, context.source),
      }),
    ).toThrow();
    expect(() => signingContext({ ...env, GITHUB_REF: "refs/pull/1/merge" })).toThrow();
  });
  it("binds each of the six Linux selections to verified package output and then a signed private catalog", async () => {
    for (const target of ["linux-x64", "linux-arm64"])
      for (const profile of ["ubuntu-26.04", "debian-13", "fedora-44"]) {
        const f = workerFixture(target, profile),
          requests: any[] = [];
        let verified = false;
        const changed = Buffer.from("synthetic signed RPM bytes");
        const outputRef =
          profile === "fedora-44"
            ? { sha256: hash(changed), bytes: changed.length }
            : f.request.input;
        const result = await privateSigningCampaign(f, {
          clock: () => NOW,
          authorityFactory: () => ({
            verify: async (input: any, proof: any, request: any) => {
              expect(await fileReference(input)).toEqual(request.input);
              expect(proof.artifact).toEqual(f.manifest);
              verified = true;
            },
          }),
          clientFactory: () => ({
            run: async (request: any, files: any) => {
              expect(verified).toBe(true);
              requests.push(request);
              if (request.operation !== "catalog-sign")
                return { request_id: "7".repeat(64), reference: outputRef, files: {} };
              const catalog = JSON.parse(fs.readFileSync(files.input, "utf8"));
              expect(catalog.packages[0]).toMatchObject({
                ...outputRef,
                target,
                profile,
                format: f.manifest.format,
              });
              expect(request.catalog_bindings[0]).toMatchObject(outputRef);
              expect(catalog.channels).toEqual(["preview"]);
              fs.mkdirSync(files.output);
              const signature = path.join(files.output, "result");
              fs.writeFileSync(
                signature,
                sign(null, fs.readFileSync(files.input), f.keys.privateKey),
              );
              return { files: { result: signature } };
            },
          }),
        });
        expect(requests.map((r) => r.operation)).toEqual([
          profile === "fedora-44" ? "rpm-sign" : "deb-bind",
          "catalog-sign",
        ]);
        expect(result.control.sequence).toBe(1);
      }
  });
  it("refuses substituted profile native version source attempt and unverified provenance before signing", async () => {
    for (const mutation of ["selection", "native", "source", "attempt", "authority"]) {
      const f = workerFixture();
      if (mutation === "selection") f.context.selection = "linux-x64-fedora-44";
      if (mutation === "native") f.manifest.native_version = "9.0.0-1";
      if (mutation === "source") f.manifest.source_commit = "f".repeat(40);
      if (mutation === "attempt") f.manifest.build_execution.attempt = 2;
      f.write();
      let calls = 0;
      await expect(
        privateSigningCampaign(f, {
          clock: () => NOW,
          authorityFactory: () => ({
            verify: async () => {
              throw new SigningError("policy_refused");
            },
          }),
          clientFactory: () => {
            calls++;
            throw new Error("must not sign");
          },
        }),
      ).rejects.toThrow();
      expect(calls).toBe(0);
      expect(fs.existsSync(f.outputDirectory)).toBe(false);
    }
  });
  it("removes private results when catalog signature verification fails", async () => {
    const f = workerFixture();
    let calls = 0;
    await expect(
      privateSigningCampaign(f, {
        clock: () => NOW,
        authorityFactory: () => ({ verify: async () => {} }),
        clientFactory: () => ({
          run: async (request: any, files: any) => {
            calls++;
            if (request.operation !== "catalog-sign")
              return { request_id: "7".repeat(64), reference: request.input, files: {} };
            fs.mkdirSync(files.output);
            const file = path.join(files.output, "result");
            fs.writeFileSync(file, Buffer.alloc(64));
            return { files: { result: file } };
          },
        }),
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
    expect(fs.existsSync(f.outputDirectory)).toBe(false);
  });
  it("imports the credentialed worker with builtins only and refuses disabled configuration without leaking environment values", () => {
    const isolated = dir(),
      repository = fileURLToPath(new URL("../", import.meta.url));
    fs.cpSync(path.join(repository, "tooling"), path.join(isolated, "tooling"), {
      recursive: true,
    });
    fs.cpSync(path.join(repository, "config"), path.join(isolated, "config"), { recursive: true });
    const imported = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(pathToFileURL(path.join(isolated, "tooling/installation-signing-worker.mjs")).href)})`,
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
    expect(imported.status, imported.stderr).toBe(0);
    const invoked = spawnSync(
      process.execPath,
      [path.join(isolated, "tooling/installation-signing-worker.mjs")],
      {
        encoding: "utf8",
        env: {
          ...workerEnvironment(),
          OHTIA_SIGNING_STAGE: isolated,
          OHTIA_SIGNING_INVOKE_TOKEN: "synthetic-private-value",
        },
      },
    );
    expect(invoked.status).toBe(1);
    expect(invoked.stdout).toBe("");
    expect(invoked.stderr).toBe("Private signing qualification refused.\n");
  });
});

function interruptedBody() {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(Buffer.from("synthetic partial bytes"));
      } else controller.error(new TypeError("synthetic confidential transport detail"));
    },
  });
}
describe("response body transport recovery", () => {
  it("retrieves the same sealed identity when execute fails after response headers", async () => {
    const f = fixture();
    let executes = 0,
      reads = 0;
    const client = f.make({
      fetcher: async (url: any, init: any) => {
        if (new URL(url).pathname.endsWith("/execute")) {
          executes++;
          return new Response(interruptedBody(), { status: 200 });
        }
        if (new URL(url).origin === f.cfg.origin && init?.method === "GET") reads++;
        return f.fetcher(url, init);
      },
    });
    const result = await client.run(f.request, {
      input: f.input,
      proof: f.proof,
      output: f.output,
    });
    expect(result.request_id).toBe(f.id);
    expect(executes).toBe(1);
    expect(reads).toBe(1);
  });
  it("refuses regressed admitted status after successful execute headers and a lost body", async () => {
    const f = fixture();
    let executes = 0,
      reads = 0;
    const client = f.make({
      fetcher: async (url: any, init: any) => {
        if (new URL(url).pathname.endsWith("/execute")) {
          executes++;
          return new Response(interruptedBody(), { status: 200 });
        }
        if (new URL(url).origin === f.cfg.origin && init?.method === "GET") {
          reads++;
          return new Response(
            canonical({
              ...f.sealed,
              state: "admitted",
              receipt: null,
              receipt_signature: null,
              result: null,
            }),
            { status: 202 },
          );
        }
        return f.fetcher(url, init);
      },
    });
    await expect(
      client.run(f.request, { input: f.input, proof: f.proof, output: f.output }),
    ).rejects.toThrow("signing_uncertain");
    expect(executes).toBe(1);
    expect(reads).toBe(1);
  });
  it("bounds replayable response-body retries and does not expose raw stream errors", async () => {
    const f = fixture();
    let calls = 0;
    const client = f.make({
      fetcher: async () => {
        calls++;
        return new Response(interruptedBody(), { status: 200 });
      },
    });
    await expect(
      client.call("/v1/requests", {
        method: "POST",
        bytes: canonical(f.request),
        deadline: new SigningDeadline(),
      }),
    ).rejects.toThrow("authority_unavailable");
    expect(calls).toBe(3);
  });
  it("does not retry a known denial when its response body also fails", async () => {
    const f = fixture();
    let calls = 0;
    const client = f.make({
      fetcher: async () => {
        calls++;
        return new Response(interruptedBody(), { status: 403 });
      },
    });
    await expect(
      client.call("/v1/requests", {
        method: "POST",
        bytes: canonical(f.request),
        deadline: new SigningDeadline(),
      }),
    ).rejects.toThrow("policy_refused");
    expect(calls).toBe(1);
  });
  it("removes a partial download before a bounded retry and still checks the complete digest", async () => {
    const f = fixture();
    let reads = 0;
    const client = f.make({
      fetcher: async (url: any, init: any) => {
        if (
          new URL(url).origin !== f.cfg.origin &&
          new URL(url).pathname.endsWith(f.request.input.sha256) &&
          init?.method !== "PUT"
        ) {
          reads++;
          if (reads === 1) return new Response(interruptedBody(), { status: 200 });
        }
        return f.fetcher(url, init);
      },
    });
    const result = await client.run(f.request, {
      input: f.input,
      proof: f.proof,
      output: f.output,
    });
    expect(reads).toBe(2);
    expect(await fileReference(result.files.result)).toEqual(f.request.input);
  });
  it("does not retry complete but truncated or digest-invalid object contents", async () => {
    for (const kind of ["truncated", "digest"]) {
      const f = fixture();
      let calls = 0;
      const bytes =
        kind === "truncated" ? Buffer.from("short") : Buffer.alloc(f.request.input.bytes);
      const client = f.make({
        fetcher: async () => {
          calls++;
          return new Response(bytes, { status: 200 });
        },
      });
      await expect(
        client.download(
          f.ticket(f.request.input, false),
          f.request.input,
          path.join(f.root, "download"),
          new SigningDeadline(),
        ),
      ).rejects.toThrow();
      expect(calls).toBe(1);
    }
  });
});
describe("source closure encoding", () => {
  it("preserves the producer's Unicode source-path keys and exact closure digest", async () => {
    const f = workerFixture();
    const closure = {
      ...f.closure,
      inputs: {
        ...f.closure.inputs,
        files: { "source é/file.ts": "1".repeat(64), "研究/文件.ts": "2".repeat(64) },
      },
    };
    const raw = catalogBytes(closure);
    f.manifest.inputs_sha256 = hash(raw);
    f.write();
    fs.writeFileSync(path.join(f.proofDirectory, "closure.json"), raw);
    let verified = false;
    await expect(
      privateSigningCampaign(f, {
        clock: () => NOW,
        authorityFactory: () => ({
          verify: async () => {
            verified = true;
            throw new SigningError("operation_failed");
          },
        }),
        clientFactory: () => {
          throw new Error("must not reach signing");
        },
      }),
    ).rejects.toThrow("operation_failed");
    expect(verified).toBe(true);
  });
  it("refuses noncanonical or duplicate source closure fields before authority and signing", async () => {
    for (const duplicate of [false, true]) {
      const f = workerFixture();
      const canonicalClosure = catalogBytes(f.closure);
      const raw = duplicate
        ? Buffer.from(
            '{"contracts":' +
              JSON.stringify(f.closure.contracts) +
              "," +
              canonicalClosure.toString("utf8").slice(1),
          )
        : Buffer.from(JSON.stringify(f.closure, null, 2) + "\n");
      f.manifest.inputs_sha256 = hash(canonicalClosure);
      f.write();
      fs.writeFileSync(path.join(f.proofDirectory, "closure.json"), raw);
      let verified = false;
      await expect(
        privateSigningCampaign(f, {
          clock: () => NOW,
          authorityFactory: () => ({
            verify: async () => {
              verified = true;
            },
          }),
          clientFactory: () => {
            throw new Error("must not sign");
          },
        }),
      ).rejects.toThrow("contract_refused");
      expect(verified).toBe(false);
    }
  });
});

describe("authenticated transfer clock", () => {
  function skewedFetch(f: ReturnType<typeof fixture>, duration: number) {
    const serverNow = NOW + 120000;
    return async (url: any, init: any) => {
      const response = await f.fetcher(url, init);
      if (new URL(url).origin !== f.cfg.origin) return response;
      const value = JSON.parse(await response.text());
      const renew = (item: any) => {
        if (item && typeof item === "object") {
          if ("expires_at_ms" in item) item.expires_at_ms = serverNow + duration;
          for (const child of Object.values(item)) renew(child);
        }
      };
      renew(value);
      return new Response(canonical(value), {
        status: response.status,
        headers: { Date: new Date(serverNow).toUTCString() },
      });
    };
  }
  it("uses the authenticated service clock and monotonic elapsed time when the runner clock is behind", async () => {
    const f = fixture();
    const result = await f
      .make({ fetcher: skewedFetch(f, 300000) })
      .run(f.request, { input: f.input, proof: f.proof, output: f.output });
    expect(result.request_id).toBe(f.id);
  });
  it("still refuses expired or overlong capabilities relative to the service clock", async () => {
    for (const duration of [-1, 600000]) {
      const f = fixture();
      await expect(
        f
          .make({ fetcher: skewedFetch(f, duration) })
          .run(f.request, { input: f.input, proof: f.proof, output: f.output }),
      ).rejects.toThrow("policy_refused");
      expect(f.calls.some((x) => x.init?.method === "PUT")).toBe(false);
    }
  });
});
describe("signing runtime dependency availability", () => {
  it("classifies an unavailable lazy JOSE module as unavailable authority without an authentication denial", () => {
    const f = fixture(),
      isolated = dir(),
      repository = fileURLToPath(new URL("../", import.meta.url));
    fs.cpSync(path.join(repository, "tooling"), path.join(isolated, "tooling"), {
      recursive: true,
    });
    fs.cpSync(path.join(repository, "config"), path.join(isolated, "config"), { recursive: true });
    const issuer = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const data = {
      policy: f.policy,
      request: f.request,
      jwks: {
        keys: [{ ...issuer.publicKey.export({ format: "jwk" }), kid: "synthetic", alg: "RS256" }],
      },
    };
    const file = path.join(isolated, "input.json");
    fs.writeFileSync(file, JSON.stringify(data));
    const code = `import fs from 'node:fs';const {OidcAuthority}=await import(${JSON.stringify(pathToFileURL(path.join(isolated, "tooling/installation-authority.mjs")).href)});const f=JSON.parse(fs.readFileSync(${JSON.stringify(file)}));const authority=new OidcAuthority(f.policy,{jwks:async()=>Buffer.from(JSON.stringify(f.jwks)),job:async()=>{throw new Error('must not query job');}});try{await authority.verify('synthetic-token',f.request);console.log('unexpected');}catch(error){console.log(error.code);}`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("authority_unavailable\n");
  });
});
