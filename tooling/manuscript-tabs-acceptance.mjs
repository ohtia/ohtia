// Exercise the central manuscript view and editor against an isolated real SQLite store.
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { _electron, expect } from "@playwright/test";
import {
  developmentLaunch,
  prepareDevelopmentRoot,
  shortTemporaryDirectory,
} from "./desktop-launch.mjs";
import { setNativeViewport } from "./design-viewport.mjs";
import {
  desktopChannels,
  failure,
  manuscriptFormat,
  message,
  portLimits,
} from "../packages/contracts/dist/index.js";
import { serializeManuscript } from "../packages/domain/dist/index.js";

const [prepared, mode] = process.argv.slice(2);
const demo = mode === "demo";
if (!prepared || !path.isAbsolute(prepared))
  throw new Error("Use an absolute runtime directory produced by desktop:prepare.");

const attempt = shortTemporaryDirectory("ohtia-manuscript-tabs-");
const root = prepareDevelopmentRoot(attempt);
const launch = developmentLaunch(root, prepared, attempt);
const thesis = { id: "019a8000-0000-7000-8000-000000000001", title: "Tesis de ejemplo" };
const other = { id: "019a8000-0000-7000-8000-000000000002", title: "Separate research" };
const date = "2026-11-18T10:00:00.000Z";
const title = "Tesis";
const extraTitle = "Legacy manuscript";
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

function seedProjects() {
  const require = createRequire(new URL("../packages/utility/package.json", import.meta.url));
  const Database = require("better-sqlite3");
  const db = new Database(path.join(root, "research", "ohtia.db3"), { fileMustExist: true });
  try {
    db.pragma("foreign_keys = ON");
    const idBytes = (id) => Buffer.from(id.replaceAll("-", ""), "hex");
    const insert = db.prepare(
      "INSERT INTO projects (id,project_type,title,document_language,is_development,setup_confirmed_at,created_at,updated_at,last_opened_at) VALUES (?,'thesis',?,?,0,?,?,?,?)",
    );
    db.transaction(() => {
      insert.run(
        idBytes(thesis.id),
        thesis.title,
        demo ? "es-ES" : "ko-KR",
        date,
        date,
        date,
        date,
      );
      insert.run(
        idBytes(other.id),
        other.title,
        "en-US",
        date,
        date,
        date,
        "2026-11-19T10:00:00.000Z",
      );
      db.prepare(
        "INSERT INTO conversations (id,project_id,title,agent_id,created_at,updated_at,revision) VALUES (?,?,?,'virgilio',?,?,1)",
      ).run(
        idBytes("019a8000-0000-7000-8000-000000000003"),
        idBytes(thesis.id),
        "Research conversation",
        date,
        date,
      );
    })();
  } finally {
    db.close();
  }
}

console.log(`Manuscript tab evidence: ${attempt}`);
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
  seedProjects();
  page = await start();
  const native = await app.browserWindow(page);
  await setNativeViewport(page, native, { width: demo ? 1440 : 1280, height: 720, zoomFactor: 1 });

  // Observe broker replies in main without changing the packaged code or the preload bridge.
  await native.evaluate(
    (window, { channel, rejection }) => {
      const frame = window.webContents.mainFrame;
      const send = frame.send;
      globalThis.manuscriptProbe = { subscription: null, rejectRead: false };
      frame.send = function (name, ...values) {
        if (name === channel && typeof values[0] === "string") {
          const response = JSON.parse(values[0]);
          if (response.kind === "result" && response.payload.ok) {
            if (response.operation === "research.subscribe")
              globalThis.manuscriptProbe.subscription = response.payload.value.subscriptionId;
            if (response.operation === "manuscript.read" && globalThis.manuscriptProbe.rejectRead) {
              globalThis.manuscriptProbe.rejectRead = false;
              values[0] = JSON.stringify({
                ...response,
                payload: rejection,
              });
            }
          }
        }
        send.call(frame, name, ...values);
      };
    },
    { channel: desktopChannels.reply, rejection: failure("storage_failed") },
  );

  const replace = async (method, read, value) => {
    const result = await page.evaluate(
      async ({ method, read, value, operationId }) => {
        const port = window.ohtia.foundation;
        const prior = await port[read]().result;
        if (!prior.ok) return prior;
        return port[method]({
          operationId,
          expectedRevision: (prior.value.record ?? prior.value).revision,
          value,
        }).result;
      },
      { method, read, value, operationId: randomUUID() },
    );
    expect(result.ok).toBe(true);
  };
  await replace("replaceLocale", "readLocale", "en-US");
  await replace("replaceAppearance", "readAppearance", "light");
  const picker = page.getByRole("combobox", { name: "Current project" });
  const explorer = page.locator(".project-explorer");
  const row = (title) => explorer.getByRole("button", { name: title, exact: true });
  const view = () => page.locator("article.workspace-manuscript:visible");
  const center = page.locator(".workspace-manuscript-surface");
  async function selectProject(project) {
    await picker.press("Enter");
    await page.getByRole("option", { name: project.title }).click();
    await expect(explorer.locator(".project-explorer-title")).toHaveText(project.title);
  }
  await expect(explorer.locator(".project-explorer-title")).toHaveText(other.title);
  await selectProject(thesis);
  await expect(explorer.getByText("No manuscripts yet.", { exact: true })).toBeVisible();

  async function call(method, projectId, input) {
    const subscriptionId = await app.evaluate(() => globalThis.manuscriptProbe.subscription);
    expect(subscriptionId).toEqual(expect.any(String));
    return page.evaluate(
      ({ method, input, operationId }) => {
        const port = window.ohtia.foundation;
        return (
          method === "readManuscript" ? port[method](input) : port[method](operationId, input)
        ).result;
      },
      { method, input: { projectId, subscriptionId, ...input }, operationId: randomUUID() },
    );
  }
  async function create(title) {
    const result = await call("createManuscript", thesis.id, { title });
    expect(result, "Create synthetic manuscript").toMatchObject({ ok: true });
    return result.value.manuscriptChange.revision;
  }
  async function save(prior) {
    const draftId = prior.draftId;
    const text = serializeManuscript(
      {
        format: manuscriptFormat,
        draftId,
        title: { id: "sec_title", text: "Espacios verdes y bienestar urbano" },
        sections: [
          { id: "sec_intro", text: "Introducción", level: 2, beforeParagraph: 0 },
          { id: "sec_method", text: "Metodología", level: 2, beforeParagraph: 7 },
          { id: "sec_sample", text: "Diseño de la muestra", level: 3, beforeParagraph: 8 },
        ],
        paragraphs: Array.from({ length: 15 }, (_, index) => ({
          id: `blk_p${index}`,
          lines: [
            {
              text:
                index === 0
                  ? "Esta tesis estudia la relación entre el acceso a espacios verdes y el bienestar de los residentes."
                  : "La observación de campo recoge las distintas formas en que los residentes usan los parques de barrio.",
              breakAfter: null,
            },
          ],
        })),
      },
      { draftId },
    );
    expect(text.ok).toBe(true);
    const result = await call("saveManuscript", thesis.id, {
      draftId,
      expectedRevisionId: prior.revisionId,
      saveReason: "manual",
      markdown: text.value,
    });
    expect(result, "Save synthetic manuscript").toMatchObject({ ok: true });
    expect(result.value.manuscriptChange.kind).toBe("committed");
    return result.value.manuscriptChange.revision;
  }

  const first = await create(title);
  const saved = await save(first);
  if (!demo) {
    const extra = await create(extraTitle);
    expect(extra.draftId).not.toBe(first.draftId);
  }
  await row("Manuscript").click();
  await expect(center).toBeVisible();
  const manuscriptTab = page.getByRole("tab", { name: "Manuscript", exact: true });
  const navigatorTab = page.getByRole("tab", { name: "Navigator", exact: true });
  await expect(manuscriptTab).toHaveAttribute("aria-selected", "true");
  await expect(navigatorTab).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tabpanel", { name: "Manuscript", exact: true })).toHaveClass(
    "workspace-manuscript-surface",
  );
  const toolbar = center.locator(".workspace-manuscript-toolbar");
  const footer = center.locator(".workspace-manuscript-footer");
  const saveStatus = footer.getByRole("status");
  const scroll = center.locator(".workspace-panel-scroll");
  const expand = page.getByRole("button", { name: "Expand document", exact: true });
  const restore = page.getByRole("button", { name: "Return to previous layout", exact: true });
  const expectFullWidth = async (surface, { wide = false } = {}) => {
    const sizes = await surface.evaluate((element) => {
      const viewport = element.closest(".workspace-panel-scroll");
      const paragraph = element.querySelector("p");
      const style = getComputedStyle(element);
      const width = element.getBoundingClientRect().width;
      const inset = parseFloat(style.paddingInlineStart) + parseFloat(style.paddingInlineEnd);
      const measure = parseFloat(style.getPropertyValue("--measure-reading"));
      const bodySize = parseFloat(style.fontSize);
      const standardInset =
        parseFloat(style.getPropertyValue("--component-workspace-document-padding")) +
        parseFloat(style.getPropertyValue("--component-workspace-content-padding"));
      return {
        viewportWidth: viewport.clientWidth,
        width,
        start: parseFloat(style.paddingInlineStart),
        end: parseFloat(style.paddingInlineEnd),
        standardInset,
        textWidth: paragraph.getBoundingClientRect().width,
        readingWidth: measure * bodySize,
        contentWidth: width - inset,
      };
    });
    expect(sizes.width).toBeCloseTo(sizes.viewportWidth, 0);
    expect(sizes.start).toBe(sizes.standardInset);
    expect(sizes.end).toBe(sizes.standardInset);
    expect(sizes.textWidth).toBeCloseTo(sizes.contentWidth, 0);
    if (wide) expect(sizes.textWidth).toBeGreaterThan(sizes.readingWidth);
  };
  await expect(footer.getByText("Preview", { exact: true })).toBeVisible();
  await expect(saveStatus).toHaveText("Saved");
  const bounds = async (locator) => {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    return box;
  };
  const tabsBox = await bounds(manuscriptTab.locator("xpath=ancestor::*[@role='tablist']"));
  const toolbarBox = await bounds(toolbar);
  const scrollBox = await bounds(scroll);
  const footerBox = await bounds(footer);
  expect(tabsBox.y + tabsBox.height).toBeLessThanOrEqual(toolbarBox.y);
  expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(scrollBox.y);
  expect(scrollBox.y + scrollBox.height).toBeLessThanOrEqual(footerBox.y);

  await expect(
    view().getByRole("heading", { name: "Espacios verdes y bienestar urbano" }),
  ).toBeVisible();
  await expect(view()).toHaveAttribute("lang", demo ? "es-ES" : "ko-KR");
  await expectFullWidth(view());
  if (!demo) {
    await expand.click();
    await expectFullWidth(view(), { wide: true });
    await restore.click();
  }
  await expect(page.getByRole("tab", { name: title, exact: true })).toHaveCount(0);
  await expect(row(extraTitle)).toHaveCount(0);
  await expect(view().getByRole("heading", { level: 2 })).toHaveCount(2);
  const methods = row("Metodología").locator("xpath=ancestor::li[1]");
  await expect(methods.getByRole("button", { name: "Diseño de la muestra" })).toBeVisible();
  const foldMethods = row("Toggle the outline for Metodología");
  await expect(foldMethods).toHaveAttribute("aria-expanded", "true");
  await foldMethods.press("Space");
  await expect(foldMethods).toHaveAttribute("aria-expanded", "false");
  await expect(row("Diseño de la muestra")).toHaveCount(0);
  await expect(view().getByRole("heading", { name: "Diseño de la muestra" })).toBeVisible();
  const foldManuscript = row("Toggle the outline for Manuscript");
  await foldManuscript.click();
  await expect(row("Metodología")).toHaveCount(0);
  await foldManuscript.click();
  await expect(foldMethods).toHaveAttribute("aria-expanded", "false");
  await foldMethods.press("Enter");
  await expect(row("Diseño de la muestra")).toBeVisible();
  await row("Fold all").click();
  await expect(foldMethods).toHaveAttribute("aria-expanded", "false");
  await expect(row("Diseño de la muestra")).toHaveCount(0);
  await expect(foldManuscript).toHaveAttribute("aria-expanded", "true");
  await expect(view().getByRole("heading", { name: "Diseño de la muestra" })).toBeVisible();
  await foldMethods.press("Enter");
  await expect(row("Diseño de la muestra")).toBeVisible();
  await row("Metodología").click();
  await expect(view().getByRole("heading", { name: "Metodología" })).toBeFocused();

  if (demo) {
    await replace("replaceLocale", "readLocale", "es-ES");
    await expect(row("Manuscrito")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Manuscrito", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await row("Diseño de la muestra").click();
    const ruta = center.getByRole("navigation", { name: "Ir a un encabezado" });
    await expect(ruta.getByRole("button", { name: "Diseño de la muestra" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(
      await native.evaluate((window) => {
        window.show();
        window.focus();
        return window.isVisible();
      }),
    ).toBe(true);
    console.log("OHTIA_DEMO_READY", app.process().pid);
    await app.waitForEvent("close", { timeout: 0 });
  } else {
    const trail = center.getByRole("navigation", { name: "Go to heading" });
    const methodsCrumb = trail.getByRole("button", { name: "Metodología", exact: true });
    const sampleCrumb = trail.getByRole("button", { name: "Diseño de la muestra", exact: true });
    await expect(methodsCrumb).toHaveAttribute("aria-current", "location");
    await expect(row("Metodología")).toHaveAttribute("aria-current", "location");
    await methodsCrumb.press("ArrowDown");
    const location = trail.getByRole("combobox", { name: "Go to heading" });
    await expect(location).toBeFocused();
    await location.fill("diseno");
    await expect(trail.getByRole("option")).toHaveCount(1);
    await location.press("Enter");
    await expect(sampleCrumb).toHaveAttribute("aria-current", "location");
    await expect(row("Diseño de la muestra")).toHaveAttribute("aria-current", "location");
    await foldMethods.click();
    await expect(row("Metodología")).toHaveAttribute("aria-current", "location");
    await expect(sampleCrumb).toHaveAttribute("aria-current", "location");
    await foldManuscript.click();
    await expect(row("Manuscript")).toHaveAttribute("aria-current", "location");
    await foldManuscript.click();
    await foldMethods.click();
    await expect(row("Diseño de la muestra")).toHaveAttribute("aria-current", "location");
    await sampleCrumb.press("ArrowLeft");
    await expect(methodsCrumb).toBeFocused();
    await sampleCrumb.press("Enter");
    await expect(location).toBeFocused();
    await location.press("ArrowLeft");
    await expect(methodsCrumb).toHaveAttribute("aria-expanded", "true");
    await expect(location).toBeFocused();
    await location.press("Escape");
    await expect(methodsCrumb).toBeFocused();
    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(trail.getByRole("button", { name: "Manuscript", exact: true })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await row("Diseño de la muestra").click();
    await expect(view().getByRole("heading", { name: "Diseño de la muestra" })).toBeFocused();
    expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await toolbar.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(footer.getByText("Edit", { exact: true })).toBeVisible();
    const editor = center.getByRole("textbox", { name: "Manuscript" });
    await expect(editor).toBeFocused();
    await expect(sampleCrumb).toHaveAttribute("aria-current", "location");
    expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(editor.locator("h2")).toHaveCount(2);
    await expand.click();
    await expectFullWidth(center.locator(".workspace-manuscript:visible"), { wide: true });
    await restore.click();
    const chapterSize = await editor
      .locator("h2")
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    const subsectionSize = await editor
      .locator("h3")
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(chapterSize).toBeGreaterThan(subsectionSize);
    await editor.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
    await page.keyboard.insertText("## Resultados");
    await expect(row("Resultados")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(row("Resultados")).toBeVisible();
    await expect(row("Resultados")).toHaveAttribute("aria-current", "location");
    await expect(saveStatus).toHaveText("Unsaved changes");
    await expect(saveStatus).toHaveAttribute("data-pending", "true");
    expect((await bounds(footer)).y).toBe(footerBox.y);
    await expect(editor.locator("h2")).toHaveCount(3);
    await expect(trail.getByRole("button", { name: "Resultados" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await native.evaluate((window) => {
      setTimeout(() => window.close(), 0);
    });
    const close = page.getByRole("dialog", { name: "Unsaved changes" });
    await expect(close).toBeVisible();
    await expect(close.getByRole("button", { name: "Save and close" })).toBeEnabled();
    await expect(close.getByRole("button", { name: "Keep open" })).toBeFocused();
    await close.getByRole("button", { name: "Keep open" }).click();
    await expect(editor.locator("h2")).toHaveCount(3);

    await row("Resultados").click();
    await expect(editor).toBeFocused();
    await toolbar.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(saveStatus).toHaveText("Unsaved changes");
    await expect(view().getByRole("heading", { name: "Resultados" })).toBeVisible();
    await expect(view().getByRole("heading", { name: "Introducción" })).toBeAttached();
    const before = await call("readManuscript", thesis.id, {
      draftId: first.draftId,
      revisionId: null,
    });
    expect(before.value.revision.revisionId).toBe(saved.revisionId);

    await toolbar.getByRole("button", { name: "Save", exact: true }).click();
    await expect(saveStatus).toHaveText("Manuscript saved.");
    await expect(saveStatus).not.toHaveAttribute("data-pending", "true");
    const after = await call("readManuscript", thesis.id, {
      draftId: first.draftId,
      revisionId: null,
    });
    expect(after.value.revision.revisionId).not.toBe(saved.revisionId);
    expect(after.value.markdown).toContain("## Resultados {#sec_");
    await navigatorTab.click();
    await expect(center).toBeHidden();
    await expect(explorer.locator('[aria-current="location"]')).toHaveCount(0);
    await navigatorTab.press("ArrowRight");
    await expect(manuscriptTab).toBeFocused();
    await expect(navigatorTab).toHaveAttribute("aria-selected", "true");
    await manuscriptTab.press("Enter");
    await expect(view().getByRole("heading", { name: "Resultados" })).toBeVisible();

    const conversation = page.locator(".workspace-chat").getByRole("textbox");
    await conversation.fill("Unsent research note");
    await row("Metodología").click();
    await expect(conversation).toHaveValue("Unsent research note");
    await setNativeViewport(page, native, { width: 1280, height: 720, zoomFactor: 4 });
    await expect(center).toBeVisible();
    await expectFullWidth(view());
    await toolbar.getByRole("button", { name: "Edit", exact: true }).scrollIntoViewIfNeeded();
    await expect(toolbar.getByRole("button", { name: "Edit", exact: true })).toBeInViewport();
    const rootCrumb = trail.getByRole("button", { name: "Manuscript", exact: true });
    await rootCrumb.scrollIntoViewIfNeeded();
    await rootCrumb.press("ArrowDown");
    await location.fill("diseno");
    await location.press("Enter");
    await expect(view().getByRole("heading", { name: "Diseño de la muestra" })).toBeInViewport();
    await saveStatus.scrollIntoViewIfNeeded();
    await expect(saveStatus).toBeInViewport();
    expect(await center.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: path.join(attempt, "v09-single-manuscript.png") });
    await selectProject(other);
    await expect(center).toBeHidden();
    await expect(row("Resultados")).toHaveCount(0);
    console.log(
      "V09 passed for the separate toolbar, outline location, mode switch, durable save and 320 CSS px.",
    );
  }
} finally {
  await app?.close().catch(() => {});
}
