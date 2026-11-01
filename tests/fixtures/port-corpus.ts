import {
  policyId,
  type Request,
  type AppearanceRecord,
  type FoundationStatus,
  type LocaleSnapshot,
} from "../../packages/contracts/dist/index.js";

export const status: FoundationStatus = {
  artifact: "development",
  service: "ready",
  engine: "verified",
  interfaceLocale: "ca-AD",
};
export const appearance: AppearanceRecord = {
  schemaVersion: 1,
  revision: 2,
  value: "dark",
  source: "saved",
};
export const localeSnapshot: LocaleSnapshot = {
  serviceGeneration: "service-1",
  record: { schemaVersion: 1, revision: 2, value: "ko-KR", source: "saved" },
  effectiveLocale: "ko-KR",
  systemLocale: "en-GB",
};
export function request(overrides: Partial<Request> = {}): Request {
  return {
    protocol: 1,
    policy: policyId,
    kind: "request",
    requestId: "request-1",
    operationId: "operation-1",
    windowGeneration: "window-1",
    serviceGeneration: "service-1",
    operation: "status.read",
    payload: {},
    ...overrides,
  } as Request;
}
export const layout = {
  version: 1 as const,
  visible: { explorer: true, documents: true, chat: true },
  preferredWidths: { explorer: 256.5, documents: 656, chat: 360 },
};
const savedLayout = { schemaVersion: 1, revision: 1, source: "saved", value: layout };
export const acceptedEnvelopes: readonly unknown[] = [
  request({ operation: "locale.read" }),
  request({ operation: "locale.replace", payload: { expectedRevision: 1, value: "ko-KR" } }),
  request({ operation: "locale.receipt", payload: { targetOperationId: "operation-1" } }),
  request({ operation: "locale.subscribe", payload: { subscriptionId: "language" } }),
  {
    ...request({ operation: "locale.read" }),
    kind: "result",
    payload: { ok: true, value: localeSnapshot },
  },
  {
    ...request({ operation: "locale.replace" }),
    kind: "result",
    payload: { ok: true, value: localeSnapshot.record },
  },
  ...["pending", "not_found", "recorded"].map((state) => ({
    ...request({ operation: "locale.receipt" }),
    kind: "result",
    payload: {
      ok: true,
      value:
        state === "recorded"
          ? { state, outcome: { ok: true, value: localeSnapshot.record } }
          : { state },
    },
  })),
  {
    ...request({ operation: "locale.subscribe" }),
    kind: "result",
    payload: { ok: true, value: { subscriptionId: "language" } },
  },
  {
    protocol: 1,
    policy: policyId,
    kind: "event",
    windowGeneration: "window-1",
    serviceGeneration: "service-1",
    subscriptionId: "language",
    sequence: 1,
    topic: "locale",
    payload: localeSnapshot,
  },
  request({ operation: "layout.read" }),
  request({ operation: "layout.failureNotice" }),
  request({ operation: "layout.replace", payload: { expectedRevision: 0, value: layout } }),
  request({ operation: "layout.receipt", payload: { targetOperationId: "layout-1" } }),
  ...[
    ["layout.read", savedLayout],
    ["layout.read", { schemaVersion: 1, revision: 0, source: "default", value: null }],
    ["layout.read", { schemaVersion: 1, revision: 3, source: "invalid_fallback", value: null }],
    ["layout.replace", savedLayout],
    ["layout.failureNotice", { announce: true }],
    ["layout.receipt", { state: "recorded", outcome: { ok: true, value: savedLayout } }],
    ["layout.receipt", { state: "pending" }],
    ["layout.receipt", { state: "not_found" }],
  ].map(([operation, value]) => ({
    ...request(),
    operation,
    kind: "result",
    payload: { ok: true, value },
  })),
  request(),
  request({ operation: "appearance.read" }),
  request({ operation: "appearance.replace", payload: { expectedRevision: 1, value: "dark" } }),
  request({ operation: "appearance.receipt", payload: { targetOperationId: "operation-1" } }),
  request({ operation: "status.subscribe", payload: { subscriptionId: "subscription-1" } }),
  request({ operation: "appearance.subscribe", payload: { subscriptionId: "subscription-1" } }),
  { ...request(), kind: "cancel", payload: undefined }, // Removed below: wire controls have no payload.
  {
    protocol: 1,
    policy: policyId,
    kind: "unsubscribe",
    windowGeneration: "window-1",
    serviceGeneration: "service-1",
    subscriptionId: "subscription-1",
  },
  { ...request(), kind: "result", payload: { ok: true, value: status } },
  {
    ...request({ operation: "appearance.read" }),
    kind: "result",
    payload: { ok: true, value: appearance },
  },
  {
    ...request({ operation: "appearance.replace" }),
    kind: "result",
    payload: { ok: true, value: appearance },
  },
  {
    ...request({ operation: "appearance.receipt" }),
    kind: "result",
    payload: { ok: true, value: { state: "recorded", outcome: { ok: true, value: appearance } } },
  },
  {
    ...request({ operation: "appearance.receipt" }),
    kind: "result",
    payload: { ok: true, value: { state: "pending" } },
  },
  {
    ...request({ operation: "appearance.receipt" }),
    kind: "result",
    payload: { ok: true, value: { state: "not_found" } },
  },
  ...["status.subscribe", "appearance.subscribe"].map((operation) => ({
    ...request(),
    kind: "result",
    operation,
    payload: { ok: true, value: { subscriptionId: "subscription-1" } },
  })),
  {
    protocol: 1,
    policy: policyId,
    kind: "event",
    windowGeneration: "window-1",
    serviceGeneration: "service-1",
    subscriptionId: "subscription-1",
    sequence: 1,
    topic: "status",
    payload: status,
  },
  {
    protocol: 1,
    policy: policyId,
    kind: "event",
    windowGeneration: "window-1",
    serviceGeneration: "service-1",
    subscriptionId: "subscription-1",
    sequence: 1,
    topic: "appearance",
    payload: appearance,
  },
].map((value) => {
  if ((value as { kind: string }).kind === "cancel") {
    const { payload: _payload, ...header } = value as Record<string, unknown>;
    return header;
  }
  return value;
});
export const rejectedEnvelopes: readonly { name: string; value: unknown; code: string }[] = [
  {
    name: "unsupported protocol",
    value: { ...request(), protocol: 2 },
    code: "unsupported_version",
  },
  {
    name: "wrong numeric policy",
    value: { ...request(), policy: "foundation-other" },
    code: "policy_mismatch",
  },
  ...[
    { ...request(), senderFrame: "forged" },
    { ...request(), path: "/private" },
    { ...request(), payload: { expectedRevision: 1 } },
    { ...request(), requestId: "" },
    { ...request(), operationId: "../secret" },
    { ...request(), operation: "sql.execute" },
    { ...request(), windowGeneration: null },
    { ...request(), payload: { constructor: {} } },
    {
      ...request(),
      operation: "appearance.replace",
      payload: { expectedRevision: -1, value: "dark" },
    },
    {
      ...request(),
      operation: "appearance.replace",
      payload: { expectedRevision: 0.5, value: "dark" },
    },
    {
      ...request(),
      operation: "appearance.replace",
      payload: { expectedRevision: Number.MAX_SAFE_INTEGER, value: "dark" },
    },
    {
      ...request(),
      operation: "appearance.replace",
      payload: { expectedRevision: 0, value: "DARK" },
    },
    {
      ...request(),
      kind: "result",
      payload: { ok: true, value: { ...status, interfaceLocale: "es-CL" } },
    },
    {
      ...request(),
      kind: "result",
      payload: { ok: true, value: { ...status, service: "unavailable" } },
    },
    {
      ...request(),
      kind: "result",
      payload: {
        ok: false,
        error: {
          code: "storage_failed",
          nextAction: "retry_later",
          parameters: { trace: "private" },
        },
      },
    },
  ].map((value, index) => ({ name: `invalid shape ${index}`, value, code: "invalid_message" })),
];

export const rejectedResultPayloads: readonly unknown[] = [
  { operation: "appearance.read", value: { ...appearance, revision: 0 } },
  {
    operation: "appearance.read",
    value: { ...appearance, source: "default", value: "system", revision: 2 },
  },
  {
    operation: "appearance.read",
    value: { ...appearance, source: "invalid_fallback", value: "dark" },
  },
  {
    operation: "appearance.replace",
    value: { ...appearance, source: "invalid_fallback", value: "system" },
  },
  ...["uncertain", "busy", "timeout", "sequence_gap"].map((code) => ({
    operation: "appearance.receipt",
    value: {
      state: "recorded",
      outcome: {
        ok: false,
        error: {
          code,
          nextAction:
            code === "uncertain"
              ? "reconcile_operation"
              : code === "busy"
                ? "retry_later"
                : code === "timeout"
                  ? "retry_read"
                  : "resubscribe",
          parameters: {},
        },
      },
    },
  })),
  {
    operation: "appearance.receipt",
    value: {
      state: "recorded",
      outcome: {
        ok: true,
        value: { schemaVersion: 1, revision: 0, value: "system", source: "default" },
      },
    },
  },
];
