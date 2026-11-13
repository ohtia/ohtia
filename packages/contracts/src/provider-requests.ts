import { isIdentifier, portLimits, utf8Size } from "./port.js";

/** ADR-0028: versioned admission age, independent of response deadlines. */
export const dispatchPolicy = Object.freeze({ version: 1, validity_ms: 2000 });
export const requestReasons = [
  "usage_limit_reached",
  "not_eligible",
  "connection_expired",
  "provider_unavailable",
  "request_rejected",
  "provider_error",
  "invalid_output",
  "connection_lost",
] as const;
export type RequestReason = (typeof requestReasons)[number];
export type RequestFailureReason = Exclude<RequestReason, "connection_lost">;
export interface RequestInput {
  readonly reference: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}
/** Fixed Ohtia metadata, outside ordinary-message policy counters, never a free-form exemption. */
export const inputOmission = Object.freeze({
  reference: "development-omission-v1",
  role: "user" as const,
  content: "Earlier messages in this conversation are not included.",
});
export interface ProviderRequestData {
  readonly attempt: string;
  readonly operation: string;
  readonly connection: string;
  readonly model: string;
  readonly instructions: { readonly reference: string; readonly text: string };
  readonly input: readonly RequestInput[];
  readonly limits: {
    readonly max_input_bytes: number;
    readonly max_input_items: number;
    readonly max_output_bytes: number;
  };
}
export interface DispatchPermit {
  readonly id: string;
  readonly attempt: string;
  readonly issued_at_ms: number;
  readonly policy_version: 1;
}
export interface ProviderUsage {
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly total_tokens: number | null;
}
export const unknownUsage: ProviderUsage = Object.freeze({
  input_tokens: null,
  output_tokens: null,
  total_tokens: null,
});
export type ProviderResult =
  | { readonly outcome: "completed" | "cancelled"; readonly dispatched: boolean }
  | { readonly outcome: "refused" | "content_filtered"; readonly dispatched: true }
  // Uncertainty cannot prove zero dispatch, including an adapter that ends before reporting started.
  | { readonly outcome: "uncertain"; readonly dispatched: true; readonly reason: "connection_lost" }
  | { readonly outcome: "failed"; readonly dispatched: true; readonly reason: RequestFailureReason }
  | {
      readonly outcome: "failed";
      readonly dispatched: false;
      readonly reason: "connection_expired" | "provider_unavailable" | "permit_expired";
    };
export type ProviderEvent = { readonly sequence: number } & (
  | { readonly kind: "started" }
  | { readonly kind: "text" | "refusal"; readonly text: string }
  | { readonly kind: "usage"; readonly usage: ProviderUsage }
  | { readonly kind: "final"; readonly result: ProviderResult }
);
export type ProviderMessage = { readonly version: 1; readonly generation: string } & (
  | {
      readonly kind: "provider_dispatch";
      readonly request: ProviderRequestData;
      readonly permit: DispatchPermit;
    }
  | { readonly kind: "provider_interrupt"; readonly attempt: string }
  | { readonly kind: "provider_event"; readonly attempt: string; readonly event: ProviderEvent }
);
export type DevelopmentAction =
  | { readonly action: "request"; readonly model: string }
  | { readonly action: "interrupt"; readonly attempt: string };
export type DevelopmentMessage = {
  readonly version: 1;
  readonly generation: string;
  readonly operation_id: string;
} & (
  | { readonly kind: "development_command"; readonly command: DevelopmentAction }
  | {
      readonly kind: "development_result";
      readonly attempt: string | null;
      readonly error: "unavailable" | "busy" | "unknown_attempt" | null;
    }
  | {
      readonly kind: "development_event";
      readonly attempt: string;
      readonly event: ProviderEvent;
      readonly transfer_manifest: readonly string[];
      readonly duration_ms: number;
      readonly longest_silence_ms: number;
    }
);
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function exact(v: Record<string, unknown>, names: string): boolean {
  return Object.keys(v).sort().join(",") === names.split(",").sort().join(",");
}
export function isModelSlug(v: unknown): v is string {
  // Model identifiers come from the provider catalog and remain opaque within the port bound.
  return text(v, portLimits.string_bytes) && v.length > 0;
}
function integer(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
}
function text(v: unknown, max: number): v is string {
  return typeof v === "string" && utf8Size(v) <= max;
}
export function isProviderRequest(v: unknown): v is ProviderRequestData {
  if (
    !object(v) ||
    !exact(v, "attempt,operation,connection,model,instructions,input,limits") ||
    ![v.attempt, v.operation, v.connection].every(isIdentifier) ||
    !isModelSlug(v.model) ||
    !object(v.instructions) ||
    !exact(v.instructions, "reference,text") ||
    !isIdentifier(v.instructions.reference) ||
    !text(v.instructions.text, 4096) ||
    !object(v.limits) ||
    !exact(v.limits, "max_input_bytes,max_input_items,max_output_bytes") ||
    !integer(v.limits.max_input_bytes, 1, 16384) ||
    !integer(v.limits.max_input_items, 1, 20) ||
    !integer(v.limits.max_output_bytes, 1, 16384) ||
    !Array.isArray(v.input) ||
    v.input.length === 0 ||
    v.input.length > v.limits.max_input_items + 1
  )
    return false;
  let bytes = 0;
  let messages = 0;
  for (const [index, item] of (v.input as unknown[]).entries()) {
    if (
      !object(item) ||
      !exact(item, "reference,role,content") ||
      !isIdentifier(item.reference) ||
      !["user", "assistant"].includes(item.role as string)
    )
      return false;
    if (item.reference === inputOmission.reference) {
      if (index !== 0 || item.role !== inputOmission.role || item.content !== inputOmission.content)
        return false;
    } else {
      if (!text(item.content, v.limits.max_input_bytes)) return false;
      bytes += utf8Size(item.content);
      messages++;
    }
  }
  return messages > 0 && messages <= v.limits.max_input_items && bytes <= v.limits.max_input_bytes;
}
export function isProviderResult(v: unknown): v is ProviderResult {
  if (!object(v) || typeof v.dispatched !== "boolean") return false;
  if (["completed", "refused", "content_filtered", "cancelled"].includes(v.outcome as string))
    return exact(v, "outcome,dispatched") && (v.outcome === "cancelled" || v.dispatched);
  if (!exact(v, "outcome,dispatched,reason")) return false;
  if (v.outcome === "uncertain") return v.dispatched && v.reason === "connection_lost";
  return (
    v.outcome === "failed" &&
    (v.dispatched
      ? v.reason !== "connection_lost" && requestReasons.includes(v.reason as RequestReason)
      : ["connection_expired", "provider_unavailable", "permit_expired"].includes(
          v.reason as string,
        ))
  );
}
export function isProviderUsage(v: unknown): v is ProviderUsage {
  return (
    object(v) &&
    exact(v, "input_tokens,output_tokens,total_tokens") &&
    Object.values(v).every((n) => n === null || integer(n))
  );
}
export function isProviderEvent(v: unknown): v is ProviderEvent {
  if (!object(v) || !integer(v.sequence, 1)) return false;
  if (v.kind === "started") return exact(v, "kind,sequence");
  if (v.kind === "text" || v.kind === "refusal")
    return exact(v, "kind,sequence,text") && text(v.text, 4096) && v.text.length > 0;
  if (v.kind === "usage") return exact(v, "kind,sequence,usage") && isProviderUsage(v.usage);
  return v.kind === "final" && exact(v, "kind,sequence,result") && isProviderResult(v.result);
}
/** Closed schemas prohibit credentials and arbitrary metadata in either direction. */
export function decodeProviderMessage(
  input: unknown,
): ProviderMessage | DevelopmentMessage | undefined {
  if (
    typeof input !== "string" ||
    input.length > portLimits.message_bytes ||
    utf8Size(input) > portLimits.message_bytes
  )
    return;
  try {
    const v: unknown = JSON.parse(input);
    if (!object(v) || v.version !== 1 || !isIdentifier(v.generation)) return;
    if (
      v.kind === "provider_dispatch" &&
      exact(v, "version,generation,kind,request,permit") &&
      isProviderRequest(v.request) &&
      object(v.permit) &&
      exact(v.permit, "id,attempt,issued_at_ms,policy_version") &&
      isIdentifier(v.permit.id) &&
      v.permit.attempt === v.request.attempt &&
      integer(v.permit.issued_at_ms) &&
      v.permit.policy_version === dispatchPolicy.version
    )
      return v as unknown as ProviderMessage;
    if (
      v.kind === "provider_interrupt" &&
      exact(v, "version,generation,kind,attempt") &&
      isIdentifier(v.attempt)
    )
      return v as unknown as ProviderMessage;
    if (
      v.kind === "provider_event" &&
      exact(v, "version,generation,kind,attempt,event") &&
      isIdentifier(v.attempt) &&
      isProviderEvent(v.event)
    )
      return v as unknown as ProviderMessage;
    if (!isIdentifier(v.operation_id)) return;
    if (
      v.kind === "development_command" &&
      exact(v, "version,generation,operation_id,kind,command") &&
      object(v.command) &&
      ((v.command.action === "request" &&
        exact(v.command, "action,model") &&
        isModelSlug(v.command.model)) ||
        (v.command.action === "interrupt" &&
          exact(v.command, "action,attempt") &&
          isIdentifier(v.command.attempt)))
    )
      return v as unknown as DevelopmentMessage;
    if (
      v.kind === "development_result" &&
      exact(v, "version,generation,operation_id,kind,attempt,error") &&
      (v.attempt === null || isIdentifier(v.attempt)) &&
      (v.error === null || ["unavailable", "busy", "unknown_attempt"].includes(v.error as string))
    )
      return v as unknown as DevelopmentMessage;
    if (
      v.kind === "development_event" &&
      exact(
        v,
        "version,generation,operation_id,kind,attempt,event,transfer_manifest,duration_ms,longest_silence_ms",
      ) &&
      isIdentifier(v.attempt) &&
      isProviderEvent(v.event) &&
      Array.isArray(v.transfer_manifest) &&
      v.transfer_manifest.length <= 22 &&
      v.transfer_manifest.every(isIdentifier) &&
      integer(v.duration_ms) &&
      integer(v.longest_silence_ms)
    )
      return v as unknown as DevelopmentMessage;
  } catch {
    /* Peer content is never a diagnostic. */
  }
  return;
}
/** A closed command grammar shared by early admission and the development-only command module. */
export function parseDevelopmentSwitches(argv: readonly string[]): DevelopmentAction | undefined {
  const args = argv.filter((arg) => arg.startsWith("--ohtia-dev-"));
  if (!args.length) return;
  const fields = new Map<string, string>();
  for (const arg of args) {
    const match = /^--ohtia-dev-(command|model|attempt)=(.+)$/.exec(arg);
    if (!match) throw new Error("Invalid development command switches.");
    const [, name, value] = match;
    if (!name || !value || fields.has(name))
      throw new Error("Invalid development command switches.");
    fields.set(name, value);
  }
  const model = fields.get("model");
  const attempt = fields.get("attempt");
  if (fields.size === 2 && fields.get("command") === "request" && isModelSlug(model))
    return { action: "request", model };
  if (fields.size === 2 && fields.get("command") === "interrupt" && isIdentifier(attempt))
    return { action: "interrupt", attempt };
  throw new Error("Invalid development command switches.");
}
