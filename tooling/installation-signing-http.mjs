import { URL } from "node:url";
// Loopback-only test transport for the signing API; provider IAM remains a separate live gate.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomBytes } from "node:crypto";
import {
  SigningError,
  canonical,
  decode,
  demand,
  fields,
  hash,
  signingLimits,
} from "./installation-authority.mjs";
import { fileReference, validateRequest } from "./installation-signer.mjs";

const statuses = {
  authentication_refused: 403,
  policy_refused: 403,
  request_conflict: 409,
  signing_uncertain: 409,
  size_refused: 413,
  contract_refused: 422,
  authority_unavailable: 503,
  operation_failed: 503,
};
async function body(stream, maximum) {
  let size = 0;
  const chunks = [];
  for await (const chunk of stream) {
    size += chunk.length;
    demand(size <= maximum, "size_refused");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function bearer(request) {
  const header = request.headers.authorization;
  demand(
    typeof header === "string" &&
      header.startsWith("Bearer ") &&
      header.length <= signingLimits.oidc_bytes + 7,
    "authentication_refused",
  );
  return header.slice(7);
}
export async function localSigningServer(service, { clock = Date.now } = {}) {
  const tickets = new Map();
  let origin;
  function ticket(ref, mode, requestId) {
    const now = clock();
    for (const [id, t] of tickets) if (t.expires_at_ms <= now) tickets.delete(id);
    for (const [id, t] of tickets)
      if (t.ref.sha256 === ref.sha256 && t.mode === mode && t.requestId === requestId)
        return { url: `${origin}/v1/transfers/${id}`, expires_at_ms: t.expires_at_ms };
    demand(tickets.size < signingLimits.transfer_tickets, "authority_unavailable");
    const id = randomBytes(32).toString("hex"),
      expires_at_ms = now + signingLimits.transfer_seconds * 1000;
    tickets.set(id, { ref, mode, requestId, expires_at_ms });
    return { url: `${origin}/v1/transfers/${id}`, expires_at_ms };
  }
  async function envelope(id) {
    const bytes = await service.store.readBytes(
      { sha256: id, bytes: fs.statSync(service.store.object(id)).size },
      signingLimits.request_bytes,
    );
    demand(hash(bytes) === id);
    return bytes;
  }
  function settledState(value) {
    if (value.state === "uncertain") throw new SigningError("signing_uncertain");
    if (value.state === "failed")
      throw new SigningError(Object.hasOwn(statuses, value.code) ? value.code : "operation_failed");
    return value;
  }
  async function decorated(value) {
    settledState(value);
    const response = structuredClone(value);
    for (const k of ["receipt", "receipt_signature", "result"])
      if (response[k])
        response[k] = { ...response[k], ...ticket(response[k], "GET", response.request_id) };
    return response;
  }
  const server = http.createServer(async (request, response) => {
    try {
      demand(
        typeof request.url === "string" && !request.url.includes("?") && !request.url.includes("%"),
      );
      const transfer = /^\/v1\/transfers\/([a-f0-9]{64})$/.exec(request.url);
      if (transfer) {
        const t = tickets.get(transfer[1]);
        demand(
          t && t.expires_at_ms > clock() && t.mode === request.method,
          "authentication_refused",
        );
        demand(
          (await service.admit(service.policy)) === true && service.policy.enabled,
          "policy_refused",
        );
        if (t.mode === "GET") {
          const state = await service.store.read(
            service.identity(validateRequest(await envelope(t.requestId))),
          );
          demand(state?.state === "sealed", "policy_refused");
          const file = service.store.object(t.ref.sha256);
          demand(canonical(await fileReference(file)).equals(canonical(t.ref)), "contract_refused");
          response.writeHead(200, {
            "Content-Length": t.ref.bytes,
            "Content-Type": "application/octet-stream",
            "Cache-Control": "no-store",
          });
          const stream = fs.createReadStream(file);
          stream.once("end", () => tickets.delete(transfer[1]));
          stream.once("error", () => response.destroy());
          response.once("close", () => stream.destroy());
          stream.pipe(response);
          return;
        }
        demand(request.headers["content-length"] === String(t.ref.bytes));
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-transfer-"));
        try {
          const file = path.join(dir, "input");
          const fd = fs.openSync(file, "wx", 0o600);
          let count = 0;
          try {
            for await (const chunk of request) {
              count += chunk.length;
              demand(count <= t.ref.bytes, "size_refused");
              fs.writeSync(fd, chunk);
            }
            fs.fsyncSync(fd);
          } finally {
            fs.closeSync(fd);
          }
          demand(count === t.ref.bytes);
          await service.store.putObject(file, t.ref);
          tickets.delete(transfer[1]);
          response.writeHead(200, { "Cache-Control": "no-store" });
          response.end();
          return;
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
      let value;
      if (request.method === "POST" && request.url === "/v1/requests") {
        const bytes = await body(request, signingLimits.request_bytes);
        const token = bearer(request);
        value = settledState(await service.create(token, bytes));
        const r = validateRequest(bytes);
        const uploads =
          value.state === "sealed"
            ? []
            : [
                { role: "input", ...ticket(r.input, "PUT", value.request_id) },
                { role: "build_proof", ...ticket(r.build_proof, "PUT", value.request_id) },
              ];
        response.writeHead(value.state === "sealed" ? 200 : 202, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        response.end(
          canonical({
            schema_version: 1,
            request_id: value.request_id,
            state: value.state,
            uploads,
          }),
        );
        return;
      }
      const route = /^\/v1\/requests\/([a-f0-9]{64})(\/execute)?$/.exec(request.url);
      demand(route, "contract_refused");
      const bytes = await envelope(route[1]);
      if (request.method === "GET" && !route[2])
        value = await service.status(bearer(request), route[1], bytes);
      else if (request.method === "POST" && route[2]) {
        const execute = decode(await body(request, signingLimits.request_bytes));
        fields(execute, "schema_version request_id");
        demand(execute.schema_version === 1 && execute.request_id === route[1]);
        value = await service.execute(bearer(request), route[1], bytes);
      } else throw new SigningError("contract_refused");
      const decoratedValue = await decorated(value);
      response.writeHead(value.state === "sealed" ? 200 : 202, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(canonical(decoratedValue));
    } catch (error) {
      const requestedCode = error instanceof SigningError ? error.code : "authority_unavailable";
      const code = Object.hasOwn(statuses, requestedCode) ? requestedCode : "authority_unavailable";
      if (!response.headersSent) {
        response.writeHead(statuses[code] ?? 503, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        response.end(canonical({ schema_version: 1, code }));
      } else response.destroy();
    }
  });
  server.requestTimeout = signingLimits.execution_ms;
  server.headersTimeout = 60000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
export class LocalSigningClient {
  constructor(origin, { token, fetcher = fetch } = {}) {
    const url = new URL(origin);
    demand(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.origin === origin);
    this.origin = origin;
    this.token = token;
    this.fetcher = fetcher;
  }
  async call(route, { method = "GET", bytes } = {}) {
    const response = await this.fetcher(this.origin + route, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        "Content-Type": "application/json",
      },
      body: bytes,
      redirect: "error",
      signal: AbortSignal.timeout(signingLimits.execution_ms),
    });
    const result = decode(await body(response.body, signingLimits.request_bytes));
    if (!response.ok) throw new SigningError(result.code);
    return result;
  }
  transferUrl(value) {
    const u = new URL(value);
    demand(
      u.origin === this.origin &&
        /^\/v1\/transfers\/[a-f0-9]{64}$/.test(u.pathname) &&
        !u.search &&
        !u.hash &&
        !u.username &&
        !u.password,
    );
    return u.href;
  }
  async run(request, { input, proof }) {
    const bytes = canonical(request);
    validateRequest(bytes);
    demand(canonical(await fileReference(input)).equals(canonical(request.input)));
    const created = await this.call("/v1/requests", { method: "POST", bytes });
    demand(created.request_id === hash(bytes));
    for (const upload of created.uploads) {
      const file = upload.role === "input" ? input : proof;
      const ref = upload.role === "input" ? request.input : request.build_proof;
      demand(canonical(await fileReference(file)).equals(canonical(ref)));
      const response = await this.fetcher(this.transferUrl(upload.url), {
        method: "PUT",
        headers: {
          "Content-Length": String(ref.bytes),
          "If-None-Match": "*",
          "x-amz-checksum-sha256": Buffer.from(ref.sha256, "hex").toString("base64"),
        },
        body: fs.createReadStream(file),
        duplex: "half",
        redirect: "error",
        signal: AbortSignal.timeout(signingLimits.execution_ms),
      });
      demand(response.ok, "authority_unavailable");
    }
    return this.call(`/v1/requests/${created.request_id}/execute`, {
      method: "POST",
      bytes: canonical({ schema_version: 1, request_id: created.request_id }),
    });
  }
  async download(ticket, destination) {
    const response = await this.fetcher(this.transferUrl(ticket.url), {
      redirect: "error",
      signal: AbortSignal.timeout(signingLimits.execution_ms),
    });
    demand(response.ok, "authority_unavailable");
    const fd = fs.openSync(destination, "wx", 0o600);
    let count = 0;
    try {
      for await (const chunk of response.body) {
        count += chunk.length;
        demand(count <= ticket.bytes, "size_refused");
        fs.writeSync(fd, chunk);
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    demand(
      canonical(await fileReference(destination)).equals(
        canonical({ sha256: ticket.sha256, bytes: ticket.bytes }),
      ),
    );
  }
}
