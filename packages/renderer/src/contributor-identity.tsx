import { message, type InterfaceLocale } from "@ohtia/contracts";
import { OhtiaGlasses } from "./branding.js";
import { LucideGlyph } from "./iconography.js";

export const contributorNames = {
  virgilio: "Virgilio",
  josefa: "Josefa",
  "jorge-luis": "Jorge Luis",
  erasmus: "Erasmus",
  boris: "Boris",
  maria: "María",
} as const;
export type ContributorId = keyof typeof contributorNames;
export type ContributorIdentity =
  | { readonly kind: "product" }
  | { readonly kind: "ai"; readonly contributor: ContributorId; readonly definitionVersion: string }
  | { readonly kind: "supervisor"; readonly author: string; readonly submittedVersion: string }
  | { readonly kind: "unknown" };

/** Canonical static role motifs. No provider readiness, execution or review meaning. */
export function ContributorSymbol({ contributor }: { readonly contributor: ContributorId }) {
  return (
    <svg
      className="contributor-symbol"
      data-contributor={contributor}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="var(--voice-ohtia-surface)"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {contributor === "virgilio" && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2.5" strokeWidth="2" />
          <path fill="none" strokeWidth="2" d="M7.5 16 Q7 10.5 12 12 Q17 13.5 16.5 8.5" />
          <circle fill="currentColor" stroke="none" cx="7.5" cy="16" r="1.6" />
          <circle cx="16.5" cy="8" r="1.8" strokeWidth="1.6" />
        </>
      )}
      {contributor === "josefa" && (
        <>
          <rect transform="rotate(-14 12 21)" x="3.5" y="5" width="13" height="13" rx="1.6" />
          <g transform="rotate(9 12 21)">
            <rect x="7.5" y="5.5" width="13" height="13" rx="1.6" />
            <path fill="none" d="M10.5 9.5 L17.5 9.5" strokeWidth="1.6" />
            <circle cx="14" cy="15.2" r="1.3" strokeWidth="1.4" />
          </g>
        </>
      )}
      {contributor === "jorge-luis" && (
        <>
          <rect fill="currentColor" stroke="none" x="15" y="3" width="3.6" height="6" rx=".8" />
          <path d="M2.5 7.5 Q7 5.5 12 7.5 L12 19 Q7 17 2.5 19 Z" />
          <path d="M12 7.5 Q17 5.5 21.5 7.5 L21.5 19 Q17 17 12 19 Z" />
          <path fill="none" strokeWidth="1.4" d="M5 11 Q7.3 10 9.6 11" />
        </>
      )}
      {contributor === "erasmus" && (
        <>
          <g transform="rotate(-5 6.5 12)">
            <rect x="2.5" y="4" width="8" height="16" rx="1.4" />
            <path fill="none" strokeWidth="1.3" d="M5 8.5 L8.5 8.5 M5 11.5 L8.5 11.5" />
          </g>
          <g transform="rotate(5 17.5 12)">
            <rect x="13.5" y="4" width="8" height="16" rx="1.4" />
            <path fill="none" strokeWidth="1.3" d="M15.5 8.5 L19 8.5 M15.5 11.5 L19 11.5" />
          </g>
        </>
      )}
      {contributor === "boris" && (
        <>
          <rect x="5" y="2.5" width="14" height="19" rx="1.6" />
          <g fill="currentColor" stroke="none">
            <rect x="8" y="6" width="8" height="3" rx=".8" />
            <rect x="8" y="10.75" width="8" height="3" rx=".8" />
            <rect x="8" y="15.5" width="5" height="2.5" rx=".8" />
          </g>
        </>
      )}
      {contributor === "maria" && (
        <>
          <rect x="2" y="6" width="13.5" height="12" rx="1.6" />
          <path
            fill="none"
            strokeWidth="1.3"
            d="M6.5 9.5 L12.5 9.5 M6.5 12.5 L12.5 12.5 M6.5 15 L10 15"
          />
          <path fill="none" strokeWidth="1.2" d="M5 8.8 L4.3 8.8 L4.3 13.2 L5 13.2" />
          <g transform="rotate(16 19 12)">
            <rect x="17.3" y="3" width="3.4" height="12.5" rx=".8" strokeWidth="1.5" />
            <path fill="currentColor" stroke="none" d="M17.3 15.5 L20.7 15.5 L19 19.5 Z" />
          </g>
        </>
      )}
    </svg>
  );
}
/** The identity belongs to the artifact, never the currently selected contributor. */
export function VoiceLabel({
  identity,
  locale,
}: {
  readonly identity: ContributorIdentity;
  readonly locale: InterfaceLocale;
}) {
  const origin =
    identity.kind === "supervisor"
      ? "human"
      : identity.kind === "unknown"
        ? "unknown"
        : identity.kind === "product"
          ? "system"
          : "ai";
  return (
    <span className="voice-label" lang={locale} data-origin={origin}>
      {identity.kind === "product" && (
        <>
          <OhtiaGlasses />
          <span>Ohtia</span>
        </>
      )}
      {identity.kind === "ai" && (
        <>
          <ContributorSymbol contributor={identity.contributor} />
          <span className="voice-label-text">
            <span>{contributorNames[identity.contributor]}</span>
            <span> · </span>
            {(identity.contributor === "boris" || identity.contributor === "maria") && (
              <>
                <span>{message(locale, "identity.writingReview")}</span>
                <span> · </span>
              </>
            )}
            <span>{message(locale, `identity.role.${identity.contributor}`)}</span>
            <span> · </span>
            <span>{message(locale, "identity.ai")}</span>
          </span>
        </>
      )}
      {identity.kind === "supervisor" && (
        <>
          <LucideGlyph name="user-round" />
          <span className="voice-label-text">
            <bdi lang="">{identity.author}</bdi>
            <span> · </span>
            <span>{message(locale, "identity.supervisor")}</span>
            <span> · </span>
            <span>{message(locale, "identity.human")}</span>
          </span>
        </>
      )}
      {identity.kind === "unknown" && (
        <>
          <LucideGlyph name="circle-question-mark" />
          <span>{message(locale, "identity.unknown")}</span>
        </>
      )}
    </span>
  );
}
export interface ContributorAttributionProps {
  readonly identity: ContributorIdentity;
  readonly locale: InterfaceLocale;
  readonly producer: string | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  /** Translated execution text, independently supplied by the operation owner. */
  readonly execution: string;
}
export function ContributorAttribution({
  identity,
  locale,
  producer,
  provider,
  model,
  execution,
}: ContributorAttributionProps) {
  return (
    <div lang={locale}>
      <VoiceLabel identity={identity} locale={locale} />
      <dl className="contributor-attribution">
        {identity.kind === "ai" && (
          <div>
            <dt>{message(locale, "identity.definition")}</dt>
            <dd lang="" dir="auto">
              {identity.definitionVersion}
            </dd>
          </div>
        )}
        {identity.kind === "supervisor" && (
          <div>
            <dt>{message(locale, "identity.submittedVersion")}</dt>
            <dd lang="" dir="auto">
              {identity.submittedVersion}
            </dd>
          </div>
        )}
        {(
          [
            ["producer", producer],
            ["provider", provider],
            ["model", model],
            ["execution", execution],
          ] as const
        ).map(([key, value]) => (
          <div key={key}>
            <dt>{message(locale, `identity.${key}`)}</dt>
            <dd lang={key === "execution" || !value ? locale : ""} dir="auto">
              {value || message(locale, "identity.unknown")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
