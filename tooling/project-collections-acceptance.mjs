// Verify the assembled production app with an isolated SQLite store and disconnected providers.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { _electron, expect } from "@playwright/test";
import {
  developmentLaunch,
  prepareDevelopmentRoot,
  shortTemporaryDirectory,
} from "./desktop-launch.mjs";
import { setNativeViewport } from "./design-viewport.mjs";
import { openWorkspaceSettings } from "./command-workspace.mjs";
import { desktopChannels, failure, message, portLimits } from "../packages/contracts/dist/index.js";

const [prepared] = process.argv.slice(2);
if (!prepared || !path.isAbsolute(prepared))
  throw new Error("Use an absolute runtime directory produced by desktop:prepare.");

const attempt = shortTemporaryDirectory("ohtia-collections-");
const root = prepareDevelopmentRoot(attempt);
const launch = developmentLaunch(root, prepared, attempt);
const projects = [
  { number: 1, title: "한글로 쓴 연구 제목", language: "ko-KR" },
  { number: 2, title: "A".repeat(120), language: "en-US" },
  { number: 3, title: "Research notes — ملاحظات علمية", language: "en-US" },
];
const id = (number) => `019a8000-0000-7000-8000-${String(number).padStart(12, "0")}`;
const bytes = (number) => Buffer.from(id(number).replaceAll("-", ""), "hex");
const date = "2026-11-17T10:00:00.000Z";
let app;

async function start() {
  app = await _electron.launch({
    executablePath: launch.executable,
    args: [launch.app, ...launch.args],
    env: { ...launch.env, OHTIA_RUNTIME_ACCEPTANCE: "1" },
    chromiumSandbox: true,
    colorScheme: null,
    artifactsDir: attempt,
  });
  const page = await app.firstWindow();
  await expect
    .poll(async () => (await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok, {
      timeout: portLimits.service_start_ms * 2,
    })
    .toBe(true);
  return page;
}

function seedExistingProjects() {
  const require = createRequire(new URL("../packages/utility/package.json", import.meta.url));
  const Database = require("better-sqlite3");
  const db = new Database(path.join(root, "research", "ohtia.db3"), { fileMustExist: true });
  try {
    db.pragma("foreign_keys = ON");
    const project = db.prepare(
      "INSERT INTO projects (id,project_type,title,document_language,is_development,setup_confirmed_at,created_at,updated_at,last_opened_at) VALUES (?,'thesis',?,?,0,?,?,?,?)",
    );
    const conversation = db.prepare(
      "INSERT INTO conversations (id,project_id,title,created_at,updated_at,revision) VALUES (?,?,?,?,?,1)",
    );
    const timelineMessage = db.prepare(
      "INSERT INTO messages (id,conversation_id,position,author_kind,content,created_at) VALUES (?,?,?,'researcher',?,?)",
    );
    db.transaction(() => {
      for (const { number, title, language } of projects)
        project.run(
          bytes(number),
          title,
          language,
          date,
          date,
          date,
          number === 2 ? "2026-11-18T10:00:00.000Z" : date,
        );
      for (let number = 1; number <= 51; ++number)
        conversation.run(bytes(100 + number), bytes(2), `Interview ${number}`, date, date);
      conversation.run(bytes(201), bytes(3), "Other project's conversation", date, date);
      for (let position = 1; position <= 24; ++position)
        timelineMessage.run(bytes(300 + position), bytes(151), position, `Note ${position}`, date);
    })();
  } finally {
    db.close();
  }
}

console.log(`Project collection evidence: ${attempt}`);
try {
  let page = await start();
  await page.evaluate(() => window.ohtia.bootstrap.openStorage());
  await expect
    .poll(() => page.evaluate(async () => (await window.ohtia.bootstrap.read()).state), {
      timeout: portLimits.service_start_ms * 2,
    })
    .toBe("storage_ready");
  await app.close();
  app = undefined;
  seedExistingProjects();
  page = await start();
  const change = async (method, reader, value) =>
    page.evaluate(
      async ({ method, reader, value, operationId }) => {
        const port = window.ohtia.foundation;
        const read = await port[reader]().result;
        if (!read.ok) return read;
        return port[method]({
          operationId,
          expectedRevision: (read.value.record ?? read.value).revision,
          value,
        }).result;
      },
      { method, reader, value, operationId: randomUUID() },
    );
  const button = (scope, key, locale = "en-US") =>
    scope.getByRole("button", { name: message(locale, key), exact: true });
  expect((await change("replaceLocale", "readLocale", "en-US")).ok).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  const native = await app.browserWindow(page);
  await setNativeViewport(page, native, { width: 1280, height: 720, zoomFactor: 1 });
  const explorer = page.locator(".workspace-explorer .project-explorer");
  const chat = page.locator(".workspace-chat");
  const picker = page.getByRole("combobox", { name: message("en-US", "project.current") });
  const title = explorer.locator(".project-explorer-title bdi");
  async function selectProject(project) {
    await picker.press("Enter");
    const option = page.getByRole("option").filter({ hasText: project.title });
    await expect(option).toHaveAccessibleName(new RegExp(project.title));
    await option.click();
    await expect(title).toHaveText(project.title);
  }
  await expect(title).toHaveText(projects[1].title);
  const conversations = button(explorer, "history.title");
  const conversationGroup = explorer.locator(
    `[id="${await conversations.getAttribute("aria-controls")}"]`,
  );
  await conversations.press("Enter");
  await expect(explorer.getByRole("button", { name: "Interview 51", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(explorer.getByRole("button", { name: "Interview 1", exact: true })).toHaveCount(0);
  await button(explorer, "workspace.materials").press("Space");
  await expect(conversations).toHaveAttribute("aria-expanded", "true");
  async function interceptOlderPage(rejection = null) {
    await native.evaluate(
      (window, { channel, oldest, rejection }) => {
        const frame = window.webContents.mainFrame;
        const send = frame.send;
        frame.send = function (name, ...values) {
          if (name === channel && typeof values[0] === "string") {
            const result = JSON.parse(values[0]);
            if (
              result.kind === "result" &&
              result.operation === "conversation.list" &&
              result.payload.ok &&
              result.payload.value.items.some((item) => item.id === oldest)
            ) {
              frame.send = send;
              if (rejection)
                send.call(frame, name, JSON.stringify({ ...result, payload: rejection }));
              else globalThis.releaseOlderConversations = () => send.call(frame, name, ...values);
              return;
            }
          }
          send.call(frame, name, ...values);
        };
      },
      { channel: desktopChannels.reply, oldest: id(101), rejection },
    );
  }
  // Keep one real SQLite response in the original window until its project scope has changed twice.
  await interceptOlderPage();
  await button(explorer, "history.loadOlder").press("Enter");
  await expect
    .poll(() => app.evaluate(() => typeof globalThis.releaseOlderConversations))
    .toBe("function");
  await expect(conversationGroup.getByRole("status")).toHaveText(
    message("en-US", "history.olderLoading"),
  );
  await selectProject(projects[0]);
  await selectProject(projects[1]);
  await expect(button(explorer, "history.loadOlder")).toBeEnabled();
  await app.evaluate(() => {
    globalThis.releaseOlderConversations();
    delete globalThis.releaseOlderConversations;
  });
  // A subsequent reply on the same IPC channel establishes delivery of the older reply.
  expect((await page.evaluate(() => window.ohtia.foundation.readStatus().result)).ok).toBe(true);
  await expect(explorer.getByRole("button", { name: "Interview 1", exact: true })).toHaveCount(0);

  await interceptOlderPage(failure("storage_failed"));
  await button(explorer, "history.loadOlder").press("Enter");
  await expect(explorer.getByRole("alert")).toHaveText(message("en-US", "history.olderFailed"));
  await expect(explorer.getByRole("button", { name: "Interview 51", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await button(explorer, "history.loadOlder").press("Enter");
  await expect(explorer.getByRole("button", { name: "Interview 1", exact: true })).toBeVisible();
  await expect(conversations).toBeFocused();
  await expect(explorer.getByRole("button", { name: "Interview 51", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await conversations.press("Enter");
  await expect(conversations).toHaveAttribute("aria-expanded", "false");
  const connection = await page.evaluate(
    () => window.ohtia.foundation.readConnection("chatgpt").result,
  );
  expect(connection.value.state).toBe("disconnected");
  const memory = "Synthetic memory persisted in the confirmed thesis.";
  const saved = await page.evaluate(
    ({ projectId, operationId, text }) =>
      window.ohtia.foundation.addMemory(operationId, { projectId, kind: "note", text }).result,
    { projectId: id(2), operationId: randomUUID(), text: memory },
  );
  expect(saved.ok).toBe(true);
  await button(explorer, "memory.title").press("Enter");
  await expect(page.getByRole("tab", { name: message("en-US", "memory.title") })).toBeFocused();
  await expect(page.getByText(memory, { exact: true })).toBeVisible();
  if (!(await chat.isVisible())) await button(page, "workspace.chat.open").press("Enter");
  await expect(button(chat, "history.show")).toBeVisible();
  await button(chat, "history.show").press("Enter");
  await expect(button(chat, "history.return")).toBeFocused();
  await button(chat, "history.return").press("Enter");
  await expect(button(chat, "history.show")).toBeFocused();
  await expect(page.getByText(memory, { exact: true })).toBeVisible();

  for (const project of [projects[0], projects[2], projects[1]]) {
    await selectProject(project);
    if (project.number === 1) {
      await button(explorer, "history.title").press("Enter");
      await expect(explorer.getByText(message("en-US", "history.noConversations"))).toBeVisible();
      await expect(explorer.getByText(message("en-US", "setup.explorer"))).toBeVisible();
    } else if (project.number === 3) {
      await button(explorer, "history.title").press("Enter");
      await expect(
        explorer.getByRole("button", { name: "Other project's conversation", exact: true }),
      ).toHaveAttribute("aria-current", "true");
      await expect(explorer.getByRole("button", { name: "Interview 51", exact: true })).toHaveCount(
        0,
      );
    }
  }

  // Re-enter the project for each layout so history starts without any pages from the explorer.
  const heading = chat.getByRole("heading", { level: 2 });
  const viewport = chat.locator(":scope > .workspace-panel-scroll");
  const timeline = chat.locator(".conversation-timeline");
  const composer = chat.getByRole("textbox");
  const rows = chat.locator(".chat-history-row");
  const older = button(chat, "history.loadOlder");
  const scrollTop = (locator) => locator.evaluate((node) => node.scrollTop);
  const withinViewport = (locator) =>
    locator.evaluate((node) => {
      const viewport = node.closest(".workspace-panel-scroll");
      const { top, bottom } = node.getBoundingClientRect();
      const scrollportTop = viewport.getBoundingClientRect().top + viewport.clientTop;
      return top >= scrollportTop && bottom <= scrollportTop + viewport.clientHeight;
    });
  const stationaryLayout = () =>
    viewport.evaluate((node) => ({
      headerTop: node.previousElementSibling.getBoundingClientRect().top,
      windowScroll: window.scrollY,
      pageScrollRange:
        document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
      adjacent: [
        ...document.querySelectorAll(
          ".workspace-explorer > .workspace-panel-scroll, .workspace-document-tabs > .workspace-panel-scroll",
        ),
      ]
        .filter((panel) => panel.getClientRects().length > 0)
        .map((panel) => [panel.getBoundingClientRect().top, panel.scrollTop]),
    }));

  const draft = "Private interview notes";
  for (const width of [1280, 600]) {
    await setNativeViewport(page, native, { width, height: 720, zoomFactor: 1 });
    await selectProject(projects[2]);
    if (width < 1024) await button(page, "command.panels.chat").press("Enter");
    await expect(composer).toHaveValue("");
    await button(chat, "history.show").press("Enter");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Other project's conversation");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    expect(await withinViewport(rows.first())).toBe(true);

    await selectProject(projects[1]);
    await expect(heading).toHaveText("Interview 51");
    if (width >= 1024) await composer.fill(draft);
    else await expect(composer).toHaveValue(draft);
    await expect.poll(() => scrollTop(timeline)).toBeGreaterThan(0);
    const timelineBottom = await scrollTop(timeline);
    await timeline.hover();
    await page.mouse.wheel(0, -250);
    await expect.poll(() => scrollTop(timeline)).toBeLessThan(timelineBottom);
    // Wait for Chromium's scroll animation before retaining the timeline's reading position.
    await expect.poll(() => scrollTop(timeline)).toBe(timelineBottom - 250);
    const readingPosition = await scrollTop(timeline);

    await button(chat, "history.show").press("Enter");
    await expect(button(chat, "history.return")).toBeFocused();
    await expect(rows).toHaveCount(50);
    await expect(rows.locator(".chat-history-title")).toHaveText(
      Array.from({ length: 50 }, (_, index) => `Interview ${51 - index}`),
    );
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await expect(older).toBeEnabled();
    expect(await scrollTop(viewport)).toBe(0);
    expect(await withinViewport(older)).toBe(false);
    const initialLayout = await stationaryLayout();
    expect(initialLayout.pageScrollRange).toBe(0);
    expect(initialLayout.adjacent).toHaveLength(width < 1024 ? 0 : 2);

    // Reach the action by wheel input before moving focus to any offscreen control.
    await viewport.hover();
    await page.mouse.wheel(0, await viewport.evaluate((node) => node.scrollHeight));
    await expect.poll(() => scrollTop(viewport)).toBeGreaterThan(0);
    await expect.poll(() => withinViewport(older)).toBe(true);
    expect(await withinViewport(rows.last())).toBe(true);

    await viewport.focus();
    await expect(viewport).toBeFocused();
    await page.keyboard.press("Home");
    await expect.poll(() => scrollTop(viewport)).toBe(0);
    await page.keyboard.press("PageDown");
    await expect.poll(() => scrollTop(viewport)).toBeGreaterThan(0);
    expect(await stationaryLayout()).toEqual(initialLayout);
    await expect(rows).toHaveCount(50);

    await page.keyboard.press("Tab");
    await expect(rows.first()).toBeFocused();
    for (let index = 0; index < 50; ++index) await page.keyboard.press("Tab");
    await expect(older).toBeFocused();
    expect(await withinViewport(older)).toBe(true);

    await interceptOlderPage(failure("storage_failed"));
    await page.keyboard.press("Enter");
    await expect(chat.getByRole("alert")).toHaveText(message("en-US", "history.olderFailed"));
    await expect(rows).toHaveCount(50);
    await expect(older).toBeFocused();
    expect(await withinViewport(older)).toBe(true);

    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(51);
    await expect(rows.last().locator(".chat-history-title")).toHaveText("Interview 1");
    await expect(rows.nth(49)).toBeFocused();
    expect(await withinViewport(rows.nth(49))).toBe(true);
    await page.keyboard.press("Tab");
    await expect(rows.last()).toBeFocused();
    expect(await withinViewport(rows.last())).toBe(true);
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await expect(older).toHaveCount(0);

    if (width >= 1024) {
      await button(page, "workspace.chat.hide").press("Enter");
      await expect(chat).toBeHidden();
      await expect(button(page, "workspace.chat.open")).toBeFocused();
      await button(page, "workspace.chat.open").press("Enter");
    } else {
      await button(page, "workspace.contents").press("Enter");
      await expect(chat).toBeHidden();
      await button(page, "command.panels.chat").press("Enter");
    }
    await expect(heading).toHaveText(message("en-US", "history.title"));
    await expect(rows).toHaveCount(51);
    await button(chat, "history.return").press("Enter");
    await expect(button(chat, "history.show")).toBeFocused();
    await expect(composer).toHaveValue(draft);
    expect(await scrollTop(timeline)).toBe(readingPosition);

    await button(chat, "history.show").press("Enter");
    await rows.last().press("Enter");
    await expect(heading).toHaveText("Interview 1");
    await expect(button(chat, "history.show")).toBeFocused();
    await expect(composer).toHaveValue("");
    await button(chat, "history.show").press("Enter");
    await expect(rows.last()).toHaveAttribute("aria-current", "true");
    await rows.first().press("Enter");
    await expect(heading).toHaveText("Interview 51");
    await expect(composer).toHaveValue(draft);
    await expect.poll(() => scrollTop(timeline)).toBe(readingPosition);
  }

  await setNativeViewport(page, native, { width: 1280, height: 720, zoomFactor: 1 });
  const views = [];
  for (const [locale, theme, width] of [
    ["en-US", "light", 1280],
    ["ko-KR", "dark", 320],
  ]) {
    expect((await change("replaceLocale", "readLocale", locale)).ok).toBe(true);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", locale);
    await openWorkspaceSettings(page);
    const settings = page.locator(".settings-dialog[open]");
    await settings.locator(`input[type="radio"][value="${theme}"]`).check();
    await expect
      .poll(() => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches))
      .toBe(theme === "dark");
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
    await setNativeViewport(page, native, { width, height: 720, zoomFactor: 1 });
    if (width < 1024) await button(page, "workspace.contents", locale).press("Enter");
    const visible = page.locator(".project-explorer");
    await expect(visible.locator(".project-explorer-title bdi")).toHaveText(projects[1].title);
    expect(
      await visible.evaluate(
        (element) => element.parentElement.scrollWidth <= element.parentElement.clientWidth,
      ),
    ).toBe(true);
    const accessibility = await visible.ariaSnapshot();
    expect(accessibility).toContain(projects[1].title);
    expect(accessibility).toContain(message(locale, "history.title"));
    fs.writeFileSync(path.join(attempt, `explorer-${locale}.yml`), accessibility);
    await page.screenshot({ path: path.join(attempt, `explorer-${locale}.png`) });
    views.push({ locale, theme, width });
  }
  await native.dispose();
  fs.writeFileSync(
    path.join(attempt, "receipt.json"),
    JSON.stringify(
      {
        artifact: createHash("sha256")
          .update(fs.readFileSync(path.join(prepared, "prepared.json")))
          .digest("hex"),
        platform: process.platform,
        architecture: process.arch,
        views,
        passed: [
          "V04",
          "V06 loading, populated, empty, unsupported, and injected page failure and retry with provider disconnected",
          "V08 late older page during A→B→A",
          "V13 history and memory independence",
          "V13 right history wheel and keyboard scrolling, explicit pagination and retry, focus and draft/reading position in wide and narrow layouts",
        ],
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await app?.close();
}
