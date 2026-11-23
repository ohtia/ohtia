import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

/** A transport failure, and whether any request byte had left when it happened. */
export type TransportFailure = Error & { readonly sent: boolean };
export function transportFailure(sent: boolean, cause?: unknown): TransportFailure {
  return Object.assign(new Error("Provider transport failed.", { cause }), { sent });
}
export function isTransportFailure(value: unknown): value is TransportFailure {
  return value instanceof Error && typeof (value as { sent?: unknown }).sent === "boolean";
}
export interface TransportRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal: AbortSignal;
}
/**
 * Send one request. `release` is the last guard: the transport calls it once the connection, TLS
 * included, is established and before any request byte leaves; false sends nothing.
 */
export type ProviderTransport = (
  request: TransportRequest,
  release: () => boolean,
) => Promise<Response>;
const nullBodyStatuses = new Set([204, 205, 304]);
const transportClosures = new WeakMap<Response, () => Promise<void>>();
/** A real transport waits for its unpooled socket to close; injected test Responses have no socket. */
export async function closeResponseTransport(response: Response): Promise<void> {
  await transportClosures.get(response)?.();
}
/**
 * `fetch` reads a request body before its connection opens, so it cannot hold the body back for a
 * guard. Node's client writes nothing, not even headers, until `end()`, which follows the guard on
 * an established, unpooled connection.
 */
export function nodeProviderTransport(
  open: (url: URL, options: https.RequestOptions) => http.ClientRequest = (url, options) =>
    https.request(url, options),
): ProviderTransport {
  return (request, release) =>
    new Promise((resolve, reject) => {
      let sent = false;
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(transportFailure(sent, error));
      };
      const body = request.body === undefined ? undefined : Buffer.from(request.body, "utf8");
      const outgoing = open(new URL(request.url), {
        method: body === undefined ? "GET" : "POST",
        agent: false,
        signal: request.signal,
        headers: {
          ...request.headers,
          ...(body === undefined ? {} : { "Content-Length": String(body.byteLength) }),
        },
      });
      let socketClosed: Promise<void> = Promise.resolve();
      outgoing.once("response", (incoming) => {
        if (settled) return;
        settled = true;
        const status = incoming.statusCode ?? 0;
        const empty = nullBodyStatuses.has(status);
        if (empty) incoming.resume();
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers))
            if (typeof value === "string") headers.set(name, value);
          const response = new Response(
            empty ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>),
            { status, headers },
          );
          transportClosures.set(response, async () => {
            incoming.destroy();
            outgoing.destroy();
            await socketClosed;
          });
          resolve(response);
        } catch (error) {
          // A status the Fetch API cannot represent: the request had left.
          incoming.destroy();
          outgoing.destroy();
          void socketClosed.then(() => {
            reject(transportFailure(true, error));
          });
        }
      });
      outgoing.on("error", (error) => {
        // Before headers there is no Response to carry the receipt. Reject only after closure.
        outgoing.destroy();
        void socketClosed.then(() => {
          fail(error);
        });
      });
      outgoing.once("socket", (socket) => {
        socketClosed = new Promise<void>((resolve) => {
          socket.once("close", () => {
            resolve();
          });
        });
        const ready = () => {
          if (settled) return;
          if (!release()) {
            outgoing.destroy();
            void socketClosed.then(() => {
              fail(undefined);
            });
            return;
          }
          sent = true;
          outgoing.end(body);
        };
        if ((socket as { encrypted?: boolean }).encrypted === true)
          socket.once("secureConnect", ready);
        else if (socket.connecting) socket.once("connect", ready);
        else ready();
      });
    });
}
