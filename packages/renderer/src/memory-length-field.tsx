import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  defaultEntryTextLength,
  defaultSourceQuoteLength,
  formatNumber,
  isMemoryDisplayLength,
  message,
  type InterfaceLocale,
  type PresentationRecord,
} from "@ohtia/contracts";
import { LucideGlyph as Icon } from "./iconography.js";
import { type MemoryLengthSetting, type SettingState } from "./settings-controller.js";

export function MemoryLengthField({
  feature,
  locale,
  setting,
  record,
  blocked,
  disabled,
  onChoose,
  status,
}: {
  readonly feature: MemoryLengthSetting;
  readonly locale: InterfaceLocale;
  readonly setting: SettingState;
  readonly record: PresentationRecord<number> | undefined;
  readonly blocked: boolean;
  readonly disabled: boolean;
  readonly onChoose: (value: number) => void;
  readonly status: (visible: boolean) => ReactNode;
}) {
  const id = useId();
  const fallback = feature === "sourceQuote" ? defaultSourceQuoteLength : defaultEntryTextLength;
  const { value: saved = fallback, revision, source } = record ?? {};
  const shown =
    setting.phase === "submitting" || setting.phase === "uncertain" ? setting.draft : saved;
  const [draft, setDraft] = useState(String(shown));
  const [invalid, setInvalid] = useState(false);
  const composing = useRef(false);
  const edited = useRef(false);
  useEffect(() => {
    edited.current = false;
    setDraft(String(shown));
    setInvalid(false);
  }, [shown, revision, source, setting.phase]);

  function commit(text: string) {
    if (blocked || composing.current) return;
    const value = /^\d+$/.test(text) ? Number(text) : NaN;
    if (!isMemoryDisplayLength(value)) {
      setInvalid(true);
      return;
    }
    edited.current = false;
    setInvalid(false);
    setDraft(String(value));
    if (value !== saved || source === "invalid_fallback") onChoose(value);
  }

  return (
    <>
      <div className="settings-group-heading">
        <label htmlFor={id}>{message(locale, `memory.${feature}Length`)}</label>
        {status(!invalid && draft === String(shown))}
      </div>
      <input
        id={id}
        className="settings-number-input"
        type="number"
        min={0}
        max={Number.MAX_SAFE_INTEGER}
        step={1}
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        readOnly={blocked}
        aria-disabled={blocked}
        aria-invalid={invalid}
        aria-describedby={`${id}-help${invalid ? ` ${id}-invalid` : ""}`}
        onChange={(event) => {
          edited.current = true;
          setDraft(event.currentTarget.value);
          setInvalid(false);
        }}
        onBlur={(event) => {
          if (edited.current) commit(event.currentTarget.value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const value = event.currentTarget.value;
          if (value !== draft) edited.current = true;
          setDraft(value);
          if (edited.current && document.activeElement !== event.currentTarget) commit(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && !composing.current) {
            event.preventDefault();
            commit(event.currentTarget.value);
          }
        }}
      />
      <p id={`${id}-help`}>{message(locale, `memory.${feature}Help`)}</p>
      {invalid && (
        <p id={`${id}-invalid`} className="language-attention" role="alert">
          <Icon name="triangle-alert" />
          {message(locale, "memory.displayLengthInvalid", {
            max: formatNumber(locale, Number.MAX_SAFE_INTEGER),
          })}
        </p>
      )}
    </>
  );
}
