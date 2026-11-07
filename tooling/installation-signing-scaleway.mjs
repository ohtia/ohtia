// Explicit provider adapters; constructors do not provision resources or enable authority.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { URL } from "node:url";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  SigningError,
  currentSigningDeadline,
  canonical,
  decode,
  demand,
  digest,
  fields,
  hash,
  positive,
  reference,
  signingLimits,
} from "./installation-authority.mjs";
import { authenticatedSourceCache, fileReference } from "./installation-signer.mjs";

const budgets = JSON.parse(
  fs.readFileSync(new URL("../config/desktop/resource-policy.json", import.meta.url)),
).budgets;
const maximumObject = budgets.update_package_bytes.value;
const same = (a, b) => canonical(a).equals(canonical(b));
const missing = (e) =>
  e?.$metadata?.httpStatusCode === 404 && ["NoSuchKey", "NotFound"].includes(e.name);
const collision = (e) => e?.$metadata?.httpStatusCode === 412 && e.name === "PreconditionFailed";
function bucket(value) {
  demand(typeof value === "string" && /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(value));
  return value;
}
async function consume(stream, maximum, accept, deadline = currentSigningDeadline()) {
  let length = 0;
  const iterator = stream[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer;
      let next;
      try {
        next = await Promise.race([
          iterator.next(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new SigningError("authority_unavailable")),
              deadline.remaining(),
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (next.done) return length;
      const bytes = Buffer.from(next.value);
      length += bytes.length;
      demand(length <= maximum, "size_refused");
      await accept(bytes);
    }
  } finally {
    stream?.destroy?.();
    // Cancellation must not wait indefinitely for a stalled upstream iterator.
    Promise.resolve(iterator.return?.()).catch(() => {});
  }
}

export class ScalewaySigningStore {
  constructor({
    ingress,
    retained,
    credentials,
    client,
    presign = getSignedUrl,
    clock = Date.now,
  }) {
    this.ingress = bucket(ingress);
    this.retained = bucket(retained);
    demand(ingress !== retained);
    demand(
      client ||
        typeof credentials === "function" ||
        (credentials &&
          typeof credentials.accessKeyId === "string" &&
          credentials.accessKeyId.length > 0 &&
          typeof credentials.secretAccessKey === "string" &&
          credentials.secretAccessKey.length > 0),
      "policy_refused",
    );
    // Injected clients are trusted test/bootstrap dependencies, never request parameters.
    this.client =
      client ??
      new S3Client({
        region: "fr-par",
        endpoint: "https://s3.fr-par.scw.cloud",
        credentials,
        maxAttempts: 1,
        followRegionRedirects: false,
        requestHandler: {
          connectionTimeout: signingLimits.subprocess_ms,
          requestTimeout: signingLimits.subprocess_ms,
        },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
    this.presign = presign;
    this.clock = clock;
  }
  async send(command, deadline = currentSigningDeadline()) {
    try {
      const value = await this.client.send(command, {
        abortSignal: AbortSignal.timeout(deadline.remaining()),
      });
      deadline.check();
      return value;
    } catch (e) {
      if (missing(e) || collision(e)) throw e;
      throw new SigningError("authority_unavailable");
    }
  }
  async raw(bucket, key, maximum, accept) {
    let value;
    try {
      value = await this.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (e) {
      if (missing(e)) return null;
      throw e;
    }
    try {
      demand(
        Number.isSafeInteger(value.ContentLength) &&
          value.ContentLength >= 0 &&
          value.ContentLength <= maximum,
        "size_refused",
      );
      const size = await consume(value.Body, value.ContentLength, accept);
      demand(size === value.ContentLength);
      return size;
    } finally {
      value.Body?.destroy?.();
    }
  }
  async bytes(bucket, key, maximum) {
    const parts = [];
    const size = await this.raw(bucket, key, maximum, (part) => {
      parts.push(part);
    });
    return size === null ? null : Buffer.concat(parts);
  }
  async immutable(key, bytes) {
    demand(bytes.length <= signingLimits.request_bytes, "size_refused");
    try {
      await this.send(
        new PutObjectCommand({
          Bucket: this.retained,
          Key: key,
          Body: bytes,
          ContentLength: bytes.length,
          IfNoneMatch: "*",
        }),
      );
      return true;
    } catch (e) {
      if (collision(e)) return false;
      throw e;
    }
  }
  async objectSize(id) {
    digest(id);
    for (const Bucket of [this.retained, this.ingress]) {
      try {
        const v = await this.send(new HeadObjectCommand({ Bucket, Key: `objects/${id}` }));
        demand(positive(v.ContentLength) <= maximumObject, "size_refused");
        return v.ContentLength;
      } catch (e) {
        if (!missing(e)) throw e;
      }
    }
    throw new SigningError("authority_unavailable");
  }
  async activation() {
    return this.bytes(this.retained, "control/active.json", signingLimits.request_bytes);
  }
  async readRequest(id) {
    digest(id);
    const bytes = await this.bytes(this.retained, `objects/${id}`, signingLimits.request_bytes);
    demand(bytes !== null && hash(bytes) === id, "contract_refused");
    return bytes;
  }
  async readBytes(ref, maximum) {
    reference(ref, maximum);
    for (const b of [this.retained, this.ingress]) {
      const bytes = await this.bytes(b, `objects/${ref.sha256}`, maximum);
      if (bytes === null) continue;
      demand(bytes.length === ref.bytes && hash(bytes) === ref.sha256);
      return bytes;
    }
    throw new SigningError("authority_unavailable");
  }
  async copyObject(ref, destination) {
    reference(ref, maximumObject);
    const fd = fs.openSync(destination, "wx", 0o600);
    let success = false;
    try {
      for (const b of [this.retained, this.ingress]) {
        const sha = createHash("sha256");
        const size = await this.raw(b, `objects/${ref.sha256}`, ref.bytes, (part) => {
          sha.update(part);
          fs.writeSync(fd, part);
        });
        if (size === null) continue;
        demand(size === ref.bytes && sha.digest("hex") === ref.sha256);
        fs.fsyncSync(fd);
        success = true;
        return;
      }
      throw new SigningError("authority_unavailable");
    } finally {
      fs.closeSync(fd);
      if (!success) fs.rmSync(destination, { force: true });
    }
  }
  async putObject(file, expected) {
    reference(expected, maximumObject);
    demand(same(await fileReference(file), expected));
    const stream = fs.createReadStream(file);
    try {
      await this.send(
        new PutObjectCommand({
          Bucket: this.retained,
          Key: `objects/${expected.sha256}`,
          Body: stream,
          ContentLength: expected.bytes,
          IfNoneMatch: "*",
        }),
      );
    } catch (e) {
      if (!collision(e)) throw e;
    } finally {
      stream.destroy();
    }
    // A successful or ambiguous existing write never establishes content identity by metadata alone.
    const sha = createHash("sha256");
    const size = await this.raw(
      this.retained,
      `objects/${expected.sha256}`,
      expected.bytes,
      (part) => {
        sha.update(part);
      },
    );
    demand(size === expected.bytes && sha.digest("hex") === expected.sha256, "signing_uncertain");
    return expected;
  }
  async putBytes(bytes) {
    demand(
      Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= signingLimits.request_bytes,
      "size_refused",
    );
    const ref = { sha256: hash(bytes), bytes: bytes.length };
    await this.immutable(`objects/${ref.sha256}`, bytes);
    demand(
      (await this.bytes(this.retained, `objects/${ref.sha256}`, bytes.length))?.equals(bytes),
      "signing_uncertain",
    );
    return ref;
  }
  async read(id) {
    digest(id);
    let last = null;
    // Direct, sequential object reads avoid list pagination and a list/read consistency assumption.
    for (let revision = 0; revision <= signingLimits.journal_revisions; revision++) {
      const bytes = await this.bytes(
        this.retained,
        `journal/${id}/${String(revision).padStart(3, "0")}.json`,
        signingLimits.request_bytes,
      );
      if (bytes === null) return last;
      demand(revision < signingLimits.journal_revisions, "signing_uncertain");
      let row;
      try {
        row = decode(bytes);
      } catch {
        throw new SigningError("signing_uncertain");
      }
      demand(
        row.revision === revision && row.previous === (last ? hash(canonical(last)) : null),
        "signing_uncertain",
      );
      last = row;
    }
    throw new SigningError("signing_uncertain");
  }
  async cas(id, previous, value) {
    digest(id);
    const actual = await this.read(id);
    if (!same(actual, previous)) return null;
    const row = {
      ...structuredClone(value),
      revision: previous ? previous.revision + 1 : 0,
      previous: previous ? hash(canonical(previous)) : null,
    };
    demand(row.revision < signingLimits.journal_revisions, "signing_uncertain");
    return (await this.immutable(
      `journal/${id}/${String(row.revision).padStart(3, "0")}.json`,
      canonical(row),
    ))
      ? row
      : null;
  }
  async bindToken(jti, requestId, expires) {
    digest(requestId);
    const key = `tokens/${hash(Buffer.from(jti))}`;
    const value = canonical({ request_id: requestId, expires_ms: expires });
    if (!(await this.immutable(key, value))) {
      const prior = await this.bytes(this.retained, key, signingLimits.request_bytes);
      demand(prior?.equals(value), "authentication_refused");
    }
  }
  sourceCache(policy, worker) {
    return authenticatedSourceCache(this, policy, worker);
  }
  async uploadTicket(ref) {
    reference(ref, maximumObject);
    const command = new PutObjectCommand({
      Bucket: this.ingress,
      Key: `objects/${ref.sha256}`,
      ContentLength: ref.bytes,
      ChecksumSHA256: Buffer.from(ref.sha256, "hex").toString("base64"),
      IfNoneMatch: "*",
    });
    return this.ticket(command, this.ingress, ref.sha256, true);
  }
  async downloadTicket(ref) {
    reference(ref, maximumObject);
    const v = await this.send(
      new HeadObjectCommand({ Bucket: this.retained, Key: `objects/${ref.sha256}` }),
    );
    demand(v.ContentLength === ref.bytes);
    return this.ticket(
      new GetObjectCommand({ Bucket: this.retained, Key: `objects/${ref.sha256}` }),
      this.retained,
      ref.sha256,
      false,
    );
  }
  async ticket(command, selectedBucket, id, upload) {
    const url = await this.presign(this.client, command, {
      expiresIn: signingLimits.transfer_seconds,
      unhoistableHeaders: new Set(upload ? ["x-amz-checksum-sha256"] : []),
      signableHeaders: new Set(
        upload ? ["content-length", "if-none-match", "x-amz-checksum-sha256"] : [],
      ),
    });
    const parsed = new URL(url);
    demand(
      parsed.protocol === "https:" &&
        parsed.hostname === `${selectedBucket}.s3.fr-par.scw.cloud` &&
        parsed.port === "" &&
        !parsed.username &&
        !parsed.password &&
        parsed.pathname === `/objects/${id}` &&
        !parsed.hash,
      "policy_refused",
    );
    return { url, expires_at_ms: this.clock() + signingLimits.transfer_seconds * 1000 };
  }
}

// Readback exposes selected configuration and secret names, never secret values.
export class ScalewaySigningDeployment {
  constructor({ token, fetcher = fetch, deadline = currentSigningDeadline }) {
    demand(
      typeof token === "function" &&
        typeof fetcher === "function" &&
        typeof deadline === "function",
    );
    this.token = token;
    this.fetcher = fetcher;
    this.deadline = deadline;
  }
  async #snapshot(kind, id, names) {
    demand(
      typeof id === "string" &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id) &&
        id !== "00000000-0000-0000-0000-000000000000",
      "policy_refused",
    );
    demand(kind === "containers" || kind === "namespaces");
    const parts = [];
    let bytes;
    let response;
    try {
      const deadline = this.deadline();
      const token = await this.token();
      demand(typeof token === "string" && token.length > 0, "authority_unavailable");
      deadline.check();
      response = await this.fetcher(
        `https://api.scaleway.com/containers/v1/regions/fr-par/${kind}/${id}`,
        {
          method: "GET",
          redirect: "error",
          headers: { "X-Auth-Token": token, "Accept-Encoding": "identity" },
          signal: AbortSignal.timeout(deadline.remaining()),
        },
      );
      demand(response.status === 200, "authority_unavailable");
      demand(
        (response.headers.get("content-encoding") ?? "identity").trim().toLowerCase() ===
          "identity",
        "authority_unavailable",
      );
      const header = response.headers.get("content-length");
      if (header !== null)
        demand(
          /^(?:0|[1-9][0-9]*)$/.test(header) &&
            Number.isSafeInteger(Number(header)) &&
            Number(header) <= signingLimits.deployment_readback_bytes,
          "authority_unavailable",
        );
      await consume(
        response.body,
        signingLimits.deployment_readback_bytes,
        (part) => parts.push(part),
        deadline,
      );
      bytes = Buffer.concat(parts);
      demand(header === null || Number(header) === bytes.length, "authority_unavailable");
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      demand(value && Object.getPrototypeOf(value) === Object.prototype, "authority_unavailable");
      demand(value.id === id, "policy_refused");
      const secrets = value.secret_environment_variables;
      demand(
        secrets && Object.getPrototypeOf(secrets) === Object.prototype,
        "authority_unavailable",
      );
      deadline.check();
      return {
        ...Object.fromEntries(names.map((name) => [name, value[name]])),
        secret_environment_names: Object.keys(secrets).sort(),
        has_error: value.error_message !== null && value.error_message !== "",
      };
    } catch (error) {
      if (error instanceof SigningError && error.code === "policy_refused") throw error;
      throw new SigningError("authority_unavailable");
    } finally {
      bytes?.fill(0);
      for (const part of parts) part.fill(0);
      Promise.resolve(response?.body?.cancel?.()).catch(() => {});
    }
  }
  container(id) {
    return this.#snapshot("containers", id, [
      "id",
      "namespace_id",
      "region",
      "status",
      "image",
      "environment_variables",
      "min_scale",
      "max_scale",
      "memory_limit_bytes",
      "mvcpu_limit",
      "local_storage_limit_bytes",
      "timeout",
      "privacy",
      "protocol",
      "port",
      "https_connections_only",
      "sandbox",
      "scaling_option",
      "command",
      "args",
      "private_network_id",
      "default_public_endpoint_enabled",
    ]);
  }
  namespace(id) {
    return this.#snapshot("namespaces", id, [
      "id",
      "project_id",
      "region",
      "status",
      "environment_variables",
    ]);
  }
}

export class ScalewaySigningSecrets {
  constructor({ token, versions, fetcher = fetch, deadline = currentSigningDeadline }) {
    fields(versions, "rpm rpm_passphrase catalog catalog_passphrase");
    this.versions = structuredClone(versions);
    this.token = token;
    this.fetcher = fetcher;
    this.deadline = deadline;
    for (const ref of Object.values(this.versions)) {
      fields(ref, "secret_id revision");
      demand(
        typeof ref.secret_id === "string" &&
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(ref.secret_id),
      );
      positive(ref.revision);
    }
    demand(new Set(Object.values(versions).map((r) => r.secret_id)).size === 4);
  }
  async access(role) {
    const ref = this.versions[role];
    demand(ref);
    try {
      const deadline = this.deadline();
      const response = await this.fetcher(
        `https://api.scaleway.com/secret-manager/v1beta1/regions/fr-par/secrets/${ref.secret_id}/versions/${ref.revision}/access`,
        {
          method: "GET",
          redirect: "error",
          headers: { "X-Auth-Token": await this.token() },
          signal: AbortSignal.timeout(deadline.remaining()),
        },
      );
      demand(response.status === 200, "authority_unavailable");
      const parts = [];
      // The provider's 64 KiB decoded payload is bounded again after base64 decoding.
      await consume(
        response.body,
        signingLimits.jwks_bytes,
        (part) => {
          parts.push(part);
        },
        deadline,
      );
      const bytes = Buffer.concat(parts);
      try {
        const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        demand(
          value.secret_id === ref.secret_id &&
            value.revision === ref.revision &&
            value.type === "opaque" &&
            typeof value.data === "string",
        );
        const secret = Buffer.from(value.data, "base64");
        if (
          secret.length === 0 ||
          secret.length > signingLimits.request_bytes ||
          secret.toString("base64") !== value.data
        ) {
          secret.fill(0);
          throw new SigningError("policy_refused");
        }
        return secret;
      } finally {
        bytes.fill(0);
        for (const part of parts) part.fill(0);
      }
    } catch (e) {
      if (e instanceof SigningError) throw e;
      throw new SigningError("authority_unavailable");
    }
  }
  async pair(keyRole, passphraseRole) {
    const key = await this.access(keyRole);
    try {
      return { key, passphrase: await this.access(passphraseRole) };
    } catch (e) {
      key.fill(0);
      throw e;
    }
  }
  rpm() {
    return this.pair("rpm", "rpm_passphrase");
  }
  catalog() {
    return this.pair("catalog", "catalog_passphrase");
  }
}
