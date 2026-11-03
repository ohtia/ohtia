// Fixed-origin private signing transport; no candidate code or publisher key is executed here.
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { finished } from "node:stream/promises";
import {
  SigningDeadline,
  SigningError,
  canonical,
  decode,
  demand,
  fields,
  hash,
  reference,
  signingLimits,
  trustedPolicy,
} from "./installation-authority.mjs";
import { fileReference, validateRequest, verifyReceipt } from "./installation-signer.mjs";
import { updateLimits } from "./update-admission.mjs";

const codes = new Set([
  "authentication_refused",
  "policy_refused",
  "request_conflict",
  "signing_uncertain",
  "size_refused",
  "contract_refused",
  "authority_unavailable",
  "operation_failed",
]);
const equal = (a, b) => canonical(a).equals(canonical(b));
const closed = async (response) => {
  try {
    await response.body?.cancel();
  } catch {}
};
const transient = (status) => [500, 502, 503, 504].includes(status);
function origin(value) {
  demand(typeof value === "string" && value.length <= 512);
  const url = new URL(value);
  demand(
    url.protocol === "https:" &&
      url.origin === value &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "policy_refused",
  );
  return url.origin;
}
export function signingClientConfiguration(value, workerSha) {
  fields(value, "schema_version enabled service_origin buckets policy");
  demand(value.schema_version === 1 && value.enabled === true, "policy_refused");
  const service = origin(value.service_origin);
  demand(new URL(service).hostname.endsWith(".fnc.fr-par.scw.cloud"), "policy_refused");
  fields(value.buckets, "ingress retained");
  for (const bucket of Object.values(value.buckets))
    demand(typeof bucket === "string" && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket));
  demand(value.buckets.ingress !== value.buckets.retained);
  fields(
    value.policy,
    "repository_id owner_id audience environment caller_workflow build_workflow source_anchor source_signers catalog_public_key rpm_primary rpm_subkey deployment",
  );
  const policy = trustedPolicy({
    schema_version: 1,
    enabled: true,
    ...value.policy,
    signing_workflow: { workflow: ".github/workflows/signing-worker.yml", sha: workerSha },
  });
  demand(
    policy.environment === "installation-signing" &&
      policy.audience === "ohtia:installation-signing" &&
      policy.caller_workflow === ".github/workflows/installation-signing.yml",
    "policy_refused",
  );
  return { origin: service, buckets: structuredClone(value.buckets), policy };
}
class SigningResponseLost extends SigningError {
  constructor() {
    super("authority_unavailable");
  }
}

async function* transportChunks(response) {
  demand(response.body, "authority_unavailable");
  try {
    yield* response.body;
  } catch {
    // Never propagate a transport exception that could contain a private capability.
    throw new SigningError("authority_unavailable");
  }
}
async function bounded(response, maximum, deadline) {
  demand(response.body, "authority_unavailable");
  const parts = [];
  let size = 0;
  try {
    for await (const chunk of transportChunks(response)) {
      deadline.check();
      size += chunk.length;
      demand(size <= maximum, "size_refused");
      parts.push(Buffer.from(chunk));
    }
    return Buffer.concat(parts);
  } catch (error) {
    await closed(response);
    throw error;
  }
}

function statusResponse(value, id) {
  fields(value, "schema_version request_id state code receipt receipt_signature result");
  demand(
    value.schema_version === 1 &&
      value.request_id === id &&
      value.code === null &&
      ["admitted", "signing", "sealed"].includes(value.state),
  );
  return value;
}

export class ProductionSigningClient {
  constructor(
    configuration,
    { invokeToken, token, fetcher = fetch, clock = Date.now, sleep = delay } = {},
  ) {
    this.origin = origin(configuration.origin);
    this.buckets = structuredClone(configuration.buckets);
    this.policy = trustedPolicy(configuration.policy);
    demand(
      typeof invokeToken === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(invokeToken),
      "authentication_refused",
    );
    demand(typeof token === "function");
    this.invokeToken = invokeToken;
    this.token = token;
    this.fetcher = fetcher;
    this.clock = clock;
    this.sleep = sleep;
  }
  async pause(deadline) {
    demand(
      deadline.remaining(signingLimits.client_retry_delay_ms + 1) >
        signingLimits.client_retry_delay_ms,
      "authority_unavailable",
    );
    await this.sleep(signingLimits.client_retry_delay_ms);
    deadline.check();
  }
  async call(route, { method = "GET", bytes, deadline, retry = true } = {}) {
    demand(route === "/v1/requests" || /^\/v1\/requests\/[a-f0-9]{64}(?:\/execute)?$/.test(route));
    const maximum = retry ? signingLimits.client_retry_attempts : 1;
    for (let attempt = 0; attempt < maximum; attempt++) {
      deadline.check();
      let response, receivedAt;
      try {
        const bearer = await this.token(deadline);
        demand(
          typeof bearer === "string" &&
            bearer.length > 0 &&
            Buffer.byteLength(bearer) <= signingLimits.oidc_bytes,
          "authentication_refused",
        );
        response = await this.fetcher(this.origin + route, {
          method,
          headers: {
            "X-Auth-Token": this.invokeToken,
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          body: bytes,
          redirect: "error",
          signal: AbortSignal.timeout(deadline.remaining(signingLimits.execution_ms)),
        });
        receivedAt = performance.now();
      } catch (error) {
        if (error instanceof SigningError) throw error;
        if (attempt + 1 < maximum) {
          await this.pause(deadline);
          continue;
        }
        throw new SigningError("authority_unavailable");
      }
      if (transient(response.status)) {
        await closed(response);
        if (attempt + 1 < maximum) {
          await this.pause(deadline);
          continue;
        }
        throw new SigningError("authority_unavailable");
      }
      let raw;
      try {
        raw = await bounded(response, signingLimits.request_bytes, deadline);
      } catch (error) {
        if (!(error instanceof SigningError) || error.code !== "authority_unavailable") throw error;
        // A denial remains final even if its response body cannot be read.
        if (![200, 202].includes(response.status)) throw new SigningError("policy_refused");
        // Successful execute headers already acknowledge the effect, even when its body is lost.
        if (method === "POST" && route.endsWith("/execute")) throw new SigningResponseLost();
        if (attempt + 1 < maximum) {
          await this.pause(deadline);
          continue;
        }
        throw error;
      }
      let result;
      try {
        result = decode(raw);
      } catch {
        throw new SigningError("contract_refused");
      }
      if (![200, 202].includes(response.status)) {
        throw new SigningError(codes.has(result.code) ? result.code : "policy_refused");
      }
      const date = response.headers?.get("date");
      if (date !== null && date !== undefined) {
        const utc = Date.parse(date);
        demand(Number.isSafeInteger(utc) && utc > 0 && new Date(utc).toUTCString() === date);
        // HTTP Date is authenticated by this fixed-origin response and has one-second precision.
        this.transferClock = { utc: utc + 1000, monotonic: receivedAt };
      }
      return result;
    }
    throw new SigningError("authority_unavailable");
  }
  ticketNow() {
    return this.transferClock
      ? this.transferClock.utc + performance.now() - this.transferClock.monotonic
      : this.clock();
  }
  ticket(ticket, ref, upload) {
    fields(ticket, "url expires_at_ms");
    demand(typeof ticket.url === "string" && ticket.url.length <= signingLimits.request_bytes);
    const url = new URL(ticket.url);
    const bucket = upload ? this.buckets.ingress : this.buckets.retained;
    demand(
      url.protocol === "https:" &&
        url.hostname === `${bucket}.s3.fr-par.scw.cloud` &&
        !url.port &&
        !url.username &&
        !url.password &&
        !url.hash &&
        url.pathname === `/objects/${ref.sha256}`,
      "policy_refused",
    );
    demand(
      Number.isSafeInteger(ticket.expires_at_ms) &&
        ticket.expires_at_ms > this.ticketNow() &&
        ticket.expires_at_ms - this.ticketNow() <= signingLimits.transfer_seconds * 1000,
      "policy_refused",
    );
    return url.href;
  }
  async upload(ticket, file, ref, deadline) {
    const url = this.ticket(ticket, ref, true);
    demand(equal(await fileReference(file), ref), "contract_refused");
    const initial = fs.lstatSync(file);
    demand(initial.isFile() && initial.nlink === 1);
    for (let attempt = 0; attempt < signingLimits.client_retry_attempts; attempt++) {
      this.ticket(ticket, ref, true);
      const descriptor = fs.openSync(
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      );
      let stream, completion;
      try {
        const actual = fs.fstatSync(descriptor);
        demand(
          actual.isFile() &&
            actual.nlink === 1 &&
            actual.size === ref.bytes &&
            actual.dev === initial.dev &&
            actual.ino === initial.ino &&
            actual.mtimeMs === initial.mtimeMs &&
            actual.ctimeMs === initial.ctimeMs,
        );
        stream = fs.createReadStream(null, { fd: descriptor, autoClose: true });
        completion = finished(stream, { cleanup: true }).catch(() => {});
        let response;
        try {
          response = await this.fetcher(url, {
            method: "PUT",
            headers: {
              "Content-Length": String(ref.bytes),
              "If-None-Match": "*",
              "x-amz-checksum-sha256": Buffer.from(ref.sha256, "hex").toString("base64"),
            },
            body: stream,
            duplex: "half",
            redirect: "error",
            signal: AbortSignal.timeout(
              deadline.remaining(Math.max(1, ticket.expires_at_ms - this.ticketNow())),
            ),
          });
        } catch {
          if (attempt + 1 >= signingLimits.client_retry_attempts)
            throw new SigningError("authority_unavailable");
          await this.pause(deadline);
          continue;
        }
        const status = response.status;
        await closed(response);
        // A create-only collision is not content acceptance: execute still verifies the retained bytes.
        if ((status >= 200 && status < 300) || status === 412) return;
        if (!transient(status)) throw new SigningError("policy_refused");
        if (attempt + 1 >= signingLimits.client_retry_attempts)
          throw new SigningError("authority_unavailable");
        await this.pause(deadline);
      } finally {
        if (stream) {
          stream.destroy();
          await completion;
        } else fs.closeSync(descriptor);
      }
    }
  }
  async download(ticket, ref, destination, deadline) {
    reference(ref, updateLimits.package_bytes);
    const url = this.ticket(ticket, ref, false);
    for (let attempt = 0; attempt < signingLimits.client_retry_attempts; attempt++) {
      this.ticket(ticket, ref, false);
      let response;
      try {
        response = await this.fetcher(url, {
          redirect: "error",
          signal: AbortSignal.timeout(
            deadline.remaining(Math.max(1, ticket.expires_at_ms - this.ticketNow())),
          ),
        });
      } catch {
        if (attempt + 1 >= signingLimits.client_retry_attempts)
          throw new SigningError("authority_unavailable");
        await this.pause(deadline);
        continue;
      }
      if (transient(response.status)) {
        await closed(response);
        if (attempt + 1 >= signingLimits.client_retry_attempts)
          throw new SigningError("authority_unavailable");
        await this.pause(deadline);
        continue;
      }
      if (response.status !== 200) {
        await closed(response);
        throw new SigningError("authority_unavailable");
      }
      const descriptor = fs.openSync(destination, "wx", 0o600);
      let count = 0,
        complete = false,
        transportFailed = false;
      try {
        for await (const chunk of transportChunks(response)) {
          deadline.check();
          count += chunk.length;
          demand(count <= ref.bytes, "size_refused");
          fs.writeSync(descriptor, chunk);
        }
        demand(count === ref.bytes, "contract_refused");
        fs.fsyncSync(descriptor);
        complete = true;
      } catch (error) {
        if (!(error instanceof SigningError) || error.code !== "authority_unavailable") throw error;
        transportFailed = true;
      } finally {
        fs.closeSync(descriptor);
        if (!complete) fs.rmSync(destination, { force: true });
        await closed(response);
      }
      if (transportFailed) {
        if (attempt + 1 >= signingLimits.client_retry_attempts)
          throw new SigningError("authority_unavailable");
        await this.pause(deadline);
        continue;
      }
      demand(equal(await fileReference(destination), ref), "contract_refused");
      return;
    }
  }
  async run(request, { input, proof, output, deadline = new SigningDeadline() } = {}) {
    const bytes = canonical(request);
    validateRequest(bytes);
    const id = hash(bytes);
    demand(
      equal(await fileReference(input, request.input.bytes), request.input) &&
        equal(await fileReference(proof, request.build_proof.bytes), request.build_proof),
    );
    demand(
      path.isAbsolute(output) && fs.realpathSync(path.dirname(output)) === path.dirname(output),
    );
    fs.mkdirSync(output, { mode: 0o700 });
    try {
      const created = await this.call("/v1/requests", { method: "POST", bytes, deadline });
      fields(created, "schema_version request_id state uploads");
      demand(
        created.schema_version === 1 &&
          created.request_id === id &&
          ["admitted", "signing", "sealed"].includes(created.state),
      );
      demand(Array.isArray(created.uploads));
      if (created.state === "sealed") demand(created.uploads.length === 0);
      else {
        demand(
          created.uploads.length === 2 && new Set(created.uploads.map((x) => x.role)).size === 2,
        );
        for (const upload of created.uploads) {
          fields(upload, "role url expires_at_ms");
          demand(["input", "build_proof"].includes(upload.role));
          const { role, ...ticket } = upload;
          if (created.state === "admitted")
            await this.upload(
              ticket,
              role === "input" ? input : proof,
              role === "input" ? request.input : request.build_proof,
              deadline,
            );
        }
      }
      let value;
      let observedSigning = created.state === "signing",
        authenticationDenied;
      for (let attempt = 0; attempt < signingLimits.client_retry_attempts; attempt++) {
        if (
          created.state !== "sealed" &&
          !observedSigning &&
          !authenticationDenied &&
          (!value || value.state === "admitted")
        ) {
          try {
            value = await this.call(`/v1/requests/${id}/execute`, {
              method: "POST",
              bytes: canonical({ schema_version: 1, request_id: id }),
              deadline,
              retry: false,
            });
          } catch (error) {
            if (
              !(error instanceof SigningError) ||
              !["authority_unavailable", "authentication_refused"].includes(error.code)
            )
              throw error;
            // Fresh authenticated retrieval can recover a sealed result after the original token expires;
            // an authentication denial never permits another execute attempt.
            if (error.code === "authentication_refused") authenticationDenied = error;
            if (error instanceof SigningResponseLost) observedSigning = true;
          }
        }
        if (value) {
          statusResponse(value, id);
          observedSigning ||= value.state === "signing";
        }
        if (!value || value.state !== "sealed")
          value = statusResponse(await this.call(`/v1/requests/${id}`, { deadline }), id);
        if (value.state === "sealed") break;
        if (authenticationDenied) throw authenticationDenied;
        if (observedSigning && value.state === "admitted")
          throw new SigningError("signing_uncertain");
        observedSigning ||= value.state === "signing";
        if (attempt + 1 >= signingLimits.client_retry_attempts)
          throw new SigningError("authority_unavailable");
        await this.pause(deadline);
      }
      demand(value?.state === "sealed", "authority_unavailable");
      const files = {};
      for (const role of ["receipt", "receipt_signature", "result"]) {
        const item = value[role];
        fields(item, "sha256 bytes url expires_at_ms");
        const { url, expires_at_ms, ...ref } = item;
        reference(
          ref,
          role === "receipt"
            ? signingLimits.request_bytes
            : role === "receipt_signature"
              ? 64
              : updateLimits.package_bytes,
        );
        const file = path.join(output, role);
        await this.download({ url, expires_at_ms }, ref, file, deadline);
        files[role] = file;
      }
      const receipt = verifyReceipt(
        fs.readFileSync(files.receipt),
        fs.readFileSync(files.receipt_signature),
        this.policy,
      );
      demand(
        receipt.request_id === id &&
          receipt.operation === request.operation &&
          equal(receipt.subject, request.subject) &&
          equal(receipt.execution, request.execution) &&
          equal(receipt.input, request.input) &&
          equal(receipt.output, { sha256: value.result.sha256, bytes: value.result.bytes }) &&
          receipt.build_proof_sha256 === request.build_proof.sha256,
        "policy_refused",
      );
      if (request.operation === "deb-bind")
        demand(equal(receipt.output, request.input), "policy_refused");
      deadline.check();
      return { request_id: id, reference: receipt.output, receipt, files };
    } catch (error) {
      fs.rmSync(output, { recursive: true, force: true });
      throw error;
    }
  }
}
