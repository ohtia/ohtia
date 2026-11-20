import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  formatNumber,
  message,
  type CommandBridge,
  type InterfaceLocale,
  type PlanInvalidReason,
  type PlanSnapshot,
  type ReplyAgent,
  type TimelinePlan,
} from "@ohtia/contracts";
import { VoiceLabel } from "./contributor-identity.js";
import { LucideGlyph } from "./iconography.js";
import { ActionProposalCard, MessageMarkdown } from "./research-presentation.js";
import type { ConversationController, ReadPlanCard } from "./conversation-controller.js";

export type PlanCardController = Pick<
  ConversationController,
  | "readPlanCard"
  | "readPlanDestinations"
  | "observePlanDestinations"
  | "performPlanAction"
  | "connections"
>;

const identity = (contributor: ReplyAgent) =>
  ({ kind: "ai", contributor, definitionVersion: "1" }) as const;

type Feedback = { readonly message: string; readonly danger: boolean };
function PlanNotice({ notice }: { readonly notice: Feedback }) {
  return (
    <div
      className={`conversation-notice ${notice.danger ? "danger" : "attention"}`}
      role={notice.danger ? "alert" : "status"}
    >
      <LucideGlyph name={notice.danger ? "octagon-alert" : "triangle-alert"} size={16} />
      <span>{notice.message}</span>
    </div>
  );
}

function invalidMessage(locale: InterfaceLocale, reason: PlanInvalidReason): string {
  switch (reason) {
    case "plan_too_large":
      return message(locale, "plan.invalid.plan_too_large", {
        max_contributions: 8,
        max_dependencies: 16,
      });
    case "purpose_too_long":
      return message(locale, "plan.invalid.purpose_too_long", { max: 2000 });
    case "reason_too_long":
      return message(locale, "plan.invalid.reason_too_long", { max: 500 });
    case "plan_key_invalid":
      return message(locale, "plan.invalid.plan_key_invalid", { min: 1, max: 64 });
    default:
      return message(locale, `plan.invalid.${reason}`);
  }
}

type Action = "accept" | "decline";
type ActionFeedback =
  "destinationChanged" | "unfinished" | "acceptFailed" | "declineFailed" | PlanInvalidReason;

export function PlanProposal({
  proposal,
  locale,
  controller,
  hasText,
  openExternalLink,
}: {
  readonly proposal: TimelinePlan;
  readonly locale: InterfaceLocale;
  readonly controller: PlanCardController;
  readonly hasText: boolean;
  readonly openExternalLink: CommandBridge["openExternalLink"];
}) {
  const {
    readPlanCard,
    readPlanDestinations,
    observePlanDestinations,
    performPlanAction,
    connections,
  } = controller;
  const [read, setRead] = useState<ReadPlanCard>();
  const [readFailed, setReadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [destinations, setDestinations] = useState<PlanSnapshot["connections"]>({});
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const restore = useRef(false);
  const intents = useRef(new Map<Action, { id: string; signature: string }>());
  const invalid = proposal.invalidReason;
  const plan = read && read.revision >= proposal.revision ? read : undefined;
  const open = (plan?.state ?? proposal.state) === "proposed";
  const projectId = plan?.projectId;
  const agentList = plan
    ? [...new Set<ReplyAgent>(["virgilio", ...plan.contributions.map(({ agentId }) => agentId)])]
        .sort()
        .join(",")
    : "";
  useEffect(() => {
    if (invalid) return;
    let live = true;
    setReadFailed(false);
    const read = new AbortController();
    void readPlanCard(proposal.id, read.signal).then(
      (value) => {
        if (live) setRead(value);
      },
      () => {
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
      read.abort();
    };
  }, [invalid, proposal.id, proposal.revision, readPlanCard, reload]);
  useEffect(() => {
    if (!open || !projectId || !agentList) return;
    let live = true;
    let requested = 0;
    const update = () => {
      const sequence = ++requested;
      void readPlanDestinations(projectId, agentList.split(",") as ReplyAgent[]).then(
        (value) => {
          if (live && requested === sequence) setDestinations(value);
        },
        () => {
          if (live && requested === sequence) setDestinations({});
        },
      );
    };
    update();
    const unsubscribe = observePlanDestinations(update);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [open, projectId, agentList, readPlanDestinations, observePlanDestinations, refresh]);
  useLayoutEffect(() => {
    if (!open && restore.current && document.activeElement === document.body)
      root.current?.focus({ preventScroll: true });
    if (!open) restore.current = false;
  }, [open]);

  const chosen: PlanSnapshot["connections"] =
    plan?.state === "accepted" ? plan.connections : open ? destinations : {};
  const service = (agent: ReplyAgent) => connections.find(({ id }) => id === chosen[agent]);
  const canRun =
    !!plan &&
    [service("virgilio"), ...plan.contributions.map(({ agentId }) => service(agentId))].every(
      Boolean,
    );
  async function decide(action: Action) {
    if (active.current || !plan || (action === "accept" && !canRun)) return;
    const shown = action === "accept" ? destinations : undefined;
    const signature = JSON.stringify(shown ?? null);
    const previous = intents.current.get(action);
    const intent =
      previous?.signature === signature ? previous : { id: crypto.randomUUID(), signature };
    intents.current.set(action, intent);
    active.current = true;
    restore.current = root.current?.contains(document.activeElement) ?? false;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await performPlanAction(intent.id, proposal, shown);
      if (result.ok || result.error.code === "proposal_not_waiting") {
        intents.current.clear();
        setReload((value) => value + 1);
        return;
      }
      switch (result.error.code) {
        case "destination_changed":
          intents.current.delete(action);
          setDestinations({});
          setRefresh((value) => value + 1);
          setFeedback("destinationChanged");
          break;
        case "plan_unfinished":
          setFeedback("unfinished");
          break;
        case "plan_invalid":
          setFeedback(result.error.parameters.reason);
          break;
        default:
          setFeedback(action === "accept" ? "acceptFailed" : "declineFailed");
      }
    } catch {
      setFeedback(action === "accept" ? "acceptFailed" : "declineFailed");
    } finally {
      setBusy(false);
      active.current = false;
    }
  }

  if (invalid)
    return (
      <div className="setup-invalid">
        {!hasText && <VoiceLabel identity={identity("virgilio")} locale={locale} />}
        <PlanNotice
          notice={{
            danger: false,
            message: [
              message(locale, "plan.invalid"),
              invalidMessage(locale, invalid),
              message(locale, "consultation.invalid.nextReply"),
            ].join(" "),
          }}
        />
      </div>
    );

  const language = proposal.language ?? "";
  const markdown = (text: string) => (
    <div lang={language} dir="auto" className="plan-markdown">
      <MessageMarkdown
        text={text}
        locale={locale}
        language={language || undefined}
        openExternalLink={openExternalLink}
      />
    </div>
  );
  const planState = plan?.state ?? proposal.state;
  if (planState === "invalid") return null;
  const agentServices = new Map<string, number>();
  for (const agent of [
    ...(plan?.contributions.map(({ agentId }) => agentId) ?? []),
    "virgilio",
  ] as const) {
    const destination = service(agent);
    if (destination)
      agentServices.set(destination.id, (agentServices.get(destination.id) ?? 0) + 1);
  }
  const requestCounts = connections.flatMap(({ id, displayName }) => {
    const n = agentServices.get(id);
    return n ? [message(locale, "plan.serviceRequests", { n, service: displayName })] : [];
  });
  const requestSummary =
    plan && agentServices.size && (plan.state === "accepted" || (open && canRun))
      ? message(locale, "plan.requests", {
          requests: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
            requestCounts,
          ),
          max_requests: formatNumber(locale, plan.maxRequests),
        })
      : null;
  const synthesisService = service("virgilio");
  const keys = new Map(plan?.contributions.map(({ id, key }) => [id, key]));
  const warning = (() => {
    switch (feedback) {
      case undefined:
        return undefined;
      case "destinationChanged":
      case "unfinished":
      case "acceptFailed":
      case "declineFailed":
        return {
          message: message(locale, `plan.${feedback}`),
          danger: feedback === "acceptFailed" || feedback === "declineFailed",
        };
      default:
        return {
          message: `${message(locale, "plan.cannotRun")} ${invalidMessage(locale, feedback)}`,
          danger: false,
        };
    }
  })();
  return (
    <div ref={root} tabIndex={-1} id={`message-${proposal.id}`}>
      <ActionProposalCard
        locale={locale}
        proposer={identity("virgilio")}
        title={message(locale, "plan.title")}
        showVoice={!hasText}
        state={planState === "proposed" ? "open" : planState}
        stateLabel={
          planState === "proposed"
            ? message(locale, "setup.waiting")
            : message(locale, `plan.${planState}`)
        }
        announceState
        busy={!plan && !readFailed}
        sections={
          plan
            ? [
                { label: message(locale, "plan.purpose"), value: { text: plan.purpose, language } },
                {
                  label: message(locale, "plan.context"),
                  value: { text: plan.sharedContext, language },
                  rendered: markdown(plan.sharedContext),
                },
              ]
            : []
        }
        details={
          plan ? (
            <>
              <ul className="plan-rows">
                {plan.contributions.map((node) => (
                  <li key={node.id} className="plan-row">
                    <div className="consultation-recipient">
                      <VoiceLabel identity={identity(node.agentId)} compact locale={locale} />
                      {service(node.agentId) && <span>· {service(node.agentId)?.displayName}</span>}
                    </div>
                    <p className="plan-meta">
                      <code>{node.key}</code> ·{" "}
                      {message(locale, node.required ? "plan.required" : "plan.optional")}
                    </p>
                    {!!node.prerequisites.length && (
                      <p className="plan-meta">
                        {message(locale, "plan.after", {
                          keys: new Intl.ListFormat(locale).format(
                            node.prerequisites.flatMap((id) => keys.get(id) ?? []),
                          ),
                        })}
                      </p>
                    )}
                    <dl className="research-fields">
                      <dt>{message(locale, "plan.request")}:</dt>
                      <dd>{markdown(node.request)}</dd>
                      <dt>{message(locale, "plan.reason")}:</dt>
                      <dd lang={language} dir="auto">
                        {node.reason}
                      </dd>
                    </dl>
                  </li>
                ))}
                <li className="plan-row plan-meta">
                  <div className="consultation-recipient">
                    <span>{message(locale, "plan.synthesis")} ·</span>
                    <VoiceLabel identity={identity("virgilio")} compact locale={locale} />
                    <span>
                      {synthesisService && `· ${synthesisService.displayName}`}
                      {plan.state !== "accepted" && message(locale, "plan.synthesisPurpose")}
                    </span>
                  </div>
                </li>
              </ul>
              {requestSummary && <p className="plan-meta">{requestSummary}</p>}
            </>
          ) : !readFailed ? (
            <p>{message(locale, "plan.loading")}</p>
          ) : undefined
        }
        actions={
          plan && open
            ? [
                {
                  label: message(locale, "plan.run"),
                  primary: true,
                  disabled: busy || !canRun,
                  onPress: () => void decide("accept"),
                },
                {
                  label: message(locale, "plan.decline"),
                  disabled: busy,
                  onPress: () => void decide("decline"),
                },
              ]
            : []
        }
        {...(plan && open && (busy || !canRun)
          ? {
              disabledReason: message(
                locale,
                busy ? "command.reason.busy" : "plan.destinationUnavailable",
              ),
            }
          : {})}
        feedback={
          readFailed ? (
            <>
              <PlanNotice notice={{ danger: true, message: message(locale, "plan.readFailed") }} />
              <button
                type="button"
                className="primitive-button plan-feedback-action"
                onClick={() => {
                  setReload((value) => value + 1);
                }}
              >
                {message(locale, "plan.reload")}
              </button>
            </>
          ) : open && warning ? (
            <PlanNotice notice={warning} />
          ) : null
        }
      />
    </div>
  );
}
