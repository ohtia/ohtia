import { vi } from "vitest";
import {
  failure,
  staleRevision,
  type FoundationPort,
  type PresentationSnapshot,
  type Outcome,
  type AppearanceChange,
  type PresentationChange,
} from "@ohtia/contracts";
import { SettingsController } from "../../packages/renderer/src/settings-controller.js";
export function call<T>(value: Outcome<T>) {
  return { result: Promise.resolve(value), cancel: vi.fn() };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export function snapshot(): PresentationSnapshot {
  return {
    serviceGeneration: "service-1",
    appearance: { schemaVersion: 1, revision: 0, value: "system", source: "default" },
    character: { schemaVersion: 1, revision: 0, value: "animated", source: "default" },
    zoom: { schemaVersion: 1, revision: 0, value: 100, source: "default" },
  };
}
export function harness() {
  let current = snapshot();
  let listener: (value: Outcome<PresentationSnapshot>) => void = () => {};
  let id = 0;
  const stop = vi.fn();
  const apply = vi.fn();
  const replace = (
    feature: "appearance" | "character" | "zoom",
    command: AppearanceChange | PresentationChange<string | number>,
  ) => {
    const value = {
      schemaVersion: 1 as const,
      revision: command.expectedRevision + 1,
      value: command.value,
      source: "saved" as const,
    };
    current = { ...current, [feature]: value } as PresentationSnapshot;
    return call({ ok: true as const, value });
  };
  const port = {
    readPresentation: vi.fn(() => call({ ok: true as const, value: current })),
    subscribePresentation: vi.fn((notify: typeof listener) => {
      listener = notify;
      return {
        ready: Promise.resolve({ ok: true as const, value: { subscriptionId: "settings" } }),
        dispose: stop,
      };
    }),
    replaceAppearance: vi.fn((command: AppearanceChange) => replace("appearance", command)),
    replaceCharacter: vi.fn((command: PresentationChange<string>) => replace("character", command)),
    replaceZoom: vi.fn((command: PresentationChange<number>) => replace("zoom", command)),
    adjustZoom: vi.fn((operationId: string, intent: string) =>
      replace("zoom", {
        operationId,
        expectedRevision: current.zoom.revision,
        value: intent === "increase" ? 110 : intent === "decrease" ? 90 : 100,
      }),
    ),
    readAppearanceReceipt: vi.fn(() =>
      call({ ok: true as const, value: { state: "not_found" as const } }),
    ),
    readCharacterReceipt: vi.fn(() =>
      call({ ok: true as const, value: { state: "not_found" as const } }),
    ),
    readZoomReceipt: vi.fn(() =>
      call({ ok: true as const, value: { state: "not_found" as const } }),
    ),
  };
  const controller = new SettingsController(
    port as unknown as FoundationPort,
    apply,
    () => `operation-${++id}`,
  );
  return {
    controller,
    port,
    apply,
    stop,
    get current() {
      return current;
    },
    notify(value: Outcome<PresentationSnapshot>) {
      if (value.ok) current = value.value;
      listener(value);
    },
  };
}
