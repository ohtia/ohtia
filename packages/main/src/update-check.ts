import type http from "node:http";
import https from "node:https";
import {
  isFinalVersion,
  portLimits,
  utf8Size,
  type AvailableUpdate,
  type UpdateCheckFailure,
} from "@ohtia/contracts";

/** SPEC-001-040: the only update endpoint; the request carries no research content or identity. */
export const latestReleaseUrl = "https://api.github.com/repos/ohtia/ohtia/releases/latest";
export type LatestRelease =
  | { readonly ok: true; readonly version: string | null; readonly notes: string }
  | { readonly ok: false; readonly failure: UpdateCheckFailure };
export type ReleaseRequester = (signal: AbortSignal) => Promise<LatestRelease>;
type Open = (url: URL, options: https.RequestOptions) => http.ClientRequest;

const semver =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * One bounded GET. The timeout covers the whole exchange and the byte bound the whole body; neither
 * a redirect nor a proxy is followed. `version` is null for a prerelease, which is never newer.
 */
export function requestLatestRelease(
  open: Open = (url, options) => https.request(url, options),
  url: string = latestReleaseUrl,
): ReleaseRequester {
  return (signal) =>
    new Promise((resolve) => {
      let settled = false;
      let request: http.ClientRequest | undefined;
      const finish = (result: LatestRelease) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        request?.destroy();
        resolve(result);
      };
      const abort = () => {
        finish({ ok: false, failure: "network" });
      };
      const timer = setTimeout(() => {
        finish({ ok: false, failure: "timeout" });
      }, portLimits.update_check_ms);
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      try {
        request = open(new URL(url), {
          method: "GET",
          agent: false,
          headers: { Accept: "application/vnd.github+json", "User-Agent": "Ohtia" },
        });
      } catch {
        finish({ ok: false, failure: "network" });
        return;
      }
      request.on("error", () => {
        finish({ ok: false, failure: "network" });
      });
      request.once("response", (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish({ ok: false, failure: "network" });
          return;
        }
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > portLimits.update_check_response_bytes) {
          finish({ ok: false, failure: "too_large" });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > portLimits.update_check_response_bytes) {
            finish({ ok: false, failure: "too_large" });
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", () => {
          finish({ ok: false, failure: "network" });
        });
        response.once("end", () => {
          finish(parseRelease(Buffer.concat(chunks)));
        });
      });
      request.end();
    });
}
export function parseRelease(bytes: Uint8Array): LatestRelease {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return { ok: false, failure: "invalid_response" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { ok: false, failure: "invalid_response" };
  const release = value as Record<string, unknown>;
  const tag = release.tag_name;
  const body = release.body;
  const match = typeof tag === "string" ? semver.exec(tag) : null;
  if (
    !match ||
    typeof release.draft !== "boolean" ||
    typeof release.prerelease !== "boolean" ||
    (body !== null && body !== undefined && typeof body !== "string")
  )
    return { ok: false, failure: "invalid_response" };
  const version = [match[1], match[2], match[3]].join(".");
  if (!isFinalVersion(version)) return { ok: false, failure: "invalid_response" };
  return {
    ok: true,
    version: release.draft || release.prerelease || match[4] !== undefined ? null : version,
    notes: typeof body === "string" ? body : "",
  };
}
/** SemVer precedence for final versions: numeric comparison of each part. */
export function newerFinal(candidate: string, installed: string): boolean {
  if (!isFinalVersion(candidate) || !isFinalVersion(installed)) return false;
  const a = candidate.split(".").map(Number);
  const b = installed.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}
function encodedSize(char: string): number {
  if (char === '"' || char === "\\" || "\b\f\n\r\t".includes(char)) return 2;
  const cp = char.codePointAt(0) ?? 0;
  return cp < 0x20 ? 6 : utf8Size(char);
}
/**
 * Split well-formed notes at code points into parts of at most one port string, keeping the
 * compact JSON of the part array within `update_notes_bytes`; anything beyond is cut.
 */
export function noteParts(text: string): Pick<AvailableUpdate, "notes" | "notesTruncated"> {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
  const parts: string[] = [];
  let part = "";
  let partBytes = 0;
  // `[]` plus each part's quotes and the commas between parts.
  let total = 2;
  let truncated = false;
  for (const char of normalized) {
    const raw = utf8Size(char);
    const cost = encodedSize(char) + (part === "" ? (parts.length ? 3 : 2) : 0);
    if (total + cost > portLimits.update_notes_bytes) {
      truncated = true;
      break;
    }
    if (partBytes + raw > portLimits.string_bytes) {
      parts.push(part);
      part = "";
      partBytes = 0;
      const fresh = encodedSize(char) + 3;
      if (total + fresh > portLimits.update_notes_bytes) {
        truncated = true;
        break;
      }
      total += fresh;
    } else total += cost;
    part += char;
    partBytes += raw;
  }
  if (part) parts.push(part);
  return { notes: parts, notesTruncated: truncated };
}
