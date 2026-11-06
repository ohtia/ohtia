/* global document, MessageChannel, window */
import { expect } from "@playwright/test";
import path from "node:path";
import { URL } from "node:url";

const cspReport = "__ohtiaCatalogCsp";
const captureMark = "__ohtiaCatalogCapture";
/** WebKit's console text for each refused stylesheet or style attribute; used only to count. */
export const webkitStyleRefusal =
  "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";
/**
 * Admits the two portable WebKit refusals that the engine or Playwright causes, not the page:
 * WebKit refuses an inline style for every `<select>`, and each Playwright screenshot injects a
 * stylesheet with no source file. Every other violation fails, including both in other engines.
 */
export function admittedCspViolation(engine, violation) {
  if (engine !== "webkit" || violation.blocked !== "inline" || violation.disposition !== "enforce")
    return false;
  if (violation.directive === "style-src-attr") return violation.target === "SELECT";
  return (
    violation.directive === "style-src-elem" &&
    violation.target === "#document" &&
    violation.source === "" &&
    violation.capture === true
  );
}
/** Keeps every console error except one WebKit refusal message per admitted violation. */
export function unadmittedConsoleErrors(engine, messages, admitted) {
  let skipped = 0;
  return messages.filter((text) => {
    if (engine !== "webkit" || text !== webkitStyleRefusal || skipped >= admitted) return true;
    skipped += 1;
    return false;
  });
}
/** Every owned page, including the coarse-pointer context, has independent admission checks. */
export function watchCharacterPage(page, url, engine) {
  return watchCatalogPage(page, url, "Character", engine);
}
/**
 * Observes page errors, console errors, structured CSP violations and request origins. Install it
 * before the page's first navigation so that the violation reporter runs in every document.
 */
export async function watchCatalogPage(page, url, name, engine) {
  const errors = [],
    consoleErrors = [],
    violations = [],
    requests = [];
  const error = (value) => errors.push(value.message);
  const consoleError = (value) => {
    if (value.type() === "error") consoleErrors.push(value.text());
  };
  const request = (value) => requests.push(value.url());
  page.on("pageerror", error);
  page.on("console", consoleError);
  page.on("request", request);
  const disposables = [];
  try {
    disposables.push(
      await page.exposeBinding(cspReport, (_source, violation) => violations.push(violation)),
    );
    disposables.push(
      await page.addInitScript(
        ({ report, capture }) => {
          document.addEventListener(
            "securitypolicyviolation",
            (event) => {
              // A disposed watcher removes the binding; this document's listener then stays inert.
              if (typeof window[report] !== "function") return;
              void window[report]({
                directive: event.effectiveDirective,
                blocked: event.blockedURI,
                disposition: event.disposition,
                source: event.sourceFile || "",
                target: event.target?.nodeName ?? "",
                capture: (window[capture] ?? 0) > 0,
              });
            },
            true,
          );
        },
        { report: cspReport, capture: captureMark },
      ),
    );
  } catch (failure) {
    page.off("pageerror", error);
    page.off("console", consoleError);
    page.off("request", request);
    // The installation failure is the diagnostic that matters here.
    await release(page, disposables).catch(() => undefined);
    throw failure;
  }
  return {
    async assert() {
      // A page round trip delivers reports sent before it.
      if (!page.isClosed()) await page.evaluate(() => 0);
      expect(errors, `${name} page errors`).toEqual([]);
      const admitted = violations.filter((item) => admittedCspViolation(engine, item));
      expect(
        violations.filter((item) => !admittedCspViolation(engine, item)),
        `${name} CSP violations`,
      ).toEqual([]);
      expect(
        unadmittedConsoleErrors(engine, consoleErrors, admitted.length),
        `${name} console/CSP errors`,
      ).toEqual([]);
      expect(
        requests.every((value) => new URL(value).origin === new URL(url).origin),
        `${name} request origins`,
      ).toBe(true);
    },
    async dispose() {
      page.off("pageerror", error);
      page.off("console", consoleError);
      page.off("request", request);
      await release(page, disposables);
    },
  };
}
/** Releases every disposable; a closed page's release failures do not replace the journey's own. */
async function release(page, disposables) {
  const failure = (
    await Promise.allSettled(disposables.map((disposable) => disposable.dispose()))
  ).find((result) => result.status === "rejected");
  if (failure && !page.isClosed()) throw failure.reason;
}
/** Takes an evidence screenshot while the page marks a capture for the CSP watcher. */
export async function captureCatalog(target, options) {
  const page = typeof target.page === "function" ? target.page() : target;
  await page.evaluate((mark) => {
    window[mark] = (window[mark] ?? 0) + 1;
  }, captureMark);
  try {
    return await target.screenshot(options);
  } finally {
    // Let violation events queued by the capture run before the mark is released. A message
    // task is used because journeys may install Playwright's fake timers.
    if (!page.isClosed())
      await page.evaluate(async (mark) => {
        await new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            channel.port1.close();
            resolve();
          };
          channel.port2.postMessage(null);
        });
        window[mark] = Math.max(0, (window[mark] ?? 1) - 1);
      }, captureMark);
  }
}
/**
 * Compares a selected contributor label with its exact one-line identity. Selection
 * serialization may close the label's blockified flex content with one block-boundary line
 * feed, as WebKit does in the catalog layout and Chromium does after inline placements; that
 * boundary is not identity text. Every name, role, origin and separator must still match.
 */
export function expectSelectedIdentity(selected, expected) {
  const identity = selected.endsWith("\n") ? selected.slice(0, -1) : selected;
  expect(identity, "Selected contributor identity").toBe(expected);
}
async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(
    dimensions.scroll,
    "Character content fits the scrollbar-adjusted viewport",
  ).toBeLessThanOrEqual(dimensions.client);
}
export async function verifyCharacterSpecimen(page, url, engine, output) {
  const watch = await watchCharacterPage(page, url, engine);
  try {
    const result = await characterJourney(page, url, engine, output);
    await watch.assert();
    return result;
  } finally {
    await watch.dispose();
  }
}
async function characterJourney(page, url, engine, output) {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${url}?screen=characters`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(0);
  for (const [name, role] of [
    ["Boris", "Academic editor"],
    ["María", "Proofreader"],
  ]) {
    const label = page.locator(".voice-label[data-origin=ai]").filter({ hasText: name });
    const expected = `${name} · Writing review · ${role} · AI`;
    expect(await label.innerText()).toBe(expected);
    const copied = await label.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const text = selection.toString();
      selection.removeAllRanges();
      return text;
    });
    expectSelectedIdentity(copied, expected);
    expect(await label.ariaSnapshot()).toContain(expected);
  }
  const play = page.getByRole("button", { name: "New synthetic batch", exact: true });
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await play.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-character-state]")).toHaveText("animated: playing");
  await expect(play).toBeFocused();
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(1);
  await page.getByLabel("Presentation", { exact: true }).selectOption("static");
  await expect(page.locator("[data-character-state]")).toHaveText("static: still");
  expect(
    await page
      .locator(".character-decoration")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await page.getByRole("button", { name: "Same batch, new event", exact: true }).click();
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(1);
  await page.getByLabel("Presentation", { exact: true }).selectOption("animated");
  await page.getByRole("button", { name: "Duplicate event", exact: true }).click();
  await expect(page.locator("[data-character-state]")).toHaveText("animated: still");
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(0);
  await page.getByLabel("Synthetic manuscript visible", { exact: true }).check();
  const buffer = page.getByRole("textbox", { name: "Synthetic manuscript buffer", exact: true });
  await buffer.fill("Preserved researcher text 연구");
  await play.click();
  await expect(page.locator("[data-character-state]")).toHaveText("animated: deferred");
  await expect(page.locator(".character-drawing")).toHaveCount(0);
  await page.getByRole("button", { name: "Explicit Navigator opening", exact: true }).click();
  await expect(page.locator("[data-character-state]")).toHaveText("animated: playing");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-character-state]")).toHaveText("static: still");
  expect(
    await page
      .locator(".character-decoration")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("[data-character-state]")).toHaveText("animated: still");
  for (const [pose, duration, fraction] of [
    ["thinking", 1600, 0.5],
    ["disagreement", 1800, 0.5],
    ["milestone", 520, 0.36],
  ]) {
    await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
    await page.getByLabel("Synthetic pose", { exact: true }).selectOption(pose);
    await play.click();
    await expect(page.locator("[data-character-state]")).toHaveText("animated: playing");
    const stage = page.locator(".character-decoration");
    await stage.evaluate((element, time) => {
      for (const animation of element.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = time;
      }
    }, duration * fraction);
    await expect(stage).toHaveAttribute("data-full", "true");
    await expect(stage.locator(".character-drawing")).toHaveCSS("overflow", "visible");
    const bounds = await stage.evaluate((element) => {
      const frame = element.getBoundingClientRect();
      return [
        ...element.querySelectorAll(
          ".character-drawing path,.character-drawing circle,.character-drawing rect,.character-drawing ellipse,.character-drawing line",
        ),
      ].map((piece) => {
        const rect = piece.getBoundingClientRect();
        const style = window.getComputedStyle(piece);
        const matrix = piece.getScreenCTM();
        const radius = style.stroke === "none" ? 0 : Number.parseFloat(style.strokeWidth) / 2;
        const x = radius * Math.hypot(matrix.a, matrix.c);
        const y = radius * Math.hypot(matrix.b, matrix.d);
        return {
          name: piece.getAttribute("class") ?? piece.tagName,
          join: style.strokeLinejoin,
          cap: style.strokeLinecap,
          left: rect.left - x - frame.left,
          top: rect.top - y - frame.top,
          right: frame.right - rect.right - x,
          bottom: frame.bottom - rect.bottom - y,
        };
      });
    });
    for (const piece of bounds) {
      expect(piece.join).toBe("round");
      expect(piece.cap).toBe("round");
      for (const edge of ["left", "top", "right", "bottom"])
        expect(piece[edge], `${pose}/${piece.name}/${edge}`).toBeGreaterThanOrEqual(0);
    }
    const noControlOverlap = await stage.evaluate((element) => {
      const frame = element.getBoundingClientRect();
      return [...document.querySelectorAll("button,select,input,textarea")].every((control) => {
        const rect = control.getBoundingClientRect();
        return (
          rect.width === 0 ||
          rect.height === 0 ||
          rect.bottom <= frame.top ||
          rect.top >= frame.bottom ||
          rect.right <= frame.left ||
          rect.left >= frame.right
        );
      });
    });
    expect(noControlOverlap, `${pose}/neighboring controls`).toBe(true);
    await captureCatalog(stage, {
      path: path.join(output, `${engine}-character-${pose}-main.png`),
    });
    await expect(stage.locator(".character-drawing")).toHaveCount(1);
    await page.clock.runFor(duration);
    await expect(stage.locator(".character-drawing")).toHaveCount(0);
    await expect(play).toBeFocused();
  }
  await page.getByLabel("Synthetic pose", { exact: true }).selectOption("thinking");
  const still = async () => {
    await expect(page.locator("[data-character-state]")).toHaveText("animated: still");
    await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(0);
  };
  const duplicate = page.getByRole("button", { name: "Duplicate event", exact: true });
  const sameBatch = page.getByRole("button", { name: "Same batch, new event", exact: true });
  const dismiss = page.getByRole("button", { name: "Dismiss or resolve", exact: true });
  await play.click();
  await sameBatch.click();
  await expect(page.locator("[data-character-state]")).toHaveText("animated: playing");
  await page.clock.runFor(1600);
  await sameBatch.click();
  await still();
  await play.click();
  await page.getByRole("button", { name: "Replace renderer", exact: true }).click();
  await duplicate.click();
  await sameBatch.click();
  await still();
  await play.click();
  await page.getByRole("button", { name: "Restart static preview", exact: true }).click();
  await expect(page.locator("[data-character-state]")).toHaveText("static: still");
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(0);
  await sameBatch.click();
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(0);
  await play.click();
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(1);
  await sameBatch.click();
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(1);
  expect(
    await page
      .locator(".character-decoration")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await page.clock.runFor(1600);
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(0);
  await page.getByLabel("Presentation", { exact: true }).selectOption("animated");
  await duplicate.click();
  await sameBatch.click();
  await still();
  await play.click();
  await dismiss.click();
  await duplicate.click();
  await still();
  await play.click();
  await page.getByLabel("Presentation", { exact: true }).selectOption("hidden");
  await expect(page.locator("[data-character-state]")).toHaveText("hidden: still");
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(0);
  await page.getByLabel("Presentation", { exact: true }).selectOption("animated");
  await duplicate.click();
  await still();
  await page.getByLabel("Presentation", { exact: true }).selectOption("static");
  await page.getByLabel("Synthetic manuscript visible", { exact: true }).check();
  await expect(buffer).toHaveValue("Preserved researcher text 연구");
  await play.click();
  await page.getByLabel("Synthetic manuscript visible", { exact: true }).uncheck();
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(0);
  await page.getByLabel("Presentation", { exact: true }).selectOption("animated");
  await sameBatch.click();
  await still();
  await play.click();
  await page.getByRole("button", { name: "Passive restoration", exact: true }).click();
  await duplicate.click();
  await still();
  await page.getByLabel("Synthetic manuscript visible", { exact: true }).check();
  await play.click();
  await page.getByRole("button", { name: "Passive restoration", exact: true }).click();
  await expect(page.locator("[data-character-state]")).toHaveText("animated: deferred");
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(0);
  await sameBatch.click();
  await expect(page.locator("[data-character-state]")).toHaveText("animated: deferred");
  await expect(page.locator(".character-decoration .character-drawing")).toHaveCount(0);
  await page.getByRole("button", { name: "Explicit Navigator opening", exact: true }).click();
  await expect(page.locator("[data-character-state]")).toHaveText("animated: playing");
  await dismiss.click();
  await still();
  await page.getByLabel("Presentation", { exact: true }).selectOption("hidden");
  await expect(page.locator(".character-drawing")).toHaveCount(0);
  await expect(page.locator(".voice-label")).toHaveCount(9);
  await expect(page.getByText("Virgilio", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Declared synthetic author", { exact: true })).toBeVisible();
  for (const locale of ["en-US", "de-DE", "fi-FI", "ko-KR"]) {
    await page.getByLabel("Interface language", { exact: true }).selectOption(locale);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    for (const width of [320, 600, 1024, 1280]) {
      await page.setViewportSize({ width, height: 400 });
      await expectNoHorizontalOverflow(page);
      await expect(page.getByText("María", { exact: true })).toHaveCount(2);
    }
  }
  await page.getByLabel("Expand specimen labels by 40%", { exact: true }).check();
  await page.locator("main").evaluate((element) => {
    for (const child of element.querySelectorAll("*")) {
      child.style.letterSpacing = ".12em";
      child.style.wordSpacing = ".16em";
      child.style.lineHeight = "1.5";
    }
    for (const paragraph of element.querySelectorAll("p")) paragraph.style.marginBlock = "2em";
  });
  await page.setViewportSize({ width: 320, height: 400 });
  await expectNoHorizontalOverflow(page);
  if (engine === "chromium") {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await expect(page.locator(".voice-label[data-origin=human]")).toBeVisible();
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
  }
  await page.getByLabel("Presentation", { exact: true }).selectOption("static");
  await page.setViewportSize({ width: 1280, height: 800 });
  await captureCatalog(page, {
    path: path.join(output, `${engine}-characters.png`),
    fullPage: true,
  });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.appearance = value;
      document.querySelector("main").style.filter = "grayscale(1)";
    }, theme);
    await expect(page.locator(".voice-label")).toHaveCount(9);
    await captureCatalog(page, {
      path: path.join(output, `${engine}-characters-${theme}-grayscale.png`),
      fullPage: true,
    });
  }
  if (engine === "chromium") {
    const coarse = await page
      .context()
      .browser()
      .newContext({
        hasTouch: true,
        viewport: { width: 320, height: 400 },
      });
    try {
      const touch = await coarse.newPage();
      const touchWatch = await watchCharacterPage(touch, url, engine);
      try {
        await touch.goto(`${url}?screen=characters`);
        await touch.evaluate(() => document.fonts.ready);
        const targets = await touch
          .locator("button, select, .primitive-field label")
          .evaluateAll((elements) =>
            elements.map((element) => ({
              name: element.textContent,
              width: element.getBoundingClientRect().width,
              height: element.getBoundingClientRect().height,
            })),
          );
        for (const target of targets) {
          expect(target.width, target.name).toBeGreaterThanOrEqual(44);
          expect(target.height, target.name).toBeGreaterThanOrEqual(44);
        }
        await touchWatch.assert();
      } finally {
        await touchWatch.dispose();
      }
    } finally {
      await coarse.close();
    }
  }
  await page.clock.resume();
  return {
    syntheticEvents: true,
    noReplay: true,
    attribution: true,
    widths: [320, 600, 1024, 1280],
    limits: [
      "Portable browser checks; packaged assistive and native zoom evidence remain separate.",
    ],
  };
}
