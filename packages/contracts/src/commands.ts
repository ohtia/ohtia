import { isIdentifier, validateJsonBounds } from "./port.js";
import { isInterfaceLocale } from "./locale.js";
import type { InterfaceLocale } from "./port.js";
import type { SimpleMessageKey } from "./catalogs.js";

export type CommandPlatform = "win32" | "linux" | "darwin";
export type CommandGroup = "general" | "panels" | "appearance" | "edit";
export const commandIds = [
  "settings.open",
  "palette.open",
  "shortcuts.open",
  "help.open",
  "window.new",
  "window.close",
  "application.quit",
  "panels.explorer",
  "panels.documents",
  "panels.chat",
  "document.focus",
  "layout.reset",
  "theme.system",
  "theme.light",
  "theme.dark",
  "zoom.increase",
  "zoom.decrease",
  "zoom.reset",
  "window.fullscreen",
  "menu.open",
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.selectAll",
  "link.documentation",
  "link.report",
  "version.copy",
  "about.open",
] as const;
export type CommandId = (typeof commandIds)[number];
export type CommandReason =
  | "handler_missing"
  | "modal_open"
  | "composing"
  | "no_edit_target"
  | "busy"
  | "zoom_minimum"
  | "zoom_maximum"
  | "actual_size"
  | "wide_layout"
  | "last_panel"
  | "window_limit";
export const commandReasons: readonly CommandReason[] = [
  "handler_missing",
  "modal_open",
  "composing",
  "no_edit_target",
  "busy",
  "zoom_minimum",
  "zoom_maximum",
  "actual_size",
  "wide_layout",
  "last_panel",
  "window_limit",
];
export interface CommandDefinition {
  readonly id: CommandId;
  readonly label: SimpleMessageKey;
  readonly group: CommandGroup;
  readonly shortcuts: Readonly<Record<CommandPlatform, readonly string[]>>;
}
const primary = (key: string) => ({
  win32: [`Ctrl+${key}`],
  linux: [`Ctrl+${key}`],
  darwin: [`Cmd+${key}`],
});
const bindings: Partial<Record<CommandId, CommandDefinition["shortcuts"]>> = {
  "settings.open": primary(","),
  "palette.open": primary("Shift+P"),
  "shortcuts.open": primary("/"),
  "help.open": { win32: ["F1"], linux: ["F1"], darwin: ["Cmd+Shift+/"] },
  "window.new": primary("Shift+N"),
  "window.close": { win32: ["Ctrl+Shift+W"], linux: ["Ctrl+Shift+W"], darwin: ["Cmd+W"] },
  "application.quit": primary("Q"),
  "panels.explorer": primary("Shift+1"),
  "panels.documents": primary("Shift+2"),
  "panels.chat": primary("Shift+3"),
  "zoom.increase": {
    win32: ["Ctrl++", "Ctrl+="],
    linux: ["Ctrl++", "Ctrl+="],
    darwin: ["Cmd++", "Cmd+="],
  },
  "zoom.decrease": primary("-"),
  "zoom.reset": primary("0"),
  "window.fullscreen": { win32: ["F11"], linux: ["F11"], darwin: ["Ctrl+Cmd+F"] },
  "menu.open": { win32: ["Alt", "F10"], linux: ["Alt", "F10"], darwin: [] },
  "edit.undo": primary("Z"),
  "edit.redo": { win32: ["Ctrl+Y"], linux: ["Ctrl+Shift+Z"], darwin: ["Cmd+Shift+Z"] },
  "edit.cut": primary("X"),
  "edit.copy": primary("C"),
  "edit.paste": primary("V"),
  "edit.selectAll": primary("A"),
};
export const commandDefinitions: readonly CommandDefinition[] = commandIds.map((id) => ({
  id,
  label: `command.${id}` as const,
  group: id.startsWith("edit.")
    ? "edit"
    : id.startsWith("panels.") || id === "document.focus" || id === "layout.reset"
      ? "panels"
      : id.startsWith("zoom.") || id.startsWith("theme.")
        ? "appearance"
        : "general",
  shortcuts: bindings[id] ?? { win32: [], linux: [], darwin: [] },
}));
/** Component-scoped keys supplement the command registry without creating application commands. */
export const componentShortcutDefinitions: readonly {
  readonly id: string;
  readonly group: "separator" | "dialogs";
  readonly label: SimpleMessageKey;
  readonly shortcuts: CommandDefinition["shortcuts"];
}[] = [
  {
    id: "separator.step",
    group: "separator",
    label: "shortcuts.separator.step",
    shortcuts: allPlatforms(["ArrowLeft", "ArrowRight"]),
  },
  {
    id: "separator.largeStep",
    group: "separator",
    label: "shortcuts.separator.largeStep",
    shortcuts: allPlatforms(["Shift+ArrowLeft", "Shift+ArrowRight"]),
  },
  {
    id: "separator.limits",
    group: "separator",
    label: "shortcuts.separator.limits",
    shortcuts: allPlatforms(["Home", "End"]),
  },
  {
    id: "separator.reset",
    group: "separator",
    label: "shortcuts.separator.reset",
    shortcuts: allPlatforms(["Enter"]),
  },
  {
    id: "separator.cancel",
    group: "separator",
    label: "shortcuts.separator.cancel",
    shortcuts: allPlatforms(["Escape"]),
  },
  {
    id: "dialogs.close",
    group: "dialogs",
    label: "dialog.close",
    shortcuts: allPlatforms(["Escape"]),
  },
];
function allPlatforms(keys: readonly string[]): CommandDefinition["shortcuts"] {
  return { win32: keys, linux: keys, darwin: keys };
}
/** ARIA uses DOM modifier names and names the literal plus key explicitly. */
export function ariaShortcuts(shortcuts: readonly string[]): string {
  return shortcuts
    .filter((key) => key !== "Alt")
    .map((key) => key.replace(/\+\+$/, "+Plus").replace(/Ctrl/g, "Control").replace(/Cmd/g, "Meta"))
    .join(" ");
}
/** Key fields shared by Electron's `before-input-event` input and a DOM KeyboardEvent. */
export interface CommandKeyInput {
  readonly key: string;
  readonly code: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly isComposing: boolean;
}
/** Only application keys; AltGr and composition remain with the focused native editor. */
export function commandForInput(
  platform: CommandPlatform,
  input: CommandKeyInput,
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
/**
 * On Linux, consuming a key in main makes Chromium drop the next IME text commits until another
 * key press, so main dispatches without consuming and the renderer cancels the key instead.
 */
export const rendererCancelsCommandKeys = (platform: CommandPlatform): boolean =>
  platform === "linux";
export const isCommandId = (value: unknown): value is CommandId =>
  typeof value === "string" && commandIds.some((id) => id === value);
export const isCommandPlatform = (value: unknown): value is CommandPlatform =>
  value === "win32" || value === "linux" || value === "darwin";
export interface CommandContext {
  readonly windowGeneration: string;
  readonly platform: CommandPlatform;
}
export interface CommandIntent {
  readonly windowGeneration: string;
  readonly source: "native" | "renderer";
  readonly sequence: number;
  readonly command: CommandId;
}
export interface CommandEntry {
  readonly id: CommandId;
  readonly reason?: CommandReason;
  readonly checked?: boolean;
}
export interface CommandSnapshot {
  readonly windowGeneration: string;
  readonly revision: number;
  readonly locale: InterfaceLocale;
  readonly entries: readonly CommandEntry[];
}
export type CommandResult =
  | {
      readonly status:
        "completed" | "failed" | "revoked" | "stale_context" | "unknown_command" | "stale_intent";
    }
  | { readonly status: "unavailable"; readonly reason: CommandReason };
export interface AboutNotice {
  readonly component: string;
  readonly license: string;
}
export interface AboutInformation {
  readonly product: "Ohtia";
  readonly version: string;
  readonly build: string;
  readonly platform: CommandPlatform;
  readonly architecture: "x86-64" | "ARM64";
  readonly copyright: string;
  readonly license: string;
  readonly notices: readonly AboutNotice[];
}
export const projectLinks = {
  repository: "https://github.com/ohtia/ohtia",
  documentation: "https://github.com/ohtia/ohtia/blob/main/docs/index.md",
  report: "https://github.com/ohtia/ohtia/issues/new/choose",
} as const;
export type ProjectLink = keyof typeof projectLinks;
export type NativeCommand =
  | "window.close"
  | "application.quit"
  | "window.fullscreen"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.selectAll"
  | "link.documentation"
  | "link.report";
export const nativeCommandIds: readonly NativeCommand[] = [
  "window.close",
  "application.quit",
  "window.fullscreen",
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.selectAll",
  "link.documentation",
  "link.report",
];
export const isNativeCommand = (value: unknown): value is NativeCommand =>
  nativeCommandIds.some((id) => id === value);
/** The input modality that activated the application-menu command. */
export type MenuInput = "keyboard" | "pointer";
export interface WindowCommandRequest {
  readonly intent: CommandIntent;
  readonly anchor?: { readonly x: number; readonly y: number };
  readonly input?: MenuInput;
}
export function isWindowCommandRequest(value: unknown): value is WindowCommandRequest {
  if (
    !plain(value) ||
    !["intent", "anchor,input,intent"].includes(Object.keys(value).sort().join(",")) ||
    !isCommandIntent(value.intent) ||
    !["window.new", "menu.open"].includes(value.intent.command)
  )
    return false;
  if (!("anchor" in value)) return value.intent.command === "window.new";
  const anchor = value.anchor;
  return (
    value.intent.command === "menu.open" &&
    (value.input === "keyboard" || value.input === "pointer") &&
    plain(anchor) &&
    keys(anchor, "x,y") &&
    [anchor.x, anchor.y].every(
      (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 100000,
    )
  );
}
export function isCommandResult(value: unknown): value is CommandResult {
  return (
    plain(value) &&
    typeof value.status === "string" &&
    (value.status === "unavailable"
      ? keys(value, "reason,status") && commandReasons.some((reason) => reason === value.reason)
      : keys(value, "status") &&
        [
          "completed",
          "failed",
          "revoked",
          "stale_context",
          "unknown_command",
          "stale_intent",
        ].includes(value.status))
  );
}
/** A popup dismissal restores its trigger; selecting an action preserves that action's focus. */
export type WindowCommandResult =
  CommandResult | { readonly status: "completed"; readonly menuDismissed: boolean };
export function isWindowCommandResult(value: unknown): value is WindowCommandResult {
  return (
    isCommandResult(value) ||
    (plain(value) &&
      keys(value, "menuDismissed,status") &&
      value.status === "completed" &&
      typeof value.menuDismissed === "boolean")
  );
}
export interface CommandBridge {
  context(): Promise<CommandContext>;
  publish(snapshot: CommandSnapshot): Promise<boolean>;
  onIntent(listener: (intent: CommandIntent) => void): () => void;
  about(): Promise<AboutInformation>;
  perform(command: NativeCommand): Promise<boolean>;
  windowAction(request: WindowCommandRequest): Promise<WindowCommandResult>;
  copyVersionInformation(locale: InterfaceLocale): Promise<boolean>;
  openLink(link: ProjectLink): Promise<boolean>;
}
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
function keys(value: Record<string, unknown>, expected: string): boolean {
  return Object.keys(value).sort().join(",") === expected;
}
export function isCommandContext(value: unknown): value is CommandContext {
  return (
    plain(value) &&
    keys(value, "platform,windowGeneration") &&
    isIdentifier(value.windowGeneration) &&
    isCommandPlatform(value.platform)
  );
}
export function isCommandIntent(value: unknown): value is CommandIntent {
  return (
    plain(value) &&
    keys(value, "command,sequence,source,windowGeneration") &&
    isIdentifier(value.windowGeneration) &&
    (value.source === "native" || value.source === "renderer") &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) > 0 &&
    isCommandId(value.command)
  );
}
export function isCommandSnapshot(value: unknown): value is CommandSnapshot {
  if (
    !plain(value) ||
    !validateJsonBounds(value).ok ||
    !keys(value, "entries,locale,revision,windowGeneration") ||
    !isIdentifier(value.windowGeneration) ||
    !isInterfaceLocale(value.locale) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !Array.isArray(value.entries) ||
    value.entries.length !== commandIds.length
  )
    return false;
  const ids = new Set<CommandId>();
  for (const entry of value.entries) {
    if (
      !plain(entry) ||
      !["id", "id,reason", "checked,id", "checked,id,reason"].includes(
        Object.keys(entry).sort().join(","),
      ) ||
      !isCommandId(entry.id) ||
      ids.has(entry.id) ||
      ("checked" in entry && typeof entry.checked !== "boolean") ||
      ("reason" in entry && !commandReasons.some((reason) => reason === entry.reason))
    )
      return false;
    ids.add(entry.id);
  }
  return true;
}
export function isAboutInformation(value: unknown): value is AboutInformation {
  if (
    !plain(value) ||
    !validateJsonBounds(value).ok ||
    !keys(value, "architecture,build,copyright,license,notices,platform,product,version") ||
    value.product !== "Ohtia" ||
    !isCommandPlatform(value.platform) ||
    (value.architecture !== "x86-64" && value.architecture !== "ARM64") ||
    ![value.version, value.build, value.copyright, value.license].every(
      (text) => typeof text === "string" && text.length > 0 && text.length <= 4096,
    ) ||
    !Array.isArray(value.notices) ||
    value.notices.length > 128
  )
    return false;
  return value.notices.every(
    (notice: unknown) =>
      plain(notice) &&
      keys(notice, "component,license") &&
      [notice.component, notice.license].every(
        (text) => typeof text === "string" && text.length > 0 && text.length <= 65536,
      ),
  );
}
