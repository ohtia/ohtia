import { URL } from "node:url";
// Typed signing operations and durable conditional journal; no cloud provisioning or publication.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import {
  SigningError,
  DeterministicSigningRefusal,
  SigningDeadline,
  currentSigningDeadline,
  withSigningDeadline,
  canonical,
  decode,
  demand,
  digest,
  execution,
  fields,
  hash,
  identifier,
  positive,
  reference,
  signingLimits,
  subject,
  trustedPolicy,
  command,
} from "./installation-authority.mjs";
import { validateCatalogPackage } from "./update-admission.mjs";

const budgets = JSON.parse(
  fs.readFileSync(new URL("../config/desktop/resource-policy.json", import.meta.url)),
).budgets;
const packageLimit = budgets.update_package_bytes.value;
const proofLimit = budgets.delivery_evidence_record_bytes.value;
const receiptDomain = Buffer.from("ohtia-signing-receipt-v1\0");
export const keyId = (key) => hash(createPublicKey(key).export({ format: "der", type: "spki" }));
export function rpmSignerId(policy) {
  return hash(
    canonical({
      mechanism: "openpgp-rpm",
      primary_fingerprint: policy.rpm_primary,
      signing_subkey_fingerprint: policy.rpm_subkey,
    }),
  );
}
export function validateRequest(bytes) {
  const r = decode(bytes);
  fields(
    r,
    "schema_version operation subject execution artifact_id input build_proof catalog_bindings",
  );
  demand(r.schema_version === 1 && ["rpm-sign", "deb-bind", "catalog-sign"].includes(r.operation));
  subject(r.subject);
  execution(r.execution);
  reference(
    r.input,
    r.operation === "catalog-sign" ? budgets.update_catalog_bytes.value : packageLimit,
  );
  reference(r.build_proof, proofLimit);
  demand(
    Array.isArray(r.catalog_bindings) &&
      r.catalog_bindings.length <= budgets.update_catalog_packages.value,
  );
  if (r.operation === "catalog-sign") {
    demand(r.artifact_id === null && r.catalog_bindings.length > 0);
    for (const b of r.catalog_bindings) {
      fields(b, "artifact_id request_id sha256 bytes format");
      identifier(b.artifact_id);
      digest(b.request_id);
      digest(b.sha256);
      demand(positive(b.bytes) <= packageLimit && ["rpm", "deb"].includes(b.format));
    }
    demand(
      new Set(r.catalog_bindings.map((b) => b.artifact_id)).size === r.catalog_bindings.length &&
        new Set(r.catalog_bindings.map((b) => b.request_id)).size === r.catalog_bindings.length,
    );
  } else {
    identifier(r.artifact_id);
    demand(r.catalog_bindings.length === 0);
  }
  return r;
}
export async function fileReference(file, maximum = packageLimit) {
  const handle = await fs.promises.open(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
  );
  try {
    const st = await handle.stat();
    demand(st.isFile() && st.nlink === 1 && st.size > 0 && st.size <= maximum, "size_refused");
    const h = createHash("sha256");
    let count = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      count += chunk.length;
      demand(count <= st.size, "contract_refused");
      h.update(chunk);
    }
    const end = await handle.stat();
    demand(
      count === st.size &&
        end.size === st.size &&
        end.mtimeMs === st.mtimeMs &&
        end.ctimeMs === st.ctimeMs,
      "contract_refused",
    );
    return { sha256: h.digest("hex"), bytes: count };
  } finally {
    await handle.close();
  }
}
export async function rpmBodyIdentity(file) {
  const h = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const st = await h.stat();
    demand(
      st.isFile() && st.nlink === 1 && st.size <= packageLimit && st.size >= 128,
      "contract_refused",
    );
    const lead = Buffer.alloc(112);
    demand(
      (await h.read(lead, 0, 112, 0)).bytesRead === 112 &&
        lead.readUInt32BE(0) === 0xedabeedb &&
        lead.readUInt32BE(96) === 0x8eade801,
      "contract_refused",
    );
    const end = 112 + lead.readUInt32BE(104) * 16 + lead.readUInt32BE(108);
    const start = Math.ceil(end / 8) * 8;
    demand(Number.isSafeInteger(start) && start + 16 < st.size, "contract_refused");
    const main = Buffer.alloc(16);
    demand(
      (await h.read(main, 0, 16, start)).bytesRead === 16 &&
        main.readUInt32BE(0) === 0x8eade801 &&
        start + 16 + main.readUInt32BE(8) * 16 + main.readUInt32BE(12) < st.size,
      "contract_refused",
    );
    const digest = createHash("sha256");
    let count = 0;
    for await (const chunk of h.createReadStream({ start, autoClose: false })) {
      count += chunk.length;
      demand(count <= st.size - start);
      digest.update(chunk);
    }
    const after = await h.stat();
    demand(
      count === st.size - start &&
        after.size === st.size &&
        after.mtimeMs === st.mtimeMs &&
        after.ctimeMs === st.ctimeMs,
    );
    return { sha256: digest.digest("hex"), bytes: count };
  } finally {
    await h.close();
  }
}
function same(a, b) {
  return canonical(a).equals(canonical(b));
}
function secureDirectory(directory) {
  demand(path.isAbsolute(directory) && fs.realpathSync(directory) === directory);
  const st = fs.lstatSync(directory);
  demand(st.isDirectory() && !st.isSymbolicLink() && (st.mode & 0o077) === 0);
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
// Retained JSON is untrusted filesystem input, including its file kind and size.
function retainedBytes(file, maximum = signingLimits.request_bytes) {
  let fd;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    const st = fs.fstatSync(fd);
    demand(
      st.isFile() &&
        st.nlink === 1 &&
        st.size > 0 &&
        st.size <= maximum &&
        st.uid === process.getuid() &&
        (st.mode & 0o022) === 0,
      "signing_uncertain",
    );
    const bytes = Buffer.alloc(st.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const size = fs.readSync(fd, bytes, count, bytes.length - count, null);
      if (!size) break;
      count += size;
    }
    const after = fs.fstatSync(fd);
    demand(
      count === st.size &&
        after.size === st.size &&
        after.mtimeMs === st.mtimeMs &&
        after.ctimeMs === st.ctimeMs &&
        after.nlink === 1,
      "signing_uncertain",
    );
    return bytes.subarray(0, count);
  } catch {
    throw new SigningError("signing_uncertain");
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writeOnce(file, bytes) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  syncDirectory(path.dirname(file));
}

export function authenticatedSourceCache(store, policy, worker) {
  const prefix = Buffer.from("ohtia-source-prefix-v1\0");
  return {
    get: async (key) => {
      const row = await store.read(hash(canonical({ kind: "verified-source", key })));
      if (!row) return undefined;
      const record = row.record;
      demand(
        typeof row.signature === "string" &&
          Buffer.from(row.signature, "base64").toString("base64") === row.signature &&
          verify(
            null,
            Buffer.concat([prefix, canonical(record)]),
            policy.catalog_public_key,
            Buffer.from(row.signature, "base64"),
          ),
        "policy_refused",
      );
      return record;
    },
    put: async (key, record, options) => {
      const id = hash(canonical({ kind: "verified-source", key }));
      const signature = (await worker.sourcePrefixSign(record, options)).toString("base64");
      const old = await store.read(id);
      if (old) {
        demand(same(old.record, record) && old.signature === signature, "policy_refused");
        return;
      }
      const written = await store.cas(id, null, { record, signature });
      if (!written) {
        const actual = await store.read(id);
        demand(same(actual.record, record) && actual.signature === signature, "policy_refused");
      }
    },
  };
}

// Local Linux fixture backend. Production requires the separately qualified S3 conditional-write adapter.
export class FileSigningStore {
  constructor(root) {
    secureDirectory(root);
    this.root = root;
    for (const n of ["objects", "journal", "tokens"]) {
      const p = path.join(root, n);
      if (!fs.existsSync(p)) {
        try {
          fs.mkdirSync(p, { mode: 0o700 });
        } catch (e) {
          if (e.code !== "EEXIST") throw e;
        }
      }
      secureDirectory(p);
    }
  }
  object(id) {
    digest(id);
    const directory = path.join(this.root, "objects", id);
    if (fs.existsSync(directory)) secureDirectory(directory);
    return path.join(directory, "data");
  }
  async objectSize(id) {
    return fs.statSync(this.object(id)).size;
  }
  async putObject(file, expected) {
    reference(expected, packageLimit);
    demand(same(await fileReference(file), expected), "contract_refused");
    const dest = this.object(expected.sha256);
    if (fs.existsSync(dest)) {
      demand(same(await fileReference(dest), expected), "signing_uncertain");
      return expected;
    }
    const partial = path.join(this.root, "objects", `.partial-${randomUUID()}`);
    fs.mkdirSync(partial, { mode: 0o700 });
    try {
      const data = path.join(partial, "data");
      await fs.promises.copyFile(file, data, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(data, 0o600);
      demand(same(await fileReference(data), expected));
      const fd = fs.openSync(data, "r");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      syncDirectory(partial);
      try {
        fs.renameSync(partial, path.dirname(dest));
      } catch (e) {
        if (!["EEXIST", "ENOTEMPTY"].includes(e.code)) throw e;
      }
      syncDirectory(path.join(this.root, "objects"));
      demand(same(await fileReference(dest), expected), "signing_uncertain");
      return expected;
    } finally {
      fs.rmSync(partial, { recursive: true, force: true });
    }
  }
  async putBytes(bytes) {
    demand(
      Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= proofLimit,
      "size_refused",
    );
    const ref = { sha256: hash(bytes), bytes: bytes.length },
      dest = this.object(ref.sha256);
    const partial = path.join(this.root, "objects", `.partial-${randomUUID()}`);
    fs.mkdirSync(partial, { mode: 0o700 });
    try {
      writeOnce(path.join(partial, "data"), bytes);
      try {
        fs.renameSync(partial, path.dirname(dest));
      } catch (e) {
        if (!["EEXIST", "ENOTEMPTY"].includes(e.code)) throw e;
      }
      syncDirectory(path.join(this.root, "objects"));
      demand((await this.readBytes(ref, proofLimit)).equals(bytes), "signing_uncertain");
      return ref;
    } finally {
      fs.rmSync(partial, { recursive: true, force: true });
    }
  }
  async readBytes(ref, maximum) {
    reference(ref, maximum);
    const fd = fs.openSync(
      this.object(ref.sha256),
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
    );
    try {
      const st = fs.fstatSync(fd);
      demand(
        st.isFile() && st.nlink === 1 && st.size === ref.bytes && st.size <= maximum,
        "contract_refused",
      );
      const bytes = Buffer.alloc(st.size + 1);
      let count = 0;
      while (count < bytes.length) {
        const n = fs.readSync(fd, bytes, count, bytes.length - count, null);
        if (n === 0) break;
        count += n;
      }
      const end = fs.fstatSync(fd);
      demand(
        count === st.size &&
          end.size === st.size &&
          end.mtimeMs === st.mtimeMs &&
          end.ctimeMs === st.ctimeMs &&
          hash(bytes.subarray(0, count)) === ref.sha256,
        "contract_refused",
      );
      return bytes.subarray(0, count);
    } finally {
      fs.closeSync(fd);
    }
  }
  sourceCache(policy, worker) {
    return authenticatedSourceCache(this, policy, worker);
  }
  async copyObject(ref, dest) {
    reference(ref, packageLimit);
    demand(same(await fileReference(this.object(ref.sha256)), ref), "contract_refused");
    await fs.promises.copyFile(this.object(ref.sha256), dest, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(dest, 0o600);
    demand(same(await fileReference(dest), ref));
  }
  journalDirectory(id) {
    digest(id);
    return path.join(this.root, "journal", id);
  }
  async read(id) {
    try {
      const dir = this.journalDirectory(id);
      if (!fs.existsSync(dir)) return null;
      secureDirectory(dir);
      const names = fs.readdirSync(dir).sort();
      demand(
        names.length > 0 && names.length <= signingLimits.journal_revisions,
        "signing_uncertain",
      );
      let last = null;
      for (let i = 0; i < names.length; i++) {
        demand(names[i] === `${String(i).padStart(3, "0")}.json`, "signing_uncertain");
        const bytes = retainedBytes(path.join(dir, names[i]));
        const row = decode(bytes, signingLimits.request_bytes);
        demand(
          row.revision === i && row.previous === (last ? hash(canonical(last)) : null),
          "signing_uncertain",
        );
        last = row;
      }
      return last;
    } catch {
      throw new SigningError("signing_uncertain");
    }
  }
  async cas(id, previous, value) {
    const dir = this.journalDirectory(id);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { mode: 0o700 });
        syncDirectory(path.dirname(dir));
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
    }
    const row = {
      ...structuredClone(value),
      revision: previous ? previous.revision + 1 : 0,
      previous: previous ? hash(canonical(previous)) : null,
    };
    try {
      writeOnce(path.join(dir, `${String(row.revision).padStart(3, "0")}.json`), canonical(row));
    } catch (e) {
      if (e.code === "EEXIST") return null;
      throw new SigningError("signing_uncertain");
    }
    return row;
  }
  async bindToken(jti, requestId, expires) {
    const id = hash(Buffer.from(jti));
    const file = path.join(this.root, "tokens", id);
    const value = { request_id: requestId, expires_ms: expires };
    try {
      writeOnce(file, canonical(value));
    } catch (e) {
      if (e.code !== "EEXIST") throw new SigningError("signing_uncertain");
      const prior = decode(retainedBytes(file));
      demand(
        prior.request_id === requestId && prior.expires_ms === expires,
        "authentication_refused",
      );
    }
  }
}

export class CryptoSigningWorker {
  constructor(policy, { keys, tools = {}, clock = Date.now } = {}) {
    this.policy = trustedPolicy(policy);
    this.keys = keys;
    this.clock = clock;
    this.tools = {
      gpg: "/usr/bin/gpg",
      gpgconf: "/usr/bin/gpgconf",
      preset: "/usr/libexec/gpg-preset-passphrase",
      rpmsign: "/usr/bin/rpmsign",
      rpmkeys: "/usr/bin/rpmkeys",
      rpm: "/usr/bin/rpm",
      ...tools,
    };
  }
  async catalogSign(bytes, { deadline, beforeSign } = {}) {
    const material = await this.keys.catalog();
    try {
      deadline?.check();
      const key = createPrivateKey({
        key: material.key,
        format: "pem",
        passphrase: material.passphrase,
      });
      demand(
        key.asymmetricKeyType === "ed25519" && keyId(key) === keyId(this.policy.catalog_public_key),
        "policy_refused",
      );
      await beforeSign?.();
      deadline?.check();
      const signature = sign(null, bytes, key);
      demand(
        signature.length === 64 && verify(null, bytes, this.policy.catalog_public_key, signature),
        "operation_failed",
      );
      return signature;
    } finally {
      material.key.fill(0);
      material.passphrase?.fill(0);
    }
  }
  async receiptSign(bytes, options) {
    return this.catalogSign(Buffer.concat([receiptDomain, bytes]), options);
  }
  async sourcePrefixSign(record, options) {
    fields(record, "commit tree policy_sha256 kind");
    digest(record.commit, 40);
    digest(record.tree, 40);
    demand(
      record.policy_sha256 === hash(canonical(this.policy)) &&
        ["personal-signature", "clean-merge"].includes(record.kind),
      "policy_refused",
    );
    return this.catalogSign(
      Buffer.concat([Buffer.from("ohtia-source-prefix-v1\0"), canonical(record)]),
      options,
    );
  }
  async rpmSign(input, directory, artifact, { deadline = new SigningDeadline(), beforeSign } = {}) {
    const cleanupDeadline = deadline,
      active = deadline.reserve(signingLimits.subprocess_ms);
    return withSigningDeadline(active, () =>
      this.#rpmSignBounded(input, directory, artifact, {
        deadline: active,
        cleanupDeadline,
        beforeSign,
      }),
    );
  }
  async #rpmSignBounded(input, directory, artifact, { deadline, cleanupDeadline, beforeSign }) {
    const run = (program, args, options = {}) => command(program, args, { ...options, deadline });
    const inputBody = await rpmBodyIdentity(input);
    const home = path.join(directory, "gnupg");
    fs.mkdirSync(home, { mode: 0o700 });
    fs.writeFileSync(path.join(home, "gpg-agent.conf"), "allow-preset-passphrase\n", {
      mode: 0o600,
    });
    const material = await this.keys.rpm();
    const environment = { HOME: directory };
    const gpg = (...args) =>
      run(
        this.tools.gpg,
        ["--no-options", "--homedir", home, "--batch", "--no-auto-key-retrieve", ...args],
        { env: environment },
      );
    try {
      await run(this.tools.gpg, ["--no-options", "--homedir", home, "--batch", "--import"], {
        stdin: material.key,
        env: environment,
      });
      const list = (await gpg("--with-colons", "--with-keygrip", "--list-secret-keys"))
        .toString()
        .split("\n")
        .map((l) => l.split(":"));
      const secret = list.filter((r) => ["sec", "ssb"].includes(r[0]));
      demand(
        secret.length === 2 &&
          secret[0][0] === "sec" &&
          secret[0][14] === "#" &&
          secret[1][0] === "ssb" &&
          secret[1][14] === "+",
        "policy_refused",
      );
      const fingerprints = list.filter((r) => r[0] === "fpr").map((r) => r[9].toLowerCase());
      demand(
        same(fingerprints, [this.policy.rpm_primary, this.policy.rpm_subkey]),
        "policy_refused",
      );
      const subIndex = list.findIndex((r) => r[0] === "ssb");
      const grip = list.slice(subIndex).find((r) => r[0] === "grp")?.[9];
      demand(/^[A-F0-9]{40}$/.test(grip), "policy_refused");
      const now = Math.floor(this.clock() / 1000);
      demand(
        secret.every((r) => r[1] !== "r" && r[1] !== "e" && (!r[6] || Number(r[6]) > now)),
        "policy_refused",
      );
      demand(
        Buffer.isBuffer(material.passphrase) &&
          material.passphrase.length > 0 &&
          material.passphrase.length <= 4096 &&
          !material.passphrase.includes(10) &&
          !material.passphrase.includes(13),
        "policy_refused",
      );
      await run(this.tools.preset, ["--homedir", home, "--preset", grip], {
        stdin: Buffer.concat([material.passphrase, Buffer.from("\n")]),
        env: environment,
      });
      const output = path.join(directory, "signed.rpm");
      await fs.promises.copyFile(input, output, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(output, 0o600);
      const before = await run(
        this.tools.rpm,
        [
          "--query",
          "--package",
          "--queryformat",
          "%{NAME}\n%{EPOCHNUM}\n%{VERSION}-%{RELEASE}\n%{ARCH}\n",
          output,
        ],
        { env: environment },
      );
      const metadata = before.toString().trim().split("\n");
      if (!(
        metadata.length === 4 &&
        metadata[0] === "ohtia-quality" &&
        metadata[1] === "0" &&
        metadata[2] === artifact.native_version &&
        metadata[3] === (artifact.target === "linux-arm64" ? "aarch64" : "x86_64")
      ))
        throw new DeterministicSigningRefusal("policy_refused");
      await beforeSign?.();
      deadline.check();
      await run(
        this.tools.rpmsign,
        [
          "--addsign",
          "--define",
          "_openpgp_sign gpg",
          "--define",
          `_gpg_path ${home}`,
          "--define",
          `_openpgp_sign_id ${this.policy.rpm_subkey}!`,
          "--define",
          "_gpg_digest_algo sha256",
          output,
        ],
        { env: environment },
      );
      const publicKey = path.join(directory, "public.asc");
      fs.writeFileSync(publicKey, await gpg("--armor", "--export", this.policy.rpm_primary), {
        mode: 0o600,
      });
      const db = path.join(directory, "trust");
      fs.mkdirSync(db, { mode: 0o700 });
      await run(this.tools.rpm, ["--dbpath", db, "--define", "_keyring rpmdb", "--initdb"], {
        env: environment,
      });
      await run(
        this.tools.rpmkeys,
        ["--dbpath", db, "--define", "_keyring rpmdb", "--import", publicKey],
        { env: environment },
      );
      const checked = await run(
        this.tools.rpmkeys,
        ["--dbpath", db, "--define", "_keyring rpmdb", "--checksig", "--verbose", output],
        { env: environment },
      );
      const text = checked.toString().toLowerCase();
      demand(
        !text.includes("nokey") &&
          !text.includes("not ok") &&
          text.includes(this.policy.rpm_primary),
        "operation_failed",
      );
      const after = await run(
        this.tools.rpm,
        [
          "--query",
          "--package",
          "--queryformat",
          "%{NAME}\n%{EPOCHNUM}\n%{VERSION}-%{RELEASE}\n%{ARCH}\n",
          output,
        ],
        { env: environment },
      );
      demand(after.equals(before), "operation_failed");
      demand(same(inputBody, await rpmBodyIdentity(output)), "operation_failed");
      return {
        file: output,
        verification: {
          mechanism: "openpgp-rpm",
          rpm_body: inputBody,
          primary_fingerprint: this.policy.rpm_primary,
          signing_subkey_fingerprint: this.policy.rpm_subkey,
          native_version: metadata[2],
          architecture: metadata[3],
        },
      };
    } finally {
      material.key.fill(0);
      material.passphrase?.fill(0);
      try {
        await command(this.tools.gpgconf, ["--homedir", home, "--kill", "gpg-agent"], {
          env: environment,
          deadline: cleanupDeadline,
        });
      } catch {
        throw new SigningError("signing_uncertain");
      }
    }
  }
}

export function verifyReceipt(bytes, signature, policy) {
  const r = decode(bytes);
  demand(
    Buffer.isBuffer(signature) &&
      signature.length === 64 &&
      verify(null, Buffer.concat([receiptDomain, bytes]), policy.catalog_public_key, signature),
    "policy_refused",
  );
  fields(
    r,
    "schema_version kind request_id operation subject execution deployment policy_sha256 source_gate_proof_sha256 build_proof_sha256 input output signer verification_proof_sha256 sealed_at_ms",
  );
  demand(
    r.schema_version === 1 &&
      r.kind === "ohtia-signing-receipt" &&
      r.policy_sha256 === hash(canonical(policy)),
    "policy_refused",
  );
  digest(r.request_id);
  subject(r.subject);
  execution(r.execution);
  for (const k of ["source_gate_proof_sha256", "build_proof_sha256", "verification_proof_sha256"])
    digest(r[k]);
  positive(r.sealed_at_ms);
  fields(r.deployment, "provider region container_id image_digest invocation");
  const { invocation, ...deployment } = r.deployment;
  demand(
    same(deployment, policy.deployment) && /^[a-f0-9-]{36}$/.test(invocation),
    "policy_refused",
  );
  reference(
    r.input,
    r.operation === "catalog-sign" ? budgets.update_catalog_bytes.value : packageLimit,
  );
  reference(r.output, packageLimit);
  fields(r.signer, "mechanism id");
  if (r.operation === "rpm-sign")
    demand(
      r.signer.mechanism === "openpgp-rpm" && r.signer.id === rpmSignerId(policy),
      "policy_refused",
    );
  else if (r.operation === "deb-bind")
    demand(
      r.signer.mechanism === "none" && r.signer.id === null && same(r.input, r.output),
      "policy_refused",
    );
  else
    demand(
      r.operation === "catalog-sign" &&
        r.signer.mechanism === "ed25519" &&
        r.signer.id === keyId(policy.catalog_public_key) &&
        r.output.bytes === 64,
      "policy_refused",
    );
  return r;
}

export class SigningService {
  constructor(
    policy,
    {
      store,
      caller,
      source,
      build,
      worker,
      clock = Date.now,
      admit = async () => false,
      deadline = () => new SigningDeadline(),
    } = {},
  ) {
    this.policy = trustedPolicy(policy);
    this.store = store;
    this.caller = caller;
    this.source = source;
    this.build = build;
    this.worker = worker;
    this.clock = clock;
    this.admit = admit;
    this.deadline = deadline;
  }
  async checkAuthority() {
    demand(this.policy.enabled && (await this.admit(this.policy)) === true, "policy_refused");
  }
  async authorize(token, request) {
    await this.checkAuthority();
    return this.caller.verify(token, structuredClone(request));
  }
  identity(request) {
    return hash(
      canonical({
        subject: {
          kind: request.subject.kind,
          repository: request.subject.repository,
          application_version: request.subject.application_version,
          source_commit: request.subject.source_commit,
          source_tree: request.subject.source_tree,
        },
        artifact_id: request.artifact_id,
        operation: request.operation,
      }),
    );
  }
  async create(token, bytes) {
    return withSigningDeadline(this.deadline(), () => this.createBounded(token, bytes));
  }
  async createBounded(token, bytes) {
    const r = validateRequest(bytes),
      id = hash(bytes);
    const auth = await this.authorize(token, r);
    await this.store.bindToken(auth.jti, id, auth.expires_ms);
    await this.source.inspect(r.subject.source_commit, r.subject.source_tree, {
      deadline: currentSigningDeadline(),
    });
    const key = this.identity(r);
    let state = await this.store.read(key);
    if (state) {
      demand(state.request_id === id, "request_conflict");
      return this.response(token, state);
    }
    await this.store.putBytes(bytes);
    const value = {
      request_id: id,
      request: r,
      state: "admitted",
      code: null,
      result: null,
      receipt: null,
      receipt_signature: null,
    };
    state = await this.store.cas(key, null, value);
    if (!state) {
      state = await this.store.read(key);
      demand(state?.request_id === id, "request_conflict");
    }
    return this.response(token, state);
  }
  view(state) {
    return structuredClone({
      schema_version: 1,
      request_id: state.request_id,
      state: state.state,
      code: state.code,
      receipt: state.receipt,
      receipt_signature: state.receipt_signature,
      result: state.result,
    });
  }
  async current(token, id, requestBytes) {
    const r = validateRequest(requestBytes);
    demand(hash(requestBytes) === id);
    const authenticated = await this.authorize(token, r);
    await this.store.bindToken(authenticated.jti, id, authenticated.expires_ms);
    const state = await this.store.read(this.identity(r));
    demand(state?.request_id === id, "request_conflict");
    demand(
      state.request && hash(canonical(state.request)) === id && same(state.request, r),
      "signing_uncertain",
    );
    return state;
  }
  async validatedView(state) {
    if (state.state !== "sealed") return this.view(state);
    demand(hash(canonical(state.request)) === state.request_id, "signing_uncertain");
    const bytes = await this.store.readBytes(state.receipt, signingLimits.request_bytes),
      signature = await this.store.readBytes(state.receipt_signature, 64),
      receipt = verifyReceipt(bytes, signature, this.policy);
    demand(
      receipt.request_id === state.request_id &&
        receipt.operation === state.request.operation &&
        same(receipt.subject, state.request.subject) &&
        same(receipt.execution, state.request.execution) &&
        same(receipt.input, state.request.input) &&
        same(receipt.output, state.result) &&
        receipt.build_proof_sha256 === state.request.build_proof.sha256,
      "signing_uncertain",
    );
    return this.view(state);
  }
  async response(token, state) {
    const value = await this.validatedView(state);
    await this.authorize(token, state.request);
    return value;
  }
  async status(token, id, requestBytes) {
    return withSigningDeadline(this.deadline(), async () =>
      this.response(token, await this.current(token, id, requestBytes)),
    );
  }
  async execute(token, id, requestBytes) {
    return withSigningDeadline(this.deadline(), () => this.executeBounded(token, id, requestBytes));
  }
  async executeBounded(token, id, requestBytes) {
    const deadline = currentSigningDeadline();
    let state = await this.current(token, id, requestBytes);
    deadline.check();
    const r = state.request,
      key = this.identity(r);
    if (state.state === "sealed") return this.response(token, state);
    demand(state.state !== "uncertain" && state.state !== "signing", "signing_uncertain");
    demand(state.state === "admitted", "request_conflict");
    const sourceProof = await this.source.inspect(r.subject.source_commit, r.subject.source_tree, {
      deadline,
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-signing-operation-"));
    fs.chmodSync(dir, 0o700);
    let started = false,
      settled = false;
    try {
      const input = path.join(dir, "input");
      await this.store.copyObject(r.input, input);
      const proofBytes = await this.store.readBytes(r.build_proof, proofLimit);
      const proof = decode(proofBytes, proofLimit);
      let artifact;
      if (r.operation === "catalog-sign") {
        fields(proof, "schema_version bindings");
        demand(proof.schema_version === 1 && same(proof.bindings, r.catalog_bindings));
        artifact = await this.catalogBindings(r, input);
      } else {
        artifact = await this.build.verify(input, proof, structuredClone(r), { deadline });
        this.checkArtifact(r, artifact);
      }
      // Retain every receipt-referenced input/proof before any private signing effect.
      await this.store.putObject(input, r.input);
      const rawProof = path.join(dir, "build-proof.json");
      fs.writeFileSync(rawProof, proofBytes, { mode: 0o600, flag: "wx" });
      await this.store.putObject(rawProof, r.build_proof);
      const startSigning = async () => {
        if (started) return;
        await this.authorize(token, r);
        deadline.check();
        const signing = await this.store.cas(key, state, {
          ...state,
          state: "signing",
          code: null,
        });
        demand(signing, "request_conflict");
        state = signing;
        started = true;
        if (r.operation === "rpm-sign") {
          const slot = hash(
            canonical({
              kind: "qualification-rpm-input",
              version: r.subject.application_version,
              input: r.input,
            }),
          );
          demand(
            await this.store.cas(slot, null, { request_id: id, state: "signing" }),
            "signing_uncertain",
          );
        }
      };
      let result, verification;
      if (r.operation === "rpm-sign") {
        const signed = await this.worker.rpmSign(input, dir, artifact, {
          deadline,
          beforeSign: startSigning,
        });
        result = await this.store.putObject(signed.file, await fileReference(signed.file));
        verification = signed.verification;
      } else if (r.operation === "deb-bind") {
        result = await this.store.putObject(input, r.input);
        verification = { mechanism: "none", artifact };
      } else {
        const bytes = fs.readFileSync(input);
        result = await this.store.putBytes(
          await this.worker.catalogSign(bytes, { deadline, beforeSign: startSigning }),
        );
        verification = {
          mechanism: "ed25519",
          bindings: r.catalog_bindings,
          catalog_sha256: r.input.sha256,
        };
      }
      deadline.check(started ? "signing_uncertain" : "authority_unavailable");
      await this.checkAuthority();
      const verificationRef = await this.store.putBytes(
        canonical({
          schema_version: 1,
          artifact: r.operation === "catalog-sign" ? null : artifact,
          verification,
        }),
      );
      const sourceRef = await this.store.putBytes(canonical(sourceProof));
      const receipt = {
        schema_version: 1,
        kind: "ohtia-signing-receipt",
        request_id: id,
        operation: r.operation,
        subject: r.subject,
        execution: r.execution,
        deployment: { ...this.policy.deployment, invocation: randomUUID() },
        policy_sha256: hash(canonical(this.policy)),
        source_gate_proof_sha256: sourceRef.sha256,
        build_proof_sha256: r.build_proof.sha256,
        input: r.input,
        output: result,
        signer:
          r.operation === "rpm-sign"
            ? { mechanism: "openpgp-rpm", id: rpmSignerId(this.policy) }
            : r.operation === "catalog-sign"
              ? { mechanism: "ed25519", id: keyId(this.policy.catalog_public_key) }
              : { mechanism: "none", id: null },
        verification_proof_sha256: verificationRef.sha256,
        sealed_at_ms: this.clock(),
      };
      const receiptBytes = canonical(receipt);
      const receiptRef = await this.store.putBytes(receiptBytes);
      const signatureRef = await this.store.putBytes(
        await this.worker.receiptSign(receiptBytes, { deadline, beforeSign: startSigning }),
      );
      await this.checkAuthority();
      deadline.check("signing_uncertain");
      const sealed = await this.store.cas(key, state, {
        ...state,
        state: "sealed",
        result,
        receipt: receiptRef,
        receipt_signature: signatureRef,
        artifact,
      });
      demand(sealed, "signing_uncertain");
      settled = true;
      return await this.response(token, sealed);
    } catch (error) {
      if (settled) {
        if (error instanceof SigningError) throw error;
        throw new SigningError("authority_unavailable");
      }
      if (started) {
        try {
          await this.store.cas(key, state, {
            ...state,
            state: "uncertain",
            code: "signing_uncertain",
          });
        } catch {
          /* Preserve the signing marker; never resume it as admitted. */
        }
        throw new SigningError("signing_uncertain");
      }
      if (error instanceof SigningError) {
        if (error.code === "signing_uncertain") throw new SigningError("authority_unavailable");
        if (error instanceof DeterministicSigningRefusal) {
          try {
            await this.store.cas(key, state, { ...state, state: "failed", code: error.code });
          } catch {
            /* No signing effect occurred; the admitted marker may remain. */
          }
        }
        throw error;
      }
      throw new SigningError("authority_unavailable");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  checkArtifact(r, a) {
    fields(
      a,
      "id target profile format native_version source_commit source_tree inputs_sha256 sha256 bytes build_execution",
    );
    demand(
      a.id === r.artifact_id &&
        a.source_commit === r.subject.source_commit &&
        a.source_tree === r.subject.source_tree &&
        a.sha256 === r.input.sha256 &&
        a.bytes === r.input.bytes,
      "policy_refused",
    );
    demand(
      ["linux-x64", "linux-arm64"].includes(a.target) &&
        a.format === (r.operation === "rpm-sign" ? "rpm" : "deb") &&
        (a.format === "rpm"
          ? a.profile === "fedora-44"
          : ["ubuntu-26.04", "debian-13"].includes(a.profile)),
      "policy_refused",
    );
    demand(
      a.native_version === r.subject.application_version.replace("-", "~") + "-1",
      "policy_refused",
    );
    digest(a.inputs_sha256);
    execution(a.build_execution);
    const version = r.subject.application_version.split("-dev.")[1].split(".");
    demand(
      version[0] === String(a.build_execution.run_id) &&
        version[1] === String(a.build_execution.attempt),
      "policy_refused",
    );
    demand(
      a.build_execution.workflow === this.policy.build_workflow.workflow &&
        a.build_execution.workflow_sha === this.policy.build_workflow.sha &&
        a.build_execution.job_id !== r.execution.job_id,
      "policy_refused",
    );
  }
  async catalogBindings(r, input) {
    const deadline = currentSigningDeadline();
    deadline.check();
    const catalog = decode(fs.readFileSync(input), budgets.update_catalog_bytes.value);
    fields(
      catalog,
      "schema_version key_id sequence issued_ms expires_ms candidate source_sha version channels notes_sha256 packages",
    );
    demand(
      catalog.schema_version === 1 &&
        catalog.key_id === keyId(this.policy.catalog_public_key) &&
        catalog.source_sha === r.subject.source_commit &&
        catalog.version === r.subject.application_version &&
        same(catalog.channels, ["preview"]),
      "policy_refused",
    );
    digest(catalog.candidate);
    digest(catalog.notes_sha256);
    positive(catalog.sequence);
    demand(
      Number.isSafeInteger(catalog.issued_ms) &&
        Number.isSafeInteger(catalog.expires_ms) &&
        catalog.issued_ms <= this.clock() &&
        this.clock() < catalog.expires_ms &&
        catalog.expires_ms - catalog.issued_ms <= budgets.update_catalog_lifetime_ms.value,
      "policy_refused",
    );
    demand(
      Array.isArray(catalog.packages) && catalog.packages.length === r.catalog_bindings.length,
      "policy_refused",
    );
    try {
      for (const p of catalog.packages) validateCatalogPackage(p, catalog.version);
    } catch {
      throw new SigningError("policy_refused");
    }
    demand(
      new Set(catalog.packages.map((p) => `${p.target}/${p.profile}/${p.format}`)).size ===
        catalog.packages.length,
      "policy_refused",
    );
    demand(
      new Set(catalog.packages.map((p) => p.filename)).size === catalog.packages.length,
      "policy_refused",
    );
    const actual = [];
    for (const binding of r.catalog_bindings) {
      deadline.check();
      const priorRequest = {
        ...r,
        operation: binding.format === "rpm" ? "rpm-sign" : "deb-bind",
        artifact_id: binding.artifact_id,
      };
      const state = await this.store.read(this.identity(priorRequest));
      if (!state || ["admitted", "signing"].includes(state.state))
        throw new SigningError("authority_unavailable");
      demand(
        state?.state === "sealed" &&
          state.request_id === binding.request_id &&
          same(state.request.subject, r.subject) &&
          same(state.result, { sha256: binding.sha256, bytes: binding.bytes }),
        "policy_refused",
      );
      const receiptBytes = await this.store.readBytes(state.receipt, signingLimits.request_bytes),
        signature = await this.store.readBytes(state.receipt_signature, 64);
      const receipt = verifyReceipt(receiptBytes, signature, this.policy);
      demand(
        same(receipt.output, state.result) && receipt.request_id === binding.request_id,
        "policy_refused",
      );
      demand(
        hash(canonical(state.request)) === state.request_id &&
          receipt.operation === state.request.operation &&
          same(receipt.input, state.request.input) &&
          same(receipt.subject, state.request.subject) &&
          same(receipt.execution, state.request.execution),
        "policy_refused",
      );
      const verified = decode(
        await this.store.readBytes(
          {
            sha256: receipt.verification_proof_sha256,
            bytes: await this.store.objectSize(receipt.verification_proof_sha256),
          },
          proofLimit,
        ),
        proofLimit,
      );
      fields(verified, "schema_version artifact verification");
      demand(verified.schema_version === 1, "policy_refused");
      const artifact = verified.artifact;
      this.checkArtifact(state.request, artifact);
      demand(catalog.candidate === artifact.inputs_sha256, "policy_refused");
      const packages = catalog.packages.filter(
        (p) =>
          p.sha256 === binding.sha256 &&
          p.bytes === binding.bytes &&
          p.target === artifact.target &&
          p.profile === artifact.profile &&
          p.format === artifact.format &&
          p.native_version === artifact.native_version,
      );
      demand(packages.length === 1, "policy_refused");
      actual.push(packages[0]);
    }
    demand(new Set(actual).size === catalog.packages.length, "policy_refused");
    return { bindings: r.catalog_bindings };
  }
}
