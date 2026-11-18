/** Internal data-service contract. Window exposure belongs to STORY-003-010. */
export interface ProjectRecord {
  readonly id: string;
  readonly projectType: "thesis";
  readonly title: string | null;
  readonly documentLanguage: string | null;
  readonly isDevelopment: boolean;
  readonly setupConfirmedAt: string | null;
  readonly createdAt: string;
  readonly lastOpenedAt: string;
  readonly updatedAt: string;
}
export interface ConversationRecord {
  readonly id: string;
  readonly projectId: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}
/** The same persisted name rules apply to researcher edits and generated suggestions. */
export function validConversationTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 400 &&
    Array.from(value).length <= 200 &&
    value.trim() === value &&
    !/^\p{White_Space}|\p{White_Space}$/u.test(value) &&
    !/[\0\uD800-\uDFFF]/u.test(value)
  );
}
export interface MessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly position: number;
  readonly authorKind: "researcher" | "agent";
  readonly agentId: string | null;
  readonly taskId: string | null;
  readonly content: string;
  readonly ending: "complete" | "partial" | null;
  readonly createdAt: string;
}
export interface ResearchPayloads {
  readonly "conversation.stop": { readonly conversationId: string };
  readonly "task.stop": { readonly taskId: string };
  readonly "task.tryAgain": { readonly taskId: string };
  /** Invoking this human command acknowledges possible duplicate charges. */
  readonly "task.startAgain": { readonly taskId: string };
  readonly "usagePause.resume": { readonly connection: "chatgpt" };
  readonly "task.continueAll": Record<string, never>;
  readonly "task.cancelAll": Record<string, never>;
  readonly "development.createProject": Record<string, never>;
  readonly "development.sendToJosefa": ResearchPayloads["message.append"];
  readonly "project.create": Record<string, never>;
  readonly "project.open": { readonly projectId: string };
  readonly "project.confirmSetup": { readonly proposalId: string };
  readonly "project.rejectSetup": { readonly proposalId: string };
  readonly "conversation.start": { readonly projectId: string; readonly content: string };
  readonly "conversation.rename": {
    readonly conversationId: string;
    readonly title: string;
    readonly expectedUpdatedAt: string;
  };
  readonly "message.append": { readonly conversationId: string; readonly content: string };
}
export type ResearchCommandName = keyof ResearchPayloads;
export type ResearchCommand = {
  [K in ResearchCommandName]: {
    readonly command: K;
    readonly operationId: string;
    readonly payload: ResearchPayloads[K];
  };
}[ResearchCommandName];
/** A stable receipt result; read records separately so replay never returns newer content as the old result. */
export interface ResearchResult {
  readonly resultId: string;
}
export const researchCommands = [
  "conversation.stop",
  "task.stop",
  "task.startAgain",
  "task.tryAgain",
  "usagePause.resume",
  "task.continueAll",
  "task.cancelAll",
  "development.createProject",
  "development.sendToJosefa",
  "project.create",
  "project.open",
  "project.confirmSetup",
  "project.rejectSetup",
  "conversation.start",
  "conversation.rename",
  "message.append",
] as const satisfies readonly ResearchCommandName[];
