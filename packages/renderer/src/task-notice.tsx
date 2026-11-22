import { useEffect, useRef, useState } from "react";
import {
  message,
  formatNumber,
  projectLinks,
  type InterfaceLocale,
  type TimelineTask,
  type PlanTaskProgress,
  type ProviderDeclaration,
  type PauseCounts,
  type CommandBridge,
} from "@ohtia/contracts";
import { useReplyDetails, type DetailsSource } from "./reply-details.js";
import { contributorNames, VoiceLabel } from "./contributor-identity.js";
import { LucideGlyph } from "./iconography.js";
import { Dialog } from "./layers.js";
import type { ConversationController, TaskAction } from "./conversation-controller.js";

export interface TaskNoticeContent {
  readonly text: string;
  readonly tone: "status" | "attention" | "danger";
  readonly role: "status" | "alert";
  readonly usage?: string;
}
export function formatOperationDuration(locale: InterfaceLocale, milliseconds: number): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "minute",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  }).format(milliseconds / 60000);
}

export function taskNoticeContent(
  task: TimelineTask,
  locale: InterfaceLocale,
  connection: ProviderDeclaration["connection"],
  hasText: boolean,
  runningAgent: string | undefined,
): TaskNoticeContent | null {
  const service = connection.displayName;
  const agent = contributorNames[task.agentId];
  const text = (key: "stopping" | "stopped" | "stoppedBefore" | "restart" | "partialStopped") =>
    message(locale, `taskNotice.${key}`);
  const status = (value: string): TaskNoticeContent => ({
    text: value,
    tone: "status",
    role: "status",
  });
  if (task.state === "completed" || (task.state === "cancelled" && task.superseded)) return null;
  if (task.state === "queued")
    return status(
      runningAgent
        ? message(locale, "taskNotice.waitingAgent", { running_agent: runningAgent })
        : task.waitingForModels
          ? message(locale, "taskNotice.modelsLoading", { service })
          : task.waitingLimit !== null
            ? message(locale, "taskNotice.waitingLimit", { running_limit: task.waitingLimit })
            : message(locale, "taskNotice.waiting"),
    );
  if (task.state === "running")
    return hasText ? null : status(message(locale, "taskNotice.replying", { service }));
  if (task.state === "cancelling") return status(text("stopping"));
  if (task.state === "blocked") {
    if (task.blockingReason === "connection_disabled")
      return status(message(locale, "taskNotice.disconnected", { service, agent }));
    if (task.blockingReason === "restart_paused") return status(text("restart"));
  }
  if (task.blockingReason === "usage_limit_reached" || task.outcomeReason === "usage_limit_reached")
    return {
      text: message(
        locale,
        connection.kind === "subscription"
          ? "taskNotice.usage.subscription"
          : "taskNotice.usage.apiKey",
        { service },
      ),
      tone: "attention",
      role: "alert",
    };
  if (task.state === "uncertain")
    return {
      text: message(
        locale,
        connection.kind === "subscription"
          ? "taskNotice.uncertain.subscription"
          : "taskNotice.uncertain.apiKey",
        { service },
      ),
      tone: "attention",
      role: "alert",
    };
  if (task.state === "cancelled")
    return {
      ...status(
        hasText ? text("partialStopped") : text(task.dispatched ? "stopped" : "stoppedBefore"),
      ),
      ...(task.dispatched ? { usage: message(locale, "taskNotice.stopUsage", { service }) } : {}),
    };
  if (task.state !== "failed") return null;
  return failedTaskContent(task, locale, connection, hasText);
}

export function failedTaskContent(
  task: PlanTaskProgress & Pick<TimelineTask, "synthesis">,
  locale: InterfaceLocale,
  connection: ProviderDeclaration["connection"],
  hasText: boolean,
): TaskNoticeContent {
  const service = connection.displayName;
  const agent = contributorNames[task.agentId];
  const limit = formatOperationDuration(locale, task.maxAttemptDurationMs);
  const inactivity = formatOperationDuration(locale, task.maxInactivityMs);
  if (task.blockingReason === "usage_limit_reached" || task.outcomeReason === "usage_limit_reached")
    return {
      text: message(
        locale,
        connection.kind === "subscription"
          ? "taskNotice.usage.subscription"
          : "taskNotice.usage.apiKey",
        { service },
      ),
      tone: "attention",
      role: "alert",
    };
  if (task.synthesis && task.outcomeReason === "input_too_large")
    return { text: message(locale, "synthesis.inputTooLarge"), tone: "danger", role: "alert" };
  if (
    hasText &&
    [
      "deadline_exceeded",
      "inactivity_timeout",
      "output_limit_exceeded",
      "invalid_output",
      "provider_error",
      "provider_unavailable",
      "connection_lost",
    ].includes(task.outcomeReason ?? "")
  ) {
    const partial =
      task.outcomeReason === "deadline_exceeded"
        ? message(locale, "taskNotice.partialDeadline")
        : task.outcomeReason === "inactivity_timeout"
          ? message(locale, "taskNotice.partialInactivity", { inactivity })
          : task.outcomeReason === "output_limit_exceeded"
            ? message(locale, "taskNotice.partialLength")
            : task.outcomeReason === "invalid_output"
              ? message(locale, "taskNotice.partialInvalid")
              : ["provider_error", "provider_unavailable"].includes(task.outcomeReason ?? "")
                ? message(locale, "taskNotice.partialProvider", { service })
                : message(locale, "taskNotice.partialLost");
    return { text: partial, tone: "status", role: "status" };
  }
  const reason = task.outcomeReason;
  const failed =
    reason === "not_eligible"
      ? message(
          locale,
          connection.kind === "subscription"
            ? "taskNotice.notEligible.subscription"
            : "taskNotice.notEligible.apiKey",
          { service },
        )
      : reason === "connection_expired"
        ? message(
            locale,
            connection.kind === "subscription"
              ? "taskNotice.expired.subscription"
              : "taskNotice.expired.apiKey",
            { service },
          )
        : reason === "empty_reply"
          ? message(locale, "taskNotice.empty", { agent })
          : reason === "deadline_exceeded"
            ? message(locale, "taskNotice.deadline", { limit })
            : reason === "inactivity_timeout"
              ? message(locale, "taskNotice.inactivity", { service, inactivity })
              : reason === "output_limit_exceeded"
                ? message(locale, "taskNotice.outputLimit")
                : reason === "service_restarted" || reason === "permit_expired"
                  ? message(locale, "taskNotice.attempts")
                  : message(
                      locale,
                      reason === "provider_unavailable"
                        ? "taskNotice.providerUnavailable"
                        : reason === "request_rejected"
                          ? "taskNotice.rejected"
                          : reason === "invalid_output"
                            ? "taskNotice.invalid"
                            : "taskNotice.providerError",
                      { service },
                    );
  return { text: failed, tone: "danger", role: "alert" };
}

export function TaskNotice({
  task,
  locale,
  connection,
  hasText,
  details,
  latest,
  setupFinal = false,
  previousOwner,
  runningAgent,

  pauses,
  controller,
  commands,
  onOpenConnections,
  announce,
}: {
  readonly task: TimelineTask;
  readonly locale: InterfaceLocale;
  readonly connection: ProviderDeclaration["connection"];
  readonly hasText: boolean;
  readonly details?: DetailsSource | undefined;
  readonly latest: boolean;
  readonly setupFinal?: boolean;
  readonly previousOwner?: TimelineTask["agentId"] | undefined;
  readonly runningAgent?: string | undefined;

  readonly pauses?: PauseCounts;
  readonly controller: Pick<ConversationController, "performTaskAction">;
  readonly commands: Pick<CommandBridge, "openLink">;
  readonly onOpenConnections?: () => void;
  readonly announce?: (signature: string) => boolean;
}) {
  const disclosure = useReplyDetails(locale, details);
  const content = taskNoticeContent(task, locale, connection, hasText, runningAgent);
  const handoff =
    previousOwner && (task.state === "failed" || task.state === "uncertain")
      ? message(locale, "handoff.previousReply", {
          agent: contributorNames[task.agentId],
          new_agent: contributorNames[previousOwner],
        })
      : undefined;
  const [announcement, setAnnouncement] = useState({
    text: "",
    role: "status" as "status" | "alert",
    locale,
    signature: "",
  });
  const localAnnouncement = useRef<string | null>(null);
  const signature = content
    ? JSON.stringify([
        task.revision,
        task.state,
        task.outcomeReason,
        task.blockingReason,
        task.waitingForModels,
        task.waitingLimit,
        hasText,
        runningAgent ?? "",
        previousOwner ?? "",
      ])
    : "";
  const announcementText = content
    ? [content.text, content.usage, handoff].filter(Boolean).join(" ")
    : "";
  useEffect(() => {
    if (!signature || localAnnouncement.current === signature) return;
    localAnnouncement.current = signature;
    if (announce && !announce(signature)) return;
    setAnnouncement({ text: announcementText, role: content?.role ?? "status", locale, signature });
  }, [signature, announcementText, announce, content?.role, locale]);
  useEffect(() => {
    if (!announcement.text) return;
    if (announcement.locale !== locale || announcement.signature !== signature) {
      setAnnouncement((current) =>
        current.locale !== locale || current.signature !== signature
          ? { ...current, text: "" }
          : current,
      );
      return;
    }
    // The persistent notice remains visible; only its live announcement copy expires.
    const timer = setTimeout(() => {
      setAnnouncement((current) => (current === announcement ? { ...current, text: "" } : current));
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [announcement, locale, signature]);
  const announcing =
    !!announcement.text && announcement.locale === locale && announcement.signature === signature;
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (setupFinal) setConfirm(false);
  }, [setupFinal]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<
    | "newer"
    | "pendingLimit"
    | "synthesisLimit"
    | "planUnfinished"
    | "consultationLimit"
    | "consultationDestination"
    | "consultationUnfinished"
    | "actionFailed"
    | "actionUncertain"
    | null
  >(null);
  const active = useRef(false);
  const intents = useRef(new Map<TaskAction, string>());
  const alive = useRef(true);
  const restartButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(action: TaskAction) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setFeedback(null);
    const id = intents.current.get(action) ?? crypto.randomUUID();
    intents.current.set(action, id);
    let result;
    try {
      result = await controller.performTaskAction(id, action, task);
    } catch {
      result = { ok: false as const, error: { code: "invalid_service_result" } };
    }
    active.current = false;
    if (!alive.current) return;
    setPending(false);
    if (
      result.ok ||
      [
        "newer_task_exists",
        "pending_limit_reached",
        "limit_reached",
        "plan_unfinished",
        "destination_changed",
        "task_not_retryable",
        "record_not_found",
      ].includes(result.error.code)
    )
      intents.current.delete(action);
    if (!result.ok)
      setFeedback(
        result.error.code === "newer_task_exists"
          ? "newer"
          : result.error.code === "plan_unfinished"
            ? "planUnfinished"
            : result.error.code === "limit_reached" && task.consultation
              ? "consultationLimit"
              : result.error.code === "destination_changed" && task.consultation
                ? "consultationDestination"
                : result.error.code === "limit_reached" && task.synthesis
                  ? "synthesisLimit"
                  : result.error.code === "consultation_unfinished"
                    ? "consultationUnfinished"
                    : result.error.code === "pending_limit_reached"
                      ? "pendingLimit"
                      : [
                            "uncertain",
                            "timeout",
                            "cancelled",
                            "disposed",
                            "invalid_service_result",
                          ].includes(result.error.code)
                        ? "actionUncertain"
                        : "actionFailed",
      );
  }
  if (!content) return null;
  const usage =
    task.blockingReason === "usage_limit_reached" || task.outcomeReason === "usage_limit_reached";
  const retryableFailure =
    latest &&
    task.state === "failed" &&
    !["not_eligible", "input_too_large"].includes(task.outcomeReason ?? "");
  const fits = !task.consultation || task.consultationRetryFits === true;
  const retry = !handoff && !setupFinal && fits && retryableFailure;
  const restart = !handoff && !setupFinal && fits && latest && task.state === "uncertain";
  const resume = usage && (task.state === "blocked" || retryableFailure);
  const count = pauses
    ? (pauses.usage.find((p) => p.connection === task.connection)?.count ?? 0)
    : undefined;
  const openConnections =
    task.blockingReason === "connection_disabled" ||
    ["connection_expired", "not_eligible"].includes(task.outcomeReason ?? "");
  const button = (action: TaskAction, label: string, disabled = false) => (
    <button
      type="button"
      className="primitive-button"
      aria-disabled={pending || disabled || undefined}
      onClick={() => {
        if (!pending && !disabled) void run(action);
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="task-notice" lang={locale} dir="auto">
      {!hasText && (
        <VoiceLabel
          identity={{ kind: "ai", contributor: task.agentId, definitionVersion: "1" }}
          locale={locale}
        />
      )}
      {task.synthesis && !hasText && (
        <p className="consultation-caption">{message(locale, "synthesis.caption")}</p>
      )}
      <div
        className="primitive-announcement"
        data-task-notice-announcement
        role="status"
        lang={announcement.locale}
        aria-atomic="true"
      >
        {announcing && announcement.role === "status" ? announcement.text : ""}
      </div>
      <div
        className="primitive-announcement"
        data-task-notice-announcement
        role="alert"
        lang={announcement.locale}
        aria-atomic="true"
      >
        {announcing && announcement.role === "alert" ? announcement.text : ""}
      </div>
      <div className={`conversation-notice ${content.tone}`} aria-hidden={announcing || undefined}>
        <LucideGlyph
          name={
            content.tone === "status"
              ? "info"
              : content.tone === "attention"
                ? "triangle-alert"
                : "octagon-alert"
          }
          size={16}
        />
        <span>
          {content.text}
          {content.usage && <span className="task-usage">{content.usage}</span>}
          {handoff && <span className="task-usage">{handoff}</span>}
        </span>
      </div>
      <div className="task-notice-actions">
        {usage && connection.usageUrl && (
          <a
            className="primitive-link"
            href={connection.usageUrl}
            onClick={(event) => {
              event.preventDefault();
              const destination = Object.entries(projectLinks).find(
                ([, url]) => url === connection.usageUrl,
              );
              if (destination) void commands.openLink(destination[0] as keyof typeof projectLinks);
            }}
          >
            {message(locale, "taskNotice.checkUsage")}{" "}
            <span role="img" aria-label={message(locale, "conversation.opensInBrowser")}>
              <LucideGlyph name="external-link" size={16} />
            </span>
          </a>
        )}
        {openConnections && (
          <button type="button" className="primitive-button" onClick={onOpenConnections}>
            {message(locale, "taskNotice.openConnections")}
          </button>
        )}
        {resume &&
          button(
            "resume",
            message(locale, "taskNotice.resume", {
              service: connection.displayName,
              n: count === undefined ? "—" : formatNumber(locale, count),
            }),
            count === undefined,
          )}
        {task.blockingReason === "restart_paused" &&
          button(
            "continue",
            message(locale, "taskNotice.continue", {
              n: pauses === undefined ? "—" : formatNumber(locale, pauses.restart),
            }),
            pauses === undefined,
          )}
        {retry && button("retry", message(locale, "taskNotice.tryAgain"))}
        {restart && (
          <button
            ref={restartButton}
            type="button"
            className="primitive-button"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) {
                if (intents.current.has("restart")) void run("restart");
                else setConfirm(true);
              }
            }}
          >
            {message(locale, "taskNotice.startAgain")}
          </button>
        )}
        {disclosure.button}
      </div>
      {disclosure.panel}
      {feedback && (
        <div
          className={`conversation-notice ${feedback === "actionFailed" ? "danger" : "attention"}`}
          role={feedback === "actionFailed" ? "alert" : "status"}
        >
          <LucideGlyph
            name={feedback === "actionFailed" ? "octagon-alert" : "triangle-alert"}
            size={16}
          />
          <span>
            {feedback === "planUnfinished"
              ? message(locale, "plan.unfinished")
              : feedback === "consultationLimit"
                ? message(locale, "plan.consultationLimit")
                : feedback === "consultationDestination"
                  ? message(locale, "plan.consultationDestination", {
                      service: connection.displayName,
                    })
                  : feedback === "consultationUnfinished"
                    ? message(locale, "consultation.retryUnfinished")
                    : feedback === "synthesisLimit"
                      ? message(locale, "synthesis.limitReached")
                      : message(locale, `taskNotice.${feedback}`)}
          </span>
        </div>
      )}
      {(restart || confirm) && (
        <Dialog
          open={confirm}
          title={message(locale, "taskNotice.confirmTitle")}
          closeLabel={message(locale, "dialog.close")}
          closePlacement="footer"
          returnFocusRef={restartButton}
          onClose={() => {
            setConfirm(false);
          }}
          footer={
            <button
              type="button"
              className="primitive-button primitive-primary"
              onClick={() => {
                setConfirm(false);
                void run("restart");
              }}
            >
              {message(locale, "taskNotice.startAgain")}
            </button>
          }
        >
          <p>
            {message(
              locale,
              connection.kind === "subscription"
                ? "taskNotice.confirm.subscription"
                : "taskNotice.confirm.apiKey",
            )}
          </p>
        </Dialog>
      )}
    </div>
  );
}
