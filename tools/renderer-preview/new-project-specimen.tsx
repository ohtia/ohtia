import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type InterfaceLocale,
  type TimelineSetupProposal,
  type FoundationPort,
} from "../../packages/contracts/dist/index.js";
import { ComposerController } from "../../packages/renderer/src/composer-controller.js";
import { ConversationView } from "../../packages/renderer/src/conversation-view.js";
import type { ConversationState } from "../../packages/renderer/src/conversation-controller.js";
import { WorkspaceSpecimen } from "./workspace-specimen.js";
import "../../packages/renderer/src/conversation.css";
const projectId = "019a8000-0000-7000-8000-000000000001",
  conversationId = "019a8000-0000-7000-8000-000000000002";
/** Synthetic creation and proposal decisions, isolated from storage and external services. */
export function NewProjectSpecimen() {
  const params = new URLSearchParams(location.search),
    locale = (params.get("locale") ?? "en-US") as InterfaceLocale;
  const [created, setCreated] = useState(params.has("setup"));
  const [decision, setDecision] = useState<TimelineSetupProposal["state"]>(
    (params.get("setup") ?? "proposed") as TimelineSetupProposal["state"],
  );
  const [sent, setSent] = useState(false);
  const create = useCallback(() => {
    setCreated(true);
    setDecision("proposed");
    setSent(false);
  }, []);
  const composer = useMemo(
    () =>
      new ComposerController({
        readDestination: () => ({
          result: Promise.resolve({ ok: true, value: { destination: null } }),
          cancel() {},
        }),
        appendMessage: () => {
          setSent(true);
          return {
            result: Promise.resolve({ ok: true, value: { resultId: conversationId } }),
            cancel() {},
          };
        },
      } as unknown as FoundationPort),
    [],
  );
  useEffect(() => {
    composer.open({ projectId, conversationId });
    void composer.refreshDestination();
    return () => composer.dispose();
  }, [composer]);
  useEffect(() => {
    composer.setup(
      decision === "confirmed",
      decision === "proposed" && !sent ? ["proposal-1"] : [],
    );
  }, [composer, decision, sent]);
  const project = {
    id: projectId,
    projectType: "thesis" as const,
    title: decision === "confirmed" ? "Redes de cuidado en Rosario" : null,
    documentLanguage: decision === "confirmed" ? "es-AR" : null,
    isDevelopment: false,
    setupConfirmedAt: decision === "confirmed" ? "2026-11-17T10:00:00Z" : null,
    lastOpenedAt: "2026-11-17T10:00:00.000Z",
    createdAt: "2026-11-17T10:00:00Z",
    updatedAt: "2026-11-17T10:00:00Z",
  };
  const proposal: TimelineSetupProposal = {
    kind: "setupProposal",
    id: "proposal-1",
    taskId: "task-1",
    position: 2,
    rank: 2,
    revision: 1,
    title: "Redes de cuidado en Rosario",
    documentLanguage: "es-AR",
    state: decision,
    invalidReason: decision === "invalid" ? "language_unknown" : null,
  };
  const state: ConversationState = {
    scope: { projectId, conversationId },
    agentHint: "virgilio",
    project,
    status: "ready",
    items: params.has("empty")
      ? []
      : [
          {
            kind: "message",
            id: "message-1",
            taskId: "task-1",
            authorKind: "agent",
            agentId: "virgilio",
            position: 2,
            rank: 1,
            revision: 1,
            language: "es-AR",
            ending: "complete",
            content: "Te propongo este título y el español de Argentina para tu tesis.",
          },
          proposal,
          ...(sent
            ? [
                {
                  kind: "message" as const,
                  id: "message-2",
                  taskId: null,
                  authorKind: "researcher" as const,
                  agentId: null,
                  position: 3,
                  rank: 1 as const,
                  revision: 1,
                  language: null,
                  ending: null,
                  content: "Please revise the proposed setup.",
                },
              ]
            : []),
        ],
    texts: new Map([
      ["message-2", "Please revise the proposed setup."],
      ["message-1", "Te propongo este título y el español de Argentina para tu tesis."],
    ]),
    replies: new Map(),
    next: null,
    loadingEarlier: false,
    failedEarlier: false,
    completed: 0,
  };
  return (
    <>
      <WorkspaceSpecimen
        onNewProject={create}
        project={created ? project : undefined}
        projectScope={created ? projectId : undefined}
        onComposerFocus={composer.focus}
        chat={
          created ? (
            <ConversationView
              state={state}
              controller={{
                composer,
                reload() {},
                loadEarlier() {},
                performSetupAction: async (_proposal, action) => {
                  setDecision(action === "confirm" ? "confirmed" : "rejected");
                },
              }}
              commands={{ copyMessage: async () => false, openExternalLink: async () => false }}
              locale={locale}
            />
          ) : undefined
        }
      />
      <output hidden data-synthetic-sent={sent} />
    </>
  );
}
