import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { failure } from "@ohtia/contracts";
import {
  verifyMissingLocatedDatabase,
  waitForReplacedLocalePublication,
} from "../tooling/storage-native-recovery.mjs";
import {
  nativeFailureObservations,
  recordNativeFailure,
  withNativeFailureObservation,
} from "../tooling/native-failure-observation.mjs";

// Native locator waits are driven explicitly so a delayed renderer cannot pass the barrier.
const { observeAttribute } = vi.hoisted(() => ({ observeAttribute: vi.fn() }));
vi.mock("@playwright/test", async (original) => {
  const actual = await original<typeof import("@playwright/test")>();
  return {
    ...actual,
    expect: Object.assign(
      (value: unknown, message?: string) =>
        value && typeof value === "object" && "nativeLocaleFixture" in value
          ? {
              toHaveAttribute: (name: string, expected: string) =>
                observeAttribute(value, name, expected),
            }
          : actual.expect(value, message),
      { poll: actual.expect.poll },
    ),
  };
});

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  observeAttribute.mockReset();
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

function localeFixture(effectiveLocale = "en-US", generation = "replacement") {
  const record = { schemaVersion: 1, revision: 7, value: "system", source: "saved" };
  const port = {
    readStatus: vi.fn(() => ({
      result: Promise.resolve({ ok: true, value: { engine: "verified" } }),
    })),
    readLocale: vi.fn(() => ({
      result: Promise.resolve({
        ok: true,
        value: { effectiveLocale, serviceGeneration: generation, record },
      }),
    })),
    replaceLocale: vi.fn(
      (command: { value: string; expectedRevision: number; operationId: string }) => ({
        result: Promise.resolve({
          ok: true,
          value: { ...record, value: command.value, revision: 8 },
        }),
      }),
    ),
  };
  const bootstrap = { read: vi.fn(async () => ({ state: "storage_ready" })) };
  vi.stubGlobal("window", { ohtia: { foundation: port, bootstrap } });
  const publications = [0, 1].map(() => {
    let publish!: () => void;
    const published = new Promise<void>((resolve) => (publish = resolve));
    return { nativeLocaleFixture: true, published, publish };
  });
  observeAttribute.mockImplementation(async (locator, name, value) => {
    expect(name).toBe("lang");
    expect(value).toBe(effectiveLocale === "ko-KR" ? "fr-FR" : "ko-KR");
    await locator.published;
  });
  const pages = publications.map((publication) => ({
    evaluate: vi.fn(async (callback: (argument: unknown) => unknown, argument?: unknown) =>
      callback(argument),
    ),
    locator: vi.fn((selector: string) => {
      expect(selector).toBe("html");
      return publication;
    }),
  }));
  const recordPublication = vi.fn();
  return { port, bootstrap, publications, pages, recordPublication };
}

describe("replacement locale publication barrier", () => {
  it("waits for storage admission before reading or changing the recovered locale", async () => {
    const input = localeFixture();
    let admit!: (value: { state: string }) => void;
    input.bootstrap.read
      .mockResolvedValueOnce({ state: "storage_opening" })
      .mockImplementationOnce(() => new Promise((resolve) => (admit = resolve)));
    const pending = waitForReplacedLocalePublication(
      ...input.pages,
      "original",
      input.recordPublication,
    );
    await vi.waitFor(() => expect(input.bootstrap.read).toHaveBeenCalledTimes(2));
    expect(input.port.readLocale).not.toHaveBeenCalled();
    expect(input.port.replaceLocale).not.toHaveBeenCalled();
    input.publications.forEach((publication) => publication.publish());
    admit({ state: "storage_ready" });
    await expect(pending).resolves.toMatchObject({ serviceGeneration: "replacement" });
    expect(input.port.replaceLocale).toHaveBeenCalledOnce();
  });
  it("keeps a subsequent selector action pending until both retained renderers observe the replacement", async () => {
    const input = localeFixture();
    const select = vi.fn();
    const pending = waitForReplacedLocalePublication(
      ...input.pages,
      "original",
      input.recordPublication,
    ).then(select);
    await vi.waitFor(() => expect(observeAttribute).toHaveBeenCalledTimes(1));
    expect(select).not.toHaveBeenCalled();
    expect(input.recordPublication).not.toHaveBeenCalled();
    input.publications[0]!.publish();
    await vi.waitFor(() => expect(observeAttribute).toHaveBeenCalledTimes(2));
    expect(select).not.toHaveBeenCalled();
    expect(input.recordPublication).not.toHaveBeenCalled();
    input.publications[1]!.publish();
    await pending;
    expect(select).toHaveBeenCalledWith({
      serviceGeneration: "replacement",
      choice: "ko-KR",
      record: { schemaVersion: 1, revision: 8, value: "ko-KR", source: "saved" },
    });
    expect(input.port.replaceLocale).toHaveBeenCalledOnce();
    expect(input.port.replaceLocale).toHaveBeenCalledWith(
      { operationId: expect.any(String), expectedRevision: 7, value: "ko-KR" },
      "replacement",
    );
  });

  it("uses a distinct publication when the recovered language is already Korean", async () => {
    const input = localeFixture("ko-KR");
    input.publications.forEach((publication) => publication.publish());
    await expect(
      waitForReplacedLocalePublication(...input.pages, "original", input.recordPublication),
    ).resolves.toMatchObject({ choice: "fr-FR" });
    expect(input.port.replaceLocale).toHaveBeenCalledOnce();
  });

  it("refuses the old generation before creating a synthetic locale mutation", async () => {
    const input = localeFixture("en-US", "original");
    await expect(
      waitForReplacedLocalePublication(...input.pages, "original", input.recordPublication),
    ).rejects.toThrow();
    expect(input.port.replaceLocale).not.toHaveBeenCalled();
    expect(observeAttribute).not.toHaveBeenCalled();
  });

  it("preserves a failed synchronization write without replay or selector admission", async () => {
    const input = localeFixture();
    const refused = failure("service_unavailable");
    input.port.replaceLocale.mockReturnValueOnce({ result: Promise.resolve(refused) } as never);
    const select = vi.fn();
    await expect(
      waitForReplacedLocalePublication(...input.pages, "original", input.recordPublication).then(
        select,
      ),
    ).rejects.toThrow(JSON.stringify(refused));
    expect(input.port.replaceLocale).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    expect(observeAttribute).not.toHaveBeenCalled();
  });

  it("preserves a renderer assertion failure without replaying the synchronization write", async () => {
    const input = localeFixture();
    const error = new Error("synthetic publication timeout");
    observeAttribute.mockRejectedValueOnce(error);
    const select = vi.fn();
    await expect(
      waitForReplacedLocalePublication(...input.pages, "original", input.recordPublication).then(
        select,
      ),
    ).rejects.toBe(error);
    expect(input.port.replaceLocale).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
  });
  it("retains a refused locale read in the failure without writing or recording success", async () => {
    const input = localeFixture();
    const refused = failure("service_unavailable");
    input.port.readLocale.mockReturnValueOnce({ result: Promise.resolve(refused) } as never);
    await expect(
      waitForReplacedLocalePublication(...input.pages, "original", input.recordPublication),
    ).rejects.toThrow(JSON.stringify(refused));
    expect(input.port.replaceLocale).not.toHaveBeenCalled();
    expect(input.recordPublication).not.toHaveBeenCalled();
  });

  it("persists completed publication evidence before a following selector failure", async () => {
    const input = localeFixture();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-locale-recovery-"));
    roots.push(root);
    const file = path.join(root, "checkpoint.json");
    input.recordPublication.mockImplementation((observed) =>
      fs.writeFileSync(file, JSON.stringify(observed)),
    );
    input.publications.forEach((publication) => publication.publish());
    const failure = new Error("synthetic subsequent selector failure");
    await expect(
      waitForReplacedLocalePublication(...input.pages, "original", input.recordPublication).then(
        () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(input.recordPublication).toHaveBeenCalledOnce();
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({
      serviceGeneration: "replacement",
      choice: "ko-KR",
      record: { revision: 8, value: "ko-KR" },
    });
  });
});
