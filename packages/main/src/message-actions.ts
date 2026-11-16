import { createHash } from "node:crypto";
import { URL } from "node:url";
import {
  isExternalMessageLink,
  isIdentifier,
  utf8Size,
  type DiagnosticEventName,
} from "@ohtia/contracts";
import type { ServiceSupervisor } from "./service-supervisor.js";

type Clipboard = {
  writeText(text: string): void | Promise<void>;
  readText(): string | Promise<string>;
};
type Diagnostic = (name: DiagnosticEventName) => void;

/** WHATWG parsing happens at the authority boundary, even for a direct hostile IPC request. */
export async function openExternalMessageLink(
  input: unknown,
  open: (url: string) => Promise<unknown>,
  diagnostic: Diagnostic = () => {},
): Promise<boolean> {
  let success = false;
  try {
    if (!isExternalMessageLink(input)) return false;
    const url = new URL(input);
    if (!["https:", "http:", "mailto:"].includes(url.protocol) || utf8Size(url.href) > 4096)
      return false;
    await open(url.href);
    success = true;
    return true;
  } catch {
    return false;
  } finally {
    diagnostic(success ? "ohtia.message.link_opened" : "ohtia.message.link_refused");
  }
}

/** Reads immutable saved text under the originating window's current conversation scope. */
export async function copyMessage(
  messageId: unknown,
  conversationId: string,
  service: Pick<ServiceSupervisor, "request">,
  clipboard: Clipboard,
  current: () => boolean,
  diagnostic: Diagnostic = () => {},
): Promise<boolean> {
  let success = false;
  try {
    if (!isIdentifier(messageId) || !isIdentifier(conversationId) || !current()) return false;
    const result = await service.request("timeline.read", { conversationId, ids: [messageId] });
    if (
      !result.ok ||
      !current() ||
      result.value.remaining.length !== 0 ||
      result.value.items.length !== 1
    )
      return false;
    const item = result.value.items[0];
    if (item?.kind !== "message" || item.id !== messageId) return false;
    let text = item.content;
    if (typeof text !== "string") {
      const reference = text;
      const parts: string[] = [];
      for (let index = 1; index <= reference.parts; index++) {
        if (!current()) return false;
        const part = await service.request("text.readPart", { source: reference.source, index });
        if (!part.ok || !current()) return false;
        parts.push(part.value.text);
      }
      text = parts.join("");
      if (
        utf8Size(text) !== reference.bytes ||
        createHash("sha256").update(text, "utf8").digest("hex") !== reference.sha256
      )
        return false;
    }
    if (!current()) return false;
    await clipboard.writeText(text);
    success = current() && (await clipboard.readText()) === text && current();
    return success;
  } catch {
    return false;
  } finally {
    diagnostic(success ? "ohtia.message.copied" : "ohtia.message.copy_failed");
  }
}
