import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import {
  commandDefinitions,
  message,
  nativeCommandIds,
  projectLinks,
  type AboutInformation,
  type CommandBridge,
  type CommandId,
  type CommandSnapshot,
  type InterfaceLocale,
  type ProjectLink,
  type SimpleMessageKey,
} from "@ohtia/contracts";
import { CommandController, presentationReason } from "./command-controller.js";
import { Dialog } from "./layers.js";
import { Button } from "./controls.js";
import { OhtiaBrand } from "./branding.js";
import { LucideGlyph } from "./iconography.js";

export type DecorationState = "static" | "animated" | "hidden";
type CopyState = { phase: "idle" | "pending" | "copied" | "failed"; attempt: number };
function CopyFeedback({
  copy,
  locale,
  manualAvailable = false,
  inDialog = false,
}: {
  copy: CopyState;
  locale: InterfaceLocale;
  manualAvailable?: boolean;
  inDialog?: boolean;
}) {
  if (copy.phase === "copied")
    return (
      <p key={copy.attempt} role="status" className="about-copied">
        <LucideGlyph name="clipboard-check" size={16} />
        {message(locale, "about.copied")}
      </p>
    );
  if (copy.phase === "failed")
    return (
      <p key={copy.attempt} role="alert" className="command-danger">
        <LucideGlyph name="octagon-alert" size={16} />
        {message(locale, manualAvailable ? "about.copyFailed" : "about.copyOutsideFailed")}
        {inDialog && !manualAvailable && <> {message(locale, "command.reason.modal_open")}</>}
      </p>
    );
  return null;
}
export function ProjectLinks({
  locale,
  onOpen,
}: {
  locale: InterfaceLocale;
  onOpen: (link: ProjectLink) => void;
}) {
  return (
    <>
      <nav className="about-links" aria-label={message(locale, "about.external")}>
        {(["repository", "documentation", "report"] as const).map((id) => (
          <a
            key={id}
            href={projectLinks[id]}
            onClick={(event) => {
              event.preventDefault();
              onOpen(id);
            }}
          >
            {message(
              locale,
              id === "repository"
                ? "about.repository"
                : id === "documentation"
                  ? "command.link.documentation"
                  : "command.link.report",
            )}
          </a>
        ))}
      </nav>
      <p className="external-caption">
        <LucideGlyph name="external-link" size={16} />
        {message(locale, "about.external")}
      </p>
    </>
  );
}
/** The browser ratio includes interface zoom; observe both density and actual capped CSS width. */
function AboutCharacter() {
  const image = useRef<HTMLImageElement>(null);
  const [vector, setVector] = useState(false);
  useLayoutEffect(() => {
    const element = image.current;
    if (!element) return;
    let density: MediaQueryList;
    let live = true;
    const update = () => {
      if (live)
        setVector((element.getBoundingClientRect().width || 128) * window.devicePixelRatio > 512);
    };
    const changed = () => {
      if (!live) return;
      density.removeEventListener("change", changed);
      bind();
      update();
    };
    const bind = () => {
      density = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
      density.addEventListener("change", changed);
    };
    bind();
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", changed);
    return () => {
      live = false;
      observer.disconnect();
      density.removeEventListener("change", changed);
      window.removeEventListener("resize", changed);
    };
  }, []);
  return (
    <img
      ref={image}
      className="about-character"
      src={`/branding/illustration.${vector ? "svg" : "png"}`}
      width={128}
      height={128}
      alt=""
    />
  );
}

export function AboutDialog({
  open,
  locale,
  info,
  failed = false,
  decoration = "static",
  manuscriptVisible = false,
  copy,
  onCopy,
  onClose,
  onOpenLink,
  actionFailed = false,
  copyDisabledReason,
}: {
  open: boolean;
  locale: InterfaceLocale;
  info?: AboutInformation;
  failed?: boolean;
  actionFailed?: boolean;
  copyDisabledReason?: string;
  decoration?: DecorationState;
  manuscriptVisible?: boolean;
  copy: CopyState;
  onCopy: () => void;
  onClose: () => void;
  onOpenLink: (link: ProjectLink) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const noticesId = useId();
  const text = (key: SimpleMessageKey) => message(locale, key);
  return (
    <Dialog
      open={open}
      title={text("command.about.open")}
      titleContent={<OhtiaBrand heading />}
      headingLevel={1}
      className="command-dialog about-dialog"
      closeLabel={text("dialog.close")}
      closeContent={<LucideGlyph name="x" />}
      onClose={onClose}
      bodyClassName="command-dialog-body"
      headingPrefix={
        open && decoration !== "hidden" && !manuscriptVisible ? <AboutCharacter /> : undefined
      }
      footer={
        <div className="command-dialog-footer">
          <Button label={text("dialog.close")} onPress={onClose} />
        </div>
      }
    >
      <p>{text("about.description")}</p>
      {failed ? (
        <p role="alert" className="command-danger">
          {text("about.loadFailed")}
        </p>
      ) : !info ? (
        <p role="status">{text("about.loading")}</p>
      ) : (
        <>
          <div className="about-version">
            <dl>
              <dt>{text("about.version")}</dt>
              <dd>{info.version}</dd>
              <dt>{text("about.build")}</dt>
              <dd>{info.build}</dd>
              <dt>{text("about.system")}</dt>
              <dd>
                {message(locale, `about.platform.${info.platform}`)} · {info.architecture}
              </dd>
            </dl>
            <div className="about-copy-actions">
              <Button
                label={text("command.version.copy")}
                onPress={onCopy}
                {...(copyDisabledReason ? { disabledReason: copyDisabledReason } : {})}
                {...(copy.phase === "pending" ? { loadingLabel: text("about.copying") } : {})}
              />
              <CopyFeedback copy={copy} locale={locale} manualAvailable />
            </div>
          </div>
          <ProjectLinks locale={locale} onOpen={onOpenLink} />
          <p>MIT · {info.copyright}</p>
          <details>
            <summary>MIT</summary>
            <p className="about-license">{info.license}</p>
          </details>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={noticesId}
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {text("about.notices")}
          </button>
          <ul
            hidden={!expanded}
            id={noticesId}
            className="about-notices"
            aria-label={text("about.notices")}
            tabIndex={0}
          >
            {info.notices.map((notice) => (
              <li key={notice.component}>
                {notice.component} · {notice.license}
              </li>
            ))}
          </ul>
        </>
      )}
      {actionFailed && (
        <p role="alert" className="command-danger">
          {text("command.failed")}
        </p>
      )}
    </Dialog>
  );
}
export function CommandButton({
  id,
  controller,
  locale,
  onInvoke,
  modalHandoff = false,
}: {
  modalHandoff?: boolean;
  id: CommandId;
  controller?: CommandController;
  locale: InterfaceLocale;
  onInvoke: (id: CommandId) => void;
}) {
  const definition = commandDefinitions.find((entry) => entry.id === id);
  if (!definition) throw new Error("Unknown command control.");
  const unavailable = controller?.entry(id).reason ?? (!controller ? "handler_missing" : undefined);
  const reason = modalHandoff && unavailable === "modal_open" ? undefined : unavailable;
  return (
    <Button
      label={message(locale, definition.label)}
      ariaKeyShortcuts={definition.shortcuts[controller?.context.platform ?? "linux"]
        .map((key) =>
          key.replace("Ctrl+", "Control+").replace("Cmd+", "Meta+").replace(/\+\+$/, "+Plus"),
        )
        .join(" ")}
      onPress={() => {
        onInvoke(id);
      }}
      {...(reason ? { disabledReason: message(locale, `command.reason.${reason}`) } : {})}
    />
  );
}
export function HelpDialog({
  open,
  locale,
  controller,
  onInvoke,
  onClose,
  onOpenLink,
  actionFailed = false,
  copy,
}: {
  open: boolean;
  locale: InterfaceLocale;
  copy?: CopyState;
  controller?: CommandController;
  onInvoke: (id: CommandId) => void;
  onClose: () => void;
  onOpenLink: (link: ProjectLink) => void;
  actionFailed?: boolean;
}) {
  return (
    <Dialog
      open={open}
      title={message(locale, "command.help.open")}
      closeLabel={message(locale, "dialog.close")}
      onClose={onClose}
      className="command-dialog help-dialog"
      bodyClassName="command-dialog-body"
      footer={
        <div className="command-dialog-footer">
          <Button label={message(locale, "dialog.close")} onPress={onClose} />
        </div>
      }
    >
      <p>{message(locale, "help.capabilities")}</p>
      {(["language", "appearance", "zoom", "characters", "layout"] as const).map((group) => (
        <section className="help-group" key={group}>
          <h3>{message(locale, `help.${group}`)}</h3>
          <p>{message(locale, `help.${group}.text`)}</p>
        </section>
      ))}
      <CommandButton
        id="shortcuts.open"
        modalHandoff
        locale={locale}
        {...(controller ? { controller } : {})}
        onInvoke={onInvoke}
      />
      <ProjectLinks locale={locale} onOpen={onOpenLink} />
      {copy && <CopyFeedback copy={copy} locale={locale} inDialog />}
      {actionFailed && (
        <p role="alert" className="command-danger">
          {message(locale, "command.failed")}
        </p>
      )}
    </Dialog>
  );
}
/** Composition owns this per-window controller; later features register their real handlers here. */
export function CommandSurfaces({
  bridge,
  locale,
  decoration = "static",
  manuscriptVisible = false,
  registerHandlers,
}: {
  bridge: CommandBridge;
  registerHandlers?: (controller: CommandController) => () => void;
  locale: InterfaceLocale;
  decoration?: DecorationState;
  manuscriptVisible?: boolean;
}) {
  const [controller, setController] = useState<CommandController>();
  const [, setSnapshot] = useState<CommandSnapshot>();
  const [surface, setSurface] = useState<"about" | "help">();
  const [info, setInfo] = useState<AboutInformation>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [copy, setCopy] = useState<CopyState>({ phase: "idle", attempt: 0 });
  const [failure, setFailure] = useState(false);
  const pendingHandoff = useRef<CommandId | undefined>(undefined);
  const current = useRef({
    live: true,
    incarnation: 0,
    localeEpoch: 0,
    surface: undefined as "about" | "help" | undefined,
    locale,
    composing: false,
    composingTarget: undefined as Node | undefined,
    copyBusy: false,
  });
  useEffect(
    () => () => {
      current.current.composing = false;
      current.current.composingTarget = undefined;
    },
    [],
  );
  useLayoutEffect(() => {
    if (current.current.locale !== locale) {
      current.current.locale = locale;
      current.current.localeEpoch++;
      setCopy({ phase: "idle", attempt: 0 });
    }
    controller?.setLocale(locale);
  }, [locale, controller]);
  useEffect(() => {
    let live = true;
    const isLive = () => live;
    let registry: CommandController | undefined;
    let unsubscribe = () => {};
    let native = () => {};
    let extensions = () => {};
    current.current.live = true;
    current.current.surface = undefined;
    current.current.copyBusy = false;
    pendingHandoff.current = undefined;
    setSurface(undefined);
    setCopy({ phase: "idle", attempt: 0 });
    setFailure(false);
    if (current.current.composingTarget && !current.current.composingTarget.isConnected) {
      current.current.composing = false;
      current.current.composingTarget = undefined;
    }
    const editable = (id: CommandId) => {
      const element = document.activeElement;
      return (
        element instanceof HTMLElement &&
        (element.isContentEditable ||
          element instanceof HTMLTextAreaElement ||
          (element instanceof HTMLInputElement &&
            ["text", "search", "url", "tel", "email", "password", "number"].includes(
              element.type,
            ))) &&
        (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ||
          (!element.disabled &&
            (!element.readOnly || id === "edit.copy" || id === "edit.selectAll")))
      );
    };
    const update = () => {
      registry?.changed();
    };
    const composition = (event: Event) => {
      current.current.composing = event.type === "compositionstart";
      current.current.composingTarget =
        current.current.composing && event.target instanceof Node ? event.target : undefined;
      update();
    };
    const focusOut = (event: Event) => {
      if (event.target === current.current.composingTarget) {
        current.current.composing = false;
        current.current.composingTarget = undefined;
      }
      update();
    };
    const blur = () => {
      current.current.composing = false;
      current.current.composingTarget = undefined;
      update();
    };
    const open = (next: "about" | "help") => {
      current.current.incarnation++;
      current.current.surface = next;
      setSurface(next);
      setFailure(false);
      setCopy({ phase: "idle", attempt: 0 });
      update();
    };
    void bridge
      .context()
      .then((context) => {
        if (!live) return;
        registry = new CommandController(context, current.current.locale);
        const reason = (id: CommandId) =>
          presentationReason(id, {
            modal:
              !!document.querySelector("dialog[open]:not(.command-dialog)") ||
              !!current.current.surface,
            composing: current.current.composing,
            editable: editable(id) || (id === "edit.copy" && !!document.getSelection()?.toString()),
          });
        const state = (id: CommandId) => {
          const unavailable = reason(id);
          return unavailable ? { reason: unavailable } : {};
        };
        for (const id of [...nativeCommandIds, "version.copy"] as const)
          registry.register(id, {
            state: () =>
              id === "version.copy" && current.current.copyBusy ? { reason: "busy" } : state(id),
            run: async () => {
              const incarnation = current.current.incarnation;
              const localeEpoch = current.current.localeEpoch;
              if (id === "version.copy") {
                current.current.copyBusy = true;
                setCopy((prior) => ({ phase: "pending", attempt: prior.attempt + 1 }));
                update();
              }
              let ok = false;
              try {
                ok =
                  id === "version.copy"
                    ? await bridge.copyVersionInformation(current.current.locale)
                    : await bridge.perform(id);
              } catch {
                ok = false;
              }
              if (live && id === "version.copy") {
                current.current.copyBusy = false;
                update();
              }
              if (
                !live ||
                incarnation !== current.current.incarnation ||
                (id === "version.copy" && localeEpoch !== current.current.localeEpoch)
              )
                return ok;
              if (id === "version.copy")
                setCopy((prior) => ({ ...prior, phase: ok ? "copied" : "failed" }));
              else if (!ok) setFailure(true);
              return ok;
            },
          });
        registry.register("help.open", {
          state: () => state("help.open"),
          run: () => {
            open("help");
            return true;
          },
        });
        registry.register("about.open", {
          state: () => state("about.open"),
          run: async () => {
            open("about");
            setInfo(undefined);
            setLoadFailed(false);
            const incarnation = current.current.incarnation;
            try {
              const info = await bridge.about();
              if (live && incarnation === current.current.incarnation) setInfo(info);
            } catch {
              if (live && incarnation === current.current.incarnation) setLoadFailed(true);
              return false;
            }
            return true;
          },
        });
        extensions = registerHandlers?.(registry) ?? (() => {});
        let publishing = false;
        let latest: CommandSnapshot | undefined;
        const flush = async () => {
          try {
            while (isLive() && latest) {
              const snapshot = latest;
              latest = undefined;
              const accepted = await bridge.publish(snapshot);
              if (live && !accepted) setFailure(true);
            }
          } catch {
            if (live) setFailure(true);
          } finally {
            publishing = false;
          }
        };
        const publish = () => {
          if (!registry || !live) return;
          const snapshot = registry.snapshot();
          setSnapshot(snapshot);
          latest = snapshot;
          if (!publishing) {
            publishing = true;
            void flush();
          }
        };
        unsubscribe = registry.subscribe(publish);
        native = bridge.onIntent((intent) => {
          void registry?.receive(intent);
        });
        setController(registry);
        publish();
      })
      .catch(() => {
        if (live) setFailure(true);
      });
    const modals = new MutationObserver((records) => {
      if (current.current.composingTarget && !current.current.composingTarget.isConnected) blur();
      else if (records.some((record) => record.type === "attributes")) update();
    });
    modals.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    window.addEventListener("blur", blur);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", focusOut);
    document.addEventListener("selectionchange", update);
    document.addEventListener("compositionstart", composition);
    document.addEventListener("compositionend", composition);
    return () => {
      modals.disconnect();
      window.removeEventListener("blur", blur);
      live = false;
      current.current.live = false;
      current.current.incarnation++;
      native();
      extensions();
      unsubscribe();
      registry?.dispose();
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", focusOut);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("compositionstart", composition);
      document.removeEventListener("compositionend", composition);
    };
  }, [bridge, registerHandlers]);
  useEffect(() => {
    if (surface || !pendingHandoff.current || !controller) return;
    const command = pendingHandoff.current;
    pendingHandoff.current = undefined;
    void controller.invoke(command);
  }, [surface, controller]);
  const dismiss = () => {
    current.current.incarnation++;
    current.current.surface = undefined;
    setSurface(undefined);
    setCopy({ phase: "idle", attempt: 0 });
    setFailure(false);
    controller?.changed();
  };
  const close = () => {
    pendingHandoff.current = undefined;
    dismiss();
  };
  const handoff = (id: CommandId) => {
    pendingHandoff.current = id;
    dismiss();
  };
  const invoke = (id: CommandId) => {
    void controller?.invoke(id);
  };
  const openLink = (link: ProjectLink) => {
    const incarnation = current.current.incarnation;
    void bridge
      .openLink(link)
      .then((ok) => {
        if (current.current.live && incarnation === current.current.incarnation) setFailure(!ok);
      })
      .catch(() => {
        if (current.current.live && incarnation === current.current.incarnation) setFailure(true);
      });
  };
  const copyReason = controller?.entry("version.copy").reason;
  return (
    <>
      <div className="actions command-entry-actions">
        <CommandButton
          id="help.open"
          locale={locale}
          {...(controller ? { controller } : {})}
          onInvoke={invoke}
        />
        <CommandButton
          id="about.open"
          locale={locale}
          {...(controller ? { controller } : {})}
          onInvoke={invoke}
        />
        <CommandButton
          id="window.new"
          locale={locale}
          {...(controller ? { controller } : {})}
          onInvoke={invoke}
        />
        <CommandButton
          id="application.quit"
          locale={locale}
          {...(controller ? { controller } : {})}
          onInvoke={invoke}
        />
      </div>
      {failure && !surface && (
        <p role="alert" className="command-danger">
          {message(locale, "command.failed")}
        </p>
      )}
      {!surface && <CopyFeedback copy={copy} locale={locale} />}
      <HelpDialog
        copy={copy}
        actionFailed={failure}
        open={surface === "help"}
        locale={locale}
        {...(controller ? { controller } : {})}
        onInvoke={(id) => {
          if (id === "shortcuts.open") handoff(id);
          else invoke(id);
        }}
        onClose={close}
        onOpenLink={openLink}
      />
      <AboutDialog
        actionFailed={failure}
        {...(copyReason
          ? { copyDisabledReason: message(locale, `command.reason.${copyReason}`) }
          : {})}
        open={surface === "about"}
        locale={locale}
        {...(info ? { info } : {})}
        failed={loadFailed}
        decoration={decoration}
        manuscriptVisible={manuscriptVisible}
        copy={copy}
        onCopy={() => {
          invoke("version.copy");
        }}
        onClose={close}
        onOpenLink={openLink}
      />
    </>
  );
}
