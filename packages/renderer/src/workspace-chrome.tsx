import {
  Fragment,
  useEffect,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type RefCallback,
} from "react";
import {
  commandDefinitions,
  formatNumber,
  message,
  workspacePanels,
  type CommandId,
  type InterfaceLocale,
  type SimpleMessageKey,
  type WorkspacePanel,
} from "@ohtia/contracts";
import { CommandController, presentationReason } from "./command-controller.js";
import { ProductCharacter, type DecorationState } from "./command-surfaces.js";
import { LayoutPreferences } from "./layout-preferences.js";
import {
  WorkspaceController,
  type LayoutFocusIntent,
  type WorkspaceState,
} from "./workspace-controller.js";
import { separatorRange } from "./workspace-geometry.js";
import { OhtiaBrand } from "./branding.js";
import { LucideGlyph, type LucideName } from "./iconography.js";
import { Tooltip } from "./layers.js";

const panelIcons = {
  explorer: "panel-left",
  documents: "app-window",
  chat: "panel-right",
} as const;
const panelKeys = {
  explorer: "command.panels.explorer",
  documents: "command.panels.documents",
  chat: "command.panels.chat",
} as const;
const actionKeys = {
  explorer: ["workspace.explorer.open", "workspace.explorer.hide"],
  documents: ["workspace.documents.open", "workspace.documents.hide"],
  chat: ["workspace.chat.open", "workspace.chat.hide"],
} as const;

/** CSS-pixel measurements supplied by the qualified window owner, never guessed here. */
export interface WorkspaceWindowInsets {
  readonly start: number;
  readonly end: number;
}
export interface WorkspaceChromeProps {
  readonly fallbackFocusRef?: RefObject<HTMLAnchorElement | null>;
  readonly preferences: LayoutPreferences;
  readonly commands: CommandController;
  readonly locale: InterfaceLocale;
  readonly windowInsets: WorkspaceWindowInsets;
  readonly decoration?: DecorationState;
  /** Only a confirmed effective value; absent before the zoom producer is connected. */
  readonly zoom?: number;
  readonly layoutFailure?: boolean;
  readonly onDismissLayoutFailure?: () => void;
}
function focusedPanel(root: HTMLElement | null): WorkspacePanel | undefined {
  const active = root?.ownerDocument.activeElement;
  const value =
    active instanceof Element && root?.contains(active)
      ? active.closest<HTMLElement>("[data-workspace-panel]")?.dataset.workspacePanel
      : undefined;
  return workspacePanels.find((panel) => panel === value);
}
function ShortcutControl({
  id,
  commands,
  locale,
  label,
  icon,
  controls,
  expanded,
  pressed,
  text = false,
  primary = false,
  controlRef,
  onUnavailable,
  displayText,
  hint = false,
}: {
  id: CommandId;
  commands: CommandController;
  locale: InterfaceLocale;
  label?: string;
  icon?: LucideName;
  controls?: string;
  expanded?: boolean;
  pressed?: boolean;
  text?: boolean;
  primary?: boolean;
  displayText?: string;
  hint?: boolean;
  controlRef?: RefCallback<HTMLButtonElement>;
  onUnavailable?: () => void;
}) {
  const definition = commandDefinitions.find((entry) => entry.id === id);
  if (!definition) throw new Error("Unknown workspace command.");
  const name = label ?? message(locale, definition.label);
  const shortcuts = definition.shortcuts[commands.context.platform];
  const reason = commands.entry(id).reason;
  const reasonId = useId();
  const explanation = reason ? message(locale, `command.reason.${reason}`) : undefined;
  return (
    <Tooltip label={[name, shortcuts.join(" / "), explanation].filter(Boolean).join(" · ")}>
      <button
        type="button"
        ref={controlRef}
        className={`workspace-control${text ? " workspace-text-control" : ""}${primary ? " workspace-primary" : ""}${id === "zoom.reset" ? " workspace-zoom" : ""}`}
        data-workspace-command={id}
        aria-label={name}
        aria-controls={controls}
        aria-expanded={expanded}
        aria-pressed={pressed}
        aria-haspopup={id === "menu.open" ? "menu" : undefined}
        aria-keyshortcuts={
          shortcuts
            .filter(
              (key) =>
                !["Alt", "Ctrl", "Control", "Shift", "Cmd", "Meta", "AltGraph"].includes(key),
            )
            .map((key) =>
              key.replace("Ctrl+", "Control+").replace("Cmd+", "Meta+").replace(/\+\+$/, "+Plus"),
            )
            .join(" ") || undefined
        }
        aria-disabled={!!reason}
        aria-describedby={explanation ? reasonId : undefined}
        onClick={() => {
          if (reason) onUnavailable?.();
          else void commands.invoke(id);
        }}
      >
        {icon && <LucideGlyph name={icon} size={text ? 16 : 20} />}
        {text && <span>{displayText ?? name}</span>}
        {hint && shortcuts.length > 0 && (id === "settings.open" || id === "help.open") && (
          <kbd>{shortcuts[0]}</kbd>
        )}
        {explanation && (
          <span className="primitive-announcement" id={reasonId}>
            {explanation}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

/** Real chrome; storage, command ownership and confirmed presentation inputs stay with composition. */
export function WorkspaceChrome({
  preferences,
  commands,
  fallbackFocusRef,
  locale,
  windowInsets,
  decoration = "static",
  zoom,
  layoutFailure = false,
  onDismissLayoutFailure,
}: WorkspaceChromeProps) {
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<WorkspaceController | undefined>(undefined);
  const [state, setState] = useState<WorkspaceState>();
  const [, refreshCommands] = useState(0);
  const [lastPanel, setLastPanel] = useState(false);
  const pendingFocus = useRef<
    LayoutFocusIntent | { target: "settings-control" } | { target: "zoom-control" } | undefined
  >(undefined);
  const controls = useRef<Partial<Record<WorkspacePanel | "focus", HTMLButtonElement | undefined>>>(
    {},
  );
  const headings = useRef<Partial<Record<WorkspacePanel, HTMLHeadingElement | undefined>>>({});
  const zoomControlRef = useCallback<RefCallback<HTMLButtonElement>>((element) => {
    if (!element) return;
    return () => {
      if (controller.current && element.ownerDocument.activeElement === element)
        pendingFocus.current = { target: "zoom-control" };
    };
  }, []);
  const id = useId();
  const panelId = (panel: WorkspacePanel) => `${id}-${panel}`;
  const text = (key: SimpleMessageKey) => message(locale, key);
  useEffect(
    () =>
      commands.subscribe(() => {
        refreshCommands((value) => value + 1);
      }),
    [commands],
  );
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let live = true;
    let suppressFocus = false;
    const focus = (intent: LayoutFocusIntent) => {
      if (!live || suppressFocus) return;
      pendingFocus.current = intent;
      if (intent.target === "panel-control")
        controls.current[intent.panel]?.focus({ preventScroll: true });
      if (intent.target === "focus-control") controls.current.focus?.focus({ preventScroll: true });
    };
    const coarse = window.matchMedia("(pointer: coarse)");
    const layout = new WorkspaceController(
      preferences,
      element.getBoundingClientRect().width,
      coarse.matches,
      (next) => {
        if (!live) return;
        const active = focusedPanel(element);
        if (active && !next.geometry.visible[active] && !pendingFocus.current)
          focus({ target: "panel-control", panel: active });
        const target = element.ownerDocument.activeElement;
        if (target instanceof HTMLElement && !pendingFocus.current) {
          const sizePanel = workspacePanels.find((panel) => panel === target.dataset.workspaceSize);
          const left = workspacePanels.find((panel) => panel === target.dataset.separatorLeft);
          const right = workspacePanels.find((panel) => panel === target.dataset.separatorRight);
          if (target.closest(".workspace-rail") && next.geometry.rail === 0) {
            if (target.dataset.workspaceCommand === "settings.open")
              pendingFocus.current = { target: "settings-control" };
            else if (target.dataset.workspaceCommand === "panels.explorer")
              focus({ target: "panel-control", panel: "explorer" });
          } else if (
            sizePanel &&
            (next.geometry.mode === "narrow" || next.geometry.pairs.length === 0)
          )
            focus({ target: "panel-control", panel: sizePanel });
          else if (
            left &&
            right &&
            !next.geometry.pairs.some(([l, r]) => l === left && r === right)
          )
            focus({ target: "panel-control", panel: left });
        }
        if (
          next.geometry.mode === "narrow" ||
          workspacePanels.filter((panel) => next.geometry.visible[panel]).length > 1
        )
          setLastPanel(false);
        setState(next);
        commands.changed();
      },
      focus,
    );
    controller.current = layout;
    setState(layout.state);
    const reason = () =>
      presentationReason("panels.explorer", {
        composing: composing,
        modal: !!document.querySelector("dialog[open]"),
        editable: false,
      });
    let composing = false;
    let composingTarget: Node | undefined;
    const composition = (event: Event) => {
      composing = event.type === "compositionstart";
      composingTarget = composing && event.target instanceof Node ? event.target : undefined;
      commands.changed();
    };
    const focusout = (event: Event) => {
      if (event.target === composingTarget) {
        composing = false;
        composingTarget = undefined;
        commands.changed();
      }
    };
    const compositionObserver = new MutationObserver(() => {
      if (composingTarget && !composingTarget.isConnected) {
        composing = false;
        composingTarget = undefined;
        commands.changed();
      }
    });
    compositionObserver.observe(document.body, { childList: true, subtree: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && layout.state.dragging) {
        event.preventDefault();
        layout.cancelResize("escape");
      }
    };
    const blur = () => {
      composing = false;
      composingTarget = undefined;
      layout.cancelResize("focus-loss");
      commands.changed();
    };
    const registrations = workspacePanels.map((panel) =>
      commands.register(`panels.${panel}`, {
        state: () => {
          const state = layout.state;
          const unavailable =
            reason() ??
            (state.geometry.mode === "wide" && (state.initializing || preferences.busy)
              ? "busy"
              : undefined) ??
            (state.geometry.mode === "wide" &&
            state.geometry.visible[panel] &&
            workspacePanels.filter((p) => state.geometry.visible[p]).length === 1
              ? "last_panel"
              : undefined);
          return {
            checked: state.geometry.visible[panel],
            ...(unavailable ? { reason: unavailable } : {}),
          };
        },
        run: () => {
          setLastPanel(false);
          return (
            layout.state.geometry.mode === "narrow"
              ? layout.select(panel)
              : layout.visibility(panel, focusedPanel(element))
          ).applied;
        },
      }),
    );
    registrations.push(
      commands.register("document.focus", {
        state: () => {
          const unavailable =
            reason() ?? (layout.state.geometry.mode === "narrow" ? "wide_layout" : undefined);
          return {
            checked: layout.state.focusMode,
            ...(unavailable ? { reason: unavailable } : {}),
          };
        },
        run: () => layout.focusMode().applied,
      }),
    );
    registrations.push(
      commands.register("layout.reset", {
        state: () => {
          const unavailable =
            reason() ?? (layout.state.initializing || preferences.busy ? "busy" : undefined);
          return unavailable ? { reason: unavailable } : {};
        },
        run: () => {
          setLastPanel(false);
          return layout.reset(focusedPanel(element)).applied;
        },
      }),
    );
    const viewport = () => {
      suppressFocus =
        !element.contains(document.activeElement) || !!document.querySelector("dialog[open]");
      const before = layout.state.geometry.mode;
      const active = document.activeElement;
      const command = active instanceof HTMLElement ? active.dataset.workspaceCommand : undefined;
      layout.viewport(element.getBoundingClientRect().width, coarse.matches, focusedPanel(element));
      if (!suppressFocus && before !== layout.state.geometry.mode) {
        const panel = workspacePanels.find((panel) => command === `panels.${panel}`);
        if (panel) focus({ target: "panel-control", panel });
        else if (command === "document.focus") {
          const visible = workspacePanels.find((panel) => layout.state.geometry.visible[panel]);
          if (visible) focus({ target: "panel-control", panel: visible });
        } else if (command === "zoom.reset") pendingFocus.current = { target: "zoom-control" };
        else if (
          command === "settings.open" &&
          active instanceof HTMLElement &&
          !pendingFocus.current &&
          (active.closest(".workspace-narrow-row, .workspace-rail") ||
            (active.closest(".workspace-explorer-footer") &&
              !layout.state.geometry.visible.explorer))
        )
          pendingFocus.current = { target: "settings-control" };
      }
      suppressFocus = false;
    };
    const observer = new ResizeObserver(viewport);
    observer.observe(element);
    coarse.addEventListener("change", viewport);
    document.addEventListener("compositionstart", composition);
    document.addEventListener("compositionend", composition);
    document.addEventListener("focusout", focusout);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", escape, true);
    void layout.initialize();
    return () => {
      live = false;
      observer.disconnect();
      coarse.removeEventListener("change", viewport);
      document.removeEventListener("compositionstart", composition);
      document.removeEventListener("compositionend", composition);
      document.removeEventListener("focusout", focusout);
      compositionObserver.disconnect();
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape, true);
      registrations.forEach((stop) => {
        stop();
      });
      layout.dispose();
      controller.current = undefined;
      pendingFocus.current = undefined;
    };
  }, [preferences, commands]);
  useLayoutEffect(() => {
    const intent = pendingFocus.current;
    pendingFocus.current = undefined;
    if (!intent) return;
    if (intent.target === "zoom-control") {
      const zoomButton = root.current?.querySelector<HTMLButtonElement>(
        '[data-workspace-command="zoom.reset"]',
      );
      if (zoomButton) zoomButton.focus({ preventScroll: true });
      else {
        const visible = workspacePanels.find((panel) => state?.geometry.visible[panel]);
        if (visible) controls.current[visible]?.focus({ preventScroll: true });
      }
      return;
    }
    if (intent.target === "settings-control") {
      const owner =
        state?.geometry.mode === "narrow"
          ? ".workspace-narrow-row"
          : state?.geometry.rail
            ? ".workspace-rail"
            : ".workspace-explorer-footer";
      root.current
        ?.querySelector<HTMLElement>(`${owner} [data-workspace-command="settings.open"]`)
        ?.focus({ preventScroll: true });
      return;
    }
    const element =
      intent.target === "focus-control"
        ? controls.current.focus
        : intent.target === "panel-control"
          ? controls.current[intent.panel]
          : headings.current[intent.panel];
    element?.focus({ preventScroll: true });
  }, [state, zoom]);
  const geometry = state?.geometry;
  const narrow = geometry?.mode === "narrow";
  const layout = controller.current;
  const mainPanel = geometry?.visible.documents
    ? "documents"
    : (workspacePanels.find((panel) => geometry?.visible[panel]) ?? "documents");
  const zoomIndicator =
    zoom !== undefined && zoom !== 100 ? (
      <ShortcutControl
        id="zoom.reset"
        commands={commands}
        locale={locale}
        icon="zoom-in"
        text
        controlRef={zoomControlRef}
        displayText={formatNumber(locale, zoom / 100, {
          style: "percent",
          maximumFractionDigits: 0,
        })}
        label={message(locale, "workspace.zoom", {
          percent: formatNumber(locale, zoom / 100, { style: "percent", maximumFractionDigits: 0 }),
        })}
      />
    ) : undefined;
  const panelControl = (panel: WorkspacePanel, compact: boolean, registerRef = true) => (
    <ShortcutControl
      id={`panels.${panel}`}
      commands={commands}
      locale={locale}
      icon={panelIcons[panel]}
      label={
        narrow
          ? text(panel === "explorer" ? "workspace.contents" : panelKeys[panel])
          : text(actionKeys[panel][geometry?.visible[panel] ? 1 : 0])
      }
      controls={panelId(panel)}
      expanded={!!geometry?.visible[panel]}
      pressed={!!geometry?.visible[panel]}
      text={!compact}
      {...(registerRef
        ? {
            controlRef: (element: HTMLButtonElement | null) => {
              if (element) controls.current[panel] = element;
              else controls.current[panel] = undefined;
            },
          }
        : {})}
      onUnavailable={() => {
        if (commands.entry(`panels.${panel}`).reason === "last_panel") setLastPanel(true);
      }}
    />
  );
  const settings = (compact: boolean) => (
    <ShortcutControl
      id="settings.open"
      commands={commands}
      locale={locale}
      icon="settings"
      text={!compact}
      hint={!compact}
    />
  );
  return (
    <div
      ref={root}
      className="workspace"
      data-mode={narrow ? "narrow" : "wide"}
      data-dragging={!!state?.dragging}
      lang={locale}
      onKeyDown={(event) => {
        if (event.key === "Escape" && state?.dragging) {
          event.preventDefault();
          layout?.cancelResize("escape");
        }
      }}
    >
      <a
        ref={fallbackFocusRef}
        className="workspace-skip"
        href={`#${panelId(mainPanel)}`}
        onClick={(event) => {
          event.preventDefault();
          headings.current[mainPanel]?.focus({ preventScroll: true });
        }}
      >
        {text("workspace.skip")}
      </a>
      <header className="workspace-bar" aria-label={text("workspace.context")}>
        <div
          className="workspace-title-row"
          style={{
            marginInlineStart: `max(env(titlebar-area-x, 0px), ${String(windowInsets.start)}px)`,
            inlineSize: `min(env(titlebar-area-width, 100%), calc(100% - ${String(windowInsets.start + windowInsets.end)}px))`,
            minBlockSize:
              "max(var(--component-workspace-context-bar-minimum), env(titlebar-area-height, 0px))",
          }}
        >
          {commands.context.platform !== "darwin" && (
            <ShortcutControl id="menu.open" commands={commands} locale={locale} icon="menu" />
          )}
          <OhtiaBrand />
          <Tooltip className="workspace-context-tooltip" label={text("workspace.noProject")}>
            <span className="workspace-project-context">{text("workspace.noProject")}</span>
          </Tooltip>
          <span className="workspace-drag-space" aria-hidden="true" />
          {!narrow && zoomIndicator}
          {!narrow && (
            <div
              className="workspace-panel-controls"
              role="group"
              aria-label={text("workspace.panels")}
            >
              {workspacePanels.map((panel) => (
                <Fragment key={panel}>{panelControl(panel, true)}</Fragment>
              ))}
            </div>
          )}
          {!narrow && (
            <ShortcutControl
              id="document.focus"
              commands={commands}
              locale={locale}
              icon={state?.focusMode ? "minimize-2" : "maximize-2"}
              label={text(state?.focusMode ? "workspace.restore" : "command.document.focus")}
              text={!!state?.focusMode}
              controlRef={(element) => {
                if (element) controls.current.focus = element;
                else delete controls.current.focus;
              }}
            />
          )}
        </div>
        {narrow && (
          <div className="workspace-narrow-row">
            {zoomIndicator}
            <div className="workspace-selector" role="group" aria-label={text("workspace.panels")}>
              {workspacePanels.map((panel) => (
                <Fragment key={panel}>{panelControl(panel, false)}</Fragment>
              ))}
            </div>
            {settings(true)}
          </div>
        )}
      </header>
      {layoutFailure && (
        <div className="workspace-notice workspace-danger" role="alert">
          <LucideGlyph name="octagon-alert" size={16} />
          <span>{text("workspace.notRemembered")}</span>
          <button type="button" onClick={onDismissLayoutFailure}>
            {text("workspace.dismiss")}
          </button>
        </div>
      )}
      {lastPanel && (
        <div className="workspace-notice workspace-attention" role="status">
          <LucideGlyph name="triangle-alert" size={16} />
          <span>{text("command.reason.last_panel")}</span>
        </div>
      )}
      {state?.persistence.save.state === "uncertain" && (
        <div className="workspace-notice workspace-attention" role="status">
          <LucideGlyph name="triangle-alert" size={16} />
          <span>{text("workspace.uncertain")}</span>
          <button
            type="button"
            onClick={() => {
              void preferences.reconcile();
            }}
          >
            {text("workspace.check")}
          </button>
        </div>
      )}
      <main className="workspace-regions" aria-label={text("workspace.regions")}>
        {!geometry?.visible.documents && (
          <h1 className="primitive-announcement">{text("workspace.regions")}</h1>
        )}
        {!narrow && geometry?.rail !== 0 && (
          <aside
            className="workspace-rail"
            aria-label={text("command.panels.explorer")}
            style={{ inlineSize: geometry?.rail }}
          >
            {panelControl("explorer", true, false)}
            <div className="workspace-rail-bottom">{settings(true)}</div>
          </aside>
        )}
        {workspacePanels.map((panel) => {
          const pair = geometry?.pairs.find(([left]) => left === panel);
          return (
            <Fragment key={panel}>
              <section
                className={`workspace-panel workspace-${panel}`}
                id={panelId(panel)}
                data-workspace-panel={panel}
                hidden={!geometry?.visible[panel]}
                inert={!geometry?.visible[panel]}
                aria-labelledby={`${panelId(panel)}-heading`}
                style={{ inlineSize: geometry?.widths[panel] }}
              >
                <h2
                  id={`${panelId(panel)}-heading`}
                  ref={(element) => {
                    if (element) headings.current[panel] = element;
                    else headings.current[panel] = undefined;
                  }}
                  tabIndex={-1}
                  className={
                    panel === "documents" ? "primitive-announcement" : "workspace-panel-heading"
                  }
                >
                  {text(panelKeys[panel])}
                </h2>
                {panel === "documents" && (
                  <div
                    className="workspace-tabs"
                    role="tablist"
                    aria-label={text("command.panels.documents")}
                  >
                    <button
                      type="button"
                      id={`${id}-navigator-tab`}
                      role="tab"
                      aria-selected="true"
                      aria-controls={`${id}-navigator`}
                    >
                      <LucideGlyph name="signpost" size={16} />
                      {text("workspace.navigator")}
                    </button>
                  </div>
                )}
                <div
                  className="workspace-panel-scroll"
                  role={panel === "documents" ? "tabpanel" : "region"}
                  id={panel === "documents" ? `${id}-navigator` : undefined}
                  aria-labelledby={
                    panel === "documents" ? `${id}-navigator-tab` : `${panelId(panel)}-heading`
                  }
                  tabIndex={0}
                >
                  {panel === "documents" ? (
                    <div className="workspace-welcome">
                      {decoration !== "hidden" && <ProductCharacter />}
                      <h1 data-type="type.ui.display">{text("workspace.welcome")}</h1>
                      <p>{text("workspace.welcomeText")}</p>
                      <div className="workspace-welcome-actions">
                        <ShortcutControl
                          id="settings.open"
                          commands={commands}
                          locale={locale}
                          icon="settings"
                          text
                          primary
                          label={text("workspace.openSettings")}
                        />
                        <ShortcutControl
                          id="shortcuts.open"
                          commands={commands}
                          locale={locale}
                          icon="keyboard"
                          text
                        />
                        <ShortcutControl id="about.open" commands={commands} locale={locale} text />
                      </div>
                    </div>
                  ) : (
                    <p className="workspace-empty">
                      <LucideGlyph name={panelIcons[panel]} size={20} />
                      {text(
                        panel === "explorer" ? "workspace.explorerEmpty" : "workspace.chatEmpty",
                      )}
                    </p>
                  )}
                </div>
                {panel === "explorer" && (
                  <footer className="workspace-explorer-footer">
                    {settings(false)}
                    <ShortcutControl
                      id="help.open"
                      commands={commands}
                      locale={locale}
                      icon="circle-question-mark"
                      text
                      hint
                    />
                  </footer>
                )}
                {!narrow && geometry && geometry.pairs.length > 0 && (
                  <div
                    className="workspace-sizing"
                    role="group"
                    aria-label={text(panelKeys[panel])}
                  >
                    {[false, true].map((increase) => (
                      <Tooltip
                        key={String(increase)}
                        label={[
                          message(locale, increase ? "workspace.increase" : "workspace.reduce", {
                            panel: text(panelKeys[panel]),
                          }),
                          state.initializing || preferences.busy
                            ? text("command.reason.busy")
                            : undefined,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      >
                        <button
                          type="button"
                          data-workspace-size={panel}
                          aria-label={message(
                            locale,
                            increase ? "workspace.increase" : "workspace.reduce",
                            { panel: text(panelKeys[panel]) },
                          )}
                          aria-disabled={state.initializing || preferences.busy}
                          aria-describedby={
                            state.initializing || preferences.busy
                              ? `${id}-size-${panel}-${String(increase)}`
                              : undefined
                          }
                          onClick={() => {
                            layout?.size(panel, increase);
                          }}
                        >
                          {increase ? "+" : "−"}
                          {(state.initializing || preferences.busy) && (
                            <span
                              className="primitive-announcement"
                              id={`${id}-size-${panel}-${String(increase)}`}
                            >
                              {text("command.reason.busy")}
                            </span>
                          )}
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </section>
              {pair && layout && state && (
                <WorkspaceSplitter
                  left={pair[0]}
                  right={pair[1]}
                  state={state}
                  controller={layout}
                  locale={locale}
                  leftId={panelId(pair[0])}
                  rightId={panelId(pair[1])}
                />
              )}
            </Fragment>
          );
        })}
      </main>
    </div>
  );
}

function WorkspaceSplitter({
  left,
  right,
  state,
  controller,
  locale,
  leftId,
  rightId,
}: {
  left: WorkspacePanel;
  right: WorkspacePanel;
  state: WorkspaceState;
  controller: WorkspaceController;
  locale: InterfaceLocale;
  leftId: string;
  rightId: string;
}) {
  const range = separatorRange(state.geometry, left, right);
  if (!range) throw new Error("Workspace separator has no adjacent pair.");
  const number = (value: number) => formatNumber(locale, value, { maximumFractionDigits: 0 });
  const widths = message(locale, "workspace.widths", {
    left: message(locale, panelKeys[left]),
    right: message(locale, panelKeys[right]),
    leftWidth: number(range.current),
    rightWidth: number(state.geometry.widths[right]),
  });
  const minimum =
    range.current === range.minimum ? left : range.current === range.maximum ? right : undefined;
  const hint = minimum
    ? message(locale, "workspace.minimum", {
        panel: message(locale, panelKeys[minimum]),
        width: number(state.geometry.widths[minimum]),
      })
    : widths;
  const busy =
    state.initializing ||
    state.persistence.save.state === "submitting" ||
    state.persistence.save.state === "uncertain";
  const reasonId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | undefined>(undefined);
  const lock = useRef<{ cursor: string; selection: string } | undefined>(undefined);
  return (
    <div className="workspace-splitter-slot">
      <Tooltip label={busy ? `${hint} · ${message(locale, "command.reason.busy")}` : hint}>
        <div
          ref={ref}
          className="workspace-splitter"
          data-separator-left={left}
          data-separator-right={right}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={message(locale, "workspace.separator", {
            left: message(locale, panelKeys[left]),
            right: message(locale, panelKeys[right]),
          })}
          aria-controls={`${leftId} ${rightId}`}
          aria-valuemin={range.minimum}
          aria-valuemax={range.maximum}
          aria-valuenow={range.current}
          aria-valuetext={widths}
          aria-disabled={busy}
          aria-describedby={busy ? reasonId : undefined}
          data-minimum={minimum ? (minimum === left ? "left" : "right") : undefined}
          onDoubleClick={() => {
            controller.pairReset(left, right);
          }}
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              event.nativeEvent.isComposing ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey
            )
              return;
            const key = event.key;
            if (key === "Escape" && state.dragging) {
              event.preventDefault();
              event.stopPropagation();
              controller.cancelResize("escape");
              return;
            }
            if (
              key === "ArrowLeft" ||
              key === "ArrowRight" ||
              key === "Home" ||
              key === "End" ||
              key === "Enter"
            ) {
              event.preventDefault();
              controller.key(left, right, key, event.shiftKey);
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            const target = event.currentTarget;
            const accepted = controller.beginResize(left, right, event.pointerId, event.clientX, {
              capture: (pointer) => {
                target.setPointerCapture(pointer);
              },
              release: (pointer) => {
                if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
              },
              lock: () => {
                lock.current = {
                  cursor: document.body.style.cursor,
                  selection: document.body.style.userSelect,
                };
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              },
              unlock: () => {
                if (lock.current) {
                  document.body.style.cursor = lock.current.cursor;
                  document.body.style.userSelect = lock.current.selection;
                  lock.current = undefined;
                  activePointer.current = undefined;
                }
              },
            });
            if (accepted) {
              activePointer.current = event.pointerId;
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
          onPointerMove={(event) => {
            controller.moveResize(event.pointerId, event.clientX);
          }}
          onPointerUp={(event) => {
            controller.endResize(event.pointerId);
          }}
          onPointerCancel={(event) => {
            if (event.pointerId === activePointer.current) controller.cancelResize("pointercancel");
          }}
          onLostPointerCapture={(event) => {
            if (event.pointerId === activePointer.current) controller.cancelResize("pointercancel");
          }}
          onBlur={() => {
            controller.cancelResize("focus-loss");
          }}
        >
          {busy && (
            <span className="primitive-announcement" id={reasonId}>
              {message(locale, "command.reason.busy")}
            </span>
          )}
          <span className="workspace-splitter-line" aria-hidden="true" />
          <span className="workspace-grip" aria-hidden="true">
            <LucideGlyph name="grip-vertical" size={16} />
          </span>
        </div>
      </Tooltip>
    </div>
  );
}
