import { windowConnectionSubscription } from "./connection-subscription.js";
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  formatDate,
  formatNumber,
  message,
  type FoundationPort,
  type ConnectionSnapshot,
  type InterfaceLocale,
  type ProviderDeclaration,
  type ReplyDetails,
} from "@ohtia/contracts";
import { contributorNames } from "./contributor-identity.js";
import { LucideGlyph } from "./iconography.js";
import { Tooltip } from "./layers.js";
import { readMemoryText } from "./project-memory-view.js";

export type ReplyDetailsPort = Pick<
  FoundationPort,
  "readReplyDetails" | "readConnection" | "readMemoryHistory" | "readTextPart"
> &
  Partial<Pick<FoundationPort, "subscribeConnection">>;
export interface DetailsSource {
  readonly port: ReplyDetailsPort;
  readonly projectId: string;
  readonly taskId: string;
  readonly service?: string;
  readonly connections?: readonly ProviderDeclaration["connection"][] | undefined;
}

type DetailsState =
  | { readonly kind: "loading" | "failed" }
  | {
      readonly kind: "ready";
      readonly details: ReplyDetails;
      readonly email: string | null;
      readonly service: string;
    };

export function useReplyDetails(locale: InterfaceLocale, source?: DetailsSource) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<DetailsState>({ kind: "loading" });
  const heading = useId();
  const button = useRef<HTMLButtonElement>(null);
  const { port, projectId, taskId, connections, service } = source ?? {};
  useEffect(() => {
    if (!open || !port || !projectId || !taskId) return;
    const input = { projectId, taskId };
    let active = true;
    let subscription: ReturnType<FoundationPort["subscribeConnection"]> | undefined;
    let shown: ReplyDetails | undefined;
    let lastAccountState: ConnectionSnapshot | undefined;
    const accountChanged = (current: ConnectionSnapshot, details: ReplyDetails) =>
      (current.state === "connected") !== (details.account !== "disconnected") ||
      (current.account_revision ?? null) !== details.accountRevision;
    const refresh = () => {
      setState({ kind: "loading" });
      setRevision((value) => value + 1);
    };
    const initial = port.readReplyDetails(input);
    async function load() {
      if (!port) return;
      const result = await initial.result;
      if (!result.ok) throw new Error("Reply details unavailable.");
      let details = result.value;
      if (details.account !== null && port.subscribeConnection) {
        subscription = windowConnectionSubscription(port)(details.connectionId, (notice) => {
          if (!active || !notice.ok) return;
          lastAccountState = notice.value;
          if (shown && accountChanged(notice.value, shown)) refresh();
        });
        const ready = await subscription.ready;
        if (!active) return;
        if (ready.ok) {
          // Registration does not replay a snapshot. Read again after the subscriber is active.
          const current = await port.readReplyDetails(input).result;
          if (!current.ok) throw new Error("Current reply details unavailable.");
          details = current.value;
        }
      }
      let label =
        service ??
        connections?.find(({ id }) => id === details.connectionId)?.displayName ??
        (details.connectionId === "fake" ? "Fake" : details.connectionId);
      let email: string | null = null;
      if (details.account === "same" && details.connectionKind === "subscription") {
        const current = await port.readConnection(details.connectionId).result;
        if (!current.ok) throw new Error("Reply account unavailable.");
        label = current.value.display_name || label;
        if (
          current.value.state !== "connected" ||
          current.value.account_revision !== details.accountRevision
        ) {
          if (!active) return;
          const latest = await port.readReplyDetails(input).result;
          if (!latest.ok) throw new Error("Current reply details unavailable.");
          details = latest.value;
        }
        if (
          current.value.state === "connected" &&
          current.value.account_revision === details.accountRevision
        )
          email = current.value.account_email;
      }
      if (!active) return;
      if (lastAccountState && accountChanged(lastAccountState, details)) {
        refresh();
        return;
      }
      shown = details;
      setState({ kind: "ready", details, email, service: label });
    }
    void load().catch(() => {
      if (active) setState({ kind: "failed" });
    });
    return () => {
      active = false;
      initial.cancel();
      subscription?.dispose();
    };
  }, [open, port, projectId, taskId, connections, service, revision]);

  if (!source) return { button: null, panel: null };
  const label = message(locale, open ? "replyDetails.hide" : "replyDetails.show");
  return {
    button: (
      <Tooltip label={label}>
        <button
          ref={button}
          type="button"
          className="primitive-button primitive-quiet reply-details-toggle"
          aria-label={label}
          onClick={() => {
            setState({ kind: "loading" });
            setOpen(!open);
          }}
        >
          <LucideGlyph name="receipt-text" size={16} />
        </button>
      </Tooltip>
    ),
    panel: open ? (
      <section
        className="reply-details"
        lang={locale}
        aria-labelledby={heading}
        aria-busy={state.kind === "loading" || undefined}
      >
        <h3 id={heading}>{message(locale, "replyDetails.title")}</h3>
        {state.kind === "loading" && <p role="status">{message(locale, "replyDetails.loading")}</p>}
        {state.kind === "failed" && (
          <>
            <div className="conversation-notice danger" role="alert">
              <LucideGlyph name="octagon-alert" size={16} />
              <span>{message(locale, "replyDetails.failed")}</span>
            </div>
            <button
              type="button"
              className="primitive-button reply-details-reload"
              onClick={() => {
                button.current?.focus();
                setState({ kind: "loading" });
                setRevision(revision + 1);
              }}
            >
              {message(locale, "replyDetails.reload")}
            </button>
          </>
        )}
        {state.kind === "ready" && <DetailValues data={state} source={source} locale={locale} />}
      </section>
    ) : null,
  };
}

function DetailValues({
  data: { details, email, service },
  source,
  locale,
}: {
  readonly data: Extract<DetailsState, { kind: "ready" }>;
  readonly source: DetailsSource;
  readonly locale: InterfaceLocale;
}) {
  const unknown = message(locale, "replyDetails.unknown");
  const number = (value: number | null) => (value === null ? unknown : formatNumber(locale, value));
  const date = (value: string | null) =>
    value === null
      ? unknown
      : formatDate(locale, new Date(value), { dateStyle: "medium", timeStyle: "medium" });
  const operation =
    details.operation === "development_test_synthesis" ? "development_test" : details.operation;
  const account =
    details.account === null
      ? null
      : details.account === "unknown"
        ? unknown
        : details.connectionKind === "api_key"
          ? details.account === "same"
            ? message(locale, "replyDetails.keySame")
            : message(
                locale,
                details.account === "different"
                  ? "replyDetails.keyDifferent"
                  : "replyDetails.keyDisconnected",
                { service },
              )
          : details.account === "same"
            ? email
              ? message(locale, "replyDetails.accountSame", { email })
              : unknown
            : message(
                locale,
                details.account === "different"
                  ? "replyDetails.accountDifferent"
                  : "replyDetails.accountDisconnected",
                { service },
              );
  const fields: readonly [string, ReactNode][] = [
    [message(locale, "replyDetails.agent"), contributorNames[details.agentId]],
    [
      message(locale, "replyDetails.operation"),
      message(locale, "replyDetails.operationVersion", {
        operation: message(locale, `replyDetails.operation.${operation}`),
        version: details.instructionVersion,
      }),
    ],
    [
      message(locale, "replyDetails.connection"),
      details.connectionKind === "api_key"
        ? message(locale, "replyDetails.apiKeyConnection", { service })
        : service,
    ],
    ...(account === null
      ? []
      : ([[message(locale, "replyDetails.account"), account] as const] as [string, ReactNode][])),
    [message(locale, "replyDetails.requestedModel"), details.requestedModel ?? unknown],
    [message(locale, "replyDetails.observedModel"), details.observedModel ?? unknown],
    [
      message(locale, "replyDetails.requestedEffort"),
      details.requestedEffort ?? message(locale, "agents.modelDefault"),
    ],
    [message(locale, "replyDetails.observedEffort"), details.observedEffort ?? unknown],
    [message(locale, "replyDetails.attempts"), number(details.attempts)],
    [message(locale, "replyDetails.started"), date(details.startedAt)],
    [message(locale, "replyDetails.ended"), date(details.endedAt)],
    [
      message(locale, "replyDetails.duration"),
      details.durationMs === null
        ? unknown
        : formatNumber(locale, details.durationMs / 1000, {
            style: "unit",
            unit: "second",
            unitDisplay: "short",
            maximumFractionDigits: 1,
          }),
    ],
    [message(locale, "replyDetails.inputTokens"), number(details.tokens.input_tokens)],
    [message(locale, "replyDetails.cachedInputTokens"), number(details.tokens.cached_input_tokens)],
    [message(locale, "replyDetails.outputTokens"), number(details.tokens.output_tokens)],
    [message(locale, "replyDetails.reasoningTokens"), number(details.tokens.reasoning_tokens)],
    [
      message(locale, "replyDetails.usage"),
      message(locale, `replyDetails.usage.${details.usage}`, { service }),
    ],
    [
      message(locale, "replyDetails.memory"),
      <MemoryVersions source={source} locale={locale} entries={details.memory} />,
    ],
  ];
  return (
    <dl>
      {fields.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{typeof value === "string" ? <bdi>{value}</bdi> : value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function MemoryVersions({
  entries,
  source,
  locale,
}: {
  readonly entries: ReplyDetails["memory"];
  readonly source: DetailsSource;
  readonly locale: InterfaceLocale;
}) {
  const label = message(locale, "replyDetails.memoryCount", { n: entries.length });
  if (!entries.length) return label;
  return (
    <details className="reply-details-memory">
      <summary className="primitive-link">{label}</summary>
      <ol>
        {entries.map((entry, index) => (
          <li key={entry.versionId}>
            <MemoryVersion
              source={source}
              locale={locale}
              version={entry}
              entryNumber={index + 1}
            />
          </li>
        ))}
      </ol>
    </details>
  );
}

function MemoryVersion({
  version,
  entryNumber,
  source,
  locale,
}: {
  readonly version: ReplyDetails["memory"][number];
  readonly entryNumber: number;
  readonly source: DetailsSource;
  readonly locale: InterfaceLocale;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string>();
  const [failed, setFailed] = useState(false);
  const { port, projectId } = source;
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const read = port.readMemoryHistory({
      projectId,
      entryId: version.entryId,
      before: version.version + 1,
    });
    async function loadMemoryVersion() {
      const result = await read.result;
      const stored =
        result.ok && result.value.versions.find(({ number }) => number === version.version);
      if (!stored) throw new Error("Memory version unavailable.");
      const content = await readMemoryText(port, stored.text, abort.signal);
      if (!abort.signal.aborted) setText(content);
    }
    void loadMemoryVersion().catch(() => {
      if (!abort.signal.aborted) setFailed(true);
    });
    return () => {
      abort.abort();
      read.cancel();
    };
  }, [open, port, projectId, version.entryId, version.version]);
  return (
    <details
      onToggle={(event) => {
        setFailed(false);
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="primitive-link">
        {message(locale, "replyDetails.memoryVersion", {
          entry: entryNumber,
          version: version.version,
        })}
      </summary>
      {failed ? (
        <p role="alert">{message(locale, "memory.historyFailed")}</p>
      ) : text === undefined ? (
        <p role="status">{message(locale, "replyDetails.loading")}</p>
      ) : (
        <p lang="" dir="auto">
          {text}
        </p>
      )}
    </details>
  );
}
