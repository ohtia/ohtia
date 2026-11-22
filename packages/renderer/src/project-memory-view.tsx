import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type SubmitEvent,
} from "react";
import {
  failure,
  formatDate,
  formatNumber,
  memoryByteLimit,
  memoryEntryLimit,
  memoryKinds,
  memoryTextLimit,
  message,
  utf8Size,
  type ErrorCode,
  type FoundationPort,
  type InterfaceLocale,
  type MemoryEntry,
  type MemoryKind,
  type MemoryHistory,
  type Outcome,
  type MemoryPage,
  type MemoryVersion,
  type PortText,
} from "@ohtia/contracts";
import type { ConversationController } from "./conversation-controller.js";
import { ContributorSymbol } from "./contributor-identity.js";
import { LucideGlyph } from "./iconography.js";
import { Dialog } from "./layers.js";
import { conversationPreview } from "./message-markdown.js";
import { stagedCommand } from "./staged-command.js";
import "./project-memory.css";

type MemoryPort = Pick<
  FoundationPort,
  | "listMemory"
  | "readMemoryHistory"
  | "readTextPart"
  | "sendTextPart"
  | "addMemory"
  | "editMemory"
  | "withdrawMemory"
>;
type Entry = Omit<MemoryEntry, "text"> & { readonly text: string };
type Version = Omit<MemoryVersion, "text"> & { readonly text: string };
export interface MemoryDraftSource {
  readonly messageId: string;
  readonly researcherText?: string;
}

interface Draft {
  readonly kind: MemoryKind;
  readonly text: string;
  readonly source?: MemoryDraftSource;
  readonly entry?: {
    readonly id: string;
    readonly version: number;
    readonly text: string;
    readonly kind: MemoryKind;
  };
  readonly notice?: "excess" | "empty" | "full" | "conflict" | "uncertain" | "failed" | undefined;
  readonly intent?: string | undefined;
}

interface DraftSnapshot {
  readonly draft: Draft | undefined;
  readonly saving: boolean;
  readonly handledSequence?: number;
}
interface ProjectDrafts {
  readonly drafts: Map<string, Draft>;
  active: DraftSnapshot;
}
const emptyDraft: DraftSnapshot = { draft: undefined, saving: false };

function draftKey(draft: Draft): string {
  if (draft.entry) return `entry/${draft.entry.id}`;
  return draft.source ? `source/${draft.source.messageId}` : "new";
}

export class ProjectMemoryDrafts {
  private readonly projects = new Map<string, ProjectDrafts>();
  private readonly listeners = new Set<() => void>();

  snapshot(projectId: string): DraftSnapshot {
    return this.projects.get(projectId)?.active ?? emptyDraft;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  open(projectId: string, draft: Draft, sequence?: number): void {
    const project = this.projects.get(projectId) ?? {
      drafts: new Map<string, Draft>(),
      active: emptyDraft,
    };
    if (project.active.saving) return;
    this.projects.set(projectId, project);
    const cached = project.drafts.get(draftKey(draft));
    const value =
      cached &&
      (!cached.entry ||
        cached.intent ||
        cached.notice === "conflict" ||
        cached.kind !== cached.entry.kind ||
        cached.text !== cached.entry.text)
        ? cached
        : draft;
    project.drafts.set(draftKey(draft), value);
    project.active = {
      ...project.active,
      draft: value,
      ...(sequence !== undefined ? { handledSequence: sequence } : {}),
    };
    this.publish();
  }

  update(projectId: string, draft: Draft | undefined, saving = false): void {
    const project = this.projects.get(projectId);
    if (!project?.active.draft) return;
    const key = draftKey(project.active.draft);
    if (draft) project.drafts.set(key, draft);
    else project.drafts.delete(key);
    project.active = { ...project.active, draft, saving };
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}

function uncertainWrite(code: ErrorCode): boolean {
  return ["uncertain", "timeout", "cancelled", "disposed", "invalid_service_result"].includes(code);
}

function freshDraft(source?: MemoryDraftSource): Draft {
  const text = source?.researcherText;
  return text !== undefined && Array.from(text).length <= memoryTextLimit
    ? { kind: "decision", text, ...(source ? { source } : {}) }
    : { kind: "note", text: "", ...(source ? { source } : {}) };
}

async function readText(port: MemoryPort, content: PortText, signal: AbortSignal): Promise<string> {
  if (typeof content === "string") return content;
  let text = "";
  for (let index = 1; index <= content.parts; index++) {
    if (signal.aborted) throw signal.reason;
    const part = await port.readTextPart({ source: content.source, index }).result;
    if (!part.ok) throw new Error("Memory text part unavailable.");
    text += part.value.text;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (utf8Size(text) !== content.bytes || sha256 !== content.sha256)
    throw new Error("Memory text integrity could not be verified.");
  return text;
}

async function readList(port: MemoryPort, projectId: string, signal: AbortSignal) {
  let after: string | null = null;
  let summary: MemoryPage | undefined;
  const entries: Entry[] = [];
  do {
    if (signal.aborted) throw signal.reason;
    const page: Outcome<MemoryPage> = await port.listMemory({ projectId, after }).result;
    if (!page.ok) throw new Error("Project memory unavailable.");
    if (summary && summary.revision !== page.value.revision) return null;
    summary = page.value;
    for (const entry of page.value.entries)
      entries.push({ ...entry, text: await readText(port, entry.text, signal) });
    after = page.value.next;
  } while (after);
  return { revision: summary.revision, active: summary.active, bytes: summary.bytes, entries };
}

async function readHistory(
  port: MemoryPort,
  projectId: string,
  entryId: string,
  signal: AbortSignal,
) {
  let before: number | null = null;
  const versions: Version[] = [];
  do {
    if (signal.aborted) throw signal.reason;
    const page: Outcome<MemoryHistory> = await port.readMemoryHistory({
      projectId,
      entryId,
      before,
    }).result;
    if (!page.ok) throw new Error("Memory history unavailable.");
    for (const version of page.value.versions)
      versions.push({ ...version, text: await readText(port, version.text, signal) });
    before = page.value.next;
  } while (before);
  return versions;
}

function Notice({
  children,
  danger = false,
  conflict = false,
  id,
}: {
  readonly children: string;
  readonly danger?: boolean;
  readonly conflict?: boolean;
  readonly id?: string;
}) {
  return (
    <div
      id={id}
      className={`conversation-notice ${danger ? "danger" : "attention"}`}
      role={danger ? "alert" : "status"}
    >
      <LucideGlyph
        name={danger ? "octagon-alert" : conflict ? "git-compare" : "triangle-alert"}
        size={16}
      />
      <span>{children}</span>
    </div>
  );
}

function MemoryAttribution({
  locale,
  version,
  originalAuthor,
}: {
  readonly locale: InterfaceLocale;
  readonly version: Version;
  readonly originalAuthor?: MemoryEntry["originalAuthor"];
}) {
  const attributedToAgent = originalAuthor === "virgilio" || version.author === "virgilio";
  const author = !attributedToAgent
    ? "memory.writtenByYou"
    : version.author === "researcher"
      ? "memory.editedByYou"
      : originalAuthor && (version.kind === "goal" || version.kind === "decision")
        ? "memory.wordedByVirgilio"
        : "memory.recordedByVirgilio";
  const date = formatDate(locale, new Date(version.date), { dateStyle: "medium" });
  const change =
    version.change === "undone"
      ? version.state === "withdrawn"
        ? "memory.change.undoneWithdrawn"
        : "memory.change.undoneRestored"
      : (`memory.change.${version.change}` as const);
  return (
    <p className="memory-attribution" data-type="type.ui.caption">
      {!originalAuthor && (
        <>
          <strong>{message(locale, change)}</strong>
          {" · "}
        </>
      )}
      <span className={attributedToAgent ? "memory-agent-author" : undefined}>
        {attributedToAgent && <ContributorSymbol contributor="virgilio" size={16} />}
        {message(locale, "memory.authorDate", { author: message(locale, author), date })}
      </span>
    </p>
  );
}

function EntryHistory({
  entryId,
  projectId,
  locale,
  port,
  epoch,
}: {
  readonly entryId: string;
  readonly projectId: string;
  readonly locale: InterfaceLocale;
  readonly port: MemoryPort;
  readonly epoch: number;
}) {
  const [versions, setVersions] = useState<readonly Version[]>();
  const [failed, setFailed] = useState(false);
  const [retry, reload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readHistory(port, projectId, entryId, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setVersions(value);
        setFailed(false);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => {
      controller.abort();
    };
  }, [entryId, epoch, port, projectId, retry]);
  if (failed)
    return (
      <div className="memory-state">
        <Notice danger>{message(locale, "memory.historyFailed")}</Notice>
        <button
          type="button"
          className="primitive-button"
          onClick={() => {
            setFailed(false);
            setVersions(undefined);
            reload((previous) => previous + 1);
          }}
        >
          {message(locale, "memory.reloadHistory")}
        </button>
      </div>
    );
  if (!versions)
    return (
      <p aria-busy="true" role="status">
        {message(locale, "plan.loading")}
      </p>
    );
  return (
    <ol className="memory-history">
      {versions.map((version) => (
        <li key={version.number}>
          <MemoryAttribution locale={locale} version={version} />
          <p className="memory-text" lang="" dir="auto">
            {version.text}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function ProjectMemoryView({
  projectId,
  locale,
  port,
  observe,
  draftRequest,
  drafts,
  goToMessage,
}: {
  readonly projectId: string;
  readonly locale: InterfaceLocale;
  readonly port: MemoryPort;
  readonly observe: ConversationController["observe"];
  readonly draftRequest:
    { readonly sequence: number; readonly source?: MemoryDraftSource } | undefined;
  readonly drafts: ProjectMemoryDrafts;
  readonly goToMessage: (source: NonNullable<MemoryEntry["source"]>) => void;
}) {
  const [memory, setMemory] = useState<NonNullable<Awaited<ReturnType<typeof readList>>>>();
  const revision = useRef<number | undefined>(undefined);
  const [epoch, setEpoch] = useState(0);
  const refresh = () => {
    setEpoch((value) => value + 1);
  };
  const [failed, setFailed] = useState(false);
  const { draft, saving, handledSequence } = useSyncExternalStore(drafts.subscribe, () =>
    drafts.snapshot(projectId),
  );
  function setDraft(value: Draft | undefined) {
    drafts.update(projectId, value);
  }
  const [withdrawal, setWithdrawal] = useState<{
    readonly id: string;
    readonly version: number;
    readonly intent: string;
  }>();
  const [withdrawNotice, setWithdrawNotice] = useState<"conflict" | "failed" | "uncertain">();
  const [withdrawing, setWithdrawing] = useState(false);
  const withdrawalPending = useRef(false);
  const busy = saving || withdrawing;
  const add = useRef<HTMLButtonElement>(null);
  const withdrawReturn = useRef<HTMLElement | null>(null);
  const textField = useRef<HTMLTextAreaElement>(null);
  const noticeId = useId();
  const descriptionId = useId();
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [histories, setHistories] = useState<ReadonlySet<string>>(() => new Set());
  const focusDraft = useRef(false);

  useEffect(
    () =>
      observe((notice) => {
        if (
          notice === "ready" ||
          (!notice.ok && notice.error.code === "sequence_gap") ||
          (notice.ok &&
            notice.value.kind === "changed" &&
            notice.value.record === "memory" &&
            notice.value.id === projectId &&
            notice.value.revision !== revision.current)
        )
          setEpoch((value) => value + 1);
      }),
    [observe, projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        let snapshot = await readList(port, projectId, controller.signal);
        while (snapshot === null && !controller.signal.aborted)
          snapshot = await readList(port, projectId, controller.signal);
        if (controller.signal.aborted || !snapshot) return;
        revision.current = snapshot.revision;
        setMemory(snapshot);
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [epoch, port, projectId]);

  useLayoutEffect(() => {
    if (!draftRequest?.source || handledSequence === draftRequest.sequence || busy) return;
    focusDraft.current = true;
    drafts.open(projectId, freshDraft(draftRequest.source), draftRequest.sequence);
    textField.current?.focus();
  }, [busy, draftRequest, drafts, handledSequence, projectId]);

  useLayoutEffect(() => {
    if (
      draft &&
      focusDraft.current &&
      textField.current &&
      !textField.current.closest("[inert], [hidden]")
    ) {
      textField.current.focus();
      focusDraft.current = false;
    }
  });

  const excess = draft ? Math.max(0, Array.from(draft.text).length - memoryTextLimit) : 0;
  const draftNotice =
    excess || draft?.notice === "excess"
      ? message(locale, "memory.excess", { excess })
      : draft?.notice === "empty"
        ? message(locale, "memory.emptyText")
        : draft?.notice === "full"
          ? message(locale, "memory.saveFull")
          : draft?.notice === "conflict"
            ? message(locale, "memory.conflict")
            : draft?.notice === "uncertain"
              ? message(locale, "memory.saveUncertain")
              : draft?.notice === "failed"
                ? message(locale, "memory.saveFailed")
                : undefined;

  function showDraft(value: Draft) {
    if (busy) return;
    drafts.open(projectId, value);
    focusDraft.current = true;
    textField.current?.focus();
  }

  function closeDraft() {
    setDraft(undefined);
    add.current?.focus();
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || drafts.snapshot(projectId).saving || withdrawalPending.current) return;
    if (excess || !draft.text.trim()) {
      setDraft({ ...draft, notice: excess ? "excess" : "empty" });
      textField.current?.focus();
      return;
    }
    const intent = draft.intent ?? crypto.randomUUID();
    drafts.update(projectId, { ...draft, intent }, true);
    const entry = draft.entry;
    const result = await stagedCommand(port, intent, draft.text, (text) =>
      entry
        ? port.editMemory(intent, {
            entryId: entry.id,
            expectedVersion: entry.version,
            kind: draft.kind,
            text,
          })
        : port.addMemory(intent, {
            projectId,
            kind: draft.kind,
            text,
            ...(draft.source ? { sourceMessageId: draft.source.messageId } : {}),
          }),
    );
    if (result.ok) {
      closeDraft();
      refresh();
      return;
    }
    const code = result.error.code;
    const unconfirmed = uncertainWrite(code);
    const fields = { ...draft, intent: undefined };
    if (code === "stale_revision" && entry) {
      setDraft({
        ...fields,
        entry: { ...entry, version: result.error.parameters.currentRevision },
        notice: "conflict",
      });
      refresh();
    } else {
      setDraft({
        ...fields,
        notice: unconfirmed
          ? "uncertain"
          : code === "memory_full"
            ? "full"
            : code === "entry_invalid"
              ? "empty"
              : "failed",
        ...(unconfirmed ? { intent } : {}),
      });
    }
  }

  async function withdraw() {
    if (!withdrawal || busy || withdrawalPending.current) return;
    withdrawalPending.current = true;
    setWithdrawing(true);
    const { id, version, intent } = withdrawal;
    const result = await port
      .withdrawMemory(intent, { entryId: id, expectedVersion: version })
      .result.catch(() => failure("uncertain"));
    withdrawalPending.current = false;
    setWithdrawing(false);
    if (result.ok) {
      withdrawReturn.current = add.current;
      setWithdrawal(undefined);
      refresh();
    } else if (result.error.code === "stale_revision") {
      setWithdrawNotice("conflict");
      setWithdrawal({
        id,
        version: result.error.parameters.currentRevision,
        intent: crypto.randomUUID(),
      });
      refresh();
    } else {
      const unconfirmed = uncertainWrite(result.error.code);
      setWithdrawNotice(unconfirmed ? "uncertain" : "failed");
      if (!unconfirmed) setWithdrawal({ ...withdrawal, intent: crypto.randomUUID() });
    }
  }

  function toggleHistory(id: string) {
    setHistories((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function renderEntry(entry: Entry) {
    const source = entry.source;
    const historyOpen = histories.has(entry.id);
    return (
      <li className="memory-entry" key={entry.id}>
        <p className="memory-text" lang="" dir="auto">
          {entry.text}
        </p>
        <MemoryAttribution locale={locale} version={entry} originalAuthor={entry.originalAuthor} />
        {source && (
          <div className="memory-source">
            <q lang="" dir="auto">
              {conversationPreview(source.prefix, source.truncated)}
            </q>
            <a
              className="memory-link"
              href={`#message-${source.messageId}`}
              onClick={(event) => {
                event.preventDefault();
                goToMessage(source);
              }}
            >
              {message(locale, "memory.goToMessage")}
            </a>
          </div>
        )}
        <div className="memory-actions">
          {entry.state === "active" && (
            <>
              <button
                className="memory-link"
                type="button"
                onClick={() => {
                  showDraft({
                    kind: entry.kind,
                    text: entry.text,
                    entry: {
                      id: entry.id,
                      version: entry.number,
                      text: entry.text,
                      kind: entry.kind,
                    },
                  });
                }}
              >
                {message(locale, "memory.editEntry")}
              </button>
              <button
                className="memory-link"
                type="button"
                onClick={(event) => {
                  withdrawReturn.current = event.currentTarget;
                  setWithdrawNotice(undefined);
                  setWithdrawal({
                    id: entry.id,
                    version: entry.number,
                    intent: crypto.randomUUID(),
                  });
                }}
              >
                {message(locale, "memory.withdrawEntry")}
              </button>
            </>
          )}
          <button
            className="memory-link"
            type="button"
            onClick={() => {
              toggleHistory(entry.id);
            }}
          >
            {message(locale, historyOpen ? "memory.hideHistory" : "memory.showHistory")}
          </button>
        </div>
        {historyOpen && (
          <EntryHistory
            entryId={entry.id}
            projectId={projectId}
            locale={locale}
            port={port}
            epoch={epoch}
          />
        )}
      </li>
    );
  }
  const entries = memory?.entries ?? [];
  const withdrawn = entries.filter(({ state }) => state === "withdrawn");
  return (
    <div
      id="project-memory"
      className="project-memory"
      aria-busy={(!memory && !failed) || undefined}
    >
      <div className="project-memory-tools">
        {memory && (
          <p>
            {message(locale, "memory.usage", {
              percent: formatNumber(locale, memory.bytes / memoryByteLimit, { style: "percent" }),
              entries: memory.active,
              max_entries: memoryEntryLimit,
            })}
          </p>
        )}
        <button
          type="button"
          className="primitive-button"
          ref={add}
          onClick={() => {
            showDraft(freshDraft());
          }}
        >
          <LucideGlyph name="notebook-pen" size={16} />
          {message(locale, "memory.addEntry")}
        </button>
      </div>
      {draft && (
        <form className="memory-form" onSubmit={(event) => void save(event)}>
          <label className="primitive-field">
            <span>{message(locale, "memory.kind")}</span>
            <select
              value={draft.kind}
              disabled={busy}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  kind: event.currentTarget.value as MemoryKind,
                  intent: undefined,
                });
              }}
            >
              {memoryKinds.map((kind) => (
                <option value={kind} key={kind}>
                  {message(locale, `memory.kind.${kind}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="primitive-field">
            <span>{message(locale, "memory.entryText")}</span>
            <textarea
              ref={textField}
              readOnly={busy}
              value={draft.text}
              dir="auto"
              rows={3}
              aria-describedby={draftNotice ? noticeId : undefined}
              aria-invalid={excess > 0 || draft.notice === "empty" || undefined}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  text: event.currentTarget.value,
                  intent: undefined,
                  notice: draft.notice === "conflict" ? "conflict" : undefined,
                });
              }}
            />
          </label>
          {draftNotice && (
            <Notice id={noticeId} conflict={draft.notice === "conflict"}>
              {draftNotice}
            </Notice>
          )}
          <div className="memory-actions">
            <button
              type="submit"
              className="primitive-button primitive-primary"
              aria-disabled={busy}
            >
              {message(locale, "memory.saveEntry")}
            </button>
            <button
              type="button"
              className="primitive-button"
              aria-disabled={busy}
              onClick={() => {
                if (!busy) closeDraft();
              }}
            >
              {message(locale, "memory.discard")}
            </button>
          </div>
        </form>
      )}
      {failed ? (
        <div className="memory-state">
          <Notice danger>{message(locale, "memory.listFailed")}</Notice>
          <button
            type="button"
            className="primitive-button"
            onClick={() => {
              setFailed(false);
              refresh();
            }}
          >
            {message(locale, "memory.reload")}
          </button>
        </div>
      ) : !memory ? (
        <p role="status">{message(locale, "plan.loading")}</p>
      ) : (
        <>
          {memory.active === 0 && <p>{message(locale, "memory.empty")}</p>}
          {memoryKinds.map((kind) => {
            const group = entries.filter(
              (entry) => entry.state === "active" && entry.kind === kind,
            );
            if (!group.length) return null;
            return (
              <section className="memory-group" key={kind}>
                <h2 data-type="type.ui.heading">{message(locale, `memory.group.${kind}`)}</h2>
                <ul>{group.map(renderEntry)}</ul>
              </section>
            );
          })}
          {withdrawn.length > 0 && (
            <div className="memory-group">
              <button
                type="button"
                className="memory-link"
                onClick={() => {
                  setShowWithdrawn(!showWithdrawn);
                }}
              >
                {message(locale, showWithdrawn ? "memory.hideWithdrawn" : "memory.showWithdrawn", {
                  n: withdrawn.length,
                })}
              </button>
              {showWithdrawn && <ul>{withdrawn.map(renderEntry)}</ul>}
            </div>
          )}
        </>
      )}
      {withdrawal && (
        <Dialog
          open
          title={message(locale, "memory.withdrawTitle")}
          closeLabel={message(locale, "dialog.close")}
          closePlacement="footer"
          closeDisabled={busy}
          descriptionId={descriptionId}
          returnFocusRef={withdrawReturn}
          onClose={() => {
            if (!busy) setWithdrawal(undefined);
          }}
          footer={
            <button
              type="button"
              className="primitive-button primitive-primary"
              aria-disabled={busy}
              onClick={() => void withdraw()}
            >
              {message(locale, "memory.withdrawEntry")}
            </button>
          }
        >
          <p id={descriptionId}>{message(locale, "memory.withdrawBody")}</p>
          {withdrawNotice && (
            <Notice conflict={withdrawNotice === "conflict"}>
              {message(
                locale,
                withdrawNotice === "conflict"
                  ? "memory.withdrawConflict"
                  : withdrawNotice === "uncertain"
                    ? "memory.withdrawUncertain"
                    : "memory.withdrawFailed",
              )}
            </Notice>
          )}
        </Dialog>
      )}
    </div>
  );
}
