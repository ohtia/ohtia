import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
} from "react";
import {
  message,
  utf8Size,
  type ManuscriptIntent,
  type ManuscriptWriteResult,
  type CanonicalManuscript,
  type FoundationPort,
  type InterfaceLocale,
  type ManuscriptPage,
  type ManuscriptRevision,
  type ManuscriptSummary,
  type Outcome,
  type PortCall,
  type ResearchInputs,
} from "@ohtia/contracts";
import { parseManuscript, serializeManuscript } from "@ohtia/domain";
import { LucideGlyph } from "./iconography.js";
import {
  manuscriptBlocks,
  manuscriptHeadingType,
  mountManuscriptEditor,
  type ManuscriptEditor,
} from "./manuscript-editor.js";
import { ManuscriptBreadcrumbs } from "./manuscript-breadcrumbs.js";
import type { ManuscriptOutline } from "./manuscript-outline.js";
import { stagedCommand } from "./staged-command.js";
import type { ProjectCollections } from "./project-controller.js";

type Scope = Pick<ResearchInputs["manuscript.read"], "projectId" | "subscriptionId">;
type ManuscriptPort = Pick<
  FoundationPort,
  "listManuscripts" | "readManuscript" | "readManuscriptPart"
>;
type Status = "loading" | "ready" | "failed" | "unavailable";
export interface ManuscriptContent {
  readonly revision: ManuscriptRevision;
  readonly document: CanonicalManuscript;
}

interface ProjectOwner {
  readonly projectId: string;
}
interface ProjectAccess {
  readonly project: ProjectOwner;
}
interface CollectionState {
  readonly owner: ProjectOwner;
  readonly scope: Scope;
  readonly status: Status;
  readonly listed:
    | {
        readonly access: ProjectAccess;
        readonly scope: Scope;
        readonly rows: readonly ManuscriptSummary[];
      }
    | undefined;
}
const noCollection = () => undefined;
const noSubscription = () => () => {};
const emptyRows: readonly ManuscriptSummary[] = [];

async function currentResult<T>(call: PortCall<T>, signal: AbortSignal) {
  const cancel = () => {
    call.cancel();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const result = await call.result;
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function failureStatus(code: string): "failed" | "unavailable" {
  return ["disposed", "service_unavailable", "record_not_found", "project_in_setup"].includes(code)
    ? "unavailable"
    : "failed";
}

export function useManuscripts(
  port: ManuscriptPort | undefined,
  collections: ProjectCollections | undefined,
  projectId: string | undefined,
  enabled: boolean,
  confirmed: boolean,
) {
  const current = useSyncExternalStore(
    collections?.subscribe ?? noSubscription,
    collections?.snapshot ?? noCollection,
  );
  const subscriptionId =
    current?.scope.projectId === projectId ? current?.subscriptionId : undefined;
  const project = useMemo(() => (port && projectId ? { projectId } : undefined), [port, projectId]);
  const access = useMemo(
    () => (enabled && confirmed && project ? { project } : undefined),
    [confirmed, enabled, project],
  );
  const scope = useMemo(
    () => (access && subscriptionId ? { ...access.project, subscriptionId } : undefined),
    [access, subscriptionId],
  );
  const [state, setState] = useState<CollectionState>();
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setAttempt((previous) => previous + 1);
  };

  useEffect(() => {
    if (!access || !scope || !port || !collections) return;
    let request: AbortController | undefined;
    async function load(
      owner: ProjectCollections,
      source: ManuscriptPort,
      active: Scope,
      selectedAccess: ProjectAccess,
    ) {
      const selectedProject = selectedAccess.project;
      request?.abort();
      const { signal } = (request = new AbortController());
      const ownsScope = () =>
        !signal.aborted &&
        owner.snapshot().scope.projectId === active.projectId &&
        owner.snapshot().subscriptionId === active.subscriptionId;

      setState((previous) => ({
        owner: selectedProject,
        scope: active,
        status: "loading",
        listed: previous?.owner === selectedProject ? previous.listed : undefined,
      }));
      try {
        const rows: ManuscriptSummary[] = [];
        let after: string | null = null;
        do {
          const page: Outcome<ManuscriptPage> = await currentResult(
            source.listManuscripts({ ...active, after }),
            signal,
          );
          if (!ownsScope()) return;
          if (!page.ok) {
            setState((previous) => ({
              owner: selectedProject,
              scope: active,
              status: failureStatus(page.error.code),
              listed: previous?.owner === selectedProject ? previous.listed : undefined,
            }));
            return;
          }
          rows.push(...page.value.manuscripts);
          after = page.value.next;
        } while (after !== null);
        setState({
          owner: selectedProject,
          scope: active,
          status: "ready",
          listed: { access: selectedAccess, scope: active, rows },
        });
      } catch {
        if (ownsScope())
          setState((previous) => ({
            owner: selectedProject,
            scope: active,
            status: "failed",
            listed: previous?.owner === selectedProject ? previous.listed : undefined,
          }));
      }
    }

    const refresh = () => {
      if (collections.snapshot().subscriptionId === scope.subscriptionId)
        void load(collections, port, scope, access);
    };
    const stop = collections.observeManuscripts(scope.projectId, refresh);
    refresh();
    return () => {
      stop();
      request?.abort();
    };
  }, [access, attempt, collections, port, scope]);

  const admitted = state?.owner === project ? state : undefined;
  const status =
    (admitted?.scope === scope ? admitted?.status : undefined) ??
    (scope || (access && (current?.status === "loading" || current?.status === "ready"))
      ? "loading"
      : "unavailable");
  // Keep mounted tabs from this project while its storage authority is being reestablished.
  const listed = admitted?.listed;
  const verifiedScope = listed?.scope === scope ? scope : undefined;
  const canPresent = access !== undefined && listed?.access === access;
  return { scope, verifiedScope, canPresent, status, rows: listed?.rows ?? emptyRows, retry };
}

async function readContent(
  port: ManuscriptPort,
  scope: Scope,
  draftId: string,
  signal: AbortSignal,
): Promise<
  { readonly content: ManuscriptContent } | { readonly status: "failed" | "unavailable" }
> {
  const result = await currentResult(
    port.readManuscript({ ...scope, draftId, revisionId: null }),
    signal,
  );
  if (!result.ok) return { status: failureStatus(result.error.code) };
  const { revision, markdown } = result.value;
  let text = "";
  if (typeof markdown === "string") text = markdown;
  else {
    for (let index = 1; index <= markdown.parts; index++) {
      const part = await currentResult(
        port.readManuscriptPart({ ...scope, draftId, revisionId: revision.revisionId, index }),
        signal,
      );
      if (!part.ok) return { status: failureStatus(part.error.code) };
      text += part.value.text;
    }
  }
  const bytes = utf8Size(text);
  const hash = await manuscriptHash(text);
  if (hash !== revision.contentSha256 || (typeof markdown !== "string" && bytes !== markdown.bytes))
    return { status: "failed" };
  const document = parseManuscript(text, { draftId });
  return document.ok ? { content: { revision, document: document.value } } : { status: "failed" };
}

export type ManuscriptJump = { readonly draftId: string; readonly headingId?: string };
type SaveIntent = Extract<ManuscriptIntent, { kind: "save" }>;
interface SaveRequest {
  readonly operationId: string;
  readonly intent: SaveIntent;
  readonly text: string;
}

export interface ManuscriptWork {
  readonly base: ManuscriptContent;
  readonly document: CanonicalManuscript;
  readonly request?: SaveRequest;
}

/** Window-owned draft state shared with any view remounted for that document. */
export class ManuscriptDrafts {
  private readonly drafts = new Map<string, ManuscriptWork>();
  private readonly listeners = new Set<() => void>();

  get(draftId: string) {
    return this.drafts.get(draftId);
  }

  get pending() {
    return this.drafts.size > 0;
  }

  get count() {
    return this.drafts.size;
  }

  get canDiscard() {
    return [...this.drafts.values()].every((work) => !work.request);
  }

  discard() {
    if (!this.canDiscard) return;
    this.drafts.clear();
    for (const listener of this.listeners) listener();
  }

  set(draftId: string, work: ManuscriptWork | undefined) {
    if (work) this.drafts.set(draftId, work);
    else this.drafts.delete(draftId);
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

async function manuscriptHash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function submitManuscript(
  port: FoundationPort,
  scope: Scope,
  request: SaveRequest,
  reconcile: boolean,
): Promise<Outcome<ManuscriptWriteResult>> {
  const { operationId, intent, text } = request;
  if (reconcile) {
    const receipt = await port.readManuscriptReceipt({ ...scope, operationId, intent }).result;
    if (!receipt.ok) return receipt;
    if (receipt.value.receipt) return { ok: true, value: receipt.value.receipt };
  }
  const { draftId, expectedRevisionId, saveReason } = intent;
  return stagedCommand(
    { sendTextPart: (id, part) => port.stageManuscriptPart(id, { ...scope, ...part }) },
    operationId,
    text,
    (markdown) =>
      port.saveManuscript(operationId, {
        ...scope,
        draftId,
        expectedRevisionId,
        saveReason,
        markdown,
      }),
  );
}

interface ViewState {
  readonly status: Status;
  readonly content?: ManuscriptContent | undefined;
}

export function ManuscriptView({
  locale,
  scope,
  waitingForCollection,
  canPresent,
  port,
  manuscript,
  visible,
  onCommit,
  onOutline,
  jump,
  drafts,
  onWriting,
  onSaveForClose,
}: {
  readonly locale: InterfaceLocale;
  readonly scope: Scope | undefined;
  readonly waitingForCollection: boolean;
  readonly canPresent: boolean;
  readonly port: FoundationPort;
  readonly manuscript: ManuscriptSummary;
  readonly visible: boolean;
  readonly onCommit: (revision: ManuscriptRevision | null) => void;
  readonly onOutline: (
    draftId: string,
    headings: ManuscriptOutline,
    activeHeading: string | undefined,
    language: string | undefined,
  ) => void;
  readonly jump: ManuscriptJump | undefined;
  readonly drafts: ManuscriptDrafts;
  readonly onWriting: (writing: boolean) => void;
  readonly onSaveForClose: (save: (() => Promise<void>) | undefined) => void;
}) {
  const [state, setState] = useState<ViewState>();
  const [attempt, setAttempt] = useState(0);
  const { draftId, currentRevisionId } = manuscript;
  const { content } = state ?? {};
  const status = scope
    ? (state?.status ?? "loading")
    : canPresent && content
      ? "ready"
      : waitingForCollection
        ? "loading"
        : "unavailable";

  useEffect(() => {
    if (!scope) return;
    const request = new AbortController();
    const { signal } = request;
    // A just-saved revision is already shown; refresh it quietly instead of announcing loading.
    setState((previous) =>
      previous?.content?.revision.draftId === draftId &&
      previous.content.revision.revisionId === currentRevisionId &&
      previous.status === "ready"
        ? previous
        : { ...previous, status: "loading" },
    );
    void readContent(port, scope, draftId, signal)
      .then((result) => {
        if (signal.aborted) return;
        if ("content" in result) setState({ status: "ready", content: result.content });
        else setState((previous) => ({ ...previous, status: result.status }));
      })
      .catch(() => {
        if (!signal.aborted) setState((previous) => ({ ...previous, status: "failed" }));
      });
    return () => {
      request.abort();
    };
  }, [attempt, draftId, currentRevisionId, port, scope]);

  return (
    <>
      <div className="workspace-manuscript-status" role="status">
        {status === "loading" && message(locale, "project.loading")}
        {status === "failed" && message(locale, "manuscript.readFailed")}
        {status === "unavailable" && message(locale, "manuscript.unavailable")}
      </div>
      {scope && (status === "failed" || status === "unavailable") && (
        <button
          type="button"
          className="primitive-button workspace-manuscript-retry"
          onClick={() => {
            setAttempt((previous) => previous + 1);
          }}
        >
          {message(locale, "taskNotice.tryAgain")}
        </button>
      )}
      {content && (
        <CommittedManuscript
          content={content}
          locale={locale}
          visible={visible && canPresent}
          blocked={!canPresent}
          {...{ onCommit, onOutline, jump, drafts, port, scope, onWriting, onSaveForClose }}
          onSaved={(next) => {
            setState((previous) =>
              previous?.content?.revision.revisionId === next.revision.parentRevisionId
                ? { status: "ready", content: next }
                : previous,
            );
          }}
        />
      )}
    </>
  );
}

function manuscriptViewport(content: HTMLDivElement | null) {
  // Short windows scroll the full tab so the controls and text share the available height.
  return content && getComputedStyle(content).overflowY === "visible"
    ? content.closest<HTMLElement>(".workspace-document-tabs")
    : content;
}

function CommittedManuscript({
  content,
  locale,
  visible,
  blocked,
  onCommit,
  onOutline,
  jump,
  drafts,
  port,
  scope,
  onWriting,
  onSaveForClose,
  onSaved,
}: {
  readonly content: ManuscriptContent;
  readonly locale: InterfaceLocale;
  readonly visible: boolean;
  readonly blocked: boolean;
  readonly onCommit: (revision: ManuscriptRevision | null) => void;
  readonly onOutline: (
    draftId: string,
    headings: ManuscriptOutline,
    activeHeading: string | undefined,
    language: string | undefined,
  ) => void;
  readonly jump: ManuscriptJump | undefined;
  readonly drafts: ManuscriptDrafts;
  readonly port: FoundationPort;
  readonly scope: Scope | undefined;
  readonly onWriting: (writing: boolean) => void;
  readonly onSaveForClose: (save: (() => Promise<void>) | undefined) => void;
  readonly onSaved: (content: ManuscriptContent) => void;
}) {
  const { revision } = content;
  const { draftId } = revision;
  const [editing, setEditing] = useState(false);
  const [readingHeading, setReadingHeading] = useState<string>();
  const [editingHeading, setEditingHeading] = useState<string>();
  const readingJump = useRef<{ viewport: HTMLElement; top: number } | undefined>(undefined);
  const work = useSyncExternalStore(drafts.subscribe, () => drafts.get(draftId));
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [feedback, setFeedback] = useState<
    "invalid" | "failed" | "uncertain" | "conflict" | "saved"
  >();
  const editorHost = useRef<HTMLDivElement>(null);
  const modeButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<ManuscriptEditor>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const restore = useRef<{ id?: string | undefined; offset: number } | undefined>(undefined);
  const requested = useRef<ManuscriptJump | undefined>(undefined);
  const document = work?.document ?? content.document;
  const sections = document.sections ?? emptySections;
  const activeHeading = editing ? editingHeading : readingHeading;
  const blocks = useMemo(() => manuscriptBlocks(document), [document]);
  const current = useRef(content);
  const known = useRef(new Set<string>());
  useLayoutEffect(() => {
    current.current = content;
    for (const block of manuscriptBlocks(content.document)) known.current.add(block.id);
  }, [content]);
  const retired = useCallback(() => {
    const base = drafts.get(draftId)?.base ?? current.current;
    const kept = new Set(manuscriptBlocks(base.document).map((block) => block.id));
    return new Set([...known.current].filter((id) => !kept.has(id)));
  }, [draftId, drafts]);

  function change(next: ManuscriptWork | undefined) {
    drafts.set(draftId, next);
  }

  function mount() {
    if (!editorHost.current || editor.current) return;
    editor.current = mountManuscriptEditor(
      editorHost.current,
      drafts.get(draftId)?.document ?? current.current.document,
      message(locale, "manuscript.collection"),
      (next) => {
        const pending = drafts.get(draftId);
        const base = pending?.base ?? current.current;
        const text = serializeManuscript(next, { draftId });
        const saved = serializeManuscript(base.document, { draftId });
        // Text identical to its base is not pending work, e.g. after typing and deleting it again.
        // A save being prepared keeps its work so the newest text survives the save.
        if (
          !pending?.request &&
          !busy.current &&
          text.ok &&
          saved.ok &&
          text.value === saved.value
        ) {
          change(undefined);
          setFeedback(undefined);
          return;
        }
        change({
          base,
          document: next,
          ...(pending?.request && { request: pending.request }),
        });
        setFeedback((previous) =>
          previous === "saved" || previous === "invalid" ? undefined : previous,
        );
      },
      setEditingHeading,
      retired,
    );
    editor.current.refreshIdentities();
  }

  useLayoutEffect(() => {
    if (visible) onCommit(revision);
  }, [onCommit, revision, visible]);
  useLayoutEffect(() => {
    if (!visible) return;
    return () => {
      onCommit(null);
    };
  }, [onCommit, visible]);

  useLayoutEffect(() => {
    onOutline(
      draftId,
      blocked ? emptySections : sections,
      blocked ? undefined : activeHeading,
      revision.language ?? undefined,
    );
  }, [activeHeading, blocked, draftId, onOutline, revision.language, sections]);
  useLayoutEffect(() => {
    onWriting(editing && visible);
    return () => {
      onWriting(false);
    };
  }, [editing, onWriting, visible]);
  useLayoutEffect(
    () => () => {
      editor.current?.destroy();
      editor.current = null;
    },
    [],
  );
  useLayoutEffect(() => {
    if (!work) editor.current?.replace(content.document);
  }, [content.document, work]);
  const hadWork = useRef(!!work);
  useLayoutEffect(() => {
    const removed = hadWork.current && !work;
    hadWork.current = !!work;
    // Save and Discard disappear with the pending work; keep keyboard focus in the toolbar.
    const active = globalThis.document.activeElement;
    if (removed && visible && (!active || active === globalThis.document.body))
      modeButton.current?.focus();
  }, [visible, work]);

  function anchor() {
    const container = manuscriptViewport(scroll.current);
    const surface = editing ? editorHost.current : article.current;
    if (!container || !surface) return { offset: 0 };
    const top = container.getBoundingClientRect().top;
    const blocks = [...surface.querySelectorAll<HTMLElement>("[data-manuscript-block]")];
    const block = blocks.find((element) => element.getBoundingClientRect().bottom > top);
    return block
      ? { id: block.dataset.manuscriptBlock, offset: top - block.getBoundingClientRect().top }
      : { offset: 0 };
  }

  const followReading = useCallback(
    (event: { readonly target: EventTarget | null }) => {
      const viewport = manuscriptViewport(scroll.current);
      if (!viewport || event.target !== viewport || !article.current || editing) return;
      if (
        readingJump.current?.viewport === viewport &&
        readingJump.current.top === viewport.scrollTop
      )
        return;
      readingJump.current = undefined;
      const top = viewport.getBoundingClientRect().top + 1;
      const heading = Array.from(
        article.current.querySelectorAll<HTMLElement>(".manuscript-heading"),
      ).findLast((element) => element.getBoundingClientRect().top <= top);
      setReadingHeading(heading?.dataset.manuscriptBlock);
    },
    [editing],
  );

  useLayoutEffect(() => {
    const tabs = scroll.current?.closest(".workspace-document-tabs");
    tabs?.addEventListener("scroll", followReading);
    return () => tabs?.removeEventListener("scroll", followReading);
  }, [followReading]);

  function goToBlock(id: string | undefined, offset: number, focusHeading: boolean) {
    const viewport = manuscriptViewport(scroll.current);
    if (!viewport) return false;
    const surface = editing ? editorHost.current : article.current;
    const element = id
      ? Array.from(surface?.querySelectorAll<HTMLElement>("[data-manuscript-block]") ?? []).find(
          (block) => block.dataset.manuscriptBlock === id,
        )
      : undefined;
    if (id && !element && focusHeading) return false;
    if (editing) {
      if (id && element) editor.current?.jump(id);
      else editor.current?.focus();
    }
    viewport.scrollTop = element
      ? viewport.scrollTop +
        element.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top +
        offset
      : 0;
    if (!editing) {
      readingJump.current = { viewport, top: viewport.scrollTop };
      const index = blocks.findIndex((block) => block.id === id);
      let heading: string | undefined;
      for (let position = index; position >= 0; position--) {
        const block = blocks[position];
        if (block && "level" in block) {
          heading = block.id;
          break;
        }
      }
      setReadingHeading(heading);
      if (focusHeading) element?.focus({ preventScroll: true });
    }
    return true;
  }

  useLayoutEffect(() => {
    if (!visible || !scroll.current) return;
    if (editing) mount();
    const previous = restore.current;
    const pendingJump = jump?.draftId === draftId && requested.current !== jump ? jump : undefined;
    if (!previous && !pendingJump) return;
    const moved = pendingJump
      ? goToBlock(pendingJump.headingId, 0, true)
      : goToBlock(previous?.id, previous?.offset ?? 0, false);
    if (moved) {
      restore.current = undefined;
      if (pendingJump) requested.current = pendingJump;
    }
  });

  /** Drop a definitely failed request; text undone to its base during the save is no longer pending. */
  function release({ base, document: working }: ManuscriptWork) {
    const text = serializeManuscript(working, { draftId });
    const saved = serializeManuscript(base.document, { draftId });
    change(
      text.ok && saved.ok && text.value === saved.value ? undefined : { base, document: working },
    );
  }

  async function save() {
    const previous = drafts.get(draftId);
    if (!scope || !visible || !previous || busy.current) return;
    busy.current = true;
    setSaving(true);
    setFeedback(undefined);
    let uncertain = previous.request;
    try {
      const base = previous.base;
      if (!uncertain) {
        const serialized = serializeManuscript(previous.document, { draftId });
        if (!serialized.ok) {
          setFeedback("invalid");
          return;
        }
        uncertain = {
          operationId: crypto.randomUUID(),
          intent: {
            kind: "save",
            draftId,
            expectedRevisionId: base.revision.revisionId,
            saveReason: "manual",
            contentSha256: await manuscriptHash(serialized.value),
          },
          text: serialized.value,
        };
        change({ ...(drafts.get(draftId) ?? previous), request: uncertain });
      }
      const result = await submitManuscript(port, scope, uncertain, !!previous.request);
      const latest = drafts.get(draftId) ?? previous;
      if (!result.ok) {
        const retryReceipt = [
          "save_uncertain",
          "outcome_unknown",
          "timed_out",
          "disposed",
          "service_unavailable",
          // A rejected bridge call has an unknown outcome, like the other controllers treat it.
          "invalid_service_result",
        ].includes(result.error.code);
        if (!retryReceipt) release(latest);
        setFeedback(retryReceipt ? "uncertain" : "failed");
        return;
      }
      if (result.value.manuscriptChange.kind === "conflict") {
        release(latest);
        setFeedback("conflict");
        return;
      }
      const savedDocument = parseManuscript(uncertain.text, { draftId });
      if (!savedDocument.ok) {
        setFeedback("uncertain");
        return;
      }
      const saved = {
        revision: result.value.manuscriptChange.revision,
        document: savedDocument.value,
      };
      if (!latest.request || latest.request.operationId !== uncertain.operationId) return;
      onSaved(saved);
      const working = serializeManuscript(latest.document, { draftId });
      change(
        working.ok && working.value === uncertain.text
          ? undefined
          : { base: saved, document: latest.document },
      );
      // Text kept over the new base may hold units that this save retired, e.g. restored by undo.
      editor.current?.refreshIdentities();
      setFeedback("saved");
    } catch {
      setFeedback(uncertain ? "uncertain" : "failed");
    } finally {
      setSaving(false);
      busy.current = false;
    }
  }

  useLayoutEffect(() => {
    if (!scope || !visible || !work) return;
    onSaveForClose(save);
    return () => {
      onSaveForClose(undefined);
    };
  });

  const modeLabel = message(locale, editing ? "menu.edit" : "manuscript.preview");
  const saveLabel = saving
    ? message(locale, "saving")
    : feedback && feedback !== "saved"
      ? message(locale, `manuscript.${feedback}`)
      : work?.request
        ? message(locale, "manuscript.uncertain")
        : work
          ? message(locale, "manuscript.pending")
          : message(locale, feedback === "saved" ? "manuscript.saved" : "saved");

  return (
    <section
      className="workspace-manuscript-view"
      inert={blocked}
      aria-label={message(locale, "manuscript.collection")}
    >
      <header className="workspace-manuscript-toolbar">
        <ManuscriptBreadcrumbs
          headings={sections}
          current={activeHeading}
          locale={locale}
          language={revision.language}
          onChoose={(heading) => {
            goToBlock(heading, 0, true);
          }}
        />
        <div className="workspace-manuscript-actions">
          <button
            ref={modeButton}
            type="button"
            className="primitive-button"
            onClick={() => {
              restore.current = anchor();
              setEditing((wasEditing) => !wasEditing);
            }}
          >
            <LucideGlyph name={editing ? "file-text" : "pencil"} size={16} />
            {message(locale, editing ? "manuscript.preview" : "menu.edit")}
          </button>
          {work && (
            <>
              <button
                type="button"
                className="primitive-button primitive-primary"
                disabled={saving || !scope}
                onClick={() => {
                  void save();
                }}
              >
                {message(
                  locale,
                  work.request && !saving ? "taskNotice.tryAgain" : "manuscript.save",
                )}
              </button>
              <button
                type="button"
                className="primitive-button"
                disabled={saving || !!work.request}
                onClick={() => {
                  change(undefined);
                  setFeedback(undefined);
                }}
              >
                {message(locale, "memory.discard")}
              </button>
            </>
          )}
        </div>
      </header>
      <div className="workspace-panel-scroll" ref={scroll} onScroll={followReading}>
        <article
          ref={article}
          className="workspace-manuscript"
          lang={revision.language ?? ""}
          dir="auto"
          hidden={editing}
        >
          {blocks.map((block) => {
            if ("text" in block) {
              const Heading =
                `h${String("level" in block ? block.level : 1)}` as keyof JSX.IntrinsicElements;
              return (
                <Heading
                  key={block.id}
                  className={"level" in block ? "manuscript-heading" : undefined}
                  data-manuscript-block={block.id}
                  data-type={manuscriptHeadingType("level" in block ? block.level : 1)}
                  tabIndex={-1}
                >
                  {block.text}
                </Heading>
              );
            }
            return (
              <p
                key={block.id}
                data-manuscript-block={block.id}
                data-type="type.doc.body"
                dir="auto"
              >
                {block.lines.map((line, index) => (
                  <Fragment key={index}>
                    {line.text}
                    {line.breakAfter === "hard" ? <br /> : line.breakAfter === "soft" ? " " : null}
                  </Fragment>
                ))}
              </p>
            );
          })}
          {!document.title && !document.paragraphs.length && !sections.length && (
            <p className="workspace-manuscript-status" lang={locale}>
              {message(locale, "manuscript.empty")}
            </p>
          )}
        </article>
        <div
          className="workspace-manuscript"
          ref={editorHost}
          lang={revision.language ?? ""}
          dir="auto"
          hidden={!editing}
        />
      </div>
      <footer className="workspace-manuscript-footer">
        <span>{modeLabel}</span>
        <span role="status" data-pending={!!work && !saving ? "true" : undefined}>
          {saveLabel}
        </span>
      </footer>
    </section>
  );
}

const emptySections: ManuscriptOutline = [];
