import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  admittedCspViolation,
  captureCatalog,
  expectSelectedIdentity,
  watchCatalogPage,
  unadmittedConsoleErrors,
  watchCharacterPage,
  webkitStyleRefusal,
} from "../tooling/catalog-character.mjs";

type Report = (source: unknown, violation: Violation) => void;
interface Violation {
  directive: string;
  blocked: string;
  disposition: string;
  source: string;
  target: string;
  capture: boolean;
}
type InitScript = (argument: unknown) => void;
class FakePage extends EventEmitter {
  report: Report | undefined;
  binding = "";
  initScript: InitScript | undefined;
  initArgument: unknown;
  disposed = 0;
  disposeFailure: Error | undefined;
  evaluations = 0;
  closed = false;
  exposeBinding(name: string, report: Report) {
    this.binding = name;
    this.report = report;
    return Promise.resolve({ dispose: () => this.release() });
  }
  addInitScript(script: InitScript, argument: unknown) {
    this.initScript = script;
    this.initArgument = argument;
    return Promise.resolve({ dispose: () => this.release() });
  }
  release() {
    this.disposed += 1;
    return this.disposeFailure ? Promise.reject(this.disposeFailure) : Promise.resolve();
  }
  evaluate(callback: (argument: unknown) => unknown, argument?: unknown) {
    this.evaluations += 1;
    return Promise.resolve(callback(argument));
  }
  isClosed() {
    return this.closed;
  }
  violate(violation: Violation, consoleMessage = true) {
    this.report?.(null, violation);
    if (consoleMessage)
      this.emit("console", { type: () => "error", text: () => webkitStyleRefusal });
  }
}
const url = "http://127.0.0.1:6000/";
const select: Violation = {
  directive: "style-src-attr",
  blocked: "inline",
  disposition: "enforce",
  source: "http://127.0.0.1:6000/assets/index.js",
  target: "SELECT",
  capture: false,
};
const injected: Violation = {
  directive: "style-src-elem",
  blocked: "inline",
  disposition: "enforce",
  source: "",
  target: "#document",
  capture: true,
};

describe("character catalog page admission", () => {
  it("observes local requests and removes every listener when the page is released", async () => {
    const page = new FakePage();
    const watch = await watchCharacterPage(page, url, "chromium");
    page.emit("request", { url: () => "http://127.0.0.1:6000/assets/local.js" });
    page.emit("console", { type: () => "info", text: () => "Synthetic info" });
    await expect(watch.assert()).resolves.toBeUndefined();
    expect(page.evaluations).toBe(1);
    await watch.dispose();
    for (const type of ["pageerror", "console", "request"])
      expect(page.listenerCount(type)).toBe(0);
    expect(page.disposed).toBe(2);
  });
  it("fails on a runtime error from any observed character page", async () => {
    const page = new FakePage();
    const watch = await watchCharacterPage(page, url, "webkit");
    page.emit("pageerror", new Error("Synthetic runtime failure"));
    await expect(watch.assert()).rejects.toThrow(/Character page errors/);
    await watch.dispose();
  });
  it("fails on console and CSP errors from a coarse or ordinary character page", async () => {
    const page = new FakePage();
    const watch = await watchCharacterPage(page, url, "webkit");
    page.emit("console", { type: () => "error", text: () => "Synthetic CSP refusal" });
    await expect(watch.assert()).rejects.toThrow(/Character console\/CSP errors/);
    await watch.dispose();
  });
  it("fails on a request outside the admitted origin even when its hostname shares a prefix", async () => {
    const page = new FakePage();
    const watch = await watchCharacterPage(page, url, "chromium");
    page.emit("request", { url: () => "http://127.0.0.1:6001/unapproved" });
    await expect(watch.assert()).rejects.toThrow(/Character request origins/);
    await watch.dispose();
  });
});
describe("catalog CSP admission", () => {
  it("admits WebKit select style attributes and capture-time injected stylesheets", async () => {
    const page = new FakePage();
    const watch = await watchCatalogPage(page, url, "Catalog", "webkit");
    page.violate(select);
    page.violate(select);
    page.violate(injected);
    page.violate({ ...select, target: "SELECT", source: "" });
    await expect(watch.assert()).resolves.toBeUndefined();
    await watch.dispose();
  });
  it("fails the same violations in Chromium and Firefox", async () => {
    for (const engine of ["chromium", "firefox"])
      for (const violation of [select, injected]) {
        const page = new FakePage();
        const watch = await watchCatalogPage(page, url, "Catalog", engine);
        page.violate(violation);
        await expect(watch.assert(), `${engine}/${violation.directive}`).rejects.toThrow(
          /Catalog CSP violations/,
        );
        await watch.dispose();
        expect(unadmittedConsoleErrors(engine, [webkitStyleRefusal], 1)).toEqual([
          webkitStyleRefusal,
        ]);
      }
  });
  it("fails the injected stylesheet outside a capture and every other WebKit variant", async () => {
    for (const violation of [
      { ...injected, capture: false },
      { ...injected, source: "http://127.0.0.1:6000/assets/index.js" },
      { ...injected, target: "STYLE" },
      { ...select, directive: "style-src-elem" },
      { ...select, directive: "script-src-attr" },
      { ...select, target: "DIV" },
      { ...select, blocked: "http://127.0.0.1:6000/assets/index.css" },
      { ...select, disposition: "report" },
      { ...injected, disposition: "report" },
    ]) {
      expect(admittedCspViolation("webkit", violation), JSON.stringify(violation)).toBe(false);
      const page = new FakePage();
      const watch = await watchCatalogPage(page, url, "Catalog", "webkit");
      page.violate(violation);
      await expect(watch.assert(), JSON.stringify(violation)).rejects.toThrow(
        /Catalog CSP violations/,
      );
      await watch.dispose();
    }
  });
  it("fails WebKit refusal messages beyond the admitted violations", async () => {
    const page = new FakePage();
    const watch = await watchCatalogPage(page, url, "Catalog", "webkit");
    page.violate(select);
    page.violate(injected);
    page.emit("console", { type: () => "error", text: () => webkitStyleRefusal });
    await expect(watch.assert()).rejects.toThrow(/Catalog console\/CSP errors/);
    await watch.dispose();
  });
  it("fails an unrelated violation or console error beside admitted WebKit refusals", async () => {
    const unrelated = { ...select, directive: "connect-src", blocked: "https://example.invalid/" };
    for (const [violation, message, pattern] of [
      [unrelated, undefined, /Catalog CSP violations/],
      [undefined, "Synthetic failure", /Catalog console\/CSP errors/],
    ] as const) {
      const page = new FakePage();
      const watch = await watchCatalogPage(page, url, "Catalog", "webkit");
      page.violate(select);
      if (violation) page.violate(violation, false);
      if (message) page.emit("console", { type: () => "error", text: () => message });
      await expect(watch.assert()).rejects.toThrow(pattern);
      await watch.dispose();
    }
  });
});
describe("catalog CSP reporter", () => {
  const scope = globalThis as {
    window?: Record<string, unknown>;
    document?: EventTarget & { nodeName: string };
  };
  afterEach(() => {
    delete scope.window;
    delete scope.document;
  });
  it("reports structured violation events and stays inert after disposal", async () => {
    const page = new FakePage();
    const watch = await watchCatalogPage(page, url, "Catalog", "webkit");
    const window: Record<string, unknown> = { __ohtiaCatalogCapture: 1 };
    const document = Object.assign(new EventTarget(), { nodeName: "#document" });
    scope.window = window;
    scope.document = document;
    page.initScript?.(page.initArgument);
    window[page.binding] = (violation: Violation) => page.report?.(null, violation);
    const violation = () =>
      Object.assign(new Event("securitypolicyviolation"), {
        effectiveDirective: "style-src-elem",
        blockedURI: "inline",
        disposition: "enforce",
        sourceFile: "",
      });
    document.dispatchEvent(violation());
    page.emit("console", { type: () => "error", text: () => webkitStyleRefusal });
    await expect(watch.assert()).resolves.toBeUndefined();
    await watch.dispose();
    Reflect.deleteProperty(window, page.binding);
    expect(() => document.dispatchEvent(violation())).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
  it("keeps the journey failure when a closed page cannot release the watcher", async () => {
    const page = new FakePage();
    const watch = await watchCatalogPage(page, url, "Catalog", "webkit");
    page.disposeFailure = new Error("Synthetic target closed");
    page.closed = true;
    await expect(watch.dispose()).resolves.toBeUndefined();
    expect(page.disposed).toBe(2);
    const open = new FakePage();
    const openWatch = await watchCatalogPage(open, url, "Catalog", "webkit");
    open.disposeFailure = new Error("Synthetic release failure");
    await expect(openWatch.dispose()).rejects.toThrow("Synthetic release failure");
  });
});
describe("catalog evidence capture", () => {
  const scope = globalThis as { window?: Record<string, number> };
  afterEach(() => {
    delete scope.window;
  });
  it("marks the page only while the screenshot runs, including when it fails", async () => {
    scope.window = {};
    const marks: (number | undefined)[] = [];
    const page = Object.assign(new FakePage(), {
      screenshot: () => {
        marks.push(scope.window?.__ohtiaCatalogCapture);
        return Promise.reject(new Error("Synthetic capture failure"));
      },
    });
    await expect(captureCatalog(page, { path: "unused.png" })).rejects.toThrow(
      "Synthetic capture failure",
    );
    const locator = {
      page: () => page,
      screenshot: () => {
        marks.push(scope.window?.__ohtiaCatalogCapture);
        return Promise.resolve(Buffer.from("png"));
      },
    };
    await expect(captureCatalog(locator, {})).resolves.toEqual(Buffer.from("png"));
    expect(marks).toEqual([1, 1]);
    expect(scope.window.__ohtiaCatalogCapture).toBe(0);
  });
});
describe("selected contributor identity", () => {
  const identity = "Boris · Writing review · Academic editor · AI";
  it("accepts the exact identity with at most one closing block-boundary line feed", () => {
    expect(() => expectSelectedIdentity(identity, identity)).not.toThrow();
    expect(() => expectSelectedIdentity(`${identity}\n`, identity)).not.toThrow();
  });
  it("rejects changed identity text, interior or repeated line breaks and other whitespace", () => {
    for (const selected of [
      "Boris · Writing review · Academic editor",
      "Boris · Writing review · Academic editor · Human",
      "Boris Writing review Academic editor AI",
      "Boris\n·\nWriting review\n·\nAcademic editor\n·\nAI",
      `\n${identity}`,
      `${identity}\n\n`,
      `${identity}\r\n`,
      `${identity} `,
      `${identity}\u00a0`,
      "",
    ])
      expect(() => expectSelectedIdentity(selected, identity), JSON.stringify(selected)).toThrow(
        /Selected contributor identity/,
      );
  });
});
