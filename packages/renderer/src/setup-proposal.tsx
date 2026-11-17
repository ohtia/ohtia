import { message, type InterfaceLocale, type TimelineSetupProposal } from "@ohtia/contracts";
import { ActionProposalCard } from "./research-presentation.js";
import { VoiceLabel } from "./contributor-identity.js";
import { LucideGlyph } from "./iconography.js";
import type { ConversationController, ConversationState } from "./conversation-controller.js";

const identity = { kind: "ai", contributor: "virgilio", definitionVersion: "1" } as const;
export function SetupProposal({
  proposal,
  state,
  controller,
  locale,
  hasText,
}: {
  readonly proposal: TimelineSetupProposal;
  readonly state: ConversationState;
  readonly controller: Pick<ConversationController, "composer" | "performSetupAction">;
  readonly locale: InterfaceLocale;
  readonly hasText: boolean;
}) {
  const title =
    state.texts.get(`${proposal.id}/title`) ??
    (typeof proposal.title === "string" ? proposal.title : "");
  const language =
    state.texts.get(`${proposal.id}/language`) ??
    (typeof proposal.documentLanguage === "string" ? proposal.documentLanguage : "");
  const label = (key: import("@ohtia/contracts").SimpleMessageKey) => message(locale, key);
  if (proposal.state === "invalid") {
    const reason = proposal.invalidReason;
    const explanation =
      reason === "title_too_long"
        ? message(locale, "setup.invalid.title_too_long", { max: 200 })
        : reason === "language_malformed" || reason === "language_unknown"
          ? message(locale, `setup.invalid.${reason}`, { tag: language })
          : label(
              reason === "title_empty"
                ? "setup.invalid.title_empty"
                : reason === "title_whitespace"
                  ? "setup.invalid.title_whitespace"
                  : reason === "multiple_calls"
                    ? "setup.invalid.multiple_calls"
                    : "setup.invalid.title_invalid",
            );
    return (
      <div className="setup-invalid">
        {!hasText && <VoiceLabel identity={identity} locale={locale} />}
        <div className="conversation-notice attention" role="status">
          <LucideGlyph name="triangle-alert" size={16} />
          <span>
            {explanation} {label("setup.invalid.nextReply")}
          </span>
        </div>
      </div>
    );
  }
  const action = state.setupActions?.get(proposal.id);
  const error = action?.error;
  const uncertain =
    !!error &&
    ["uncertain", "timeout", "cancelled", "disposed", "invalid_service_result"].includes(error);
  const showFeedback =
    proposal.state === "proposed" ||
    (proposal.state === "replaced" && error === "proposal_not_waiting");
  const feedback =
    error && showFeedback
      ? uncertain
        ? label(action.action === "confirm" ? "setup.confirmUncertain" : "setup.rejectUncertain")
        : error === "proposal_not_waiting" && proposal.state === "replaced"
          ? label(action.action === "confirm" ? "setup.confirmReplaced" : "setup.rejectReplaced")
          : error === "setup_reply_active"
            ? label("setup.replyActive")
            : label(action.action === "confirm" ? "setup.confirmFailed" : "setup.rejectFailed")
      : "";
  const waiting =
    !!state.conversation?.runningTask ||
    state.items.some(
      (item) =>
        item.kind === "task" && ["queued", "blocked", "running", "cancelling"].includes(item.state),
    );
  let languageName = language;
  try {
    languageName = new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? language;
  } catch {
    /* Keep the recorded tag if no display name exists. */
  }
  return (
    <ActionProposalCard
      locale={locale}
      proposer={identity}
      showVoice={!hasText}
      title={label("setup.title")}
      state={
        proposal.state === "proposed"
          ? "open"
          : proposal.state === "confirmed"
            ? "accepted"
            : proposal.state === "rejected"
              ? "declined"
              : "replaced"
      }
      stateLabel={label(
        proposal.state === "proposed"
          ? "setup.waiting"
          : proposal.state === "confirmed"
            ? "setup.confirmed"
            : proposal.state === "rejected"
              ? "setup.rejected"
              : "setup.replaced",
      )}
      sections={[
        {
          label: label("setup.type"),
          value: { text: label("project.type.thesis"), language: locale },
        },
        { label: label("setup.proposedTitle"), value: { text: title, language } },
        {
          label: label("setup.language"),
          value: { text: `${languageName} · ${language}`, language: locale },
        },
      ]}
      note={label("setup.warning")}
      actions={[
        {
          label: label("setup.confirm"),
          primary: true,
          disabled: waiting || !!action?.busy,
          onPress: () => {
            void controller.performSetupAction(proposal, "confirm");
          },
        },
        {
          label: label("setup.correct"),
          disabled: !!action?.busy,
          onPress: () => {
            controller.composer.correct(proposal.id);
          },
        },
        {
          label: label("setup.reject"),
          disabled: !!action?.busy,
          onPress: () => {
            void controller.performSetupAction(proposal, "reject");
          },
        },
      ]}
      {...(waiting || action?.busy
        ? { disabledReason: label(waiting ? "setup.waitForReply" : "command.reason.busy") }
        : {})}
      feedback={
        feedback ? (
          <div
            className={`conversation-notice ${uncertain ? "attention" : "danger"}`}
            role={uncertain ? "status" : "alert"}
          >
            <LucideGlyph name={uncertain ? "triangle-alert" : "octagon-alert"} size={16} />
            <span>{feedback}</span>
          </div>
        ) : undefined
      }
    />
  );
}
