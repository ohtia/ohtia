import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import {
  diagnosticCatalog,
  diagnosticLimits,
  diagnosticSeverities,
  decodeDiagnosticLine,
  makeDiagnosticRecord,
  isArtifactVersion,
  type DiagnosticRecord,
  type DiagnosticSeverity,
} from "@ohtia/contracts";

export type DiagnosticStatus =
  | "ready"
  | "invalid_record"
  | "oversized_record"
  | "busy"
  | "unavailable"
  | "closed"
  | "confirmation_required";
export interface DiagnosticResult {
  readonly ok: boolean;
  readonly status: DiagnosticStatus;
}
export interface DiagnosticPage extends DiagnosticResult {
  readonly records: readonly DiagnosticRecord[];
  readonly invalid: number;
  readonly unsupported: number;
  readonly nextOffset?: number;
}
export interface DiagnosticWriterOptions {
  readonly root: string;
  readonly version: string;
  /** Recheck the admitted data root/profile; failure must precede any log I/O. */
  readonly assertAdmission: () => void;
  readonly threshold?: DiagnosticSeverity;
  readonly now?: () => string;
  readonly canStartPermissionHelper?: () => boolean;
}
const writers = new Set<string>();
const filename = (slot: number) => (slot === 0 ? "ohtia.jsonl" : `ohtia.${String(slot)}.jsonl`);
function missing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
/** No child receives this class or a file handle. The broker lock owns cross-process exclusion. */
export class DiagnosticWriter {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private initialized = false;
  private permissionFailed = false;
  private helperCount = 0;
  private cancelPermission: (() => void) | undefined;
  private closing = false;
  private readonly directory: string;
  private identity: { dev: number; ino: number } | undefined;
  private currentStatus: DiagnosticStatus = "ready";
  private rejected = 0;
  private readonly owns: boolean;
  constructor(private readonly options: DiagnosticWriterOptions) {
    this.directory = path.join(options.root, "logs");
    this.owns = !writers.has(this.directory) && isArtifactVersion(options.version);
    if (this.owns) writers.add(this.directory);
    else this.currentStatus = "unavailable";
  }
  get reservedPermissionProcesses(): number {
    return this.helperCount;
  }
  get status() {
    return { status: this.currentStatus, rejected: this.rejected };
  }
  catalog() {
    return diagnosticCatalog;
  }
  private result(status: DiagnosticStatus): DiagnosticResult {
    return { ok: status === "ready", status };
  }
  private reject(status: DiagnosticStatus): DiagnosticResult {
    this.rejected = Math.min(Number.MAX_SAFE_INTEGER, this.rejected + 1);
    this.currentStatus = status;
    return this.result(status);
  }
  /** The complete queue is count-bounded; closures retain only validated bounded records. */
  private enqueue<T>(
    action: () => T | Promise<T>,
    refused: (status: DiagnosticStatus) => T,
    retryPermissions = false,
  ): Promise<T> {
    if (this.closing) return Promise.resolve(refused("closed"));
    if (!this.owns) return Promise.resolve(refused("unavailable"));
    if (this.pending >= diagnosticLimits.pending) return Promise.resolve(refused("busy"));
    this.pending++;
    const operation = this.tail.then(async () => {
      try {
        if (this.closing) return refused("closed");
        if (this.permissionFailed && !retryPermissions) return refused("unavailable");
        if (retryPermissions) this.permissionFailed = false;
        this.checkRoot();
        if (!this.initialized) await this.initialize();
        this.checkRoot();
        const result = await action();
        return result;
      } catch {
        this.initialized = false;
        return refused("unavailable");
      } finally {
        this.pending--;
      }
    });
    this.tail = operation;
    return operation;
  }
  private checkRoot(): void {
    this.options.assertAdmission();
    const root = this.options.root;
    if (
      !path.isAbsolute(root) ||
      fs.realpathSync.native(root) !== root ||
      !fs.lstatSync(root).isDirectory()
    )
      throw new Error("Diagnostic root refused.");
    if (process.platform !== "win32" && fs.statSync(root).uid !== process.getuid?.())
      throw new Error("Diagnostic root owner refused.");
    if (this.identity) {
      const stat = fs.lstatSync(this.directory);
      if (
        !stat.isDirectory() ||
        fs.realpathSync.native(this.directory) !== this.directory ||
        stat.dev !== this.identity.dev ||
        stat.ino !== this.identity.ino
      )
        throw new Error("Diagnostic directory identity changed.");
    }
  }
  private async restrict(file: string, directory: boolean): Promise<void> {
    if (this.closing) throw new Error("Diagnostic writer closed.");
    if (process.platform !== "win32") {
      const stat = fs.lstatSync(file);
      if (stat.uid !== process.getuid?.()) throw new Error("Diagnostic owner refused.");
      fs.chmodSync(file, directory ? 0o700 : 0o600);
      if ((fs.statSync(file).mode & 0o777) !== (directory ? 0o700 : 0o600))
        throw new Error("Diagnostic permissions refused.");
      return;
    }
    // Fixed native executable and script; the path travels as data, never executable text.
    const system = process.env.SystemRoot;
    if (!system || !path.isAbsolute(system)) throw new Error("Native ACL tool unavailable.");
    const script =
      '$ErrorActionPreference="Stop"; $p=$env:OHTIA_DIAGNOSTIC_ACL_PATH; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $inherit=if(Test-Path -LiteralPath $p -PathType Container){[System.Security.AccessControl.InheritanceFlags]"ContainerInherit,ObjectInherit"}else{[System.Security.AccessControl.InheritanceFlags]::None}; function Test-OhtiaAcl($value){return ($value.AreAccessRulesProtected -and $value.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $sid.Value -and $value.Access.Count -eq 1 -and $value.Access[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $sid.Value -and $value.Access[0].AccessControlType -eq "Allow" -and $value.Access[0].FileSystemRights -eq "FullControl" -and $value.Access[0].InheritanceFlags -eq $inherit -and $value.Access[0].PropagationFlags -eq [System.Security.AccessControl.PropagationFlags]::None)}; $acl=Get-Acl -LiteralPath $p; if(Test-OhtiaAcl $acl){exit 0}; $acl.SetAccessRuleProtection($true,$false); foreach($r in @($acl.Access)){$acl.RemoveAccessRuleSpecific($r)}; $acl.SetOwner($sid); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,"FullControl",$inherit,"None","Allow"); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $p -AclObject $acl; $check=Get-Acl -LiteralPath $p; if(!(Test-OhtiaAcl $check)){exit 1}';
    try {
      if (this.options.canStartPermissionHelper && !this.options.canStartPermissionHelper())
        throw new Error("Diagnostic helper capacity unavailable.");
      await new Promise<void>((resolve, reject) => {
        const child = childProcess.spawn(
          path.join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoProfile", "-NonInteractive", "-Command", script],
          {
            env: { ...process.env, OHTIA_DIAGNOSTIC_ACL_PATH: file },
            stdio: "ignore",
            timeout: 15000,
            windowsHide: true,
          },
        );
        this.helperCount = diagnosticLimits.permissionProcesses;
        this.cancelPermission = () => {
          child.kill();
        };
        let failed = false;
        child.on("error", () => {
          failed = true;
        });
        child.once("close", (code) => {
          this.helperCount = 0;
          this.cancelPermission = undefined;
          if (code === 0 && !failed && !this.closing) resolve();
          else reject(new Error("Diagnostic ACL unavailable."));
        });
      });
    } catch {
      this.permissionFailed = true;
      throw new Error("Diagnostic ACL unavailable.");
    }
  }

  private stat(file: string) {
    const stat = fs.lstatSync(file);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      fs.realpathSync.native(file) !== file ||
      (process.platform !== "win32" && stat.uid !== process.getuid?.())
    )
      throw new Error("Managed diagnostic file refused.");
    return stat;
  }
  private open(file: string, flags: number): number {
    const before = this.stat(file);
    const fd = fs.openSync(
      file,
      flags |
        (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK),
    );
    const after = fs.fstatSync(fd);
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      after.dev !== before.dev ||
      after.ino !== before.ino
    ) {
      fs.closeSync(fd);
      throw new Error("Managed diagnostic file changed.");
    }
    return fd;
  }
  private async createActive(): Promise<void> {
    const file = path.join(this.directory, filename(0));
    const fd = fs.openSync(
      file,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      0o600,
    );
    fs.closeSync(fd);
    await this.restrict(file, false);
    this.checkRoot();
  }
  private remove(file: string): boolean {
    try {
      this.stat(file);
      fs.unlinkSync(file);
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }
  private async initialize(): Promise<void> {
    try {
      fs.mkdirSync(this.directory, { mode: 0o700 });
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST")
        throw error;
    }
    const stat = fs.lstatSync(this.directory);
    if (!stat.isDirectory() || fs.realpathSync.native(this.directory) !== this.directory)
      throw new Error("Diagnostic directory refused.");
    this.identity = { dev: stat.dev, ino: stat.ino };
    await this.restrict(this.directory, true);
    this.checkRoot();
    // Only known managed names are reconciled; unrelated files are never read/deleted.
    const dir = fs.opendirSync(this.directory);
    try {
      let entry: fs.Dirent | null;
      while ((entry = dir.readSync())) {
        if (!/^ohtia\.\d+\.jsonl$/.test(entry.name)) continue;
        const managedName = entry.name;
        if (![1, 2, 3, 4].some((slot) => filename(slot) === managedName))
          this.remove(path.join(this.directory, entry.name));
      }
    } finally {
      dir.closeSync();
    }
    for (let slot = 0; slot < diagnosticLimits.files; slot++) {
      const file = path.join(this.directory, filename(slot));
      try {
        this.stat(file);
        await this.restrict(file, false);
        this.checkRoot();
        const fd = this.open(file, fs.constants.O_RDWR);
        try {
          const size = Math.min(fs.fstatSync(fd).size, diagnosticLimits.fileBytes);
          const bytes = Buffer.alloc(size);
          let count = 0;
          while (count < size) {
            const read = fs.readSync(fd, bytes, count, size - count, count);
            if (!read) break;
            count += read;
          }
          const end = bytes.subarray(0, count).lastIndexOf(10) + 1;
          if (fs.fstatSync(fd).size !== end) fs.ftruncateSync(fd, end);
        } finally {
          fs.closeSync(fd);
        }
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    if (!fs.existsSync(path.join(this.directory, filename(0)))) await this.createActive();
    this.initialized = true;
  }
  initializeLogs(): Promise<DiagnosticResult> {
    return this.enqueue(
      () => {
        this.currentStatus = "ready";
        return this.result("ready");
      },
      (status) => this.reject(status),
      true,
    );
  }
  append(input: unknown, correlation?: string): Promise<DiagnosticResult> {
    let record: DiagnosticRecord | undefined;
    try {
      record = makeDiagnosticRecord(
        input,
        this.options.version,
        (this.options.now ?? (() => new Date().toISOString()))(),
        correlation,
      );
    } catch {
      /* Never stringify an exception. */
    }
    if (!record) return Promise.resolve(this.reject("invalid_record"));
    const bytes = Buffer.from(JSON.stringify(record) + "\n", "utf8");
    if (bytes.length > diagnosticLimits.recordBytes || bytes.length > diagnosticLimits.fileBytes)
      return Promise.resolve(this.reject("oversized_record"));
    if (record.severity_number < diagnosticSeverities[this.options.threshold ?? "INFO"])
      return Promise.resolve(this.result("ready"));
    return this.enqueue(
      async () => {
        const active = path.join(this.directory, filename(0));
        if (this.stat(active).size + bytes.length > diagnosticLimits.fileBytes) {
          this.remove(path.join(this.directory, filename(4)));
          for (let slot = 3; slot >= 0; slot--) {
            const from = path.join(this.directory, filename(slot));
            try {
              this.stat(from);
              fs.renameSync(from, path.join(this.directory, filename(slot + 1)));
            } catch (error) {
              if (!missing(error)) throw error;
            }
          }
          await this.createActive();
        }
        const fd = this.open(active, fs.constants.O_WRONLY | fs.constants.O_APPEND);
        try {
          let count = 0;
          while (count < bytes.length) {
            const written = fs.writeSync(fd, bytes, count, bytes.length - count);
            if (!written) throw new Error("Diagnostic append interrupted.");
            count += written;
          }
        } finally {
          fs.closeSync(fd);
        }
        this.currentStatus = "ready";
        return this.result("ready");
      },
      (status) => this.reject(status),
    );
  }
  /** Named slots and byte offsets, never paths or raw payloads. Reads are bounded pages. */
  read(slot: number, offset = 0): Promise<DiagnosticPage> {
    const refused = (status: DiagnosticStatus): DiagnosticPage => ({
      ...this.reject(status),
      records: [],
      invalid: 0,
      unsupported: 0,
    });
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= diagnosticLimits.files ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > diagnosticLimits.fileBytes
    )
      return Promise.resolve(refused("invalid_record"));
    return this.enqueue(() => {
      const file = path.join(this.directory, filename(slot));
      if (!fs.existsSync(file))
        return { ...this.result("ready"), records: [], invalid: 0, unsupported: 0 };
      const fd = this.open(file, fs.constants.O_RDONLY);
      let bytes: Buffer;
      try {
        const size = fs.fstatSync(fd).size;
        if (size > diagnosticLimits.fileBytes || offset > size) return refused("invalid_record");
        bytes = Buffer.alloc(size);
        let count = 0;
        while (count < size) {
          const read = fs.readSync(fd, bytes, count, size - count, count);
          if (!read) break;
          count += read;
        }
        bytes = bytes.subarray(0, count);
      } finally {
        fs.closeSync(fd);
      }
      if (offset > 0 && bytes[offset - 1] !== 10) return refused("invalid_record");
      const records: DiagnosticRecord[] = [];
      let invalid = 0,
        unsupported = 0,
        scanned = 0,
        start = offset;
      while (start < bytes.length && scanned < diagnosticLimits.readRecords) {
        const end = bytes.indexOf(10, start);
        if (end < 0) {
          invalid++;
          start = bytes.length;
          break;
        }
        const decoded = decodeDiagnosticLine(bytes.subarray(start, end));
        if (decoded.ok) records.push(decoded.value);
        else if (decoded.code === "unsupported_schema") unsupported++;
        else invalid++;
        start = end + 1;
        scanned++;
      }
      return {
        ...this.result("ready"),
        records,
        invalid,
        unsupported,
        ...(start < bytes.length ? { nextOffset: start } : {}),
      };
    }, refused);
  }
  deleteLogs(confirmed: unknown): Promise<DiagnosticResult & { readonly deleted: number }> {
    let deleted = 0;
    if (confirmed !== true)
      return Promise.resolve({ ...this.result("confirmation_required"), deleted });
    return this.enqueue(
      async () => {
        for (let slot = 0; slot < diagnosticLimits.files; slot++)
          if (this.remove(path.join(this.directory, filename(slot)))) deleted++;
        await this.createActive();
        this.currentStatus = "ready";
        return { ...this.result("ready"), deleted };
      },
      (status) => ({ ...this.reject(status), deleted }),
    );
  }
  async close(): Promise<void> {
    if (this.closing) {
      await this.tail;
      return;
    }
    this.closing = true;
    try {
      this.cancelPermission?.();
    } catch {
      /* The helper timeout still bounds a denied cancellation. */
    }
    await this.tail;
    if (this.owns) writers.delete(this.directory);
    this.currentStatus = "closed";
  }
}
