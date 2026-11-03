import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { message, type InterfaceLocale, type SimpleMessageKey } from "@ohtia/contracts";
import { LucideGlyph as Icon } from "./iconography.js";
import {
  type SettingsState,
  type SettingFeature,
  type SettingValue,
  SettingsController,
} from "./settings-controller.js";
export function settingName(locale: InterfaceLocale, feature: SettingFeature): string {
  return message(
    locale,
    feature === "appearance"
      ? "help.appearance"
      : feature === "character"
        ? "help.characters"
        : "help.zoom",
  );
}
export function settingLabel(
  locale: InterfaceLocale,
  feature: SettingFeature,
  value: SettingValue,
): string {
  return feature === "appearance"
    ? message(locale, `command.theme.${value as "system" | "light" | "dark"}`)
    : feature === "character"
      ? message(locale, `settings.${value as "animated" | "static" | "hidden"}`)
      : new Intl.NumberFormat(locale, { style: "percent" }).format(Number(value) / 100);
}
export function RecoveryFocusBoundary({
  children,
  onRecover,
  className,
  hidden,
  onFocusWithin,
  onBlurOutside,
}: {
  readonly children: ReactNode;
  readonly onRecover: () => void;
  readonly className?: string;
  readonly hidden?: boolean;
  readonly onFocusWithin?: () => void;
  readonly onBlurOutside?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const previous = focused.current;
    if (previous && !previous.isConnected) {
      focused.current = null;
      if (previous.ownerDocument.activeElement === previous.ownerDocument.body) onRecover();
    }
  });
  return (
    <div
      ref={root}
      hidden={hidden}
      className={className ?? "settings-notices"}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement) focused.current = event.target;
        onFocusWithin?.();
      }}
      onBlurCapture={(event) => {
        if (
          (event.relatedTarget instanceof Node && !root.current?.contains(event.relatedTarget)) ||
          (event.relatedTarget === null &&
            event.target instanceof HTMLElement &&
            event.target.isConnected &&
            event.target.ownerDocument.activeElement !== event.target)
        ) {
          focused.current = null;
          onBlurOutside?.();
        }
      }}
    >
      {children}
    </div>
  );
}
export function SettingsNotices({
  feature,
  state,
  controller,
  locale,
  onChooseAgain,
  onRecover,
  showChanged = false,
}: {
  readonly feature: SettingFeature;
  readonly state: SettingsState;
  readonly controller: SettingsController;
  readonly locale: InterfaceLocale;
  readonly onChooseAgain: () => void;
  readonly onRecover: () => void;
  readonly showChanged?: boolean;
}) {
  const text = (key: SimpleMessageKey) => message(locale, key);
  const name = (feature: SettingFeature) => settingName(locale, feature);
  const label = (feature: SettingFeature, value: SettingValue) =>
    settingLabel(locale, feature, value);
  const setting = state.settings[feature];
  const current = state.current?.[feature];
  return (
    <RecoveryFocusBoundary onRecover={onRecover}>
      {setting.phase === "rejected" && (
        <p className="language-danger" role="alert">
          <Icon name="octagon-alert" />
          {message(locale, "settings.rejected", {
            setting: name(feature),
            value: current ? label(feature, current.value) : "—",
          })}{" "}
          <button
            type="button"
            onClick={() => {
              onRecover();
              void controller.retry(feature);
            }}
          >
            {text("settings.language.tryAgain")}
          </button>
        </p>
      )}
      {setting.phase === "uncertain" && (
        <p className="language-attention" role="status">
          <Icon name="triangle-alert" />
          {setting.canChoose
            ? text("settings.language.recovered")
            : message(locale, "settings.uncertain", { setting: name(feature) })}{" "}
          <button
            type="button"
            onClick={() => {
              onRecover();
              void controller.check(feature);
            }}
          >
            {text("settings.language.check")}
          </button>
          {setting.canChoose && (
            <button
              type="button"
              onClick={() => {
                onRecover();
                void controller.retry(feature);
              }}
            >
              {text("settings.language.tryAgain")}
            </button>
          )}
        </p>
      )}
      {setting.phase === "conflict" && !state.readFailed && (
        <p className="language-attention" role="status">
          <Icon name="git-compare" />
          {message(locale, "settings.conflict", { setting: name(feature) })}{" "}
          <button type="button" onClick={onChooseAgain}>
            {text("settings.language.chooseAgain")}
          </button>
        </p>
      )}
      {setting.displayFailed && (
        <p className="language-attention" role="status">
          <Icon name="triangle-alert" />
          {message(
            locale,
            current?.source === "saved" ? "settings.applyFailed" : "settings.displayFailed",
            { setting: name(feature) },
          )}{" "}
          <button
            type="button"
            onClick={() => {
              onRecover();
              controller.applyAgain(feature);
            }}
          >
            {text("settings.language.applyAgain")}
          </button>
        </p>
      )}
      {showChanged && setting.changedFromWindow && current && (
        <p role="status">
          <Icon name="info" />
          {message(locale, "settings.changed", {
            setting: name(feature),
            value: label(feature, current.value),
          })}
        </p>
      )}
      {current?.source === "invalid_fallback" && (
        <p className="language-danger" role="alert">
          <Icon name="octagon-alert" />
          {message(locale, "settings.fallback", { setting: name(feature) })}
        </p>
      )}
    </RecoveryFocusBoundary>
  );
}

export function SettingsZoomRefusalNotice({
  state,
  controller,
  locale,
  onRecover,
}: {
  readonly state: SettingsState;
  readonly controller: SettingsController;
  readonly locale: InterfaceLocale;
  readonly onRecover: () => void;
}) {
  return (
    <RecoveryFocusBoundary onRecover={onRecover}>
      {state.zoomBusy && (
        <p role="status" className="language-attention">
          <Icon name="triangle-alert" />
          {message(locale, "settings.zoomUnavailable")}{" "}
          <button
            type="button"
            onClick={() => {
              onRecover();
              void controller.refresh();
            }}
          >
            {message(locale, "settings.language.check")}
          </button>
        </p>
      )}
    </RecoveryFocusBoundary>
  );
}
export function SettingsReadFailureNotice({
  state,
  controller,
  locale,
  onRecover,
}: {
  readonly state: SettingsState;
  readonly controller: SettingsController;
  readonly locale: InterfaceLocale;
  readonly onRecover: () => void;
}) {
  return (
    <RecoveryFocusBoundary onRecover={onRecover}>
      {state.readFailed && (
        <p role="alert" className="language-danger">
          <Icon name="octagon-alert" />
          {message(locale, "settings.readFailed")}{" "}
          <button
            type="button"
            onClick={() => {
              onRecover();
              void controller.refresh();
            }}
          >
            {message(locale, "refresh")}
          </button>
        </p>
      )}
    </RecoveryFocusBoundary>
  );
}
export function SettingsFeedback({
  state,
  controller,
  locale,
  inDialog,
  onChooseAgain,
  onOpenSettings,
}: {
  readonly state: SettingsState;
  readonly controller: SettingsController;
  readonly locale: InterfaceLocale;
  readonly inDialog: boolean;
  readonly onChooseAgain: (feature: SettingFeature) => void;
  readonly onOpenSettings: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [retainFocus, setRetainFocus] = useState(false);
  const hasNotices =
    state.readFailed ||
    state.zoomBusy ||
    (["appearance", "character", "zoom"] as const).some((feature) => {
      const setting = state.settings[feature];
      return (
        setting.phase === "rejected" ||
        setting.phase === "uncertain" ||
        (setting.phase === "conflict" && !state.readFailed) ||
        setting.displayFailed ||
        state.current?.[feature].source === "invalid_fallback"
      );
    });
  const recover = () => {
    if (inDialog) {
      if (anchor.current?.closest("dialog[open]")) anchor.current.focus();
    } else if (!document.querySelector("dialog[open]"))
      document.querySelector<HTMLButtonElement>(".command-entry-actions button")?.focus();
  };
  return (
    <RecoveryFocusBoundary
      onRecover={recover}
      className="settings-feedback"
      hidden={!hasNotices && !retainFocus}
      onFocusWithin={() => {
        if (inDialog) setRetainFocus(true);
      }}
      onBlurOutside={() => {
        setRetainFocus(false);
      }}
    >
      {inDialog && (hasNotices || retainFocus) && (
        <button ref={anchor} type="button" onClick={onOpenSettings}>
          {message(locale, "command.settings.open")}
        </button>
      )}
      {(["appearance", "character", "zoom"] as const).map((feature) => (
        <SettingsNotices
          key={feature}
          feature={feature}
          state={state}
          controller={controller}
          locale={locale}
          onRecover={recover}
          onChooseAgain={() => {
            onChooseAgain(feature);
          }}
        />
      ))}
      <SettingsZoomRefusalNotice
        state={state}
        controller={controller}
        locale={locale}
        onRecover={recover}
      />
      <SettingsReadFailureNotice
        state={state}
        controller={controller}
        locale={locale}
        onRecover={recover}
      />
    </RecoveryFocusBoundary>
  );
}
