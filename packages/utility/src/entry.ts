import { initializeStorage } from "./storage-lifecycle.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  suppressDiagnosticCapture,
  admitDevelopmentRoot,
  admitRuntimeProfile,
  decodeStorageNotice,
  isDevelopmentExecutable,
  isIdentifier,
  isInterfaceLocale,
  parseRuntimeArgument,
  portLimits,
} from "@ohtia/contracts";
import { DurableStore, type StorageOptions } from "./storage.js";
import { createStatusService } from "./status-service.js";

suppressDiagnosticCapture((discard) => {
  process.stdout.write = discard;
  process.stderr.write = discard;
});
process.on("uncaughtException", () => {
  process.exit(1);
});
process.on("unhandledRejection", () => {
  process.exit(1);
});

/** Recheck the native context independently before even a future locator/store could be opened. */
async function start(): Promise<void> {
  const parent = (
    process as NodeJS.Process & {
      readonly parentPort?: {
        postMessage(message: string): void;
        on(event: "message", listener: (event: { readonly data: unknown }) => void): void;
      };
    }
  ).parentPort;
  const [runtimeArgument, generation, locale, mode] = process.argv.slice(2);
  const selected = parseRuntimeArgument(runtimeArgument);
  if (
    !parent ||
    !selected ||
    !generation ||
    !isIdentifier(generation) ||
    !isInterfaceLocale(locale) ||
    !["create", "open", "retry", "restore", "blocked"].includes(mode ?? "")
  )
    throw new Error("Invalid utility context.");
  const user = os.userInfo();
  const home = fs.realpathSync.native(user.homedir);
  const contains = (a: string, b: string) => {
    const relative = path.relative(a, b);
    return (
      relative === "" ||
      (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
    );
  };
  const host = {
    username: user.username,
    home,
    researchRoot: path.join(home, "ohtia"),
    target: `${process.platform}-${process.arch}`,
    configurationRoot: path.join(
      home,
      ...(process.platform === "win32"
        ? ["AppData", "Roaming"]
        : process.platform === "darwin"
          ? ["Library", "Application Support"]
          : [".config"]),
    ),
    contains,
    canonical: (value: string) => {
      if (!path.isAbsolute(value)) throw new Error("Absolute utility root required.");
      return fs.realpathSync.native(value);
    },
    owned: (value: string) => process.platform === "win32" || fs.statSync(value).uid === user.uid,
  };
  let researchRoot = host.researchRoot;
  let assertAdmission: () => void;
  if (selected.mode === "qualification") {
    const profileFile = selected.profile;
    if (
      path.basename(profileFile) !== "runtime-profile.json" ||
      !contains(home, profileFile) ||
      fs.lstatSync(profileFile).nlink !== 1
    )
      throw new Error("Invalid utility admission location.");
    if (!path.isAbsolute(profileFile) || fs.realpathSync.native(profileFile) !== profileFile)
      throw new Error("Invalid utility admission file.");
    if (!fs.lstatSync(profileFile).isFile())
      throw new Error("A regular utility admission file is required.");
    const handle = fs.openSync(
      profileFile,
      fs.constants.O_RDONLY |
        (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK),
    );
    let input: unknown;
    try {
      if (!fs.fstatSync(handle).isFile()) throw new Error("Invalid utility admission file.");
      const bytes = Buffer.alloc(portLimits.locator_bytes + 1);
      const count = fs.readSync(handle, bytes, 0, bytes.length, 0);
      if (count > portLimits.locator_bytes) throw new Error("Oversized utility admission file.");
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count)),
      );
    } finally {
      fs.closeSync(handle);
    }
    const profile = admitRuntimeProfile(input, host);
    researchRoot = profile.research_root;
    assertAdmission = () => {
      admitRuntimeProfile(input, host);
      for (const stable of Object.values(profile.stable_roots)) {
        const file = path.join(stable.root, stable.sentinel_filename ?? ".ohtia-runtime-sentinel");
        if (
          fs.realpathSync.native(file) !== file ||
          !fs.lstatSync(file).isFile() ||
          fs.statSync(file).size > portLimits.locator_bytes ||
          createHash("sha256").update(fs.readFileSync(file)).digest("hex") !==
            stable.sentinel_sha256
        )
          throw new Error("Stable fixture changed.");
      }
    };
  } else {
    if (selected.mode === "development") {
      // Packaged bytes can carry this branch, but only an Electron development runtime enters it.
      if (!isDevelopmentExecutable(process.platform, path.basename(process.execPath)))
        throw new Error("Packaged bytes do not admit a development root.");
      const instanceFile = path.join(selected.root, "instance.json");
      const recorded = fs.lstatSync(instanceFile);
      if (
        !recorded.isFile() ||
        recorded.nlink !== 1 ||
        recorded.size > portLimits.locator_bytes ||
        fs.realpathSync.native(instanceFile) !== instanceFile
      )
        throw new Error("Invalid development instance record.");
      const instance: unknown = JSON.parse(fs.readFileSync(instanceFile, "utf8"));
      admitDevelopmentRoot(selected.root, instance, {
        home,
        researchRoot: host.researchRoot,
        nativeApplicationRoot: path.join(host.configurationRoot, "Ohtia"),
        canonical: host.canonical,
        contains,
        owned: host.owned,
      });
      researchRoot = path.join(selected.root, "research");
      for (const name of ["configuration", "research"])
        if (
          fs.lstatSync(path.join(selected.root, name), { throwIfNoEntry: false })?.isSymbolicLink()
        )
          throw new Error("Development roots admit no aliased component.");
    }
    // A blocked service opens nothing, and main reports an aliased root on explicit opening.
    assertAdmission = () => {
      if (
        mode !== "blocked" &&
        fs.existsSync(researchRoot) &&
        fs.realpathSync.native(researchRoot) !== researchRoot
      )
        throw new Error("The research root is not canonical.");
    };
  }
  assertAdmission();
  const directory = path.dirname(fileURLToPath(import.meta.url));
  let store: DurableStore | undefined;
  if (mode !== "blocked") {
    const metadata: unknown = JSON.parse(
      fs.readFileSync(path.join(directory, "storage.json"), "utf8"),
    );
    if (!metadata || typeof metadata !== "object")
      throw new Error("Missing storage artifact identity.");
    const record = metadata as {
      target: string;
      bindingSha256: string;
      engine: StorageOptions["engine"];
      runtime: Record<string, string>;
    };
    if (
      record.target !== `${process.platform}-${process.arch}` ||
      !Object.entries(record.runtime).every(([key, value]) => process.versions[key] === value)
    )
      throw new Error("Storage runtime identity mismatch.");
    store = new DurableStore({
      emitDiagnostic: (event) => {
        parent.postMessage(
          JSON.stringify({
            kind: "diagnostic",
            generation,
            event: { ...event, timestamp: new Date().toISOString() },
          }),
        );
      },
      root: researchRoot,
      binding: path.join(directory, "native/binding.node"),
      bindingSha256: record.bindingSha256,
      engine: record.engine,
      migrationDirectory: path.join(directory, "migrations"),
      release: "0.0.0",
      allowCreate: mode === "create",
      assertAdmission,
    });
  }
  const service = createStatusService(
    generation,
    locale,
    (text) => {
      parent.postMessage(text);
    },
    store,
    () => {
      process.exit(1);
    },
  );
  let stopping = false;
  const isStopping = () => stopping;
  let initialization: Promise<void> = Promise.resolve();
  parent.on("message", (event) => {
    try {
      if (event.data === JSON.stringify({ kind: "shutdown", generation })) {
        if (isStopping()) return;
        stopping = true;
        service.dispose();
        void initialization
          .then(async () => {
            await service.drain();
            await store?.close();
            assertAdmission();
            process.exit(0);
          })
          .catch(() => {
            process.exit(1);
          });
        return;
      }
      if (isStopping()) return;
      if (typeof event.data === "string" && event.data.length < portLimits.message_bytes) {
        const value: unknown = JSON.parse(event.data);
        if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          if (
            (record.kind === "activate_storage" || record.kind === "system_locale") &&
            record.generation === generation &&
            Object.keys(record).sort().join(",") === "generation,kind,locale" &&
            isInterfaceLocale(record.locale)
          ) {
            if (record.kind === "activate_storage") service.activate(record.locale);
            else service.setSystemLocale(record.locale);
            return;
          }
        }
      }
      service.receive(event.data);
    } catch {
      service.dispose();
      process.exit(1);
    }
  });
  initialization = initializeStorage(
    store,
    mode ?? "blocked",
    generation,
    (text) => {
      parent.postMessage(text);
      const notice = decodeStorageNotice(JSON.parse(text) as unknown);
      if (!notice) return;
      const event =
        notice.state === "storage_ready"
          ? { event_name: "ohtia.storage.opened" }
          : notice.state === "checkpoint_restored"
            ? { event_name: "ohtia.storage.checkpoint_restored" }
            : {
                event_name: "ohtia.storage.open_failed",
                error_code:
                  notice.state === "recovery_required"
                    ? "recovery_required"
                    : notice.state === "retry_required"
                      ? "retry_required"
                      : "storage_unavailable",
              };
      parent.postMessage(
        JSON.stringify({
          kind: "diagnostic",
          generation,
          event: { ...event, timestamp: new Date().toISOString() },
        }),
      );
    },
    isStopping,
  );
  await initialization;
}
void start().catch(() => {
  process.exit(1);
});
