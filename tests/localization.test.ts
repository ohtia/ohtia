import fs from "node:fs";
import { describe, it, expect, vi } from "vitest";
import {
  catalogs,
  messageContracts,
  supportedLocales,
  localeAutonyms,
  message,
  resolveInterfaceLocale,
  formatNumber,
  formatDate,
  decodeLocaleChange,
  decodeLocaleSnapshot,
  decodeEnvelope,
  failure,
  staleRevision,
  policyId,
  type LocaleSnapshot,
  type LocaleReceipt,
  type Outcome,
  type FoundationPort,
  type SavedLocaleRecord,
  type LocaleChoice,
  type PortCall,
  type LocaleChange,
} from "@ohtia/contracts";
import { pseudolocalize } from "./fixtures/pseudolocalization.mjs";
import { catalogGate } from "../tooling/quality-catalogs.mjs";
import { LanguageController } from "../packages/renderer/src/language-controller.js";

const snapshot = (value: LocaleChoice = "system", revision = 0): LocaleSnapshot => ({
  serviceGeneration: "service-1",
  record: { schemaVersion: 1, revision, value, source: revision ? "saved" : "default" },
  systemLocale: "en-GB",
  effectiveLocale: value === "system" ? "en-GB" : value,
});
function call<T>(value: T): PortCall<T> {
  return { result: Promise.resolve(value), cancel: vi.fn() };
}
function harness(apply = vi.fn()) {
  let notify: (result: Outcome<LocaleSnapshot>) => void = () => {};
  const port = {
    readLocale: vi.fn(() => call({ ok: true as const, value: snapshot() })),
    replaceLocale: vi.fn((command: LocaleChange): PortCall<Outcome<SavedLocaleRecord>> =>
      call({
        ok: true,
        value: {
          schemaVersion: 1,
          revision: command.expectedRevision + 1,
          value: command.value,
          source: "saved",
        },
      }),
    ),
    readLocaleReceipt: vi.fn((): PortCall<Outcome<LocaleReceipt>> =>
      call({ ok: true, value: { state: "not_found" } }),
    ),
    subscribeLocale: vi.fn((listener: typeof notify) => {
      notify = listener;
      return {
        ready: Promise.resolve({ ok: true as const, value: { subscriptionId: "locale" } }),
        dispose: vi.fn(),
      };
    }),
  };
  const controller = new LanguageController(
    port as unknown as FoundationPort,
    apply,
    (() => {
      let n = 0;
      return () => "op-" + ++n;
    })(),
  );
  return { port, controller, apply, notify: (result: Outcome<LocaleSnapshot>) => notify(result) };
}
describe("complete shared localization", () => {
  it("checks exact JSON inventory, every typed parameter and the controlled autonyms", () => {
    expect(catalogGate(supportedLocales, messageContracts, catalogs)).toMatchObject({
      status: "passed",
      locales: 25,
    });
    expect(fs.readdirSync("packages/contracts/src/localization").sort()).toEqual(
      supportedLocales.map((l) => l + ".json").sort(),
    );
    expect(Object.keys(localeAutonyms)).toEqual([...supportedLocales]);
    for (const locale of supportedLocales) {
      expect(localeAutonyms[locale].lang).toBe(locale);
      expect(
        message(locale, "settings.language.useSystem", { locale: localeAutonyms[locale].label }),
      ).toContain(localeAutonyms[locale].label);
      expect(message(locale, "settings.language.rejected", { value: "private draft" })).toContain(
        "private draft",
      );
      expect(message(locale, "title")).toBe("Ohtia");
      expect(formatNumber(locale, 12345.67)).toBe(new Intl.NumberFormat(locale).format(12345.67));
      const date = new Date("2026-01-02T12:00:00Z");
      expect(formatDate(locale, date, { timeZone: "UTC" })).toBe(
        new Intl.DateTimeFormat(locale, { timeZone: "UTC" }).format(date),
      );
    }
    expect(() =>
      Reflect.apply(message, undefined, ["en-US", "settings.language.useSystem"]),
    ).toThrow(/parameters/);
    expect(() => Reflect.apply(message, undefined, ["en-US", "title", { extra: "no" }])).toThrow(
      /parameters/,
    );
    expect(() => Reflect.apply(message, undefined, ["en-US", "absent"])).toThrow(/Missing/);
  });
  it("resolves unavailable preferences and explicit invalid choices without mutating inputs", () => {
    expect(resolveInterfaceLocale(undefined)).toBe("en-US");
    expect(resolveInterfaceLocale(["en-GB", "fr-CA"], "es-AR")).toBe("es-AR");
    expect(resolveInterfaceLocale(["bad_tag", "ca-ES-u-nu-latn"], "not-supported")).toBe("ca-ES");
    expect(resolveInterfaceLocale(["zz-ZZ", "fr-CA"])).toBe("fr-CA");
  });
  it("rejects unsupported and extra fields on the real closed locale schema", () => {
    for (const value of [
      null,
      {},
      { operationId: "op", expectedRevision: 0, value: "nn-NO" },
      { operationId: "op", expectedRevision: -1, value: "system" },
      { operationId: "op", expectedRevision: 0, value: "ko-KR", private: true },
      { operationId: "op", expectedRevision: Number.MAX_SAFE_INTEGER, value: "system" },
    ])
      expect(decodeLocaleChange(value).ok).toBe(false);
    expect(decodeLocaleChange({ operationId: "op", expectedRevision: 0, value: "ko-KR" }).ok).toBe(
      true,
    );
    expect(decodeLocaleSnapshot(snapshot())).toEqual(snapshot());
    expect(decodeLocaleSnapshot({ ...snapshot(), effectiveLocale: "es-ES" })).toBeUndefined();
    expect(decodeLocaleSnapshot({})).toBeUndefined();
    expect(
      decodeLocaleSnapshot({
        get record() {
          throw new Error("Do not evaluate");
        },
      }),
    ).toBeUndefined();
    const base = {
      protocol: 1,
      policy: policyId,
      kind: "result",
      requestId: "r",
      operationId: "o",
      windowGeneration: "w",
      serviceGeneration: "service-1",
    };
    expect(
      decodeEnvelope({
        ...base,
        operation: "locale.read",
        payload: { ok: true, value: snapshot() },
      }).ok,
    ).toBe(true);
    expect(
      decodeEnvelope({
        ...base,
        operation: "locale.receipt",
        payload: { ok: true, value: { state: "recorded", outcome: staleRevision(2) } },
      }).ok,
    ).toBe(true);
    expect(
      decodeEnvelope({
        ...base,
        operation: "locale.replace",
        payload: { ok: true, value: snapshot().record },
      }).ok,
    ).toBe(false);
  });
});
describe("language causal identity and view lifetime", () => {
  it("saves each separately admitted intent once and ignores obsolete passive revisions", async () => {
    const h = harness();
    const changes = vi.fn();
    const off = h.controller.subscribe(changes);
    await h.controller.refresh();
    h.notify({ ok: true, value: snapshot("fr-CA", 3) });
    h.notify({ ok: true, value: snapshot("ko-KR", 1) });
    expect(h.controller.snapshot().draft).toBe("fr-CA");
    expect(h.controller.snapshot().changedFromWindow).toBe(true);
    h.port.readLocale.mockImplementation(() => call({ ok: true, value: snapshot("es-AR", 4) }));
    await h.controller.choose("es-AR");
    expect(h.controller.snapshot().phase).toBe("confirmed");
    expect(h.port.replaceLocale).toHaveBeenCalledWith(
      {
        operationId: "op-1",
        expectedRevision: 3,
        value: "es-AR",
      },
      "service-1",
    );
    await h.controller.choose("es-AR");
    expect(h.port.replaceLocale).toHaveBeenCalledTimes(2);
    expect(changes).toHaveBeenCalled();
    off();
    h.controller.dispose();
  });
  it.each(["not_found", "pending", "read-failure"])(
    "retains the original uncertain identity after %s and never resends",
    async (state) => {
      const h = harness();
      await h.controller.refresh();
      h.port.replaceLocale.mockImplementation(() => call(failure("uncertain")));
      h.port.readLocaleReceipt.mockImplementation(() =>
        call(
          state === "read-failure"
            ? failure("storage_failed")
            : { ok: true, value: { state: state as "pending" | "not_found" } },
        ),
      );
      await h.controller.choose("ko-KR");
      await h.controller.choose("fr-FR");
      await h.controller.check();
      expect(h.controller.snapshot().phase).toBe("uncertain");
      expect(h.port.readLocaleReceipt).toHaveBeenCalledWith("op-1");
      expect(h.port.replaceLocale).toHaveBeenCalledOnce();
      h.controller.dispose();
    },
  );
  it("reconciles a durable receipt and separates refresh failure from a successful save", async () => {
    const h = harness();
    await h.controller.refresh();
    h.port.replaceLocale.mockImplementation(() => call(failure("uncertain")));
    await h.controller.choose("ko-KR");
    h.port.readLocaleReceipt.mockImplementation(() =>
      call({
        ok: true,
        value: {
          state: "recorded",
          outcome: { ok: true, value: snapshot("ko-KR", 1).record as SavedLocaleRecord },
        },
      }),
    );
    h.port.readLocale.mockImplementation(() => call(failure("storage_failed")) as never);
    await h.controller.check();
    expect(h.controller.snapshot()).toMatchObject({ phase: "confirmed", readFailed: true });
    h.port.readLocale.mockImplementation(() => call({ ok: true, value: snapshot("ko-KR", 1) }));
    await h.controller.refresh();
    await h.controller.check();
    expect(h.controller.snapshot().readFailed).toBe(false);
    expect(h.port.replaceLocale).toHaveBeenCalledOnce();
    h.controller.dispose();
  });
  it.each(["stale_revision", "storage_failed"])(
    "keeps %s distinct and retries rejection only as a fresh intent",
    async (code) => {
      const h = harness();
      await h.controller.refresh();
      h.port.replaceLocale.mockImplementation(() =>
        call(code === "stale_revision" ? staleRevision(2) : failure("storage_failed")),
      );
      await h.controller.choose("es-AR");
      expect(h.controller.snapshot().phase).toBe(
        code === "stale_revision" ? "conflict" : "rejected",
      );
      await h.controller.retry();
      expect(h.port.replaceLocale).toHaveBeenCalledTimes(code === "stale_revision" ? 1 : 2);
      h.controller.dispose();
    },
  );
  it("reconciles a stale receipt and retries presentation alone", async () => {
    const apply = vi.fn(() => {
      throw new Error("Synthetic display failure");
    });
    const h = harness(apply);
    await h.controller.refresh();
    expect(h.controller.snapshot().displayFailed).toBe(true);
    h.controller.applyAgain();
    expect(h.controller.snapshot().displayFailed).toBe(true);
    apply.mockImplementation(() => {});
    h.controller.applyAgain();
    expect(h.controller.snapshot().displayFailed).toBe(false);
    h.port.replaceLocale.mockImplementation(() => call(failure("uncertain")));
    await h.controller.choose("ko-KR");
    h.port.readLocaleReceipt.mockImplementation(() =>
      call({ ok: true, value: { state: "recorded", outcome: staleRevision(2) } }),
    );
    await h.controller.check();
    expect(h.controller.snapshot().phase).toBe("conflict");
    expect(h.port.replaceLocale).toHaveBeenCalledOnce();
    h.controller.dispose();
  });
  it("disposes late callbacks and bounded subscriptions without changing a replacement view", async () => {
    const a = harness();
    await a.controller.refresh();
    let resolve!: (value: Outcome<SavedLocaleRecord>) => void;
    a.port.replaceLocale.mockImplementation(() => ({
      result: new Promise((done) => {
        resolve = done;
      }),
      cancel: vi.fn(),
    }));
    const pending = a.controller.choose("ko-KR");
    a.controller.dispose();
    const b = harness();
    await b.controller.refresh();
    await b.controller.choose("es-AR");
    const before = b.controller.snapshot();
    resolve({ ok: true, value: snapshot("ko-KR", 1).record as SavedLocaleRecord });
    await pending;
    a.notify({ ok: true, value: snapshot("fr-CA", 9) });
    await a.controller.refresh();
    await a.controller.choose("es-ES");
    a.controller.applyAgain();
    expect(b.controller.snapshot()).toBe(before);
    expect(a.apply).toHaveBeenCalledTimes(1);
    b.controller.dispose();
  });
  it("rereads and resubscribes once after a gap, with disposal and a controlled failure", async () => {
    const h = harness();
    await h.controller.refresh();
    h.notify(failure("sequence_gap"));
    expect(h.port.subscribeLocale).toHaveBeenCalledTimes(2);
    await h.controller.refresh();
    h.port.subscribeLocale.mockImplementation(
      () => ({ ready: Promise.resolve(failure("service_unavailable")), dispose: vi.fn() }) as never,
    );
    await h.controller.refresh();
    expect(h.controller.snapshot().readFailed).toBe(true);
    h.controller.dispose();
  });
});

describe("language recovery race regressions", () => {
  it("keeps new input during a pending write and suppresses repeated snapshot application", async () => {
    const h = harness();
    await h.controller.choose("ko-KR");
    await h.controller.check();
    await h.controller.refresh();
    expect(h.port.replaceLocale).not.toHaveBeenCalled();
    await h.controller.choose("nn-NO");
    let finish!: (result: Outcome<SavedLocaleRecord>) => void;
    h.port.replaceLocale.mockImplementation(() => ({
      result: new Promise((resolve) => {
        finish = resolve;
      }),
      cancel() {},
    }));
    const saving = h.controller.choose("ko-KR");
    h.notify({ ok: true, value: snapshot("es-AR", 2) });
    expect(h.controller.snapshot().draft).toBe("ko-KR");
    const count = h.apply.mock.calls.length;
    h.notify({ ok: true, value: snapshot("es-AR", 2) });
    expect(h.apply).toHaveBeenCalledTimes(count);
    finish(staleRevision(2));
    await saving;
    expect(h.controller.snapshot().phase).toBe("conflict");
    h.controller.dispose();
  });
  it("coalesces receipt checks, disposes pending reads and ignores the old receipt after replacement", async () => {
    const h = harness();
    await h.controller.refresh();
    h.port.replaceLocale.mockImplementation(() => call(failure("uncertain")));
    await h.controller.choose("ko-KR");
    let finish!: (result: Outcome<LocaleReceipt>) => void;
    const cancel = vi.fn();
    h.port.readLocaleReceipt.mockImplementation(() => ({
      result: new Promise((resolve) => {
        finish = resolve;
      }),
      cancel,
    }));
    const first = h.controller.check();
    await h.controller.check();
    expect(h.port.readLocaleReceipt).toHaveBeenCalledTimes(2);
    h.controller.dispose();
    expect(cancel).toHaveBeenCalledOnce();
    finish({
      ok: true,
      value: {
        state: "recorded",
        outcome: { ok: true, value: snapshot("ko-KR", 1).record as SavedLocaleRecord },
      },
    });
    await first;
    expect(h.controller.snapshot().phase).toBe("uncertain");
  });
  it("does not apply or announce a read finishing after the owner closes", async () => {
    const h = harness();
    let finish!: (value: Outcome<LocaleSnapshot>) => void;
    h.port.readLocale.mockImplementation(
      () =>
        ({
          result: new Promise((resolve) => {
            finish = resolve;
          }),
          cancel: vi.fn(),
        }) as never,
    );
    const pending = h.controller.refresh();
    h.controller.dispose();
    finish({ ok: true, value: snapshot("ko-KR", 2) });
    await pending;
    expect(h.apply).not.toHaveBeenCalled();
  });
});

describe("reviewed locale recovery contracts", () => {
  it("retains a failed stream when its concurrent read succeeds", async () => {
    const h = harness();
    let complete!: (value: Outcome<LocaleSnapshot>) => void;
    h.port.readLocale.mockImplementation(
      () =>
        ({
          result: new Promise((resolve) => {
            complete = resolve;
          }),
          cancel() {},
        }) as never,
    );
    const opening = h.controller.refresh();
    h.notify(failure("sequence_gap"));
    complete({ ok: true, value: snapshot() });
    await opening;
    expect(h.controller.snapshot().readFailed).toBe(true);
    expect(h.port.subscribeLocale).toHaveBeenCalledOnce();
    h.port.readLocale.mockImplementation(() => call({ ok: true, value: snapshot() }));
    await h.controller.refresh();
    expect(h.controller.snapshot().readFailed).toBe(false);
    h.controller.dispose();
  });
  it("adopts a restored checkpoint's lower revision only through a new admitted generation", async () => {
    const h = harness();
    await h.controller.refresh();
    h.notify({ ok: true, value: snapshot("ko-KR", 9) });
    h.notify({ ok: true, value: snapshot("system", 0) });
    expect(h.controller.snapshot().current?.record.revision).toBe(9);
    const restored = { ...snapshot(), serviceGeneration: "service-2" };
    h.notify({ ok: true, value: restored });
    expect(h.controller.snapshot().current).toEqual(restored);
    expect(h.controller.snapshot().draft).toBe("system");
    expect(h.controller.snapshot().changedFromWindow).toBe(false);
    h.controller.dispose();
  });
  it("does not announce an originating system save as another window's change", async () => {
    const h = harness();
    h.port.readLocale.mockImplementation(() => call({ ok: true, value: snapshot("ko-KR", 1) }));
    await h.controller.refresh();
    let read!: (value: Outcome<LocaleSnapshot>) => void;
    h.port.readLocale.mockImplementation(
      () =>
        ({
          result: new Promise((resolve) => {
            read = resolve;
          }),
          cancel() {},
        }) as never,
    );
    const saving = h.controller.choose("system");
    await Promise.resolve();
    await Promise.resolve();
    h.notify({ ok: true, value: snapshot("system", 2) });
    expect(h.controller.snapshot().changedFromWindow).toBe(false);
    read(failure("storage_failed"));
    await saving;
    expect(h.controller.snapshot()).toMatchObject({
      phase: "confirmed",
      changedFromWindow: false,
      readFailed: true,
    });
    h.controller.dispose();
  });
});

it("keeps pseudolocalization as a separate synthetic expansion resource", () => {
  for (const locale of supportedLocales) {
    const text = message(locale, "settings.language.help");
    const expanded = pseudolocalize(text);
    expect(expanded).toContain(text);
    expect(Array.from(expanded).length).toBeGreaterThanOrEqual(Array.from(text).length * 1.4);
  }
  expect(supportedLocales).toHaveLength(25);
});

it("rejects a locale snapshot from a different generation inside an otherwise valid envelope", () => {
  const value = snapshot();
  const base = {
    protocol: 1,
    policy: policyId,
    requestId: "r",
    operationId: "o",
    windowGeneration: "w",
    serviceGeneration: "service-2",
  };
  expect(
    decodeEnvelope({
      ...base,
      kind: "result",
      operation: "locale.read",
      payload: { ok: true, value },
    }).ok,
  ).toBe(false);
  expect(
    decodeEnvelope({
      protocol: 1,
      policy: policyId,
      kind: "event",
      windowGeneration: "w",
      serviceGeneration: "service-2",
      subscriptionId: "sub",
      sequence: 1,
      topic: "locale",
      payload: value,
    }).ok,
  ).toBe(false);
});

describe("recovery completion and new intent boundaries", () => {
  it("does not report a failed load while automatic bounded recovery is succeeding", async () => {
    const h = harness();
    await h.controller.refresh();
    const seen: boolean[] = [];
    h.controller.subscribe(() => seen.push(h.controller.snapshot().readFailed));
    let finish!: (result: Outcome<LocaleSnapshot>) => void;
    h.port.readLocale.mockImplementation(
      () =>
        ({
          result: new Promise((resolve) => {
            finish = resolve;
          }),
          cancel() {},
        }) as never,
    );
    h.notify(failure("sequence_gap"));
    expect(h.port.subscribeLocale).toHaveBeenCalledTimes(2);
    expect(seen).not.toContain(true);
    finish({ ok: true, value: snapshot() });
    await h.controller.refresh();
    expect(h.controller.snapshot().readFailed).toBe(false);
    expect(seen).not.toContain(true);
    h.controller.dispose();
  });
  it("keeps not_found uncertain in the same generation and permits only a new explicit intent after replacement", async () => {
    const h = harness();
    let current = snapshot();
    h.port.readLocale.mockImplementation(() => call({ ok: true, value: current }));
    h.port.replaceLocale.mockImplementationOnce(() => call(failure("uncertain")));
    await h.controller.refresh();
    await h.controller.choose("ko-KR");
    expect(h.controller.snapshot().canChoose).toBe(false);
    await h.controller.retry();
    expect(h.port.replaceLocale).toHaveBeenCalledOnce();
    current = { ...snapshot(), serviceGeneration: "service-2" };
    await h.controller.refresh();
    expect(h.controller.snapshot()).toMatchObject({ phase: "uncertain", canChoose: true });
    expect(h.port.readLocaleReceipt).toHaveBeenLastCalledWith("op-1");
    expect(h.port.replaceLocale).toHaveBeenCalledOnce();
    current = { ...snapshot("ko-KR", 1), serviceGeneration: "service-2" };
    await h.controller.retry();
    expect(h.port.replaceLocale).toHaveBeenLastCalledWith(
      {
        operationId: "op-2",
        expectedRevision: 0,
        value: "ko-KR",
      },
      "service-2",
    );
    expect(h.controller.snapshot().phase).toBe("confirmed");
    expect(h.controller.snapshot().canChoose).toBe(false);
    h.controller.dispose();
  });
});

it.each(["not_found", "pending", "failed"])(
  "surfaces a stream gap during an automatic %s receipt wait without unbounded recovery",
  async (state) => {
    const h = harness();
    await h.controller.refresh();
    h.port.replaceLocale.mockImplementation(() => call(failure("uncertain")));
    await h.controller.choose("ko-KR");
    let finish!: (result: Outcome<LocaleReceipt>) => void;
    h.port.readLocaleReceipt.mockImplementationOnce(() => ({
      result: new Promise((resolve) => {
        finish = resolve;
      }),
      cancel() {},
    }));
    const recovering = h.controller.refresh();
    await vi.waitFor(() => expect(h.port.readLocaleReceipt).toHaveBeenCalledTimes(2));
    expect(h.controller.snapshot().readFailed).toBe(false);
    h.notify(failure("sequence_gap"));
    finish(
      state === "failed"
        ? failure("service_unavailable")
        : { ok: true, value: { state: state as "pending" | "not_found" } },
    );
    await recovering;
    expect(h.controller.snapshot()).toMatchObject({ phase: "uncertain", readFailed: true });
    expect(h.port.subscribeLocale).toHaveBeenCalledTimes(2);
    expect(h.port.replaceLocale).toHaveBeenCalledOnce();
    await h.controller.refresh();
    expect(h.controller.snapshot().readFailed).toBe(false);
    expect(h.port.subscribeLocale).toHaveBeenCalledTimes(3);
    expect(h.port.replaceLocale).toHaveBeenCalledOnce();
    h.controller.dispose();
  },
);
