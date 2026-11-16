import { useMemo, useState } from "react";
import {
  catalogs,
  type InterfaceLocale,
  type TimelineItem,
} from "../../packages/contracts/dist/index.js";
import { ConversationView } from "../../packages/renderer/src/conversation-view.js";
import type { ConversationState } from "../../packages/renderer/src/conversation-controller.js";
import "./conversation-specimen.css";

const id = (n: number) => `019a8000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text =
  '# A first comparison plan\n\n1. Match each school to its district.\n\n   Keep the district identifier with each row.\n\n2. Compare absence rates by `heat_band`.\n\n> Examine the source before drawing an inference.\n>\n> Keep source observations separate from interpretations.\n\n```python\nrates = schools.merge(districts, on="district_id").groupby("heat_band")["absence_days"].mean()\n```\n\n| District | Surface temp. (°C) | Days absent | Very long column label |\n| --- | ---: | ---: | --- |\n| District 1 | 31.8 | 12 | 한국어 mixed Latin with a very long unbroken address |\n| District 2 | 29.6 | 8 | More evidence to examine |\n\nExample values. Add hot days once the [daily temperature series][weather] is out.\n\n[weather]: https://example.org/long/full/address?source=daily-temperature-series\n\nInline $x *literal*$ and display:\n\n$$\nx **literal** + y\n$$\n\n![never fetched](https://example.org/tracker.png)\n\n<script>throw new Error("never executes")</script>\n\n[unsafe](javascript:alert(1))\n\n~~strikethrough~~ [^note]\n\n[^note]: literal footnote\n\n---\n\nA paragraph after the thematic break.';
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
        if (key.startsWith("conversation."))
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
          controller={{ reload() {}, loadEarlier() {} }}
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
