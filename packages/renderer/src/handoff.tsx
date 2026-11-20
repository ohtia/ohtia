import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  message,
  type ConversationBusyReason,
  type ConversationSummary,
  type HandoffSelectionMessage,
  type InterfaceLocale,
  type ReplyAgent,
  type TimelineHandoffProposal,
} from "@ohtia/contracts";
import { ActionProposalCard } from "./research-presentation.js";
import { ContributorSymbol, contributorNames, VoiceLabel } from "./contributor-identity.js";
import { LucideGlyph } from "./iconography.js";
import { Dialog } from "./layers.js";
import { conversationPreview } from "./message-markdown.js";
import type { ConversationController } from "./conversation-controller.js";
import "./handoff.css";

const virgilio = { kind: "ai", contributor: "virgilio", definitionVersion: "1" } as const;
const josefa = { kind: "ai", contributor: "josefa", definitionVersion: "1" } as const;
type ProposalAction = "accept" | "decline";
type Feedback =
  | ConversationBusyReason
  | "proposalChanged"
  | "returnChanged"
  | "selection"
  | "acceptFailed"
  | "declineFailed"
  | "returnFailed";

function HandoffFeedback({ feedback, locale }: { feedback: Feedback; locale: InterfaceLocale }) {
  const danger = feedback.endsWith("Failed");
  const changed = feedback === "proposalChanged" || feedback === "returnChanged";
  return (
    <div
      className={`conversation-notice handoff-feedback ${danger ? "danger" : "attention"}`}
      role={danger ? "alert" : "status"}
    >
      <LucideGlyph
        name={danger ? "octagon-alert" : changed ? "git-compare" : "triangle-alert"}
        size={16}
      />
      <span>{message(locale, `handoff.${feedback}`)}</span>
    </div>
  );
}

export function HandoffProposal({
  proposal,
  note,
  hasText,
  service,
  documentLanguage,
  controller,
  locale,
}: {
  proposal: TimelineHandoffProposal;
  note: string;
  hasText: boolean;
  service: string | undefined;
  documentLanguage: string | null | undefined;
  controller: Pick<ConversationController, "performHandoffAction">;
  locale: InterfaceLocale;
}) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  const intents = useRef(new Map<ProposalAction, string>());
  const root = useRef<HTMLDivElement>(null);
  const restore = useRef(false);
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
  async function decideProposal(action: ProposalAction) {
    if (active.current) return;
    active.current = true;
    restore.current = root.current?.contains(root.current.ownerDocument.activeElement) ?? false;
    setPending(true);
    setFeedback(null);
    const id = intents.current.get(action) ?? crypto.randomUUID();
    intents.current.set(action, id);
    try {
      const result = await controller.performHandoffAction(id, proposal, action);
      if (!result.ok) {
        const error = result.error;
        setFeedback(
          error.code === "conversation_busy"
            ? error.parameters.reason
            : error.code === "owner_changed" || error.code === "proposal_not_waiting"
              ? "proposalChanged"
              : action === "accept"
                ? "acceptFailed"
                : "declineFailed",
        );
      }
    } catch {
      setFeedback(action === "accept" ? "acceptFailed" : "declineFailed");
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  if (proposal.state === "invalid") {
    const reason = proposal.invalidReason;
    if (!reason) return null;
    const text =
      reason === "reason_too_long"
        ? message(locale, "handoff.invalid.reason_too_long", { max: 500 })
        : message(locale, `handoff.invalid.${reason}`);
    return (
      <div className="setup-invalid">
        {!hasText && <VoiceLabel identity={virgilio} locale={locale} />}
        <div className="conversation-notice attention" role="status">
          <LucideGlyph name="triangle-alert" size={16} />
          <span>
            {text} {message(locale, "handoff.invalid.nextReply")}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div ref={root} tabIndex={-1} className="handoff-proposal">
      <ActionProposalCard
        locale={locale}
        proposer={virgilio}
        showVoice={!hasText}
        title={message(locale, "handoff.title")}
        state={open ? "open" : proposal.state}
        stateLabel={
          open
            ? message(locale, "setup.waiting")
            : proposal.state === "replaced"
              ? message(locale, "consultation.replaced")
              : message(locale, `handoff.${proposal.state}`)
        }
        announceState
        recipient={
          <div className="consultation-recipient">
            <VoiceLabel identity={josefa} compact locale={locale} />
            {service && <span> · {service}</span>}
          </div>
        }
        sections={[
          {
            label: message(locale, "handoff.note"),
            value: { text: note, language: documentLanguage ?? "" },
            rendered: (
              <div className="handoff-quoted-note" lang={documentLanguage ?? ""} dir="auto">
                {note}
              </div>
            ),
          },
          {
            label: message(locale, "consultation.reason"),
            value: { text: proposal.reason ?? "", language: documentLanguage ?? "" },
          },
        ]}
        note={message(locale, "handoff.scope")}
        actions={[
          {
            label: message(locale, "handoff.accept"),
            primary: true,
            disabled: pending || !service,
            onPress: () => void decideProposal("accept"),
          },
          {
            label: message(locale, "handoff.decline"),
            disabled: pending,
            onPress: () => void decideProposal("decline"),
          },
        ]}
        {...(pending || !service
          ? {
              disabledReason: message(
                locale,
                pending ? "command.reason.busy" : "consultation.destinationUnavailable",
              ),
            }
          : {})}
        feedback={feedback && <HandoffFeedback feedback={feedback} locale={locale} />}
      />
    </div>
  );
}

export function HandoffDivider({ agent, locale }: { agent: ReplyAgent; locale: InterfaceLocale }) {
  return (
    <div className="handoff-divider">
      <span className="handoff-divider-line" aria-hidden="true" />
      <ContributorSymbol contributor={agent} size={16} />
      <span>{message(locale, "handoff.divider", { agent: contributorNames[agent] })}</span>
      <span className="handoff-divider-line" aria-hidden="true" />
    </div>
  );
}

type ReturnController = Pick<ConversationController, "listHandoffMessages" | "returnHandoff">;
export function HandoffReturnControl({
  conversation,
  controller,
  locale,
  focusAfter,
}: {
  conversation: ConversationSummary;
  controller: ReturnController;
  locale: InterfaceLocale;
  focusAfter?: React.RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const fallback = useRef<HTMLDivElement>(null);
  if (!open && conversation.agentId === "virgilio") return null;
  return (
    <div className="handoff-return-control" tabIndex={-1} ref={fallback}>
      {conversation.agentId === "josefa" && (
        <button
          type="button"
          className="primitive-button"
          onClick={() => {
            setOpen(true);
          }}
        >
          {message(locale, "handoff.return")}
        </button>
      )}
      {open && (
        <HandoffReturnDialog
          conversation={conversation}
          controller={controller}
          locale={locale}
          close={() => {
            setOpen(false);
          }}
          returnFocus={focusAfter ?? fallback}
        />
      )}
    </div>
  );
}

function HandoffReturnDialog({
  conversation,
  controller,
  locale,
  close,
  returnFocus,
}: {
  conversation: ConversationSummary;
  controller: ReturnController;
  locale: InterfaceLocale;
  close: () => void;
  returnFocus: React.RefObject<HTMLDivElement | null>;
}) {
  const description = useId();
  const all = useRef<HTMLInputElement>(null);
  const intent = useRef<{ id: string; selection: string; revision: number }>(null);
  const active = useRef(false);
  const [revision, setRevision] = useState(conversation.ownerRevision);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [page, setPage] = useState<{
    messages: HandoffSelectionMessage[];
    priorReply: boolean;
  } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    void controller.listHandoffMessages(conversation.id, revision, abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      setLoading(false);
      if (!result.ok) {
        setPage(null);
        setFeedback(result.error.code === "owner_changed" ? "returnChanged" : "selection");
        return;
      }
      setPage(result.value);
      const latest = result.value.messages.findLast(({ agentId }) => agentId === "josefa");
      setSelected(new Set(latest ? [latest.position] : []));
    });
    return () => {
      abort.abort();
    };
  }, [controller.listHandoffMessages, conversation.id, revision, reload]);
  useEffect(() => {
    if (
      feedback === "returnChanged" &&
      conversation.agentId === "josefa" &&
      conversation.ownerRevision !== revision
    ) {
      setLoading(true);
      setRevision(conversation.ownerRevision);
    }
  }, [feedback, conversation.agentId, conversation.ownerRevision, revision]);
  const messages = page?.messages ?? [];
  const checked = messages.length > 0 && selected.size === messages.length;
  const mixed = selected.size > 0 && !checked;
  useLayoutEffect(() => {
    if (all.current) all.current.indeterminate = mixed;
  }, [mixed, loading]);
  function toggle(position: number, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(position);
      else next.delete(position);
      return next;
    });
  }
  async function confirmReturn() {
    if (!page || loading || active.current) return;
    active.current = true;
    setPending(true);
    setFeedback(null);
    const selection = messages
      .filter(({ position }) => selected.has(position))
      .map(({ position }) => position)
      .join(",");
    const previous = intent.current;
    const id =
      previous?.selection === selection && previous.revision === revision
        ? previous.id
        : crypto.randomUUID();
    intent.current = { id, selection, revision };
    try {
      const result = await controller.returnHandoff(id, conversation.id, revision, selection);
      if (result.ok) close();
      else if (result.error.code === "selection_invalid") {
        setFeedback("selection");
        intent.current = null;
        setLoading(true);
        setReload((value) => value + 1);
      } else if (result.error.code === "owner_changed") {
        setPage(null);
        setFeedback("returnChanged");
      } else
        setFeedback(
          result.error.code === "conversation_busy"
            ? result.error.parameters.reason
            : "returnFailed",
        );
    } catch {
      setFeedback("returnFailed");
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      title={message(locale, "handoff.returnTitle")}
      descriptionId={description}
      onClose={close}
      closeLabel={message(locale, "dialog.close")}
      closePlacement="footer"
      initialFocus="close"
      returnFocusRef={returnFocus}
      className="command-dialog handoff-dialog"
      bodyClassName="command-dialog-body"
      footerClassName="actions command-dialog-footer handoff-dialog-footer"
      footer={
        <>
          <button
            type="button"
            className="primitive-button primitive-primary"
            aria-disabled={!page || pending || loading || undefined}
            onClick={() => void confirmReturn()}
          >
            {message(locale, "handoff.return")}
          </button>
          {feedback && <HandoffFeedback feedback={feedback} locale={locale} />}
        </>
      }
    >
      <p id={description}>
        {message(locale, page?.priorReply ? "handoff.returnPrior" : "handoff.returnNew")}
      </p>
      {loading && <p role="status">{message(locale, "plan.loading")}</p>}
      {page && !loading && (
        <>
          <label className="handoff-select-all">
            <input
              type="checkbox"
              ref={all}
              checked={checked}
              aria-checked={mixed ? "mixed" : checked}
              disabled={!messages.length || pending}
              onChange={(event) => {
                setSelected(
                  new Set(event.target.checked ? messages.map(({ position }) => position) : []),
                );
              }}
            />
            <span>{message(locale, "handoff.selectAll")}</span>
          </label>
          {!!messages.length && (
            <div className="handoff-selection" role="list">
              {messages.map(({ position, agentId, prefix, truncated }) => (
                <div key={position} role="listitem">
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(position)}
                      disabled={pending}
                      onChange={(event) => {
                        toggle(position, event.target.checked);
                      }}
                    />
                    <span>
                      <strong>
                        {agentId ? contributorNames[agentId] : message(locale, "conversation.you")}:
                      </strong>{" "}
                      <bdi>{conversationPreview(prefix, truncated)}</bdi>
                    </span>
                  </label>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
