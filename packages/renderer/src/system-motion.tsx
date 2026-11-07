import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SystemMotion, SystemMotionBridge } from "@ohtia/contracts";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
/** Surfaces without the desktop bridge rely on Chromium's media query alone. */
export const unobservedSystemMotion: SystemMotionBridge = {
  readMotion: () => "unknown",
  subscribeMotion: () => () => {},
};
const SystemMotionContext = createContext<SystemMotionBridge>(unobservedSystemMotion);

/** ADR-0047: either Chromium's media query or the native portal observation requests reduction. */
export function systemReducesMotion(source: SystemMotionBridge): boolean {
  return window.matchMedia(reducedMotionQuery).matches || source.readMotion() === "reduce";
}
export function observeSystemMotion(
  source: SystemMotionBridge,
  listener: (reduced: boolean) => void,
): () => void {
  const media = window.matchMedia(reducedMotionQuery);
  const changed = () => {
    listener(media.matches || source.readMotion() === "reduce");
  };
  media.addEventListener("change", changed);
  let unsubscribe = () => {};
  try {
    unsubscribe = source.subscribeMotion(changed);
  } catch {
    /* A refused native subscription leaves the media query as the live input. */
  }
  return () => {
    media.removeEventListener("change", changed);
    unsubscribe();
  };
}
export function useSystemMotionSource(): SystemMotionBridge {
  return useContext(SystemMotionContext);
}
export function useSystemReducedMotion(active = true): boolean {
  const source = useSystemMotionSource();
  const [reduced, setReduced] = useState(() => systemReducesMotion(source));
  useEffect(() => {
    if (!active) return;
    setReduced(systemReducesMotion(source));
    return observeSystemMotion(source, setReduced);
  }, [source, active]);
  return reduced;
}
/** One bridge subscription per window, shared by every mounted consumer. */
function shareSystemMotion(source: SystemMotionBridge) {
  const listeners = new Set<(value: SystemMotion) => void>();
  const bridge: SystemMotionBridge = {
    readMotion: () => source.readMotion(),
    subscribeMotion(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return { listeners, bridge };
}
/** Supplies the native observation and mirrors it on the root, where motion tokens read it. */
export function SystemMotionProvider({
  source,
  children,
}: {
  readonly source: SystemMotionBridge;
  readonly children: ReactNode;
}) {
  const shared = useMemo(() => shareSystemMotion(source), [source]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (source.readMotion() === "reduce") root.dataset.systemMotion = "reduce";
      else delete root.dataset.systemMotion;
    };
    apply();
    let unsubscribe = () => {};
    try {
      unsubscribe = source.subscribeMotion((value) => {
        apply();
        for (const listener of [...shared.listeners]) {
          try {
            listener(value);
          } catch {
            // A failing consumer must not remove the window's only bridge subscription.
            shared.listeners.delete(listener);
          }
        }
      });
    } catch {
      /* Consumers keep the media query and the last native observation they could read. */
    }
    return () => {
      unsubscribe();
      delete root.dataset.systemMotion;
    };
  }, [source, shared]);
  return (
    <SystemMotionContext.Provider value={shared.bridge}>{children}</SystemMotionContext.Provider>
  );
}
