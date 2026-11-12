import { createServer } from "node:http";
import { randomBytes, createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { portLimits } from "@ohtia/contracts";

export const chatGPTEndpoints = Object.freeze({
  authorize: "https://auth.openai.com/api/accounts/authorize",
  token: "https://auth.openai.com/api/accounts/oauth/token",
  keys: "https://auth.openai.com/.well-known/jwks.json",
  issuer: "https://auth.openai.com",
  models: "https://api.openai.com/v1/models",
  resource: "https://api.openai.com/v1",
});
export type ProviderFetch = typeof fetch;
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
/** Two account labels must fit the public snapshot even after JSON escaping. */
export function displayEmail(value: unknown): value is string {
  return (
    nonempty(value) &&
    Buffer.byteLength(value) <= portLimits.string_bytes &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
/** Bound untrusted provider bodies before decoding, including chunked responses. */
export async function providerJSON(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Missing provider response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error("Provider response exceeded its bound.");
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export interface BrowserResult {
  readonly callback: URLSearchParams;
  readonly redirect: string;
  readonly nonce: string;
  readonly verifier: string;
}
/** Each attempt owns one IPv4 loopback listener and consumes exactly one state-matching GET. */
export async function browserSignIn(options: {
  readonly client: string;
  readonly host: string;
  readonly first: boolean;
  readonly signal: AbortSignal;
  readonly completedText: string;
  readonly openBrowser: (url: string) => Promise<void>;
}): Promise<BrowserResult> {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return new Promise((resolve, reject) => {
    let finished = false;
    let redirect = "";
    const finish = (result?: URLSearchParams, error?: Error) => {
      if (finished) return;
      finished = true;
      options.signal.removeEventListener("abort", aborted);
      server.close();
      server.closeAllConnections();
      if (error) reject(error);
      else if (result) resolve({ callback: result, redirect, nonce, verifier });
    };
    const aborted = () => {
      finish(undefined, new Error("Sign-in cancelled."));
    };
    const server = createServer(
      { maxHeaderSize: 16384, requestTimeout: 5000, headersTimeout: 5000 },
      (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Connection", "close");
        let url: URL;
        try {
          url = new URL(request.url ?? "", "http://127.0.0.1");
        } catch {
          response.writeHead(400).end();
          return;
        }
        if (url.pathname !== "/auth/callback") {
          response.writeHead(404).end();
          return;
        }
        if (
          finished ||
          request.method !== "GET" ||
          url.searchParams.getAll("state").length !== 1 ||
          url.searchParams.get("state") !== state
        ) {
          response.writeHead(400).end();
          return;
        }
        // No provider text is reflected in the page. End the response before closing its socket.
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.once("close", () => {
          finish(url.searchParams);
        });
        response.end(options.completedText, () => {
          finish(url.searchParams);
        });
        // Reserve this attempt synchronously so a second request cannot be accepted.
        server.close();
        server.removeAllListeners("request");
      },
    );
    server.on("error", () => {
      finish(undefined, new Error("Sign-in listener unavailable."));
    });
    options.signal.addEventListener("abort", aborted, { once: true });
    if (options.signal.aborted) {
      aborted();
      return;
    }
    server.listen(0, "127.0.0.1", () => {
      if (finished) {
        server.close();
        return;
      }
      const address = server.address();
      if (!address || typeof address === "string") {
        finish(undefined, new Error("Invalid callback address."));
        return;
      }
      redirect = `http://127.0.0.1:${String(address.port)}/auth/callback`;
      const url = new URL(chatGPTEndpoints.authorize);
      url.search = new URLSearchParams({
        client_id: options.client,
        ext_agent_host_id: options.host,
        response_type: "code",
        redirect_uri: redirect,
        scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        resource: chatGPTEndpoints.resource,
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: challenge,
        ...(options.first ? { agent_name_hint: "Ohtia" } : {}),
      }).toString();
      void options.openBrowser(url.toString()).catch(() => {
        finish(undefined, new Error("Browser hand-off failed."));
      });
    });
  });
}
/** Fixed issuer/JWKS origin, algorithm allowlist and signature verification precede claim use. */
export async function verifyIdentity(
  token: string,
  client: string,
  nonce: string,
  request: ProviderFetch,
  signal: AbortSignal,
): Promise<{ sub: string; email: string }> {
  const parts = token.split(".");
  const [encodedHeader = "", encodedClaims = "", encodedSignature = ""] = parts;
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
    throw new Error("Invalid identity.");
  const header: unknown = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  if (
    !object(header) ||
    header.alg !== "RS256" ||
    !nonempty(header.kid) ||
    header.crit !== undefined
  )
    throw new Error("Invalid identity.");
  const response = await request(chatGPTEndpoints.keys, { signal, redirect: "error" });
  if (!response.ok) throw new Error("Identity keys unavailable.");
  const body = await providerJSON(response);
  if (!object(body) || !Array.isArray(body.keys)) throw new Error("Invalid identity keys.");
  const matches = body.keys.filter(
    (key: unknown) =>
      object(key) &&
      key.kid === header.kid &&
      key.kty === "RSA" &&
      (key.use === undefined || key.use === "sig") &&
      (key.alg === undefined || key.alg === "RS256"),
  );
  if (matches.length !== 1) throw new Error("Invalid identity key.");
  const key = createPublicKey({ key: matches[0] as JsonWebKey, format: "jwk" });
  if (
    !verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      key,
      Buffer.from(encodedSignature, "base64url"),
    )
  )
    throw new Error("Invalid identity signature.");
  const claims: unknown = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8"));
  const now = Date.now() / 1000;
  if (
    !object(claims) ||
    claims.iss !== chatGPTEndpoints.issuer ||
    !(
      claims.aud === client ||
      (Array.isArray(claims.aud) && claims.aud.length === 1 && claims.aud[0] === client)
    ) ||
    typeof claims.exp !== "number" ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now ||
    typeof claims.iat !== "number" ||
    !Number.isFinite(claims.iat) ||
    claims.iat > now + 5 ||
    (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now)) ||
    claims.nonce !== nonce ||
    !nonempty(claims.sub) ||
    !displayEmail(claims.email)
  )
    throw new Error("Invalid identity claims.");
  return { sub: claims.sub, email: claims.email };
}
