import {
  failure,
  isCollaborationProposal,
  isHandoffTool,
  utf8Size,
  type ConsultationState,
  type ConversationBusyReason,
  type HandoffInvalidReason,
  type Outcome,
  type ProviderTool,
  type ProviderToolCall,
  type ReplyAgent,
  type ResearchCommand,
} from "@ohtia/contracts";
import { sql, type Kysely } from "kysely";
import { agentIdentity } from "./consultations.js";
import { unfinishedPlan } from "./plan-proposals.js";
import { bytes, isEntityId, newId, type ResearchSchema } from "./research.js";
import { nextPosition } from "./tasks.js";

export interface HandoffRow {
  id: Uint8Array;
  conversation_id: Uint8Array;
  from_agent_id: ReplyAgent;
  to_agent_id: ReplyAgent | null;
  to_operation: "search_strategy_planning" | "direct_guidance" | null;
  initiated_by: "agent" | "researcher";
  state: ConsultationState;
  invalid_reason: HandoffInvalidReason | null;
  note: string;
  reason: string;
  proposed_by_attempt_id: Uint8Array | null;
  expected_owner_revision: number;
  position: number | null;
  created_at: string;
  decided_at: string | null;
  decided_by_operation_id: string | null;
}

export const handoffNoteLimit = 32768;
export const handoffReasonLimit = 500;

export const handoffTool: ProviderTool = {
  namespace: "ohtia",
  name: "propose_handoff",
  description:
    "Propose continuing this conversation with a specialist, subject to researcher approval.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        enum: ["josefa"],
        description: "The agent that would continue the conversation.",
      },
      note: {
        type: "string",
        description: "The attributed context the agent needs, 1 to 32,768 UTF-8 bytes.",
      },
      reason: { type: "string", description: "Why the handoff would help, 1 to 500 characters." },
    },
    required: ["agent", "note", "reason"],
    additionalProperties: false,
  },
};

function nonblank(text: unknown): text is string {
  return typeof text === "string" && text.trim().length > 0 && !/[\0\uD800-\uDFFF]/u.test(text);
}

export function readHandoffProposal(
  calls: readonly ProviderToolCall[],
  agentAvailable: boolean,
): { note: string; reason: string } | { invalid: HandoffInvalidReason } | undefined {
  const call = calls.find(isHandoffTool);
  if (!call) return;
  if (calls.filter(isCollaborationProposal).length > 1) return { invalid: "multiple_calls" };
  let value: unknown;
  try {
    value = JSON.parse(call.arguments);
  } catch {
    return { invalid: "note_empty" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { invalid: "note_empty" };
  const { agent, note, reason } = value as Record<string, unknown>;
  if (!nonblank(note)) return { invalid: "note_empty" };
  if (utf8Size(note) > handoffNoteLimit) return { invalid: "note_too_large" };
  if (!nonblank(reason)) return { invalid: "reason_empty" };
  if (Array.from(reason).length > handoffReasonLimit) return { invalid: "reason_too_long" };
  if (!agentAvailable || agent !== "josefa" || Object.keys(value).length !== 3)
    return { invalid: "agent_unavailable" };
  return { note, reason };
}

export async function handoffBusy(
  db: Kysely<ResearchSchema>,
  conversation: Uint8Array,
  excluding?: Uint8Array,
): Promise<ConversationBusyReason | undefined> {
  const active = db
    .selectFrom("tasks")
    .select("id")
    .where("conversation_id", "=", conversation)
    .where("state", "in", ["queued", "blocked", "running", "cancelling"]);
  const replies = active.where("kind", "=", "reply");
  if (await (excluding ? replies.where("id", "!=", excluding) : replies).executeTakeFirst())
    return "reply_active";
  if (await unfinishedPlan(db, conversation)) return "plan_unfinished";
  if (await active.where("kind", "=", "consultation").executeTakeFirst())
    return "consultation_unfinished";
  return undefined;
}

export function handoffBoundary(db: Kysely<ResearchSchema>, conversation: Uint8Array) {
  return db
    .selectFrom("handoffs")
    .select("position")
    .where("conversation_id", "=", conversation)
    .where("state", "=", "accepted")
    .orderBy("position", "desc")
    .executeTakeFirst();
}

export function replaceHandoff(db: Kysely<ResearchSchema>, conversation: Uint8Array, now: string) {
  return db
    .updateTable("handoffs")
    .set({ state: "replaced", decided_at: now })
    .where("conversation_id", "=", conversation)
    .where("state", "=", "proposed")
    .execute();
}

export async function saveHandoffProposal(
  db: Kysely<ResearchSchema>,
  conversation: Uint8Array,
  attempt: Uint8Array,
  ownerRevision: number,
  proposal: NonNullable<ReturnType<typeof readHandoffProposal>>,
  now: string,
) {
  const id = newId();
  const invalid = "invalid" in proposal ? proposal.invalid : null;
  if (!invalid)
    await db
      .updateTable("interventions")
      .set({ state: "replaced", decided_at: now, revision: sql`revision+1` })
      .where("state", "=", "proposed")
      .where("conversation_id", "=", conversation)
      .execute();
  await db
    .insertInto("handoffs")
    .values({
      id,
      conversation_id: conversation,
      from_agent_id: "virgilio",
      to_agent_id: invalid ? null : "josefa",
      to_operation: invalid ? null : "search_strategy_planning",
      initiated_by: "agent",
      state: invalid ? "invalid" : "proposed",
      invalid_reason: invalid,
      note: "note" in proposal ? proposal.note : "",
      reason: "reason" in proposal ? proposal.reason : "",
      proposed_by_attempt_id: attempt,
      expected_owner_revision: ownerRevision,
      position: null,
      created_at: now,
      decided_at: invalid ? now : null,
      decided_by_operation_id: null,
    })
    .execute();
}

export function returnableMessages(db: Kysely<ResearchSchema>, conversation: Uint8Array) {
  return db
    .selectFrom("messages as m")
    .where("m.conversation_id", "=", conversation)
    .where(
      "m.position",
      ">",
      db
        .selectFrom("handoffs")
        .select(sql<number>`coalesce(max(position),0)`.as("last_away"))
        .where("conversation_id", "=", conversation)
        .where("from_agent_id", "=", "virgilio"),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("handoff_selected_messages")
            .select("handoff_id")
            .whereRef("message_id", "=", "m.id"),
        ),
      ),
    );
}

type HandoffCommand = Extract<
  ResearchCommand,
  { command: "handoff.accept" | "handoff.decline" | "handoff.return" }
>;

export async function decideHandoff(
  db: Kysely<ResearchSchema>,
  input: HandoffCommand,
  now: string,
): Promise<Outcome<Uint8Array>> {
  const returning = input.command === "handoff.return";
  const reference = returning ? input.payload.conversationId : input.payload.proposalId;
  if (!isEntityId(reference)) return failure("invalid_message");
  const declining = input.command === "handoff.decline";
  if (
    !declining &&
    (!Number.isSafeInteger(input.payload.expectedOwnerRevision) ||
      input.payload.expectedOwnerRevision < 1)
  )
    return failure("invalid_message");
  if (returning && typeof input.payload.selection !== "string") return failure("invalid_message");
  const proposal = returning
    ? undefined
    : await db
        .selectFrom("handoffs")
        .selectAll()
        .where("id", "=", bytes(reference))
        .where("initiated_by", "=", "agent")
        .executeTakeFirst();
  if (!returning && !proposal) return failure("record_not_found");
  if (proposal && proposal.state !== "proposed") return failure("proposal_not_waiting");
  const conversation = await db
    .selectFrom("conversations")
    .selectAll()
    .where("id", "=", proposal?.conversation_id ?? bytes(reference))
    .executeTakeFirst();
  if (!conversation) return failure("record_not_found");
  if (
    !declining &&
    (conversation.owner_revision !== input.payload.expectedOwnerRevision ||
      (returning
        ? conversation.agent_id !== "josefa"
        : proposal?.expected_owner_revision !== conversation.owner_revision ||
          conversation.agent_id !== "virgilio"))
  )
    return failure("owner_changed");
  if (!declining) {
    const reason = await handoffBusy(db, conversation.id);
    if (reason)
      return {
        ok: false,
        error: { code: "conversation_busy", nextAction: "retry_later", parameters: { reason } },
      };
  }
  const positions: number[] = [];
  if (returning && input.payload.selection !== "") {
    for (const part of input.payload.selection.split(",")) {
      const position = Number(part);
      if (
        !Number.isSafeInteger(position) ||
        position <= (positions.at(-1) ?? 0) ||
        String(position) !== part
      )
        return failure("selection_invalid");
      positions.push(position);
    }
  }
  const selected = positions.length
    ? await returnableMessages(db, conversation.id)
        .where(
          sql<boolean>`m.position IN (SELECT value FROM json_each(${JSON.stringify(positions)}))`,
        )
        .select("m.id")
        .execute()
    : [];
  if (selected.length !== positions.length) return failure("selection_invalid");
  const id = proposal?.id ?? newId();
  const decision = { decided_at: now, decided_by_operation_id: input.operationId };
  if (declining) {
    await db
      .updateTable("handoffs")
      .set({ ...decision, state: "declined" })
      .where("id", "=", id)
      .execute();
    await db
      .updateTable("conversations")
      .set({ revision: sql`revision+1` })
      .where("id", "=", conversation.id)
      .execute();
    return { ok: true, value: id };
  }
  const position = await nextPosition(db, conversation.id);
  const agent = returning ? "virgilio" : "josefa";
  if (returning) {
    await db
      .insertInto("handoffs")
      .values({
        ...decision,
        id,
        conversation_id: conversation.id,
        from_agent_id: "josefa",
        to_agent_id: agent,
        to_operation: "direct_guidance",
        initiated_by: "researcher",
        state: "accepted",
        invalid_reason: null,
        note: "",
        reason: "",
        proposed_by_attempt_id: null,
        expected_owner_revision: conversation.owner_revision,
        position,
        created_at: now,
      })
      .execute();
    for (let index = 0; index < selected.length; index += 256)
      await db
        .insertInto("handoff_selected_messages")
        .values(
          selected
            .slice(index, index + 256)
            .map(({ id: message_id }) => ({ handoff_id: id, message_id })),
        )
        .execute();
  } else {
    await db
      .updateTable("handoffs")
      .set({ ...decision, state: "accepted", position })
      .where("id", "=", id)
      .execute();
  }
  await db
    .updateTable("conversations")
    .set({
      agent_id: agent,
      owner_revision: conversation.owner_revision + 1,
      revision: sql`revision+1`,
    })
    .where("id", "=", conversation.id)
    .execute();
  return { ok: true, value: id };
}

export function handoffProposalNote(proposal: Pick<HandoffRow, "state" | "invalid_reason">) {
  const prefix =
    "Note from Ohtia: at this point you proposed continuing this conversation with Josefa";
  switch (proposal.state) {
    case "accepted":
      return undefined;
    case "proposed":
      return prefix + "; the proposal is waiting for the researcher to accept or decline it.";
    case "declined":
      return prefix + "; the researcher declined, so the conversation stayed with you.";
    case "replaced":
      return prefix + "; a later proposal of yours replaced it.";
    case "invalid":
      break;
  }
  if (proposal.invalid_reason === "multiple_calls")
    return "Note from Ohtia: at this point you made more than one proposal in one reply, so Ohtia accepted none of them. The researcher was told.";
  const explanations = {
    note_empty: "its note was empty",
    note_too_large: "its note was longer than 32,768 bytes",
    reason_empty: "it had no reason",
    reason_too_long: "its reason was longer than 500 characters",
    agent_unavailable: "it named an agent that isn't available",
    conversation_busy: "work in this conversation hadn't finished",
  };
  if (!proposal.invalid_reason) throw new Error("Invalid handoff lacks its reason.");
  return `Note from Ohtia: at this point Ohtia did not accept your handoff proposal because ${explanations[proposal.invalid_reason]}. The researcher was told.`;
}

export function handoffContext(handoff: HandoffRow, priorReply: boolean, selected: boolean) {
  if (handoff.initiated_by === "agent")
    return `Virgilio, the research guide, handed this conversation to you with this note. The researcher did not write it.\n\nNote:\n${handoff.note}`;
  const { name, role } = agentIdentity(handoff.from_agent_id);
  if (priorReply)
    return selected
      ? `The researcher brought you back to this conversation. While you were away, the researcher worked with ${name}, ${role}. Below are the messages from that part that the researcher chose to show you; you have not seen the others.`
      : `The researcher brought you back to this conversation. While you were away, the researcher worked with ${name}, ${role}, and chose not to show you any of those messages.`;
  return selected
    ? `The researcher asked you to continue this conversation, which started with ${name}, ${role}. Below are the messages the researcher chose to show you; you have not seen the others.`
    : `The researcher asked you to continue this conversation, which started with ${name}, ${role}, and chose not to show you any of its messages.`;
}
