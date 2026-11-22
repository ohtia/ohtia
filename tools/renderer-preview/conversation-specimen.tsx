import { useMemo, useState } from "react";
import {
  catalogs,
  chatgptConnection,
  failure,
  type ReplyDetails,
  type InterfaceLocale,
  type TimelineItem,
} from "../../packages/contracts/dist/index.js";
import { ConversationView } from "../../packages/renderer/src/conversation-view.js";
import type { ConversationState } from "../../packages/renderer/src/conversation-controller.js";
import "./conversation-specimen.css";
import type { ReplyDetailsPort } from "../../packages/renderer/src/reply-details.js";

const id = (n: number) => `019a8000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text =
  '# A first comparison plan\n\n1. Match each school to its district.\n\n   Keep the district identifier with each row.\n\n2. Compare absence rates by `heat_band`.\n\n> Examine the source before drawing an inference.\n>\n> Keep source observations separate from interpretations.\n\n```python\nrates = schools.merge(districts, on="district_id").groupby("heat_band")["absence_days"].mean()\n```\n\n| District | Surface temp. (°C) | Days absent | Very long column label |\n| --- | ---: | ---: | --- |\n| District 1 | 31.8 | 12 | 한국어 mixed Latin with a very long unbroken address |\n| District 2 | 29.6 | 8 | More evidence to examine |\n\nExample values. Add hot days once the [daily temperature series][weather] is out.\n\n[weather]: https://example.org/long/full/address?source=daily-temperature-series\n\nInline $x *literal*$ and display:\n\n$$\nx **literal** + y\n$$\n\n![never fetched](https://example.org/tracker.png)\n\n<script>throw new Error("never executes")</script>\n\n[unsafe](javascript:alert(1))\n\n~~strikethrough~~ [^note]\n\n[^note]: literal footnote\n\n---\n\nA paragraph after the thematic break.';
const sample: ReplyDetails = {
  agentId: "virgilio",
  operation: "direct_guidance",
  instructionVersion: 6,
  connectionId: "chatgpt",
  connectionKind: "subscription",
  account: "same",
  accountRevision: "019a8000-0000-4000-8000-000000000042",
  requestedModel: "GPT synthetic",
  observedModel: "GPT synthetic 한국어",
  requestedEffort: "high",
  observedEffort: "low",
  attempts: 1,
  startedAt: "2026-11-10T14:41:07.000Z",
  endedAt: "2026-11-10T14:41:52.000Z",
  durationMs: 45000,
  usage: "reported",
  tokens: {
    input_tokens: 18240,
    cached_input_tokens: 12032,
    output_tokens: 1206,
    reasoning_tokens: null,
  },
  memory: [{ entryId: id(40), versionId: id(41), version: 1 }],
};
const call = <T,>(value: T) => ({ result: Promise.resolve(value), cancel() {} });
const detailsPort: ReplyDetailsPort = {
  readReplyDetails: () => call({ ok: true, value: sample }),
  readConnection: () =>
    call({
      ok: true,
      value: {
        connection: "chatgpt",
        display_name: "ChatGPT",
        state: "connected",
        reason: null,
        account_email: "researcher@example.org",
        account_revision: "019a8000-0000-4000-8000-000000000042",
        last_account_email: null,
        probing: false,
        probe_id: null,
        model_list_revision: null,
        model_count: 0,
      },
    }),
  readMemoryHistory: () =>
    call({
      ok: true,
      value: {
        entryId: id(40),
        next: null,
        versions: [
          {
            number: 1,
            kind: "note",
            change: "added",
            state: "active",
            author: "researcher",
            date: "2026-11-10T14:41:07.000Z",
            text: "Synthetic memory version.",
          },
        ],
      },
    }),
  readTextPart: () => call(failure("record_not_found")),
};
/** Synthetic presentation only: clipboard and browser effects are replaced with a visible log. */
export function ConversationSpecimen() {
  const params = new URLSearchParams(location.search);
  const locale = (params.get("locale") ?? "en-US") as InterfaceLocale;
  const requestedWidth = params.get("width");
  const width =
    requestedWidth === "320" || requestedWidth === "640" || requestedWidth === "960"
      ? requestedWidth
      : "280";
  useMemo(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.appearance = params.get("theme") ?? "light";
    if (params.has("expanded")) {
      for (const [key, value] of Object.entries(catalogs[locale].messages)) {
        if (key.startsWith("conversation.") || key.startsWith("replyDetails."))
          (catalogs[locale].messages as Record<string, string>)[key] =
            `⟦${value}${"·".repeat(Math.ceil(Array.from(value).length * 0.4))}⟧`;
      }
    }
  }, []);
  const [log, setLog] = useState("");
  const state: ConversationState = {
    scope: { projectId: id(10), conversationId: id(20) },
    status: "ready",
    items: [
      {
        kind: "message",
        id: id(1),
        position: 1,
        rank: 1,
        revision: 1,
        authorKind: "researcher",
        agentId: null,
        taskId: null,
        content: "How do I compare the school data? attendance_2024_daily_records_by_school_v3.csv",
        language: null,
        ending: null,
      },
      {
        kind: "message",
        id: id(2),
        position: 2,
        rank: 1,
        revision: 1,
        authorKind: "agent",
        agentId: "virgilio",
        taskId: id(30),
        content: text,
        language: "en",
        ending: "complete",
      },
      {
        kind: "task",
        connection: "chatgpt",
        blockingReason: null,
        outcomeReason: null,
        replyMessageId: null,
        waitingForModels: false,
        waitingLimit: 3,
        dispatched: true,
        superseded: false,
        maxAttemptDurationMs: 600_000,
        maxInactivityMs: 120_000,
        id: id(31),
        position: 3,
        rank: 3,
        revision: 1,
        agentId: "virgilio",
        language: "ko",
        state: "running",
      },
    ] as TimelineItem[],
    texts: new Map([
      [id(1), "How do I compare the school data? attendance_2024_daily_records_by_school_v3.csv"],
      [id(2), text],
    ]),
    replies: new Map([
      [id(31), { sequence: 1, text: "**한국어 mixed Latin**\n\nA streaming *reply*" }],
    ]),
    next: null,
    loadingEarlier: false,
    failedEarlier: false,
    completed: 0,
  };
  return (
    <main className="conversation-specimen">
      <h1>Conversation Markdown catalog</h1>
      <p>Synthetic messages. No clipboard, external navigation, research or provider effects.</p>
      <div className={`conversation-specimen-panel width-${width}`}>
        <ConversationView
          state={state}
          locale={locale}
          detailsPort={detailsPort}
          controller={{ connections: [chatgptConnection], reload() {}, loadEarlier() {} }}
          commands={{
            async copyMessage(messageId) {
              setLog(`copy ${messageId}`);
              return !params.has("copyFails");
            },
            async openExternalLink(url) {
              setLog(`open ${url}`);
              return true;
            },
          }}
        />
      </div>
      <output aria-label="Synthetic callback log">{log}</output>
    </main>
  );
}
