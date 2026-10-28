import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  admitRuntimeProfile,
  catalogs,
  decodeBootstrapSnapshot,
  decodeText,
  messageKeys,
  portLimits,
  resolveInterfaceLocale,
  supportedLocales,
  isBootstrapAction,
  type ProfileHost,
  type RuntimeProfile,
} from "../packages/contracts/dist/index.js";
import {
  containsPath,
  readBoundedFile,
  admitRuntimeSwitches,
  LocatorPublisher,
  parseLocator,
  posixLocatorIO,
  readLocator,
  ServiceSupervisor,
  RuntimeNotices,
  recoverService,
  validateDataDirectory,
  type SupervisedChild,
} from "../packages/main/dist/index.js";
import { createStatusService } from "../packages/utility/dist/index.js";
import { request } from "./fixtures/port-corpus.js";

const temporary: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ohtia runtime ñ ")));
  temporary.push(root);
  const home = path.join(root, "isolated");
  const configuration = path.join(home, "config");
  const research = path.join(home, "ohtia");
  const scratch = path.join(home, "scratch");
  const stable = path.join(root, "stable");
  for (const p of [configuration, research, scratch, stable]) fs.mkdirSync(p, { recursive: true });
  const profile: RuntimeProfile = {
    schema_version: 1,
    kind: "independent-native-profile",
    inspected_by: "agent:test",
    username: "isolated",
    target: "linux-x64",
    home,
    configuration_root: configuration,
    research_root: research,
    scratch_root: scratch,
    stable_roots: Object.fromEntries(
      ["configuration", "store", "recovery"].map((key) => [
        key,
        { root: stable, sentinel_sha256: "a".repeat(64) },
      ]),
    ) as RuntimeProfile["stable_roots"],
    manual_checks: {
      independent_account_or_vm: true,
      no_emulation: true,
      local_owned_unsynchronized_volumes: true,
      no_credentials: true,
      stable_roots_complete: true,
      native_security_and_display: true,
    },
  };
  const host: ProfileHost = {
    username: "isolated",
    home,
    configurationRoot: configuration,
    researchRoot: research,
    target: "linux-x64",
    canonical: (p) => fs.realpathSync.native(p),
    contains: containsPath,
    owned: () => true,
  };
  return { root, profile, host, settings: path.join(configuration, "Ohtia", "settings") };
}
describe("minimum locale contract", () => {
  it.each(supportedLocales)(
    "retains the exact supported %s locale and a complete catalog",
    (locale) => {
      expect(resolveInterfaceLocale([locale])).toBe(locale);
      expect(catalogs[locale].version).toBe(1);
      expect(Object.keys(catalogs[locale].messages)).toEqual([...messageKeys]);
      expect(
        Object.values(catalogs[locale].messages).every(
          (text) => text.length > 0 && !/[{}<>]/.test(text),
        ),
      ).toBe(true);
    },
  );
  it.each([
    [["es-CL", "en-GB"], "es-ES"],
    [["nn-NO", "en-GB"], "en-GB"],
    [["de-Latn-CH"], "de-CH"],
    [["ca-ES-valencia"], "ca-ES"],
    [["de-CH-1996"], "de-CH"],
    [["en-GB-u-nu-latn"], "en-GB"],
    [["bad_tag", "fr-CA"], "fr-CA"],
    [["zz-ZZ", "fr-CA"], "fr-CA"],
    [["pt-AO"], "pt-PT"],
    [["en-IN"], "en-US"],
    [["no-NO"], "nb-NO"],
    [["no"], "nb-NO"],
    [[], "en-US"],
    [["nn-NO"], "en-US"],
    ...Object.entries({
      en: "en-US",
      es: "es-ES",
      pt: "pt-PT",
      fr: "fr-FR",
      de: "de-DE",
      it: "it-IT",
      nl: "nl-NL",
      sv: "sv-SE",
      da: "da-DK",
      nb: "nb-NO",
      fi: "fi-FI",
      ca: "ca-AD",
      ko: "ko-KR",
    }).map(([language, expected]) => [[language], expected]),
  ])("resolves ordered preferences %j", (languages, expected) => {
    expect(resolveInterfaceLocale(languages as string[])).toBe(expected);
  });
  it("admits only saved supported choices and never mutates rejected input", () => {
    expect(resolveInterfaceLocale(["en-GB"], "es-AR")).toBe("es-AR");
    expect(resolveInterfaceLocale(["en-GB"], { value: "es-AR" })).toBe("en-GB");
    expect(
      decodeBootstrapSnapshot({ version: 1, locale: "xx-XX", state: "missing" }),
    ).toBeUndefined();
    expect(
      decodeBootstrapSnapshot({ version: 1, locale: "ko-KR", state: "missing", path: "/private" }),
    ).toBeUndefined();
  });
});
describe("runtime launch and recovery guards", () => {
  it("admits instrumented loopback switches only for explicit acceptance", () => {
    expect(() => admitRuntimeSwitches(["/app with spaces"], [], false)).not.toThrow();
    expect(() =>
      admitRuntimeSwitches(["--remote-debugging-port=0"], ["--inspect=0"], true),
    ).not.toThrow();
    for (const flag of [
      "--inspect=0",
      "--disable-seccomp-filter-sandbox",
      "--disable-gpu-sandbox",
      "--renderer-cmd-prefix=other",
      "--utility-cmd-prefix=other",
      "--js-flags=other",
      "--log-file=/outside",
    ]) {
      expect(() => admitRuntimeSwitches([flag], [], false)).toThrow();
      if (flag !== "--inspect=0") expect(() => admitRuntimeSwitches([flag], [], true)).toThrow();
    }
  });
  it("excludes location selection and bounds recovery notices", () => {
    expect(isBootstrapAction("choose_open")).toBe(false);
    expect(isBootstrapAction("choose_create")).toBe(false);
    expect(isBootstrapAction("retry_service")).toBe(true);
    expect(
      decodeBootstrapSnapshot({
        version: 1,
        locale: "en-US",
        state: "pending_create",
        notice: "shutdown_uncertain",
      }),
    ).toMatchObject({ state: "pending_create", notice: "shutdown_uncertain" });
    expect(
      decodeBootstrapSnapshot({
        version: 1,
        locale: "en-US",
        state: "missing",
        notice: "arbitrary",
      }),
    ).toBeUndefined();
  });
  it("rejects a hard-linked locator before a descriptor content read", () => {
    const { profile, settings } = fixture();
    fs.mkdirSync(settings, { recursive: true });
    const stable = path.join(profile.stable_roots.configuration.root, "stable-location.json");
    fs.writeFileSync(stable, JSON.stringify({ version: 1, data_directory: profile.research_root }));
    const locator = path.join(settings, "data-location.json");
    fs.linkSync(stable, locator);
    const contentRead = vi.spyOn(fs, "readSync");
    try {
      expect(() => readBoundedFile(locator)).toThrow();
      expect(readLocator(settings, profile).state).toBe("locator_unreadable");
      expect(contentRead).not.toHaveBeenCalled();
    } finally {
      contentRead.mockRestore();
    }
  });
});
describe("native profile admission before executable or sentinel reads", () => {
  it("accepts an independently inspected set of real disjoint roots", () => {
    const { profile, host } = fixture();
    expect(admitRuntimeProfile(profile, host)).toBe(profile);
  });
  it.each(["username", "target", "home", "configuration_root"])(
    "refuses a changed %s without any content-read authority",
    (key) => {
      const { profile, host } = fixture();
      expect(() => admitRuntimeProfile({ ...profile, [key]: "unverified" }, host)).toThrow();
    },
  );
  it("rejects missing inspection, root overlap, foreign ownership and aliases", () => {
    const { profile, host } = fixture();
    expect(() => admitRuntimeProfile({ ...profile, manual_checks: {} }, host)).toThrow();
    expect(() =>
      admitRuntimeProfile({ ...profile, scratch_root: profile.research_root }, host),
    ).toThrow();
    expect(() => admitRuntimeProfile(profile, { ...host, owned: () => false })).toThrow();
    const alias = path.join(profile.home, "alias");
    fs.symlinkSync(
      profile.stable_roots.store.root,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => admitRuntimeProfile({ ...profile, research_root: alias }, host)).toThrow();
  });
});
describe("fixed locator and pending-location safety", () => {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  it("rejects duplicate locator keys and unpaired surrogate paths", () => {
    expect(
      parseLocator(new TextEncoder().encode('{"version":1,"version":1,"data_directory":"/data"}'))
        .state,
    ).toBe("locator_invalid");
    expect(parseLocator(encode({ version: 1, data_directory: "/data/\ud800" })).state).toBe(
      "locator_invalid",
    );
  });
  it.each([
    [{ version: 2, data_directory: "/data" }, "locator_newer"],
    [{ version: 0, data_directory: "/data" }, "locator_invalid"],
    [{ version: 1, data_directory: "relative" }, "locator_invalid"],
    [{ version: 1, data_directory: "/data", extra: true }, "locator_invalid"],
    [{ version: true, data_directory: "/data" }, "locator_invalid"],
  ])("rejects an incompatible locator %j", (input, expected) => {
    expect(parseLocator(encode(input)).state).toBe(expected);
  });
  it("bounds malformed UTF-8 and file length without changing a rejected record", () => {
    const { profile, settings } = fixture();
    fs.mkdirSync(settings, { recursive: true });
    const file = path.join(settings, "data-location.json");
    const bytes = Buffer.alloc(portLimits.locator_bytes + 1, 120);
    fs.writeFileSync(file, bytes);
    expect(readLocator(settings, profile).state).toBe("locator_invalid");
    expect(fs.readFileSync(file)).toEqual(bytes);
    expect(parseLocator(new Uint8Array([0xc0, 0x80])).state).toBe("locator_invalid");
  });
  it("rejects settings ancestors, descendants and aliases to stable data", () => {
    const { profile, settings } = fixture();
    fs.mkdirSync(settings, { recursive: true });
    const alias = path.join(profile.research_root, "alias");
    fs.symlinkSync(
      profile.stable_roots.store.root,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    for (const directory of [profile.home, settings, path.dirname(settings), alias])
      expect(() => validateDataDirectory(directory, settings, profile)).toThrow();
  });
  it("publishes only after successful store validation and preserves the previous record on pre-replace failure", async () => {
    const { profile, settings } = fixture();
    const old = profile.research_root;
    const next = profile.research_root;
    fs.mkdirSync(old, { recursive: true });
    fs.mkdirSync(next, { recursive: true });
    fs.mkdirSync(settings, { recursive: true });
    const file = path.join(settings, "data-location.json");
    const previous = encode({ version: 1, data_directory: old });
    fs.writeFileSync(file, previous);
    const publisher = new LocatorPublisher();
    expect(
      await publisher.publish(settings, next, profile, async () => false, posixLocatorIO),
    ).toBe("rejected");
    expect(fs.readFileSync(file)).toEqual(Buffer.from(previous));
    expect(
      await publisher.publish(settings, next, profile, async () => true, {
        ...posixLocatorIO,
        syncDirectory: async () => {
          throw new Error("denied");
        },
      }),
    ).toBe("rejected");
    expect(fs.readFileSync(file)).toEqual(Buffer.from(previous));
    expect(await publisher.publish(settings, next, profile, async () => true, posixLocatorIO)).toBe(
      "confirmed",
    );
    expect(readLocator(settings, profile)).toEqual({
      state: "located",
      locator: { version: 1, data_directory: next },
    });
  });
  it("retains the default folder and previous-locator evidence when replacement acknowledgement is lost", async () => {
    const { profile, settings } = fixture();
    const old = profile.research_root;
    const next = profile.research_root;
    fs.mkdirSync(old, { recursive: true });
    fs.mkdirSync(next, { recursive: true });
    fs.mkdirSync(settings, { recursive: true });
    fs.writeFileSync(
      path.join(settings, "data-location.json"),
      encode({ version: 1, data_directory: old }),
    );
    const io = {
      ...posixLocatorIO,
      syncDirectory: async () => {},
      replace: async (a: string, b: string) => {
        fs.renameSync(a, b);
        throw new Error("lost confirmation");
      },
    };
    expect(
      await new LocatorPublisher().publish(settings, next, profile, async () => true, io),
    ).toBe("uncertain");
    expect(fs.existsSync(old) && fs.existsSync(next)).toBe(true);
    expect(fs.readdirSync(settings).some((name) => name.endsWith(".previous"))).toBe(true);
  });
});

describe("acknowledged runtime errors", () => {
  it("waits for overlapping distinct notices and requests quit only once", async () => {
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const show = vi.fn((key: string) =>
      key === "resource_failure" ? first.promise : second.promise,
    );
    const quit = vi.fn();
    const notices = new RuntimeNotices(show, quit);
    const one = notices.quitAfter("resource_failure");
    const two = notices.quitAfter("startup_failed");
    expect(two).toBe(one);
    first.resolve();
    await first.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(quit).not.toHaveBeenCalled();
    second.resolve();
    await Promise.all([one, two]);
    expect(show).toHaveBeenCalledTimes(2);
    expect(quit).toHaveBeenCalledOnce();
  });
  it("deduplicates a repeated key and includes notices added while draining", async () => {
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const show = vi.fn((key: string) =>
      key === "startup_failed" ? first.promise : second.promise,
    );
    const quit = vi.fn();
    const notices = new RuntimeNotices(show, quit);
    expect(notices.report("startup_failed")).toBe(notices.report("startup_failed"));
    const exiting = notices.quitAfter("startup_failed");
    await Promise.resolve();
    const later = notices.report("shutdown_uncertain");
    first.resolve();
    await first.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(quit).not.toHaveBeenCalled();
    second.resolve();
    await Promise.all([exiting, later]);
    expect(show).toHaveBeenCalledTimes(2);
    expect(quit).toHaveBeenCalledOnce();
  });
});

class Child implements SupervisedChild {
  receive: (message: unknown) => void = () => {};
  exit: () => void = () => {};
  sent: string[] = [];
  killed = 0;
  send(message: string) {
    this.sent.push(message);
  }
  kill() {
    this.killed++;
  }
  messages(listener: (message: unknown) => void) {
    this.receive = listener;
  }
  exited(listener: () => void) {
    this.exit = listener;
  }
}
describe("bounded supervised service generation", () => {
  it("never restarts a faulted child when quit supersedes a pending retry", async () => {
    const child = new Child();
    const service = new ServiceSupervisor(child, "service-1", () => {});
    child.receive("invalid");
    let quitting = false;
    const restart = vi.fn();
    const retry = recoverService(service, () => !quitting, restart);
    quitting = true;
    const quit = service.stop();
    child.exit();
    expect(await retry).toBe("cancelled");
    expect(await quit).toBe(true);
    expect(restart).not.toHaveBeenCalled();
  });
  it("does not restart the old generation twice when concurrent retries wait for exit", async () => {
    const child = new Child();
    const service = new ServiceSupervisor(child, "service-1", () => {});
    child.receive("invalid");
    let current = true;
    const restart = vi.fn(() => {
      current = false;
    });
    const first = recoverService(service, () => current, restart);
    const second = recoverService(service, () => current, restart);
    child.exit();
    expect(await first).toBe("ready");
    expect(await second).toBe("cancelled");
    expect(restart).toHaveBeenCalledOnce();
  });
  it("deduplicates stop attempts and releases their timers after every uncertain deadline", async () => {
    vi.useFakeTimers();
    const child = new Child();
    const service = new ServiceSupervisor(child, "service-1", () => {});
    child.receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
    for (let i = 0; i < 3; i++) {
      const first = service.stop();
      expect(service.stop()).toBe(first);
      expect(service.available).toBe(false);
      expect(service.recoveryRequired).toBe(true);
      expect(vi.getTimerCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(portLimits.shutdown_total_ms);
      expect(await first).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
    child.exit();
  });
  it("reports recovery uncertainty without restarting a child that has not ceased", async () => {
    vi.useFakeTimers();
    const child = new Child();
    const service = new ServiceSupervisor(child, "service-1", () => {});
    child.receive("invalid");
    const restart = vi.fn();
    const recovery = recoverService(service, () => true, restart);
    await vi.advanceTimersByTimeAsync(portLimits.shutdown_total_ms);
    expect(await recovery).toBe("uncertain");
    expect(restart).not.toHaveBeenCalled();
    child.exit();
  });
  it("requires a ready handshake and releases no accepted work merely on a kill signal", () => {
    const child = new Child();
    const changed = vi.fn();
    const supervisor = new ServiceSupervisor(child, "service-1", changed);
    child.receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
    const release = vi.fn();
    const deliver = vi.fn();
    supervisor.dispatch({ request: request(), release, releaseSubscription: vi.fn(), deliver });
    child.receive("invalid");
    expect(child.killed).toBe(1);
    expect(release).not.toHaveBeenCalled();
    child.exit();
    expect(release).toHaveBeenCalledOnce();
    expect(supervisor.ceased).toBe(true);
    expect(deliver).toHaveBeenCalled();
  });
  it("rejects old generations and mismatched correlation before delivery", () => {
    const child = new Child();
    const supervisor = new ServiceSupervisor(child, "service-1", () => {});
    child.receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
    const deliver = vi.fn();
    supervisor.dispatch({
      request: request(),
      deliver,
      release: vi.fn(),
      releaseSubscription: vi.fn(),
    });
    const status = {
      artifact: "development",
      service: "ready",
      engine: "unavailable",
      interfaceLocale: "en-US",
    };
    child.receive(
      JSON.stringify({
        ...request({ serviceGeneration: "old" }),
        kind: "result",
        payload: { ok: true, value: status },
      }),
    );
    expect(deliver).not.toHaveBeenCalled();
    child.receive(
      JSON.stringify({
        ...request({ operationId: "wrong" }),
        kind: "result",
        payload: { ok: true, value: status },
      }),
    );
    expect(child.killed).toBe(1);
    child.exit();
  });
  it("bounds startup and shutdown while retaining uncertainty without an exit receipt", async () => {
    vi.useFakeTimers();
    const child = new Child();
    const supervisor = new ServiceSupervisor(child, "service-1", () => {});
    vi.advanceTimersByTime(portLimits.service_start_ms);
    expect(child.killed).toBe(1);
    const stopped = supervisor.stop();
    await vi.advanceTimersByTimeAsync(portLimits.shutdown_total_ms);
    expect(await stopped).toBe(false);
    expect(supervisor.ceased).toBe(false);
    child.exit();
  });
  it("faults a ready but unresponsive child by the shared request deadline", async () => {
    vi.useFakeTimers();
    const child = new Child();
    const changed = vi.fn();
    const supervisor = new ServiceSupervisor(child, "service-1", changed);
    expect(supervisor.recoveryRequired).toBe(false);
    child.receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
    const release = vi.fn();
    supervisor.dispatch({
      request: request(),
      release,
      releaseSubscription: vi.fn(),
      deliver: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(portLimits.request_deadline_ms);
    expect(supervisor.available).toBe(false);
    expect(supervisor.recoveryRequired).toBe(true);
    expect(child.killed).toBe(1);
    expect(release).not.toHaveBeenCalled();
    child.exit();
    expect(release).toHaveBeenCalledOnce();
  });
  it("exchanges the real shared wire contract with a status peer and rejects storage activation", () => {
    const child = new Child();
    const supervisor = new ServiceSupervisor(child, "service-1", () => {});
    const service = createStatusService("service-1", "ko-KR", (text) => child.receive(text));
    child.send = (text) => service.receive(text);
    child.receive(JSON.stringify({ kind: "ready", generation: "service-1" }));
    const replies: unknown[] = [];
    const work = {
      deliver: (text: string) => replies.push(decodeText(text)),
      release: vi.fn(),
      releaseSubscription: vi.fn(),
    };
    supervisor.dispatch({ ...work, request: request() });
    expect(replies[0]).toMatchObject({
      ok: true,
      value: { payload: { ok: true, value: { interfaceLocale: "ko-KR", engine: "unavailable" } } },
    });
    supervisor.dispatch({
      ...work,
      request: request({ operation: "appearance.read", requestId: "read-2" }),
    });
    expect(replies[1]).toMatchObject({
      ok: true,
      value: { payload: { ok: false, error: { code: "service_unavailable" } } },
    });
    child.exit();
  });
});
