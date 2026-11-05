/* global document, window */
/** Observe a failed native interaction without reading document content or input values. */
export async function observeNativeFailure(
  application,
  { phase, selector = null, budgetMs = 2000, sampleMs = 500 },
) {
  const started = performance.now();
  const windows = [];
  let timer;
  const copy = (status, extra = {}) => ({
    version: 1,
    phase,
    capture_status: status,
    budget_ms: budgetMs,
    frame_sample_ms: sampleMs,
    elapsed_ms: performance.now() - started,
    windows: JSON.parse(JSON.stringify(windows)),
    ...extra,
  });
  if (!application) return copy("unavailable", { reason: "application-unavailable" });
  try {
    const pages = application.windows();
    if (!pages.length) return copy("unavailable", { reason: "no-renderer-pages" });
    const observations = pages.map(async (page, index) => {
      const observed = { page_index: index, status: "pending" };
      windows.push(observed);
      let native;
      try {
        native = await application.browserWindow(page);
        observed.native = await native.evaluate((window) => ({
          window_id: window.id,
          web_contents_id: window.webContents.id,
          bounds: window.getBounds(),
          content_bounds: window.getContentBounds(),
          visible: window.isVisible(),
          focused: window.isFocused(),
          minimized: window.isMinimized(),
          web_contents_focused: window.webContents.isFocused(),
          background_throttling: window.webContents.getBackgroundThrottling(),
        }));
        observed.renderer = await page.evaluate(
          async ({ selector, sampleMs }) => {
            const element = selector ? document.querySelector(selector) : null;
            const rect = element?.getBoundingClientRect();
            const style = element ? window.getComputedStyle(element) : null;
            const state = {
              visibility: document.visibilityState,
              hidden: document.hidden,
              focused: document.hasFocus(),
              language: document.documentElement.lang,
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                dpr: window.devicePixelRatio,
              },
              active_tag: document.activeElement?.tagName ?? null,
              target: element
                ? {
                    tag: element.tagName,
                    connected: element.isConnected,
                    disabled: typeof element.disabled === "boolean" ? element.disabled : null,
                    aria_disabled: element.getAttribute("aria-disabled"),
                    inert: element.closest("[inert]") !== null,
                    display: style.display,
                    visibility: style.visibility,
                    opacity: style.opacity,
                    pointer_events: style.pointerEvents,
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                  }
                : null,
            };
            state.frames = await new Promise((resolve) => {
              const started = window.performance.now();
              let count = 0;
              let pending;
              const tick = () => {
                count++;
                pending = window.requestAnimationFrame(tick);
              };
              pending = window.requestAnimationFrame(tick);
              window.setTimeout(() => {
                window.cancelAnimationFrame(pending);
                resolve({ count, elapsed_ms: window.performance.now() - started });
              }, sampleMs);
            });
            return state;
          },
          { selector, sampleMs },
        );
        observed.status = "observed";
      } catch (error) {
        observed.status = "failed";
        observed.error_type = error instanceof Error ? error.name : "UnknownError";
      } finally {
        if (native) {
          try {
            await native.dispose();
          } catch (error) {
            observed.disposal_error_type = error instanceof Error ? error.name : "UnknownError";
          }
        }
      }
    });
    const completed = Promise.allSettled(observations).then(() => "completed");
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timed-out"), budgetMs);
    });
    if ((await Promise.race([completed, timeout])) === "timed-out") return copy("timed-out");
    return copy(
      windows.every((window) => window.status === "observed" && !window.disposal_error_type)
        ? "complete"
        : "partial",
    );
  } catch (error) {
    return copy("unavailable", {
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
  } finally {
    clearTimeout(timer);
  }
}

class NativeFailureObservationError extends Error {
  constructor(cause, observation) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = cause instanceof Error ? cause.name : "Error";
    this.observation = observation;
  }
}

/** Capture the failed operation before a later cleanup can change its window or phase. */
export async function withNativeFailureObservation(
  application,
  metadata,
  operation,
  publishFailure,
) {
  try {
    return await operation();
  } catch (error) {
    if (nativeFailureObservations(error).length) throw error;
    let observation;
    try {
      observation = await observeNativeFailure(
        typeof application === "function" ? application() : application,
        metadata(),
      );
    } catch (captureError) {
      observation = {
        version: 1,
        capture_status: "unavailable",
        reason: "observation-metadata-unavailable",
        error_type: captureError instanceof Error ? captureError.name : "UnknownError",
      };
    }
    const observedError = new NativeFailureObservationError(error, observation);
    if (publishFailure) {
      try {
        await publishFailure(observedError);
      } catch (publicationError) {
        throw new AggregateError(
          [observedError, publicationError],
          `${String(observedError)}; failure observation publication failed: ${String(publicationError)}`,
          { cause: observedError },
        );
      }
    }
    throw observedError;
  }
}

/** Retain the initiating observation and any independent cleanup observations in error order. */
export function nativeFailureObservations(error) {
  const pending = [error];
  const visited = new Set();
  const observations = [];
  while (pending.length) {
    const current = pending.shift();
    if (!(current instanceof Error) || visited.has(current)) continue;
    visited.add(current);
    if (current instanceof NativeFailureObservationError) observations.push(current.observation);
    if (current instanceof AggregateError) pending.unshift(...current.errors);
    if (current.cause) pending.push(current.cause);
  }
  return observations;
}

// Error identity distinguishes independent failures with identical diagnostics.
const reportedFailures = new WeakMap();

/** Persist the initiating failure and completed capture before application shutdown can stall. */
export async function recordNativeFailure(receipt, error, application, metadata, persist) {
  const retained = nativeFailureObservations(error);
  const phase = retained[0]?.phase ?? metadata.phase;
  let failure = receipt.cases.find((row) => row.id === "run" && row.result === "fail");
  if (!failure) {
    failure = {
      id: "run",
      result: "fail",
      error: String(error),
      phase,
      last_completed_case: receipt.cases.at(-1)?.id ?? null,
    };
    receipt.cases.push(failure);
    reportedFailures.set(failure, new Set([error]));
  } else if (!reportedFailures.get(failure)?.has(error)) {
    failure.related_errors ??= [];
    const related = {
      error: String(error),
      phase: error instanceof AggregateError ? null : phase,
      ...(error instanceof AggregateError ? { kind: "aggregate" } : {}),
    };
    failure.related_errors.push(related);
    if (!reportedFailures.has(failure)) reportedFailures.set(failure, new Set());
    reportedFailures.get(failure).add(error);
  }
  const publish = () => {
    try {
      persist();
    } catch (publicationError) {
      throw new AggregateError(
        [error, publicationError],
        `${String(error)}; failure receipt publication failed: ${String(publicationError)}`,
        { cause: error },
      );
    }
  };
  publish();
  const observations = retained.length
    ? retained
    : [await observeNativeFailure(application, metadata)];
  failure.native_observations = [
    ...new Set([...(failure.native_observations ?? []), ...observations]),
  ];
  publish();
  return failure;
}
