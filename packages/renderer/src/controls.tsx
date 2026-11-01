import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LucideGlyph } from "./iconography.js";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "destructive";
  disabledReason?: string;
  loadingLabel?: string;
}
export function Button({
  label,
  onPress,
  variant = "secondary",
  disabledReason,
  loadingLabel,
}: ButtonProps) {
  const id = useId();
  return (
    <span className="primitive-control">
      <button
        type="button"
        className={`primitive-button primitive-${variant}`}
        aria-disabled={!!disabledReason || !!loadingLabel}
        aria-busy={!!loadingLabel}
        aria-describedby={disabledReason || loadingLabel ? id : undefined}
        onClick={() => {
          if (!disabledReason && !loadingLabel) onPress();
        }}
      >
        {label}
      </button>
      {(disabledReason || loadingLabel) && <span id={id}>{disabledReason ?? loadingLabel}</span>}
      <span role="status" aria-atomic="true" className="primitive-announcement">
        {loadingLabel ?? ""}
      </span>
    </span>
  );
}
export function Link({
  href,
  children,
  externalLabel,
}: {
  href: string;
  children: ReactNode;
  externalLabel?: string;
}) {
  // Links never admit executable URLs supplied by a consumer.
  const safe = /^(https?:\/\/|mailto:|#)/i.test(href);
  return (
    <a className="primitive-link" href={safe ? href : undefined}>
      {children}
      {externalLabel && <> ({externalLabel})</>}
    </a>
  );
}
interface FieldDescription {
  id: string;
  label: string;
  help?: string;
  error?: string;
  disabledReason?: string;
}
function FieldNotes({ id, help, error, disabledReason }: FieldDescription) {
  return (
    <>
      {help && <span id={`${id}-help`}>{help}</span>}
      {disabledReason && <span id={`${id}-disabled`}>{disabledReason}</span>}
      {error && (
        <span id={`${id}-error`} className="primitive-error">
          <LucideGlyph name="triangle-alert" /> {error}
        </span>
      )}
    </>
  );
}
function descriptions({ id, help, error, disabledReason }: FieldDescription) {
  return (
    [help && `${id}-help`, error && `${id}-error`, disabledReason && `${id}-disabled`]
      .filter(Boolean)
      .join(" ") || undefined
  );
}
export interface TextFieldProps extends FieldDescription {
  value: string;
  onChange: (value: string) => void;
  onValidate: (value: string) => void;
}
export function TextField(props: TextFieldProps) {
  const composing = useRef(false);
  const deferred = useRef(false);
  return (
    <div className="primitive-field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        value={props.value}
        readOnly={!!props.disabledReason}
        aria-disabled={!!props.disabledReason}
        aria-invalid={!!props.error}
        aria-describedby={descriptions(props)}
        onChange={(event) => {
          if (!props.disabledReason) props.onChange(event.currentTarget.value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          if (deferred.current) {
            deferred.current = false;
            props.onValidate(event.currentTarget.value);
          }
        }}
        onBlur={(event) => {
          if (composing.current) deferred.current = true;
          else props.onValidate(event.currentTarget.value);
        }}
      />
      <FieldNotes {...props} />
    </div>
  );
}
export function Selector(
  props: FieldDescription & {
    value: string;
    options: readonly { value: string; label: string }[];
    onChange: (value: string) => void;
  },
) {
  return (
    <div className="primitive-field">
      <label htmlFor={props.id}>{props.label}</label>
      <select
        id={props.id}
        value={props.value}
        aria-invalid={!!props.error}
        aria-disabled={!!props.disabledReason}
        aria-describedby={descriptions(props)}
        onChange={(event) => {
          if (!props.disabledReason) props.onChange(event.currentTarget.value);
        }}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldNotes {...props} />
    </div>
  );
}
export function Choice(
  props: FieldDescription & {
    kind: "checkbox" | "radio" | "switch";
    checked: boolean;
    name?: string;
    onChange: (checked: boolean) => void;
  },
) {
  return (
    <div className="primitive-field">
      <label htmlFor={props.id}>
        <input
          id={props.id}
          type={props.kind === "radio" ? "radio" : "checkbox"}
          role={props.kind === "switch" ? "switch" : undefined}
          name={props.name}
          checked={props.checked}
          aria-disabled={!!props.disabledReason}
          aria-describedby={descriptions(props)}
          onChange={(event) => {
            if (!props.disabledReason) props.onChange(event.currentTarget.checked);
          }}
        />
        {props.label}
      </label>
      <FieldNotes {...props} />
    </div>
  );
}
export function ErrorSummary({
  title,
  errors,
  submission,
}: {
  title: string;
  errors: readonly { fieldId: string; message: string }[];
  submission: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (submission > 0 && errors.length) ref.current?.focus();
  }, [submission]);
  if (!errors.length) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" aria-label={title}>
      <p>{title}</p>
      <ul>
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              className="primitive-link"
              href={`#${error.fieldId}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(error.fieldId)?.focus();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Form({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) {
  const composing = useRef(false);
  return (
    <form
      noValidate
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing))
          event.preventDefault();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!composing.current) onSubmit();
      }}
    >
      {children}
    </form>
  );
}
/** The edit revision prevents an old acknowledgement clearing an A→B→A edit. */
export function useFieldDraft(initial: string) {
  const [value, setValue] = useState(initial);
  const current = useRef({ value: initial, revision: 0 });
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return {
    value,
    edit(next: string) {
      current.current = { value: next, revision: current.current.revision + 1 };
      setValue(next);
    },
    capture() {
      return { ...current.current };
    },
    acknowledge(sent: { value: string; revision: number }) {
      if (
        !active.current ||
        sent.revision !== current.current.revision ||
        sent.value !== current.current.value
      )
        return false;
      current.current = { value: "", revision: current.current.revision + 1 };
      setValue("");
      return true;
    },
  };
}
