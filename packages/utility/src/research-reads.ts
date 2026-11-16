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
  const task = await db
    .selectFrom("tasks")
    .selectAll()
    .where("conversation_id", "=", bytes(conversationId))
    .where("id", "=", bytes(id))
    .executeTakeFirst();
  return task
    ? {
        id,
        kind: "task",
        rank: 3,
        revision: task.state_revision,
        position: task.reply_position ?? task.input_through_position,
        agentId: "virgilio",
        language: task.document_language,
        state: task.state,
      }
    : undefined;
}
export async function readResearch(
  db: Kysely<ResearchSchema>,
  request: Request,
): Promise<Outcome<unknown>> {
  switch (request.operation) {
    case "project.list":
    case "conversation.list": {
      const p = request.payload;
      const result =
        request.operation === "project.list"
          ? await listProjects(db)
          : await listConversations(db, request.payload.projectId);
      if (!result.ok) return result;
      const rows = result.value.map((row) =>
        "projectId" in row ? { ...row, agentId: "virgilio" as const } : row,
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
        all.value.map((row) => [row.id, { ...row, agentId: "virgilio" as const }]),
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
        ) ${before} ORDER BY position DESC, rank DESC, id DESC LIMIT ${p.count + 1}`.execute(db);
      const items: TimelineItem[] = [];
      for (const row of rows.rows.slice(0, p.count)) {
        const item = await timelineItem(db, p.conversationId, identifier(row.id));
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
        const item = await timelineItem(db, p.conversationId, id);
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
