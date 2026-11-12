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
>;
function serviceSnapshot(value: unknown): value is ServiceConnectionSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !Object.hasOwn(value, "last_account_email") &&
    !Object.hasOwn(value, "account_email") &&
    !Object.hasOwn(value, "display_name") &&
    isConnectionSnapshot({
      ...value,
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
      Object.keys(record).sort().join(",") === "generation,kind,snapshot" &&
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
      const previous = this.records.get(report.snapshot.connection);
      const sameRevision =
        previous !== undefined &&
        previous.snapshot.model_list_revision === report.snapshot.model_list_revision;
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
  available(connection: string): boolean {
    return this.records.get(connection)?.snapshot.state === "connected";
  }
}
