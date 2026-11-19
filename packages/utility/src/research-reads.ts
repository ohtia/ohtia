import { sql, type Kysely } from "kysely";
import {
  failure,
  isReplyAgent,
  conversationPreviewPrefixLimit,
  type ConversationSummary,
  encodeEnvelope,
  splitText,
  type Outcome,
  type Request,
  type ResearchEvent,
  type ResearchScope,
  type TimelineItem,
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
// An unstarted retry follows the most recent reserved position in its replacement chain.
const taskPosition = sql<number>`coalesce(t.reply_position, t.input_through_position,
  (WITH RECURSIVE previous(id, reply_position, replaces_task_id, depth) AS (
    SELECT id, reply_position, replaces_task_id, 1 FROM tasks WHERE id=t.replaces_task_id
    UNION ALL SELECT older.id, older.reply_position, older.replaces_task_id, previous.depth+1
      FROM tasks older JOIN previous ON older.id=previous.replaces_task_id
  ) SELECT reply_position FROM previous WHERE reply_position IS NOT NULL ORDER BY depth LIMIT 1),
  (SELECT origin.reply_position FROM contributions c JOIN interventions i ON i.id=c.intervention_id
    JOIN attempts a ON a.id=i.proposed_by_attempt_id JOIN tasks origin ON origin.id=a.task_id
    WHERE c.id=t.contribution_id))`;

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
    .select(["tasks.document_language as language", "tasks.kind as task_kind"])
    .where("messages.conversation_id", "=", bytes(conversationId))
    .where("messages.id", "=", bytes(id))
    .executeTakeFirst();
  if (row) {
    if (row.agent_id !== null && !isReplyAgent(row.agent_id))
      throw new Error("Unknown reply author.");
    return {
      id,
      kind: "message",
      ...(row.task_kind === "consultation" ? ({ consultation: true } as const) : {}),
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
    .where("i.id", "=", bytes(id))
    .executeTakeFirst();
  if (consultation && consultation.reply_position !== null)
    return {
      id,
      kind: "consultation",
      rank: 2,
      revision: consultation.revision,
      position: consultation.reply_position,
      taskId: identifier(consultation.taskId),
      language: consultation.document_language,
      state: consultation.state,
      invalidReason: consultation.invalid_reason,
      agentId: consultation.agent_id,
      request:
        consultation.request === null
          ? null
          : storedText(consultation.request, `consultation_${id}`),
      reason: consultation.reason,
      connection: consultation.connection,
    };
  const task = await db
    .selectFrom("tasks as t")
    .selectAll("t")
    .select(taskPosition.as("position"))
    .where("t.conversation_id", "=", bytes(conversationId))
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
        }
      : {}),
    agentId: replyAgent(task.operation),
    language: task.document_language,
    state: task.state,
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
    .where("state", "=", "blocked")
    .where("blocking_reason", "=", "restart_paused")
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
  return { revision: snapshot.revision, restart: restart.count, usage };
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
    .where("conversation_id", "=", row.id);
  const latestTask = await tasks.orderBy(sql`rowid`, "desc").executeTakeFirst();
  const latestReply = await tasks
    .where("kind", "=", "reply")
    .orderBy(sql`rowid`, "desc")
    .executeTakeFirst();
  const running = await tasks
    .select("operation")
    .where("state", "in", ["running", "cancelling"])
    .executeTakeFirst();
  const waiting = await tasks.where("state", "in", ["queued", "blocked"]).executeTakeFirst();
  return {
    ...conversationRecord(row),
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
      latestTask?.state === "failed" || latestTask?.state === "uncertain"
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
): Promise<Outcome<unknown>> {
  switch (request.operation) {
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
      const items: import("@ohtia/contracts").ProjectRecord[] = [];
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
          UNION ALL SELECT t.id, ${taskPosition} AS position, 3 AS rank FROM tasks t WHERE t.conversation_id = ${bytes(p.conversationId)}
          UNION ALL SELECT p.id, t.reply_position AS position, 2 AS rank FROM project_setup_proposals p JOIN tasks t ON t.id=p.task_id WHERE t.conversation_id = ${bytes(p.conversationId)}
          UNION ALL SELECT i.id, t.reply_position AS position, 2 AS rank
            FROM interventions i JOIN attempts a ON a.id=i.proposed_by_attempt_id JOIN tasks t ON t.id=a.task_id
            WHERE i.conversation_id = ${bytes(p.conversationId)}
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
      const consultation = /^consultation_([0-9a-f-]+)$/.exec(request.payload.source);
      if (consultation?.[1]) {
        const row = await db
          .selectFrom("contributions")
          .select("request")
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
): Promise<readonly Extract<ResearchEvent, { kind: "changed" }>[]> {
  const result: Extract<ResearchEvent, { kind: "changed" }>[] = [];
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
      .selectFrom("interventions")
      .select(["id", "revision"])
      .where("conversation_id", "=", bytes(scope.conversationId))
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
      .where("conversation_id", "=", bytes(scope.conversationId))
      .execute())
      result.push({
        kind: "changed",
        record: "timeline",
        id: identifier(row.id),
        revision: row.state_revision,
      });
  }
  return result;
}
