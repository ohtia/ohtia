// V05/V06 on the assembled desktop renderer, real preload and an isolated SQLite store.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { _electron, expect } from "@playwright/test";
import { message, portLimits } from "../packages/contracts/dist/index.js";
import {
  developmentLaunch,
  prepareDevelopmentRoot,
  shortTemporaryDirectory,
} from "./desktop-launch.mjs";
import { setNativeViewport } from "./design-viewport.mjs";
import {
  confirmProjectRenameFixture,
  createProjectRenameFixture,
  originalTitle,
  otherTitle,
  selectProject,
} from "./project-rename-acceptance.mjs";

const [prepared] = process.argv.slice(2);
if (!prepared || !path.isAbsolute(prepared))
  throw new Error("Use an absolute runtime directory produced by desktop:prepare.");

const attempt = shortTemporaryDirectory("ohtia-profile-");
const root = prepareDevelopmentRoot(attempt);
const launch = developmentLaunch(root, prepared, attempt);
let app;
const receipt = {
  artifact: createHash("sha256")
    .update(fs.readFileSync(path.join(prepared, "prepared.json")))
    .digest("hex"),
  host: { platform: process.platform, architecture: os.arch(), release: os.release() },
  locale: null,
  cases: [],
  limitations: [
    "Uses a synthetic setup-confirmed fixture and makes no provider call.",
    "Composition is driven through Chromium CDP. No OS IME or manual assistive journey was exercised.",
  ],
};

function record(name) {
  receipt.cases.push(name);
}

async function start() {
  app = await _electron.launch({
    executablePath: launch.executable,
    args: [launch.app, ...launch.args],
    env: { ...launch.env, OHTIA_RUNTIME_ACCEPTANCE: "1" },
    chromiumSandbox: true,
    artifactsDir: attempt,
  });
  const page = await app.firstWindow();
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok, {
      timeout: portLimits.service_start_ms * 2,
    })
    .toBe(true);
  await page.evaluate(() => window.ohtia.bootstrap.openStorage());
  await expect
    .poll(() => page.evaluate(async () => (await window.ohtia.bootstrap.read()).state), {
      timeout: portLimits.service_start_ms * 2,
    })
    .toBe("storage_ready");
  return page;
}

const documentArea = (page) => page.locator(".workspace-documents");
const profile = (page) => documentArea(page).locator(".thesis-profile");
const field = (page, key) => profile(page).locator(`[data-profile-field="${key}"]`);
const heading = (page, key) => profile(page).locator(`[data-profile-section="${key}"] h3`);
const tab = (page, key) => documentArea(page).getByRole("tab", { name: text(key), exact: true });
const button = (scope, key, params) =>
  scope.getByRole("button", { name: text(key, params), exact: true });
const text = (key, params = {}) => message(receipt.locale, key, params);
const sectionName = (key) => text(`profile.section.${key}`);

async function openProfile(page) {
  await button(page.locator(".project-explorer"), "profile.title").press("Enter");
  await expect(tab(page, "profile.title")).toBeFocused();
  await expect(profile(page)).toBeVisible();
}
async function openFromNavigator(page, action, target) {
  await tab(page, "workspace.navigator").press("Enter");
  await button(documentArea(page), action).press("Enter");
  await expect(heading(page, target)).toBeFocused();
  await expect(tab(page, "profile.title")).toHaveCount(1);
}
async function editSection(page, key) {
  await button(profile(page), "profile.editSection", { section: sectionName(key) }).press("Enter");
  await expect(
    profile(page).locator(`[data-profile-section="${key}"] input:checked`).first(),
  ).toBeFocused();
}
const state = (page, key, value) =>
  field(page, key).locator(`input[type="radio"][value="${value}"]`);

console.log(`Thesis profile workspace evidence: ${attempt}`);
try {
  let page = await start();
  const projects = await createProjectRenameFixture(page);
  await app.close();
  app = undefined;
  confirmProjectRenameFixture(path.join(root, "research", "ohtia.db3"), projects);
  page = await start();
  receipt.locale = await page.locator("html").getAttribute("lang");
  await selectProject(page, originalTitle);
  await openProfile(page);
  await expect(profile(page)).toContainText(text("profile.unset"));
  await expect(page.locator(".project-explorer")).toContainText(
    text("profile.sectionUnanswered", { count: 8 }),
  );
  await editSection(page, "schedule");
  await state(page, "deadline", "unknown").check();
  await openFromNavigator(page, "profile.openResearch", "research");
  await openFromNavigator(page, "profile.openSchedule", "schedule");
  await expect(state(page, "deadline", "unknown")).toBeChecked();
  await selectProject(page, otherTitle);
  await openProfile(page);
  await expect(profile(page)).toContainText(text("profile.unset"));
  await expect(field(page, "deadline").locator("input")).toHaveCount(0);
  await selectProject(page, originalTitle);
  // Returning to the project selects Navigator; the profile tab keeps its pending input.
  await tab(page, "profile.title").press("Enter");
  await expect(state(page, "deadline", "unknown")).toBeChecked();
  await button(profile(page), "profile.save").press("Enter");
  await expect(profile(page)).toContainText(text("profile.savedVersion", { number: 1 }));
  await expect(field(page, "deadline")).toContainText(text("profile.state.unknown"));
  await expect(
    button(profile(page), "profile.editSection", { section: sectionName("schedule") }),
  ).toBeFocused();
  record("single-tab-section-keyboard-pending-project-switch-and-partial-save");

  await openFromNavigator(page, "profile.openResearch", "research");
  await editSection(page, "research");
  await state(page, "questions", "known").check();
  await button(field(page, "questions"), "profile.addItem").press("Enter");
  const firstQuestion = field(page, "questions").getByRole("textbox").first();
  await expect(firstQuestion).toBeFocused();
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 });
    await page.keyboard.insertText("한");
    await page.keyboard.press("Enter");
    await expect(profile(page)).toContainText(text("profile.savedVersion", { number: 1 }));
  } finally {
    await cdp.detach();
  }
  const question = "한글 연구 질문 · ملاحظات";
  await firstQuestion.fill(question);

  const opened = app.waitForEvent("window");
  await page.evaluate(() => window.ohtia.bootstrap.newWindow());
  const second = await opened;
  await selectProject(second, originalTitle);
  await openFromNavigator(second, "profile.openResearch", "research");
  await editSection(second, "research");
  await state(second, "topic", "known").check();
  await field(second, "topic").getByRole("textbox").first().fill("Competing topic");
  await button(profile(second), "profile.save").press("Enter");
  await expect(profile(second)).toContainText(text("profile.savedVersion", { number: 2 }));
  await expect(profile(page)).toContainText(text("profile.conflict"));
  await expect(profile(page)).toContainText(text("profile.savedVersion", { number: 1 }));
  await expect(firstQuestion).toHaveValue(question);
  await button(profile(page), "profile.compare").press("Enter");
  await expect(profile(page)).toContainText(text("profile.savedVersion", { number: 2 }));
  await expect(firstQuestion).toHaveValue(question);
  await button(profile(page), "profile.save").press("Enter");
  await expect(profile(page)).toContainText(text("profile.savedVersion", { number: 3 }));
  await expect(field(page, "topic")).toContainText("Competing topic");
  await expect(page.locator(".project-explorer")).toContainText(
    text("profile.sectionUnanswered", { count: 6 }),
  );
  record("known-question-composition-competing-version-and-checked-save");

  const subtitle = "부제 · Optional subtitle";
  await button(profile(page), "profile.addSubtitle").press("Enter");
  const rename = page.locator("dialog[open]");
  const subtitleInput = rename.getByRole("textbox", { name: text("project.rename.subtitle") });
  await expect(subtitleInput).toBeFocused();
  await subtitleInput.fill(subtitle);
  await button(rename, "project.rename.save").press("Enter");
  await expect(rename).toHaveCount(0);
  await expect(profile(page).locator(".profile-subtitle-text")).toHaveText(subtitle);
  await expect(profile(second).locator(".profile-subtitle-text")).toHaveText(subtitle);
  record("subtitle-saved-with-the-title-revision-in-both-windows");

  const native = await app.browserWindow(page);
  try {
    await setNativeViewport(page, native, { width: 320, height: 650, zoomFactor: 1 });
    for (const appearance of ["light", "dark"]) {
      await page.evaluate(
        (appearance) => (document.documentElement.dataset.appearance = appearance),
        appearance,
      );
      await expect(profile(page)).toBeVisible();
      const { scrollWidth, clientWidth } = await profile(page).evaluate((node) => ({
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      // The working title spans the document width inside the profile's insets.
      const spans = await profile(page).evaluate((article) => {
        const style = getComputedStyle(article);
        const inner =
          article.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return Math.abs(
          article.querySelector(".profile-thesis-title").getBoundingClientRect().width - inner,
        );
      });
      expect(spans).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(attempt, `profile-${appearance}.png`) });
    }
  } finally {
    await native.dispose();
  }
  record("narrow-profile-reflow-both-themes");
  await app.close();
  app = undefined;
  page = await start();
  await selectProject(page, originalTitle);
  await openFromNavigator(page, "profile.openResearch", "research");
  await expect(profile(page)).toContainText(text("profile.savedVersion", { number: 3 }));
  await expect(field(page, "questions")).toContainText(question);
  await expect(field(page, "questions")).toContainText(text("profile.origin.researcher_statement"));
  await openFromNavigator(page, "profile.openSchedule", "schedule");
  await expect(field(page, "deadline")).toContainText(text("profile.state.unknown"));
  await expect(profile(page).locator(".profile-subtitle-text")).toHaveText(subtitle);
  record("restart-restores-version-values-attribution-and-subtitle");
} catch (error) {
  // Keep the failing window's state with the evidence.
  for (const [index, window] of (app?.windows() ?? []).entries())
    await window
      .screenshot({ path: path.join(attempt, `failure-${String(index)}.png`) })
      .catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
  fs.writeFileSync(path.join(attempt, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
}
