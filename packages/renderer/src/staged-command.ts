import {
  failure,
  portLimits,
  splitText,
  utf8Size,
  type FoundationPort,
  type Outcome,
  type PortCall,
  type TextDescriptor,
} from "@ohtia/contracts";

export async function stagedCommand<T>(
  port: Pick<FoundationPort, "sendTextPart">,
  id: string,
  text: string,
  send: (content: string | TextDescriptor) => PortCall<T>,
): Promise<Outcome<T>> {
  try {
    const parts = splitText(text);
    if (parts.length > portLimits.text_parts) return failure("invalid_message");
    let content: string | TextDescriptor = text;
    if (parts.length > 1) {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      content = {
        parts: parts.length,
        bytes: utf8Size(text),
        sha256: [...new Uint8Array(hash)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
      };
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (typeof content !== "string")
        for (let index = 0; index < parts.length; index++) {
          const part = await port.sendTextPart(id, {
            index: index + 1,
            count: content.parts,
            bytes: content.bytes,
            sha256: content.sha256,
            text: parts[index] ?? "",
          }).result;
          if (!part.ok) return part;
        }
      const result = await send(content).result;
      if (result.ok || result.error.code !== "parts_incomplete" || attempt === 1) return result;
    }
  } catch {
    return failure("invalid_service_result");
  }
  return failure("invalid_service_result");
}
