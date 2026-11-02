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
export interface CommandBridge {
  context(): Promise<CommandContext>;
  publish(snapshot: CommandSnapshot): Promise<boolean>;
  onIntent(listener: (intent: CommandIntent) => void): () => void;
  about(): Promise<AboutInformation>;
  perform(command: NativeCommand): Promise<boolean>;
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
