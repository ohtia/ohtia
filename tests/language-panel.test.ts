// @vitest-environment jsdom
import { createElement, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, expect, vi } from "vitest";
import { LanguagePanel } from "../packages/renderer/src/language-panel.js";
import {
  message,
  supportedLocales,
  localeAutonyms,
  failure,
  staleRevision,
  type LocaleSnapshot,
  type InterfaceLocale,
  type FoundationPort,
  type Outcome,
  type LocaleChange,
  type SavedLocaleRecord,
} from "@ohtia/contracts";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount());
  });
  document.body.replaceChildren();
});
function call<T>(value: T) {
  return { result: Promise.resolve(value), cancel: vi.fn() };
}
function snapshot(value: "system" | InterfaceLocale = "system", revision = 0): LocaleSnapshot {
  return {
    serviceGeneration: "service-1",
    record: { schemaVersion: 1, revision, value, source: revision ? "saved" : "default" },
    effectiveLocale: value === "system" ? "en-GB" : value,
    systemLocale: "en-GB",
  };
}
function harness(initial = snapshot()) {
  let current = initial;
  let notify: (value: Outcome<LocaleSnapshot>) => void = () => {};
  const port = {
    readLocale: vi.fn(() => call({ ok: true as const, value: current })),
    replaceLocale: vi.fn((command: LocaleChange) => {
      current = {
        ...snapshot(command.value, command.expectedRevision + 1),
        serviceGeneration: current.serviceGeneration,
      };
      return call({ ok: true as const, value: current.record as SavedLocaleRecord });
    }),
    readLocaleReceipt: vi.fn(() =>
      call({ ok: true as const, value: { state: "not_found" as const } }),
    ),
    subscribeLocale: (listener: typeof notify) => {
      notify = listener;
      return {
        ready: Promise.resolve({ ok: true, value: { subscriptionId: "language" } }),
        dispose: vi.fn(),
      };
    },
  };
  return {
    port,
    notify: (value: Outcome<LocaleSnapshot>) => {
      if (value.ok) current = value.value;
      notify(value);
    },
  };
}
async function mount(
  h: ReturnType<typeof harness>,
  locale: InterfaceLocale = "en-US",
  apply?: (snapshot: LocaleSnapshot) => void,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  function Surface() {
    const [language, setLanguage] = useState(locale);
    return createElement(
      "div",
      {},
      createElement("textarea", { defaultValue: "Researcher draft 연구 초안" }),
      createElement(LanguagePanel, {
        port: h.port as unknown as FoundationPort,
        locale: language,
        available: true,
        onLocale:
          apply ??
          ((value) => {
            document.documentElement.lang = value.effectiveLocale;
            setLanguage(value.effectiveLocale);
          }),
      }),
    );
  }
  await act(async () => root.render(createElement(Surface)));
  return container;
}
async function choose(container: HTMLElement, value: string) {
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function button(container: HTMLElement) {
  await act(async () => {
    container.querySelector("button")!.click();
  });
}
describe("localized language surface", () => {
  it.each(supportedLocales)("presents all autonyms and language tags in %s", async (locale) => {
    const h = harness(snapshot(locale, 1));
    const container = await mount(h, locale);
    expect(container.querySelector("h2")!.textContent).toContain(
      message(locale, "settings.language.title"),
    );
    const options = container.querySelectorAll("option");
    expect(options).toHaveLength(26);
    expect(options[0]!.textContent).toContain(localeAutonyms["en-GB"].label);
    supportedLocales.forEach((value, index) => {
      expect(options[index + 1]!.lang).toBe(value);
      expect(options[index + 1]!.textContent).toBe(localeAutonyms[value].label);
    });
    expect(container.querySelector("select")!.getAttribute("aria-describedby")).toBe(
      "language-help",
    );
  });
  it("changes messages and html.lang without remounting private input or moving focus", async () => {
    const h = harness();
    const container = await mount(h);
    const input = container.querySelector("textarea")!;
    input.focus();
    await act(async () => h.notify({ ok: true, value: snapshot("ko-KR", 2) }));
    expect(document.documentElement.lang).toBe("ko-KR");
    expect(container.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("Researcher draft 연구 초안");
    expect(document.activeElement).toBe(input);
    await choose(container, "es-AR");
    expect(h.port.replaceLocale).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(message("es-AR", "saved"));
  });
  it.each(["rejected", "conflict", "uncertain"])(
    "presents controlled %s with an inspectable action",
    async (phase) => {
      const h = harness();
      h.port.replaceLocale.mockImplementation(
        () =>
          call(
            phase === "conflict"
              ? staleRevision(2)
              : failure(phase === "uncertain" ? "uncertain" : "storage_failed"),
          ) as never,
      );
      if (phase === "conflict")
        h.port.readLocale
          .mockReturnValue(call({ ok: true, value: snapshot("fr-CA", 2) }) as never)
          .mockReturnValueOnce(call({ ok: true, value: snapshot() }) as never);
      const container = await mount(h);
      await choose(container, "ko-KR");
      expect(
        container.querySelector(phase === "rejected" ? '[role="alert"]' : 'p[role="status"]'),
      ).not.toBeNull();
      await button(container);
      expect(h.port.replaceLocale).toHaveBeenCalledTimes(phase === "rejected" ? 2 : 1);
      if (phase === "conflict")
        expect(document.activeElement).toBe(container.querySelector("select"));
      if (phase === "uncertain") expect(h.port.readLocaleReceipt).toHaveBeenCalledTimes(2);
    },
  );
  it("keeps saved success separate from display failure and retries application only", async () => {
    const h = harness();
    const apply = vi.fn(() => {
      throw new Error("Synthetic display failure");
    });
    const container = await mount(h, "en-US", apply);
    expect(container.textContent).toContain(message("en-US", "settings.language.applyFailed"));
    apply.mockImplementation(() => {});
    await button(container);
    expect(h.port.replaceLocale).not.toHaveBeenCalled();
    h.port.readLocale.mockImplementation(() => call(failure("storage_failed")) as never);
    await choose(container, "fr-CA");
    expect(container.textContent).toContain(message("en-US", "saved"));
    expect(container.textContent).toContain(message("en-US", "settings.language.readFailed"));
    await button(container);
  });
  it("announces invalid saved language without replacing evidence", async () => {
    const value = snapshot();
    const h = harness({
      ...value,
      record: { ...value.record, source: "invalid_fallback", revision: 2 },
    });
    const container = await mount(h);
    expect(container.textContent).toContain(message("en-GB", "locale_fallback"));
    expect(h.port.replaceLocale).not.toHaveBeenCalled();
  });
});

it("keeps the language control focusable while saving and restores action focus", async () => {
  const h = harness();
  let finish!: (value: unknown) => void;
  h.port.replaceLocale.mockImplementation(
    () =>
      ({
        result: new Promise((resolve) => {
          finish = resolve;
        }),
        cancel() {},
      }) as never,
  );
  const container = await mount(h);
  const select = container.querySelector("select")!;
  select.focus();
  await choose(container, "ko-KR");
  expect(select.disabled).toBe(false);
  expect(select.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(select);
  await act(async () => finish(failure("storage_failed")));
  const retry = container.querySelector("button")!;
  retry.focus();
  await button(container);
  expect(document.activeElement).toBe(select);
  await act(async () => finish(failure("storage_failed")));
});

it("offers an explicit system repair for an invalid saved value", async () => {
  const value = snapshot();
  const h = harness({
    ...value,
    record: { ...value.record, revision: 2, source: "invalid_fallback" },
  });
  const container = await mount(h);
  expect(h.port.replaceLocale).not.toHaveBeenCalled();
  await button(container);
  expect(h.port.replaceLocale).toHaveBeenCalledWith(
    expect.objectContaining({ expectedRevision: 2, value: "system" }),
    "service-1",
  );
  expect(document.activeElement).toBe(container.querySelector("select"));
});

it("offers a fresh explicit intent after durable absence in a newly admitted service", async () => {
  const h = harness();
  h.port.replaceLocale.mockImplementationOnce(() => call(failure("uncertain")) as never);
  const container = await mount(h);
  await choose(container, "ko-KR");
  await act(async () =>
    h.notify({ ok: true, value: { ...snapshot(), serviceGeneration: "service-2" } }),
  );
  await button(container);
  expect(container.textContent).toContain(message("en-GB", "settings.language.recovered"));
  expect(container.querySelector("select")!.getAttribute("aria-disabled")).toBe("false");
  expect(h.port.replaceLocale).toHaveBeenCalledOnce();
  const retry = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === message("en-GB", "settings.language.tryAgain"),
  )!;
  await act(async () => retry.click());
  expect(h.port.replaceLocale).toHaveBeenCalledTimes(2);
  expect(h.port.replaceLocale.mock.calls[1][0].operationId).not.toBe(
    h.port.replaceLocale.mock.calls[0][0].operationId,
  );
});
