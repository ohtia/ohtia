import { formatNumber, message, type InterfaceLocale } from "@ohtia/contracts";
import { LucideGlyph } from "./iconography.js";
import "./activity-badge.css";

export interface ActivityCounts {
  readonly replies: number;
  readonly attention: number;
}

export function activityName(
  locale: InterfaceLocale,
  name: string,
  counts: ActivityCounts,
  control: "chat" | "history",
): string {
  const { replies, attention } = counts;
  return [
    name,
    ...(control === "history"
      ? [
          attention && message(locale, "activity.conversationsAttention", { count: attention }),
          replies && message(locale, "activity.conversationsNew", { count: replies }),
        ]
      : [
          replies && message(locale, "activity.newReplies", { count: replies }),
          attention && message(locale, "activity.needsAttention"),
        ]),
  ]
    .filter(Boolean)
    .join(", ");
}

export function ActivityBadge(
  props:
    | { readonly variant: "attention" }
    | { readonly variant: "new"; readonly count: number; readonly locale: InterfaceLocale },
) {
  return (
    <span aria-hidden="true" className={`activity-badge activity-badge-${props.variant}`}>
      {props.variant === "new" ? (
        formatNumber(props.locale, props.count)
      ) : (
        <LucideGlyph name="triangle-alert" size={16} />
      )}
    </span>
  );
}

export function ActivityBadges({
  counts,
  locale,
}: {
  readonly counts: ActivityCounts;
  readonly locale: InterfaceLocale;
}) {
  return (
    <>
      {counts.replies > 0 && <ActivityBadge variant="new" count={counts.replies} locale={locale} />}
      {counts.attention > 0 && <ActivityBadge variant="attention" />}
    </>
  );
}
