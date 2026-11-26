import { createHash } from "node:crypto";
import {
  failure,
  portLimits,
  splitText,
  utf8Size,
  type Outcome,
  type TextDescriptor,
  type TextPart,
  type PortText,
} from "@ohtia/contracts";

export function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
export function storedText(text: string, source: string): PortText {
  const bytes = utf8Size(text);
  if (bytes <= portLimits.string_bytes) return text;
  const parts = splitText(text);
  if (parts.length > portLimits.text_parts)
    throw new Error("Stored text exceeds the parts contract.");
  return { source, parts: parts.length, bytes, sha256: digest(text) };
}
interface Staged {
  readonly descriptor: TextDescriptor;
  readonly subscription: string | undefined;
  readonly parts: Map<number, string>;
  bytes: number;
  stop: () => void;
}
/** In-memory, window-generation-scoped uploads. No receipt, filesystem or diagnostics authority. */
export class TextStaging {
  private readonly windows = new Map<string, Map<string, Staged>>();
  constructor(
    private readonly after: (ms: number, fn: () => void) => () => void = (ms, fn) => {
      const timer = setTimeout(fn, ms);
      timer.unref();
      return () => {
        clearTimeout(timer);
      };
    },
  ) {}
  discard(window: string, operation: string, subscription?: string): void {
    const texts = this.windows.get(window);
    const staged = texts?.get(operation);
    if (!staged || staged.subscription !== subscription) return;
    staged.stop();
    texts?.delete(operation);
    if (!texts?.size) this.windows.delete(window);
  }
  closeSubscription(window: string, subscription: string): void {
    for (const [id, staged] of this.windows.get(window) ?? [])
      if (staged.subscription === subscription) this.discard(window, id, subscription);
  }
  closeWindow(window: string): void {
    for (const [id, staged] of this.windows.get(window) ?? [])
      this.discard(window, id, staged.subscription);
  }
  dispose(): void {
    for (const window of this.windows.keys()) this.closeWindow(window);
  }
  part(
    window: string,
    operation: string,
    input: TextPart,
    subscription?: string,
  ): Outcome<{ readonly accepted: true }> {
    const texts = this.windows.get(window) ?? new Map<string, Staged>();
    const previous = texts.get(operation);
    if (previous && previous.subscription !== subscription) return failure("invalid_message");
    const invalid = () => {
      this.discard(window, operation, subscription);
      return failure("invalid_message");
    };
    const { index, count, bytes, sha256, text } = input;
    let size: number;
    try {
      size = utf8Size(text);
    } catch {
      return invalid();
    }
    if (index < 1 || index > count || size === 0 || size > portLimits.text_part_bytes)
      return invalid();
    if (
      previous &&
      (previous.descriptor.parts !== count ||
        previous.descriptor.bytes !== bytes ||
        previous.descriptor.sha256 !== sha256 ||
        (previous.parts.has(index) && previous.parts.get(index) !== text))
    )
      return invalid();
    const added = previous?.parts.has(index) ? 0 : size;
    if (
      (!previous && texts.size >= portLimits.staged_texts_per_window) ||
      [...texts.values()].reduce((sum, value) => sum + value.bytes, 0) + added >
        portLimits.staged_text_bytes_per_window
    )
      return failure("busy");
    const staged = previous ?? {
      subscription,
      descriptor: { parts: count, bytes, sha256 },
      parts: new Map<number, string>(),
      bytes: 0,
      stop() {},
    };
    staged.stop();
    staged.parts.set(index, text);
    staged.bytes += added;
    staged.stop = this.after(portLimits.staged_text_idle_ms, () => {
      this.discard(window, operation, subscription);
    });
    texts.set(operation, staged);
    this.windows.set(window, texts);
    return { ok: true, value: { accepted: true } };
  }
  take(
    window: string,
    operation: string,
    descriptor: TextDescriptor,
    subscription?: string,
  ): Outcome<string> {
    const staged = this.windows.get(window)?.get(operation);
    this.discard(window, operation, subscription);
    if (
      !staged ||
      staged.subscription !== subscription ||
      JSON.stringify(staged.descriptor) !==
        JSON.stringify({
          parts: descriptor.parts,
          bytes: descriptor.bytes,
          sha256: descriptor.sha256,
        }) ||
      staged.parts.size !== descriptor.parts
    )
      return failure("parts_incomplete");
    const parts: string[] = [];
    for (let index = 1; index <= descriptor.parts; index++) {
      const part = staged.parts.get(index);
      if (part === undefined) return failure("parts_incomplete");
      parts.push(part);
    }
    const text = parts.join("");
    if (
      utf8Size(text) !== descriptor.bytes ||
      digest(text) !== descriptor.sha256 ||
      JSON.stringify(splitText(text)) !== JSON.stringify(parts)
    )
      return failure("parts_incomplete");
    return { ok: true, value: text };
  }
}
