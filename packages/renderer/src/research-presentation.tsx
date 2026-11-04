import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { InterfaceLocale } from "@ohtia/contracts";
import { Button } from "./controls.js";
import { LucideGlyph, type LucideName } from "./iconography.js";
import { VoiceLabel, type ContributorIdentity } from "./contributor-identity.js";

/**
 * Controlled research presentation. Every value, label and callback comes from the consumer;
 * these components read no storage, request no inference and never infer state from prose.
 */

/** Supplied research content keeps its recorded language; `undefined` remains unknown. */
export interface RecordedText {
  readonly text: string;
  readonly language: string | undefined;
}
export interface PresentationAction {
  readonly label: string;
  readonly onPress: () => void;
}
/** An unknown or not-applicable count is never displayed as zero or as a percentage. */
export type PresentationMetric = number | "unknown" | "not-applicable";
export interface MetricLabels {
  readonly unknown: string;
  /** Accessible explanation of the visible "—". */
  readonly notApplicable: string;
}
type Proposer = Exclude<ContributorIdentity, { readonly kind: "supervisor" }>;

function assertProposer(identity: ContributorIdentity): asserts identity is Proposer {
  // Original supervisor feedback is quoted, never presented as an AI or product proposal.
  if (identity.kind === "supervisor")
    throw new RangeError("Supervisor identity cannot label proposed or interpreted content.");
}

function Recorded({ value, document = false }: { value: RecordedText; document?: boolean }) {
  return (
    <span
      className="research-recorded"
      lang={value.language ?? ""}
      dir="auto"
      data-font-role={document ? "document" : undefined}
    >
      {value.text}
    </span>
  );
}

export function MetricValue({
  value,
  labels,
  format = String,
}: {
  readonly value: PresentationMetric;
  readonly labels: MetricLabels;
  readonly format?: (value: number) => string;
}) {
  if (value === "unknown") return <span data-metric="unknown">{labels.unknown}</span>;
  if (value === "not-applicable")
    return (
      <span data-metric="not-applicable">
        <span aria-hidden="true">—</span>
        <span className="research-hidden">{labels.notApplicable}</span>
      </span>
    );
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Invalid presentation metric.");
  return <span data-metric="known">{format(value)}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function EvidenceHighlight({
  state,
  label,
  passage,
}: {
  readonly state: "proposed" | "confirmed";
  /** Translated accessible name: source, page or location, and state. */
  readonly label: string;
  readonly passage: RecordedText;
}) {
  return (
    <span role="group" aria-label={label} className="evidence-highlight" data-state={state}>
      {state === "confirmed" ? (
        <mark className="evidence-highlight-fill">
          <Recorded value={passage} />
        </mark>
      ) : (
        <Recorded value={passage} />
      )}
    </span>
  );
}

export interface TutorCommentProps {
  readonly locale: InterfaceLocale;
  /** Author as declared by the returned file or the researcher. */
  readonly author: string;
  readonly authorSource: "file" | "user";
  readonly submittedVersion: string;
  readonly quotation: RecordedText;
  readonly labels: {
    readonly authorSource: Readonly<Record<"file" | "user", string>>;
    readonly submittedVersion: string;
    readonly interpretation: string;
  };
  readonly interpretation?: { readonly identity: Proposer; readonly text: RecordedText };
}
export function TutorComment({
  locale,
  author,
  authorSource,
  submittedVersion,
  quotation,
  labels,
  interpretation,
}: TutorCommentProps) {
  if (interpretation) assertProposer(interpretation.identity);
  return (
    <figure className="research-tutor">
      <figcaption>
        <VoiceLabel identity={{ kind: "supervisor", author, submittedVersion }} locale={locale} />
        <dl className="research-fields">
          <Field label={labels.submittedVersion}>
            <bdi>{submittedVersion}</bdi>
          </Field>
          <Field label={labels.authorSource[authorSource]}>
            <bdi lang="">{author}</bdi>
          </Field>
        </dl>
      </figcaption>
      <blockquote className="research-tutor-quote" data-font-role="document">
        <q lang={quotation.language ?? ""} dir="auto">
          {quotation.text}
        </q>
      </blockquote>
      {interpretation && (
        <div
          className="research-interpretation"
          data-origin={interpretation.identity.kind === "unknown" ? "unknown" : "recorded"}
          role="group"
          aria-label={labels.interpretation}
        >
          <VoiceLabel identity={interpretation.identity} locale={locale} />
          <p>
            <Recorded value={interpretation.text} />
          </p>
        </div>
      )}
    </figure>
  );
}

export type TrustState = "proposed" | "confirmed" | "pending" | "rejected" | "review-required";
const trustMarks: Record<TrustState, LucideName> = {
  proposed: "circle-dashed",
  confirmed: "circle-check",
  pending: "circle-dashed",
  rejected: "circle-x",
  "review-required": "refresh-cw",
};
export type ProposalReview =
  | { readonly state: "proposed" | "pending" }
  /** The researcher's review of an exact version and scope, not a correctness certificate. */
  | { readonly state: "confirmed"; readonly version: string; readonly scope: string }
  | { readonly state: "rejected"; readonly reason: RecordedText }
  | { readonly state: "review-required"; readonly cause: RecordedText };
export interface ProposalCardProps {
  readonly locale: InterfaceLocale;
  /** The actual producer recorded with the proposal. */
  readonly producer: Proposer;
  /** What is being reviewed: quotation, paraphrase, relationship basis or interpretation. */
  readonly subject: string;
  readonly content: RecordedText;
  readonly review: ProposalReview;
  readonly labels: {
    readonly state: Readonly<Record<TrustState, string>>;
    readonly version: string;
    readonly scope: string;
    readonly reason: string;
    readonly cause: string;
    readonly confirmationLimit: string;
  };
  /** Offered only for proposed or pending content; content text never changes this set. */
  readonly actions?: {
    readonly confirm: PresentationAction;
    readonly correct: PresentationAction;
    readonly reject: PresentationAction;
    readonly leavePending: PresentationAction;
  };
  readonly reviewAgain?: PresentationAction;
}
export function ProposalCard({
  locale,
  producer,
  subject,
  content,
  review,
  labels,
  actions,
  reviewAgain,
}: ProposalCardProps) {
  assertProposer(producer);
  const id = useId();
  const state = review.state;
  const open = state === "proposed" || state === "pending";
  return (
    <article
      className="research-card"
      data-state={state}
      data-origin={producer.kind === "unknown" ? "unknown" : "recorded"}
      aria-labelledby={id}
    >
      <p id={id} className="research-card-title">
        <VoiceLabel identity={producer} locale={locale} />
        <span>{subject}</span>
      </p>
      <p className="research-trust" data-state={state}>
        <LucideGlyph name={trustMarks[state]} /> {labels.state[state]}
      </p>
      <p data-font-role="document">
        <Recorded value={content} />
      </p>
      {review.state === "confirmed" && (
        <>
          <dl className="research-fields">
            <Field label={labels.version}>
              <bdi>{review.version}</bdi>
            </Field>
            <Field label={labels.scope}>
              <bdi>{review.scope}</bdi>
            </Field>
          </dl>
          <p>{labels.confirmationLimit}</p>
        </>
      )}
      {review.state === "rejected" && (
        <dl className="research-fields">
          <Field label={labels.reason}>
            <Recorded value={review.reason} />
          </Field>
        </dl>
      )}
      {review.state === "review-required" && (
        <>
          <div className="research-review-notice">
            <p>
              <LucideGlyph name="refresh-cw" /> {labels.cause}: <Recorded value={review.cause} />
            </p>
          </div>
          {reviewAgain && <Button {...reviewAgain} />}
        </>
      )}
      {open && actions && (
        <div className="actions">
          <Button {...actions.confirm} />
          <Button {...actions.correct} />
          <Button {...actions.reject} />
          {state === "proposed" && <Button {...actions.leavePending} />}
        </div>
      )}
    </article>
  );
}

export type ContrastOutcome =
  "supported" | "partly-supported" | "ambiguous" | "not-found" | "contradicted" | "not-verified";
const outcomeMarks: Record<ContrastOutcome, [LucideName, "neutral" | "attention"]> = {
  supported: ["circle-dot", "neutral"],
  "partly-supported": ["contrast", "attention"],
  ambiguous: ["circle-question-mark", "attention"],
  "not-found": ["search-x", "attention"],
  contradicted: ["arrow-left-right", "attention"],
  "not-verified": ["ban", "neutral"],
};
/** Missing access is a not-verified cause, never contradiction or evidence of absence. */
export type ContrastCause = "access" | "processing" | "restriction" | "scope";
export type ContrastResultProps = {
  readonly label: string;
  readonly reason: RecordedText;
  /** A CoverageStatement for the examined content. */
  readonly coverage: ReactElement;
  readonly labels: { readonly reason: string; readonly cause: string };
} & (
  | { readonly outcome: Exclude<ContrastOutcome, "not-verified"> }
  | {
      readonly outcome: "not-verified";
      readonly cause: ContrastCause;
      readonly causeLabel: string;
    }
);
export function ContrastResult(props: ContrastResultProps) {
  const [icon, tone] = outcomeMarks[props.outcome];
  return (
    <div className="research-outcome" data-outcome={props.outcome} data-tone={tone}>
      <p className="research-outcome-label">
        <LucideGlyph name={icon} /> {props.label}
      </p>
      <dl className="research-fields">
        <Field label={props.labels.reason}>
          <Recorded value={props.reason} />
        </Field>
        {props.outcome === "not-verified" && (
          <Field label={props.labels.cause}>
            <span data-cause={props.cause}>{props.causeLabel}</span>
          </Field>
        )}
      </dl>
      {props.coverage}
    </div>
  );
}

export type CritiqueSeverity = "verifiable-error" | "defensible-weakness" | "reviewer-question";
const critiqueMarks: Record<CritiqueSeverity, number> = {
  "verifiable-error": 3,
  "defensible-weakness": 2,
  "reviewer-question": 1,
};
/** Marks and label describe the kind of criticism; they are not a grade or certificate. */
export function CritiqueLevel({
  level,
  label,
}: {
  readonly level: CritiqueSeverity;
  readonly label: string;
}) {
  const marks = critiqueMarks[level];
  return (
    <span className="research-critique" data-level={level} data-marks={marks}>
      <svg
        width={marks * 8}
        height="16"
        viewBox={`0 0 ${String(marks * 8)} 16`}
        aria-hidden="true"
        focusable="false"
        fill="currentColor"
      >
        {Array.from({ length: marks }, (_, index) => (
          <rect key={index} x={index * 8 + 1} y="2" width="4" height="12" rx="1" />
        ))}
      </svg>
      <span>{label}</span>
    </span>
  );
}

export interface ObservationCardProps {
  readonly locale: InterfaceLocale;
  readonly producer: Proposer;
  readonly level: CritiqueSeverity;
  readonly levelLabel: string;
  readonly draftVersion: string;
  readonly block: string;
  readonly passage: RecordedText;
  readonly grounds: RecordedText;
  readonly labels: {
    readonly title: string;
    readonly draftVersion: string;
    readonly block: string;
    readonly passage: string;
    readonly grounds: string;
  };
  /** Optional ContrastResult; the CoverageStatement is required. */
  readonly outcome?: ReactElement;
  readonly coverage: ReactElement;
  readonly actions?: readonly PresentationAction[];
}
export function ObservationCard({
  locale,
  producer,
  level,
  levelLabel,
  draftVersion,
  block,
  passage,
  grounds,
  labels,
  outcome,
  coverage,
  actions,
}: ObservationCardProps) {
  assertProposer(producer);
  const id = useId();
  return (
    <article
      className="research-card"
      data-state="proposed"
      data-origin={producer.kind === "unknown" ? "unknown" : "recorded"}
      aria-labelledby={id}
    >
      <p id={id} className="research-card-title">
        <VoiceLabel identity={producer} locale={locale} />
        <span>{labels.title}</span>
      </p>
      <CritiqueLevel level={level} label={levelLabel} />
      <dl className="research-fields">
        <Field label={labels.draftVersion}>
          <bdi>{draftVersion}</bdi>
        </Field>
        <Field label={labels.block}>
          <bdi>{block}</bdi>
        </Field>
        <Field label={labels.passage}>
          <Recorded value={passage} document />
        </Field>
        <Field label={labels.grounds}>
          <Recorded value={grounds} />
        </Field>
      </dl>
      {outcome}
      {coverage}
      {actions && actions.length > 0 && (
        <div className="actions">
          {actions.map((action, index) => (
            <Button key={index} {...action} />
          ))}
        </div>
      )}
    </article>
  );
}

/** Changed support keeps the previous observation at its original anchor as history. */
export function ReviewRequired({
  title,
  changed,
  previousVersion,
  currentVersion,
  labels,
  reviewAgain,
  children,
}: {
  readonly title: string;
  readonly changed: RecordedText;
  readonly previousVersion: string;
  readonly currentVersion: string;
  readonly labels: {
    readonly changed: string;
    readonly previous: string;
    readonly current: string;
  };
  readonly reviewAgain: PresentationAction;
  /** The unchanged earlier observation. */
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="research-review" aria-labelledby={id}>
      <div className="research-review-notice">
        <p id={id}>
          <LucideGlyph name="refresh-cw" /> {title}
        </p>
        <dl className="research-fields">
          <Field label={labels.changed}>
            <Recorded value={changed} />
          </Field>
          <Field label={labels.previous}>
            <bdi>{previousVersion}</bdi>
          </Field>
          <Field label={labels.current}>
            <bdi>{currentVersion}</bdi>
          </Field>
        </dl>
      </div>
      <Button {...reviewAgain} />
      <div className="research-history" data-version={previousVersion}>
        {children}
      </div>
    </section>
  );
}

export interface CoverageStatementProps {
  readonly examinedRecords: PresentationMetric;
  readonly completeTexts: PresentationMetric;
  readonly inaccessible: PresentationMetric;
  /** Uncovered material types; an empty list states that none were omitted. */
  readonly omitted: readonly RecordedText[] | "unknown";
  readonly labels: {
    readonly title: string;
    readonly examinedRecords: string;
    readonly completeTexts: string;
    readonly inaccessible: string;
    readonly omitted: string;
    readonly noneOmitted: string;
    readonly metric: MetricLabels;
  };
  readonly format?: (value: number) => string;
}
export function CoverageStatement({
  examinedRecords,
  completeTexts,
  inaccessible,
  omitted,
  labels,
  format,
}: CoverageStatementProps) {
  const id = useId();
  const metric = (value: PresentationMetric) => (
    <MetricValue value={value} labels={labels.metric} {...(format ? { format } : {})} />
  );
  return (
    <div className="research-coverage" role="group" aria-labelledby={id}>
      <p id={id}>
        <LucideGlyph name="info" /> {labels.title}
      </p>
      <dl className="research-fields">
        <Field label={labels.examinedRecords}>{metric(examinedRecords)}</Field>
        <Field label={labels.completeTexts}>{metric(completeTexts)}</Field>
        <Field label={labels.inaccessible}>{metric(inaccessible)}</Field>
        <Field label={labels.omitted}>
          {omitted === "unknown" ? (
            <span data-metric="unknown">{labels.metric.unknown}</span>
          ) : omitted.length === 0 ? (
            labels.noneOmitted
          ) : (
            <ul>
              {omitted.map((item, index) => (
                <li key={index}>
                  <Recorded value={item} />
                </li>
              ))}
            </ul>
          )}
        </Field>
      </dl>
    </div>
  );
}

export type ProcessingState =
  | { readonly state: "received" }
  | {
      readonly state: "processing";
      readonly phase: string;
      readonly progress?: { readonly value: number; readonly max: number };
    }
  | { readonly state: "complete" }
  | { readonly state: "partial"; readonly omitted: RecordedText }
  | { readonly state: "unprocessable"; readonly cause: RecordedText };
type ProcessingKind = ProcessingState["state"];
const processingMarks: Record<ProcessingKind, LucideName> = {
  received: "info",
  processing: "circle-dashed",
  complete: "check",
  partial: "contrast",
  unprocessable: "triangle-alert",
};
/** A received file is never presented as read. */
export function ProcessingStatus({
  status,
  labels,
}: {
  readonly status: ProcessingState;
  readonly labels: {
    readonly state: Readonly<Record<ProcessingKind, string>>;
    readonly omitted: string;
    readonly cause: string;
  };
}) {
  return (
    <span className="research-processing" data-state={status.state}>
      <span className="research-processing-label">
        <LucideGlyph name={processingMarks[status.state]} /> {labels.state[status.state]}
      </span>
      {status.state === "processing" && (
        <span>
          {status.phase}
          {status.progress && (
            <>
              {" "}
              <progress
                value={status.progress.value}
                max={status.progress.max}
                aria-label={status.phase}
              />{" "}
              {status.progress.value} / {status.progress.max}
            </>
          )}
        </span>
      )}
      {status.state === "partial" && (
        <span>
          {labels.omitted}: <Recorded value={status.omitted} />
        </span>
      )}
      {status.state === "unprocessable" && (
        <span>
          {labels.cause}: <Recorded value={status.cause} />
        </span>
      )}
    </span>
  );
}

export function RestrictionBadge({
  label,
  inheritance,
}: {
  readonly label: string;
  /** Translated description of claims and arguments inheriting the restriction. */
  readonly inheritance?: string;
}) {
  return (
    <span className="research-restriction">
      <span className="research-restriction-label">
        <LucideGlyph name="lock" size={16} /> {label}
      </span>
      {inheritance && <span>{inheritance}</span>}
    </span>
  );
}

export type SourceKind = "document" | "dataset" | "media" | "software" | "object";
const sourceMarks: Record<SourceKind, LucideName> = {
  document: "file-text",
  dataset: "database",
  media: "image",
  software: "code",
  object: "archive",
};
export interface SourceRowProps {
  readonly title: RecordedText;
  readonly authors: RecordedText;
  readonly year: PresentationMetric;
  readonly kind: SourceKind;
  readonly publication: string;
  readonly origin: string;
  readonly processing: ReactNode;
  readonly restrictions?: readonly ReactNode[];
  readonly confirmedClaims: PresentationMetric;
  readonly proposedClaims: PresentationMetric;
  readonly labels: {
    readonly type: string;
    readonly kind: Readonly<Record<SourceKind, string>>;
    readonly year: string;
    readonly publication: string;
    readonly origin: string;
    readonly confirmedClaims: string;
    readonly proposedClaims: string;
    readonly metric: MetricLabels;
  };
}
export function SourceRow({
  title,
  authors,
  year,
  kind,
  publication,
  origin,
  processing,
  restrictions = [],
  confirmedClaims,
  proposedClaims,
  labels,
}: SourceRowProps) {
  const id = useId();
  return (
    <article className="research-source" aria-labelledby={id}>
      <p id={id} className="research-source-title">
        <Recorded value={title} />
      </p>
      <p>
        <Recorded value={authors} />
      </p>
      <dl className="research-fields">
        <Field label={labels.year}>
          <MetricValue value={year} labels={labels.metric} />
        </Field>
        <Field label={labels.type}>
          <LucideGlyph name={sourceMarks[kind]} size={16} /> {labels.kind[kind]}
        </Field>
        <Field label={labels.publication}>{publication}</Field>
        <Field label={labels.origin}>{origin}</Field>
        <Field label={labels.confirmedClaims}>
          <MetricValue value={confirmedClaims} labels={labels.metric} />
        </Field>
        <Field label={labels.proposedClaims}>
          <MetricValue value={proposedClaims} labels={labels.metric} />
        </Field>
      </dl>
      <div className="actions">
        {processing}
        {restrictions.map((restriction, index) => (
          <span key={index}>{restriction}</span>
        ))}
      </div>
    </article>
  );
}

export interface WeeklyAction {
  readonly id: string;
  /** Generated proposal text keeps the language in which it was generated. */
  readonly what: RecordedText;
  readonly why: RecordedText;
  readonly done: RecordedText;
  /** Estimated time; `undefined` states that no estimate exists, never zero. */
  readonly time: string | undefined;
  readonly open?: PresentationAction;
}
/** The Navigator shows at most five actions, each identified as an Ohtia proposal. */
export function WeeklyActions({
  locale,
  label,
  actions,
  labels,
}: {
  readonly locale: InterfaceLocale;
  readonly label: string;
  readonly actions: readonly WeeklyAction[];
  readonly labels: {
    readonly why: string;
    readonly done: string;
    readonly time: string;
    readonly unknownTime: string;
    readonly proposal: string;
  };
}) {
  if (actions.length > 5) throw new RangeError("The Navigator shows at most five weekly actions.");
  return (
    <div className="research-weekly">
      <p className="research-card-title">
        <VoiceLabel identity={{ kind: "product" }} locale={locale} />
        <span>{labels.proposal}</span>
      </p>
      <ol aria-label={label}>
        {actions.map((action) => (
          <li key={action.id} className="research-card" data-state="proposed">
            <p className="research-weekly-what">
              <Recorded value={action.what} />
            </p>
            <dl className="research-fields">
              <Field label={labels.why}>
                <Recorded value={action.why} />
              </Field>
              <Field label={labels.done}>
                <Recorded value={action.done} />
              </Field>
              <Field label={labels.time}>
                {action.time === undefined ? (
                  <span data-metric="unknown">{labels.unknownTime}</span>
                ) : (
                  action.time
                )}
              </Field>
            </dl>
            {action.open && <Button {...action.open} />}
          </li>
        ))}
      </ol>
    </div>
  );
}

export type StageState = "not-started" | "in-progress" | "done";
export interface Stage {
  readonly id: string;
  readonly name: string;
  readonly state: StageState;
  readonly focus?: boolean;
  readonly pendingProposal?: boolean;
}
/** Stage, stage state, focus and pending proposal remain separate facts. */
export function StageStatus({
  label,
  stages,
  orientation = "vertical",
  labels,
}: {
  readonly label: string;
  readonly stages: readonly Stage[];
  readonly orientation?: "horizontal" | "vertical";
  readonly labels: {
    readonly state: Readonly<Record<StageState, string>>;
    readonly focus: string;
    readonly pendingProposal: string;
  };
}) {
  if (stages.filter((stage) => stage.focus).length > 1)
    throw new RangeError("At most one stage is the current focus.");
  return (
    <ol className="research-stages" data-orientation={orientation} aria-label={label}>
      {stages.map((stage) => (
        <li
          key={stage.id}
          className="research-stage"
          data-focus={stage.focus ? "true" : "false"}
          aria-current={stage.focus ? "step" : undefined}
        >
          <span className="research-stage-name">{stage.name}</span>
          <span className="research-badge" data-state={stage.state}>
            {labels.state[stage.state]}
          </span>
          {stage.focus && (
            <span className="research-badge" data-state="focus">
              {labels.focus}
            </span>
          )}
          {stage.pendingProposal && (
            <span className="research-stage-proposal">
              <LucideGlyph name="circle-dashed" size={16} /> {labels.pendingProposal}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export interface PacePlan {
  readonly state: "on-pace" | "behind";
  readonly label: string;
  readonly deadline: string;
  readonly completion: PresentationMetric;
}
/** Without an agreed plan there is explanatory text and no indicator. */
export function PaceIndicator({
  plan,
  noPlan,
  labels,
}: {
  readonly plan: PacePlan | undefined;
  readonly noPlan: string;
  readonly labels: {
    readonly deadline: string;
    readonly completion: string;
    readonly metric: MetricLabels;
  };
}) {
  if (!plan)
    return (
      <p className="research-pace" data-plan="none">
        {noPlan}
      </p>
    );
  if (typeof plan.completion === "number" && plan.completion > 100)
    throw new RangeError("Plan completion exceeds 100%.");
  return (
    <div className="research-pace" data-plan={plan.state}>
      <p className="research-pace-label" data-state={plan.state}>
        <LucideGlyph name="calendar-clock" /> {plan.label}
      </p>
      <dl className="research-fields">
        <Field label={labels.deadline}>
          <bdi>{plan.deadline}</bdi>
        </Field>
        <Field label={labels.completion}>
          <MetricValue
            value={plan.completion}
            labels={labels.metric}
            format={(value) => `${String(value)}%`}
          />
        </Field>
      </dl>
    </div>
  );
}

export type SaveState =
  | { readonly state: "saving" }
  | { readonly state: "saved"; readonly version: string }
  | { readonly state: "unsaved"; readonly pending: number }
  | { readonly state: "failed"; readonly textSafe: boolean; readonly retry: PresentationAction }
  | { readonly state: "conflict" };
type SaveKind = SaveState["state"];
const saveMarks: Record<SaveKind, LucideName> = {
  saving: "save",
  saved: "check",
  unsaved: "triangle-alert",
  failed: "octagon-alert",
  conflict: "git-compare",
};
const saveKey = (status: SaveState) =>
  status.state === "saved" ? `saved:${status.version}` : status.state;
/**
 * Local persistence state. Provider connectivity is a separate indication and never blocks it.
 * A newly saved version and a conflict are announced as status and a failure as alert; the first
 * snapshot and repeated identical snapshots are not announced. Saving and typing-driven unsaved
 * counts stay silent: the operation is announced through its outcome.
 */
export function SaveStatus({
  status,
  labels,
  offline,
}: {
  readonly status: SaveState;
  readonly labels: {
    readonly state: Readonly<Record<SaveKind, string>>;
    readonly version: string;
    readonly pending: string;
    readonly textSafe: string;
    readonly textAtRisk: string;
  };
  /** Translated provider-connectivity text, shown separately from local saving. */
  readonly offline?: string;
}) {
  const key = saveKey(status);
  const text = labels.state[status.state];
  const previous = useRef(key);
  // The mounted snapshot and every announced version stay silent when observed again.
  const announced = useRef(new Set([key]));
  const entries = useRef(0);
  const [announcement, setAnnouncement] = useState<{
    key: string;
    alert: boolean;
    text: string;
  }>();
  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    if (status.state === "failed" || status.state === "conflict") {
      // Each new failure or conflict is announced, even with the same text as an earlier one.
      entries.current += 1;
      setAnnouncement({
        key: `${status.state}:${String(entries.current)}`,
        alert: status.state === "failed",
        text,
      });
    } else if (status.state === "saved" && !announced.current.has(key)) {
      announced.current.add(key);
      setAnnouncement({ key, alert: false, text });
    } else setAnnouncement(undefined);
  }, [key, status.state, text]);
  return (
    <div className="research-save" data-state={status.state}>
      <p className="research-save-label" data-state={status.state}>
        <LucideGlyph name={saveMarks[status.state]} /> {text}
        {status.state === "saved" && (
          <>
            {" · "}
            {labels.version} <bdi>{status.version}</bdi>
          </>
        )}
        {status.state === "unsaved" && (
          <>
            {" · "}
            {labels.pending} {status.pending}
          </>
        )}
      </p>
      {status.state === "failed" && (
        <>
          <p>{status.textSafe ? labels.textSafe : labels.textAtRisk}</p>
          <Button {...status.retry} />
        </>
      )}
      {offline && (
        <p className="research-offline">
          <LucideGlyph name="cloud-off" /> {offline}
        </p>
      )}
      <span className="primitive-announcement" role="status" aria-atomic="true">
        {announcement && !announcement.alert && (
          <span key={announcement.key}>{announcement.text}</span>
        )}
      </span>
      <span className="primitive-announcement" role="alert" aria-atomic="true">
        {announcement?.alert && <span key={announcement.key}>{announcement.text}</span>}
      </span>
    </div>
  );
}

/** Preserves the researcher's local text; comparison and recovery are consumer callbacks. */
export function VersionConflict({
  title,
  explanation,
  local,
  localBase,
  savedFirst,
  labels,
  compare,
  recover,
}: {
  readonly title: string;
  readonly explanation: string;
  readonly local: RecordedText;
  readonly localBase: string;
  readonly savedFirst: string;
  readonly labels: {
    readonly localText: string;
    readonly localBase: string;
    readonly savedFirst: string;
  };
  readonly compare: PresentationAction;
  readonly recover: PresentationAction;
}) {
  const id = useId();
  return (
    <section className="research-conflict" aria-labelledby={id}>
      <p id={id} className="research-conflict-title">
        <LucideGlyph name="git-compare" /> {title}
      </p>
      <p>{explanation}</p>
      <dl className="research-fields">
        <Field label={labels.savedFirst}>
          <bdi>{savedFirst}</bdi>
        </Field>
        <Field label={labels.localBase}>
          <bdi>{localBase}</bdi>
        </Field>
      </dl>
      <div className="research-local" role="group" aria-label={labels.localText}>
        <p data-font-role="document">
          <Recorded value={local} />
        </p>
      </div>
      <div className="actions">
        <Button {...compare} />
        <Button {...recover} />
      </div>
    </section>
  );
}
