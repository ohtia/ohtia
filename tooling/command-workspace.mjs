/* global window, getComputedStyle, crypto */
import path from "node:path";
import { expect } from "@playwright/test";
import { message } from "../packages/contracts/dist/index.js";
import { focusNative, withCommandCleanup } from "./command-native-focus.mjs";
import { invokeNativeMenu } from "./command-acceptance.mjs";

/** Installed root only: no catalog navigation, fixture root or synthetic research controls. */
export async function verifyWorkspaceComposition(application, page, output) {
  const locale = (await page.evaluate(() => window.ohtia.bootstrap.read())).locale;
  const text = (key) => message(locale, key);
  const native = await application.browserWindow(page);
  const originalSize = await native.evaluate((window) => window.getContentSize());
  const initialLayout = await page.evaluate(() => window.ohtia.foundation.readLayout().result);
  let extra;
  let observingMenu = false;
  const command = (id) => page.locator(`[data-workspace-command="${id}"]:visible`).first();
  const invoke = async (id) => {
    await expect
      .poll(() =>
        application.evaluate(
          ({ Menu }, command) => Menu.getApplicationMenu()?.getMenuItemById(command)?.enabled,
          id,
        ),
      )
      .toBe(true);
    return invokeNativeMenu(application, id);
  };
  const settings = page.locator(".settings-dialog");
  const openSettings = async (trigger, entry) => {
    const nativeFocus = await focusNative(native, `workspace Settings from ${entry}`);
    try {
      await trigger.click();
      await expect(settings, `Workspace Settings from ${entry}`).toBeVisible();
    } catch (error) {
      const control = await trigger.evaluate((button) => ({
        disabled: button.getAttribute("aria-disabled"),
        focused: button.ownerDocument.activeElement === button,
        hidden: !!button.closest("[hidden], [inert]"),
        mode: button.closest(".workspace")?.dataset.mode,
      }));
      throw new Error(
        `Workspace Settings from ${entry}; native focus ${JSON.stringify(nativeFocus)}; control ${JSON.stringify(control)}: ${String(error)}`,
        { cause: error },
      );
    }
  };
  const settleLayout = async () => {
    await expect.poll(() => command("panels.explorer").getAttribute("aria-disabled")).toBe("false");
  };
  return withCommandCleanup(
    async () => {
      if (await settings.isVisible()) await page.keyboard.press("Escape");
      await native.evaluate((window) => window.setContentSize(1280, 800));
      await expect(page.locator(".workspace")).toHaveAttribute("data-mode", "wide");
      await focusNative(native, "integrated workspace");
      await expect(
        page.getByRole("heading", { name: text("workspace.welcome"), exact: true }),
      ).toBeVisible();
      expect(
        await page.locator(".workspace textarea, .research-specimen, [data-catalog]").count(),
      ).toBe(0);
      const beforePresentation = await page.evaluate(
        () => window.ohtia.foundation.readPresentation().result,
      );
      await invoke("layout.reset");
      await settleLayout();
      const titleRow = page.locator(".application-workspace .workspace-title-row");
      await expect(titleRow).toHaveCount(1);
      const geometry = await titleRow.evaluate((row) => {
        const bounds = row.getBoundingClientRect();
        const overlay = window.navigator.windowControlsOverlay?.getTitlebarAreaRect();
        return {
          x: bounds.x,
          right: bounds.right,
          height: bounds.height,
          overlay: overlay ? { x: overlay.x, right: overlay.right } : null,
          drag: getComputedStyle(row.querySelector(".workspace-drag-space")).getPropertyValue(
            "app-region",
          ),
        };
      });
      expect(geometry.height).toBe(48);
      expect(geometry.drag).toBe("drag");
      expect(
        geometry.overlay,
        "Native window-controls safe area must be observable.",
      ).not.toBeNull();
      expect(geometry.x).toBeGreaterThanOrEqual(geometry.overlay.x);
      expect(geometry.right).toBeLessThanOrEqual(geometry.overlay.right);
      await openSettings(command("settings.open"), "explorer footer");
      const chat = settings.getByRole("checkbox", {
        name: text("command.panels.chat"),
        exact: true,
      });
      await chat.uncheck();
      await expect(page.locator('[data-workspace-panel="chat"]')).toBeHidden();
      await chat.check();
      await expect(page.locator('[data-workspace-panel="chat"]')).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(command("settings.open")).toBeFocused();
      await settleLayout();
      // Both actual separator gestures resolve through the same authority as Settings.
      const widths = () =>
        page
          .locator(".workspace")
          .evaluate((workspace) =>
            Object.fromEntries(
              [...workspace.querySelectorAll("[data-workspace-panel]")].map((panel) => [
                panel.dataset.workspacePanel,
                Math.round(panel.getBoundingClientRect().width),
              ]),
            ),
          );
      const beforeResize = await widths();
      const splitter = page.getByRole("separator").last();
      await splitter.focus();
      await splitter.press("ArrowLeft");
      await settleLayout();
      await expect.poll(widths).toEqual({
        ...beforeResize,
        documents: beforeResize.documents - 16,
        chat: beforeResize.chat + 16,
      });
      await splitter.press("Enter");
      await settleLayout();
      await expect.poll(widths).toEqual(beforeResize);
      await splitter.press("ArrowRight");
      await settleLayout();
      await expect.poll(widths).toEqual({
        ...beforeResize,
        documents: beforeResize.documents + 16,
        chat: beforeResize.chat - 16,
      });
      await splitter.dblclick();
      await settleLayout();
      await expect.poll(widths).toEqual(beforeResize);
      await command("panels.explorer").click();
      await expect(page.locator(".workspace-rail")).toBeVisible();
      await openSettings(
        page.locator('.workspace-rail [data-workspace-command="settings.open"]'),
        "rail",
      );
      await page.keyboard.press("Escape");
      await native.evaluate((window) => window.setContentSize(600, 800));
      await expect(page.locator(".workspace")).toHaveAttribute("data-mode", "narrow");
      await openSettings(
        page.locator('.workspace-narrow-row [data-workspace-command="settings.open"]'),
        "narrow bar",
      );
      await page.keyboard.press("Escape");
      await expect(
        page.locator('.workspace-narrow-row [data-workspace-command="settings.open"]'),
      ).toBeFocused();
      await native.evaluate((window) => window.setContentSize(1280, 800));
      await invoke("palette.open");
      const palette = page.locator(".command-palette[open]");
      await expect(palette).toBeVisible();
      await palette.getByRole("combobox").fill(text("command.layout.reset"));
      await palette.getByRole("combobox").press("Enter");
      await expect(palette).toHaveCount(0);
      await settleLayout();
      await expect(page.locator('[data-workspace-panel="explorer"]')).toBeVisible();
      await invoke("shortcuts.open");
      await expect(page.locator(".shortcuts-dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      const platform = await application.evaluate(() => process.platform);
      if (platform !== "darwin") {
        await application.evaluate(({ Menu }) => {
          if (globalThis.__workspaceMenuProbe) throw new Error("Menu observation already active.");
          const original = Menu.prototype.popup;
          const probe = { original, calls: 0, close: undefined };
          globalThis.__workspaceMenuProbe = probe;
          Menu.prototype.popup = function (options) {
            probe.calls++;
            probe.close = () => this.closePopup();
            return original.call(this, options);
          };
        });
        observingMenu = true;
        await command("menu.open").click();
        await expect
          .poll(() => application.evaluate(() => globalThis.__workspaceMenuProbe.calls))
          .toBe(1);
        await application.evaluate(() => globalThis.__workspaceMenuProbe.close());
        await expect(command("menu.open")).toBeFocused();
        await page.keyboard.press("F10");
        await expect
          .poll(() => application.evaluate(() => globalThis.__workspaceMenuProbe.calls))
          .toBe(2);
        await application.evaluate(() => globalThis.__workspaceMenuProbe.close());
        await expect(command("menu.open")).toBeFocused();
      }
      const opening = application.waitForEvent("window", { timeout: 10000 });
      await invoke("window.new");
      extra = await opening;
      await expect(extra.locator(".workspace")).toBeVisible();
      expect(
        (await extra.evaluate(() => window.ohtia.foundation.readPresentation().result)).value,
      ).toEqual(beforePresentation.value);
      await focusNative(native, "per-window layout isolation");
      await command("panels.chat").click();
      await expect(page.locator('[data-workspace-panel="chat"]')).toBeHidden();
      await expect(extra.locator('[data-workspace-panel="chat"]')).toBeVisible();
      await settleLayout();
      await command("panels.chat").click();
      await settleLayout();
      await extra.close();
      extra = undefined;
      await focusNative(native, "workspace after new window");
      await invoke("help.open");
      await expect(page.locator(".help-dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await invoke("about.open");
      const about = page.locator(".about-dialog");
      await expect(about).toBeVisible();
      await about.getByRole("button", { name: text("command.version.copy"), exact: true }).click();
      await expect(about.locator(".about-copied")).toBeVisible();
      const copied = await application.evaluate(async ({ clipboard }) => clipboard.readText());
      expect(copied).toContain(await about.locator("dd").nth(1).innerText());
      await page.keyboard.press("Escape");
      await page.screenshot({ path: path.join(output, "integrated-workspace.png") });
      return {
        geometry,
        entries: ["footer", "rail", "narrow"],
        cases: [
          "shared-settings-layout",
          "separator-key-and-pair-reset",
          "palette-real-command",
          "shortcuts",
          ...(platform !== "darwin" ? ["application-menu-button-and-F10"] : []),
          "new-window-confirmed-preferences",
          "existing-window-layout-stays-local",
          "help-about-copy-version",
        ],
        limitations: [
          "Menu popup dismissal is controlled by the non-shipping observer; physical Alt/menu input, native IME, assistive operators and window-manager first-frame capture remain separately qualified.",
        ],
      };
    },
    async () => {
      if (observingMenu)
        await application.evaluate(({ Menu }) => {
          const probe = globalThis.__workspaceMenuProbe;
          probe.close?.();
          Menu.prototype.popup = probe.original;
          delete globalThis.__workspaceMenuProbe;
        });
      if (extra && !extra.isClosed()) await extra.close();
      await native.evaluate((window, size) => window.setContentSize(...size), originalSize);
      if (initialLayout.ok && initialLayout.value.value) {
        await page.evaluate(async (value) => {
          const current = await window.ohtia.foundation.readLayout().result;
          if (current.ok)
            await window.ohtia.foundation.replaceLayout({
              operationId: crypto.randomUUID(),
              expectedRevision: current.value.revision,
              value,
            }).result;
        }, initialLayout.value.value);
      }
      await native.dispose();
    },
  );
}
