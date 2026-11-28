import {
  canonicalJson,
  encodeProfileContent,
  profileFieldTypes,
  profileSchemaVersion,
  type ProfileField,
  type ProfileFields,
  type ProfileOrigin,
} from "@ohtia/contracts";

export const profileSections = {
  schedule: ["deadline", "milestones", "weekly_availability_minutes"],
  research: [
    "discipline",
    "approach",
    "interests",
    "goals",
    "working_point",
    "topic",
    "questions",
    "objectives",
  ],
  requirements: [
    "thesis_level",
    "modality",
    "institution",
    "program",
    "estimated_length",
    "target_languages",
    "institutional_requirements",
    "citation_practice",
    "integrity_conditions",
    "ai_use_conditions",
    "restrictions",
    "academic_support",
  ],
  resources: ["experience", "autonomy", "tools", "difficulties", "adaptations"],
  prior_work: ["bibliography", "corpus", "data", "methods", "passages", "decisions"],
} as const satisfies Record<string, readonly ProfileField[]>;

export type ProfileSection = keyof typeof profileSections;
export function sectionOf(field: ProfileField): ProfileSection {
  return profileSectionIds.find((section) =>
    (profileSections[section] as readonly ProfileField[]).includes(field),
  ) as ProfileSection;
}
/** Fields without a saved answer; unknown and inapplicable are answers. */
export function unanswered(fields: ProfileFields | undefined, section: ProfileSection): number {
  return profileSections[section].filter((field) => !fields?.[field]).length;
}
/** The researcher's local calendar date, which a milestone date is compared with. */
export function localDate(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
export const profileSectionIds = Object.keys(profileSections) as ProfileSection[];
export const profileFields = profileSectionIds.flatMap((section) => [...profileSections[section]]);

export type SavedFact = NonNullable<ProfileFields[ProfileField]>;
export type FieldState = SavedFact["state"] | "pending";

export interface DraftValue {
  readonly id: string;
  readonly text: string;
  readonly date: string;
  /** Only milestones use the done mark. */
  readonly done: boolean;
  readonly origin: ProfileOrigin;
}
export interface FieldDraft {
  readonly state: FieldState;
  readonly values: readonly DraftValue[];
}
export type ProfileDraft = Readonly<Partial<Record<ProfileField, FieldDraft>>>;

export const researcherOrigin = { kind: "researcher_statement" } as const;
export function newDraftValue(id = "value"): DraftValue {
  return { id, text: "", date: "", done: false, origin: researcherOrigin };
}
export function editFact(fact: SavedFact | undefined): FieldDraft {
  if (!fact) return { state: "pending", values: [] };
  if (fact.state !== "known") return { state: fact.state, values: [] };
  const items = "items" in fact ? fact.items : [fact];
  return {
    state: "known",
    values: items.map(({ value, origin }, index) =>
      typeof value === "object"
        ? { id: String(index), text: value.title, date: value.date ?? "", done: value.done, origin }
        : { id: String(index), text: String(value), date: "", done: false, origin },
    ),
  };
}

export function draftFact(field: ProfileField, draft: FieldDraft): SavedFact | undefined {
  if (draft.state === "pending") return;
  if (draft.state !== "known") return { state: draft.state };
  const known = <T>(value: T, origin: ProfileOrigin) => ({
    state: "known" as const,
    value,
    origin,
  });
  const type = profileFieldTypes[field];
  if (type === "milestones")
    return {
      state: "known",
      items: draft.values.map(({ text, date, done, origin }) =>
        known({ title: text, ...(date ? { date } : {}), done }, origin),
      ),
    };
  if (type === "list")
    return { state: "known", items: draft.values.map(({ text, origin }) => known(text, origin)) };
  const value = draft.values[0];
  if (!value) return;
  return type === "minutes"
    ? known(/^\d+$/.test(value.text) ? Number(value.text) : Number.NaN, value.origin)
    : known(value.text, value.origin);
}

export function sameFact(left: SavedFact | undefined, right: SavedFact | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

export function validatedDraftFact(field: ProfileField, draft: FieldDraft): SavedFact | undefined {
  try {
    const fact = draftFact(field, draft);
    if (!fact) return;
    encodeProfileContent({ schemaVersion: profileSchemaVersion, fields: { [field]: fact } });
    return fact;
  } catch {
    return;
  }
}

export function encodeDraft(draft: ProfileDraft): {
  readonly fields: ProfileFields;
  readonly invalid: readonly ProfileField[];
} {
  const fields: Record<string, SavedFact> = {};
  const invalid: ProfileField[] = [];
  for (const field of profileFields) {
    const edit = draft[field];
    if (!edit) continue;
    const fact = validatedDraftFact(field, edit);
    if (fact) fields[field] = fact;
    else invalid.push(field);
  }
  return { fields, invalid };
}
