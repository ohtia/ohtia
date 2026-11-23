import { useMemo, useState } from "react";
import {
  anthropicApiKeyConnection,
  catalogs,
  chatgptConnection,
  failure,
  type InterfaceLocale,
  type TimelineTask,
} from "../../packages/contracts/dist/index.js";
import { TaskNotice } from "../../packages/renderer/src/task-notice.js";
import "./conversation-specimen.css";
import "../../packages/renderer/src/conversation.css";
const id = (n: number) => `019a8000-0000-7000-8000-${String(n).padStart(12, "0")}`;
/** Synthetic task states and action results, with no data service or provider effects. */
export function TaskNoticeSpecimen() {
  const params = new URLSearchParams(location.search);
  const locale = (params.get("locale") ?? "en-US") as InterfaceLocale;
  const connection = params.has("apiKey") ? anthropicApiKeyConnection : chatgptConnection;
  useMemo(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.appearance = params.get("theme") ?? "light";
    if (params.has("expanded"))
      for (const [key, value] of Object.entries(catalogs[locale].messages)) {
        if (key.startsWith("taskNotice.") && key !== "taskNotice.waitingLimit")
          (catalogs[locale].messages as Record<string, string>)[key] =
            `⟦${value}${"·".repeat(Math.ceil(value.length * 0.4))}⟧`;
      }
  }, []);
  const [log, setLog] = useState("");
  const cases: readonly (Partial<TimelineTask> & {
    text?: boolean;
    latest?: boolean;
    runningAgent?: string;
  })[] = [
    { state: "queued" },
    { state: "queued", runningAgent: "Josefa" },
    { state: "running" },
    { state: "blocked", blockingReason: "connection_disabled" },
    { state: "blocked", blockingReason: "usage_limit_reached" },
    { state: "blocked", blockingReason: "restart_paused" },
    { state: "cancelling" },
    { state: "cancelled", dispatched: false },
    { state: "cancelled", text: true },
    { state: "cancelled" },
    ...[
      "usage_limit_reached",
      "not_eligible",
      "connection_expired",
      "provider_unavailable",
      "provider_error",
      "request_rejected",
      "invalid_output",
      "empty_reply",
      "output_limit_exceeded",
      "deadline_exceeded",
      "inactivity_timeout",
      "service_restarted",
      "permit_expired",
    ].map((outcomeReason) => ({ state: "failed" as const, outcomeReason })),
    ...[
      "deadline_exceeded",
      "inactivity_timeout",
      "output_limit_exceeded",
      "provider_error",
      "provider_unavailable",
      "invalid_output",
      "connection_lost",
    ].map((outcomeReason) => ({ state: "failed" as const, outcomeReason, text: true })),
    { state: "uncertain" },
    { state: "uncertain", text: true },
    { state: "failed", outcomeReason: "usage_limit_reached", latest: false },
    { state: "queued", waitingForModels: true },
    { state: "queued", waitingLimit: null },
    { state: "failed", outcomeReason: "not_eligible", text: true },
    { state: "failed", outcomeReason: "connection_expired", text: true },
  ];
  return (
    <main className="conversation-specimen">
      <h1>Task notices catalog</h1>
      <p>Synthetic state and command outcomes. No saved research or external effects.</p>
      <div
        className={`conversation-specimen-panel task-notices-specimen width-${params.get("width") === "320" ? "320" : "280"}`}
      >
        {cases.map((change, index) => {
          const task: TimelineTask = {
            id: id(index + 1),
            kind: "task",
            rank: 3,
            revision: 1,
            position: index + 1,
            agentId: "virgilio",
            language: "en",
            state: "failed",
            connection: connection.id,
            blockingReason: null,
            outcomeReason: null,
            replyMessageId: null,
            waitingForModels: false,
            waitingLimit: 3,
            dispatched: true,
            superseded: false,
            maxAttemptDurationMs: 600_000,
            maxInactivityMs: 120_000,
            ...change,
          };
          return (
            <article className="conversation-message agent" key={task.id} data-case={String(index)}>
              {change.text && <p lang="en">Synthetic partial reply. 한국어 mixed Latin.</p>}
              <TaskNotice
                task={task}
                locale={locale}
                connection={connection}
                hasText={change.text ?? false}
                latest={change.latest ?? true}
                runningAgent={change.runningAgent}

                pauses={{
                  revision: 1,
                  restart: 1234,
                  usage: [{ connection: connection.id, count: 12345 }],
                }}
                controller={{
                  async performTaskAction(operation, action) {
                    setLog(`${action} ${operation}`);
                    return params.has("uncertain")
                      ? failure("uncertain")
                      : params.has("failed")
                        ? failure("storage_failed")
                        : { ok: true, value: { resultId: id(999) } };
                  },
                }}
                commands={{
                  async openLink(destination) {
                    setLog(`open ${destination}`);
                    return true;
                  },
                }}
                onOpenConnections={() => setLog("connections")}
              />
            </article>
          );
        })}
      </div>
      <output aria-label="Synthetic callback log">{log}</output>
    </main>
  );
}
