import { useLayoutEffect, useRef, useState } from "react";
import {
  formatNumber,
  message,
  planChangeLimit,
  type InterfaceLocale,
  type PlanChangeInvalidReason,
  type PlanChangePreview,
  type PlanChangeRow,
  type PlanChangeRequest,
  type PlanText,
  type TimelinePlanChangeProposal,
} from "@ohtia/contracts";
import { VoiceLabel } from "./contributor-identity.js";
import type { ConversationController } from "./conversation-controller.js";
import { PlanNotice } from "./plan-progress.js";
import { invalidPlanMessage } from "./plan-proposal.js";
import { ActionProposalCard } from "./research-presentation.js";

const identity = { kind: "ai", contributor: "virgilio", definitionVersion: "1" } as const;

function invalidChangeReason(locale: InterfaceLocale, reason: PlanChangeInvalidReason) {
  if (reason === "plan_moved_on") return message(locale, "planChange.stale");
  switch (reason) {
    case "too_many_changes":
      return message(locale, "planChange.invalid.too_many_changes", { max: planChangeLimit });
    case "empty_change":
    case "unknown_contribution":
    case "contribution_completed":
    case "dependency_removed":
    case "agent_not_authorized":
      return message(locale, `planChange.invalid.${reason}`);
    default:
      return invalidPlanMessage(locale, reason);
  }
}

function invalidChange(locale: InterfaceLocale, reason: PlanChangeInvalidReason) {
  const detail = invalidChangeReason(locale, reason);
  return reason === "plan_moved_on"
    ? detail
    : [
        message(locale, "planChange.invalid"),
        detail,
        message(locale, "consultation.invalid.nextReply"),
      ].join(" ");
}

function rowLabel(locale: InterfaceLocale, row: PlanChangeRow, service: string) {
  const list = new Intl.ListFormat(locale);
  if (row.restartHeld || row.blockingReason === "restart_paused")
    return message(locale, "plan.progress.restartPaused");
  if (row.state === "waiting" && row.waitingFor.length)
    return message(locale, "plan.progress.waitingFor", { keys: list.format(row.waitingFor) });
  if (row.state === "blocked" && row.blockedBy)
    return message(locale, "plan.progress.blockedBy", { key: row.blockedBy });
  if (row.state === "active") {
    if (row.taskState === "running") return message(locale, "plan.progress.working");
    if (row.taskState === "cancelling") return message(locale, "taskNotice.stopping");
    if (row.blockingReason === "connection_disabled")
      return message(locale, "plan.progress.disconnected", { service });
    if (row.blockingReason === "usage_limit_reached")
      return message(locale, "plan.progress.usagePaused", { service });
  }
  switch (row.state) {
    case "completed":
      return message(locale, "plan.progress.done");
    case "failed":
      return message(locale, "plan.progress.failed");
    case "uncertain":
      return message(locale, "plan.progress.uncertain");
    case "cancelled":
      return message(locale, "plan.progress.cancelled");
    default:
      return message(locale, "plan.progress.waitingToStart");
  }
}

export function PlanChangeProposal({
  proposal,
  preview,
  locale,
  hasText,
  language,
  texts,
  connectionName,
  decide,
}: {
  readonly proposal: TimelinePlanChangeProposal;
  readonly preview: PlanChangePreview | undefined;
  readonly locale: InterfaceLocale;
  readonly hasText: boolean;
  readonly language: string;
  readonly texts: ReadonlyMap<string, string>;
  readonly connectionName: (id: string) => string;
  readonly decide: ConversationController["performPlanChange"];
}) {
  const [feedback, setFeedback] = useState<{ message: string; danger: boolean }>();
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const restore = useRef(false);
  const operations = useRef(new Map<boolean, string>());
  const open = proposal.state === "proposed";
  useLayoutEffect(() => {
    if (
      !open &&
      restore.current &&
      root.current?.ownerDocument.activeElement === root.current?.ownerDocument.body
    )
      root.current?.focus({ preventScroll: true });
    if (!open) restore.current = false;
  }, [open]);

  async function perform(apply: boolean) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setFeedback(undefined);
    restore.current = root.current?.contains(root.current.ownerDocument.activeElement) ?? false;
    const operation = operations.current.get(apply) ?? crypto.randomUUID();
    operations.current.set(apply, operation);
    const failed = message(locale, apply ? "planChange.applyFailed" : "planChange.declineFailed");
    try {
      const result = await decide(operation, proposal.id, apply);
      if (!result.ok) {
        const { error } = result;
        if (error.code === "plan_change_invalid")
          setFeedback({
            danger: false,
            message: invalidChangeReason(locale, error.parameters.reason),
          });
        else if (error.code === "event_limit_reached")
          setFeedback({ danger: false, message: message(locale, "plan.progress.eventLimit") });
        else setFeedback({ danger: true, message: failed });
      }
    } catch {
      setFeedback({ danger: true, message: failed });
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  if (proposal.state === "invalid" && proposal.invalidReason)
    return (
      <div className="setup-invalid">
        {!hasText && <VoiceLabel identity={identity} locale={locale} />}
        <PlanNotice
          notice={{ danger: false, message: invalidChange(locale, proposal.invalidReason) }}
        />
      </div>
    );
  if (!preview) return null;
  const value = (text: PlanText) =>
    typeof text === "string" ? text : (texts.get(text.source) ?? "");
  const display = (row: PlanChangeRow, stops = false) => (
    <>
      <div className="plan-row-state">
        <code>{row.key}</code> · {rowLabel(locale, row, connectionName(row.connection))}
      </div>
      {stops && row.taskState === "running" && (
        <p className="plan-meta">{message(locale, "planChange.stops")}</p>
      )}
    </>
  );
  const request = (entry: PlanChangeRequest) => {
    const changed = new Set(entry.changed);
    const list = new Intl.ListFormat(locale);
    return (
      <div className="plan-row plan-change-request">
        <div className="consultation-recipient">
          <VoiceLabel
            identity={{ ...identity, contributor: entry.agentId }}
            compact
            locale={locale}
          />
          <span>· {connectionName(entry.connection)}</span>
        </div>
        <p className="plan-meta">
          <code>{entry.key}</code> ·{" "}
          {message(
            locale,
            entry.required
              ? changed.has("required")
                ? "planChange.required"
                : "plan.required"
              : changed.has("required")
                ? "planChange.optional"
                : "plan.optional",
          )}
        </p>
        {(entry.prerequisites.length > 0 || changed.has("prerequisites")) && (
          <p className="plan-meta">
            {entry.prerequisites.length
              ? message(locale, changed.has("prerequisites") ? "planChange.after" : "plan.after", {
                  keys: list.format(entry.prerequisites),
                })
              : message(locale, "planChange.afterNone")}
          </p>
        )}
        <dl className="research-fields plan-request-fields">
          <div>
            <dt>
              {changed.has("request")
                ? message(locale, "planChange.request")
                : message(locale, "plan.request") + ":"}
            </dt>
            <dd lang={language} dir="auto">
              {value(entry.request)}
            </dd>
          </div>
          <div>
            <dt>
              {changed.has("reason")
                ? message(locale, "planChange.reason")
                : message(locale, "plan.reason") + ":"}
            </dt>
            <dd lang={language} dir="auto">
              {value(entry.reason)}
            </dd>
          </div>
        </dl>
      </div>
    );
  };
  const state =
    proposal.state === "applied"
      ? "accepted"
      : proposal.state === "proposed"
        ? "open"
        : proposal.state === "replaced"
          ? "replaced"
          : "declined";
  return (
    <div ref={root} tabIndex={-1}>
      <ActionProposalCard
        proposer={identity}
        locale={locale}
        showVoice={!hasText}
        title={message(locale, "planChange.title")}
        state={state}
        stateLabel={
          open
            ? message(locale, "setup.waiting")
            : proposal.state === "applied"
              ? message(locale, "planChange.applied")
              : proposal.state === "replaced"
                ? message(locale, "plan.replaced")
                : message(locale, "planChange.declined")
        }
        stateIcon={
          open ? "circle-dashed" : proposal.state === "applied" ? "circle-check" : "circle-x"
        }
        sections={[]}
        busy={busy}
        actions={
          open
            ? [
                {
                  label: message(locale, "planChange.apply"),
                  primary: true,
                  disabled: busy,
                  onPress: () => void perform(true),
                },
                {
                  label: message(locale, "planChange.decline"),
                  disabled: busy,
                  onPress: () => void perform(false),
                },
              ]
            : []
        }
        feedback={open && feedback ? <PlanNotice notice={feedback} /> : undefined}
        details={
          <div className="plan-change-details">
            <dl className="plan-change-groups">
              {preview.removed.length > 0 && (
                <div>
                  <dt>{message(locale, "planChange.removed")}</dt>
                  <dd>
                    <ul className="plan-rows">
                      {preview.removed.map((row) => (
                        <li key={row.key}>{display(row, true)}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {preview.replaced.length > 0 && (
                <div>
                  <dt>{message(locale, "planChange.changed")}</dt>
                  <dd>
                    <ul className="plan-rows">
                      {preview.replaced.map(({ before, after }) => (
                        <li key={before.key}>
                          {display(before, true)}
                          {request(after)}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {preview.added.length > 0 && (
                <div>
                  <dt>{message(locale, "planChange.added")}</dt>
                  <dd>
                    <ul className="plan-rows">
                      {preview.added.map((row) => (
                        <li key={row.key}>{request(row)}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {preview.unchanged.length > 0 && (
                <div>
                  <dt>{message(locale, "planChange.unchanged")}</dt>
                  <dd>
                    <ul className="plan-rows">
                      {preview.unchanged.map((row) => (
                        <li key={row.key}>{display(row)}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {preview.purpose !== null && (
                <div>
                  <dt>{message(locale, "planChange.purpose")}</dt>
                  <dd lang={language} dir="auto">
                    {value(preview.purpose)}
                  </dd>
                </div>
              )}
              {preview.context !== null && (
                <div>
                  <dt>{message(locale, "planChange.context")}</dt>
                  <dd lang={language} dir="auto">
                    {value(preview.context)}
                  </dd>
                </div>
              )}
            </dl>
            <p className="plan-meta">
              {message(locale, "planChange.requests", {
                n: preview.additionalRequests,
                m: preview.remainingRequests,
                max_requests: formatNumber(locale, preview.maxRequests),
              })}
            </p>
          </div>
        }
      />
    </div>
  );
}
