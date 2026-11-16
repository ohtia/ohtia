import type {
  ConversationRecord,
  ProjectRecord,
  ResearchPayloads,
  ResearchResult,
} from "./research.js";
import { isConnectionId } from "./connections.js";
import type { PortCall, Subscription, Outcome } from "./port.js";

export const researchOperations = [
  "project.create",
  "project.confirmSetup",
  "conversation.start",
  "conversation.rename",
  "message.append",
  "conversation.stop",
  "task.stop",
  "destination.read",
  "project.list",
  "conversation.list",
  "conversation.read",
  "timeline.listBefore",
  "timeline.read",
  "research.subscribe",
  "text.part",
  "text.readPart",
  "reply.readParts",
] as const;
export type ResearchOperation = (typeof researchOperations)[number];
export type WindowResearchCommand = Extract<ResearchOperation, keyof ResearchPayloads>;
export interface TextDescriptor {
  readonly parts: number;
  readonly bytes: number;
  readonly sha256: string;
}
export interface TextReference extends TextDescriptor {
  readonly source: string;
}
export type PortText = string | TextReference;
export interface TextPart {
  readonly index: number;
  readonly count: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly text: string;
}
export interface TimelineCursor {
  readonly position: number;
  readonly rank: number;
  readonly id: string;
}
export interface TimelineIdentity extends TimelineCursor {
  readonly revision: number;
}
export interface TimelineMessage extends TimelineIdentity {
  readonly kind: "message";
  readonly rank: 1;
  readonly authorKind: "researcher" | "agent";
  readonly agentId: "virgilio" | null;
  readonly taskId: string | null;
  readonly content: PortText;
  readonly language: string | null;
  readonly ending: "complete" | "partial" | null;
}
export interface TimelineTask extends TimelineIdentity {
  readonly kind: "task";
  readonly rank: 3;
  readonly agentId: "virgilio";
  readonly language: string | null;
  readonly state:
    | "queued"
    | "blocked"
    | "running"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "uncertain";
}
export type TimelineItem = TimelineMessage | TimelineTask;
export type ConversationSummary = ConversationRecord & { readonly agentId: "virgilio" };
export interface ResearchScope {
  readonly projectId: string | null;
  readonly conversationId: string | null;
}
export interface ListPage<T, C> {
  readonly items: readonly T[];
  readonly next: C | null;
  readonly hasMore: boolean;
}
export interface IdPage<T> {
  readonly items: readonly T[];
  readonly remaining: readonly string[];
}
export interface ReplyPart {
  readonly sequence: number;
  readonly text: string;
}
export interface ReplyParts {
  readonly parts: readonly ReplyPart[];
  readonly latestSequence: number;
}
export type ResearchEvent =
  | { readonly kind: "inferenceActivity" }
  | {
      readonly kind: "changed";
      readonly record: "project" | "conversation" | "timeline" | "usagePause" | "executionLimits";
      readonly id: string;
      readonly revision: number;
    }
  | {
      readonly kind: "reply";
      readonly taskId: string;
      readonly sequence: number;
      readonly text: string;
    };
export interface MessageDestination {
  readonly operation: string;
  readonly maxAttemptDurationMs: number;
  readonly connection: string;
}
export const researcherMessageLimit = 20_000;
export function validResearcherMessage(text: string): boolean {
  return text.trim().length > 0 && Array.from(text).length <= researcherMessageLimit;
}
export interface ResearchInputs {
  "conversation.stop": ResearchPayloads["conversation.stop"];
  "task.stop": ResearchPayloads["task.stop"];
  "destination.read": { readonly projectId: string } & (
    { readonly conversationId: string } | { readonly agentId: "virgilio" }
  );
  "project.create": ResearchPayloads["project.create"];
  "project.confirmSetup": ResearchPayloads["project.confirmSetup"];
  "conversation.start": { readonly projectId: string; readonly content: string | TextDescriptor };
  "conversation.rename": ResearchPayloads["conversation.rename"];
  "message.append": { readonly conversationId: string; readonly content: string | TextDescriptor };
  "project.list": { readonly cursor: string | null; readonly count: number };
  "conversation.list": {
    readonly projectId: string;
    readonly cursor: string | null;
    readonly count: number;
  };
  "conversation.read": { readonly projectId: string; readonly ids: readonly string[] };
  "timeline.listBefore": {
    readonly conversationId: string;
    readonly cursor: TimelineCursor | null;
    readonly count: number;
  };
  "timeline.read": { readonly conversationId: string; readonly ids: readonly string[] };
  "research.subscribe": ResearchScope & { readonly subscriptionId: string };
  "text.part": TextPart;
  "text.readPart": { readonly source: string; readonly index: number };
  "reply.readParts": { readonly taskId: string; readonly fromSequence: number };
}
export interface ResearchOutputs {
  "conversation.stop": ResearchResult;
  "task.stop": ResearchResult;
  "destination.read": { readonly destination: MessageDestination | null };
  "project.create": ResearchResult;
  "project.confirmSetup": ResearchResult;
  "conversation.start": ResearchResult;
  "conversation.rename": ResearchResult;
  "message.append": ResearchResult;
  "project.list": ListPage<ProjectRecord, string>;
  "conversation.list": ListPage<ConversationSummary, string>;
  "conversation.read": IdPage<ConversationSummary>;
  "timeline.listBefore": ListPage<TimelineItem, TimelineCursor>;
  "timeline.read": IdPage<TimelineItem>;
  "research.subscribe": { readonly subscriptionId: string };
  "text.part": { readonly accepted: true };
  "text.readPart": { readonly text: string };
  "reply.readParts": ReplyParts;
}
export interface ResearchPort {
  stopConversation(
    operationId: string,
    input: ResearchInputs["conversation.stop"],
  ): PortCall<ResearchResult>;
  stopTask(operationId: string, input: ResearchInputs["task.stop"]): PortCall<ResearchResult>;
  readDestination(
    input: ResearchInputs["destination.read"],
  ): PortCall<ResearchOutputs["destination.read"]>;
  createProject(operationId: string): PortCall<ResearchResult>;
  confirmProjectSetup(
    operationId: string,
    input: ResearchInputs["project.confirmSetup"],
  ): PortCall<ResearchResult>;
  startConversation(
    operationId: string,
    input: ResearchInputs["conversation.start"],
  ): PortCall<ResearchResult>;
  renameConversation(
    operationId: string,
    input: ResearchInputs["conversation.rename"],
  ): PortCall<ResearchResult>;
  appendMessage(
    operationId: string,
    input: ResearchInputs["message.append"],
  ): PortCall<ResearchResult>;
  listProjects(input: ResearchInputs["project.list"]): PortCall<ResearchOutputs["project.list"]>;
  listConversations(
    input: ResearchInputs["conversation.list"],
  ): PortCall<ResearchOutputs["conversation.list"]>;
  readConversations(
    input: ResearchInputs["conversation.read"],
  ): PortCall<ResearchOutputs["conversation.read"]>;
  listTimelineBefore(
    input: ResearchInputs["timeline.listBefore"],
  ): PortCall<ResearchOutputs["timeline.listBefore"]>;
  readTimeline(input: ResearchInputs["timeline.read"]): PortCall<ResearchOutputs["timeline.read"]>;
  sendTextPart(operationId: string, input: TextPart): PortCall<ResearchOutputs["text.part"]>;
  readTextPart(input: ResearchInputs["text.readPart"]): PortCall<ResearchOutputs["text.readPart"]>;
  readReplyParts(input: ResearchInputs["reply.readParts"]): PortCall<ReplyParts>;
  subscribeResearch(
    scope: ResearchScope,
    listener: (notice: Outcome<ResearchEvent>) => void,
  ): Subscription;
}
export function isResearchOperation(value: string): value is ResearchOperation {
  return researchOperations.some((operation) => operation === value);
}
export function isResearchMutation(value: string): value is WindowResearchCommand {
  return [
    "project.create",
    "project.confirmSetup",
    "conversation.start",
    "conversation.rename",
    "message.append",
    "conversation.stop",
    "task.stop",
  ].includes(value);
}
export function compareTimeline(a: TimelineCursor, b: TimelineCursor): number {
  return a.position - b.position || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function mergeTimeline(
  current: readonly TimelineItem[],
  incoming: readonly TimelineItem[],
): TimelineItem[] {
  const items = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming)
    if ((items.get(item.id)?.revision ?? 0) < item.revision) items.set(item.id, item);
  return [...items.values()].sort(compareTimeline);
}
export function splitText(text: string, maximum = 4096): string[] {
  if (!Number.isSafeInteger(maximum) || maximum < 4) throw new Error("Invalid text part bound.");
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const point of text) {
    const cp = point.codePointAt(0) ?? 0;
    if (cp >= 0xd800 && cp <= 0xdfff) throw new Error("Invalid Unicode scalar.");
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + size > maximum) {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += point;
    bytes += size;
  }
  if (part || !parts.length) parts.push(part);
  return parts;
}

function obj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    obj(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
export function isResearchId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}
function opaque(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}
function hash(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function descriptor(value: unknown): value is TextDescriptor {
  return (
    exact(value, ["parts", "bytes", "sha256"]) &&
    integer(value.parts, 2, 64) &&
    integer(value.bytes, 4097, 262144) &&
    hash(value.sha256)
  );
}
export function isTextReference(value: unknown): value is TextReference {
  return (
    exact(value, ["source", "parts", "bytes", "sha256"]) &&
    opaque(value.source) &&
    descriptor({ parts: value.parts, bytes: value.bytes, sha256: value.sha256 })
  );
}
function content(value: unknown): boolean {
  return typeof value === "string" || descriptor(value);
}
function ids(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 128 && value.every(isResearchId);
}
function date(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function nullable(value: unknown, valid: (value: unknown) => boolean): boolean {
  return value === null || valid(value);
}
function cursor(value: unknown): boolean {
  return (
    exact(value, ["position", "rank", "id"]) &&
    integer(value.position) &&
    integer(value.rank) &&
    isResearchId(value.id)
  );
}
export function researchInput(operation: ResearchOperation, value: unknown): boolean {
  switch (operation) {
    case "conversation.stop":
      return exact(value, ["conversationId"]) && isResearchId(value.conversationId);
    case "task.stop":
      return exact(value, ["taskId"]) && isResearchId(value.taskId);
    case "destination.read":
      return (
        obj(value) &&
        isResearchId(value.projectId) &&
        ((exact(value, ["projectId", "conversationId"]) && isResearchId(value.conversationId)) ||
          (exact(value, ["projectId", "agentId"]) && value.agentId === "virgilio"))
      );
    case "project.create":
      return exact(value, []);
    case "project.confirmSetup":
      return (
        exact(value, ["projectId", "title", "documentLanguage"]) &&
        isResearchId(value.projectId) &&
        typeof value.title === "string" &&
        typeof value.documentLanguage === "string"
      );
    case "conversation.start":
      return (
        exact(value, ["projectId", "content"]) &&
        isResearchId(value.projectId) &&
        content(value.content)
      );
    case "message.append":
      return (
        exact(value, ["conversationId", "content"]) &&
        isResearchId(value.conversationId) &&
        content(value.content)
      );
    case "conversation.rename":
      return (
        exact(value, ["conversationId", "title", "expectedUpdatedAt"]) &&
        isResearchId(value.conversationId) &&
        typeof value.title === "string" &&
        date(value.expectedUpdatedAt)
      );
    case "project.list":
      return (
        exact(value, ["cursor", "count"]) &&
        nullable(value.cursor, isResearchId) &&
        integer(value.count, 1, 128)
      );
    case "conversation.list":
      return (
        exact(value, ["projectId", "cursor", "count"]) &&
        isResearchId(value.projectId) &&
        nullable(value.cursor, isResearchId) &&
        integer(value.count, 1, 128)
      );
    case "conversation.read":
      return exact(value, ["projectId", "ids"]) && isResearchId(value.projectId) && ids(value.ids);
    case "timeline.listBefore":
      return (
        exact(value, ["conversationId", "cursor", "count"]) &&
        isResearchId(value.conversationId) &&
        nullable(value.cursor, cursor) &&
        integer(value.count, 1, 50)
      );
    case "timeline.read":
      return (
        exact(value, ["conversationId", "ids"]) &&
        isResearchId(value.conversationId) &&
        ids(value.ids)
      );
    case "research.subscribe":
      return (
        exact(value, ["subscriptionId", "projectId", "conversationId"]) &&
        opaque(value.subscriptionId) &&
        nullable(value.projectId, isResearchId) &&
        nullable(value.conversationId, isResearchId) &&
        (value.conversationId === null || value.projectId !== null)
      );
    case "text.part":
      return (
        exact(value, ["index", "count", "bytes", "sha256", "text"]) &&
        integer(value.index, Number.MIN_SAFE_INTEGER) &&
        integer(value.count, 2, 64) &&
        integer(value.bytes, 4097, 262144) &&
        hash(value.sha256) &&
        typeof value.text === "string"
      );
    case "text.readPart":
      return (
        exact(value, ["source", "index"]) && opaque(value.source) && integer(value.index, 1, 64)
      );
    case "reply.readParts":
      return (
        exact(value, ["taskId", "fromSequence"]) &&
        isResearchId(value.taskId) &&
        integer(value.fromSequence)
      );
  }
}
function conversation(value: unknown): boolean {
  return (
    exact(value, ["id", "projectId", "title", "createdAt", "updatedAt", "revision", "agentId"]) &&
    isResearchId(value.id) &&
    isResearchId(value.projectId) &&
    nullable(value.title, (x) => typeof x === "string") &&
    date(value.createdAt) &&
    date(value.updatedAt) &&
    integer(value.revision) &&
    value.agentId === "virgilio"
  );
}
function project(value: unknown): boolean {
  return (
    exact(value, [
      "id",
      "projectType",
      "title",
      "documentLanguage",
      "isDevelopment",
      "setupConfirmedAt",
      "createdAt",
      "updatedAt",
    ]) &&
    isResearchId(value.id) &&
    value.projectType === "thesis" &&
    nullable(value.title, (x) => typeof x === "string") &&
    nullable(value.documentLanguage, (x) => typeof x === "string") &&
    typeof value.isDevelopment === "boolean" &&
    nullable(value.setupConfirmedAt, date) &&
    date(value.createdAt) &&
    date(value.updatedAt)
  );
}
function item(value: unknown): boolean {
  if (
    !obj(value) ||
    !cursor({ position: value.position, rank: value.rank, id: value.id }) ||
    !integer(value.revision) ||
    !nullable(value.language, (x) => typeof x === "string")
  )
    return false;
  if (value.kind === "message")
    return (
      exact(value, [
        "id",
        "position",
        "rank",
        "revision",
        "kind",
        "authorKind",
        "agentId",
        "taskId",
        "content",
        "language",
        "ending",
      ]) &&
      value.rank === 1 &&
      value.revision === 1 &&
      (typeof value.content === "string" || isTextReference(value.content)) &&
      (value.authorKind === "researcher"
        ? value.agentId === null &&
          value.taskId === null &&
          value.language === null &&
          value.ending === null
        : value.authorKind === "agent" &&
          value.agentId === "virgilio" &&
          isResearchId(value.taskId) &&
          typeof value.ending === "string" &&
          ["complete", "partial"].includes(value.ending))
    );
  return (
    exact(value, ["id", "position", "rank", "revision", "kind", "agentId", "language", "state"]) &&
    value.kind === "task" &&
    value.rank === 3 &&
    value.agentId === "virgilio" &&
    [
      "queued",
      "blocked",
      "running",
      "cancelling",
      "completed",
      "failed",
      "cancelled",
      "uncertain",
    ].includes(value.state as string)
  );
}
export function researchOutput(operation: ResearchOperation, value: unknown): boolean {
  if (operation === "destination.read")
    return (
      exact(value, ["destination"]) &&
      nullable(
        value.destination,
        (d) =>
          exact(d, ["operation", "maxAttemptDurationMs", "connection"]) &&
          opaque(d.operation) &&
          integer(d.maxAttemptDurationMs) &&
          isConnectionId(d.connection),
      )
    );
  if (isResearchMutation(operation))
    return exact(value, ["resultId"]) && isResearchId(value.resultId);
  if (operation === "research.subscribe")
    return exact(value, ["subscriptionId"]) && opaque(value.subscriptionId);
  if (operation === "text.part") return exact(value, ["accepted"]) && value.accepted === true;
  if (operation === "text.readPart")
    return exact(value, ["text"]) && typeof value.text === "string";
  if (operation === "reply.readParts")
    return (
      exact(value, ["parts", "latestSequence"]) &&
      integer(value.latestSequence, 0) &&
      Array.isArray(value.parts) &&
      value.parts.every(
        (part) =>
          exact(part, ["sequence", "text"]) &&
          integer(part.sequence) &&
          part.sequence <= (value.latestSequence as number) &&
          typeof part.text === "string",
      )
    );
  const valid =
    operation === "project.list"
      ? project
      : operation.startsWith("conversation.")
        ? conversation
        : item;
  if (!obj(value) || !Array.isArray(value.items) || !value.items.every(valid)) return false;
  if (operation === "timeline.read" || operation === "conversation.read")
    return exact(value, ["items", "remaining"]) && ids(value.remaining);
  return (
    exact(value, ["items", "next", "hasMore"]) &&
    typeof value.hasMore === "boolean" &&
    (value.hasMore
      ? operation === "timeline.listBefore"
        ? cursor(value.next)
        : isResearchId(value.next)
      : value.next === null)
  );
}
export function isResearchEvent(value: unknown): value is ResearchEvent {
  if (!obj(value)) return false;
  if (value.kind === "inferenceActivity") return exact(value, ["kind"]);
  if (value.kind === "reply")
    return (
      exact(value, ["kind", "taskId", "sequence", "text"]) &&
      isResearchId(value.taskId) &&
      integer(value.sequence) &&
      typeof value.text === "string"
    );
  return (
    exact(value, ["kind", "record", "id", "revision"]) &&
    value.kind === "changed" &&
    typeof value.record === "string" &&
    ["project", "conversation", "timeline", "usagePause", "executionLimits"].includes(
      value.record,
    ) &&
    (isResearchId(value.id) || (value.record === "executionLimits" && opaque(value.id))) &&
    integer(value.revision)
  );
}

/** Cross-check successful research responses against the admitted request, after schema validation. */
export function researchResultMatches(
  operation: ResearchOperation,
  input: unknown,
  output: unknown,
): boolean {
  if (!obj(input) || !obj(output)) return false;
  if (operation === "conversation.read" || operation === "timeline.read") {
    const requested = input.ids as readonly string[];
    const items = output.items as readonly { readonly id: string; readonly projectId?: string }[];
    const remaining = output.remaining as readonly string[];
    return (
      items.length <= requested.length &&
      items.every(
        (item, index) =>
          item.id === requested[index] &&
          (operation !== "conversation.read" || item.projectId === input.projectId),
      ) &&
      remaining.length === requested.length - items.length &&
      remaining.every((id, index) => id === requested[items.length + index]) &&
      (requested.length === 0 || items.length > 0)
    );
  }
  if (
    operation === "timeline.listBefore" ||
    operation === "project.list" ||
    operation === "conversation.list"
  ) {
    const items = output.items as readonly (TimelineCursor & { readonly projectId?: string })[];
    if (items.length > (input.count as number) || (output.hasMore && !items.length)) return false;
    if (
      operation === "conversation.list" &&
      items.some((item) => item.projectId !== input.projectId)
    )
      return false;
    const last = items.at(-1);
    if (
      output.hasMore &&
      last &&
      (operation === "timeline.listBefore"
        ? compareTimeline(last, output.next as TimelineCursor) !== 0
        : last.id !== output.next)
    )
      return false;
    if (operation === "timeline.listBefore")
      return items.every(
        (item, index) =>
          (!input.cursor || compareTimeline(item, input.cursor as TimelineCursor) < 0) &&
          (index === 0 || compareTimeline(items[index - 1] ?? item, item) > 0),
      );
  }
  if (operation === "reply.readParts") {
    const parts = output.parts as readonly ReplyPart[];
    return (
      parts.every((part, index) => part.sequence === (input.fromSequence as number) + index) &&
      ((input.fromSequence as number) > (output.latestSequence as number) || parts.length > 0)
    );
  }
  return true;
}
