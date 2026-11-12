// Recipe-owned private campaign orchestration; this never installs or executes an input package.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  canonical,
  decode,
  demand,
  fields,
  hash,
  positive,
  SigningDeadline,
  SigningError,
  GitHubBuildAuthority,
  githubReaders,
  signingLimits,
} from "./installation-authority.mjs";
import { fileReference, keyId, validateRequest } from "./installation-signer.mjs";
import { catalogBytes, updateLimits, verifyCatalog } from "./update-admission.mjs";
import {
  ProductionSigningClient,
  signingClientConfiguration,
  signingClientEnvironmentConfiguration,
} from "./installation-signing-client.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export const qualificationNotes = "Internal qualification; no public release.\n";
export function signingContext(env) {
  demand(
    env.GITHUB_ACTIONS === "true" &&
      env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.GITHUB_REPOSITORY === "ohtia/ohtia" &&
      env.GITHUB_REPOSITORY_ID === "1431132416" &&
      env.GITHUB_REPOSITORY_OWNER_ID === "346940169" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch",
    "authentication_refused",
  );
  for (const key of ["GITHUB_SHA", "SIGNING_RECIPE_SHA"])
    demand(/^[a-f0-9]{40}$/.test(env[key] ?? ""));
  demand(
    env.SIGNING_RECIPE_REF ===
      `ohtia/ohtia/.github/workflows/signing-worker.yml@${env.SIGNING_RECIPE_SHA}`,
  );
  demand(/^[a-f0-9]{40}$/.test(env.SOURCE_COMMIT ?? env.GITHUB_SHA));
  const numbers = {};
  for (const [name, key] of [
    ["run", "GITHUB_RUN_ID"],
    ["attempt", "GITHUB_RUN_ATTEMPT"],
    ["job", "SIGNING_JOB_ID"],
  ]) {
    demand(/^[1-9][0-9]{0,15}$/.test(env[key] ?? ""));
    numbers[name] = positive(Number(env[key]));
  }
  return {
    ...numbers,
    source: env.SOURCE_COMMIT ?? env.GITHUB_SHA,
    main: env.GITHUB_SHA,
    worker: env.SIGNING_RECIPE_SHA,
    selection: env.SIGNING_SELECTION,
  };
}
export function qualificationControl(run, context, closure, now = Date.now()) {
  demand(
    run.id === context.run &&
      run.run_attempt === context.attempt &&
      run.head_sha === context.main &&
      run.head_branch === "main" &&
      run.event === "workflow_dispatch" &&
      run.path === ".github/workflows/installation-signing.yml",
    "policy_refused",
  );
  demand(
    typeof run.created_at === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(run.created_at),
  );
  positive(context.run);
  positive(context.attempt);
  const issued = Date.parse(run.created_at),
    expires = issued + updateLimits.catalog_lifetime_ms;
  demand(
    Number.isSafeInteger(issued) &&
      issued > 0 &&
      Number.isSafeInteger(expires) &&
      issued <= now &&
      now < expires,
    "policy_refused",
  );
  fields(closure, "inputs contracts");
  fields(closure.contracts, "versions target_schema migration_manifest_sha256");
  const version = `0.0.0-dev.${context.run}.${context.attempt}`;
  demand(
    closure.inputs.source_sha === context.source &&
      Array.isArray(closure.contracts.versions) &&
      equal(closure.contracts.versions, [
        version,
        `0.0.0-dev.${context.run}.${context.attempt + 1}`,
      ]) &&
      Number.isSafeInteger(context.attempt + 1),
  );
  positive(closure.contracts.target_schema);
  demand(/^[a-f0-9]{64}$/.test(closure.contracts.migration_manifest_sha256));
  return {
    schema_version: 1,
    sequence: context.attempt,
    issued_ms: issued,
    expires_ms: expires,
    notes_sha256: hash(Buffer.from(qualificationNotes)),
    version,
    target_schema: closure.contracts.target_schema,
  };
}
const equal = (a, b) => canonical(a).equals(canonical(b));
export function packageRequest(manifest, proofReference, context) {
  demand(
    manifest.source_commit === context.source &&
      manifest.build_execution.run_id === context.run &&
      manifest.build_execution.attempt === context.attempt &&
      manifest.build_execution.job_id !== context.job,
  );
  const request = {
    schema_version: 1,
    operation: manifest.format === "rpm" ? "rpm-sign" : "deb-bind",
    subject: {
      kind: "qualification",
      id: `qualification-${context.run}-${context.attempt}`,
      repository: "ohtia/ohtia",
      application_version: `0.0.0-dev.${context.run}.${context.attempt}`,
      source_commit: context.source,
      source_tree: manifest.source_tree,
    },
    execution: {
      workflow: ".github/workflows/installation-signing.yml",
      workflow_sha: context.main,
      run_id: context.run,
      attempt: context.attempt,
      job_id: context.job,
      invocation: `worker-${context.job}`,
    },
    artifact_id: manifest.id,
    input: { sha256: manifest.sha256, bytes: manifest.bytes },
    build_proof: proofReference,
    catalog_bindings: [],
  };
  validateRequest(canonical(request));
  return request;
}
export async function freshSigningToken(
  env,
  policy,
  context,
  { fetcher = fetch, deadline = new SigningDeadline() } = {},
) {
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  demand(
    url.protocol === "https:" &&
      url.hostname.endsWith(".actions.githubusercontent.com") &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash,
    "authentication_refused",
  );
  url.searchParams.set("audience", policy.audience);
  demand(
    typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN === "string" &&
      env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length > 0,
  );
  const response = await fetcher(url.href, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(deadline.remaining()),
  });
  demand(response.status === 200, "authority_unavailable");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    deadline.check();
    size += chunk.length;
    demand(size <= signingLimits.request_bytes, "size_refused");
    chunks.push(Buffer.from(chunk));
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  demand(
    typeof value.value === "string" && Buffer.byteLength(value.value) <= signingLimits.oidc_bytes,
  );
  const parts = value.value.split(".");
  demand(parts.length === 3);
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  // TLS authenticates this direct issuer response; the signing service independently verifies its JWT signature.
  demand(
    claims.iss === "https://token.actions.githubusercontent.com" &&
      claims.aud === policy.audience &&
      claims.repository_id === policy.repository_id &&
      claims.repository_owner_id === policy.owner_id &&
      claims.sha === context.main &&
      claims.ref === "refs/heads/main" &&
      claims.event_name === "workflow_dispatch" &&
      claims.runner_environment === "github-hosted" &&
      claims.environment === policy.environment &&
      claims.run_id === String(context.run) &&
      claims.run_attempt === String(context.attempt) &&
      claims.check_run_id === String(context.job) &&
      claims.workflow_sha === context.main &&
      claims.workflow_ref === `ohtia/ohtia/${policy.caller_workflow}@refs/heads/main` &&
      claims.job_workflow_ref ===
        `ohtia/ohtia/${policy.signing_workflow.workflow}@${context.worker}` &&
      claims.job_workflow_sha === context.worker,
    "authentication_refused",
  );
  return value.value;
}
export async function privateSigningCampaign(
  {
    configuration,
    context,
    run,
    proofDirectory,
    outputDirectory,
    gh,
    githubToken,
    invokeToken,
    token,
  },
  {
    clientFactory = (cfg) => new ProductionSigningClient(cfg, { invokeToken, token }),
    authorityFactory = (policy) =>
      new GitHubBuildAuthority(policy, {
        gh,
        job: githubReaders({ token: githubToken }).job,
        environment: {
          GH_TOKEN: githubToken,
          GH_HOST: "github.com",
          GH_CONFIG_DIR: path.join(outputDirectory, "gh-config"),
        },
      }),
    clock = Date.now,
  } = {},
) {
  const cfg = signingClientConfiguration(configuration, context.worker);
  demand(path.isAbsolute(proofDirectory) && fs.realpathSync(proofDirectory) === proofDirectory);
  demand(
    path.isAbsolute(outputDirectory) &&
      fs.realpathSync(path.dirname(outputDirectory)) === path.dirname(outputDirectory),
  );
  const read = (name) => {
    const fd = fs.openSync(
      path.join(proofDirectory, name),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    try {
      const before = fs.fstatSync(fd);
      demand(
        before.isFile() && before.nlink === 1 && before.size > 0 && before.size <= 2 * 1024 ** 2,
      );
      const bytes = Buffer.alloc(before.size + 1);
      let count = 0;
      while (count < bytes.length) {
        const n = fs.readSync(fd, bytes, count, bytes.length - count, null);
        if (!n) break;
        count += n;
      }
      const after = fs.fstatSync(fd);
      demand(
        count === before.size &&
          after.size === before.size &&
          after.mtimeMs === before.mtimeMs &&
          after.ctimeMs === before.ctimeMs,
      );
      const raw = bytes.subarray(0, count);
      if (name === "closure.json") {
        try {
          // Source paths are UTF-8 keys; preserve the producer's existing closure encoding.
          const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
          demand(catalogBytes(value).equals(raw));
          return value;
        } catch {
          throw new SigningError("contract_refused");
        }
      }
      return decode(raw, 2 * 1024 ** 2);
    } finally {
      fs.closeSync(fd);
    }
  };
  const manifest = read("manifest.json"),
    closure = read("closure.json"),
    proof = read("build-proof.json");
  demand(equal(manifest, proof.artifact) && manifest.inputs_sha256 === hash(catalogBytes(closure)));
  const target = JSON.parse(
    fs.readFileSync(path.join(root, "config/desktop/targets.json")),
  ).targets.find((t) => t.id === manifest.target);
  const profile = target?.distribution_profiles?.find((p) => p.id === manifest.profile);
  demand(
    ["linux-x64", "linux-arm64"].includes(manifest.target) &&
      profile &&
      profile.formats === undefined &&
      profile.package === manifest.format,
  );
  demand(`${manifest.target}-${manifest.profile}` === context.selection, "policy_refused");
  const control = qualificationControl(run, context, closure, clock());
  demand(manifest.native_version === control.version.replace("-", "~") + "-1", "policy_refused");
  const input = path.join(proofDirectory, `package.${manifest.format}`),
    proofFile = path.join(proofDirectory, "build-proof.json");
  const proofRef = await fileReference(proofFile, 2 * 1024 ** 2),
    request = packageRequest(manifest, proofRef, context);
  demand(equal(await fileReference(input), request.input));
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  try {
    await authorityFactory(cfg.policy).verify(input, proof, request);
    const client = clientFactory(cfg);
    const signed = await client.run(request, {
      input,
      proof: proofFile,
      output: path.join(outputDirectory, "package"),
    });
    const binding = {
      artifact_id: manifest.id,
      request_id: signed.request_id,
      ...signed.reference,
      format: manifest.format,
    };
    const catalog = {
      schema_version: 1,
      key_id: keyId(cfg.policy.catalog_public_key),
      sequence: control.sequence,
      issued_ms: control.issued_ms,
      expires_ms: control.expires_ms,
      candidate: manifest.inputs_sha256,
      source_sha: context.source,
      version: control.version,
      channels: ["preview"],
      notes_sha256: control.notes_sha256,
      packages: [
        {
          target: manifest.target,
          profile: manifest.profile,
          format: manifest.format,
          filename: `ohtia-${control.version}-${manifest.target}-${manifest.profile}.${manifest.format}`,
          ...signed.reference,
          native_version: manifest.native_version,
          schema: {
            source_min: 0,
            source_max: control.target_schema,
            target: control.target_schema,
          },
          queued_work_version: null,
        },
      ],
    };
    const catalogFile = path.join(outputDirectory, "catalog.json"),
      catalogProof = path.join(outputDirectory, "catalog-proof.json");
    fs.writeFileSync(catalogFile, catalogBytes(catalog), { flag: "wx", mode: 0o600 });
    fs.writeFileSync(catalogProof, canonical({ schema_version: 1, bindings: [binding] }), {
      flag: "wx",
      mode: 0o600,
    });
    const catalogRequest = {
      ...request,
      operation: "catalog-sign",
      artifact_id: null,
      input: await fileReference(catalogFile),
      build_proof: await fileReference(catalogProof),
      catalog_bindings: [binding],
    };
    const signedCatalog = await client.run(catalogRequest, {
      input: catalogFile,
      proof: catalogProof,
      output: path.join(outputDirectory, "catalog"),
    });
    verifyCatalog(
      fs.readFileSync(catalogFile),
      fs.readFileSync(signedCatalog.files.result),
      { keys: [{ id: catalog.key_id, public_key: cfg.policy.catalog_public_key, revoked: false }] },
      {
        now_ms: clock(),
        channel: "preview",
        preview_opt_in: true,
        execution: "internal",
        previous: null,
        installed_version: null,
        target: manifest.target,
        profile: manifest.profile,
        format: manifest.format,
        schema: control.target_schema,
        queued_work_version: null,
      },
    );
    return { package: signed, catalog: signedCatalog, control };
  } catch (error) {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const env = process.env,
    context = signingContext(env);
  const stage = env.OHTIA_SIGNING_STAGE;
  demand(typeof stage === "string" && path.isAbsolute(stage) && fs.realpathSync(stage) === stage);
  const template = JSON.parse(
    fs.readFileSync(path.join(root, "config/installation/signing-client.json")),
  );
  const cfg = signingClientEnvironmentConfiguration(template, context.worker, env);
  const configuration = {
    schema_version: template.schema_version,
    enabled: template.enabled,
    service_origin: cfg.origin,
    buckets: cfg.buckets,
    policy: template.policy,
  };
  const run = decode(fs.readFileSync(path.join(stage, "run.json")), 2 * 1024 ** 2);
  try {
    await privateSigningCampaign({
      configuration,
      context,
      run,
      proofDirectory: path.join(stage, "input"),
      outputDirectory: path.join(stage, "output"),
      gh: path.join(stage, "tools/gh"),
      githubToken: env.GITHUB_TOKEN,
      invokeToken: env.OHTIA_SIGNING_INVOKE_TOKEN,
      token: (deadline) => freshSigningToken(env, cfg.policy, context, { deadline }),
    });
    process.stdout.write("Private signing qualification completed.\n");
  } finally {
    delete env.OHTIA_SIGNING_INVOKE_TOKEN;
    delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    process.stderr.write("Private signing qualification refused.\n");
    process.exitCode = 1;
  }
}
