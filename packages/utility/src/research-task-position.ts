import { sql } from "kysely";

const replacedReplyPosition = sql<
  number | null
>`(WITH RECURSIVE previous(id, reply_position, replaces_task_id, depth) AS (
    SELECT id, reply_position, replaces_task_id, 1 FROM tasks WHERE id=t.replaces_task_id
    UNION ALL SELECT older.id, older.reply_position, older.replaces_task_id, previous.depth+1
      FROM tasks older JOIN previous ON older.id=previous.replaces_task_id
  ) SELECT reply_position FROM previous WHERE reply_position IS NOT NULL ORDER BY depth LIMIT 1)`;
const consultationOrigin = sql<
  number | null
>`(SELECT origin.reply_position FROM contributions c JOIN interventions i ON i.id=c.intervention_id
    JOIN attempts a ON a.id=i.proposed_by_attempt_id JOIN tasks origin ON origin.id=a.task_id
    WHERE c.id=t.contribution_id)`;

// Both queries alias the task being ordered as t.
export const taskPosition = sql<number>`CASE WHEN t.kind='synthesis' THEN t.reply_position
  ELSE coalesce(t.reply_position, t.input_through_position, ${replacedReplyPosition}, ${consultationOrigin}) END`;

// A visible reply uses its reservation. Pending work also has an anchor, and a
// replacement must sort at least as late as the reply it replaces.
export const activityTaskPosition = sql<number>`coalesce(t.reply_position, max(
  coalesce(t.input_through_position, 0),
  coalesce(${replacedReplyPosition}, 0),
  coalesce(${consultationOrigin}, 0)
))`;
