import { useEffect, useMemo, useRef, useState } from "react";
import {
  catalogs,
  chatgptConnection,
  failure,
  type FoundationPort,
  type InterfaceLocale,
  type Outcome,
  type ResearchResult,
  type TimelineItem,
} from "../../packages/contracts/dist/index.js";
import { CommandController } from "../../packages/renderer/src/command-controller.js";
import { CommandPalette } from "../../packages/renderer/src/command-discovery.js";
import { ExitDialog } from "../../packages/renderer/src/exit-dialog.js";
import "../../packages/renderer/src/command-surfaces.css";
import { ComposerController } from "../../packages/renderer/src/composer-controller.js";
import { ConversationView } from "../../packages/renderer/src/conversation-view.js";
import type { ConversationState } from "../../packages/renderer/src/conversation-controller.js";
import "./conversation-specimen.css";
import { WorkspaceSpecimen } from "./workspace-specimen.js";
const projectId = "019a8000-0000-7000-8000-000000000001";
const conversationId = "019a8000-0000-7000-8000-000000000002";
const success: Outcome<ResearchResult> = { ok: true, value: { resultId: conversationId } };
const call = <T,>(value: T) => ({ result: Promise.resolve(value), cancel() {} });
/** Synthetic port. Every save and Stop waits for an explicit catalog-only confirmation. */
export function ComposerSpecimen() {
  const params = new URLSearchParams(location.search);
  const locale = (params.get("locale") ?? "en-US") as InterfaceLocale;
  const [log, setLog] = useState("");
  const [exit, setExit] = useState(false);
  const [palette, setPalette] = useState(false);
  const paletteTrigger = useRef<HTMLButtonElement>(null);
  const fixture = useMemo(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.appearance = params.get("theme") ?? "light";
    if (params.has("expanded"))
      for (const [key, value] of Object.entries(catalogs[locale].messages)) {
        if (key.startsWith("composer.") && !key.endsWith("counter") && !key.endsWith("remove"))
          (catalogs[locale].messages as Record<string, string>)[key] =
            `⟦${value}${"·".repeat(Math.ceil(value.length * 0.4))}⟧`;
      }
    let destinationFails = params.has("destinationFailure");
    let destinationPending = params.has("destinationPending");
    let resolveDestination: (() => void) | undefined;
    let saved: ((result: Outcome<ResearchResult>) => void) | undefined;
    let stopped: ((result: Outcome<ResearchResult>) => void) | undefined;
    const declaration = params.has("apiKey")
      ? { id: "fake", displayName: "Fake API", kind: "api_key" as const, usageUrl: null }
      : chatgptConnection;
    const port = {
      appendMessage(id: string) {
        setLog(`saving ${id}`);
        return {
          result: new Promise<Outcome<ResearchResult>>((resolve) => {
            saved = resolve;
          }),
          cancel() {},
        };
      },
      stopConversation(id: string) {
        if (params.has("stackedNotices")) return call(failure("uncertain"));
        setLog(`stopping ${id}`);
        return {
          result: new Promise<Outcome<ResearchResult>>((resolve) => {
            stopped = resolve;
          }),
          cancel() {},
        };
      },
      sendTextPart() {
        return call({ ok: true, value: { accepted: true } });
      },
      subscribeConnection() {
        return {
          ready: Promise.resolve({ ok: true, value: { subscriptionId: "connection" } }),
          dispose() {},
        };
      },
      readDestination() {
        if (destinationFails) return call(failure("storage_failed"));
        const value = {
          ok: true as const,
          value: {
            destination: {
              operation: "development_test",
              maxAttemptDurationMs: 600_000,
              connection: declaration.id,
            },
          },
        };
        if (destinationPending)
          return {
            result: new Promise<typeof value>((resolve) => {
              resolveDestination = () => {
                destinationPending = false;
                resolve(value);
              };
            }),
            cancel() {},
          };
        return call(value);
      },
      readConnection() {
        return call({
          ok: true,
          value: {
            state: "connected",
            account_email: "researcher@example.org",
            last_account_email: null,
          },
        });
      },
    } as unknown as FoundationPort;
    const composer = new ComposerController(port, () => crypto.randomUUID(), [declaration]);
    composer.open({ projectId, conversationId });
    if (params.has("stackedNotices")) {
      composer.edit("x".repeat(20_001));
      composer.running(true);
      composer.requestStop();
    }
    return {
      composer,
      commands: new CommandController(
        { windowGeneration: "synthetic-composer-window", platform: "linux" },
        locale,
      ),
      resolveDestination() {
        resolveDestination?.();
      },
      restoreDestination() {
        destinationFails = false;
      },
      confirmSave() {
        saved?.(success);
      },
      confirmStop() {
        stopped?.(success);
      },
    };
  }, []);
  useEffect(() => {
    void fixture.composer.refreshDestination();
    return () => {
      fixture.composer.dispose();
      fixture.commands.dispose();
    };
  }, [fixture]);
  const viewState = params.get("viewState");
  const agentMessage: TimelineItem = {
    kind: "message",
    id: conversationId,
    rank: 1,
    revision: 1,
    position: 2,
    authorKind: "agent",
    agentId: "virgilio",
    taskId: "019a8000-0000-7000-8000-000000000003",
    content: "Synthetic agent reply.",
    language: "en",
    ending: "complete",
  };
  const state: ConversationState = {
    scope: { projectId, conversationId },
    status:
      viewState === "loading" || viewState === "failed" || viewState === "unavailable"
        ? viewState
        : "ready",
    items: [
      {
        kind: "message",
        id: projectId,
        rank: 1,
        revision: 1,
        position: 1,
        authorKind: "researcher",
        agentId: null,
        taskId: null,
        content: "A reused message\nwith two lines.",
        language: null,
        ending: null,
      },
      ...(params.has("workspace") ? [agentMessage] : []),
    ],
    texts: new Map([
      [projectId, "A reused message\nwith two lines."],
      [conversationId, "Synthetic agent reply."],
    ]),
    replies: new Map(),
    next: null,
    loadingEarlier: false,
    failedEarlier: false,
    completed: 0,
  };
  const chat = (
    <ConversationView
      state={state}
      locale={locale}
      controller={{ composer: fixture.composer, reload() {}, loadEarlier() {} }}
      commands={{
        async copyMessage() {
          return true;
        },
        async openExternalLink() {
          return false;
        },
      }}
    />
  );
  if (params.has("workspace")) return <WorkspaceSpecimen chat={chat} />;
  return (
    <main className="conversation-specimen">
      <h1>Message composer catalog</h1>
      <p>Synthetic input, memory and port outcomes. No research or provider effects.</p>
      <div className="conversation-specimen-panel composer-specimen-panel width-280">{chat}</div>
      <button type="button" onClick={fixture.confirmSave}>
        Confirm synthetic save
      </button>
      <button type="button" onClick={fixture.confirmStop}>
        Confirm synthetic Stop
      </button>
      <button type="button" onClick={fixture.resolveDestination}>
        Confirm synthetic destination
      </button>
      <button type="button" onClick={fixture.restoreDestination}>
        Restore synthetic destination
      </button>
      <button type="button" onClick={() => setExit(true)}>
        Show synthetic exit
      </button>
      <ExitDialog
        state={
          exit
            ? { operationId: "synthetic-exit", phase: "confirm", running: 2, failed: false }
            : null
        }
        locale={locale}
        onChoose={() => setExit(false)}
      />
      <button ref={paletteTrigger} type="button" onClick={() => setPalette(true)}>
        Show synthetic palette
      </button>
      <CommandPalette
        open={palette}
        locale={locale}
        controller={fixture.commands}
        snapshot={fixture.commands.snapshot()}
        onClose={() => setPalette(false)}
        onInvoke={() => setPalette(false)}
        returnFocusRef={paletteTrigger}
      />
      <output aria-label="Synthetic callback log">{log}</output>
    </main>
  );
}
