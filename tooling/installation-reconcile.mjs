// Metadata-only reconciliation runs under the native parent's advisory lock; no package is staged or activated.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  catalogBytes,
  compareVersions,
  decodeAcceptanceState,
  digest,
  updateLimits,
  verifyCatalog,
} from "./update-admission.mjs";
const [directory, evidence, leaseDigest] = process.argv.slice(2);
function read(file, maximum = updateLimits.catalog_bytes) {
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const info = fs.fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 || info.size > maximum)
      throw new Error("Unsafe retained reconciliation input.");
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length > maximum) throw new Error("Retained input grew beyond its bound.");
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}
const lock = path.join(directory, "operation.lock");
if (digest(read(lock)) !== leaseDigest) throw new Error("Retained lease changed.");
const acceptedFile = path.join(directory, "accepted.json"),
  partialFile = path.join(directory, "accepted.partial");
const previous = fs.existsSync(acceptedFile) ? decodeAcceptanceState(read(acceptedFile)) : null;
let selected = previous;
const partialExists = fs.existsSync(partialFile);
if (partialExists || !previous) {
  const campaign = JSON.parse(read(path.join(evidence, "campaign.json"), 8 * 1024 * 1024));
  const trust = JSON.parse(read(path.join(evidence, "qualification-trust.json")));
  const signed = [];
  for (const planned of campaign.attempts) {
    if (
      path.basename(planned.catalogName) !== planned.catalogName ||
      path.basename(planned.signatureName) !== planned.signatureName
    )
      throw new Error("Unsafe retained catalog path.");
    const bytes = read(path.join(evidence, planned.catalogName)),
      catalog = JSON.parse(bytes);
    const entry = catalog.packages.find(
      (item) =>
        item.target === campaign.cell.target &&
        item.profile === campaign.cell.profile &&
        item.format === planned.format,
    );
    const admitted = verifyCatalog(bytes, read(path.join(evidence, planned.signatureName)), trust, {
      now_ms: catalog.issued_ms,
      execution: "internal",
      channel: "preview",
      preview_opt_in: true,
      previous: null,
      installed_version: null,
      target: campaign.cell.target,
      profile: campaign.cell.profile,
      format: planned.format,
      schema: entry?.schema.source_min,
      queued_work_version: null,
    });
    signed.push(admitted.state);
  }
  let partial;
  if (partialExists) {
    const bytes = read(partialFile);
    try {
      partial = decodeAcceptanceState(bytes);
    } catch {
      /* Preserve torn bytes and conservatively burn the highest retained signed floor. */
    }
  }
  if (
    partial &&
    signed.some(
      (item) =>
        item.sequence === partial.sequence &&
        item.catalog_sha256 === partial.catalog_sha256 &&
        item.highest_version === partial.highest_version,
    )
  ) {
    selected = partial;
  } else {
    selected = signed.sort((a, b) => b.sequence - a.sequence)[0];
    if (!selected)
      throw new Error("No signed retained catalog can reconstruct the uncertain floor.");
    selected = {
      ...selected,
      last_accepted_ms: Math.max(Date.now(), previous?.last_accepted_ms ?? 0),
    };
  }
  if (previous) {
    if (selected.sequence < previous.sequence) selected = previous;
    else if (
      compareVersions(selected.highest_version, previous.highest_version) < 0 ||
      (selected.sequence === previous.sequence &&
        selected.catalog_sha256 !== previous.catalog_sha256)
    )
      throw new Error("Reconciliation would regress or replace the accepted floor.");
    selected = {
      ...selected,
      last_accepted_ms: Math.max(selected.last_accepted_ms, previous.last_accepted_ms),
    };
  }
  if (!previous || !catalogBytes(selected).equals(catalogBytes(previous))) {
    const nonce = randomUUID(),
      pending = path.join(directory, `accepted-reconciliation-${nonce}.partial`);
    if (previous)
      fs.copyFileSync(
        acceptedFile,
        path.join(directory, `accepted-before-reconciliation-${nonce}.json`),
        fs.constants.COPYFILE_EXCL,
      );
    const descriptor = fs.openSync(pending, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, catalogBytes(selected));
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(pending, acceptedFile);
  }
  if (partialExists)
    fs.renameSync(
      partialFile,
      path.join(directory, `accepted-partial-reconciled-${randomUUID()}.json`),
    );
}
if (digest(read(lock)) !== leaseDigest) throw new Error("Retained lease changed.");
const folder = fs.openSync(directory, "r");
try {
  fs.fsyncSync(folder);
} finally {
  fs.closeSync(folder);
}
console.log(
  JSON.stringify({
    status: "reconciled",
    state: selected,
    partial_retained: partialExists,
    effect: "No package or graphical action was replayed.",
  }),
);
