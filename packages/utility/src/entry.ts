import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { admitRuntimeProfile, isIdentifier, isInterfaceLocale, portLimits } from "@ohtia/contracts";
import { createStatusService } from "./status-service.js";

/** Recheck the native context independently before even a future locator/store could be opened. */
function start(): void {
  const parent = (
    process as NodeJS.Process & {
      readonly parentPort?: {
        postMessage(message: string): void;
        on(event: "message", listener: (event: { readonly data: unknown }) => void): void;
      };
    }
  ).parentPort;
  const [profileFile, generation, locale] = process.argv.slice(2);
  if (
    !parent ||
    !profileFile ||
    !generation ||
    !isIdentifier(generation) ||
    !isInterfaceLocale(locale)
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
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count)));
  } finally {
    fs.closeSync(handle);
  }
  admitRuntimeProfile(input, {
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
    canonical: (value) => {
      if (!path.isAbsolute(value)) throw new Error("Absolute utility root required.");
      return fs.realpathSync.native(value);
    },
    owned: (value) => process.platform === "win32" || fs.statSync(value).uid === user.uid,
  });
  const service = createStatusService(generation, locale, (text) => {
    parent.postMessage(text);
  });
  parent.on("message", (event) => {
    try {
      if (event.data === JSON.stringify({ kind: "shutdown", generation })) {
        service.dispose();
        process.exit(0);
      }
      service.receive(event.data);
    } catch {
      service.dispose();
      process.exit(1);
    }
  });
  parent.postMessage(JSON.stringify({ kind: "ready", generation }));
}
try {
  start();
} catch {
  process.exit(1);
}
