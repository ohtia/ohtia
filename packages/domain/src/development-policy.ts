import { inputOmission, utf8Size, type RequestInput } from "@ohtia/contracts";

export const developmentTest = Object.freeze({
  operation: "development_test",
  policy_version: 1,
  instruction_version: 1,
  max_pending_tasks: 20,
  max_input_bytes: 16 * 1024,
  max_input_items: 20,
  max_output_bytes: 16 * 1024,
  max_work_units: 1,
  max_attempt_duration_ms: 10 * 60 * 1000,
  max_inactivity_ms: 120 * 1000,
  stop_grace_ms: 5000,
  max_attempts: 2,
  max_auto_retries: 0,
  retry_backoff_ms: 0,
  instructions:
    "You are Virgilio, the research guide in Ohtia, a desktop application where researchers write research documents with the help of AI agents.\n\nThis conversation is a development test of Ohtia's connection to the language-model service. It belongs to no research project, and nothing in it is research data.\n\nReply in English to the last message. Keep replies short unless the message asks for a particular length.",
});
export const omittedMessages = inputOmission.content;
/** Newest whole messages share the policy budget; the one fixed Ohtia note is separate metadata. */
export function developmentInput(messages: readonly RequestInput[]): readonly RequestInput[] {
  const selected: RequestInput[] = [];
  let size = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i];
    if (!item) break;
    const bytes = utf8Size(item.content);
    if (
      selected.length + 1 > developmentTest.max_input_items ||
      size + bytes > developmentTest.max_input_bytes
    )
      break;
    selected.unshift(item);
    size += bytes;
  }
  if (messages.length > 0 && selected.length === 0)
    throw new RangeError("The newest request message exceeds its policy bounds.");
  if (selected.length < messages.length) selected.unshift(inputOmission);
  return selected;
}
export function operationPolicy(
  operation: string,
  mode: string,
): typeof developmentTest | undefined {
  return mode === "development" && operation === developmentTest.operation
    ? developmentTest
    : undefined;
}
