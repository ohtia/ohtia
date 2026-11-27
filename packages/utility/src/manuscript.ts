import {
  manuscriptLimits,
  type CanonicalManuscript,
  type ManuscriptResult,
} from "@ohtia/contracts";
import { parseManuscript as parseText, type ManuscriptIdentity } from "@ohtia/domain";

export { serializeManuscript, type ManuscriptIdentity } from "@ohtia/domain";

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function parseManuscript(
  source: string | Uint8Array,
  identity: ManuscriptIdentity,
): ManuscriptResult<CanonicalManuscript> {
  if (typeof source === "string") return parseText(source, identity);
  if (source.byteLength > manuscriptLimits.documentBytes)
    return { ok: false, diagnostic: { code: "document-limit", location: { kind: "document" } } };
  let text: string;
  try {
    text = utf8.decode(source);
  } catch {
    return { ok: false, diagnostic: { code: "invalid-text", location: { kind: "document" } } };
  }
  return parseText(text, identity);
}
