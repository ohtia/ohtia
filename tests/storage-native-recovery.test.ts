import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyMissingLocatedDatabase } from "../tooling/storage-native-recovery.mjs";
import {
  nativeFailureObservations,
  recordNativeFailure,
  withNativeFailureObservation,
} from "../tooling/native-failure-observation.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-recovery-observation-"));
  roots.push(root);
  const database = path.join(root, "synthetic.db3");
  fs.writeFileSync(database, "synthetic database bytes");
  const file = path.join(root, "receipt.json");
  const receipt = { cases: [] };
  let application: unknown;
  let metadata = { phase: "initial", selector: null as string | null };
  const page = {
    evaluate: vi.fn(async (_callback: unknown, input?: { sampleMs?: number }) =>
      input?.sampleMs
        ? { visibility: "visible", frames: { count: 2, elapsed_ms: 500 } }
        : { ok: false },
    ),
  };
  const app = {
    windows: () => [page],
    browserWindow: async () => ({
      evaluate: async () => ({ window_id: 42, web_contents_id: 43, visible: true, focused: true }),
      dispose: async () => {},
    }),
  };
  const persist = vi.fn(() => fs.writeFileSync(file, JSON.stringify(receipt)));
  const report = (error: unknown) =>
    recordNativeFailure(receipt, error, application, metadata, persist);
  const options = {
    start: vi.fn(async () => {
      application = app;
      metadata = { phase: "startup", selector: null };
      return page;
    }),
    open: vi.fn(async () => {
      metadata = { phase: "open-missing-database", selector: "#location-state" };
    }),
    close: vi.fn(async () => {
      application = undefined;
    }),
    enterPhase: (phase: string, selector: string | null = null) => {
      metadata = { phase, selector };
    },
    observeFailure: (operation: () => Promise<unknown>) =>
      withNativeFailureObservation(
        () => application,
        () => ({ ...metadata }),
        operation,
        report,
      ),
  };
  return {
    database,
    file,
    receipt,
    options,
    page,
    persist,
    report,
    getApplication: () => application,
  };
}

describe("missing-database native recovery evidence", () => {
  it.each(["start", "open"])(
    "publishes the failed %s context before pending shutdown and retains it after close",
    async (boundary) => {
      const input = fixture();
      const primary = new Error("synthetic initiating interaction failure");
      if (boundary === "start") {
        const start = input.options.start.getMockImplementation()!;
        input.options.start.mockImplementation(async () => {
          await start();
          throw primary;
        });
      } else {
        const open = input.options.open.getMockImplementation()!;
        input.options.open.mockImplementation(async () => {
          await open();
          throw primary;
        });
      }
      let release!: () => void;
      let markClosing!: () => void;
      const closing = new Promise<void>((resolve) => (markClosing = resolve));
      const close = input.options.close.getMockImplementation()!;
      input.options.close.mockImplementation(async () => {
        markClosing();
        await new Promise<void>((resolve) => (release = resolve));
        await close();
      });
      // Attach the rejection handler immediately, while the real producer remains in cleanup.
      const finished = verifyMissingLocatedDatabase(input.database, input.options).catch(
        (error) => error,
      );
      await closing;
      try {
        const failure = JSON.parse(fs.readFileSync(input.file, "utf8")).cases[0];
        expect(failure).toMatchObject({
          result: "fail",
          error: String(primary),
          phase: boundary === "start" ? "startup" : "open-missing-database",
          native_observations: [
            {
              capture_status: "complete",
              windows: [{ native: { window_id: 42, web_contents_id: 43 } }],
            },
          ],
        });
        expect(input.getApplication()).toBeDefined();
      } finally {
        release();
      }
      const error = await finished;
      expect(error.cause).toBe(primary);
      expect(input.getApplication()).toBeUndefined();
      expect(input.receipt.cases).toHaveLength(1);
      expect(fs.readFileSync(input.database, "utf8")).toBe("synthetic database bytes");
      expect(fs.existsSync(input.database + ".acceptance-retained")).toBe(false);
    },
  );

  it("retains initiating and restoration failures with separate phases in one failed receipt", async () => {
    const input = fixture();
    const primary = new Error("synthetic opening failure");
    const cleanup = new Error(primary.message);
    const open = input.options.open.getMockImplementation()!;
    input.options.open.mockImplementation(async () => {
      await open();
      throw primary;
    });
    input.options.close.mockRejectedValueOnce(cleanup);
    const error = await verifyMissingLocatedDatabase(input.database, input.options).catch(
      (error) => error,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors[0].cause).toBe(primary);
    expect(error.errors[1].cause).toBe(cleanup);
    expect(nativeFailureObservations(error).map((item) => item.phase)).toEqual([
      "open-missing-database",
      "restore-missing-database-fixture",
    ]);
    await input.report(error);
    await input.report(error);
    const receipt = JSON.parse(fs.readFileSync(input.file, "utf8"));
    expect(receipt.cases).toHaveLength(1);
    expect(receipt.cases[0]).toMatchObject({
      error: String(primary),
      phase: "open-missing-database",
    });
    expect(receipt.cases[0].native_observations).toHaveLength(2);
    expect(receipt.cases[0].related_errors).toEqual([
      { error: String(cleanup), phase: "restore-missing-database-fixture" },
      { error: String(error), phase: null, kind: "aggregate" },
    ]);
    expect(fs.readFileSync(input.database + ".acceptance-retained", "utf8")).toBe(
      "synthetic database bytes",
    );
  });

  it("identifies an operation shutdown failure before restoring the retained fixture", async () => {
    const input = fixture();
    const primary = new Error("synthetic application shutdown failure");
    input.options.close.mockRejectedValueOnce(primary);
    const error = await verifyMissingLocatedDatabase(input.database, input.options).catch(
      (error) => error,
    );
    expect(error.cause).toBe(primary);
    expect(JSON.parse(fs.readFileSync(input.file, "utf8")).cases[0]).toMatchObject({
      phase: "close-missing-database-application",
      error: String(primary),
    });
    expect(fs.readFileSync(input.database, "utf8")).toBe("synthetic database bytes");
  });

  it("identifies restoration-only failure and preserves a suspect replacement and the retained original", async () => {
    const input = fixture();
    const close = input.options.close.getMockImplementation()!;
    input.options.close.mockImplementation(async () => {
      await close();
      fs.writeFileSync(input.database, "suspect replacement");
    });
    await expect(verifyMissingLocatedDatabase(input.database, input.options)).rejects.toThrow();
    expect(JSON.parse(fs.readFileSync(input.file, "utf8")).cases[0]).toMatchObject({
      result: "fail",
      phase: "restore-missing-database-fixture",
    });
    expect(fs.readFileSync(input.database, "utf8")).toBe("suspect replacement");
    expect(fs.readFileSync(input.database + ".acceptance-retained", "utf8")).toBe(
      "synthetic database bytes",
    );
  });

  it("keeps the native refusal assertions and restores the original synthetic file on success", async () => {
    const input = fixture();
    await expect(verifyMissingLocatedDatabase(input.database, input.options)).resolves.toEqual({
      replacementCreated: false,
      retainedOriginalRestored: true,
    });
    expect(input.options.open).toHaveBeenCalledExactlyOnceWith(input.page, "storage_failed");
    expect(input.page.evaluate).toHaveBeenCalledOnce();
    expect(input.persist).not.toHaveBeenCalled();
    expect(fs.readFileSync(input.database, "utf8")).toBe("synthetic database bytes");
  });
});
