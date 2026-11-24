import { ResearchService } from "./research-service.js";
import { DurableProvider } from "./durable-provider.js";
import {
  apiKeyConnections,
  decodeConnectionReport,
  providerMessageVersion,
  decodeApplicationExit,
  isIdentifier,
  isResearchOperation,
  isResearchMutation,
  decodeServiceWake,
  decodeDevelopmentAction,
  decodeProviderEvent,
  ServiceConnections,
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
  type PresentationSnapshot,
} from "@ohtia/contracts";

import type { DurableStore } from "./storage.js";
import type { RuntimeMode } from "./tasks.js";

/** Bounded service peer. Storage remains unavailable until the broker confirms locator activation. */
export function createStatusService(
  generation: string,
  locale: InterfaceLocale,
  send: (text: string) => void,
  storage?: DurableStore,
  admissionLost?: (reason: "provider_work_failed" | "storage_admission_lost") => void,
  mode: RuntimeMode = "installed",
) {
  if (!isInterfaceLocale(locale)) throw new Error("Unsupported trusted service locale.");
  const connections = new ServiceConnections();
  let modelRefreshSequence = 0;
  const context = {
    generation,
    mode,
    connections,
    providerMessages: new Map(),
    requestModelRefresh: (connection: string) => {
      const refresh_id = `models_${String(++modelRefreshSequence)}`;
      connections.beginModelRefresh(connection, refresh_id);
      send(
        JSON.stringify({
          kind: "model_list_refresh",
          refresh_id,
          version: providerMessageVersion,
          generation,
          connection,
        }),
      );
    },
  };
  storage?.setTaskContext(context);
  // The service generation identifies every provider message; main discards the rest.
  let research: ResearchService | undefined;
  const durable = storage
    ? new DurableProvider({
        storage,
        context,
        send,
        rateLimitChanged: () => {
          for (const connection of apiKeyConnections) research?.connectionChanged(connection);
        },
        retryReady: () => {
          enqueueProvider(async () => {
            if (enabled && durable) await durable.pump();
            for (const connection of apiKeyConnections) research?.connectionChanged(connection);
          });
        },
        reply: (task, sequence, text) => research?.reply(task, sequence, text),
      })
    : undefined;
  const streams = new Map<
    string,
    {
      window: string;
      subscription: string;
      topic: "status" | "appearance" | "locale" | "presentation";
      signature?: string;
      sequence: number;
      revision: number;
    }
  >();
  const queuedSubscriptions = new Map<string, { cancelled: boolean }>();
  let systemLocale = locale;
  let enabled = false;
  let disposed = false;
  let providerFailed = false;
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
  function loseProvider(): void {
    if (disposed || providerFailed) return;
    providerFailed = true;
    enabled = false;
    durable?.dispose();
    status = { ...status, service: "unavailable", engine: "unavailable" };
    try {
      admissionLost?.("provider_work_failed");
    } catch {
      // An observer cannot restore this generation's execution authority.
    }
  }
  if (storage && durable)
    research = new ResearchService(storage, generation, emit, durable, loseProvider);
  // Provider failures end this generation's admission, including failures after a window command commits.
  async function persistCatalog(connection: string): Promise<void> {
    if (!storage?.ready) return;
    const outcome = await storage.storeModelReport(connection);
    if (!outcome.ok) throw new Error("Model list storage failed.");
    if (!outcome.value) return;
    research?.sharedChange({
      kind: "providerModelsChanged",
      connection,
      list_revision: outcome.value.listRevision,
    });
    for (const change of outcome.value.changed)
      research?.sharedChange({ kind: "agentPreferenceChanged", ...change });
  }
  const enqueueProvider = (operation: () => unknown, publish = true): void => {
    queue = queue
      .then(async () => {
        if (!disposed && !providerFailed) {
          await operation();
          if (publish) await research?.publish();
        }
      })
      .catch(loseProvider);
  };
  const appearanceEvent = (record: Outcome<AppearanceRecord>) => {
    if (!record.ok) return;
    if (!disposed)
      send(JSON.stringify({ kind: "appearance_changed", generation, record: record.value }));
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
  const presentationSnapshot = async (): Promise<Outcome<PresentationSnapshot>> => {
    if (!storage) return failure("service_unavailable");
    const appearance = await storage.readAppearance();
    if (!appearance.ok) return appearance;
    const character = await storage.readPresentationPreference("character");
    if (!character.ok) return character;
    const zoom = await storage.readPresentationPreference("zoom");
    if (!zoom.ok) return zoom;
    const sourceQuote = await storage.readPresentationPreference("sourceQuote");
    if (!sourceQuote.ok) return sourceQuote;
    const entryText = await storage.readPresentationPreference("entryText");
    if (!entryText.ok) return entryText;
    return {
      ok: true,
      value: {
        serviceGeneration: generation,
        appearance: appearance.value,
        character: character.value,
        zoom: zoom.value,
        sourceQuote: sourceQuote.value,
        entryText: entryText.value,
      },
    };
  };
  const presentationEvent = async () => {
    const snapshot = await presentationSnapshot();
    if (!snapshot.ok || disposed) return;
    send(JSON.stringify({ kind: "presentation_changed", generation, snapshot: snapshot.value }));
    const signature = JSON.stringify(snapshot.value);
    for (const stream of streams.values()) {
      if (stream.topic !== "presentation" || stream.signature === signature) continue;
      stream.signature = signature;
      emit({
        protocol: 1,
        policy: policyId,
        kind: "event",
        windowGeneration: stream.window,
        serviceGeneration: generation,
        subscriptionId: stream.subscription,
        sequence: ++stream.sequence,
        topic: "presentation",
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
    if (isResearchOperation(value.operation)) {
      await research?.dispatch(value, () => !!subscription?.cancelled);
      return;
    }
    if (value.operation === "updateCheck.read")
      emit({ ...value, kind: "result", payload: await storage.readUpdateCheck() });
    else if (value.operation === "updateCheck.receipt")
      emit({
        ...value,
        kind: "result",
        payload: await storage.readUpdateCheckReceipt(value.payload.targetOperationId),
      });
    else if (value.operation === "updateCheck.replace")
      emit({
        ...value,
        kind: "result",
        payload: await storage.replaceUpdateCheck({
          operationId: value.operationId,
          ...value.payload,
        }),
      });
    else if (value.operation === "limits.read")
      emit({ ...value, kind: "result", payload: await storage.readExecutionLimits() });
    else if (value.operation === "limits.receipt")
      emit({
        ...value,
        kind: "result",
        payload: await storage.readExecutionLimitsReceipt(value.payload.targetOperationId),
      });
    else if (value.operation === "limits.replace") {
      const result = await storage.replaceExecutionLimits({
        operationId: value.operationId,
        ...value.payload,
      });
      emit({ ...value, kind: "result", payload: result });
      if (result.ok) {
        // This queue also owns provider admission; a new permit always reads the committed limit.
        try {
          await durable?.pump();
          await research?.publish();
        } catch {
          loseProvider();
        }
      }
    } else if (value.operation === "bounds.read")
      emit({ ...value, kind: "result", payload: await storage.readWindowBounds() });
    else if (value.operation === "bounds.receipt")
      emit({
        ...value,
        kind: "result",
        payload: await storage.readWindowBoundsReceipt(value.payload.targetOperationId),
      });
    else if (value.operation === "bounds.replace")
      emit({
        ...value,
        kind: "result",
        payload: await storage.replaceWindowBounds({
          operationId: value.operationId,
          ...value.payload,
        }),
      });
    else if (value.operation === "presentation.read")
      emit({ ...value, kind: "result", payload: await presentationSnapshot() });
    else if (
      value.operation === "character.receipt" ||
      value.operation === "zoom.receipt" ||
      value.operation === "sourceQuote.receipt" ||
      value.operation === "entryText.receipt"
    )
      emit({
        ...value,
        kind: "result",
        payload: await storage.readPresentationReceipt(
          (
            {
              "character.receipt": "character",
              "zoom.receipt": "zoom",
              "sourceQuote.receipt": "sourceQuote",
              "entryText.receipt": "entryText",
            } as const
          )[value.operation],
          value.payload.targetOperationId,
        ),
      });
    else if (
      value.operation === "character.replace" ||
      value.operation === "sourceQuote.replace" ||
      value.operation === "entryText.replace" ||
      value.operation === "zoom.replace" ||
      value.operation === "zoom.commit"
    ) {
      const result =
        value.operation === "zoom.replace" || value.operation === "zoom.commit"
          ? await storage.replacePresentationPreference(
              "zoom",
              {
                operationId: value.operationId,
                expectedRevision: value.payload.expectedRevision,
                value: value.payload.value,
              },
              value.operation === "zoom.commit" ? value.payload.intent : null,
            )
          : await storage.replacePresentationPreference(
              (
                {
                  "character.replace": "character",
                  "sourceQuote.replace": "sourceQuote",
                  "entryText.replace": "entryText",
                } as const
              )[value.operation],
              { operationId: value.operationId, ...value.payload },
            );
      emit({ ...value, kind: "result", payload: result });
      if (result.ok || result.error.code === "uncertain") await presentationEvent();
    } else if (value.operation === "locale.read")
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
      if (result.ok || result.error.code === "uncertain") {
        appearanceEvent(await storage.readAppearance());
        await presentationEvent();
      }
    } else if (
      value.operation === "appearance.subscribe" ||
      value.operation === "locale.subscribe" ||
      value.operation === "presentation.subscribe"
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
        value.operation === "locale.subscribe" || value.operation === "presentation.subscribe"
          ? value.operation === "presentation.subscribe"
            ? await presentationSnapshot()
            : await localeSnapshot()
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
        topic:
          value.operation === "presentation.subscribe"
            ? "presentation"
            : value.operation === "locale.subscribe"
              ? "locale"
              : "appearance",
        sequence: 1,
        revision:
          "record" in record.value
            ? record.value.record.revision
            : "revision" in record.value
              ? record.value.revision
              : -1,
        ...(value.operation === "presentation.subscribe"
          ? { signature: JSON.stringify(record.value) }
          : {}),
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
        topic:
          value.operation === "presentation.subscribe"
            ? "presentation"
            : value.operation === "locale.subscribe"
              ? "locale"
              : "appearance",
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
      if (!isInterfaceLocale(resolvedLocale) || !storage?.ready || disposed || providerFailed)
        throw new Error("Invalid storage activation.");
      enabled = true;
      if (durable)
        enqueueProvider(async () => {
          for (const connection of connections.connectionIds()) await persistCatalog(connection);
          await durable.pump();
        });
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
      const exit = decodeApplicationExit(text);
      if (exit?.kind === "application_exit") {
        if (exit.generation !== generation) return;
        if (!durable || !enabled) {
          send(
            JSON.stringify({
              kind: "application_exit_state",
              generation,
              operationId: exit.operationId,
              running: 0,
              held: true,
              cancelled: false,
              failed: !!storage,
            }),
          );
          return;
        }
        durable.holdExit(exit);
        enqueueProvider(() => durable.applicationExit(exit));
        return;
      }
      if (typeof text === "string" && text.length < 512) {
        try {
          const control: unknown = JSON.parse(text);
          if (
            control &&
            typeof control === "object" &&
            "kind" in control &&
            control.kind === "research_window_closed"
          ) {
            const value = control as Record<string, unknown>;
            if (
              Object.keys(value).sort().join(",") !== "generation,kind,windowGeneration" ||
              value.generation !== generation ||
              !isIdentifier(value.windowGeneration)
            )
              throw new Error("Invalid window disposal.");
            const window = value.windowGeneration;
            research?.revokeWindow(window);
            for (const [key, subscription] of queuedSubscriptions)
              if (key.startsWith(`${window}/`)) subscription.cancelled = true;
            // Accepted commands retain their uploaded parts; cleanup follows all work already queued.
            queue = queue.then(() => research?.closeWindow(window)).catch(loseProvider);
            return;
          }
        } catch {
          // The ordinary envelope decoder below reports malformed broker messages.
        }
      }
      const wake = decodeServiceWake(text);
      if (wake) {
        if (wake.generation === generation)
          enqueueProvider(async () => {
            if (enabled && durable) durable.wake(wake);
            // This exact echo is ordered after every old permit and before the next pump.
            send(JSON.stringify(wake));
            if (enabled && durable) await durable.pump();
          });
        return;
      }
      const report = decodeConnectionReport(text, generation);
      if (report) {
        // Without storage there is no task transaction to serialize with these reports.
        if (!durable) {
          if (!connections.receive(report)) throw new Error("Invalid connection report.");
          return;
        }
        enqueueProvider(async () => {
          if (!connections.receive(report)) throw new Error("Invalid connection report.");
          if (report.kind === "connection_models" && !report.page.hasMore)
            await persistCatalog(report.page.connection);
          if (report.kind === "connection_state" || !report.page.hasMore)
            research?.connectionChanged(
              report.kind === "connection_state"
                ? report.snapshot.connection
                : report.page.connection,
            );
          if (enabled) await durable.pump();
        });
        return;
      }
      const providerEvent = decodeProviderEvent(text, generation);
      if (providerEvent) {
        if (durable) {
          const type = providerEvent.event.type;
          enqueueProvider(
            async () => {
              if (!(await durable.receive(providerEvent, enabled)))
                throw new Error("Invalid provider event order.");
            },
            type === "started" || type === "usage" || type === "result" || type === "late_usage",
          );
        }

        return;
      }
      const action = decodeDevelopmentAction(text, generation);
      if (action) {
        if (mode !== "development")
          throw new Error("Development actions require the development mode.");
        if (!durable || !enabled) throw new Error("Development actions require admitted storage.");
        enqueueProvider(() => durable.developmentAction(action));
        return;
      }
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
        research?.unsubscribe(value.windowGeneration, value.subscriptionId);
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
        if (!storage?.admissionReady) admissionLost?.("storage_admission_lost");
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
        value.operation === "appearance.subscribe" ||
        value.operation === "locale.subscribe" ||
        value.operation === "presentation.subscribe" ||
        value.operation === "research.subscribe"
          ? { cancelled: false }
          : undefined;
      const subscriptionKey =
        value.operation === "appearance.subscribe" ||
        value.operation === "locale.subscribe" ||
        value.operation === "presentation.subscribe" ||
        value.operation === "research.subscribe"
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
          const outcome = failure(
            isResearchMutation(value.operation) ||
              value.operation === "appearance.replace" ||
              value.operation === "limits.replace" ||
              value.operation === "updateCheck.replace" ||
              value.operation === "locale.replace" ||
              value.operation === "layout.replace" ||
              value.operation === "bounds.replace" ||
              value.operation === "character.replace" ||
              value.operation === "sourceQuote.replace" ||
              value.operation === "entryText.replace" ||
              value.operation === "zoom.replace" ||
              value.operation === "zoom.commit"
              ? "uncertain"
              : "storage_failed",
          );
          if (isResearchOperation(value.operation))
            storage.reportResearchPort(value.operation, outcome);
          emit({ ...value, kind: "result", payload: outcome });
        })
        .finally(() => {
          if (!storage.admissionReady && !disposed && !providerFailed)
            admissionLost?.("storage_admission_lost");
          pending--;
          if (subscriptionKey) queuedSubscriptions.delete(subscriptionKey);
        });
    },
    drain(): Promise<void> {
      return queue;
    },
    connections,
    dispose(): void {
      research?.dispose();
      disposed = true;
      enabled = false;
      streams.clear();
      durable?.dispose();
    },
  };
}
