import { useEffect, useId, useSyncExternalStore } from "react";
import { message, type InterfaceLocale } from "@ohtia/contracts";
import { LucideGlyph as Icon } from "./iconography.js";
import type { UpdateCheckController } from "./update-check-controller.js";

/** SPEC-001-040: the Settings control for the startup update check, enabled by default. */
export function UpdateCheckSetting({
  controller,
  locale,
  available,
}: {
  readonly controller: UpdateCheckController;
  readonly locale: InterfaceLocale;
  readonly available: boolean;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const id = useId();
  useEffect(() => {
    if (available) void controller.refresh();
  }, [controller, available]);
  const name = message(locale, "settings.updates");
  const submitting = state.phase === "submitting";
  const blocked = !available || !state.current || submitting || state.phase === "uncertain";
  return (
    <div className="update-check-setting">
      <div className="settings-group-heading">
        <label className="settings-layout-option">
          <input
            type="checkbox"
            checked={state.draft}
            aria-disabled={blocked}
            aria-describedby={`${id}-help`}
            onChange={(event) => {
              if (!blocked) void controller.choose(event.currentTarget.checked);
            }}
          />
          {message(locale, "settings.updateCheck")}
        </label>
        <span className="settings-save-state" role="status">
          {(submitting || state.phase === "confirmed") && (
            <>
              <Icon name={submitting ? "circle-dashed" : "check"} />
              {message(locale, submitting ? "saving" : "saved")}
            </>
          )}
        </span>
      </div>
      <p id={`${id}-help`}>{message(locale, "update.privacy")}</p>
      {state.phase === "rejected" && (
        <p className="language-danger" role="alert" data-settings-attention="octagon-alert">
          <Icon name="octagon-alert" />
          {message(locale, "settings.updateCheckRejected")}
        </p>
      )}
      {state.phase === "conflict" && (
        <p className="language-attention" role="status" data-settings-attention="git-compare">
          <Icon name="git-compare" />
          {message(locale, "settings.conflict", { setting: name })}
        </p>
      )}
      {state.phase === "uncertain" && (
        <p className="language-attention" role="status" data-settings-attention="triangle-alert">
          <Icon name="triangle-alert" />
          {message(locale, "settings.uncertain", { setting: name })}{" "}
          <button
            type="button"
            onClick={() => {
              void controller.check();
            }}
          >
            {message(locale, "settings.language.check")}
          </button>
        </p>
      )}
      {available && state.readFailed && (
        <p className="language-danger" role="alert" data-settings-attention="octagon-alert">
          <Icon name="octagon-alert" />
          {message(locale, "settings.readFailed")}{" "}
          <button
            type="button"
            onClick={() => {
              void controller.refresh();
            }}
          >
            {message(locale, "refresh")}
          </button>
        </p>
      )}
    </div>
  );
}
