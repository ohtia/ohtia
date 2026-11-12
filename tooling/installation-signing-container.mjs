// Production transport composition requires fresh independent activation and deployment readback.
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  canonical,
  decode,
  demand,
  fields,
  SigningError,
  SigningDeadline,
  signingLimits,
  withSigningDeadline,
  currentSigningDeadline,
  trustedPolicy,
  githubReaders,
  OidcAuthority,
  MainSourceAuthority,
  GitHubBuildAuthority,
} from "./installation-authority.mjs";
import { SigningService, CryptoSigningWorker, validateRequest } from "./installation-signer.mjs";
import {
  ScalewaySigningStore,
  ScalewaySigningSecrets,
  ScalewaySigningDeployment,
} from "./installation-signing-scaleway.mjs";
import {
  signingAdmission,
  signingConfigurationHash,
  signingDeploymentRequirements,
} from "./installation-signing-admission.mjs";

const statuses = Object.freeze({
  authentication_refused: 403,
  policy_refused: 403,
  request_conflict: 409,
  signing_uncertain: 409,
  size_refused: 413,
  contract_refused: 422,
  authority_unavailable: 503,
  operation_failed: 503,
});

function readBody(request, deadline, bodyTimeout) {
  const declared = request.headers["content-length"];
  if (declared !== undefined) {
    demand(typeof declared === "string" && /^(?:0|[1-9][0-9]*)$/.test(declared));
    demand(
      Number.isSafeInteger(Number(declared)) && Number(declared) <= signingLimits.request_bytes,
      "size_refused",
    );
  }
  return new Promise((resolve, reject) => {
    const parts = [];
    let count = 0;
    const finish = (error) => {
      clearTimeout(timer);
      request.removeListener("data", data);
      request.removeListener("end", end);
      request.removeListener("aborted", aborted);
      request.removeListener("error", aborted);
      if (error) {
        request.pause();
        reject(error);
      } else resolve(Buffer.concat(parts));
    };
    const data = (part) => {
      try {
        deadline.check();
        count += part.length;
        demand(count <= signingLimits.request_bytes, "size_refused");
        parts.push(Buffer.from(part));
      } catch (error) {
        finish(error);
      }
    };
    const end = () => finish();
    const aborted = () => finish(new SigningError("authority_unavailable"));
    const timer = setTimeout(aborted, deadline.remaining(bodyTimeout));
    timer.unref();
    request.on("data", data);
    request.once("end", end);
    request.once("aborted", aborted);
    request.once("error", aborted);
  });
}
function token(request) {
  const matches = request.rawHeaders
    .filter((_, i) => i % 2 === 0)
    .filter((name) => name.toLowerCase() === "authorization");
  const value = request.headers.authorization;
  demand(
    matches.length === 1 &&
      typeof value === "string" &&
      value.startsWith("Bearer ") &&
      value.length > 7 &&
      value.length <= signingLimits.oidc_bytes + 7,
    "authentication_refused",
  );
  return value.slice(7);
}
function settled(value) {
  if (value.state === "uncertain") throw new SigningError("signing_uncertain");
  if (value.state === "failed")
    throw new SigningError(Object.hasOwn(statuses, value.code) ? value.code : "operation_failed");
  return value;
}

// Provider IAM protects invocation separately; this transport never issues local transfer capabilities.
export function productionSigningServer(
  service,
  { bodyTimeout = signingLimits.subprocess_ms } = {},
) {
  demand(
    Number.isSafeInteger(bodyTimeout) &&
      bodyTimeout > 0 &&
      bodyTimeout <= signingLimits.subprocess_ms,
  );
  let active = false;
  const server = http.createServer(
    { maxHeaderSize: signingLimits.request_bytes },
    async (request, response) => {
      let ownsSlot = false;
      request.on("error", () => {});
      const deadline = new SigningDeadline();
      const send = (status, value) => {
        response.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        response.end(canonical(value));
      };
      try {
        await withSigningDeadline(deadline, async () => {
          demand(typeof request.url === "string" && !/[?%#]/.test(request.url));
          const bearer = token(request);
          await service.checkAuthority();
          const isCreate = request.method === "POST" && request.url === "/v1/requests";
          const route = /^\/v1\/requests\/([a-f0-9]{64})(\/execute)?$/.exec(request.url);
          demand(
            isCreate ||
              (route &&
                ((request.method === "GET" && !route[2]) ||
                  (request.method === "POST" && route[2]))),
          );
          const body =
            request.method === "POST" ? await readBody(request, deadline, bodyTimeout) : null;
          demand(!active, "authority_unavailable");
          active = ownsSlot = true;
          let value;
          if (request.method === "POST" && request.url === "/v1/requests") {
            const bytes = body;
            const input = validateRequest(bytes);
            value = settled(await service.create(bearer, bytes));
            const uploads = [];
            if (value.state !== "sealed") {
              for (const role of ["input", "build_proof"])
                uploads.push({ role, ...(await service.store.uploadTicket(input[role])) });
            }
            await service.authorize(bearer, input);
            deadline.check();
            send(value.state === "sealed" ? 200 : 202, {
              schema_version: 1,
              request_id: value.request_id,
              state: value.state,
              uploads,
            });
            return;
          }
          const bytes = await service.store.readRequest(route[1]);
          if (request.method === "POST") {
            const execute = decode(body);
            fields(execute, "schema_version request_id");
            demand(execute.schema_version === 1 && execute.request_id === route[1]);
            value = await service.execute(bearer, route[1], bytes);
          } else value = await service.status(bearer, route[1], bytes);
          settled(value);
          const result = structuredClone(value);
          for (const role of ["receipt", "receipt_signature", "result"])
            if (result[role])
              result[role] = {
                ...result[role],
                ...(await service.store.downloadTicket(result[role])),
              };
          await service.authorize(bearer, validateRequest(bytes));
          deadline.check();
          send(value.state === "sealed" ? 200 : 202, result);
        });
      } catch (error) {
        const requested = error instanceof SigningError ? error.code : "authority_unavailable";
        const code = Object.hasOwn(statuses, requested) ? requested : "authority_unavailable";
        if (!response.headersSent && !response.destroyed) {
          response.shouldKeepAlive = false;
          send(statuses[code], { schema_version: 1, code });
        } else response.destroy();
      } finally {
        if (ownsSlot) active = false;
      }
    },
  );
  server.requestTimeout = signingLimits.execution_ms;
  server.headersTimeout = signingLimits.subprocess_ms;
  server.maxConnections = signingLimits.transfer_tickets;
  return server;
}

export function composeSigningContainer(configuration, { environment = process.env } = {}) {
  signingConfigurationHash(configuration);
  const policy = trustedPolicy(configuration.policy);
  // Enabled local policy still needs independent control and live provider readback at every gate.
  fields(configuration.buckets, "ingress retained");
  const accessKeyId = environment.OHTIA_SIGNING_BACKEND_ACCESS_KEY;
  const secretAccessKey = environment.OHTIA_SIGNING_BACKEND_SECRET_KEY;
  demand(
    typeof accessKeyId === "string" &&
      accessKeyId.length > 0 &&
      typeof secretAccessKey === "string" &&
      secretAccessKey.length > 0,
    "authority_unavailable",
  );
  const store = new ScalewaySigningStore({
    ...configuration.buckets,
    credentials: { accessKeyId, secretAccessKey },
  });
  const keys = new ScalewaySigningSecrets({
    token: async () => secretAccessKey,
    versions: configuration.secret_versions,
  });
  const worker = new CryptoSigningWorker(policy, { keys });
  const readers = githubReaders();
  const source = new MainSourceAuthority(readers);
  const build = new GitHubBuildAuthority(policy, {
    job: readers.job,
    environment: { HOME: "/tmp", GH_CONFIG_DIR: "/tmp/ohtia-gh" },
  });
  const admit = policy.enabled
    ? signingAdmission(configuration, {
        store,
        deployment: new ScalewaySigningDeployment({ token: async () => secretAccessKey }),
      })
    : async () => false;
  const service = new SigningService(policy, {
    store,
    worker,
    source,
    build,
    caller: new OidcAuthority(policy, readers),
    deadline: currentSigningDeadline,
    admit,
  });
  return { service, store, close: () => store.client.destroy() };
}

export async function runSigningContainer() {
  demand(process.platform === "linux" && process.arch === "x64" && process.getuid() !== 0);
  process.umask(0o077);
  const raw = process.env.OHTIA_SIGNING_CONFIGURATION;
  demand(typeof raw === "string" && Buffer.byteLength(raw) <= signingLimits.request_bytes);
  const configuration = decode(Buffer.from(raw));
  const composed = composeSigningContainer(configuration);
  for (const name of ["OHTIA_SIGNING_BACKEND_ACCESS_KEY", "OHTIA_SIGNING_BACKEND_SECRET_KEY"])
    delete process.env[name];
  const portText = process.env.PORT ?? String(signingDeploymentRequirements.port);
  demand(/^[1-9][0-9]{0,4}$/.test(portText) && Number(portText) <= 65535);
  const server = productionSigningServer(composed.service);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(portText), "0.0.0.0", resolve);
  });
  const shutdown = () => {
    server.close(() => {
      composed.close();
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), signingLimits.execution_ms).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSigningContainer().catch(() => {
    process.stderr.write("Signing container startup refused.\n");
    process.exitCode = 1;
  });
}
