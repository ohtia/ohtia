import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareSigningRequest, loadSignedCatalogs } from "../tooling/installation-signing.mjs";
import {
  assertCampaignSigning,
  parseCampaignOptions,
  withCampaignAcceptance,
  readCampaignSnapshot,
  admitPendingCatalog,
  resumePolicy,
} from "../tooling/installation-campaign.mjs";
import { catalogBytes, digest, keyIdentity, updateLimits } from "../tooling/update-admission.mjs";

const key = generateKeyPairSync("ed25519");
const pem = key.publicKey.export({ type: "spki", format: "pem" }).toString();
const keyId = keyIdentity(pem);
const now = 1_790_000_000_000;
const directories: string[] = [];
const leaseDetails = { owner: { pid: process.pid } };
type TestCatalog = {
  candidate: string;
  source_sha: string;
  version: string;
  sequence: number;
  notes_sha256: string;
  packages: { native_version: string; sha256: string; schema: { source_min: number } }[];
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-signing-test-")),
  );
  directories.push(root);
  const build = path.join(root, "build é");
  const request = path.join(root, "signature request");
  const publicKey = path.join(root, "catalog-public.pem");
  fs.mkdirSync(build);
  fs.writeFileSync(publicKey, pem);
  const inputs = { source_sha: "a".repeat(40), files: { "reviewed-source.ts": "b".repeat(64) } };
  const contracts = {
    versions: ["0.0.0-dev.42.1", "0.0.0-dev.42.2"],
    target_schema: 2,
    migration_manifest_sha256: "c".repeat(64),
  };
  const cell = { target: "linux-x64", profile: "fedora-44", formats: ["rpm"] };
  for (const [name, value] of Object.entries({ inputs, contracts, cell }))
    fs.writeFileSync(path.join(build, `${name}.json`), JSON.stringify(value));
  for (let attempt = 1; attempt <= 2; attempt++) {
    const directory = path.join(build, `build-${attempt}/packages`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, `package-${attempt}.rpm`),
      `synthetic package ${attempt}\n`,
    );
  }
  return { root, build, request, publicKey, inputs, contracts, cell };
}
function retainedAcceptance(root: string) {
  const directory = path.join(root, "acceptance");
  fs.mkdirSync(directory, { mode: 0o700 });
  const bytes = catalogBytes({
    sequence: 4,
    catalog_sha256: "f".repeat(64),
    highest_version: "0.0.0-dev.41.2",
    last_accepted_ms: now,
  });
  fs.writeFileSync(path.join(directory, "accepted.json"), bytes, { mode: 0o600 });
  return { directory, bytes };
}
function signCatalogs(request: string) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const bytes = fs.readFileSync(path.join(request, `catalog-${attempt}.json`));
    fs.writeFileSync(
      path.join(request, `catalog-${attempt}.sig`),
      sign(null, bytes, key.privateKey),
    );
  }
}
async function prepared() {
  const result = fixture();
  await prepareSigningRequest(result.build, result.request, result.publicKey, keyId, 5, now);
  signCatalogs(result.request);
  return result;
}
function load(value: ReturnType<typeof fixture>, options = {}) {
  return loadSignedCatalogs(value.build, value.request, value.publicKey, keyId, {
    now,
    ...options,
  });
}
function rewriteFirst(request: string, change: (catalog: TestCatalog) => void) {
  const file = path.join(request, "catalog-1.json");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  change(value);
  const bytes = catalogBytes(value);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(path.join(request, "catalog-1.sig"), sign(null, bytes, key.privateKey));
}

describe("externally signed internal installation catalogs", () => {
  it("prepares only unsigned canonical requests bound to both exact final packages", async () => {
    const value = fixture();
    const original = fs.readFileSync(path.join(value.build, "build-1/packages/package-1.rpm"));
    await prepareSigningRequest(value.build, value.request, value.publicKey, keyId, 5, now);
    expect(fs.readdirSync(value.request).sort()).toEqual([
      "catalog-1.json",
      "catalog-2.json",
      "request.json",
    ]);
    const bytes = fs.readFileSync(path.join(value.request, "catalog-1.json"));
    const catalog = JSON.parse(bytes.toString());
    expect(bytes.equals(catalogBytes(catalog))).toBe(true);
    expect(catalog.packages[0].sha256).toBe(digest(original));
    expect(catalog.candidate).toBe(
      digest(catalogBytes({ inputs: value.inputs, contracts: value.contracts })),
    );
    expect(catalog.sequence).toBe(5);
    expect(
      JSON.parse(fs.readFileSync(path.join(value.request, "catalog-2.json"), "utf8")).sequence,
    ).toBe(6);
    expect(
      fs.readFileSync(path.join(value.build, "build-1/packages/package-1.rpm")).equals(original),
    ).toBe(true);
  });
  it("loads supplied signatures against the independently pinned public key", async () => {
    const value = await prepared();
    const result = await load(value);
    expect(result.key_id).toBe(keyId);
    expect(result.trust.keys).toEqual([{ id: keyId, public_key: pem, revoked: false }]);
    expect(result.catalogs.map((item: { signature: Buffer }) => item.signature.length)).toEqual([
      64, 64,
    ]);
    const first = Buffer.from(result.catalogs[0].bytes);
    fs.writeFileSync(path.join(value.request, "catalog-1.json"), "changed afterwards");
    expect(result.catalogs[0].bytes.equals(first)).toBe(true);
  });
  it("refuses a substituted public key fingerprint and private PEM input before output", async () => {
    const value = fixture();
    await expect(
      prepareSigningRequest(value.build, value.request, value.publicKey, "f".repeat(64), 1, now),
    ).rejects.toThrow("independent fingerprint");
    expect(fs.existsSync(value.request)).toBe(false);
    fs.writeFileSync(value.publicKey, key.privateKey.export({ type: "pkcs8", format: "pem" }));
    await expect(
      prepareSigningRequest(value.build, value.request, value.publicKey, keyId, 1, now),
    ).rejects.toThrow("public SPKI");
    expect(fs.existsSync(value.request)).toBe(false);
  });
  it("refuses changed package bytes and dirty source inputs after request preparation", async () => {
    const value = await prepared();
    const file = path.join(value.build, "build-2/packages/package-2.rpm");
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, "changed package\n");
    await expect(load(value)).rejects.toThrow("exact final packages");
    fs.writeFileSync(file, original);
    fs.writeFileSync(
      path.join(value.build, "inputs.json"),
      JSON.stringify({ ...value.inputs, changed: true }),
    );
    await expect(load(value)).rejects.toThrow("selected build or key");
  });
  it("refuses valid signatures over catalogs with substituted build ordering or package contracts", async () => {
    const changes = [
      (catalog: TestCatalog) => {
        catalog.candidate = "d".repeat(64);
      },
      (catalog: TestCatalog) => {
        catalog.source_sha = "d".repeat(40);
      },
      (catalog: TestCatalog) => {
        catalog.version = "0.0.0-dev.42.2";
        catalog.packages[0].native_version = "0.0.0~dev.42.2-1";
      },
      (catalog: TestCatalog) => {
        catalog.sequence = 6;
      },
      (catalog: TestCatalog) => {
        catalog.packages[0].sha256 = "d".repeat(64);
      },
      (catalog: TestCatalog) => {
        catalog.packages[0].schema.source_min = 1;
      },
      (catalog: TestCatalog) => {
        catalog.notes_sha256 = "d".repeat(64);
      },
    ];
    for (const change of changes) {
      const value = await prepared();
      rewriteFirst(value.request, change);
      await expect(load(value)).rejects.toThrow("exact final packages or build contract");
    }
  });
  it("refuses missing truncated invalid signatures and noncanonical requests", async () => {
    const value = await prepared();
    const signature = path.join(value.request, "catalog-2.sig");
    fs.unlinkSync(signature);
    await expect(load(value)).rejects.toThrow();
    for (const bytes of [Buffer.alloc(63), Buffer.alloc(64), Buffer.alloc(65)]) {
      fs.writeFileSync(signature, bytes);
      await expect(load(value)).rejects.toThrow();
    }
    signCatalogs(value.request);
    const request = path.join(value.request, "request.json");
    const metadata = JSON.parse(fs.readFileSync(request, "utf8"));
    fs.writeFileSync(request, JSON.stringify(metadata));
    await expect(load(value)).rejects.toThrow("noncanonical request");
  });
  it("authenticates expired retained metadata without admitting a fresh expired operation", async () => {
    const value = await prepared();
    const late = now + updateLimits.catalog_lifetime_ms + 1;
    await expect(load(value, { now: late })).rejects.toThrow("clock_or_expiry");
    const retained = await load(value, { now: late, allowExpired: true });
    vi.spyOn(Date, "now").mockReturnValue(late);
    const { directory, bytes: acceptedBytes } = retainedAcceptance(value.root);
    const campaign = {
      inputs: value.inputs,
      contracts: value.contracts,
      signing: { kind: "external", key_id: keyId, request_sha256: retained.request_sha256 },
      attempts: value.contracts.versions.map((version, index) => ({
        attempt: index + 1,
        version,
        phase: "prepared",
        catalogName: `catalog-${index + 1}.json`,
        signatureName: `catalog-${index + 1}.sig`,
      })),
    };
    let mutations = 0;
    await expect(
      withCampaignAcceptance(
        directory,
        false,
        {
          resume: true,
          inputs: value.inputs,
          contracts: value.contracts,
          external: retained,
          readRetained: () => ({ campaign, trust: retained.trust }),
        },
        async (_, persist, __, snapshot) => {
          const planned = snapshot.campaign.attempts[0];
          const read = (name: string) => fs.readFileSync(path.join(value.request, name));
          const admitted = admitPendingCatalog(
            readCampaignSnapshot(read, planned, retained, "catalog"),
            readCampaignSnapshot(read, planned, retained, "signature"),
            snapshot.trust,
            {
              execution: "internal",
              channel: "preview",
              preview_opt_in: true,
              previous: null,
              installed_version: null,
              target: "linux-x64",
              profile: "fedora-44",
              format: "rpm",
              schema: 2,
              queued_work_version: null,
            },
          );
          persist(admitted);
          mutations++;
        },
        leaseDetails,
      ),
    ).rejects.toThrow("clock_or_expiry");
    expect(mutations).toBe(0);
    expect(fs.readFileSync(path.join(directory, "accepted.json")).equals(acceptedBytes)).toBe(true);
  });
  it("preserves existing requests and refuses ambiguous or linked package inputs", async () => {
    const value = await prepared();
    const request = fs.readFileSync(path.join(value.request, "request.json"));
    await expect(
      prepareSigningRequest(value.build, value.request, value.publicKey, keyId, 5, now),
    ).rejects.toThrow();
    expect(fs.readFileSync(path.join(value.request, "request.json")).equals(request)).toBe(true);
    const extra = path.join(value.build, "build-1/packages/extra.rpm");
    fs.writeFileSync(extra, "ambiguous package");
    await expect(load(value)).rejects.toThrow("missing or ambiguous final package");
    fs.unlinkSync(extra);
    const packagePath = path.join(value.build, "build-1/packages/package-1.rpm");
    fs.linkSync(packagePath, path.join(value.root, "package-hardlink"));
    await expect(load(value)).rejects.toThrow("ordinary file with one link");
  });
  it("requires complete external signing flags and forbids implicit ephemeral renewal", () => {
    const flags = [
      "--signed-catalogs",
      "/requests",
      "--catalog-public-key",
      "/public.pem",
      "--catalog-key-id",
      keyId,
    ];
    expect(
      parseCampaignOptions([...flags, "--operator-installation", "--resume"]).externalSigning,
    ).toEqual({ directory: "/requests", publicKey: "/public.pem", keyId });
    expect(() => parseCampaignOptions(flags.slice(0, 2))).toThrow("together");
    expect(() => parseCampaignOptions([...flags, "--resume", "--renew-catalogs"])).toThrow(
      "cannot renew",
    );
    expect(() => parseCampaignOptions([...flags, "--catalog-key-id", keyId])).toThrow("duplicate");
  });
  it("binds resume to the complete version order original signing mode request and public trust", async () => {
    const value = await prepared();
    const external = await load(value);
    const campaign = {
      contracts: value.contracts,
      signing: {
        kind: "external",
        key_id: external.key_id,
        request_sha256: external.request_sha256,
      },
      attempts: value.contracts.versions.map((version, index) => ({
        attempt: index + 1,
        version,
        catalogName: `catalog-${index + 1}.json`,
        signatureName: `catalog-${index + 1}.sig`,
      })),
    };
    expect(() => assertCampaignSigning(campaign, external, external.trust)).not.toThrow();
    for (const attempts of [
      campaign.attempts.slice(0, 1),
      [...campaign.attempts].reverse(),
      [campaign.attempts[0], campaign.attempts[0]],
    ])
      expect(() =>
        assertCampaignSigning({ ...campaign, attempts }, external, external.trust),
      ).toThrow("version order");
    expect(() => assertCampaignSigning(campaign, null, null)).toThrow(
      "original external signing mode",
    );
    expect(() =>
      assertCampaignSigning({ ...campaign, signing: null }, external, external.trust),
    ).toThrow("original external signing mode");
    expect(() =>
      assertCampaignSigning(
        campaign,
        { ...external, request_sha256: "f".repeat(64) },
        external.trust,
      ),
    ).toThrow("original external request");
    expect(() => assertCampaignSigning(campaign, external, { keys: [] })).toThrow(
      "pinned public key",
    );
    const changed = structuredClone(campaign);
    changed.attempts[1].signatureName = "replacement.sig";
    expect(() => assertCampaignSigning(changed, external, external.trust)).toThrow(
      "metadata changed",
    );
    expect(() =>
      assertCampaignSigning(
        { contracts: value.contracts, attempts: campaign.attempts },
        null,
        null,
      ),
    ).not.toThrow();
  });
  it("reads the latest retained phase and trust under the native acceptance lease", async () => {
    const value = await prepared();
    const external = await load(value);
    const { directory, bytes: acceptedBytes } = retainedAcceptance(value.root);
    const file = path.join(value.root, "campaign.json");
    const campaign = {
      inputs: value.inputs,
      contracts: value.contracts,
      signing: { kind: "external", key_id: keyId, request_sha256: external.request_sha256 },
      attempts: value.contracts.versions.map((version, index) => ({
        attempt: index + 1,
        version,
        catalogName: `catalog-${index + 1}.json`,
        signatureName: `catalog-${index + 1}.sig`,
        phase: "prepared",
      })),
    };
    fs.writeFileSync(file, JSON.stringify(campaign));
    // A resume begins with the old phase; another owner publishes before it takes the lease.
    const stale = JSON.parse(fs.readFileSync(file, "utf8"));
    campaign.attempts[0].phase = "observing";
    fs.writeFileSync(file, JSON.stringify(campaign));
    let mutations = 0;
    const context = {
      resume: true,
      inputs: value.inputs,
      contracts: value.contracts,
      external,
      readRetained: () => {
        expect(fs.existsSync(path.join(directory, "operation.lock"))).toBe(true);
        return { campaign: JSON.parse(fs.readFileSync(file, "utf8")), trust: external.trust };
      },
    };
    expect(stale.attempts[0].phase).toBe("prepared");
    await expect(
      withCampaignAcceptance(
        directory,
        false,
        context,
        async (_, __, ___, retained) => {
          resumePolicy(retained.campaign.attempts, new Map(), 0, 6);
          mutations++;
        },
        leaseDetails,
      ),
    ).rejects.toThrow("uncertain");
    expect(mutations).toBe(0);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).attempts[0].phase).toBe("observing");
    const operation = vi.fn();
    await expect(
      withCampaignAcceptance(
        directory,
        false,
        {
          ...context,
          readRetained: () => ({ campaign, trust: { keys: [] } }),
        },
        operation,
        leaseDetails,
      ),
    ).rejects.toThrow("pinned public key");
    await expect(
      withCampaignAcceptance(
        directory,
        false,
        {
          ...context,
          readRetained: () => ({ campaign: { ...campaign, inputs: {} }, trust: external.trust }),
        },
        operation,
        leaseDetails,
      ),
    ).rejects.toThrow("inputs changed");
    expect(operation).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(directory, "operation.lock"))).toBe(false);
    expect(fs.readFileSync(path.join(directory, "accepted.json")).equals(acceptedBytes)).toBe(true);
  });
  it("refuses external sequences at or below the persisted floor before campaign creation", async () => {
    const value = await prepared();
    const external = await load(value);
    const directory = path.join(value.root, "acceptance");
    fs.mkdirSync(directory, { mode: 0o700 });
    const operation = vi.fn();
    for (const sequence of [5, 6]) {
      const bytes = catalogBytes({
        sequence,
        catalog_sha256: "a".repeat(64),
        highest_version: value.contracts.versions[0],
        last_accepted_ms: now,
      });
      fs.writeFileSync(path.join(directory, "accepted.json"), bytes, { mode: 0o600 });
      await expect(
        withCampaignAcceptance(
          directory,
          false,
          { resume: false, external },
          operation,
          leaseDetails,
        ),
      ).rejects.toThrow("advance the retained acceptance floor");
      expect(fs.readFileSync(path.join(directory, "accepted.json")).equals(bytes)).toBe(true);
    }
    expect(operation).not.toHaveBeenCalled();
    fs.writeFileSync(
      path.join(directory, "accepted.json"),
      catalogBytes({
        sequence: 4,
        catalog_sha256: "a".repeat(64),
        highest_version: "0.0.0-dev.41.2",
        last_accepted_ms: now,
      }),
    );
    await withCampaignAcceptance(
      directory,
      false,
      { resume: false, external },
      operation,
      leaseDetails,
    );
    expect(operation).toHaveBeenCalledOnce();
  });
  it("refuses substituted retained catalog and signature snapshots on the journey read path", async () => {
    const value = await prepared();
    const external = await load(value);
    const planned = { attempt: 1, catalogName: "catalog-1.json", signatureName: "catalog-1.sig" };
    const read = (name: string) => fs.readFileSync(path.join(value.request, name));
    for (const kind of ["catalog", "signature"]) {
      const name = kind === "catalog" ? planned.catalogName : planned.signatureName;
      const original = read(name);
      expect(readCampaignSnapshot(read, planned, external, kind).equals(original)).toBe(true);
      fs.writeFileSync(path.join(value.request, name), Buffer.alloc(original.length));
      expect(() => readCampaignSnapshot(read, planned, external, kind)).toThrow(
        "independently selected signed request",
      );
      fs.writeFileSync(path.join(value.request, name), original);
    }
  });
  it("rejects another controller owner before creating a native lease", async () => {
    const value = fixture();
    const directory = path.join(value.root, "acceptance");
    fs.mkdirSync(directory, { mode: 0o700 });
    const operation = vi.fn();
    const context = { resume: false, external: null };
    for (const owner of [null, {}, { pid: process.pid + 1 }]) {
      expect(() => withCampaignAcceptance(directory, true, context, operation, { owner })).toThrow(
        "owner differs",
      );
      expect(fs.existsSync(path.join(directory, "operation.lock"))).toBe(false);
    }
    expect(operation).not.toHaveBeenCalled();
    await withCampaignAcceptance(
      directory,
      true,
      context,
      async (_, __, lease) => {
        expect(lease.pid).toBe(process.pid);
        expect(lease.owner).toEqual(leaseDetails.owner);
        expect(fs.existsSync(path.join(directory, "operation.lock"))).toBe(true);
      },
      leaseDetails,
    );
    expect(fs.existsSync(path.join(directory, "operation.lock"))).toBe(false);
  });
  it("prepares a request through the CLI without accepting a private signing input", () => {
    const value = fixture();
    const script = path.resolve("tooling/installation-signing.mjs");
    const result = execFileSync(
      process.execPath,
      [script, value.build, value.request, value.publicKey, keyId, "5"],
      { encoding: "utf8" },
    );
    expect(JSON.parse(result).key_id).toBe(keyId);
    expect(fs.existsSync(path.join(value.request, "catalog-1.sig"))).toBe(false);
    expect(() =>
      execFileSync(
        process.execPath,
        [script, value.build, path.join(value.root, "invalid"), value.publicKey, keyId, "0x1"],
        { stdio: "pipe" },
      ),
    ).toThrow();
    expect(fs.existsSync(path.join(value.root, "invalid"))).toBe(false);
  });
  it("rejects invalid sequence clocks and nonincreasing build versions before creating a request", async () => {
    const value = fixture();
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER])
      await expect(
        prepareSigningRequest(value.build, value.request, value.publicKey, keyId, sequence, now),
      ).rejects.toThrow("sequence");
    await expect(
      prepareSigningRequest(
        value.build,
        value.request,
        value.publicKey,
        keyId,
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    ).rejects.toThrow("clock");
    fs.writeFileSync(
      path.join(value.build, "contracts.json"),
      JSON.stringify({ ...value.contracts, versions: [...value.contracts.versions].reverse() }),
    );
    await expect(
      prepareSigningRequest(value.build, value.request, value.publicKey, keyId, 1, now),
    ).rejects.toThrow("versions must increase");
    expect(fs.existsSync(value.request)).toBe(false);
  });
});
