import { designMetrics } from "../packages/renderer/src/design-tokens.js";
import { workspaceMinimums } from "../packages/contracts/src/index.js";
import { describe, expect, it, vi } from "vitest";
import {
  decodeEnvelope,
  decodeLayoutChange,
  failure,
  isWorkspaceLayout,
  staleRevision,
  workspacePanels,
  type FoundationPort,
  type LayoutChange,
  type LayoutRecord,
  type LayoutReceipt,
  type Outcome,
  type SavedLayoutRecord,
  type WorkspaceLayout,
} from "../packages/contracts/src/index.js";
import {
  defaultWorkspaceLayout,
  resolveWorkspaceLayout,
  separatorRange,
  resetWorkspacePair,
  transferWorkspaceWidth,
  readingWidth,
  workspaceWidth,
} from "../packages/renderer/src/workspace-geometry.js";
import {
  WorkspaceController,
  type ResizeCancelReason,
} from "../packages/renderer/src/workspace-controller.js";
import { LayoutPreferences } from "../packages/renderer/src/layout-preferences.js";
import { request } from "./fixtures/port-corpus.js";
const defaults = defaultWorkspaceLayout(1280);
function call<T>(value: Outcome<T>) {
  return { result: Promise.resolve(value), cancel: vi.fn() };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const result = new Promise<T>((done) => {
    resolve = done;
  });
  return { result, resolve, cancel: vi.fn() };
}
function harness(
  width = 1280,
  record: LayoutRecord = { schemaVersion: 1, revision: 0, source: "default", value: null },
) {
  let latest = record;
  let notice = false;
  const port = {
    readLayout: vi.fn(() => call({ ok: true, value: latest })),
    replaceLayout: vi.fn((change: LayoutChange) => {
      latest = {
        schemaVersion: 1,
        revision: change.expectedRevision + 1,
        source: "saved",
        value: change.value,
      };
      return call({ ok: true, value: latest as SavedLayoutRecord });
    }),
    readLayoutReceipt: vi.fn(() =>
      call<LayoutReceipt>({ ok: true, value: { state: "not_found" } }),
    ),
    claimLayoutFailureNotice: vi.fn(() => {
      const announce = !notice;
      notice = true;
      return call({ ok: true, value: { announce } });
    }),
  };
  const announce = vi.fn();
  let id = 0;
  const preferences = new LayoutPreferences(
    port as unknown as FoundationPort,
    () => `layout-${++id}`,
    announce,
  );
  const changed = vi.fn();
  const focus = vi.fn();
  const controller = new WorkspaceController(preferences, width, false, changed, focus);
  return { port, preferences, controller, announce, changed, focus };
}
async function flush() {
  for (let n = 0; n < 8; n++) await Promise.resolve();
}
describe("workspace layout schema and deterministic geometry", () => {
  it("uses canonical reading metrics and numerical allocations", () => {
    expect(readingWidth).toBe(652);
    for (const panel of workspacePanels)
      expect(workspaceMinimums[panel]).toBe(designMetrics[`component.workspace.${panel}.minimum`]);
    for (const [width, expected] of [
      [1440, [256, 816, 360]],
      [1280, [256, 656, 360]],
      [1024, [200, 536, 280]],
    ] as const) {
      const geometry = resolveWorkspaceLayout(defaultWorkspaceLayout(width), width);
      expect(workspacePanels.map((panel) => geometry.widths[panel])).toEqual(expected);
    }
    expect(defaultWorkspaceLayout(600)).toEqual(defaults);
    for (const width of [NaN, Infinity, -1, Number.MAX_VALUE])
      expect(() => workspaceWidth(width)).toThrow();
  });
  it("preserves minima and exact sums in all seven visibility combinations, rail sizes and fractional inputs", () => {
    for (let mask = 1; mask < 8; mask++)
      for (const coarse of [false, true])
        for (const width of [1024, 1280.95, 1440, 2111.5]) {
          const layout = {
            ...defaultWorkspaceLayout(width),
            visible: { explorer: !!(mask & 1), documents: !!(mask & 2), chat: !!(mask & 4) },
            preferredWidths: { explorer: 333.5, documents: 611.7, chat: 399.4 },
          };
          const original = structuredClone(layout);
          const g = resolveWorkspaceLayout(layout, width, coarse);
          expect(
            g.widths.explorer + g.widths.documents + g.widths.chat + g.rail + 4 * g.pairs.length,
          ).toBe(Math.floor(width));
          for (const [panel, min] of [
            ["explorer", 200],
            ["documents", 320],
            ["chat", 280],
          ] as const)
            expect(g.widths[panel]).toBeGreaterThanOrEqual(layout.visible[panel] ? min : 0);
          expect(layout).toEqual(original);
          if (mask === 1) expect(g.widths.explorer).toBe(Math.floor(width));
          if (mask === 2 || mask === 4)
            expect(g.widths[mask === 2 ? "documents" : "chat"]).toBe(
              Math.floor(width) - (coarse ? 48 : 40),
            );
        }
  });
  it("resolves hiding, restoring and constrained reopening without changing preferences", () => {
    const layout = defaultWorkspaceLayout(1440);
    expect(
      resolveWorkspaceLayout(
        { ...layout, visible: { explorer: true, documents: false, chat: true } },
        1440,
      ).widths,
    ).toEqual({ explorer: 256, documents: 0, chat: 1180 });
    expect(resolveWorkspaceLayout(layout, 1440).widths.documents).toBe(816);
    const wide: WorkspaceLayout = {
      ...layout,
      preferredWidths: { explorer: 400, documents: 652, chat: 600 },
    };
    expect(resolveWorkspaceLayout(wide, 1440, false, "documents", "chat").widths).toEqual({
      explorer: 200,
      documents: 652,
      chat: 580,
    });
    expect(resolveWorkspaceLayout(wide, 1440, false, "documents", "explorer").widths).toEqual({
      explorer: 400,
      documents: 652,
      chat: 380,
    });
    const below = { ...layout, preferredWidths: { explorer: 500, documents: 400, chat: 500 } };
    expect(resolveWorkspaceLayout(below, 1024).widths).toEqual({
      explorer: 336,
      documents: 400,
      chat: 280,
    });
  });
  it("enforces exact private-data-free schemas while allowing finite fractional widths", () => {
    const valid = {
      ...defaults,
      preferredWidths: { explorer: 256.5, documents: 100000, chat: 280 },
    };
    expect(isWorkspaceLayout(valid)).toBe(true);
    expect(decodeLayoutChange({ operationId: "op", expectedRevision: 0, value: valid }).ok).toBe(
      true,
    );
    for (const value of [
      null,
      { version: 1, visible: defaults.visible, widths: defaults.preferredWidths },
      [],
      {},
      { ...defaults, version: 2 },
      { ...defaults, path: "private" },
      { ...defaults, visible: { explorer: false, documents: false, chat: false } },
      { ...defaults, visible: { ...defaults.visible, chat: 1 } },
      { ...defaults, preferredWidths: { ...defaults.preferredWidths, explorer: 199 } },
      { ...defaults, preferredWidths: { ...defaults.preferredWidths, chat: Infinity } },
      { ...defaults, preferredWidths: { ...defaults.preferredWidths, documents: 100001 } },
      { ...defaults, preferredWidths: { ...defaults.preferredWidths, documents: NaN } },
      { ...defaults, preferredWidths: { ...defaults.preferredWidths, secret: 333 } },
      Object.create(null),
      Object.defineProperty({ ...defaults }, "version", {
        get() {
          throw new Error("Never read");
        },
      }),
    ]) {
      expect(isWorkspaceLayout(value)).toBe(false);
      expect(decodeLayoutChange({ operationId: "op", expectedRevision: 0, value }).ok).toBe(false);
    }
    for (const change of [
      null,
      {},
      { operationId: "op", expectedRevision: -1, value: defaults },
      { operationId: "op", expectedRevision: 0, value: defaults, private: true },
    ])
      expect(decodeLayoutChange(change).ok).toBe(false);
    for (const operation of [
      "layout.read",
      "layout.replace",
      "layout.receipt",
      "layout.failureNotice",
    ] as const) {
      const payload =
        operation === "layout.replace"
          ? { expectedRevision: 0, value: valid }
          : operation === "layout.receipt"
            ? { targetOperationId: "op" }
            : {};
      expect(decodeEnvelope(request({ operation, payload } as never)).ok).toBe(true);
    }
  });
  it("keeps adjacent resizing extrema and pair reset oracles independent of the third panel", () => {
    const g = resolveWorkspaceLayout(defaultWorkspaceLayout(1024), 1024);
    expect(separatorRange(g, "explorer", "documents")).toEqual({
      minimum: 200,
      current: 200,
      maximum: 416,
    });
    expect(separatorRange(g, "documents", "chat")).toEqual({
      minimum: 320,
      current: 536,
      maximum: 536,
    });
    expect(separatorRange(g, "explorer", "chat")).toBeUndefined();
    expect(transferWorkspaceWidth(g, "explorer", "chat", 5)).toBe(g);
    expect(transferWorkspaceWidth(g, "explorer", "documents", NaN)).toBe(g);
    expect(transferWorkspaceWidth(g, "explorer", "documents", 9999).widths).toEqual({
      explorer: 416,
      documents: 320,
      chat: 280,
    });
    for (const [width, docs, chat] of [
      [1280, 500, 516],
      [1024, 320, 496],
    ]) {
      const initial = resolveWorkspaceLayout(defaultWorkspaceLayout(width), width);
      const moved = { ...initial, widths: { ...initial.widths, documents: docs, chat } };
      expect(resetWorkspacePair(moved, "documents", "chat").widths).toEqual(initial.widths);
    }
    const hidden = resolveWorkspaceLayout(
      {
        ...defaultWorkspaceLayout(1440),
        visible: { explorer: true, documents: false, chat: true },
      },
      1440,
    );
    expect(
      resetWorkspacePair(
        { ...hidden, widths: { explorer: 700, documents: 0, chat: 736 } },
        "explorer",
        "chat",
      ).widths,
    ).toEqual(hidden.widths);
    expect(resetWorkspacePair(g, "explorer", "chat")).toBe(g);
  });
});
describe("per-window workspace controller", () => {
  it("does not persist viewport, focus, narrow selection or canceled interactions", async () => {
    const h = harness();
    await h.controller.initialize();
    h.controller.focusMode();
    expect(h.controller.state.geometry.widths.documents).toBe(1240);
    h.controller.viewport(1440);
    h.controller.focusMode();
    expect(h.controller.state.geometry.widths.documents).toBe(816);
    h.controller.viewport(600, false, "chat");
    expect(h.controller.state.geometry.widths.chat).toBe(600);
    h.controller.select("explorer");
    h.controller.viewport(320);
    h.controller.viewport(1280);
    expect(h.controller.state.preference).toEqual(defaults);
    expect(h.port.replaceLayout).not.toHaveBeenCalled();
    expect(h.controller.select("chat").applied).toBe(false);
    h.controller.dispose();
    h.controller.viewport(600);
    expect(h.controller.reset().applied).toBe(false);
  });
  it("defaults to documents on narrow creation, drops focus snapshots and restores underlying wide preferences", async () => {
    const h = harness(320);
    await h.controller.initialize();
    expect(h.controller.state.geometry.widths.documents).toBe(320);
    expect(h.controller.focusMode().applied).toBe(false);
    expect(h.controller.size("documents", true).applied).toBe(false);
    h.controller.viewport(1280);
    h.controller.focusMode();
    h.controller.viewport(600);
    expect(h.controller.state.focusMode).toBe(false);
    h.controller.viewport(1280);
    expect(h.controller.state.preference.visible).toEqual(defaults.visible);
    h.controller.viewport(600);
    h.controller.select("chat");
    h.controller.reset();
    await flush();
    expect(h.controller.state.geometry.widths.documents).toBe(600);
    expect(h.port.replaceLayout.mock.calls[0]?.[0].value).toEqual(defaults);
  });
  it("preserves hidden preferred widths and handles last panel and focus restoration", async () => {
    const h = harness(1440);
    await h.controller.initialize();
    h.controller.visibility("documents", "documents");
    await flush();
    expect(h.focus).toHaveBeenLastCalledWith({ target: "panel-control", panel: "documents" });
    expect(h.controller.state.geometry.widths.chat).toBe(1180);
    expect(h.port.replaceLayout.mock.calls[0]?.[0].value.preferredWidths.documents).toBe(816);
    h.controller.visibility("documents");
    await flush();
    expect(h.controller.state.geometry.widths.documents).toBe(816);
    h.controller.focusMode();
    h.controller.visibility("chat");
    await flush();
    expect(h.controller.state.focusMode).toBe(false);
    h.controller.visibility("chat");
    await flush();
    expect(h.controller.visibility("documents").reason).toBe("last_panel");
    expect(h.controller.size("documents", true).applied).toBe(false);
    h.controller.viewport(600);
    h.controller.select("explorer");
    h.controller.viewport(1280);
    expect(h.focus).toHaveBeenLastCalledWith({ target: "panel-control", panel: "explorer" });
  });
  it("supports keyboard, buttons, pair reset and retains hidden preferences on resize", async () => {
    const h = harness(1024);
    await h.controller.initialize();
    for (const key of ["End", "Home", "ArrowRight", "ArrowLeft", "Enter"] as const) {
      h.controller.key("explorer", "documents", key, true);
      await flush();
      expect(h.controller.state.geometry.widths.chat).toBe(280);
    }
    h.controller.key("documents", "chat", "Home");
    await flush();
    expect(h.controller.state.geometry.widths.chat).toBe(496);
    h.controller.pairReset("documents", "chat");
    await flush();
    expect(h.controller.state.geometry.widths.chat).toBe(280);
    h.controller.size("documents", false);
    await flush();
    h.controller.size("chat", true);
    await flush();
    h.controller.size("chat", false);
    await flush();
    h.controller.size("explorer", true);
    await flush();
    expect(h.controller.key("explorer", "chat", "Home").applied).toBe(false);
    h.controller.visibility("documents");
    await flush();
    const hidden = h.controller.state.preference.preferredWidths.documents;
    h.controller.pairReset("explorer", "chat");
    await flush();
    expect(h.controller.state.preference.preferredWidths.documents).toBe(hidden);
    const exported = h.controller.state;
    (exported.preference.preferredWidths as any).chat = 999;
    expect(h.controller.state.preference.preferredWidths.chat).not.toBe(999);
  });
  it("captures only the initiating pointer and commits once only on release", async () => {
    const h = harness();
    await h.controller.initialize();
    const host = { capture: vi.fn(), release: vi.fn(), lock: vi.fn(), unlock: vi.fn() };
    expect(h.controller.beginResize("explorer", "documents", 1, 100, host)).toBe(true);
    expect(h.controller.beginResize("documents", "chat", 2, 100, host)).toBe(false);
    expect(h.controller.state.transitions).toBe(false);
    h.controller.moveResize(2, 500);
    expect(h.controller.endResize(2).applied).toBe(false);
    h.controller.moveResize(1, 164);
    expect(h.controller.state.geometry.widths.explorer).toBe(320);
    expect(h.controller.key("explorer", "documents", "End").applied).toBe(false);
    expect(h.controller.pairReset("explorer", "documents").applied).toBe(false);
    expect(h.controller.size("explorer", true).applied).toBe(false);
    expect(h.port.replaceLayout).not.toHaveBeenCalled();
    h.controller.endResize(1);
    await flush();
    expect(h.port.replaceLayout).toHaveBeenCalledOnce();
    expect(host.release).toHaveBeenCalledWith(1);
    expect(host.unlock).toHaveBeenCalledOnce();
    expect(h.controller.state.transitions).toBe(true);
  });
  it.each<ResizeCancelReason>([
    "escape",
    "pointercancel",
    "focus-loss",
    "unmount",
    "viewport",
    "visibility",
  ])("restores start and releases locks on %s", async (reason) => {
    const h = harness();
    await h.controller.initialize();
    const start = h.controller.state.geometry;
    const host = { capture: vi.fn(), release: vi.fn(), lock: vi.fn(), unlock: vi.fn() };
    h.controller.beginResize("documents", "chat", 3, 0, host);
    h.controller.moveResize(3, -200);
    if (reason === "unmount") h.controller.dispose();
    else if (reason === "viewport") h.controller.viewport(600);
    else if (reason === "visibility") {
      h.controller.focusMode();
    } else h.controller.cancelResize(reason);
    if (!["viewport", "visibility"].includes(reason))
      expect(h.controller.state.geometry).toEqual(start);
    expect(host.release).toHaveBeenCalledOnce();
    expect(host.unlock).toHaveBeenCalledOnce();
    expect(h.port.replaceLayout).not.toHaveBeenCalled();
  });
  it("preserves transient focus choice and ignores initial reads after controller disposal", async () => {
    const h = harness();
    const pending = deferred<Outcome<LayoutRecord>>();
    h.port.readLayout.mockReturnValueOnce(pending as never);
    const initializing = h.controller.initialize();
    h.controller.focusMode();
    pending.resolve({
      ok: true,
      value: { schemaVersion: 1, revision: 4, source: "saved", value: defaults },
    });
    await initializing;
    expect(h.controller.state.focusMode).toBe(true);
    const disposed = harness();
    const read = deferred<Outcome<LayoutRecord>>();
    disposed.port.readLayout.mockReturnValueOnce(read as never);
    const loading = disposed.controller.initialize();
    disposed.controller.dispose();
    disposed.changed.mockClear();
    read.resolve({
      ok: true,
      value: { schemaVersion: 1, revision: 5, source: "saved", value: defaults },
    });
    await loading;
    expect(disposed.changed).not.toHaveBeenCalled();
  });
});
describe("layout receipt and controller lifetimes", () => {
  it("reconciles an accepted write after disposal without rearranging a newer live controller", async () => {
    const h = harness();
    await h.controller.initialize();
    const pending = deferred<Outcome<SavedLayoutRecord>>();
    h.port.replaceLayout.mockReturnValueOnce(pending as never);
    h.controller.visibility("chat");
    const change = h.port.replaceLayout.mock.calls[0]![0];
    h.controller.dispose();
    h.changed.mockClear();
    const next = new WorkspaceController(h.preferences, 1440);
    const initializing = next.initialize();
    next.focusMode();
    pending.resolve(failure("uncertain"));
    await initializing;
    await flush();
    expect(next.state.persistence.save.state).toBe("uncertain");
    h.port.readLayoutReceipt.mockReturnValueOnce(
      call({ ok: true, value: { state: "pending" } }) as never,
    );
    await h.preferences.reconcile();
    await h.preferences.reconcile();
    expect(h.port.replaceLayout).toHaveBeenCalledOnce();
    h.port.readLayoutReceipt.mockReturnValueOnce(
      call({
        ok: true,
        value: {
          state: "recorded",
          outcome: {
            ok: true,
            value: { schemaVersion: 1, source: "saved", revision: 1, value: change.value },
          },
        },
      }) as never,
    );
    await h.preferences.reconcile();
    expect(next.state.persistence.save.state).toBe("confirmed");
    expect(next.state.focusMode).toBe(true);
    expect(h.changed).not.toHaveBeenCalled();
  });
  it("keeps conflicts and failures inspectable, never automatically retries and announces only once", async () => {
    const h = harness();
    await h.controller.initialize();
    h.port.replaceLayout.mockReturnValueOnce(call(staleRevision(4)) as never);
    h.controller.visibility("chat");
    await flush();
    expect(h.controller.state.persistence.save.state).toBe("conflicting");
    expect(h.controller.state.preference.visible.chat).toBe(false);
    h.port.replaceLayout.mockReturnValueOnce(call(failure("storage_failed")) as never);
    h.controller.reset();
    await flush();
    expect(h.announce).toHaveBeenCalledOnce();
    expect(h.port.replaceLayout).toHaveBeenCalledTimes(2);
    h.port.readLayout.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await h.preferences.load();
    expect(h.controller.state.persistence.refreshError?.code).toBe("storage_failed");
  });
  it("retains success after refresh failure and rejects older snapshots", async () => {
    const h = harness();
    await h.controller.initialize();
    h.controller.visibility("chat");
    await flush();
    h.port.readLayout.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await h.preferences.load();
    expect(h.preferences.snapshot.save.state).toBe("confirmed");
    h.port.readLayout.mockReturnValueOnce(
      call({
        ok: true,
        value: { schemaVersion: 1, source: "default", revision: 0, value: null },
      }) as never,
    );
    expect((await h.preferences.load()).ok).toBe(false);
    expect(h.preferences.snapshot.refreshError?.code).toBe("invalid_service_result");
    expect(h.port.replaceLayout).toHaveBeenCalledOnce();
  });
  it("preserves uncertain identity on thrown transport and invalid receipts, blocking new writes", async () => {
    const h = harness();
    await h.controller.initialize();
    h.port.replaceLayout.mockImplementationOnce(() => {
      throw new Error("Lost reply");
    });
    h.controller.reset();
    await flush();
    expect(h.preferences.busy).toBe(true);
    expect(h.controller.reset().applied).toBe(false);
    expect(h.controller.visibility("chat").applied).toBe(false);
    expect(await h.preferences.save(defaults)).toBe(false);
    h.port.readLayoutReceipt.mockImplementationOnce(() => {
      throw new Error("Unavailable");
    });
    await h.preferences.reconcile();
    h.port.readLayoutReceipt.mockReturnValueOnce(
      call({
        ok: true,
        value: {
          state: "recorded",
          outcome: {
            ok: true,
            value: { schemaVersion: 1, source: "saved", revision: 40, value: defaults },
          },
        },
      }) as never,
    );
    await h.preferences.reconcile();
    expect(h.preferences.snapshot.save.state).toBe("uncertain");
    h.port.readLayoutReceipt.mockReturnValueOnce(
      call({ ok: true, value: { state: "recorded", outcome: staleRevision(5) } }) as never,
    );
    await h.preferences.reconcile();
    expect(h.preferences.snapshot.save.state).toBe("conflicting");
    expect(h.preferences.busy).toBe(false);
  });
  it("keeps defaults usable on load failure and handles unavailable notice ownership", async () => {
    const h = harness(600);
    h.port.readLayout.mockImplementationOnce(() => {
      throw new Error("Unavailable");
    });
    await h.controller.initialize();
    h.port.claimLayoutFailureNotice.mockImplementationOnce(() => {
      throw new Error("Unavailable");
    });
    h.port.readLayout.mockReturnValue(call(failure("service_unavailable")) as never);
    h.controller.reset();
    await flush();
    expect(h.controller.state.persistence.save.state).toBe("rejected");
    expect(h.port.replaceLayout).not.toHaveBeenCalled();
    await h.preferences.reconcile();
  });
});

describe("layout restoration boundaries", () => {
  it("loads each newly opened window from the latest record while preserving existing live layouts", async () => {
    const h = harness();
    await h.controller.initialize();
    h.controller.visibility("documents");
    await flush();
    const session = new LayoutPreferences(
      h.port as unknown as FoundationPort,
      () => "another-window",
      h.announce,
    );
    const second = new WorkspaceController(session, 1440);
    await second.initialize();
    expect(second.state.geometry.widths.chat).toBe(1180);
    second.visibility("documents");
    await flush();
    expect(h.controller.state.geometry.visible.documents).toBe(false);
    second.viewport(600);
    second.select("chat");
    second.viewport(1280);
    expect(second.state.geometry.visible.documents).toBe(true);
    h.controller.viewport(600);
    expect(h.controller.state.geometry.visible.chat).toBe(true);
  });
  it("releases cursor and selection when capture fails or has already been lost", async () => {
    const h = harness();
    await h.controller.initialize();
    const host = {
      capture: vi.fn(() => {
        throw new Error("Capture denied");
      }),
      release: vi.fn(),
      lock: vi.fn(),
      unlock: vi.fn(),
    };
    expect(h.controller.beginResize("documents", "chat", 1, 0, host)).toBe(false);
    expect(host.unlock).toHaveBeenCalledOnce();
    host.capture.mockImplementation(() => {});
    host.release.mockImplementation(() => {
      throw new Error("Already released");
    });
    expect(h.controller.beginResize("documents", "chat", 1, 0, host)).toBe(true);
    h.controller.cancelResize("pointercancel");
    expect(host.unlock).toHaveBeenCalledTimes(2);
    expect(h.port.replaceLayout).not.toHaveBeenCalled();
  });
});

describe("independent review regression schedules", () => {
  it.each(["release", "escape", "pointercancel", "focus-loss", "viewport"])(
    "adopts the saved record after an unavailable initial resize and %s",
    async (ending) => {
      const h = harness();
      const read = deferred<Outcome<LayoutRecord>>();
      h.port.readLayout.mockReturnValueOnce(read as never);
      const loading = h.controller.initialize();
      const host = { capture: vi.fn(), release: vi.fn(), lock: vi.fn(), unlock: vi.fn() };
      expect(h.controller.state.initializing).toBe(true);
      expect(h.controller.beginResize("explorer", "documents", 1, 0, host)).toBe(false);
      expect(h.controller.key("explorer", "documents", "End").applied).toBe(false);
      expect(h.controller.size("explorer", true).applied).toBe(false);
      expect(h.controller.pairReset("explorer", "documents").applied).toBe(false);
      h.controller.moveResize(1, 60);
      if (ending === "release") expect(h.controller.endResize(1).applied).toBe(false);
      else if (ending === "viewport") h.controller.viewport(1440);
      else h.controller.cancelResize(ending as ResizeCancelReason);
      const saved: WorkspaceLayout = {
        version: 1,
        visible: { explorer: true, documents: true, chat: false },
        preferredWidths: { explorer: 400, documents: 700, chat: 500 },
      };
      read.resolve({
        ok: true,
        value: { schemaVersion: 1, source: "saved", revision: 5, value: saved },
      });
      await loading;
      expect(h.controller.state.initializing).toBe(false);
      expect(h.controller.state.preference).toEqual(saved);
      expect(host.capture).not.toHaveBeenCalled();
      expect(h.port.replaceLayout).not.toHaveBeenCalled();
      h.controller.visibility("chat");
      await flush();
      expect(h.port.replaceLayout.mock.calls[0]?.[0]).toMatchObject({
        expectedRevision: 5,
        value: { preferredWidths: saved.preferredWidths },
      });
    },
  );
  it("does not save zero movement or clamped sizing and commits a double-click pair reset once", async () => {
    const h = harness(1024);
    await h.controller.initialize();
    const before = h.controller.state.preference;
    expect(h.controller.key("explorer", "documents", "Home").reason).toBe("unchanged");
    expect(h.controller.key("explorer", "documents", "ArrowLeft").reason).toBe("unchanged");
    expect(h.controller.size("explorer", false).reason).toBe("unchanged");
    const host = { capture: vi.fn(), release: vi.fn(), lock: vi.fn(), unlock: vi.fn() };
    for (let pointer = 1; pointer <= 2; pointer++) {
      h.controller.beginResize("explorer", "documents", pointer, 100, host);
      expect(h.controller.endResize(pointer).reason).toBe("unchanged");
    }
    expect(h.port.replaceLayout).not.toHaveBeenCalled();
    expect(h.controller.state.dragging).toBe(false);
    expect(h.controller.state.transitions).toBe(true);
    expect(h.controller.state.preference).toEqual(before);
    h.controller.viewport(1440);
    expect(h.controller.state.geometry.widths).toEqual({
      explorer: 256,
      documents: 816,
      chat: 360,
    });
    h.controller.pairReset("explorer", "documents");
    await flush();
    expect(h.port.replaceLayout).toHaveBeenCalledOnce();
    expect(h.controller.pairReset("explorer", "chat").applied).toBe(false);
  });
  it("does not spend the failure notice on uncertainty that later confirms", async () => {
    const h = harness();
    await h.controller.initialize();
    h.port.replaceLayout.mockReturnValueOnce(call(failure("uncertain")) as never);
    h.controller.visibility("chat");
    await flush();
    const change = h.port.replaceLayout.mock.calls[0]![0];
    expect(h.announce).not.toHaveBeenCalled();
    expect(h.port.claimLayoutFailureNotice).not.toHaveBeenCalled();
    h.port.readLayoutReceipt.mockReturnValueOnce(
      call({
        ok: true,
        value: {
          state: "recorded",
          outcome: {
            ok: true,
            value: { schemaVersion: 1, revision: 1, source: "saved", value: change.value },
          },
        },
      }) as never,
    );
    await h.preferences.reconcile();
    h.port.replaceLayout.mockReturnValueOnce(call(failure("storage_failed")) as never);
    h.controller.reset();
    await flush();
    expect(h.announce).toHaveBeenCalledOnce();
  });
  it("guards initial controller actions and shares a bounded read for an explicit complete-record intent", async () => {
    const h = harness();
    const initial = deferred<Outcome<LayoutRecord>>();
    h.port.readLayout.mockReturnValueOnce(initial as never);
    const loading = h.controller.initialize();
    expect(h.controller.visibility("chat").reason).toBe("unavailable");
    expect(h.controller.reset().reason).toBe("unavailable");
    const saved: WorkspaceLayout = {
      version: 1,
      visible: { explorer: true, documents: true, chat: false },
      preferredWidths: { explorer: 400, documents: 700, chat: 500 },
    };
    expect(h.port.replaceLayout).not.toHaveBeenCalled();
    initial.resolve({
      ok: true,
      value: { schemaVersion: 1, revision: 4, source: "saved", value: saved },
    });
    await loading;
    expect(h.controller.state.preference).toEqual(saved);
    h.controller.visibility("explorer");
    await flush();
    expect(h.port.replaceLayout.mock.calls[0]?.[0].value.preferredWidths).toEqual(
      saved.preferredWidths,
    );
    expect(h.announce).not.toHaveBeenCalled();
    const direct = harness();
    const read = deferred<Outcome<LayoutRecord>>();
    direct.port.readLayout.mockReturnValueOnce(read as never);
    const load = direct.preferences.load();
    const write = direct.preferences.save(defaults);
    expect(direct.preferences.busy).toBe(true);
    expect(direct.port.readLayout).toHaveBeenCalledOnce();
    read.resolve({
      ok: true,
      value: { schemaVersion: 1, revision: 7, source: "saved", value: saved },
    });
    await load;
    expect(await write).toBe(true);
    expect(direct.port.replaceLayout.mock.calls[0]?.[0].expectedRevision).toBe(7);
    const failed = harness(1280, { schemaVersion: 1, revision: 5, source: "saved", value: saved });
    failed.port.readLayout.mockReturnValueOnce(call(failure("service_unavailable")) as never);
    await failed.controller.initialize();
    expect(failed.controller.state.preference).toEqual(defaults);
    expect(failed.port.replaceLayout).not.toHaveBeenCalled();
    failed.controller.visibility("chat");
    await flush();
    expect(failed.port.readLayout).toHaveBeenCalledTimes(2);
    expect(failed.port.replaceLayout.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: 5,
      value: {
        preferredWidths: defaults.preferredWidths,
        visible: { explorer: true, documents: true, chat: false },
      },
    });
    expect(failed.announce).not.toHaveBeenCalled();
  });
  it("keeps an inconsistent success uncertain in both its state and return value", async () => {
    const h = harness();
    await h.controller.initialize();
    h.port.replaceLayout.mockReturnValueOnce(
      call({
        ok: true,
        value: { schemaVersion: 1, source: "saved", revision: 99, value: defaults },
      }) as never,
    );
    expect(await h.preferences.save(defaults)).toBe(false);
    expect(h.preferences.snapshot.save.state).toBe("uncertain");
    expect(h.announce).not.toHaveBeenCalled();
  });
  it("restores narrow Reset focus before hiding the outgoing panel and tolerates failed cleanup", async () => {
    const h = harness(600);
    await h.controller.initialize();
    h.controller.select("chat");
    h.focus.mockClear();
    h.focus.mockImplementationOnce(() =>
      expect(h.controller.state.geometry.visible.chat).toBe(true),
    );
    expect(h.controller.reset("chat").focus).toEqual({ target: "panel-control", panel: "chat" });
    await flush();
    expect(h.controller.state.geometry.visible.documents).toBe(true);
    h.controller.viewport(1280);
    const host = {
      capture: vi.fn(() => {
        throw new Error("Capture failed");
      }),
      release: vi.fn(() => {
        throw new Error("Release failed");
      }),
      lock: vi.fn(),
      unlock: vi.fn(() => {
        throw new Error("Unlock failed");
      }),
    };
    expect(h.controller.beginResize("documents", "chat", 2, 0, host)).toBe(false);
    expect(host.release).toHaveBeenCalledOnce();
    expect(host.unlock).toHaveBeenCalledOnce();
  });
});

it("adopts late underlying wide preferences without replacing narrow selection or focus mode", async () => {
  const saved: WorkspaceLayout = {
    version: 1,
    visible: { explorer: true, documents: false, chat: true },
    preferredWidths: { explorer: 400, documents: 700, chat: 500 },
  };
  for (const mode of ["narrow", "focus"]) {
    const h = harness(mode === "narrow" ? 600 : 1280);
    const read = deferred<Outcome<LayoutRecord>>();
    h.port.readLayout.mockReturnValueOnce(read as never);
    const loading = h.controller.initialize();
    if (mode === "narrow") h.controller.select("chat");
    else h.controller.focusMode();
    read.resolve({
      ok: true,
      value: { schemaVersion: 1, revision: 9, source: "saved", value: saved },
    });
    await loading;
    if (mode === "narrow") {
      expect(h.controller.state.geometry.visible.chat).toBe(true);
      h.controller.viewport(1280);
    } else {
      expect(h.controller.state.focusMode).toBe(true);
      expect(h.controller.state.geometry.visible.documents).toBe(true);
      h.controller.focusMode();
    }
    expect(h.controller.state.preference).toEqual(saved);
    expect(h.port.replaceLayout).not.toHaveBeenCalled();
  }
});

it("initializes once and never rereads or replaces an edited layout through repeated initialization", async () => {
  const h = harness();
  const read = deferred<Outcome<LayoutRecord>>();
  h.port.readLayout.mockReturnValueOnce(read as never);
  const first = h.controller.initialize();
  const again = h.controller.initialize();
  expect(again).toBe(first);
  expect(h.port.readLayout).toHaveBeenCalledOnce();
  const saved: WorkspaceLayout = {
    version: 1,
    visible: { explorer: true, documents: true, chat: false },
    preferredWidths: { explorer: 400, documents: 700, chat: 500 },
  };
  read.resolve({
    ok: true,
    value: { schemaVersion: 1, revision: 3, source: "saved", value: saved },
  });
  await first;
  const write = deferred<Outcome<SavedLayoutRecord>>();
  h.port.replaceLayout.mockReturnValueOnce(write as never);
  h.controller.visibility("chat");
  const live = h.controller.state.preference;
  expect(h.controller.initialize()).toBe(first);
  await h.controller.initialize();
  expect(h.controller.state.preference).toEqual(live);
  expect(h.port.readLayout).toHaveBeenCalledOnce();
  write.resolve(failure("uncertain"));
  await flush();
  await h.controller.initialize();
  expect(h.controller.state.preference).toEqual(live);
  expect(h.port.readLayout).toHaveBeenCalledOnce();
  expect(h.preferences.snapshot.save.state).toBe("uncertain");
  const ready = harness();
  await ready.controller.initialize();
  const host = { capture: vi.fn(), release: vi.fn(), lock: vi.fn(), unlock: vi.fn() };
  ready.controller.beginResize("explorer", "documents", 1, 0, host);
  ready.controller.moveResize(1, 60);
  await ready.controller.initialize();
  expect(ready.controller.state.dragging).toBe(true);
  ready.controller.endResize(1);
  await flush();
  expect(ready.port.replaceLayout).toHaveBeenCalledOnce();
});

it("gives a replacement controller a fresh read after a confirmed write overtakes an old refresh", async () => {
  const value: WorkspaceLayout = {
    version: 1,
    visible: { explorer: true, documents: true, chat: false },
    preferredWidths: { explorer: 400, documents: 700, chat: 500 },
  };
  const h = harness(1280, { schemaVersion: 1, revision: 3, source: "saved", value });
  await h.controller.initialize();
  const old = deferred<Outcome<LayoutRecord>>();
  h.port.readLayout.mockReturnValueOnce(old as never);
  const refresh = h.preferences.load();
  h.controller.visibility("chat");
  await flush();
  const confirmed = h.port.replaceLayout.mock.calls[0]![0].value;
  expect(h.preferences.snapshot.save.state).toBe("confirmed");
  h.controller.dispose();
  const fresh = deferred<Outcome<LayoutRecord>>();
  h.port.readLayout.mockReturnValueOnce(fresh as never);
  const replacement = new WorkspaceController(h.preferences, 1440);
  const loading = replacement.initialize();
  expect(h.port.readLayout).toHaveBeenCalledTimes(3);
  old.resolve({ ok: true, value: { schemaVersion: 1, revision: 3, source: "saved", value } });
  expect(replacement.state.initializing).toBe(true);
  fresh.resolve({
    ok: true,
    value: { schemaVersion: 1, revision: 4, source: "saved", value: confirmed },
  });
  await loading;
  expect((await refresh).ok).toBe(true);
  expect(replacement.state.preference).toEqual(confirmed);
  expect(replacement.state.persistence.refreshError).toBeUndefined();
  replacement.visibility("explorer");
  await flush();
  expect(h.port.replaceLayout.mock.calls[1]?.[0]).toMatchObject({
    expectedRevision: 4,
    value: { preferredWidths: value.preferredWidths },
  });
});
it("does not coalesce a new refresh into a read started before a confirmed write", async () => {
  const h = harness();
  await h.controller.initialize();
  const old = deferred<Outcome<LayoutRecord>>();
  h.port.readLayout.mockReturnValueOnce(old as never);
  const first = h.preferences.load();
  h.controller.visibility("chat");
  await flush();
  const fresh = h.preferences.load();
  expect(h.port.readLayout).toHaveBeenCalledTimes(3);
  expect((await fresh).ok).toBe(true);
  old.resolve({
    ok: true,
    value: { schemaVersion: 1, revision: 0, source: "default", value: null },
  });
  expect((await first).ok).toBe(true);
  expect(h.preferences.snapshot.refreshError).toBeUndefined();
  h.controller.dispose();
  const before = h.port.readLayout.mock.calls.length;
  const disposed = new WorkspaceController(h.preferences, 1280);
  disposed.dispose();
  await disposed.initialize();
  expect(h.port.readLayout).toHaveBeenCalledTimes(before);
});

describe("read supersession consumers", () => {
  const saved: WorkspaceLayout = {
    version: 1,
    visible: { explorer: true, documents: true, chat: false },
    preferredWidths: { explorer: 400, documents: 700, chat: 500 },
  };
  it.each(["old-first", "new-first"])(
    "keeps save admission alive when a replacement read supersedes it: %s",
    async (order) => {
      const h = harness(1280, { schemaVersion: 1, revision: 5, source: "saved", value: saved });
      h.port.readLayout.mockReturnValueOnce(call(failure("service_unavailable")) as never);
      await h.controller.initialize();
      const old = deferred<Outcome<LayoutRecord>>(),
        fresh = deferred<Outcome<LayoutRecord>>();
      h.port.readLayout.mockReturnValueOnce(old as never).mockReturnValueOnce(fresh as never);
      h.controller.visibility("chat");
      h.controller.dispose();
      const replacement = new WorkspaceController(h.preferences, 1440);
      const loading = replacement.initialize();
      const result: Outcome<LayoutRecord> = {
        ok: true,
        value: { schemaVersion: 1, revision: 5, source: "saved", value: saved },
      };
      if (order === "old-first") {
        old.resolve(result);
        await Promise.resolve();
        fresh.resolve(result);
      } else {
        fresh.resolve(result);
        await Promise.resolve();
        old.resolve(result);
      }
      await loading;
      await flush();
      expect(h.port.replaceLayout).toHaveBeenCalledOnce();
      expect(h.preferences.snapshot.save.state).toBe("confirmed");
      expect(h.announce).not.toHaveBeenCalled();
      expect(h.port.replaceLayout.mock.calls[0]?.[0].expectedRevision).toBe(5);
    },
  );
  it.each(["old-first", "new-first"])(
    "forwards an initializing reader to the newer completed refresh: %s",
    async (order) => {
      const h = harness(1280, { schemaVersion: 1, revision: 3, source: "saved", value: saved });
      await h.controller.initialize();
      const write = deferred<Outcome<SavedLayoutRecord>>();
      h.port.replaceLayout.mockReturnValueOnce(write as never);
      h.controller.visibility("chat");
      const changed = h.port.replaceLayout.mock.calls[0]![0].value;
      h.controller.dispose();
      const old = deferred<Outcome<LayoutRecord>>(),
        fresh = deferred<Outcome<LayoutRecord>>();
      h.port.readLayout.mockReturnValueOnce(old as never).mockReturnValueOnce(fresh as never);
      const replacement = new WorkspaceController(h.preferences, 1440);
      const loading = replacement.initialize();
      expect(h.port.readLayout).toHaveBeenCalledOnce();
      write.resolve({
        ok: true,
        value: { schemaVersion: 1, revision: 4, source: "saved", value: changed },
      });
      await flush();
      expect(h.port.readLayout).toHaveBeenCalledTimes(2);
      const refresh = h.preferences.load(true);
      const result: Outcome<LayoutRecord> = {
        ok: true,
        value: { schemaVersion: 1, revision: 4, source: "saved", value: changed },
      };
      if (order === "old-first") {
        old.resolve({
          ok: true,
          value: { schemaVersion: 1, revision: 3, source: "saved", value: saved },
        });
        await Promise.resolve();
        fresh.resolve(result);
      } else {
        fresh.resolve(result);
        await Promise.resolve();
        old.resolve({
          ok: true,
          value: { schemaVersion: 1, revision: 3, source: "saved", value: saved },
        });
      }
      await Promise.all([loading, refresh]);
      expect(replacement.state.preference).toEqual(changed);
      expect(replacement.state.persistence.refreshError).toBeUndefined();
      expect(h.port.replaceLayout).toHaveBeenCalledOnce();
    },
  );
  it("uses a newer confirmed model when an earlier refresh returns late", async () => {
    const h = harness(1280, { schemaVersion: 1, revision: 3, source: "saved", value: saved });
    await h.controller.initialize();
    const old = deferred<Outcome<LayoutRecord>>();
    h.port.readLayout.mockReturnValueOnce(old as never);
    const refresh = h.preferences.load();
    h.controller.visibility("chat");
    await flush();
    const changed = h.port.replaceLayout.mock.calls[0]![0].value;
    old.resolve({
      ok: true,
      value: { schemaVersion: 1, revision: 3, source: "saved", value: saved },
    });
    expect(await refresh).toMatchObject({ ok: true, value: { revision: 4, value: changed } });
    expect(h.preferences.snapshot.refreshError).toBeUndefined();
    const model = h.preferences.readModel!;
    (model.value!.preferredWidths as any).chat = 999;
    expect(h.preferences.readModel!.value!.preferredWidths.chat).toBe(500);
  });
  it.each(["direct", "receipt"])(
    "refreshes a read overtaken by a revision-only conflict: %s",
    async (route) => {
      const h = harness(1280, { schemaVersion: 1, revision: 3, source: "saved", value: saved });
      await h.controller.initialize();
      const old = deferred<Outcome<LayoutRecord>>();
      h.port.readLayout.mockReturnValueOnce(old as never);
      const refresh = h.preferences.load();
      h.port.replaceLayout.mockReturnValueOnce(
        call(route === "direct" ? staleRevision(4) : failure("uncertain")) as never,
      );
      h.controller.visibility("chat");
      await flush();
      if (route === "receipt") {
        h.port.readLayoutReceipt.mockReturnValueOnce(
          call({ ok: true, value: { state: "recorded", outcome: staleRevision(4) } }) as never,
        );
        await h.preferences.reconcile();
      }
      const live = h.controller.state.preference;
      h.port.readLayout.mockReturnValueOnce(
        call({
          ok: true,
          value: { schemaVersion: 1, revision: 4, source: "saved", value: saved },
        }) as never,
      );
      old.resolve({
        ok: true,
        value: { schemaVersion: 1, revision: 3, source: "saved", value: saved },
      });
      expect(await refresh).toMatchObject({ ok: true, value: { revision: 4, value: saved } });
      expect(h.preferences.snapshot.save.state).toBe("conflicting");
      expect(h.preferences.snapshot.refreshError).toBeUndefined();
      expect(h.controller.state.preference).toEqual(live);
      expect(h.port.readLayout).toHaveBeenCalledTimes(3);
      expect(h.port.replaceLayout).toHaveBeenCalledOnce();
    },
  );
  it("bounds conflict recovery to one read and reports continued contention accurately", async () => {
    const h = harness(1280, { schemaVersion: 1, revision: 3, source: "saved", value: saved });
    await h.controller.initialize();
    const old = deferred<Outcome<LayoutRecord>>(),
      recovery = deferred<Outcome<LayoutRecord>>();
    h.port.readLayout.mockReturnValueOnce(old as never).mockReturnValueOnce(recovery as never);
    const refresh = h.preferences.load();
    h.port.replaceLayout.mockReturnValueOnce(call(staleRevision(4)) as never);
    h.controller.visibility("chat");
    await flush();
    old.resolve({
      ok: true,
      value: { schemaVersion: 1, revision: 3, source: "saved", value: saved },
    });
    await flush();
    expect(h.port.readLayout).toHaveBeenCalledTimes(3);
    h.port.replaceLayout.mockReturnValueOnce(call(staleRevision(5)) as never);
    h.controller.visibility("explorer");
    await flush();
    recovery.resolve({
      ok: true,
      value: { schemaVersion: 1, revision: 4, source: "saved", value: saved },
    });
    expect(await refresh).toEqual(staleRevision(5));
    expect(h.preferences.snapshot.refreshError?.code).toBe("stale_revision");
    expect(h.port.readLayout).toHaveBeenCalledTimes(3);
    expect(h.port.replaceLayout).toHaveBeenCalledTimes(2);
    h.port.readLayout.mockReturnValueOnce(
      call({
        ok: true,
        value: { schemaVersion: 1, revision: 5, source: "saved", value: saved },
      }) as never,
    );
    expect((await h.preferences.load()).ok).toBe(true);
    expect(h.preferences.snapshot.refreshError).toBeUndefined();
  });
  it("releases a failed-write read barrier before the failure-notice claim completes", async () => {
    const h = harness();
    await h.controller.initialize();
    const write = deferred<Outcome<SavedLayoutRecord>>();
    const notice = deferred<Outcome<{ announce: boolean }>>();
    h.port.replaceLayout.mockReturnValueOnce(write as never);
    h.port.claimLayoutFailureNotice.mockReturnValueOnce(notice as never);
    const saving = h.preferences.save(defaults);
    const refresh = h.preferences.load(true);
    expect(h.port.readLayout).toHaveBeenCalledOnce();
    write.resolve(failure("storage_failed"));
    expect((await refresh).ok).toBe(true);
    expect(h.port.readLayout).toHaveBeenCalledTimes(2);
    expect(h.announce).not.toHaveBeenCalled();
    notice.resolve({ ok: true, value: { announce: true } });
    expect(await saving).toBe(false);
    expect(h.announce).toHaveBeenCalledOnce();
  });
});
