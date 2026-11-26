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
// Reserved status codes used by the utility entry for controlled failure paths.
export const dataServiceExitCodes = Object.freeze({
  uncaught_exception: 64,
  unhandled_rejection: 65,
  message_handler_failed: 66,
  provider_work_failed: 67,
  storage_admission_lost: 68,
});
const dataServiceExitReasons = Object.keys(
  dataServiceExitCodes,
) as (keyof typeof dataServiceExitCodes)[];
export const diagnosticCatalog = Object.freeze({
  "ohtia.pause.read": event("data_service", "pause.read", "DEBUG", "success", []),
  "ohtia.plan.graph_recorded": event(
    "data_service",
    "plan.addContributions",
    "INFO",
    "recorded",
    [],
  ),
  "ohtia.plan.completed": event("data_service", "plan.advance", "INFO", "completed", []),
  "ohtia.plan.cancel_requested": event("data_service", "plan.cancel", "INFO", "success", []),
  "ohtia.plan.read": event("data_service", "plan.read", "DEBUG", "success", []),
  "ohtia.plan.events_listed": event("data_service", "planEvent.list", "DEBUG", "success", []),
  "ohtia.plan.finished": event("data_service", "plan.finish", "INFO", "success", []),
  "ohtia.contribution.input_too_large": event("data_service", "plan.advance", "WARN", "failed", [
    "input_too_large",
  ]),
  "ohtia.contribution.activation_refused": event("data_service", "plan.advance", "WARN", "failed", [
    "destination_changed",
    "input_changed",
  ]),
  "ohtia.work.reserved": event("data_service", "intervention.reserve", "DEBUG", "recorded", []),
  "ohtia.work.released": event("data_service", "intervention.release", "DEBUG", "recorded", []),
  "ohtia.work.settled": event("data_service", "intervention.settle", "DEBUG", "recorded", []),
  "ohtia.handoff.proposed": event("data_service", "handoff.propose", "INFO", "recorded", []),
  "ohtia.handoff.accepted": event("data_service", "handoff.accept", "INFO", "accepted", []),
  "ohtia.handoff.declined": event("data_service", "handoff.decline", "INFO", "declined", []),
  "ohtia.handoff.returned": event("data_service", "handoff.return", "INFO", "success", []),
  "ohtia.handoff.selection_listed": event(
    "data_service",
    "handoff.selection",
    "DEBUG",
    "success",
    [],
  ),
  "ohtia.plan_change.read": event("data_service", "planChange.read", "DEBUG", "success", []),
  "ohtia.plan_change.proposed": event("data_service", "planChange.propose", "INFO", "recorded", []),
  "ohtia.memory.recorded": event("data_service", "task.reply", "INFO", "success", []),
  "ohtia.memory.added": event("data_service", "memory.add", "INFO", "success", []),
  "ohtia.memory.edited": event("data_service", "memory.edit", "INFO", "success", []),
  "ohtia.memory.withdrawn": event("data_service", "memory.withdraw", "INFO", "success", []),
  "ohtia.memory.listed": event("data_service", "memory.list", "DEBUG", "success", []),
  "ohtia.memory.history_read": event("data_service", "memory.history", "DEBUG", "success", []),
  "ohtia.memory.undone": event("data_service", "memory.undo", "INFO", "accepted", []),
  "ohtia.plan_change.applied": event("data_service", "planChange.apply", "INFO", "accepted", []),
  "ohtia.plan_change.declined": event("data_service", "planChange.decline", "INFO", "declined", []),
  "ohtia.plan.proposed": event("data_service", "plan.propose", "INFO", "recorded", []),
  "ohtia.plan.accepted": event("data_service", "plan.accept", "INFO", "accepted", []),
  "ohtia.plan.declined": event("data_service", "plan.decline", "INFO", "declined", []),
  "ohtia.consultation.proposed": event(
    "data_service",
    "consultation.propose",
    "INFO",
    "recorded",
    [],
  ),
  "ohtia.consultation.accepted": event(
    "data_service",
    "consultation.accept",
    "INFO",
    "accepted",
    [],
  ),
  "ohtia.consultation.declined": event(
    "data_service",
    "consultation.decline",
    "INFO",
    "declined",
    [],
  ),
  "ohtia.contribution.retry_requested": event(
    "data_service",
    "contribution.tryAgain",
    "INFO",
    "accepted",
    [],
  ),
  "ohtia.contribution.restarted": event(
    "data_service",
    "contribution.startAgain",
    "INFO",
    "accepted",
    [],
  ),
  "ohtia.synthesis.retry_requested": event(
    "data_service",
    "synthesis.tryAgain",
    "INFO",
    "accepted",
    [],
  ),
  "ohtia.development.plan_started": event(
    "data_service",
    "development.runPlan",
    "INFO",
    "accepted",
    [],
  ),
  "ohtia.task.retry_requested": event("data_service", "task.tryAgain", "INFO", "accepted", []),
  "ohtia.message.link_opened": event("broker", "openExternalLink", "INFO", "opened", []),
  "ohtia.message.link_refused": event("broker", "openExternalLink", "WARN", "refused", []),
  "ohtia.message.copied": event("broker", "copyMessage", "INFO", "copied", []),
  "ohtia.message.copy_failed": event("broker", "copyMessage", "WARN", "failed", []),
  "ohtia.limits.read": event("data_service", "limits.read", "DEBUG", "success", []),
  "ohtia.limits.replaced": event("data_service", "limits.replace", "INFO", "success", []),
  "ohtia.limits.receipt_read": event("data_service", "limits.receipt", "DEBUG", "success", []),
  "ohtia.limits.failed": event("data_service", "limits", "ERROR", "failure", [
    "invalid_message",
    "busy",
    "service_unavailable",
    "operation_conflict",
    "preference_invalid",
    "storage_failed",
    "uncertain",
  ]),
  "ohtia.task.stop_requested": event("data_service", "task.stop", "INFO", "accepted", []),
  "ohtia.task.replaced": event("data_service", "task.startAgain", "INFO", "accepted", []),
  "ohtia.task.blocked": event("data_service", "task.block", "INFO", "blocked", []),
  "ohtia.service.started": event("data_service", "service.start", "INFO", "started", []),
  "ohtia.service.stopped": event("data_service", "service.stop", "INFO", "stopped", []),
  "ohtia.service.woke": event("data_service", "service.wake", "INFO", "reviewed", []),
  "ohtia.task.recovery_paused": event("data_service", "task.recover", "INFO", "paused", []),
  "ohtia.task.continued": event("data_service", "task.continue", "INFO", "continued", []),
  "ohtia.task.cancel_all_requested": event(
    "data_service",
    "task.cancelAll",
    "INFO",
    "accepted",
    [],
  ),
  "ohtia.task.continue_requested": event("data_service", "task.continue", "INFO", "accepted", []),
  "ohtia.usage_pause.opened": event("data_service", "usage_pause.open", "WARN", "paused", []),
  "ohtia.usage_pause.resumed": event("data_service", "usage_pause.resume", "INFO", "resumed", []),
  "ohtia.usage_pause.resume_requested": event(
    "data_service",
    "usage_pause.resume",
    "INFO",
    "accepted",
    [],
  ),
  "ohtia.task.accepted": event("data_service", "task.accept", "INFO", "accepted", []),
  "ohtia.task.dispatch_permitted": event("data_service", "task.dispatch", "INFO", "permitted", []),
  "ohtia.task.completed": event("data_service", "task.finish", "INFO", "completed", []),
  "ohtia.task.failed": event("data_service", "task.finish", "WARN", "failed", []),
  "ohtia.task.uncertain": event("data_service", "task.finish", "WARN", "uncertain", []),
  "ohtia.task.cancelled": event("data_service", "task.finish", "INFO", "cancelled", []),
  "ohtia.task.readmitted": event("data_service", "task.dispatch", "INFO", "readmitted", []),
  "ohtia.connection.renewal_started": event("broker", "connection.renew", "INFO", "accepted", []),
  "ohtia.connection.renewed": event("broker", "connection.renew", "INFO", "connected", []),
  "ohtia.connection.expired": event("broker", "connection.renew", "WARN", "expired", []),
  "ohtia.project.setup_proposed": event(
    "data_service",
    "project.proposeSetup",
    "INFO",
    "success",
    [],
  ),
  "ohtia.project.setup_rejected": event(
    "data_service",
    "project.rejectSetup",
    "INFO",
    "success",
    [],
  ),
  "ohtia.stage.transition_recorded": event(
    "data_service",
    "stage.transition",
    "INFO",
    "success",
    [],
  ),
  "ohtia.profile.saved": event("data_service", "profile.save", "INFO", "success", []),
  "ohtia.project.renamed": event("data_service", "project.rename", "INFO", "success", []),
  "ohtia.project.read": event("data_service", "project.read", "DEBUG", "success", []),
  "ohtia.project.opened": event("data_service", "project.open", "INFO", "success", []),
  "ohtia.project.created": event("data_service", "project.create", "INFO", "success", []),
  "ohtia.project.setup_confirmed": event(
    "data_service",
    "project.confirmSetup",
    "INFO",
    "success",
    [],
  ),
  "ohtia.conversation.started": event("data_service", "conversation.start", "INFO", "success", []),
  "ohtia.conversation.renamed": event("data_service", "conversation.rename", "INFO", "success", []),
  "ohtia.development.josefa_message_appended": event(
    "data_service",
    "development.sendToJosefa",
    "INFO",
    "success",
    [],
  ),
  "ohtia.message.appended": event("data_service", "message.append", "INFO", "success", []),
  "ohtia.project_attention.listed": event(
    "data_service",
    "projectAttention.list",
    "DEBUG",
    "success",
    [],
  ),
  "ohtia.project.listed": event("data_service", "project.list", "DEBUG", "success", []),
  "ohtia.conversation.listed": event("data_service", "conversation.list", "DEBUG", "success", []),
  "ohtia.research.subscribed": event("data_service", "research.subscribe", "DEBUG", "success", []),
  "ohtia.text.staged": event("data_service", "text.part", "DEBUG", "success", []),
  "ohtia.text.read": event("data_service", "text.readPart", "DEBUG", "success", []),
  "ohtia.usage.late_accepted": event("data_service", "usage.late", "DEBUG", "accepted", []),
  "ohtia.usage.late_rejected": event("data_service", "usage.late", "WARN", "rejected", [
    "attempt_unavailable",
    "revision_conflict",
    "window_closed",
    "clock_unreliable",
  ]),
  "ohtia.agent_preference.listed": event(
    "data_service",
    "agentPreference.list",
    "DEBUG",
    "success",
    [],
  ),
  "ohtia.provider_model.listed": event(
    "data_service",
    "providerModel.list",
    "DEBUG",
    "success",
    [],
  ),
  "ohtia.agent_preference.replaced": event(
    "data_service",
    "agentPreference.replace",
    "INFO",
    "success",
    [],
  ),
  "ohtia.reply.details_read": event("data_service", "reply.details", "DEBUG", "success", []),
  "ohtia.reply.read": event("data_service", "reply.readParts", "DEBUG", "success", []),
  "ohtia.timeline.listed": event("data_service", "timeline.listBefore", "DEBUG", "success", []),
  "ohtia.timeline.read": event("data_service", "timeline.read", "DEBUG", "success", []),
  "ohtia.destination.read": event("data_service", "destination.read", "DEBUG", "success", []),
  "ohtia.conversation.stop_requested": event(
    "data_service",
    "conversation.stop",
    "INFO",
    "success",
    [],
  ),
  "ohtia.conversation.read": event("data_service", "conversation.read", "DEBUG", "success", []),
  "ohtia.message.listed": event("data_service", "message.list", "DEBUG", "success", []),
  "ohtia.research.failed": event("data_service", "research.run", "WARN", "failure", [
    "busy",
    "service_unavailable",
    "invalid_message",
    "project_not_in_setup",
    "proposal_not_waiting",
    "conversation_busy",
    "selection_invalid",
    "owner_changed",
    "setup_reply_active",
    "destination_changed",
    "consultation_unfinished",
    "plan_unfinished",
    "plan_invalid",
    "plan_change_invalid",
    "undo_unavailable",
    "memory_full",
    "entry_invalid",
    "graph_version_conflict",
    "unknown_prerequisite",
    "self_dependency",
    "cycle",
    "duplicate_contribution",
    "plan_key_invalid",
    "plan_key_duplicate",
    "empty_plan",
    "request_empty",
    "request_too_large",
    "purpose_empty",
    "purpose_too_long",
    "shared_context_too_large",
    "plan_state_changed",
    "event_limit_reached",
    "task_not_stoppable",
    "project_in_setup",
    "stage_state_changed",
    "stage_unavailable",
    "stale_generation",
    "agent_unavailable",
    "record_not_found",
    "name_invalid",
    "message_invalid",
    "parts_incomplete",
    "input_too_large",
    "input_changed",
    "limit_reached",
    "plan_too_large",
    "agent_not_authorized",
    "pending_limit_reached",
    "newer_task_exists",
    "task_not_retryable",
    "stale_revision",
    "operation_conflict",
    "storage_failed",
  ]),
  "ohtia.research.uncertain": event("data_service", "research.run", "WARN", "uncertain", [
    "uncertain",
  ]),
  "ohtia.connection.connected": event("broker", "connection.connect", "INFO", "connected", []),
  "ohtia.connection.failed": event("broker", "connection.run", "WARN", "failure", [
    "store_unavailable",
    "connection_failed",
    "sign_in_timeout",
    "plan_use_not_allowed",
    "sign_in_rejected",
    "key_rejected",
    "key_not_permitted",
    "key_needs_workspace",
    "key_check_unreachable",
    "key_check_unavailable",
  ]),
  "ohtia.connection.subscribe": event("broker", "connection.subscribe", "DEBUG", "accepted", []),
  "ohtia.connection.list_models": event(
    "broker",
    "connection.listModels",
    "DEBUG",
    "completed",
    [],
  ),
  "ohtia.connection.read": event("broker", "connection.read", "DEBUG", "success", []),
  "ohtia.connection.connect": event("broker", "connection.connect", "INFO", "accepted", []),
  "ohtia.connection.replace_key": event("broker", "connection.replaceKey", "INFO", "accepted", []),
  "ohtia.connection.disconnect": event("broker", "connection.disconnect", "INFO", "completed", []),
  "ohtia.connection.probe_listed": event("broker", "connection.probe", "INFO", "listed", []),
  "ohtia.connection.probe_unreachable": event("broker", "connection.probe", "WARN", "unreachable", [
    "probe_unreachable",
  ]),
  "ohtia.provider.dispatched": event("broker", "provider.dispatch", "INFO", "dispatched", []),
  "ohtia.provider.not_dispatched": event("broker", "provider.dispatch", "WARN", "not_dispatched", [
    "connection_expired",
    "provider_unavailable",
    "permit_expired",
  ]),
  "ohtia.provider.discarded": event("broker", "provider.dispatch", "DEBUG", "discarded", []),
  "ohtia.provider.completed": event("broker", "provider.request", "INFO", "completed", []),
  "ohtia.provider.title_requested": event("broker", "provider.title", "INFO", "requested", []),
  "ohtia.provider.title_suggested": event("broker", "provider.title", "INFO", "suggested", []),
  "ohtia.provider.title_omitted": event("broker", "provider.title", "INFO", "omitted", []),
  "ohtia.provider.failed": event("broker", "provider.request", "WARN", "failure", [
    "usage_limit_reached",
    "not_eligible",
    "connection_expired",
    "provider_unavailable",
    "request_rejected",
    "refused",
    "rate_limited",
    "max_output_reached",
    "model_unavailable",
    "billing_limit_reached",

    "provider_error",
    "invalid_output",
    "output_limit_exceeded",
    "empty_reply",
    "deadline_exceeded",
    "inactivity_timeout",
  ]),
  "ohtia.provider.cancelled": event("broker", "provider.request", "INFO", "cancelled", []),
  "ohtia.provider.uncertain": event("broker", "provider.request", "WARN", "uncertain", [
    "connection_lost",
  ]),
  "ohtia.window.bounds_failed": event("broker", "bounds.replace", "WARN", "failure", [
    "storage_failed",
  ]),
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
  "ohtia.service.faulted": event("broker", "service.run", "ERROR", "failure", [
    "startup_timeout",
    "request_timeout",
    "channel_write_failed",
    "protocol_rejected",
    "wake_queue_full",
  ]),
  "ohtia.service.child_exited": event("broker", "service.exit", "WARN", "exited", [
    "exit_zero",
    "exit_nonzero",
    "exit_unknown",
    ...dataServiceExitReasons,
  ]),
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
export function dataServiceExitReason(
  code: number | undefined,
): (typeof diagnosticCatalog)["ohtia.service.child_exited"]["errors"][number] {
  if (code === undefined) return "exit_unknown";
  if (code === 0) return "exit_zero";
  return (
    dataServiceExitReasons.find((reason) => dataServiceExitCodes[reason] === code) ?? "exit_nonzero"
  );
}
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
export function isCanonicalUuid(value: unknown): value is string {
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
    (correlation !== undefined && !isCanonicalUuid(correlation))
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
      (Object.hasOwn(attrs, "ohtia.correlation.id") &&
        !isCanonicalUuid(attrs["ohtia.correlation.id"])) ||
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
