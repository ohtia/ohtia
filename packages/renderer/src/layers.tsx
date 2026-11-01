import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import type { ButtonProps } from "./controls.js";

/** Native modal top-layer semantics supply inert background and focus containment. */
export function Dialog({
  open,
  title,
  closeLabel,
  children,
  onClose,
  initialFocus = "close",
  returnFocusRef,
}: {
  open: boolean;
  title: string;
  closeLabel: string;
  children: ReactNode;
  onClose: () => void;
  initialFocus?: "close" | "safe";
  returnFocusRef?: Readonly<RefObject<HTMLElement | null>>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const currentClose = useRef(onClose);
  const currentReturn = useRef(returnFocusRef);
  const currentOpen = useRef(open);
  useLayoutEffect(() => {
    currentClose.current = onClose;
    currentReturn.current = returnFocusRef;
    currentOpen.current = open;
  }, [onClose, returnFocusRef, open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    if (dialog.ownerDocument.querySelector("dialog[open]")) {
      onClose();
      return;
    }
    const owner = dialog.ownerDocument;
    const trigger = owner.activeElement;
    let active = true;
    const focusSafe = () => {
      (
        dialog.querySelector<HTMLElement>(
          initialFocus === "safe" ? "[data-safe]" : "[data-close]",
        ) ?? dialog.querySelector<HTMLElement>("[data-close]")
      )?.focus();
    };
    const containFocus = () => {
      if (
        active &&
        currentOpen.current &&
        dialog.isConnected &&
        dialog.open &&
        !dialog.contains(owner.activeElement)
      )
        focusSafe();
    };
    const outsideKey = (event: KeyboardEvent) => {
      if (
        !active ||
        !currentOpen.current ||
        !dialog.isConnected ||
        !dialog.open ||
        event.defaultPrevented ||
        event.isComposing ||
        (event.target instanceof Node && dialog.contains(event.target))
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        currentClose.current();
      } else if (event.key === "Tab") {
        event.preventDefault();
        focusSafe();
      }
    };
    const nativeClose = () => {
      if (
        active &&
        currentOpen.current &&
        dialog.isConnected &&
        !dialog.open &&
        !owner.querySelector("dialog[open]")
      ) {
        dialog.showModal();
        focusSafe();
      }
    };
    dialog.showModal();
    focusSafe();
    const observer = new MutationObserver(containFocus);
    observer.observe(dialog, { childList: true, subtree: true });
    owner.addEventListener("focusin", containFocus);
    owner.addEventListener("keydown", outsideKey);
    dialog.addEventListener("close", nativeClose);
    return () => {
      active = false;
      observer.disconnect();
      owner.removeEventListener("focusin", containFocus);
      owner.removeEventListener("keydown", outsideKey);
      dialog.removeEventListener("close", nativeClose);
      dialog.close();
      const restore = (target: HTMLElement | null | undefined) => {
        if (target?.isConnected && target.ownerDocument === owner) target.focus();
        return target != null && owner.activeElement === target;
      };
      if (!(trigger instanceof HTMLElement && trigger !== owner.body && restore(trigger)))
        restore(currentReturn.current?.current);
    };
  }, [open, initialFocus]);
  return (
    <dialog
      ref={ref}
      className="primitive-dialog"
      aria-labelledby={id}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            "button, [href], input, select, textarea, [tabindex], summary, [contenteditable=true]",
          ),
        ].filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(":disabled") &&
            element.getClientRects().length > 0,
        );
        const sequential = focusable
          .filter((element) => {
            if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name)
              return true;
            const group = focusable.filter(
              (candidate): candidate is HTMLInputElement =>
                candidate instanceof HTMLInputElement &&
                candidate.type === "radio" &&
                candidate.name === element.name &&
                candidate.form === element.form,
            );
            return (group.find((candidate) => candidate.checked) ?? group[0]) === element;
          })
          .sort((left, right) => (left.tabIndex || Infinity) - (right.tabIndex || Infinity));
        const index = sequential.indexOf(
          event.currentTarget.ownerDocument.activeElement as HTMLElement,
        );
        const next = event.shiftKey
          ? index <= 0
            ? sequential.length - 1
            : index - 1
          : (index + 1) % sequential.length;
        event.preventDefault();
        sequential[next]?.focus();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={id}>{title}</h2>
      <button type="button" data-close onClick={onClose}>
        {closeLabel}
      </button>
      {children}
    </dialog>
  );
}
export function Confirmation({
  open,
  title,
  consequences,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  disabledReason,
  returnFocusRef,
}: {
  open: boolean;
  title: string;
  consequences: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  disabledReason?: string;
  returnFocusRef?: Readonly<RefObject<HTMLElement | null>>;
}) {
  const reasonId = useId();
  return (
    <Dialog
      open={open}
      title={title}
      closeLabel={cancelLabel}
      onClose={onCancel}
      initialFocus="safe"
      {...(returnFocusRef ? { returnFocusRef } : {})}
    >
      <div>{consequences}</div>
      <div className="actions">
        <button type="button" data-safe onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className="primitive-destructive"
          aria-disabled={!!disabledReason}
          aria-describedby={disabledReason ? reasonId : undefined}
          onClick={() => {
            if (!disabledReason) onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
      {disabledReason && <p id={reasonId}>{disabledReason}</p>}
    </Dialog>
  );
}
/** Reposition on viewport/scroll/content changes and remove every listener on disposal. */
function useLayerPosition(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  layer: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    if (!open || !anchor.current || !layer.current) return;
    const control = anchor.current;
    const surface = layer.current;
    const position = () => {
      const rect = control.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      const margin = Number.parseFloat(getComputedStyle(surface).paddingLeft) || 0;
      surface.style.left = `${String(Math.max(margin, Math.min(rect.left, width - surface.offsetWidth - margin)))}px`;
      surface.style.top = `${String(Math.max(margin, Math.min(rect.bottom, height - surface.offsetHeight - margin)))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(surface);
    observer.observe(control);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, anchor, layer]);
}
export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ "aria-describedby"?: string | undefined }>;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const layer = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const dismissed = useRef(false);
  const hovered = useRef(false);
  useLayerPosition(visible, anchor, layer);
  useEffect(() => {
    if (!visible) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const modal = document.querySelector("dialog[open]");
        if (modal && !modal.contains(anchor.current)) {
          dismissed.current = true;
          setVisible(false);
          return;
        }
        event.preventDefault();
        dismissed.current = true;
        setVisible(false);
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("keydown", escape, true);
    };
  }, [visible]);
  return (
    <span
      ref={anchor}
      className="primitive-layer-anchor"
      onKeyDown={(event) => {
        if (event.key === "Escape" && visible) {
          event.preventDefault();
          event.stopPropagation();
          dismissed.current = true;
          setVisible(false);
        }
      }}
      onPointerEnter={() => {
        hovered.current = true;
        if (!dismissed.current) setVisible(true);
      }}
      onPointerLeave={(event) => {
        hovered.current = false;
        if (!event.currentTarget.contains(document.activeElement)) {
          setVisible(false);
          dismissed.current = false;
        }
      }}
      onFocus={() => {
        if (!dismissed.current) setVisible(true);
      }}
      onBlur={(event) => {
        if (!hovered.current && !event.currentTarget.contains(event.relatedTarget)) {
          setVisible(false);
          dismissed.current = false;
        }
      }}
    >
      {cloneElement(children, {
        "aria-describedby":
          [children.props["aria-describedby"], visible ? id : undefined]
            .filter(Boolean)
            .join(" ") || undefined,
      })}
      {visible && (
        <span ref={layer} className="primitive-tooltip" id={id} role="tooltip">
          {label}
        </span>
      )}
    </span>
  );
}

export function IconButton({
  label,
  icon,
  onPress,
  disabledReason,
  loadingLabel,
}: Omit<ButtonProps, "variant"> & { icon: ReactNode }) {
  const id = useId();
  return (
    <span className="primitive-control">
      <Tooltip label={label}>
        <button
          type="button"
          aria-label={label}
          aria-describedby={disabledReason || loadingLabel ? id : undefined}
          aria-disabled={!!disabledReason || !!loadingLabel}
          aria-busy={!!loadingLabel}
          onClick={() => {
            if (!disabledReason && !loadingLabel) onPress();
          }}
        >
          <span aria-hidden="true">{icon}</span>
        </button>
      </Tooltip>
      {(disabledReason || loadingLabel) && <span id={id}>{disabledReason ?? loadingLabel}</span>}
      <span role="status" aria-atomic="true" className="primitive-announcement">
        {loadingLabel ?? ""}
      </span>
    </span>
  );
}
export function Popover({
  label,
  closeLabel,
  children,
}: {
  label: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const hovered = useRef(false);
  useLayerPosition(open, anchor, panel);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      ref={anchor}
      className="primitive-layer-anchor"
      onPointerEnter={() => {
        hovered.current = true;
      }}
      onPointerLeave={(event) => {
        hovered.current = false;
        if (!event.currentTarget.contains(document.activeElement)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (!hovered.current && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {label}
      </button>
      {open && (
        <div
          ref={panel}
          className="primitive-popover"
          id={id}
          role="region"
          aria-label={label}
          tabIndex={-1}
        >
          {children}
          <button type="button" onClick={close}>
            {closeLabel}
          </button>
        </div>
      )}
    </div>
  );
}
export interface MenuAction {
  id: string;
  label: string;
  onPress: () => void;
  disabledReason?: string;
}
export function ActionMenu({
  label,
  actions,
  contextual = false,
  children,
}: {
  label: string;
  actions: readonly MenuAction[];
  contextual?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  useLayerPosition(open, anchor, menu);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  return (
    <div
      ref={anchor}
      className="primitive-layer-anchor"
      onContextMenu={(event) => {
        if (contextual) {
          event.preventDefault();
          setOpen(true);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (
          contextual &&
          (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
        ) {
          event.preventDefault();
          setOpen(true);
        }
      }}
    >
      {children}
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
      </button>
      {open && (
        <div
          ref={menu}
          className="primitive-menu"
          role="menu"
          aria-label={label}
          id={id}
          onKeyDown={(event) => {
            const items = [
              ...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []),
            ];
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : event.key === "ArrowDown"
                    ? (index + 1) % items.length
                    : event.key === "ArrowUp"
                      ? (index + items.length - 1) % items.length
                      : undefined;
            if (next !== undefined) {
              event.preventDefault();
              items[next]?.focus();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === "Tab") {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          {actions.map((action) => (
            <div role="presentation" key={action.id}>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={!!action.disabledReason}
                aria-describedby={action.disabledReason ? `${id}-${action.id}` : undefined}
                onClick={() => {
                  if (!action.disabledReason) {
                    close();
                    action.onPress();
                  }
                }}
              >
                {action.label}
              </button>
              {action.disabledReason && (
                <span id={`${id}-${action.id}`}>{action.disabledReason}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
