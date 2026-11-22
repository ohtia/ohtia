import { isAccountFingerprint } from "./provider-requests.js";
import { validateJsonBounds, portLimits, utf8Size, isIdentifier } from "./port.js";
import {
  isConnectionSnapshot,
  isModelPage,
  type ConnectionSnapshot,
  type ModelPage,
  type ProviderModel,
} from "./connections.js";
export type ServiceConnectionSnapshot = Omit<
  ConnectionSnapshot,
  "last_account_email" | "account_email" | "display_name"
> & {
  readonly account_fingerprint?: string;
  readonly model_report_id?: string;
  readonly model_read_at?: string;
  readonly connection_kind?: "subscription" | "api_key";
};
function serviceSnapshot(value: unknown): value is ServiceConnectionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { account_fingerprint, connection_kind, model_report_id, model_read_at, ...snapshot } =
    value as Record<string, unknown>;
  return (
    (model_report_id === undefined
      ? model_read_at === undefined
      : isIdentifier(model_report_id) &&
        typeof model_read_at === "string" &&
        Number.isFinite(Date.parse(model_read_at)) &&
        snapshot.model_list_revision !== null) &&
    (!Object.hasOwn(value, "account_fingerprint") || isAccountFingerprint(account_fingerprint)) &&
    (!Object.hasOwn(value, "connection_kind") ||
      connection_kind === "subscription" ||
      connection_kind === "api_key") &&
    !Object.hasOwn(value, "last_account_email") &&
    !Object.hasOwn(value, "account_email") &&
    !Object.hasOwn(value, "display_name") &&
    isConnectionSnapshot({
      ...snapshot,
      display_name: "Service",
      last_account_email: null,
      account_email: null,
    })
  );
}
export type ConnectionReport =
  | {
      readonly kind: "connection_state";
      readonly generation: string;
      readonly snapshot: ServiceConnectionSnapshot;
      readonly refresh_id?: string;
    }
  | { readonly kind: "connection_models"; readonly generation: string; readonly page: ModelPage };
export function decodeConnectionReport(
  text: unknown,
  generation: string,
): ConnectionReport | undefined {
  if (typeof text !== "string" || text.length > portLimits.message_bytes) return;
  try {
    if (utf8Size(text) > portLimits.message_bytes) return;
    const value: unknown = JSON.parse(text);
    const bounded = validateJsonBounds(value);
    if (!bounded.ok || !value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (!isIdentifier(record.generation) || record.generation !== generation) return;
    if (
      record.kind === "connection_state" &&
      Object.keys(record).sort().join(",") ===
        (Object.hasOwn(record, "refresh_id")
          ? "generation,kind,refresh_id,snapshot"
          : "generation,kind,snapshot") &&
      (!Object.hasOwn(record, "refresh_id") || isIdentifier(record.refresh_id)) &&
      serviceSnapshot(record.snapshot)
    )
      return value as ConnectionReport;
    if (
      record.kind === "connection_models" &&
      Object.keys(record).sort().join(",") === "generation,kind,page" &&
      isModelPage(record.page)
    )
      return value as ConnectionReport;
  } catch {
    /* No peer payload reaches diagnostics. */
  }
  return;
}
/** Only complete lists are visible to the future task engine; availability is always state-based. */
export class ServiceConnections {
  private readonly refreshing = new Map<string, string>();
  beginModelRefresh(connection: string, refreshId: string): void {
    this.refreshing.set(connection, refreshId);
  }
  private readonly records = new Map<
    string,
    {
      snapshot: ServiceConnectionSnapshot;
      models: readonly ProviderModel[] | null;
      pending: ProviderModel[];
    }
  >();
  receive(report: ConnectionReport): boolean {
    if (report.kind === "connection_state") {
      if (
        !report.snapshot.probing &&
        report.refresh_id !== undefined &&
        this.refreshing.get(report.snapshot.connection) === report.refresh_id
      )
        this.refreshing.delete(report.snapshot.connection);
      const previous = this.records.get(report.snapshot.connection);
      const sameRevision =
        previous !== undefined &&
        previous.snapshot.model_list_revision === report.snapshot.model_list_revision &&
        previous.snapshot.account_fingerprint === report.snapshot.account_fingerprint &&
        previous.snapshot.model_report_id === report.snapshot.model_report_id;
      this.records.set(report.snapshot.connection, {
        snapshot: report.snapshot,
        models: sameRevision ? previous.models : null,
        pending: [],
      });
      return true;
    }
    const page = report.page;
    const record = this.records.get(page.connection);
    if (
      !record ||
      record.snapshot.model_list_revision !== page.model_list_revision ||
      page.nextCursor !== record.pending.length + page.models.length ||
      page.nextCursor > record.snapshot.model_count ||
      (page.hasMore
        ? page.models.length === 0 || page.nextCursor >= record.snapshot.model_count
        : page.nextCursor !== record.snapshot.model_count)
    )
      return false;
    record.pending.push(...page.models);
    if (!page.hasMore) {
      record.models = record.pending;
      record.pending = [];
    }
    return true;
  }
  read(connection: string):
    | {
        readonly state: ConnectionSnapshot["state"];
        readonly models: readonly ProviderModel[] | null;
      }
    | undefined {
    const record = this.records.get(connection);
    return record ? { state: record.snapshot.state, models: record.models } : undefined;
  }
  connectionIds(): readonly string[] {
    return [...this.records.keys()];
  }
  completedList(connection: string) {
    const record = this.records.get(connection);
    if (!record?.models || record.snapshot.state !== "connected") return undefined;
    const { model_report_id, model_read_at, account_fingerprint, connection_kind } =
      record.snapshot;
    if (!model_report_id || !model_read_at) return undefined;
    return {
      connection,
      reportId: model_report_id,
      readAt: model_read_at,
      fingerprint: account_fingerprint,
      kind: connection_kind ?? "subscription",
      models: record.models,
    };
  }
  account(connection: string) {
    const record = this.records.get(connection);
    if (!record)
      return { kind: "subscription" as const, fingerprint: undefined, revision: undefined };
    const { snapshot } = record;
    const connected = snapshot.state === "connected";
    return {
      kind: snapshot.connection_kind ?? "subscription",
      fingerprint: connected ? snapshot.account_fingerprint : undefined,
      revision: connected ? snapshot.account_revision : undefined,
    };
  }
  /** Wait for an in-flight catalog read or its remaining pages, not forever after a failed read. */
  awaitingModels(connection: string): boolean {
    const record = this.records.get(connection);
    return (
      this.refreshing.has(connection) ||
      (!!record &&
        record.models === null &&
        (record.snapshot.probing || record.snapshot.model_list_revision !== null))
    );
  }
  available(connection: string): boolean {
    return this.records.get(connection)?.snapshot.state === "connected";
  }
}
