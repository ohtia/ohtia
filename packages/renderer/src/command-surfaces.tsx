import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  useMemo,
  type RefObject,
  type ReactNode,
} from "react";
import {
  commandDefinitions,
  message,
  nativeCommandIds,
  projectLinks,
  type AboutInformation,
  type CommandBridge,
  type CommandId,
  type CommandSnapshot,
  type WindowCommandResult,
  type CommandPlatform,
  type CommandReason,
  type InterfaceLocale,
  type ProjectLink,
  type SimpleMessageKey,
} from "@ohtia/contracts";
import { CommandController, presentationReason } from "./command-controller.js";
import { Dialog } from "./layers.js";
import { CommandPalette, KeyboardShortcutsDialog } from "./command-discovery.js";
import { Button } from "./controls.js";
import { OhtiaBrand, StaticCharacterIllustration } from "./branding.js";
import { LucideGlyph } from "./iconography.js";

const menuButtonSelector =
  '[data-workspace-command="menu.open"], [data-command-id="menu.open"] button';
function currentMenuButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>(menuButtonSelector)].find(
    (button) => !button.closest("[hidden], [inert], dialog:not([open])"),
  );
}

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

export function ProductCharacter() {
  return <StaticCharacterIllustration />;
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
  feedback,
  returnFocusRef,
  copyDisabledReason,
}: {
  open: boolean;
  locale: InterfaceLocale;
  info?: AboutInformation;
  failed?: boolean;
  actionFailed?: boolean;
  copyDisabledReason?: string;
  feedback?: ReactNode;
  returnFocusRef?: Readonly<RefObject<HTMLElement | null>>;
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
      {...(returnFocusRef ? { returnFocusRef } : {})}
      headingPrefix={
        open && decoration !== "hidden" && !manuscriptVisible ? <ProductCharacter /> : undefined
      }
      footer={
        <div className="command-dialog-footer">
          <Button label={text("dialog.close")} onPress={onClose} />
        </div>
      }
    >
      {feedback}
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
    <span data-command-id={id}>
      <Button
        label={message(locale, definition.label)}
        {...(id === "menu.open" ? { ariaHasPopup: "menu" as const } : {})}
        ariaKeyShortcuts={definition.shortcuts[controller?.context.platform ?? "linux"]
          .filter((key) => key !== "Alt")
          .map((key) =>
            key.replace("Ctrl+", "Control+").replace("Cmd+", "Meta+").replace(/\+\+$/, "+Plus"),
          )
          .join(" ")}
        onPress={() => {
          onInvoke(id);
        }}
        {...(reason ? { disabledReason: message(locale, `command.reason.${reason}`) } : {})}
      />
    </span>
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
  feedback,
  returnFocusRef,
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
  feedback?: ReactNode;
  returnFocusRef?: Readonly<RefObject<HTMLElement | null>>;
}) {
  return (
    <Dialog
      open={open}
      title={message(locale, "command.help.open")}
      closeLabel={message(locale, "dialog.close")}
      onClose={onClose}
      className="command-dialog help-dialog"
      bodyClassName="command-dialog-body"
      {...(returnFocusRef ? { returnFocusRef } : {})}
      footer={
        <div className="command-dialog-footer">
          <Button label={message(locale, "dialog.close")} onPress={onClose} />
        </div>
      }
    >
      {feedback}
      <p>{message(locale, "help.capabilities")}</p>
      {(["language", "appearance", "zoom", "characters", "layout"] as const).map((group) => (
        <section className="help-group" key={group}>
          <h3>{message(locale, `help.${group}`)}</h3>
          <p>
            {message(
              locale,
              group === "layout" &&
                controller &&
                controller.entry("layout.reset").reason !== "handler_missing"
                ? "workspace.helpLayout"
                : `help.${group}.text`,
            )}
          </p>
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
  renderSettings,
  renderFeedback,
  children,
  returnFocusRef,
}: {
  returnFocusRef?: Readonly<RefObject<HTMLElement | null>>;
  children?: (controller: CommandController | undefined) => ReactNode;
  bridge: CommandBridge;
  registerHandlers?: (
    controller: CommandController,
    reason: (id: CommandId) => CommandReason | undefined,
  ) => () => void;
  renderSettings?: (
    open: boolean,
    close: () => void,
    platform: CommandPlatform,
    feedback: ReactNode,
    returnFocus: Readonly<RefObject<HTMLElement | null>>,
  ) => ReactNode;
  renderFeedback?: (openSettings: () => void, inDialog: boolean) => ReactNode;
  locale: InterfaceLocale;
  decoration?: DecorationState;
  manuscriptVisible?: boolean;
}) {
  const settingsRenderer = useRef(renderSettings);
  settingsRenderer.current = renderSettings;
  const settingsAvailable = !!renderSettings;
  const [controller, setController] = useState<CommandController>();
  const [, setSnapshot] = useState<CommandSnapshot>();
  const [surface, setSurface] = useState<"about" | "help" | "settings" | "palette" | "shortcuts">();
  const [paletteSnapshot, setPaletteSnapshot] = useState<CommandSnapshot>();
  const inspectingOrigin = useRef(false);
  const [info, setInfo] = useState<AboutInformation>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [copy, setCopy] = useState<CopyState>({ phase: "idle", attempt: 0 });
  const [failure, setFailure] = useState(false);
  const [unavailable, setUnavailable] = useState<{ command: CommandId; reason: CommandReason }>();
  const pendingHandoff = useRef<CommandId | undefined>(undefined);
  const actionBar = useRef<HTMLDivElement>(null);
  const modalTrigger = useRef<HTMLElement | null>(null);
  const modalReturnFocus = useMemo(
    () => ({
      get current(): HTMLElement | null {
        const original = modalTrigger.current;
        return original &&
          original.isConnected &&
          original !== original.ownerDocument.body &&
          !original.closest("dialog:not([open]), [hidden], [inert]")
          ? original
          : (returnFocusRef?.current ??
              actionBar.current?.querySelector<HTMLElement>("button") ??
              null);
      },
    }),
    [returnFocusRef],
  );
  const current = useRef({
    live: true,
    incarnation: 0,
    localeEpoch: 0,
    surface: undefined as "about" | "help" | "settings" | "palette" | "shortcuts" | undefined,
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
    let unsubscribeResults = () => {};
    let native = () => {};
    let wheel = () => {};
    let resetWheel = () => {};
    let extensions = () => {};
    current.current.live = true;
    current.current.surface = undefined;
    current.current.copyBusy = false;
    pendingHandoff.current = undefined;
    setSurface(undefined);
    setCopy({ phase: "idle", attempt: 0 });
    setFailure(false);
    setUnavailable(undefined);
    if (current.current.composingTarget && !current.current.composingTarget.isConnected) {
      current.current.composing = false;
      current.current.composingTarget = undefined;
    }
    const editable = (id: CommandId) => {
      const element = inspectingOrigin.current ? modalReturnFocus.current : document.activeElement;
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
      resetWheel();
      current.current.composing = false;
      current.current.composingTarget = undefined;
      update();
    };
    const open = (next: "about" | "help" | "settings" | "palette" | "shortcuts") => {
      modalTrigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
              (!!current.current.surface && !inspectingOrigin.current),
            composing: !inspectingOrigin.current && current.current.composing,
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
        for (const [id, surface] of [
          ["palette.open", "palette"],
          ["shortcuts.open", "shortcuts"],
        ] as const)
          registry.register(id, {
            state: () => state(id),
            run: () => {
              open(surface);
              return true;
            },
          });
        for (const id of ["window.new", "menu.open"] as const) {
          if (id === "menu.open" && context.platform === "darwin") continue;
          registry.register(id, {
            state: () => state(id),
            run: async (execution) => {
              const button = currentMenuButton();
              const rect = button?.getBoundingClientRect();
              if (id === "menu.open" && !rect) return false;
              let result: WindowCommandResult;
              try {
                result = await bridge.windowAction({
                  intent: execution.intent,
                  ...(id === "menu.open" && rect
                    ? {
                        anchor: {
                          x: Math.max(0, Math.round(rect.left)),
                          y: Math.max(0, Math.round(rect.bottom)),
                        },
                      }
                    : {}),
                });
              } catch {
                result = { status: "failed" };
              }
              if (execution.isCurrent()) {
                if (
                  id === "menu.open" &&
                  result.status === "completed" &&
                  "menuDismissed" in result &&
                  result.menuDismissed &&
                  !document.querySelector("dialog[open]")
                )
                  currentMenuButton()?.focus();
                if (result.status === "failed") setFailure(true);
              }
              return result.status === "completed" ? { status: "completed" } : result;
            },
          });
        }
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
        if (settingsAvailable)
          registry.register("settings.open", {
            state: () => state("settings.open"),
            run: () => {
              open("settings");
              return true;
            },
          });
        extensions = registerHandlers?.(registry, reason) ?? (() => {});
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
          // State providers are synchronous. Inspect the restored origin target without changing
          // native-menu availability or invocation admission while the palette owns the modal.
          if (current.current.surface === "palette") {
            inspectingOrigin.current = true;
            try {
              setPaletteSnapshot(registry.snapshot());
            } finally {
              inspectingOrigin.current = false;
            }
          }
          setUnavailable((previous) =>
            previous &&
            previous.command !== "window.new" &&
            previous.command !== "menu.open" &&
            registry?.entry(previous.command).reason !== previous.reason
              ? undefined
              : previous,
          );
          latest = snapshot;
          if (!publishing) {
            publishing = true;
            void flush();
          }
        };
        unsubscribe = registry.subscribe(publish);
        unsubscribeResults = registry.subscribeResults((result, command) => {
          if (!live) return;
          setUnavailable(
            result.status === "unavailable" &&
              (command === "window.new" ||
                command === "menu.open" ||
                registry?.entry(command).reason === result.reason)
              ? { command, reason: result.reason }
              : undefined,
          );
        });
        native = bridge.onIntent((intent) => {
          void registry?.receive(intent);
        });
        // Chromium omits macOS wheel zoom; its pinned DOM exposes native ticks and momentum.
        if (context.platform === "darwin") {
          let remainder = 0;
          resetWheel = () => {
            remainder = 0;
          };
          const releaseWheel = (event: KeyboardEvent) => {
            if (!event.metaKey) resetWheel();
          };
          const commandWheel = (event: WheelEvent) => {
            // Electron's synthetic end phase can retain ticks with zero displacement.
            if (event.deltaY === 0) return;
            const input = event as WheelEvent & {
              readonly wheelDeltaY?: number;
              readonly momentum?: boolean;
            };
            if (
              event.defaultPrevented ||
              !event.metaKey ||
              event.ctrlKey ||
              event.altKey ||
              event.shiftKey ||
              current.current.composing ||
              input.momentum !== false ||
              typeof input.wheelDeltaY !== "number" ||
              !Number.isFinite(input.wheelDeltaY)
            ) {
              resetWheel();
              return;
            }
            // Blink divides the legacy 120-unit tick by density and truncates it.
            const measured = (input.wheelDeltaY * window.devicePixelRatio) / 120;
            const nearest = Math.sign(measured) * Math.floor(Math.abs(measured) + 0.5);
            // Recover whole native ticks within the one-DOM-unit truncation interval.
            const ticks =
              nearest !== 0 && Math.abs(measured - nearest) < window.devicePixelRatio / 120
                ? nearest
                : Math.round(input.wheelDeltaY * window.devicePixelRatio) / 120;
            remainder += ticks;
            // Match Chromium's nearest-whole-tick rounding in both directions.
            const whole = Math.sign(remainder) * Math.floor(Math.abs(remainder) + 0.5);
            remainder -= whole;
            event.preventDefault();
            // Consume this event's notches even if admission is busy; never replay them.
            if (whole !== 0) void registry?.invoke(whole > 0 ? "zoom.increase" : "zoom.decrease");
          };
          document.addEventListener("wheel", commandWheel, { passive: false });
          window.addEventListener("keyup", releaseWheel);
          wheel = () => {
            document.removeEventListener("wheel", commandWheel);
            window.removeEventListener("keyup", releaseWheel);
          };
        }
        setController(registry);
        publish();
      })
      .catch(() => {
        if (live) setFailure(true);
      });
    let altTarget: EventTarget | null = null;
    const cancelMenuKey = () => {
      altTarget = null;
    };
    const menuPointerDown = (event: PointerEvent) => {
      cancelMenuKey();
      // The native popup owns focus while open; pointer activation must retain its Edit target.
      if (
        event.button === 0 &&
        event.target instanceof Element &&
        event.target.closest(menuButtonSelector)
      )
        event.preventDefault();
    };
    const cancelChord = (event: KeyboardEvent) => {
      if (
        event.code !== "AltLeft" ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        cancelMenuKey();
    };
    const menuKey = (event: KeyboardEvent) => {
      const priorAlt = altTarget;
      cancelMenuKey();
      if (
        !registry ||
        registry.context.platform === "darwin" ||
        event.defaultPrevented ||
        event.isComposing ||
        current.current.composing ||
        event.getModifierState("AltGraph") ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.repeat
      )
        return;
      if (event.type === "keydown" && event.key === "Alt" && event.code === "AltLeft") {
        altTarget = event.target;
        return;
      }
      const f10 = event.type === "keydown" && event.key === "F10" && !event.altKey;
      const loneAlt =
        event.type === "keyup" &&
        event.key === "Alt" &&
        event.code === "AltLeft" &&
        priorAlt === event.target &&
        priorAlt !== null;
      if (f10 || loneAlt) {
        event.preventDefault();
        void registry.invoke("menu.open");
      }
    };
    // Bubble after focused controls so preventDefault and stopPropagation retain their meaning.
    window.addEventListener("keydown", menuKey);
    window.addEventListener("keyup", menuKey);
    document.addEventListener("keydown", cancelChord, true);
    document.addEventListener("pointerdown", menuPointerDown, true);
    document.addEventListener("compositionstart", cancelMenuKey, true);
    window.addEventListener("blur", cancelMenuKey);
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
      window.removeEventListener("keydown", menuKey);
      window.removeEventListener("keyup", menuKey);
      document.removeEventListener("keydown", cancelChord, true);
      document.removeEventListener("pointerdown", menuPointerDown, true);
      document.removeEventListener("compositionstart", cancelMenuKey, true);
      window.removeEventListener("blur", cancelMenuKey);
      modals.disconnect();
      window.removeEventListener("blur", blur);
      live = false;
      current.current.live = false;
      current.current.incarnation++;
      native();
      wheel();
      extensions();
      unsubscribe();
      unsubscribeResults();
      registry?.dispose();
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", focusOut);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("compositionstart", composition);
      document.removeEventListener("compositionend", composition);
    };
  }, [bridge, registerHandlers, settingsAvailable]);
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
    setUnavailable(undefined);
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
  const openSettings = () => {
    if (surface) handoff("settings.open");
    else invoke("settings.open");
  };
  const windowFeedback = renderFeedback?.(openSettings, false);
  const dialogFeedback =
    surface === "help" || surface === "about" || surface === "palette" || surface === "shortcuts"
      ? renderFeedback?.(openSettings, true)
      : undefined;
  const copyReason = controller?.entry("version.copy").reason;
  const commandFeedback = unavailable ? (
    <p role="status" className="command-unavailable">
      {message(locale, `command.reason.${unavailable.reason}`)}
    </p>
  ) : null;
  const discoveryFeedback = (
    <>
      {commandFeedback}
      {dialogFeedback}
      {failure && (
        <p role="alert" className="command-danger">
          {message(locale, "command.failed")}
        </p>
      )}
      <CopyFeedback copy={copy} locale={locale} inDialog />
    </>
  );
  return (
    <>
      {children ? (
        children(controller)
      ) : (
        <div ref={actionBar} className="actions command-entry-actions">
          {controller && controller.context.platform !== "darwin" && (
            <CommandButton
              id="menu.open"
              locale={locale}
              controller={controller}
              onInvoke={invoke}
            />
          )}
          {settingsAvailable && (
            <CommandButton
              id="settings.open"
              locale={locale}
              {...(controller ? { controller } : {})}
              onInvoke={invoke}
            />
          )}
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
          {(["palette.open", "shortcuts.open"] as const).map((id) => (
            <CommandButton
              key={id}
              id={id}
              locale={locale}
              {...(controller ? { controller } : {})}
              onInvoke={invoke}
            />
          ))}
        </div>
      )}
      {failure && !surface && (
        <p role="alert" className="command-danger">
          {message(locale, "command.failed")}
        </p>
      )}
      {!surface && commandFeedback}
      {renderFeedback && (
        <div className="command-window-feedback" hidden={!!surface}>
          {windowFeedback}
        </div>
      )}
      {!surface && <CopyFeedback copy={copy} locale={locale} />}
      {controller &&
        settingsRenderer.current?.(
          surface === "settings",
          close,
          controller.context.platform,
          <>
            {commandFeedback}
            {failure && (
              <p role="alert" className="command-danger">
                {message(locale, "command.failed")}
              </p>
            )}
          </>,
          modalReturnFocus,
        )}
      {controller && (
        <>
          <CommandPalette
            key={controller.context.windowGeneration}
            feedback={discoveryFeedback}
            open={surface === "palette"}
            locale={locale}
            controller={controller}
            snapshot={paletteSnapshot ?? controller.snapshot()}
            onClose={close}
            onInvoke={(id) => {
              if (current.current.surface === "palette") handoff(id);
            }}
            returnFocusRef={modalReturnFocus}
          />
          <KeyboardShortcutsDialog
            feedback={discoveryFeedback}
            open={surface === "shortcuts"}
            locale={locale}
            platform={controller.context.platform}
            onClose={close}
            returnFocusRef={modalReturnFocus}
          />
        </>
      )}
      <HelpDialog
        returnFocusRef={modalReturnFocus}
        feedback={
          <>
            {commandFeedback}
            {surface === "help" && dialogFeedback}
          </>
        }
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
        returnFocusRef={modalReturnFocus}
        feedback={
          <>
            {commandFeedback}
            {surface === "about" && dialogFeedback}
          </>
        }
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
