import { nextPosition, type TaskSchema, type TaskTransaction } from "./tasks.js";
import fs from "node:fs";
import * as crypto from "node:crypto";
import { type Generated, type Kysely, sql } from "kysely";
import {
  failure,
  validResearcherMessage,
  validConversationTitle,
  isIdentifier,
  isDiagnosticTime,
  researchCommands,
  staleRevision,
  type ConversationRecord,
  type MessageRecord,
  type Outcome,
  type ProjectRecord,
  type ResearchCommand,
  type ResearchResult,
} from "@ohtia/contracts";

export interface ProjectRow {
  id: Uint8Array;
  project_type: "thesis";
  title: string | null;
  document_language: string | null;
  is_development: number;
  setup_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string;
}
export interface ConversationRow {
  id: Uint8Array;
  project_id: Uint8Array;
  title: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}
export interface MessageRow {
  id: Uint8Array;
  conversation_id: Uint8Array;
  position: number;
  author_kind: "researcher" | "agent";
  agent_id: string | null;
  task_id: Uint8Array | null;
  content: string;
  ending: "complete" | "partial" | null;
  created_at: string;
}
import type { SetupProposalRow } from "./project-setup.js";
export interface ResearchSchema extends TaskSchema {
  project_setup_proposals: SetupProposalRow;
  projects: ProjectRow;
  conversations: ConversationRow & {
    automatic_title_eligible: Generated<number>;
    title_attempt_id: Generated<Uint8Array | null>;
  };
  messages: MessageRow;
  command_receipts: {
    operation_id: string;
    command: ResearchCommand["command"];
    payload_sha256: Uint8Array;
    result_id: Uint8Array;
    error_code: "record_not_found" | null;
    created_at: string;
  };
}
export function isEntityId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}
export function bytes(id: string): Buffer {
  return Buffer.from(id.replaceAll("-", ""), "hex");
}
export function identifier(value: Uint8Array): string {
  const hex = Buffer.from(value).toString("hex");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!isEntityId(id)) throw new Error("Invalid stored entity identity.");
  return id;
}
export function newId(): Buffer {
  // The pinned runtimes expose this API before the current @types/node declaration line.
  const id = (crypto as typeof crypto & { randomUUIDv7(): string }).randomUUIDv7();
  if (!isEntityId(id)) throw new Error("UUIDv7 generation unavailable.");
  return bytes(id);
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  );
}
function isUsageConnection(value: unknown): value is "chatgpt" {
  return value === "chatgpt";
}
function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === "string" && descriptor?.enumerable && "value" in descriptor;
    })
  );
}
/** RFC 8785: ECMAScript primitives, UTF-16 key order, no normalization or invalid Unicode. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown): string {
    if (item === null || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (text(item)) return JSON.stringify(item);
    if (!item || typeof item !== "object" || ancestors.has(item))
      throw new Error("Invalid canonical JSON input.");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (
          Object.getPrototypeOf(item) !== Array.prototype ||
          Reflect.ownKeys(item).length !== item.length + 1
        )
          throw new Error("Invalid JSON array.");
        const elements: string[] = [];
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor?.enumerable || !("value" in descriptor))
            throw new Error("Invalid JSON array element.");
          elements.push(encode(descriptor.value));
        }
        return `[${elements.join(",")}]`;
      }
      if (!object(item)) throw new Error("Invalid JSON object.");
      return `{${Object.keys(item)
        .sort()
        .map((key) => {
          if (!text(key)) throw new Error("Invalid JSON property.");
          return `${JSON.stringify(key)}:${encode(item[key])}`;
        })
        .join(",")}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value);
}

export class LanguageRegistry {
  private readonly subtags = new Map<string, Set<string>>();
  private readonly ranges: { type: string; first: string; last: string }[] = [];
  constructor(file: string | URL) {
    const registry = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
    if (!/^File-Date: \d{4}-\d\d-\d\d\n%%\n/.test(registry))
      throw new Error("Invalid language registry.");
    for (const record of registry.split("\n%%\n").slice(1)) {
      const type = /^Type: (.+)$/m.exec(record)?.[1];
      const subtag = /^Subtag: (.+)$/m.exec(record)?.[1]?.toLowerCase();
      if (!type || !subtag || /^Deprecated:/m.test(record)) continue;
      const [first, last] = subtag.split("..");
      if (first && last) this.ranges.push({ type, first, last });
      else {
        const values = this.subtags.get(type) ?? new Set<string>();
        values.add(subtag);
        this.subtags.set(type, values);
      }
    }
  }
  canonical(value: unknown): string | undefined {
    if (typeof value !== "string") return;
    // BCP 47 case conversion is ASCII-only; Unicode lookalikes must remain invalid input.
    const lowered = value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    const parts = /^([a-z]{2,3})(?:-([a-z]{4}))?(?:-([a-z]{2}|[0-9]{3}))?$/.exec(lowered);
    if (!parts?.[1]) return;
    const present = [
      ["language", parts[1]],
      ["script", parts[2]],
      ["region", parts[3]],
    ] as const;
    if (
      present.some(
        ([type, subtag]) =>
          subtag &&
          !this.subtags.get(type)?.has(subtag) &&
          !this.ranges.some(
            (r) =>
              r.type === type &&
              subtag.length === r.first.length &&
              subtag >= r.first &&
              subtag <= r.last,
          ),
      )
    )
      return;
    return [
      parts[1],
      parts[2] ? parts[2].slice(0, 1).toUpperCase() + parts[2].slice(1) : undefined,
      parts[3]?.toUpperCase(),
    ]
      .filter(Boolean)
      .join("-");
  }
}
function project(row: ProjectRow): ProjectRecord {
  return {
    id: identifier(row.id),
    projectType: row.project_type,
    title: row.title,
    documentLanguage: row.document_language,
    isDevelopment: row.is_development === 1,
    setupConfirmedAt: row.setup_confirmed_at,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function conversationRecord(row: ConversationRow): ConversationRecord {
  return {
    id: identifier(row.id),
    projectId: identifier(row.project_id),
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
  };
}
function message(row: MessageRow): MessageRecord {
  return {
    id: identifier(row.id),
    conversationId: identifier(row.conversation_id),
    position: row.position,
    authorKind: row.author_kind,
    agentId: row.agent_id,
    taskId: row.task_id ? identifier(row.task_id) : null,
    content: row.content,
    ending: row.ending,
    createdAt: row.created_at,
  };
}
const payloadKeys = {
  "conversation.stop": ["conversationId"],
  "task.stop": ["taskId"],
  "task.startAgain": ["taskId"],
  "task.tryAgain": ["taskId"],
  "development.createProject": [],
  "project.create": [],
  "project.open": ["projectId"],
  "usagePause.resume": ["connection"],
  "task.continueAll": [],
  "task.cancelAll": [],
  "project.confirmSetup": ["proposalId"],
  "project.rejectSetup": ["proposalId"],
  "conversation.start": ["projectId", "content"],
  "conversation.rename": ["conversationId", "title", "expectedUpdatedAt"],
  "message.append": ["conversationId", "content"],
} as const;

/** Runs only inside the DurableStore's reserved transaction and admission boundary. */
export async function applyResearchCommand(
  db: Kysely<ResearchSchema>,
  input: ResearchCommand,
  registry: () => LanguageRegistry,
  tasks: TaskTransaction,
  payloadHash?: string,
): Promise<Outcome<ResearchResult>> {
  if (
    !object(input) ||
    Object.keys(input).sort().join(",") !== "command,operationId,payload" ||
    !isIdentifier(input.operationId) ||
    !researchCommands.includes(input.command) ||
    !object(input.payload)
  )
    return failure("invalid_message");
  let hash: Buffer;
  try {
    hash = payloadHash
      ? Buffer.from(payloadHash, "hex")
      : crypto.createHash("sha256").update(canonicalJson(input.payload)).digest();
  } catch {
    return failure("invalid_message");
  }
  const receipt = await db
    .selectFrom("command_receipts")
    .selectAll()
    .where("operation_id", "=", input.operationId)
    .executeTakeFirst();
  if (receipt)
    return receipt.command === input.command && Buffer.from(receipt.payload_sha256).equals(hash)
      ? receipt.error_code
        ? failure(receipt.error_code)
        : { ok: true, value: { resultId: identifier(receipt.result_id) } }
      : failure("operation_conflict");
  const keys = payloadKeys[input.command];
  if (
    Object.keys(input.payload).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(input.payload, key))
  )
    return failure("invalid_message");
  const now = new Date().toISOString();
  let result: Uint8Array;
  switch (input.command) {
    case "conversation.stop": {
      if (!isEntityId(input.payload.conversationId)) return failure("invalid_message");
      const outcome = await tasks.stopConversation(
        bytes(input.payload.conversationId),
        input.operationId,
      );
      if (!outcome.ok) return outcome;
      result = outcome.value;
      break;
    }
    case "task.stop":
    case "task.tryAgain":
    case "task.startAgain": {
      if (!isEntityId(input.payload.taskId)) return failure("invalid_message");
      const outcome = await tasks.control(
        input.command,
        bytes(input.payload.taskId),
        input.operationId,
      );
      if (!outcome.ok) return outcome;
      result = outcome.value;
      break;
    }
    case "usagePause.resume": {
      if (!isUsageConnection(input.payload.connection)) return failure("invalid_message");
      result = newId();
      await tasks.resumeUsage(input.payload.connection, input.operationId);
      break;
    }
    case "task.cancelAll": {
      result = newId();
      await tasks.cancelAll();
      break;
    }
    case "task.continueAll": {
      result = newId();
      await tasks.continueAll();
      break;
    }
    case "development.createProject":
    case "project.create": {
      const development = input.command === "development.createProject";
      if (development && tasks.context.mode !== "development") return failure("invalid_message");
      result = newId();
      await db
        .insertInto("projects")
        .values({
          id: result,
          project_type: "thesis",
          title: development ? "Development project" : null,
          document_language: development ? "en" : null,
          is_development: development ? 1 : 0,
          setup_confirmed_at: development ? now : null,
          last_opened_at: now,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto("conversations")
        .values({
          id: newId(),
          project_id: result,
          title: null,
          created_at: now,
          updated_at: now,
          revision: 1,
        })
        .execute();
      break;
    }
    case "project.open": {
      if (!isEntityId(input.payload.projectId)) return failure("invalid_message");
      result = bytes(input.payload.projectId);
      const opened = await db
        .updateTable("projects")
        .set({ last_opened_at: now })
        .where("id", "=", result)
        .executeTakeFirst();
      if (opened.numUpdatedRows === 0n) {
        await db
          .insertInto("command_receipts")
          .values({
            operation_id: input.operationId,
            command: input.command,
            payload_sha256: hash,
            result_id: result,
            error_code: "record_not_found",
            created_at: now,
          })
          .execute();
        return failure("record_not_found");
      }
      break;
    }
    case "project.confirmSetup":
    case "project.rejectSetup": {
      if (!isEntityId(input.payload.proposalId)) return failure("invalid_message");
      const proposal = await db
        .selectFrom("project_setup_proposals")
        .selectAll()
        .where("id", "=", bytes(input.payload.proposalId))
        .executeTakeFirst();
      if (!proposal) return failure("record_not_found");
      const current = await db
        .selectFrom("projects")
        .selectAll()
        .where("id", "=", proposal.project_id)
        .executeTakeFirstOrThrow();
      if (proposal.state !== "proposed" || current.setup_confirmed_at !== null)
        return failure("proposal_not_waiting");
      const producingTask = await db
        .selectFrom("tasks")
        .select(["conversation_id", "input_through_position"])
        .where("id", "=", proposal.task_id)
        .executeTakeFirstOrThrow();
      const newerReply = await db
        .selectFrom("messages")
        .select("id")
        .where("conversation_id", "=", producingTask.conversation_id)
        .where("author_kind", "=", "researcher")
        .where("position", ">", producingTask.input_through_position)
        .executeTakeFirst();
      if (newerReply) return failure("proposal_not_waiting");
      const confirming = input.command === "project.confirmSetup";
      if (confirming) {
        const active = await db
          .selectFrom("tasks")
          .select("id")
          .where("project_id", "=", proposal.project_id)
          .where("operation", "=", "project_setup")
          .where("state", "in", ["queued", "blocked", "running", "cancelling"])
          .executeTakeFirst();
        if (active) return failure("setup_reply_active");
        const language = registry().canonical(proposal.document_language);
        if (!language) return failure("invalid_message");
        await db
          .updateTable("projects")
          .set({
            title: proposal.title,
            document_language: language,
            setup_confirmed_at: now,
            updated_at: now,
          })
          .where("id", "=", current.id)
          .execute();
      }
      await db
        .updateTable("project_setup_proposals")
        .set({
          state: confirming ? "confirmed" : "rejected",
          decided_at: now,
          decided_by_operation_id: input.operationId,
        })
        .where("id", "=", proposal.id)
        .execute();
      tasks.touch(producingTask.conversation_id);
      result = confirming ? current.id : proposal.id;
      break;
    }
    case "conversation.start": {
      const p = input.payload;
      if (!isEntityId(p.projectId)) return failure("invalid_message");
      const current = await db
        .selectFrom("projects")
        .selectAll()
        .where("id", "=", bytes(p.projectId))
        .executeTakeFirst();
      if (!current) return failure("record_not_found");
      if (current.setup_confirmed_at === null) return failure("project_in_setup");
      if (!text(p.content) || !validResearcherMessage(p.content)) return failure("message_invalid");
      const admission = await tasks.admission(current.id, null, p.content);
      if (!admission.ok) return admission;
      result = newId();
      await db
        .insertInto("conversations")
        .values({
          id: result,
          project_id: current.id,
          title: null,
          automatic_title_eligible: current.is_development ? 0 : 1,
          created_at: now,
          updated_at: now,
          revision: 1,
        })
        .execute();
      await append(db, result, p.content, now);
      await tasks.accept(current.id, result, 1, input.operationId);
      break;
    }
    case "conversation.rename": {
      const p = input.payload;
      if (!isEntityId(p.conversationId) || !isDiagnosticTime(p.expectedUpdatedAt))
        return failure("invalid_message");
      const current = await db
        .selectFrom("conversations")
        .selectAll()
        .where("id", "=", bytes(p.conversationId))
        .executeTakeFirst();
      if (!current) return failure("record_not_found");
      if (!validConversationTitle(p.title)) return failure("name_invalid");
      if (p.expectedUpdatedAt !== current.updated_at) return staleRevision(current.revision);
      result = current.id;
      const updated = new Date(
        Math.max(Date.parse(now), Date.parse(current.updated_at) + 1),
      ).toISOString();
      await db
        .updateTable("conversations")
        .set({
          title: p.title,
          title_attempt_id: null,
          updated_at: updated,
          revision: current.revision + 1,
        })
        .where("id", "=", result)
        .execute();
      break;
    }
    case "message.append": {
      const p = input.payload;
      if (!isEntityId(p.conversationId)) return failure("invalid_message");
      const current = await db
        .selectFrom("conversations")
        .selectAll()
        .where("id", "=", bytes(p.conversationId))
        .executeTakeFirst();
      if (!current) return failure("record_not_found");
      if (!text(p.content) || !validResearcherMessage(p.content)) return failure("message_invalid");
      const admission = await tasks.admission(current.project_id, current.id, p.content);
      if (!admission.ok) return admission;
      result = await append(db, current.id, p.content, now);
      const saved = await db
        .selectFrom("messages")
        .select("position")
        .where("id", "=", result)
        .executeTakeFirstOrThrow();
      await tasks.accept(current.project_id, current.id, saved.position, input.operationId);
      break;
    }
  }
  await db
    .insertInto("command_receipts")
    .values({
      operation_id: input.operationId,
      command: input.command,
      payload_sha256: hash,
      result_id: result,
      error_code: null,
      created_at: now,
    })
    .execute();
  return { ok: true, value: { resultId: identifier(result) } };
}
async function append(
  db: Kysely<ResearchSchema>,
  conversationId: Uint8Array,
  content: string,
  now: string,
): Promise<Uint8Array> {
  const position = await nextPosition(db, conversationId);
  const id = newId();
  await db
    .insertInto("messages")
    .values({
      id,
      conversation_id: conversationId,
      position,
      author_kind: "researcher",
      agent_id: null,
      task_id: null,
      ending: null,
      content,
      created_at: now,
    })
    .execute();
  return id;
}
export async function listProjects(
  db: Kysely<ResearchSchema>,
): Promise<Outcome<readonly ProjectRecord[]>> {
  const rows = await db
    .selectFrom("projects")
    .selectAll()
    .orderBy("last_opened_at", "desc")
    .orderBy("id", "desc")
    .execute();
  return { ok: true, value: rows.map(project) };
}
export async function listConversations(
  db: Kysely<ResearchSchema>,
  projectId: string,
): Promise<Outcome<readonly ConversationRecord[]>> {
  if (!isEntityId(projectId)) return failure("invalid_message");
  if (
    !(await db
      .selectFrom("projects")
      .select("id")
      .where("id", "=", bytes(projectId))
      .executeTakeFirst())
  )
    return failure("record_not_found");
  const rows = await conversationSummaries(db, projectId)
    .selectAll()
    .orderBy("latestAt", "desc")
    .orderBy("id", "desc")
    .execute();
  return { ok: true, value: rows.map(conversationRecord) };
}
export function conversationSummaries(db: Kysely<ResearchSchema>, projectId: string) {
  return db.selectFrom(
    db
      .selectFrom("conversations")
      .leftJoin("messages as latest", (join) =>
        join.on(
          "latest.id",
          "=",
          sql<Uint8Array>`(
          SELECT id FROM messages WHERE conversation_id = conversations.id
          ORDER BY position DESC LIMIT 1
        )`,
        ),
      )
      .where("conversations.project_id", "=", bytes(projectId))
      .selectAll("conversations")
      .select("latest.id as latestMessageId")
      .select(sql<string>`coalesce(latest.created_at, conversations.created_at)`.as("latestAt"))
      .as("summaries"),
  );
}
export async function listMessages(
  db: Kysely<ResearchSchema>,
  conversationId: string,
  fromPosition: number,
): Promise<Outcome<readonly MessageRecord[]>> {
  if (!isEntityId(conversationId) || !Number.isSafeInteger(fromPosition) || fromPosition < 1)
    return failure("invalid_message");
  if (
    !(await db
      .selectFrom("conversations")
      .select("id")
      .where("id", "=", bytes(conversationId))
      .executeTakeFirst())
  )
    return failure("record_not_found");
  const rows = await db
    .selectFrom("messages")
    .selectAll()
    .where("conversation_id", "=", bytes(conversationId))
    .where("position", ">=", fromPosition)
    .orderBy("position")
    .execute();
  return { ok: true, value: rows.map(message) };
}
