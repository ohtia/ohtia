import { utf8Size, type ProviderOperation, type TransferEntry } from "@ohtia/contracts";

/** SPEC-003-004: every operation version fixes all of these values; the researcher cannot edit them. */
export interface OperationPolicy {
  readonly operation: ProviderOperation;
  readonly version: number;
  readonly instruction_version: number;
  readonly max_pending_tasks: number;
  readonly max_input_bytes: number;
  readonly max_input_items: number;
  readonly max_output_bytes: number;
  readonly max_work_units: number;
  readonly max_attempt_duration_ms: number;
  readonly max_inactivity_ms: number;
  readonly stop_grace_ms: number;
  readonly max_attempts: number;
  readonly max_auto_retries: number;
  readonly retry_backoff_ms: number;
  /** Agent instructions are English and sent in the request's `instructions` field. */
  readonly instructions: string;
  /** The runtime modes whose operation catalog admits this version. */
  readonly modes: readonly ("development" | "installed" | "qualification")[];
}

const developmentTestInstructions = [
  "You are Virgilio, the research guide in Ohtia, a desktop application where researchers write research documents with the help of AI agents.",
  "This conversation is a development test of Ohtia's connection to the language-model service. It belongs to no research project, and nothing in it is research data.",
  "Reply in English to the last message. Keep replies short unless the message asks for a particular length.",
].join("\n\n");

const policies: readonly OperationPolicy[] = Object.freeze([
  Object.freeze({
    operation: "development_test",
    version: 1,
    instruction_version: 1,
    max_pending_tasks: 20,
    max_input_bytes: 16 * 1024,
    max_input_items: 20,
    max_output_bytes: 16 * 1024,
    max_work_units: 1,
    max_attempt_duration_ms: 10 * 60 * 1000,
    max_inactivity_ms: 120 * 1000,
    stop_grace_ms: 5 * 1000,
    max_attempts: 2,
    max_auto_retries: 0,
    retry_backoff_ms: 0,
    instructions: developmentTestInstructions,
    modes: Object.freeze(["development"] as const),
  }),
]);

/** The operation catalog: an operation absent from a mode's catalog does not exist there. */
export function operationPolicy(
  operation: string,
  version: number,
  mode: "development" | "installed" | "qualification",
): OperationPolicy | undefined {
  return policies.find(
    (policy) =>
      policy.operation === operation && policy.version === version && policy.modes.includes(mode),
  );
}

export const omittedMessagesNote = "Earlier messages in this conversation are not included.";
export interface InputMessage {
  /** An identifier recorded in the transfer list, never the text. */
  readonly reference: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}
export interface BuiltInput {
  readonly input: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
  readonly transfer: readonly TransferEntry[];
}
/**
 * The input rule of every operation in EPIC-003: the newest whole messages that fit within the
 * byte and item limits, sent oldest first, with the English note when older ones are left out.
 * A message is never cut, and the note counts toward neither limit.
 */
export function buildInput(
  policy: OperationPolicy,
  messages: readonly InputMessage[],
  context: { readonly reference: string; readonly revision: number },
): BuiltInput | undefined {
  const chosen: InputMessage[] = [];
  let bytes = 0;
  for (const message of [...messages].reverse()) {
    const size = utf8Size(message.text);
    if (chosen.length + 1 > policy.max_input_items || bytes + size > policy.max_input_bytes) break;
    chosen.unshift(message);
    bytes += size;
  }
  // An input whose newest message alone exceeds the limits has nothing to answer.
  if (!chosen.length) return;
  const omitted = chosen.length < messages.length;
  return {
    input: [
      ...(omitted ? [{ role: "user" as const, text: omittedMessagesNote }] : []),
      ...chosen.map((message) => ({ role: message.role, text: message.text })),
    ],
    transfer: [
      { kind: "instructions", operation: policy.operation, version: policy.instruction_version },
      ...(omitted
        ? [{ kind: "note" as const, note: "earlier_messages_omitted" as const, ...context }]
        : []),
      ...chosen.map((message) => ({ kind: "message" as const, reference: message.reference })),
    ],
  };
}
