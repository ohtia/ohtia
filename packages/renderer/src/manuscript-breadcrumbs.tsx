import { useEffect, useId, useMemo, useRef, useState } from "react";
import { message, type InterfaceLocale } from "@ohtia/contracts";
import { useLayerPosition } from "./layers.js";
import {
  manuscriptBranches,
  manuscriptPath,
  manuscriptSubtree,
  type ManuscriptBranch,
  type ManuscriptOutline,
} from "./manuscript-outline.js";

interface Crumb {
  readonly id: string;
  readonly label: string;
  readonly choices: readonly ManuscriptBranch[];
}

export function ManuscriptBreadcrumbs({
  headings,
  current,
  locale,
  language,
  onChoose,
}: {
  readonly headings: ManuscriptOutline;
  readonly current: string | undefined;
  readonly locale: InterfaceLocale;
  readonly language: string | null;
  readonly onChoose: (headingId: string) => void;
}) {
  const branches = useMemo(() => manuscriptBranches(headings), [headings]);
  const path = current ? manuscriptPath(branches, current) : [];
  const crumbs: Crumb[] = [
    { id: "manuscript", label: message(locale, "manuscript.collection"), choices: branches },
    ...path.map(({ heading, siblings }) => ({
      id: heading.id,
      label: heading.text,
      choices: siblings,
    })),
  ];
  const [open, setOpen] = useState<string>();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !nav.current?.contains(event.target)) setOpen(undefined);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  if (!headings.length) return null;
  return (
    <nav
      ref={nav}
      className="manuscript-breadcrumbs"
      aria-label={message(locale, "manuscript.location")}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(undefined);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        const { key, target } = event;
        if (key !== "ArrowLeft" && key !== "ArrowRight") return;
        if (!(target instanceof HTMLElement)) return;
        if (target instanceof HTMLInputElement && target.value) return;
        const item = target.closest<HTMLLIElement>("[data-crumb]");
        const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
        const next =
          (key === "ArrowLeft") !== rtl ? item?.previousElementSibling : item?.nextElementSibling;
        if (!(next instanceof HTMLLIElement) || !next.dataset.crumb) return;
        event.preventDefault();
        next.querySelector<HTMLButtonElement>("button")?.focus();
        if (open) setOpen(next.dataset.crumb);
      }}
    >
      <ol>
        {crumbs.map((crumb, index) => (
          <BreadcrumbSegment
            key={crumb.id}
            crumb={crumb}
            open={open === crumb.id}
            last={index === crumbs.length - 1}
            locale={locale}
            language={index === 0 ? locale : language}
            headingLanguage={language}
            current={current}
            onOpen={() => {
              setOpen((previous) => (previous === crumb.id ? undefined : crumb.id));
            }}
            onDismiss={() => {
              setOpen(undefined);
            }}
            onChoose={(id) => {
              setOpen(undefined);
              onChoose(id);
            }}
          />
        ))}
      </ol>
    </nav>
  );
}

function BreadcrumbSegment({
  crumb,
  open,
  last,
  locale,
  language,
  headingLanguage,
  current,
  onOpen,
  onDismiss,
  onChoose,
}: {
  readonly crumb: Crumb;
  readonly open: boolean;
  readonly last: boolean;
  readonly locale: InterfaceLocale;
  readonly language: string | null;
  readonly headingLanguage: string | null;
  readonly current: string | undefined;
  readonly onOpen: () => void;
  readonly onDismiss: () => void;
  readonly onChoose: (headingId: string) => void;
}) {
  const id = useId();
  const anchor = useRef<HTMLLIElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  useLayerPosition(open, anchor, layer);
  return (
    <li ref={anchor} data-crumb={crumb.id}>
      <button
        ref={trigger}
        type="button"
        className="primitive-button primitive-quiet manuscript-crumb"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-current={last ? "location" : undefined}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <bdi lang={language ?? ""}>{crumb.label}</bdi>
      </button>
      {!last && <span aria-hidden="true">›</span>}
      {open && (
        <div
          ref={layer}
          id={id}
          role="dialog"
          aria-label={crumb.label}
          className="primitive-popover manuscript-crumb-picker"
        >
          <HeadingPicker
            id={id}
            headings={crumb.choices}
            locale={locale}
            language={headingLanguage}
            current={current}
            onChoose={onChoose}
            onDismiss={() => {
              onDismiss();
              trigger.current?.focus();
            }}
          />
        </div>
      )}
    </li>
  );
}

function HeadingPicker({
  id,
  headings,
  locale,
  language,
  current,
  onChoose,
  onDismiss,
}: {
  readonly id: string;
  readonly headings: readonly ManuscriptBranch[];
  readonly locale: InterfaceLocale;
  readonly language: string | null;
  readonly current: string | undefined;
  readonly onChoose: (headingId: string) => void;
  readonly onDismiss: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(current);
  const input = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLLIElement>(null);
  const label = message(locale, "manuscript.location");
  const searchable = (text: string) =>
    text.normalize("NFC").toLocaleLowerCase(locale).normalize("NFD").replace(/\p{M}/gu, "");
  const filter = searchable(query.trim());
  const choices = manuscriptSubtree(headings).filter(({ heading }) =>
    searchable(heading.text).includes(filter),
  );
  const index = Math.max(
    0,
    choices.findIndex(({ heading }) => heading.id === activeId),
  );
  const active = choices[index]?.heading.id;
  const optionId = (key: string) => `${id}-heading-${key}`;
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const option = activeOption.current;
    if (option && typeof option.scrollIntoView === "function")
      option.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <>
      <input
        ref={input}
        type="text"
        role="combobox"
        className="primitive-input"
        aria-label={label}
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls={`${id}-choices`}
        aria-activedescendant={active ? optionId(active) : undefined}
        placeholder={label}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setActiveId(undefined);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDismiss();
          } else if (event.key === "Enter" && active) {
            event.preventDefault();
            onChoose(active);
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setActiveId(choices[(index + delta + choices.length) % choices.length]?.heading.id);
          }
        }}
      />
      <ul
        id={`${id}-choices`}
        role="listbox"
        aria-label={label}
        className="manuscript-crumb-choices"
      >
        {choices.map(({ heading, depth }) => (
          <li
            key={heading.id}
            ref={heading.id === active ? activeOption : undefined}
            id={optionId(heading.id)}
            role="option"
            aria-selected={heading.id === active}
            onPointerDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              onChoose(heading.id);
            }}
          >
            <span aria-hidden="true">{" ".repeat(depth * 3)}</span>
            <bdi lang={language ?? ""}>{heading.text}</bdi>
          </li>
        ))}
      </ul>
    </>
  );
}
