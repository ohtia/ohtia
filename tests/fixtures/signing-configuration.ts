import { generateKeyPairSync } from "node:crypto";
import { canonical } from "../../tooling/installation-authority.mjs";
import { signingDeploymentRequirements } from "../../tooling/installation-signing-admission.mjs";

export const signingNamespaceId = "33333333-3333-4333-8333-333333333333";
export const signingProjectId = "22222222-2222-4222-8222-222222222222";
export function signingContainerSnapshot(config: ReturnType<typeof signingConfiguration>) {
  return {
    ...structuredClone(signingDeploymentRequirements),
    id: config.policy.deployment.container_id,
    namespace_id: signingNamespaceId,
    image: "rg.fr-par.scw.cloud/fixture/signer@" + config.policy.deployment.image_digest,
    region: "fr-par",
    status: "ready",
    has_error: false,
    environment_variables: { OHTIA_SIGNING_CONFIGURATION: canonical(config).toString() },
    secret_environment_names: [
      "OHTIA_SIGNING_BACKEND_ACCESS_KEY",
      "OHTIA_SIGNING_BACKEND_SECRET_KEY",
    ],
  };
}
export function signingNamespaceSnapshot() {
  return {
    id: signingNamespaceId,
    project_id: signingProjectId,
    region: "fr-par",
    status: "ready",
    has_error: false,
    environment_variables: {},
    secret_environment_names: [],
  };
}

export function signingConfiguration() {
  const publicKey = generateKeyPairSync("ed25519")
    .publicKey.export({ format: "pem", type: "spki" })
    .toString();
  return {
    schema_version: 1,
    project_id: signingProjectId,
    policy: {
      schema_version: 1,
      enabled: false,
      repository_id: "1431132416",
      owner_id: "346940169",
      audience: "ohtia:installation-signing",
      environment: "installation-signing",
      caller_workflow: ".github/workflows/installation-signing.yml",
      signing_workflow: { workflow: ".github/workflows/signing-worker.yml", sha: "c".repeat(40) },
      build_workflow: { workflow: ".github/workflows/signing-build.yml", sha: "d".repeat(40) },
      source_anchor: "e".repeat(40),
      source_signers: [{ principal: "fixture", public_key: "ssh-ed25519 AAAA" }],
      catalog_public_key: publicKey,
      rpm_primary: "1".repeat(40),
      rpm_subkey: "2".repeat(40),
      deployment: {
        provider: "scaleway-serverless-containers",
        region: "fr-par",
        container_id: "11111111-1111-4111-8111-111111111111",
        image_digest: "sha256:" + "f".repeat(64),
      },
    },
    buckets: {
      ingress: "ohtia-signing-ingress",
      retained: "ohtia-signing-retained",
    },
    secret_versions: Object.fromEntries(
      ["rpm", "rpm_passphrase", "catalog", "catalog_passphrase"].map((name, i) => [
        name,
        { secret_id: "00000000-0000-0000-0000-" + String(i + 1).padStart(12, "0"), revision: 1 },
      ]),
    ),
  };
}
