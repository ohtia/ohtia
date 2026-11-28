import { useId, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import {
  formatDate,
  formatNumber,
  message,
  profileFieldTypes,
  profileListLimit,
  type InterfaceLocale,
  type ProfileField,
  type ProfileOrigin,
} from "@ohtia/contracts";
import { LucideGlyph } from "./iconography.js";
import type { ProjectSelectionLease } from "./pending-project-work.js";
import type { ThesisProfileController } from "./thesis-profile-controller.js";
import {
  editFact,
  localDate,
  newDraftValue,
  profileFields,
  profileSectionIds,
  profileSections,
  researcherOrigin,
  validatedDraftFact,
  type DraftValue,
  type FieldDraft,
  type FieldState,
  type ProfileSection,
  type SavedFact,
} from "./thesis-profile-fields.js";
import { Selector } from "./controls.js";
import "./thesis-profile.css";

type Notice = NonNullable<ReturnType<ThesisProfileController["snapshot"]>["notice"]>;
const notices = {
  invalid: "profile.invalid",
  tooLarge: "profile.tooLarge",
  conflict: "profile.conflict",
  saveFailed: "profile.saveFailed",
  uncertain: "profile.uncertain",
  saved: "profile.saved",
  refreshFailed: "profile.refreshFailed",
} as const satisfies Record<Notice, string>;

const factStates = ["known", "unknown", "inapplicable"] as const;
const originKinds = ["researcher_statement", "described_material"] as const;
const hints = {
  schedule: "profile.deadlinePrompt",
  research: "profile.researchPrompt",
  prior_work: "profile.priorWorkPrompt",
} as const satisfies Partial<Record<ProfileSection, string>>;
const help = {
  tools: "profile.help.tools",
  bibliography: "profile.help.bibliography",
} as const satisfies Partial<Record<ProfileField, string>>;

function Origin({ locale, origin }: { locale: InterfaceLocale; origin: ProfileOrigin }) {
  return (
    <span className="profile-origin">
      {message(locale, `profile.origin.${origin.kind}`)}
      {origin.kind === "described_material" && (
        <>
          {" · "}
          <bdi lang="">{origin.description}</bdi>
        </>
      )}
    </span>
  );
}

function StateMark({ locale, state }: { locale: InterfaceLocale; state: FieldState }) {
  return (
    <span className="profile-state" data-state={state}>
      {state === "pending" && <LucideGlyph name="circle-dashed" size={16} />}
      {message(locale, `profile.state.${state}`)}
    </span>
  );
}

function SavedValue({
  locale,
  field,
  fact,
  today,
}: {
  locale: InterfaceLocale;
  field: ProfileField;
  fact: SavedFact | undefined;
  today: string;
}) {
  if (fact?.state !== "known")
    return <StateMark locale={locale} state={fact?.state ?? "pending"} />;
  const values = "items" in fact ? fact.items : [fact];
  if (!values.length)
    return <span className="profile-empty">{message(locale, "profile.emptyList")}</span>;
  const date = (value: string) =>
    formatDate(locale, new Date(`${value}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  return (
    <ul className="profile-values" role="list">
      {values.map(({ value, origin }, index) => (
        <li key={index} data-done={typeof value === "object" && value.done ? "true" : undefined}>
          <span className="profile-value">
            {typeof value === "object" ? (
              <>
                <bdi lang="">{value.title}</bdi>
                {value.date && <> · {date(value.date)}</>}
              </>
            ) : typeof value === "number" ? (
              formatNumber(locale, value)
            ) : field === "deadline" ? (
              date(value)
            ) : (
              <bdi lang="">{value}</bdi>
            )}
          </span>
          {typeof value === "object" && value.done && (
            <span className="profile-state" data-state="done">
              {message(locale, "profile.milestoneDone")}
            </span>
          )}
          {typeof value === "object" && !value.done && value.date && value.date < today && (
            <span className="profile-state" data-state="late">
              {message(locale, "profile.datePassed")}
            </span>
          )}
          <Origin locale={locale} origin={origin} />
        </li>
      ))}
    </ul>
  );
}

function ValueEditor({
  id,
  field,
  label,
  value,
  locale,
  invalid,
  onChange,
  onRemove,
}: {
  id: string;
  field: ProfileField;
  label: string;
  value: DraftValue;
  locale: InterfaceLocale;
  invalid: string | undefined;
  onChange: (next: DraftValue) => void;
  onRemove?: (() => void) | undefined;
}) {
  const kind = profileFieldTypes[field];
  const validation = invalid ? { "aria-invalid": true, "aria-describedby": invalid } : {};
  const writableOrigin =
    value.origin.kind === "researcher_statement" || value.origin.kind === "described_material";
  function edit(patch: Partial<Pick<DraftValue, "text" | "date" | "done">>) {
    onChange({ ...value, ...patch, origin: writableOrigin ? value.origin : researcherOrigin });
  }
  return (
    <div className="profile-input-row" role="group" aria-labelledby={`${id}-label`}>
      <label htmlFor={id} id={`${id}-label`}>
        {label}
      </label>
      {kind === "date" || kind === "minutes" ? (
        <input
          {...validation}
          id={id}
          type={kind === "date" ? "date" : "text"}
          {...(kind === "minutes" ? { inputMode: "numeric" as const } : {})}
          value={value.text}
          onChange={(event) => {
            edit({ text: event.currentTarget.value });
          }}
        />
      ) : (
        <textarea
          {...validation}
          id={id}
          rows={2}
          dir="auto"
          lang=""
          value={value.text}
          onChange={(event) => {
            edit({ text: event.currentTarget.value });
          }}
        />
      )}
      {kind === "milestones" && (
        <div className="profile-milestone-controls">
          <label>
            {message(locale, "profile.milestoneDate")}
            <input
              {...validation}
              type="date"
              value={value.date}
              onChange={(event) => {
                edit({ date: event.currentTarget.value });
              }}
            />
          </label>
          <label className="profile-done">
            <input
              type="checkbox"
              checked={value.done}
              onChange={(event) => {
                edit({ done: event.currentTarget.checked });
              }}
            />
            {message(locale, "profile.milestoneDone")}
          </label>
        </div>
      )}
      {writableOrigin ? (
        <Selector
          id={`${id}-source`}
          label={message(locale, "profile.source")}
          value={value.origin.kind}
          options={originKinds.map((kind) => ({
            value: kind,
            label: message(locale, `profile.origin.${kind}`),
          }))}
          onChange={(kind) => {
            onChange({
              ...value,
              origin: kind === "described_material" ? { kind, description: "" } : researcherOrigin,
            });
          }}
        />
      ) : (
        <Origin locale={locale} origin={value.origin} />
      )}
      {value.origin.kind === "described_material" && (
        <label>
          {message(locale, "profile.materialDescription")}
          <textarea
            {...validation}
            rows={2}
            dir="auto"
            lang=""
            value={value.origin.description}
            onChange={(event) => {
              onChange({
                ...value,
                origin: { kind: "described_material", description: event.currentTarget.value },
              });
            }}
          />
        </label>
      )}
      {onRemove && (
        <button
          type="button"
          className="primitive-button primitive-quiet"
          aria-label={message(locale, "profile.removeNamed", { label })}
          onClick={onRemove}
        >
          {message(locale, "profile.removeItem")}
        </button>
      )}
    </div>
  );
}

function FieldEditor({
  field,
  fact,
  pending,
  locale,
  invalid,
  onEdit,
}: {
  field: ProfileField;
  fact: SavedFact | undefined;
  pending: FieldDraft | undefined;
  locale: InterfaceLocale;
  invalid: boolean;
  onEdit: (draft: FieldDraft | undefined) => void;
}) {
  const id = useId();
  const focusNext = useRef<string | undefined>(undefined);
  const root = useRef<HTMLFieldSetElement>(null);
  useLayoutEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = undefined;
    root.current?.querySelector<HTMLElement>(`[id="${id}-${next}"]`)?.focus();
  });
  const draft = pending ?? editFact(fact);
  const label = message(locale, `profile.field.${field}`);
  const kind = profileFieldTypes[field];
  const list = kind === "list" || kind === "milestones";
  // A saved answer can change state but cannot return to unanswered.
  const states: readonly FieldState[] =
    fact === undefined ? [...factStates, "pending"] : factStates;
  const hint = field in help ? help[field as keyof typeof help] : undefined;
  const describedBy = [hint && `${id}-help`, invalid && `${id}-error`].filter(Boolean).join(" ");
  return (
    <fieldset
      ref={root}
      className="profile-edit-field"
      data-profile-field={field}
      aria-describedby={describedBy || undefined}
    >
      <legend>{label}</legend>
      {hint && (
        <p id={`${id}-help`} className="profile-help">
          {message(locale, hint)}
        </p>
      )}
      {pending && (
        // Pending input stays beside the saved value, including a newer revision after a conflict.
        <div className="profile-saved-compare">
          <span className="profile-saved-label">{message(locale, "profile.savedValue")}</span>
          <SavedValue locale={locale} field={field} fact={fact} today={localDate()} />
        </div>
      )}
      <div className="profile-states">
        {states.map((state) => (
          <label key={state}>
            <input
              type="radio"
              name={`${id}-state`}
              value={state}
              checked={draft.state === state}
              onChange={() => {
                onEdit(
                  state === "pending"
                    ? undefined
                    : {
                        state,
                        values:
                          state === "known" && !list && draft.values.length === 0
                            ? [newDraftValue()]
                            : draft.values,
                      },
                );
              }}
            />
            {message(locale, `profile.state.${state}`)}
          </label>
        ))}
      </div>
      {draft.state === "known" &&
        draft.values.map((value, index) => (
          <ValueEditor
            key={value.id}
            id={`${id}-${value.id}`}
            field={field}
            value={value}
            locale={locale}
            invalid={
              invalid && !validatedDraftFact(field, { ...draft, values: [value] })
                ? `${id}-error`
                : undefined
            }
            label={
              list ? message(locale, "profile.itemLabel", { label, number: index + 1 }) : label
            }
            onChange={(next) => {
              onEdit({
                ...draft,
                values: draft.values.map((row) => (row.id === value.id ? next : row)),
              });
            }}
            onRemove={
              list
                ? () => {
                    root.current?.querySelector<HTMLElement>("input[type=radio]:checked")?.focus();
                    onEdit({ ...draft, values: draft.values.filter((row) => row.id !== value.id) });
                  }
                : undefined
            }
          />
        ))}
      {draft.state === "known" && list && (
        <button
          type="button"
          className="primitive-button primitive-secondary"
          disabled={draft.values.length >= profileListLimit}
          onClick={() => {
            const next = crypto.randomUUID();
            focusNext.current = next;
            onEdit({ ...draft, values: [...draft.values, newDraftValue(next)] });
          }}
        >
          {message(locale, kind === "milestones" ? "profile.addMilestone" : "profile.addItem")}
        </button>
      )}
      {invalid && (
        <p id={`${id}-error`} className="primitive-error">
          {message(locale, "profile.invalidField")}
        </p>
      )}
    </fieldset>
  );
}

export interface ProfileSectionTarget {
  readonly section: ProfileSection;
}

export function ThesisProfileView({
  controller,
  lease,
  subscriptionId,
  unavailable,
  retryConnection,
  locale,
  language,
  title,
  subtitle,
  rename,
  target,
}: {
  readonly controller: ThesisProfileController;
  readonly lease: ProjectSelectionLease;
  readonly subscriptionId: string | undefined;
  readonly unavailable: boolean;
  readonly retryConnection: () => void;
  readonly locale: InterfaceLocale;
  readonly language: string;
  readonly title: string;
  readonly subtitle: string | null;
  /** Opens the project rename form, optionally at the subtitle; absent while rename is unavailable. */
  readonly rename: ((focus?: "subtitle") => void) | undefined;
  readonly target: ProfileSectionTarget | undefined;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const root = useRef<HTMLElement>(null);
  const id = useId();
  const handledTarget = useRef<ProfileSectionTarget | undefined>(undefined);
  const focusAfter = useRef<{ readonly section: ProfileSection; readonly edit: boolean }>(
    undefined,
  );
  const loaded = state.saved !== undefined;
  const editing = state.editing;

  useLayoutEffect(() => {
    if (!target || handledTarget.current === target || !lease.isCurrent() || !loaded) return;
    const heading = root.current?.querySelector<HTMLElement>(
      `[data-profile-section="${target.section}"] h3`,
    );
    if (!heading || heading.closest("[hidden], [inert]")) return;
    heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
    handledTarget.current = target;
  }, [lease, loaded, target]);

  const previousEditing = useRef(editing);
  useLayoutEffect(() => {
    const previous = previousEditing.current;
    previousEditing.current = editing;
    const request = focusAfter.current;
    focusAfter.current = undefined;
    const section = (name: ProfileSection | undefined) =>
      root.current?.querySelector(`[data-profile-section="${name ?? ""}"]`);
    if (request?.edit && editing === request.section)
      // Opening an editor moves focus to its first answer.
      (
        section(editing)?.querySelector<HTMLElement>("input:checked") ??
        section(editing)?.querySelector<HTMLElement>("input, textarea")
      )?.focus();
    else if (previous && !editing) {
      // A save or discard closes the editor: return to its section's Edit action when focus was
      // inside the editor or has been lost with it.
      const active = document.activeElement;
      if (!active || active === document.body || section(previous)?.contains(active) || request)
        section(previous)?.querySelector<HTMLElement>("[data-profile-edit]")?.focus();
    }
  }, [editing]);

  useLayoutEffect(() => {
    const field = state.invalid[0];
    if (state.notice !== "invalid" || !field) return;
    const editor = root.current?.querySelector(`[data-profile-field="${field}"]`);
    if (!editor || editor.closest("[hidden], [inert]") || document.querySelector("dialog[open]"))
      return;
    (
      editor.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      editor.querySelector<HTMLElement>("input, textarea")
    )?.focus();
  }, [state.invalid, state.notice]);

  const fields = state.saved?.fields;
  const tally = { known: 0, pending: 0, unknown: 0, inapplicable: 0 };
  for (const field of profileFields) tally[fields?.[field]?.state ?? "pending"]++;
  const edits = Object.keys(state.draft).length;
  const locked = state.busy || !!state.intent;
  const today = localDate();
  let languageName = language;
  try {
    languageName = new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? language;
  } catch {
    // Some stored language tags have no representation in the runtime's display names.
  }

  return (
    <article className="thesis-profile" ref={root} aria-labelledby={`${id}-title`}>
      <header className="profile-header">
        <p className="profile-eyebrow">{message(locale, "profile.title")}</p>
        <h2 id={`${id}-title`} className="profile-thesis-title">
          <bdi lang={language}>{title}</bdi>
        </h2>
        <p className="profile-subtitle">
          {subtitle ? (
            <bdi lang={language} className="profile-subtitle-text">
              {subtitle}
            </bdi>
          ) : (
            <span className="profile-subtitle-empty">{message(locale, "profile.noSubtitle")}</span>
          )}
          {rename && !subtitle && (
            <button
              type="button"
              className="primitive-button primitive-quiet profile-link"
              onClick={() => {
                rename("subtitle");
              }}
            >
              {message(locale, "profile.addSubtitle")}
            </button>
          )}
          {rename && (
            <button
              type="button"
              className="primitive-button primitive-quiet profile-link"
              onClick={() => {
                rename();
              }}
            >
              {message(locale, "profile.changeTitle")}
            </button>
          )}
        </p>
        {loaded && (
          <>
            <p className="profile-meta">
              {state.saved
                ? message(locale, "profile.savedVersion", { number: state.saved.revision.revision })
                : message(locale, "profile.unset")}
            </p>
            <ul className="profile-tally" role="list">
              {(["known", "pending", "unknown", "inapplicable"] as const).map((key) => (
                <li key={key}>{message(locale, `profile.tally.${key}`, { count: tally[key] })}</li>
              ))}
            </ul>
          </>
        )}
      </header>
      {(!subscriptionId || state.reading) && !unavailable && !loaded && (
        <p role="status">{message(locale, "profile.loading")}</p>
      )}
      {(unavailable || state.readFailed) && (
        <div className="profile-actions">
          <p role="alert">
            {message(locale, unavailable ? "profile.unavailable" : "profile.readFailed")}
          </p>
          <button
            type="button"
            className="primitive-button"
            onClick={() => {
              if (unavailable) retryConnection();
              else void controller.load(state.conflict);
            }}
          >
            {message(locale, "taskNotice.tryAgain")}
          </button>
        </div>
      )}
      <div className="profile-notice">
        <p role="status" aria-atomic="true">
          {state.notice ? message(locale, notices[state.notice]) : ""}
        </p>
        {loaded && state.notice === "refreshFailed" && (
          <button
            type="button"
            className="primitive-button"
            disabled={!subscriptionId || state.reading}
            onClick={() => {
              void controller.refreshSaved();
            }}
          >
            {message(locale, "taskNotice.tryAgain")}
          </button>
        )}
      </div>
      {loaded &&
        profileSectionIds.map((section) => {
          const open = editing === section;
          const name = message(locale, `profile.section.${section}`);
          const hint = section in hints ? hints[section as keyof typeof hints] : undefined;
          return (
            <section
              key={section}
              className="profile-section"
              data-profile-section={section}
              aria-labelledby={`${id}-${section}`}
            >
              <div className="profile-section-head">
                <h3 id={`${id}-${section}`} tabIndex={-1}>
                  {name}
                </h3>
                {hint && <p className="profile-hint">{message(locale, hint)}</p>}
                {!open && (
                  <button
                    type="button"
                    className="primitive-button profile-edit-action"
                    data-profile-edit
                    disabled={locked || (!!editing && edits > 0)}
                    aria-label={message(locale, "profile.editSection", { section: name })}
                    onClick={() => {
                      if (controller.beginSection(section))
                        focusAfter.current = { section, edit: true };
                    }}
                  >
                    <LucideGlyph name="pencil" size={16} />
                    {message(locale, "profile.edit")}
                  </button>
                )}
              </div>
              {open ? (
                <div className="profile-editor">
                  {section === "requirements" && (
                    <p className="profile-readonly">
                      <strong>{message(locale, "profile.documentLanguage")}</strong>
                      {` · ${languageName} · `}
                      {message(locale, "profile.documentLanguageNote")}
                    </p>
                  )}
                  <fieldset className="profile-editor-fields" disabled={locked}>
                    <legend className="primitive-announcement">{name}</legend>
                    {profileSections[section].map((field) => (
                      <FieldEditor
                        key={field}
                        field={field}
                        fact={fields?.[field]}
                        pending={state.draft[field]}
                        locale={locale}
                        invalid={state.invalid.includes(field)}
                        onEdit={(edit) => {
                          controller.edit(field, edit);
                        }}
                      />
                    ))}
                  </fieldset>
                  <div className="profile-actions">
                    <button
                      type="button"
                      className="primitive-button primitive-primary"
                      aria-disabled={
                        !subscriptionId || locked || state.reading || state.conflict || !edits
                      }
                      onClick={() => {
                        void controller.save();
                      }}
                    >
                      {message(locale, state.busy ? "profile.saving" : "profile.save")}
                    </button>
                    <button
                      type="button"
                      className="primitive-button"
                      disabled={locked}
                      onClick={() => {
                        focusAfter.current = { section, edit: false };
                        controller.discard();
                      }}
                    >
                      {message(locale, edits ? "profile.discard" : "profile.cancelEdit")}
                    </button>
                    {state.conflict && (
                      <button
                        type="button"
                        className="primitive-button"
                        disabled={state.reading || !subscriptionId}
                        onClick={() => {
                          void controller.load(true);
                        }}
                      >
                        {message(locale, "profile.compare")}
                      </button>
                    )}
                    {state.intent && (
                      <button
                        type="button"
                        className="primitive-button"
                        disabled={state.busy || !subscriptionId}
                        onClick={() => {
                          void controller.reconcile(true);
                        }}
                      >
                        {message(locale, "profile.checkSave")}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <dl className="profile-facts">
                  {profileSections[section].map((field) => (
                    <div key={field} className="profile-fact" data-profile-field={field}>
                      <dt>{message(locale, `profile.field.${field}`)}</dt>
                      <dd>
                        <SavedValue
                          locale={locale}
                          field={field}
                          fact={fields?.[field]}
                          today={today}
                        />
                      </dd>
                    </div>
                  ))}
                  {section === "requirements" && (
                    <div className="profile-fact">
                      <dt>{message(locale, "profile.documentLanguage")}</dt>
                      <dd>
                        <span className="profile-value">
                          {languageName} ({language})
                        </span>
                        <span className="profile-origin">
                          {message(locale, "profile.documentLanguageNote")}
                        </span>
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </section>
          );
        })}
    </article>
  );
}
