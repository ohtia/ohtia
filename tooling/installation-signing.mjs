// Offline public-key preparation and admission for externally signed internal campaigns.
import fs from "node:fs";
import path from "node:path";
import { createHash, createPublicKey } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  catalogBytes,
  compareVersions,
  digest,
  keyIdentity,
  nativeVersion,
  updateLimits,
  verifyCatalog,
} from "./update-admission.mjs";
import { synchronizeDirectory } from "./installation-filesystem.mjs";

function requireSigning(condition, message) {
  if (!condition) throw new Error(`External signing refused: ${message}.`);
}
function canonicalDirectory(directory) {
  requireSigning(
    path.isAbsolute(directory) &&
      fs.realpathSync.native(directory) === directory &&
      fs.statSync(directory).isDirectory(),
    "use a canonical absolute directory",
  );
}
function openRegular(file, maximum) {
  requireSigning(path.isAbsolute(file), "use an absolute file path");
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
  );
  try {
    const info = fs.fstatSync(descriptor);
    requireSigning(
      info.isFile() &&
        info.nlink === 1 &&
        info.size > 0 &&
        info.size <= maximum &&
        fs.realpathSync.native(file) === file,
      "use a bounded ordinary file with one link",
    );
    return { descriptor, info };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}
function unchanged(descriptor, info) {
  const actual = fs.fstatSync(descriptor);
  requireSigning(
    actual.size === info.size && actual.mtimeMs === info.mtimeMs && actual.ctimeMs === info.ctimeMs,
    "input changed while being read",
  );
}
function readBounded(file, maximum) {
  const { descriptor, info } = openRegular(file, maximum);
  try {
    const bytes = Buffer.alloc(info.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(descriptor, bytes, count, bytes.length - count, null);
      if (read === 0) break;
      count += read;
    }
    requireSigning(count === info.size, "input length changed");
    unchanged(descriptor, info);
    return bytes.subarray(0, count);
  } finally {
    fs.closeSync(descriptor);
  }
}
function json(file, canonical = false, maximum = 8 * 1024 * 1024) {
  const bytes = readBounded(file, maximum);
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  requireSigning(!canonical || catalogBytes(value).equals(bytes), "noncanonical request");
  return { value, bytes };
}
function publicTrust(file, expectedId) {
  requireSigning(
    /^[a-f0-9]{64}$/.test(expectedId),
    "an independent public-key fingerprint is required",
  );
  const pem = new TextDecoder("utf-8", { fatal: true })
    .decode(readBounded(file, updateLimits.catalog_bytes))
    .replaceAll("\r\n", "\n")
    .trim();
  requireSigning(
    /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----$/.test(pem),
    "supply only a public SPKI PEM",
  );
  requireSigning(
    keyIdentity(pem) === expectedId,
    "public key differs from the independent fingerprint",
  );
  const public_key = createPublicKey(pem).export({ type: "spki", format: "pem" }).toString();
  return { keys: [{ id: expectedId, public_key, revoked: false }] };
}
async function packageInfo(file) {
  const { descriptor, info } = openRegular(file, updateLimits.package_bytes);
  try {
    const hash = createHash("sha256");
    let count = 0;
    for await (const bytes of fs.createReadStream(null, { fd: descriptor, autoClose: false })) {
      count += bytes.length;
      requireSigning(count <= info.size, "package grew while being hashed");
      hash.update(bytes);
    }
    requireSigning(count === info.size, "package length changed");
    unchanged(descriptor, info);
    return { bytes: count, sha256: hash.digest("hex") };
  } finally {
    fs.closeSync(descriptor);
  }
}
async function signingBuild(buildDirectory) {
  canonicalDirectory(buildDirectory);
  const cell = json(path.join(buildDirectory, "cell.json")).value;
  const inputs = json(path.join(buildDirectory, "inputs.json")).value;
  const contracts = json(path.join(buildDirectory, "contracts.json")).value;
  requireSigning(
    /^[a-f0-9]{40}$/.test(inputs.source_sha) &&
      Array.isArray(contracts.versions) &&
      contracts.versions.length === 2 &&
      Number.isSafeInteger(contracts.target_schema) &&
      contracts.target_schema > 0 &&
      /^[a-f0-9]{64}$/.test(contracts.migration_manifest_sha256) &&
      Array.isArray(cell.formats) &&
      cell.formats.length > 0 &&
      cell.formats.length <= updateLimits.catalog_packages &&
      new Set(cell.formats).size === cell.formats.length &&
      cell.formats.every((format) => ["deb", "rpm", "dmg", "zip", "nsis"].includes(format)),
    "invalid sealed build contract",
  );
  requireSigning(compareVersions(...contracts.versions) < 0, "versions must increase");
  const attempts = [];
  const filenames = new Set();
  for (let index = 0; index < contracts.versions.length; index++) {
    const attempt = index + 1;
    const version = contracts.versions[index];
    const directory = path.join(buildDirectory, `build-${attempt}/packages`);
    canonicalDirectory(directory);
    const names = fs.readdirSync(directory);
    requireSigning(names.length <= updateLimits.archive_entries, "too many package files");
    const packages = [];
    for (const format of cell.formats) {
      const matches = names.filter((name) =>
        name.endsWith(`.${format === "nsis" ? "exe" : format}`),
      );
      requireSigning(matches.length === 1, "missing or ambiguous final package");
      const filename = matches[0];
      requireSigning(
        filename.length <= 160 &&
          /^[a-zA-Z0-9][a-zA-Z0-9._~-]*$/.test(filename) &&
          !filenames.has(filename),
        "unsafe or repeated package filename",
      );
      filenames.add(filename);
      packages.push({
        target: cell.target,
        profile: cell.profile,
        format,
        filename,
        ...(await packageInfo(path.join(directory, filename))),
        native_version: ["deb", "rpm"].includes(format) ? nativeVersion(version) : version,
        schema: {
          source_min: 0,
          source_max: contracts.target_schema,
          target: contracts.target_schema,
        },
        queued_work_version: null,
      });
    }
    attempts.push({ attempt, version, packages });
  }
  return {
    cell,
    inputs,
    contracts,
    candidate: digest(catalogBytes({ inputs, contracts })),
    attempts,
  };
}
function validSequence(sequence) {
  return Number.isSafeInteger(sequence) && sequence >= 1 && Number.isSafeInteger(sequence + 1);
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

export async function prepareSigningRequest(
  buildDirectory,
  outputDirectory,
  publicKeyFile,
  expectedId,
  firstSequence,
  now = Date.now(),
) {
  publicTrust(publicKeyFile, expectedId);
  const build = await signingBuild(buildDirectory);
  requireSigning(validSequence(firstSequence), "invalid first catalog sequence");
  requireSigning(
    Number.isSafeInteger(now) &&
      now > 1000 &&
      Number.isSafeInteger(now + updateLimits.catalog_lifetime_ms),
    "invalid catalog clock",
  );
  requireSigning(path.isAbsolute(outputDirectory), "use an absolute request directory");
  canonicalDirectory(path.dirname(outputDirectory));
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  const request = {
    schema_version: 1,
    candidate: build.candidate,
    key_id: expectedId,
    first_sequence: firstSequence,
  };
  for (const item of build.attempts) {
    const catalog = {
      schema_version: 1,
      key_id: expectedId,
      sequence: firstSequence + item.attempt - 1,
      issued_ms: now - 1000,
      expires_ms: now - 1000 + updateLimits.catalog_lifetime_ms,
      candidate: build.candidate,
      source_sha: build.inputs.source_sha,
      version: item.version,
      channels: ["preview"],
      notes_sha256: digest(Buffer.from("Internal qualification; no public release.\n")),
      packages: item.packages,
    };
    retain(path.join(outputDirectory, `catalog-${item.attempt}.json`), catalogBytes(catalog));
  }
  retain(path.join(outputDirectory, "request.json"), catalogBytes(request));
  return {
    directory: outputDirectory,
    key_id: expectedId,
    candidate: build.candidate,
    first_sequence: firstSequence,
  };
}

export async function loadSignedCatalogs(
  buildDirectory,
  requestDirectory,
  publicKeyFile,
  expectedId,
  { allowExpired = false, now = Date.now() } = {},
) {
  const trust = publicTrust(publicKeyFile, expectedId);
  const build = await signingBuild(buildDirectory);
  canonicalDirectory(requestDirectory);
  const { value: request, bytes: requestBytes } = json(
    path.join(requestDirectory, "request.json"),
    true,
    updateLimits.catalog_bytes,
  );
  requireSigning(
    request.schema_version === 1 &&
      request.candidate === build.candidate &&
      request.key_id === expectedId &&
      validSequence(request.first_sequence) &&
      catalogBytes(request).equals(
        catalogBytes({
          schema_version: 1,
          candidate: build.candidate,
          key_id: expectedId,
          first_sequence: request.first_sequence,
        }),
      ),
    "request differs from the selected build or key",
  );
  const catalogs = [];
  for (const item of build.attempts) {
    const bytes = readBounded(
      path.join(requestDirectory, `catalog-${item.attempt}.json`),
      updateLimits.catalog_bytes,
    );
    const signature = readBounded(path.join(requestDirectory, `catalog-${item.attempt}.sig`), 64);
    const catalog = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const admitted = verifyCatalog(bytes, signature, trust, {
      now_ms: allowExpired ? catalog.issued_ms : now,
      execution: "internal",
      channel: "preview",
      preview_opt_in: true,
      previous: null,
      installed_version: null,
      target: build.cell.target,
      profile: build.cell.profile,
      format: build.cell.formats[0],
      schema: build.contracts.target_schema,
      queued_work_version: null,
    });
    requireSigning(
      admitted.catalog.key_id === expectedId &&
        catalog.candidate === build.candidate &&
        catalog.source_sha === build.inputs.source_sha &&
        catalog.version === item.version &&
        catalog.sequence === request.first_sequence + item.attempt - 1 &&
        catalog.channels.length === 1 &&
        catalog.channels[0] === "preview" &&
        catalog.notes_sha256 ===
          digest(Buffer.from("Internal qualification; no public release.\n")) &&
        catalogBytes(catalog.packages).equals(catalogBytes(item.packages)),
      "signed catalog differs from the exact final packages or build contract",
    );
    catalogs.push({ attempt: item.attempt, bytes, signature });
  }
  return {
    trust,
    catalogs,
    cell: build.cell,
    candidate: build.candidate,
    key_id: expectedId,
    request_sha256: digest(requestBytes),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usage =
    "Use installation-signing.mjs <sealed-build-directory> <new-request-directory> <public-key.pem> <expected-SPKI-DER-SHA256> <first-sequence>. Finalize native package signatures before preparation. Sign the exact catalog-1.json and catalog-2.json bytes, including the trailing LF, externally into catalog-1.sig and catalog-2.sig using raw 64-byte Ed25519 signatures. No private key, acceptance lease, installation or public feed is used by this entry.";
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") console.log(usage);
  else {
    requireSigning(args.length === 5 && /^[1-9][0-9]*$/.test(args[4]), usage);
    console.log(JSON.stringify(await prepareSigningRequest(...args.slice(0, 4), Number(args[4]))));
  }
}
