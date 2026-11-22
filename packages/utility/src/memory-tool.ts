import { isMemoryTool, type ProviderTool, type ProviderToolCall } from "@ohtia/contracts";

import { memoryKinds, type MemoryKind } from "@ohtia/contracts";
const memoryActions = ["add", "edit", "merge", "withdraw"] as const;
export type MemoryAction = (typeof memoryActions)[number];

export interface MemoryChange {
  readonly action: MemoryAction;
  readonly entries: readonly string[];
  readonly kind: MemoryKind;
  readonly text: string;
  readonly sources: readonly string[];
}

export const memoryTool: ProviderTool = {
  namespace: "ohtia",
  name: "update_memory",
  description:
    "Add, edit, merge or withdraw project memory entries. Ohtia applies the valid changes when your reply completes, and the researcher can undo them.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      changes: {
        type: "array",
        description: "One to three changes, applied in order.",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["add", "edit", "merge", "withdraw"],
              description: "What the change does.",
            },
            entries: {
              type: "array",
              description:
                "Labels of the entries the change acts on, such as E2: none to add, one to edit or withdraw, two to five to merge, the first of which keeps the merged entry.",
              items: {
                type: "string",
              },
            },
            kind: {
              type: "string",
              enum: ["goal", "decision", "focus", "open_question", "note"],
              description: "Kind of the added, edited or merged entry. Ignored to withdraw.",
            },
            text: {
              type: "string",
              description: "Text of the added, edited or merged entry. Ignored to withdraw.",
            },
            sources: {
              type: "array",
              description:
                "Labels of the messages the entry comes from, such as M4. A goal or decision needs a message of the researcher. Ignored to withdraw.",
              items: {
                type: "string",
              },
            },
          },
          required: ["action", "entries", "kind", "text", "sources"],
          additionalProperties: false,
        },
      },
    },
    required: ["changes"],
    additionalProperties: false,
  },
};

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isChange(value: unknown): value is MemoryChange {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 5) return false;
  const { action, entries, kind, text, sources } = value as Record<string, unknown>;
  return (
    memoryActions.includes(action as MemoryAction) &&
    strings(entries) &&
    memoryKinds.includes(kind as MemoryKind) &&
    typeof text === "string" &&
    strings(sources)
  );
}

export function memoryCalls(
  calls: readonly ProviderToolCall[],
): readonly (readonly MemoryChange[])[] {
  return calls.filter(isMemoryTool).map(({ arguments: args }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args);
    } catch {
      return [];
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Object.keys(parsed).length !== 1 ||
      !("changes" in parsed) ||
      !Array.isArray(parsed.changes) ||
      !parsed.changes.every(isChange)
    )
      return [];
    return parsed.changes;
  });
}
