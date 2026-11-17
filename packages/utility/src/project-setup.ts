import { projectTypes, type ProviderTool, type ProviderToolCall } from "@ohtia/contracts";
import type { LanguageRegistry } from "./research.js";

export const setupTool: ProviderTool = {
  namespace: "ohtia",
  name: "propose_project_setup",
  strict: true,
  description:
    "Propose the working title and the language of the document text. The researcher confirms or rejects the proposal in Ohtia.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Working title exactly as agreed with the researcher.",
      },
      document_language: {
        type: "string",
        description:
          "BCP 47 tag of the form language[-script][-region]: a script subtag only for a writing system and a region subtag only for a regional variety that the researcher indicated.",
      },
    },
    required: ["title", "document_language"],
    additionalProperties: false,
  },
};
export const setupInstructions =
  "You are Virgilio, the research guide in Ohtia, a desktop application where researchers write research documents with the help of AI agents.\n\nThe researcher has just created a new project.\nProject type: {project_type_name}. {project_type_description}\n\nYour task in this conversation is limited to agreeing with the researcher on two facts:\n\n1. A working title for the document.\n2. The language in which the document will be written.\n\nHow to work:\n- Reply in the language the researcher writes in.\n- Keep replies short and ask one question at a time.\n- If the researcher has no title yet, ask about the topic and suggest a provisional title built from their own words. Do not invent a topic, a method or findings.\n- The document language can differ from the language of this conversation. Ask if it is not clear.\n- Express the language as a BCP 47 tag of the form language[-script][-region]: a language subtag; then a script subtag only when the researcher indicates a writing system (for example sr-Latn); then a region subtag only when the researcher indicates a regional variety (for example es-AR, pt-BR, en-GB or es-419). Never guess a script or a region.\n- Do not give research advice yet. If asked, say that you will help with the research once the project is set up.\n- When both facts are clear, write one sentence summarizing them and call propose_project_setup once, with the title exactly as agreed and the language tag.\n- Ohtia shows your proposal to the researcher, who confirms or rejects it. You cannot confirm it, and you must never say that the project has been created or saved.\n- If the researcher corrects or rejects a proposal, continue the conversation and make a new proposal when both facts are clear again."
    .replace("{project_type_name}", projectTypes.thesis.name)
    .replace("{project_type_description}", projectTypes.thesis.description);
/** Version 2 aligns the agreed title with the selected document language. */
export const setupInstructionsV2 = setupInstructions.replace(
  "- Express the language as a BCP 47 tag",
  "- Agree on the document language explicitly; do not infer it from the conversation language, the interface language or the language of an earlier title.\n- The working title must be written in the agreed document language. If an earlier title is in another language, propose its wording in the document language and ask the researcher to agree to that wording before calling propose_project_setup. Do not silently translate an agreed title. Preserve proper names and quoted terms where appropriate.\n- Before calling propose_project_setup, check that the title wording and document_language describe the same agreed document language. A conversation in Spanish with American English as the document language needs a title agreed in English and the tag en-US.\n- A researcher reply after a proposal continues setup and makes that earlier proposal unavailable for confirmation. Agree on the updated title and document language, then call propose_project_setup again to present a fresh proposal; chat agreement alone never confirms setup. Ohtia’s earlier proposal notes describe their position in the conversation’s history; a note saying a proposal was waiting does not make it actionable after a later researcher reply.\n- Express the language as a BCP 47 tag",
);
export const setupInvalidReasons = [
  "title_empty",
  "title_whitespace",
  "title_too_long",
  "title_invalid",
  "language_malformed",
  "language_unknown",
  "multiple_calls",
] as const;
export type SetupInvalidReason = (typeof setupInvalidReasons)[number];
export type SetupState = "proposed" | "invalid" | "replaced" | "rejected" | "confirmed";
export interface SetupProposalRow {
  id: Uint8Array;
  project_id: Uint8Array;
  task_id: Uint8Array;
  attempt_id: Uint8Array;
  arguments_json: string;
  title: string;
  document_language: string;
  state: SetupState;
  invalid_reason: SetupInvalidReason | null;
  created_at: string;
  decided_at: string | null;
  decided_by_operation_id: string | null;
}
export interface SetupValues {
  title: string;
  document_language: string;
}
/** Accept only the task's permitted strict schema, before content validation. */
export function acceptedSetupCalls(
  calls: readonly ProviderToolCall[],
): (SetupValues & { arguments_json: string })[] {
  const accepted: (SetupValues & { arguments_json: string })[] = [];
  for (const call of calls) {
    if (call.namespace !== setupTool.namespace || call.name !== setupTool.name) continue;
    try {
      const args: unknown = JSON.parse(call.arguments);
      if (
        args &&
        typeof args === "object" &&
        !Array.isArray(args) &&
        Object.keys(args).sort().join(",") === "document_language,title" &&
        "title" in args &&
        typeof args.title === "string" &&
        "document_language" in args &&
        typeof args.document_language === "string"
      ) {
        accepted.push({
          title: args.title,
          document_language: args.document_language,
          arguments_json: call.arguments,
        });
      }
    } catch {
      /* Calls outside the strict schema confer no research effect. */
    }
  }
  return accepted;
}
export const malformedScalar =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
export function setupTextProjection(text: string): string {
  return text.replace(new RegExp(malformedScalar.source, "gu"), "\uFFFD");
}
export function setupInvalidReason(
  values: SetupValues,
  registry: LanguageRegistry | (() => LanguageRegistry),
): SetupInvalidReason | null {
  if (!values.title) return "title_empty";
  if (
    values.title.trim() !== values.title ||
    /^\p{White_Space}|\p{White_Space}$/u.test(values.title)
  )
    return "title_whitespace";
  if (Array.from(values.title).length > 200) return "title_too_long";
  if (values.title.includes("\0") || malformedScalar.test(values.title)) return "title_invalid";
  if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z]{4})?(?:-[a-zA-Z]{2}|-[0-9]{3})?$/.test(values.document_language))
    return "language_malformed";
  return (typeof registry === "function" ? registry() : registry).canonical(
    values.document_language,
  )
    ? null
    : "language_unknown";
}
export function setupRevision(proposal: Pick<SetupProposalRow, "state">): number {
  return proposal.state === "proposed" || proposal.state === "invalid" ? 1 : 2;
}
export function setupNote(
  proposal: Pick<SetupProposalRow, "state" | "title" | "document_language" | "invalid_reason">,
): string | undefined {
  if (proposal.state === "confirmed") return;
  if (proposal.state === "invalid") {
    if (proposal.invalid_reason === "multiple_calls")
      return "Note from Ohtia: at this point you called propose_project_setup more than once in one reply, so Ohtia accepted none of the calls. The researcher was told.";
    const reasons = {
      title_empty: "its title was empty.",
      title_whitespace: "its title started or ended with whitespace.",
      title_too_long: "its title was longer than 200 characters.",
      title_invalid: "its title contained U+0000 or invalid Unicode.",
      language_malformed:
        "its language was not a BCP 47 tag made of a language subtag, an optional script subtag and an optional region subtag.",
      language_unknown:
        "its language tag contains a subtag that does not exist, or is deprecated, in the IANA Language Subtag Registry.",
    };
    if (!proposal.invalid_reason) throw new Error("Invalid proposal lacks its reason.");
    return `Note from Ohtia: at this point Ohtia did not accept your proposal because ${reasons[proposal.invalid_reason]} The researcher was told.`;
  }
  const endings = {
    proposed: "a setup that is waiting for the researcher to confirm or reject it.",
    replaced: "a setup that a later proposal of yours replaced.",
    rejected: "a setup that the researcher rejected; nothing was saved.",
  };
  return `Note from Ohtia: at this point you proposed ${endings[proposal.state]}\nWorking title: ${proposal.title}\nDocument language: ${proposal.document_language}`;
}
