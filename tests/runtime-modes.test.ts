import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  admitDevelopmentRoot,
  isDevelopmentExecutable,
  parseRuntimeArgument,
  type ProfileHost,
} from "@ohtia/contracts";
import {
  developmentRootLocation,
  nativeEnvironment,
  prepareDevelopmentRoot,
  shortTemporaryDirectory,
  waitForDesktop,
} from "../tooling/desktop-launch.mjs";
import { developmentInstanceRunning, holderName } from "../tooling/development-instance.mjs";
import {
  admitRuntimeSwitches,
  ensureResearchRoot,
  resolveRuntimeContext,
} from "../packages/main/src/profile.js";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-modes-")));
  temporary.push(base);
  const home = path.join(base, "home");
  const configurationRoot = path.join(home, ".config");
  fs.mkdirSync(configurationRoot, { recursive: true });
  const root = path.join(base, "checkout", ".ohtia-dev");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "instance.json"), JSON.stringify({ version: 1 }));
  const host: ProfileHost = {
    username: "synthetic",
    home,
    configurationRoot,
    researchRoot: path.join(home, "ohtia"),
    target: `${process.platform}-${process.arch}`,
    canonical: (value) => {
      if (!path.isAbsolute(value)) throw new Error("Absolute path required.");
      return fs.realpathSync.native(value);
    },
    contains: (parent, child) => {
      const relative = path.relative(parent, child);
      return (
        relative === "" ||
        (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
      );
    },
    owned: () => true,
  };
  const inputs = {
    profileFile: "",
    developmentRoot: "",
    packaged: true,
    appData: configurationRoot,
    temp: path.join(base, "temporary"),
  };
  return { base, home, root, host, inputs };
}
const guard = (host: ProfileHost) => ({
  home: host.home,
  researchRoot: host.researchRoot,
  nativeApplicationRoot: path.join(host.configurationRoot, "Ohtia"),
  canonical: host.canonical,
  contains: host.contains,
  owned: host.owned,
});

describe("runtime mode selection", () => {
  it("opens installed bytes at the native roots without a profile", () => {
    const { host, inputs, home } = fixture();
    expect(resolveRuntimeContext(inputs, host)).toEqual({
      mode: "installed",
      home,
      configuration_root: inputs.appData,
      research_root: path.join(home, "ohtia"),
      scratch_root: inputs.temp,
      stable_roots: {},
    });
  });
  it("keeps packaged bytes installed even with a valid development root", () => {
    const { host, inputs, root, home } = fixture();
    const context = resolveRuntimeContext({ ...inputs, developmentRoot: root }, host);
    expect(context.mode).toBe("installed");
    expect(context.research_root).toBe(path.join(home, "ohtia"));
  });
  it("redirects a development runtime only to its admitted root", () => {
    const { host, inputs, root } = fixture();
    const context = resolveRuntimeContext(
      { ...inputs, packaged: false, developmentRoot: root },
      host,
    );
    expect(context).toMatchObject({
      mode: "development",
      configuration_root: path.join(root, "configuration"),
      research_root: path.join(root, "research"),
      stable_roots: {},
    });
  });
  it("refuses a development runtime without a development root", () => {
    const { host, inputs } = fixture();
    expect(() => resolveRuntimeContext({ ...inputs, packaged: false }, host)).toThrow(
      "development root",
    );
  });
  it.each([true, false])(
    "refuses a failed qualification profile with no fallback when packaged is %s",
    (packaged) => {
      const { host, inputs, root } = fixture();
      expect(() =>
        resolveRuntimeContext(
          { ...inputs, packaged, developmentRoot: root, profileFile: "/not/admitted.json" },
          host,
        ),
      ).toThrow("Isolation admission refused");
    },
  );
  it("decodes only the closed service arguments", () => {
    expect(parseRuntimeArgument("installed")).toEqual({ mode: "installed" });
    expect(parseRuntimeArgument("development:/a")).toEqual({ mode: "development", root: "/a" });
    expect(parseRuntimeArgument("qualification:/a")).toEqual({
      mode: "qualification",
      profile: "/a",
    });
    for (const value of [undefined, "", "development:", "qualification:", "/a", "other:/a"])
      expect(parseRuntimeArgument(value)).toBeUndefined();
  });
  it("keeps refusing inspection switches without the acceptance variable", () => {
    for (const flag of ["--inspect=0", "--remote-debugging-port=0"]) {
      expect(() => {
        admitRuntimeSwitches([flag], [], false);
      }).toThrow("not admitted");
      expect(() => {
        admitRuntimeSwitches([flag], [], true);
      }).not.toThrow();
    }
  });
});

describe("development root guards", () => {
  it("admits a canonical owned root with its instance record", () => {
    const { host, root } = fixture();
    expect(() => {
      admitDevelopmentRoot(root, { version: 1 }, guard(host));
    }).not.toThrow();
  });
  it.each([undefined, null, {}, { version: 2 }, { version: 1, other: true }, "1"])(
    "refuses the invalid instance record %j",
    (instance) => {
      const { host, root } = fixture();
      expect(() => {
        admitDevelopmentRoot(root, instance, guard(host));
      }).toThrow("instance.json");
    },
  );
  it("refuses a root another account owns", () => {
    const { host, root } = fixture();
    expect(() => {
      admitDevelopmentRoot(root, { version: 1 }, { ...guard(host), owned: () => false });
    }).toThrow("another account");
  });
  it("refuses roots that overlap the native research or application locations", () => {
    const { host, home } = fixture();
    for (const location of [
      path.join(home, "ohtia"),
      path.join(home, "ohtia", "checkout", ".ohtia-dev"),
      path.join(home, ".config", "Ohtia", "nested"),
    ]) {
      fs.mkdirSync(location, { recursive: true });
      expect(() => {
        admitDevelopmentRoot(location, { version: 1 }, guard(host));
      }).toThrow("overlaps");
    }
  });
  it("refuses a root that contains the account home", () => {
    const { host, home } = fixture();
    expect(() => {
      admitDevelopmentRoot(path.dirname(home), { version: 1 }, guard(host));
    }).toThrow();
  });
  it.runIf(process.platform !== "win32")("refuses an aliased root", () => {
    const { host, root, base } = fixture();
    const alias = path.join(base, "alias");
    fs.symlinkSync(root, alias);
    expect(() => {
      admitDevelopmentRoot(alias, { version: 1 }, guard(host));
    }).toThrow("canonical");
  });
});

describe("development components", () => {
  it.runIf(process.platform !== "win32")("refuses an aliased configuration directory", () => {
    const { host, inputs, root, base } = fixture();
    const elsewhere = path.join(base, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(root, "configuration"));
    expect(() =>
      resolveRuntimeContext({ ...inputs, packaged: false, developmentRoot: root }, host),
    ).toThrow("configuration");
  });
  it("refuses a configuration entry that is not a directory", () => {
    const { host, inputs, root } = fixture();
    fs.writeFileSync(path.join(root, "configuration"), "file");
    expect(() =>
      resolveRuntimeContext({ ...inputs, packaged: false, developmentRoot: root }, host),
    ).toThrow("not a plain directory");
  });
});

describe("explicit research root creation", () => {
  it("creates a missing root without creating its parents", () => {
    const { home, base } = fixture();
    const root = path.join(home, "ohtia");
    ensureResearchRoot(root);
    expect(fs.lstatSync(root).isDirectory()).toBe(true);
    ensureResearchRoot(root);
    expect(() => {
      ensureResearchRoot(path.join(base, "missing", "ohtia"));
    }).toThrow();
  });
  it("leaves a file at the research root untouched", () => {
    const { home } = fixture();
    const root = path.join(home, "ohtia");
    fs.writeFileSync(root, "kept");
    expect(() => {
      ensureResearchRoot(root);
    }).toThrow("plain directory");
    expect(fs.readFileSync(root, "utf8")).toBe("kept");
  });
  it.runIf(process.platform !== "win32")("leaves a symlinked research root untouched", () => {
    const { home, base } = fixture();
    const root = path.join(home, "ohtia");
    const target = path.join(base, "elsewhere");
    fs.mkdirSync(target);
    fs.symlinkSync(target, root);
    expect(() => {
      ensureResearchRoot(root);
    }).toThrow("plain directory");
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(target)).toEqual([]);
  });
});

describe("development launcher", () => {
  it("refuses a checkout inside the native data before writing anything", () => {
    const { host, home } = fixture();
    const checkout = path.join(home, "ohtia", "checkout");
    fs.mkdirSync(checkout, { recursive: true });
    expect(() => developmentRootLocation(checkout, host)).toThrow("overlaps");
    expect(fs.readdirSync(checkout)).toEqual([]);
  });
  it.runIf(process.platform !== "win32")("refuses an aliased development directory", () => {
    const { host, base } = fixture();
    const checkout = path.join(base, "aliased");
    fs.mkdirSync(checkout);
    fs.symlinkSync(path.join(base, "home"), path.join(checkout, ".ohtia-dev"));
    expect(() => developmentRootLocation(checkout, host)).toThrow("alias");
  });
  it.runIf(process.platform !== "win32")("never writes through an instance link", () => {
    const { base } = fixture();
    const checkout = path.join(base, "linked");
    const target = path.join(base, "outside.json");
    fs.mkdirSync(path.join(checkout, ".ohtia-dev"), { recursive: true });
    fs.symlinkSync(target, path.join(checkout, ".ohtia-dev", "instance.json"));
    expect(() => prepareDevelopmentRoot(checkout)).toThrow();
    expect(fs.existsSync(target)).toBe(false);
  });
  it.runIf(process.platform !== "win32")(
    "keeps the temporary root short enough for the singleton socket",
    () => {
      const directory = shortTemporaryDirectory("ohtia-dev-");
      temporary.push(directory);
      expect(path.join(directory, "SingletonSocket").length).toBeLessThan(60);
    },
  );
});

describe("development executable", () => {
  it.each([
    ["linux", "electron", true],
    ["linux", "ohtia", false],
    ["linux", "Electron Helper", false],
    ["win32", "electron.exe", true],
    ["win32", "electron", false],
    ["win32", "ohtia.exe", false],
    ["darwin", "Electron", true],
    ["darwin", "Electron Helper", true],
    ["darwin", "Electron Helper (Plugin)", true],
    ["darwin", "Ohtia Helper", false],
  ])("on %s treats %s as a development runtime: %s", (platform, name, expected) => {
    expect(isDevelopmentExecutable(platform, name)).toBe(expected);
  });
});

describe("running development instance", () => {
  const lockedProfile = () => {
    const { root } = fixture();
    const profile = path.join(root, "configuration", "Ohtia");
    fs.mkdirSync(profile, { recursive: true });
    return { root, profile };
  };
  it("is absent without a lock", () => {
    expect(developmentInstanceRunning(lockedProfile().root)).toBe(false);
  });
  it.runIf(process.platform === "win32")("follows the Windows lock file", () => {
    const { root, profile } = lockedProfile();
    fs.writeFileSync(path.join(profile, "lockfile"), "");
    expect(developmentInstanceRunning(root)).toBe(true);
  });
  it.runIf(process.platform !== "win32")("follows the holder a POSIX lock names", () => {
    const { root, profile } = lockedProfile();
    const lock = path.join(profile, "SingletonLock");
    fs.symlinkSync("host-name-4242", lock);
    const named = (name: string) => (pid: number) => (pid === 4242 ? name : "");
    expect(developmentInstanceRunning(root, named("electron"))).toBe(true);
    expect(developmentInstanceRunning(root, named("firefox"))).toBe(false);
    expect(developmentInstanceRunning(root, named(""))).toBe(false);
    fs.rmSync(lock);
    fs.symlinkSync("not-a-holder", lock);
    expect(developmentInstanceRunning(root, named("electron"))).toBe(false);
  });
  it.runIf(process.platform !== "win32")("stops when it cannot identify the holder", () => {
    const { root, profile } = lockedProfile();
    fs.symlinkSync(`host-name-${process.pid}`, path.join(profile, "SingletonLock"));
    vi.stubEnv("PATH", "/nonexistent");
    try {
      expect(() => developmentInstanceRunning(root)).toThrow("cannot identify");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.runIf(process.platform !== "win32")("takes a holder that has ended for no broker", () => {
    const { root, profile } = lockedProfile();
    const ended = spawnSync(process.execPath, ["-p", "process.pid"], { encoding: "utf8" });
    expect(ended.stdout).toMatch(/^\d+\s*$/);
    fs.symlinkSync(`host-name-${ended.stdout.trim()}`, path.join(profile, "SingletonLock"));
    expect(developmentInstanceRunning(root)).toBe(false);
  });
  it("names a holder only from a successful ps result", () => {
    const result = (status: number | null, stdout: string, stderr = "", signal?: string) => ({
      status,
      stdout,
      stderr,
      signal,
    });
    expect(holderName(result(0, "electron\n"), 1)).toBe("electron");
    expect(holderName(result(0, "/runtime/Electron.app/Contents/MacOS/Electron\n"), 1)).toBe(
      "electron",
    );
    expect(holderName(result(0, "electron\n", "ld.so: ignored preload\n"), 1)).toBe("electron");
    expect(holderName(result(0, "electron <defunct>\n"), 1)).not.toBe("electron");
    expect(holderName(result(1, ""), 1)).toBe("");
    for (const unknown of [
      result(0, "", "Failure calling sysctl: Operation not permitted\n"),
      result(0, ""),
      result(null, "", "", "SIGTERM"),
      result(1, "", "ps: unknown failure\n"),
      result(1, "electron\n"),
      result(2, ""),
      { status: null, stdout: null, stderr: null },
    ])
      expect(() => holderName(unknown, 1)).toThrow("cannot identify");
  });
  it.runIf(process.platform !== "win32")("does not take a reused PID for the broker", () => {
    const { root, profile } = lockedProfile();
    fs.symlinkSync(`host-name-${process.pid}`, path.join(profile, "SingletonLock"));
    expect(developmentInstanceRunning(root)).toBe(false);
  });
});

describe("waiting for the desktop", () => {
  const desktop = () => Object.assign(new EventEmitter(), { kill: vi.fn() });
  it("accepts a clean exit", async () => {
    const child = desktop();
    const waiting = waitForDesktop(child, "/root");
    child.emit("exit", 0, null);
    await expect(waiting).resolves.toBeUndefined();
  });
  it.each([
    [1, null, "code 1"],
    [null, "SIGSEGV", "SIGSEGV"],
    [null, "SIGTERM", "SIGTERM"],
  ])("reports an unrequested end (%s, %s) with its diagnostics", async (code, signal, text) => {
    const child = desktop();
    const waiting = waitForDesktop(child, "/root");
    child.emit("exit", code, signal);
    await expect(waiting).rejects.toThrow(`Desktop exited with ${text}`);
    await expect(waiting).rejects.toThrow(path.join("/root", "research"));
  });
  it("forwards a signal sent to the launcher and treats that end as requested", async () => {
    const child = desktop();
    const listeners = process.listenerCount("SIGTERM");
    const waiting = waitForDesktop(child, "/root", "linux");
    process.emit("SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("exit", null, "SIGTERM");
    await expect(waiting).resolves.toBeUndefined();
    expect(process.listenerCount("SIGTERM")).toBe(listeners);
  });
  it("forwards only the first signal, which is the one Electron shuts down on", async () => {
    const child = desktop();
    const waiting = waitForDesktop(child, "/root", "linux");
    process.emit("SIGINT");
    process.emit("SIGINT");
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("exit", 0, null);
    await waiting;
  });
  it("leaves the window open on Windows, where a signal would end it abruptly", async () => {
    const child = desktop();
    const hangup = process.listenerCount("SIGHUP");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const waiting = waitForDesktop(child, "/root", "win32");
    expect(process.listenerCount("SIGHUP")).toBe(hangup);
    process.emit("SIGINT");
    expect(child.kill).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Close the application window to stop it.");
    log.mockRestore();
    child.emit("exit", 1, null);
    await expect(waiting).rejects.toThrow("Desktop exited with code 1");
  });
});

describe("workspace entries", () => {
  const command = (...args: string[]) =>
    spawnSync(process.execPath, ["tooling/workspace.mjs", ...args], { encoding: "utf8" });
  it.each([["dev"], ["preview"]])("refuses arguments to %s", (name) => {
    const result = command(name, "/some/runtime-profile.json");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      name === "dev" ? "development command switches only" : "without arguments",
    );
  });
  it("exposes the qualification launch through a package script", () => {
    const manifest = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["desktop:launch"]).toBe("node tooling/workspace.mjs desktop:launch");
  });
  it("keeps the qualification launch behind its profile arguments", () => {
    const result = command("desktop:launch");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("desktop:launch <absolute-runtime-profile.json>");
  });
});

describe("native session environment", () => {
  it("passes the Plasma session version that Chromium needs and no other session secrets", () => {
    vi.stubEnv("XDG_CURRENT_DESKTOP", "KDE");
    vi.stubEnv("KDE_SESSION_VERSION", "6");
    vi.stubEnv("XDG_SESSION_TYPE", "wayland");
    vi.stubEnv("WAYLAND_DISPLAY", "wayland-ohtia");
    vi.stubEnv("KDE_FULL_SESSION", "true");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "synthetic-unforwarded");
    try {
      const env = nativeEnvironment({
        home: "/home/synthetic",
        username: "synthetic",
        configurationRoot: "/home/synthetic/.config",
        scratch: "/home/synthetic/scratch",
      });
      expect(env.XDG_CURRENT_DESKTOP).toBe("KDE");
      expect(env.KDE_SESSION_VERSION).toBe("6");
      expect(env.WAYLAND_DISPLAY).toBe("wayland-ohtia");
      expect(env.KDE_FULL_SESSION).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
