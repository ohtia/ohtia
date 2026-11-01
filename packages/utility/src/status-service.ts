import {
  decodeText,
  encodeEnvelope,
  failure,
  isInterfaceLocale,
  policyId,
  portLimits,
  type FoundationStatus,
  type InterfaceLocale,
  type Request,
  type Outcome,
  type AppearanceRecord,
  type LocaleSnapshot,
} from "@ohtia/contracts";

import type { DurableStore } from "./storage.js";

/** Bounded service peer. Storage remains unavailable until the broker confirms locator activation. */
export function createStatusService(
  generation: string,
  locale: InterfaceLocale,
  send: (text: string) => void,
  storage?: DurableStore,
  admissionLost?: () => void,
) {
  if (!isInterfaceLocale(locale)) throw new Error("Unsupported trusted service locale.");
  const streams = new Map<
    string,
    {
      window: string;
      subscription: string;
      topic: "status" | "appearance" | "locale";
      sequence: number;
      revision: number;
    }
  >();
  const queuedSubscriptions = new Map<string, { cancelled: boolean }>();
  let systemLocale = locale;
  let enabled = false;
  let disposed = false;
  const isDisposed = () => disposed;
  let pending = 0;
  let queue = Promise.resolve();
  let status: FoundationStatus = {
    artifact: "development",
    service: "ready",
    engine: "unavailable",
    interfaceLocale: locale,
  };
  const emit = (value: unknown) => {
    const encoded = encodeEnvelope(value);
    if (!encoded.ok) throw new Error("Invalid service output.");
    if (!disposed) send(encoded.value);
  };
  const appearanceEvent = (record: Outcome<AppearanceRecord>) => {
    if (!record.ok) return;
    for (const stream of streams.values()) {
      if (stream.topic !== "appearance" || record.value.revision <= stream.revision) continue;
      stream.revision = record.value.revision;
      emit({
        protocol: 1,
        policy: policyId,
        kind: "event",
        windowGeneration: stream.window,
        serviceGeneration: generation,
        subscriptionId: stream.subscription,
        sequence: ++stream.sequence,
        topic: "appearance",
        payload: record.value,
      });
    }
  };
  const localeSnapshot = async (): Promise<Outcome<LocaleSnapshot>> => {
    if (!storage) return failure("service_unavailable");
    const record = await storage.readLocale();
    return record.ok
      ? {
          ok: true,
          value: {
            serviceGeneration: generation,
            record: record.value,
            systemLocale,
            effectiveLocale: record.value.value === "system" ? systemLocale : record.value.value,
          },
        }
      : record;
  };
  const localeEvent = async () => {
    const snapshot = await localeSnapshot();
    if (!snapshot.ok) return;
    const localeChanged = status.interfaceLocale !== snapshot.value.effectiveLocale;
    status = { ...status, interfaceLocale: snapshot.value.effectiveLocale };
    if (!disposed)
      send(JSON.stringify({ kind: "locale_changed", generation, snapshot: snapshot.value }));
    for (const stream of streams.values()) {
      if (stream.topic === "status" && localeChanged)
        emit({
          protocol: 1,
          policy: policyId,
          kind: "event",
          windowGeneration: stream.window,
          serviceGeneration: generation,
          subscriptionId: stream.subscription,
          sequence: ++stream.sequence,
          topic: "status",
          payload: status,
        });
      if (stream.topic !== "locale" || snapshot.value.record.revision <= stream.revision) continue;
      stream.revision = snapshot.value.record.revision;
      emit({
        protocol: 1,
        policy: policyId,
        kind: "event",
        windowGeneration: stream.window,
        serviceGeneration: generation,
        subscriptionId: stream.subscription,
        sequence: ++stream.sequence,
        topic: "locale",
        payload: snapshot.value,
      });
    }
  };
  async function dispatch(value: Request, subscription?: { cancelled: boolean }): Promise<void> {
    if (disposed) return;
    if (subscription?.cancelled) {
      emit({ ...value, kind: "result", payload: failure("cancelled") });
      return;
    }
    if (!enabled || !storage?.ready) {
      emit({ ...value, kind: "result", payload: failure("service_unavailable") });
      return;
    }
    if (value.operation === "locale.read")
      emit({ ...value, kind: "result", payload: await localeSnapshot() });
    else if (value.operation === "locale.receipt")
      emit({
        ...value,
        kind: "result",
        payload: await storage.readLocaleReceipt(value.payload.targetOperationId),
      });
    else if (value.operation === "locale.replace") {
      const result = await storage.replaceLocale({
        operationId: value.operationId,
        ...value.payload,
      });
      emit({ ...value, kind: "result", payload: result });
      // A lost COMMIT acknowledgement cannot suppress publication of a known current effect.
      // Reading the authoritative snapshot neither settles the original receipt nor repeats a write.
      if (result.ok || result.error.code === "uncertain") await localeEvent();
    } else if (value.operation === "layout.read")
      emit({ ...value, kind: "result", payload: await storage.readLayout() });
    else if (value.operation === "layout.receipt")
      emit({
        ...value,
        kind: "result",
        payload: await storage.readLayoutReceipt(value.payload.targetOperationId),
      });
    else if (value.operation === "layout.replace")
      emit({
        ...value,
        kind: "result",
        payload: await storage.replaceLayout({ operationId: value.operationId, ...value.payload }),
      });
    else if (value.operation === "appearance.read")
      emit({ ...value, kind: "result", payload: await storage.readAppearance() });
    else if (value.operation === "appearance.receipt")
      emit({
        ...value,
        kind: "result",
        payload: await storage.readReceipt(value.payload.targetOperationId),
      });
    else if (value.operation === "appearance.replace") {
      const result = await storage.replaceAppearance({
        operationId: value.operationId,
        ...value.payload,
      });
      emit({ ...value, kind: "result", payload: result });
      if (result.ok) appearanceEvent(await storage.readAppearance());
    } else if (
      value.operation === "appearance.subscribe" ||
      value.operation === "locale.subscribe"
    ) {
      const id = `${value.windowGeneration}/${value.payload.subscriptionId}`;
      if (
        streams.has(id) ||
        streams.size >= portLimits.windows * portLimits.subscriptions_per_window ||
        [...streams.values()].filter((s) => s.window === value.windowGeneration).length >=
          portLimits.subscriptions_per_window
      ) {
        emit({ ...value, kind: "result", payload: failure("busy") });
        return;
      }
      const record =
        value.operation === "locale.subscribe"
          ? await localeSnapshot()
          : await storage.readAppearance();
      if (!record.ok) {
        emit({ ...value, kind: "result", payload: record });
        return;
      }
      if (isDisposed()) return;
      if ((() => subscription?.cancelled)()) {
        emit({ ...value, kind: "result", payload: failure("cancelled") });
        return;
      }
      streams.set(id, {
        window: value.windowGeneration,
        subscription: value.payload.subscriptionId,
        topic: value.operation === "locale.subscribe" ? "locale" : "appearance",
        sequence: 1,
        revision: "record" in record.value ? record.value.record.revision : record.value.revision,
      });
      emit({ ...value, kind: "result", payload: { ok: true, value: value.payload } });
      emit({
        protocol: 1,
        policy: policyId,
        kind: "event",
        windowGeneration: value.windowGeneration,
        serviceGeneration: generation,
        subscriptionId: value.payload.subscriptionId,
        sequence: 1,
        topic: value.operation === "locale.subscribe" ? "locale" : "appearance",
        payload: record.value,
      });
    }
  }
  return {
    setSystemLocale(value: InterfaceLocale): void {
      if (!isInterfaceLocale(value) || disposed) throw new Error("Invalid system locale.");
      systemLocale = value;
    },
    activate(resolvedLocale: InterfaceLocale): void {
      if (!isInterfaceLocale(resolvedLocale) || !storage?.ready || disposed)
        throw new Error("Invalid storage activation.");
      enabled = true;
      status = { ...status, engine: "verified", interfaceLocale: resolvedLocale };
      for (const stream of streams.values())
        if (stream.topic === "status")
          emit({
            protocol: 1,
            policy: policyId,
            kind: "event",
            windowGeneration: stream.window,
            serviceGeneration: generation,
            subscriptionId: stream.subscription,
            sequence: ++stream.sequence,
            topic: "status",
            payload: status,
          });
    },
    receive(text: unknown): void {
      if (disposed) return;
      const decoded = decodeText(text);
      if (!decoded.ok) throw new Error("Invalid broker message.");
      const value = decoded.value;
      if (value.serviceGeneration !== generation) return;
      if (value.kind === "cancel") return; // Status work is synchronous and may already be terminal.
      if (value.kind === "unsubscribe") {
        const id = `${value.windowGeneration}/${value.subscriptionId}`;
        const queued = queuedSubscriptions.get(id);
        if (queued) queued.cancelled = true;
        streams.delete(id);
        send(
          JSON.stringify({
            kind: "stream_disposed",
            generation,
            windowGeneration: value.windowGeneration,
            subscriptionId: value.subscriptionId,
          }),
        );
        return;
      }
      if (value.kind !== "request") throw new Error("Unauthorized broker message direction.");
      if (enabled) {
        status = { ...status, engine: storage?.admissionReady ? "verified" : "unavailable" };
        if (!storage?.admissionReady) admissionLost?.();
      }
      if (value.operation === "status.read") {
        emit({ ...value, kind: "result", payload: { ok: true, value: status } });
        return;
      }
      if (value.operation === "status.subscribe") {
        const id = `${value.windowGeneration}/${value.payload.subscriptionId}`;
        const inWindow = [...streams.values()].filter(
          (stream) => stream.window === value.windowGeneration,
        ).length;
        if (
          streams.has(id) ||
          streams.size >= portLimits.windows * portLimits.subscriptions_per_window ||
          inWindow >= portLimits.subscriptions_per_window
        ) {
          emit({ ...value, kind: "result", payload: failure("busy") });
          return;
        }
        streams.set(id, {
          window: value.windowGeneration,
          subscription: value.payload.subscriptionId,
          topic: "status",
          sequence: 1,
          revision: -1,
        });
        emit({ ...value, kind: "result", payload: { ok: true, value: value.payload } });
        emit({
          protocol: 1,
          policy: policyId,
          kind: "event",
          windowGeneration: value.windowGeneration,
          serviceGeneration: generation,
          subscriptionId: value.payload.subscriptionId,
          sequence: 1,
          topic: "status",
          payload: status,
        });
        return;
      }
      if (!storage || !enabled) {
        emit({ ...value, kind: "result", payload: failure("service_unavailable") });
        return;
      }
      if (pending >= portLimits.pending_global) {
        emit({ ...value, kind: "result", payload: failure("busy") });
        return;
      }
      pending++;
      const subscription =
        value.operation === "appearance.subscribe" || value.operation === "locale.subscribe"
          ? { cancelled: false }
          : undefined;
      const subscriptionKey =
        value.operation === "appearance.subscribe" || value.operation === "locale.subscribe"
          ? `${value.windowGeneration}/${value.payload.subscriptionId}`
          : undefined;
      if (subscriptionKey && subscription) {
        if (queuedSubscriptions.has(subscriptionKey)) {
          pending--;
          emit({ ...value, kind: "result", payload: failure("busy") });
          return;
        }
        queuedSubscriptions.set(subscriptionKey, subscription);
      }
      queue = queue
        .then(() => dispatch(value, subscription))
        .catch(() => {
          emit({
            ...value,
            kind: "result",
            payload: failure(
              value.operation === "appearance.replace" ||
                value.operation === "locale.replace" ||
                value.operation === "layout.replace"
                ? "uncertain"
                : "storage_failed",
            ),
          });
        })
        .finally(() => {
          if (!storage.admissionReady && !disposed) admissionLost?.();
          pending--;
          if (subscriptionKey) queuedSubscriptions.delete(subscriptionKey);
        });
    },
    drain(): Promise<void> {
      return queue;
    },
    dispose(): void {
      disposed = true;
      enabled = false;
      streams.clear();
    },
  };
}
