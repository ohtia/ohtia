import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  message,
  type FoundationPort,
  type CommandBridge,
  type InterfaceLocale,
  type LocaleSnapshot,
  type CommandId,
  type CommandReason,
} from "@ohtia/contracts";
import { useCharacterMode } from "./character.js";
import { CommandSurfaces } from "./command-surfaces.js";
import { CommandController } from "./command-controller.js";
import { type SettingFeature, SettingsController } from "./settings-controller.js";
import { LucideGlyph as Icon } from "./iconography.js";
import { RecoveryFocusBoundary, SettingsFeedback } from "./settings-notices.js";
import { SettingsDialog } from "./settings-dialog.js";
import { LanguageController } from "./language-controller.js";
import { LayoutPreferences } from "./layout-preferences.js";
import { WorkspaceController, type WorkspaceState } from "./workspace-controller.js";
import type { DecorationState } from "./command-surfaces.js";

export interface WorkspaceSettingsBinding {
  readonly preferences: LayoutPreferences;
  readonly decoration: DecorationState;
  readonly zoom: number;
  readonly layoutFailure: boolean;
  readonly onDismissLayoutFailure: () => void;
  readonly onWorkspaceChange: (
    workspace: WorkspaceController | undefined,
    state?: WorkspaceState,
  ) => void;
}

/** Window-lifetime settings and command ownership, shared with the actual workspace when composed. */
export function SettingsSurfaces({
  port,
  bridge,
  locale,
  available,
  onLocale,
  children,
  returnFocusRef,
  composeWorkspace = false,
}: {
  readonly children?: (
    commands: CommandController | undefined,
    binding: WorkspaceSettingsBinding,
  ) => ReactNode;
  readonly composeWorkspace?: boolean;
  readonly returnFocusRef?: ComponentProps<typeof CommandSurfaces>["returnFocusRef"];
  readonly port: FoundationPort;
  readonly bridge: CommandBridge;
  readonly locale: InterfaceLocale;
  readonly available: boolean;
  readonly onLocale: (snapshot: LocaleSnapshot) => void;
}) {
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
  const [requestedFocus, setRequestedFocus] = useState<SettingFeature>();
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
    [controller],
  );
  const decoration = useCharacterMode(state.current?.character.value ?? "static");
  return (
    <>
      <CommandSurfaces
        {...(children
          ? {
              children: (commands: CommandController | undefined) =>
                children(commands, {
                  preferences,
                  decoration,
                  zoom: state.effectiveZoom,
                  layoutFailure,
                  onDismissLayoutFailure: () => {
                    setLayoutFailure(false);
                  },
                  onWorkspaceChange,
                }),
            }
          : {})}
        {...(returnFocusRef ? { returnFocusRef } : {})}
        bridge={bridge}
        locale={locale}
        decoration={decoration}
        registerHandlers={register}
        renderFeedback={(openSettings, inDialog) => (
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
                returnFocusRef={returnFocusRef}
                port={port}
                locale={locale}
                available={available}
                language={language}
                controller={controller}
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
              {message(locale, "dialog.close")}
            </button>
          </p>
        )}
      </RecoveryFocusBoundary>
    </>
  );
}
