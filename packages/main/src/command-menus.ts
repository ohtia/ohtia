import { Menu, type BrowserWindow, type Input, type MenuItemConstructorOptions } from "electron";
import { randomUUID } from "node:crypto";
import {
  commandDefinitions,
  isCommandSnapshot,
  message,
  type SimpleMessageKey,
  type CommandContext,
  type CommandId,
  type CommandPlatform,
  type CommandSnapshot,
  type InterfaceLocale,
} from "@ohtia/contracts";

/** Only application keys; AltGr and composition remain with the focused native editor. */
export function commandForInput(
  platform: CommandPlatform,
  input: Pick<Input, "key" | "code" | "control" | "meta" | "alt" | "shift" | "isComposing">,
): CommandId | undefined {
  if (input.alt || (platform === "darwin" ? input.control && !input.meta : input.meta)) return;
  const primary = platform === "darwin" ? input.meta : input.control;
  // Hangul input mode can report a jamo for a Latin command key; composition still wins above.
  const key =
    /^\p{Script=Hangul}$/u.test(input.key) && /^Key[A-Z]$/.test(input.code)
      ? input.code.slice(3).toLowerCase()
      : input.key.toLowerCase();
  if (input.isComposing) {
    if (primary && !(platform === "darwin" && input.control)) {
      if (key === "q" && !input.shift) return "application.quit";
      if (key === "w" && input.shift === (platform !== "darwin")) return "window.close";
    }
    return;
  }
  if (!primary) {
    if (input.control || input.meta || input.shift) return;
    return key === "f1" && platform !== "darwin"
      ? "help.open"
      : key === "f11" && platform !== "darwin"
        ? "window.fullscreen"
        : key === "f10" && platform !== "darwin"
          ? "menu.open"
          : undefined;
  }
  if (platform === "darwin" && input.control)
    return key === "f" && !input.shift ? "window.fullscreen" : undefined;
  // Electron reports the shifted glyph (for example ! or §) for a numbered key.
  const panelKey = /^Digit([1-3])$/.exec(input.code)?.[1];
  if (input.shift && panelKey)
    return panelKey === "1"
      ? "panels.explorer"
      : panelKey === "2"
        ? "panels.documents"
        : "panels.chat";
  // Native Edit roles own their accelerators and IME-aware responder behavior.
  if (["+", "=", "add"].includes(key) || input.code === "NumpadAdd") return "zoom.increase";
  if ((key === "-" && !input.shift) || input.code === "NumpadSubtract") return "zoom.decrease";
  if (key === "/") return "shortcuts.open";
  if (key === "?" && input.code === "Slash" && input.shift && platform === "darwin")
    return "help.open";
  const chord = `${platform === "darwin" ? "Cmd" : "Ctrl"}+${input.shift ? "Shift+" : ""}${key.length === 1 && /[a-z]/.test(key) ? key.toUpperCase() : key}`;
  return commandDefinitions.find(
    (definition) =>
      !definition.id.startsWith("edit.") && definition.shortcuts[platform].includes(chord),
  )?.id;
}
interface WindowCommands {
  context: CommandContext;
  sequence: number;
  snapshot?: CommandSnapshot | undefined;
  dispose(): void;
}
/** Native presentation mirrors the focused window; it grants no broker capability. */
export class CommandMenus {
  private windows = new Map<BrowserWindow, WindowCommands>();
  private lastMenu: { window: BrowserWindow | null; projection: string } | undefined;
  constructor(
    private platform: CommandPlatform,
    private locale: () => InterfaceLocale,
    private documentUrl: string,
    private lifecycle: { quit(): void; close(window: BrowserWindow): void },
  ) {}
  attach(window: BrowserWindow): void {
    const contents = window.webContents;
    const state: WindowCommands = {
      context: { windowGeneration: randomUUID(), platform: this.platform },
      sequence: 0,
      dispose: () => {},
    };
    let altAlone = false;
    const input = (event: Electron.Event, key: Input) => {
      // macOS owns native accelerator registration; composing keys must reach the editor only.
      contents.setIgnoreMenuShortcuts(key.isComposing);
      if (key.type === "keyUp") {
        if (key.key === "Alt" && altAlone && !key.isComposing) this.dispatch(window, "menu.open");
        altAlone = false;
        return;
      }
      if (key.type !== "keyDown") return;
      const singleAlt =
        this.platform !== "darwin" &&
        key.key === "Alt" &&
        key.code !== "AltRight" &&
        !key.control &&
        !key.meta &&
        !key.shift &&
        !key.isComposing;
      altAlone = singleAlt;
      const command = commandForInput(this.platform, key);
      if (!command) return;
      event.preventDefault();
      if (!key.isAutoRepeat) this.dispatch(window, command, true);
    };
    const focus = () => {
      this.refresh();
    };
    const blur = () => {
      altAlone = false;
      this.refresh();
    };
    const navigation = (_event: unknown, url: string, inPlace: boolean, main: boolean) => {
      if (main && !inPlace && url === this.documentUrl) {
        altAlone = false;
        state.context = { windowGeneration: randomUUID(), platform: this.platform };
        state.snapshot = undefined;
        state.sequence = 0;
        this.refresh();
      }
    };
    const gone = () => {
      altAlone = false;
      state.snapshot = undefined;
      this.refresh();
    };
    state.dispose = () => {
      contents.removeListener("before-input-event", input);
      contents.removeListener("did-start-navigation", navigation);
      contents.removeListener("render-process-gone", gone);
      window.removeListener("focus", focus);
      window.removeListener("blur", blur);
    };
    this.windows.set(window, state);
    contents.on("before-input-event", input);
    contents.on("did-start-navigation", navigation);
    contents.on("render-process-gone", gone);
    window.on("focus", focus);
    window.on("blur", blur);
    window.once("closed", () => {
      state.dispose();
      this.windows.delete(window);
      this.refresh();
    });
    this.refresh();
  }
  context(window: BrowserWindow): CommandContext | undefined {
    return this.windows.get(window)?.context;
  }
  /** One composition owner claims a fresh registry lease; a remount revokes its predecessor. */
  connect(window: BrowserWindow): CommandContext | undefined {
    const state = this.windows.get(window);
    if (!state) return;
    state.context = { windowGeneration: randomUUID(), platform: this.platform };
    state.sequence = 0;
    state.snapshot = undefined;
    this.refresh();
    return state.context;
  }
  publish(window: BrowserWindow, value: unknown): boolean {
    const state = this.windows.get(window);
    if (
      !state ||
      !isCommandSnapshot(value) ||
      value.windowGeneration !== state.context.windowGeneration ||
      value.revision <= (state.snapshot?.revision ?? -1)
    )
      return false;
    state.snapshot = value;
    this.refresh();
    return true;
  }
  windowLocale(window: BrowserWindow): InterfaceLocale {
    return this.windows.get(window)?.snapshot?.locale ?? this.locale();
  }
  dispatch(window: BrowserWindow | null, id: CommandId, recheckInRenderer = false): void {
    if (id === "application.quit") {
      this.lifecycle.quit();
      return;
    }
    if (!window) return;
    if (id === "window.close" && this.windows.has(window) && !window.isDestroyed()) {
      this.lifecycle.close(window);
      return;
    }
    const state = this.windows.get(window);
    if (
      !state ||
      window.isDestroyed() ||
      window.webContents.isDestroyed() ||
      !state.snapshot ||
      (!recheckInRenderer &&
        !state.snapshot.entries.some((entry) => entry.id === id && !entry.reason))
    )
      return;
    window.webContents.send("ohtia:command-intent", {
      windowGeneration: state.context.windowGeneration,
      source: "native",
      sequence: ++state.sequence,
      command: id,
    });
  }
  template(window: BrowserWindow | null): MenuItemConstructorOptions[] {
    const state = window ? this.windows.get(window) : undefined;
    const locale = state?.snapshot?.locale ?? this.locale();
    const text = (key: SimpleMessageKey) => message(locale, key);
    const separator: MenuItemConstructorOptions = { type: "separator" };
    const theme = ["theme.system", "theme.light", "theme.dark"].map((id) =>
      state?.snapshot?.entries.find((entry) => entry.id === id),
    );
    const confirmedTheme =
      theme.every((entry) => typeof entry?.checked === "boolean") &&
      theme.filter((entry) => entry?.checked).length === 1;
    const item = (id: CommandId): MenuItemConstructorOptions => {
      const definition = commandDefinitions.find((entry) => entry.id === id);
      if (!definition) throw new Error("Unknown menu command.");
      const entry = state?.snapshot?.entries.find((entry) => entry.id === id);
      const role = {
        "edit.undo": "undo",
        "edit.redo": "redo",
        "edit.cut": "cut",
        "edit.copy": "copy",
        "edit.paste": "paste",
        "edit.selectAll": "selectAll",
      } as const;
      const nativeRole = id in role ? role[id as keyof typeof role] : undefined;
      const checked = id.startsWith("panels.") || (id.startsWith("theme.") && confirmedTheme);
      const shortcut = definition.shortcuts[this.platform][0];
      return {
        id,
        label: text(definition.label),
        enabled:
          id === "application.quit" ||
          (id === "window.close" && !!window && !window.isDestroyed()) ||
          (!!entry && !entry.reason),
        ...(shortcut
          ? {
              accelerator: shortcut.replace(/\+\+$/, "+Plus"),
              ...(this.platform === "darwin" ? {} : { registerAccelerator: !!nativeRole }),
            }
          : {}),
        ...(checked
          ? {
              type: id.startsWith("theme.") ? "radio" : "checkbox",
              checked: entry?.checked ?? false,
            }
          : {}),
        ...(this.platform === "darwin" && entry?.reason
          ? { toolTip: text(`command.reason.${entry.reason}`) }
          : {}),
        ...(nativeRole
          ? { role: nativeRole }
          : {
              click: () => {
                this.dispatch(this.focusedWindow(), id);
                // Native checkbox/radio activation is optimistic; restore the confirmed projection.
                this.refresh(true);
              },
            }),
      };
    };
    const group = (
      name: "application" | "file" | "edit" | "view" | "theme" | "help",
      submenu: MenuItemConstructorOptions[],
    ): MenuItemConstructorOptions => ({ label: text(`menu.${name}`), submenu });
    const mac = this.platform === "darwin";
    return [
      ...(mac
        ? [
            group("application", [
              item("about.open"),
              separator,
              item("settings.open"),
              separator,
              { role: "services", label: text("menu.services") },
              separator,
              { role: "hide", label: text("menu.hide") },
              { role: "hideOthers", label: text("menu.hideOthers") },
              { role: "unhide", label: text("menu.showAll") },
              separator,
              item("application.quit"),
            ]),
          ]
        : []),
      group("file", [
        item("window.new"),
        ...(!mac ? [item("settings.open"), separator] : []),
        item("window.close"),
        ...(!mac ? [item("application.quit")] : []),
      ]),
      group("edit", [
        item("edit.undo"),
        item("edit.redo"),
        separator,
        item("edit.cut"),
        item("edit.copy"),
        item("edit.paste"),
        separator,
        item("edit.selectAll"),
      ]),
      group("view", [
        item("palette.open"),
        separator,
        item("panels.explorer"),
        item("panels.documents"),
        item("panels.chat"),
        item("document.focus"),
        item("layout.reset"),
        separator,
        group("theme", [item("theme.system"), item("theme.light"), item("theme.dark")]),
        separator,
        item("zoom.increase"),
        item("zoom.decrease"),
        item("zoom.reset"),
        separator,
        item("window.fullscreen"),
      ]),
      group("help", [
        item("help.open"),
        item("shortcuts.open"),
        separator,
        item("link.documentation"),
        item("link.report"),
        separator,
        item("version.copy"),
        ...(!mac ? [item("about.open")] : []),
      ]),
    ];
  }
  private focusedWindow(): BrowserWindow | null {
    return (
      [...this.windows.keys()].find((window) => !window.isDestroyed() && window.isFocused()) ?? null
    );
  }
  refresh(force = false): void {
    // getFocusedWindow is consulted on every publication/focus change, never cached across windows.
    const window = this.focusedWindow();
    const template = this.template(window);
    const projection = JSON.stringify(template);
    if (!force && this.lastMenu?.window === window && this.lastMenu.projection === projection)
      return;
    this.lastMenu = { window, projection };
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
  dispose(): void {
    for (const state of this.windows.values()) state.dispose();
    this.windows.clear();
  }
}
