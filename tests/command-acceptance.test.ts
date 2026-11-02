// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeCommandDialog } from "../tooling/command-presentation.mjs";
import { verifyCommandsAfterDeniedNavigation } from "../tooling/command-acceptance.mjs";

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.commandAcceptanceDocument;
  vi.restoreAllMocks();
});
function fixture() {
  const dialog = document.createElement("dialog");
  dialog.className = "about-dialog";
  document.body.append(dialog);
  // Geometry is a controlled adapter input; jsdom has no browser layout engine.
  const geometry = vi
    .spyOn(dialog, "getBoundingClientRect")
    .mockImplementation(
      () => ({ width: dialog.open ? 480 : 0, height: dialog.open ? 600 : 0 }) as DOMRect,
    );
  const expectedDocument = { url: window.location.href, token: "synthetic-document" };
  document.documentElement.dataset.commandAcceptanceDocument = expectedDocument.token;
  let focused = false;
  let refuseFocus = false;
  const native = {
    id: 7,
    focus: () => {
      if (!refuseFocus) focused = true;
    },
    isFocused: () => focused,
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    webContents: { focus: vi.fn(), getURL: () => window.location.href },
  };
  const handle = {
    evaluate: async (callback: (window: typeof native) => unknown) => callback(native),
    dispose: vi.fn(async () => {}),
  };
  const item = {
    enabled: true,
    click: vi.fn(() => {
      dialog.open = true;
    }),
  };
  let menuItem: typeof item | null = item;
  const electron = {
    Menu: {
      getApplicationMenu: () => ({
        getMenuItemById: (id: string) => (id === "about.open" ? menuItem : null),
      }),
    },
    BrowserWindow: {
      getFocusedWindow: () => (focused ? native : undefined),
      getAllWindows: () => [native],
    },
  };
  const application = {
    browserWindow: async () => handle,
    evaluate: async (
      callback: (api: typeof electron, argument: unknown) => unknown,
      argument?: unknown,
    ) => callback(electron, argument),
  };
  const page = {
    evaluate: async (callback: (argument?: string) => unknown, argument?: string) =>
      callback(argument),
    locator: vi.fn(() => {
      throw new Error("Cancelled navigation has no completion event.");
    }),
    reload: vi.fn(() => {
      throw new Error("Reload would discard the registry under test.");
    }),
    keyboard: {
      press: vi.fn(async (key: string) => {
        if (key === "Escape") dialog.open = false;
      }),
    },
  };
  return {
    dialog,
    page,
    application,
    handle,
    item,
    geometry,
    expectedDocument,
    setMenuItem: (next: typeof item | null) => {
      menuItem = next;
    },
    refuseFocus: () => {
      refuseFocus = true;
    },
  };
}

describe("commands after denied navigation", () => {
  it("observes missing, closed, shown and CSS-hidden dialogs from the admitted document", async () => {
    const f = fixture();
    expect(await observeCommandDialog(f.page, ".missing")).toEqual({ open: false, visible: false });
    expect(await observeCommandDialog(f.page, ".about-dialog")).toEqual({
      open: false,
      visible: false,
    });
    f.dialog.open = true;
    expect(await observeCommandDialog(f.page, ".about-dialog")).toEqual({
      open: true,
      visible: true,
    });
    f.geometry.mockReturnValueOnce({ width: 0, height: 600 } as DOMRect);
    expect(await observeCommandDialog(f.page, ".about-dialog")).toEqual({
      open: true,
      visible: false,
    });
    f.geometry.mockReturnValueOnce({ width: 480, height: 0 } as DOMRect);
    expect(await observeCommandDialog(f.page, ".about-dialog")).toEqual({
      open: true,
      visible: false,
    });
    f.dialog.style.visibility = "hidden";
    expect(await observeCommandDialog(f.page, ".about-dialog")).toEqual({
      open: true,
      visible: false,
    });
    const nonDialog = document.createElement("div");
    nonDialog.className = "non-dialog";
    document.body.append(nonDialog);
    expect(await observeCommandDialog(f.page, ".non-dialog")).toEqual({
      open: false,
      visible: false,
    });
    document.body.append(f.dialog.cloneNode(true));
    await expect(observeCommandDialog(f.page, ".about-dialog")).rejects.toThrow(
      /identify one surface/,
    );
  });
  it("opens and dismisses About through the native callback while navigation-aware locators remain blocked", async () => {
    const f = fixture();
    const observed = await verifyCommandsAfterDeniedNavigation(
      f.application,
      f.page,
      f.expectedDocument,
    );
    expect(observed).toEqual({
      shown: { open: true, visible: true },
      hidden: { open: false, visible: false },
      document: f.expectedDocument,
      mainUrl: f.expectedDocument.url,
      nativeFocus: {
        target: "admitted document",
        strategy: "native focus request",
        compositorInputAttempts: 0,
        focused: true,
      },
    });
    expect(f.item.click).toHaveBeenCalledOnce();
    expect(f.dialog.open).toBe(false);
    expect(f.page.keyboard.press).toHaveBeenCalledWith("Escape");
    expect(f.page.locator).not.toHaveBeenCalled();
    expect(f.page.reload).not.toHaveBeenCalled();
    expect(f.handle.dispose).toHaveBeenCalledOnce();
  });
  it("retains the failed phase and native focus evidence while releasing its handle", async () => {
    const f = fixture();
    f.item.click.mockImplementation(() => {
      throw new Error("Synthetic menu refusal.");
    });
    await expect(
      verifyCommandsAfterDeniedNavigation(f.application, f.page, f.expectedDocument),
    ).rejects.toThrow(/dispatch About; native state.*"focusedWindowId":7.*Synthetic menu refusal/);
    expect(f.handle.dispose).toHaveBeenCalledOnce();
    expect(f.page.reload).not.toHaveBeenCalled();
  });
  it.each(["missing", "disabled"] as const)(
    "distinguishes a %s About item in failure diagnostics",
    async (state) => {
      const f = fixture();
      if (state === "missing") f.setMenuItem(null);
      else f.item.enabled = false;
      f.handle.evaluate = async () => {
        throw new Error("Synthetic native handle refusal.");
      };
      let failure: unknown;
      try {
        await verifyCommandsAfterDeniedNavigation(f.application, f.page, f.expectedDocument);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      const message = (failure as Error).message;
      expect(message).toContain(`"aboutPresent":${String(state !== "missing")}`);
      expect(message).toContain('"aboutEnabled":false');
      expect(f.item.click).not.toHaveBeenCalled();
      expect(f.handle.dispose).toHaveBeenCalledOnce();
    },
  );

  it("refuses to dispatch when the target never obtains actual OS focus", async () => {
    const f = fixture();
    f.refuseFocus();
    await expect(
      verifyCommandsAfterDeniedNavigation(f.application, f.page, f.expectedDocument),
    ).rejects.toThrow(/focus the native window; native state.*"focusedWindowId":null/);
    expect(f.item.click).not.toHaveBeenCalled();
    expect(f.handle.dispose).toHaveBeenCalledOnce();
  });
  it("rejects a replacement document even when the About flow appears to finish", async () => {
    const f = fixture();
    f.item.click.mockImplementation(() => {
      f.dialog.open = true;
      document.documentElement.dataset.commandAcceptanceDocument = "replacement-document";
    });
    await expect(
      verifyCommandsAfterDeniedNavigation(f.application, f.page, f.expectedDocument),
    ).rejects.toThrow(/verify the admitted document/);
    expect(f.handle.dispose).toHaveBeenCalledOnce();
  });
});
