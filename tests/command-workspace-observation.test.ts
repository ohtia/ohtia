import { describe, expect, it, vi } from "vitest";
import { verifyWorkspaceSettingsEntry } from "../tooling/command-workspace.mjs";
import {
  nativeFailureObservations,
  withNativeFailureObservation,
} from "../tooling/native-failure-observation.mjs";

describe("workspace Settings failure publication", () => {
  it("publishes the initiating failure before pending secondary diagnostics and keeps both errors", async () => {
    const primary = new Error("synthetic entry failure");
    const diagnostic = new Error("synthetic unavailable control peer");
    let release!: () => void;
    let markInspecting!: () => void;
    const inspecting = new Promise<void>((resolve) => (markInspecting = resolve));
    const trigger = {
      click: vi.fn(async () => {
        throw primary;
      }),
      evaluate: vi.fn(async () => {
        markInspecting();
        await new Promise<void>((resolve) => (release = resolve));
        throw diagnostic;
      }),
    };
    const native = { evaluate: vi.fn(async () => true) };
    const publish = vi.fn(async (_error: Error) => {});
    const observe = vi.fn((operation: () => Promise<unknown>, metadata: { phase: string }) =>
      withNativeFailureObservation(null, () => metadata, operation, publish),
    );
    const finished = verifyWorkspaceSettingsEntry(
      native,
      trigger,
      {},
      "rail",
      observe,
      '.workspace-rail [data-workspace-command="settings.open"]',
    ).catch((error) => error);
    await inspecting;
    try {
      expect(publish).toHaveBeenCalledOnce();
      expect(observe.mock.calls[0][1]).toMatchObject({
        selector: '.workspace-rail [data-workspace-command="settings.open"]',
      });
      const failure = publish.mock.calls[0][0];
      expect(failure.cause).toBe(primary);
      expect(nativeFailureObservations(failure).map((item) => item.phase)).toEqual([
        "workspace-settings-rail",
      ]);
    } finally {
      release();
    }
    const error = await finished;
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors[0].cause).toBe(primary);
    expect(error.errors[1]).toBe(diagnostic);
  });
});
