import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  isAboutInformation,
  message,
  type AboutInformation,
  type CommandPlatform,
  type InterfaceLocale,
} from "@ohtia/contracts";

/** Version comes from the running app; build identity fingerprints its actual bundled inventory. */
export function readAboutInformation(
  directory: string,
  version: string,
  platform: CommandPlatform,
  architecture: string,
): AboutInformation {
  if (architecture !== "x64" && architecture !== "arm64")
    throw new Error("Unsupported About architecture.");
  const license = fs.readFileSync(path.join(directory, "licenses/Ohtia-LICENSE"), "utf8");
  const copyright = license.split("\n").find((line) => line.startsWith("Copyright (c)"));
  const notices: unknown = JSON.parse(
    fs.readFileSync(path.join(directory, "notices.json"), "utf8"),
  );
  const value = {
    product: "Ohtia",
    version,
    build: `sha256:${createHash("sha256")
      .update(fs.readFileSync(path.join(directory, "inventory.json")))
      .digest("hex")}`,
    platform,
    architecture: architecture === "x64" ? "x86-64" : "ARM64",
    copyright,
    license,
    notices,
  };
  if (!isAboutInformation(value)) throw new Error("Invalid bundled About information.");
  return value;
}
export function versionInformation(info: AboutInformation, locale: InterfaceLocale): string {
  return `${info.product}\n${message(locale, "about.version")}: ${info.version}\n${message(locale, "about.build")}: ${info.build}\n${message(locale, "about.system")}: ${message(locale, `about.platform.${info.platform}`)} · ${info.architecture}`;
}
export async function copyVersionInformation(
  info: AboutInformation,
  locale: InterfaceLocale,
  clipboard: {
    writeText(text: string): void | Promise<void>;
    readText(): string | Promise<string>;
  },
): Promise<boolean> {
  try {
    const text = versionInformation(info, locale);
    await clipboard.writeText(text);
    return (await clipboard.readText()) === text;
  } catch {
    return false;
  }
}
