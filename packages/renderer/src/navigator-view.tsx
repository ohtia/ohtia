import { useId, useState, type ReactNode } from "react";
import {
  formatDate,
  message,
  type InterfaceLocale,
  type ProfileFields,
  type SimpleMessageKey,
  type WorkflowStep,
} from "@ohtia/contracts";
import { StageStatus, type Stage } from "./research-presentation.js";
import type { NavigatorState } from "./navigator-controller.js";
import { profileSectionIds, unanswered, type ProfileSection } from "./thesis-profile-fields.js";
import "./thesis-profile.css";
import "./navigator.css";

/** The saved profile as the Navigator reads it; pending edits never reach it. */
export interface NavigatorProfile {
  /** `undefined` while reading, `null` before the first save. */
  readonly saved: { readonly fields: ProfileFields } | null | undefined;
  readonly readFailed: boolean;
  readonly retry: () => void;
}

type Milestone = { readonly title: string; readonly date?: string; readonly done: boolean };
const shownMilestones = 3;

/** Not-done milestones: dated ones from the earliest date, then undated ones in profile order. */
export function upcomingMilestones(fields: ProfileFields | undefined): {
  readonly recorded: number;
  readonly pending: readonly Milestone[];
} {
  const fact = fields?.milestones;
  const items = fact?.state === "known" ? fact.items.map((item) => item.value) : [];
  const pending = items.filter((item) => !item.done);
  const dated = pending
    .filter((item) => item.date !== undefined)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return {
    recorded: items.length,
    pending: [...dated, ...pending.filter((item) => item.date === undefined)],
  };
}

function calendarDate(locale: InterfaceLocale, value: string, style: "medium" | "long"): string {
  // A profile date is a calendar date; UTC keeps it from shifting with the time zone.
  return formatDate(locale, new Date(`${value}T00:00:00Z`), { dateStyle: style, timeZone: "UTC" });
}

function Schedule({
  locale,
  profile,
  today,
  openSchedule,
}: {
  readonly locale: InterfaceLocale;
  readonly profile: NavigatorProfile;
  readonly today: string;
  readonly openSchedule: () => void;
}) {
  const id = useId();
  const text = (key: SimpleMessageKey) => message(locale, key);
  const saved = profile.saved;
  const fields = saved?.fields;
  const deadline = fields?.deadline;
  const { recorded, pending } = upcomingMilestones(fields);
  return (
    <section className="navigator-schedule" aria-labelledby={`${id}-heading`}>
      <div className="navigator-section-heading">
        <h3 id={`${id}-heading`}>{text("profile.section.schedule")}</h3>
        <button type="button" className="primitive-button" onClick={openSchedule}>
          {text("profile.openSchedule")}
        </button>
      </div>
      {profile.readFailed ? (
        <div className="navigator-failure">
          <p>{text("navigator.scheduleFailed")}</p>
          <button type="button" className="primitive-button" onClick={profile.retry}>
            {text("retry")}
          </button>
        </div>
      ) : saved === undefined ? (
        <p className="profile-hint">{text("profile.loading")}</p>
      ) : (
        <>
          <p className="navigator-deadline">
            <span className="navigator-label">{text("profile.field.deadline")}</span>{" "}
            {deadline?.state === "known" ? (
              <strong>{calendarDate(locale, deadline.value, "long")}</strong>
            ) : (
              <span className="profile-state" data-state={deadline ? deadline.state : "pending"}>
                {text(
                  deadline?.state === "unknown"
                    ? "navigator.deadline.unknown"
                    : deadline?.state === "inapplicable"
                      ? "navigator.deadline.inapplicable"
                      : "navigator.deadline.pending",
                )}
              </span>
            )}
          </p>
          <div className="navigator-milestones">
            <span className="navigator-label" id={`${id}-milestones`}>
              {text("navigator.upcoming")}
            </span>
            {pending.length ? (
              <>
                <ul aria-labelledby={`${id}-milestones`}>
                  {pending.slice(0, shownMilestones).map((item, index) => (
                    <li key={index}>
                      <bdi lang="">{item.title}</bdi>
                      {item.date && (
                        <span className="profile-hint">
                          {calendarDate(locale, item.date, "medium")}
                        </span>
                      )}
                      {item.date && item.date < today && (
                        <span className="profile-state" data-state="late">
                          {text("profile.datePassed")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {pending.length > shownMilestones && (
                  <p className="profile-hint">
                    {message(locale, "navigator.moreMilestones", {
                      count: pending.length - shownMilestones,
                    })}
                  </p>
                )}
              </>
            ) : (
              <p>{text(recorded ? "navigator.noPendingMilestones" : "navigator.noMilestones")}</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export interface NavigatorViewProps {
  readonly locale: InterfaceLocale;
  readonly title: string;
  readonly subtitle: string | null;
  readonly projectType: "thesis";
  readonly steps: readonly WorkflowStep[];
  readonly stages: NavigatorState;
  readonly retryStages: () => void;
  readonly profile: NavigatorProfile;
  readonly openProfile: (section?: ProfileSection) => void;
  /** Eligible controls for a stage, or `null` when there are none; the area is then absent. */
  readonly stageActions?: (step: WorkflowStep) => ReactNode;
  readonly today: string;
}

/** The project overview: schedule, the project type's workflow and the selected stage's detail. */
export function NavigatorView({
  locale,
  title,
  subtitle,
  projectType,
  steps,
  stages,
  retryStages,
  profile,
  openProfile,
  stageActions,
  today,
}: NavigatorViewProps) {
  const id = useId();
  // Workflow keys are composed from the project type and step; the catalog test covers them.
  const text = (key: string) => message(locale, key as SimpleMessageKey);
  const name = (step: WorkflowStep) => text(`workflow.${projectType}.${step.id}.name`);
  const views = stages.stages;
  const latestEntry = views && [...views.values()][0]?.snapshot.latestEntry;
  const [chosen, choose] = useState<string>();
  const selectedId = chosen ?? latestEntry?.stageId ?? steps[0]?.id;
  const selected = steps.find((step) => step.id === selectedId) ?? steps[0];
  const items: Stage[] = views
    ? steps.map((step) =>
        step.kind === "milestone"
          ? { id: step.id, kind: "milestone", name: name(step), state: "pending" }
          : {
              id: step.id,
              name: name(step),
              state: views.get(step.id)?.snapshot.state ?? "not-started",
            },
      )
    : [];
  const view = selected?.kind === "stage" ? views?.get(selected.id) : undefined;
  const latest = view?.latest;
  const actions = selected ? stageActions?.(selected) : undefined;
  const hasActions =
    actions !== undefined &&
    actions !== null &&
    typeof actions !== "boolean" &&
    !(Array.isArray(actions) && actions.length === 0);
  const fields = profile.saved?.fields;
  const questions = fields?.questions?.state === "known" ? fields.questions.items : [];
  return (
    <article className="navigator" aria-labelledby={`${id}-title`}>
      <header className="navigator-header">
        <h2 id={`${id}-title`} className="profile-thesis-title" lang="" dir="auto">
          {title}
        </h2>
        {subtitle && (
          <p className="profile-subtitle-text" lang="" dir="auto">
            {subtitle}
          </p>
        )}
      </header>
      <Schedule
        locale={locale}
        profile={profile}
        today={today}
        openSchedule={() => {
          openProfile("schedule");
        }}
      />
      {stages.readFailed ? (
        <div className="navigator-failure">
          <p>{text("navigator.stagesFailed")}</p>
          <button type="button" className="primitive-button" onClick={retryStages}>
            {text("retry")}
          </button>
        </div>
      ) : !views ? (
        <p className="profile-hint">{text("navigator.stagesLoading")}</p>
      ) : (
        <div className="navigator-workflow">
          <StageStatus
            label={text("navigator.stages")}
            stages={items}
            labels={{
              state: {
                "not-started": text("navigator.state.notStarted"),
                "in-progress": text("navigator.state.inProgress"),
                done: text("navigator.state.done"),
              },
              milestone: {
                pending: text("navigator.milestone.pending"),
                reached: text("navigator.milestone.reached"),
              },
            }}
            selected={selected?.id}
            onSelect={choose}
          />
          {selected && (
            <section className="navigator-stage" aria-labelledby={`${id}-stage`}>
              <h3 id={`${id}-stage`}>{name(selected)}</h3>
              {selected.kind === "milestone" ? (
                <p>{text("navigator.milestone.notReached")}</p>
              ) : (
                <>
                  <dl className="navigator-facts">
                    <dt>{text("navigator.purpose")}</dt>
                    <dd>{text(`workflow.${projectType}.${selected.id}.purpose`)}</dd>
                    <dt>{text("navigator.output")}</dt>
                    <dd>{text(`workflow.${projectType}.${selected.id}.output`)}</dd>
                  </dl>
                  {latest ? (
                    <>
                      <p>
                        {message(
                          locale,
                          latest.state === "done"
                            ? "navigator.since.done"
                            : "navigator.since.inProgress",
                          {
                            date: formatDate(locale, new Date(latest.observedAt), {
                              dateStyle: "medium",
                            }),
                          },
                        )}
                      </p>
                      {latest.remainingConditions.length > 0 && (
                        <div>
                          <h4>{text("navigator.conditions")}</h4>
                          <ul>
                            {latest.remainingConditions.map((condition, index) => (
                              <li key={index} lang="" dir="auto">
                                {condition}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="profile-hint">{text("navigator.notStarted")}</p>
                  )}
                  {view?.snapshot.enter === "workflow_unavailable" ? (
                    <p className="profile-hint">{text("navigator.laterStage")}</p>
                  ) : (
                    <p className="profile-hint">{text("navigator.searchUnavailable")}</p>
                  )}
                  <div>
                    <h4>{text("navigator.have")}</h4>
                    {profile.readFailed || profile.saved === undefined ? (
                      <p className="profile-hint">
                        {text(profile.readFailed ? "navigator.scheduleFailed" : "profile.loading")}
                      </p>
                    ) : (
                      <ul className="navigator-sections">
                        {profileSectionIds.map((section) => {
                          const count = unanswered(fields, section);
                          return (
                            <li key={section}>
                              <button
                                type="button"
                                className="primitive-button primitive-quiet profile-link"
                                onClick={() => {
                                  openProfile(section);
                                }}
                              >
                                {text(`profile.section.${section}`)}
                              </button>
                              <span className="profile-hint">
                                {count
                                  ? message(locale, "profile.sectionUnanswered", { count })
                                  : text("profile.sectionComplete")}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {!profile.readFailed && questions.length > 0 && (
                      <div>
                        <h4>{text("navigator.questions")}</h4>
                        <ul>
                          {questions.map((question, index) => (
                            <li key={index} lang="" dir="auto">
                              {question.value}
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="primitive-button primitive-quiet profile-link"
                          onClick={() => {
                            openProfile("research");
                          }}
                        >
                          {text("navigator.openQuestions")}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              {hasActions && <div className="navigator-stage-actions">{actions}</div>}
            </section>
          )}
        </div>
      )}
    </article>
  );
}
