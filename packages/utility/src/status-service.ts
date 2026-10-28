import {
  decodeText,
  encodeEnvelope,
  failure,
  isInterfaceLocale,
  policyId,
  portLimits,
  type FoundationStatus,
  type InterfaceLocale,
} from "@ohtia/contracts";

/** No database, provider, research files or saved preferences are accessed by this foundation peer. */
export function createStatusService(
  generation: string,
  locale: InterfaceLocale,
  send: (text: string) => void,
) {
  if (!isInterfaceLocale(locale)) throw new Error("Unsupported trusted service locale.");
  const streams = new Map<string, { window: string; subscription: string }>();
  const status: FoundationStatus = {
    artifact: "development",
    service: "ready",
    engine: "unavailable",
    interfaceLocale: locale,
  };
  const emit = (value: unknown) => {
    const encoded = encodeEnvelope(value);
    if (!encoded.ok) throw new Error("Invalid service output.");
    send(encoded.value);
  };
  return {
    receive(text: unknown): void {
      const decoded = decodeText(text);
      if (!decoded.ok) throw new Error("Invalid broker message.");
      const value = decoded.value;
      if (value.serviceGeneration !== generation) return;
      if (value.kind === "cancel") return; // Status work is synchronous and may already be terminal.
      if (value.kind === "unsubscribe") {
        streams.delete(`${value.windowGeneration}/${value.subscriptionId}`);
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
      // Storage activation is a separate owner; never invent a saved/default database result.
      emit({ ...value, kind: "result", payload: failure("service_unavailable") });
    },
    dispose(): void {
      streams.clear();
    },
  };
}
