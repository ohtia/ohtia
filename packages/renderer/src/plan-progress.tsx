import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  formatNumber,
  message,
  type ErrorCode,
  type InterfaceLocale,
  type PauseCounts,
  type PlanTaskProgress,
  type ProviderDeclaration,
  type ReplyAgent,
  type SimpleMessageKey,
} from "@ohtia/contracts";
import { contributorNames } from "./contributor-identity.js";
import { LucideGlyph, type LucideName } from "./iconography.js";
import { Dialog } from "./layers.js";
import { failedTaskContent } from "./task-notice.js";
import type {
  ConversationController,
  PlanProgressAction,
  ReadPlanCard,
} from "./conversation-controller.js";

type Connection = ProviderDeclaration["connection"];
type Contribution = ReadPlanCard["contributions"][number];
type Status = { readonly label: string; readonly icon: LucideName };
type EndAction = "cancel" | "finish";
type RowAction = {
  readonly label: string;
  readonly command: PlanProgressAction;
  readonly disabled?: boolean;
  readonly restart?: Connection;
};
type RowProgress = Status & {
  readonly formattedLabel?: ReactNode;
  readonly reason?: string;
  readonly action?: RowAction;
  readonly result?: string | null;
};
type Feedback = { readonly message: string; readonly danger: boolean };

export function PlanNotice({ notice }: { readonly notice?: Feedback }) {
  return (
    <div
      className={
        notice
          ? `conversation-notice ${notice.danger ? "danger" : "attention"}`
          : "primitive-announcement"
      }
      role={notice?.danger ? "alert" : "status"}
    >
      {notice && (
        <>
          <LucideGlyph name={notice.danger ? "octagon-alert" : "triangle-alert"} size={16} />
          <span>{notice.message}</span>
        </>
      )}
    </div>
  );
}

export function planProgressState(plan: ReadPlanCard, locale: InterfaceLocale) {
  if (plan.outcome) {
    const icons = {
      complete: "check-check",
      partial: "chart-pie",
      failed: "octagon-alert",
      cancelled: "circle-stop",
    } as const;
    return {
      label: message(locale, `plan.progress.${plan.outcome}`),
      icon: icons[plan.outcome],
    } as const;
  }
  if (plan.needsAttention)
    return { label: message(locale, "plan.progress.attention"), icon: "triangle-alert" } as const;
  return {
    label: message(locale, "plan.progress.running", {
      done: plan.contributions.filter(({ state }) => state === "completed").length,
      total: plan.contributions.length,
    }),
    icon: "circle-ellipsis",
  } as const;
}

function keyedStatus(
  locale: InterfaceLocale,
  keys: readonly string[],
  blocked = false,
): RowProgress {
  const slot = "\uFFFC";
  const list = new Intl.ListFormat(locale);
  const label = (value: string) =>
    blocked
      ? message(locale, "plan.progress.blockedBy", { key: value })
      : message(locale, "plan.progress.waitingFor", { keys: value });
  const [before, after] = label(slot).split(slot);
  return {
    icon: blocked ? "link-2-off" : "circle-dashed",
    label: label(list.format(keys)),
    formattedLabel: (
      <>
        {before}
        {list.formatToParts(keys).map((part, index) =>
          part.type === "element" ? (
            <code key={index} dir="ltr">
              {part.value}
            </code>
          ) : (
            <Fragment key={index}>{part.value}</Fragment>
          ),
        )}
        {after}
      </>
    ),
  };
}

function PlanStateAnnouncement({
  text,
  locale,
  dialogOpen,
  initial = false,
  suppress = false,
}: {
  readonly text: string;
  readonly locale: InterfaceLocale;
  readonly dialogOpen: boolean;
  readonly initial?: boolean;
  readonly suppress?: boolean;
}) {
  const previous = useRef<{ text: string; locale: InterfaceLocale } | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (dialogOpen) {
      setAnnouncement("");
      return;
    }
    const last = previous.current;
    previous.current = { text, locale };
    if (last ? last.locale === locale && last.text !== text : initial)
      setAnnouncement(suppress ? "" : text);
  }, [dialogOpen, initial, locale, suppress, text]);
  useEffect(() => {
    if (!announcement) return;
    // A native dialog can remove and restore the background accessibility tree.
    // Leave time for assistive technology to consume a queue of polite changes.
    const timer = setTimeout(() => {
      setAnnouncement("");
    }, 10000);
    return () => {
      clearTimeout(timer);
    };
  }, [announcement]);
  return (
    <div
      className="primitive-announcement"
      data-plan-state-announcement
      aria-live="polite"
      aria-atomic="true"
    >
      {dialogOpen ? "" : announcement}
    </div>
  );
}

function restartPause(locale: InterfaceLocale, pauses: PauseCounts | undefined): RowProgress {
  return {
    label: message(locale, "plan.progress.restartPaused"),
    icon: "circle-pause",
    action: {
      label: message(locale, "taskNotice.continue", {
        n: pauses ? formatNumber(locale, pauses.restart) : "—",
      }),
      command: { kind: "continue" },
      disabled: !pauses?.restart,
    },
  };
}

function taskProgress(
  task: PlanTaskProgress,
  taskId: string,
  {
    locale,
    pauses,
    service,
    synthesis,
    mayRetry,
  }: {
    readonly locale: InterfaceLocale;
    readonly pauses: PauseCounts | undefined;
    readonly service: Connection | undefined;
    readonly synthesis: boolean;
    readonly mayRetry: boolean;
  },
): RowProgress {
  switch (task.state) {
    case "running":
      return { label: message(locale, "plan.progress.working"), icon: "pen-line" };
    case "cancelling":
      return { label: message(locale, "taskNotice.stopping"), icon: "circle-stop" };
    case "completed":
      return {
        label: message(locale, "plan.progress.done"),
        icon: "check-check",
        result: task.replyMessageId,
      };
    case "cancelled":
      return {
        label: message(locale, synthesis ? "plan.progress.stopped" : "plan.progress.cancelled"),
        icon: "circle-stop",
      };
    case "uncertain":
      return {
        label: message(locale, "plan.progress.uncertain"),
        icon: "triangle-alert",
        ...(mayRetry && service
          ? {
              action: {
                label: message(locale, "taskNotice.startAgain"),
                command: { kind: synthesis ? "retrySynthesis" : "restartTask", taskId },
                restart: service,
              },
            }
          : {}),
      };
    case "failed":
      return {
        label: message(locale, "plan.progress.failed"),
        icon: "octagon-alert",
        ...(service
          ? {
              reason: failedTaskContent(
                { ...task, ...(synthesis ? { synthesis: true } : {}) },
                locale,
                service,
                !!task.replyMessageId,
              ).text,
            }
          : {}),
        ...(mayRetry &&
        task.outcomeReason !== "not_eligible" &&
        (!synthesis || task.outcomeReason !== "input_too_large")
          ? {
              action: {
                label: message(locale, "taskNotice.tryAgain"),
                command: { kind: synthesis ? "retrySynthesis" : "retryTask", taskId },
              },
            }
          : {}),
      };
    case "blocked":
      if (task.blockingReason === "restart_paused") return restartPause(locale, pauses);
      if (task.blockingReason === "connection_disabled" && service)
        return {
          label: message(locale, "plan.progress.disconnected", { service: service.displayName }),
          icon: "unplug",
        };
      if (
        task.blockingReason === "usage_limit_reached" &&
        service &&
        task.connection === "chatgpt"
      ) {
        const count = pauses?.usage.find(({ connection }) => connection === task.connection)?.count;
        return {
          label: message(locale, "plan.progress.usagePaused", { service: service.displayName }),
          icon: "circle-pause",
          action: {
            label: message(locale, "taskNotice.resume", {
              service: service.displayName,
              n: pauses ? formatNumber(locale, count ?? 0) : "—",
            }),
            command: { kind: "resume", connection: task.connection },
            disabled: !count,
          },
        };
      }
      break;
    case "queued":
      break;
  }
  return { label: message(locale, "plan.progress.waitingToStart"), icon: "circle-dashed" };
}

function contributionProgress(
  node: Contribution,
  plan: ReadPlanCard,
  nodes: ReadonlyMap<string, Contribution>,
  locale: InterfaceLocale,
  pauses: PauseCounts | undefined,
  service: Connection | undefined,
): RowProgress {
  if (node.state === "waiting") {
    if (node.restartHeld) return restartPause(locale, pauses);
    const keys = node.prerequisites.flatMap((id) => {
      const prerequisite = nodes.get(id);
      return prerequisite && prerequisite.state !== "completed" ? [prerequisite.key] : [];
    });
    return keys.length
      ? keyedStatus(locale, keys)
      : { label: message(locale, "plan.progress.waitingToStart"), icon: "circle-dashed" };
  }
  if (node.state === "blocked") {
    const cause = node.blockedBy ? nodes.get(node.blockedBy) : undefined;
    return keyedStatus(locale, cause ? [cause.key] : [], true);
  }
  if (node.state === "failed" && node.failureReason) {
    const reason =
      node.failureReason === "destination_changed"
        ? message(locale, "plan.progress.notSentDestination", {
            agent: contributorNames[node.agentId],
            service: service?.displayName ?? plan.connections[node.agentId] ?? "",
          })
        : message(
            locale,
            node.failureReason === "input_changed"
              ? "plan.progress.notSentInput"
              : "plan.progress.notSentSize",
          );
    return {
      label: message(locale, "plan.progress.failed"),
      icon: "octagon-alert",
      reason,
      ...(!plan.outcome && node.failureReason === "destination_changed"
        ? {
            action: {
              label: message(locale, "taskNotice.tryAgain"),
              command: { kind: "retryContribution", contributionId: node.id },
            },
          }
        : {}),
    };
  }
  if (node.state === "cancelled")
    return { label: message(locale, "plan.progress.cancelled"), icon: "circle-stop" };
  if (node.state === "completed")
    return {
      label: message(locale, "plan.progress.done"),
      icon: "check-check",
      result: node.resultMessageId,
    };
  if (node.task && node.taskId)
    return taskProgress(node.task, node.taskId, {
      locale,
      pauses,
      service,
      synthesis: false,
      mayRetry: !plan.outcome,
    });
  // Active nodes acquire a task atomically. The waiting label also covers an absent task
  // while reading older plan records.
  return { label: message(locale, "plan.progress.waitingToStart"), icon: "circle-dashed" };
}

function synthesisProgress(
  plan: ReadPlanCard,
  locale: InterfaceLocale,
  pauses: PauseCounts | undefined,
  service: Connection | undefined,
): RowProgress {
  const continuation = plan.continuation;
  if (
    continuation?.admission === "withdrawn" ||
    (continuation?.stopped && continuation.taskState !== "cancelling")
  )
    return { label: message(locale, "plan.progress.stopped"), icon: "circle-stop" };
  if (plan.outcome === "failed" || plan.outcome === "cancelled")
    return { label: message(locale, "plan.progress.notWritten"), icon: "circle-minus" };
  if (continuation?.task && continuation.taskId)
    return taskProgress(continuation.task, continuation.taskId, {
      locale,
      pauses,
      service,
      synthesis: true,
      mayRetry: true,
    });
  if (continuation?.restartHeld) return restartPause(locale, pauses);
  return {
    label: message(
      locale,
      plan.outcome ? "plan.progress.waitingToStart" : "plan.progress.waitingContributions",
    ),
    icon: "circle-dashed",
  };
}

type Refusal = {
  readonly code: ErrorCode;
  readonly action: PlanProgressAction;
  readonly destination?: { readonly agent: string; readonly service: string };
};

function progressNotice(locale: InterfaceLocale, { code, action, destination }: Refusal): Feedback {
  if (action.kind === "cancel" || action.kind === "finish")
    return {
      message: message(
        locale,
        action.kind === "cancel" ? "plan.progress.stopFailed" : "plan.progress.finishFailed",
      ),
      danger: true,
    };
  switch (code) {
    case "limit_reached":
      return { message: message(locale, "plan.progress.limitReached"), danger: false };
    case "destination_changed":
      if (destination)
        return {
          message: message(locale, "plan.progress.refusedDestination", destination),
          danger: false,
        };
      break;
    case "input_changed":
      return { message: message(locale, "plan.progress.refusedInput"), danger: false };
    case "plan_unfinished":
      return { message: message(locale, "plan.unfinished"), danger: false };
    case "event_limit_reached":
      return { message: message(locale, "plan.progress.eventLimit"), danger: false };
  }
  if (code === "pending_limit_reached")
    return { message: message(locale, "taskNotice.pendingLimit"), danger: false };
  if (["uncertain", "timeout", "cancelled", "disposed", "invalid_service_result"].includes(code))
    return { message: message(locale, "taskNotice.actionUncertain"), danger: false };
  return { message: message(locale, "taskNotice.actionFailed"), danger: true };
}

type ConfirmAction = {
  readonly action: PlanProgressAction;
  readonly title: SimpleMessageKey;
  readonly body: SimpleMessageKey;
  readonly label: SimpleMessageKey;
};

export function PlanProgress({
  plan,
  stateLabel,
  announceAcceptance,
  sharedAttentionAnnouncement = false,
  locale,
  connections,
  pauses,
  perform,
  refresh,
  root,
  revealResult,
  onOpenConnections,
  contributionHeading,
  requestDetails,
  synthesisHeading,
}: {
  readonly plan: ReadPlanCard;
  readonly stateLabel: string;
  readonly announceAcceptance: boolean;
  readonly sharedAttentionAnnouncement?: boolean;
  readonly locale: InterfaceLocale;
  readonly connections: readonly Connection[];
  readonly pauses?: PauseCounts;
  readonly perform?: ConversationController["performPlanProgressAction"];
  readonly refresh: () => void;
  readonly root: RefObject<HTMLDivElement | null>;
  readonly revealResult: (id: string) => void;
  readonly onOpenConnections?: () => void;
  readonly contributionHeading: (node: Contribution) => ReactNode;
  readonly requestDetails: (node: Contribution) => ReactNode;
  readonly synthesisHeading: ReactNode;
}) {
  const dialogDescription = useId();
  const active = useRef(false);
  const intents = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmAction>();
  const [refusal, setRefusal] = useState<Refusal>();
  const feedback = refusal && progressNotice(locale, refusal);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const nodes = new Map(plan.contributions.map((node) => [node.id, node]));
  const service = (agent: ReplyAgent, task?: PlanTaskProgress | null) => {
    const id = task?.connection ?? plan.connections[agent];
    return connections.find((connection) => connection.id === id);
  };
  const unfinished =
    !plan.outcome ||
    plan.continuation?.admission === "waiting" ||
    ["queued", "blocked", "running", "cancelling"].some(
      (state) => state === plan.continuation?.taskState,
    );
  const completed = plan.contributions.some(({ state }) => state === "completed");
  const endLabel = (kind: EndAction) =>
    kind === "cancel" ? "plan.progress.stop" : "plan.progress.finish";

  async function run(action: PlanProgressAction) {
    if (active.current || !perform) return;
    const key = JSON.stringify(action);
    const id = intents.current.get(key) ?? crypto.randomUUID();
    intents.current.set(key, id);
    active.current = true;
    setConfirm(undefined);
    setRefusal(undefined);
    setBusy(true);
    try {
      const result = await perform(id, action);
      if (result.ok || (action.kind === "finish" && result.error.code === "plan_state_changed")) {
        if (action.kind === "resume" || action.kind === "continue" || !result.ok)
          intents.current.delete(key);
        refresh();
        return;
      }
      const contribution =
        "contributionId" in action
          ? nodes.get(action.contributionId)
          : "taskId" in action && action.kind !== "retrySynthesis"
            ? plan.contributions.find(({ taskId }) => taskId === action.taskId)
            : undefined;
      const destination = contribution
        ? {
            agent: contributorNames[contribution.agentId],
            service:
              service(contribution.agentId)?.displayName ??
              plan.connections[contribution.agentId] ??
              "",
          }
        : undefined;
      setRefusal({ code: result.error.code, action, ...(destination ? { destination } : {}) });
    } catch {
      setRefusal({ code: "invalid_service_result", action });
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  function end(kind: EndAction) {
    const title = kind === "cancel" ? "plan.progress.stopTitle" : "plan.progress.finishTitle";
    const body =
      kind === "cancel"
        ? plan.outcome
          ? "plan.progress.stopSynthesisBody"
          : "plan.progress.stopBody"
        : completed
          ? "plan.progress.finishBody"
          : "plan.progress.finishEmptyBody";
    setConfirm({ action: { kind, planId: plan.planId }, title, body, label: endLabel(kind) });
  }

  const button = (label: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      className="primitive-button"
      aria-disabled={busy || disabled || undefined}
      onClick={() => {
        if (!busy && !disabled) onClick();
      }}
    >
      {label}
    </button>
  );

  function row(status: RowProgress, name: string, toggle?: ReactNode) {
    const { action, result } = status;
    return (
      <>
        <p className="action-proposal-state plan-row-state" data-icon={status.icon}>
          <LucideGlyph name={status.icon} size={16} />
          <span>
            <span className="primitive-announcement">{name}: </span>
            {status.formattedLabel ?? status.label}
          </span>
        </p>
        <PlanStateAnnouncement
          text={`${name}: ${status.label}`}
          locale={locale}
          dialogOpen={!!confirm}
        />
        {status.reason && <p className="plan-failure-reason">{status.reason}</p>}
        {(result || action || toggle || status.icon === "unplug") && (
          <div className="plan-row-actions">
            {result && (
              <a
                className="primitive-link"
                href={`#message-${result}`}
                onClick={(event) => {
                  event.preventDefault();
                  revealResult(result);
                }}
              >
                {message(locale, "plan.progress.goToResult")}
              </a>
            )}
            {status.icon === "unplug" &&
              onOpenConnections &&
              button(message(locale, "taskNotice.openConnections"), onOpenConnections)}
            {action &&
              button(
                action.label,
                () => {
                  if (!action.restart) {
                    void run(action.command);
                    return;
                  }
                  setConfirm({
                    action: action.command,
                    title: "taskNotice.confirmTitle",
                    body:
                      action.restart.kind === "subscription"
                        ? "taskNotice.confirm.subscription"
                        : "taskNotice.confirm.apiKey",
                    label: "taskNotice.startAgain",
                  });
                },
                !perform || action.disabled,
              )}
            {toggle}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <PlanStateAnnouncement
        text={stateLabel}
        suppress={sharedAttentionAnnouncement && plan.needsAttention}
        locale={locale}
        dialogOpen={!!confirm}
        initial={announceAcceptance}
      />
      <ul className="plan-rows">
        {plan.contributions.map((node) => {
          const shown = expanded.has(node.id);
          const toggle = (
            <button
              type="button"
              className="primitive-link plan-request-toggle"
              onClick={() => {
                setExpanded((previous) => {
                  const next = new Set(previous);
                  if (next.has(node.id)) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                });
              }}
            >
              {message(locale, shown ? "plan.progress.hideRequest" : "plan.progress.showRequest")}
            </button>
          );
          return (
            <li key={node.id} className="plan-row">
              {contributionHeading(node)}
              {row(
                contributionProgress(
                  node,
                  plan,
                  nodes,
                  locale,
                  pauses,
                  service(node.agentId, node.task),
                ),
                node.key,
                toggle,
              )}
              {shown && requestDetails(node)}
            </li>
          );
        })}
        <li className="plan-row">
          {synthesisHeading}
          {row(
            synthesisProgress(plan, locale, pauses, service("virgilio", plan.continuation?.task)),
            message(locale, "plan.synthesis"),
          )}
        </li>
      </ul>
      <p className="plan-meta">
        {message(locale, "plan.progress.requestsUsed", {
          n: plan.requestsUsed,
          max_requests: plan.maxRequests,
        })}
      </p>
      {(unfinished || plan.needsAttention) && (
        <div className="plan-row-actions">
          {plan.needsAttention &&
            button(
              message(locale, endLabel("finish")),
              () => {
                end("finish");
              },
              !perform,
            )}
          {unfinished &&
            button(
              message(locale, endLabel("cancel")),
              () => {
                end("cancel");
              },
              !perform,
            )}
        </div>
      )}
      <PlanNotice {...(feedback && !feedback.danger ? { notice: feedback } : {})} />
      {feedback?.danger && <PlanNotice notice={feedback} />}
      <Dialog
        open={!!confirm}
        title={confirm ? message(locale, confirm.title) : ""}
        descriptionId={dialogDescription}
        closeLabel={message(locale, "dialog.close")}
        closePlacement="footer"
        returnFocusRef={root}
        onClose={() => {
          setConfirm(undefined);
        }}
        footer={
          <button
            type="button"
            className="primitive-button primitive-primary"
            onClick={() => {
              if (confirm) void run(confirm.action);
            }}
          >
            {confirm ? message(locale, confirm.label) : ""}
          </button>
        }
      >
        <p id={dialogDescription}>{confirm ? message(locale, confirm.body) : ""}</p>
      </Dialog>
    </>
  );
}
