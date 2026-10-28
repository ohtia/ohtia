import fs from "node:fs";
import { promises as files } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { portLimits, type BootstrapState, type RuntimeProfile } from "@ohtia/contracts";
import { containsPath, readBoundedFile } from "./profile.js";

export interface DataLocator {
  readonly version: 1;
  readonly data_directory: string;
}
export type LocatorRead =
  | { readonly state: "located"; readonly locator: DataLocator }
  | {
      readonly state: Exclude<BootstrapState, "located" | "pending_create">;
    };
export function parseLocator(bytes: Uint8Array): LocatorRead {
  if (bytes.byteLength > portLimits.locator_bytes) return { state: "locator_invalid" };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    // JSON.parse discards duplicate keys; count the actual top-level member tokens as well.
    const keys: string[] = [];
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const character = text[i];
      if (character === '"') {
        const start = i++;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === "\\") i++;
          i++;
        }
        let next = i + 1;
        while (/\s/.test(text[next] ?? "x")) next++;
        if (depth === 1 && text[next] === ":")
          keys.push(JSON.parse(text.slice(start, i + 1)) as string);
      } else if (character === "{" || character === "[") depth++;
      else if (character === "}" || character === "]") depth--;
    }
    if (keys.length !== 2 || new Set(keys).size !== 2) return { state: "locator_invalid" };
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { state: "locator_invalid" };
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(",") !== "data_directory,version" ||
      !Number.isSafeInteger(record.version) ||
      typeof record.data_directory !== "string" ||
      !path.isAbsolute(record.data_directory) ||
      record.data_directory.includes("\0") ||
      /[\uD800-\uDFFF]/u.test(record.data_directory)
    )
      return { state: "locator_invalid" };
    if (record.version !== 1)
      return { state: (record.version as number) > 1 ? "locator_newer" : "locator_invalid" };
    return { state: "located", locator: { version: 1, data_directory: record.data_directory } };
  } catch {
    return { state: "locator_invalid" };
  }
}
/** Resolve missing leaf components without letting an existing native alias conceal overlap. */
export function canonicalProspective(value: string): string {
  if (!path.isAbsolute(value)) throw new Error("Absolute data location required.");
  try {
    return fs.realpathSync.native(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || path.dirname(value) === value)
      throw error;
    return path.join(canonicalProspective(path.dirname(value)), path.basename(value));
  }
}
export function validateDataDirectory(
  directory: string,
  settings: string,
  profile: RuntimeProfile,
): string {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== profile.research_root)
    throw new Error("Data location is outside the admitted research boundary.");
  const resolved = fs.realpathSync.native(directory);
  const fixedSettings = canonicalProspective(settings);
  if (
    resolved !== profile.research_root ||
    containsPath(resolved, fixedSettings) ||
    containsPath(fixedSettings, resolved) ||
    Object.values(profile.stable_roots).some(
      (stable) => containsPath(stable.root, resolved) || containsPath(resolved, stable.root),
    )
  )
    throw new Error("Data location is outside the admitted research boundary.");
  const stat = fs.statSync(resolved);
  const root = fs.statSync(profile.research_root);
  // The inspected research root supplies the local, unsynchronized filesystem qualification.
  if (
    !stat.isDirectory() ||
    stat.dev !== root.dev ||
    (process.platform !== "win32" && stat.uid !== root.uid)
  )
    throw new Error("Data location is not on the admitted local volume.");
  return resolved;
}
export function readLocator(settings: string, profile: RuntimeProfile): LocatorRead {
  try {
    const fixed = canonicalProspective(settings);
    if (
      !containsPath(profile.configuration_root, fixed) ||
      fixed !== path.join(profile.configuration_root, "Ohtia", "settings")
    )
      return { state: "path_rejected" };
    const record = parseLocator(readBoundedFile(path.join(fixed, "data-location.json")));
    if (record.state !== "located") return record;
    try {
      return {
        state: "located",
        locator: {
          version: 1,
          data_directory: validateDataDirectory(record.locator.data_directory, fixed, profile),
        },
      };
    } catch {
      return { state: "path_rejected" };
    }
  } catch (error) {
    if (error instanceof RangeError) return { state: "locator_invalid" };
    const code = (error as NodeJS.ErrnoException).code;
    return {
      state:
        code === "ENOENT" ? "missing" : code === "ELOOP" ? "path_rejected" : "locator_unreadable",
    };
  }
}
/** The storage owner supplies a qualified native publication adapter and store compatibility receipt. */
export interface LocatorPublicationIO {
  writeSyncedExclusive(file: string, bytes: Uint8Array): Promise<void>;
  replace(temporary: string, destination: string): Promise<void>;
  syncDirectory(directory: string): Promise<void>;
}
export const posixLocatorIO: LocatorPublicationIO = {
  async writeSyncedExclusive(file, bytes) {
    const handle = await files.open(file, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  async replace(temporary, destination) {
    await files.rename(temporary, destination);
  },
  async syncDirectory(directory) {
    // Windows requires write access on the directory handle for FlushFileBuffers.
    const handle = await files.open(directory, process.platform === "win32" ? "r+" : "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};
export type Publication = "confirmed" | "rejected" | "uncertain";
/** Serialized, failure-preserving primitive. The runtime never calls this before storage admission. */
export class LocatorPublisher {
  private active = false;
  async publish(
    settings: string,
    directory: string,
    profile: RuntimeProfile,
    validateStore: (directory: string) => Promise<boolean>,
    io: LocatorPublicationIO,
  ): Promise<Publication> {
    if (this.active) return "rejected";
    this.active = true;
    let replacing = false;
    try {
      const selected = validateDataDirectory(directory, settings, profile);
      const identity = fs.statSync(selected, { bigint: true });
      const previous = readLocator(settings, profile);
      if (previous.state !== "missing" && previous.state !== "located") return "rejected";
      if (!(await validateStore(selected))) return "rejected";
      const current = fs.statSync(selected, { bigint: true });
      if (
        validateDataDirectory(selected, settings, profile) !== selected ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino
      )
        return "rejected";
      await files.mkdir(settings, { recursive: true, mode: 0o700 });
      if (canonicalProspective(settings) !== settings) return "rejected";
      await io.syncDirectory(settings);
      await io.syncDirectory(path.dirname(settings));
      await io.syncDirectory(profile.configuration_root);
      const id = randomUUID();
      if (previous.state === "located")
        await io.writeSyncedExclusive(
          path.join(settings, `.data-location-${id}.previous`),
          readBoundedFile(path.join(settings, "data-location.json")),
        );
      const temporary = path.join(settings, `.data-location-${id}.pending`);
      const bytes = Buffer.from(JSON.stringify({ version: 1, data_directory: selected }));
      await io.writeSyncedExclusive(temporary, bytes);
      await io.syncDirectory(settings);
      replacing = true;
      await io.replace(temporary, path.join(settings, "data-location.json"));
      await io.syncDirectory(settings);
      if (!readBoundedFile(path.join(settings, "data-location.json")).equals(bytes))
        return "uncertain";
      return "confirmed";
    } catch {
      return replacing ? "uncertain" : "rejected";
    } finally {
      this.active = false;
    }
  }
}
