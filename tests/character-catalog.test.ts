import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { expectSelectedIdentity, watchCharacterPage } from "../tooling/catalog-character.mjs";

describe("character catalog page admission", () => {
  it("observes local requests and removes every listener when the page is released", () => {
    const page = new EventEmitter();
    const watch = watchCharacterPage(page, "http://127.0.0.1:6000/");
    page.emit("request", { url: () => "http://127.0.0.1:6000/assets/local.js" });
    page.emit("console", { type: () => "info", text: () => "Synthetic info" });
    expect(() => watch.assert()).not.toThrow();
    watch.dispose();
    for (const type of ["pageerror", "console", "request"])
      expect(page.listenerCount(type)).toBe(0);
  });
  it("fails on a runtime error from any observed character page", () => {
    const page = new EventEmitter();
    const watch = watchCharacterPage(page, "http://127.0.0.1:6000/");
    page.emit("pageerror", new Error("Synthetic runtime failure"));
    expect(() => watch.assert()).toThrow(/Character page errors/);
    watch.dispose();
  });
  it("fails on console and CSP errors from a coarse or ordinary character page", () => {
    const page = new EventEmitter();
    const watch = watchCharacterPage(page, "http://127.0.0.1:6000/");
    page.emit("console", { type: () => "error", text: () => "Synthetic CSP refusal" });
    expect(() => watch.assert()).toThrow(/Character console\/CSP errors/);
    watch.dispose();
  });
  it("fails on a request outside the admitted origin even when its hostname shares a prefix", () => {
    const page = new EventEmitter();
    const watch = watchCharacterPage(page, "http://127.0.0.1:6000/");
    page.emit("request", { url: () => "http://127.0.0.1:6001/unapproved" });
    expect(() => watch.assert()).toThrow(/Character request origins/);
    watch.dispose();
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
