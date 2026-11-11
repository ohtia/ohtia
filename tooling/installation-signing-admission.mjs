// Independent activation is selected by an administrator, never by a signing request.
import fs from "node:fs";
import path from "node:path";
import {
  canonical,
  currentSigningDeadline,
  decode,
  demand,
  fields,
  hash,
  SigningError,
  signingLimits,
  trustedPolicy,
} from "./installation-authority.mjs";

export const signingDeploymentRequirements = Object.freeze({
  scaling_option: Object.freeze({ concurrent_requests_threshold: 1 }),
  min_scale: 0,
  max_scale: 1,
  memory_limit_bytes: signingLimits.container_memory_bytes,
  mvcpu_limit: signingLimits.container_mvcpu,
  local_storage_limit_bytes: signingLimits.container_storage_bytes,
  timeout: `${signingLimits.execution_ms / 1000}s`,
  privacy: "private",
  protocol: "http1",
  port: 8080,
  https_connections_only: true,
  sandbox: "v2",
  command: Object.freeze([]),
  args: Object.freeze([]),
  private_network_id: null,
  default_public_endpoint_enabled: true,
});
const roles = "rpm rpm_passphrase catalog catalog_passphrase";
const same = (a, b) => {
  try {
    return canonical(a).equals(canonical(b));
  } catch {
    return false;
  }
};
function uuid(value) {
  demand(
    typeof value === "string" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value) &&
      value !== "00000000-0000-0000-0000-000000000000",
    "policy_refused",
  );
  return value;
}
function configurationRecord(configuration) {
  fields(configuration, "schema_version project_id policy buckets secret_versions");
  demand(configuration.schema_version === 1);
  const policy = trustedPolicy(configuration.policy);
  uuid(policy.deployment.container_id);
  fields(configuration.buckets, "ingress retained");
  const project = uuid(configuration.project_id);
  for (const name of Object.values(configuration.buckets))
    demand(
      typeof name === "string" && /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(name),
      "policy_refused",
    );
  demand(configuration.buckets.ingress !== configuration.buckets.retained, "policy_refused");
  fields(configuration.secret_versions, roles);
  for (const ref of Object.values(configuration.secret_versions)) {
    fields(ref, "secret_id revision");
    uuid(ref.secret_id);
    demand(Number.isSafeInteger(ref.revision) && ref.revision > 0 && ref.revision <= 4294967295);
  }
  demand(
    new Set(Object.values(configuration.secret_versions).map((ref) => ref.secret_id)).size === 4,
  );
  const record = { ...structuredClone(configuration), policy };
  demand(canonical(record).length <= signingLimits.request_bytes, "size_refused");
  return { configuration: record, project };
}
export function signingConfigurationHash(configuration) {
  const record = configurationRecord(configuration).configuration;
  return hash(
    canonical({ configuration: record, container_requirements: signingDeploymentRequirements }),
  );
}
export function signingActivationRecord(configuration, enabled) {
  const record = configurationRecord(configuration).configuration;
  demand(typeof enabled === "boolean" && (!enabled || record.policy.enabled), "policy_refused");
  return {
    schema_version: 1,
    enabled,
    policy_sha256: hash(canonical(record.policy)),
    configuration_sha256: signingConfigurationHash(record),
    container_id: record.policy.deployment.container_id,
    image_digest: record.policy.deployment.image_digest,
  };
}
function approvedControl(bytes, expected) {
  try {
    const value = decode(bytes);
    fields(
      value,
      "schema_version enabled policy_sha256 configuration_sha256 container_id image_digest",
    );
    demand(same(value, expected), "policy_refused");
  } catch {
    throw new SigningError("policy_refused");
  }
}
function approvedScaling(value) {
  demand(value && Object.getPrototypeOf(value) === Object.prototype, "policy_refused");
  demand(
    Object.keys(value).every((key) =>
      ["concurrent_requests_threshold", "cpu_usage_threshold", "memory_usage_threshold"].includes(
        key,
      ),
    ),
    "policy_refused",
  );
  demand(value.concurrent_requests_threshold === 1, "policy_refused");
  for (const key of ["cpu_usage_threshold", "memory_usage_threshold"])
    demand(value[key] === undefined || value[key] === null || value[key] === 0, "policy_refused");
}
export function signingAdmission(configuration, { store, deployment }) {
  const frozen = configurationRecord(configuration);
  const expected = signingActivationRecord(frozen.configuration, true);
  const config = frozen.configuration;
  return async (policy) => {
    demand(policy.enabled && same(policy, config.policy), "policy_refused");
    const before = await store.activation();
    approvedControl(before, expected);
    const container = await deployment.container(expected.container_id);
    demand(
      container.id === expected.container_id &&
        container.region === "fr-par" &&
        container.status === "ready" &&
        container.has_error === false,
      "policy_refused",
    );
    demand(
      typeof container.image === "string" &&
        /^rg\.fr-par\.scw\.cloud\/[a-z0-9][a-z0-9/_-]*@sha256:[a-f0-9]{64}$/.test(
          container.image,
        ) &&
        container.image.endsWith("@" + expected.image_digest),
      "policy_refused",
    );
    for (const [key, value] of Object.entries(signingDeploymentRequirements))
      if (key !== "scaling_option") demand(same(container[key], value), "policy_refused");
    approvedScaling(container.scaling_option);
    demand(
      same(container.environment_variables, {
        OHTIA_SIGNING_CONFIGURATION: canonical(config).toString(),
      }),
      "policy_refused",
    );
    demand(
      same(container.secret_environment_names, [
        "OHTIA_SIGNING_BACKEND_ACCESS_KEY",
        "OHTIA_SIGNING_BACKEND_SECRET_KEY",
      ]),
      "policy_refused",
    );
    const namespace = await deployment.namespace(uuid(container.namespace_id));
    demand(
      namespace.id === container.namespace_id &&
        namespace.project_id === frozen.project &&
        namespace.region === "fr-par" &&
        namespace.status === "ready" &&
        namespace.has_error === false,
      "policy_refused",
    );
    demand(
      same(namespace.environment_variables, {}) && same(namespace.secret_environment_names, []),
      "policy_refused",
    );
    const after = await store.activation();
    approvedControl(after, expected);
    demand(before.equals(after), "policy_refused");
    currentSigningDeadline().check();
    return true;
  };
}

// This offline producer writes reviewable metadata only; it cannot apply or enable a deployment.
export function prepareSigningActivation(configurationFile, destination, enabled) {
  const entry = fs.lstatSync(configurationFile);
  demand(entry.isFile() && !entry.isSymbolicLink());
  const fd = fs.openSync(
    configurationFile,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
  );
  let bytes;
  try {
    const info = fs.fstatSync(fd);
    demand(
      info.isFile() &&
        info.dev === entry.dev &&
        info.ino === entry.ino &&
        info.size > 0 &&
        info.size <= signingLimits.request_bytes,
    );
    bytes = Buffer.alloc(info.size + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    demand(count === info.size);
    bytes = bytes.subarray(0, count);
  } finally {
    fs.closeSync(fd);
  }
  const configuration = decode(bytes);
  const control = canonical(signingActivationRecord(configuration, enabled));
  const requirements = canonical(signingDeploymentRequirements);
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const [name, value] of [
    ["active.json", control],
    ["container-requirements.json", requirements],
  ]) {
    const file = fs.openSync(path.join(destination, name), "wx", 0o600);
    try {
      fs.writeFileSync(file, value);
    } finally {
      fs.closeSync(file);
    }
  }
  const plan = canonical({
    schema_version: 1,
    mode: "offline-preview",
    requires_independent_approval: true,
    control_bucket: configuration.buckets.retained,
    control_key: "control/active.json",
    files: { "active.json": hash(control), "container-requirements.json": hash(requirements) },
  });
  const file = fs.openSync(path.join(destination, "plan.json"), "wx", 0o600);
  try {
    fs.writeFileSync(file, plan);
  } finally {
    fs.closeSync(file);
  }
}
