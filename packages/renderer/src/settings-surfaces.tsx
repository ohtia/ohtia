import { isReplyAgent, type AgentPreferenceTarget, type ReplyAgent } from "@ohtia/contracts";
import type { ProjectController } from "./project-controller.js";
import type { NewProjectController } from "./new-project-controller.js";
import { LimitsFeedback } from "./limits-panel.js";
import { LimitsController } from "./limits-controller.js";
import { ConversationController } from "./conversation-controller.js";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  defaultEntryTextLength,
  defaultSourceQuoteLength,
  message,
  type FoundationPort,
  type BootstrapState,
  type CommandBridge,
  type InterfaceLocale,
  type LocaleSnapshot,
  type CommandId,
  type CommandReason,
  type DiagnosticsBridge,
  type UpdateBridge,
} from "@ohtia/contracts";
import { UpdateController } from "./update-controller.js";
import { UpdateCheckController } from "./update-check-controller.js";
import { DiagnosticsPanel, useDiagnosticDeletion } from "./diagnostics-panel.js";
import { UpdateCheckSetting } from "./update-check-setting.js";
import { useCharacterMode } from "./character.js";
import { CommandSurfaces } from "./command-surfaces.js";
import { CommandController } from "./command-controller.js";
import { type SettingFeature, SettingsController } from "./settings-controller.js";
import { LucideGlyph as Icon } from "./iconography.js";
import { RecoveryFocusBoundary, SettingsFeedback } from "./settings-notices.js";
import { SettingsDialog, type SettingsSection } from "./settings-dialog.js";
import { ManagedStoreSetting } from "./managed-store-setting.js";
import { LanguageController } from "./language-controller.js";
import { LayoutPreferences } from "./layout-preferences.js";
import { WorkspaceController, type WorkspaceState } from "./workspace-controller.js";
import type { DecorationState } from "./command-surfaces.js";

export interface WorkspaceSettingsBinding {
  readonly preferences: LayoutPreferences;
  readonly decoration: DecorationState;
  readonly zoom: number;
  readonly sourceQuoteLength: number;
  readonly entryTextLength: number;
  readonly layoutFailure: boolean;
  readonly onDismissLayoutFailure: () => void;
  readonly onWorkspaceChange: (
    workspace: WorkspaceController | undefined,
    state?: WorkspaceState,
  ) => void;
  readonly updates: UpdateController | undefined;
}

/** Window-lifetime settings and command ownership, shared with the actual workspace when composed. */
export function SettingsSurfaces({
  port,
  bridge,
  locale,
  available,
  storageState,
  serviceGeneration,
  onLocale,
  children,
  returnFocusRef,
  composeWorkspace = false,
  manuscriptVisible = false,
  research,
  projects,
  newProject,
  update,
  recovery,
  diagnostics,
}: {
  readonly diagnostics?: DiagnosticsBridge;
  readonly recovery?: ReactNode;
  /** SPEC-001-040: main's update pushes; without them the window offers no update command. */
  readonly update?: UpdateBridge;
  readonly children?: (
    commands: CommandController | undefined,
    binding: WorkspaceSettingsBinding,
    openConnections: () => void,
    openAgents: (agent?: ReplyAgent) => void,
  ) => ReactNode;
  readonly composeWorkspace?: boolean;
  readonly manuscriptVisible?: boolean;
  readonly research?: ConversationController;
  readonly projects?: ProjectController;
  readonly newProject?: NewProjectController;
  readonly returnFocusRef?: ComponentProps<typeof CommandSurfaces>["returnFocusRef"];
  readonly port: FoundationPort;
  readonly bridge: CommandBridge;
  readonly locale: InterfaceLocale;
  readonly available: boolean;
  readonly storageState: BootstrapState;
  readonly serviceGeneration: string | undefined;
  readonly onLocale: (snapshot: LocaleSnapshot) => void;
}) {
  const diagnosticDeletion = useDiagnosticDeletion();
  const limits = useMemo(() => new LimitsController(port, () => crypto.randomUUID()), [port]);
  const updates = useMemo(
    () => (update ? new UpdateController(update, port, bridge) : undefined),
    [update, port, bridge],
  );
  const updateCheck = useMemo(
    () => (update ? new UpdateCheckController(port, () => crypto.randomUUID()) : undefined),
    [update, port],
  );
  useEffect(
    () => () => {
      updateCheck?.dispose();
    },
    [updateCheck],
  );
  useEffect(() => {
    updates?.start();
    return () => {
      updates?.dispose();
    };
  }, [updates]);
  const ownResearch = useMemo(
    () => (research ? undefined : new ConversationController(port)),
    [port, research],
  );
  useEffect(() => {
    const source = research ?? ownResearch;
    const stop = source?.observe(limits.observed);
    if (available) {
      void limits.refresh();
      ownResearch?.open({ projectId: null, conversationId: null });
    }
    return () => {
      stop?.();
    };
  }, [research, ownResearch, limits, available]);
  useEffect(
    () => () => {
      limits.dispose();
      ownResearch?.dispose();
    },
    [limits, ownResearch],
  );
  const applyLocale = useRef(onLocale);
  applyLocale.current = onLocale;
  const [layoutState, setLayoutState] = useState<WorkspaceState>();
  const [sharedWorkspace, setSharedWorkspace] = useState<WorkspaceController>();
  const previousWorkspace = useRef<WorkspaceController | undefined>(undefined);
  const storageAvailable = useRef(available);
  storageAvailable.current = available;
  const commandRegistry = useRef<CommandController | undefined>(undefined);
  const onWorkspaceChange = useCallback(
    (workspace: WorkspaceController | undefined, state?: WorkspaceState) => {
      setSharedWorkspace(workspace);
      setLayoutState(state);
    },
    [],
  );
  const [layoutFailure, setLayoutFailure] = useState(false);
  const [requestedFocus, setRequestedFocus] = useState<
    SettingFeature | "connections" | "agents" | `agents:${ReplyAgent}`
  >();
  const sourceResearch = research ?? ownResearch;
  const observeAgentSettings = useCallback(
    (refresh: (target?: AgentPreferenceTarget, revision?: number) => void) =>
      sourceResearch?.observe((notice) => {
        if (notice === "ready") refresh();
        else if (notice.ok && notice.value.kind === "agentPreferenceChanged")
          refresh(
            notice.value.source === "replace" ? notice.value.target : undefined,
            notice.value.revision,
          );
        else if (
          notice.ok &&
          (notice.value.kind === "providerModelsChanged" ||
            notice.value.kind === "destinationChanged")
        )
          refresh();
      }) ?? (() => {}),
    [sourceResearch],
  );
  const language = useMemo(
    () =>
      new LanguageController(
        port,
        (snapshot) => {
          applyLocale.current(snapshot);
        },
        () => crypto.randomUUID(),
      ),
    [port],
  );
  const controller = useMemo(
    () =>
      new SettingsController(
        port,
        async (feature, record) => {
          if (feature === "zoom") {
            const result = await port.applyZoom().result;
            if (
              !result.ok ||
              !result.value.applied ||
              result.value.revision < record.revision ||
              result.value.percent !== record.value
            )
              throw new Error("Confirmed interface zoom could not be applied.");
          }
        },
        () => crypto.randomUUID(),
      ),
    [port],
  );
  const preferences = useMemo(
    () =>
      new LayoutPreferences(
        port,
        () => crypto.randomUUID(),
        () => {
          setLayoutFailure(true);
        },
      ),
    [port],
  );
  const ownWorkspace = useMemo(
    () =>
      composeWorkspace
        ? undefined
        : new WorkspaceController(preferences, window.innerWidth, false, setLayoutState),
    [preferences, composeWorkspace],
  );
  const workspace = ownWorkspace ?? sharedWorkspace ?? previousWorkspace.current;
  previousWorkspace.current = workspace;
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => {
    commandRegistry.current?.changed();
  }, [available]);
  useEffect(() => {
    const resize = () => {
      ownWorkspace?.viewport(window.innerWidth);
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      ownWorkspace?.dispose();
    };
  }, [ownWorkspace]);
  useEffect(
    () => () => {
      controller.dispose();
      language.dispose();
    },
    [controller, language],
  );
  useEffect(() => {
    if (available) {
      void controller.refresh();
      void language.refresh();
      void ownWorkspace?.initialize();
    }
  }, [available, controller, language, ownWorkspace]);
  const register = useCallback(
    (registry: CommandController, reason: (id: CommandId) => CommandReason | undefined) => {
      commandRegistry.current = registry;
      const zoom = (intent: "increase" | "decrease" | "reset"): CommandReason | undefined => {
        const snapshot = controller.snapshot();
        if (!snapshot.current) return "handler_missing";
        const setting = snapshot.settings.zoom;
        if (setting.phase === "submitting" || (setting.phase === "uncertain" && !setting.canChoose))
          return "busy";
        const value = snapshot.current.zoom.value;
        return intent === "reset" && value === 100
          ? "actual_size"
          : intent === "increase" && value === 400
            ? "zoom_maximum"
            : intent === "decrease" && value === 75
              ? "zoom_minimum"
              : undefined;
      };
      const stops: (() => void)[] = [];
      if (newProject) {
        stops.push(
          registry.register("project.new", {
            state: () => {
              const unavailable =
                reason("project.new") ??
                (!storageAvailable.current || newProject.snapshot().busy ? "busy" : undefined);
              return unavailable ? { reason: unavailable } : {};
            },
            run: () => newProject.start(),
          }),
          newProject.subscribe(() => {
            registry.changed();
          }),
        );
      }
      if (projects) {
        stops.push(
          registry.register("project.rename", {
            state: () => {
              const unavailable =
                reason("project.rename") ??
                (!storageAvailable.current ? "busy" : projects.renameReason());
              return unavailable ? { reason: unavailable } : {};
            },
            run: projects.beginRename,
          }),
          projects.subscribe(() => {
            registry.changed();
          }),
        );
      }
      if (research) {
        let lastReason = research.newConversationReason();
        stops.push(
          registry.register("conversation.new", {
            state: () => {
              const unavailable =
                reason("conversation.new") ??
                research.newConversationReason() ??
                (!storageAvailable.current ? "busy" : undefined);
              return unavailable ? { reason: unavailable } : {};
            },
            run: research.startNew,
          }),
          research.subscribe(() => {
            const nextReason = research.newConversationReason();
            if (nextReason !== lastReason) {
              lastReason = nextReason;
              registry.changed();
            }
          }),
        );
      }
      for (const intent of ["increase", "decrease", "reset"] as const)
        stops.push(
          registry.register(`zoom.${intent}`, {
            state: () => {
              const unavailable =
                reason(`zoom.${intent}`) ??
                (!storageAvailable.current ? "busy" : undefined) ??
                zoom(intent);
              return unavailable ? { reason: unavailable } : {};
            },
            run: async () => {
              const saved = await controller.choose(
                "zoom",
                controller.snapshot().current?.zoom.value ?? 100,
                intent,
              );
              const state = controller.snapshot();
              if (state.zoomBusy)
                return { status: "unavailable" as const, reason: "busy" as const };
              if (state.zoomReason)
                return { status: "unavailable" as const, reason: state.zoomReason };
              return saved;
            },
          }),
        );
      for (const value of ["system", "light", "dark"] as const)
        stops.push(
          registry.register(`theme.${value}`, {
            state: () => {
              const snapshot = controller.snapshot();
              const phase = snapshot.settings.appearance.phase;
              const unavailable =
                reason(`theme.${value}`) ??
                (!storageAvailable.current ? "busy" : undefined) ??
                (!snapshot.current
                  ? "handler_missing"
                  : phase === "submitting" ||
                      (phase === "uncertain" && !snapshot.settings.appearance.canChoose)
                    ? "busy"
                    : undefined);
              return {
                ...(unavailable ? { reason: unavailable } : {}),
                checked: snapshot.current?.appearance.value === value,
              };
            },
            run: () => controller.choose("appearance", value),
          }),
        );
      stops.push(
        controller.subscribe(() => {
          registry.changed();
        }),
      );
      return () => {
        if (commandRegistry.current === registry) commandRegistry.current = undefined;
        for (const stop of stops) stop();
      };
    },
    [controller, newProject, projects, research],
  );
  const decoration = useCharacterMode(state.current?.character.value ?? "static");
  return (
    <>
      <CommandSurfaces
        {...(children
          ? {
              children: (commands: CommandController | undefined) =>
                children(
                  commands,
                  {
                    preferences,
                    decoration,
                    zoom: state.effectiveZoom,
                    sourceQuoteLength: state.current?.sourceQuote.value ?? defaultSourceQuoteLength,
                    entryTextLength: state.current?.entryText.value ?? defaultEntryTextLength,
                    layoutFailure,
                    onDismissLayoutFailure: () => {
                      setLayoutFailure(false);
                    },
                    onWorkspaceChange,
                    updates,
                  },
                  () => {
                    setRequestedFocus("connections");
                    void commands?.invoke("settings.open");
                  },
                  (agent?: ReplyAgent) => {
                    // Only a known agent selects a row; anything else, such as an event, opens the page.
                    setRequestedFocus(isReplyAgent(agent) ? `agents:${agent}` : "agents");
                    void commands?.invoke("settings.open");
                  },
                ),
            }
          : {})}
        {...(returnFocusRef ? { returnFocusRef } : {})}
        bridge={bridge}
        locale={locale}
        decoration={decoration}
        manuscriptVisible={manuscriptVisible}
        {...(updates ? { updates } : {})}
        registerHandlers={register}
        renderFeedback={(openSettings, inDialog) => (
          <>
            <SettingsFeedback
              controller={controller}
              state={state}
              locale={locale}
              inDialog={inDialog}
              onOpenSettings={openSettings}
              onChooseAgain={(feature) => {
                setRequestedFocus(feature);
                openSettings();
              }}
            />
            <LimitsFeedback
              {...(returnFocusRef ? { returnFocusRef } : {})}
              controller={limits}
              locale={locale}
              available={available}
              inDialog={inDialog}
              onOpenSettings={openSettings}
            />
          </>
        )}
        renderSettings={(open, close, platform, feedback, returnFocusRef) => (
          <>
            {workspace && (
              <SettingsDialog
                open={open}
                feedback={feedback}
                onClose={() => {
                  setRequestedFocus(undefined);
                  close();
                }}
                requestedFocus={requestedFocus}
                {...(sourceResearch ? { connections: sourceResearch.connections } : {})}
                observeResearch={observeAgentSettings}
                openLink={(link) => {
                  void bridge.openLink(link);
                }}
                returnFocusRef={returnFocusRef}
                port={port}
                locale={locale}
                available={available}
                language={language}
                controller={controller}
                limits={limits}
                sections={[
                  {
                    id: "storage",
                    title: message(locale, "location"),
                    icon: "folder-archive",
                    content: (active: boolean) =>
                      active && (
                        <ManagedStoreSetting
                          port={port}
                          locale={locale}
                          storageState={storageState}
                          serviceGeneration={serviceGeneration}
                        />
                      ),
                  },
                  ...(updateCheck
                    ? [
                        {
                          id: "updates",
                          title: message(locale, "settings.updates"),
                          icon: "download",
                          content: open && (
                            <UpdateCheckSetting
                              controller={updateCheck}
                              locale={locale}
                              available={available}
                            />
                          ),
                        } satisfies SettingsSection,
                      ]
                    : []),
                  ...(diagnostics
                    ? [
                        {
                          id: "diagnostics",
                          title: message(locale, "diagnostics.title"),
                          icon: "file-text",
                          content: (active: boolean) =>
                            active && (
                              <DiagnosticsPanel
                                bridge={diagnostics}
                                locale={locale}
                                deletionControl={diagnosticDeletion}
                              />
                            ),
                        } satisfies SettingsSection,
                      ]
                    : []),
                  ...(recovery
                    ? [
                        {
                          id: "migration-recovery",
                          title: message(locale, "migration_recovery"),
                          icon: "database",
                          content: open && recovery,
                        } satisfies SettingsSection,
                      ]
                    : []),
                ]}
                workspace={workspace}
                workspaceState={layoutState ?? workspace.state}
                platform={platform}
              />
            )}
          </>
        )}
      />
      <RecoveryFocusBoundary
        className="settings-feedback layout-memory-feedback"
        onRecover={() => {
          if (!document.querySelector("dialog[open]"))
            document.querySelector<HTMLButtonElement>(".command-entry-actions button")?.focus();
        }}
      >
        {layoutFailure && !composeWorkspace && (
          <p className="language-danger" role="alert">
            <Icon name="octagon-alert" />
            {message(locale, "settings.layoutNotRemembered")}{" "}
            <button
              type="button"
              onClick={() => {
                if (!document.querySelector("dialog[open]"))
                  document
                    .querySelector<HTMLButtonElement>(".command-entry-actions button")
                    ?.focus();
                setLayoutFailure(false);
              }}
            >
              {message(locale, "settings.closeLayoutNotice")}
            </button>
          </p>
        )}
      </RecoveryFocusBoundary>
    </>
  );
}
