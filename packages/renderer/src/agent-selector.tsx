import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  conversationAgents,
  isReplyAgent,
  message,
  type ConversationAgent,
  type InterfaceLocale,
  type ReplyAgent,
} from "@ohtia/contracts";
import type { ComposerController } from "./composer-controller.js";
import { ContributorSymbol, contributorNames, VoiceLabel } from "./contributor-identity.js";
import { LucideGlyph } from "./iconography.js";
import "./agent-selector.css";

export function AgentBand({
  composer,
  agent,
  selectable,
  locale,
}: {
  readonly composer: ComposerController;
  readonly agent: ReplyAgent | undefined;
  readonly selectable: boolean;
  readonly locale: InterfaceLocale;
}) {
  const { agentId, saving, notice } = useSyncExternalStore(composer.subscribe, composer.snapshot);
  if (!selectable && !agent) return null;
  return (
    <div className="agent-band">
      {selectable ? (
        <AgentSelector
          value={agentId}
          disabled={saving || notice === "uncertain"}
          description={notice === "uncertain" ? message(locale, "composer.uncertain") : undefined}
          choose={composer.selectAgent}
          locale={locale}
        />
      ) : agent ? (
        <VoiceLabel
          identity={{ kind: "ai", contributor: agent, definitionVersion: "1" }}
          locale={locale}
        />
      ) : null}
    </div>
  );
}

function AgentSelector({
  value,
  disabled,
  description,
  choose,
  locale,
}: {
  readonly value: ReplyAgent;
  readonly disabled: boolean;
  readonly description: string | undefined;
  readonly choose: (agent: ReplyAgent) => void;
  readonly locale: InterfaceLocale;
}) {
  const id = useId();
  const labelId = id + "-label";
  const listId = id + "-list";
  const optionId = (agent: ConversationAgent) => id + "-" + agent;
  const [active, setActive] = useState<number | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const query = useRef({ text: "", at: 0 });
  const selected = conversationAgents.indexOf(value);
  const current = active === null ? undefined : conversationAgents[active];
  const open = active !== null && !disabled;
  const last = conversationAgents.length - 1;
  const unavailable = message(locale, "agentSelector.unavailable");

  const close = () => {
    setActive(null);
    query.current = { text: "", at: 0 };
  };
  const commit = (agent: ConversationAgent | undefined) => {
    if (!isReplyAgent(agent)) return;
    close();
    choose(agent);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const band = button.current?.closest(".agent-band");
    if (!band) return;
    const place = () => {
      const rect = band.getBoundingClientRect();
      if (!rect.width) {
        setActive(null);
        return;
      }
      setPosition({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(band);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !current) return;
    document.getElementById(optionId(current))?.scrollIntoView?.({ block: "nearest" });
  }, [current, id, open]);

  const option = (agent: ConversationAgent, index: number) => {
    const disabled = !isReplyAgent(agent);
    return (
      <div
        className="agent-option"
        id={optionId(agent)}
        key={agent}
        role="option"
        aria-selected={active === index}
        aria-disabled={disabled || undefined}
        onClick={() => commit(agent)}
      >
        <ContributorSymbol contributor={agent} size={20} />
        <span className="agent-option-lines">
          <span>{contributorNames[agent]}</span>
          <span>{message(locale, `identity.role.${agent}`)}</span>
          {disabled && <span>{unavailable}</span>}
        </span>
        {value === agent && <LucideGlyph name="check" size={16} />}
      </div>
    );
  };
  return (
    <>
      <span className="agent-band-label" id={labelId}>
        {message(locale, "agentSelector.label")}
      </span>
      <button
        type="button"
        ref={button}
        className="agent-select-button"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && current ? optionId(current) : undefined}
        aria-disabled={disabled || undefined}
        aria-description={description}
        onClick={() => {
          if (disabled) return;
          if (open) close();
          else setActive(selected);
        }}
        onBlur={() => {
          if (open) {
            commit(current);
            close();
          }
        }}
        onKeyDown={(event) => {
          if (disabled || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return;
          const { key, altKey } = event;
          const now = performance.now();
          const previous = now - query.current.at < 700 ? query.current.text : "";
          if (altKey && key !== "ArrowDown" && key !== "ArrowUp") return;
          if (key === "Tab") {
            if (open) {
              commit(current);
              close();
            }
            return;
          }
          if (key === "Escape" && !open) return;
          if (key.length === 1 && (key !== " " || (open && previous))) {
            event.preventDefault();
            const text = previous + key.toLocaleLowerCase(locale);
            query.current = { text, at: now };
            const repeated = Array.from(text).every((letter) => letter === text[0]);
            const prefix = repeated ? key.toLocaleLowerCase(locale) : text;
            const start = (active ?? selected) + (previous && !repeated ? 0 : 1);
            const agents = [
              ...conversationAgents.slice(start),
              ...conversationAgents.slice(0, start),
            ];
            const match = agents.find((agent) =>
              contributorNames[agent].toLocaleLowerCase(locale).startsWith(prefix),
            );
            setActive(match ? conversationAgents.indexOf(match) : (active ?? selected));
            return;
          }
          if (
            ![
              "ArrowDown",
              "ArrowUp",
              "Home",
              "End",
              "PageUp",
              "PageDown",
              "Enter",
              " ",
              "Escape",
            ].includes(key)
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          query.current = { text: "", at: 0 };
          if (key === "Escape") close();
          else if (key === "Home") setActive(0);
          else if (key === "End") setActive(last);
          else if (!open) setActive(key === "ArrowUp" && !altKey ? 0 : selected);
          else if (altKey && key === "ArrowUp") {
            commit(current);
            close();
          } else if (key === "Enter" || key === " ") commit(current);
          else if (!altKey && active !== null) {
            const offset =
              key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : key === "PageDown" ? 10 : -10;
            setActive(Math.max(0, Math.min(last, active + offset)));
          }
        }}
      >
        <ContributorSymbol contributor={value} size={20} />
        <span>
          {contributorNames[value]} · {message(locale, `identity.role.${value}`)} ·{" "}
          {message(locale, "identity.ai")}
        </span>
        <LucideGlyph name="arrow-down" size={16} />
      </button>
      {open &&
        createPortal(
          <div
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            className="agent-listbox"
            onMouseDown={(event) => event.preventDefault()}
            style={{
              top: position.top,
              left: position.left,
              inlineSize: "calc(" + String(position.width) + "px - 2 * var(--space-4))",
              maxBlockSize: "calc(100dvh - " + String(position.top) + "px - var(--space-2))",
            }}
            lang={locale}
          >
            {conversationAgents.slice(0, 4).map(option)}
            <div role="group" aria-labelledby={id + "-writing"}>
              <div id={id + "-writing"} className="agent-group-heading">
                {message(locale, "identity.writingReview")}
              </div>
              {conversationAgents.slice(4).map((agent, index) => option(agent, index + 4))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
