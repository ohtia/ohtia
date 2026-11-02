import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandController,
  presentationReason,
} from "../packages/renderer/src/command-controller.js";
import {
  commandDefinitions,
  commandIds,
  isCommandContext,
  isCommandIntent,
  isCommandSnapshot,
  isAboutInformation,
  message,
  supportedLocales,
  type CommandId,
  type CommandIntent,
} from "../packages/contracts/src/index.js";
import {
  copyVersionInformation,
  readAboutInformation,
  versionInformation,
} from "../packages/main/src/about.js";
import { checkColorUsage } from "../tooling/design-usage.mjs";
import { checkTokens } from "../tooling/design-tokens.mjs";
const context = { windowGeneration: "window-one", platform: "linux" as const };
const intent = (command: CommandId, sequence = 1): CommandIntent => ({
  windowGeneration: context.windowGeneration,
  source: "native",
  sequence,
  command,
});
afterEach(() => {
  vi.doUnmock("electron");
});

describe("named command registration and causal dispatch", () => {
  it("keeps future handlers unavailable and registers the complete platform inventory without reserved editor or AltGr shortcuts", async () => {
    const controller = new CommandController(context, "en-US");
    expect(controller.snapshot().entries).toHaveLength(commandIds.length);
    for (const command of commandDefinitions) {
      expect(message("ko-KR", command.label)).not.toBe("");
      expect(controller.entry(command.id).reason).toBe("handler_missing");
      for (const keys of Object.values(command.shortcuts))
        expect(keys.some((key) => /Ctrl\+Alt|Cmd\+K|Ctrl\+K|Cmd\+B|Ctrl\+B/.test(key))).toBe(false);
    }
    expect(commandDefinitions.find((c) => c.id === "window.close")!.shortcuts.darwin).toEqual([
      "Cmd+W",
    ]);
    expect(await controller.receive(intent("settings.open"))).toEqual({
      status: "unavailable",
      reason: "handler_missing",
    });
    expect(
      await controller.receive({ ...intent("settings.open"), windowGeneration: "other" }),
    ).toEqual({ status: "stale_context" });
    expect(
      await controller.receive({ ...intent("settings.open"), command: "research.confirm" }),
    ).toEqual({ status: "unknown_command" });
    const state = vi.fn(() => ({ checked: true }));
    const run = vi.fn(() => true);
    const dispose = controller.register("settings.open", { state, run });
    expect(() => controller.register("settings.open", { state, run })).toThrow(
      /registration refused/,
    );
    expect(controller.entry("settings.open")).toEqual({ id: "settings.open", checked: true });
    await controller.invoke("settings.open");
    expect(run).toHaveBeenCalledOnce();
    dispose();
    dispose();
    expect(controller.entry("settings.open").reason).toBe("handler_missing");
    const listener = vi.fn();
    const off = controller.subscribe(listener);
    controller.setLocale("es-AR");
    off();
    expect(controller.snapshot().locale).toBe("es-AR");
    expect(listener).toHaveBeenCalledOnce();
    controller.dispose();
    controller.changed();
    controller.subscribe(listener)();
    expect(() => controller.register("help.open", { state, run })).toThrow();
    expect(await controller.invoke("help.open")).toEqual({ status: "revoked" });
  });
  it("executes one intent once across duplicates, rejects reordered payloads and revokes late handler callbacks", async () => {
    const controller = new CommandController(context, "en-US");
    let release!: (value: boolean) => void;
    const run = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const dispose = controller.register("window.new", { state: () => ({}), run });
    const first = controller.receive(intent("window.new"));
    expect(controller.receive(intent("window.new"))).toBe(first);
    await Promise.resolve();
    expect(run).toHaveBeenCalledOnce();
    expect(await controller.receive(intent("help.open"))).toEqual({ status: "stale_intent" });
    dispose();
    release(true);
    expect(await first).toEqual({ status: "revoked" });
    const later = vi.fn(() => true);
    controller.register("window.new", { state: () => ({}), run: later });
    expect(await controller.receive(intent("window.new", 2))).toEqual({ status: "completed" });
    expect(await controller.receive(intent("window.new", 1))).toEqual({ status: "stale_intent" });
    expect(later).toHaveBeenCalledOnce();
    const never = vi.fn();
    controller.register("help.open", { state: () => ({}), run: never });
    const pending = controller.receive(intent("help.open", 3));
    controller.dispose();
    expect(await pending).toEqual({ status: "revoked" });
    expect(never).not.toHaveBeenCalled();
  });
  it("rechecks availability at execution, controls handler failures and keeps presentation separate from permission", async () => {
    const controller = new CommandController(context, "en-US");
    let busy = false;
    const run = vi.fn(() => true);
    const dispose = controller.register("zoom.increase", {
      state: () => (busy ? { reason: "busy" } : {}),
      run,
    });
    const call = controller.invoke("zoom.increase");
    busy = true;
    expect(await call).toEqual({ status: "unavailable", reason: "busy" });
    expect(run).not.toHaveBeenCalled();
    dispose();
    controller.register("zoom.increase", { state: () => ({}), run: () => false });
    expect(await controller.invoke("zoom.increase")).toEqual({ status: "failed" });
    controller.register("zoom.decrease", {
      state: () => ({}),
      run: () => {
        throw new Error("controlled");
      },
    });
    expect(await controller.invoke("zoom.decrease")).toEqual({ status: "failed" });
    for (const [id, state, reason] of [
      ["palette.open", { modal: true, composing: false, editable: true }, "modal_open"],
      ["help.open", { modal: false, composing: true, editable: true }, "composing"],
      ["edit.undo", { modal: false, composing: false, editable: false }, "no_edit_target"],
      ["edit.copy", { modal: true, composing: true, editable: true }, undefined],
    ] as const)
      expect(presentationReason(id, state)).toBe(reason);
  });
});

describe("closed command boundary decoding", () => {
  it("requires exact contexts, monotonic identities and one complete bounded registry projection", () => {
    const controller = new CommandController(context, "en-US");
    const snapshot = controller.snapshot();
    expect(isCommandContext(context)).toBe(true);
    expect(isCommandContext({ ...context, extra: 1 })).toBe(false);
    expect(isCommandIntent(intent("help.open"))).toBe(true);
    for (const value of [
      null,
      [],
      { ...intent("help.open"), sequence: 0 },
      { ...intent("help.open"), source: "content" },
      { ...intent("help.open"), extra: true },
      { ...intent("help.open"), windowGeneration: "bad id" },
    ])
      expect(isCommandIntent(value)).toBe(false);
    expect(isCommandSnapshot(snapshot)).toBe(true);
    for (const value of [
      null,
      { ...snapshot, extra: 1 },
      { ...snapshot, revision: -1 },
      { ...snapshot, locale: "zz-ZZ" },
      { ...snapshot, entries: [] },
      { ...snapshot, entries: snapshot.entries.map(() => snapshot.entries[0]) },
      { ...snapshot, entries: snapshot.entries.map((entry) => ({ ...entry, reason: "invented" })) },
      { ...snapshot, entries: snapshot.entries.map((entry) => ({ ...entry, checked: 1 })) },
    ])
      expect(isCommandSnapshot(value)).toBe(false);
  });
  it("reads actual artifact/license identity and copies only the displayed localized version and system after confirmation", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-about-"));
    try {
      fs.mkdirSync(path.join(directory, "licenses"));
      fs.copyFileSync("LICENSE", path.join(directory, "licenses/Ohtia-LICENSE"));
      fs.writeFileSync(
        path.join(directory, "inventory.json"),
        '{"version":1,"files":{"main.mjs":"synthetic"}}',
      );
      fs.writeFileSync(
        path.join(directory, "notices.json"),
        JSON.stringify([{ component: "React", license: "MIT" }]),
      );
      const info = readAboutInformation(directory, "0.0.0-dev.8.2", "linux", "x64");
      expect(info.build).toBe(
        `sha256:${createHash("sha256")
          .update(fs.readFileSync(path.join(directory, "inventory.json")))
          .digest("hex")}`,
      );
      expect(info.copyright).toBe("Copyright (c) 2026 Adrian Mastronardi & Mónica Pené");
      expect(isAboutInformation(info)).toBe(true);
      expect(isAboutInformation({ ...info, extra: true })).toBe(false);
      expect(readAboutInformation(directory, "1.0.0", "darwin", "arm64").architecture).toBe(
        "ARM64",
      );
      expect(() => readAboutInformation(directory, "1.0.0", "linux", "ia32")).toThrow(
        /architecture/,
      );
      for (const locale of supportedLocales) {
        let copied = "";
        const clipboard = {
          writeText: (text: string) => {
            copied = text;
          },
          readText: () => copied,
        };
        expect(await copyVersionInformation(info, locale, clipboard)).toBe(true);
        expect(copied).toBe(versionInformation(info, locale));
        expect(copied).toContain(`${message(locale, "about.system")}: Linux · x86-64`);
        expect(copied).not.toContain(directory);
        expect(copied).not.toContain("Copyright");
      }
      expect(
        await copyVersionInformation(info, "en-US", { writeText() {}, readText: () => "other" }),
      ).toBe(false);
      expect(
        await copyVersionInformation(info, "en-US", {
          writeText() {
            throw new Error("denied");
          },
          readText: () => "",
        }),
      ).toBe(false);
      for (const value of [
        null,
        { ...info, product: "Other" },
        { ...info, architecture: "private CPU" },
        { ...info, version: "" },
        { ...info, notices: [{ component: "injected", license: "MIT", extra: true }] },
      ])
        expect(isAboutInformation(value)).toBe(false);
      fs.writeFileSync(path.join(directory, "notices.json"), "{}");
      expect(() => readAboutInformation(directory, "1", "linux", "x64")).toThrow(/bundled/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("admits only explicit subtle decorative borders and retains control/focus contrast enforcement", () => {
    const model = checkTokens();
    const sources = {
      "notice.css": ".notice { border: var(--border-width-default) solid var(--border-subtle); }",
    };
    const declaration = {
      selector: ".notice",
      minimum: 3,
      backgrounds: ["surface.page"],
      decorativeBorders: "border.subtle",
    };
    expect(checkColorUsage(model, sources, { version: 1, rules: [declaration] })).toBeGreaterThan(
      0,
    );
    expect(() =>
      checkColorUsage(model, sources, {
        version: 1,
        rules: [{ ...declaration, decorativeBorders: "border.control" }],
      }),
    ).toThrow(/decorative/);
    expect(() =>
      checkColorUsage(
        model,
        { "notice.css": sources["notice.css"].replace("border:", "outline:") },
        { version: 1, rules: [declaration] },
      ),
    ).toThrow(/Unlisted/);
  });
});

async function nativeMenus() {
  vi.resetModules();
  const buildFromTemplate = vi.fn((template) => template);
  const setApplicationMenu = vi.fn();
  vi.doMock("electron", () => ({ Menu: { buildFromTemplate, setApplicationMenu } }));
  const { CommandMenus, commandForInput } = await import("../packages/main/src/command-menus.js");
  return { CommandMenus, commandForInput, buildFromTemplate, setApplicationMenu };
}
describe("native menu and focused-window shortcut projection", () => {
  it("routes menu clicks and application keys to the focused generation, mirrors state and disposes every listener", async () => {
    const { CommandMenus, buildFromTemplate } = await nativeMenus();
    class Window extends EventEmitter {
      focused = true;
      destroyed = false;
      contents = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        setIgnoreMenuShortcuts: vi.fn(),
        isDestroyed: () => this.destroyed,
      });
      get webContents() {
        if (this.destroyed) throw new Error("Object has been destroyed");
        return this.contents;
      }
      isFocused = () => this.focused;
      isDestroyed = () => this.destroyed;
    }
    const one = new Window(),
      two = new Window();
    two.focused = false;
    const menus = new CommandMenus("linux", () => "en-US", "ohtia://app/index.html", {
      quit: vi.fn(),
      close: vi.fn(),
    });
    const nativeOne = one as unknown as Electron.BrowserWindow,
      nativeTwo = two as unknown as Electron.BrowserWindow;
    menus.attach(nativeOne);
    menus.attach(nativeTwo);
    const controller = new CommandController(menus.context(nativeOne)!, "es-AR");
    controller.register("help.open", { state: () => ({}), run() {} });
    expect(menus.publish(nativeOne, controller.snapshot())).toBe(true);
    expect(menus.publish(nativeOne, controller.snapshot())).toBe(false);
    const flatten = (
      items: Electron.MenuItemConstructorOptions[],
    ): Electron.MenuItemConstructorOptions[] =>
      items.flatMap((item) => [
        item,
        ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
      ]);
    const items = flatten(menus.template(nativeOne));
    expect(items.find((item) => item.id === "help.open")!.label).toBe("Ayuda de Ohtia");
    expect(items.find((item) => item.id === "settings.open")!.enabled).toBe(false);
    expect(items.find((item) => item.id === "edit.copy")!.role).toBe("copy");
    expect(items.filter((item) => /zoom/i.test(item.role ?? ""))).toHaveLength(0);
    items.find((item) => item.id === "help.open")!.click!({} as never, undefined, {} as never);
    expect(one.webContents.send).toHaveBeenCalledWith(
      "ohtia:command-intent",
      expect.objectContaining({
        command: "help.open",
        source: "native",
        windowGeneration: controller.context.windowGeneration,
      }),
    );
    const event = { preventDefault: vi.fn() };
    const key = {
      type: "keyDown",
      key: "F1",
      code: "F1",
      control: false,
      meta: false,
      alt: false,
      shift: false,
      isComposing: false,
    };
    one.webContents.emit("before-input-event", event, key);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(one.webContents.send).toHaveBeenCalledTimes(2);
    one.webContents.emit(
      "before-input-event",
      { preventDefault: vi.fn() },
      { ...key, isComposing: true },
    );
    expect(one.webContents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    expect(one.webContents.send).toHaveBeenCalledTimes(2);
    menus.dispatch(nativeTwo, "help.open");
    expect(two.webContents.send).not.toHaveBeenCalled();
    one.focused = false;
    two.focused = true;
    two.emit("focus");
    const secondController = new CommandController(menus.context(nativeTwo)!, "en-US");
    secondController.register("help.open", { state: () => ({}), run: () => true });
    menus.publish(nativeTwo, secondController.snapshot());
    items.find((item) => item.id === "help.open")!.click!({} as never, undefined, {} as never);
    expect(two.webContents.send).toHaveBeenCalledWith(
      "ohtia:command-intent",
      expect.objectContaining({ windowGeneration: secondController.context.windowGeneration }),
    );
    expect(buildFromTemplate).toHaveBeenCalled();
    one.webContents.emit("did-start-navigation", {}, "ohtia://app/index.html", false, true);
    expect(menus.publish(nativeOne, controller.snapshot())).toBe(false);
    one.webContents.emit("render-process-gone");
    one.destroyed = true;
    expect(() => one.emit("closed")).not.toThrow();
    expect(one.contents.listenerCount("before-input-event")).toBe(0);
    menus.dispose();
    expect(two.listenerCount("focus")).toBe(0);
    expect(menus.context(nativeOne)).toBeUndefined();
  });
  it("uses each platform inventory and preserves composition, AltGr, native edits and OS conventions", async () => {
    const { CommandMenus, commandForInput } = await nativeMenus();
    const base = {
      key: "",
      code: "",
      control: false,
      meta: false,
      alt: false,
      shift: false,
      isComposing: false,
    };
    for (const [platform, input, command] of [
      ["linux", { key: "P", control: true, shift: true }, "palette.open"],
      ["win32", { key: "1", control: true, shift: true }, "panels.explorer"],
      ["linux", { key: "!", code: "Digit1", control: true, shift: true }, "panels.explorer"],
      ["linux", { key: "§", code: "Digit3", control: true, shift: true }, "panels.chat"],
      ["darwin", { key: "?", code: "Slash", meta: true, shift: true }, "help.open"],
      ["darwin", { key: "w", meta: true }, "window.close"],
      ["linux", { key: "+", control: true, shift: true }, "zoom.increase"],
      ["linux", { key: "=", control: true }, "zoom.increase"],
      ["linux", { code: "NumpadAdd", control: true }, "zoom.increase"],
      ["darwin", { code: "NumpadSubtract", meta: true }, "zoom.decrease"],
      ["win32", { key: "0", control: true }, "zoom.reset"],
      ["darwin", { key: "/", code: "Digit7", meta: true, shift: true }, "shortcuts.open"],
      ["linux", { key: "?", code: "Slash", control: true, shift: true }, undefined],
      ["linux", { key: "à", code: "Digit0", control: true }, undefined],
      ["linux", { key: "0", code: "Digit0", control: true, shift: true }, undefined],
      ["linux", { key: "ㅔ", code: "KeyP", control: true, shift: true }, "palette.open"],
      ["darwin", { key: "ㅂ", code: "KeyQ", meta: true }, "application.quit"],
      [
        "linux",
        { key: "ㅔ", code: "KeyP", control: true, shift: true, isComposing: true },
        undefined,
      ],
      ["linux", { key: "/", control: true }, "shortcuts.open"],
      ["linux", { key: "F11" }, "window.fullscreen"],
      ["darwin", { key: "f", control: true, meta: true }, "window.fullscreen"],
      ["linux", { key: "F10" }, "menu.open"],
      ["linux", { key: "P", control: true, shift: true, isComposing: true }, undefined],
      ["linux", { key: "@", control: true, alt: true }, undefined],
      ["linux", { key: "c", control: true }, undefined],
      ["linux", { key: "b", control: true }, undefined],
      ["darwin", { key: "p", control: true, shift: true }, undefined],
      ["linux", { key: "F1", shift: true }, undefined],
      ["linux", { key: "q", control: true, isComposing: true }, "application.quit"],
      ["darwin", { key: "w", meta: true, isComposing: true }, "window.close"],
      ["darwin", { key: "q", meta: true, control: true, isComposing: true }, undefined],
      ["linux", { key: "F1", meta: true }, undefined],
    ] as const)
      expect(commandForInput(platform, { ...base, ...input })).toBe(command);
    for (const platform of ["linux", "win32", "darwin"] as const) {
      const menus = new CommandMenus(platform, () => "ko-KR", "ohtia://app/index.html", {
        quit: vi.fn(),
        close: vi.fn(),
      });
      const template = menus.template(null);
      expect(template.map((item) => item.label)).toEqual(
        platform === "darwin"
          ? ["Ohtia", "파일", "편집", "보기", "도움말"]
          : ["파일", "편집", "보기", "도움말"],
      );
      menus.refresh();
      menus.dispose();
    }
  });
});

it("keeps registration leases distinct when a consumer reuses its handler object", async () => {
  const controller = new CommandController(context, "en-US");
  const run = vi.fn(() => true);
  const handler = { state: () => ({}), run };
  const oldDispose = controller.register("settings.open", handler);
  const queued = controller.invoke("settings.open");
  oldDispose();
  const newDispose = controller.register("settings.open", handler);
  oldDispose();
  expect(controller.entry("settings.open").reason).toBeUndefined();
  expect(await queued).toEqual({ status: "revoked" });
  expect(run).not.toHaveBeenCalled();
  expect(await controller.invoke("settings.open")).toEqual({ status: "completed" });
  newDispose();
  let complete!: (value: boolean) => void;
  let execution!: import("../packages/renderer/src/command-controller.js").CommandExecution;
  const pendingHandler = {
    state: () => ({}),
    run: (lease: typeof execution) => {
      execution = lease;
      return new Promise<boolean>((resolve) => {
        complete = resolve;
      });
    },
  };
  const dispose = controller.register("settings.open", pendingHandler);
  const pending = controller.invoke("settings.open");
  await Promise.resolve();
  dispose();
  controller.register("settings.open", pendingHandler);
  expect(execution.isCurrent()).toBe(false);
  complete(true);
  expect(await pending).toEqual({ status: "revoked" });
});

it("retains main-owned lifecycle actions, revokes replaced registry leases and ignores denied navigation, repeats and stale Alt", async () => {
  const { CommandMenus, buildFromTemplate } = await nativeMenus();
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      setIgnoreMenuShortcuts: vi.fn(),
      isDestroyed: () => false,
    });
    isFocused = () => true;
    isDestroyed = () => false;
  }
  const window = new Window();
  const native = window as unknown as Electron.BrowserWindow;
  const lifecycle = { quit: vi.fn(), close: vi.fn() };
  const menus = new CommandMenus("linux", () => "en-US", "ohtia://app/index.html", lifecycle);
  menus.attach(native);
  menus.dispatch(null, "application.quit");
  menus.dispatch(native, "window.close");
  expect(lifecycle.quit).toHaveBeenCalledOnce();
  expect(lifecycle.close).toHaveBeenCalledWith(native);
  const context = menus.connect(native)!;
  const controller = new CommandController(context, "en-US");
  controller.register("help.open", { state: () => ({}), run: () => true });
  controller.register("menu.open", { state: () => ({}), run: () => true });
  menus.publish(native, controller.snapshot());
  const builds = buildFromTemplate.mock.calls.length;
  controller.changed();
  menus.publish(native, controller.snapshot());
  expect(buildFromTemplate).toHaveBeenCalledTimes(builds);
  window.webContents.emit("did-start-navigation", {}, "https://example.invalid", false, true);
  expect(menus.context(native)).toEqual(context);
  controller.changed();
  expect(menus.publish(native, controller.snapshot())).toBe(true);
  const input = {
    type: "keyDown",
    key: "F1",
    code: "F1",
    control: false,
    meta: false,
    shift: false,
    alt: false,
    isComposing: false,
  };
  const event = { preventDefault: vi.fn() };
  window.webContents.emit("before-input-event", event, { ...input, isAutoRepeat: true });
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(window.webContents.send).not.toHaveBeenCalled();
  window.webContents.emit("before-input-event", event, {
    ...input,
    key: "Alt",
    code: "AltLeft",
    alt: true,
  });
  window.emit("blur");
  window.webContents.emit("before-input-event", event, {
    ...input,
    type: "keyUp",
    key: "Alt",
    code: "AltLeft",
  });
  expect(window.webContents.send).not.toHaveBeenCalled();
  const delayed = controller.snapshot();
  const secondContext = menus.connect(native)!;
  expect(secondContext.windowGeneration).not.toBe(context.windowGeneration);
  expect(menus.publish(native, delayed)).toBe(false);
  const second = new CommandController(secondContext, "en-US");
  second.register("help.open", { state: () => ({ reason: "modal_open" }), run: () => true });
  expect(menus.publish(native, second.snapshot())).toBe(true);
  // A keyboard intent rechecks the current renderer state instead of trusting a delayed menu mirror.
  window.webContents.emit("before-input-event", event, input);
  expect(window.webContents.send).toHaveBeenCalledWith(
    "ohtia:command-intent",
    expect.objectContaining({
      command: "help.open",
      windowGeneration: secondContext.windowGeneration,
    }),
  );
  window.webContents.emit("render-process-gone");
  menus.dispatch(null, "application.quit");
  menus.dispatch(native, "window.close");
  expect(lifecycle.quit).toHaveBeenCalledTimes(2);
  expect(lifecycle.close).toHaveBeenCalledTimes(2);
  menus.dispose();
});

it("never invents a native radio selection and restores confirmed state after native activation", async () => {
  const { CommandMenus, buildFromTemplate } = await nativeMenus();
  const window = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), {
      send: vi.fn(),
      setIgnoreMenuShortcuts: vi.fn(),
      isDestroyed: () => false,
    }),
    isFocused: () => true,
    isDestroyed: () => false,
  });
  const native = window as unknown as Electron.BrowserWindow;
  const menus = new CommandMenus("linux", () => "en-US", "ohtia://app/index.html", {
    quit: vi.fn(),
    close: vi.fn(),
  });
  menus.attach(native);
  const controller = new CommandController(menus.connect(native)!, "en-US");
  const ids = ["theme.system", "theme.light", "theme.dark"] as const;
  const find = (
    id: string,
    items: Electron.MenuItemConstructorOptions[] = menus.template(native),
  ): Electron.MenuItemConstructorOptions | undefined => {
    for (const item of items) {
      if (item.id === id) return item;
      if (Array.isArray(item.submenu)) {
        const nested = find(id, item.submenu);
        if (nested) return nested;
      }
    }
  };
  menus.publish(native, controller.snapshot());
  expect(find("theme.system")!.type).toBeUndefined();
  controller.register("theme.system", { state: () => ({ checked: false }), run: () => false });
  menus.publish(native, controller.snapshot());
  expect(find("theme.system")!.type).toBeUndefined();
  for (const id of ["theme.light", "theme.dark"] as const)
    controller.register(id, { state: () => ({ checked: id === "theme.dark" }), run: () => false });
  menus.publish(native, controller.snapshot());
  for (const id of ids) expect(find(id)!.type).toBe("radio");
  expect(find("theme.dark")!.checked).toBe(true);
  const clicked = find("theme.light")!;
  clicked.checked = true;
  clicked.click!({} as never, undefined, {} as never);
  const restored = buildFromTemplate.mock.calls.at(-1)![0];
  expect(find("theme.light", restored)!.checked).toBe(false);
  expect(find("theme.dark", restored)!.checked).toBe(true);
  menus.dispose();
});

it("retains one aggregate request limit across auxiliary requests and service admission", async () => {
  const { RequestBudget, PortAdmission } = await import("../packages/main/src/port-admission.js");
  const { request } = await import("./fixtures/port-corpus.js");
  const { portLimits } = await import("../packages/contracts/src/index.js");
  const budget = new RequestBudget(),
    pool = new PortAdmission(budget),
    frame = {};
  const sender = { frame, url: "ohtia://app" };
  const attached = pool.attach({
    ...sender,
    windowGeneration: "window-1",
    serviceGeneration: "service-1",
  });
  const service = pool.admit(sender, JSON.stringify(request()));
  expect(service.ok).toBe(true);
  const releases: (() => void)[] = [];
  for (let i = 1; i < portLimits.pending_per_window; i++) {
    const lease = budget.reserve(frame);
    expect(lease.ok).toBe(true);
    if (lease.ok) releases.push(lease.value);
  }
  expect(budget.reserve(frame).ok).toBe(false);
  expect(pool.admit(sender, JSON.stringify(request({ requestId: "additional" }))).ok).toBe(false);
  if (attached.ok) attached.value();
  expect(budget.reserve(frame).ok).toBe(false);
  if (service.ok) {
    service.value.release();
    service.value.release();
  }
  const replacement = budget.reserve(frame);
  expect(replacement.ok).toBe(true);
  if (replacement.ok) releases.push(replacement.value);
  releases.forEach((release) => {
    release();
    release();
  });
  const global: (() => void)[] = [];
  const frames = Array.from(
    { length: Math.ceil(portLimits.pending_global / portLimits.pending_per_window) },
    () => ({}),
  );
  for (let i = 0; i < portLimits.pending_global; i++) {
    const lease = budget.reserve(frames[Math.floor(i / portLimits.pending_per_window)]);
    expect(lease.ok).toBe(true);
    if (lease.ok) global.push(lease.value);
  }
  expect(budget.reserve({}).ok).toBe(false);
  global.forEach((release) => release());
  const last = budget.reserve({});
  expect(last.ok).toBe(true);
  if (last.ok) last.value();
});
