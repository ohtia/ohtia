import { canonicalJson } from "./canonical-json.js";
import { utf8Size } from "./port.js";
import { isResearchId, type PortText } from "./research-port.js";

export const profileTextBytes = 2 * 1024;
export const profileRevisionBytes = 32 * 1024;
export const profileListLimit = 16;

const fieldTypes = {
  thesis_level: "text",
  modality: "text",
  institution: "text",
  program: "text",
  discipline: "text",
  approach: "text",
  interests: "list",
  goals: "list",
  working_point: "text",
  target_languages: "list",
  topic: "text",
  questions: "list",
  objectives: "list",
  estimated_length: "text",
  institutional_requirements: "list",
  citation_practice: "text",
  integrity_conditions: "list",
  ai_use_conditions: "list",
  restrictions: "list",
  academic_support: "list",
  deadline: "date",
  milestones: "milestones",
  weekly_availability_minutes: "minutes",
  experience: "text",
  autonomy: "text",
  tools: "list",
  difficulties: "list",
  adaptations: "list",
  bibliography: "list",
  corpus: "list",
  data: "list",
  methods: "list",
  passages: "list",
  decisions: "list",
} as const;
export type ProfileField = keyof typeof fieldTypes;
export function isProfileField(value: unknown): value is ProfileField {
  return typeof value === "string" && Object.hasOwn(fieldTypes, value);
}

export type ProfileOrigin =
  | { readonly kind: "researcher_statement" }
  | { readonly kind: "described_material"; readonly description: string }
  | {
      readonly kind: "artifact_version";
      readonly artifact: "conversation_message";
      readonly id: string;
      readonly revision: 1;
    }
  | {
      readonly kind: "adopted_proposal";
      readonly proposalId: string;
      readonly producer: "virgilio";
      readonly attemptId: string;
    };
type Known<T> = { readonly state: "known"; readonly value: T; readonly origin: ProfileOrigin };
type Unresolved = { readonly state: "unknown" | "inapplicable" };
type List<T> = { readonly state: "known"; readonly items: readonly Known<T>[] };
type Milestone = { readonly title: string; readonly date?: string };
type ProfileFactType = {
  text: Known<string>;
  date: Known<string>;
  minutes: Known<number>;
  list: List<string>;
  milestones: List<Milestone>;
};
export type ProfileFields = {
  readonly [K in ProfileField]?: ProfileFactType[(typeof fieldTypes)[K]] | Unresolved;
};
export interface ProfileContent {
  readonly schemaVersion: 1;
  readonly fields: ProfileFields;
}
export interface ProfileRevision {
  readonly revisionId: string;
  readonly revision: number;
  readonly previousRevisionId: string | null;
  readonly changedFields: readonly ProfileField[];
}
export interface ProfileChange {
  readonly projectId: string;
  readonly revision: ProfileRevision;
}
export interface ProfileSaveResult {
  readonly resultId: string;
  readonly profileChange: ProfileChange;
}
export interface ProfileReadResult {
  readonly projectId: string;
  readonly profile: (ProfileRevision & { readonly content: PortText }) | null;
}
export interface ProfileReceiptResult {
  readonly projectId: string;
  readonly operationId: string;
  readonly receipt: ProfileSaveResult | null;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    object(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function boundedText(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !/[\0\uD800-\uDFFF]/u.test(value) &&
    utf8Size(value) <= profileTextBytes
  );
}
function calendarDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function milestone(value: unknown): boolean {
  return (
    object(value) &&
    boundedText(value.title) &&
    (Object.hasOwn(value, "date")
      ? exact(value, ["title", "date"]) && calendarDate(value.date)
      : exact(value, ["title"]))
  );
}
function origin(value: unknown): boolean {
  if (!object(value)) return false;
  switch (value.kind) {
    case "researcher_statement":
      return exact(value, ["kind"]);
    case "described_material":
      return exact(value, ["kind", "description"]) && boundedText(value.description);
    case "artifact_version":
      return (
        exact(value, ["kind", "artifact", "id", "revision"]) &&
        value.artifact === "conversation_message" &&
        isResearchId(value.id) &&
        value.revision === 1
      );
    case "adopted_proposal":
      return (
        exact(value, ["kind", "proposalId", "producer", "attemptId"]) &&
        isResearchId(value.proposalId) &&
        value.producer === "virgilio" &&
        isResearchId(value.attemptId)
      );
    default:
      return false;
  }
}
function known(value: unknown, valid: (item: unknown) => boolean): boolean {
  return (
    exact(value, ["state", "value", "origin"]) &&
    value.state === "known" &&
    valid(value.value) &&
    origin(value.origin)
  );
}
function fieldValue(field: ProfileField, value: unknown): boolean {
  if (exact(value, ["state"])) return value.state === "unknown" || value.state === "inapplicable";
  switch (fieldTypes[field]) {
    case "text":
      return known(value, boundedText);
    case "date":
      return known(value, calendarDate);
    case "minutes":
      return known(
        value,
        (item) =>
          typeof item === "number" && Number.isSafeInteger(item) && item >= 0 && item <= 10_080,
      );
    case "list":
    case "milestones":
      return (
        exact(value, ["state", "items"]) &&
        value.state === "known" &&
        Array.isArray(value.items) &&
        value.items.length <= profileListLimit &&
        value.items.every((item: unknown) =>
          known(item, fieldTypes[field] === "list" ? boundedText : milestone),
        )
      );
  }
}

/** The same bounded canonical body represents a sparse save and an immutable snapshot. */
export function decodeProfileContent(encoded: string): ProfileContent | undefined {
  try {
    if (utf8Size(encoded) > profileRevisionBytes) return;
    const value: unknown = JSON.parse(encoded);
    if (
      exact(value, ["schemaVersion", "fields"]) &&
      value.schemaVersion === 1 &&
      object(value.fields) &&
      Object.keys(value.fields).length > 0 &&
      Object.entries(value.fields).every(
        ([key, fact]) => isProfileField(key) && fieldValue(key, fact),
      ) &&
      canonicalJson(value) === encoded
    )
      return value as unknown as ProfileContent;
  } catch {
    return;
  }
}
export function encodeProfileContent(content: ProfileContent): string {
  const encoded = canonicalJson(content);
  if (!decodeProfileContent(encoded)) throw new Error("Invalid thesis profile content.");
  return encoded;
}
