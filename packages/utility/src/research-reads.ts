import {
  listPlanEvents,
  planRevisions,
  readPlan,
  readPlanText,
  synthesisSources,
} from "./plan-coordination.js";
import { handoffBoundary, returnableMessages, type HandoffRow } from "./handoffs.js";
import { planInvalidReason } from "./plan-proposals.js";
import { consultationRetryFits } from "./work-limits.js";
import { sql, type Kysely } from "kysely";
import {
  failure,
  isReplyAgent,
  conversationPreviewPrefixLimit,
  handoffSelectionPageSize,
  type HandoffSelectionPage,
  type ConversationSummary,
  encodeEnvelope,
  splitText,
  type Outcome,
  type Request,
  type ResearchEvent,
  type ResearchScope,
  type TimelineItem,
  consultationInvalidReasons,
  type ConsultationInvalidReason,
} from "@ohtia/contracts";
import {
  bytes,
  conversationRecord,
  conversationSummaries,
  identifier,
  type ConversationRow,
  type ResearchSchema,
} from "./research.js";
import { TaskTransaction, type TaskContext } from "./tasks.js";
import { recordedOperationPolicy, replyAgent } from "./operations.js";
import { conversationAttention, type ResearchAttention } from "./research-attention.js";
import { taskPosition } from "./research-task-position.js";
import { setupRevision } from "./project-setup.js";
import { storedText } from "./research-text.js";

/** Test the actual envelope as well as its payload: containers, node count, strings and bytes compose. */
export function fitsResearchResult(request: Request, value: unknown): boolean {
  return encodeEnvelope({ ...request, kind: "result", payload: { ok: true, value } }).ok;
}
const cursorOf = ({ position, rank, id }: TimelineItem) => ({ position, rank, id });
async function exists(db: Kysely<ResearchSchema>, conversationId: string): Promise<boolean> {
  return !!(await db
    .selectFrom("conversations")
    .select("id")
    .where("id", "=", bytes(conversationId))
    .executeTakeFirst());
}
// Model proposals and the explicit development run have an identifiable chat position.
const visibleIntervention = sql<boolean>`(i.proposed_by_attempt_id IS NOT NULL OR EXISTS (
  SELECT 1 FROM command_receipts r WHERE r.operation_id=i.decided_by_operation_id
    AND r.command='development.runPlan'))`;
const interventionPosition = sql<number | null>`coalesce(t.reply_position,
  (SELECT min(m.position) FROM messages m WHERE m.conversation_id=i.conversation_id))`;

function proposalRevision({ state }: Pick<HandoffRow, "state">) {
  return state === "proposed" || state === "invalid" ? 1 : 2;
}

async function timelineItem(
  db: Kysely<ResearchSchema>,
  conversationId: string,
  id: string,
  context: TaskContext,
): Promise<TimelineItem | undefined> {
  const row = await db
    .selectFrom("messages")
    .leftJoin("tasks", "tasks.id", "messages.task_id")
    .selectAll("messages")
    .select([
      "tasks.document_language as language",
      "tasks.kind as task_kind",
      "tasks.operation as operation",
      "tasks.contribution_id as contribution_id",
    ])
    .where("messages.conversation_id", "=", bytes(conversationId))
    .where("messages.id", "=", bytes(id))
    .executeTakeFirst();
  if (row) {
    if (row.agent_id !== null && !isReplyAgent(row.agent_id))
      throw new Error("Unknown reply author.");
    const node =
      row.task_kind === "contribution" && row.contribution_id
        ? await db
            .selectFrom("contributions as c")
            .innerJoin("interventions as i", "i.id", "c.intervention_id")
            .select(["c.plan_key", "c.intervention_id"])
            .where("c.id", "=", row.contribution_id)
            .where(visibleIntervention)
            .executeTakeFirst()
        : undefined;
    return {
      id,
      kind: "message",
      ...(node?.plan_key
        ? { planContribution: { planId: identifier(node.intervention_id), key: node.plan_key } }
        : {}),
      ...(row.task_kind === "consultation" ? ({ consultation: true } as const) : {}),
      ...(row.task_id && row.operation === "contribution_synthesis"
        ? { synthesisSources: await synthesisSources(db, row.task_id) }
        : {}),
      rank: 1,
      revision: 1,
      position: row.position,
      authorKind: row.author_kind,
      agentId: row.agent_id,
      taskId: row.task_id ? identifier(row.task_id) : null,
      content: storedText(row.content, `message_${id}`),
      language: row.author_kind === "agent" ? row.language : null,
      ending: row.ending,
    };
  }
  const proposal = await db
    .selectFrom("project_setup_proposals as p")
    .innerJoin("tasks as t", "t.id", "p.task_id")
    .selectAll("p")
    .select("t.reply_position")
    .where("t.conversation_id", "=", bytes(conversationId))
    .where("p.id", "=", bytes(id))
    .executeTakeFirst();
  if (proposal && proposal.reply_position !== null)
    return {
      id,
      kind: "setupProposal",
      rank: 2,
      position: proposal.reply_position,
      revision: setupRevision(proposal),
      taskId: identifier(proposal.task_id),
      title: storedText(proposal.title, `setup_title_${id}`),
      documentLanguage: storedText(proposal.document_language, `setup_language_${id}`),
      state: proposal.state,
      invalidReason: proposal.invalid_reason,
    };
  const plan = await db
    .selectFrom("interventions as i")
    .leftJoin("attempts as a", "a.id", "i.proposed_by_attempt_id")
    .leftJoin("tasks as t", "t.id", "a.task_id")
    .innerJoin("projects as p", "p.id", "i.project_id")
    .select([
      "i.state",
      "i.invalid_reason",
      "i.revision",
      "t.id as taskId",
      "p.document_language",
      interventionPosition.as("position"),
    ])
    .where("i.kind", "=", "plan")
    .where(visibleIntervention)
    .where("i.conversation_id", "=", bytes(conversationId))
    .where("i.id", "=", bytes(id))
    .executeTakeFirst();
  if (plan && plan.position !== null)
    return {
      id,
      kind: "plan",
      rank: 2,
      revision: plan.revision,
      position: plan.position,
      taskId: plan.taskId ? identifier(plan.taskId) : null,
      language: plan.document_language,
      state: plan.state,
      invalidReason: plan.state === "invalid" ? planInvalidReason(plan.invalid_reason) : null,
    };
  const consultation = await db
    .selectFrom("interventions as i")
    .innerJoin("attempts as a", "a.id", "i.proposed_by_attempt_id")
    .innerJoin("tasks as origin", "origin.id", "a.task_id")
    .leftJoin("contributions as c", "c.intervention_id", "i.id")
    .leftJoin("tasks as initial", (join) =>
      join.onRef("initial.contribution_id", "=", "c.id").on("initial.replaces_task_id", "is", null),
    )
    .select([
      "i.state",
      "i.invalid_reason",
      "i.revision",
      "origin.id as taskId",
      "origin.reply_position",
      "origin.document_language",
      "c.agent_id",
      "c.request",
      "c.reason",
      "initial.connection",
    ])
    .where("i.conversation_id", "=", bytes(conversationId))
    .where("i.kind", "=", "consultation")
    .where("i.id", "=", bytes(id))
    .executeTakeFirst();
  if (consultation && consultation.reply_position !== null) {
    if (consultation.agent_id !== null && consultation.agent_id !== "josefa")
      throw new Error("Unknown consultation agent.");
    if (
      consultation.invalid_reason !== null &&
      !consultationInvalidReasons.includes(consultation.invalid_reason as ConsultationInvalidReason)
    )
      throw new Error("Unknown consultation invalid reason.");
    return {
      id,
      kind: "consultation",
      rank: 2,
      revision: consultation.revision,
      position: consultation.reply_position,
      taskId: identifier(consultation.taskId),
      language: consultation.document_language,
      state: consultation.state,
      invalidReason: consultation.invalid_reason as ConsultationInvalidReason | null,
      agentId: consultation.agent_id,
      request:
        consultation.request === null
          ? null
          : storedText(consultation.request, `consultation_${id}`),
      reason: consultation.reason,
      connection: consultation.connection,
    };
  }
  // The originating attempt identifies the divider so the accepted card keeps its own ID.
  const handoff = await db
    .selectFrom("handoffs as h")
    .leftJoin("attempts as a", "a.id", "h.proposed_by_attempt_id")
    .leftJoin("tasks as t", "t.id", "a.task_id")
    .selectAll("h")
    .select(["t.id as taskId", "t.reply_position"])
    .where("h.conversation_id", "=", bytes(conversationId))
    .where((eb) =>
      eb.or([eb("h.id", "=", bytes(id)), eb("h.proposed_by_attempt_id", "=", bytes(id))]),
    )
    .executeTakeFirst();
  if (handoff) {
    if (
      handoff.state === "accepted" &&
      handoff.position !== null &&
      handoff.to_agent_id &&
      identifier(handoff.proposed_by_attempt_id ?? handoff.id) === id
    )
      return {
        id,
        kind: "handoffDivider",
        rank: 1,
        revision: 1,
        position: handoff.position,
        agentId: handoff.to_agent_id,
      };
    if (handoff.taskId && handoff.reply_position !== null && identifier(handoff.id) === id)
      return {
        id,
        kind: "handoffProposal",
        rank: 2,
        revision: proposalRevision(handoff),
        position: handoff.reply_position,
        taskId: identifier(handoff.taskId),
        expectedOwnerRevision: handoff.expected_owner_revision,
        state: handoff.state,
        invalidReason: handoff.invalid_reason,
        note: handoff.state === "invalid" ? null : storedText(handoff.note, `handoff_${id}`),
        reason: handoff.state === "invalid" ? null : handoff.reason,
      };
    return undefined;
  }
  const task = await db
    .selectFrom("tasks as t")
    .selectAll("t")
    .select(taskPosition.as("position"))
    .where("t.conversation_id", "=", bytes(conversationId))
    .where((eb) =>
      eb.or([
        eb("t.kind", "in", ["reply", "consultation"]),
        eb.and([
          eb("t.operation", "=", "contribution_synthesis"),
          eb("t.reply_position", "is not", null),
        ]),
      ]),
    )
    .where("t.id", "=", bytes(id))
    .executeTakeFirst();
  if (!task) return undefined;
  const attempt = await db
    .selectFrom("attempts")
    .selectAll()
    .where("task_id", "=", task.id)
    .orderBy("attempt_number", "desc")
    .executeTakeFirst();
  const replacement = await db
    .selectFrom("tasks")
    .select("id")
    .where("replaces_task_id", "=", task.id)
    .executeTakeFirst();
  const saved = await db
    .selectFrom("messages")
    .select("id")
    .where("task_id", "=", task.id)
    .executeTakeFirst();
  const policy = recordedOperationPolicy(task.operation, task.policy_version);
  if (!policy) throw new Error("Task policy unavailable.");
  const synthesis =
    task.kind === "synthesis"
      ? await db
          .selectFrom("continuations")
          .select(["stopped", "intervention_id"])
          .where("task_id", "=", task.id)
          .executeTakeFirst()
      : undefined;
  return {
    id,
    kind: "task",
    rank: 3,
    revision: task.state_revision,
    position: task.position,
    ...(task.kind === "consultation"
      ? {
          consultation: true as const,
          replacesTaskId: task.replaces_task_id ? identifier(task.replaces_task_id) : null,
          consultationRetryFits: !replacement && (await consultationRetryFits(db, task, policy)),
        }
      : {}),
    ...(task.kind === "synthesis"
      ? {
          synthesis: true as const,
          synthesisStopped: synthesis?.stopped === 1,
          ...(synthesis ? { synthesisPlanId: identifier(synthesis.intervention_id) } : {}),
        }
      : {}),
    agentId: replyAgent(task.operation),
    language: task.document_language,
    state: task.state === "waiting_capacity" ? "queued" : task.state,
    connection: task.connection,
    blockingReason: task.blocking_reason,
    outcomeReason: attempt?.outcome_reason ?? null,
    replyMessageId: saved ? identifier(saved.id) : null,
    waitingForModels:
      task.state === "queued" && context.connections.awaitingModels(task.connection),
    waitingLimit:
      task.state === "queued"
        ? await new TaskTransaction(db, context).waitingLimit(task.connection)
        : null,
    dispatched:
      attempt?.dispatch_permitted_at !== null && attempt?.dispatch_permitted_at !== undefined,
    superseded:
      !!replacement ||
      (task.state === "cancelled" &&
        ["service_restarted", "permit_expired"].includes(attempt?.outcome_reason ?? "")),
    maxAttemptDurationMs: policy.max_attempt_duration_ms,
    maxInactivityMs: policy.max_inactivity_ms,
  };
}
export async function readPauseCounts(
  db: Kysely<ResearchSchema>,
): Promise<import("@ohtia/contracts").PauseCounts> {
  const revision = await sql<{
    revision: number;
  }>`SELECT revision FROM pause_counts_revision`.execute(db);
  const restart = await db
    .selectFrom("tasks")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("state", "in", ["blocked", "waiting_capacity"])
    .where("blocking_reason", "=", "restart_paused")
    .executeTakeFirstOrThrow();
  const heldContributions = await db
    .selectFrom("contributions")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("restart_held", "=", 1)
    .where("state", "=", "waiting")
    .executeTakeFirstOrThrow();
  const heldContinuations = await db
    .selectFrom("continuations")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("admission", "=", "waiting")
    .where("restart_held", "=", 1)
    .executeTakeFirstOrThrow();
  const usage = [];
  for (const pause of await db
    .selectFrom("usage_limit_pauses")
    .select("connection")
    .where("resumed_at", "is", null)
    .orderBy("connection")
    .execute()) {
    const held = await db
      .selectFrom("tasks")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("state", "=", "blocked")
      .where("blocking_reason", "=", "usage_limit_reached")
      .where("connection", "=", pause.connection)
      .executeTakeFirstOrThrow();
    usage.push({ connection: pause.connection, count: held.count });
  }
  const snapshot = revision.rows[0];
  if (!snapshot) throw new Error("Pause revision unavailable.");
  return {
    revision: snapshot.revision,
    restart: restart.count + heldContributions.count + heldContinuations.count,
    usage,
  };
}
async function summarizeConversation(
  db: Kysely<ResearchSchema>,
  row: ConversationRow & { latestAt: string; latestMessageId: Uint8Array | null },
): Promise<ConversationSummary> {
  const latest = row.latestMessageId
    ? await db
        .selectFrom("messages")
        .leftJoin("tasks", "tasks.id", "messages.task_id")
        .select(["messages.content", "tasks.document_language as language"])
        .where("messages.id", "=", row.latestMessageId)
        .executeTakeFirstOrThrow()
    : undefined;
  const prefix = [];
  for (const character of latest?.content ?? "") {
    prefix.push(character);
    if (prefix.length > conversationPreviewPrefixLimit) break;
  }
  const tasks = db
    .selectFrom("tasks")
    .select(["id", "state"])
    .where("conversation_id", "=", row.id)
    .where("kind", "in", ["reply", "consultation"]);
  const attention = await conversationAttention(db, row.id);
  const latestReply = await tasks
    .where("kind", "=", "reply")
    .orderBy(sql`rowid`, "desc")
    .executeTakeFirst();
  const running = await tasks
    .select("operation")
    .where("state", "in", ["running", "cancelling"])
    .executeTakeFirst();
  const waiting = await db
    .selectFrom("tasks")
    .select("id")
    .where("conversation_id", "=", row.id)
    .where("state", "in", ["queued", "blocked", "waiting_capacity"])
    .executeTakeFirst();
  return {
    ...conversationRecord(row),
    ownerPosition: (await handoffBoundary(db, row.id))?.position ?? null,
    latestAt: row.latestAt,
    latestPrefix: prefix.slice(0, conversationPreviewPrefixLimit).join(""),
    latestTruncated: prefix.length > conversationPreviewPrefixLimit,
    latestLanguage: latest?.language ?? null,
    latestReplyTaskId: latestReply ? identifier(latestReply.id) : null,
    runningTask: running
      ? {
          id: identifier(running.id),
          agentId: replyAgent(running.operation),
          state: running.state === "cancelling" ? "cancelling" : "running",
        }
      : null,
    status:
      attention.reply_attention || attention.plan_id
        ? "attention"
        : running
          ? "replying"
          : waiting
            ? "waiting"
            : null,
  };
}
export async function readResearch(
  db: Kysely<ResearchSchema>,
  request: Request,
  context: TaskContext,
  attention: ResearchAttention,
): Promise<Outcome<unknown>> {
  switch (request.operation) {
    case "handoff.selection": {
      const { conversationId, expectedOwnerRevision, after } = request.payload;
      const id = bytes(conversationId);
      const conversation = await db
        .selectFrom("conversations")
        .select(["owner_revision", "agent_id"])
        .where("id", "=", id)
        .executeTakeFirst();
      if (!conversation) return failure("record_not_found");
      if (
        conversation.owner_revision !== expectedOwnerRevision ||
        conversation.agent_id !== "josefa"
      )
        return failure("owner_changed");
      const prior = await db
        .selectFrom("messages as m")
        .innerJoin("tasks as t", "t.id", "m.task_id")
        .select("m.id")
        .where("m.conversation_id", "=", id)
        .where("m.agent_id", "=", "virgilio")
        .where("t.kind", "in", ["reply", "synthesis"])
        .executeTakeFirst();
      const priorHandoff = await db
        .selectFrom("handoffs")
        .select("id")
        .where("conversation_id", "=", id)
        .where("from_agent_id", "=", "virgilio")
        .where("state", "=", "accepted")
        .executeTakeFirst();
      const priorReply = !!(prior || priorHandoff);
      const rows = await returnableMessages(db, id)
        .where("m.position", ">", after)
        .select([
          "m.position",
          "m.agent_id",
          sql<string>`substr(m.content,1,${conversationPreviewPrefixLimit + 1})`.as("sample"),
        ])
        .orderBy("m.position")
        .limit(handoffSelectionPageSize + 1)
        .execute();
      const messages: HandoffSelectionPage["messages"] = rows
        .slice(0, handoffSelectionPageSize)
        .map((row) => {
          const symbols = Array.from(row.sample);
          if (row.agent_id !== null && !isReplyAgent(row.agent_id))
            throw new Error("Unknown message author.");
          return {
            position: row.position,
            agentId: row.agent_id,
            prefix: symbols.slice(0, conversationPreviewPrefixLimit).join(""),
            truncated: symbols.length > conversationPreviewPrefixLimit,
          };
        });
      let length = messages.length;
      while (length > 0) {
        const last = messages[length - 1];
        if (!last) break;
        const page = {
          priorReply,
          messages: messages.slice(0, length),
          next: rows.length > length ? last.position : null,
        };
        if (fitsResearchResult(request, page)) return { ok: true, value: page };
        length--;
      }
      return rows.length
        ? failure("invalid_service_result")
        : { ok: true, value: { priorReply, messages: [], next: null } };
    }
    case "plan.read":
      return readPlan(db, request.payload.planId);
    case "planEvent.list":
      return listPlanEvents(db, request.payload.planId, request.payload.afterSequence);
    case "pause.read":
      return { ok: true, value: await readPauseCounts(db) };
    case "destination.read": {
      const p = request.payload;
      const project = await db
        .selectFrom("projects")
        .select("id")
        .where("id", "=", bytes(p.projectId))
        .executeTakeFirst();
      if (!project) return failure("record_not_found");
      let agent = "agentId" in p ? p.agentId : undefined;
      if ("conversationId" in p) {
        const conversation = await db
          .selectFrom("conversations")
          .select("agent_id")
          .where("id", "=", bytes(p.conversationId))
          .where("project_id", "=", project.id)
          .executeTakeFirst();
        if (!conversation) return failure("record_not_found");
        agent = conversation.agent_id;
      }
      const destination = await new TaskTransaction(db, context).destination(project.id, agent);
      return {
        ok: true,
        value: {
          destination: destination
            ? {
                operation: destination.policy.operation,
                maxAttemptDurationMs: destination.policy.max_attempt_duration_ms,
                connection: destination.connection,
              }
            : null,
        },
      };
    }

    case "projectAttention.list": {
      const value = attention.list(request.payload);
      return fitsResearchResult(request, value)
        ? { ok: true, value }
        : failure("invalid_service_result");
    }
    case "project.list": {
      const { cursor, count } = request.payload;
      let query = db.selectFrom("projects").selectAll();
      if (cursor)
        query = query.where((eb) =>
          eb.or([
            eb("last_opened_at", "<", cursor.lastOpenedAt),
            eb.and([
              eb("last_opened_at", "=", cursor.lastOpenedAt),
              eb("id", "<", bytes(cursor.id)),
            ]),
          ]),
        );
      const rows = await query
        .orderBy("last_opened_at", "desc")
        .orderBy("id", "desc")
        .limit(count + 1)
        .execute();
      const items: import("@ohtia/contracts").ProjectSummary[] = [];
      const cursorOf = (row: import("@ohtia/contracts").ProjectRecord) => ({
        lastOpenedAt: row.lastOpenedAt,
        id: row.id,
      });
      for (const row of rows.slice(0, count)) {
        const item = {
          id: identifier(row.id),
          projectType: row.project_type,
          title: row.title,
          documentLanguage: row.document_language,
          isDevelopment: row.is_development === 1,
          setupConfirmedAt: row.setup_confirmed_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastOpenedAt: row.last_opened_at,
          needsAttention: attention.has(identifier(row.id)),
        };
        const hasMore = items.length + 1 < rows.length;
        if (
          !fitsResearchResult(request, {
            items: [...items, item],
            next: hasMore ? cursorOf(item) : null,
            hasMore,
          })
        )
          break;
        items.push(item);
      }
      const hasMore = items.length < rows.length;
      const last = items.at(-1);
      if (hasMore && !last) return failure("invalid_service_result");
      return { ok: true, value: { items, next: hasMore && last ? cursorOf(last) : null, hasMore } };
    }
    case "conversation.list": {
      const { projectId, cursor, count } = request.payload;
      const project = await db
        .selectFrom("projects")
        .select("id")
        .where("id", "=", bytes(projectId))
        .executeTakeFirst();
      if (!project) return failure("record_not_found");
      let query = conversationSummaries(db, projectId).selectAll();
      if (cursor)
        query = query.where((eb) =>
          eb.or([
            eb("latestAt", "<", cursor.latestAt),
            eb.and([eb("latestAt", "=", cursor.latestAt), eb("id", "<", bytes(cursor.id))]),
          ]),
        );
      const rows = await query
        .orderBy("latestAt", "desc")
        .orderBy("id", "desc")
        .limit(count + 1)
        .execute();
      const items: ConversationSummary[] = [];
      const cursorOf = ({ latestAt, id }: ConversationSummary) => ({ latestAt, id });
      for (const row of rows.slice(0, count)) {
        const item = await summarizeConversation(db, row);
        const hasMore = items.length + 1 < rows.length;
        if (
          !fitsResearchResult(request, {
            items: [...items, item],
            next: hasMore ? cursorOf(item) : null,
            hasMore,
          })
        )
          break;
        items.push(item);
      }
      const hasMore = items.length < rows.length;
      const last = items.at(-1);
      if (hasMore && !last) return failure("invalid_service_result");
      return { ok: true, value: { items, next: hasMore && last ? cursorOf(last) : null, hasMore } };
    }
    case "conversation.read": {
      const { projectId, ids } = request.payload;
      const project = await db
        .selectFrom("projects")
        .select("id")
        .where("id", "=", bytes(projectId))
        .executeTakeFirst();
      if (!project) return failure("record_not_found");
      if (!ids.length) return { ok: true, value: { items: [], remaining: [] } };
      const rows = await conversationSummaries(db, projectId)
        .selectAll()
        .where("id", "in", ids.map(bytes))
        .execute();
      const byId = new Map(rows.map((row) => [identifier(row.id), row]));
      const items: ConversationSummary[] = [];
      for (const id of ids) {
        const row = byId.get(id);
        if (!row) return failure("record_not_found");
        const item = await summarizeConversation(db, row);
        if (
          !fitsResearchResult(request, {
            items: [...items, item],
            remaining: ids.slice(items.length + 1),
          })
        )
          break;
        items.push(item);
      }
      if (!items.length) return failure("invalid_service_result");
      return { ok: true, value: { items, remaining: ids.slice(items.length) } };
    }
    case "timeline.listBefore": {
      const p = request.payload;
      if (!(await exists(db, p.conversationId))) return failure("record_not_found");
      const c = p.cursor;
      const before = c
        ? sql`WHERE position < ${c.position} OR (position = ${c.position} AND (rank < ${c.rank} OR (rank = ${c.rank} AND id < ${bytes(c.id)})))`
        : sql``;
      const rows = await sql<{ id: Uint8Array; position: number; rank: number }>`
        SELECT id, position, rank FROM (
          SELECT id, position, 1 AS rank FROM messages WHERE conversation_id = ${bytes(p.conversationId)}
          UNION ALL SELECT coalesce(proposed_by_attempt_id,id), position, 1 AS rank FROM handoffs
            WHERE conversation_id = ${bytes(p.conversationId)} AND state='accepted'
          UNION ALL SELECT h.id, t.reply_position, 2 AS rank
            FROM handoffs h JOIN attempts a ON a.id=h.proposed_by_attempt_id JOIN tasks t ON t.id=a.task_id
            WHERE h.conversation_id = ${bytes(p.conversationId)}
          UNION ALL SELECT t.id, ${taskPosition} AS position, 3 AS rank FROM tasks t WHERE t.conversation_id = ${bytes(p.conversationId)} AND (t.kind IN ('reply','consultation') OR (t.operation='contribution_synthesis' AND t.reply_position IS NOT NULL))
          UNION ALL SELECT p.id, t.reply_position AS position, 2 AS rank FROM project_setup_proposals p JOIN tasks t ON t.id=p.task_id WHERE t.conversation_id = ${bytes(p.conversationId)}
          UNION ALL SELECT i.id, ${interventionPosition} AS position, 2 AS rank
            FROM interventions i LEFT JOIN attempts a ON a.id=i.proposed_by_attempt_id LEFT JOIN tasks t ON t.id=a.task_id
            WHERE i.conversation_id = ${bytes(p.conversationId)} AND ${visibleIntervention}
        ) ${before} ORDER BY position DESC, rank DESC, id DESC LIMIT ${p.count + 1}`.execute(db);
      const items: TimelineItem[] = [];
      for (const row of rows.rows.slice(0, p.count)) {
        const item = await timelineItem(db, p.conversationId, identifier(row.id), context);
        if (!item) throw new Error("Timeline item vanished in snapshot.");
        const more = items.length + 1 < rows.rows.length;
        if (
          !fitsResearchResult(request, {
            items: [...items, item],
            next: more ? cursorOf(item) : null,
            hasMore: more,
          })
        )
          break;
        items.push(item);
      }
      const hasMore = items.length < rows.rows.length;
      if (hasMore && !items.length) return failure("invalid_service_result");
      const last = items.at(-1);
      return { ok: true, value: { items, next: hasMore && last ? cursorOf(last) : null, hasMore } };
    }
    case "timeline.read": {
      const p = request.payload;
      if (!(await exists(db, p.conversationId))) return failure("record_not_found");
      const items: TimelineItem[] = [];
      let consumed = 0;
      for (const id of p.ids) {
        const item = await timelineItem(db, p.conversationId, id, context);
        if (!item) return failure("record_not_found");
        if (
          !fitsResearchResult(request, {
            items: [...items, item],
            remaining: p.ids.slice(consumed + 1),
          })
        )
          break;
        items.push(item);
        consumed++;
      }
      if (p.ids.length && !consumed) return failure("invalid_service_result");
      return { ok: true, value: { items, remaining: p.ids.slice(consumed) } };
    }
    case "text.readPart": {
      if (request.payload.source.startsWith("plan_"))
        return readPlanText(db, request.payload.source, request.payload.index);
      const handoff = /^handoff_([0-9a-f-]+)$/.exec(request.payload.source);
      if (handoff?.[1]) {
        const row = await db
          .selectFrom("handoffs")
          .select("note")
          .where("id", "=", bytes(handoff[1]))
          .where("state", "!=", "invalid")
          .executeTakeFirst();
        const text = row && splitText(row.note)[request.payload.index - 1];
        return typeof text === "string"
          ? { ok: true, value: { text } }
          : failure("record_not_found");
      }
      const consultation = /^consultation_([0-9a-f-]+)$/.exec(request.payload.source);
      if (consultation?.[1]) {
        const row = await db
          .selectFrom("contributions")
          .select("request")
          .where("plan_key", "is", null)
          .where("intervention_id", "=", bytes(consultation[1]))
          .executeTakeFirst();
        const text = row && splitText(row.request)[request.payload.index - 1];
        return typeof text === "string"
          ? { ok: true, value: { text } }
          : failure("record_not_found");
      }
      const setup = /^setup_(title|language)_([0-9a-f-]+)$/.exec(request.payload.source);
      if (setup?.[2]) {
        const row = await db
          .selectFrom("project_setup_proposals")
          .select(["title", "document_language"])
          .where("id", "=", bytes(setup[2]))
          .executeTakeFirst();
        const text =
          row &&
          splitText(setup[1] === "title" ? row.title : row.document_language)[
            request.payload.index - 1
          ];
        return typeof text === "string"
          ? { ok: true, value: { text } }
          : failure("record_not_found");
      }
      const match = /^message_([0-9a-f-]+)$/.exec(request.payload.source);
      if (!match?.[1]) return failure("record_not_found");
      const row = await db
        .selectFrom("messages")
        .select("content")
        .where("id", "=", bytes(match[1]))
        .executeTakeFirst();
      const text = row && splitText(row.content)[request.payload.index - 1];
      return typeof text === "string" ? { ok: true, value: { text } } : failure("record_not_found");
    }
    default:
      return failure("invalid_message");
  }
}
/** Metadata only; no private message text enters the subscription revision map. */
export async function researchRevisions(
  db: Kysely<ResearchSchema>,
  scope: ResearchScope,
): Promise<readonly Extract<ResearchEvent, { kind: "changed" | "planChanged" }>[]> {
  const result: Extract<ResearchEvent, { kind: "changed" | "planChanged" }>[] = [];
  for (const row of await db.selectFrom("projects").select(["id", "setup_confirmed_at"]).execute())
    result.push({
      kind: "changed",
      record: "project",
      id: identifier(row.id),
      revision: row.setup_confirmed_at ? 2 : 1,
    });
  for (const row of await db
    .selectFrom("usage_limit_pauses")
    .select(["id", "resumed_at"])
    .execute())
    result.push({
      kind: "changed",
      record: "usagePause",
      id: identifier(row.id),
      revision: row.resumed_at ? 2 : 1,
    });
  for (const row of await db
    .selectFrom("application_preferences")
    .select(["key", "revision"])
    .where("key", "=", "execution_limits")
    .execute())
    result.push({
      kind: "changed",
      record: "executionLimits",
      id: row.key,
      revision: row.revision,
    });
  if (scope.projectId)
    for (const row of await db
      .selectFrom("conversations")
      .select(["id", "revision"])
      .where("project_id", "=", bytes(scope.projectId))
      .execute())
      result.push({
        kind: "changed",
        record: "conversation",
        id: identifier(row.id),
        revision: row.revision,
      });
  if (scope.conversationId) {
    const conversation = await db
      .selectFrom("conversations")
      .select("project_id")
      .where("id", "=", bytes(scope.conversationId))
      .executeTakeFirst();
    if (!conversation || identifier(conversation.project_id) !== scope.projectId)
      throw new Error("Invalid research scope.");
    for (const row of await db
      .selectFrom("messages")
      .select("id")
      .where("conversation_id", "=", bytes(scope.conversationId))
      .execute())
      result.push({ kind: "changed", record: "timeline", id: identifier(row.id), revision: 1 });
    for (const row of await db
      .selectFrom("handoffs")
      .select(["id", "state", "proposed_by_attempt_id"])
      .where("conversation_id", "=", bytes(scope.conversationId))
      .execute()) {
      if (row.proposed_by_attempt_id)
        result.push({
          kind: "changed",
          record: "timeline",
          id: identifier(row.id),
          revision: proposalRevision(row),
        });
      if (row.state === "accepted")
        result.push({
          kind: "changed",
          record: "timeline",
          id: identifier(row.proposed_by_attempt_id ?? row.id),
          revision: 1,
        });
    }
    for (const row of await db
      .selectFrom("project_setup_proposals as p")
      .innerJoin("tasks as t", "t.id", "p.task_id")
      .select(["p.id", "p.state"])
      .where("t.conversation_id", "=", bytes(scope.conversationId))
      .execute())
      result.push({
        kind: "changed",
        record: "timeline",
        id: identifier(row.id),
        revision: setupRevision(row),
      });
    for (const row of await db
      .selectFrom("interventions as i")
      .select(["i.id", "i.revision"])
      .where("i.conversation_id", "=", bytes(scope.conversationId))
      .where(visibleIntervention)
      .execute())
      result.push({
        kind: "changed",
        record: "timeline",
        id: identifier(row.id),
        revision: row.revision,
      });
    for (const row of await db
      .selectFrom("tasks")
      .select(["id", "state_revision"])
      .where((eb) =>
        eb.or([
          eb("kind", "in", ["reply", "consultation"]),
          eb.and([
            eb("operation", "=", "contribution_synthesis"),
            eb("reply_position", "is not", null),
          ]),
        ]),
      )
      .where("conversation_id", "=", bytes(scope.conversationId))
      .execute())
      result.push({
        kind: "changed",
        record: "timeline",
        id: identifier(row.id),
        revision: row.state_revision,
      });
  }
  return [...result, ...(await planRevisions(db, scope))];
}
