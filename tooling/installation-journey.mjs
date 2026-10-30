import { synchronizeDirectory } from "./installation-filesystem.mjs";
// Controlled internal campaign. No public feed, product updater or publication authority.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import {
  parseCampaignOptions,
  resumePolicy,
  renewalCatalog,
  renewalTrust,
} from "./installation-campaign.mjs";
import {
  loadRuntimeProfile,
  readBoundedFile,
  verifyStableSentinels,
  containsPath,
} from "../packages/main/dist/index.js";
import {
  catalogBytes,
  digest,
  keyIdentity,
  nativeVersion,
  verifyCatalog,
  stagePackage,
  withAcceptanceState,
  updateLimits,
} from "./update-admission.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log(
    "Use installation-journey.mjs <runtime-profile.json> <build> <evidence> [--operator-installation] [--continue-from <completed-evidence> | --baseline <inspected-proof.json>] [--resume [--renew-catalogs]]. Linux requires an external root operator using a separately verified administrator-owned helper and the platform Python: scripts/installation_operator.py <profile> <cell.json> <staged.json> <receipt.json> [--rpm-keyring <expected-key-db> --rpm-key-id <fingerprint>]. Before any request, independently register both artifacts with the root-owned helper using --admit-artifact, --expected-sha256, --build and --expected-candidate; request files grant no administrative authority. --resume uses identical retained catalogs and refuses to replay an uncertain UI mutation. After a ceased-owner interruption, explicitly run installation_native.py reconcile-state <profile> <retained-evidence>; it preserves replay floors and partial evidence. For manual freshness or uncertain-effect recovery, run inspect-baseline on an independently selected intact archive and start a new higher-version campaign with --baseline. --renew-catalogs explicitly renews only retained unobserved package metadata, preserves old signed files and never lowers version/sequence floors. All paths and data belong to an inspected synthetic fixture.",
  );
  process.exit(0);
}
const [profileFile, buildDirectory, evidenceDirectory, ...options] = args;
const { resume, operator, continueFrom, baseline, renew } = parseCampaignOptions(options);
const profile = loadRuntimeProfile(profileFile);
verifyStableSentinels(profile);
function json(file, maximum = 8 * 1024 * 1024) {
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(readBoundedFile(file, maximum)),
  );
}
function inside(value) {
  return (
    path.isAbsolute(value) &&
    containsPath(profile.scratch_root, value) &&
    value !== profile.scratch_root
  );
}
if (
  !inside(evidenceDirectory) ||
  !path.isAbsolute(buildDirectory) ||
  fs.realpathSync.native(buildDirectory) !== buildDirectory ||
  fs.realpathSync.native(path.dirname(evidenceDirectory)) !== path.dirname(evidenceDirectory)
)
  throw new Error("Use canonical build and inspected scratch evidence paths.");
if (!resume) fs.mkdirSync(evidenceDirectory, { mode: 0o700 });
else if (fs.realpathSync.native(evidenceDirectory) !== evidenceDirectory)
  throw new Error("Invalid retained campaign.");
const cell = json(path.join(buildDirectory, "cell.json"));
if (cell.target !== profile.target)
  throw new Error("Native target differs from the inspected profile.");
if (cell.target.startsWith("linux-") && !operator)
  throw new Error("Native Linux campaigns require explicit external operator mode.");
const inputs = json(path.join(buildDirectory, "inputs.json")),
  contracts = json(path.join(buildDirectory, "contracts.json"));
if (
  !Array.isArray(contracts.versions) ||
  contracts.versions.length !== 2 ||
  !Number.isSafeInteger(contracts.target_schema) ||
  contracts.target_schema < 1
)
  throw new Error("Missing sealed build contract.");
const candidate = digest(catalogBytes({ inputs, contracts }));
const python = path.join(
  root,
  process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python",
);
function publish(file, value) {
  const temporary = file + "." + randomUUID() + ".partial";
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
  synchronizeDirectory(path.dirname(file));
}
function retain(file, bytes) {
  const descriptor = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  synchronizeDirectory(path.dirname(file));
}
let logIndex = 0;
async function run(arguments_, label, env = process.env) {
  const log = path.join(evidenceDirectory, `${label}-${Date.now()}-${logIndex++}.log`),
    descriptor = fs.openSync(log, "wx", 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(arguments_[0], arguments_.slice(1), {
        cwd: root,
        env,
        stdio: ["ignore", descriptor, descriptor],
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Internal step failed: ${label}; retain its log and fixtures.`)),
      );
    });
  } finally {
    fs.closeSync(descriptor);
  }
}
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
async function inspect(directory, label) {
  const sourceStore = process.platform === "win32" ? await snapshotStore() : null;
  const descriptorFile = path.join(evidenceDirectory, `${label}-descriptor-${randomUUID()}.json`);
  await run(
    [
      python,
      path.join(root, "scripts/installation_native.py"),
      "describe-payload",
      path.join(buildDirectory, "cell.json"),
      directory,
      descriptorFile,
    ],
    `${label}-descriptor`,
  );
  const prepared = json(descriptorFile);
  const output = path.join(evidenceDirectory, `${label}-${randomUUID()}.json`);
  await run(
    [
      path.join(directory, prepared.executable),
      path.join(root, "tooling/installation-store.cjs"),
      directory,
      profile.research_root,
      output,
      descriptorFile,
    ],
    label,
    { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  );
  if (sourceStore && !(await matchesStore(sourceStore)))
    throw new Error("Store changed during semantic Windows inspection.");
  return { ...json(output), ...(sourceStore ? { source_store: sourceStore } : {}) };
}
const files = new Map();
const server = http.createServer((request, response) => {
  const file = files.get(request.url);
  if (!file) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader("Content-Length", fs.statSync(file).size);
  const stream = fs.createReadStream(file);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const endpoint = `http://127.0.0.1:${server.address().port}/`;
const acceptance = path.join(profile.scratch_root, "update-acceptance");
const createdAcceptance = !fs.existsSync(acceptance);
if (createdAcceptance) {
  if (resume) throw new Error("Retained acceptance state is missing.");
  fs.mkdirSync(acceptance, { mode: 0o700 });
}
const fresh = !fs.existsSync(path.join(acceptance, "accepted.json"));
if (fresh && !createdAcceptance)
  throw new Error("Existing acceptance state is missing or incomplete; reconcile it explicitly.");
const trustFile = path.join(evidenceDirectory, "qualification-trust.json"),
  campaignFile = path.join(evidenceDirectory, "campaign.json");
function rootJson(file) {
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const info = fs.fstatSync(descriptor);
    if (!info.isFile() || info.uid !== 0 || info.nlink !== 1 || info.size > 65536)
      throw new Error("External operator evidence must be a bounded ordinary root-owned file.");
    return JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } finally {
    fs.closeSync(descriptor);
  }
}
async function snapshotStore() {
  const snapshot = {};
  for (const name of ["ohtia.db3", "ohtia.db3-wal", "ohtia.db3-shm", "ohtia.db3-journal"]) {
    const file = path.join(profile.research_root, name);
    if (!fs.existsSync(file)) {
      snapshot[name] = null;
      continue;
    }
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.nlink !== 1 || fs.realpathSync.native(file) !== file)
      throw new Error("Unsafe Windows store snapshot input.");
    snapshot[name] = { sha256: await hashFile(file), bytes: info.size };
  }
  return snapshot;
}
async function matchesStore(snapshot) {
  const names = ["ohtia.db3", "ohtia.db3-wal", "ohtia.db3-shm", "ohtia.db3-journal"];
  if (
    !snapshot ||
    Object.keys(snapshot).length !== names.length ||
    !names.every((name) => Object.hasOwn(snapshot, name))
  )
    return false;
  for (const name of names) {
    const file = path.join(profile.research_root, name),
      expected = snapshot[name];
    if (expected === null) {
      if (fs.existsSync(file)) return false;
      continue;
    }
    if (!fs.existsSync(file)) return false;
    const info = fs.lstatSync(file);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size !== expected.bytes ||
      fs.realpathSync.native(file) !== file ||
      (await hashFile(file)) !== expected.sha256
    )
      return false;
  }
  return true;
}
async function verifyBaseline(proof) {
  if (
    proof.cell.target !== cell.target ||
    proof.cell.profile !== cell.profile ||
    proof.cell.filesystem !== cell.filesystem ||
    (proof.home && proof.home !== profile.home) ||
    (proof.research_root && proof.research_root !== profile.research_root) ||
    !proof.store_sha256 ||
    !proof.artifact_file ||
    !proof.package?.sha256 ||
    (await hashFile(path.join(profile.research_root, "ohtia.db3"))) !== proof.store_sha256 ||
    !proof.store_files ||
    !(await matchesStore(proof.store_files)) ||
    (await hashFile(proof.artifact_file)) !== proof.package.sha256
  )
    throw new Error("The inspected baseline store, target or selected artifact changed.");
  if (
    (cell.target.startsWith("linux-") && proof.prepared_directory !== "/opt/ohtia-quality") ||
    (!cell.target.startsWith("linux-") && !inside(proof.prepared_directory)) ||
    fs.realpathSync.native(proof.prepared_directory) !== proof.prepared_directory
  )
    throw new Error("Baseline installation must remain in its canonical native fixture.");
  await run(
    [
      python,
      path.join(root, "scripts/installation_native.py"),
      "verify-payload",
      proof.artifact_file,
      path.join(buildDirectory, "cell.json"),
      proof.prepared_directory,
    ],
    "verify-baseline-payload",
  );
  const actual = await inspect(proof.prepared_directory, "verify-baseline-store");
  if (
    actual.installed_version !== proof.package.version ||
    !catalogBytes(actual.appearance).equals(catalogBytes(proof.saved))
  )
    throw new Error("Baseline executable or current preference changed.");
}
async function operatorReceipt(record, staged, attempt, repair) {
  const receipt = path.join(
    evidenceDirectory,
    `operator-ready-${attempt}-${record.admission.lease.nonce}.json`,
  );
  publish(path.join(evidenceDirectory, `operator-request-${attempt}.json`), {
    staged,
    receipt,
    attempt,
    requires_repair: repair,
    operator_entrypoint: "scripts/installation_operator.py",
    arguments: [profileFile, path.join(buildDirectory, "cell.json"), staged, receipt],
  });
  const deadline = Date.now() + updateLimits.operator_ms;
  while (!fs.existsSync(receipt)) {
    if (Date.now() >= deadline) {
      const error = new Error(
        "Operator deadline elapsed; retain the lease and verify the native transaction before explicit reconciliation and continuation.",
      );
      error.code = "operator_in_progress";
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const result = rootJson(receipt);
  if (
    result.status !== "passed" ||
    result.sha256 !== record.sha256 ||
    !catalogBytes(result.lease).equals(catalogBytes(record.admission.lease))
  )
    throw new Error("Wrong operator receipt or expired operation lease.");
}
await run(
  [
    python,
    path.join(root, "scripts/installation_native.py"),
    "lease-identity",
    String(process.pid),
  ],
  "lease-owner",
);
const ownerLogs = fs
  .readdirSync(evidenceDirectory)
  .filter((name) => name.startsWith("lease-owner-") && name.endsWith(".log"))
  .sort();
const owner = json(path.join(evidenceDirectory, ownerLogs.at(-1)));
try {
  await withAcceptanceState(
    acceptance,
    fresh,
    async (previous, persist, lease) => {
      let campaign;
      if (resume) {
        campaign = json(campaignFile);
        if (
          !catalogBytes(campaign.inputs).equals(catalogBytes(inputs)) ||
          !catalogBytes(campaign.contracts).equals(catalogBytes(contracts))
        )
          throw new Error("Retained campaign inputs changed.");
      } else {
        const keys = generateKeyPairSync("ed25519"),
          public_key = keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
          key_id = keyIdentity(public_key);
        publish(trustFile, { keys: [{ id: key_id, public_key, revoked: false }] });
        let initialDirectory = null,
          initialPrevious = null;
        if (baseline) {
          if (!inside(baseline) || fs.realpathSync.native(baseline) !== baseline)
            throw new Error("Use an inspected baseline proof inside scratch.");
          const proof = json(baseline);
          if (proof.kind !== "inspected-native-baseline")
            throw new Error("An explicit inspected baseline is required.");
          await verifyBaseline(proof);
          initialPrevious = baseline;
          initialDirectory = proof.prepared_directory;
        } else if (continueFrom) {
          if (!inside(continueFrom) || fs.realpathSync.native(continueFrom) !== continueFrom)
            throw new Error("Select retained completed evidence inside scratch.");
          const prior = json(path.join(continueFrom, "result.json"));
          if (prior.status !== "passed")
            throw new Error(
              "A new campaign requires completed prior evidence; resume incomplete work.",
            );
          const finalAttempt = prior.results.at(-1).attempt;
          initialPrevious = path.join(
            continueFrom,
            `native-${finalAttempt}/installation-result.json`,
          );
          const proof = json(initialPrevious);
          await verifyBaseline(proof);
          initialDirectory = proof.prepared_directory;
        } else if (fs.existsSync(path.join(profile.research_root, "ohtia.db3")))
          throw new Error("Do not adopt an existing store without completed evidence.");
        campaign = {
          schema_version: 1,
          inputs,
          contracts,
          cell,
          initialDirectory,
          initialPrevious,
          attempts: [],
        };
        for (let index = 0; index < 2; index++) {
          const attempt = index + 1,
            version = contracts.versions[index],
            directory = path.join(buildDirectory, `build-${attempt}/packages`),
            entries = [];
          for (const format of cell.formats) {
            const names = fs
              .readdirSync(directory)
              .filter((name) => name.endsWith(`.${format === "nsis" ? "exe" : format}`));
            if (names.length !== 1) throw new Error("Missing or ambiguous package.");
            const file = path.join(directory, names[0]),
              bytes = fs.statSync(file).size;
            if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > updateLimits.package_bytes)
              throw new Error("Package outside its byte bound.");
            entries.push({
              target: cell.target,
              profile: cell.profile,
              format,
              filename: names[0],
              bytes,
              sha256: await hashFile(file),
              native_version: ["deb", "rpm"].includes(format) ? nativeVersion(version) : version,
              schema: {
                source_min: 0,
                source_max: contracts.target_schema,
                target: contracts.target_schema,
              },
              queued_work_version: null,
            });
          }
          const issued = Date.now(),
            catalog = {
              schema_version: 1,
              key_id,
              sequence: (previous?.sequence ?? 0) + attempt,
              issued_ms: issued - 1000,
              expires_ms: issued + updateLimits.catalog_lifetime_ms - 1000,
              candidate,
              source_sha: inputs.source_sha,
              version,
              channels: ["preview"],
              notes_sha256: digest(Buffer.from("Internal qualification; no public release.\n")),
              packages: entries,
            };
          const catalogName = `catalog-${attempt}.json`,
            signatureName = `catalog-${attempt}.sig`,
            bytes = catalogBytes(catalog);
          retain(path.join(evidenceDirectory, catalogName), bytes);
          retain(path.join(evidenceDirectory, signatureName), sign(null, bytes, keys.privateKey));
          campaign.attempts.push({
            attempt,
            version,
            catalogName,
            signatureName,
            format: attempt === 1 ? cell.formats[0] : cell.formats.at(-1),
            phase: "prepared",
            destination: path.join(
              profile.scratch_root,
              `${process.platform === "win32" ? "installed Windows-" : "installed-"}${contracts.versions[0]}-${attempt}`,
            ),
          });
        }
        publish(campaignFile, campaign);
      }
      const trust = json(trustFile),
        results = [];
      for (const planned of campaign.attempts) {
        const catalog = json(path.join(evidenceDirectory, planned.catalogName));
        if (catalog.candidate !== candidate)
          throw new Error("Signed catalog differs from the sealed source/build identity.");
        for (const entry of catalog.packages) {
          const file = path.join(
            buildDirectory,
            `build-${planned.attempt}/packages`,
            entry.filename,
          );
          if (fs.statSync(file).size !== entry.bytes || (await hashFile(file)) !== entry.sha256)
            throw new Error("Retained final package bytes changed.");
          files.set(`/${entry.filename}`, file);
        }
      }
      const confirmations = new Map();
      for (const planned of campaign.attempts) {
        const file = path.join(
          evidenceDirectory,
          `native-${planned.attempt}/installation-result.json`,
        );
        if (fs.existsSync(file)) confirmations.set(planned.attempt, json(file));
      }
      const lastCatalog = json(path.join(evidenceDirectory, campaign.attempts.at(-1).catalogName));
      const policy = resumePolicy(
        campaign.attempts,
        confirmations,
        previous?.sequence ?? 0,
        lastCatalog.sequence,
      );
      if (policy.lastConfirmedAttempt !== null) {
        const confirmed = confirmations.get(policy.lastConfirmedAttempt);
        if (!confirmed.store_files || !(await matchesStore(confirmed.store_files)))
          throw new Error(
            "Stored data changed after the last confirmed effect; no mutation is replayed.",
          );
      }
      if (renew) {
        const pending = campaign.attempts.filter((item) => !confirmations.has(item.attempt));
        if (!pending.length) throw new Error("No unobserved catalog remains to renew.");
        const keys = generateKeyPairSync("ed25519"),
          nonce = randomUUID(),
          now = Date.now();
        const public_key = keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
          key_id = keyIdentity(public_key);
        let sequence = Math.max(
          previous?.sequence ?? 0,
          ...campaign.attempts.map(
            (item) => json(path.join(evidenceDirectory, item.catalogName)).sequence,
          ),
        );
        const usedKeys = new Set(
          campaign.attempts
            .filter((item) => confirmations.has(item.attempt))
            .map((item) => json(path.join(evidenceDirectory, item.catalogName)).key_id),
        );
        const renewed = [];
        for (const planned of pending) {
          const oldBytes = readBoundedFile(
              path.join(evidenceDirectory, planned.catalogName),
              updateLimits.catalog_bytes,
            ),
            old = JSON.parse(oldBytes);
          const entry = old.packages.find(
            (item) =>
              item.target === cell.target &&
              item.profile === cell.profile &&
              item.format === planned.format,
          );
          verifyCatalog(
            oldBytes,
            readBoundedFile(path.join(evidenceDirectory, planned.signatureName), 64),
            trust,
            {
              now_ms: old.issued_ms,
              execution: "internal",
              channel: "preview",
              preview_opt_in: true,
              previous: null,
              installed_version: null,
              target: cell.target,
              profile: cell.profile,
              format: planned.format,
              schema: entry?.schema.source_min,
              queued_work_version: null,
            },
          );
          const catalog = renewalCatalog(old, key_id, ++sequence, now),
            bytes = catalogBytes(catalog);
          const catalogName = `catalog-${planned.attempt}-renewed-${nonce}.json`,
            signatureName = `catalog-${planned.attempt}-renewed-${nonce}.sig`;
          retain(path.join(evidenceDirectory, catalogName), bytes);
          retain(path.join(evidenceDirectory, signatureName), sign(null, bytes, keys.privateKey));
          renewed.push({ planned, catalogName, signatureName });
        }
        retain(
          path.join(evidenceDirectory, `qualification-trust-before-${nonce}.json`),
          fs.readFileSync(trustFile),
        );
        const newKey = { id: key_id, public_key, revoked: false };
        // Both generations stay trusted until the new catalog references are durably published.
        trust.keys = renewalTrust(trust, newKey).keys;
        publish(trustFile, trust);
        for (const item of renewed) {
          item.planned.catalogName = item.catalogName;
          item.planned.signatureName = item.signatureName;
        }
        publish(campaignFile, campaign);
        usedKeys.add(key_id);
        trust.keys = renewalTrust(trust, newKey, usedKeys).keys;
        publish(trustFile, trust);
        publish(path.join(evidenceDirectory, `catalog-renewal-${nonce}.json`), {
          reason:
            "Explicit manual renewal of unchanged unobserved internal artifacts; old signed evidence retained.",
          candidate,
          renewed_attempts: pending.map((item) => item.attempt),
          sequence,
        });
      }
      let installedDirectory = campaign.initialDirectory,
        previousReceipt = campaign.initialPrevious;
      for (const planned of campaign.attempts) {
        const nativeOutput = path.join(evidenceDirectory, `native-${planned.attempt}`),
          nativeResult = path.join(nativeOutput, "installation-result.json");
        if (planned.phase === "observing" && !fs.existsSync(nativeResult))
          throw new Error(
            "Interrupted graphical mutation has an uncertain outcome; inspect retained evidence instead of replaying it.",
          );
        if (fs.existsSync(nativeResult)) {
          const confirmed = json(nativeResult);
          if (confirmed.status !== "passed" || confirmed.package.version !== planned.version)
            throw new Error(
              "Confirmed attempt or stored data changed; reconcile before continuing.",
            );
          {
            const checked = verifyCatalog(
              readBoundedFile(
                path.join(evidenceDirectory, planned.catalogName),
                updateLimits.catalog_bytes,
              ),
              readBoundedFile(path.join(evidenceDirectory, planned.signatureName), 64),
              trust,
              {
                now_ms: json(path.join(evidenceDirectory, planned.catalogName)).issued_ms,
                execution: "internal",
                channel: "preview",
                preview_opt_in: true,
                previous: null,
                installed_version: confirmed.package.version,
                target: cell.target,
                profile: cell.profile,
                format: planned.format,
                schema: contracts.target_schema,
                queued_work_version: null,
              },
            );
            if (checked.entry.sha256 !== confirmed.package.sha256)
              throw new Error("Confirmed artifact differs from retained admission.");
            if (policy.complete && planned.attempt === policy.lastConfirmedAttempt) {
              await run(
                [
                  python,
                  path.join(root, "scripts/installation_native.py"),
                  "verify-payload",
                  confirmed.artifact_file,
                  path.join(buildDirectory, "cell.json"),
                  confirmed.prepared_directory,
                ],
                "verify-completed-payload",
              );
              const actual = await inspect(confirmed.prepared_directory, "store-resumed");
              if (
                actual.schema !== contracts.target_schema ||
                actual.installed_version !== planned.version
              )
                throw new Error("Resumed installed contract changed.");
            }
          }
          installedDirectory = confirmed.prepared_directory;
          previousReceipt = nativeResult;
          planned.phase = "complete";
          publish(campaignFile, campaign);
          results.push({
            attempt: planned.attempt,
            version: planned.version,
            format: planned.format,
            status: "passed",
          });
          continue;
        }
        let current,
          repair = false;
        try {
          if ((operator || process.platform === "win32") && planned.phase === "install_requested") {
            const retainedCatalog = json(path.join(evidenceDirectory, planned.catalogName));
            const retainedEntry = retainedCatalog.packages.find(
              (item) =>
                item.target === cell.target &&
                item.profile === cell.profile &&
                item.format === planned.format,
            );
            if (
              fs.existsSync(
                path.join(
                  evidenceDirectory,
                  `${operator ? "operator" : "windows"}-pending-${retainedEntry.sha256}.json`,
                ),
              )
            )
              throw new Error(
                "Retained native transition requires its unchanged-store checkpoint.",
              );
          }
          current = installedDirectory
            ? await inspect(installedDirectory, "store-preflight")
            : {
                schema: 0,
                ...(process.platform === "win32" ? { source_store: await snapshotStore() } : {}),
                installed_version:
                  cell.target.startsWith("linux-") &&
                  fs.existsSync("/opt/ohtia-quality/resources/app/package.json")
                    ? json("/opt/ohtia-quality/resources/app/package.json").version
                    : null,
              };
          if (
            process.platform === "win32" &&
            !installedDirectory &&
            Object.values(current.source_store).some((value) => value !== null)
          )
            throw new Error("An existing Windows store requires an inspected native baseline.");
        } catch (error) {
          if ((!operator && process.platform !== "win32") || planned.phase !== "install_requested")
            throw error;
          const catalog = json(path.join(evidenceDirectory, planned.catalogName));
          const entry = catalog.packages.find(
            (item) =>
              item.target === cell.target &&
              item.profile === cell.profile &&
              item.format === planned.format,
          );
          const checkpointFile = path.join(
            evidenceDirectory,
            `${operator ? "operator" : "windows"}-pending-${entry.sha256}.json`,
          );
          if (!fs.existsSync(checkpointFile))
            throw new Error(
              operator
                ? "The installation is damaged. Have the root-owned operator publish --inspect-pending to the pending checkpoint path, then explicitly resume; do not guess schema or delete replay state."
                : "The Windows installation is damaged and has no verified unchanged-store checkpoint. Preserve the installation, data and replay state for explicit recovery.",
            );
          const checkpoint = operator ? rootJson(checkpointFile) : json(checkpointFile);
          if (
            checkpoint.kind !== "unchanged-verified-store" ||
            checkpoint.sha256 !== entry.sha256 ||
            !(await matchesStore(checkpoint.store))
          )
            throw new Error(
              "Damaged-installation store differs from its verified pre-transition checkpoint.",
            );
          current = {
            ...checkpoint.current,
            ...(process.platform === "win32" ? { source_store: checkpoint.store } : {}),
          };
          repair = true;
        }
        const bytes = readBoundedFile(
            path.join(evidenceDirectory, planned.catalogName),
            updateLimits.catalog_bytes,
          ),
          signature = readBoundedFile(path.join(evidenceDirectory, planned.signatureName), 64);
        const admitted = verifyCatalog(bytes, signature, trust, {
          now_ms: Date.now(),
          execution: "internal",
          channel: "preview",
          preview_opt_in: true,
          previous,
          installed_version: current.installed_version,
          target: cell.target,
          profile: cell.profile,
          format: planned.format,
          schema: current.schema,
          queued_work_version: null,
        });
        persist(admitted);
        previous = admitted.state;
        const staged = await stagePackage(admitted, endpoint, profile.scratch_root);
        const record = {
          ...staged,
          entry: admitted.entry,
          version: planned.version,
          migration_manifest_sha256: contracts.migration_manifest_sha256,
          admission: {
            candidate,
            lease,
            state: admitted.state,
            catalog_sha256: admitted.state.catalog_sha256,
            expires_ms: json(path.join(evidenceDirectory, planned.catalogName)).expires_ms,
            source_schema: current.schema,
            ...(process.platform === "win32" ? { source_store: current.source_store } : {}),
            installed_version: current.installed_version,
            installed_directory: installedDirectory,
          },
        };
        const stagedFile = path.join(
          evidenceDirectory,
          `staged-${planned.attempt}-${lease.nonce}.json`,
        );
        publish(stagedFile, record);
        planned.phase = "staged";
        publish(campaignFile, campaign);
        planned.phase = "install_requested";
        publish(campaignFile, campaign);
        if (operator) await operatorReceipt(record, stagedFile, planned.attempt, repair);
        else
          await run(
            [
              python,
              path.join(root, "scripts/installation_native.py"),
              process.platform === "win32" ? "prepare-windows" : "prepare-mac",
              profileFile,
              path.join(buildDirectory, "cell.json"),
              stagedFile,
              planned.destination,
              path.join(evidenceDirectory, `prepared-${planned.attempt}-${lease.nonce}.json`),
            ],
            `prepare-${planned.attempt}`,
          );
        const command = [
          python,
          path.join(root, "scripts/installation_native.py"),
          "exercise",
          profileFile,
          path.join(buildDirectory, "cell.json"),
          stagedFile,
          planned.destination,
          nativeOutput,
        ];
        command.push("--installed");
        if (previousReceipt) command.push("--previous", previousReceipt);
        planned.phase = "observing";
        publish(campaignFile, campaign);
        await run(command, `observe-${planned.attempt}`);
        const confirmed = json(nativeResult);
        installedDirectory = confirmed.prepared_directory;
        previousReceipt = nativeResult;
        const actual = await inspect(installedDirectory, `store-after-${planned.attempt}`);
        if (
          actual.schema !== contracts.target_schema ||
          actual.installed_version !== planned.version
        )
          throw new Error(
            "Actual installed store or executable differs from the admitted package.",
          );
        planned.phase = "complete";
        publish(campaignFile, campaign);
        verifyStableSentinels(profile);
        results.push({
          attempt: planned.attempt,
          version: planned.version,
          format: planned.format,
          status: "passed",
        });
      }
      publish(path.join(evidenceDirectory, "result.json"), {
        version: 1,
        status: "passed",
        cell,
        inputs,
        contracts,
        results,
        limitations: [
          "Internal ephemeral catalog identity; no official publisher identity.",
          "macOS ad-hoc execution excludes Developer ID, notarization and Gatekeeper distribution acceptance.",
          "No public feed, publication or product automatic updater is enabled.",
          "No schema transition, physical power loss or compatible executable rollback is certified by this same-schema experiment.",
        ],
      });
    },
    { owner },
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
