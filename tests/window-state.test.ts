import { describe, it, expect, vi } from "vitest";
import {
  isWindowBounds,
  decodeWindowBoundsChange,
  decodeEnvelope,
  policyId,
  failure,
  staleRevision,
  windowTokens,
  type WindowBounds,
  type WindowBoundsRecord,
  type WindowBoundsChange,
  type Outcome,
  type SavedWindowBoundsRecord,
} from "../packages/contracts/src/index.js";
import {
  applyWindowBoundsCommand,
  type RecordedWindowBoundsCommand,
} from "../packages/domain/src/window-bounds-command.js";
import {
  WindowTheme,
  WindowPreferences,
  requestBootstrapPlacement,
  windowOptions,
  windowPlacement,
  type WindowPreferencePeer,
} from "../packages/main/src/window-state.js";
const bounds: WindowBounds = {
  version: 1,
  x: -1000,
  y: 40,
  width: 800,
  height: 600,
  maximized: false,
};
const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const secondary = { x: -1280, y: 0, width: 1280, height: 1024 };
const record = (value: WindowBounds | null = bounds, revision = 1): WindowBoundsRecord => ({
  schemaVersion: 1,
  revision,
  value,
  source: value ? "saved" : "default",
});
describe("closed native window contracts and safe placement", () => {
  it("rejects unknown fields, versions, fractions, unsafe coordinates, accessors and private content", () => {
    expect(isWindowBounds(bounds)).toBe(true);
    for (const invalid of [
      null,
      [],
      { ...bounds, version: 2 },
      { ...bounds, path: "private" },
      { ...bounds, width: 319 },
      { ...bounds, height: 399 },
      { ...bounds, height: 100001 },
      { ...bounds, x: 0.5 },
      { ...bounds, y: Number.MAX_SAFE_INTEGER + 1 },
      { ...bounds, maximized: 1 },
      { ...bounds, width: Infinity },
    ])
      expect(isWindowBounds(invalid)).toBe(false);
    const getter = vi.fn(() => 1000);
    expect(isWindowBounds(Object.defineProperty({ ...bounds }, "width", { get: getter }))).toBe(
      false,
    );
    expect(getter).not.toHaveBeenCalled();
    expect(isWindowBounds({ ...bounds, [Symbol("private")]: true })).toBe(false);
    expect(
      decodeWindowBoundsChange({ operationId: "close-1", expectedRevision: 0, value: bounds }).ok,
    ).toBe(true);
    expect(
      decodeWindowBoundsChange({
        operationId: "close-1",
        expectedRevision: Number.MAX_SAFE_INTEGER,
        value: bounds,
      }).ok,
    ).toBe(false);
  });
  it("round-trips each named peer operation with exact bounded schemas", () => {
    for (const [operation, payload] of [
      ["bounds.read", {}],
      ["bounds.replace", { expectedRevision: 0, value: bounds }],
      ["bounds.receipt", { targetOperationId: "close-1" }],
    ] as const) {
      expect(
        decodeEnvelope({
          protocol: 1,
          policy: policyId,
          kind: "request",
          requestId: "req-1",
          operationId: "close-1",
          windowGeneration: "broker-1",
          serviceGeneration: "service-1",
          operation,
          payload,
        }).ok,
      ).toBe(true);
    }
  });
  it("restores fully contained records on a connected display, clamping size first", () => {
    expect(windowPlacement(bounds, [primary, secondary], primary)).toEqual({
      x: -1000,
      y: 40,
      width: 800,
      height: 600,
      maximized: false,
    });
  });
  it("centers defaults for missing, unsupported and offscreen records without writing them", () => {
    const expected = { x: 320, y: 140, width: 1280, height: 800, maximized: false };
    for (const value of [null, { ...bounds, version: 2 }, { ...bounds, x: 5000 }, bounds])
      expect(windowPlacement(value, [primary], primary)).toEqual(expected);
    expect(windowPlacement(null, [secondary], secondary)).toEqual({
      x: -1280,
      y: 112,
      width: 1280,
      height: 800,
      maximized: false,
    });
    expect(
      windowPlacement(
        { ...bounds, x: 0, y: 0, width: 100000, height: 100000, maximized: true },
        [primary],
        primary,
      ),
    ).toEqual({ x: 0, y: 0, width: 1920, height: 1080, maximized: true });
  });
  it("cascades by 24 DIP within the focused display using saved size and clamps at its edge", () => {
    expect(windowPlacement(bounds, [primary, secondary], primary, bounds)).toEqual({
      x: -976,
      y: 64,
      width: 800,
      height: 600,
      maximized: false,
    });
    expect(
      windowPlacement(bounds, [primary], primary, { x: 1800, y: 1000, width: 800, height: 600 }),
    ).toEqual({ x: 1120, y: 480, width: 800, height: 600, maximized: false });
  });
});
it("requests saved normal state before bootstrap resize without revealing hidden windows", () => {
  const calls: unknown[] = [];
  const window = {
    setBounds: (value: unknown) => calls.push(["bounds", value]),
    unmaximize: () => calls.push(["unmaximize"]),
    maximize: () => calls.push(["maximize"]),
  };
  const placement = { x: 24, y: 32, width: 960, height: 600, maximized: false };
  requestBootstrapPlacement(window, placement, true, true);
  expect(calls).toEqual([["unmaximize"], ["bounds", { width: 960, height: 600 }]]);
  calls.length = 0;
  requestBootstrapPlacement(window, { ...placement, maximized: true }, true, false);
  expect(calls).toEqual([
    ["unmaximize"],
    ["bounds", { x: 24, y: 32, width: 960, height: 600 }],
    ["maximize"],
  ]);
  for (const maximized of [false, true]) {
    calls.length = 0;
    requestBootstrapPlacement(window, { ...placement, maximized }, false, true);
    expect(calls).toEqual([["bounds", { width: 960, height: 600 }]]);
  }
});
it.each(["wayland", "positioned"] as const)(
  "clamps oversized close-time geometry before requesting bootstrap restoration on %s",
  (backend) => {
    const calls: unknown[] = [];
    const window = {
      setBounds: (value: unknown) => calls.push(["bounds", value]),
      unmaximize: () => calls.push(["unmaximize"]),
      maximize: () => calls.push(["maximize"]),
    };
    const area = { x: 0, y: 0, width: 1280, height: 720 };
    const saved = { version: 1, x: 24, y: 24, width: 1292, height: 742, maximized: true };
    const placement = windowPlacement(saved, [area], area, undefined, backend);
    requestBootstrapPlacement(window, placement, true, backend === "wayland");
    expect(calls).toEqual([
      ["unmaximize"],
      ["bounds", { ...(backend === "wayland" ? {} : { x: 0, y: 0 }), width: 1280, height: 720 }],
      ...(backend === "wayland" ? [["maximize"]] : []),
    ]);
    expect(saved).toEqual({ version: 1, x: 24, y: 24, width: 1292, height: 742, maximized: true });
  },
);
describe("native theme ordering and initial window options", () => {
  it.each(["linux", "win32", "darwin"])(
    "uses generated theme colors, hidden first paint and platform controls on %s",
    (platform) => {
      const options = windowOptions(platform, "dark", windowPlacement(null, [primary], primary));
      expect(options.show).toBe(false);
      expect(options.autoHideMenuBar).toBe(true);
      expect(options.backgroundColor).toBe(windowTokens.dark["surface.page"]);
      expect(options.minHeight).toBe(400);
      expect(options.titleBarStyle).toBe(platform === "darwin" ? "hiddenInset" : "hidden");
      expect(options.titleBarOverlay).toEqual(
        platform === "darwin"
          ? { height: 48 }
          : {
              height: 48,
              color: windowTokens.dark["surface.panel"],
              ...(platform === "win32"
                ? { symbolColor: windowTokens.dark["content.primary"] }
                : {}),
            },
      );
    },
  );
  it("ignores duplicate and late theme revisions, tracks system changes and revokes destroyed windows", () => {
    let dark = false;
    const theme = new WindowTheme("win32", () => dark);
    const window = {
      isDestroyed: vi.fn(() => false),
      setBackgroundColor: vi.fn(),
      setTitleBarOverlay: vi.fn(),
    };
    expect(theme.confirm({ schemaVersion: 1, revision: 4, source: "saved", value: "dark" })).toBe(
      true,
    );
    theme.apply(window);
    expect(theme.confirm({ schemaVersion: 1, revision: 3, source: "saved", value: "light" })).toBe(
      false,
    );
    expect(theme.confirm({ schemaVersion: 1, revision: 4, source: "saved", value: "light" })).toBe(
      false,
    );
    expect(theme.source()).toBe("dark");
    expect(theme.source(false)).toBe("system");
    expect(theme.scheme()).toBe("dark");
    expect(theme.scheme(false)).toBe("light");
    dark = true;
    expect(theme.scheme(false)).toBe("dark");
    theme.confirm({ schemaVersion: 1, revision: 5, source: "saved", value: "system" });
    dark = false;
    theme.apply(window);
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith(windowTokens.light["surface.page"]);
    window.isDestroyed.mockReturnValue(true);
    theme.apply(window);
    expect(window.setBackgroundColor).toHaveBeenCalledTimes(2);
    theme.reset();
    expect(
      theme.confirm({ schemaVersion: 1, revision: 0, source: "default", value: "system" }),
    ).toBe(true);
  });
});
describe("atomic window bounds receipts", () => {
  it("replays the original outcome, refuses conflicting identities and records stale revisions", () => {
    let current = record(null, 0);
    const receipts = new Map<string, RecordedWindowBoundsCommand>();
    const replace = vi.fn((value: WindowBounds): SavedWindowBoundsRecord => ({
      ...current,
      revision: current.revision + 1,
      source: "saved",
      value,
    }));
    const transaction = {
      readReceipt: (id: string) => receipts.get(id),
      readWindowBounds: () => ({ ok: true as const, value: current }),
      replaceWindowBounds: replace,
      recordReceipt: (id: string, receipt: RecordedWindowBoundsCommand) => {
        receipts.set(id, receipt);
      },
    };
    const command: WindowBoundsChange = {
      operationId: "close-1",
      expectedRevision: 0,
      value: bounds,
    };
    const first = applyWindowBoundsCommand(transaction, command);
    expect(first).toMatchObject({ ok: true, value: { revision: 1 } });
    if (first.ok) current = first.value;
    expect(applyWindowBoundsCommand(transaction, command)).toEqual(first);
    expect(replace).toHaveBeenCalledOnce();
    expect(
      applyWindowBoundsCommand(transaction, { ...command, value: { ...bounds, x: 0 } }),
    ).toEqual(failure("operation_conflict"));
    expect(applyWindowBoundsCommand(transaction, { ...command, operationId: "close-2" })).toEqual(
      staleRevision(1),
    );
  });
});
describe("broker close-time serialization", () => {
  it("serializes complete records against the latest revision, keeps accepted writes after close and never repeats an uncertain write", async () => {
    let release: ((outcome: Outcome<SavedWindowBoundsRecord>) => void) | undefined;
    let revision = 0;
    const calls: string[] = [];
    const peer = {
      request: vi.fn(async (operation: string) => {
        calls.push(operation);
        if (operation === "bounds.read")
          return { ok: true, value: record(revision ? bounds : null, revision) };
        if (operation === "bounds.receipt")
          return {
            ok: true,
            value: {
              state: "recorded",
              outcome: { ok: true, value: { ...record(), revision: ++revision } },
            },
          };
        if (calls.filter((value) => value === "bounds.replace").length === 1)
          return await new Promise<Outcome<SavedWindowBoundsRecord>>((resolve) => {
            release = resolve;
          });
        return { ok: true, value: { ...record(), revision: ++revision } };
      }),
    } as unknown as WindowPreferencePeer;
    const failed = vi.fn();
    const preferences = new WindowPreferences(() => peer, failed, 8);
    const first = preferences.save(bounds);
    const second = preferences.save({ ...bounds, x: 0 });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(calls).toEqual(["bounds.read", "bounds.replace"]);
    release?.(failure("uncertain"));
    await Promise.all([first, second, preferences.drain()]);
    expect(calls).toEqual([
      "bounds.read",
      "bounds.replace",
      "bounds.receipt",
      "bounds.read",
      "bounds.replace",
    ]);
    expect(peer.request).toHaveBeenNthCalledWith(
      5,
      "bounds.replace",
      { expectedRevision: 1, value: { ...bounds, x: 0 } },
      expect.any(String),
    );
    expect(failed).not.toHaveBeenCalled();
  });
  it("preserves original operation identities across peer loss and bounds its pending inventory", async () => {
    const failed = vi.fn();
    const request = vi.fn(async (operation: string) =>
      operation === "bounds.read"
        ? { ok: true, value: record(null, 0) }
        : operation === "bounds.replace"
          ? failure("uncertain")
          : failure("service_unavailable"),
    );
    let peer: WindowPreferencePeer | undefined = { request } as unknown as WindowPreferencePeer;
    const preferences = new WindowPreferences(() => peer, failed, 1);
    await preferences.save(bounds);
    const id = request.mock.calls.find(([operation]) => operation === "bounds.replace");
    expect(id).toBeDefined();
    await preferences.save(bounds);
    expect(request.mock.calls.filter(([operation]) => operation === "bounds.replace")).toHaveLength(
      1,
    );
    peer = undefined;
    await preferences.reconcilePending();
    const recovered = vi.fn(async () => ({
      ok: true,
      value: { state: "recorded", outcome: { ok: true, value: record() } },
    }));
    peer = { request: recovered } as unknown as WindowPreferencePeer;
    await preferences.reconcilePending();
    expect(recovered).toHaveBeenCalledWith("bounds.receipt", {
      targetOperationId: (request.mock.calls as unknown[][]).find(
        (call) => call[0] === "bounds.replace",
      )?.[2],
    });
    await preferences.reconcilePending();
    expect(recovered).toHaveBeenCalledOnce();
  });
});

it("records only controlled diagnostics for failed close writes and rejected original receipts", async () => {
  const failed = vi.fn();
  let mode = "read";
  const request = vi.fn(async (operation: string) => {
    if (mode === "throw") throw new Error("Synthetic unavailable peer");
    if (operation === "bounds.read")
      return mode === "read" ? failure("storage_failed") : { ok: true, value: record(null, 0) };
    if (operation === "bounds.replace")
      return failure(mode === "receipt" ? "uncertain" : "storage_failed");
    return { ok: true, value: { state: "recorded", outcome: staleRevision(2) } };
  });
  const preferences = new WindowPreferences(
    () => ({ request }) as unknown as WindowPreferencePeer,
    failed,
    4,
  );
  await preferences.save(bounds);
  expect(request).toHaveBeenCalledOnce();
  mode = "write";
  await preferences.save(bounds);
  mode = "receipt";
  await preferences.save(bounds);
  mode = "throw";
  await preferences.save(bounds);
  expect(failed).toHaveBeenCalledTimes(4);
  expect(request.mock.calls.filter(([operation]) => operation === "bounds.replace")).toHaveLength(
    2,
  );
});

it("forgets a prior generation's explicit theme until the replacement confirms its preference", () => {
  const theme = new WindowTheme("linux", () => false);
  theme.confirm({ schemaVersion: 1, revision: 5, value: "dark", source: "saved" });
  expect(theme.scheme()).toBe("dark");
  theme.reset();
  expect(theme.scheme()).toBe("light");
  theme.confirm({ schemaVersion: 1, revision: 1, value: "dark", source: "saved" });
  expect(theme.scheme()).toBe("dark");
});

it("retires a missing uncertain receipt only after the original writer ceases, without replay", async () => {
  let ceased = false;
  const original = {
    get ceased() {
      return ceased;
    },
    request: vi.fn(async (operation: string) =>
      operation === "bounds.read"
        ? { ok: true, value: record(null, 0) }
        : operation === "bounds.replace"
          ? failure("uncertain")
          : { ok: true, value: { state: "not_found" } },
    ),
  } as unknown as WindowPreferencePeer;
  const request = vi.fn(async (operation: string) =>
    operation === "bounds.read"
      ? { ok: true, value: record(null, 0) }
      : operation === "bounds.replace"
        ? { ok: true, value: record() }
        : { ok: true, value: { state: "not_found" } },
  );
  let peer = original;
  const failed = vi.fn();
  const preferences = new WindowPreferences(() => peer, failed, 1);
  await preferences.save(bounds);
  peer = { request } as unknown as WindowPreferencePeer;
  await preferences.reconcilePending();
  await preferences.save(bounds);
  expect(request.mock.calls.some(([operation]) => operation === "bounds.replace")).toBe(false);
  ceased = true;
  await preferences.reconcilePending();
  const calls = request.mock.calls.length;
  await preferences.reconcilePending();
  expect(request).toHaveBeenCalledTimes(calls);
  await preferences.save(bounds);
  expect(request.mock.calls.filter(([operation]) => operation === "bounds.replace")).toHaveLength(
    1,
  );
  expect(
    vi.mocked(original.request).mock.calls.filter(([operation]) => operation === "bounds.replace"),
  ).toHaveLength(1);
  // One unresolved outcome diagnostic plus the distinct capacity refusal, never one per lookup.
  expect(failed).toHaveBeenCalledTimes(2);
});

it("requests saved size and maximization on Wayland without exposing a coordinate restoration or cascade", () => {
  const saved = { ...bounds, x: 5000, y: -5000, maximized: true };
  const placement = windowPlacement(saved, [primary, secondary], primary, bounds, "wayland");
  expect(placement).toEqual({ x: 0, y: 0, width: 800, height: 600, maximized: true });
  const options = windowOptions("linux", "dark", placement, true);
  expect(options).not.toHaveProperty("x");
  expect(options).not.toHaveProperty("y");
  expect(options).toMatchObject({ width: 800, height: 600, show: false });
  expect(windowPlacement(null, [primary], primary, undefined, "wayland")).toMatchObject({
    x: 0,
    y: 0,
    width: 1280,
    height: 800,
    maximized: false,
  });
});
