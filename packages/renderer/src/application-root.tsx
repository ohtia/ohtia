import { useId, useSyncExternalStore } from "react";
import { ProjectController } from "./project-controller.js";
import { ProjectSelector } from "./project-selector.js";
import { NewProjectController } from "./new-project-controller.js";
import { Dialog } from "./layers.js";
import { ConversationController } from "./conversation-controller.js";
import { ConversationView } from "./conversation-view.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  message,
  type SimpleMessageKey,
  type LocaleSnapshot,
  type BootstrapSnapshot,
  type DesktopBridge,
  type FoundationStatus,
  type PortCall,
} from "@ohtia/contracts";
import { ShortcutControl } from "./workspace-chrome.js";
import { CommandButton } from "./command-surfaces.js";
import { SettingsSurfaces } from "./settings-surfaces.js";
import { OhtiaBrand } from "./branding.js";
import { WorkspaceChrome } from "./workspace-chrome.js";
import { SystemMotionProvider } from "./system-motion.js";

declare global {
  interface Window {
    readonly ohtia: DesktopBridge;
  }
}
function bootstrapFailure(state: string | undefined): boolean {
  return (
    !!state &&
    (state.startsWith("locator_") ||
      [
        "path_rejected",
        "storage_failed",
        "recovery_required",
        "retry_required",
        "publication_uncertain",
      ].includes(state))
  );
}
function anotherProjectModalOpen(): boolean {
  return !!document.querySelector("dialog[open]:not(.new-project-dialog):not(.new-project-error)");
}
export function ApplicationRoot({ bridge }: { readonly bridge: DesktopBridge }) {
  return (
    <SystemMotionProvider source={bridge.system}>
      <ApplicationContent bridge={bridge} />
    </SystemMotionProvider>
  );
}
function ApplicationContent({ bridge }: { readonly bridge: DesktopBridge }) {
  const conversation = useMemo(
    () => new ConversationController(bridge.foundation),
    [bridge.foundation],
  );
  const conversationState = useSyncExternalStore(conversation.subscribe, conversation.snapshot);
  const [createdProject, setCreatedProject] = useState<string>();
  const projects = useMemo(
    () =>
      new ProjectController(bridge.foundation, (scope) => {
        setCreatedProject(undefined);
        conversation.open(scope);
      }),
    [bridge.foundation, conversation],
  );
  const projectState = useSyncExternalStore(projects.subscribe, projects.snapshot);
  useEffect(
    () =>
      conversation.observe((notice) => {
        if (
          notice !== "ready" &&
          notice.ok &&
          notice.value.kind === "changed" &&
          notice.value.record === "project"
        )
          projects.noteProject();
      }),
    [conversation, projects],
  );
  useEffect(() => {
    projects.remember(conversationState.scope);
  }, [projects, conversationState.scope]);
  useEffect(
    () => () => {
      projects.dispose();
    },
    [projects],
  );
  const newProject = useMemo(
    () =>
      new NewProjectController(
        bridge.foundation,
        (scope, revision) => {
          if (projects.adopt(scope, revision)) setCreatedProject(scope.projectId ?? undefined);
        },
        undefined,
        undefined,
        projects.beginCreation,
      ),
    [bridge.foundation, projects],
  );
  const activeProject =
    conversationState.project ?? projects.project(conversationState.scope.projectId);
  const projectDescriptionId = useId();
  const newProjectState = useSyncExternalStore(newProject.subscribe, newProject.snapshot);
  const [projectDialogBlocked, setProjectDialogBlocked] = useState(false);
  useLayoutEffect(() => {
    if (newProjectState.dialog === null) return;
    const update = () => {
      setProjectDialogBlocked(anotherProjectModalOpen());
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["open"],
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
    };
  }, [newProjectState.dialog]);
  useEffect(
    () => () => {
      newProject.dispose();
    },
    [newProject],
  );
  const [bootstrap, setBootstrap] = useState<BootstrapSnapshot>();
  const bootstrapSelection = useMemo(
    () => ({ restored: false, revision: 0, previousReady: null as BootstrapSnapshot | null }),
    [bridge],
  );
  useEffect(() => {
    if (bootstrap?.state !== "storage_ready") {
      bootstrapSelection.previousReady = null;
      return;
    }
    const previous = bootstrapSelection.previousReady;
    const recovered =
      bootstrapSelection.restored &&
      (!previous || previous.serviceGeneration !== bootstrap.serviceGeneration);
    bootstrapSelection.previousReady = bootstrap;
    const navigation = bootstrap.navigateConversation;
    const explicit =
      bootstrapSelection.restored &&
      navigation &&
      navigation.revision > bootstrapSelection.revision;
    const current = conversation.snapshot().scope;
    const scope = explicit
      ? { projectId: navigation.projectId, conversationId: navigation.conversationId }
      : !bootstrapSelection.restored
        ? bootstrap.openConversation
        : undefined;
    if (navigation)
      bootstrapSelection.revision = Math.max(bootstrapSelection.revision, navigation.revision);
    bootstrapSelection.restored = true;
    if (scope) projects.adopt(scope);
    else {
      const acknowledged =
        bootstrap.openConversation?.projectId === current.projectId &&
        bootstrap.openConversation.conversationId === current.conversationId;
      if (acknowledged) projects.remember(current);
      // A replaced service may never have acknowledged the renderer's active scope.
      if (recovered || !current.projectId) conversation.open(current);
      else if (acknowledged) conversation.refreshProject();
    }
    void projects.initialize((bootstrap.restoreLastProject ?? false) && !scope);
  }, [
    conversation,
    projects,
    bootstrapSelection,
    bootstrap?.navigateConversation?.revision,
    bootstrap?.navigateConversation?.projectId,
    bootstrap?.navigateConversation?.conversationId,
    bootstrap?.restoreLastProject,
    bootstrap?.serviceGeneration,
    bootstrap?.state,
    bootstrap?.openConversation?.projectId,
    bootstrap?.openConversation?.conversationId,
  ]);
  useEffect(
    () => () => {
      conversation.dispose();
    },
    [conversation],
  );
  const [status, setStatus] = useState<FoundationStatus["service"]>("starting");
  const [busy, setBusy] = useState(false);
  const commandReturn = useRef<HTMLButtonElement | null>(null);
  const workspaceReturn = useRef<HTMLAnchorElement | null>(null);
  const workspaceMounted = useRef(false);
  const pendingWorkspaceFocus = useRef(false);
  const returnFocus = useMemo(
    () => ({
      get current() {
        const workspace = workspaceReturn.current;
        return workspace && !workspace.closest("[hidden], [inert]")
          ? workspace
          : commandReturn.current;
      },
    }),
    [],
  );
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState(0);
  const notice = useRef<HTMLParagraphElement>(null);
  const appliedLocale = useRef<LocaleSnapshot | undefined>(undefined);
  const prepareWorkspaceFocus = (next: BootstrapSnapshot) => {
    if (
      next.state === "storage_ready" &&
      document.activeElement?.closest("[data-bootstrap-surface]")
    )
      pendingWorkspaceFocus.current = true;
  };
  useLayoutEffect(() => {
    if (!pendingWorkspaceFocus.current || !workspaceReturn.current) return;
    pendingWorkspaceFocus.current = false;
    if (!document.querySelector("dialog[open]")) workspaceReturn.current.focus();
  });
  const applyLocale = useRef((snapshot: LocaleSnapshot) => {
    if (
      appliedLocale.current?.serviceGeneration === snapshot.serviceGeneration &&
      snapshot.record.revision < appliedLocale.current.record.revision
    )
      return;
    appliedLocale.current = snapshot;
    document.documentElement.lang = snapshot.effectiveLocale;
    document.title = message(snapshot.effectiveLocale, "title");
    setBootstrap((current) =>
      current ? { ...current, locale: snapshot.effectiveLocale } : current,
    );
  });
  useEffect(() => {
    let disposed = false;
    const isDisposed = () => disposed;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let call: PortCall<FoundationStatus> | undefined;
    async function poll() {
      call = bridge.foundation.readStatus();
      const result = await call.result;
      if (isDisposed()) return;
      const next = await bridge.bootstrap.read();
      if (isDisposed()) return;
      setStatus(
        next.state === "storage_opening"
          ? "starting"
          : result.ok
            ? result.value.service
            : "unavailable",
      );
      if (!appliedLocale.current) {
        document.documentElement.lang = next.locale;
        document.title = message(next.locale, "title");
      }
      prepareWorkspaceFocus(next);
      setBootstrap((current) =>
        !appliedLocale.current || !current ? next : { ...next, locale: current.locale },
      );
      timer = setTimeout(() => {
        void poll();
      }, 1000);
    }
    void bridge.bootstrap.read().then((value) => {
      if (isDisposed()) return;
      document.documentElement.lang = value.locale;
      document.title = message(value.locale, "title");
      setBootstrap(value);
      void poll();
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      call?.cancel();
    };
  }, [bridge]);
  const locationNotice = bootstrap?.notice === "locale_fallback" ? undefined : bootstrap?.notice;
  useEffect(() => {
    if (
      (failed || bootstrapFailure(bootstrap?.state) || locationNotice) &&
      !document.querySelector("dialog[open]")
    )
      notice.current?.focus();
  }, [failed, bootstrap?.state, locationNotice, announcement]);
  if (!bootstrap) return null;
  if (bootstrap.state === "storage_ready") workspaceMounted.current = true;
  const workspaceReady = bootstrap.state === "storage_ready";
  const text = (key: SimpleMessageKey) => message(bootstrap.locale, key);
  async function action(method: keyof DesktopBridge["bootstrap"], trigger: HTMLButtonElement) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const focusOutcome =
      method === "openStorage" || method === "restoreCheckpoint" || method === "retryService";
    try {
      const value = await bridge.bootstrap[method]();
      prepareWorkspaceFocus(value);
      flushSync(() => {
        if (!appliedLocale.current) {
          document.documentElement.lang = value.locale;
          document.title = message(value.locale, "title");
        }
        setBootstrap((current) =>
          appliedLocale.current && current ? { ...value, locale: current.locale } : value,
        );
      });
      if (bootstrapFailure(value.state) || value.notice) setAnnouncement((value) => value + 1);
      else if (focusOutcome) {
        const target = value.state === "storage_ready" ? workspaceReturn.current : notice.current;
        target?.focus();
      } else trigger.focus();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-window foundation-window">
      <SettingsSurfaces
        research={conversation}
        newProject={newProject}
        composeWorkspace={workspaceMounted.current}
        bridge={bridge.commands}
        port={bridge.foundation}
        locale={bootstrap.locale}
        available={bootstrap.state === "storage_ready"}
        onLocale={applyLocale.current}
        returnFocusRef={returnFocus}
      >
        {(commands, binding, openConnections) => (
          <>
            <Dialog
              role={newProjectState.dialog === "failed" ? "alertdialog" : "dialog"}
              descriptionId={projectDescriptionId}
              open={newProjectState.dialog !== null && !projectDialogBlocked}
              title={text(
                newProjectState.dialog === "connection"
                  ? "project.connectTitle"
                  : newProjectState.dialog === "openingFailed"
                    ? "project.openFailedTitle"
                    : newProjectState.dialog === "uncertain"
                      ? "project.createUncertainTitle"
                      : "project.createFailedTitle",
              )}
              closeLabel={text("dialog.close")}
              closePlacement="footer"
              closeDisabled={newProjectState.busy}
              onClose={() => {
                if (!anotherProjectModalOpen()) newProject.close();
              }}
              returnFocusRef={returnFocus}
              className={
                newProjectState.dialog === "failed" ? "new-project-error" : "new-project-dialog"
              }
              footer={
                <button
                  type="button"
                  className="primitive-button primitive-primary"
                  aria-disabled={newProjectState.busy}
                  onClick={() => {
                    if (newProjectState.busy) return;
                    if (newProjectState.dialog === "connection") {
                      newProject.close();
                      openConnections();
                    } else void newProject.start();
                  }}
                >
                  {text(
                    newProjectState.dialog === "connection"
                      ? "taskNotice.openConnections"
                      : "taskNotice.tryAgain",
                  )}
                </button>
              }
            >
              <p id={projectDescriptionId}>
                {text(
                  newProjectState.dialog === "connection"
                    ? "project.connectBody"
                    : newProjectState.dialog === "openingFailed"
                      ? "project.openFailedBody"
                      : newProjectState.dialog === "uncertain"
                        ? "project.createUncertainBody"
                        : "project.createFailedBody",
                )}
              </p>
            </Dialog>
            {workspaceMounted.current && commands && (
              <div
                className="application-workspace"
                hidden={!workspaceReady}
                inert={!workspaceReady}
              >
                <WorkspaceChrome
                  {...binding}
                  projectSelector={
                    <ProjectSelector
                      controller={projects}
                      state={projectState}
                      current={activeProject}
                      currentId={conversationState.scope.projectId}
                      currentFailed={
                        conversationState.status === "failed" ||
                        conversationState.status === "unavailable"
                      }
                      locale={bootstrap.locale}
                    />
                  }
                  hasProjects={projectState.hasProjects}
                  project={activeProject}
                  projectScope={conversationState.scope.projectId ?? undefined}
                  revealProjectChat={createdProject === conversationState.scope.projectId}
                  onComposerFocus={conversation.composer.focus}
                  chat={
                    conversationState.scope.conversationId ? (
                      <ConversationView
                        state={conversationState}
                        controller={conversation}
                        onOpenConnections={openConnections}
                        commands={bridge.commands}
                        locale={bootstrap.locale}
                      />
                    ) : undefined
                  }
                  chatTitle={
                    conversationState.conversation
                      ? (conversationState.conversation.title ??
                        new Intl.DateTimeFormat(bootstrap.locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(conversationState.conversation.createdAt)))
                      : undefined
                  }
                  commands={commands}
                  available={workspaceReady}
                  locale={bootstrap.locale}
                  windowInsets={{ start: 0, end: 0 }}
                  fallbackFocusRef={workspaceReturn}
                />
              </div>
            )}
            <header
              data-bootstrap-surface
              hidden={workspaceReady}
              className="workspace-bar foundation-titlebar"
            >
              <div className="workspace-title-row foundation-title-row">
                {commands && commands.context.platform !== "darwin" && (
                  <ShortcutControl
                    id="menu.open"
                    commands={commands}
                    locale={bootstrap.locale}
                    icon="menu"
                  />
                )}
                <h1 id="title">
                  <OhtiaBrand />
                </h1>
                <span className="workspace-drag-space" aria-hidden="true" />
              </div>
            </header>
            <main data-bootstrap-surface hidden={workspaceReady} aria-labelledby="title">
              <p>{text("intro")}</p>
              <div
                className="actions command-entry-actions"
                ref={(element) => {
                  commandReturn.current =
                    element?.querySelector<HTMLButtonElement>(
                      '[data-command-id="settings.open"] button',
                    ) ?? null;
                }}
              >
                {(
                  [
                    "settings.open",
                    "help.open",
                    "about.open",
                    "window.new",
                    "application.quit",
                  ] as const
                ).map((id) => (
                  <CommandButton
                    key={id}
                    id={id}
                    locale={bootstrap.locale}
                    {...(commands ? { controller: commands } : {})}
                    onInvoke={(command) => {
                      void commands?.invoke(command);
                    }}
                  />
                ))}
              </div>
              <p role="status" aria-live="polite" aria-atomic="true">
                {text(
                  status === "ready"
                    ? "status_ready"
                    : status === "starting"
                      ? "status_starting"
                      : "status_unavailable",
                )}
              </p>
              <section aria-labelledby="location-title" aria-busy={busy}>
                <h2 id="location-title">{text("location")}</h2>
                <p
                  key={announcement}
                  id="location-state"
                  ref={notice}
                  tabIndex={-1}
                  role={
                    failed || locationNotice || bootstrapFailure(bootstrap.state)
                      ? "alert"
                      : "status"
                  }
                >
                  {text(failed ? "startup_failed" : (locationNotice ?? bootstrap.state))}
                </p>
                {bootstrap.state !== "storage_ready" && <p>{text("storage_disclosure")}</p>}
                {["pending_create", "located"].includes(bootstrap.state) && (
                  <button
                    type="button"
                    aria-disabled={busy}
                    onClick={(event) => {
                      void action("openStorage", event.currentTarget);
                    }}
                  >
                    {text("open_storage")}
                  </button>
                )}
                {bootstrap.state === "recovery_required" && (
                  <button
                    type="button"
                    aria-disabled={busy}
                    onClick={(event) => {
                      void action("restoreCheckpoint", event.currentTarget);
                    }}
                  >
                    {text("restore_checkpoint")}
                  </button>
                )}
              </section>
              <div className="actions">
                <button
                  type="button"
                  aria-disabled={busy || bootstrap.state === "storage_opening"}
                  onClick={(event) => {
                    if (bootstrap.state === "storage_opening") return;
                    void action("retryService", event.currentTarget);
                  }}
                >
                  {text("retry")}
                </button>
              </div>
            </main>
          </>
        )}
      </SettingsSurfaces>
    </div>
  );
}
