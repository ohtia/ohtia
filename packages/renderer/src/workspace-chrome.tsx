import type { ReactNode } from "react";
import { ActivityBadges, activityName, type ActivityCounts } from "./activity-badge.js";
import {
  Fragment,
  useEffect,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
  type RefCallback,
} from "react";
import {
  commandDefinitions,
  formatNumber,
  message,
  workspacePanels,
  type CommandBridge,
  type CommandId,
  type ManuscriptCloseCommand,
  type FoundationPort,
  type ManuscriptRevision,
  type ProjectRecord,
  type InterfaceLocale,
  type SimpleMessageKey,
  type WorkspacePanel,
} from "@ohtia/contracts";
import { CommandController, presentationReason } from "./command-controller.js";
import { ProductCharacter, type DecorationState } from "./command-surfaces.js";
import { LayoutPreferences } from "./layout-preferences.js";
import {
  WorkspaceController,
  type LayoutFocusIntent,
  type WorkspaceState,
} from "./workspace-controller.js";
import { designMetrics } from "./design-tokens.js";
import { separatorRange } from "./workspace-geometry.js";
import { OhtiaBrand } from "./branding.js";
import { LucideGlyph, type LucideName } from "./iconography.js";
import { Dialog, Tooltip } from "./layers.js";
import type { UpdateController, UpdateSnapshot } from "./update-controller.js";
import { availableVersion, useHeldWhileWriting } from "./update-surfaces.js";
import type { ProjectCollections } from "./project-controller.js";
import { ProjectExplorer } from "./project-explorer.js";
import {
  ManuscriptView,
  useManuscripts,
  type ManuscriptJump,
  ManuscriptDrafts,
} from "./manuscript-view.js";
import type { ManuscriptOutline } from "./manuscript-outline.js";
import { Tabs } from "./tabs.js";

const panelIcons = {
  explorer: "panel-left",
  documents: "app-window",
  chat: "panel-right",
} as const;
const panelKeys = {
  explorer: "command.panels.explorer",
  documents: "command.panels.documents",
  chat: "command.panels.chat",
} as const;
const actionKeys = {
  explorer: ["workspace.explorer.open", "workspace.explorer.hide"],
  documents: ["workspace.documents.open", "workspace.documents.hide"],
  chat: ["workspace.chat.open", "workspace.chat.hide"],
} as const;

/** Additional CSS-pixel safe-area minima; the native overlay rectangle remains authoritative. */
export interface WorkspaceWindowInsets {
  readonly start: number;
  readonly end: number;
}
export interface WorkspaceChromeProps {
  readonly chat?: ReactNode;
  readonly memory?: ReactNode;
  readonly collections?: ProjectCollections;
  readonly manuscriptPort?: FoundationPort;
  readonly manuscriptLifecycle?: Pick<
    CommandBridge,
    | "perform"
    | "setManuscriptPending"
    | "onManuscriptClose"
    | "onManuscriptLock"
    | "confirmManuscriptLock"
  >;
  readonly onManuscriptVisibility?: (revision: ManuscriptRevision | null) => void;
  readonly memoryRequest?: number;
  readonly revealSourceRequest?: object;
  readonly projectSelector?: ReactNode;
  projectNotice?: ReactNode;
  readonly hasProjects?: boolean | undefined;
  readonly project?: ProjectRecord | undefined;
  readonly projectScope?: string | undefined;
  readonly revealProjectChat?: boolean | undefined;
  readonly onComposerFocus?: () => void;
  readonly chatActivity?: ActivityCounts;
  readonly onChatVisibility?: (visible: boolean) => void;
  readonly chatTitle?: string | undefined;
  readonly chatHeadingStart?: ReactNode;
  readonly chatHeadingActions?: ReactNode;
  readonly replaceChatHeading?: boolean | undefined;
  readonly revealChatRequest?: number | undefined;
  readonly fallbackFocusRef?: RefObject<HTMLAnchorElement | null>;
  readonly preferences: LayoutPreferences;
  readonly commands: CommandController;
  readonly locale: InterfaceLocale;
  /** Retain the controller while temporarily unavailable, without admitting new layout commands. */
  readonly available?: boolean;
  readonly windowInsets: WorkspaceWindowInsets;
  readonly decoration?: DecorationState;
  /** Only a confirmed effective value; absent before the zoom producer is connected. */
  readonly zoom?: number;
  readonly layoutFailure?: boolean;
  readonly onDismissLayoutFailure?: () => void;
  /** SPEC-001-040: the window's update state; the title bar shows a newer version from it. */
  readonly updates?: UpdateController | undefined;
  /**
   * True while the researcher writes in the manuscript editor. The update button neither appears
   * nor changes then; it shows the current state once writing stops.
   */
  readonly writing?: boolean;
  /** Share this exact window authority with Settings; disposal revokes the binding. */
  readonly onWorkspaceChange?: (
    workspace: WorkspaceController | undefined,
    state?: WorkspaceState,
  ) => void;
}
interface DocumentTabsState {
  readonly projectId: string | undefined;
  readonly selected: string;
  readonly opened: ReadonlyMap<string, readonly string[]>;
}

const ignoreManuscriptVisibility = () => {};
const noUpdateSubscription = () => () => {};
const noUpdateSnapshot = (): UpdateSnapshot | undefined => undefined;
function focusedPanel(root: HTMLElement | null): WorkspacePanel | undefined {
  const active = root?.ownerDocument.activeElement;
  const value =
    active instanceof Element && root?.contains(active)
      ? active.closest<HTMLElement>("[data-workspace-panel]")?.dataset.workspacePanel
      : undefined;
  return workspacePanels.find((panel) => panel === value);
}
export function ShortcutControl({
  id,
  commands,
  locale,
  label,
  icon,
  controls,
  expanded,
  pressed,
  text = false,
  primary = false,
  controlRef,
  onUnavailable,
  displayText,
  activity,
  hint = false,
}: {
  id: CommandId;
  commands: CommandController;
  locale: InterfaceLocale;
  label?: string;
  icon?: LucideName;
  controls?: string;
  expanded?: boolean;
  pressed?: boolean;
  text?: boolean;
  primary?: boolean;
  displayText?: string;
  activity?: ActivityCounts;
  hint?: boolean;
  controlRef?: RefCallback<HTMLButtonElement>;
  onUnavailable?: () => void;
}) {
  const definition = commandDefinitions.find((entry) => entry.id === id);
  if (!definition) throw new Error("Unknown workspace command.");
  const visibleName = label ?? message(locale, definition.label);
  const name = activity ? activityName(locale, visibleName, activity, "chat") : visibleName;
  const marked = !!(activity?.replies || activity?.attention);
  const shortcuts = definition.shortcuts[commands.context.platform];
  const reason = commands.entry(id).reason;
  const reasonId = useId();
  const explanation = reason ? message(locale, `command.reason.${reason}`) : undefined;
  return (
    <Tooltip label={[name, shortcuts.join(" / "), explanation].filter(Boolean).join(" · ")}>
      <button
        type="button"
        ref={controlRef}
        className={`workspace-control${marked ? " activity-badge-control" : ""}${text ? " workspace-text-control" : ""}${primary ? " workspace-primary" : ""}${id === "zoom.reset" ? " workspace-zoom" : ""}`}
        data-workspace-command={id}
        aria-label={name}
        aria-controls={controls}
        aria-expanded={expanded}
        aria-pressed={pressed}
        aria-haspopup={id === "menu.open" ? "menu" : undefined}
        aria-keyshortcuts={
          shortcuts
            .filter(
              (key) =>
                !["Alt", "Ctrl", "Control", "Shift", "Cmd", "Meta", "AltGraph"].includes(key),
            )
            .map((key) =>
              key.replace("Ctrl+", "Control+").replace("Cmd+", "Meta+").replace(/\+\+$/, "+Plus"),
            )
            .join(" ") || undefined
        }
        aria-disabled={!!reason}
        aria-describedby={explanation ? reasonId : undefined}
        onClick={(event) => {
          if (id === "project.new" && event.detail > 1) return;
          if (reason) onUnavailable?.();
          else void commands.invoke(id);
        }}
      >
        {icon && <LucideGlyph name={icon} size={text ? 16 : 20} />}
        {text && <span>{displayText ?? visibleName}</span>}
        {marked && <ActivityBadges counts={activity} locale={locale} />}
        {hint && shortcuts.length > 0 && id === "settings.open" && <kbd>{shortcuts[0]}</kbd>}
        {explanation && (
          <span className="primitive-announcement" id={reasonId}>
            {explanation}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

/** Real chrome; storage, command ownership and confirmed presentation inputs stay with composition. */
const pendingReportRetryMs = 1000;

export function WorkspaceChrome({
  chat,
  memory,
  memoryRequest,
  collections,
  manuscriptPort,
  manuscriptLifecycle,
  onManuscriptVisibility = ignoreManuscriptVisibility,
  revealSourceRequest,
  chatTitle,
  chatActivity,
  onChatVisibility,
  chatHeadingStart,
  chatHeadingActions,
  replaceChatHeading,
  revealChatRequest,
  projectSelector,
  projectNotice,
  hasProjects = false,
  project,
  projectScope,
  revealProjectChat = true,
  onComposerFocus,
  preferences,
  commands,
  fallbackFocusRef,
  locale,
  available = true,
  windowInsets,
  decoration = "static",
  zoom,
  layoutFailure = false,
  onDismissLayoutFailure,
  onWorkspaceChange,
  updates,
  writing = false,
}: WorkspaceChromeProps) {
  const [writingManuscript, setWritingManuscript] = useState(false);
  const updateSnapshot = useSyncExternalStore(
    updates?.subscribe ?? noUpdateSubscription,
    updates?.snapshot ?? noUpdateSnapshot,
  );
  const newerVersion = useHeldWhileWriting(
    availableVersion(updateSnapshot?.notice?.state),
    writing || writingManuscript,
  );
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<WorkspaceController | undefined>(undefined);
  const availability = useRef(available);
  availability.current = available;
  const [state, setState] = useState<WorkspaceState>();
  const [, refreshCommands] = useState(0);
  const [lastPanel, setLastPanel] = useState(false);
  const pendingFocus = useRef<
    LayoutFocusIntent | { target: "settings-control" } | { target: "zoom-control" } | undefined
  >(undefined);
  const controls = useRef<Partial<Record<WorkspacePanel | "focus", HTMLButtonElement | undefined>>>(
    {},
  );
  const headings = useRef<Partial<Record<WorkspacePanel, HTMLHeadingElement | undefined>>>({});
  const zoomControlRef = useCallback<RefCallback<HTMLButtonElement>>((element) => {
    if (!element) return;
    return () => {
      if (controller.current && element.ownerDocument.activeElement === element)
        pendingFocus.current = { target: "zoom-control" };
    };
  }, []);
  const id = useId();
  const panelId = (panel: WorkspacePanel) => `${id}-${panel}`;
  const manuscripts = useManuscripts(
    manuscriptPort,
    collections,
    projectScope,
    available,
    !!project?.setupConfirmedAt && project.id === projectScope,
  );
  const [documents, setDocuments] = useState<DocumentTabsState>(() => ({
    projectId: projectScope,
    selected: "navigator",
    opened: new Map(),
  }));
  if (documents.projectId !== projectScope)
    setDocuments({ ...documents, projectId: projectScope, selected: "navigator" });
  const openIds = projectScope ? (documents.opened.get(projectScope) ?? []) : [];
  const memoryOpen = !!memory && openIds.includes("memory");
  const primary = manuscripts.rows[0];
  const manuscriptTab =
    !!manuscriptPort &&
    !!projectScope &&
    (!!primary || (project?.id === projectScope && !!project.setupConfirmedAt));
  const selectedTab =
    documents.projectId === projectScope &&
    ((documents.selected === "memory" && memoryOpen) ||
      (documents.selected === "manuscript" && manuscriptTab))
      ? documents.selected
      : "navigator";
  const manuscriptSelected = selectedTab === "manuscript";
  const memorySelected = selectedTab === "memory";
  const [manuscriptDrafts] = useState(() => new ManuscriptDrafts());
  const [pendingClose, setPendingClose] = useState<ManuscriptCloseCommand>();
  const [closingManuscript, setClosingManuscript] = useState(false);
  const saveForClose = useRef<(() => Promise<void>) | undefined>(undefined);
  const setSaveForClose = useCallback((save: (() => Promise<void>) | undefined) => {
    saveForClose.current = save;
  }, []);
  const pendingManuscript = useSyncExternalStore(
    manuscriptDrafts.subscribe,
    () => manuscriptDrafts.pending,
  );

  useEffect(() => {
    const report = manuscriptLifecycle?.setManuscriptPending;
    if (!report) return;
    // Main applies reports in sending order. It refuses them while an exit stops services, so a
    // refused report is sent again until main accepts the current value.
    let sent: boolean | undefined;
    let refused = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const sync = () => {
      if (disposed) return;
      const pending = manuscriptDrafts.pending;
      if (!refused && pending === sent) return;
      refused = false;
      sent = pending;
      const fail = () => {
        if (disposed) return;
        refused = true;
        clearTimeout(retry);
        retry = setTimeout(sync, pendingReportRetryMs);
      };
      void report(pending).then((accepted) => {
        if (!accepted) fail();
      }, fail);
    };
    sync();
    const unsubscribe = manuscriptDrafts.subscribe(sync);
    return () => {
      disposed = true;
      unsubscribe();
      clearTimeout(retry);
    };
  }, [manuscriptDrafts, manuscriptLifecycle]);

  useEffect(() => manuscriptLifecycle?.onManuscriptClose?.(setPendingClose), [manuscriptLifecycle]);
  // While an ordinary quit stops services, the manuscript accepts no more text.
  const [manuscriptLock, setManuscriptLock] = useState<string>();
  // Only a composition in the manuscript editor holds text the drafts have not recorded yet.
  const [composing, setComposing] = useState(false);
  const composingNow = useRef(false);
  const composedAtLock = useRef(false);
  useEffect(() => {
    const editorOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest(".workspace-manuscript-view .ProseMirror") : null;
    const start = (event: Event) => {
      if (!editorOf(event.target)) return;
      composingNow.current = true;
      setComposing(true);
    };
    const end = () => {
      composingNow.current = false;
      setComposing(false);
    };
    // Leaving the editor ends its composition even if the input method never reports it.
    const leave = (event: FocusEvent) => {
      const editor = editorOf(event.target);
      if (editor && !(event.relatedTarget instanceof Node && editor.contains(event.relatedTarget)))
        end();
    };
    document.addEventListener("compositionstart", start, true);
    document.addEventListener("compositionend", end, true);
    document.addEventListener("focusout", leave, true);
    return () => {
      document.removeEventListener("compositionstart", start, true);
      document.removeEventListener("compositionend", end, true);
      document.removeEventListener("focusout", leave, true);
    };
  }, []);
  useEffect(
    () =>
      manuscriptLifecycle?.onManuscriptLock?.((request) => {
        // Read the composition before the lock makes the editor read-only and ends it.
        if (request.locked) composedAtLock.current = composingNow.current;
        setManuscriptLock(request.locked ? request.id : undefined);
      }),
    [manuscriptLifecycle],
  );
  useEffect(() => {
    if (!manuscriptLock) return;
    // Text still being composed has not reached the drafts, so it counts as pending.
    void manuscriptLifecycle
      ?.confirmManuscriptLock?.(
        manuscriptLock,
        manuscriptDrafts.pending || composedAtLock.current || composingNow.current,
      )
      .catch(() => {});
  }, [manuscriptDrafts, manuscriptLifecycle, manuscriptLock]);
  useEffect(() => {
    if (
      !manuscriptLifecycle ||
      !pendingClose ||
      pendingManuscript ||
      closingManuscript ||
      composing
    )
      return;
    // Nothing is left to confirm, for example after a save finished: continue the requested close.
    // A composition in the manuscript first ends and records its text, which then asks as usual.
    setPendingClose(undefined);
    void manuscriptLifecycle
      .setManuscriptPending?.(false)
      .then((ready) => (ready ? manuscriptLifecycle.perform(pendingClose) : undefined))
      .catch(() => {});
  }, [closingManuscript, composing, manuscriptLifecycle, pendingClose, pendingManuscript]);

  async function finishManuscriptClose(discard: boolean) {
    if (!manuscriptLifecycle || !pendingClose || closingManuscript) return;
    setClosingManuscript(true);
    try {
      if (discard) manuscriptDrafts.discard();
      else await saveForClose.current?.();
      if (manuscriptDrafts.pending) {
        setPendingClose(undefined);
        return;
      }
      if (await manuscriptLifecycle.setManuscriptPending?.(false)) {
        setPendingClose(undefined);
        await manuscriptLifecycle.perform(pendingClose);
      }
    } finally {
      setClosingManuscript(false);
    }
  }

  const [jump, setJump] = useState<ManuscriptJump>();
  const [outline, setOutline] = useState<{
    draftId: string;
    headings: ManuscriptOutline;
    activeHeading: string | undefined;
    language: string | undefined;
  }>();
  const onOutline = useCallback(
    (
      draftId: string,
      headings: ManuscriptOutline,
      activeHeading: string | undefined,
      language: string | undefined,
    ) => {
      setOutline({ draftId, headings, activeHeading, language });
    },
    [],
  );
  const activeOutline =
    manuscripts.canPresent && outline?.draftId === primary?.draftId ? outline : undefined;
  const liveProject = useRef(projectScope);
  useLayoutEffect(() => {
    liveProject.current = projectScope;
  }, [projectScope]);
  const creating = useRef(new Set<string>());
  const [createFailed, setCreateFailed] = useState<string>();

  useEffect(() => {
    function protectPending(event: BeforeUnloadEvent) {
      if (!manuscriptDrafts.pending) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", protectPending);
    return () => {
      window.removeEventListener("beforeunload", protectPending);
    };
  }, [manuscriptDrafts]);

  const handledMemoryRequests = useRef(new Map<string, number>());
  const handledSourceRequest = useRef<object | undefined>(undefined);
  const selectedTabRef = useRef<HTMLButtonElement>(null);
  const [focusDocument, setFocusDocument] = useState<string>();

  const openDocument = useCallback(
    (tab: string) => {
      if (!projectScope) return;
      const layout = controller.current;
      if (!layout) return;
      layout.reveal("documents");
      setDocuments((previous) => {
        if (previous.projectId !== projectScope) return previous;
        const opened = previous.opened.get(projectScope) ?? [];
        return {
          ...previous,
          selected: tab,
          opened:
            tab !== "memory" || opened.includes(tab)
              ? previous.opened
              : new Map(previous.opened).set(projectScope, [...opened, tab]),
        };
      });
      if (tab === "memory") setFocusDocument(tab);
    },
    [projectScope],
  );

  const openMemory = useCallback(() => {
    openDocument("memory");
  }, [openDocument]);

  function openManuscript(headingId?: string) {
    if (!manuscripts.verifiedScope || (!primary && manuscripts.status !== "ready")) return;
    if (primary && headingId) setJump({ draftId: primary.draftId, headingId });
    else setFocusDocument("manuscript");
    openDocument("manuscript");
  }

  async function createPrimary() {
    const scope = manuscripts.verifiedScope;
    if (!scope || !manuscriptPort || primary || creating.current.has(scope.projectId)) return;
    creating.current.add(scope.projectId);
    setCreateFailed(undefined);
    try {
      const result = await manuscriptPort.createManuscript(
        `primary-manuscript-${scope.projectId}`,
        { ...scope, title: project?.title ?? message(locale, "manuscript.collection") },
      ).result;
      if (liveProject.current !== scope.projectId) return;
      if (result.ok) {
        manuscripts.retry();
        openDocument("manuscript");
      } else {
        manuscripts.retry();
        setCreateFailed(scope.projectId);
      }
    } catch {
      if (liveProject.current === scope.projectId) setCreateFailed(scope.projectId);
    } finally {
      creating.current.delete(scope.projectId);
    }
  }

  useLayoutEffect(() => {
    if (
      !memory ||
      !memoryRequest ||
      !projectScope ||
      handledMemoryRequests.current.get(projectScope) === memoryRequest ||
      !state ||
      state.initializing ||
      preferences.busy
    )
      return;
    handledMemoryRequests.current.set(projectScope, memoryRequest);
    openMemory();
  }, [memory, memoryRequest, openMemory, preferences, projectScope, state]);

  useLayoutEffect(() => {
    const layout = controller.current;
    if (
      !revealSourceRequest ||
      handledSourceRequest.current === revealSourceRequest ||
      !layout ||
      !state ||
      state.initializing ||
      preferences.busy
    )
      return;
    handledSourceRequest.current = revealSourceRequest;
    layout.reveal("chat");
  }, [preferences, revealSourceRequest, state]);

  const text = (key: SimpleMessageKey) => message(locale, key);
  useEffect(
    () =>
      commands.subscribe(() => {
        refreshCommands((value) => value + 1);
      }),
    [commands],
  );
  useEffect(() => {
    commands.changed();
  }, [commands, available]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let live = true;
    let suppressFocus = false;
    const focus = (intent: LayoutFocusIntent) => {
      if (!live || suppressFocus) return;
      pendingFocus.current = intent;
      if (intent.target === "panel-control")
        controls.current[intent.panel]?.focus({ preventScroll: true });
      if (intent.target === "focus-control") controls.current.focus?.focus({ preventScroll: true });
    };
    const coarse = window.matchMedia("(pointer: coarse)");
    const layout = new WorkspaceController(
      preferences,
      element.getBoundingClientRect().width,
      coarse.matches,
      (next) => {
        if (!live) return;
        const active = focusedPanel(element);
        if (active && !next.geometry.visible[active] && !pendingFocus.current)
          focus({ target: "panel-control", panel: active });
        const target = element.ownerDocument.activeElement;
        if (target instanceof HTMLElement && !pendingFocus.current) {
          const sizePanel = workspacePanels.find((panel) => panel === target.dataset.workspaceSize);
          const left = workspacePanels.find((panel) => panel === target.dataset.separatorLeft);
          const right = workspacePanels.find((panel) => panel === target.dataset.separatorRight);
          if (target.closest(".workspace-rail") && next.geometry.rail === 0) {
            if (target.dataset.workspaceCommand === "settings.open")
              pendingFocus.current = { target: "settings-control" };
            else if (target.dataset.workspaceCommand === "panels.explorer")
              focus({ target: "panel-control", panel: "explorer" });
          } else if (
            sizePanel &&
            (next.geometry.mode === "narrow" || next.geometry.pairs.length === 0)
          )
            focus({ target: "panel-control", panel: sizePanel });
          else if (
            left &&
            right &&
            !next.geometry.pairs.some(([l, r]) => l === left && r === right)
          )
            focus({ target: "panel-control", panel: left });
        }
        if (
          next.geometry.mode === "narrow" ||
          workspacePanels.filter((panel) => next.geometry.visible[panel]).length > 1
        )
          setLastPanel(false);
        setState(next);
        if (controller.current) onWorkspaceChange?.(controller.current, next);
        commands.changed();
      },
      focus,
    );
    controller.current = layout;
    setState(layout.state);
    onWorkspaceChange?.(layout, layout.state);
    const reason = () =>
      presentationReason("panels.explorer", {
        composing: composing,
        modal: !!document.querySelector("dialog[open]"),
        editable: false,
      }) ?? (!availability.current ? "busy" : undefined);
    let composing = false;
    let composingTarget: Node | undefined;
    const composition = (event: Event) => {
      composing = event.type === "compositionstart";
      composingTarget = composing && event.target instanceof Node ? event.target : undefined;
      commands.changed();
    };
    const focusout = (event: Event) => {
      if (event.target === composingTarget) {
        composing = false;
        composingTarget = undefined;
        commands.changed();
      }
    };
    const compositionObserver = new MutationObserver(() => {
      if (composingTarget && !composingTarget.isConnected) {
        composing = false;
        composingTarget = undefined;
        commands.changed();
      }
    });
    compositionObserver.observe(document.body, { childList: true, subtree: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && layout.state.dragging) {
        event.preventDefault();
        layout.cancelResize("escape");
      }
    };
    const blur = () => {
      composing = false;
      composingTarget = undefined;
      layout.cancelResize("focus-loss");
      commands.changed();
    };
    const registrations = workspacePanels.map((panel) =>
      commands.register(`panels.${panel}`, {
        state: () => {
          const state = layout.state;
          const unavailable =
            reason() ??
            (state.geometry.mode === "wide" && (state.initializing || preferences.busy)
              ? "busy"
              : undefined) ??
            (state.geometry.mode === "wide" &&
            state.geometry.visible[panel] &&
            workspacePanels.filter((p) => state.geometry.visible[p]).length === 1
              ? "last_panel"
              : undefined);
          return {
            checked: state.geometry.visible[panel],
            ...(unavailable ? { reason: unavailable } : {}),
          };
        },
        run: () => {
          setLastPanel(false);
          return (
            layout.state.geometry.mode === "narrow"
              ? layout.select(panel)
              : layout.visibility(panel, focusedPanel(element))
          ).applied;
        },
      }),
    );
    registrations.push(
      commands.register("document.focus", {
        state: () => {
          const unavailable =
            reason() ?? (layout.state.geometry.mode === "narrow" ? "wide_layout" : undefined);
          return {
            checked: layout.state.focusMode,
            ...(unavailable ? { reason: unavailable } : {}),
          };
        },
        run: () => layout.focusMode().applied,
      }),
    );
    registrations.push(
      commands.register("layout.reset", {
        state: () => {
          const unavailable =
            reason() ?? (layout.state.initializing || preferences.busy ? "busy" : undefined);
          return unavailable ? { reason: unavailable } : {};
        },
        run: () => {
          setLastPanel(false);
          return layout.reset(focusedPanel(element)).applied;
        },
      }),
    );
    const viewport = () => {
      const width = element.getBoundingClientRect().width;
      if (width <= 0 || element.closest("[hidden]")) {
        layout.cancelResize("visibility");
        return;
      }
      suppressFocus =
        !element.contains(document.activeElement) || !!document.querySelector("dialog[open]");
      const before = layout.state.geometry.mode;
      const active = document.activeElement;
      const command = active instanceof HTMLElement ? active.dataset.workspaceCommand : undefined;
      layout.viewport(width, coarse.matches, focusedPanel(element));
      if (!suppressFocus && before !== layout.state.geometry.mode) {
        const panel = workspacePanels.find((panel) => command === `panels.${panel}`);
        if (panel) focus({ target: "panel-control", panel });
        else if (command === "document.focus") {
          const visible = workspacePanels.find((panel) => layout.state.geometry.visible[panel]);
          if (visible) focus({ target: "panel-control", panel: visible });
        } else if (command === "zoom.reset") pendingFocus.current = { target: "zoom-control" };
        else if (
          command === "settings.open" &&
          active instanceof HTMLElement &&
          !pendingFocus.current &&
          (active.closest(".workspace-narrow-row, .workspace-rail") ||
            (active.closest(".workspace-explorer-footer") &&
              !layout.state.geometry.visible.explorer))
        )
          pendingFocus.current = { target: "settings-control" };
      }
      suppressFocus = false;
    };
    const observer = new ResizeObserver(viewport);
    observer.observe(element);
    coarse.addEventListener("change", viewport);
    document.addEventListener("compositionstart", composition);
    document.addEventListener("compositionend", composition);
    document.addEventListener("focusout", focusout);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", escape, true);
    void layout.initialize();
    return () => {
      live = false;
      observer.disconnect();
      coarse.removeEventListener("change", viewport);
      document.removeEventListener("compositionstart", composition);
      document.removeEventListener("compositionend", composition);
      document.removeEventListener("focusout", focusout);
      compositionObserver.disconnect();
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape, true);
      registrations.forEach((stop) => {
        stop();
      });
      layout.dispose();
      onWorkspaceChange?.(undefined);
      controller.current = undefined;
      pendingFocus.current = undefined;
    };
  }, [preferences, commands, onWorkspaceChange]);
  useLayoutEffect(() => {
    const intent = pendingFocus.current;
    pendingFocus.current = undefined;
    if (!intent) return;
    if (intent.target === "zoom-control") {
      const zoomButton = root.current?.querySelector<HTMLButtonElement>(
        '[data-workspace-command="zoom.reset"]',
      );
      if (zoomButton) zoomButton.focus({ preventScroll: true });
      else {
        const visible = workspacePanels.find((panel) => state?.geometry.visible[panel]);
        if (visible) controls.current[visible]?.focus({ preventScroll: true });
      }
      return;
    }
    if (intent.target === "settings-control") {
      const owner =
        state?.geometry.mode === "narrow"
          ? ".workspace-narrow-row"
          : state?.geometry.rail
            ? ".workspace-rail"
            : ".workspace-explorer-footer";
      root.current
        ?.querySelector<HTMLElement>(`${owner} [data-workspace-command="settings.open"]`)
        ?.focus({ preventScroll: true });
      return;
    }
    const element =
      intent.target === "focus-control"
        ? controls.current.focus
        : intent.target === "panel-control"
          ? controls.current[intent.panel]
          : headings.current[intent.panel];
    element?.focus({ preventScroll: true });
  }, [state, zoom]);
  useLayoutEffect(() => {
    if (!focusDocument || !state?.geometry.visible.documents) return;
    setFocusDocument(undefined);
    if (focusDocument !== selectedTab) return;
    const tab = selectedTabRef.current;
    if (
      tab &&
      !tab.closest("[hidden], [inert]") &&
      (focusDocument !== "memory" ||
        !tab.closest(".workspace-documents")?.contains(document.activeElement))
    )
      tab.focus();
  }, [focusDocument, selectedTab, state]);

  const revealedProject = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const layout = controller.current;
    if (
      !revealProjectChat ||
      !projectScope ||
      revealedProject.current === projectScope ||
      !layout ||
      state?.initializing ||
      preferences.busy
    )
      return;
    revealedProject.current = projectScope;
    if (layout.state.geometry.mode === "narrow") layout.select("chat");
    else if (!layout.state.geometry.visible.chat) layout.visibility("chat");
  }, [revealProjectChat, projectScope, state, preferences]);
  const focusedProject = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      !revealProjectChat ||
      !projectScope ||
      focusedProject.current === projectScope ||
      revealedProject.current !== projectScope ||
      !state?.geometry.visible.chat
    )
      return;
    focusedProject.current = projectScope;
    onComposerFocus?.();
  }, [revealProjectChat, projectScope, state, onComposerFocus]);
  const revealedChatRequest = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const layout = controller.current;
    if (
      !revealChatRequest ||
      revealChatRequest === revealedChatRequest.current ||
      !layout ||
      state?.initializing ||
      preferences.busy
    )
      return;
    revealedChatRequest.current = revealChatRequest;
    if (layout.state.geometry.mode === "narrow") layout.select("chat");
    else if (!layout.state.geometry.visible.chat) layout.visibility("chat");
  }, [revealChatRequest, state, preferences]);
  const focusedChatRequest = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      !revealChatRequest ||
      revealedChatRequest.current !== revealChatRequest ||
      focusedChatRequest.current === revealChatRequest ||
      !state?.geometry.visible.chat
    )
      return;
    focusedChatRequest.current = revealChatRequest;
    onComposerFocus?.();
  }, [revealChatRequest, state, onComposerFocus]);
  const projectLabel = projectScope
    ? project
      ? project.setupConfirmedAt
        ? (project.title ?? "")
        : text("setup.context")
      : undefined
    : text("workspace.noProject");
  const projectLanguage = project?.setupConfirmedAt ? (project.documentLanguage ?? "") : locale;
  const geometry = state?.geometry;
  const narrow = geometry?.mode === "narrow";
  const layout = controller.current;
  const mainPanel = geometry?.visible.documents
    ? "documents"
    : (workspacePanels.find((panel) => geometry?.visible[panel]) ?? "documents");
  const zoomIndicator =
    zoom !== undefined && zoom !== 100 ? (
      <ShortcutControl
        id="zoom.reset"
        commands={commands}
        locale={locale}
        icon="zoom-in"
        text
        controlRef={zoomControlRef}
        displayText={formatNumber(locale, zoom / 100, {
          style: "percent",
          maximumFractionDigits: 0,
        })}
        label={message(locale, "workspace.zoom", {
          percent: formatNumber(locale, zoom / 100, { style: "percent", maximumFractionDigits: 0 }),
        })}
      />
    ) : undefined;
  const chatVisible = available && !!geometry?.visible.chat;
  useLayoutEffect(() => {
    onChatVisibility?.(chatVisible);
  }, [chatVisible, onChatVisibility]);
  const panelControl = (panel: WorkspacePanel, compact: boolean, registerRef = true) => (
    <ShortcutControl
      id={`panels.${panel}`}
      commands={commands}
      locale={locale}
      icon={panelIcons[panel]}
      label={
        narrow
          ? text(panel === "explorer" ? "workspace.contents" : panelKeys[panel])
          : text(actionKeys[panel][geometry?.visible[panel] ? 1 : 0])
      }
      {...(panel === "chat" && !chatVisible && chatActivity ? { activity: chatActivity } : {})}
      controls={panelId(panel)}
      expanded={!!geometry?.visible[panel]}
      pressed={!!geometry?.visible[panel]}
      text={!compact}
      {...(registerRef
        ? {
            controlRef: (element: HTMLButtonElement | null) => {
              if (element) controls.current[panel] = element;
              else controls.current[panel] = undefined;
            },
          }
        : {})}
      onUnavailable={() => {
        if (commands.entry(`panels.${panel}`).reason === "last_panel") setLastPanel(true);
      }}
    />
  );
  const settings = (compact: boolean) => (
    <ShortcutControl
      id="settings.open"
      commands={commands}
      locale={locale}
      icon="settings"
      text={!compact}
      hint={!compact}
    />
  );
  const sizingControls = (panel: WorkspacePanel) =>
    !narrow && geometry && geometry.pairs.length > 0 ? (
      <div
        className="workspace-sizing"
        role="group"
        aria-label={panel === "chat" && chatTitle ? chatTitle : text(panelKeys[panel])}
      >
        {[false, true].map((increase) => (
          <Tooltip
            key={String(increase)}
            label={[
              message(locale, increase ? "workspace.increase" : "workspace.reduce", {
                panel: text(panelKeys[panel]),
              }),
              state.initializing || preferences.busy ? text("command.reason.busy") : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <button
              type="button"
              data-workspace-size={panel}
              aria-label={message(locale, increase ? "workspace.increase" : "workspace.reduce", {
                panel: text(panelKeys[panel]),
              })}
              aria-disabled={state.initializing || preferences.busy}
              aria-describedby={
                state.initializing || preferences.busy
                  ? `${id}-size-${panel}-${String(increase)}`
                  : undefined
              }
              onClick={() => {
                layout?.size(panel, increase);
              }}
            >
              {increase ? "+" : "−"}
              {(state.initializing || preferences.busy) && (
                <span
                  className="primitive-announcement"
                  id={`${id}-size-${panel}-${String(increase)}`}
                >
                  {text("command.reason.busy")}
                </span>
              )}
            </button>
          </Tooltip>
        ))}
      </div>
    ) : null;
  return (
    <div
      ref={root}
      className="workspace"
      data-mode={narrow ? "narrow" : "wide"}
      data-dragging={!!state?.dragging}
      lang={locale}
      onKeyDown={(event) => {
        if (event.key === "Escape" && state?.dragging) {
          event.preventDefault();
          layout?.cancelResize("escape");
        }
      }}
    >
      <Dialog
        open={!!pendingClose && pendingManuscript}
        title={text("manuscript.pending")}
        closeLabel={text("manuscript.keepOpen")}
        closePlacement="footer"
        closeDisabled={closingManuscript}
        onClose={() => {
          setPendingClose(undefined);
        }}
        footer={
          <>
            <button
              type="button"
              className="primitive-button"
              disabled={closingManuscript || !manuscriptDrafts.canDiscard}
              onClick={() => {
                void finishManuscriptClose(true).catch(() => {});
              }}
            >
              {text("manuscript.discardClose")}
            </button>
            {manuscriptSelected && manuscriptDrafts.count === 1 && !!saveForClose.current && (
              <button
                type="button"
                className="primitive-button primitive-primary"
                disabled={closingManuscript}
                onClick={() => {
                  void finishManuscriptClose(false).catch(() => {});
                }}
              >
                {text("manuscript.saveClose")}
              </button>
            )}
          </>
        }
      >
        <p>{text("manuscript.closeExplanation")}</p>
      </Dialog>
      <a
        ref={fallbackFocusRef}
        className="workspace-skip"
        href={`#${panelId(mainPanel)}`}
        onClick={(event) => {
          event.preventDefault();
          headings.current[mainPanel]?.focus({ preventScroll: true });
        }}
      >
        {text("workspace.skip")}
      </a>
      <header className="workspace-bar" aria-label={text("workspace.context")}>
        <div
          className="workspace-title-row"
          style={{
            marginInlineStart: `max(env(titlebar-area-x, 0px), ${String(windowInsets.start)}px)`,
            inlineSize: `min(env(titlebar-area-width, 100%), calc(100% - ${String(windowInsets.start + windowInsets.end)}px))`,
            minBlockSize:
              "max(var(--component-workspace-context-bar-minimum), env(titlebar-area-height, 0px))",
          }}
        >
          {commands.context.platform !== "darwin" && (
            <ShortcutControl id="menu.open" commands={commands} locale={locale} icon="menu" />
          )}
          <OhtiaBrand />
          <div className="workspace-project-controls">
            {projectSelector ??
              (projectLabel !== undefined && (
                <Tooltip
                  className="workspace-context-tooltip"
                  label={projectLabel}
                  language={projectLanguage}
                >
                  <bdi className="workspace-project-context" lang={projectLanguage}>
                    {projectLabel}
                  </bdi>
                </Tooltip>
              ))}
            {project?.setupConfirmedAt && (
              <ShortcutControl
                id="project.rename"
                commands={commands}
                locale={locale}
                icon="pencil"
              />
            )}
            <ShortcutControl id="project.new" commands={commands} locale={locale} icon="plus" />
          </div>
          <span className="workspace-drag-space" aria-hidden="true" />
          {newerVersion && (
            <ShortcutControl
              id="update.check"
              commands={commands}
              locale={locale}
              icon="download"
              label={message(locale, "update.button", { version: newerVersion })}
            />
          )}
          {!narrow && zoomIndicator}
          {!narrow && (
            <div
              className="workspace-panel-controls"
              role="group"
              aria-label={text("workspace.panels")}
            >
              {workspacePanels.map((panel) => (
                <Fragment key={panel}>{panelControl(panel, true)}</Fragment>
              ))}
            </div>
          )}
          {!narrow && (
            <ShortcutControl
              id="document.focus"
              commands={commands}
              locale={locale}
              icon={state?.focusMode ? "minimize-2" : "maximize-2"}
              label={text(state?.focusMode ? "workspace.restore" : "command.document.focus")}
              text={!!state?.focusMode}
              controlRef={(element) => {
                if (element) controls.current.focus = element;
                else delete controls.current.focus;
              }}
            />
          )}
        </div>
        {narrow && (
          <div className="workspace-narrow-row">
            {zoomIndicator}
            <div className="workspace-selector" role="group" aria-label={text("workspace.panels")}>
              {workspacePanels.map((panel) => (
                <Fragment key={panel}>{panelControl(panel, false)}</Fragment>
              ))}
            </div>
            {settings(true)}
          </div>
        )}
      </header>
      {projectNotice}
      {layoutFailure && (
        <div className="workspace-notice workspace-danger" role="alert">
          <LucideGlyph name="octagon-alert" size={16} />
          <span>{text("workspace.notRemembered")}</span>
          <button type="button" onClick={onDismissLayoutFailure}>
            {text("workspace.dismiss")}
          </button>
        </div>
      )}
      {lastPanel && (
        <div className="workspace-notice workspace-attention" role="status">
          <LucideGlyph name="triangle-alert" size={16} />
          <span>{text("command.reason.last_panel")}</span>
        </div>
      )}
      {state?.persistence.save.state === "uncertain" && (
        <div className="workspace-notice workspace-attention" role="status">
          <LucideGlyph name="triangle-alert" size={16} />
          <span>{text("workspace.uncertain")}</span>
          <button
            type="button"
            onClick={() => {
              void preferences.reconcile();
            }}
          >
            {text("workspace.check")}
          </button>
        </div>
      )}
      <main className="workspace-regions" aria-label={text("workspace.regions")}>
        {!geometry?.visible.documents && (
          <h1 className="primitive-announcement">{text("workspace.regions")}</h1>
        )}
        {!narrow && geometry?.rail !== 0 && (
          <aside
            className="workspace-rail"
            aria-label={text("command.panels.explorer")}
            style={{ inlineSize: geometry?.rail }}
          >
            {panelControl("explorer", true, false)}
            <div className="workspace-rail-bottom">{settings(true)}</div>
          </aside>
        )}
        {workspacePanels.map((panel) => {
          const pair = geometry?.pairs.find(([left]) => left === panel);
          const heading = (
            <h2
              id={`${panelId(panel)}-heading`}
              ref={(element) => {
                if (element) headings.current[panel] = element;
                else headings.current[panel] = undefined;
              }}
              tabIndex={-1}
              className={
                panel === "documents" || (panel === "chat" && replaceChatHeading)
                  ? "primitive-announcement"
                  : "workspace-panel-heading"
              }
            >
              {panel === "chat" && chatTitle ? chatTitle : text(panelKeys[panel])}
            </h2>
          );
          return (
            <Fragment key={panel}>
              <section
                className={`workspace-panel workspace-${panel}`}
                id={panelId(panel)}
                data-workspace-panel={panel}
                data-chat-compact={
                  panel === "chat" &&
                  geometry &&
                  geometry.widths.chat <= designMetrics["component.workspace.chat.minimum"]
                    ? true
                    : undefined
                }
                hidden={!geometry?.visible[panel]}
                inert={!geometry?.visible[panel]}
                aria-labelledby={`${panelId(panel)}-heading`}
                style={{ inlineSize: geometry?.widths[panel] }}
              >
                {panel === "chat" ? (
                  <div
                    className={`workspace-chat-heading${chatHeadingStart || chatHeadingActions ? " with-conversation-controls" : ""}`}
                  >
                    {chatHeadingStart}
                    {heading}
                    {chatHeadingActions}
                    {sizingControls(panel)}
                  </div>
                ) : (
                  heading
                )}
                {panel === "documents" ? (
                  <Tabs
                    label={text("command.panels.documents")}
                    className="workspace-document-tabs"
                    listClassName="workspace-tabs"
                    panelClassName="workspace-panel-scroll"
                    items={[
                      {
                        id: "navigator",
                        label: text("workspace.navigator"),
                        icon: <LucideGlyph name="signpost" size={16} />,
                        content: projectScope ? (
                          project && (
                            <p className="workspace-empty workspace-setup">
                              {text(
                                project.setupConfirmedAt
                                  ? "setup.navigatorConfirmed"
                                  : "setup.navigator",
                              )}
                            </p>
                          )
                        ) : (
                          <div className="workspace-welcome">
                            {decoration !== "hidden" && <ProductCharacter />}
                            <h1 data-type="type.ui.display">{text("workspace.welcome")}</h1>
                            <p>
                              {text(
                                hasProjects ? "project.chooseWelcome" : "workspace.welcomeText",
                              )}
                            </p>
                            <div className="workspace-welcome-actions">
                              <ShortcutControl
                                id="project.new"
                                commands={commands}
                                locale={locale}
                                icon="plus"
                                text
                                primary
                              />
                              <ShortcutControl
                                id="settings.open"
                                commands={commands}
                                locale={locale}
                                icon="settings"
                                text
                                label={text("workspace.openSettings")}
                              />
                              <ShortcutControl
                                id="shortcuts.open"
                                commands={commands}
                                locale={locale}
                                icon="keyboard"
                                text
                              />
                              <ShortcutControl
                                id="about.open"
                                commands={commands}
                                locale={locale}
                                text
                              />
                            </div>
                          </div>
                        ),
                      },
                      ...(manuscriptTab
                        ? [
                            {
                              id: "manuscript",
                              label: text("manuscript.collection"),
                              icon: <LucideGlyph name="file-text" size={16} />,
                              panelClassName: "workspace-manuscript-surface",
                              content: primary ? (
                                <ManuscriptView
                                  key={primary.draftId}
                                  locale={locale}
                                  scope={manuscripts.verifiedScope}
                                  waitingForCollection={manuscripts.status === "loading"}
                                  canPresent={manuscripts.canPresent}
                                  port={manuscriptPort}
                                  manuscript={primary}
                                  visible={
                                    available && !!geometry?.visible.documents && manuscriptSelected
                                  }
                                  onCommit={onManuscriptVisibility}
                                  onOutline={onOutline}
                                  jump={jump}
                                  drafts={manuscriptDrafts}
                                  onWriting={setWritingManuscript}
                                  onSaveForClose={setSaveForClose}
                                  locked={!!manuscriptLock}
                                />
                              ) : (
                                <div className="workspace-manuscript">
                                  <p role="status">
                                    {text(
                                      manuscripts.status === "loading"
                                        ? "project.loading"
                                        : manuscripts.status === "ready"
                                          ? "manuscript.none"
                                          : manuscripts.status === "failed"
                                            ? "manuscript.listFailed"
                                            : "manuscript.unavailable",
                                    )}
                                  </p>
                                  {manuscripts.status === "ready" && (
                                    <button
                                      type="button"
                                      className="primitive-button"
                                      onClick={() => {
                                        void createPrimary();
                                      }}
                                    >
                                      {text("manuscript.create")}
                                    </button>
                                  )}
                                  {createFailed === projectScope && (
                                    <p role="status">{text("manuscript.createFailed")}</p>
                                  )}
                                </div>
                              ),
                            },
                          ]
                        : []),
                      ...(memoryOpen
                        ? [
                            {
                              id: "memory",
                              label: text("memory.title"),
                              icon: <LucideGlyph name="notebook-text" size={16} />,
                              content: memory,
                            },
                          ]
                        : []),
                    ]}
                    selected={selectedTab}
                    onSelect={(tab) => {
                      setDocuments((previous) =>
                        previous.projectId === projectScope
                          ? { ...previous, selected: tab }
                          : previous,
                      );
                    }}
                    selectedTabRef={selectedTabRef}
                  />
                ) : (
                  <div
                    className="workspace-panel-scroll"
                    role="region"
                    aria-labelledby={`${panelId(panel)}-heading`}
                    tabIndex={0}
                  >
                    {panel === "explorer" && collections ? (
                      <ProjectExplorer
                        collections={collections}
                        project={project}
                        locale={locale}
                        memoryAvailable={!!memory}
                        memorySelected={memorySelected}
                        openMemory={openMemory}
                        manuscripts={manuscriptPort ? manuscripts : undefined}
                        manuscriptSelected={manuscriptSelected}
                        headings={activeOutline?.headings}
                        activeHeading={activeOutline?.activeHeading}
                        headingLanguage={activeOutline?.language}
                        openManuscript={openManuscript}
                        revealChat={() => controller.current?.reveal("chat")}
                      />
                    ) : panel === "explorer" && memory ? (
                      <>
                        <button
                          type="button"
                          className="workspace-memory-entry primitive-button primitive-quiet"
                          aria-current={memorySelected || undefined}
                          onClick={openMemory}
                        >
                          <LucideGlyph name="notebook-text" size={16} />
                          {text("memory.title")}
                        </button>
                        <p className="workspace-empty workspace-memory-empty">
                          <LucideGlyph name={panelIcons.explorer} size={20} />
                          {text("setup.explorer")}
                        </p>
                      </>
                    ) : panel === "chat" && chat ? (
                      chat
                    ) : (
                      <p className="workspace-empty">
                        <LucideGlyph name={panelIcons[panel]} size={20} />
                        {text(
                          panel === "explorer"
                            ? projectScope
                              ? "setup.explorer"
                              : "workspace.explorerEmpty"
                            : hasProjects
                              ? "project.chooseChat"
                              : "workspace.chatEmpty",
                        )}
                      </p>
                    )}
                  </div>
                )}
                {panel === "explorer" && (
                  <footer className="workspace-explorer-footer">{settings(false)}</footer>
                )}
                {panel !== "chat" && sizingControls(panel)}
              </section>
              {pair && layout && state && (
                <WorkspaceSplitter
                  left={pair[0]}
                  right={pair[1]}
                  state={state}
                  controller={layout}
                  locale={locale}
                  leftId={panelId(pair[0])}
                  rightId={panelId(pair[1])}
                />
              )}
            </Fragment>
          );
        })}
      </main>
    </div>
  );
}

function WorkspaceSplitter({
  left,
  right,
  state,
  controller,
  locale,
  leftId,
  rightId,
}: {
  left: WorkspacePanel;
  right: WorkspacePanel;
  state: WorkspaceState;
  controller: WorkspaceController;
  locale: InterfaceLocale;
  leftId: string;
  rightId: string;
}) {
  const range = separatorRange(state.geometry, left, right);
  if (!range) throw new Error("Workspace separator has no adjacent pair.");
  const number = (value: number) => formatNumber(locale, value, { maximumFractionDigits: 0 });
  const widths = message(locale, "workspace.widths", {
    left: message(locale, panelKeys[left]),
    right: message(locale, panelKeys[right]),
    leftWidth: number(range.current),
    rightWidth: number(state.geometry.widths[right]),
  });
  const minimum =
    range.current === range.minimum ? left : range.current === range.maximum ? right : undefined;
  const hint = minimum
    ? message(locale, "workspace.minimum", {
        panel: message(locale, panelKeys[minimum]),
        width: number(state.geometry.widths[minimum]),
      })
    : widths;
  const busy =
    state.initializing ||
    state.persistence.save.state === "submitting" ||
    state.persistence.save.state === "uncertain";
  const reasonId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | undefined>(undefined);
  const lock = useRef<{ cursor: string; selection: string } | undefined>(undefined);
  return (
    <div className="workspace-splitter-slot">
      <Tooltip label={busy ? `${hint} · ${message(locale, "command.reason.busy")}` : hint}>
        <div
          ref={ref}
          className="workspace-splitter"
          data-separator-left={left}
          data-separator-right={right}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={message(locale, "workspace.separator", {
            left: message(locale, panelKeys[left]),
            right: message(locale, panelKeys[right]),
          })}
          aria-controls={`${leftId} ${rightId}`}
          aria-valuemin={range.minimum}
          aria-valuemax={range.maximum}
          aria-valuenow={range.current}
          aria-valuetext={widths}
          aria-disabled={busy}
          aria-describedby={busy ? reasonId : undefined}
          data-minimum={minimum ? (minimum === left ? "left" : "right") : undefined}
          onDoubleClick={() => {
            controller.pairReset(left, right);
          }}
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              event.nativeEvent.isComposing ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey
            )
              return;
            const key = event.key;
            if (key === "Escape" && state.dragging) {
              event.preventDefault();
              event.stopPropagation();
              controller.cancelResize("escape");
              return;
            }
            if (
              key === "ArrowLeft" ||
              key === "ArrowRight" ||
              key === "Home" ||
              key === "End" ||
              key === "Enter"
            ) {
              event.preventDefault();
              controller.key(left, right, key, event.shiftKey);
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            const target = event.currentTarget;
            const accepted = controller.beginResize(left, right, event.pointerId, event.clientX, {
              capture: (pointer) => {
                target.setPointerCapture(pointer);
              },
              release: (pointer) => {
                if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
              },
              lock: () => {
                lock.current = {
                  cursor: document.body.style.cursor,
                  selection: document.body.style.userSelect,
                };
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              },
              unlock: () => {
                if (lock.current) {
                  document.body.style.cursor = lock.current.cursor;
                  document.body.style.userSelect = lock.current.selection;
                  lock.current = undefined;
                  activePointer.current = undefined;
                }
              },
            });
            if (accepted) {
              activePointer.current = event.pointerId;
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
          onPointerMove={(event) => {
            controller.moveResize(event.pointerId, event.clientX);
          }}
          onPointerUp={(event) => {
            controller.endResize(event.pointerId);
          }}
          onPointerCancel={(event) => {
            if (event.pointerId === activePointer.current) controller.cancelResize("pointercancel");
          }}
          onLostPointerCapture={(event) => {
            if (event.pointerId === activePointer.current) controller.cancelResize("pointercancel");
          }}
          onBlur={() => {
            // A drag started on the other separator focuses it after the shared controller
            // has accepted that gesture, so only this separator's own gesture ends here.
            if (activePointer.current !== undefined) controller.cancelResize("focus-loss");
          }}
        >
          {busy && (
            <span className="primitive-announcement" id={reasonId}>
              {message(locale, "command.reason.busy")}
            </span>
          )}
          <span className="workspace-splitter-line" aria-hidden="true" />
          <span className="workspace-grip" aria-hidden="true">
            <LucideGlyph name="grip-vertical" size={16} />
          </span>
        </div>
      </Tooltip>
    </div>
  );
}
