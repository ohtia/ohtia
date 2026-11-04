import { useEffect, useId, useRef, useState, type RefObject, type ReactNode } from "react";
import {
  ariaShortcuts,
  commandDefinitions,
  componentShortcutDefinitions,
  message,
  type CommandId,
  type CommandEntry,
  type CommandPlatform,
  type CommandSnapshot,
  type InterfaceLocale,
} from "@ohtia/contracts";
import type { CommandController } from "./command-controller.js";
import { Dialog } from "./layers.js";
import { LucideGlyph } from "./iconography.js";

const paletteGroups = ["general", "panels", "appearance", "edit"] as const;
const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC").toLowerCase();
export function paletteCommands(locale: InterfaceLocale, query: string) {
  const needle = fold(query);
  return paletteGroups.flatMap((group) =>
    commandDefinitions.filter(
      (command) =>
        command.group === group &&
        (fold(message(locale, command.label)).includes(needle) ||
          fold(message(locale, `palette.group.${group}`)).includes(needle)),
    ),
  );
}
export function shortcutLabel(binding: string): string {
  return binding
    .replaceAll("ArrowLeft", "←")
    .replaceAll("ArrowRight", "→")
    .replaceAll("Escape", "Esc");
}
function ShortcutKeys({ bindings }: { bindings: readonly string[] }) {
  return (
    <span className="command-keys">
      {bindings.map((binding) => (
        <kbd key={binding}>{shortcutLabel(binding)}</kbd>
      ))}
    </span>
  );
}
function DiscoveryFeedback({
  children,
  locale,
}: {
  readonly children: ReactNode;
  readonly locale: InterfaceLocale;
}) {
  return (
    <div className="discovery-feedback">
      <div
        className="discovery-feedback-scroll"
        role="region"
        tabIndex={0}
        aria-label={message(locale, "command.feedback")}
      >
        {children}
      </div>
    </div>
  );
}
interface DiscoveryDialogProps {
  readonly feedback?: ReactNode;
  readonly open: boolean;
  readonly locale: InterfaceLocale;
  readonly onClose: () => void;
  readonly returnFocusRef: Readonly<RefObject<HTMLElement | null>>;
}
type CommandPaletteProps = DiscoveryDialogProps & {
  readonly controller: CommandController;
  readonly snapshot: CommandSnapshot;
  readonly onInvoke: (id: CommandId) => void;
};
/** Each opening owns its transient query, active option and activation guard. */
export function CommandPalette(props: CommandPaletteProps) {
  return props.open ? <PaletteOpening {...props} /> : null;
}
function PaletteOpening({
  open,
  locale,
  controller,
  snapshot,
  onClose,
  onInvoke,
  returnFocusRef,
  feedback,
}: CommandPaletteProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CommandId>();
  const composing = useRef(false);
  const activating = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const commands = paletteCommands(locale, query);
  const entry = (command: CommandId): CommandEntry =>
    snapshot.entries.find((entry) => entry.id === command) ?? {
      id: command,
      reason: "handler_missing",
    };
  const active =
    commands.find((command) => command.id === selected) ??
    commands.find((command) => !entry(command.id).reason) ??
    commands[0];
  useEffect(() => {
    if (open && active)
      list.current
        ?.querySelector(`[id="${id}-${active.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  const activate = (command: CommandId) => {
    if (!open || composing.current || activating.current || entry(command).reason) return;
    activating.current = true;
    onInvoke(command);
  };
  return (
    <Dialog
      open={open}
      title={message(locale, "command.palette.open")}
      closeLabel={message(locale, "dialog.close")}
      closeContent={<LucideGlyph name="x" />}
      className="command-dialog command-palette"
      initialFocus="input"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      footer={
        <p id={`${id}-help`} className="palette-footer">
          {message(locale, "palette.help")}
        </p>
      }
    >
      <div className="palette-input-row">
        <LucideGlyph name="search" size={20} />
        <input
          role="combobox"
          aria-label={message(locale, "palette.input")}
          aria-autocomplete="list"
          aria-describedby={`${id}-help`}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={active ? `${id}-${active.id}` : undefined}
          placeholder={message(locale, "palette.input")}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelected(undefined);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              event.nativeEvent.isComposing ||
              composing.current ||
              // eslint-disable-next-line @typescript-eslint/no-deprecated -- IME confirmation may report 229 after compositionend.
              event.keyCode === 229
            )
              return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!commands.length) return;
              const index = commands.findIndex((command) => command.id === active?.id);
              setSelected(
                commands.at(
                  (index + (event.key === "ArrowDown" ? 1 : -1) + commands.length) %
                    commands.length,
                )?.id,
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (!event.repeat && active) activate(active.id);
            }
          }}
        />
      </div>
      <div
        ref={list}
        id={`${id}-list`}
        role="listbox"
        aria-label={message(locale, "palette.results")}
        className="palette-list"
      >
        {paletteGroups.map((group) => {
          const items = commands.filter((command) => command.group === group);
          if (!items.length) return null;
          return (
            <div key={group} role="group" aria-labelledby={`${id}-group-${group}`}>
              <div className="palette-group-label" id={`${id}-group-${group}`}>
                {message(locale, `palette.group.${group}`)}
              </div>
              {items.map((command) => {
                const reason = entry(command.id).reason;
                const bindings = command.shortcuts[controller.context.platform];
                return (
                  <div
                    key={command.id}
                    id={`${id}-${command.id}`}
                    role="option"
                    aria-selected={active?.id === command.id}
                    aria-disabled={!!reason}
                    aria-labelledby={`${id}-label-${command.id}`}
                    aria-describedby={reason ? `${id}-reason-${command.id}` : undefined}
                    aria-keyshortcuts={ariaShortcuts(bindings) || undefined}
                    className="palette-option"
                    onPointerMove={() => {
                      setSelected(command.id);
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      activate(command.id);
                    }}
                  >
                    <span id={`${id}-label-${command.id}`}>{message(locale, command.label)}</span>
                    <ShortcutKeys bindings={bindings} />
                    {reason && (
                      <span className="palette-reason" id={`${id}-reason-${command.id}`}>
                        {message(locale, `command.reason.${reason}`)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <DiscoveryFeedback locale={locale}>{feedback}</DiscoveryFeedback>
      {!commands.length && (
        <p role="status" className="palette-empty">
          {message(locale, "palette.empty", { query })}
        </p>
      )}
    </Dialog>
  );
}

export function KeyboardShortcutsDialog({
  open,
  locale,
  platform,
  onClose,
  returnFocusRef,
  feedback,
}: DiscoveryDialogProps & { readonly platform: CommandPlatform }) {
  if (!open) return null;
  // Edit bindings share General in the five-group help inventory; no second command list.
  const rows = commandDefinitions
    .filter((command) => command.shortcuts[platform].length)
    .map((command) => ({
      ...command,
      group:
        command.group === "edit"
          ? "general"
          : command.group === "appearance"
            ? "zoom"
            : command.group,
    }));
  const groups = ["general", "panels", "zoom", "separator", "dialogs"] as const;
  return (
    <Dialog
      open={open}
      title={message(locale, "command.shortcuts.open")}
      closeLabel={message(locale, "dialog.close")}
      closeContent={<LucideGlyph name="x" />}
      className="command-dialog shortcuts-dialog"
      bodyClassName="shortcuts-body"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      footer={
        <div className="shortcuts-footer">
          <div
            className="shortcuts-note"
            role="region"
            tabIndex={0}
            aria-label={message(locale, "shortcuts.source")}
          >
            {message(locale, "shortcuts.source")}
          </div>
        </div>
      }
    >
      <DiscoveryFeedback locale={locale}>{feedback}</DiscoveryFeedback>
      <table className="shortcuts-table">
        <thead>
          <tr>
            <th scope="col">{message(locale, "shortcuts.action")}</th>
            <th scope="col">{message(locale, "shortcuts.binding")}</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group}>
            <tr className="shortcuts-group">
              <th scope="rowgroup" colSpan={2}>
                {message(locale, `shortcuts.group.${group}`)}
              </th>
            </tr>
            {[
              ...rows.filter((command) => command.group === group),
              ...componentShortcutDefinitions.filter((command) => command.group === group),
            ].map((command) => (
              <tr key={command.id} data-shortcut-id={command.id}>
                <th scope="row">{message(locale, command.label)}</th>
                <td>
                  <ShortcutKeys bindings={command.shortcuts[platform]} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </Dialog>
  );
}
