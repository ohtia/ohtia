/* global document, window, innerWidth, innerHeight */
import path from "node:path";
import { sendNativeHelpShortcut } from "./command-shortcut.mjs";
import {
  focusNative,
  NativeFocusError,
  captureNativeFocus,
  withCommandCleanup,
} from "./command-native-focus.mjs";
import { expect } from "@playwright/test";
import {
  message,
  commandDefinitions,
  commandIds,
  projectLinks,
} from "../packages/contracts/dist/index.js";
import {
  verifyCommandFocus,
  observeCommandDialog,
  verifyCommandLandmarks,
  verifyAboutRendition,
  verifyCommandDensities,
} from "./command-presentation.mjs";
import { setNativeViewport } from "./design-viewport.mjs";

const nativeViewportCases = [
  [320, 1],
  [600, 1],
  [1024, 1],
  [1280, 1],
  [1280, 2],
  [1280, 4],
];

/** Exercise Electron's documented MenuItem.click event/role dispatcher in the focused window. */
export async function invokeNativeMenu(application, id) {
  return application.evaluate(({ Menu, BrowserWindow }, command) => {
    const window = BrowserWindow.getFocusedWindow();
    const item = Menu.getApplicationMenu()?.getMenuItemById(command);
    if (!item?.enabled) throw new Error("Native acceptance command is unavailable.");
    const selectors = {
      "edit.selectAll": "selectAll:",
      "edit.copy": "copy:",
      "edit.cut": "cut:",
      "edit.paste": "paste:",
      "edit.undo": "undo:",
      "edit.redo": "redo:",
    };
    if (process.platform === "darwin" && Object.hasOwn(selectors, command))
      Menu.sendActionToFirstResponder(selectors[command]);
    else item.click({}, window, window?.webContents);
    return true;
  }, id);
}

export async function verifyCommandsAfterDeniedNavigation(application, page, expectedDocument) {
  const native = await application.browserWindow(page);
  let phase = "focus the native window",
    nativeFocus;
  return withCommandCleanup(
    async () => {
      try {
        nativeFocus = await focusNative(native, "admitted document");
        phase = "wait for About availability";
        await expect
          .poll(() =>
            application.evaluate(
              ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("about.open")?.enabled,
            ),
          )
          .toBe(true);
        phase = "dispatch About";
        await invokeNativeMenu(application, "about.open");
        phase = "observe the open About dialog";
        let shown;
        await expect
          .poll(async () => {
            shown = await observeCommandDialog(page, ".about-dialog");
            return shown;
          })
          .toEqual({ open: true, visible: true });
        phase = "dismiss About";
        await page.keyboard.press("Escape");
        let hidden;
        await expect
          .poll(async () => {
            hidden = await observeCommandDialog(page, ".about-dialog");
            return hidden;
          })
          .toEqual({ open: false, visible: false });
        phase = "verify the admitted document";
        const document = await page.evaluate(() => ({
          url: window.location.href,
          token: window.document.documentElement.dataset.commandAcceptanceDocument,
        }));
        expect(document).toEqual(expectedDocument);
        const mainUrl = await native.evaluate((window) => window.webContents.getURL());
        expect(mainUrl).toBe(expectedDocument.url);
        return { shown, hidden, document, mainUrl, nativeFocus };
      } catch (error) {
        let nativeState;
        try {
          nativeState = await application.evaluate(({ BrowserWindow, Menu }) => {
            const about = Menu.getApplicationMenu()?.getMenuItemById("about.open");
            return {
              focusedWindowId: BrowserWindow.getFocusedWindow()?.id ?? null,
              windows: BrowserWindow.getAllWindows().map((window) => ({
                id: window.id,
                focused: window.isFocused(),
                visible: window.isVisible(),
                minimized: window.isMinimized(),
              })),
              aboutPresent: Boolean(about),
              aboutEnabled: about?.enabled ?? false,
            };
          });
        } catch {
          nativeState = "unavailable";
        }
        const detail = error instanceof Error ? error.message : "Command qualification failed.";
        throw new Error(
          `Denied-navigation command check failed during ${phase}; native state ${JSON.stringify(nativeState)}: ${detail}`,
          { cause: error },
        );
      }
    },
    () => native.dispose(),
    (error) => captureNativeFocus(error, nativeFocus),
  );
}

async function verifyNativeInventory(application, locale, platform) {
  const observed = await application.evaluate(({ Menu }) => {
    const rows = [];
    const walk = (menu) =>
      menu.items
        .filter((item) => item.type !== "separator")
        .map((item) => {
          if (item.id) {
            rows.push({
              id: item.id,
              label: item.label,
              role: item.role || null,
              type: item.type,
              accelerator: item.accelerator ?? null,
            });
            return item.id;
          }
          return item.role ? `role:${item.role}` : { label: item.label, items: walk(item.submenu) };
        });
    return { tree: walk(Menu.getApplicationMenu()), rows };
  });
  const group = (name, items) => ({ label: message(locale, `menu.${name}`), items });
  const mac = platform === "darwin";
  expect(observed.tree).toEqual([
    ...(mac
      ? [
          group("application", [
            "about.open",
            "settings.open",
            "role:services",
            "role:hide",
            "role:hideothers",
            "role:unhide",
            "application.quit",
          ]),
        ]
      : []),
    group("file", [
      "window.new",
      ...(!mac ? ["settings.open"] : []),
      "window.close",
      ...(!mac ? ["application.quit"] : []),
    ]),
    group("edit", [
      "edit.undo",
      "edit.redo",
      "edit.cut",
      "edit.copy",
      "edit.paste",
      "edit.selectAll",
    ]),
    group("view", [
      "palette.open",
      "panels.explorer",
      "panels.documents",
      "panels.chat",
      "document.focus",
      "layout.reset",
      group("theme", ["theme.system", "theme.light", "theme.dark"]),
      "zoom.increase",
      "zoom.decrease",
      "zoom.reset",
      "window.fullscreen",
    ]),
    group("help", [
      "help.open",
      "shortcuts.open",
      "link.documentation",
      "link.report",
      "version.copy",
      ...(!mac ? ["about.open"] : []),
    ]),
  ]);
  expect(observed.rows.map((row) => row.id).sort()).toEqual(
    commandIds.filter((id) => id !== "menu.open").sort(),
  );
  const roles = {
    "edit.undo": "undo",
    "edit.redo": "redo",
    "edit.cut": "cut",
    "edit.copy": "copy",
    "edit.paste": "paste",
    "edit.selectAll": "selectall",
  };
  const normalize = (key) =>
    key
      ?.replace(/^Command\+/, "Cmd+")
      .replace(/^Control\+/, "Ctrl+")
      .replace(/\+Plus$/, "++") ?? null;
  for (const row of observed.rows) {
    const definition = commandDefinitions.find((entry) => entry.id === row.id);
    expect(row.label).toBe(message(locale, definition.label));
    expect(normalize(row.accelerator)).toBe(definition.shortcuts[platform][0] ?? null);
    expect(row.role).toBe(roles[row.id] ?? null);
    expect(row.type).toBe(row.id.startsWith("panels.") ? "checkbox" : "normal");
  }
  return observed;
}

async function verifyProjectDestinations(application, page, about) {
  await application.evaluate(({ shell }) => {
    globalThis.__ohtiaCommandLinks = { original: shell.openExternal, destinations: [] };
    shell.openExternal = async (url) => {
      globalThis.__ohtiaCommandLinks.destinations.push(url);
    };
  });
  try {
    for (const link of await about.locator(".about-links a").all()) await link.click();
    expect(
      await page.evaluate(() => window.ohtia.commands.openLink("unregistered-destination")),
    ).toBe(false);
    const destinations = await application.evaluate(
      () => globalThis.__ohtiaCommandLinks.destinations,
    );
    expect(destinations).toEqual([
      projectLinks.repository,
      projectLinks.documentation,
      projectLinks.report,
    ]);
    return { destinations, browserSink: "controlled; system browser launch is not exercised" };
  } finally {
    await application.evaluate(({ shell }) => {
      shell.openExternal = globalThis.__ohtiaCommandLinks.original;
      delete globalThis.__ohtiaCommandLinks;
    });
  }
}

async function verifyNativeRoutingAndEditing(application, page, nativeWindow) {
  const focus = [];
  const activate = async (window, target) => {
    try {
      focus.push(await focusNative(window, target));
    } catch (error) {
      if (error instanceof NativeFocusError) {
        focus.push(error.observation);
        error.history = focus;
      }
      throw error;
    }
  };
  let peer, peerWindow;
  return withCommandCleanup(
    async () => {
      const opened = application.waitForEvent("window");
      await page.evaluate(() => window.ohtia.bootstrap.newWindow());
      peer = await opened;
      await peer.waitForLoadState("domcontentloaded");
      peerWindow = await application.browserWindow(peer);
      await expect(peer.getByRole("heading", { name: "Ohtia", exact: true })).toBeVisible();
      await activate(nativeWindow, "original");
      await expect
        .poll(() =>
          application.evaluate(
            ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("about.open")?.enabled,
          ),
        )
        .toBe(true);
      await invokeNativeMenu(application, "about.open");
      await expect(page.locator(".about-dialog")).toBeVisible();
      await expect(peer.locator("dialog[open]")).toHaveCount(0);
      await activate(peerWindow, "peer");
      await expect
        .poll(() =>
          application.evaluate(
            ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("help.open")?.enabled,
          ),
        )
        .toBe(true);
      await invokeNativeMenu(application, "help.open");
      await expect(peer.locator(".help-dialog")).toBeVisible();
      await expect(page.locator(".about-dialog")).toBeVisible();
      await activate(nativeWindow, "original");
      await expect
        .poll(() =>
          application.evaluate(
            ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("help.open")?.enabled,
          ),
        )
        .toBe(false);
      await invokeNativeMenu(application, "version.copy");
      await expect(page.locator(".about-dialog .about-copied")).toBeVisible();
      await expect(peer.locator(".about-copied")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await activate(peerWindow, "peer");
      await peer.keyboard.press("Escape");
      for (const target of [page, peer])
        await target.evaluate(() => {
          const field = document.createElement("textarea");
          field.id = "command-native-edit-fixture";
          field.setAttribute("aria-label", "Synthetic native editing target");
          document.querySelector("main").append(field);
        });
      const first = page.locator("#command-native-edit-fixture");
      const other = peer.locator("#command-native-edit-fixture");
      await other.fill("Untouched peer buffer");
      await activate(nativeWindow, "original");
      await first.focus();
      await first.pressSequentially("Synthetic native text");
      await expect
        .poll(() =>
          application.evaluate(
            ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("edit.copy")?.enabled,
          ),
        )
        .toBe(true);
      await invokeNativeMenu(application, "edit.selectAll");
      await expect
        .poll(() => first.evaluate((field) => field.selectionEnd - field.selectionStart))
        .toBe("Synthetic native text".length);
      await invokeNativeMenu(application, "edit.copy");
      await expect
        .poll(() => application.evaluate(async ({ clipboard }) => await clipboard.readText()))
        .toBe("Synthetic native text");
      await invokeNativeMenu(application, "edit.cut");
      await expect(first).toHaveValue("");
      await invokeNativeMenu(application, "edit.undo");
      await expect(first).toHaveValue("Synthetic native text");
      await invokeNativeMenu(application, "edit.redo");
      await expect(first).toHaveValue("");
      await invokeNativeMenu(application, "edit.paste");
      await expect(first).toHaveValue("Synthetic native text");
      await expect(other).toHaveValue("Untouched peer buffer");
      await activate(peerWindow, "peer");
      await invokeNativeMenu(application, "window.close");
      await expect.poll(() => application.windows().length).toBe(1);
      await expect(page.getByRole("heading", { name: "Ohtia", exact: true })).toBeVisible();
      return {
        menuDispatch: "About, Help, version copy and Close",
        windows: 2,
        focus,
        nativeEditRoles: ["selectAll", "copy", "cut", "undo", "redo", "paste"],
        target: "synthetic textarea in the actual packaged renderer; not a manuscript editor",
        dispatch:
          process.platform === "darwin"
            ? "native first-responder selectors for Edit; actual MenuItem.click for application commands"
            : "actual MenuItem.click",
      };
    },
    async () => {
      if (peer && !peer.isClosed()) await peerWindow?.evaluate((window) => window.close());
      await peerWindow?.dispose();
      if (!page.isClosed()) {
        await page.evaluate(() => document.getElementById("command-native-edit-fixture")?.remove());
        await activate(nativeWindow, "original");
      }
    },
    (error) => captureNativeFocus(error, focus.at(-1), focus),
  );
}

/** Release-equivalent Electron checks; native keyboard-layout/IME and assistive checks stay explicit. */
export async function verifyPackagedCommands(application, page, nativeWindow, output, cdp) {
  const locale = await page.locator("html").getAttribute("lang");
  const text = (key) => message(locale, key);
  const result = {
    cases: [],
    viewports: [],
    limitations: [
      "External-link checks control the browser sink; system browser launch is not exercised. Hidden/manuscript inputs are qualified through controlled component fixtures; persisted native Settings propagation belongs to its declared consumer. Interpreter layout and IME qualification remain separate.",
      "Automation exercises actual Electron menu objects, broker, clipboard, synthetic Electron input for browser-side shortcuts and Chromium input for renderer keys. Focus receipts identify any owned headless GNOME compositor input; it does not certify physical Spanish, US, AZERTY, QWERTZ or Korean keyboard layouts, OS IMEs or manual assistive journeys.",
    ],
  };
  const originalAppearance = await page.locator("html").getAttribute("data-appearance");
  const original = await nativeWindow.evaluate((window) => ({
    size: window.getContentSize(),
    zoom: window.webContents.getZoomFactor(),
  }));
  const external = [];
  const observe = (request) => {
    if (!request.url().startsWith("ohtia://")) external.push(request.url());
  };
  page.on("request", observe);
  return withCommandCleanup(
    async () => {
      result.nativeFocus = await focusNative(nativeWindow, "command surfaces");
      const artifact = await page.evaluate(() => window.ohtia.commands.about());
      const running = await application.evaluate(({ app }) => ({
        version: app.getVersion(),
        platform: process.platform,
        architecture: process.arch,
      }));
      result.inventory = await verifyNativeInventory(application, locale, running.platform);
      result.focused = await nativeWindow.evaluate((window) => window.isFocused());
      expect(artifact.version).toBe(running.version);
      expect(artifact.platform).toBe(running.platform);
      expect(artifact.architecture).toBe(running.architecture === "x64" ? "x86-64" : "ARM64");
      expect(artifact.build).toMatch(/^sha256:[a-f0-9]{64}$/);
      await expect
        .poll(() =>
          application.evaluate(
            ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("about.open")?.enabled,
          ),
        )
        .toBe(true);
      const menu = await application.evaluate(({ Menu }) => {
        const menu = Menu.getApplicationMenu();
        const read = (id) => {
          const item = menu.getMenuItemById(id);
          return { id, enabled: item.enabled, role: item.role, accelerator: item.accelerator };
        };
        return [
          "settings.open",
          "window.new",
          "menu.open",
          "palette.open",
          "shortcuts.open",
          "help.open",
          "about.open",
          "zoom.increase",
          "zoom.decrease",
          "zoom.reset",
        ].map((id) => (id === "menu.open" ? { id, registered: false } : read(id)));
      });
      for (const entry of menu.filter((entry) =>
        [
          "settings.open",
          "window.new",
          "palette.open",
          "shortcuts.open",
          "zoom.increase",
          "zoom.decrease",
          "zoom.reset",
        ].includes(entry.id),
      ))
        expect(entry.enabled).toBe(false);
      expect(menu.some((entry) => ["zoomin", "zoomout", "resetzoom"].includes(entry.role))).toBe(
        false,
      );
      result.cases.push("running-artifact-identity-and-truthful-native-availability");
      const aboutTrigger = page.getByRole("button", {
        name: text("command.about.open"),
        exact: true,
      });
      await aboutTrigger.click();
      const about = page.locator(".about-dialog");
      await expect(about).toBeVisible();
      await expect
        .poll(() =>
          about.locator("img").evaluate((image) => ({
            complete: image.complete,
            width: image.naturalWidth,
            height: image.naturalHeight,
          })),
        )
        .toEqual({ complete: true, width: 512, height: 512 });
      await expect(about.locator("h1")).toHaveText("Ohtia");
      await expect(about.locator("dd").nth(0)).toHaveText(artifact.version);
      await expect(about.locator("dd").nth(1)).toHaveText(artifact.build);
      await about.getByRole("button", { name: text("command.version.copy"), exact: true }).click();
      await expect(about.locator(".about-copied")).toHaveText(text("about.copied"));
      const copied = await application.evaluate(
        async ({ clipboard }) => await clipboard.readText(),
      );
      const displayed = await about
        .locator("dl")
        .evaluate((dl) =>
          [...dl.querySelectorAll("dt")]
            .map(
              (label, index) =>
                `${label.textContent}: ${dl.querySelectorAll("dd")[index].textContent}`,
            )
            .join("\n"),
        );
      expect(copied).toBe(`Ohtia\n${displayed}`);
      await about.getByRole("button", { name: text("about.notices"), exact: true }).click();
      await expect(about.getByRole("list", { name: text("about.notices") })).toBeVisible();
      await expect(about.getByRole("list", { name: text("about.notices") })).toContainText(
        "IBM Plex",
      );
      result.projectLinks = await verifyProjectDestinations(application, page, about);
      const tree = await cdp.send("Accessibility.getFullAXTree");
      await verifyCommandLandmarks(cdp);
      const nodes = tree.nodes.filter((node) => !node.ignored);
      expect(
        nodes.some((node) => node.role?.value === "dialog" && node.name?.value === "Ohtia"),
      ).toBe(true);
      expect(
        nodes.some(
          (node) => node.role?.value === "list" && node.name?.value === text("about.notices"),
        ),
      ).toBe(true);
      result.cases.push("actual-about-accessibility-tree");
      result.cases.push("real-clipboard-confirmation-and-offline-notices");
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (value) => (document.documentElement.dataset.appearance = value),
          theme,
        );
        for (const [width, zoom] of nativeViewportCases) {
          await setNativeViewport(page, nativeWindow, { width, height: 600, zoomFactor: zoom });
          await verifyAboutRendition(about.locator("img"));
          const geometry = await about.evaluate((dialog) => {
            const rect = dialog.getBoundingClientRect(),
              image = dialog.querySelector("img").getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              width: rect.width,
              viewport: { width: innerWidth, height: innerHeight },
              image: {
                width: image.width,
                height: image.height,
                complete: dialog.querySelector("img").complete,
                naturalWidth: dialog.querySelector("img").naturalWidth,
                naturalHeight: dialog.querySelector("img").naturalHeight,
              },
              scroll: dialog.querySelector(".command-dialog-body").scrollHeight,
            };
          });
          expect(geometry.left).toBeGreaterThanOrEqual(15);
          expect(geometry.right).toBeLessThanOrEqual(geometry.viewport.width - 15);
          expect(geometry.top).toBeGreaterThanOrEqual(0);
          expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport.height);
          expect(geometry.image.width).toBe(128);
          expect(geometry.image.height).toBe(128);
          expect(geometry.image.complete).toBe(true);
          expect(geometry.image.naturalWidth).toBe(512);
          expect(geometry.image.naturalHeight).toBe(512);
          const copyAction = about.getByRole("button", {
            name: text("command.version.copy"),
            exact: true,
          });
          await verifyCommandFocus(copyAction);
          result.viewports.push({ surface: "about", theme, width, zoom, geometry });
        }
        await setNativeViewport(page, nativeWindow, { width: 1280, height: 600, zoomFactor: 1 });
        await page.screenshot({ path: path.join(output, `commands-about-${theme}.png`) });
      }
      await setNativeViewport(page, nativeWindow, { width: 800, height: 600, zoomFactor: 1 });
      result.renditions = await verifyCommandDensities(cdp, about.locator("img"));
      await page.keyboard.press("Escape");
      await expect(about).toBeHidden();
      await expect(aboutTrigger).toBeFocused();
      await expect
        .poll(() =>
          application.evaluate(
            ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("help.open")?.enabled,
          ),
        )
        .toBe(true);
      result.helpShortcut = await sendNativeHelpShortcut(nativeWindow, running.platform);
      const help = page.locator(".help-dialog");
      await expect(help).toBeVisible();
      await verifyCommandLandmarks(cdp);
      await expect(help).toContainText(text("help.capabilities"));
      await expect(
        help.getByRole("button", { name: text("command.shortcuts.open"), exact: true }),
      ).toHaveAttribute("aria-disabled", "true");
      await expect(help).toContainText(text("command.reason.handler_missing"));
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (value) => (document.documentElement.dataset.appearance = value),
          theme,
        );
        for (const [width, zoom] of nativeViewportCases) {
          await setNativeViewport(page, nativeWindow, { width, height: 600, zoomFactor: zoom });
          const geometry = await help.evaluate((dialog) => {
            const bounds = dialog.getBoundingClientRect();
            return {
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              viewportWidth: innerWidth,
              viewportHeight: innerHeight,
            };
          });
          expect(geometry.left).toBeGreaterThanOrEqual(15);
          expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - 15);
          expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
          for (const action of [
            help.locator("[data-close]"),
            help.getByRole("button", { name: text("command.shortcuts.open"), exact: true }),
            help.locator(".command-dialog-footer button"),
          ]) {
            await verifyCommandFocus(action);
          }
          result.viewports.push({ surface: "help", theme, width, zoom, geometry });
        }
      }
      await page.keyboard.press("Escape");
      await expect(help).toBeHidden();
      await expect(aboutTrigger).toBeFocused();
      await setNativeViewport(page, nativeWindow, { width: 800, height: 600, zoomFactor: 1 });
      result.routingAndEditing = await verifyNativeRoutingAndEditing(
        application,
        page,
        nativeWindow,
      );
      expect(external).toEqual([]);
      result.cases.push(
        "registry-shortcut-offline-help-and-focus-restoration",
        "complete-platform-menu-and-accelerator-inventory",
        "native-menu-focused-window-routing-and-edit-roles",
        "broker-authorized-project-destinations-with-controlled-browser-sink",
      );
      return result;
    },
    async () => {
      page.off("request", observe);
      await page.keyboard.press("Escape");
      await setNativeViewport(page, nativeWindow, {
        width: original.size[0],
        height: original.size[1],
        zoomFactor: original.zoom,
      });
      await page.evaluate((value) => {
        if (value === null) delete document.documentElement.dataset.appearance;
        else document.documentElement.dataset.appearance = value;
      }, originalAppearance);
    },
    (error) =>
      captureNativeFocus(
        error,
        result.routingAndEditing?.focus.at(-1) ?? result.nativeFocus,
        result.routingAndEditing?.focus ?? [],
      ),
  );
}
