import { performance } from "node:perf_hooks";
import { URL, fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
// Trusted source, caller and build-proof verification for the external signing boundary.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";

const budgetRecord = JSON.parse(
  fs.readFileSync(new URL("../config/desktop/resource-policy.json", import.meta.url)),
);
export const signingLimits = Object.freeze(
  Object.fromEntries(
    Object.entries(budgetRecord.budgets)
      .filter(([k]) => k.startsWith("signing_"))
      .map(([k, v]) => [k.slice(8), v.value]),
  ),
);
export class SigningDeadline {
  constructor(milliseconds = signingLimits.execution_ms) {
    demand(Number.isSafeInteger(milliseconds) && milliseconds > 0);
    this.end = performance.now() + milliseconds;
  }
  check(code = "authority_unavailable") {
    demand(performance.now() < this.end, code);
  }
  reserve(milliseconds) {
    demand(Number.isSafeInteger(milliseconds) && milliseconds > 0);
    const child = Object.create(SigningDeadline.prototype);
    child.end = this.end - milliseconds;
    child.check();
    return child;
  }
  remaining(maximum = signingLimits.subprocess_ms) {
    this.check();
    return Math.max(1, Math.floor(Math.min(maximum, this.end - performance.now())));
  }
}
const deadlineContext = new AsyncLocalStorage();
export const currentSigningDeadline = () => deadlineContext.getStore() ?? new SigningDeadline();
export const withSigningDeadline = (deadline, operation) =>
  deadlineContext.run(deadline, operation);

export class SigningError extends Error {
  constructor(code = "policy_refused") {
    super(code);
    this.code = code;
  }
}
// Only a trusted native preflight can establish a deterministic, effect-free refusal.
export class DeterministicSigningRefusal extends SigningError {}

export function demand(condition, code = "contract_refused") {
  if (!condition) throw new SigningError(code);
}
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function canonical(value) {
  function normalized(item, depth = 0) {
    demand(depth <= 24);
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") {
      demand(Number.isSafeInteger(item) && !Object.is(item, -0));
      return item;
    }
    if (typeof item === "string") {
      demand(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item));
      return item;
    }
    if (Array.isArray(item)) return item.map((x) => normalized(x, depth + 1));
    demand(item && Object.getPrototypeOf(item) === Object.prototype);
    return Object.fromEntries(
      Object.keys(item)
        .sort()
        .map((k) => {
          demand(/^[\x20-\x7e]+$/.test(k));
          return [k, normalized(item[k], depth + 1)];
        }),
    );
  }
  return Buffer.from(JSON.stringify(normalized(value)) + "\n");
}
export function decode(bytes, maximum = signingLimits.request_bytes) {
  demand(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximum, "size_refused");
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    demand(canonical(value).equals(bytes));
    return value;
  } catch (error) {
    if (error instanceof SigningError) throw error;
    throw new SigningError("contract_refused");
  }
}
export function fields(value, names) {
  demand(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === names.split(" ").length &&
      names.split(" ").every((k) => Object.hasOwn(value, k)),
  );
}
export function digest(value, length = 64) {
  demand(typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value));
  return value;
}
export function identifier(value) {
  demand(typeof value === "string" && /^[a-z][a-z0-9-]{0,127}$/.test(value));
  return value;
}
export function positive(value) {
  demand(Number.isSafeInteger(value) && value > 0);
  return value;
}
export function reference(value, maximum) {
  fields(value, "sha256 bytes");
  digest(value.sha256);
  demand(positive(value.bytes) <= maximum, "size_refused");
}
export function execution(value) {
  fields(value, "workflow workflow_sha run_id attempt job_id invocation");
  demand(
    typeof value.workflow === "string" &&
      /^\.github\/workflows\/[a-z0-9-]+\.yml$/.test(value.workflow),
  );
  digest(value.workflow_sha, 40);
  for (const k of ["run_id", "attempt", "job_id"]) positive(value[k]);
  demand(typeof value.invocation === "string" && /^[a-zA-Z0-9._-]{1,128}$/.test(value.invocation));
}
export function subject(value) {
  fields(value, "kind id repository application_version source_commit source_tree");
  demand(value.kind === "qualification" && value.repository === "ohtia/ohtia");
  identifier(value.id);
  demand(
    typeof value.application_version === "string" &&
      /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-dev\.[1-9]\d*\.[1-9]\d*$/.test(
        value.application_version,
      ),
  );
  digest(value.source_commit, 40);
  digest(value.source_tree, 40);
}
export function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
export function trustedPolicy(policy) {
  fields(
    policy,
    "schema_version enabled repository_id owner_id audience environment caller_workflow signing_workflow build_workflow source_anchor source_signers catalog_public_key rpm_primary rpm_subkey deployment",
  );
  demand(policy.schema_version === 1 && typeof policy.enabled === "boolean");
  demand(policy.repository_id === "1431132416" && policy.owner_id === "346940169");
  demand(typeof policy.audience === "string" && /^[a-z0-9:/.\-]{1,256}$/.test(policy.audience));
  identifier(policy.environment);
  for (const w of [policy.signing_workflow, policy.build_workflow]) {
    fields(w, "workflow sha");
    demand(/^\.github\/workflows\/[a-z0-9-]+\.yml$/.test(w.workflow));
    digest(w.sha, 40);
  }
  demand(/^\.github\/workflows\/[a-z0-9-]+\.yml$/.test(policy.caller_workflow));
  digest(policy.source_anchor, 40);
  demand(
    Array.isArray(policy.source_signers) &&
      policy.source_signers.length > 0 &&
      policy.source_signers.length <= 32,
  );
  for (const s of policy.source_signers) {
    fields(s, "principal public_key");
    demand(
      /^[a-zA-Z0-9@._-]+$/.test(s.principal) &&
        /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(s.public_key),
    );
  }
  demand(
    typeof policy.catalog_public_key === "string" &&
      /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n$/.test(
        policy.catalog_public_key,
      ),
  );
  digest(policy.rpm_primary, 40);
  digest(policy.rpm_subkey, 40);
  demand(policy.rpm_primary !== policy.rpm_subkey);
  fields(policy.deployment, "provider region container_id image_digest");
  demand(
    policy.deployment.provider === "scaleway-serverless-containers" &&
      policy.deployment.region === "fr-par",
  );
  demand(
    /^[a-f0-9-]{36}$/.test(policy.deployment.container_id) &&
      /^sha256:[a-f0-9]{64}$/.test(policy.deployment.image_digest),
  );
  return deepFreeze(structuredClone(policy));
}

// Output and time bounds apply before returning any child output to a parser.
export async function command(
  program,
  args,
  {
    cwd,
    stdin,
    env = {},
    maximum = 262144,
    timeout = signingLimits.subprocess_ms,
    deadline = currentSigningDeadline(),
  } = {},
) {
  demand(process.platform === "linux" && path.isAbsolute(program));
  const duration = deadline.remaining(Math.min(timeout, signingLimits.subprocess_ms));
  const expires = process.hrtime.bigint() + BigInt(duration) * 1000000n;
  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./installation-signing-runner.mjs", import.meta.url)),
          "supervisor",
          String(expires),
          program,
          ...args,
        ],
        {
          cwd,
          env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", ...env },
          stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
          detached: true,
        },
      );
    } catch {
      reject(new SigningError("authority_unavailable"));
      return;
    }
    let output = [],
      errors = [],
      size = 0,
      failed = false,
      failureCode = "authority_unavailable",
      settled = false;
    let timer;
    child.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new SigningError("authority_unavailable"));
      }
    });
    // EMFILE/ENFILE can return a ChildProcess without any stdio handles.
    if (!child.stdin || !child.stdout || !child.stderr || !child.stdio?.[3] || !child.stdio?.[4]) {
      settled = true;
      for (const stream of child.stdio ?? []) {
        stream?.on("error", () => {});
        stream?.destroy();
      }
      reject(new SigningError("authority_unavailable"));
      return;
    }
    const stop = (code = "authority_unavailable") => {
      if (failed) return;
      failed = true;
      failureCode = code;
      // Abort through a dedicated pipe; the live supervisor signals its own group.
      child.stdio[4].end("abort");
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    };
    timer = setTimeout(stop, duration);
    const collect = (destination) => (chunk) => {
      size += chunk.length;
      if (size > maximum) stop("size_refused");
      else destination.push(chunk);
    };
    child.stdout.on("data", collect(output));
    child.stderr.on("data", collect(errors));
    let completion = "";
    child.stdio[3].on("data", (bytes) => {
      completion += bytes.toString();
      if (completion.length > 2) stop();
    });
    child.stdio[4].on("error", () => {});
    child.once("exit", () => {
      child.stdio[4].destroy();
      child.stdin.destroy();
    });
    child.on("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (failed) reject(new SigningError(failureCode));
        else if (process.hrtime.bigint() >= expires || !["0\n", "1\n"].includes(completion))
          reject(new SigningError("authority_unavailable"));
        else if (completion === "1\n") reject(new SigningError("operation_failed"));
        else resolve(Buffer.concat(output));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

export class OidcAuthority {
  constructor(policy, { jwks, job, clock = Date.now }) {
    this.policy = trustedPolicy(policy);
    this.jwks = jwks;
    this.job = job;
    this.clock = clock;
  }
  async verify(token, request) {
    try {
      demand(this.policy.enabled, "policy_refused");
      demand(
        typeof token === "string" && Buffer.byteLength(token) <= signingLimits.oidc_bytes,
        "authentication_refused",
      );
      let raw;
      try {
        raw = await this.jwks();
      } catch (error) {
        if (error instanceof SigningError) throw error;
        throw new SigningError("authority_unavailable");
      }
      demand(
        Buffer.isBuffer(raw) && raw.length <= signingLimits.jwks_bytes,
        "authority_unavailable",
      );
      let keyset;
      try {
        keyset = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      } catch {
        throw new SigningError("authority_unavailable");
      }
      demand(
        keyset &&
          Object.getPrototypeOf(keyset) === Object.prototype &&
          Array.isArray(keyset.keys) &&
          keyset.keys.length > 0 &&
          keyset.keys.length <= signingLimits.jwks_keys,
        "authority_unavailable",
      );
      demand(
        keyset.keys.every(
          (k) =>
            k &&
            Object.getPrototypeOf(k) === Object.prototype &&
            k.kty === "RSA" &&
            typeof k.kid === "string" &&
            !Object.hasOwn(k, "d"),
        ) && new Set(keyset.keys.map((k) => k.kid)).size === keyset.keys.length,
        "authority_unavailable",
      );
      let resolver;
      try {
        resolver = createLocalJWKSet(keyset);
        for (const jwk of keyset.keys) {
          demand(
            !["d", "p", "q", "dp", "dq", "qi", "oth"].some((field) => Object.hasOwn(jwk, field)),
            "authority_unavailable",
          );
          // Validate metadata eligibility through the same established resolver used for JWTs.
          const key = await resolver({ alg: "RS256", kid: jwk.kid });
          demand(
            key.type === "public" && key.algorithm.modulusLength >= 2048,
            "authority_unavailable",
          );
        }
      } catch {
        throw new SigningError("authority_unavailable");
      }
      const { payload: p } = await jwtVerify(token, resolver, {
        issuer: "https://token.actions.githubusercontent.com",
        audience: this.policy.audience,
        algorithms: ["RS256"],
        typ: "JWT",
        maxTokenAge: signingLimits.oidc_lifetime_seconds,
        requiredClaims: ["exp", "iat", "nbf", "jti", "sub"],
        currentDate: new Date(this.clock()),
        clockTolerance: 0,
      });
      demand(
        Number.isSafeInteger(p.iat) &&
          Number.isSafeInteger(p.exp) &&
          p.exp - p.iat > 0 &&
          p.exp - p.iat <= signingLimits.oidc_lifetime_seconds,
        "authentication_refused",
      );
      demand(
        p.repository === "ohtia/ohtia" &&
          p.repository_id === this.policy.repository_id &&
          p.repository_owner_id === this.policy.owner_id &&
          p.ref === "refs/heads/main" &&
          p.event_name === "workflow_dispatch" &&
          p.runner_environment === "github-hosted" &&
          p.environment === this.policy.environment,
        "authentication_refused",
      );
      demand(
        [
          `repo:ohtia/ohtia:environment:${this.policy.environment}`,
          `repo:ohtia@${this.policy.owner_id}/ohtia@${this.policy.repository_id}:environment:${this.policy.environment}`,
        ].includes(p.sub),
        "authentication_refused",
      );
      const e = request.execution;
      demand(
        p.sha === request.subject.source_commit &&
          p.workflow_sha === p.sha &&
          p.workflow_ref === `ohtia/ohtia/${this.policy.caller_workflow}@refs/heads/main`,
        "authentication_refused",
      );
      demand(
        p.job_workflow_ref ===
          `ohtia/ohtia/${this.policy.signing_workflow.workflow}@${this.policy.signing_workflow.sha}` &&
          p.job_workflow_sha === this.policy.signing_workflow.sha,
        "authentication_refused",
      );
      demand(
        p.run_id === String(e.run_id) &&
          p.run_attempt === String(e.attempt) &&
          e.workflow === this.policy.caller_workflow &&
          e.workflow_sha === p.workflow_sha &&
          /^[1-9]\d*$/.test(p.check_run_id) &&
          typeof p.jti === "string" &&
          p.jti.length <= 128,
        "authentication_refused",
      );
      let job;
      try {
        job = await this.job(e.job_id);
      } catch (error) {
        if (error instanceof SigningError) throw error;
        throw new SigningError("authority_unavailable");
      }
      demand(
        job.id === e.job_id &&
          job.run_id === e.run_id &&
          job.run_attempt === e.attempt &&
          job.head_sha === p.sha &&
          job.status === "in_progress" &&
          job.check_run_url ===
            `https://api.github.com/repos/ohtia/ohtia/check-runs/${p.check_run_id}`,
        "authentication_refused",
      );
      return deepFreeze({
        jti: p.jti,
        expires_ms: p.exp * 1000,
        execution: structuredClone(e),
        source_commit: p.sha,
      });
    } catch (error) {
      if (
        error instanceof SigningError &&
        ["policy_refused", "authority_unavailable"].includes(error.code)
      )
        throw error;
      throw new SigningError("authentication_refused");
    }
  }
}

// Only trusted bootstrap code supplies these readers; request data never selects origins.
export function githubReaders({ fetcher = fetch, token, clock = Date.now } = {}) {
  async function read(url, maximum) {
    try {
      const headers = { Accept: "application/vnd.github+json" };
      if (token && new URL(url).hostname === "api.github.com")
        headers.Authorization = `Bearer ${token}`;
      const response = await fetcher(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(currentSigningDeadline().remaining()),
      });
      demand(response.ok, "authority_unavailable");
      let count = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        count += chunk.length;
        demand(count <= maximum, "authority_unavailable");
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof SigningError) throw error;
      throw new SigningError("authority_unavailable");
    }
  }

  let cache;
  return {
    jwks: async () => {
      const now = clock();
      if (!cache || now >= cache.until) {
        cache = {
          until: now + signingLimits.jwks_cache_ms,
          bytes: await read(
            "https://token.actions.githubusercontent.com/.well-known/jwks",
            signingLimits.jwks_bytes,
          ),
        };
      }
      return Buffer.from(cache.bytes);
    },
    job: async (id) => {
      positive(id);
      return JSON.parse(
        await read(
          `https://api.github.com/repos/ohtia/ohtia/actions/jobs/${id}`,
          signingLimits.request_bytes,
        ),
      );
    },
  };
}

export class GitSourceAuthority {
  constructor(
    policy,
    { repository, git = "/usr/bin/git", sshKeygen = "/usr/bin/ssh-keygen", cache },
  ) {
    this.policy = trustedPolicy(policy);
    demand(path.isAbsolute(repository));
    this.repository = repository;
    this.git = git;
    this.sshKeygen = sshKeygen;
    this.cache = cache;
  }
  async inspect(source, expectedTree, { deadline = new SigningDeadline() } = {}) {
    digest(source, 40);
    digest(expectedTree, 40);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-source-"));
    fs.chmodSync(dir, 0o700);
    try {
      const allowed = path.join(dir, "allowed-signers");
      fs.writeFileSync(
        allowed,
        this.policy.source_signers.map((s) => `${s.principal} ${s.public_key}\n`).join(""),
        { mode: 0o600 },
      );
      let work = this.repository;

      const gitOutput = async (maximum, ...args) =>
        (
          await command(
            this.git,
            [
              "-c",
              "core.hooksPath=/dev/null",
              "-c",
              "core.fsmonitor=false",
              "-c",
              "core.attributesFile=/dev/null",
              "-c",
              `gpg.ssh.program=${this.sshKeygen}`,
              "-c",
              `gpg.ssh.allowedSignersFile=${allowed}`,
              "-c",
              "gpg.format=ssh",
              "-c",
              "gpg.program=/bin/false",
              "-c",
              "gpg.x509.program=/bin/false",
              ...args,
            ],
            {
              cwd: work,
              deadline,
              maximum,
              env: {
                GIT_CONFIG_NOSYSTEM: "1",
                GIT_CONFIG_GLOBAL: "/dev/null",
                GIT_NO_REPLACE_OBJECTS: "1",
                GIT_NO_LAZY_FETCH: "1",
                GIT_TERMINAL_PROMPT: "0",
              },
            },
          )
        )
          .toString()
          .trim();
      const git = (...args) => gitOutput(signingLimits.jwks_bytes, ...args);
      demand((await git("rev-parse", "--is-shallow-repository")) === "false", "policy_refused");
      const originalGraft = await git("rev-parse", "--git-path", "info/grafts");
      demand(!fs.existsSync(path.resolve(this.repository, originalGraft)), "policy_refused");
      const objects = fs.realpathSync(
        path.resolve(this.repository, await git("rev-parse", "--git-path", "objects")),
      );
      // Never execute merge drivers, hooks or helpers from the supplied repository configuration.
      const bare = path.join(dir, "repository.git");
      await git("init", "--bare", "--template=", bare);
      fs.writeFileSync(path.join(bare, "objects/info/alternates"), objects + "\n", { mode: 0o600 });
      work = bare;
      demand((await git("rev-parse", `${source}^{tree}`)) === expectedTree, "policy_refused");
      // A shallow boundary, replacement or graft can hide unsigned ancestry.
      demand((await git("rev-parse", "--is-shallow-repository")) === "false", "policy_refused");
      const graft = await git("rev-parse", "--git-path", "info/grafts");
      demand(!fs.existsSync(path.resolve(this.repository, graft)), "policy_refused");
      await git("merge-base", "--is-ancestor", this.policy.source_anchor, source);
      const policyHash = hash(canonical(this.policy));
      const pending = [],
        seen = new Set();
      const known = new Set([this.policy.source_anchor]);
      let uncached = 0;
      const visit = async (commit) => {
        digest(commit, 40);
        if (known.has(commit) || seen.has(commit)) return;
        try {
          await git("merge-base", "--is-ancestor", commit, this.policy.source_anchor);
          known.add(commit);
          return;
        } catch (error) {
          if (
            error instanceof SigningError &&
            ["authority_unavailable", "size_refused"].includes(error.code)
          )
            throw error;
          /* Not in the independently trusted anchor history. */
        }
        seen.add(commit);
        const tree = await git("rev-parse", `${commit}^{tree}`);
        const cached = await this.cache?.get(`${policyHash}/${commit}`);
        if (cached) {
          demand(
            cached.commit === commit && cached.tree === tree && cached.policy_sha256 === policyHash,
            "policy_refused",
          );
          known.add(commit);
          return;
        }
        demand(++uncached <= signingLimits.source_commits, "size_refused");
        const parents = (await git("show", "-s", "--format=%P", commit)).split(" ").filter(Boolean);
        demand(parents.length > 0 && parents.length <= 2, "policy_refused");
        for (const parent of parents) await visit(parent);
        pending.push({ commit, tree, parents });
      };
      await visit(source);
      const records = [];
      if (pending.length) {
        const ids = (
          await gitOutput(
            (signingLimits.source_objects + 1) * 41,
            "rev-list",
            "--objects",
            "--no-object-names",
            ...pending.map((r) => r.commit),
            "--not",
            ...known,
          )
        )
          .split("\n")
          .filter(Boolean);
        demand(ids.length <= signingLimits.source_objects, "size_refused");
        ids.forEach((id) => digest(id, 40));
        const sizes = await command(
          this.git,
          ["--git-dir", bare, "cat-file", "--batch-check=%(objectsize)"],
          {
            cwd: bare,
            stdin: Buffer.from(ids.join("\n") + "\n"),
            maximum: signingLimits.source_objects * 24,
            deadline,
            env: {
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: "/dev/null",
              GIT_NO_REPLACE_OBJECTS: "1",
              GIT_NO_LAZY_FETCH: "1",
            },
          },
        );
        let total = 0;
        for (const line of sizes.toString().trim().split("\n")) {
          demand(/^\d+$/.test(line), "policy_refused");
          total += Number(line);
          demand(
            Number.isSafeInteger(total) && total <= signingLimits.source_bytes,
            "size_refused",
          );
        }
      }
      for (const { commit, tree, parents } of pending) {
        demand(
          parents.every((p) => known.has(p)),
          "policy_refused",
        );
        let signed = false;
        try {
          await git("verify-commit", commit);
          signed = true;
        } catch (error) {
          if (error instanceof SigningError && error.code === "authority_unavailable") throw error;
          /* A personal signature or an exactly reproduced clean merge is mandatory. */
        }
        if (!signed) {
          demand(parents.length === 2, "policy_refused");
          const merged = (await git("merge-tree", "--write-tree", ...parents)).split("\n")[0];
          demand(merged === tree, "policy_refused");
        }
        const record = {
          commit,
          tree,
          policy_sha256: policyHash,
          kind: signed ? "personal-signature" : "clean-merge",
        };
        await this.cache?.put(`${policyHash}/${commit}`, record, { deadline });
        records.push(record);
        known.add(commit);
      }
      return {
        source_commit: source,
        source_tree: expectedTree,
        anchor: this.policy.source_anchor,
        records,
      };
    } catch (error) {
      if (
        error instanceof SigningError &&
        ["size_refused", "authority_unavailable"].includes(error.code)
      )
        throw error;
      throw new SigningError(
        error instanceof SigningError ? "policy_refused" : "authority_unavailable",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

export function verifyBuildResult(result, request, policy, artifact) {
  const cert = result?.signature?.certificate,
    statement = result?.statement;
  demand(
    cert &&
      cert.issuer === "https://token.actions.githubusercontent.com" &&
      cert.sourceRepositoryURI === "https://github.com/ohtia/ohtia" &&
      cert.sourceRepositoryIdentifier === policy.repository_id &&
      cert.sourceRepositoryOwnerIdentifier === policy.owner_id &&
      cert.sourceRepositoryDigest === request.subject.source_commit &&
      cert.sourceRepositoryRef === "refs/heads/main" &&
      cert.runnerEnvironment === "github-hosted" &&
      cert.buildTrigger === "workflow_dispatch",
    "policy_refused",
  );
  demand(
    cert.buildSignerURI ===
      `https://github.com/ohtia/ohtia/${policy.build_workflow.workflow}@${policy.build_workflow.sha}` &&
      cert.buildSignerDigest === policy.build_workflow.sha,
    "policy_refused",
  );
  const expected = `https://github.com/ohtia/ohtia/actions/runs/${artifact.build_execution.run_id}/attempts/${artifact.build_execution.attempt}`;
  demand(
    cert.runInvocationURI === expected &&
      Array.isArray(result.verifiedTimestamps) &&
      result.verifiedTimestamps.length > 0,
    "policy_refused",
  );
  demand(
    statement?.predicateType === "https://slsa.dev/provenance/v1" &&
      Array.isArray(statement.subject) &&
      statement.subject.some((s) => s.digest?.sha256 === request.input.sha256),
    "policy_refused",
  );
  // The pinned builder, not the caller, owns this exact manifest in its authenticated predicate.
  const bound = statement.predicate?.buildDefinition?.externalParameters?.ohtia;
  demand(bound && canonical(bound).equals(canonical(artifact)), "policy_refused");
  return true;
}

export class GitHubBuildAuthority {
  constructor(policy, { gh = "/usr/bin/gh", environment = {}, job, runner = command } = {}) {
    this.policy = trustedPolicy(policy);
    this.gh = gh;
    this.environment = { ...environment };
    this.run = runner;
    this.job = job;
  }
  async verify(input, proof, request, { deadline = new SigningDeadline() } = {}) {
    fields(proof, "schema_version artifact bundle");
    demand(proof.schema_version === 1 && typeof proof.bundle === "string");
    const artifact = proof.artifact;
    fields(
      artifact,
      "id target profile format native_version source_commit source_tree inputs_sha256 sha256 bytes build_execution",
    );
    identifier(artifact.id);
    execution(artifact.build_execution);
    digest(artifact.inputs_sha256);
    demand(
      artifact.source_commit === request.subject.source_commit &&
        artifact.source_tree === request.subject.source_tree &&
        artifact.sha256 === request.input.sha256 &&
        artifact.bytes === request.input.bytes,
      "policy_refused",
    );
    demand(
      artifact.build_execution.workflow === this.policy.build_workflow.workflow &&
        artifact.build_execution.workflow_sha === this.policy.build_workflow.sha &&
        artifact.build_execution.job_id !== request.execution.job_id,
      "policy_refused",
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-build-proof-"));
    try {
      const bundle = path.join(dir, "bundle.jsonl");
      fs.writeFileSync(bundle, proof.bundle, { mode: 0o600 });
      const raw = await this.run(
        this.gh,
        [
          "attestation",
          "verify",
          input,
          "--repo",
          "ohtia/ohtia",
          "--bundle",
          bundle,
          "--signer-workflow",
          `ohtia/ohtia/${this.policy.build_workflow.workflow}`,
          "--signer-digest",
          this.policy.build_workflow.sha,
          "--source-digest",
          request.subject.source_commit,
          "--source-ref",
          "refs/heads/main",
          "--deny-self-hosted-runners",
          "--format",
          "json",
        ],
        { env: this.environment, maximum: signingLimits.jwks_bytes, deadline },
      );
      const results = JSON.parse(raw);
      demand(
        Array.isArray(results) && results.length > 0 && results.length <= 32,
        "policy_refused",
      );
      demand(
        results.some((r) => {
          try {
            return verifyBuildResult(r.verificationResult, request, this.policy, artifact);
          } catch {
            return false;
          }
        }),
        "policy_refused",
      );
      demand(typeof this.job === "function", "authority_unavailable");
      const actual = await this.job(artifact.build_execution.job_id);
      if (actual.status !== "completed") throw new SigningError("authority_unavailable");
      demand(
        actual.id === artifact.build_execution.job_id &&
          actual.run_id === artifact.build_execution.run_id &&
          actual.run_attempt === artifact.build_execution.attempt &&
          actual.head_sha === request.subject.source_commit &&
          actual.status === "completed" &&
          actual.conclusion === "success",
        "policy_refused",
      );
      deadline.check();
      return structuredClone(artifact);
    } catch (error) {
      if (error instanceof SigningError) throw error;
      throw new SigningError(
        error instanceof SigningError ? "policy_refused" : "authority_unavailable",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
