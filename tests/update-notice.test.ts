// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceChrome } from "../packages/renderer/src/workspace-chrome.js";
import { CommandController } from "../packages/renderer/src/command-controller.js";
import { CommandSurfaces } from "../packages/renderer/src/command-surfaces.js";
import { LayoutPreferences } from "../packages/renderer/src/layout-preferences.js";
import { UpdateController } from "../packages/renderer/src/update-controller.js";
import { UpdateCheckController } from "../packages/renderer/src/update-check-controller.js";
import { UpdateCheckSetting } from "../packages/renderer/src/update-check-setting.js";
import {
  failure,
  message,
  type AboutInformation,
  type CommandBridge,
  type CommandIntent,
  type FoundationPort,
  type UpdateCheckRecord,
  type UpdateRoute,
  type UpdateState,
  type UpdateStateNotice,
} from "../packages/contracts/src/index.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root, container: HTMLDivElement;
const call = <T>(value: T) => ({ result: Promise.resolve(value), cancel() {} });
const idle: UpdateState = {
  installedVersion: "0.2.0",
  check: "idle",
  failure: null,
  available: null,
};
const newer = (version = "0.3.0", notes = ["Fixes"]): UpdateState => ({
  installedVersion: "0.2.0",
  check: "checked",
  failure: null,
  available: { version, notes, notesTruncated: false },
});
const info: AboutInformation = {
  product: "Ohtia",
  version: "0.2.0",
  build: "sha256:abc123",
  platform: "linux",
  architecture: "x86-64",
  copyright: "Copyright",
  license: "MIT License",
  notices: [],
};

/** A window's update sources: main's pushes, its port reads and its command bridge. */
function sources(route: UpdateRoute = "software_centre", initial: UpdateState = idle) {
  const listeners = new Set<(notice: UpdateStateNotice) => void>();
  let sequence = 0;
  let current: UpdateState = initial;
  const port = {
    readUpdate: vi.fn(() =>
      call({ ok: true as const, value: { sequence, state: current } as UpdateStateNotice }),
    ),
    checkForUpdate: vi.fn(() => {
      // Like main's broker: a build that cannot check answers its unchanged state.
      if (current.check === "unavailable")
        return call({ ok: true as const, value: { sequence, state: current } });
      current = { ...current, check: "checking", failure: null };
      sequence++;
      return call({ ok: true as const, value: { sequence, state: current } });
    }),
  };
  let intent: ((intent: CommandIntent) => void) | undefined;
  let intents = 0;
  const commands: CommandBridge = {
    context: vi.fn(async () => ({ windowGeneration: "window-1", platform: "linux" as const })),
    publish: vi.fn(async () => true),
    readExitState: async () => null,
    onExitState: () => () => {},
    chooseExit: vi.fn(async () => true),
    onIntent: vi.fn((next) => {
      intent = next;
      return () => {};
    }),
    about: vi.fn(async () => info),
    copyVersionInformation: vi.fn(async () => true),
    windowAction: vi.fn(async () => ({ status: "completed" as const })),
    perform: vi.fn(async () => true),
    openLink: vi.fn(async () => true),
    openNoticeLink: vi.fn(async () => true),
    openExternalLink: vi.fn(async () => true),
    copyMessage: vi.fn(async () => true),
    updateRoute: vi.fn(async () => route),
    openUpdateRoute: vi.fn(async () => true),
  };
  const controller = new UpdateController(
    {
      subscribeState: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    port as unknown as FoundationPort,
    commands,
  );
  return {
    port,
    commands,
    controller,
    push: async (state: UpdateState, at = sequence + 1) => {
      sequence = Math.max(sequence, at);
      current = state;
      await act(async () => {
        for (const listener of listeners) listener({ sequence: at, state });
      });
    },
    send: async (command: CommandIntent["command"]) =>
      act(async () =>
        intent?.({ windowGeneration: "window-1", source: "native", sequence: ++intents, command }),
      ),
  };
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect() {}
      observe() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("update state in one window", () => {
  it("keeps the notice with the highest sequence, whichever arrives first", async () => {
    const test = sources();
    test.controller.start();
    await act(async () => {});
    expect(test.controller.snapshot()).toMatchObject({
      route: "software_centre",
      notice: { sequence: 0, state: idle },
    });
    await test.push(newer("0.4.0"), 5);
    await test.push(newer("0.3.0"), 4);
    expect(test.controller.snapshot().notice).toEqual({ sequence: 5, state: newer("0.4.0") });
    test.controller.dispose();
  });
  it("reports a route that could not be opened and clears it on the next attempt", async () => {
    const test = sources();
    vi.mocked(test.commands.openUpdateRoute).mockResolvedValueOnce(false);
    expect(await test.controller.openRoute()).toBe(false);
    expect(test.controller.snapshot().openFailed).toBe(true);
    expect(await test.controller.openRoute()).toBe(true);
    expect(test.controller.snapshot().openFailed).toBe(false);
  });
});

describe("title-bar update button", () => {
  function chrome(test: ReturnType<typeof sources>, writing = false) {
    const commands = new CommandController(
      { windowGeneration: "chrome-window", platform: "linux" },
      "en-US",
    );
    const run = vi.fn(() => true);
    commands.register("update.check", { state: () => ({}), run });
    const preferences = new LayoutPreferences(
      {
        readLayout: () =>
          call({
            ok: true as const,
            value: { schemaVersion: 1, revision: 0, source: "missing", value: null },
          }),
        replaceLayout: () => call(failure("service_unavailable")),
        readLayoutReceipt: () =>
          call({ ok: true as const, value: { state: "not_found" as const } }),
        claimLayoutFailureNotice: () => call({ ok: true as const, value: { announce: false } }),
      } as unknown as FoundationPort,
      () => "operation",
      () => {},
    );
    const render = (hold: boolean) =>
      act(async () =>
        root.render(
          h(WorkspaceChrome, {
            preferences,
            commands,
            locale: "en-US",
            windowInsets: { start: 0, end: 0 },
            updates: test.controller,
            writing: hold,
          }),
        ),
      );
    return { run, render: async (hold = writing) => render(hold) };
  }
  const updateButton = () =>
    container.querySelector<HTMLButtonElement>('[data-workspace-command="update.check"]');

  it("appears only for a newer version, quietly, in neutral tokens with the download icon", async () => {
    const test = sources();
    test.controller.start();
    const view = chrome(test);
    await view.render();
    expect(updateButton()).toBeNull();
    await test.push({ ...idle, check: "checked" });
    expect(updateButton()).toBeNull();
    await test.push(newer());
    const control = updateButton()!;
    expect(control.getAttribute("aria-label")).toBe("Ohtia 0.3.0 is available");
    expect(control.className).toBe("workspace-control");
    expect(control.closest(".workspace-title-row")).not.toBeNull();
    expect(control.querySelector("svg")!.outerHTML).toContain("M12 15V3");
    expect(container.querySelector(".activity-badge, [class*='attention']")).toBeNull();
    expect(document.querySelector("dialog[open], [role=alert]")).toBeNull();
    await act(async () => control.click());
    expect(view.run).toHaveBeenCalledOnce();
    test.controller.dispose();
  });
  it("neither appears nor changes while the researcher writes, and shows the state afterwards", async () => {
    const test = sources();
    test.controller.start();
    const view = chrome(test, true);
    await view.render(true);
    await test.push(newer("0.3.0"));
    expect(updateButton()).toBeNull();
    await view.render(false);
    expect(updateButton()!.getAttribute("aria-label")).toBe("Ohtia 0.3.0 is available");
    await view.render(true);
    await test.push(newer("0.4.0"));
    expect(updateButton()!.getAttribute("aria-label")).toBe("Ohtia 0.3.0 is available");
    await view.render(false);
    expect(updateButton()!.getAttribute("aria-label")).toBe("Ohtia 0.4.0 is available");
    test.controller.dispose();
  });
});

describe("update dialog and About", () => {
  async function surfaces(test: ReturnType<typeof sources>) {
    test.controller.start();
    await act(async () =>
      root.render(
        h(CommandSurfaces, { bridge: test.commands, locale: "en-US", updates: test.controller }),
      ),
    );
  }
  const dialog = () => container.querySelector<HTMLDialogElement>(".update-dialog")!;
  const buttonNamed = (text: string, scope: ParentNode = container) =>
    [...scope.querySelectorAll("button")].find((node) => node.textContent === text);

  it("checks on request and shows versions, literal notes and the software centre on Linux", async () => {
    const test = sources("software_centre");
    await surfaces(test);
    await test.send("update.check");
    expect(test.port.checkForUpdate).toHaveBeenCalledOnce();
    expect(dialog().hasAttribute("open")).toBe(true);
    expect(dialog().querySelector("h2")!.textContent).toBe("Ohtia updates");
    expect(dialog().querySelector("[role=status]")!.textContent).toBe("Checking for updates…");
    await test.push(newer("0.3.0", ["<b>Bold</b> & <script>alert(1)</script>\n- item"]));
    const notes = dialog().querySelector(".update-notes")!;
    expect(notes.textContent).toBe("<b>Bold</b> & <script>alert(1)</script>\n- item");
    expect(notes.querySelector("b, script, li")).toBeNull();
    expect(notes.getAttribute("role")).toBe("region");
    expect(notes.getAttribute("aria-labelledby")).toBe(dialog().querySelector("h3")!.id);
    expect(dialog().textContent).toContain("Installed version0.2.0");
    expect(dialog().textContent).toContain("New version0.3.0");
    expect(dialog().textContent).toContain(message("en-US", "update.how.system"));
    expect(buttonNamed("Open download page", dialog())).toBeUndefined();
    await act(async () => buttonNamed("Open software updates", dialog())!.click());
    expect(test.commands.openUpdateRoute).toHaveBeenCalledOnce();
    expect(dialog().querySelector("[role=alert]")).toBeNull();
  });
  it("offers the official download page on Windows and macOS", async () => {
    const test = sources("download_page", newer());
    await surfaces(test);
    await test.send("update.check");
    await test.push(newer());
    expect(dialog().textContent).toContain(message("en-US", "update.how.download"));
    expect(dialog().textContent).toContain(message("en-US", "about.external"));
    expect(buttonNamed("Open software updates", dialog())).toBeUndefined();
    vi.mocked(test.commands.openUpdateRoute).mockResolvedValueOnce(false);
    await act(async () => buttonNamed("Open download page", dialog())!.click());
    expect(dialog().querySelector("[role=alert]")!.textContent).toBe(
      message("en-US", "command.failed"),
    );
  });
  it("only explains the system update when Linux has no known software centre", async () => {
    const test = sources("system");
    await surfaces(test);
    await test.send("update.check");
    await test.push(newer());
    expect(dialog().textContent).toContain(message("en-US", "update.how.system"));
    expect(dialog().querySelectorAll(".update-route button")).toHaveLength(0);
  });
  it("reports a failed manual check with a way to try again, and the latest version", async () => {
    const test = sources();
    await surfaces(test);
    await test.send("update.check");
    await test.push({ ...idle, check: "failed", failure: "timeout" });
    expect(dialog().querySelector("[role=alert]")!.textContent).toBe(
      message("en-US", "update.failed.timeout"),
    );
    await act(async () => buttonNamed("Try again", dialog())!.click());
    expect(test.port.checkForUpdate).toHaveBeenCalledTimes(2);
    await test.push({ ...idle, check: "checked" });
    expect(dialog().querySelector("[role=status]")!.textContent).toBe(
      message("en-US", "update.current"),
    );
    expect(dialog().textContent).not.toContain(message("en-US", "update.new"));
  });
  it("says a development build does not check", async () => {
    const test = sources("system", { ...idle, check: "unavailable" });
    await surfaces(test);
    await test.send("update.check");
    expect(dialog().querySelector("[role=status]")!.textContent).toBe(
      message("en-US", "update.unavailable"),
    );
    expect(dialog().textContent).not.toContain(message("en-US", "update.privacy"));
  });
  it("shows the newer version and its route in About, without the notes", async () => {
    const test = sources("software_centre");
    await surfaces(test);
    await test.push(newer("0.3.0", ["Secret notes"]));
    await test.send("about.open");
    const about = container.querySelector(".about-dialog")!;
    expect(about.querySelector(".about-update")!.textContent).toContain(
      "Ohtia 0.3.0 is available.",
    );
    expect(about.textContent).not.toContain("Secret notes");
    await act(async () => buttonNamed("Open software updates", about)!.click());
    expect(test.commands.openUpdateRoute).toHaveBeenCalledOnce();
  });
  it("adds no update section to About while no newer version is known", async () => {
    const test = sources();
    await surfaces(test);
    await test.send("about.open");
    expect(container.querySelector(".about-update")).toBeNull();
  });
});

describe("startup check setting", () => {
  function preference(record: UpdateCheckRecord) {
    let current = record;
    const port = {
      readUpdateCheck: vi.fn(() => call({ ok: true as const, value: current })),
      replaceUpdateCheck: vi.fn((change: { expectedRevision: number; value: boolean }) => {
        current = {
          schemaVersion: 1,
          revision: change.expectedRevision + 1,
          value: change.value,
          source: "saved",
        };
        return call({ ok: true as const, value: current });
      }),
      readUpdateCheckReceipt: vi.fn(() =>
        call({ ok: true as const, value: { state: "not_found" as const } }),
      ),
    };
    return {
      port,
      controller: new UpdateCheckController(port as unknown as FoundationPort, () => "op-1"),
    };
  }
  const box = () => container.querySelector<HTMLInputElement>(".update-check-setting input")!;

  it("is enabled by default and saves the researcher's choice with its revision", async () => {
    const test = preference({ schemaVersion: 1, revision: 0, value: true, source: "default" });
    await act(async () =>
      root.render(
        h(UpdateCheckSetting, { controller: test.controller, locale: "en-US", available: true }),
      ),
    );
    expect(box().checked).toBe(true);
    expect(container.querySelector("label")!.textContent).toBe(
      message("en-US", "settings.updateCheck"),
    );
    expect(box().getAttribute("aria-describedby")).toBe(container.querySelector("p")!.id);
    await act(async () => box().click());
    expect(test.port.replaceUpdateCheck).toHaveBeenCalledWith({
      operationId: "op-1",
      expectedRevision: 0,
      value: false,
    });
    expect(box().checked).toBe(false);
    expect(container.textContent).toContain("Saved");
  });
  it("reconciles an uncertain save through its receipt, never by sending it again", async () => {
    const test = preference({ schemaVersion: 1, revision: 2, value: true, source: "saved" });
    test.port.replaceUpdateCheck.mockReturnValueOnce(call(failure("uncertain")) as never);
    await act(async () =>
      root.render(
        h(UpdateCheckSetting, { controller: test.controller, locale: "en-US", available: true }),
      ),
    );
    await act(async () => box().click());
    expect(box().getAttribute("aria-disabled")).toBe("true");
    test.port.readUpdateCheckReceipt.mockReturnValueOnce(
      call({
        ok: true as const,
        value: {
          state: "recorded" as const,
          outcome: {
            ok: true as const,
            value: {
              schemaVersion: 1 as const,
              revision: 3,
              value: false,
              source: "saved" as const,
            },
          },
        },
      }) as never,
    );
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Check")!.click(),
    );
    expect(test.port.replaceUpdateCheck).toHaveBeenCalledOnce();
    expect(box().checked).toBe(false);
  });
  it("shows another window's newer value after a stale revision", async () => {
    const test = preference({ schemaVersion: 1, revision: 1, value: true, source: "saved" });
    test.port.replaceUpdateCheck.mockImplementationOnce(
      () =>
        call({
          ok: false as const,
          error: { code: "stale_revision" as const, parameters: { currentRevision: 2 } },
        }) as never,
    );
    test.port.readUpdateCheck
      .mockReturnValueOnce(
        call({
          ok: true as const,
          value: { schemaVersion: 1, revision: 1, value: true, source: "saved" },
        }) as never,
      )
      .mockReturnValueOnce(
        call({
          ok: true as const,
          value: { schemaVersion: 1, revision: 2, value: false, source: "saved" },
        }) as never,
      );
    await act(async () =>
      root.render(
        h(UpdateCheckSetting, { controller: test.controller, locale: "en-US", available: true }),
      ),
    );
    await act(async () => box().click());
    expect(container.textContent).toContain(
      message("en-US", "settings.conflict", { setting: message("en-US", "settings.updates") }),
    );
    expect(box().checked).toBe(false);
  });
});

describe("update controllers at their edges", () => {
  it("ignores pushes, checks and routes after disposal, and reports a thrown check or route", async () => {
    const test = sources();
    test.controller.start();
    test.controller.start();
    expect(test.port.readUpdate).toHaveBeenCalledOnce();
    test.port.checkForUpdate.mockImplementationOnce(() => ({
      result: Promise.reject(new Error("transport")),
      cancel() {},
    }));
    expect(await test.controller.check()).toBe(false);
    vi.mocked(test.commands.openUpdateRoute).mockRejectedValueOnce(new Error("transport"));
    expect(await test.controller.openRoute()).toBe(false);
    expect(test.controller.snapshot().openFailed).toBe(true);
    test.controller.dispose();
    const before = test.controller.snapshot();
    await test.push(newer("0.9.0"));
    expect(test.controller.snapshot()).toBe(before);
    expect(await test.controller.check()).toBe(false);
    expect(await test.controller.openRoute()).toBe(false);
    test.controller.start();
    expect(test.port.readUpdate).toHaveBeenCalledOnce();
  });
  it("omits the route control until main names the route", async () => {
    const test = sources();
    vi.mocked(test.commands.updateRoute).mockRejectedValueOnce(new Error("transport"));
    test.controller.start();
    await act(async () =>
      root.render(
        h(CommandSurfaces, { bridge: test.commands, locale: "en-US", updates: test.controller }),
      ),
    );
    await test.send("update.check");
    await test.push(newer());
    expect(container.querySelector(".update-dialog .update-route")).toBeNull();
    expect(container.querySelector(".update-dialog .update-notes")).not.toBeNull();
  });

  function preference() {
    let current: UpdateCheckRecord = {
      schemaVersion: 1,
      revision: 1,
      value: true,
      source: "saved",
    };
    const port = {
      readUpdateCheck: vi.fn(() => call({ ok: true as const, value: current })),
      replaceUpdateCheck: vi.fn(() => call(failure("uncertain"))),
      readUpdateCheckReceipt: vi.fn(() =>
        call({ ok: true as const, value: { state: "pending" as const } }),
      ),
    };
    const controller = new UpdateCheckController(port as unknown as FoundationPort, () => "op-2");
    return {
      port,
      controller,
      set: (record: UpdateCheckRecord) => {
        current = record;
      },
    };
  }
  it("keeps an uncertain save while its receipt is pending and settles a missing or refused one", async () => {
    const test = preference();
    await test.controller.refresh();
    expect(await test.controller.choose(false)).toBe(false);
    expect(test.controller.snapshot().phase).toBe("uncertain");
    expect(await test.controller.choose(true)).toBe(false);
    await test.controller.check();
    expect(test.controller.snapshot()).toMatchObject({ phase: "uncertain", draft: false });
    test.port.readUpdateCheckReceipt.mockReturnValueOnce(
      call({ ok: true as const, value: { state: "not_found" as const } }) as never,
    );
    await test.controller.check();
    expect(test.controller.snapshot()).toMatchObject({ phase: "rejected", draft: true });
    await test.controller.check();
    expect(test.port.readUpdateCheckReceipt).toHaveBeenCalledTimes(2);
    expect(await test.controller.choose(false)).toBe(false);
    test.port.readUpdateCheckReceipt.mockReturnValueOnce(
      call({
        ok: true as const,
        value: {
          state: "recorded" as const,
          outcome: {
            ok: false as const,
            error: { code: "stale_revision" as const, parameters: { currentRevision: 4 } },
          },
        },
      }) as never,
    );
    test.set({ schemaVersion: 1, revision: 4, value: false, source: "saved" });
    await test.controller.check();
    expect(test.controller.snapshot()).toMatchObject({ phase: "conflict", draft: false });
  });
  it("ignores an older record, reports a failed read with Refresh, and stops after disposal", async () => {
    const test = preference();
    await test.controller.refresh();
    test.set({ schemaVersion: 1, revision: 0, value: false, source: "default" });
    await test.controller.refresh();
    expect(test.controller.snapshot().current?.revision).toBe(1);
    test.port.readUpdateCheck.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await act(async () =>
      root.render(
        h(UpdateCheckSetting, { controller: test.controller, locale: "en-US", available: true }),
      ),
    );
    const refresh = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === message("en-US", "refresh"),
    )!;
    expect(container.querySelector("[role=alert]")!.textContent).toContain(
      message("en-US", "settings.readFailed"),
    );
    await act(async () => refresh.click());
    expect(container.querySelector("[role=alert]")).toBeNull();
    test.controller.dispose();
    await test.controller.refresh();
    expect(await test.controller.choose(false)).toBe(false);
    await test.controller.check();
    expect(test.port.readUpdateCheck).toHaveBeenCalledTimes(4);
  });
  it("ignores a save that answers after disposal", async () => {
    const test = preference();
    await test.controller.refresh();
    let answer!: (value: unknown) => void;
    test.port.replaceUpdateCheck.mockReturnValueOnce({
      result: new Promise((resolve) => {
        answer = resolve;
      }),
      cancel() {},
    } as never);
    const saving = test.controller.choose(false);
    test.controller.dispose();
    answer({ ok: true, value: { schemaVersion: 1, revision: 2, value: false, source: "saved" } });
    expect(await saving).toBe(true);
    expect(test.controller.snapshot().phase).toBe("submitting");
  });
});

describe("review corrections", () => {
  const dialog = () => container.querySelector<HTMLDialogElement>(".update-dialog")!;
  async function surfaces(test: ReturnType<typeof sources>) {
    test.controller.start();
    await act(async () =>
      root.render(
        h(CommandSurfaces, { bridge: test.commands, locale: "en-US", updates: test.controller }),
      ),
    );
  }
  it("reports a check that main refused, with Try again, in an alert apart from the status", async () => {
    const test = sources();
    test.port.checkForUpdate.mockImplementationOnce(() => call(failure("busy")) as never);
    await surfaces(test);
    await test.send("update.check");
    const status = dialog().querySelector(".update-status")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("");
    expect(dialog().querySelector("[role=alert]")!.textContent).toBe(
      message("en-US", "command.failed"),
    );
    const retry = [...dialog().querySelectorAll("button")].find(
      (button) => button.textContent === "Try again",
    )!;
    await act(async () => retry.click());
    expect(test.port.checkForUpdate).toHaveBeenCalledTimes(2);
    expect(dialog().querySelector("[role=alert]")).toBeNull();
    expect(dialog().querySelector(".update-status")).toBe(status);
    expect(status.textContent).toBe(message("en-US", "update.checking"));
  });
  it("opens a dialog without the failure of an earlier one", async () => {
    const test = sources("software_centre");
    await surfaces(test);
    await test.push(newer());
    vi.mocked(test.commands.openUpdateRoute).mockResolvedValueOnce(false);
    await test.send("about.open");
    const open = () =>
      [...document.querySelectorAll<HTMLButtonElement>("dialog[open] button")].find(
        (button) => button.textContent === "Open software updates",
      )!;
    await act(async () => open().click());
    expect(container.querySelector(".about-dialog [role=alert]")).not.toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".about-dialog [data-close]")!.click(),
    );
    await test.send("update.check");
    await test.push(newer());
    expect(dialog().querySelector(".update-route [role=alert]")).toBeNull();
  });
  it("shows the newest record when a confirmed receipt is older than another window's save", async () => {
    let current: UpdateCheckRecord = {
      schemaVersion: 1,
      revision: 1,
      value: true,
      source: "saved",
    };
    const port = {
      readUpdateCheck: vi.fn(() => call({ ok: true as const, value: current })),
      replaceUpdateCheck: vi.fn(() => call(failure("uncertain"))),
      readUpdateCheckReceipt: vi.fn(() =>
        call({
          ok: true as const,
          value: {
            state: "recorded" as const,
            outcome: {
              ok: true as const,
              value: {
                schemaVersion: 1 as const,
                revision: 2,
                value: false,
                source: "saved" as const,
              },
            },
          },
        }),
      ),
    };
    const controller = new UpdateCheckController(port as unknown as FoundationPort, () => "op-3");
    await controller.refresh();
    await controller.choose(false);
    current = { schemaVersion: 1, revision: 3, value: true, source: "saved" };
    await controller.refresh();
    port.readUpdateCheck.mockReturnValueOnce(call(failure("storage_failed")) as never);
    await controller.check();
    expect(controller.snapshot()).toMatchObject({
      phase: "conflict",
      draft: true,
      current: { revision: 3, value: true },
    });
  });
});

describe("round-2 review corrections", () => {
  it("names the conflict when the read after a receipt first shows another window's save", async () => {
    let current: UpdateCheckRecord = {
      schemaVersion: 1,
      revision: 1,
      value: true,
      source: "saved",
    };
    const port = {
      readUpdateCheck: vi.fn(() => call({ ok: true as const, value: current })),
      replaceUpdateCheck: vi.fn(() => call(failure("uncertain"))),
      readUpdateCheckReceipt: vi.fn(() => {
        // Another window saves after this receipt was recorded, before the following read.
        current = { schemaVersion: 1, revision: 3, value: true, source: "saved" };
        return call({
          ok: true as const,
          value: {
            state: "recorded" as const,
            outcome: {
              ok: true as const,
              value: {
                schemaVersion: 1 as const,
                revision: 2,
                value: false,
                source: "saved" as const,
              },
            },
          },
        });
      }),
    };
    const controller = new UpdateCheckController(port as unknown as FoundationPort, () => "op-4");
    await controller.refresh();
    await controller.choose(false);
    await controller.check();
    expect(controller.snapshot()).toMatchObject({
      phase: "conflict",
      readFailed: false,
      draft: true,
      current: { revision: 3, value: true },
    });
  });
  it("replaces a refused request's alert with a newer state from main", async () => {
    const test = sources();
    test.port.checkForUpdate.mockImplementationOnce(() => call(failure("busy")) as never);
    test.controller.start();
    await act(async () =>
      root.render(
        h(CommandSurfaces, { bridge: test.commands, locale: "en-US", updates: test.controller }),
      ),
    );
    await test.send("update.check");
    const dialog = container.querySelector(".update-dialog")!;
    expect(dialog.querySelector("[role=alert]")).not.toBeNull();
    await test.push(newer("0.3.0"));
    expect(dialog.querySelector("[role=alert]")).toBeNull();
    expect(dialog.querySelector(".update-status")!.textContent).toBe("Ohtia 0.3.0 is available.");
  });
});

describe("round-3 review correction", () => {
  it("never labels this window's own later save as another window's conflict", async () => {
    let current: UpdateCheckRecord = {
      schemaVersion: 1,
      revision: 1,
      value: true,
      source: "saved",
    };
    let answerRead!: (value: unknown) => void;
    const port = {
      readUpdateCheck: vi.fn(() => call({ ok: true as const, value: current })),
      replaceUpdateCheck: vi.fn((change: { expectedRevision: number; value: boolean }) => {
        current = {
          schemaVersion: 1,
          revision: change.expectedRevision + 1,
          value: change.value,
          source: "saved",
        };
        return call({ ok: true as const, value: current });
      }),
      readUpdateCheckReceipt: vi.fn(() =>
        call({
          ok: true as const,
          value: {
            state: "recorded" as const,
            outcome: {
              ok: true as const,
              value: {
                schemaVersion: 1 as const,
                revision: 2,
                value: false,
                source: "saved" as const,
              },
            },
          },
        }),
      ),
    };
    const controller = new UpdateCheckController(port as unknown as FoundationPort, () => "op-5");
    await controller.refresh();
    port.replaceUpdateCheck.mockReturnValueOnce(call(failure("uncertain")) as never);
    await controller.choose(false);
    current = { schemaVersion: 1, revision: 2, value: false, source: "saved" };
    // The read after the receipt waits while this window saves again.
    port.readUpdateCheck.mockReturnValueOnce({
      result: new Promise((resolve) => {
        answerRead = resolve;
      }),
      cancel() {},
    } as never);
    const checking = controller.check();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot().phase).toBe("confirmed");
    expect(await controller.choose(true)).toBe(true);
    expect(controller.snapshot()).toMatchObject({ phase: "confirmed", current: { revision: 3 } });
    answerRead({ ok: true, value: current });
    await checking;
    expect(controller.snapshot()).toMatchObject({
      phase: "confirmed",
      draft: true,
      current: { revision: 3, value: true },
    });
  });
});

describe("round-4 review correction", () => {
  it("names another window's save that follows this window's later save", async () => {
    let current: UpdateCheckRecord = {
      schemaVersion: 1,
      revision: 1,
      value: true,
      source: "saved",
    };
    let answerRead!: (value: unknown) => void;
    const port = {
      readUpdateCheck: vi.fn(() => call({ ok: true as const, value: current })),
      replaceUpdateCheck: vi.fn((change: { expectedRevision: number; value: boolean }) => {
        current = {
          schemaVersion: 1,
          revision: change.expectedRevision + 1,
          value: change.value,
          source: "saved",
        };
        return call({ ok: true as const, value: current });
      }),
      readUpdateCheckReceipt: vi.fn(() =>
        call({
          ok: true as const,
          value: {
            state: "recorded" as const,
            outcome: {
              ok: true as const,
              value: {
                schemaVersion: 1 as const,
                revision: 2,
                value: false,
                source: "saved" as const,
              },
            },
          },
        }),
      ),
    };
    const controller = new UpdateCheckController(port as unknown as FoundationPort, () => "op-6");
    await controller.refresh();
    port.replaceUpdateCheck.mockReturnValueOnce(call(failure("uncertain")) as never);
    await controller.choose(false);
    current = { schemaVersion: 1, revision: 2, value: false, source: "saved" };
    port.readUpdateCheck.mockReturnValueOnce({
      result: new Promise((resolve) => {
        answerRead = resolve;
      }),
      cancel() {},
    } as never);
    const checking = controller.check();
    await Promise.resolve();
    await Promise.resolve();
    expect(await controller.choose(true)).toBe(true);
    // Another window then saves the opposite value, and the delayed read returns it.
    answerRead({
      ok: true,
      value: { schemaVersion: 1, revision: 4, value: false, source: "saved" },
    });
    await checking;
    expect(controller.snapshot()).toMatchObject({
      phase: "conflict",
      draft: false,
      current: { revision: 4, value: false },
    });
  });
});
