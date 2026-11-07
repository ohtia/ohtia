import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CharacterPresentation } from "@ohtia/contracts";
import { OhtiaGlasses, StaticCharacterIllustration } from "./branding.js";
import {
  CharacterController,
  effectiveCharacterMode,
  characterDurations,
  type CharacterPose,
} from "./character-controller.js";
import {
  observeSystemMotion,
  systemReducesMotion,
  useSystemMotionSource,
} from "./system-motion.js";

/** OS override is observed for the whole mounted consumer lifetime, including closed dialogs. */
export function useCharacterMode(
  confirmed: CharacterPresentation,
  controller?: CharacterController,
): CharacterPresentation {
  const source = useSystemMotionSource();
  const [reduced, setReduced] = useState(() => systemReducesMotion(source));
  useLayoutEffect(() => {
    const changed = (value: boolean) => {
      controller?.setMode(effectiveCharacterMode(confirmed, value));
      setReduced(value);
    };
    changed(systemReducesMotion(source));
    return observeSystemMotion(source, changed);
  }, [confirmed, controller, source]);
  return effectiveCharacterMode(confirmed, reduced);
}

/** Canonical pieces in back-to-front order; only the three delivered specimen poses are admitted. */
export function CharacterDrawing({
  pose,
  size = 128,
  moving = false,
}: {
  readonly pose?: CharacterPose | undefined;
  readonly size?: number;
  readonly moving?: boolean;
}) {
  if (!Number.isFinite(size) || size < 96)
    throw new RangeError("Character size must be at least 96 CSS pixels.");
  return (
    <svg
      className="character-drawing"
      data-pose={pose ?? "neutral"}
      data-moving={moving}
      width={size}
      height={size}
      viewBox="-16 0 152 152"
      aria-hidden="true"
      focusable="false"
      fill="var(--voice-ohtia-surface)"
      stroke="var(--voice-ohtia-content)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g
        className="character-body"
        transform={pose === "milestone" && moving ? "translate(0 -10) scale(1.06)" : undefined}
      >
        <g className="character-coat">
          <rect x="53" y="88" width="14" height="18" />
          <path d="M24 152 L30 116 Q60 100 90 116 L96 152 Z" />
          <path
            fill="none"
            strokeWidth="2.5"
            className="character-detail"
            d="M48 107 L60 128 L72 107 M60 128 L60 152"
          />
          <rect
            fill="none"
            strokeWidth="2.5"
            className="character-detail"
            x="74"
            y="128"
            width="12"
            height="9"
            rx="1.5"
          />
        </g>
        <g
          className="character-head"
          transform={
            pose === "thinking"
              ? "rotate(7 60 72)"
              : pose === "disagreement"
                ? "rotate(-6 60 72)"
                : undefined
          }
        >
          <g className="character-hair" fill="var(--voice-ohtia-content)" strokeWidth="2">
            <path d="M33.2 77.5 Q15 75.5 29.1 63.8 Q11.7 53.5 31.5 49.7 Q19.1 31.5 40.1 38.3 Q38.9 20 52.9 31.8 Q60 13 67.1 31.8 Q82.9 16.4 79.9 38.3 Q97.7 33.9 88.5 49.7 Q108.3 53.5 90.9 63.8 Q108.9 76.6 86.8 77.5 Z" />
            <path
              fill="none"
              strokeWidth="3.5"
              className="character-strands"
              d="M31 50 Q22 66 28 80 Q33 90 27 98 M89 50 Q98 66 92 80 Q87 90 93 98"
            />
          </g>
          <g className="character-bun" fill="var(--voice-ohtia-content)" strokeWidth="1.5">
            <circle cx="60" cy="17" r="12" />
            <path
              fill="none"
              stroke="var(--voice-ohtia-surface)"
              strokeWidth="2"
              className="character-highlight"
              d="M52.5 14 Q55 8.5 61.5 8.5"
            />
          </g>
          <g className="character-pencil" fill="none" strokeWidth="3.5">
            <path d="M46 24 L76 6" />
            <path
              fill="none"
              stroke="var(--voice-ohtia-surface)"
              strokeWidth="1.5"
              className="character-highlight"
              d="M69.5 7.6 L71.5 11"
            />
          </g>
          <circle cx="60" cy="66" r="30" />
          <path
            fill="none"
            strokeWidth="3.5"
            transform={
              pose === "disagreement" || pose === "milestone" ? "translate(0 -4)" : undefined
            }
            className="character-brow character-brow-left"
            d="M38 45 Q47 40 56 44"
          />
          <path
            fill="none"
            strokeWidth="3.5"
            transform={
              pose === "thinking"
                ? "translate(0 -4) rotate(-6 73 43)"
                : pose === "disagreement"
                  ? "translate(0 2) rotate(6 73 43)"
                  : pose === "milestone"
                    ? "translate(0 -4)"
                    : undefined
            }
            className="character-brow character-brow-right"
            d="M64 44 Q73 40 82 45"
          />
          {pose === "milestone" ? (
            <ellipse fill="none" className="character-mouth" cx="60" cy="86" rx="3.5" ry="4.5" />
          ) : (
            <path
              fill="none"
              className="character-mouth"
              d={pose ? "M53 86 L67 86" : "M51 84 Q60 91 69 84"}
            />
          )}
          <g transform="translate(28 30)" strokeWidth="4" className="character-glasses">
            <path
              fill="none"
              d="M8.6 29.5 L4.5 22.5 M55.4 29.5 L59.5 22.5 M28.5 31.5 Q32 27.5 35.5 31.5"
            />
            <circle strokeWidth="4.5" cx="19" cy="34" r="11" />
            <circle strokeWidth="4.5" cx="45" cy="34" r="11" />
            <circle
              fill="var(--voice-ohtia-content)"
              stroke="none"
              transform={
                pose === "thinking"
                  ? "translate(2 -4)"
                  : pose === "disagreement"
                    ? "translate(-4 -1)"
                    : undefined
              }
              className="character-pupil character-pupil-left"
              cx="19"
              cy="34"
              r="4.2"
            />
            <circle
              fill="var(--voice-ohtia-content)"
              stroke="none"
              transform={
                pose === "thinking"
                  ? "translate(2 -4)"
                  : pose === "disagreement"
                    ? "translate(4 -1)"
                    : undefined
              }
              className="character-pupil character-pupil-right"
              cx="45"
              cy="34"
              r="4.2"
            />
          </g>
        </g>
      </g>
    </svg>
  );
}

/** Persistent branding/Settings preview, never an application-event animation. */
export function CharacterPreview({
  mode,
  manuscriptVisible = false,
  size = 128,
}: {
  readonly mode: CharacterPresentation;
  readonly manuscriptVisible?: boolean;
  readonly size?: number;
}) {
  if (mode === "hidden" || manuscriptVisible || size < 96) return <OhtiaGlasses />;
  return size === 96 || size === 128 ? (
    <StaticCharacterIllustration size={size} className="settings-character-image" />
  ) : (
    <CharacterDrawing size={size} />
  );
}

/** A surface must supply current manuscript visibility; notices/actions live outside decoration. */
export function CharacterDecoration({
  controller,
  confirmed,
  manuscriptVisible,
  size = 128,
}: {
  readonly controller: CharacterController;
  readonly confirmed: CharacterPresentation;
  readonly manuscriptVisible: boolean;
  readonly size?: number;
}) {
  const mode = useCharacterMode(confirmed, controller);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [attachedController, setAttachedController] = useState<CharacterController>();
  useLayoutEffect(
    () => () => {
      controller.setSurfaceAvailable(false);
    },
    [controller],
  );
  useLayoutEffect(() => {
    controller.setSurfaceAvailable(size >= 96);
    setAttachedController(controller);
  }, [controller, size]);
  const surface = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    controller.setMode(mode);
  }, [controller, mode]);
  useLayoutEffect(() => {
    controller.setManuscriptVisible(manuscriptVisible);
  }, [controller, manuscriptVisible]);
  useLayoutEffect(() => {
    const element = surface.current;
    const event = state.playing;
    if (
      !element ||
      !event ||
      controller.snapshot().playing !== event ||
      mode !== "animated" ||
      manuscriptVisible ||
      size < 96
    )
      return;
    const animations = [
      ...element.querySelectorAll<SVGElement>(
        ".character-body,.character-head,.character-brow,.character-pupil",
      ),
    ].map((part) => {
      const transform = getComputedStyle(part).transform;
      return part.animate(
        [
          { transform: "none" },
          { transform, offset: event.pose === "milestone" ? 0.36 : 0.5 },
          { transform: "none" },
        ],
        {
          duration: characterDurations[event.pose],
          iterations: 1,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        },
      );
    });
    const cancel = () => {
      for (const animation of animations) animation.cancel();
    };
    const unregister = controller.registerMotion(cancel);
    return () => {
      cancel();
      unregister();
    };
  }, [controller, state.playing, mode, manuscriptVisible, size]);
  // Guard current props as well as controller state before layout effects run.
  const full =
    attachedController === controller &&
    mode !== "hidden" &&
    !manuscriptVisible &&
    size >= 96 &&
    state.presenting !== undefined;
  return (
    <span ref={surface} className="character-decoration" data-full={full} aria-hidden="true">
      {full ? (
        <CharacterDrawing
          size={size}
          pose={state.pose}
          moving={mode === "animated" && !!state.playing}
        />
      ) : (
        <OhtiaGlasses />
      )}
    </span>
  );
}
