import type { Kysely } from "kysely";
import {
  failure,
  isReplaceAgentPreference,
  staleRevision,
  type AgentPreference,
  type AgentPreferences,
  type AgentPreferenceTarget,
  type EffortSupport,
  type Outcome,
  type ProviderModel,
  type ProviderModelPage,
  type ProviderModelPageInput,
  type ReplaceAgentPreference,
  type ServiceConnections,
} from "@ohtia/contracts";
import { newId } from "./research.js";

export interface PreferenceRow {
  id: Uint8Array;
  target: AgentPreferenceTarget;
  connection: string | null;
  model: string | null;
  model_name: string | null;
  effort: string | null;
  inherit: 0 | 1;
  revision: number;
  source: AgentPreference["source"];
  seed_pending: 0 | 1;
}

export interface AgentPreferenceSchema {
  agent_inference_preferences: PreferenceRow;
  provider_model_lists: {
    connection: string;
    list_revision: number;
    kind: "subscription" | "api_key";
    model_count: number;
    report_id: string;
    read_at: string;
    account_fingerprint: Uint8Array | null;
  };
  provider_models: {
    connection: string;
    position: number;
    model: string;
    name: string;
    effort_support: EffortSupport;
    effort_levels: string;
    default_effort: string | null;
    max_output: number | null;
    max_input: number | null;
    origin: "service" | "catalog";
  };
}
type Catalog = NonNullable<ReturnType<ServiceConnections["completedList"]>>;
type ModelRow = AgentPreferenceSchema["provider_models"];
const preferenceRows = (db: Kysely<AgentPreferenceSchema>) =>
  db.selectFrom("agent_inference_preferences").selectAll();

function modelEntry(row: ModelRow): ProviderModel {
  return {
    id: row.model,
    name: row.name,
    effortSupport: row.effort_support,
    effortLevels: JSON.parse(row.effort_levels) as NonNullable<ProviderModel["effortLevels"]>,
    ...(row.default_effort !== null ? { defaultEffort: row.default_effort } : {}),
    ...(row.max_input !== null ? { maxInput: row.max_input } : {}),
    ...(row.max_output !== null ? { maxOutput: row.max_output } : {}),
    origin: row.origin,
  };
}
export function supportsEffort(model: ProviderModel, effort: string): boolean {
  return (
    model.effortSupport === "supported" &&
    model.effortLevels?.some((level) => level.name === effort && level.supported) === true
  );
}
function sameCatalogAccount(
  connections: ServiceConnections,
  list: AgentPreferenceSchema["provider_model_lists"],
): boolean {
  const fingerprint = connections.account(list.connection).fingerprint;
  return list.account_fingerprint
    ? Buffer.from(list.account_fingerprint).toString("hex") === fingerprint
    : connections.completedList(list.connection)?.reportId === list.report_id;
}

export async function availableInferenceModel(
  db: Kysely<AgentPreferenceSchema>,
  connections: ServiceConnections,
  connection: string,
  model: string,
): Promise<ProviderModel | null | undefined> {
  const live = connections.read(connection)?.models;
  if (live) return live.find((entry) => entry.id === model) ?? null;
  const list = await db
    .selectFrom("provider_model_lists")
    .selectAll()
    .where("connection", "=", connection)
    .executeTakeFirst();
  if (!list || !sameCatalogAccount(connections, list)) return undefined;
  const entry = await db
    .selectFrom("provider_models")
    .selectAll()
    .where("connection", "=", connection)
    .where("model", "=", model)
    .executeTakeFirst();
  return entry ? modelEntry(entry) : null;
}
/** True only when the task has no model or a complete account list excludes it. */
export async function inferenceModelUnavailable(
  db: Kysely<AgentPreferenceSchema>,
  connections: ServiceConnections,
  task: { connection: string; resolved_model: string | null },
): Promise<boolean | undefined> {
  if (!task.resolved_model) return true;
  const model = await availableInferenceModel(
    db,
    connections,
    task.connection,
    task.resolved_model,
  );
  return model === undefined ? undefined : model === null;
}
export async function readAgentPreferences(
  db: Kysely<AgentPreferenceSchema>,
  connections: ServiceConnections,
): Promise<AgentPreferences> {
  const preferences = await preferenceRows(db).orderBy("target").execute();
  const lists = await db
    .selectFrom("provider_model_lists")
    .selectAll()
    .orderBy("connection")
    .execute();
  return {
    preferences: preferences.map((row) => ({
      target: row.target,
      revision: row.revision,
      connection: row.connection,
      model: row.model,
      modelName: row.model_name,
      effort: row.effort,
      inherit: row.inherit === 1,
      source: row.source,
      seedPending: row.seed_pending === 1,
    })),
    lists: lists.map((row) => ({
      connection: row.connection,
      kind: row.kind,
      list_revision: row.list_revision,
      count: row.model_count,
      updatedAt: row.read_at,
      current: sameCatalogAccount(connections, row),
    })),
  };
}
export async function listProviderModels(
  db: Kysely<AgentPreferenceSchema>,
  input: ProviderModelPageInput,
  fits: (page: ProviderModelPage) => boolean,
): Promise<Outcome<ProviderModelPage>> {
  const { connection, list_revision, cursor, count } = input;
  const list = await db
    .selectFrom("provider_model_lists")
    .select(["list_revision", "model_count"])
    .where("connection", "=", connection)
    .executeTakeFirst();
  if (list?.list_revision !== list_revision) return staleRevision(list?.list_revision ?? 0);
  if (cursor > list.model_count) return failure("invalid_message");
  const rows = await db
    .selectFrom("provider_models")
    .selectAll()
    .where("connection", "=", connection)
    .where("position", ">=", cursor)
    .orderBy("position")
    .limit(count)
    .execute();
  const models: ProviderModel[] = [];
  let nextCursor = cursor;
  for (const row of rows) {
    const model = modelEntry(row);
    if (
      !fits({
        connection,
        list_revision,
        models: [...models, model],
        nextCursor: nextCursor + 1,
        hasMore: nextCursor + 1 < list.model_count,
      })
    )
      break;
    models.push(model);
    nextCursor++;
  }
  const hasMore = nextCursor < list.model_count;
  if (nextCursor === cursor && hasMore) return failure("storage_failed");
  return { ok: true, value: { connection, list_revision, models, nextCursor, hasMore } };
}

export async function storeProviderModels(db: Kysely<AgentPreferenceSchema>, catalog: Catalog) {
  const { connection, reportId, readAt, kind, fingerprint, models } = catalog;
  const previous = await db
    .selectFrom("provider_model_lists")
    .select(["report_id", "list_revision"])
    .where("connection", "=", connection)
    .executeTakeFirst();
  if (previous?.report_id === reportId) return null;
  const listRevision = (previous?.list_revision ?? 0) + 1;
  const content = {
    list_revision: listRevision,
    kind,
    model_count: models.length,
    report_id: reportId,
    read_at: readAt,
    account_fingerprint: fingerprint ? Buffer.from(fingerprint, "hex") : null,
  };
  await db
    .insertInto("provider_model_lists")
    .values({ connection, ...content })
    .onConflict((conflict) => conflict.column("connection").doUpdateSet(content))
    .execute();
  await db.deleteFrom("provider_models").where("connection", "=", connection).execute();
  for (const [position, model] of models.entries()) {
    await db
      .insertInto("provider_models")
      .values({
        connection,
        position,
        model: model.id,
        name: model.name,
        effort_support: model.effortSupport ?? "unknown",
        effort_levels: JSON.stringify(model.effortLevels ?? []),
        default_effort: model.defaultEffort ?? null,
        max_output: model.maxOutput ?? null,
        max_input: model.maxInput ?? null,
        origin: model.origin ?? "service",
      })
      .execute();
  }
  const preferences = await preferenceRows(db).execute();
  const defaultModel = preferences.find((row) => row.target === "default");
  const first = models[0];
  const seeded = !!(defaultModel?.seed_pending && first);
  const changed: { target: AgentPreferenceTarget; revision: number }[] = [];
  if (seeded) {
    const revision = defaultModel.revision + 1;
    await db
      .updateTable("agent_inference_preferences")
      .set({ connection, model: first.id, model_name: first.name, seed_pending: 0, revision })
      .where("target", "=", "default")
      .execute();
    changed.push({ target: "default", revision });
  }
  const available = new Map(models.map((model) => [model.id, model]));
  for (const row of preferences) {
    const effective = row.inherit ? defaultModel : row;
    if (effective?.connection !== connection || !effective.model) continue;
    const model = available.get(effective.model);
    // Preserve the last name when a model disappears so the researcher can identify the choice.
    const modelName = row.inherit ? null : (model?.name ?? row.model_name);
    const effort = row.effort && model && supportsEffort(model, row.effort) ? row.effort : null;
    if (row.model_name === modelName && row.effort === effort) continue;
    const revision = row.revision + 1;
    await db
      .updateTable("agent_inference_preferences")
      .set({ model_name: modelName, effort, revision })
      .where("target", "=", row.target)
      .execute();
    changed.push({ target: row.target, revision });
  }
  return { listRevision, changed, seeded };
}

export async function replaceAgentPreference(
  db: Kysely<AgentPreferenceSchema>,
  connections: ServiceConnections,
  choice: ReplaceAgentPreference,
): Promise<Outcome<PreferenceRow>> {
  if (!isReplaceAgentPreference(choice)) return failure("invalid_message");
  const old = await preferenceRows(db).where("target", "=", choice.target).executeTakeFirst();
  if ((old?.revision ?? 0) !== choice.expectedRevision) return staleRevision(old?.revision ?? 0);
  const inherited = choice.inherit
    ? await preferenceRows(db).where("target", "=", "default").executeTakeFirst()
    : undefined;
  const connection = choice.inherit ? (inherited?.connection ?? null) : choice.connection;
  const modelId = choice.inherit ? (inherited?.model ?? null) : choice.model;
  const record =
    connection && modelId
      ? await db
          .selectFrom("provider_models")
          .selectAll()
          .where("connection", "=", connection)
          .where("model", "=", modelId)
          .executeTakeFirst()
      : undefined;
  if (
    !choice.inherit &&
    (!connection ||
      !modelId ||
      !connections.available(connection) ||
      !record ||
      !(await availableInferenceModel(db, connections, connection, modelId)))
  )
    return failure("record_not_found");
  const { target, source, inherit } = choice;
  const revision = choice.expectedRevision + 1;
  const row = {
    id: old?.id ?? newId(),
    target,
    source,
    inherit: inherit ? (1 as const) : (0 as const),
    seed_pending: 0 as const,
    revision,
    connection: choice.connection,
    model: choice.model,
    model_name: inherit ? null : (record?.name ?? null),
    effort:
      choice.effort && record && supportsEffort(modelEntry(record), choice.effort)
        ? choice.effort
        : null,
  };
  await db
    .insertInto("agent_inference_preferences")
    .values(row)
    .onConflict((conflict) => conflict.column("target").doUpdateSet(row))
    .execute();
  if (target === "default" && record) {
    const model = modelEntry(record);
    const inherited = await preferenceRows(db).where("inherit", "=", 1).execute();
    for (const agent of inherited) {
      if (!agent.effort || supportsEffort(model, agent.effort)) continue;
      await db
        .updateTable("agent_inference_preferences")
        .set({ effort: null, revision: agent.revision + 1 })
        .where("target", "=", agent.target)
        .execute();
    }
  }
  return { ok: true, value: row };
}

export interface ResolvedInference {
  connection: string;
  resolved_model: string | null;
  resolved_model_name: string | null;
  resolved_effort: string | null;
  resolution_source: "invocation" | "agent" | "default";
}
export async function resolveInference(
  db: Kysely<AgentPreferenceSchema>,
  target: Exclude<AgentPreferenceTarget, "default">,
  fallback: string,
  invocation?: { connection: string; model: string; modelName: string; effort: string | null },
): Promise<ResolvedInference> {
  if (invocation)
    return {
      connection: invocation.connection,
      resolved_model: invocation.model,
      resolved_model_name: invocation.modelName,
      resolved_effort: invocation.effort,
      resolution_source: "invocation",
    };
  const rows = await preferenceRows(db).where("target", "in", [target, "default"]).execute();
  const agent = rows.find((row) => row.target === target);
  const own = agent && !agent.inherit;
  const choice = own ? agent : rows.find((row) => row.target === "default");
  return {
    connection: choice?.connection ?? fallback,
    resolved_model: choice?.model ?? null,
    resolved_model_name: choice?.model_name ?? null,
    resolved_effort: (own ? choice?.effort : agent ? agent.effort : choice?.effort) ?? null,
    resolution_source: own ? "agent" : "default",
  };
}
