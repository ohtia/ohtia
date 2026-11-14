import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  isIdentifier,
  isProviderModelSlug,
  providerMessageVersion,
  type DevelopmentAction,
  type DevelopmentReportMessage,
  type ProviderResult,
  type ProviderUsage,
  type TransferEntry,
} from "@ohtia/contracts";

/**
 * The development command of SPEC-003-008: switches of the unpackaged `development` runtime only.
 * Main loads this module in that mode alone, and no package contains it (STORY-003-003).
 */
export const developmentPrefix = "[ohtia dev]";
export const developmentRequestText = "Describe the usual parts of a thesis in about 300 words.";
const actions: Readonly<Record<string, readonly string[]>> = Object.freeze({
  request: ["model"],
  interrupt: ["attempt"],
});
export type DevelopmentInvocation =
  | { readonly ok: true; readonly action: DevelopmentAction }
  | { readonly ok: false; readonly error: string };
/** Parse `--ohtia-dev-command=<action>` and its `--ohtia-dev-<argument>=<value>` switches. */
export function parseDevelopmentSwitches(
  switches: readonly string[],
  operationId: string = randomUUID(),
): DevelopmentInvocation | undefined {
  const values = new Map<string, string>();
  for (const item of switches) {
    const match = /^--ohtia-dev-([a-z]+(?:-[a-z]+)*)=([^\0]*)$/.exec(item);
    if (!match) return { ok: false, error: `Unrecognized switch: ${item.slice(0, 64)}` };
    const [, name, value] = match as unknown as [string, string, string];
    if (values.has(name)) return { ok: false, error: `Repeated switch: --ohtia-dev-${name}` };
    values.set(name, value);
  }
  if (!values.size) return;
  const command = values.get("command");
  const expected = command !== undefined ? actions[command] : undefined;
  if (!command || !expected || !Object.hasOwn(actions, command))
    return {
      ok: false,
      error: `Use --ohtia-dev-command=<action>, where <action> is ${Object.keys(actions).join(" or ")}.`,
    };
  for (const name of values.keys())
    if (name !== "command" && !expected.includes(name))
      return { ok: false, error: `The ${command} action takes no --ohtia-dev-${name}.` };
  for (const name of expected)
    if (!values.has(name))
      return { ok: false, error: `The ${command} action needs --ohtia-dev-${name}=<value>.` };
  if (command === "request") {
    const model = values.get("model");
    if (!isProviderModelSlug(model))
      return { ok: false, error: "Use a model slug from the connection's model list." };
    return {
      ok: true,
      action: { name: "request", operation_id: operationId, model, text: developmentRequestText },
    };
  }
  const attempt = values.get("attempt");
  if (!isIdentifier(attempt)) return { ok: false, error: "Use an attempt identifier it printed." };
  return { ok: true, action: { name: "interrupt", operation_id: operationId, attempt } };
}
function count(value: number | null): string {
  return value === null ? "unknown" : String(value);
}
function describeResult(result: ProviderResult): string {
  switch (result.status) {
    case "completed":
    case "cancelled":
      return result.status;
    case "uncertain":
      return `uncertain (${result.reason})`;
    case "failed":
      return `${result.dispatched ? "failed" : "not dispatched"} (${result.reason})`;
  }
}
function describeUsage(usage: ProviderUsage): string {
  return `input ${count(usage.input_tokens)}, cached input ${count(usage.cached_input_tokens)}, output ${count(usage.output_tokens)}, reasoning ${count(usage.reasoning_tokens)}`;
}
function describeTransfer(transfer: readonly TransferEntry[]): string {
  return transfer
    .map((entry) =>
      entry.kind === "instructions"
        ? `instructions ${entry.operation} v${String(entry.version)}`
        : entry.kind === "message"
          ? `message ${entry.reference}`
          : `note ${entry.note}`,
    )
    .join(", ");
}
/**
 * Provider text and switch values reach a terminal. Replace every Unicode control (Cc), format
 * (Cf), line-separator and paragraph-separator character except newline and tab, so no reply can
 * carry an escape sequence or disguise what the terminal shows; a CRLF pair is a newline.
 */
const terminalUnsafe = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
export function terminalSafe(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .replace(terminalUnsafe, (character) =>
      character === "\n" || character === "\t" ? character : "\uFFFD",
    );
}
/** Main's stdout is suppressed for diagnostics; the command writes to the terminal directly. */
function terminal(text: string): void {
  try {
    fs.writeSync(1, text);
  } catch {
    /* No terminal: the development command has nowhere else to print. */
  }
}
export interface DevelopmentHost {
  /** Post one development action to the current data service; false when none is available. */
  post(text: string, generation: string): boolean;
  /** The current data service's generation once it and the connection state are ready. */
  ready(): string | undefined;
}
/** Runs actions in the running instance and prints their identifiers and results. */
export function createDevelopmentCommand(host: DevelopmentHost, output = terminal) {
  // A CRLF pair can arrive split across two streamed pieces: hold a final CR for the next write.
  let carriageReturn = false;
  const write = (text: string) => {
    let next = carriageReturn ? `\r${text}` : text;
    carriageReturn = next.endsWith("\r");
    if (carriageReturn) next = next.slice(0, -1);
    if (next) output(terminalSafe(next));
  };
  const queued: DevelopmentAction[] = [];
  const streaming = new Set<string>();
  const line = (text: string) => {
    write(`${developmentPrefix} ${text}\n`);
  };
  const send = (action: DevelopmentAction): boolean => {
    const generation = host.ready();
    if (!generation) return false;
    return host.post(
      JSON.stringify({
        kind: "development_action",
        version: providerMessageVersion,
        generation,
        action,
      }),
      generation,
    );
  };
  const flush = () => {
    for (let next = queued[0]; next && send(next); next = queued[0]) queued.shift();
  };
  return {
    /** Switches from this launch or, through `second-instance`, from a later launch. */
    run(switches: unknown): void {
      if (!Array.isArray(switches) || !switches.every((item) => typeof item === "string")) {
        line("Ignored a development command whose switches could not be read.");
        return;
      }
      const invocation = parseDevelopmentSwitches(switches);
      if (!invocation) return;
      if (!invocation.ok) {
        line(invocation.error);
        return;
      }
      line(`${invocation.action.name} ${invocation.action.operation_id}: accepted`);
      queued.push(invocation.action);
      flush();
    },
    /** Called whenever a data service becomes ready with the connection state reported. */
    flush,
    report(message: DevelopmentReportMessage): void {
      const id = message.operation_id;
      const report = message.report;
      switch (report.type) {
        case "refused":
          line(`${id}: refused (${report.reason})`);
          return;
        case "attempt":
          line(`${id}: attempt ${report.attempt}`);
          return;
        case "interrupt_sent":
          line(`${id}: interrupt sent to attempt ${report.attempt}`);
          return;
        case "text":
          if (!streaming.has(report.attempt)) {
            streaming.add(report.attempt);
            line(`attempt ${report.attempt} reply:`);
          }
          write(report.text);
          return;
        case "finished":
          if (streaming.delete(report.attempt)) write("\n");
          line(
            `attempt ${report.attempt}: ${describeResult(report.result)}; duration ${String(report.duration_ms)} ms; longest silence between events ${String(report.longest_silence_ms)} ms; ${String(report.events)} events; usage ${describeUsage(report.usage)}; sent ${describeTransfer(report.transfer)}`,
          );
          return;
      }
    },
  };
}
export type DevelopmentCommand = ReturnType<typeof createDevelopmentCommand>;
