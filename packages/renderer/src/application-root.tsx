import { contributorNames } from "./contributor-identity.js";
import { useId, useSyncExternalStore } from "react";
import { latestProject, ProjectCollections, ProjectController } from "./project-controller.js";
import type { ProjectSelectionLease } from "./pending-project-work.js";
import { ProjectSelector } from "./project-selector.js";
import { ThesisProfileController } from "./thesis-profile-controller.js";
import { NewProjectController } from "./new-project-controller.js";
import { ProjectRename, ProjectRenameStatus } from "./project-rename.js";
import { Dialog } from "./layers.js";
import { ConversationController, knownConversationAgent } from "./conversation-controller.js";
import {
  ConversationHeaderButton,
  ConversationHistory,
  ConversationNameField,
  ConversationRenameNotice,
  conversationName,
} from "./conversation-history.js";
import { AgentBand } from "./agent-selector.js";
import { HandoffReturnControl } from "./handoff.js";
import {
  ProjectMemoryDrafts,
  ProjectMemoryView,
  type MemoryDraftSource,
} from "./project-memory-view.js";
import { ConversationView } from "./conversation-view.js";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  message,
  type SimpleMessageKey,
  type LocaleSnapshot,
  type ManuscriptRevision,
  type BootstrapSnapshot,
  type BootstrapNotice,
  type DesktopBridge,
  type FoundationStatus,
  type PortCall,
} from "@ohtia/contracts";
import { ShortcutControl } from "./workspace-chrome.js";
import { CommandButton } from "./command-surfaces.js";
import { SettingsSurfaces } from "./settings-surfaces.js";
import { CheckpointRecovery, checkpointStatus } from "./checkpoint-recovery.js";
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
  const [createdProject, setCreatedProject] = useState<string>();
  const [visibleManuscript, setVisibleManuscript] = useState<ManuscriptRevision | null>(null);
  const [memoryDrafts] = useState(() => new ProjectMemoryDrafts());
  const profileDrafts = useMemo(
    () => new Map<string, ThesisProfileController>(),
    [bridge.foundation],
  );
  const { collections, conversation, projects } = useMemo(() => {
    const conversation = new ConversationController(bridge.foundation, undefined, (scope) => {
      projects.rememberStarted(scope);
    });
    const projects = new ProjectController(bridge.foundation, (scope) => {
      setCreatedProject(undefined);
      conversation.open(scope);
    });
    return { collections: new ProjectCollections(conversation), conversation, projects };
  }, [bridge.foundation]);
  useLayoutEffect(() => {
    let lease: ProjectSelectionLease | undefined;
    let unregister: (() => void) | undefined;
    const update = () => {
      const next = projects.selectionLease();
      if (lease === next) return;
      unregister?.();
      lease = next;
      unregister =
        next && projects.pendingWork.register(next, conversation.composer.beforeProjectDetach);
    };
    const unsubscribe = projects.subscribe(update);
    update();
    return () => {
      unsubscribe();
      unregister?.();
    };
  }, [conversation, projects]);
  const conversationState = useSyncExternalStore(conversation.subscribe, conversation.snapshot);
  const history = useSyncExternalStore(
    conversation.history.subscribe,
    conversation.history.snapshot,
  );
  const activity = useSyncExternalStore(
    conversation.activity.subscribe,
    conversation.activity.snapshot,
  );
  const chatVisible = useRef(false);
  const updateActivityPresentation = useCallback(() => {
    conversation.activity.presentation(
      chatVisible.current &&
        !conversation.history.snapshot().visible &&
        conversation.snapshot().status === "ready",
      document.hasFocus() && document.visibilityState === "visible",
    );
  }, [conversation]);
  const onChatVisibility = useCallback(
    (visible: boolean) => {
      chatVisible.current = visible;
      updateActivityPresentation();
    },
    [updateActivityPresentation],
  );
  useLayoutEffect(() => {
    updateActivityPresentation();
    window.addEventListener("focus", updateActivityPresentation);
    window.addEventListener("blur", updateActivityPresentation);
    document.addEventListener("visibilitychange", updateActivityPresentation);
    return () => {
      window.removeEventListener("focus", updateActivityPresentation);
      window.removeEventListener("blur", updateActivityPresentation);
      document.removeEventListener("visibilitychange", updateActivityPresentation);
    };
  }, [updateActivityPresentation]);
  useLayoutEffect(updateActivityPresentation, [
    updateActivityPresentation,
    history.visible,
    conversationState.scope.projectId,
    conversationState.scope.conversationId,
    conversationState.status,
  ]);
  const agentBand = useRef<HTMLDivElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const renameNotice = useId();
  const previousChatView = useRef({ history: false, renaming: false, id: null as string | null });
  useLayoutEffect(() => {
    const previous = previousChatView.current;
    const renaming = !!conversationState.rename && !history.visible;
    previousChatView.current = {
      history: history.visible,
      renaming,
      id: conversationState.scope.conversationId,
    };
    const focus =
      previous.history !== history.visible
        ? history.visible
          ? returnButton.current
          : historyButton.current
        : previous.renaming &&
            !renaming &&
            previous.id === conversationState.scope.conversationId &&
            document.activeElement === document.body
          ? renameButton.current
          : null;
    if (focus && !focus.closest("[hidden], [inert]") && !document.querySelector("dialog[open]"))
      focus.focus({ preventScroll: true });
  }, [history.visible, conversationState.rename, conversationState.scope.conversationId]);
  const projectState = useSyncExternalStore(projects.subscribe, projects.snapshot);
  useEffect(
    () =>
      conversation.observe((notice) => {
        if (notice === "ready" || !notice.ok || notice.value.kind !== "changed") return;
        const { record, id, revision } = notice.value;
        if (record === "project") projects.noteProject();
        if (record === "profile" && id === conversation.snapshot().scope.projectId)
          profileDrafts.get(id)?.changed(revision);
        if (record === "projectTitle" && id === conversation.snapshot().scope.projectId)
          projects.noteProjectTitle(id, revision);
      }),
    [conversation, profileDrafts, projects],
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
  const [memoryRequests, requestMemory] = useState<
    ReadonlyMap<
      string,
      {
        readonly sequence: number;
        readonly source?: MemoryDraftSource;
      }
    >
  >(() => new Map());
  const memorySequence = useRef(0);
  const [sourceRequest, setSourceRequest] = useState<{
    projectId: string;
    conversationId: string;
    messageId: string;
  }>();
  const currentProjectId = conversationState.scope.projectId;
  const activeMemoryRequest = currentProjectId ? memoryRequests.get(currentProjectId) : undefined;
  const activeSourceRequest =
    sourceRequest?.projectId === currentProjectId ? sourceRequest : undefined;
  function openMemory(source?: MemoryDraftSource) {
    if (!currentProjectId) return;
    const sequence = ++memorySequence.current;
    const handled = memoryDrafts.snapshot(currentProjectId).handledSequence;
    requestMemory((previous) => {
      const request = previous.get(currentProjectId);
      const pending = request?.sequence === handled ? undefined : request?.source;
      const requestedSource = source ?? pending;
      return new Map(previous).set(currentProjectId, {
        sequence,
        ...(requestedSource ? { source: requestedSource } : {}),
      });
    });
  }
  const activeProject = latestProject(
    conversationState.project,
    projects.project(conversationState.scope.projectId),
  );
  const profileLease = projects.selectionLease();
  const profileLanguage = activeProject?.documentLanguage;
  const profileAvailable =
    profileLease &&
    profileLanguage &&
    activeProject.setupConfirmedAt &&
    activeProject.id === currentProjectId &&
    profileLease.projectId === currentProjectId;
  let profile: ThesisProfileController | undefined;
  if (profileAvailable) {
    profile = profileDrafts.get(profileLease.projectId);
    if (!profile) {
      profile = new ThesisProfileController(bridge.foundation);
      profileDrafts.set(profileLease.projectId, profile);
    }
  }
  const renameReturn = useRef<HTMLButtonElement>(null);
  const renameProject =
    activeProject?.id === currentProjectId && conversationState.researchScopeReady
      ? activeProject
      : undefined;
  useLayoutEffect(() => {
    projects.prepareRename(renameProject);
  }, [projects, renameProject]);
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
    if (recovered) {
      conversation.forgetProjectRecords();
      projects.forgetProjectRecords();
    }
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
  const [restoreFeedback, setRestoreFeedback] = useState<{
    readonly notice: BootstrapNotice;
    readonly state: BootstrapSnapshot["state"];
    readonly verification: string | undefined;
  }>();
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
      setRestoreFeedback((feedback) =>
        feedback &&
        !next.notice &&
        feedback.state === next.state &&
        feedback.verification === next.checkpoint?.verification
          ? feedback
          : undefined,
      );
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
  const locationNotice =
    restoreFeedback?.notice ??
    (bootstrap?.notice === "locale_fallback" ? undefined : bootstrap?.notice);
  useEffect(() => {
    if (
      (failed || bootstrapFailure(bootstrap?.state) || locationNotice) &&
      !document.querySelector("dialog[open]")
    )
      notice.current?.focus();
  }, [failed, bootstrap?.state, bootstrap?.checkpoint?.verification, locationNotice, announcement]);
  if (!bootstrap) return null;
  if (bootstrap.state === "storage_ready") workspaceMounted.current = true;
  const workspaceReady = bootstrap.state === "storage_ready";
  const text = (key: SimpleMessageKey) => message(bootstrap.locale, key);
  async function action(operation: () => Promise<BootstrapSnapshot>, restoring = false) {
    if (busy || !bootstrap) return;
    setBusy(true);
    setFailed(false);
    setRestoreFeedback(undefined);
    try {
      const value = await operation();
      if (
        restoring &&
        (value.notice === "recovery_busy" ||
          value.notice === "recovery_stale" ||
          value.notice === "recovery_unavailable" ||
          value.notice === "shutdown_uncertain")
      )
        setRestoreFeedback({
          notice: value.notice,
          state: value.state,
          verification: value.checkpoint?.verification,
        });
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
      else if (!document.querySelector("dialog[open]")) {
        const target = value.state === "storage_ready" ? workspaceReturn.current : notice.current;
        target?.focus();
      }
    } catch {
      if (restoring)
        setRestoreFeedback({
          notice: "recovery_uncertain",
          state: bootstrap.state,
          verification: bootstrap.checkpoint?.verification,
        });
      else setFailed(true);
      setAnnouncement((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  const restore = (verification: string) =>
    void action(() => bridge.bootstrap.restoreCheckpoint(verification), true);
  const retry = () => void action(() => bridge.bootstrap.retryService());
  return (
    <div className="workspace-window foundation-window">
      <span
        className="primitive-announcement"
        role="status"
        aria-atomic="true"
        lang={bootstrap.locale}
      >
        {activity.replyAnnouncement && (
          <span key={activity.replyAnnouncement.key}>
            {activity.replyAnnouncement.agent
              ? message(bootstrap.locale, "conversation.replied", {
                  agent: contributorNames[activity.replyAnnouncement.agent],
                })
              : message(bootstrap.locale, "activity.newReplies", {
                  count: activity.replyAnnouncement.count,
                })}
          </span>
        )}
      </span>
      <span
        className="primitive-announcement"
        role="alert"
        aria-atomic="false"
        aria-relevant="additions"
        lang={bootstrap.locale}
      >
        {activity.alerts.map((alert) => (
          <span key={alert.key}>
            {text(alert.source === "plan" ? "activity.planAlert" : "activity.conversationAlert")}
          </span>
        ))}
      </span>
      <SettingsSurfaces
        research={conversation}
        projects={projects}
        newProject={newProject}
        composeWorkspace={workspaceMounted.current}
        manuscriptVisible={visibleManuscript !== null}
        bridge={bridge.commands}
        port={bridge.foundation}
        diagnostics={bridge.diagnostics}
        update={bridge.update}
        locale={bootstrap.locale}
        available={bootstrap.state === "storage_ready"}
        storageState={bootstrap.state}
        serviceGeneration={bootstrap.serviceGeneration}
        onLocale={applyLocale.current}
        returnFocusRef={returnFocus}
        recovery={
          <CheckpointRecovery
            snapshot={bootstrap}
            busy={busy}
            notice={
              failed
                ? "startup_failed"
                : locationNotice === "resource_failure"
                  ? undefined
                  : locationNotice
            }
            onRestore={restore}
            onRetry={retry}
          />
        }
      >
        {(
          commands,
          { sourceQuoteLength, entryTextLength, ...binding },
          openConnections,
          openAgents,
        ) => (
          <>
            <ProjectRename
              controller={projects}
              available={renameProject !== undefined}
              draft={projectState.rename}
              language={activeProject?.documentLanguage}
              locale={bootstrap.locale}
              returnFocusRef={renameReturn}
            />
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
                  chatActivity={activity.chat}
                  collections={collections}
                  manuscriptPort={bridge.foundation}
                  manuscriptLifecycle={bridge.commands}
                  onManuscriptVisibility={setVisibleManuscript}
                  {...(profile && profileLease && profileLanguage
                    ? {
                        profile: {
                          controller: profile,
                          lease: profileLease,
                          language: profileLanguage,
                          subscriptionId: conversation.projectSubscription(profileLease.projectId),
                          unavailable:
                            !conversationState.researchScopeReady &&
                            (conversationState.status === "failed" ||
                              conversationState.status === "unavailable"),
                          retryConnection: conversation.reload,
                          guard: projects.pendingWork,
                          // Rename itself refuses while its form is already open.
                          rename: renameProject?.setupConfirmedAt
                            ? (focus?: "subtitle") => {
                                projects.beginRename(focus);
                              }
                            : undefined,
                        },
                      }
                    : {})}
                  {...(activeProject?.setupConfirmedAt && currentProjectId
                    ? {
                        memory: (
                          <ProjectMemoryView
                            key={currentProjectId}
                            locale={bootstrap.locale}
                            projectId={currentProjectId}
                            port={bridge.foundation}
                            observe={collections.observeMemory}
                            drafts={memoryDrafts}
                            sourceQuoteLength={sourceQuoteLength}
                            entryTextLength={entryTextLength}
                            draftRequest={
                              activeMemoryRequest?.source ? activeMemoryRequest : undefined
                            }
                            goToMessage={(source) => {
                              conversation.switchConversation(source.conversationId);
                              setSourceRequest({
                                projectId: currentProjectId,
                                conversationId: source.conversationId,
                                messageId: source.messageId,
                              });
                            }}
                          />
                        ),
                        ...(activeMemoryRequest
                          ? { memoryRequest: activeMemoryRequest.sequence }
                          : {}),
                        ...(activeSourceRequest
                          ? { revealSourceRequest: activeSourceRequest }
                          : {}),
                      }
                    : {})}
                  onChatVisibility={onChatVisibility}
                  projectSelector={
                    <ProjectSelector
                      buttonRef={renameReturn}
                      controller={projects}
                      state={projectState}
                      attentionProjects={activity.projects}
                      current={activeProject}
                      currentId={conversationState.scope.projectId}
                      currentFailed={
                        conversationState.status === "failed" ||
                        conversationState.status === "unavailable"
                      }
                      locale={bootstrap.locale}
                    />
                  }
                  projectNotice={
                    <ProjectRenameStatus
                      controller={projects}
                      state={projectState}
                      locale={bootstrap.locale}
                      returnFocusRef={renameReturn}
                    />
                  }
                  hasProjects={projectState.hasProjects}
                  project={activeProject}
                  projectScope={conversationState.scope.projectId ?? undefined}
                  revealProjectChat={createdProject === conversationState.scope.projectId}
                  onComposerFocus={conversation.composer.focus}
                  revealChatRequest={conversationState.newConversationRequest}
                  chatHeadingStart={
                    history.visible && (
                      <ConversationHeaderButton
                        buttonRef={returnButton}
                        icon="arrow-left"
                        label={message(bootstrap.locale, "history.return")}
                        action={conversation.history.hide}
                      />
                    )
                  }
                  replaceChatHeading={!history.visible && !!conversationState.rename}
                  chatHeadingActions={
                    conversationState.scope.projectId && (
                      <>
                        {!history.visible && (
                          <>
                            {conversationState.rename ? (
                              <ConversationNameField
                                key={conversationState.scope.conversationId}
                                controller={conversation}
                                rename={conversationState.rename}
                                locale={bootstrap.locale}
                                noticeId={renameNotice}
                              />
                            ) : (
                              conversationState.conversation && (
                                <ConversationHeaderButton
                                  buttonRef={renameButton}
                                  icon="pencil"
                                  label={message(bootstrap.locale, "history.rename")}
                                  action={() => {
                                    if (conversationState.conversation)
                                      conversation.beginRename(
                                        conversationName(
                                          conversationState.conversation,
                                          bootstrap.locale,
                                        ),
                                      );
                                  }}
                                />
                              )
                            )}
                            {activeProject?.setupConfirmedAt && (
                              <ConversationHeaderButton
                                buttonRef={historyButton}
                                icon="list"
                                label={message(bootstrap.locale, "history.show")}
                                action={conversation.history.show}
                                activity={{ counts: activity.history, locale: bootstrap.locale }}
                              />
                            )}
                          </>
                        )}
                        {activeProject?.setupConfirmedAt && (
                          <ShortcutControl
                            id="conversation.new"
                            commands={commands}
                            locale={bootstrap.locale}
                            icon="message-square-plus"
                          />
                        )}
                      </>
                    )
                  }
                  chat={
                    conversationState.scope.projectId ? (
                      <>
                        <span className="primitive-announcement" role="status" data-history-loading>
                          {history.visible && history.status === "loading"
                            ? message(bootstrap.locale, "history.loading")
                            : ""}
                        </span>
                        <div className="chat-conversation" hidden={history.visible}>
                          {!history.visible && (
                            <AgentBand
                              key={conversationState.scope.projectId}
                              composer={conversation.composer}
                              bandRef={agentBand}
                              continuation={
                                conversationState.conversation && (
                                  <HandoffReturnControl
                                    key={conversationState.conversation.id}
                                    conversation={conversationState.conversation}
                                    controller={conversation}
                                    locale={bootstrap.locale}
                                    focusAfter={agentBand}
                                  />
                                )
                              }
                              agent={knownConversationAgent(conversationState)}
                              selectable={
                                !conversationState.scope.conversationId &&
                                !!conversationState.project?.setupConfirmedAt &&
                                !conversationState.project.isDevelopment
                              }
                              locale={bootstrap.locale}
                            />
                          )}
                          <ConversationRenameNotice
                            rename={conversationState.rename}
                            renamed={conversationState.renamed}
                            noticeId={renameNotice}
                            locale={bootstrap.locale}
                          />
                          <div className="chat-timeline-slot">
                            <ConversationView
                              state={conversationState}
                              sharedReplyAnnouncements
                              onOpenMemory={() => {
                                openMemory();
                              }}
                              onAddMemory={openMemory}
                              sourceRequest={activeSourceRequest}
                              controller={conversation}
                              onOpenConnections={openConnections}
                              onOpenAgents={openAgents}
                              commands={bridge.commands}
                              detailsPort={bridge.foundation}
                              locale={bootstrap.locale}
                            />
                          </div>
                        </div>
                        {history.visible && (
                          <div className="chat-history-view">
                            <ConversationHistory
                              state={history}
                              controller={conversation.history}
                              select={conversation.switchConversation}
                              current={conversationState.scope.conversationId}
                              unreadReplies={activity.unreadReplies}
                              locale={bootstrap.locale}
                            />
                          </div>
                        )}
                      </>
                    ) : undefined
                  }
                  chatTitle={
                    history.visible
                      ? message(bootstrap.locale, "history.title")
                      : conversationState.conversation
                        ? conversationName(conversationState.conversation, bootstrap.locale)
                        : conversationState.scope.projectId &&
                            !conversationState.scope.conversationId
                          ? message(bootstrap.locale, "command.conversation.new")
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
                  {text(
                    failed ? "startup_failed" : (locationNotice ?? checkpointStatus(bootstrap)),
                  )}
                </p>
                {locationNotice && bootstrap.checkpointProblem && (
                  <p>{text(bootstrap.checkpointProblem)}</p>
                )}
                {bootstrap.state !== "storage_ready" && <p>{text("storage_disclosure")}</p>}
                {["pending_create", "located"].includes(bootstrap.state) && (
                  <button
                    type="button"
                    aria-disabled={busy}
                    onClick={() => void action(() => bridge.bootstrap.openStorage())}
                  >
                    {text("open_storage")}
                  </button>
                )}
                <CheckpointRecovery
                  snapshot={bootstrap}
                  busy={busy}
                  startupNotice={notice}
                  onRestore={restore}
                  onRetry={retry}
                />
              </section>
            </main>
          </>
        )}
      </SettingsSurfaces>
    </div>
  );
}
