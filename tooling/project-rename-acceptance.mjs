// Non-shipping verification for the actual renderer, broker, preload and native store.
import { createRequire } from "node:module";
import { expect } from "@playwright/test";
import { message, portLimits } from "../packages/contracts/dist/index.js";
import { setNativeViewport } from "./design-viewport.mjs";

export const originalTitle = "Initial thesis";
export const otherTitle = "Another thesis";
const firstTitle = "한글 " + "A".repeat(120) + " مراجعة";
const competingTitle = "Competing title";

export async function createProjectRenameFixture(page) {
  const outcomes = await page.evaluate(async () => {
    const port = window.ohtia.foundation;
    const first = await port.createProject(crypto.randomUUID()).result;
    const second = await port.createProject(crypto.randomUUID()).result;
    return [first, second];
  });
  expect(outcomes.every(({ ok }) => ok)).toBe(true);
  return outcomes.map(({ value }) => value.resultId);
}

/** Used only with the acceptance application's own fixture closed. */
export function confirmProjectRenameFixture(file, projects) {
  const require = createRequire(new URL("../packages/utility/package.json", import.meta.url));
  const Database = require("better-sqlite3");
  const db = new Database(file, { fileMustExist: true });
  try {
    const confirm = db.prepare(
      "UPDATE projects SET title=?, document_language='en', setup_confirmed_at=created_at " +
        "WHERE id=? AND setup_confirmed_at IS NULL",
    );
    db.transaction(() => {
      for (const [index, id] of projects.entries())
        expect(
          confirm.run(
            [originalTitle, otherTitle][index],
            Buffer.from(id.replaceAll("-", ""), "hex"),
          ).changes,
        ).toBe(1);
    })();
  } finally {
    db.close();
  }
}

export async function selectProject(page, title) {
  const selector = page.locator(".project-selector-button");
  if ((await selector.locator("bdi").textContent()) !== title) {
    await selector.press("Enter");
    await page
      .getByRole("option")
      .filter({ has: page.getByText(title, { exact: true }) })
      .click();
  }
  await expect(selector.locator("bdi")).toHaveText(title);
}

export async function verifyPackagedProjectRename(application, first, projects, locale) {
  const text = (key) => message(locale, key);
  const selector = first.locator(".project-selector-button");
  const [projectId, otherProjectId] = projects;
  const next = application.waitForEvent("window");
  await first.evaluate(() => window.ohtia.bootstrap.newWindow());
  const second = await next;
  await selectProject(first, originalTitle);
  await selectProject(second, originalTitle);
  await expect(first.locator("html")).toHaveAttribute("lang", locale);
  await expect(second.locator("html")).toHaveAttribute("lang", locale);
  const trigger = (page) =>
    page.getByRole("button", { name: text("command.project.rename"), exact: true });
  await expect(trigger(first)).toBeEnabled();
  await expect(trigger(second)).toBeEnabled();

  const denied = await first.evaluate(
    ({ otherProjectId, firstTitle }) =>
      window.ohtia.foundation.renameProject(crypto.randomUUID(), {
        projectId: otherProjectId,
        title: firstTitle,
        expectedTitleRevision: 1,
      }).result,
    { otherProjectId, firstTitle },
  );
  expect(denied).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  const dialog = (page) =>
    page.getByRole("dialog", { name: text("command.project.rename"), exact: true });
  const field = (page) => dialog(page).getByRole("textbox", { name: text("project.rename.title") });
  const native = await application.browserWindow(first);
  try {
    await setNativeViewport(first, native, { width: 320, height: 600, zoomFactor: 1 });
    for (const theme of ["light", "dark"]) {
      await first.evaluate((theme) => (document.documentElement.dataset.appearance = theme), theme);
      await trigger(first).focus();
      await first.keyboard.press("Enter");
      await expect(field(first)).toBeFocused();
      const geometry = await dialog(first).evaluate((node) => ({
        width: node.getBoundingClientRect().width,
        viewport: innerWidth,
        content: node.scrollWidth,
        client: node.clientWidth,
      }));
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.content).toBeLessThanOrEqual(geometry.client);
      await first.keyboard.press("Escape");
      await expect(trigger(first)).toBeFocused();
    }
    await trigger(second).click();
    await field(second).fill(competingTitle);
    await trigger(first).click();
    await expect(field(first)).toBeFocused();

    const cdp = await first.context().newCDPSession(first);
    try {
      await cdp.send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 });
      await first.keyboard.insertText("한");
      await first.keyboard.press("Enter");
      await expect(dialog(first)).toBeVisible();
    } finally {
      await cdp.detach();
    }
    await field(first).fill(firstTitle);
    await native.evaluate((window) => {
      const frame = window.webContents.mainFrame;
      const send = frame.send;
      const operations = [];
      window.projectRenameEvidence = {
        operations,
        restore: () => {
          frame.send = send;
        },
      };
      frame.send = function (channel, payload) {
        if (typeof payload === "string") {
          const answer = JSON.parse(payload);
          if (
            answer.kind === "result" &&
            answer.operation === "project.rename" &&
            answer.payload.ok
          ) {
            operations.push(answer.operationId);
            if (operations.length === 1) return;
          }
          if (
            answer.kind === "result" &&
            answer.operation === "project.read" &&
            operations.length === 2
          ) {
            answer.payload = {
              ok: false,
              error: { code: "storage_failed", nextAction: "retry_later", parameters: {} },
            };
            return send.call(this, channel, JSON.stringify(answer));
          }
        }
        return send.call(this, channel, payload);
      };
    });
    await first.keyboard.press("Enter");
    await expect(dialog(first).getByText(text("project.rename.uncertain"))).toBeVisible({
      timeout: portLimits.request_deadline_ms + 5000,
    });
    await expect(field(first)).toHaveValue(firstTitle);
    await dialog(first)
      .getByRole("button", { name: text("workspace.check") })
      .click();
    await expect(dialog(first)).toHaveCount(0);
    await expect(selector.locator("bdi")).toHaveText(firstTitle);
    await expect(first.getByText(text("project.rename.refreshFailed"))).toBeVisible();
    const operations = await native.evaluate((window) => window.projectRenameEvidence.operations);
    expect(operations).toHaveLength(2);
    expect(operations[1]).toBe(operations[0]);

    await field(second).press("Enter");
    await expect(dialog(second).getByText(text("project.rename.stale"))).toBeVisible();
    await expect(field(second)).toHaveValue(competingTitle);
    await dialog(second)
      .getByRole("button", { name: text("project.reload") })
      .click();
    await expect(dialog(second).getByText(firstTitle, { exact: true })).toBeVisible();
    await field(second).press("Enter");
    await expect(dialog(second)).toHaveCount(0);
    await expect(second.locator(".project-selector-button bdi")).toHaveText(competingTitle);
    const stored = await second.evaluate(
      (projectId) => window.ohtia.foundation.readProject({ projectId }).result,
      projectId,
    );
    expect(stored).toMatchObject({
      ok: true,
      value: { id: projectId, title: competingTitle, titleRevision: 3, documentLanguage: "en" },
    });
    const reload = first.locator(".project-rename-refresh button");
    await expect(reload).toBeVisible();
    await reload.focus();
    await native.evaluate((window) => {
      window.projectRenameEvidence.restore();
    });
    const nextTitle = "Title refreshed in the background";
    const nextSave = await second.evaluate(
      ({ projectId, nextTitle }) =>
        window.ohtia.foundation.renameProject(crypto.randomUUID(), {
          projectId,
          title: nextTitle,
          expectedTitleRevision: 3,
        }).result,
      { projectId, nextTitle },
    );
    expect(nextSave).toMatchObject({
      ok: true,
      value: { titleChange: { title: nextTitle, titleRevision: 4 } },
    });
    await expect(selector.locator("bdi")).toHaveText(nextTitle);
    await expect(reload).toHaveCount(0);
    await expect(selector).toBeFocused();
    await selectProject(first, otherTitle);
    await selectProject(first, nextTitle);
    return {
      locale,
      themes: ["light", "dark"],
      viewport: 320,
      ime: "Chromium composition and text insertion",
      exactReplay: true,
      wrongScopeRefused: true,
      concurrentConflict: true,
      confirmedThroughReadFailure: true,
      focusRestoredAfterBackgroundRefresh: true,
    };
  } finally {
    await native.evaluate((window) => {
      window.projectRenameEvidence?.restore();
      delete window.projectRenameEvidence;
    });
    await native.dispose();
  }
}
