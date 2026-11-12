import fs from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonical,
  hash,
  signingLimits,
  SigningDeadline,
  withSigningDeadline,
} from "../tooling/installation-authority.mjs";
import {
  signingActivationRecord,
  signingAdmission,
  signingConfigurationHash,
  signingDeploymentRequirements,
  prepareSigningActivation,
} from "../tooling/installation-signing-admission.mjs";
import {
  ScalewaySigningDeployment,
  ScalewaySigningStore,
} from "../tooling/installation-signing-scaleway.mjs";
import { composeSigningContainer } from "../tooling/installation-signing-container.mjs";
import {
  signingConfiguration,
  signingContainerSnapshot,
  signingNamespaceSnapshot,
  signingNamespaceId as namespaceId,
  signingProjectId as projectId,
} from "./fixtures/signing-configuration";
import { MockS3 } from "./fixtures/signing-store";
import {
  signingClientEnvironmentConfiguration,
  signingResourceBindingsHash,
} from "../tooling/installation-signing-client.mjs";
import { prepareSigningConfiguration } from "../tooling/installation-signing-configuration.mjs";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(config = signingConfiguration()) {
  config.policy.enabled = true;
  const container = signingContainerSnapshot(config);
  const namespace = signingNamespaceSnapshot();
  const record = signingActivationRecord(config, true);
  const store = { activation: vi.fn(async () => canonical(record)) };
  const deployment = {
    container: vi.fn(async () => container),
    namespace: vi.fn(async () => namespace),
  };
  return {
    config,
    container,
    namespace,
    record,
    store,
    deployment,
    admit: signingAdmission(config, { store, deployment }),
  };
}
function rawResponse(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    error_message: null,
    secret_environment_variables: { backend: "sensitive-fixture-value" },
    region: "fr-par",
    status: "ready",
    environment_variables: {},
    ...extra,
  };
}

function providerFixture(config: ReturnType<typeof signingConfiguration>) {
  const toRaw = (snapshot: any) => {
    const { secret_environment_names, has_error, ...visible } = snapshot;
    return {
      ...visible,
      error_message: null,
      secret_environment_variables: Object.fromEntries(
        secret_environment_names.map((name: string) => [name, "synthetic-private-value"]),
      ),
    };
  };
  const container = toRaw(signingContainerSnapshot(config)),
    namespace = toRaw(signingNamespaceSnapshot());
  const fetcher = vi.fn(async (url: string) => {
    const body = url.endsWith("/containers/" + container.id)
      ? container
      : url.endsWith("/namespaces/" + namespace.id)
        ? namespace
        : null;
    if (!body) throw new Error("Unexpected fixed API request");
    const bytes = JSON.stringify(body);
    return new Response(bytes, { headers: { "content-length": String(Buffer.byteLength(bytes)) } });
  });
  return {
    container,
    namespace,
    fetcher,
    reader: new ScalewaySigningDeployment({ token: async () => "synthetic-token", fetcher }),
  };
}

describe("independent signing activation", () => {
  it("binds the exact public configuration and deployment requirements automatically", () => {
    const { config, record } = fixture();
    expect(Object.keys(record).sort()).toEqual([
      "configuration_sha256",
      "container_id",
      "enabled",
      "image_digest",
      "policy_sha256",
      "schema_version",
    ]);
    expect(record.policy_sha256).toBe(hash(canonical(config.policy)));
    expect(record.configuration_sha256).toBe(
      hash(
        canonical({ configuration: config, container_requirements: signingDeploymentRequirements }),
      ),
    );
    expect(signingConfigurationHash(config)).toBe(record.configuration_sha256);
    const changed = structuredClone(config);
    changed.secret_versions.rpm.revision++;
    expect(signingConfigurationHash(changed)).not.toBe(record.configuration_sha256);
    expect(signingActivationRecord(config, false)).toEqual({ ...record, enabled: false });
  });
  it("binds the explicit project independently of the configured bucket names", async () => {
    const f = fixture();
    expect(f.config.buckets).toEqual({
      ingress: "ohtia-signing-ingress",
      retained: "ohtia-signing-retained",
    });
    await expect(f.admit(f.config.policy)).resolves.toBe(true);
    const renamed = structuredClone(f.config);
    renamed.buckets.ingress = "another-ingress";
    renamed.buckets.retained = "another-retained";
    expect(signingConfigurationHash(renamed)).not.toBe(f.record.configuration_sha256);
    const rebound = fixture(renamed);
    await expect(rebound.admit(renamed.policy)).resolves.toBe(true);
    // A UUID-looking name is not authoritative Project metadata.
    renamed.buckets.ingress = "ohtia-signing-ingress-" + namespaceId;
    renamed.buckets.retained = "ohtia-signing-retained-" + namespaceId;
    await expect(fixture(renamed).admit(renamed.policy)).resolves.toBe(true);
    const changed = structuredClone(f.config);
    changed.project_id = namespaceId;
    expect(signingConfigurationHash(changed)).not.toBe(f.record.configuration_sha256);
    expect(signingActivationRecord(changed, true).policy_sha256).toBe(f.record.policy_sha256);
    // Even approval for the changed configuration cannot admit a namespace in the old Project.
    const wrongProject = fixture(changed);
    await expect(wrongProject.admit(changed.policy)).rejects.toThrow("policy_refused");
  });
  it("admits documented raw v1 container and namespace responses through both adapters", async () => {
    const f = fixture(),
      provider = providerFixture(f.config);
    provider.container.scaling_option.cpu_usage_threshold = null;
    provider.container.scaling_option.memory_usage_threshold = null;
    const admit = signingAdmission(f.config, { store: f.store, deployment: provider.reader });
    await expect(admit(f.config.policy)).resolves.toBe(true);
    expect(provider.fetcher).toHaveBeenCalledTimes(2);
    provider.container.scaling_option.cpu_usage_threshold = 50;
    await expect(admit(f.config.policy)).rejects.toThrow("policy_refused");
    provider.container.scaling_option.cpu_usage_threshold = null;
    provider.container.scaling_option.memory_usage_threshold = 50;
    await expect(admit(f.config.policy)).rejects.toThrow("policy_refused");
  });
  it("admits a maximum-size public configuration inside a separately bounded provider response", async () => {
    const config = signingConfiguration();
    config.policy.enabled = true;
    const padding = signingLimits.request_bytes - canonical(config).length;
    config.policy.catalog_public_key = config.policy.catalog_public_key.replace(
      "\n-----END PUBLIC KEY-----",
      "A".repeat(padding) + "\n-----END PUBLIC KEY-----",
    );
    expect(canonical(config).length).toBe(signingLimits.request_bytes);
    const f = fixture(config),
      provider = providerFixture(config);
    expect(Buffer.byteLength(JSON.stringify(provider.container))).toBeGreaterThan(
      signingLimits.request_bytes,
    );
    const admit = signingAdmission(config, { store: f.store, deployment: provider.reader });
    await expect(admit(config.policy)).resolves.toBe(true);
  });
  it("requires closed canonical control metadata and a matching policy", async () => {
    const { config, record, store, deployment, admit } = fixture();
    for (const bytes of [
      null,
      Buffer.from("{}"),
      Buffer.from(JSON.stringify(record)),
      canonical({ ...record, extra: true }),
      canonical({ ...record, enabled: false }),
      canonical({ ...record, configuration_sha256: "0".repeat(64) }),
      canonical({ ...record, image_digest: "sha256:" + "0".repeat(64) }),
      canonical({ ...record, policy_sha256: "0".repeat(64) }),
      canonical({ ...record, container_id: namespaceId }),
    ]) {
      store.activation.mockResolvedValueOnce(bytes as Buffer);
      await expect(admit(config.policy)).rejects.toThrow("policy_refused");
    }
    expect(deployment.container).not.toHaveBeenCalled();
    await expect(admit({ ...config.policy, enabled: false })).rejects.toThrow("policy_refused");
  });
  it("reads control on both sides of fresh provider observations without a success cache", async () => {
    const f = fixture();
    await expect(f.admit(f.config.policy)).resolves.toBe(true);
    expect(f.store.activation).toHaveBeenCalledTimes(2);
    expect(f.deployment.container).toHaveBeenCalledWith(f.record.container_id);
    expect(f.deployment.namespace).toHaveBeenCalledWith(namespaceId);
    f.store.activation.mockResolvedValueOnce(canonical({ ...f.record, enabled: false }));
    await expect(f.admit(f.config.policy)).rejects.toThrow("policy_refused");
    expect(f.deployment.container).toHaveBeenCalledTimes(1);
  });
  it("observes revocation during provider readback and never retains a stale authorization", async () => {
    const f = fixture();
    f.deployment.container.mockImplementationOnce(async () => {
      f.store.activation.mockResolvedValue(canonical({ ...f.record, enabled: false }));
      return f.container;
    });
    await expect(f.admit(f.config.policy)).rejects.toThrow("policy_refused");
    await expect(f.admit(f.config.policy)).rejects.toThrow("policy_refused");
  });
  it("refuses mutable images, wrong identities, readiness and every changed deployment requirement", async () => {
    for (const [key, value] of Object.entries({
      id: namespaceId,
      region: "nl-ams",
      status: "updating",
      has_error: true,
      image: "rg.fr-par.scw.cloud/fixture/signer:latest",
      ...Object.fromEntries(
        Object.entries(signingDeploymentRequirements).map(([name, value]) => [
          name,
          value === null ? namespaceId : null,
        ]),
      ),
      scaling_option: { concurrent_requests_threshold: 2 },
      environment_variables: { NODE_OPTIONS: "unapproved" },
      secret_environment_names: ["UNAPPROVED"],
    })) {
      const f = fixture();
      Object.assign(f.container, { [key]: value });
      await expect(f.admit(f.config.policy)).rejects.toThrow("policy_refused");
    }
  });
  it("requires the dedicated project and rejects inherited namespace environment", async () => {
    for (const [key, value] of Object.entries({
      id: projectId,
      project_id: namespaceId,
      region: "nl-ams",
      status: "creating",
      has_error: true,
      environment_variables: { NODE_OPTIONS: "unapproved" },
      secret_environment_names: ["inherited"],
    })) {
      const f = fixture();
      Object.assign(f.namespace, { [key]: value });
      await expect(f.admit(f.config.policy)).rejects.toThrow("policy_refused");
    }
  });
  it("uses independent observations in the real service composition before allowing work", async () => {
    const f = fixture();
    vi.spyOn(ScalewaySigningStore.prototype, "activation").mockImplementation(f.store.activation);
    vi.spyOn(ScalewaySigningDeployment.prototype, "container").mockImplementation(
      f.deployment.container,
    );
    vi.spyOn(ScalewaySigningDeployment.prototype, "namespace").mockImplementation(
      f.deployment.namespace,
    );
    const composed = composeSigningContainer(f.config, {
      environment: {
        OHTIA_SIGNING_BACKEND_ACCESS_KEY: "fixture-access",
        OHTIA_SIGNING_BACKEND_SECRET_KEY: "fixture-secret",
      },
    });
    try {
      await expect(composed.service.checkAuthority()).resolves.toBeUndefined();
      f.store.activation.mockResolvedValue(canonical({ ...f.record, enabled: false }));
      await expect(composed.service.checkAuthority()).rejects.toThrow("policy_refused");
    } finally {
      composed.close();
    }
  });
  it("rejects changed configuration and credential fields before producing an approval", () => {
    const { config } = fixture();
    const missingProject = structuredClone(config);
    delete (missingProject as Partial<typeof config>).project_id;
    for (const changed of [
      missingProject,
      ...[undefined, null, 1, "", "PROJECT_ID", "00000000-0000-0000-0000-000000000000"].map(
        (project_id) => ({ ...config, project_id }),
      ),
      {
        ...missingProject,
        buckets: {
          ingress: "ohtia-signing-ingress-" + projectId,
          retained: "ohtia-signing-retained-" + projectId,
        },
      },
      ...[null, 1, "ab", "x".repeat(64), "a/*", "https://foreign.invalid", "a.b", "A-B"].map(
        (retained) => ({ ...config, buckets: { ...config.buckets, retained } }),
      ),
      { ...config, token: "sensitive-fixture" },
      { ...config, buckets: { ...config.buckets, retained: config.buckets.ingress } },
      {
        ...config,
        secret_versions: {
          ...config.secret_versions,
          rpm: { ...config.secret_versions.rpm, revision: "latest" },
        },
      },
      {
        ...config,
        policy: {
          ...config.policy,
          deployment: {
            ...config.policy.deployment,
            container_id: "00000000-0000-0000-0000-000000000000",
          },
        },
      },
    ])
      expect(() => signingActivationRecord(changed, true)).toThrow();
  });
  it("assembles ordinary public metadata into canonical runtime and a disabled caller template", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-runtime-assembly-"));
    roots.push(root);
    const config = signingConfiguration(),
      fragment = path.join(root, "fragment.json"),
      policy = path.join(root, "policy.json"),
      output = path.join(root, "runtime");
    const { project_id, buckets, secret_versions } = config;
    fs.writeFileSync(fragment, JSON.stringify({ project_id, buckets, secret_versions }, null, 2));
    fs.writeFileSync(policy, JSON.stringify(config.policy, null, 2));
    prepareSigningConfiguration(fragment, policy, output);
    expect(fs.readFileSync(path.join(output, "runtime.json"))).toEqual(canonical(config));
    const template = JSON.parse(fs.readFileSync(path.join(output, "client-template.json"), "utf8"));
    expect(template.enabled).toBe(false);
    expect(template.service_origin).toBeNull();
    expect(template.buckets).toBeNull();
    expect(template.resource_bindings_sha256).toBeNull();
    const caller = path.join(root, "caller.json");
    const resources = { service_origin: "https://fixture.fnc.fr-par.scw.cloud", buckets };
    fs.writeFileSync(caller, JSON.stringify(resources));
    const boundOutput = path.join(root, "bound");
    prepareSigningConfiguration(fragment, policy, boundOutput, caller);
    const bound = JSON.parse(
      fs.readFileSync(path.join(boundOutput, "client-template.json"), "utf8"),
    );
    const environment = {
      SCW_SIGNING_SERVICE_ORIGIN: resources.service_origin,
      SCW_SIGNING_INGRESS_BUCKET: buckets.ingress,
      SCW_SIGNING_RETAINED_BUCKET: buckets.retained,
    };
    expect(bound.resource_bindings_sha256).toBe(signingResourceBindingsHash(resources));
    expect(() =>
      signingClientEnvironmentConfiguration(bound, config.policy.signing_workflow.sha, environment),
    ).toThrow();
    const enabled = { ...bound, enabled: true }; // Unit fixture only; the producer always emits disabled output.
    expect(
      signingClientEnvironmentConfiguration(
        enabled,
        config.policy.signing_workflow.sha,
        environment,
      ).origin,
    ).toBe(resources.service_origin);
    expect(() =>
      signingClientEnvironmentConfiguration(
        { ...template, enabled: true },
        config.policy.signing_workflow.sha,
        environment,
      ),
    ).toThrow();
    expect(() =>
      signingClientEnvironmentConfiguration(enabled, config.policy.signing_workflow.sha, {
        ...environment,
        SCW_SIGNING_SERVICE_ORIGIN: "https://another.fnc.fr-par.scw.cloud",
      }),
    ).toThrow();
    const python = spawnSync(
      process.env.OHTIA_PYTHON ?? "python3",
      [
        "-I",
        "-c",
        "import json,sys;sys.path.insert(0,'scripts');import installation_signing_metadata as m;print(m.caller_hash(json.loads(sys.stdin.read())))",
      ],
      { input: JSON.stringify(resources), encoding: "utf8" },
    );
    expect(python.status, python.stderr).toBe(0);
    expect(python.stdout.trim()).toBe(bound.resource_bindings_sha256);
    fs.writeFileSync(
      caller,
      JSON.stringify({ ...resources, buckets: { ...buckets, ingress: "other-valid-bucket" } }),
    );
    expect(() =>
      prepareSigningConfiguration(fragment, policy, path.join(root, "mismatch"), caller),
    ).toThrow();
    expect(fs.existsSync(path.join(root, "mismatch"))).toBe(false);
    expect(template.policy).not.toHaveProperty("source_anchor");
    expect(template.policy).not.toHaveProperty("source_signers");
    expect(template.policy.signing_workflow).toBeUndefined();
    const plan = JSON.parse(fs.readFileSync(path.join(output, "plan.json"), "utf8"));
    expect(plan.configuration_sha256).toBe(signingConfigurationHash(config));
    expect(plan.requires_independent_approval).toBe(true);
    for (const [name, digest] of Object.entries(plan.files))
      expect(hash(fs.readFileSync(path.join(output, name)))).toBe(digest);
    prepareSigningActivation(
      path.join(output, "runtime.json"),
      path.join(root, "activation"),
      false,
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "activation/active.json"), "utf8")).enabled,
    ).toBe(false);
    expect(() => prepareSigningConfiguration(fragment, policy, output)).toThrow();
    const cli = spawnSync(
      process.execPath,
      [
        "tooling/installation-signing-configuration.mjs",
        "--fragment",
        fragment,
        "--policy",
        policy,
        "--output",
        path.join(root, "cli"),
      ],
      { encoding: "utf8" },
    );
    expect(cli.status, cli.stderr).toBe(0);
    if (process.platform !== "win32") {
      expect(fs.statSync(output).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(output, "runtime.json")).mode & 0o777).toBe(0o600);
    }
  });
  it("refuses ambiguous oversized or credential-bearing assembly inputs before creating output", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-runtime-refusal-"));
    roots.push(root);
    const config = signingConfiguration(),
      fragment = path.join(root, "fragment.json"),
      policy = path.join(root, "policy.json"),
      output = path.join(root, "output");
    const { project_id, buckets, secret_versions } = config;
    const good = JSON.stringify({ project_id, buckets, secret_versions });
    fs.writeFileSync(policy, JSON.stringify(config.policy));
    for (const bytes of [
      good.replace("{", '{"project_id":"sensitive-value",'),
      " ".repeat(signingLimits.request_bytes + 1),
      JSON.stringify({ project_id, buckets, secret_versions, token: "sensitive-value" }),
    ]) {
      fs.writeFileSync(fragment, bytes);
      expect(() => prepareSigningConfiguration(fragment, policy, output)).toThrow();
      expect(fs.existsSync(output)).toBe(false);
    }
    fs.writeFileSync(fragment, good);
    fs.writeFileSync(policy, JSON.stringify({ ...config.policy, private_key: "sensitive-value" }));
    const cli = spawnSync(
      process.execPath,
      [
        "tooling/installation-signing-configuration.mjs",
        "--fragment",
        fragment,
        "--policy",
        policy,
        "--output",
        output,
      ],
      { encoding: "utf8" },
    );
    expect(cli.status).toBe(1);
    expect(cli.stderr).toBe("Unable to prepare signing configuration.\n");
    expect(cli.stdout).toBe("");
    expect(fs.existsSync(output)).toBe(false);
  });
  it("prepares fresh private metadata with payload hashes and no network operation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-activation-"));
    roots.push(root);
    const f = fixture(),
      file = path.join(root, "configuration.json"),
      output = path.join(root, "preview");
    fs.writeFileSync(file, canonical(f.config));
    prepareSigningActivation(file, output, true);
    const plan = JSON.parse(fs.readFileSync(path.join(output, "plan.json"), "utf8"));
    expect(plan.mode).toBe("offline-preview");
    expect(plan.requires_independent_approval).toBe(true);
    expect(plan.control_key).toBe("control/active.json");
    expect(JSON.parse(fs.readFileSync(path.join(output, "active.json"), "utf8"))).toEqual(f.record);
    for (const [name, digest] of Object.entries(plan.files))
      expect(hash(fs.readFileSync(path.join(output, name)))).toBe(digest);
    if (process.platform !== "win32") {
      expect(fs.statSync(output).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(output, "active.json")).mode & 0o777).toBe(0o600);
    }
    expect(() => prepareSigningActivation(file, output, false)).toThrow();
    const disabled = path.join(root, "disabled-preview");
    const result = spawnSync(
      process.execPath,
      [
        "tooling/installation-signing-activation.mjs",
        "--configuration",
        file,
        "--output",
        disabled,
        "--enabled",
        "false",
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(fs.readFileSync(path.join(disabled, "active.json"), "utf8"))).toEqual({
      ...f.record,
      enabled: false,
    });
  });
  it("keeps CLI diagnostics free of input values and rejects malformed input before output", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-activation-cli-"));
    roots.push(root);
    const file = path.join(root, "sensitive-fixture.json"),
      output = path.join(root, "preview");
    fs.writeFileSync(file, canonical({ secret: "sensitive-fixture-value" }));
    const result = spawnSync(
      process.execPath,
      [
        "tooling/installation-signing-activation.mjs",
        "--configuration",
        file,
        "--output",
        output,
        "--enabled",
        "true",
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("Unable to prepare signing activation metadata.\n");
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("sensitive-fixture");
    expect(fs.existsSync(output)).toBe(false);
  });
});

describe("provider deployment readback", () => {
  it("negotiates identity JSON through the real HTTP transport before admitting deployment", async () => {
    const f = fixture(),
      provider = providerFixture(f.config),
      encodings: unknown[] = [];
    const server = createServer((request, response) => {
      const body = request.url?.endsWith("/containers/" + provider.container.id)
        ? provider.container
        : request.url?.endsWith("/namespaces/" + provider.namespace.id)
          ? provider.namespace
          : null;
      if (!body) {
        response.writeHead(404);
        response.end();
        return;
      }
      const encoding = request.headers["accept-encoding"];
      encodings.push(encoding);
      const raw = Buffer.from(JSON.stringify(body));
      const identity = encoding === "identity",
        bytes = identity ? raw : gzipSync(raw);
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": bytes.length,
        ...(identity ? {} : { "Content-Encoding": "gzip" }),
      });
      response.end(bytes);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP fixture");
    try {
      const reader = new ScalewaySigningDeployment({
        token: async () => "synthetic-token",
        fetcher: (url: string, options: RequestInit) =>
          fetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}`, options),
      });
      const admit = signingAdmission(f.config, { store: f.store, deployment: reader });
      await expect(admit(f.config.policy)).resolves.toBe(true);
      expect(encodings).toEqual(["identity", "identity"]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("uses fixed authenticated GETs and returns secret names without secret values", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(rawResponse(namespaceId))));
    const reader = new ScalewaySigningDeployment({ token: async () => "synthetic-token", fetcher });
    const value = await reader.namespace(namespaceId);
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.scaleway.com/containers/v1/regions/fr-par/namespaces/${namespaceId}`,
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: { "X-Auth-Token": "synthetic-token", "Accept-Encoding": "identity" },
      }),
    );
    expect(value.secret_environment_names).toEqual(["backend"]);
    expect(JSON.stringify(value)).not.toContain("sensitive-fixture");
    expect(value.has_error).toBe(false);
  });
  it("rejects unsupported identities before requesting credentials or network access", async () => {
    const token = vi.fn(async () => "synthetic-token"),
      fetcher = vi.fn();
    const reader = new ScalewaySigningDeployment({ token, fetcher });
    for (const id of [
      "../other",
      "00000000-0000-0000-0000-000000000000",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase(),
    ])
      await expect(reader.container(id)).rejects.toThrow("policy_refused");
    expect(token).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses denied, redirected, malformed, oversized and mismatched responses without retry", async () => {
    for (const response of [
      new Response("sensitive-fixture", { status: 403 }),
      new Response(null, { status: 302, headers: { Location: "https://untrusted.invalid" } }),
      new Response("{"),
      new Response(Buffer.alloc(signingLimits.deployment_readback_bytes + 1, 32)),
      new Response("{}", {
        headers: { "content-length": String(signingLimits.deployment_readback_bytes + 1) },
      }),
      new Response(JSON.stringify(rawResponse(namespaceId)), {
        headers: { "content-encoding": "gzip" },
      }),
      new Response(JSON.stringify(rawResponse(projectId))),
      new Response(JSON.stringify(rawResponse(namespaceId)), {
        headers: { "content-length": "1" },
      }),
    ]) {
      const fetcher = vi.fn(async () => response),
        reader = new ScalewaySigningDeployment({ token: async () => "synthetic-token", fetcher });
      await expect(reader.container(namespaceId)).rejects.toThrow(
        /^(?:authority_unavailable|policy_refused)$/,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("bounds stalled response bodies under the current operation deadline", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull() {
              return new Promise(() => {});
            },
          }),
        ),
    );
    const reader = new ScalewaySigningDeployment({ token: async () => "synthetic-token", fetcher });
    await expect(
      withSigningDeadline(new SigningDeadline(20), () => reader.container(namespaceId)),
    ).rejects.toThrow("authority_unavailable");
  });
  it("reads only the retained activation object without a write or ticket capability", async () => {
    const f = fixture(),
      client = new MockS3();
    const store = new ScalewaySigningStore({ ...f.config.buckets, client });
    expect(await store.activation()).toBeNull();
    client.objects.set(f.config.buckets.retained + "/control/active.json", canonical(f.record));
    expect(await store.activation()).toEqual(canonical(f.record));
    expect(
      client.calls.every(
        (c) => c.name === "GetObjectCommand" && c.input.Key === "control/active.json",
      ),
    ).toBe(true);
  });
});
