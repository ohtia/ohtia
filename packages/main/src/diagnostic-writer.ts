import fs from "node:fs";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import childProcess from "node:child_process";
import {
  diagnosticCatalog,
  diagnosticLimits,
  diagnosticSeverities,
  decodeDiagnosticReadRequest,
  decodeDiagnosticLine,
  diagnosticBundleFooter,
  diagnosticBundleHeader,
  diagnosticBundleRecord,
  type DiagnosticBundleSelection,
  type DiagnosticBundleScanResult,
  makeDiagnosticRecord,
  isArtifactVersion,
  type DiagnosticContinuation,
  type DiagnosticRecord,
  type DiagnosticSeverity,
} from "@ohtia/contracts";

export type DiagnosticStatus =
  | "ready"
  | "invalid_record"
  | "oversized_record"
  | "busy"
  | "unavailable"
  | "stale"
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
  readonly continuation?: DiagnosticContinuation;
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
  private readKey = randomBytes(32);
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
  private async restrict(
    file: string,
    directory: boolean,
    operation: "restrict" | "create" | "verify" = "restrict",
  ): Promise<void> {
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
    // Framework ACL APIs and SID-typed rules avoid module discovery and account-name lookup.
    const script = [
      '$ErrorActionPreference="Stop";',
      "$p=$env:OHTIA_DIAGNOSTIC_ACL_PATH;",
      "$operation=$env:OHTIA_DIAGNOSTIC_ACL_OPERATION;",
      "$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;",
      '$directory=($operation -eq "restrict") -and [System.IO.Directory]::Exists($p);',
      '$inherit=if($directory){[System.Security.AccessControl.InheritanceFlags]"ContainerInherit,ObjectInherit"}else{[System.Security.AccessControl.InheritanceFlags]::None};',
      "function Read-OhtiaAcl(){if($directory){return [System.IO.Directory]::GetAccessControl($p)}else{return [System.IO.File]::GetAccessControl($p)}};",
      "function Test-OhtiaAcl($value){$rules=@($value.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]));",
      'return ($value.AreAccessRulesProtected -and $value.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $sid.Value -and $rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $sid.Value -and $rules[0].AccessControlType -eq "Allow" -and $rules[0].FileSystemRights -eq "FullControl" -and $rules[0].InheritanceFlags -eq $inherit -and $rules[0].PropagationFlags -eq [System.Security.AccessControl.PropagationFlags]::None)};',
      '$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,"FullControl",$inherit,"None","Allow");',
      // Start with the protected ACL so no other account can acquire a read handle on the empty file.
      'if($operation -eq "create"){',
      "$security=[System.Security.AccessControl.FileSecurity]::new();",
      "$security.SetAccessRuleProtection($true,$false); $security.SetOwner($sid); $security.AddAccessRule($rule);",
      '$handle=[System.IO.FileStream]::new($p,"CreateNew","FullControl","None",4096,"None",$security);',
      'try{try{if(!(Test-OhtiaAcl ($handle.GetAccessControl()))){throw "Diagnostic ACL unavailable."}}finally{$handle.Dispose()}}catch{[System.IO.File]::Delete($p); throw};',
      "exit 0};",
      "$acl=Read-OhtiaAcl; if(Test-OhtiaAcl $acl){exit 0};",
      'if($operation -eq "verify"){exit 1};',
      "$acl.SetAccessRuleProtection($true,$false);",
      "foreach($r in @($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($r)};",
      "$acl.SetOwner($sid);",
      "$acl.AddAccessRule($rule);",
      "if($directory){[System.IO.Directory]::SetAccessControl($p,$acl)}else{[System.IO.File]::SetAccessControl($p,$acl)};",
      "$check=Read-OhtiaAcl; if(!(Test-OhtiaAcl $check)){exit 1}",
    ].join(" ");
    try {
      if (this.options.canStartPermissionHelper && !this.options.canStartPermissionHelper())
        throw new Error("Diagnostic helper capacity unavailable.");
      await new Promise<void>((resolve, reject) => {
        const child = childProcess.spawn(
          path.join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoProfile", "-NonInteractive", "-Command", script],
          {
            env: {
              ...process.env,
              OHTIA_DIAGNOSTIC_ACL_PATH: file,
              OHTIA_DIAGNOSTIC_ACL_OPERATION: operation,
            },
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
      if (operation === "restrict") this.permissionFailed = true;
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
    this.readKey = randomBytes(32);
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
          this.readKey = randomBytes(32);
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
  private continuation(slot: number, stat: fs.BigIntStats, offset: number): DiagnosticContinuation {
    // Some filesystems report change time as birth time, which changes on append.
    const identity = [slot, stat.dev, stat.ino, offset].join(":");
    return { offset, token: createHmac("sha256", this.readKey).update(identity).digest("hex") };
  }

  read(slot: number, continuation?: DiagnosticContinuation): Promise<DiagnosticPage> {
    const refused = (status: DiagnosticStatus): DiagnosticPage => ({
      ...this.reject(status),
      records: [],
      invalid: 0,
      unsupported: 0,
    });
    const request = decodeDiagnosticReadRequest({
      slot,
      ...(continuation === undefined ? {} : { continuation }),
    });
    if (!request) return Promise.resolve(refused("invalid_record"));
    return this.enqueue(() => {
      const file = path.join(this.directory, filename(request.slot));
      const cursor = request.continuation;
      const offset = cursor?.offset ?? 0;
      let fd: number;
      try {
        fd = this.open(file, fs.constants.O_RDONLY);
      } catch (error) {
        if (!missing(error)) return refused("unavailable");
        if (cursor) return refused("stale");
        return { ...this.result("ready"), records: [], invalid: 0, unsupported: 0 };
      }
      let bytes: Buffer;
      let stat: fs.BigIntStats;
      try {
        stat = fs.fstatSync(fd, { bigint: true });
        if (cursor && this.continuation(request.slot, stat, offset).token !== cursor.token)
          return refused("stale");
        if (stat.size > BigInt(diagnosticLimits.fileBytes)) return refused("invalid_record");
        const size = Number(stat.size);
        if (cursor && offset >= size) return refused("stale");
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
      if (cursor && (offset >= bytes.length || bytes[offset - 1] !== 10)) return refused("stale");
      const records: DiagnosticRecord[] = [];
      let invalid = 0;
      let unsupported = 0;
      let end = cursor?.offset ?? bytes.length;
      if (end > 0 && bytes[end - 1] !== 10) {
        // Count an incomplete tail once, then continue with the last complete record.
        invalid++;
        end = bytes.lastIndexOf(10) + 1;
      }
      for (let scanned = invalid; end > 0 && scanned < diagnosticLimits.readRecords; scanned++) {
        const newline = end - 1;
        const start = newline === 0 ? 0 : bytes.lastIndexOf(10, newline - 1) + 1;
        const decoded = decodeDiagnosticLine(bytes.subarray(start, newline));
        if (decoded.ok) records.push(decoded.value);
        else if (decoded.code === "unsupported_schema") unsupported++;
        else invalid++;
        end = start;
      }
      return {
        ...this.result("ready"),
        records,
        invalid,
        unsupported,
        ...(end > 0 ? { continuation: this.continuation(request.slot, stat, end) } : {}),
      };
    }, refused);
  }
  /** POSIX staging is created exclusively by the broker. Windows needs its ACL at creation. */
  async createBundleTemporary(file: string): Promise<boolean> {
    if (process.platform !== "win32") return false;
    if (!(await this.bundleTemporaryPermission(file, "create")))
      throw new Error("Diagnostic bundle staging unavailable.");
    return true;
  }

  verifyBundleTemporary(file: string): Promise<boolean> {
    if (process.platform !== "win32") return Promise.resolve(true);
    return this.bundleTemporaryPermission(file, "verify");
  }

  private bundleTemporaryPermission(
    file: string,
    operation: "create" | "verify",
  ): Promise<boolean> {
    return this.enqueue(
      async () => {
        try {
          await this.restrict(file, false, operation);
          return true;
        } catch {
          return false;
        }
      },
      () => false,
    );
  }

  prepareBundle(
    selection: DiagnosticBundleSelection,
    current: () => boolean,
  ): Promise<DiagnosticBundleScanResult> {
    const scannable = () => current() && !this.closing;
    return this.enqueue<DiagnosticBundleScanResult>(
      async () => {
        const header = diagnosticBundleHeader(selection);
        let length = Buffer.byteLength(header + diagnosticBundleFooter);
        const records: { observed: string; line: string }[] = [];
        let invalid = 0;
        let unsupported = 0;
        let scanned = 0;
        for (let slot = 0; slot < diagnosticLimits.files; slot++) {
          if (!(selection.slots & (1 << slot))) continue;
          if (!scannable()) return { status: "stale" };
          this.checkRoot();
          let fd: number;
          try {
            fd = this.open(path.join(this.directory, filename(slot)), fs.constants.O_RDONLY);
          } catch (error) {
            if (missing(error)) continue;
            return { status: "unavailable" };
          }
          let bytes: Buffer;
          try {
            try {
              const size = fs.fstatSync(fd).size;
              if (size > diagnosticLimits.fileBytes) return { status: "invalid_file" };
              bytes = Buffer.alloc(size);
              let count = 0;
              while (count < size) {
                const read = fs.readSync(fd, bytes, count, size - count, count);
                if (!read) return { status: "unavailable" };
                count += read;
              }
            } finally {
              fs.closeSync(fd);
            }
          } catch {
            return { status: "unavailable" };
          }

          // Scanning in slot and byte-offset order makes stable sort preserve the ties.
          for (let start = 0; start < bytes.length;) {
            if (++scanned % 128 === 0) {
              await new Promise<void>((resolve) => {
                setImmediate(resolve);
              });
              if (!scannable()) return { status: "stale" };
            }
            const end = bytes.indexOf(10, start);
            if (end < 0) {
              invalid++;
              break;
            }
            const decoded = decodeDiagnosticLine(bytes.subarray(start, end));
            start = end + 1;
            if (!decoded.ok) {
              if (decoded.code === "unsupported_schema") unsupported++;
              else invalid++;
              continue;
            }
            const observed = decoded.value.observed_timestamp;
            if (
              observed < selection.from ||
              observed > selection.through ||
              length > diagnosticLimits.bundleBytes
            )
              continue;
            const line = "    " + JSON.stringify(diagnosticBundleRecord(decoded.value));
            length += Buffer.byteLength(line) + (records.length === 0 ? 1 : 2);
            if (length <= diagnosticLimits.bundleBytes) records.push({ observed, line });
            else records.length = 0;
          }
        }
        if (length > diagnosticLimits.bundleBytes)
          return { status: "too_large", invalid, unsupported };
        records.sort((a, b) => (a.observed < b.observed ? -1 : a.observed > b.observed ? 1 : 0));
        const lines = records.map(({ line }) => line).join(",\n");
        const json = header + (lines ? lines + "\n" : "") + diagnosticBundleFooter;
        return { status: "preview", json, invalid, unsupported };
      },
      (status) => ({ status: status === "busy" ? status : "unavailable" }),
    );
  }

  deleteLogs(confirmed: unknown): Promise<DiagnosticResult & { readonly deleted: number }> {
    let deleted = 0;
    if (confirmed !== true)
      return Promise.resolve({ ...this.result("confirmation_required"), deleted });
    return this.enqueue(
      async () => {
        this.readKey = randomBytes(32);
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
