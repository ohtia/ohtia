/** Internal data-service contract. Window exposure belongs to STORY-003-010. */
export interface ProjectRecord {
  readonly id: string;
  readonly projectType: "thesis";
  readonly title: string | null;
  readonly documentLanguage: string | null;
  readonly isDevelopment: boolean;
  readonly setupConfirmedAt: string | null;
  readonly createdAt: string;
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
export interface MessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly position: number;
  readonly authorKind: "researcher" | "agent";
  readonly agentId: string | null;
  readonly taskId: string | null;
  readonly content: string;
  readonly createdAt: string;
}
export interface ResearchPayloads {
  readonly "development.createProject": Record<string, never>;
  readonly "project.create": Record<string, never>;
  readonly "project.confirmSetup": {
    readonly projectId: string;
    readonly title: string;
    readonly documentLanguage: string;
  };
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
  "development.createProject",
  "project.create",
  "project.confirmSetup",
  "conversation.start",
  "conversation.rename",
  "message.append",
] as const satisfies readonly ResearchCommandName[];
