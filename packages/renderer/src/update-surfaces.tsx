import { useId, useState, type ReactNode, type RefObject } from "react";
import {
  message,
  type InterfaceLocale,
  type SimpleMessageKey,
  type UpdateCheckFailure,
  type UpdateRoute,
  type UpdateState,
} from "@ohtia/contracts";
import { Dialog } from "./layers.js";
import { Button } from "./controls.js";
import { LucideGlyph } from "./iconography.js";
import type { UpdateSnapshot } from "./update-controller.js";

const failureText: Record<UpdateCheckFailure, SimpleMessageKey> = {
  timeout: "update.failed.timeout",
  network: "update.failed.network",
  invalid_response: "update.failed.response",
  too_large: "update.failed.response",
};

/** The newer version a completed check found, or none. */
export function availableVersion(state: UpdateState | undefined): string | undefined {
  return state?.available?.version;
}

/**
 * Keeps the last value shown while `hold` is set, so a change never appears during writing
 * (WCAG 2.2.4 in the design system); the current value appears as soon as `hold` clears.
 */
export function useHeldWhileWriting<T>(value: T, hold: boolean): T {
  const [shown, setShown] = useState(value);
  if (!hold && !Object.is(shown, value)) setShown(value);
  return hold ? shown : value;
}

/** How to update on this system, with the one control main resolves for it. */
export function UpdateRouteControl({
  locale,
  route,
  openFailed,
  onOpen,
}: {
  readonly locale: InterfaceLocale;
  readonly route: UpdateRoute | undefined;
  readonly openFailed: boolean;
  readonly onOpen: () => void;
}) {
  const text = (key: SimpleMessageKey) => message(locale, key);
  if (!route) return null;
  return (
    <div className="update-route">
      <p>{text(route === "download_page" ? "update.how.download" : "update.how.system")}</p>
      {route !== "system" && (
        <Button
          variant="primary"
          label={text(route === "download_page" ? "update.openDownload" : "update.openSoftware")}
          onPress={onOpen}
        />
      )}
      {route === "download_page" && (
        <p className="external-caption">
          <LucideGlyph name="external-link" size={16} />
          {text("about.external")}
        </p>
      )}
      {openFailed && (
        <p role="alert" className="command-danger">
          <LucideGlyph name="octagon-alert" size={16} />
          {text(route === "software_centre" ? "update.openSoftwareFailed" : "command.failed")}
        </p>
      )}
    </div>
  );
}

/** About's short form of the same state: the newer version and how to get it, without notes. */
export function AboutUpdate({
  locale,
  snapshot,
  onOpenRoute,
}: {
  readonly locale: InterfaceLocale;
  readonly snapshot: UpdateSnapshot | undefined;
  readonly onOpenRoute: () => void;
}) {
  const version = availableVersion(snapshot?.notice?.state);
  if (!snapshot || !version) return null;
  return (
    <section className="about-update">
      <p>
        <LucideGlyph name="download" size={16} />
        {message(locale, "update.available", { version })}
      </p>
      <UpdateRouteControl
        locale={locale}
        route={snapshot.route}
        openFailed={snapshot.openFailed}
        onOpen={onOpenRoute}
      />
    </section>
  );
}

/** Progress and results; a failure is announced apart, so this region never changes role. */
function statusText(locale: InterfaceLocale, state: UpdateState | undefined, refused: boolean) {
  if (refused || state?.check === "failed") return "";
  if (!state || state.check === "checking") return message(locale, "update.checking");
  if (state.check === "unavailable") return message(locale, "update.unavailable");
  const version = availableVersion(state);
  if (version) return message(locale, "update.available", { version });
  return state.check === "checked" ? message(locale, "update.current") : "";
}

export function UpdateDialog({
  open,
  locale,
  snapshot,
  onCheck,
  onOpenRoute,
  onClose,
  feedback,
  returnFocusRef,
}: {
  readonly open: boolean;
  readonly locale: InterfaceLocale;
  readonly snapshot: UpdateSnapshot | undefined;
  readonly onCheck: () => void;
  readonly onOpenRoute: () => void;
  readonly onClose: () => void;
  readonly feedback?: ReactNode;
  readonly returnFocusRef?: Readonly<RefObject<HTMLElement | null>>;
}) {
  const text = (key: SimpleMessageKey) => message(locale, key);
  const notesId = useId();
  const state = snapshot?.notice?.state;
  const available = state?.available ?? null;
  const refused = snapshot?.checkRefused ?? false;
  // A refused request reports itself; otherwise only a failed manual check reports its cause.
  const failure = refused
    ? text("command.failed")
    : state?.check === "failed" && state.failure
      ? text(failureText[state.failure])
      : undefined;
  return (
    <Dialog
      open={open}
      title={text("update.title")}
      closeLabel={text("dialog.close")}
      closeContent={<LucideGlyph name="x" />}
      onClose={onClose}
      className="command-dialog update-dialog"
      bodyClassName="command-dialog-body"
      {...(returnFocusRef ? { returnFocusRef } : {})}
      footer={
        <div className="command-dialog-footer">
          <Button label={text("dialog.close")} onPress={onClose} />
        </div>
      }
    >
      {feedback}
      <p role="status" className="update-status">
        {statusText(locale, state, refused)}
      </p>
      {failure && (
        <>
          <p role="alert" className="command-danger">
            <LucideGlyph name="octagon-alert" size={16} />
            {failure}
          </p>
          <Button label={text("taskNotice.tryAgain")} onPress={onCheck} />
        </>
      )}
      {state && (
        <>
          <div className="about-version">
            <dl>
              <dt>{text("update.installed")}</dt>
              <dd>{state.installedVersion}</dd>
              {available && (
                <>
                  <dt>{text("update.new")}</dt>
                  <dd>{available.version}</dd>
                </>
              )}
            </dl>
          </div>
          {available && (
            <>
              {available.notes.length > 0 && (
                <section className="update-notes-section">
                  <h3 id={notesId}>{text("update.notes")}</h3>
                  {/* Release notes are inert text: never parsed as Markdown or HTML. */}
                  <div
                    className="update-notes"
                    role="region"
                    aria-labelledby={notesId}
                    tabIndex={0}
                  >
                    {available.notes.join("")}
                  </div>
                  {available.notesTruncated && <p>{text("update.notesTruncated")}</p>}
                </section>
              )}
              <UpdateRouteControl
                locale={locale}
                route={snapshot.route}
                openFailed={snapshot.openFailed}
                onOpen={onOpenRoute}
              />
            </>
          )}
          {state.check !== "unavailable" && (
            <p className="external-caption">{text("update.privacy")}</p>
          )}
        </>
      )}
    </Dialog>
  );
}
