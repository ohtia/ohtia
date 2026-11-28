import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export const openrouterAuthorize = "https://openrouter.ai/auth";
export const openrouterKeyExchange = "https://openrouter.ai/api/v1/auth/keys";

/** RFC 7636 S256: the challenge is the unpadded base64url SHA-256 of the verifier's ASCII text. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
export interface Authorization {
  readonly verifier: string;
  readonly challenge: string;
  readonly state: string;
}
/** Fresh values for one attempt: a 32-byte verifier and a 16-byte state. */
export function authorization(random: (size: number) => Buffer = randomBytes): Authorization {
  const verifier = random(32).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier), state: random(16).toString("base64url") };
}
/** The address opened in the browser, with exactly these parameters and no proposed limit. */
export function authorizationUrl(port: number, values: Authorization): string {
  const url = new URL(openrouterAuthorize);
  url.search = new URLSearchParams({
    callback_url: `http://127.0.0.1:${String(port)}/callback`,
    code_challenge: values.challenge,
    code_challenge_method: "S256",
    state: values.state,
    key_label: "Ohtia",
    expiration: "7-days",
  }).toString();
  return url.toString();
}
/** What the browser brought back: a code with the matching state, or OpenRouter's Deny. */
export type Callback = { readonly code: string } | "denied";

/**
 * One IPv4 loopback listener per attempt. Only `GET /callback` is answered; it accepts a single
 * request, either one without parameters (Deny) or one with a code and this attempt's state.
 */
export function waitForCallback(options: {
  readonly values: Authorization;
  readonly signal: AbortSignal;
  readonly completedText: string;
  readonly openBrowser: (url: string) => Promise<void>;
}): Promise<Callback> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (result?: Callback, error?: Error) => {
      if (finished) return;
      finished = true;
      options.signal.removeEventListener("abort", aborted);
      server.close();
      server.closeAllConnections();
      if (error) reject(error);
      else if (result) resolve(result);
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
          response.writeHead(404).end();
          return;
        }
        if (finished || request.method !== "GET" || url.pathname !== "/callback") {
          response.writeHead(404).end();
          return;
        }
        const parameters = url.searchParams;
        const codes = parameters.getAll("code");
        const states = parameters.getAll("state");
        let result: Callback;
        if ([...parameters.keys()].length === 0) result = "denied";
        else if (
          codes.length === 1 &&
          codes[0] &&
          states.length === 1 &&
          states[0] === options.values.state
        )
          result = { code: codes[0] };
        else {
          // A request without a code, or a code without this attempt's state, is never accepted.
          response.writeHead(400).end();
          return;
        }
        // No provider text is reflected in the page. End the response before closing its socket.
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.once("close", () => {
          finish(result);
        });
        response.end(options.completedText, () => {
          finish(result);
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
      // A TCP listener always reports its address once listening.
      const { port } = server.address() as AddressInfo;
      void options.openBrowser(authorizationUrl(port, options.values)).catch(() => {
        finish(undefined, new Error("Browser hand-off failed."));
      });
    });
  });
}
