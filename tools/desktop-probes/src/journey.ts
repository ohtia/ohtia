/** Private, disposable qualification messages; these are not product port contracts. */
export type Appearance = "system" | "light" | "dark";
export type Request =
  | { operation: "status" | "appearance-read" }
  | { operation: "appearance-write"; value: Appearance };

export function expectedSender(
  event: { sender: unknown; senderFrame: { url: string } | null },
  contents: { mainFrame: { url: string } },
  url: string,
): boolean {
  try {
    return (
      event.sender === contents &&
      event.senderFrame === contents.mainFrame &&
      event.senderFrame.url === url
    );
  } catch {
    // An inaccessible/destroyed frame never acquires authority.
    return false;
  }
}

export function parseRequest(
  value: unknown,
  limits: { messageBytes: number; stringBytes: number },
): Request | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return;
    if (Object.getOwnPropertySymbols(value).length) return;
    let keys = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) return;
      if (++keys > 2 || (key !== "operation" && key !== "value")) return;
    }
    if (!("operation" in value) || typeof value.operation !== "string") return;
    if (Buffer.byteLength(value.operation, "utf8") > limits.stringBytes) return;
    let request: Request;
    if (value.operation === "status" || value.operation === "appearance-read") {
      if (keys !== 1) return;
      request = { operation: value.operation };
    } else if (value.operation === "appearance-write") {
      if (
        keys !== 2 ||
        !("value" in value) ||
        (value.value !== "system" && value.value !== "light" && value.value !== "dark")
      )
        return;
      if (Buffer.byteLength(value.value, "utf8") > limits.stringBytes) return;
      request = { operation: "appearance-write", value: value.value };
    } else return;
    if (Buffer.byteLength(JSON.stringify(request), "utf8") > limits.messageBytes) return;
    return request;
  } catch {
    return;
  }
}
