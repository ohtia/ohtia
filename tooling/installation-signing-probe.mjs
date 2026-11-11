// Disposable local-key/RPM experiment. This is never production signing or provider admission.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { canonical, command, demand, SigningError } from "./installation-authority.mjs";
import { observeSigningResources } from "./installation-signing-resources.mjs";
import { CryptoSigningWorker, fileReference, keyId } from "./installation-signer.mjs";

async function nativeSigningFixtureProbe(input) {
  demand(path.isAbsolute(input) && input.endsWith(".rpm"));
  const original = await fileReference(input);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-disposable-signer-"));
  fs.chmodSync(directory, 0o700);
  const home = path.join(directory, "generation");
  fs.mkdirSync(home, { mode: 0o700 });
  const passphrase = Buffer.from(randomBytes(24).toString("hex"));
  const gpg = (...args) =>
    command(
      "/usr/bin/gpg",
      [
        "--no-options",
        "--homedir",
        home,
        "--batch",
        "--pinentry-mode",
        "loopback",
        "--passphrase-fd",
        "0",
        ...args,
      ],
      { stdin: Buffer.concat([passphrase, Buffer.from("\n")]) },
    );
  try {
    const sshKey = path.join(directory, "source-key");
    const repository = path.join(directory, "source");
    const allowed = path.join(directory, "allowed-signers");
    await command("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", sshKey]);
    fs.writeFileSync(
      allowed,
      "fixture@example.invalid " + fs.readFileSync(sshKey + ".pub", "utf8"),
      { mode: 0o600 },
    );
    await command("/usr/bin/git", [
      "-c",
      "init.defaultBranch=fixture",
      "init",
      "--quiet",
      repository,
    ]);
    await command("/usr/bin/git", [
      "-C",
      repository,
      "-c",
      "user.name=Disposable fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "gpg.format=ssh",
      "-c",
      "user.signingkey=" + sshKey,
      "commit",
      "--allow-empty",
      "--quiet",
      "-S",
      "-m",
      "Disposable source signature fixture",
    ]);
    await command("/usr/bin/git", [
      "-C",
      repository,
      "-c",
      "gpg.ssh.allowedSignersFile=" + allowed,
      "verify-commit",
      "HEAD",
    ]);
    await gpg(
      "--quick-generate-key",
      "Ohtia disposable signing fixture <fixture@example.invalid>",
      "rsa4096",
      "cert",
      "1d",
    );
    const primary = (await gpg("--with-colons", "--list-keys"))
      .toString()
      .split("\n")
      .find((l) => l.startsWith("fpr:"))
      .split(":")[9];
    await gpg("--quick-add-key", primary, "rsa4096", "sign", "1d");
    const fingerprints = (await gpg("--with-colons", "--list-keys"))
      .toString()
      .split("\n")
      .filter((l) => l.startsWith("fpr:"))
      .map((l) => l.split(":")[9]);
    const secret = await gpg("--armor", "--export-secret-subkeys", primary);
    const catalog = generateKeyPairSync("ed25519"),
      source = generateKeyPairSync("ed25519");
    const raw = source.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const ssh = Buffer.concat([
      Buffer.from([0, 0, 0, 11]),
      Buffer.from("ssh-ed25519"),
      Buffer.from([0, 0, 0, 32]),
      raw,
    ]).toString("base64");
    const policy = {
      schema_version: 1,
      enabled: true,
      repository_id: "1431132416",
      owner_id: "346940169",
      audience: "ohtia-signing:fixture",
      environment: "ohtia-signing",
      caller_workflow: ".github/workflows/installation-signing.yml",
      signing_workflow: { workflow: ".github/workflows/signing-worker.yml", sha: "c".repeat(40) },
      build_workflow: { workflow: ".github/workflows/signing-build.yml", sha: "d".repeat(40) },
      source_anchor: "e".repeat(40),
      source_signers: [{ principal: "fixture@example.invalid", public_key: "ssh-ed25519 " + ssh }],
      catalog_public_key: catalog.publicKey.export({ format: "pem", type: "spki" }).toString(),
      rpm_primary: fingerprints[0].toLowerCase(),
      rpm_subkey: fingerprints[1].toLowerCase(),
      deployment: {
        provider: "scaleway-serverless-containers",
        region: "fr-par",
        container_id: "00000000-0000-0000-0000-000000000000",
        image_digest: "sha256:" + "0".repeat(64),
      },
    };
    const worker = new CryptoSigningWorker(policy, {
      keys: {
        rpm: async () => ({ key: Buffer.from(secret), passphrase: Buffer.from(passphrase) }),
        catalog: async () => ({
          key: Buffer.from(catalog.privateKey.export({ format: "pem", type: "pkcs8" })),
          passphrase: Buffer.alloc(0),
        }),
      },
    });
    const meta = (
      await command("/usr/bin/rpm", [
        "--query",
        "--package",
        "--queryformat",
        "%{VERSION}-%{RELEASE}\n%{ARCH}\n",
        input,
      ])
    )
      .toString()
      .trim()
      .split("\n");
    const operation = path.join(directory, "operation");
    fs.mkdirSync(operation, { mode: 0o700 });
    const signed = await worker.rpmSign(input, operation, {
      native_version: meta[0],
      target: meta[1] === "aarch64" ? "linux-arm64" : "linux-x64",
    });
    const final = await fileReference(signed.file);
    demand(signed.verification.rpm_body && signed.verification.rpm_body.bytes > 0);
    const fullSecret = await gpg("--armor", "--export-secret-keys", primary);
    const badWorker = new CryptoSigningWorker(policy, {
      keys: {
        rpm: async () => ({ key: Buffer.from(fullSecret), passphrase: Buffer.from(passphrase) }),
      },
    });
    const badDir = path.join(directory, "primary-refusal");
    fs.mkdirSync(badDir, { mode: 0o700 });
    let primaryRefused = false;
    try {
      await badWorker.rpmSign(input, badDir, {
        native_version: meta[0],
        target: meta[1] === "aarch64" ? "linux-arm64" : "linux-x64",
      });
    } catch (e) {
      primaryRefused = e.code === "policy_refused";
    }
    fullSecret.fill(0);
    demand(primaryRefused && !fs.existsSync(path.join(badDir, "signed.rpm")));

    demand(final.sha256 !== original.sha256);
    const empty = path.join(directory, "empty-trust");
    fs.mkdirSync(empty, { mode: 0o700 });
    await command("/usr/bin/rpm", ["--dbpath", empty, "--initdb"]);
    const noKey = spawnSync(
      "/usr/bin/rpmkeys",
      ["--dbpath", empty, "--checksig", "--verbose", signed.file],
      { env: { PATH: "/usr/bin:/bin", LANG: "C" }, timeout: 120000, maxBuffer: 65536 },
    );
    demand(
      noKey.status !== 0 &&
        Buffer.concat([noKey.stdout, noKey.stderr]).includes(Buffer.from("NOKEY")),
    );
    const message = canonical({
      fixture_only: true,
      signed_rpm: final,
      public_key_id: keyId(policy.catalog_public_key),
    });
    const signature = await worker.catalogSign(message);
    demand(
      verify(null, message, catalog.publicKey, signature) &&
        !verify(null, Buffer.concat([message, Buffer.from(" ")]), catalog.publicKey, signature),
    );
    const receiptSignature = await worker.receiptSign(message);
    demand(!verify(null, message, catalog.publicKey, receiptSignature));
    const verifyArgs = [
      "--dbpath",
      path.join(operation, "trust"),
      "--define",
      "_keyring rpmdb",
      "--checksig",
      "--verbose",
      signed.file,
    ];
    const positive = spawnSync("/usr/bin/rpmkeys", verifyArgs, {
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
      timeout: 120000,
      maxBuffer: 65536,
    });
    const positiveText = Buffer.concat([positive.stdout, positive.stderr]).toString().toLowerCase();
    demand(
      positive.status === 0 &&
        signed.verification.primary_fingerprint === policy.rpm_primary &&
        signed.verification.signing_subkey_fingerprint === policy.rpm_subkey &&
        positiveText.includes("signature") &&
        !positiveText.includes("nokey"),
    );
    const changedHeader = path.join(directory, "changed-header.bin");
    const headerBytes = fs.readFileSync(path.join(operation, "rpm-header.bin"));
    headerBytes[headerBytes.length - 1] ^= 1;
    fs.writeFileSync(changedHeader, headerBytes, { mode: 0o600 });
    const alteredHeader = spawnSync(
      "/usr/bin/gpg",
      [
        "--no-options",
        "--homedir",
        path.join(operation, "gnupg"),
        "--batch",
        "--no-auto-key-retrieve",
        "--status-fd",
        "1",
        "--verify",
        path.join(operation, "rpm-signature.bin"),
        changedHeader,
      ],
      {
        env: { PATH: "/usr/bin:/bin", HOME: directory, LANG: "C" },
        timeout: 120000,
        maxBuffer: 65536,
      },
    );
    await command("/usr/bin/gpgconf", [
      "--homedir",
      path.join(operation, "gnupg"),
      "--kill",
      "gpg-agent",
    ]);
    demand(
      alteredHeader.status !== 0 && alteredHeader.stdout?.includes(Buffer.from("[GNUPG:] BADSIG ")),
    );
    const fd = fs.openSync(signed.file, "r+");
    try {
      const b = Buffer.alloc(1);
      fs.readSync(fd, b, 0, 1, final.bytes - 1);
      b[0] ^= 1;
      fs.writeSync(fd, b, 0, 1, final.bytes - 1);
    } finally {
      fs.closeSync(fd);
    }
    const altered = spawnSync("/usr/bin/rpmkeys", verifyArgs, {
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
      timeout: 120000,
      maxBuffer: 65536,
    });
    const alteredText = Buffer.concat([altered.stdout, altered.stderr]).toString().toLowerCase();
    demand(
      altered.status !== 0 &&
        alteredText.includes("bad") &&
        alteredText.includes("digest") &&
        !alteredText.includes("nokey"),
    );
    demand(canonical(await fileReference(input)).equals(canonical(original)));
    secret.fill(0);
    return {
      fixture_only: true,
      provider_enforcement: false,
      native_installation: false,
      real_keys_used: false,
      input: original,
      checks: {
        native_ssh_git_verification: true,
        subkey_only_import: true,
        usable_primary_secret_refused: true,
        rpm_body_preserved: true,
        rpm_expected_test_signer: true,
        missing_key_refused: true,
        changed_payload_refused: true,
        changed_header_refused: true,
        final_digest_changes: true,
        original_unchanged: true,
        ed25519_exact_bytes: true,
        altered_catalog_refused: true,
        receipt_domain_separated: true,
      },
      runtime: {
        node: process.version,
        rpm: (await command("/usr/bin/rpm", ["--version"])).toString().trim(),
        gpg: (await command("/usr/bin/gpg", ["--version"])).toString().split("\n")[0],
      },
    };
  } finally {
    passphrase.fill(0);
    await command("/usr/bin/gpgconf", ["--homedir", home, "--kill", "gpg-agent"]);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
export async function signingFixtureProbe(input, { resources = false } = {}) {
  if (!resources) return nativeSigningFixtureProbe(input);
  const { result, resource_observations } = await observeSigningResources(() =>
    nativeSigningFixtureProbe(input),
  );
  return { ...result, resource_observations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const resources = args.length === 2 && args[0] === "--resources";
  if (!(args.length === 1 || resources)) {
    process.stderr.write(
      "Use installation-signing-probe.mjs [--resources] <absolute-unsigned-fixture-rpm>.\n",
    );
    process.exitCode = 1;
  } else
    try {
      process.stdout.write(
        JSON.stringify(await signingFixtureProbe(args.at(-1), { resources }), null, 2) + "\n",
      );
    } catch (error) {
      if (resources)
        process.stdout.write(
          JSON.stringify(
            {
              fixture_only: true,
              status: "failed",
              code: error instanceof SigningError ? error.code : "operation_failed",
              resource_observations: error.resource_observations ?? null,
            },
            null,
            2,
          ) + "\n",
        );
      process.stderr.write("Disposable signing probe refused.\n");
      process.exitCode = 1;
    }
}
