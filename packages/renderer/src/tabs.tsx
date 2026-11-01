import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
  closeLabel?: string;
}
export function Tabs({
  label,
  items,
  selected,
  onSelect,
  onClose,
  selectedTabRef,
}: {
  label: string;
  items: readonly TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  selectedTabRef?: RefObject<HTMLButtonElement | null>;
}) {
  const prefix = useId();
  const [focused, setFocused] = useState(selected);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const list = useRef<HTMLDivElement>(null);
  const focusOwner = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!focusOwner.current || items.some((item) => item.id === focusOwner.current)) return;
    focusOwner.current = undefined;
    const active = document.activeElement;
    if (active === document.body || (active && list.current?.contains(active)))
      refs.current.get(selected)?.focus();
  }, [items, selected]);
  return (
    <div>
      <div
        ref={list}
        className="primitive-tabs"
        role="tablist"
        aria-label={label}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLElement)
            focusOwner.current =
              event.target.closest<HTMLElement>("[data-tab-owner]")?.dataset.tabOwner;
        }}
        onBlurCapture={(event) => {
          if (
            event.target.isConnected &&
            event.target.ownerDocument.activeElement !== event.target &&
            !(
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            )
          )
            focusOwner.current = undefined;
        }}
      >
        {items.map((item, index) => (
          <div role="presentation" key={item.id} data-tab-owner={item.id}>
            <button
              type="button"
              role="tab"
              id={`${prefix}-tab-${item.id}`}
              aria-controls={`${prefix}-panel-${item.id}`}
              aria-selected={item.id === selected}
              tabIndex={
                item.id === (items.some((tab) => tab.id === focused) ? focused : selected) ? 0 : -1
              }
              onFocus={() => {
                setFocused(item.id);
              }}
              ref={(node) => {
                if (node) refs.current.set(item.id, node);
                else refs.current.delete(item.id);
                if (item.id === selected && selectedTabRef) selectedTabRef.current = node;
              }}
              onClick={() => {
                onSelect(item.id);
              }}
              onKeyDown={(event) => {
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : event.key === "ArrowRight"
                        ? (index + 1) % items.length
                        : event.key === "ArrowLeft"
                          ? (index + items.length - 1) % items.length
                          : undefined;
                if (next !== undefined) {
                  event.preventDefault();
                  const target = items[next];
                  if (target) refs.current.get(target.id)?.focus();
                } else if (event.key === "Delete" && item.closeLabel) {
                  event.preventDefault();
                  onClose?.(item.id);
                }
              }}
            >
              {item.label}
            </button>
            {item.closeLabel && (
              <button
                type="button"
                aria-label={item.closeLabel}
                onClick={() => {
                  onClose?.(item.id);
                }}
              >
                {item.closeLabel}
              </button>
            )}
          </div>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${prefix}-panel-${item.id}`}
          aria-labelledby={`${prefix}-tab-${item.id}`}
          hidden={item.id !== selected}
          tabIndex={0}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
