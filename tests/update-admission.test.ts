import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogBytes,
  compareVersions,
  controlledUrl,
  digest,
  keyIdentity,
  nativeVersion,
  stagePackage,
  updateLimits,
  verifyCatalog,
  withAcceptanceState,
} from "../tooling/update-admission.mjs";
import {
  parseCampaignOptions,
  resumePolicy,
  renewalCatalog,
  renewalTrust,
} from "../tooling/installation-campaign.mjs";
const fixture = generateKeyPairSync("ed25519");
const pem = fixture.publicKey.export({ type: "spki", format: "pem" }).toString();
const keyId = keyIdentity(pem);
const bytes = Buffer.from("controlled qualification package\n");
const now = Date.now();
function example() {
  return {
    schema_version: 1,
    key_id: keyId,
    sequence: 1,
    issued_ms: now - 1000,
    expires_ms: now + 60000,
    candidate: "a".repeat(64),
    source_sha: "b".repeat(40),
    version: "0.1.0",
    channels: ["stable"],
    notes_sha256: "c".repeat(64),
    packages: [
      {
        target: "linux-x64",
        profile: "ubuntu-24.04",
        format: "deb",
        filename: "ohtia-0.1.0-linux-x64.deb",
        bytes: bytes.length,
        sha256: digest(bytes),
        native_version: "0.1.0-1",
        schema: { source_min: 0, source_max: 1, target: 1 },
        queued_work_version: null,
      },
    ],
  };
}
function context() {
  return {
    now_ms: now,
    channel: "stable",
    preview_opt_in: false,
    execution: "internal",
    previous: null,
    installed_version: "0.0.0",
    target: "linux-x64",
    profile: "ubuntu-24.04",
    format: "deb",
    schema: 0,
    queued_work_version: null,
  };
}
const trust = { keys: [{ id: keyId, public_key: pem, revoked: false }] };
function admission(catalog = example(), overrides = {}) {
  const encoded = catalogBytes(catalog);
  return verifyCatalog(encoded, sign(null, encoded, fixture.privateKey), trust, {
    ...context(),
    ...overrides,
  });
}
const directories: string[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
function temporary() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-update-test-")));
  directories.push(directory);
  return directory;
}
async function endpoint(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}/`;
}
describe("authenticated internal update admission", () => {
  it("binds exact candidate package bytes to an independently pinned Ed25519 key", () => {
    const result = admission();
    expect(result.entry.sha256).toBe(digest(bytes));
    expect(result.state.sequence).toBe(1);
    const encoded = catalogBytes(example());
    encoded[30] ^= 1;
    expect(() =>
      verifyCatalog(
        encoded,
        sign(null, catalogBytes(example()), fixture.privateKey),
        trust,
        context(),
      ),
    ).toThrow();
  });
  it("refuses unknown revoked and substituted trust roots and invalid signatures", () => {
    const encoded = catalogBytes(example()),
      signature = sign(null, encoded, fixture.privateKey);
    for (const keys of [
      [],
      [{ ...trust.keys[0], id: "f".repeat(64) }],
      [{ ...trust.keys[0], revoked: true }],
      [
        {
          ...trust.keys[0],
          public_key: generateKeyPairSync("ed25519")
            .publicKey.export({ type: "spki", format: "pem" })
            .toString(),
        },
      ],
    ])
      expect(() => verifyCatalog(encoded, signature, { keys }, context())).toThrow();
    expect(() => verifyCatalog(encoded, Buffer.alloc(64), trust, context())).toThrow("signature");
    expect(() => verifyCatalog(encoded, signature.subarray(0, 63), trust, context())).toThrow(
      "signature",
    );
  });
  it("rejects duplicate fields malformed UTF-8 unknown fields and overlong catalogs before trust", () => {
    for (const encoded of [
      Buffer.from('{"schema_version":1,"schema_version":1}\n'),
      Buffer.from([0xff]),
      Buffer.alloc(updateLimits.catalog_bytes + 1),
      Buffer.from(JSON.stringify(example())),
    ])
      expect(() => verifyCatalog(encoded, Buffer.alloc(64), trust, context())).toThrow();
    expect(() => admission({ ...example(), extra: true })).toThrow("fields");
    expect(() => admission({ ...example(), schema_version: 2 })).toThrow("catalog_version");
  });
  it("enforces finite validity clock monotonicity and bounded offline first use", () => {
    for (const overrides of [
      { now_ms: 0 },
      { now_ms: NaN },
      { now_ms: now - 2000 },
      { now_ms: now + 60000 },
    ])
      expect(() => admission(example(), overrides)).toThrow();
    expect(() =>
      admission({ ...example(), expires_ms: now + updateLimits.catalog_lifetime_ms + 1 }),
    ).toThrow("clock_or_expiry");
    const previous = admission().state;
    expect(() =>
      admission(example(), { previous: { ...previous, last_accepted_ms: now + 1 } }),
    ).toThrow("clock_or_state");
    expect(admission(example(), { previous }).state.catalog_sha256).toBe(previous.catalog_sha256);
  });
  it("retains sequence and version high-water marks across failed attempts and reinstall", () => {
    const previous = admission().state;
    expect(() => admission({ ...example(), notes_sha256: "e".repeat(64) }, { previous })).toThrow(
      "replay",
    );
    expect(() =>
      admission(
        {
          ...example(),
          sequence: 2,
          version: "0.0.1",
          packages: [{ ...example().packages[0], native_version: "0.0.1-1" }],
        },
        { previous },
      ),
    ).toThrow("downgrade");
    expect(() => admission(example(), { installed_version: "0.2.0" })).toThrow("downgrade");
  });
  it("requires external preview opt-in and never selects a prerelease for stable", () => {
    const preview = {
      ...example(),
      version: "0.1.0-beta.10",
      channels: ["preview"],
      packages: [{ ...example().packages[0], native_version: "0.1.0~beta.10-1" }],
    };
    expect(() => admission(preview)).toThrow("channel");
    expect(() => admission(preview, { channel: "preview" })).toThrow("preview_opt_in");
    expect(admission(preview, { channel: "preview", preview_opt_in: true }).catalog.version).toBe(
      preview.version,
    );
    expect(() =>
      admission(
        { ...preview, channels: ["stable", "preview"] },
        { channel: "preview", preview_opt_in: true },
      ),
    ).toThrow("stable_prerelease");
    for (const execution of ["development", "distribution", "preview", undefined])
      expect(() => admission(example(), { execution })).toThrow("internal_only");
  });
  it("rejects wrong CPU distribution package schema and queued-work contracts", () => {
    for (const overrides of [
      { target: "linux-arm64" },
      { profile: "fedora-44" },
      { format: "rpm" },
      { schema: 2 },
      { schema: true },
      { queued_work_version: 1 },
    ])
      expect(() => admission(example(), overrides)).toThrow();
    expect(() =>
      admission({ ...example(), packages: [{ ...example().packages[0], profile: "fedora-44" }] }),
    ).toThrow("profile");
    expect(() =>
      admission({ ...example(), packages: [example().packages[0], example().packages[0]] }),
    ).toThrow("duplicate_package");
    for (const filename of [
      "../package.deb",
      "x/y.deb",
      "x%2f.deb",
      "x.deb?key=secret",
      "-bad.deb",
    ])
      expect(() =>
        admission({ ...example(), packages: [{ ...example().packages[0], filename }] }),
      ).toThrow("filename");
  });
  it("admits macOS 26 and 27 catalog payloads without claiming platform identity", () => {
    for (const profile of ["macos-26", "macos-27"]) {
      const catalog = {
        ...example(),
        packages: [
          {
            ...example().packages[0],
            target: "darwin-arm64",
            profile,
            format: "zip",
            filename: "ohtia.zip",
            native_version: "0.1.0",
          },
        ],
      };
      expect(
        admission(catalog, { target: "darwin-arm64", profile, format: "zip" }).entry.profile,
      ).toBe(profile);
    }
  });
  it("matches numeric SemVer prereleases and maps them to Debian and RPM tilde versions", () => {
    const versions = [
      "0.1.0-beta.2",
      "0.1.0-beta.10",
      "0.1.0-dev.2.1",
      "0.1.0-dev.10.1",
      "0.1.0",
      "0.2.0",
    ];
    for (let i = 0; i < versions.length - 1; i++) {
      expect(compareVersions(versions[i], versions[i + 1])).toBe(-1);
      expect(compareVersions(versions[i + 1], versions[i])).toBe(1);
    }
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(nativeVersion("0.1.0-beta.10")).toBe("0.1.0~beta.10-1");
    for (const version of [
      "01.0.0",
      "1.0.0+build.1",
      "1.0.0-alpha.1",
      "1.0.0-dev.1",
      "1.0.0-beta.1.2",
      "1.0.0-beta.01",
      "99999999999999999.0.0",
    ])
      expect(() => nativeVersion(version)).toThrow();
  });
  it("excludes public endpoints redirects credentials and query-controlled artifact names", async () => {
    for (const url of [
      "https://example.org/",
      "http://localhost/",
      "http://127.0.0.1/path/",
      "http://user@127.0.0.1/",
      "http://127.0.0.1/?token=x",
    ])
      expect(() => controlledUrl(url, "x.deb")).toThrow("controlled_endpoint");
    const url = await endpoint((_request, response) => {
      response.writeHead(302, { Location: "https://example.org/" });
      response.end();
    });
    await expect(stagePackage(admission(), url, temporary())).rejects.toThrow("staging_failed");
  });
  it("streams exact bytes to a private new file and refuses an unverified capability", async () => {
    const url = await endpoint((_request, response) => {
      response.writeHead(200, { "Content-Length": bytes.length });
      response.end(bytes);
    });
    const parent = temporary(),
      admitted = admission();
    admitted.entry.sha256 = "d".repeat(64);
    const result = await stagePackage(admitted, url, parent);
    expect(fs.readFileSync(result.file)).toEqual(bytes);
    expect(result.sha256).toBe(digest(bytes));
    await expect(stagePackage({ ...admitted }, url, parent)).rejects.toThrow("unverified_catalog");
  });
  it("never publishes partial truncated corrupt compressed or oversized downloads", async () => {
    for (const payload of [
      Buffer.from("corrupt"),
      Buffer.alloc(bytes.length + 1),
      bytes.subarray(0, 3),
    ]) {
      const url = await endpoint((_request, response) => response.end(payload));
      const parent = temporary();
      await expect(stagePackage(admission(), url, parent)).rejects.toThrow("staging_failed");
      const directory = path.join(parent, fs.readdirSync(parent)[0]);
      expect(fs.readdirSync(directory)).toEqual(["package.partial"]);
    }
    const url = await endpoint((_request, response) => {
      response.setHeader("Content-Encoding", "gzip");
      response.end(bytes);
    });
    await expect(stagePackage(admission(), url, temporary())).rejects.toThrow("staging_failed");
  });
  it("preserves prior installation and acceptance inputs on interrupted download", async () => {
    const url = await endpoint((_request, response) => {
      response.write(bytes.subarray(0, 4));
    });
    const parent = temporary(),
      sentinel = path.join(parent, "previous-installation");
    fs.writeFileSync(sentinel, "previous");
    const admitted = admission(),
      state = structuredClone(admitted.state);
    const controller = new AbortController();
    const pending = stagePackage(admitted, url, parent, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow("staging_failed");
    expect(fs.readFileSync(sentinel, "utf8")).toBe("previous");
    expect(admitted.state).toEqual(state);
  });
  it("durably retains replay state before staging and refuses concurrent or missing-state resumption", async () => {
    const parent = temporary(),
      directory = path.join(parent, "state");
    fs.mkdirSync(directory, { mode: 0o700 });
    const admitted = admission();
    await expect(
      withAcceptanceState(
        directory,
        true,
        async (previous, persist, lease) => {
          expect(previous).toBe(null);
          expect(
            JSON.parse(fs.readFileSync(path.join(directory, "operation.lock"), "utf8")),
          ).toEqual(lease);
          expect(lease.pid).toBe(process.pid);
          persist(admitted);
          await expect(withAcceptanceState(directory, false, async () => {})).rejects.toThrow();
          throw new Error("interruption after catalog acceptance");
        },
        { pid: -1 },
      ),
    ).rejects.toThrow("interruption after catalog acceptance");
    await withAcceptanceState(directory, false, async (previous) =>
      expect(previous.catalog_sha256).toBe(admitted.state.catalog_sha256),
    );
    await expect(withAcceptanceState(directory, true, async () => {})).rejects.toThrow(
      "state_initialization",
    );
    fs.unlinkSync(path.join(directory, "accepted.json"));
    await expect(withAcceptanceState(directory, false, async () => {})).rejects.toThrow(
      "state_initialization",
    );
  });
  it("retains the synchronized owner after ordinary persistence failure or operator timeout", async () => {
    for (const failure of ["persistence", "operator"] as const) {
      const directory = path.join(temporary(), "acceptance");
      fs.mkdirSync(directory, { mode: 0o700 });
      if (failure === "persistence")
        vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
          throw Object.assign(new Error("no space"), { code: "ENOSPC" });
        });
      await expect(
        withAcceptanceState(
          directory,
          true,
          async (_previous, persist) => {
            persist(admission());
            throw Object.assign(new Error("native command may still run"), {
              code: "operator_in_progress",
            });
          },
          { owner: { synthetic: "birth identity" } },
        ),
      ).rejects.toThrow();
      const lease = JSON.parse(fs.readFileSync(path.join(directory, "operation.lock"), "utf8"));
      expect(lease.pid).toBe(process.pid);
      expect(lease.owner).toEqual({ synthetic: "birth identity" });
      expect(
        fs.existsSync(
          path.join(directory, failure === "persistence" ? "accepted.partial" : "accepted.json"),
        ),
      ).toBe(true);
      await expect(withAcceptanceState(directory, false, async () => {})).rejects.toThrow();
    }
  });
  it("admits a development first installation with no prior executable while preserving the final-version downgrade guard", () => {
    const catalog = {
      ...example(),
      version: "0.0.0-dev.27.1",
      channels: ["preview"],
      packages: [{ ...example().packages[0], native_version: "0.0.0~dev.27.1-1" }],
    };
    expect(
      admission(catalog, { installed_version: null, channel: "preview", preview_opt_in: true })
        .catalog.version,
    ).toBe(catalog.version);
    expect(() =>
      admission(catalog, { installed_version: "0.0.0", channel: "preview", preview_opt_in: true }),
    ).toThrow("downgrade");
  });
});

describe("retained internal campaign recovery", () => {
  it("accepts explicit flags in either order and rejects ambiguous or duplicate options", () => {
    const a = parseCampaignOptions(["--operator-installation", "--continue-from", "/evidence"]);
    const b = parseCampaignOptions(["--continue-from", "/evidence", "--operator-installation"]);
    expect(a).toEqual(b);
    for (const flags of [
      ["--resume", "--resume"],
      ["--unknown"],
      ["--continue-from"],
      ["--resume", "--continue-from", "/evidence"],
    ])
      expect(() => parseCampaignOptions(flags)).toThrow();
  });
  it("resumes an accepted second package without rechecking the superseded first installed payload", () => {
    const attempts = [
      { attempt: 1, version: "0.1.0", phase: "complete" },
      { attempt: 2, version: "0.2.0", phase: "install_requested" },
    ];
    const confirmations = new Map([[1, { status: "passed", package: { version: "0.1.0" } }]]);
    expect(resumePolicy(attempts, confirmations, 2, 2)).toEqual({
      lastConfirmedAttempt: 1,
      complete: false,
    });
    confirmations.set(2, { status: "passed", package: { version: "0.2.0" } });
    expect(resumePolicy(attempts, confirmations, 2, 2)).toEqual({
      lastConfirmedAttempt: 2,
      complete: true,
    });
  });
  it("refuses replay of uncertain graphical mutations, mismatched receipts and superseded campaigns", () => {
    const attempts = [{ attempt: 1, version: "0.1.0", phase: "observing" }];
    expect(() => resumePolicy(attempts, new Map(), 1, 1)).toThrow("uncertain");
    expect(() =>
      resumePolicy(
        attempts,
        new Map([[1, { status: "passed", package: { version: "0.2.0" } }]]),
        1,
        1,
      ),
    ).toThrow("changed");
    expect(() => resumePolicy(attempts, new Map(), 2, 1)).toThrow("superseded");
  });
});

describe("explicit internal catalog renewal", () => {
  it("renews expiry and sequence while preserving every package and build identity", () => {
    const old = example(),
      keys = generateKeyPairSync("ed25519"),
      public_key = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const renewed = renewalCatalog(
      old,
      keyIdentity(public_key),
      old.sequence + 1,
      old.expires_ms + 1000,
    );
    expect(renewed.packages).toEqual(old.packages);
    expect(renewed.candidate).toBe(old.candidate);
    expect(renewed.source_sha).toBe(old.source_sha);
    expect(renewed.version).toBe(old.version);
    const bytes = catalogBytes(renewed),
      signature = sign(null, bytes, keys.privateKey);
    expect(() =>
      verifyCatalog(bytes, signature, trust, { ...context(), now_ms: renewed.issued_ms }),
    ).toThrow("untrusted_key");
    expect(
      verifyCatalog(
        bytes,
        signature,
        { keys: [{ id: renewed.key_id, public_key, revoked: false }] },
        { ...context(), now_ms: renewed.issued_ms, previous: admission().state },
      ).state.sequence,
    ).toBe(2);
    expect(() => renewalCatalog(old, renewed.key_id, old.sequence, now)).toThrow();
    expect(() => renewalCatalog(old, renewed.key_id, 2, 1)).toThrow();
  });
  it("keeps old and new signing roots trusted through each durable renewal handoff", () => {
    const keys = generateKeyPairSync("ed25519"),
      public_key = keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      newKey = { id: keyIdentity(public_key), public_key, revoked: false },
      handoff = renewalTrust(trust, newKey),
      old = example(),
      renewed = renewalCatalog(old, newKey.id, 2, now);
    expect(
      verifyCatalog(
        catalogBytes(old),
        sign(null, catalogBytes(old), fixture.privateKey),
        handoff,
        context(),
      ).state.sequence,
    ).toBe(1);
    expect(
      verifyCatalog(
        catalogBytes(renewed),
        sign(null, catalogBytes(renewed), keys.privateKey),
        handoff,
        context(),
      ).state.sequence,
    ).toBe(2);
    const pruned = renewalTrust(handoff, newKey, new Set([newKey.id]));
    expect(pruned.keys.map((key) => key.id)).toEqual([newKey.id]);
    expect(
      verifyCatalog(
        catalogBytes(renewed),
        sign(null, catalogBytes(renewed), keys.privateKey),
        pruned,
        context(),
      ).state.sequence,
    ).toBe(2);
  });
  it("makes dirty inputs part of the signed candidate even with an unchanged base commit", () => {
    const first = {
      inputs: { source_sha: "a".repeat(40), files: { "module.mjs": "b".repeat(64) } },
      contracts: {
        target_schema: 2,
        migration_manifest_sha256: "c".repeat(64),
        versions: ["0.0.0-dev.27.1", "0.0.0-dev.27.2"],
      },
    };
    const second = structuredClone(first);
    second.inputs.files["module.mjs"] = "d".repeat(64);
    expect(digest(catalogBytes(first))).not.toBe(digest(catalogBytes(second)));
    expect(digest(catalogBytes(first))).toBe(
      digest(catalogBytes({ contracts: first.contracts, inputs: first.inputs })),
    );
  });
});
