import { ConnectionsPanel } from "./connections-panel.js";
import { useSystemReducedMotion } from "./system-motion.js";
import {
  useEffect,
  useCallback,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import {
  message,
  appearances,
  characterPresentations,
  nextInterfaceZoom,
  workspacePanels,
  type FoundationPort,
  type InterfaceLocale,
  type CommandPlatform,
  type SimpleMessageKey,
} from "@ohtia/contracts";
import { Dialog } from "./layers.js";
import { LucideGlyph as Icon } from "./iconography.js";
import { OhtiaGlasses } from "./branding.js";
import { CharacterPreview } from "./character.js";
import { LanguagePanel } from "./language-panel.js";
import {
  SettingsNotices,
  RecoveryFocusBoundary,
  SettingsZoomRefusalNotice,
  SettingsReadFailureNotice,
  settingName,
  settingLabel,
} from "./settings-notices.js";
import type { LanguageController } from "./language-controller.js";
import type { WorkspaceController, WorkspaceState } from "./workspace-controller.js";
import {
  SettingsController,
  type SettingFeature,
  type SettingValue,
} from "./settings-controller.js";

/** Add a section only when its owning feature supplies real controls and operations. */
export interface SettingsSection {
  readonly id: string;
  readonly title: string;
  readonly content: ReactNode;
}
function useSystemPreference(query: string, active: boolean): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    if (!active) return;
    const media = window.matchMedia(query);
    const changed = () => {
      setMatches(media.matches);
    };
    changed();
    media.addEventListener("change", changed);
    return () => {
      media.removeEventListener("change", changed);
    };
  }, [query, active]);
  return matches;
}
function focusSetting(id: string, feature: SettingFeature | "layout"): void {
  const group = document.getElementById(`${id}-${feature}-controls`);
  (
    group?.querySelector<HTMLElement>("input:checked") ??
    group?.querySelector<HTMLElement>("input,button")
  )?.focus();
}
export function SettingsDialog({
  open,
  onClose,
  port,
  locale,
  available,
  language,
  controller,
  workspace,
  workspaceState,
  platform,
  sections = [],
  feedback,
  requestedFocus,
  returnFocusRef,
}: {
  readonly returnFocusRef?: Readonly<RefObject<HTMLElement | null>>;
  readonly requestedFocus?: SettingFeature | undefined;
  readonly feedback?: ReactNode;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly port: FoundationPort;
  readonly locale: InterfaceLocale;
  readonly available: boolean;
  readonly language: LanguageController;
  readonly controller: SettingsController;
  readonly workspace: WorkspaceController;
  readonly workspaceState: WorkspaceState;
  readonly platform: CommandPlatform;
  readonly sections?: readonly SettingsSection[];
}) {
  const subscribe = useCallback(
    (listener: () => void) => (open ? controller.subscribe(listener) : () => {}),
    [controller, open],
  );
  const state = useSyncExternalStore(subscribe, controller.snapshot);
  useEffect(() => {
    controller.setViewOpen(open);
    return () => {
      controller.setViewOpen(false);
    };
  }, [controller, open]);
  useEffect(() => {
    if (open && workspaceState.persistence.save.state === "uncertain")
      void workspace.reconcilePreferences();
  }, [open, workspace, workspaceState.persistence.save.state]);
  const id = useId();
  useEffect(() => {
    if (open && requestedFocus) focusSetting(id, requestedFocus);
  }, [open, requestedFocus, id]);
  const systemDark = useSystemPreference("(prefers-color-scheme: dark)", open);
  const reducedMotion = useSystemReducedMotion(open);
  const [reason, setReason] = useState<SimpleMessageKey>();
  useEffect(() => {
    setReason(undefined);
  }, [open, state.current?.serviceGeneration, state.current?.zoom.revision]);
  const text = (key: SimpleMessageKey) => message(locale, key);
  const name = (feature: SettingFeature) => settingName(locale, feature);
  const label = (feature: SettingFeature, value: SettingValue) =>
    settingLabel(locale, feature, value);
  const blocked = (feature: SettingFeature) =>
    !available ||
    !state.current ||
    state.settings[feature].phase === "submitting" ||
    (state.settings[feature].phase === "uncertain" && !state.settings[feature].canChoose) ||
    (state.settings[feature].phase === "conflict" && state.readFailed);
  const status = (feature: SettingFeature) => {
    const phase = state.settings[feature].phase;
    return (
      <span className="settings-save-state" role="status">
        {(phase === "confirmed" || phase === "submitting") && (
          <>
            <Icon name={phase === "confirmed" ? "check" : "circle-dashed"} />
            {text(phase === "confirmed" ? "saved" : "saving")}
          </>
        )}
      </span>
    );
  };
  const notices = (feature: SettingFeature) => (
    <SettingsNotices
      feature={feature}
      state={state}
      controller={controller}
      locale={locale}
      showChanged={open}
      onRecover={() => {
        if (open) focusSetting(id, feature);
      }}
      onChooseAgain={() => {
        if (open) focusSetting(id, feature);
      }}
    />
  );
  const zoom = state.current?.zoom.value ?? 100;
  const zoomAction = (intent: "increase" | "decrease" | "reset") => {
    const next = nextInterfaceZoom(zoom, intent);
    if (blocked("zoom")) return;
    if (next === zoom) {
      setReason(
        intent === "reset"
          ? "command.reason.actual_size"
          : intent === "increase"
            ? "command.reason.zoom_maximum"
            : "command.reason.zoom_minimum",
      );
      return;
    }
    setReason(undefined);
    void controller.choose("zoom", next, intent);
  };
  const layout = workspaceState.preference;
  const count = workspacePanels.filter((panel) => layout.visible[panel]).length;
  return (
    <Dialog
      open={open}
      {...(returnFocusRef ? { returnFocusRef } : {})}
      onClose={onClose}
      title={text("settings.title")}
      headingLevel={1}
      closeLabel={text("dialog.close")}
      closeContent={<Icon name="x" />}
      className="command-dialog settings-dialog"
      bodyClassName="settings-dialog-body"
    >
      <div className="settings-content">
        <p className="settings-info">
          <Icon name="info" />
          {text("settings.immediate")}
        </p>
        {!available && (
          <p className="settings-info" role="status">
            <Icon name="info" />
            {text("settings.unavailable")}
          </p>
        )}
        {feedback}
        <h2>{text("settings.section")}</h2>
        {open && (
          <LanguagePanel
            port={port}
            locale={locale}
            available={available}
            onLocale={() => {}}
            controller={language}
            headingLevel={3}
          />
        )}
        <section aria-labelledby={`${id}-appearance`}>
          <h3>
            <span id={`${id}-appearance`}>{name("appearance")}</span>
            {status("appearance")}
          </h3>
          <div
            role="radiogroup"
            aria-labelledby={`${id}-appearance`}
            className="settings-theme-cards"
            id={`${id}-appearance-controls`}
          >
            {appearances.map((value) => (
              <label
                key={value}
                className="settings-theme-card"
                data-selected={state.settings.appearance.draft === value}
              >
                <input
                  type="radio"
                  name={`${id}-theme`}
                  value={value}
                  aria-label={text(`command.theme.${value}`)}
                  aria-describedby={`${id}-theme-${value}-help`}
                  checked={state.settings.appearance.draft === value}
                  aria-disabled={blocked("appearance")}
                  onChange={() => {
                    if (!blocked("appearance")) void controller.choose("appearance", value);
                  }}
                />
                <svg
                  className="settings-theme-preview"
                  viewBox="0 0 120 64"
                  aria-hidden="true"
                  focusable="false"
                >
                  <rect
                    width="120"
                    height="64"
                    fill={
                      value === "dark"
                        ? "var(--ref-color-neutral-19)"
                        : "var(--ref-color-neutral-98)"
                    }
                  />
                  {value === "system" && (
                    <rect x="60" width="60" height="64" fill="var(--ref-color-neutral-19)" />
                  )}
                  <g
                    fill={
                      value === "dark"
                        ? "var(--ref-color-neutral-41)"
                        : "var(--ref-color-neutral-88)"
                    }
                  >
                    <rect x="4" y="4" width="112" height="8" />
                    <rect x="4" y="16" width="24" height="44" />
                    <rect x="32" y="16" width="52" height="44" />
                    <rect x="88" y="16" width="28" height="44" />
                  </g>
                  {value === "system" && (
                    <g fill="var(--ref-color-neutral-41)">
                      <rect x="60" y="4" width="56" height="8" />
                      <rect x="60" y="16" width="24" height="44" />
                      <rect x="88" y="16" width="28" height="44" />
                    </g>
                  )}
                </svg>
                <span>
                  <Icon
                    name={value === "system" ? "monitor" : value === "light" ? "sun" : "moon"}
                  />
                  {text(`command.theme.${value}`)}
                </span>
                <small id={`${id}-theme-${value}-help`}>
                  {text(
                    value === "system"
                      ? systemDark
                        ? "settings.nowDark"
                        : "settings.nowLight"
                      : value === "light"
                        ? "settings.alwaysLight"
                        : "settings.alwaysDark",
                  )}
                </small>
              </label>
            ))}
          </div>
          {notices("appearance")}
          <div
            className="settings-zoom"
            id={`${id}-zoom-controls`}
            role="group"
            aria-labelledby={`${id}-zoom`}
          >
            <h4>
              <span id={`${id}-zoom`}>{name("zoom")}</span>
              {status("zoom")}
            </h4>
            <div className="settings-zoom-actions">
              <button
                type="button"
                aria-label={text("command.zoom.decrease")}
                aria-disabled={blocked("zoom") || zoom === 75}
                onClick={() => {
                  zoomAction("decrease");
                }}
              >
                <span aria-hidden="true">−</span>
              </button>
              <output aria-live="polite" aria-label={name("zoom")}>
                {label("zoom", state.effectiveZoom)}
              </output>
              <button
                type="button"
                aria-label={text("command.zoom.increase")}
                aria-disabled={blocked("zoom") || zoom === 400}
                onClick={() => {
                  zoomAction("increase");
                }}
              >
                <Icon name="plus" />
              </button>
              <button
                type="button"
                aria-disabled={blocked("zoom") || zoom === 100}
                onClick={() => {
                  zoomAction("reset");
                }}
              >
                {text("command.zoom.reset")}
              </button>
            </div>
            <p>
              {message(locale, "settings.zoomShortcuts", {
                shortcuts: platform === "darwin" ? "⌘+, ⌘−, ⌘0" : "Ctrl++, Ctrl+−, Ctrl+0",
              })}
            </p>
            {(state.settings.zoom.phase === "submitting" ||
              (state.settings.zoom.phase === "uncertain" && !state.settings.zoom.canChoose)) && (
              <p role="status">{text("settings.zoomPending")}</p>
            )}
            <SettingsZoomRefusalNotice
              state={state}
              controller={controller}
              locale={locale}
              onRecover={() => {
                if (open) focusSetting(id, "zoom");
              }}
            />
            {state.zoomReason && (
              <p role="status">{message(locale, `command.reason.${state.zoomReason}`)}</p>
            )}
            {reason && <p role="status">{text(reason)}</p>}
            {notices("zoom")}
          </div>
          <div className="settings-characters" id={`${id}-character-controls`}>
            <h4>
              <span id={`${id}-characters`}>{name("character")}</span>
              {status("character")}
            </h4>
            <div className="settings-character-options">
              <div role="radiogroup" aria-labelledby={`${id}-characters`}>
                {characterPresentations.map((value) => (
                  <label
                    key={value}
                    className="settings-character-option"
                    data-selected={state.settings.character.draft === value}
                  >
                    <input
                      type="radio"
                      name={`${id}-character`}
                      value={value}
                      aria-label={text(`settings.${value}`)}
                      aria-describedby={`${id}-character-${value}-help`}
                      checked={state.settings.character.draft === value}
                      aria-disabled={blocked("character")}
                      onChange={() => {
                        if (!blocked("character")) void controller.choose("character", value);
                      }}
                    />
                    <span>
                      {text(`settings.${value}`)}
                      <small id={`${id}-character-${value}-help`}>
                        {text(`settings.${value}Help`)}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="settings-character-preview">
                {state.settings.character.draft === "hidden" ? (
                  <>
                    <OhtiaGlasses />
                    <span>{text("settings.symbolOnly")}</span>
                  </>
                ) : (
                  open && (
                    <CharacterPreview
                      mode={state.settings.character.draft as "animated" | "static"}
                      size={96}
                    />
                  )
                )}
              </div>
            </div>
            {reducedMotion && state.settings.character.draft === "animated" && (
              <p className="settings-info">
                <Icon name="info" />
                {text("settings.reducedMotion")}
              </p>
            )}
            {notices("character")}
          </div>
        </section>
        <section id={`${id}-layout-controls`} aria-labelledby={`${id}-layout`}>
          <h3>
            <span id={`${id}-layout`}>{text("help.layout")}</span>
            <span className="settings-save-state" role="status">
              {workspaceState.persistence.save.state === "submitting" ? (
                <>
                  <Icon name="circle-dashed" />
                  {text("saving")}
                </>
              ) : workspaceState.persistence.save.state === "confirmed" ? (
                <>
                  <Icon name="check" />
                  {text("saved")}
                </>
              ) : null}
            </span>
          </h3>
          {workspacePanels.map((panel) => (
            <label className="settings-layout-option" key={panel}>
              <input
                type="checkbox"
                checked={layout.visible[panel]}
                aria-disabled={
                  !available ||
                  workspaceState.initializing ||
                  workspaceState.persistence.save.state === "submitting" ||
                  workspaceState.persistence.save.state === "uncertain" ||
                  (count === 1 && layout.visible[panel])
                }
                onChange={() => {
                  if (available) workspace.visibility(panel, undefined, true);
                }}
              />
              {text(`command.panels.${panel}`)}
            </label>
          ))}
          {count === 1 && <p role="status">{text("command.reason.last_panel")}</p>}
          <button
            type="button"
            aria-disabled={
              !available ||
              workspaceState.initializing ||
              workspaceState.persistence.save.state === "submitting" ||
              workspaceState.persistence.save.state === "uncertain"
            }
            onClick={() => {
              if (available) workspace.reset();
            }}
          >
            <Icon name="rotate-ccw" />
            {text("command.layout.reset")}
          </button>
          <p>{text("settings.layoutHelp")}</p>
          <RecoveryFocusBoundary
            onRecover={() => {
              if (open) focusSetting(id, "layout");
            }}
          >
            {workspaceState.persistence.save.state === "rejected" && (
              <p className="language-danger" role="alert">
                <Icon name="octagon-alert" />
                {text("settings.layoutNotRemembered")}{" "}
                <button
                  type="button"
                  aria-disabled={!available}
                  onClick={() => {
                    if (!available) return;
                    if (open) focusSetting(id, "layout");
                    void workspace.rememberLayout();
                  }}
                >
                  {text("settings.language.tryAgain")}
                </button>
              </p>
            )}
            {workspaceState.persistence.save.state === "conflicting" && (
              <p className="language-attention" role="status">
                <Icon name="git-compare" />
                {text("settings.layoutConflict")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    if (open) focusSetting(id, "layout");
                  }}
                >
                  {text("settings.language.chooseAgain")}
                </button>
              </p>
            )}
            {workspaceState.persistence.save.state === "uncertain" && (
              <p className="language-attention" role="status">
                <Icon name="triangle-alert" />
                {message(locale, "settings.uncertain", { setting: text("help.layout") })}{" "}
                <button
                  type="button"
                  onClick={() => {
                    if (open) focusSetting(id, "layout");
                    void workspace.reconcilePreferences();
                  }}
                >
                  {text("settings.language.check")}
                </button>
              </p>
            )}
          </RecoveryFocusBoundary>
        </section>
        <SettingsReadFailureNotice
          state={state}
          controller={controller}
          locale={locale}
          onRecover={() => {
            if (open) focusSetting(id, "appearance");
          }}
        />
        {open && <ConnectionsPanel port={port} locale={locale} available={available} />}
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`${id}-${section.id}`}>
            <h3 id={`${id}-${section.id}`}>{section.title}</h3>
            {section.content}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
