/* global document, window, getComputedStyle, KeyboardEvent, CompositionEvent, Event, matchMedia */
import path from "node:path";
import { expect } from "@playwright/test";
import { captureCatalog, watchCatalogPage } from "./catalog-character.mjs";

/** The isolated catalog verifier runs this synthetic geometry and input journey. */
export async function verifyComposerSpecimen(page, url, engine, output) {
  const watch = await watchCatalogPage(page, url, "Composer", engine);
  const cases = [];
  try {
    await page.setViewportSize({ width: 320, height: 1050 });
    for (const theme of ["light", "dark"])
      for (const locale of ["en-US", "de-DE", "ko-KR"]) {
        await page.goto(`${url}?screen=composer&theme=${theme}&locale=${locale}`);
        await page.evaluate(() => document.fonts.ready);
        const input = page.locator(".composer-box textarea");
        await expect(input).toBeVisible();
        const initial = await input.evaluate((element) => element.getBoundingClientRect().height);
        await input.fill("한글 mixed Latin\nSecond line\nThird line");
        const measured = await input.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            height: element.getBoundingClientRect().height,
            horizontal: element.scrollWidth > element.clientWidth,
            font: style.fontSize,
            line: style.lineHeight,
            resize: style.resize,
          };
        });
        expect(measured.height).toBeGreaterThan(initial);
        expect(measured.horizontal).toBe(false);
        expect(measured.font).toBe("16px");
        expect(measured.line).toBe("24px");
        expect(measured.resize).toBe("none");
        await input.fill(Array.from({ length: 30 }, (_, index) => `Line ${index}`).join("\n"));
        expect(
          await input.evaluate((element) => element.getBoundingClientRect().height),
        ).toBeLessThanOrEqual(200);
        await page.locator(".conversation-actions button").nth(1).click();
        const dialog = page.locator("dialog[open]");
        await expect(dialog.locator("[data-close]")).toBeFocused();
        expect(await dialog.locator("[data-close] svg").count()).toBe(1);
        await dialog.locator("[data-close]").click();
        expect(await input.inputValue()).toContain("Line 29");
        await page.locator(".conversation-actions button").nth(1).click();
        await dialog.locator(".primitive-primary").click();
        await expect(input).toHaveValue("A reused message\nwith two lines.");
        await expect(input).toBeFocused();
        const pasted = "😀".repeat(20_001);
        await input.evaluate((element, text) => {
          element.select();
          const event = new Event("paste", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
          element.dispatchEvent(event);
        }, pasted);
        await expect(input).toHaveValue(pasted);
        await expect(page.locator(".composer-action")).toHaveAttribute("aria-disabled", "true");
        await input.fill("한글 mixed Latin");
        await input.evaluate((element) => {
          element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
          element.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
          );
          element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
        });
        await expect(page.getByRole("status").filter({ hasText: "Sending" })).toHaveCount(0);
        await page.keyboard.press("Shift+Enter");
        expect(await input.inputValue()).toContain("\n");
        await page.keyboard.press("Enter");
        await expect(page.locator("output")).toHaveText(/^saving /);
        await page.locator(".composer-action").click();
        await expect(page.locator(".composer-reason")).toBeVisible();
        await page.getByRole("button", { name: "Confirm synthetic save", exact: true }).click();
        await expect(page.locator("output")).toHaveText(/^stopping /);
        await page.getByRole("button", { name: "Confirm synthetic Stop", exact: true }).click();
        await expect(input).toHaveValue("");
        await expect(page.locator(".composer-reason")).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
        await captureCatalog(page.locator(".conversation-specimen-panel"), {
          path: path.join(output, `${engine}-composer-${theme}-${locale}.png`),
        });
        cases.push({
          theme,
          locale,
          width: 280,
          multiline: true,
          reuse: true,
          input: true,
          stop: true,
        });
      }
    await page.goto(`${url}?screen=composer`);
    const pastedInput = page.locator("textarea");
    await pastedInput.fill("Start selected end");
    await pastedInput.evaluate((element) => {
      element.setSelectionRange(6, 14);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: () => "one\r\ntwo\r" },
      });
      element.dispatchEvent(event);
    });
    await expect(pastedInput).toHaveValue("Start one\ntwo\n end");
    await expect
      .poll(() => pastedInput.evaluate((element) => [element.selectionStart, element.selectionEnd]))
      .toEqual([14, 14]);
    await page.locator(".composer-action").click();
    await expect(page.locator("output")).toHaveText(/^saving /);
    await pastedInput.press("End");
    await pastedInput.press("ControlOrMeta+End");
    await pastedInput.pressSequentially("newer");
    await page.getByRole("button", { name: "Confirm synthetic save", exact: true }).click();
    await expect(pastedInput).toHaveValue("newer");
    await page.goto(`${url}?screen=composer&apiKey&expanded`);
    await expect(page.locator(".composer-destination")).toContainText("API key");
    if (engine === "chromium") {
      await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
      await page.locator("textarea").focus();
      expect(
        await page
          .locator(".composer-box")
          .evaluate((element) => getComputedStyle(element).outlineStyle),
      ).not.toBe("none");
      await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
    }
    await page.setViewportSize({ width: 280, height: 1050 });
    await page.goto(`${url}?screen=composer&locale=fr-FR&destinationFailure`);
    const draft = page.locator("textarea");
    await expect(page.locator(".composer-destination-error")).toBeVisible();
    await draft.fill("Draft retained through destination failure");
    await expect(page.locator(".composer-action")).toHaveAttribute("aria-disabled", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await captureCatalog(page.locator(".conversation-specimen-panel"), {
      path: path.join(output, `${engine}-composer-destination-failure.png`),
    });
    await page.getByRole("button", { name: "Restore synthetic destination", exact: true }).click();
    await page.locator(".composer-destination-error button").click();
    await expect(page.locator(".composer-destination-error")).toHaveCount(0);
    await expect(page.locator(".composer-action")).toHaveAttribute("aria-disabled", "false");
    await expect(draft).toHaveValue("Draft retained through destination failure");
    await page.getByRole("button", { name: "Show synthetic exit", exact: true }).click();
    const exit = page.locator(".exit-dialog[open]");
    const close = exit.locator(".primitive-dialog-footer [data-close]");
    await expect(close).toBeFocused();
    await expect(close.locator("svg")).toHaveCount(1);
    await expect(exit.locator(".primitive-dialog-header button")).toHaveCount(0);
    const geometry = await exit.locator(".primitive-dialog-footer button").evaluateAll((buttons) =>
      buttons.map((button) => ({
        top: button.getBoundingClientRect().top,
        bottom: button.getBoundingClientRect().bottom,
        height: button.getBoundingClientRect().height,
        client: button.clientHeight,
        scroll: button.scrollHeight,
      })),
    );
    expect(geometry[0].height).toBeGreaterThan(32);
    for (let index = 0; index < geometry.length; index++) {
      expect(geometry[index].scroll).toBeLessThanOrEqual(geometry[index].client + 1);
      if (index) expect(geometry[index - 1].bottom).toBeLessThanOrEqual(geometry[index].top);
    }
    await captureCatalog(exit, { path: path.join(output, `${engine}-composer-exit-footer.png`) });
    await close.click();
    await page.goto(`${url}?screen=composer&destinationPending`);
    await page.locator("textarea").fill("Draft waiting for metadata");
    await expect(page.locator(".composer-reason")).toHaveText("Reading the message destination…");
    await expect(page.locator(".composer-action")).toHaveAttribute("aria-disabled", "true");
    await captureCatalog(page.locator(".conversation-specimen-panel"), {
      path: path.join(output, `${engine}-composer-destination-loading.png`),
    });
    await page.getByRole("button", { name: "Confirm synthetic destination", exact: true }).click();
    await expect(page.locator(".composer-reason")).toHaveCount(0);
    await expect(page.locator(".composer-action")).toHaveAttribute("aria-disabled", "false");
    await expect(page.locator("textarea")).toHaveValue("Draft waiting for metadata");
    await page.getByRole("button", { name: "Show synthetic palette", exact: true }).click();
    const paletteClose = page.locator(".command-palette > [data-close]");
    await expect(paletteClose).toBeVisible();
    const fine = await paletteClose.boundingBox();
    expect(fine.width).toBe(32);
    expect(fine.height).toBe(32);
    await paletteClose.click();
    if (engine === "chromium") {
      const touch = await page
        .context()
        .browser()
        .newContext({ hasTouch: true, viewport: { width: 280, height: 1050 } });
      const touchPage = await touch.newPage();
      const touchWatch = await watchCatalogPage(touchPage, url, "Composer palette coarse", engine);
      try {
        await touchPage.goto(`${url}?screen=composer`);
        expect(await touchPage.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
        await touchPage
          .getByRole("button", { name: "Show synthetic palette", exact: true })
          .click();
        const coarseClose = touchPage.locator(".command-palette > [data-close]");
        await expect(coarseClose).toBeVisible();
        const coarse = await coarseClose.boundingBox();
        expect(coarse.width).toBe(44);
        expect(coarse.height).toBe(44);
        await coarseClose.click();
        await touchPage.setViewportSize({ width: 1280, height: 400 });
        await touchPage.goto(`${url}?screen=composer&workspace`);
        const headerControls = touchPage.locator(
          ".workspace-chat-heading [data-workspace-size=chat]",
        );
        await expect(headerControls).toHaveCount(2);
        for (const control of await headerControls.all()) {
          const rect = await control.boundingBox();
          expect(rect.width).toBeGreaterThanOrEqual(44);
          expect(rect.height).toBeGreaterThanOrEqual(44);
        }
        await touchWatch.assert();
      } finally {
        await touchWatch.dispose();
        await touch.close();
      }
    }
    for (const viewState of ["ready", "loading", "failed", "unavailable"]) {
      await page.goto(`${url}?screen=composer&viewState=${viewState}`);
      const composer = page.locator(".message-composer");
      await expect(composer).toBeVisible();
      const placement = await composer.evaluate((element) => ({
        margin: getComputedStyle(element).marginBlockEnd,
        gap:
          element.parentElement.getBoundingClientRect().bottom -
          element.getBoundingClientRect().bottom,
      }));
      expect(placement.margin).toBe("0px");
      expect(Math.abs(placement.gap)).toBeLessThanOrEqual(1);
    }
    for (const height of [800, 400]) {
      await page.setViewportSize({ width: 1280, height });
      for (const viewState of ["ready", "loading", "failed", "unavailable"]) {
        await page.goto(`${url}?screen=composer&workspace&viewState=${viewState}`);
        const composer = page.locator(".workspace-chat .message-composer");
        await expect(composer).toBeVisible();
        if (viewState === "ready")
          await composer.locator("textarea").fill("Multiline preview\n".repeat(20));
        const placement = await composer.evaluate((element) => {
          const view = element.closest(".conversation-view").getBoundingClientRect();
          const scroll = element.closest(".workspace-panel-scroll").getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return {
            margin: getComputedStyle(element).marginBlockEnd,
            viewGap: view.bottom - box.bottom,
            scrollGap: scroll.bottom - view.bottom,
            bottom: box.bottom,
            viewport: window.innerHeight,
          };
        });
        expect(placement.margin).toBe("0px");
        expect(Math.abs(placement.viewGap)).toBeLessThanOrEqual(1);
        expect(Math.abs(placement.scrollGap)).toBeLessThanOrEqual(1);
        expect(placement.bottom).toBeLessThanOrEqual(placement.viewport);
        if (viewState === "ready")
          await captureCatalog(page.locator(".workspace-chat"), {
            path: path.join(output, `${engine}-composer-workspace-${height}.png`),
          });
      }
    }
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.goto(`${url}?screen=composer&workspace&stackedNotices&destinationFailure`);
    const crowded = page.locator(".message-composer");
    await expect(crowded.locator(".composer-stop-error")).toBeVisible();
    await expect(crowded.locator(".composer-destination-error")).toBeVisible();
    const scrolling = await crowded.evaluate((element) => ({
      overflow: getComputedStyle(element).overflowY,
      client: element.clientHeight,
      scroll: element.scrollHeight,
    }));
    expect(scrolling.overflow).toBe("auto");
    expect(scrolling.scroll).toBeGreaterThan(scrolling.client);
    const crowdedBox = await crowded.boundingBox();
    await page.mouse.move(
      crowdedBox.x + crowdedBox.width - 8,
      crowdedBox.y + crowdedBox.height - 8,
    );
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => crowded.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    for (const selector of [".composer-stop-error button", ".composer-destination-error button"]) {
      const action = crowded.locator(selector);
      await action.scrollIntoViewIfNeeded();
      const bounds = await action.boundingBox();
      expect(bounds.y).toBeGreaterThanOrEqual(crowdedBox.y);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(crowdedBox.y + crowdedBox.height + 1);
      await action.click();
    }
    const history = page.locator(".conversation-status-scroll, .conversation-content");
    await expect(history).toHaveCount(1);
    const historyHeight = (await history.boundingBox()).height;
    const conversationHeight = (await page.locator(".conversation-view").boundingBox()).height;
    expect(historyHeight).toBeGreaterThanOrEqual(Math.min(48, conversationHeight * 0.2) - 1);
    await captureCatalog(page.locator(".workspace-chat"), {
      path: path.join(output, `${engine}-composer-stacked-notices.png`),
    });
    await page.goto(`${url}?screen=composer&workspace`);
    const compact = await page.locator(".workspace-chat").evaluate((panel) => {
      const composer = panel.querySelector(".message-composer"),
        timeline = panel.querySelector(".conversation-timeline"),
        agent = panel.querySelector(".conversation-message.agent");
      const header = panel.querySelector(".workspace-chat-heading"),
        controls = header.querySelector(".workspace-sizing");
      return {
        composerPadding: getComputedStyle(composer).paddingInlineStart,
        inputStart:
          composer.querySelector(".composer-box").getBoundingClientRect().left -
          panel.getBoundingClientRect().left,
        inputEnd:
          panel.getBoundingClientRect().right -
          composer.querySelector(".composer-box").getBoundingClientRect().right,
        timelinePadding: getComputedStyle(timeline).paddingInlineStart,
        trailingMargin: getComputedStyle(panel.querySelector(".workspace-panel-scroll"))
          .marginInlineEnd,
        footerControls: panel.querySelectorAll(":scope > .workspace-sizing").length,
        headerBottom: header.getBoundingClientRect().bottom,
        controlBottom: controls.getBoundingClientRect().bottom,
        controlTop: controls.getBoundingClientRect().top,
        headerTop: header.getBoundingClientRect().top,
        ...(agent ? { agentPadding: getComputedStyle(agent).paddingInlineStart } : {}),
      };
    });
    expect(compact.composerPadding).toBe("12px");
    expect(compact.inputStart).toBe(12);
    expect(compact.inputEnd).toBe(12);
    expect(compact.timelinePadding).toBe("12px");
    expect(compact.agentPadding).toBe("0px");
    expect(compact.trailingMargin).toBe("0px");
    expect(compact.footerControls).toBe(0);
    expect(compact.controlTop).toBeGreaterThanOrEqual(compact.headerTop);
    expect(compact.controlBottom).toBeLessThanOrEqual(compact.headerBottom);
    await watch.assert();
    return {
      cases,
      apiKey: true,
      destinationRecovery: true,
      destinationLoading: true,
      wrappedExitFooter: true,
      workspaceAnchored: true,
      compactWorkspace: true,
      stackedNoticeRecovery: true,
      paletteCloseFine: true,
      paletteCloseCoarse: engine === "chromium",
      pseudolocalization: true,
      limitations: [
        "Synthetic catalog and simulated composition; no real-account, native input-method or manual screen-reader evidence.",
      ],
    };
  } finally {
    await watch.dispose();
  }
}
