// Manual internal qualification only. This module enables no product updater or public feed.
import fs from "node:fs";
import path from "node:path";
import { createHash, createPublicKey, verify, randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/desktop/resource-policy.json")));
export const updateLimits = Object.freeze(
  Object.fromEntries(
    Object.entries(policy.budgets)
      .filter(([name]) => name.startsWith("update_"))
      .map(([name, item]) => {
        requireUpdate(
          Number.isSafeInteger(item.value) &&
            item.value > 0 &&
            item.permitted.minimum === item.value &&
            item.permitted.maximum === item.value,
          "policy",
        );
        return [name.slice(7), item.value];
      }),
  ),
);
const targets = JSON.parse(fs.readFileSync(path.join(root, "config/desktop/targets.json"))).targets;
const capabilities = new WeakMap();
export function requireUpdate(condition, code) {
  if (!condition) throw new Error(`Update refused: ${code}.`);
}
export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function integer(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}
function exact(value, names) {
  requireUpdate(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === names.length &&
      names.every((key) => Object.hasOwn(value, key)),
    "fields",
  );
}
function hash(value, length = 64) {
  requireUpdate(
    typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value),
    "identity",
  );
}
/** Sorted keys and a single LF make duplicates, alternate encodings and signed-byte identity unambiguous. */
export function catalogBytes(value) {
  function canonical(item) {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, canonical(item[key])]),
      );
    return item;
  }
  return Buffer.from(JSON.stringify(canonical(value)) + "\n", "utf8");
}
function decode(bytes) {
  requireUpdate(
    Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= updateLimits.catalog_bytes,
    "catalog_length",
  );
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Update refused: catalog_encoding.");
  }
  requireUpdate(catalogBytes(value).equals(bytes), "catalog_representation");
  return value;
}
/** Only the explicitly supported prerelease vocabulary has a native package mapping. */
export function versionParts(version) {
  requireUpdate(typeof version === "string" && version.length <= 96, "version");
  const match =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(dev|beta)\.([1-9][0-9]*)(?:\.([1-9][0-9]*))?)?$/.exec(
      version,
    );
  requireUpdate(
    match && (match[4] !== "dev" || match[6]) && (match[4] !== "beta" || !match[6]),
    "version",
  );
  const numbers = [match[1], match[2], match[3], match[5] ?? "0", match[6] ?? "0"].map(Number);
  requireUpdate(
    numbers.every((number) => integer(number)),
    "version",
  );
  return [
    ...numbers.slice(0, 3),
    match[4] === "beta" ? 0 : match[4] === "dev" ? 1 : 2,
    ...numbers.slice(3),
  ];
}
export function compareVersions(left, right) {
  const a = versionParts(left),
    b = versionParts(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
export function nativeVersion(version) {
  versionParts(version);
  return version.replace("-", "~") + "-1";
}
export function keyIdentity(pem) {
  const key = createPublicKey(pem);
  requireUpdate(key.asymmetricKeyType === "ed25519", "key_type");
  return digest(key.export({ type: "spki", format: "der" }));
}
function validatePackage(entry, version) {
  exact(entry, [
    "target",
    "profile",
    "format",
    "filename",
    "bytes",
    "sha256",
    "native_version",
    "schema",
    "queued_work_version",
  ]);
  const target = targets.find((item) => item.id === entry.target);
  requireUpdate(target && target.distribution_packages.includes(entry.format), "target");
  const profiles =
    target.os === "linux"
      ? target.distribution_profiles
      : target.os === "darwin"
        ? (target.required_os_majors ?? target.admitted_os_majors).map((major) => ({
            id: `macos-${major}`,
          }))
        : [{ id: "windows-11-25h2" }];
  // The native target manifest owns distribution-specific package admission.
  requireUpdate(
    Array.isArray(profiles) &&
      profiles.some(
        (item) =>
          (item.id ?? item.profile) === entry.profile &&
          (!item.package || item.package === entry.format),
      ),
    "profile",
  );
  requireUpdate(
    typeof entry.filename === "string" &&
      entry.filename.length <= 160 &&
      /^[a-zA-Z0-9][a-zA-Z0-9._~-]*$/.test(entry.filename) &&
      entry.filename.endsWith(`.${entry.format}`),
    "filename",
  );
  requireUpdate(
    integer(entry.bytes, 1) && entry.bytes <= updateLimits.package_bytes,
    "package_length",
  );
  hash(entry.sha256);
  requireUpdate(
    entry.native_version ===
      (entry.format === "deb" || entry.format === "rpm" ? nativeVersion(version) : version),
    "native_version",
  );
  exact(entry.schema, ["source_min", "source_max", "target"]);
  requireUpdate(
    Object.values(entry.schema).every((value) => integer(value)) &&
      entry.schema.source_min <= entry.schema.source_max &&
      entry.schema.target >= entry.schema.source_max,
    "schema",
  );
  requireUpdate(entry.queued_work_version === null, "queued_work");
}
export function verifyCatalog(bytes, signature, trust, context) {
  // The supplied trust root is independent operator input, never read from the endpoint/catalog.
  const catalog = decode(bytes);
  exact(catalog, [
    "schema_version",
    "key_id",
    "sequence",
    "issued_ms",
    "expires_ms",
    "candidate",
    "source_sha",
    "version",
    "channels",
    "notes_sha256",
    "packages",
  ]);
  requireUpdate(catalog.schema_version === 1 && integer(catalog.sequence, 1), "catalog_version");
  hash(catalog.key_id);
  hash(catalog.candidate);
  hash(catalog.source_sha, 40);
  hash(catalog.notes_sha256);
  requireUpdate(Array.isArray(trust.keys) && trust.keys.length > 0, "trust");
  const key = trust.keys.find((item) => item.id === catalog.key_id);
  requireUpdate(
    key && key.revoked === false && keyIdentity(key.public_key) === key.id,
    "untrusted_key",
  );
  requireUpdate(
    Buffer.isBuffer(signature) &&
      signature.length === 64 &&
      verify(null, bytes, key.public_key, signature),
    "signature",
  );
  versionParts(catalog.version);
  requireUpdate(
    integer(context.now_ms, 1) &&
      integer(catalog.issued_ms, 1) &&
      integer(catalog.expires_ms, 1) &&
      catalog.expires_ms > catalog.issued_ms &&
      catalog.expires_ms - catalog.issued_ms <= updateLimits.catalog_lifetime_ms &&
      context.now_ms >= catalog.issued_ms &&
      context.now_ms < catalog.expires_ms,
    "clock_or_expiry",
  );
  requireUpdate(
    Array.isArray(catalog.channels) &&
      catalog.channels.length > 0 &&
      catalog.channels.length <= 2 &&
      new Set(catalog.channels).size === catalog.channels.length &&
      catalog.channels.every((channel) => ["stable", "preview"].includes(channel)),
    "channels",
  );
  requireUpdate(
    !catalog.version.includes("-") || !catalog.channels.includes("stable"),
    "stable_prerelease",
  );
  requireUpdate(
    context.channel === "stable" ||
      (context.channel === "preview" && context.preview_opt_in === true),
    "preview_opt_in",
  );
  requireUpdate(catalog.channels.includes(context.channel), "channel");
  requireUpdate(context.execution === "internal", "internal_only");
  requireUpdate(
    Array.isArray(catalog.packages) &&
      catalog.packages.length > 0 &&
      catalog.packages.length <= updateLimits.catalog_packages,
    "packages",
  );
  const identities = new Set(),
    filenames = new Set();
  for (const entry of catalog.packages) {
    validatePackage(entry, catalog.version);
    const id = `${entry.target}/${entry.profile}/${entry.format}`;
    requireUpdate(!identities.has(id) && !filenames.has(entry.filename), "duplicate_package");
    identities.add(id);
    filenames.add(entry.filename);
  }
  const catalogHash = digest(bytes);
  const state = context.previous;
  if (state !== null) {
    exact(state, ["sequence", "catalog_sha256", "highest_version", "last_accepted_ms"]);
    requireUpdate(
      integer(state.sequence, 1) &&
        integer(state.last_accepted_ms, 1) &&
        context.now_ms >= state.last_accepted_ms,
      "clock_or_state",
    );
    hash(state.catalog_sha256);
    versionParts(state.highest_version);
    requireUpdate(
      catalog.sequence > state.sequence ||
        (catalog.sequence === state.sequence && state.catalog_sha256 === catalogHash),
      "replay",
    );
    requireUpdate(compareVersions(catalog.version, state.highest_version) >= 0, "downgrade");
  }
  if (context.installed_version !== null)
    requireUpdate(compareVersions(catalog.version, context.installed_version) >= 0, "downgrade");
  const entry = catalog.packages.find(
    (item) =>
      item.target === context.target &&
      item.profile === context.profile &&
      item.format === context.format,
  );
  requireUpdate(entry, "package_selection");
  requireUpdate(
    integer(context.schema) &&
      context.schema >= entry.schema.source_min &&
      context.schema <= entry.schema.source_max &&
      context.queued_work_version === entry.queued_work_version,
    "incompatible_store",
  );
  const admitted = Object.freeze({
    catalog,
    entry,
    state: {
      sequence: catalog.sequence,
      catalog_sha256: catalogHash,
      highest_version: catalog.version,
      last_accepted_ms: context.now_ms,
    },
  });
  // Preserve private immutable bytes: callers cannot change an admitted digest/path after verification.
  capabilities.set(
    admitted,
    structuredClone({ entry, expires_ms: catalog.expires_ms, state: admitted.state }),
  );
  return admitted;
}
/** Controlled endpoint only; redirects, credentials, queries and public/development feeds are refused. */
export function controlledUrl(endpoint, filename) {
  const url = new URL(endpoint);
  requireUpdate(
    url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname === "/",
    "controlled_endpoint",
  );
  return new URL(filename, url);
}
/** New staging directories are caller-owned, disjoint from the installation and data directories. */
export async function stagePackage(admitted, endpoint, parent, signal) {
  const capability = capabilities.get(admitted);
  requireUpdate(capability, "unverified_catalog");
  const { entry, expires_ms } = capability;
  requireUpdate(Date.now() < expires_ms, "expired_before_download");
  const url = controlledUrl(endpoint, entry.filename);
  requireUpdate(
    path.isAbsolute(parent) &&
      fs.realpathSync.native(parent) === parent &&
      fs.statSync(parent).isDirectory(),
    "staging_parent",
  );
  const directory = fs.mkdtempSync(path.join(parent, "ohtia-update-"));
  fs.chmodSync(directory, 0o700);
  const partial = path.join(directory, "package.partial"),
    final = path.join(directory, entry.filename);
  const descriptor = fs.openSync(partial, "wx", 0o600);
  let reader;
  try {
    const timeout = AbortSignal.timeout(updateLimits.download_ms);
    const abort = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const response = await fetch(url, {
      redirect: "error",
      signal: abort,
      headers: { "Accept-Encoding": "identity" },
    });
    requireUpdate(
      response.status === 200 && response.body && !response.headers.get("content-encoding"),
      "download_response",
    );
    const length = response.headers.get("content-length");
    requireUpdate(length === null || length === String(entry.bytes), "download_length");
    reader = response.body.getReader();
    const checksum = createHash("sha256");
    let count = 0;
    while (true) {
      abort.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      requireUpdate(count <= entry.bytes, "download_length");
      checksum.update(value);
      let written = 0;
      while (written < value.byteLength)
        written += fs.writeSync(descriptor, value, written, value.byteLength - written);
    }
    requireUpdate(
      count === entry.bytes && checksum.digest("hex") === entry.sha256,
      "download_digest",
    );
    requireUpdate(Date.now() < expires_ms, "expired_after_download");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    fs.renameSync(partial, final);
    const folder = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(folder);
    } finally {
      fs.closeSync(folder);
    }
    return { file: final, sha256: entry.sha256, bytes: count };
  } catch (error) {
    // No activation or accepted-sequence mutation occurs. Retain partial bytes for explicit inspection.
    try {
      fs.closeSync(descriptor);
    } catch {
      /* Already closed after a completed stream. */
    }
    const reason = /^Update refused: ([a-z_]+)\.$/.exec(error.message)?.[1] ?? "transport";
    const failure = new Error(
      "Update refused: staging_failed; previous installation and acceptance state unchanged.",
    );
    failure.code = reason;
    throw failure;
  } finally {
    if (reader) await reader.cancel().catch(() => {});
  }
}

export function decodeAcceptanceState(bytes) {
  const previous = decode(bytes);
  exact(previous, ["sequence", "catalog_sha256", "highest_version", "last_accepted_ms"]);
  requireUpdate(
    integer(previous.sequence, 1) && integer(previous.last_accepted_ms, 1),
    "state_file",
  );
  hash(previous.catalog_sha256);
  versionParts(previous.highest_version);
  return previous;
}

/** One admitted operation owns persistent replay state; a missing existing state is a recovery failure. */
export async function withAcceptanceState(directory, fresh, operation, leaseDetails = {}) {
  requireUpdate(
    path.isAbsolute(directory) && fs.realpathSync.native(directory) === directory,
    "state_directory",
  );
  const info = fs.statSync(directory);
  requireUpdate(
    info.isDirectory() &&
      (process.platform === "win32" ||
        (info.uid === process.getuid() && (info.mode & 0o077) === 0)),
    "state_permissions",
  );
  const lock = path.join(directory, "operation.lock"),
    stateFile = path.join(directory, "accepted.json");
  const descriptor = fs.openSync(lock, "wx", 0o600);
  let retainLease = false;
  try {
    const lease = Object.freeze({
      ...leaseDetails,
      pid: process.pid,
      nonce: randomUUID(),
      started_ms: Date.now(),
    });
    fs.writeFileSync(descriptor, JSON.stringify(lease) + "\n");
    fs.fsyncSync(descriptor);
    const exists = fs.existsSync(stateFile);
    requireUpdate(fresh === !exists, "state_initialization");
    let previous = null;
    if (exists) {
      const info = fs.lstatSync(stateFile);
      requireUpdate(
        info.isFile() &&
          info.nlink === 1 &&
          info.size <= updateLimits.catalog_bytes &&
          (process.platform === "win32" ||
            (info.uid === process.getuid() && (info.mode & 0o077) === 0)),
        "state_file",
      );
      previous = decodeAcceptanceState(fs.readFileSync(stateFile));
    }
    const persist = (admitted) => {
      requireUpdate(capabilities.has(admitted), "unverified_catalog");
      // Revalidate a copy retained at admission rather than caller-mutable public state.
      const state = capabilities.get(admitted).state;
      requireUpdate(
        !previous ||
          (state.sequence >= previous.sequence &&
            compareVersions(state.highest_version, previous.highest_version) >= 0 &&
            state.last_accepted_ms >= previous.last_accepted_ms &&
            (state.sequence !== previous.sequence ||
              state.catalog_sha256 === previous.catalog_sha256)),
        "state_regression",
      );
      try {
        const pending = path.join(directory, "accepted.partial");
        const file = fs.openSync(pending, "wx", 0o600);
        try {
          fs.writeFileSync(file, catalogBytes(state));
          fs.fsyncSync(file);
        } finally {
          fs.closeSync(file);
        }
        fs.renameSync(pending, stateFile);
        const folder = fs.openSync(directory, "r");
        try {
          fs.fsyncSync(folder);
        } finally {
          fs.closeSync(folder);
        }
      } catch (error) {
        retainLease = true;
        throw error;
      }

      previous = structuredClone(state);
    };
    try {
      return await operation(previous, persist, lease);
    } catch (error) {
      if (error.code === "operator_in_progress") retainLease = true;
      throw error;
    }
  } finally {
    fs.closeSync(descriptor);
    // Keep the already-synchronized birth identity when persistence or an external transaction is uncertain.
    if (!retainLease) fs.unlinkSync(lock);
  }
}
