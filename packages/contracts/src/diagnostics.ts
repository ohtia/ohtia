/** ADR-0013: local profile, deliberately without message/body or arbitrary metadata. */
export const diagnosticLimits = Object.freeze({
  fileBytes: 5 * 1024 * 1024,
  files: 5,
  recordBytes: 8192,
  pending: 64,
  readRecords: 64,
  permissionProcesses: 2,
});
export const diagnosticSeverities = { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17, FATAL: 21 } as const;
export type DiagnosticSeverity = keyof typeof diagnosticSeverities;
const event = <
  C extends string,
  O extends string,
  S extends DiagnosticSeverity,
  R extends string,
  const E extends readonly string[],
>(
  component: C,
  operation: O,
  severity: S,
  outcome: R,
  errors: E,
) => Object.freeze({ component, operation, severity, outcome, errors: Object.freeze(errors) });
export const diagnosticCatalog = Object.freeze({
  "ohtia.application.stop_uncertain": event("broker", "application.stop", "WARN", "uncertain", [
    "shutdown_uncertain",
  ]),
  "ohtia.port.rejected": event("broker", "port.admit", "WARN", "failure", [
    "frame_rejected",
    "invalid_message",
    "context_rejected",
  ]),
  "ohtia.application.started": event("broker", "application.start", "INFO", "success", []),
  "ohtia.application.stopped": event("broker", "application.stop", "INFO", "success", []),
  "ohtia.service.ready": event("broker", "service.start", "INFO", "success", []),
  "ohtia.service.unavailable": event("broker", "service.run", "ERROR", "failure", [
    "service_unavailable",
  ]),
  "ohtia.storage.opened": event("data_service", "storage.open", "INFO", "success", []),
  "ohtia.storage.open_failed": event("data_service", "storage.open", "ERROR", "failure", [
    "storage_unavailable",
    "recovery_required",
    "retry_required",
  ]),
  "ohtia.storage.checkpoint_restored": event(
    "data_service",
    "storage.restore",
    "INFO",
    "success",
    [],
  ),
  "ohtia.appearance.saved": event("data_service", "appearance.replace", "INFO", "success", []),
  "ohtia.appearance.failed": event("data_service", "appearance.replace", "WARN", "failure", [
    "storage_failed",
    "stale_revision",
    "operation_conflict",
    "service_unavailable",
  ]),
  "ohtia.appearance.uncertain": event("data_service", "appearance.replace", "WARN", "uncertain", [
    "uncertain",
  ]),
  "ohtia.service.cancel_requested": event("broker", "service.cancel", "DEBUG", "uncertain", []),
  "ohtia.application.failed": event("broker", "application.run", "FATAL", "failure", [
    "runtime_failed",
  ]),
});
export type DiagnosticEventName = keyof typeof diagnosticCatalog;
export type DiagnosticEvent = {
  [K in DiagnosticEventName]: {
    readonly event_name: K;
    readonly timestamp?: string;
    readonly duration_ms?: number;
  } & ((typeof diagnosticCatalog)[K]["errors"][number] extends never
    ? { readonly error_code?: never }
    : { readonly error_code: (typeof diagnosticCatalog)[K]["errors"][number] });
}[DiagnosticEventName];
export interface DiagnosticAttributes {
  readonly "ohtia.component": string;
  readonly "ohtia.operation": string;
  readonly "ohtia.outcome": string;
  readonly "ohtia.error.code"?: string;
  readonly "ohtia.duration_ms"?: number;
  readonly "ohtia.correlation.id"?: string;
}
export interface DiagnosticRecord {
  readonly schema_version: 1;
  readonly timestamp?: string;
  readonly observed_timestamp: string;
  readonly severity_text: DiagnosticSeverity;
  readonly severity_number: number;
  readonly event_name: DiagnosticEventName;
  readonly resource: { readonly "service.name": "ohtia"; readonly "service.version": string };
  readonly attributes: DiagnosticAttributes;
}
/** Only descriptor values are read; accessors, symbols and custom prototypes are refused. */
function object(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length > allowed.length ||
    keys.some((key) => typeof key !== "string" || !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    return;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return;
    result[key as string] = descriptor.value as unknown;
  }
  return result;
}
export function isDiagnosticTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function duration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && !Object.is(value, -0);
}
function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}
export function isArtifactVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
  );
}
function name(value: unknown): value is DiagnosticEventName {
  return typeof value === "string" && Object.hasOwn(diagnosticCatalog, value);
}
function permittedError(eventName: DiagnosticEventName, value: unknown): boolean {
  const errors: readonly string[] = diagnosticCatalog[eventName].errors;
  return errors.length ? typeof value === "string" && errors.includes(value) : value === undefined;
}
export function decodeDiagnosticEvent(input: unknown): DiagnosticEvent | undefined {
  try {
    const value = object(
      input,
      ["event_name", "timestamp", "duration_ms", "error_code"],
      ["event_name"],
    );
    if (
      !value ||
      !name(value.event_name) ||
      (Object.hasOwn(value, "timestamp") && !isDiagnosticTime(value.timestamp)) ||
      (Object.hasOwn(value, "duration_ms") && !duration(value.duration_ms)) ||
      !permittedError(value.event_name, value.error_code) ||
      (Object.hasOwn(value, "error_code") && value.error_code === undefined)
    )
      return;
    return {
      event_name: value.event_name,
      ...(value.timestamp !== undefined ? { timestamp: value.timestamp as string } : {}),
      ...(value.duration_ms !== undefined ? { duration_ms: value.duration_ms as number } : {}),
      ...(value.error_code !== undefined ? { error_code: value.error_code as string } : {}),
    } as DiagnosticEvent;
  } catch {
    return;
  }
}
/** Identity and correlations are supplied only by the broker's running artifact/state. */
export function makeDiagnosticRecord(
  input: unknown,
  version: string,
  observed: string,
  correlation?: string,
): DiagnosticRecord | undefined {
  const value = decodeDiagnosticEvent(input);
  if (
    !value ||
    !isArtifactVersion(version) ||
    !isDiagnosticTime(observed) ||
    (correlation !== undefined && !uuid(correlation))
  )
    return;
  const spec = diagnosticCatalog[value.event_name];
  return {
    schema_version: 1,
    ...(value.timestamp ? { timestamp: value.timestamp } : {}),
    observed_timestamp: observed,
    severity_text: spec.severity,
    severity_number: diagnosticSeverities[spec.severity],
    event_name: value.event_name,
    resource: { "service.name": "ohtia", "service.version": version },
    attributes: {
      "ohtia.component": spec.component,
      "ohtia.operation": spec.operation,
      "ohtia.outcome": spec.outcome,
      ...(value.error_code ? { "ohtia.error.code": value.error_code } : {}),
      ...(value.duration_ms !== undefined ? { "ohtia.duration_ms": value.duration_ms } : {}),
      ...(correlation ? { "ohtia.correlation.id": correlation } : {}),
    },
  };
}
export type DiagnosticDecode =
  | { readonly ok: true; readonly value: DiagnosticRecord }
  | {
      readonly ok: false;
      readonly code: "invalid_record" | "unsupported_schema" | "oversized_record";
    };
export function decodeDiagnosticRecord(input: unknown): DiagnosticDecode {
  try {
    if (input && typeof input === "object" && Object.getPrototypeOf(input) === Object.prototype) {
      const schema = Object.getOwnPropertyDescriptor(input, "schema_version");
      if (schema && "value" in schema && Number.isSafeInteger(schema.value) && schema.value !== 1)
        return { ok: false, code: "unsupported_schema" };
    }
    const value = object(
      input,
      [
        "schema_version",
        "timestamp",
        "observed_timestamp",
        "severity_text",
        "severity_number",
        "event_name",
        "resource",
        "attributes",
      ],
      [
        "schema_version",
        "observed_timestamp",
        "severity_text",
        "severity_number",
        "event_name",
        "resource",
        "attributes",
      ],
    );
    if (!value) return { ok: false, code: "invalid_record" };
    if (Number.isSafeInteger(value.schema_version) && value.schema_version !== 1)
      return { ok: false, code: "unsupported_schema" };
    const resource = object(
      value.resource,
      ["service.name", "service.version"],
      ["service.name", "service.version"],
    );
    const attrs = object(
      value.attributes,
      [
        "ohtia.component",
        "ohtia.operation",
        "ohtia.outcome",
        "ohtia.error.code",
        "ohtia.duration_ms",
        "ohtia.correlation.id",
      ],
      ["ohtia.component", "ohtia.operation", "ohtia.outcome"],
    );
    if (!resource || resource["service.name"] !== "ohtia" || !attrs || value.schema_version !== 1)
      return { ok: false, code: "invalid_record" };
    const candidate = makeDiagnosticRecord(
      {
        event_name: value.event_name,
        ...(Object.hasOwn(value, "timestamp") ? { timestamp: value.timestamp } : {}),
        ...(Object.hasOwn(attrs, "ohtia.error.code")
          ? { error_code: attrs["ohtia.error.code"] }
          : {}),
        ...(Object.hasOwn(attrs, "ohtia.duration_ms")
          ? { duration_ms: attrs["ohtia.duration_ms"] }
          : {}),
      },
      resource["service.version"] as string,
      value.observed_timestamp as string,
      attrs["ohtia.correlation.id"] as string | undefined,
    );
    if (
      !candidate ||
      (Object.hasOwn(attrs, "ohtia.correlation.id") && !uuid(attrs["ohtia.correlation.id"])) ||
      value.severity_text !== candidate.severity_text ||
      value.severity_number !== candidate.severity_number ||
      attrs["ohtia.component"] !== candidate.attributes["ohtia.component"] ||
      attrs["ohtia.operation"] !== candidate.attributes["ohtia.operation"] ||
      attrs["ohtia.outcome"] !== candidate.attributes["ohtia.outcome"]
    )
      return { ok: false, code: "invalid_record" };
    return { ok: true, value: candidate };
  } catch {
    return { ok: false, code: "invalid_record" };
  }
}
/** Parse compact JSON without discarding duplicate keys or imposing a key/escape order. */
function uniqueCompactJson(text: string): unknown {
  const input: unknown = JSON.parse(text);
  const stack: (Set<string> | undefined)[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++;
        i++;
      }
      if (text[i + 1] === ":") {
        const keys = stack[stack.length - 1];
        const key: unknown = JSON.parse(text.slice(start, i + 1));
        if (!keys || typeof key !== "string" || keys.has(key))
          throw new Error("Duplicate diagnostic key.");
        keys.add(key);
      }
    } else if (char === "{") stack.push(new Set());
    else if (char === "[") stack.push(undefined);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === " " || char === "\t" || char === "\r" || char === "\n")
      throw new Error("Noncompact diagnostic JSON.");
  }
  return input;
}
export function decodeDiagnosticLine(bytes: Uint8Array): DiagnosticDecode {
  if (bytes.byteLength > diagnosticLimits.recordBytes)
    return { ok: false, code: "oversized_record" };
  try {
    const text = decodeURIComponent(
      Array.from(bytes, (byte) => "%" + byte.toString(16).padStart(2, "0")).join(""),
    );
    const input = uniqueCompactJson(text);
    return decodeDiagnosticRecord(input);
  } catch {
    return { ok: false, code: "invalid_record" };
  }
}
export function diagnosticToOpenTelemetry(input: unknown) {
  const decoded = decodeDiagnosticRecord(input);
  if (!decoded.ok) return decoded;
  const record = decoded.value;
  return {
    ok: true as const,
    value: {
      ...(record.timestamp ? { Timestamp: BigInt(Date.parse(record.timestamp)) * 1000000n } : {}),
      ObservedTimestamp: BigInt(Date.parse(record.observed_timestamp)) * 1000000n,
      SeverityText: record.severity_text,
      SeverityNumber: record.severity_number,
      EventName: record.event_name,
      Resource: record.resource,
      Attributes: { ...record.attributes, "ohtia.log.schema_version": record.schema_version },
    },
  };
}
/** Private child channel: neither the generation nor event text authenticates its sender. */
export function decodeChildDiagnostic(
  input: unknown,
  generation: string,
): DiagnosticEvent | undefined {
  if (typeof input !== "string" || input.length > diagnosticLimits.recordBytes) return;
  try {
    const decoded: unknown = JSON.parse(input);
    if (JSON.stringify(decoded) !== input) return;
    const value = object(decoded, ["kind", "generation", "event"], ["kind", "generation", "event"]);
    if (!value || value.kind !== "diagnostic" || value.generation !== generation) return;
    const event = decodeDiagnosticEvent(value.event);
    if (!event || diagnosticCatalog[event.event_name].component !== "data_service") return;
    return event;
  } catch {
    return;
  }
}
/** Drop automatic JS/SDK console output before inspecting or serializing any arguments. */
export function suppressDiagnosticCapture(
  install: (discard: (...args: readonly unknown[]) => boolean) => void,
): void {
  install((...args) => {
    const callback = args[args.length - 1];
    if (typeof callback === "function")
      void Promise.resolve()
        .then(() => {
          (callback as () => void)();
        })
        .catch(() => {});
    return true;
  });
}
