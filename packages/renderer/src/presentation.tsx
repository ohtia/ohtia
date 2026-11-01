import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./controls.js";
import { LucideGlyph, type LucideName } from "./iconography.js";

export type PresentationPhase =
  | "requested"
  | "accepted"
  | "uncertain"
  | "failed"
  | "confirmed"
  | "pending"
  | "rejected"
  | "review-required";
const marks: Record<PresentationPhase, LucideName> = {
  requested: "circle-dashed",
  accepted: "check",
  uncertain: "circle-question-mark",
  failed: "octagon-alert",
  confirmed: "circle-check",
  pending: "circle-dashed",
  rejected: "circle-x",
  "review-required": "refresh-cw",
};
export function StateLabel({ phase, label }: { phase: PresentationPhase; label: string }) {
  return (
    <span className="primitive-state" data-phase={phase}>
      <LucideGlyph name={marks[phase]} /> {label}
    </span>
  );
}
export interface PresentationEvent {
  operationId: string;
  revision: number;
  phase: PresentationPhase;
  label: string;
  source: "snapshot" | "response";
}
/** Presentation events never grant permission or certify a durable domain outcome. */
export function OperationStatus({
  operationId,
  event,
}: {
  operationId: string;
  event?: PresentationEvent;
}) {
  const [current, setCurrent] = useState<PresentationEvent>();
  const [announcement, setAnnouncement] = useState<{ key: string; event: PresentationEvent }>();
  const announcementScope = useRef(operationId);
  useLayoutEffect(() => {
    if (announcementScope.current !== operationId) {
      announcementScope.current = operationId;
      setAnnouncement(undefined);
    }
  }, [operationId]);
  const latest = useRef(new Map<string, PresentationEvent>());
  const announced = useRef(new Set<string>());
  useEffect(() => {
    if (
      !event ||
      event.operationId !== operationId ||
      !Number.isSafeInteger(event.revision) ||
      event.revision < 0
    )
      return;
    const previous = latest.current.get(operationId);
    if (
      previous &&
      (event.revision < previous.revision ||
        (event.revision === previous.revision && event.phase !== previous.phase))
    ) {
      setCurrent(previous);
      return;
    }
    latest.current.set(operationId, event);
    setCurrent(event);
    const key = JSON.stringify([event.operationId, event.revision, event.phase]);
    if (
      event.source === "response" &&
      ["accepted", "failed", "confirmed", "rejected", "uncertain"].includes(event.phase) &&
      !announced.current.has(key)
    ) {
      announced.current.add(key);
      setAnnouncement({ key, event });
    }
  }, [event, operationId]);
  const visible = announcement?.event.operationId === operationId ? announcement : undefined;
  const blocking = visible?.event.phase === "failed" || visible?.event.phase === "rejected";
  // The outer live regions stay mounted; keyed children expose distinct same-text outcomes.
  return (
    <div>
      {current?.operationId === operationId && (
        <StateLabel phase={current.phase} label={current.label} />
      )}
      <span className="primitive-announcement" role="status" aria-atomic="true">
        {visible && !blocking && <span key={visible.key}>{visible.event.label}</span>}
      </span>
      <span className="primitive-announcement" role="alert" aria-atomic="true">
        {visible && blocking && <span key={visible.key}>{visible.event.label}</span>}
      </span>
    </div>
  );
}

export function Notice({
  title,
  children,
  tone = "attention",
  action,
}: {
  title: string;
  children: ReactNode;
  tone?: "attention" | "danger";
  action?: { label: string; onPress: () => void };
}) {
  const id = useId();
  return (
    <section className={`primitive-${tone}`} aria-labelledby={id}>
      <h3 id={id}>
        <LucideGlyph name={tone === "danger" ? "octagon-alert" : "triangle-alert"} /> {title}
      </h3>
      <div>{children}</div>
      {action && <Button {...action} />}
    </section>
  );
}
export interface ToastMessage {
  id: string;
  label: string;
}
/** Mount one region at the application root; a single controlled slot has no timeout. */
export function ToastRegion({
  toast,
  dismissLabel,
  onDismiss,
}: {
  toast?: ToastMessage;
  dismissLabel: string;
  onDismiss: (id: string) => void;
}) {
  return (
    <aside className="primitive-toast">
      <span role="status" aria-atomic="true">
        {toast?.label ?? ""}
      </span>
      {toast && (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={() => {
            onDismiss(toast.id);
          }}
        >
          {dismissLabel}
        </button>
      )}
    </aside>
  );
}
export interface TableColumn {
  id: string;
  label: string;
  numeric?: boolean;
}
export interface TableRow {
  id: string;
  heading: string;
  cells: Readonly<Record<string, ReactNode>>;
}
export function DataTable({
  label,
  columns,
  rows,
  compact = false,
  sort,
  onSort,
  more,
}: {
  label: string;
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
  compact?: boolean;
  sort?: { column: string; direction: "ascending" | "descending"; label: string };
  onSort?: (column: string) => void;
  more?: { label: string; onPress: () => void; disabledReason?: string };
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLTableSectionElement>(null);
  useLayoutEffect(() => {
    const region = viewport.current,
      head = header.current;
    if (!region || !head) return;
    const update = () => {
      const inset = Number.parseFloat(getComputedStyle(head.querySelector("th") ?? head).top) || 0;
      region.style.scrollPaddingBlockStart = `${String(head.getBoundingClientRect().height + inset)}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(head);
    return () => {
      observer.disconnect();
    };
  }, [compact]);
  return (
    <div>
      {sort && <p role="status">{sort.label}</p>}
      {compact && onSort && (
        <div className="actions">
          {columns.map((column) => (
            <button
              key={column.id}
              type="button"
              onClick={() => {
                onSort(column.id);
              }}
            >
              {column.label}
            </button>
          ))}
        </div>
      )}
      {compact ? (
        <ul aria-label={label}>
          {rows.map((row) => (
            <li key={row.id}>
              <strong>{row.heading}</strong>
              <dl>
                {columns.map((column) => (
                  <div key={column.id}>
                    <dt>{column.label}</dt>
                    <dd>{row.cells[column.id]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <div
          ref={viewport}
          className="primitive-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={label}
          onFocusCapture={(event) => {
            const head = header.current,
              region = event.currentTarget,
              target = event.target;
            if (
              !head ||
              !(target instanceof HTMLElement) ||
              target === region ||
              head.contains(target)
            )
              return;
            const floating = target.closest(".primitive-menu, .primitive-popover, dialog");
            if (floating && region.contains(floating)) return;
            const extent = Number.parseFloat(getComputedStyle(region).paddingTop) || 0;
            const overlap =
              head.getBoundingClientRect().bottom + extent - target.getBoundingClientRect().top;
            if (overlap > 0) region.scrollTop -= overlap;
          }}
        >
          <table>
            <caption>{label}</caption>
            <thead ref={header}>
              <tr>
                <th scope="col">{label}</th>
                {columns.map((column) => (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={sort?.column === column.id ? sort.direction : undefined}
                  >
                    {onSort ? (
                      <button
                        type="button"
                        onClick={() => {
                          onSort(column.id);
                        }}
                      >
                        {column.label}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.heading}</th>
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={column.numeric ? "primitive-numeric" : undefined}
                    >
                      {row.cells[column.id]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && <Button {...more} />}
    </div>
  );
}
export function Skeleton({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div role="group" aria-busy="true" aria-label={label}>
      <span aria-hidden="true" className="primitive-skeleton">
        {children ?? "…"}
      </span>
      <span>{label}</span>
    </div>
  );
}
export function Progress({
  label,
  phase,
  value,
  max = 100,
}: {
  label: string;
  phase: string;
  value?: number;
  max?: number;
}) {
  const id = useId();
  return (
    <div>
      <label id={`${id}-label`} htmlFor={id}>
        {label}: {phase}
      </label>
      {value === undefined ? (
        <div role="progressbar" aria-labelledby={`${id}-label`} aria-valuetext={phase} />
      ) : (
        <progress id={id} value={value} max={max} />
      )}
      {value !== undefined && (
        <span>
          {value} / {max}
        </span>
      )}
    </div>
  );
}

export function Panel({
  label,
  hidden = false,
  children,
}: {
  label: string;
  hidden?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} hidden={hidden}>
      <h2 id={id} tabIndex={-1}>
        {label}
      </h2>
      {children}
    </section>
  );
}
/** Static separator only; interactive window resizing belongs to the workspace controller. */
export function Separator({
  orientation = "horizontal",
}: {
  orientation?: "horizontal" | "vertical";
}) {
  return <div role="separator" aria-orientation={orientation} className="primitive-separator" />;
}
