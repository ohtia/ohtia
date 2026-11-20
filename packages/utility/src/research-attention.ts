import { sql, type Kysely } from "kysely";
import type { ProjectAttentionPage, ResearchEvent, ResearchInputs } from "@ohtia/contracts";
import { activityTaskPosition } from "./research-task-position.js";
import { planNeedsAttention } from "./plan-coordination.js";
import { identifier, type ResearchSchema } from "./research.js";

// A synthesis without a reserved or replaced position does not supersede a reply.
const latestReplyTask = sql<Uint8Array | null>`(
  SELECT id FROM (
    SELECT t.id, t.operation, t.rowid AS acceptance, ${activityTaskPosition} AS position
      FROM tasks t WHERE t.conversation_id=conversations.id
        AND (t.kind IN ('reply','consultation') OR t.operation='contribution_synthesis')
  )
  WHERE operation<>'contribution_synthesis' OR position>0
  ORDER BY position DESC, acceptance DESC LIMIT 1
)`;
const attentionPlan = sql<Uint8Array | null>`(
  SELECT i.id FROM interventions i WHERE i.conversation_id=conversations.id AND ${planNeedsAttention}
  ORDER BY i.rowid DESC LIMIT 1
)`;

function attentionRows(db: Kysely<ResearchSchema>) {
  return db
    .selectFrom("conversations")
    .leftJoin("tasks as latest", (join) => join.on("latest.id", "=", latestReplyTask))
    .leftJoin("interventions as plan", (join) => join.on("plan.id", "=", attentionPlan))
    .select([
      "conversations.id",
      "conversations.project_id",
      "latest.id as task_id",
      "latest.state_revision as task_revision",
      sql<number | null>`latest.state IN ('failed','uncertain')`.as("reply_attention"),
      "plan.id as plan_id",
      "plan.revision as plan_revision",
    ]);
}

type AttentionRow = Awaited<
  ReturnType<ReturnType<typeof attentionRows>["executeTakeFirstOrThrow"]>
>;

export async function conversationAttention(db: Kysely<ResearchSchema>, conversation: Uint8Array) {
  return attentionRows(db).where("conversations.id", "=", conversation).executeTakeFirstOrThrow();
}

type AttentionEvent =
  | Extract<ResearchEvent, { kind: "projectAttention" }>
  | (Extract<ResearchEvent, { kind: "attentionRaised" }> & { readonly conversationId: string });
export type ResearchActivity = AttentionEvent | Extract<ResearchEvent, { kind: "replyFinished" }>;

export class ResearchAttention {
  private revision = 1;
  private readonly conversations = new Map<string, AttentionRow>();
  private readonly projects = new Map<string, number>();

  async initialize(db: Kysely<ResearchSchema>): Promise<void> {
    this.revision = 1;
    this.conversations.clear();
    this.projects.clear();
    this.commit(await attentionRows(db).execute());
    this.revision = 1;
  }

  /** Apply the final rows of one committed transaction as one revision. */
  commit(rows: readonly AttentionRow[]): readonly AttentionEvent[] {
    const previousProjects = new Map<string, boolean>();
    const events: AttentionEvent[] = [];
    for (const row of rows) {
      const id = identifier(row.id);
      const project = identifier(row.project_id);
      const previous = this.conversations.get(id);
      const before = previous !== undefined;
      const after = !!(row.reply_attention || row.plan_id);
      if (before !== after) {
        if (!previousProjects.has(project))
          previousProjects.set(project, this.projects.has(project));
        const count = (this.projects.get(project) ?? 0) + (after ? 1 : -1);
        if (count) this.projects.set(project, count);
        else this.projects.delete(project);
      }
      if (after) this.conversations.set(id, row);
      else this.conversations.delete(id);
      const task =
        row.reply_attention &&
        row.task_id &&
        row.task_revision !== null &&
        (!previous?.reply_attention ||
          !previous.task_id ||
          identifier(previous.task_id) !== identifier(row.task_id))
          ? { id: identifier(row.task_id), revision: row.task_revision }
          : undefined;
      const plan =
        row.plan_id &&
        row.plan_revision !== null &&
        (!previous?.plan_id || identifier(previous.plan_id) !== identifier(row.plan_id))
          ? { id: identifier(row.plan_id), revision: row.plan_revision }
          : undefined;
      const source = plan ? "plan" : task && "conversation";
      if (source)
        events.push({
          kind: "attentionRaised",
          source,
          conversationId: id,
          ...(task ? { task } : {}),
          ...(plan ? { plan } : {}),
        });
    }
    if ([...previousProjects].some(([id, hadAttention]) => this.projects.has(id) !== hadAttention))
      events.unshift({ kind: "projectAttention", revision: ++this.revision });
    return events;
  }

  has(project: string): boolean {
    return this.projects.has(project);
  }

  list({ cursor, count }: ResearchInputs["projectAttention.list"]): ProjectAttentionPage {
    const page = [...this.projects.keys()]
      .sort()
      .filter((id) => cursor === null || id > cursor)
      .slice(0, count + 1);
    const hasMore = page.length > count;
    if (hasMore) page.pop();
    return {
      items: page,
      next: hasMore ? (page.at(-1) ?? null) : null,
      hasMore,
      revision: this.revision,
    };
  }
}
