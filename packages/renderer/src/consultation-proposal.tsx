import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  message,
  type CommandBridge,
  type InterfaceLocale,
  type TimelineConsultation,
} from "@ohtia/contracts";
import { ActionProposalCard, MessageMarkdown } from "./research-presentation.js";
import { VoiceLabel } from "./contributor-identity.js";
import { LucideGlyph } from "./iconography.js";
import type { ConversationController } from "./conversation-controller.js";

const virgilio = { kind: "ai", contributor: "virgilio", definitionVersion: "1" } as const;
const josefa = { kind: "ai", contributor: "josefa", definitionVersion: "1" } as const;
type Action = "accept" | "decline";

export function ConsultationProposal({
  proposal,
  request,
  destination,
  controller,
  locale,
  hasText,
  openExternalLink,
}: {
  readonly proposal: TimelineConsultation;
  readonly request: string;
  readonly destination: string | null | undefined;
  readonly controller: Pick<
    ConversationController,
    "performConsultationAction" | "observeConsultationDestination" | "connections"
  >;
  readonly locale: InterfaceLocale;
  readonly hasText: boolean;
  readonly openExternalLink: CommandBridge["openExternalLink"];
}) {
  const open = proposal.state === "proposed";
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<
    "destinationChanged" | "unfinished" | "acceptFailed" | "declineFailed" | null
  >(null);
  const intents = useRef(new Map<Action, { id: string; connection: string | undefined }>());
  const root = useRef<HTMLDivElement>(null);
  const previousService = useRef<string | null | undefined>(undefined);
  const active = useRef(false);
  const restore = useRef(false);
  useEffect(() => {
    if (open) return controller.observeConsultationDestination();
  }, [open, controller.observeConsultationDestination]);
  useLayoutEffect(() => {
    if (!open && restore.current && document.activeElement === document.body)
      root.current?.focus({ preventScroll: true });
    if (!open) restore.current = false;
  }, [open]);
  useEffect(() => {
    if (open && destination) previousService.current = destination;
  }, [open, destination]);

  const connection = open ? destination : (proposal.connection ?? previousService.current);
  const service = controller.connections.find(({ id }) => id === connection);
  const destinationUnavailable = open && destination !== undefined && !service;
  async function decide(action: Action) {
    if (active.current) return;
    active.current = true;
    restore.current = root.current?.contains(document.activeElement) ?? false;
    setBusy(true);
    setFeedback(null);
    const old = intents.current.get(action);
    const selected = action === "accept" ? service?.id : undefined;
    const intent =
      old?.connection === selected && old ? old : { id: crypto.randomUUID(), connection: selected };
    intents.current.set(action, intent);
    try {
      const result = await controller.performConsultationAction(
        intent.id,
        proposal,
        action,
        intent.connection,
      );
      if (result.ok || result.error.code === "proposal_not_waiting") {
        intents.current.clear();
        return;
      }
      setFeedback(
        result.error.code === "destination_changed"
          ? "destinationChanged"
          : result.error.code === "consultation_unfinished"
            ? "unfinished"
            : action === "accept"
              ? "acceptFailed"
              : "declineFailed",
      );
    } catch {
      setFeedback(action === "accept" ? "acceptFailed" : "declineFailed");
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  if (proposal.state === "invalid") {
    const reason = proposal.invalidReason;
    if (!reason) return null;
    const explanation =
      reason === "reason_too_long"
        ? message(locale, "consultation.invalid.reason_too_long", { max: 500 })
        : message(locale, `consultation.invalid.${reason}`);
    return (
      <div className="setup-invalid">
        {!hasText && <VoiceLabel identity={virgilio} locale={locale} />}
        <div className="conversation-notice attention" role="status">
          <LucideGlyph name="triangle-alert" size={16} />
          <span>
            {message(locale, "consultation.invalid")} {explanation}{" "}
            {message(locale, "consultation.invalid.nextReply")}
          </span>
        </div>
      </div>
    );
  }

  const warning = feedback === "destinationChanged" || feedback === "unfinished";
  const language = proposal.language ?? "";
  return (
    <div ref={root} tabIndex={-1} className="consultation-proposal">
      <ActionProposalCard
        locale={locale}
        proposer={virgilio}
        showVoice={!hasText}
        title={message(locale, "consultation.title")}
        state={proposal.state === "proposed" ? "open" : proposal.state}
        stateLabel={
          proposal.state === "proposed"
            ? message(locale, "setup.waiting")
            : message(locale, `consultation.${proposal.state}`)
        }
        recipient={
          <div className="consultation-recipient">
            <VoiceLabel identity={josefa} compact locale={locale} />
            {service && <span> · {service.displayName}</span>}
          </div>
        }
        sections={[
          {
            label: message(locale, "consultation.request"),
            value: { text: request, language },
            rendered: (
              <div className="consultation-request" lang={language} dir="auto">
                <MessageMarkdown
                  text={request}
                  locale={locale}
                  language={proposal.language ?? undefined}
                  openExternalLink={openExternalLink}
                />
              </div>
            ),
          },
          {
            label: message(locale, "consultation.reason"),
            value: { text: proposal.reason ?? "", language },
          },
        ]}
        note={message(locale, "consultation.scope")}
        actions={[
          {
            label: message(locale, "consultation.ask"),
            primary: true,
            disabled: busy || !service,
            onPress: () => {
              void decide("accept");
            },
          },
          {
            label: message(locale, "consultation.decline"),
            disabled: busy,
            onPress: () => {
              void decide("decline");
            },
          },
        ]}
        {...(busy || destinationUnavailable
          ? {
              disabledReason: message(
                locale,
                busy ? "command.reason.busy" : "consultation.destinationUnavailable",
              ),
            }
          : {})}
        feedback={
          open &&
          feedback && (
            <div
              className={`conversation-notice ${warning ? "attention" : "danger"}`}
              role={warning ? "status" : "alert"}
            >
              <LucideGlyph name={warning ? "triangle-alert" : "octagon-alert"} size={16} />
              <span>{message(locale, `consultation.${feedback}`)}</span>
            </div>
          )
        }
      />
    </div>
  );
}
