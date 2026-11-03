import { useLayoutEffect, useRef, useState } from "react";
import { designMetrics } from "./design-tokens.js";

/** Canonical compact geometry; decoration never communicates research confirmation. */
export function OhtiaGlasses({
  size = designMetrics["icon.size.large"],
}: {
  readonly size?: number;
}) {
  if (!Number.isFinite(size) || size <= 0 || size >= 96)
    throw new RangeError("Glasses size must be greater than zero and below 96 CSS pixels.");
  const compact = size <= 24;
  return (
    <svg
      className="ohtia-glasses"
      width={size}
      height={size}
      viewBox={compact ? "0 0 24 24" : "0 0 64 64"}
      aria-hidden="true"
      focusable="false"
    >
      {compact ? (
        <g fill="none" stroke="currentColor" strokeWidth="var(--icon-stroke)">
          <circle cx="7.125" cy="12" r="4.125" />
          <circle cx="16.875" cy="12" r="4.125" />
          <path d="M10.6875 11.0625 Q12 9.5625 13.3125 11.0625 M3.225 10.3125 L1.6875 7.6875 M20.775 10.3125 L22.3125 7.6875" />
          <g fill="currentColor" stroke="none">
            <circle cx="7.125" cy="12" r="1.575" />
            <circle cx="16.875" cy="12" r="1.575" />
          </g>
        </g>
      ) : (
        <g stroke="var(--voice-ohtia-content)">
          <g fill="var(--voice-ohtia-surface)" strokeWidth="4.5">
            <circle cx="19" cy="34" r="11" />
            <circle cx="45" cy="34" r="11" />
          </g>
          <path
            fill="none"
            strokeWidth="4"
            d="M28.5 31.5 Q32 27.5 35.5 31.5 M8.6 29.5 L4.5 22.5 M55.4 29.5 L59.5 22.5"
          />
          <g fill="var(--voice-ohtia-content)" stroke="none">
            <circle cx="19" cy="34" r="4.2" />
            <circle cx="45" cy="34" r="4.2" />
          </g>
        </g>
      )}
    </svg>
  );
}
export function OhtiaBrand({ heading = false }: { readonly heading?: boolean } = {}) {
  return (
    <span className="ohtia-brand" data-type={heading ? "type.ui.heading" : "type.ui.subheading"}>
      <OhtiaGlasses />
      <span>Ohtia</span>
    </span>
  );
}

/** The browser ratio includes interface zoom; observe both density and actual capped CSS width. */
export function StaticCharacterIllustration({
  size = 128,
  className = "about-character",
}: {
  readonly size?: 96 | 128;
  readonly className?: string;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [vector, setVector] = useState(false);
  useLayoutEffect(() => {
    const element = image.current;
    if (!element) return;
    let density: MediaQueryList;
    let live = true;
    const update = () => {
      if (live)
        setVector((element.getBoundingClientRect().width || size) * window.devicePixelRatio > 512);
    };
    const changed = () => {
      if (!live) return;
      density.removeEventListener("change", changed);
      bind();
      update();
    };
    const bind = () => {
      density = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
      density.addEventListener("change", changed);
    };
    bind();
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", changed);
    return () => {
      live = false;
      observer.disconnect();
      density.removeEventListener("change", changed);
      window.removeEventListener("resize", changed);
    };
  }, [size]);
  return (
    <img
      ref={image}
      className={className}
      src={`/branding/illustration.${vector ? "svg" : "png"}`}
      width={size}
      height={size}
      alt=""
    />
  );
}
