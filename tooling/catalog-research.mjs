/* global document, window, getComputedStyle */
import { expect } from "@playwright/test";
import path from "node:path";
import { watchCatalogPage } from "./catalog-character.mjs";

const trustStates = ["proposed", "confirmed", "pending", "rejected", "review-required"];
const components = {
  VoiceLabel: ".voice-label",
  EvidenceHighlight: ".evidence-highlight",
  TutorComment: ".research-tutor",
  ProposalCard: "article.research-card",
  ContrastResult: ".research-outcome",
  CritiqueLevel: ".research-critique",
  ObservationCard: "article.research-card:has(.research-critique)",
  ReviewRequired: ".research-review",
  CoverageStatement: ".research-coverage",
  SourceRow: ".research-source",
  ProcessingStatus: ".research-processing",
  RestrictionBadge: ".research-restriction",
  WeeklyActions: ".research-weekly",
  StageStatus: ".research-stages",
  PaceIndicator: ".research-pace",
  SaveStatus: ".research-save",
  VersionConflict: ".research-conflict",
};

async function expectFits(page, label) {
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(
    dimensions.scroll,
    `${label}: content fits the scrollbar-adjusted viewport`,
  ).toBeLessThanOrEqual(dimensions.client);
}
const border = (locator, side = "top") =>
  locator.evaluate((element, edge) => {
    const style = getComputedStyle(element);
    return {
      style: style.getPropertyValue(`border-${edge}-style`),
      width: parseFloat(style.getPropertyValue(`border-${edge}-width`)),
      color: style.getPropertyValue(`border-${edge}-color`),
      background: style.backgroundColor,
    };
  }, side);

/** Portable Chromium journey for synthetic research specimens; no product or native claim. */
export async function verifyResearchSpecimen(page, url, engine, output) {
  const watch = watchCatalogPage(page, url, "Research");
  const dialogs = [];
  const dialog = (value) => {
    dialogs.push(value.message());
    void value.dismiss();
  };
  page.on("dialog", dialog);
  try {
    const result = await researchJourney(page, url, engine, output);
    expect(dialogs, "Untrusted text opened no dialog").toEqual([]);
    watch.assert();
    return result;
  } finally {
    page.off("dialog", dialog);
    watch.dispose();
  }
}

async function researchJourney(page, url, engine, output) {
  await page.goto(`${url}?screen=research`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const levels = await page
    .locator("h1, h2, h3, h4, h5, h6")
    .evaluateAll((items) => items.map((item) => Number(item.tagName.slice(1))));
  for (const [index, level] of levels.entries())
    expect(level - (levels[index - 1] ?? 0), "Heading levels do not skip").toBeLessThanOrEqual(1);
  for (const [name, selector] of Object.entries(components))
    expect(await page.locator(selector).count(), name).toBeGreaterThan(0);
  for (const state of trustStates)
    await expect(
      page.locator(`article.research-card[data-state="${state}"]`).first(),
    ).toBeVisible();
  const outcomes = await page
    .locator(".research-outcome")
    .evaluateAll((items) => [...new Set(items.map((item) => item.dataset.outcome))].sort());
  expect(outcomes).toEqual([
    "ambiguous",
    "contradicted",
    "not-found",
    "not-verified",
    "partly-supported",
    "supported",
  ]);
  expect(
    await page
      .locator(".research-processing")
      .evaluateAll((items) => [...new Set(items.map((item) => item.dataset.state))].sort()),
  ).toEqual(["complete", "partial", "processing", "received", "unprocessable"]);
  expect(
    await page
      .locator(".research-save")
      .evaluateAll((items) => [...new Set(items.map((item) => item.dataset.state))].sort()),
  ).toEqual(["conflict", "failed", "saved", "saving", "unsaved"]);

  // Shapes and labels, not color alone, distinguish trust and evidence states.
  const card = (state) => page.locator(`article.research-card[data-state="${state}"]`).first();
  expect(await border(card("proposed"))).toMatchObject({ style: "dashed", width: 2 });
  expect(await border(card("confirmed"))).toMatchObject({ style: "solid", width: 2 });
  expect(await border(card("pending"))).toMatchObject({ style: "dashed", width: 1 });
  for (const state of trustStates)
    expect((await card(state).locator(".research-trust").innerText()).trim()).not.toBe("");
  const proposedEvidence = page.locator('.evidence-highlight[data-state="proposed"]').first();
  const confirmedEvidence = page.locator('.evidence-highlight[data-state="confirmed"]').first();
  expect(await border(proposedEvidence, "bottom")).toMatchObject({ style: "dashed", width: 2 });
  expect(await border(confirmedEvidence, "bottom")).toMatchObject({ style: "solid", width: 2 });
  await expect(confirmedEvidence).toHaveAttribute("aria-label", /researcher-confirmed/);
  await expect(proposedEvidence).toHaveAttribute("aria-label", /not reviewed/);
  expect((await border(page.locator(".research-tutor"), "left")).style).toBe("solid");
  await expect(page.locator(".research-tutor figcaption .voice-label")).toHaveAttribute(
    "data-origin",
    "human",
  );
  await expect(page.locator(".research-interpretation .voice-label")).toHaveAttribute(
    "data-origin",
    "ai",
  );
  await expect(page.locator('[data-layer="researcher"] .voice-label')).toHaveCount(0);
  for (const [level, marks] of [
    ["verifiable-error", 3],
    ["defensible-weakness", 2],
    ["reviewer-question", 1],
  ])
    await expect(
      page.locator(`.research-critique[data-level="${level}"]`).first().locator("rect"),
    ).toHaveCount(marks);
  await expect(page.locator('.research-pace[data-plan="none"] svg')).toHaveCount(0);
  const unknownProposal = await border(
    page.locator('article.research-card[data-state="proposed"][data-origin="unknown"]'),
  );
  expect(unknownProposal).toMatchObject({ style: "dashed", width: 2 });
  expect(unknownProposal.color, "Unknown producers do not take the Ohtia voice").not.toBe(
    (await border(card("proposed"))).color,
  );
  await expect(page.locator(".research-weekly [lang='ko-KR'][dir='auto']")).toHaveCount(1);
  await expect(page.locator(".research-review-notice button")).toHaveCount(0);
  await expect(page.locator('[data-specimen="usage"]')).not.toContainText("0");
  await expect(page.locator('[data-specimen="usage"] [data-metric="unknown"]')).toHaveCount(2);
  await expect(page.locator('[data-metric="not-applicable"]').first()).toContainText("—");

  // Approval-like or markup prose is text: it changes neither state nor the offered actions.
  const approval = page.locator('[data-specimen="approval-prose"]');
  await expect(approval.locator("article")).toHaveAttribute("data-state", "proposed");
  await expect(approval.locator(".research-trust")).toHaveText(/Proposed, not reviewed/);
  for (const name of [
    "Confirm quotation",
    "Correct quotation",
    "Reject quotation",
    "Leave quotation pending",
  ])
    await expect(approval.getByRole("button", { name, exact: true })).toBeVisible();
  const apply = approval.getByRole("button", {
    name: "Apply quotation to manuscript",
    exact: true,
  });
  await expect(apply).toHaveAttribute("aria-disabled", "true");
  await apply.click({ force: true });
  const log = page.locator("[data-callback-log]");
  await expect(log).toContainText("Last synthetic callback: None.");
  const confirm = approval.getByRole("button", { name: "Confirm quotation", exact: true });
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(log).toContainText("Last synthetic callback: Confirm quotation.");
  await expect(confirm).toBeFocused();
  await expect(approval.locator("article")).toHaveAttribute("data-state", "proposed");
  await expect(page.locator("main img, main script, main iframe")).toHaveCount(0);
  await expect(page.locator("main")).toContainText('<img src="x" onerror="alert(1)">');

  // Content keeps its recorded language and isolation independently of the interface locale.
  await expect(page.locator('blockquote[lang="de"]')).toHaveCount(1);
  for (const [language, text] of [
    ["ko-KR", "연구 결과는"],
    ["ar", "الدراسة"],
    ["", "Language and producer not recorded"],
  ]) {
    const content = page.locator(`[lang="${language}"][dir="auto"]`).filter({ hasText: text });
    await expect(content).toHaveCount(1);
  }
  await page.getByLabel("Voice label language", { exact: true }).selectOption("ko-KR");
  await expect(page.locator('.voice-label[lang="ko-KR"]').first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(
    page.locator('[lang="ko-KR"][dir="auto"]').filter({ hasText: "연구 결과는" }),
  ).toHaveCount(1);
  await page.getByLabel("Voice label language", { exact: true }).selectOption("en-US");

  // Saving announces new versions and failures once, without moving focus.
  const live = page.locator('[data-specimen="live-save"]');
  const status = live.locator('.research-save > [role="status"]');
  const alert = live.locator('.research-save > [role="alert"]');
  await expect(status).toHaveText("");
  const complete = live.getByRole("button", { name: "Synthetic save completes", exact: true });
  await complete.click();
  await expect(status).toHaveText("Saved");
  await expect(live.locator(".research-save-label")).toContainText("Version 12");
  await status.locator("span").evaluate((element) => {
    element.dataset.observed = "true";
  });
  await live.getByRole("button", { name: "Repeat passive snapshot", exact: true }).click();
  await expect(status.locator('span[data-observed="true"]')).toHaveCount(1);
  const fail = live.getByRole("button", { name: "Synthetic save fails", exact: true });
  await fail.click();
  await expect(alert).toHaveText("Could not save");
  await expect(fail).toBeFocused();
  await live.getByLabel("Providers offline", { exact: true }).check();
  await expect(live.locator(".research-offline")).toContainText("Local saving continues");
  await expect(live.locator(".research-save-label")).toContainText("Could not save");
  await live.getByRole("button", { name: "Try saving again", exact: true }).click();
  await expect(log).toContainText("Try saving again");
  const conflicted = live.getByRole("button", { name: "Synthetic conflict", exact: true });
  await conflicted.click();
  await expect(status).toHaveText("Version conflict");
  await expect(alert).toHaveText("");
  await expect(conflicted).toBeFocused();
  const conflict = page.locator(".research-conflict");
  await expect(conflict.locator('[role="group"]')).toContainText("still exactly as I typed it");
  await conflict.getByRole("button", { name: "Compare versions", exact: true }).click();
  await expect(log).toContainText("Compare versions");
  await expect(conflict.getByRole("button")).toHaveCount(2);

  if (engine === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const tree = await cdp.send("Accessibility.getFullAXTree");
    for (const role of [
      "article",
      "group",
      "status",
      "alert",
      "list",
      "figure",
      "blockquote",
      "mark",
    ])
      expect(
        tree.nodes.some((node) => !node.ignored && node.role?.value === role),
        role,
      ).toBe(true);
    await cdp.detach();
  }

  // Keyboard reaches research actions in DOM order with the specified focus indicator.
  await page.locator("h1").click();
  const names = [];
  for (let index = 0; index < 80; index++) {
    await page.keyboard.press("Tab");
    names.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""));
  }
  for (const name of [
    "Confirm interpretation",
    "Review quotation again",
    "Review observation again",
  ])
    expect(names, name).toContain(name);
  const reviewAgain = page.getByRole("button", { name: "Review quotation again", exact: true });
  await reviewAgain.focus();
  expect(
    await reviewAgain.evaluate((element) => ({
      notice: !!element.closest(".research-review-notice"),
      outline: getComputedStyle(element).outlineWidth,
    })),
    "Focus ring is drawn outside the attention surface",
  ).toEqual({ notice: false, outline: "3px" });
  await page.getByRole("button", { name: "Confirm interpretation", exact: true }).focus();
  expect(
    await page
      .getByRole("button", { name: "Confirm interpretation", exact: true })
      .evaluate((element) => getComputedStyle(element).outlineWidth),
  ).toBe("3px");

  for (const width of [320, 600, 1024, 1280]) {
    const backgrounds = new Set();
    await page.setViewportSize({ width, height: 700 });
    for (const theme of ["light", "dark"]) {
      await page.getByLabel("Theme", { exact: true }).selectOption(theme);
      backgrounds.add(
        await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
      );
      await expectFits(page, `${String(width)}/${theme}`);
    }
    expect(backgrounds.size).toBe(2);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ["light", "dark"]) {
    await page.getByLabel("Theme", { exact: true }).selectOption(theme);
    await page.screenshot({
      path: path.join(output, `${engine}-research-${theme}.png`),
      fullPage: true,
    });
    await page.locator("main").evaluate((element) => {
      element.style.filter = "grayscale(1)";
    });
    await page.screenshot({
      path: path.join(output, `${engine}-research-${theme}-grayscale.png`),
      fullPage: true,
    });
    await page.locator("main").evaluate((element) => {
      element.style.filter = "";
    });
  }
  await page.getByLabel("Expand labels by at least 40%", { exact: true }).check();
  const expanded = await page.getByRole("button", { name: /^Compare versions/ }).textContent();
  expect(Array.from(expanded).length).toBeGreaterThanOrEqual(
    Math.ceil(Array.from("Compare versions").length * 1.4),
  );
  await page.locator("main").evaluate((element) => {
    for (const child of element.querySelectorAll("*")) {
      child.style.letterSpacing = ".12em";
      child.style.wordSpacing = ".16em";
      child.style.lineHeight = "1.5";
    }
    for (const paragraph of element.querySelectorAll("p")) paragraph.style.marginBlock = "2em";
  });
  for (const width of [320, 600]) {
    await page.setViewportSize({ width, height: 400 });
    await expectFits(page, `${String(width)}/expanded`);
  }
  await page.screenshot({
    path: path.join(output, `${engine}-research-320-expanded.png`),
    fullPage: true,
  });

  if (engine === "chromium") {
    await page.emulateMedia({ forcedColors: "active" });
    const proposed = await border(card("proposed"));
    expect(proposed.style).toBe("dashed");
    expect(proposed.width).toBeGreaterThan(0);
    expect((await border(proposedEvidence, "bottom")).style).toBe("dashed");
    expect((await border(confirmedEvidence, "bottom")).style).toBe("solid");
    const system = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "Canvas";
      document.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    });
    expect(
      await confirmedEvidence
        .locator("mark")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe(system);
    await expect(page.locator(".research-trust").first()).toBeVisible();
    await page.emulateMedia({ forcedColors: "none" });
    const coarse = await page
      .context()
      .browser()
      .newContext({
        hasTouch: true,
        viewport: { width: 320, height: 600 },
      });
    try {
      const touch = await coarse.newPage();
      const touchWatch = watchCatalogPage(touch, url, "Research coarse");
      try {
        await touch.goto(`${url}?screen=research`);
        await touch.evaluate(() => document.fonts.ready);
        expect(await touch.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(
          true,
        );
        const targets = await touch.locator("main button, main select").evaluateAll((elements) =>
          elements.map((element) => ({
            name: element.textContent,
            height: element.getBoundingClientRect().height,
            width: element.getBoundingClientRect().width,
          })),
        );
        for (const target of targets) {
          expect(target.height, target.name).toBeGreaterThanOrEqual(44);
          expect(target.width, target.name).toBeGreaterThanOrEqual(44);
        }
        await expectFits(touch, "coarse/320");
        touchWatch.assert();
      } finally {
        touchWatch.dispose();
      }
    } finally {
      await coarse.close();
    }
  }
  return {
    components: Object.keys(components),
    trustStates,
    approvalProseInert: true,
    untrustedMarkupInert: true,
    mixedLanguage: ["de", "ko-KR", "ar", "unknown"],
    widths: [320, 600, 1024, 1280],
    themes: ["light", "dark"],
    expansion: true,
    textSpacing: true,
    forcedColors: engine === "chromium",
    coarseTargets: engine === "chromium",
    limitations: [
      "Synthetic portable catalog only; packaged native zoom, assistive-technology journeys, linguistic review and WCAG conformance are separate evidence.",
    ],
  };
}
