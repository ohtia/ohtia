import { sql, type Kysely } from "kysely";
import {
  failure,
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
  identifier,
  listProjects,
  listConversations,
  type ResearchSchema,
} from "./research.js";
import { TaskTransaction, type TaskContext } from "./tasks.js";
import { operationPolicy } from "./operations.js";
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
    .select("tasks.document_language as language")
    .where("messages.conversation_id", "=", bytes(conversationId))
    .where("messages.id", "=", bytes(id))
    .executeTakeFirst();
  if (row)
    return {
      id,
      kind: "message",
      rank: 1,
      revision: 1,
      position: row.position,
      authorKind: row.author_kind,
      agentId: row.author_kind === "agent" ? "virgilio" : null,
      taskId: row.task_id ? identifier(row.task_id) : null,
      content: storedText(row.content, `message_${id}`),
      language: row.author_kind === "agent" ? row.language : null,
      ending: row.ending,
    };
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
  const task = await db
    .selectFrom("tasks")
    .selectAll()
    .where("conversation_id", "=", bytes(conversationId))
    .where("id", "=", bytes(id))
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
  const policy = operationPolicy(task.operation, task.policy_version, context.mode);
  if (!policy) throw new Error("Task policy unavailable.");
  return {
    id,
    kind: "task",
    rank: 3,
    revision: task.state_revision,
    position: task.reply_position ?? task.input_through_position,
    agentId: "virgilio",
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
async function latestReplyTask(
  db: Kysely<ResearchSchema>,
  conversation: string,
): Promise<string | null> {
  const task = await db
    .selectFrom("tasks")
    .select("id")
    .where("conversation_id", "=", bytes(conversation))
    .orderBy(sql`rowid`, "desc")
    .executeTakeFirst();
  return task ? identifier(task.id) : null;
}
async function runningTask(
  db: Kysely<ResearchSchema>,
  conversation: string,
): Promise<import("@ohtia/contracts").ConversationSummary["runningTask"]> {
  const row = await db
    .selectFrom("tasks")
    .select(["id", "state"])
    .where("conversation_id", "=", bytes(conversation))
    .where("state", "in", ["running", "cancelling"])
    .executeTakeFirst();
  return row
    ? {
        id: identifier(row.id),
        agentId: "virgilio",
        state: row.state === "cancelling" ? "cancelling" : "running",
      }
    : null;
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
      if ("conversationId" in p) {
        const conversation = await db
          .selectFrom("conversations")
          .select("id")
          .where("id", "=", bytes(p.conversationId))
          .where("project_id", "=", project.id)
          .executeTakeFirst();
        if (!conversation) return failure("record_not_found");
      }
      const destination = await new TaskTransaction(db, context).destination(project.id);
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

    case "project.list":
    case "conversation.list": {
      const p = request.payload;
      const result =
        request.operation === "project.list"
          ? await listProjects(db)
          : await listConversations(db, request.payload.projectId);
      if (!result.ok) return result;
      const rows = await Promise.all(
        result.value.map(async (row) =>
          "projectId" in row
            ? {
                ...row,
                agentId: "virgilio" as const,
                latestReplyTaskId: await latestReplyTask(db, row.id),
                runningTask: await runningTask(db, row.id),
              }
            : row,
        ),
      );
      const offset = p.cursor === null ? 0 : rows.findIndex((row) => row.id === p.cursor) + 1;
      if (p.cursor !== null && offset === 0) return failure("record_not_found");
      const items: typeof rows = [];
      for (const row of rows.slice(offset, offset + p.count)) {
        const more = offset + items.length + 1 < rows.length;
        if (
          !fitsResearchResult(request, {
            items: [...items, row],
            next: more ? row.id : null,
            hasMore: more,
          })
        )
          break;
        items.push(row);
      }
      const hasMore = offset + items.length < rows.length;
      if (hasMore && !items.length) return failure("invalid_service_result");
      return { ok: true, value: { items, next: hasMore ? items.at(-1)?.id : null, hasMore } };
    }
    case "conversation.read": {
      const p = request.payload;
      const all = await listConversations(db, p.projectId);
      if (!all.ok) return all;
      const rows = new Map(
        await Promise.all(
          all.value.map(
            async (row) =>
              [
                row.id,
                {
                  ...row,
                  agentId: "virgilio" as const,
                  latestReplyTaskId: await latestReplyTask(db, row.id),
                  runningTask: await runningTask(db, row.id),
                },
              ] as const,
          ),
        ),
      );
      const items = [];
      let consumed = 0;
      for (const id of p.ids) {
        const row = rows.get(id);
        if (!row) return failure("record_not_found");
        if (
          !fitsResearchResult(request, {
            items: [...items, row],
            remaining: p.ids.slice(consumed + 1),
          })
        )
          break;
        items.push(row);
        consumed++;
      }
      if (p.ids.length && !consumed) return failure("invalid_service_result");
      return { ok: true, value: { items, remaining: p.ids.slice(consumed) } };
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
          UNION ALL SELECT id, coalesce(reply_position,input_through_position) AS position, 3 AS rank FROM tasks WHERE conversation_id = ${bytes(p.conversationId)}
          UNION ALL SELECT p.id, t.reply_position AS position, 2 AS rank FROM project_setup_proposals p JOIN tasks t ON t.id=p.task_id WHERE t.conversation_id = ${bytes(p.conversationId)}
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
