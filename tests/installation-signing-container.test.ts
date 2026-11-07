import { signingConfiguration as configuration } from "./fixtures/signing-configuration";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeDependencyNotices } from "../tooling/installation-signing-image.mjs";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonical, currentSigningDeadline, hash } from "../tooling/installation-authority.mjs";
import {
  productionSigningServer,
  composeSigningContainer,
} from "../tooling/installation-signing-container.mjs";
import { ScalewaySigningStore } from "../tooling/installation-signing-scaleway.mjs";
import { MockS3 } from "./fixtures/signing-store";

const roots: string[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  for (const close of closers.splice(0)) await close();
});
const ref = (value: string) => ({
  sha256: hash(Buffer.from(value)),
  bytes: Buffer.byteLength(value),
});
function request() {
  return {
    schema_version: 1,
    operation: "deb-bind",
    artifact_id: "fixture-deb",
    subject: {
      kind: "qualification",
      id: "fixture",
      repository: "ohtia/ohtia",
      application_version: "0.0.0-dev.100.1",
      source_commit: "a".repeat(40),
      source_tree: "b".repeat(40),
    },
    execution: {
      workflow: ".github/workflows/installation-signing.yml",
      workflow_sha: "a".repeat(40),
      run_id: 100,
      attempt: 1,
      job_id: 200,
      invocation: "fixture",
    },
    input: ref("input"),
    build_proof: ref("proof"),
    catalog_bindings: [],
  };
}
function fixture() {
  const bytes = canonical(request()),
    id = hash(bytes);
  const state = {
    schema_version: 1,
    request_id: id,
    state: "admitted",
    code: null,
    result: null,
    receipt: null,
    receipt_signature: null,
  };
  return {
    checkAuthority: vi.fn(async () => {}),
    authorize: vi.fn(async () => {}),
    create: vi.fn(async () => state),
    status: vi.fn(async () => state),
    execute: vi.fn(async () => state),
    store: {
      readRequest: vi.fn(async () => bytes),
      uploadTicket: vi.fn(async (r) => ({
        url: "https://fixture-ingress.s3.fr-par.scw.cloud/objects/" + r.sha256,
        expires_at_ms: 12345,
      })),
      downloadTicket: vi.fn(async (r) => ({
        url: "https://fixture-retained.s3.fr-par.scw.cloud/objects/" + r.sha256,
        expires_at_ms: 12345,
      })),
    },
  };
}
async function listen(service = fixture(), bodyTimeout?: number) {
  const server = productionSigningServer(service, { bodyTimeout });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port.");
  const origin = "http://127.0.0.1:" + address.port;
  return {
    service,
    origin,
    call: (route: string, init: RequestInit = {}) =>
      fetch(origin + route, {
        ...init,
        headers: { Authorization: "Bearer fixture", ...init.headers },
      }),
  };
}

describe("signing container transport", () => {
  it("returns exact provider upload capabilities without filesystem store access", async () => {
    const { call, service } = await listen();
    const response = await call("/v1/requests", { method: "POST", body: canonical(request()) });
    const result = await response.json();
    expect(response.status).toBe(202);
    expect(Object.keys(result).sort()).toEqual([
      "request_id",
      "schema_version",
      "state",
      "uploads",
    ]);
    expect(result.uploads.map((u: { role: string }) => u.role)).toEqual(["input", "build_proof"]);
    expect(service.authorize).toHaveBeenCalledWith("fixture", request());
    expect(service.store.readRequest).not.toHaveBeenCalled();
  });
  it("loads a retained request by digest and decorates sealed result references", async () => {
    const service = fixture(),
      r = ref("sealed");
    service.status.mockResolvedValue({ ...(await service.status()), state: "sealed", result: r });
    const { call } = await listen(service);
    const response = await call("/v1/requests/" + hash(canonical(request())));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.result).toEqual({
      ...r,
      url: expect.stringContaining(r.sha256),
      expires_at_ms: 12345,
    });
    expect(service.store.readRequest).toHaveBeenCalledWith(hash(canonical(request())));
    expect(service.authorize).toHaveBeenCalled();
  });
  it("refuses a mismatched execute envelope before invoking any signing operation", async () => {
    const { call, service } = await listen();
    const response = await call("/v1/requests/" + hash(canonical(request())) + "/execute", {
      method: "POST",
      body: canonical({ schema_version: 1, request_id: "0".repeat(64) }),
    });
    expect(response.status).toBe(422);
    expect(service.execute).not.toHaveBeenCalled();
  });
  it("checks authentication syntax before storage or presigning", async () => {
    const { call, service } = await listen();
    const response = await call("/v1/requests", {
      method: "POST",
      headers: { Authorization: "invalid" },
    });
    expect(response.status).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.store.uploadTicket).not.toHaveBeenCalled();
    expect(service.store.readRequest).not.toHaveBeenCalled();
  });
  it("rejects duplicate authorization headers", async () => {
    const { origin, service } = await listen();
    const code = await new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest(
        origin + "/v1/requests",
        {
          method: "POST",
          headers: [
            "Host",
            "127.0.0.1",
            "Authorization",
            "Bearer first",
            "Authorization",
            "Bearer second",
          ],
        },
        (incoming) => {
          incoming.resume();
          incoming.once("end", () => resolve(incoming.statusCode ?? 0));
        },
      );
      outgoing.once("error", reject);
      outgoing.end(canonical(request()));
    });
    expect(code).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
  });
  it("refuses unknown routes and local transfer routes", async () => {
    const { call } = await listen();
    for (const route of ["/v1/transfers/" + "a".repeat(64), "/v1/requests?override=true"])
      expect((await call(route)).status).toBe(422);
  });
  it("bounds incoming metadata before calling the service", async () => {
    const { call, service } = await listen();
    const response = await call("/v1/requests", { method: "POST", body: Buffer.alloc(65537, 32) });
    expect(response.status).toBe(413);
    expect(service.create).not.toHaveBeenCalled();
  });
  it("does not expose exception text or credentials", async () => {
    const service = fixture();
    service.create.mockRejectedValue(new Error("sensitive-fixture-text"));
    const { call } = await listen(service);
    const response = await call("/v1/requests", { method: "POST", body: canonical(request()) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ schema_version: 1, code: "authority_unavailable" });
  });
  it("preserves the pending status contract while a journal records signing", async () => {
    const service = fixture();
    service.status.mockResolvedValue({ ...(await service.status()), state: "signing" });
    const { call } = await listen(service);
    const response = await call("/v1/requests/" + hash(canonical(request())));
    expect(response.status).toBe(202);
    expect((await response.json()).state).toBe("signing");
    expect(service.store.downloadTicket).not.toHaveBeenCalled();
  });
  it("does not issue transfer tickets for uncertain work", async () => {
    const service = fixture();
    service.status.mockResolvedValue({ ...(await service.status()), state: "uncertain" });
    const { call } = await listen(service);
    expect((await call("/v1/requests/" + hash(canonical(request())))).status).toBe(409);
    expect(service.store.downloadTicket).not.toHaveBeenCalled();
  });
  it("keeps one request active without releasing its slot when another request is refused", async () => {
    const service = fixture();
    let unblock: () => void = () => {};
    let entered: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const state = await service.create();
    service.create.mockImplementation(async () => {
      entered();
      await barrier;
      return state;
    });
    const { call } = await listen(service);
    const first = call("/v1/requests", { method: "POST", body: canonical(request()) });
    await ready;
    expect((await call("/v1/requests/" + hash(canonical(request())))).status).toBe(503);
    expect((await call("/v1/requests/" + hash(canonical(request())))).status).toBe(503);
    unblock();
    expect((await first).status).toBe(202);
    expect((await call("/unknown")).status).toBe(422);
  });
  it("does not give an unfinished metadata body the signing slot", async () => {
    const service = fixture();
    const { call, origin } = await listen(service, 2000);
    let outgoing: ReturnType<typeof httpRequest>;
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    service.checkAuthority.mockImplementationOnce(async () => {
      started();
    });
    const partial = new Promise<number>((resolve, reject) => {
      outgoing = httpRequest(
        origin + "/v1/requests",
        { method: "POST", headers: { Authorization: "Bearer fixture", "Content-Length": "2" } },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode ?? 0));
        },
      );
      outgoing.once("error", reject);
      outgoing.write("{");
    });
    await ready;
    const complete = await call("/v1/requests", { method: "POST", body: canonical(request()) });
    expect(complete.status).toBe(202);
    outgoing!.end("}");
    expect(await partial).toBe(422);
    expect(service.create).toHaveBeenCalledTimes(1);
  });
  it("expires a stalled metadata body without invoking the service", async () => {
    const { service, origin } = await listen(fixture(), 20);
    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest(
        origin + "/v1/requests",
        { method: "POST", headers: { Authorization: "Bearer fixture", "Content-Length": "2" } },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode ?? 0));
        },
      );
      outgoing.once("error", reject);
      outgoing.write("{");
    });
    expect(status).toBe(503);
    expect(service.create).not.toHaveBeenCalled();
  });
  it("returns 413 for a large body before any service effect", async () => {
    const { service, origin } = await listen();
    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest(
        origin + "/v1/requests",
        {
          method: "POST",
          headers: { Authorization: "Bearer fixture", "Content-Length": "1048576" },
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode ?? 0));
        },
      );
      outgoing.once("error", reject);
      outgoing.end(Buffer.alloc(1048576));
    });
    expect(status).toBe(413);
    expect(service.create).not.toHaveBeenCalled();
  });
  it("bounds chunked metadata without a Content-Length header", async () => {
    const { service, origin } = await listen();
    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest(
        origin + "/v1/requests",
        {
          method: "POST",
          headers: { Authorization: "Bearer fixture", "Transfer-Encoding": "chunked" },
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode ?? 0));
        },
      );
      outgoing.once("error", reject);
      outgoing.write(Buffer.alloc(65536));
      outgoing.end(Buffer.alloc(65536));
    });
    expect(status).toBe(413);
    expect(service.create).not.toHaveBeenCalled();
  });
  it("shares the original operation deadline through transport and service dispatch", async () => {
    const service = fixture();
    let observed: unknown;
    service.checkAuthority.mockImplementation(async () => {
      observed = currentSigningDeadline();
    });
    service.create.mockImplementation(async () => {
      expect(currentSigningDeadline()).toBe(observed);
      return {
        schema_version: 1,
        request_id: hash(canonical(request())),
        state: "admitted",
        code: null,
        receipt: null,
        receipt_signature: null,
        result: null,
      };
    });
    const { call } = await listen(service);
    expect(
      (await call("/v1/requests", { method: "POST", body: canonical(request()) })).status,
    ).toBe(202);
  });
});

describe("signing container composition", () => {
  const environment = {
    OHTIA_SIGNING_BACKEND_ACCESS_KEY: "fixture-only-access",
    OHTIA_SIGNING_BACKEND_SECRET_KEY: "fixture-only-secret",
  };
  it("keeps admission disabled and makes no provider request", async () => {
    const provider = vi.spyOn(globalThis, "fetch");
    const composed = composeSigningContainer(configuration(), { environment });
    expect(typeof composed.service.source.acquisition.open).toBe("function");
    expect(composed.service.source.repository).toBeUndefined();
    try {
      const server = productionSigningServer(composed.service);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      closers.push(
        () =>
          new Promise<void>((resolve) => {
            server.close(() => {
              composed.close();
              resolve();
            });
            server.closeIdleConnections();
          }),
      );
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing port.");
      const response = await fetch("http://127.0.0.1:" + address.port + "/v1/requests", {
        method: "POST",
        headers: { Authorization: "Bearer fixture" },
        body: canonical(request()),
      });
      expect(response.status).toBe(403);
      expect(provider).toHaveBeenCalledTimes(1);
    } catch (error) {
      composed.close();
      throw error;
    }
  });
  it("requires independent activation even when local policy is enabled", async () => {
    const config = configuration();
    config.policy.enabled = true;
    vi.spyOn(ScalewaySigningStore.prototype, "activation").mockResolvedValue(null);
    const provider = vi.spyOn(globalThis, "fetch");
    const composed = composeSigningContainer(config, { environment });
    try {
      await expect(composed.service.checkAuthority()).rejects.toThrow("policy_refused");
      expect(provider).not.toHaveBeenCalled();
    } finally {
      composed.close();
    }
  });
  it("never falls back to ambient provider credentials", () => {
    expect(() => composeSigningContainer(configuration(), { environment: {} })).toThrow(
      "authority_unavailable",
    );
  });
  it("binds retained request bytes to their digest", async () => {
    const client = new MockS3(),
      bytes = canonical(request());
    const store = new ScalewaySigningStore({
      ingress: "fixture-ingress",
      retained: "fixture-retained",
      client,
    });
    client.objects.set("fixture-retained/objects/" + hash(bytes), bytes);
    expect(await store.readRequest(hash(bytes))).toEqual(bytes);
    client.objects.set("fixture-retained/objects/" + hash(bytes), Buffer.from("substituted"));
    await expect(store.readRequest(hash(bytes))).rejects.toThrow("contract_refused");
  });
  it("bounds retained request retrieval before parsing", async () => {
    const client = new MockS3();
    const store = new ScalewaySigningStore({
      ingress: "fixture-ingress",
      retained: "fixture-retained",
      client,
    });
    client.objects.set("fixture-retained/objects/" + "a".repeat(64), Buffer.alloc(65537));
    await expect(store.readRequest("a".repeat(64))).rejects.toThrow();
  });
  it("keeps the image recipe independent of host credentials and whole-worktree copies", () => {
    const recipe = fs.readFileSync("tools/installation-signer/Containerfile", "utf8");
    expect(recipe).toContain("USER 65532:65532");
    const entrypoint = fs.readFileSync("tools/installation-signer/entrypoint.sh", "utf8");
    expect(recipe).toContain('ENTRYPOINT ["/bin/sh", "/opt/ohtia/entrypoint.sh"]');
    expect(entrypoint).toContain("ulimit -c 0");
    expect(entrypoint).toContain("exec /usr/bin/tini -g -- /usr/bin/node");
    expect(recipe).not.toMatch(/COPY\s+\.\s/);
    expect(recipe).not.toContain("ARG ");
  });
});

describe("dependency notice retention", () => {
  function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-notices-"));
    roots.push(directory);
    const packages = new Map<string, string>();
    for (const name of ["source", "target"]) {
      const location = path.join(directory, name);
      fs.mkdirSync(location);
      fs.writeFileSync(
        path.join(location, "package.json"),
        JSON.stringify({ license: "Apache-2.0" }),
      );
      packages.set(name + "@1.0.0", location);
    }
    const source = path.join(directory, "source/LICENSE");
    fs.writeFileSync(source, "Permitted synthetic license fixture.\n");
    const fallback = {
      package: "target@1.0.0",
      license: "Apache-2.0",
      source_package: "source@1.0.0",
      file: "LICENSE",
      sha256: hash(fs.readFileSync(source)),
    };
    return { packages, source, fallback, output: path.join(directory, "notices") };
  }
  it("retains a mapped exact-version notice for every bundled package", () => {
    const f = fixture();
    writeDependencyNotices(f.packages, f.output, [f.fallback], f.source);
    const map = JSON.parse(fs.readFileSync(path.join(f.output, "notice-map.json"), "utf8"));
    expect(Object.keys(map).sort()).toEqual(["source@1.0.0", "target@1.0.0"]);
    expect(map["target@1.0.0"].fallback_source).toBe("source@1.0.0/LICENSE");
    expect(fs.readFileSync(path.join(f.output, map["target@1.0.0"].files[0]))).toEqual(
      fs.readFileSync(f.source),
    );
  });
  it("refuses a package whose missing notice has no reviewed fallback", () => {
    const f = fixture();
    expect(() => writeDependencyNotices(f.packages, f.output, [], f.source)).toThrow(
      "Missing declared dependency notice",
    );
  });
  it("refuses a substituted fallback license text", () => {
    const f = fixture();
    f.fallback.sha256 = "0".repeat(64);
    expect(() => writeDependencyNotices(f.packages, f.output, [f.fallback], f.source)).toThrow(
      "digest mismatch",
    );
  });
  it("refuses a fallback path outside its selected package", () => {
    const f = fixture();
    f.fallback.file = "../source/LICENSE";
    expect(() => writeDependencyNotices(f.packages, f.output, [f.fallback], f.source)).toThrow(
      "Missing declared dependency notice",
    );
  });
});
