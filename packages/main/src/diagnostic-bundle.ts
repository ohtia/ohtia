import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  DiagnosticBundlePreview,
  DiagnosticBundleResult,
  DiagnosticBundleScanResult,
} from "@ohtia/contracts";
import { containsPath } from "./profile.js";
import { canonicalProspective } from "./locator.js";

interface Preview<Owner> {
  readonly owner: Owner;
  readonly id: string;
  readonly admitted: () => boolean;
  snapshot?: DiagnosticBundlePreview;
}

interface BundleDestination {
  readonly protectedRoots: readonly string[];
  readonly createTemporary: (file: string) => Promise<boolean>;
  readonly verifyTemporary: (file: string) => Promise<boolean>;
}

/** One preview and one native picker/write per application. */
export class DiagnosticBundleFlow<Owner> {
  private preview: Preview<Owner> | undefined;
  private preparing = false;
  private saving = false;
  private writing: ReturnType<typeof writeBundle> | undefined;

  async drain(): Promise<void> {
    // An unanswered picker has no filesystem effect and must not delay exit.
    await this.writing?.catch(() => {});
  }

  discard(owner: Owner, id?: string): DiagnosticBundleResult {
    const preview = this.preview;
    if (!preview || preview.owner !== owner || (id !== undefined && preview.id !== id))
      return { status: "stale" };
    delete preview.snapshot;
    this.preview = undefined;
    return { status: "cancelled" };
  }

  async prepare(
    owner: Owner,
    id: string,
    admitted: () => boolean,
    scan: (current: () => boolean) => Promise<DiagnosticBundleScanResult>,
  ): Promise<DiagnosticBundleResult> {
    if (this.preparing || (this.preview && this.preview.owner !== owner)) return { status: "busy" };
    this.discard(owner);
    const preview: Preview<Owner> = { owner, id, admitted };
    this.preview = preview;
    this.preparing = true;
    const current = () => this.preview === preview && admitted();
    try {
      const result = await scan(current);
      if (!current()) return { status: "stale" };
      if (result.status !== "preview") return result;
      const snapshot = Object.freeze({ ...result, token: randomUUID() });
      preview.snapshot = snapshot;
      return snapshot;
    } catch {
      return { status: "unavailable" };
    } finally {
      if (this.preview === preview && !preview.snapshot) this.discard(owner, id);
      this.preparing = false;
    }
  }

  async save(
    owner: Owner,
    token: string,
    pick: () => Promise<string | undefined>,
    options: BundleDestination,
  ): Promise<DiagnosticBundleResult> {
    const preview = this.preview;
    if (
      !preview?.snapshot ||
      preview.owner !== owner ||
      preview.snapshot.token !== token ||
      !preview.admitted()
    )
      return { status: "stale" };
    if (this.saving) return { status: "busy" };
    this.saving = true;
    const current = () => this.preview === preview && preview.admitted();
    try {
      const destination = await pick();
      if (!current()) return { status: "stale" };
      if (destination === undefined) return { status: "cancelled" };
      this.writing = writeBundle(destination, preview.snapshot.json, current, options);
      return { status: await this.writing };
    } catch {
      return { status: "unavailable" };
    } finally {
      if (this.preview === preview) this.discard(owner, preview.id);
      this.writing = undefined;
      this.saving = false;
    }
  }
}

function identity(stat: fs.BigIntStats): string {
  return `${String(stat.dev)}:${String(stat.ino)}`;
}

function destinationIdentity(file: string): string | undefined {
  try {
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || fs.realpathSync.native(file) !== file)
      throw new Error("Bundle destination refused.");
    return identity(stat);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function writeBundle(
  selected: string,
  json: string,
  current: () => boolean,
  { protectedRoots, createTemporary, verifyTemporary }: BundleDestination,
): Promise<"saved" | "stale" | "unavailable" | "uncertain"> {
  if (!path.isAbsolute(selected)) return "unavailable";
  const directory = fs.realpathSync.native(path.dirname(selected));
  const name = path.basename(selected);
  if (
    !name ||
    name === "." ||
    name === ".." ||
    (process.platform === "win32" && (!/^[a-z]:/i.test(directory) || /[:. ]$|:/.test(name))) ||
    protectedRoots.some((root) => containsPath(canonicalProspective(root), directory))
  )
    return "unavailable";
  const directoryIdentity = identity(fs.statSync(directory, { bigint: true }));
  const destination = path.join(directory, name);
  const original = destinationIdentity(destination);
  const temporary = path.join(directory, `.ohtia-diagnostics-${randomUUID()}.pending`);

  // Exclusive staging and an atomic same-directory replacement preserve the selected file on failure.
  let staged: string | undefined;
  let result: "saved" | "stale" | "unavailable" | "uncertain" = "unavailable";
  try {
    if (await createTemporary(temporary)) {
      staged = destinationIdentity(temporary);
      if (!staged) throw new Error("Bundle staging is missing.");
    }
    const handle = await fs.promises.open(temporary, staged ? "r+" : "wx", 0o600);
    try {
      const stat = await handle.stat({ bigint: true });
      const fileIdentity = identity(stat);
      if (staged && staged !== fileIdentity) throw new Error("Bundle staging changed.");
      staged = fileIdentity;
      if (stat.size !== 0n) throw new Error("Bundle staging is not empty.");
      if (
        !current() ||
        destinationIdentity(temporary) !== staged ||
        !(await verifyTemporary(temporary)) ||
        !current() ||
        destinationIdentity(temporary) !== staged
      )
        throw new Error("Bundle staging refused.");
      await handle.writeFile(json, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!current()) result = "stale";
    else if (
      fs.realpathSync.native(directory) === directory &&
      identity(fs.statSync(directory, { bigint: true })) === directoryIdentity &&
      destinationIdentity(destination) === original &&
      destinationIdentity(temporary) === staged
    ) {
      // No async boundary between the final revocation check and the commit.
      fs.renameSync(temporary, destination);
      result = "saved";
    }
  } catch {
    // Filesystem errors never cross the bridge.
    if (!current()) result = "stale";
  } finally {
    if (result !== "saved") {
      try {
        const remaining = destinationIdentity(temporary);
        if (remaining && remaining === staged) fs.unlinkSync(temporary);
        else if (remaining) result = "uncertain";
      } catch {
        result = "uncertain";
      }
    }
  }
  return result;
}
