import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { deflateSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { GitSourceAcquisition, sourceFetchRequest } from "../tooling/installation-source.mjs";
import { validateSourcePack } from "../tooling/installation-source-pack.mjs";
import {
  GitSourceAuthority,
  SigningDeadline,
  signingLimits,
} from "../tooling/installation-authority.mjs";

const roots: string[] = [];
const linuxIt = process.platform === "linux" ? it : it.skip;
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const packet = (text: string) =>
  Buffer.from((Buffer.byteLength(text) + 4).toString(16).padStart(4, "0") + text);

function header(type: number, length: number) {
  const bytes = [];
  let byte = type * 16 + (length % 16);
  length = Math.floor(length / 16);
  while (length) {
    bytes.push(byte | 128);
    byte = length % 128;
    length = Math.floor(length / 128);
  }
  bytes.push(byte);
  return Buffer.from(bytes);
}
function pack(
  entries: { type?: number; bytes: Buffer; declared?: number; base?: Buffer }[],
  extra = Buffer.alloc(0),
) {
  const top = Buffer.alloc(12);
  top.write("PACK");
  top.writeUInt32BE(2, 4);
  top.writeUInt32BE(entries.length, 8);
  const body = Buffer.concat([
    top,
    ...entries.flatMap((e) => [
      header(e.type ?? 3, e.declared ?? e.bytes.length),
      e.base ?? Buffer.alloc(0),
      deflateSync(e.bytes),
    ]),
    extra,
  ]);
  return Buffer.concat([body, createHash("sha1").update(body).digest()]);
}
const limits = { maximumBytes: 1024 * 1024, maximumObjects: 128 };
function native(program: string, args: string[], input?: Buffer) {
  const result = spawnSync(program, args, {
    input,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30000,
  });
  if (result.status !== 0)
    throw new Error("Synthetic Git producer failed: " + result.stderr.toString());
  return result.stdout;
}
function graph(signed = true) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-source-fixture-")));
  roots.push(root);
  const repo = path.join(root, "producer"),
    privateKey = path.join(root, "fixture-key");
  native("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", privateKey]);
  const git = (...args: string[]) =>
    native("/usr/bin/git", ["-C", repo, ...args])
      .toString()
      .trim();
  native("/usr/bin/git", ["init", "--initial-branch=main", "--quiet", repo]);
  git("config", "user.name", "Disposable source fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("commit", "--quiet", "--allow-empty", "-m", "Independent anchor");
  const anchor = git("rev-parse", "HEAD");
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ scripts: { prepare: `touch ${path.join(root, "must-never-run")}` } }),
  );
  fs.writeFileSync(path.join(repo, ".gitattributes"), "* filter=external merge=external\n");
  fs.writeFileSync(
    path.join(repo, ".gitmodules"),
    '[submodule "untrusted"]\npath = external\nurl = file:///must-never-read\n',
  );
  git("add", ".");
  git(
    "-c",
    "gpg.format=ssh",
    "-c",
    "user.signingkey=" + privateKey,
    "commit",
    "--quiet",
    ...(signed ? ["-S"] : []),
    "-m",
    "Fixture source",
  );
  const source = git("rev-parse", "HEAD"),
    tree = git("rev-parse", "HEAD^{tree}");
  const key = generateKeyPairSync("ed25519");
  const policy = {
    schema_version: 1,
    enabled: true,
    repository_id: "1431132416",
    owner_id: "346940169",
    audience: "ohtia:fixture",
    environment: "fixture",
    caller_workflow: ".github/workflows/installation-signing.yml",
    signing_workflow: { workflow: ".github/workflows/signing-worker.yml", sha: "c".repeat(40) },
    build_workflow: { workflow: ".github/workflows/signing-build.yml", sha: "d".repeat(40) },
    source_anchor: anchor,
    source_signers: [
      {
        principal: "fixture@example.invalid",
        public_key: fs
          .readFileSync(privateKey + ".pub", "utf8")
          .trim()
          .split(" ")
          .slice(0, 2)
          .join(" "),
      },
    ],
    catalog_public_key: key.publicKey.export({ format: "pem", type: "spki" }).toString(),
    rpm_primary: "1".repeat(40),
    rpm_subkey: "2".repeat(40),
    deployment: {
      provider: "scaleway-serverless-containers",
      region: "fr-par",
      container_id: "00000000-0000-0000-0000-000000000000",
      image_digest: "sha256:" + "0".repeat(64),
    },
  };
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const discovery = url.endsWith("/info/refs?service=git-upload-pack");
    const bytes = discovery
      ? Buffer.concat([
          packet("# service=git-upload-pack\n"),
          Buffer.from("0000"),
          native("/usr/bin/git", ["upload-pack", "--stateless-rpc", "--advertise-refs", repo]),
        ])
      : native("/usr/bin/git", ["upload-pack", "--stateless-rpc", repo], init.body as Buffer);
    return new Response(bytes, {
      headers: {
        "Content-Type": discovery
          ? "application/x-git-upload-pack-advertisement"
          : "application/x-git-upload-pack-result",
      },
    });
  };
  return { root, repo, git, source, tree, policy, calls, fetcher };
}

describe("source pack resource preflight", () => {
  it("counts raw and reconstructed bytes without importing an object", () => {
    const bytes = pack([{ bytes: Buffer.from("fixture") }, { bytes: Buffer.alloc(0) }]);
    expect(validateSourcePack(bytes, limits)).toMatchObject({
      objects: 2,
      inflated_bytes: 7,
      reconstructed_bytes: 7,
    });
  });
  it("accepts bounded OFS and REF delta encodings for native validation", () => {
    const base = Buffer.from("abc"),
      packedBase = Buffer.concat([header(3, 3), deflateSync(base)]);
    const delta = Buffer.from([3, 3, 0x90, 3]);
    expect(
      validateSourcePack(
        pack([{ bytes: base }, { type: 6, base: Buffer.from([packedBase.length]), bytes: delta }]),
        limits,
      ),
    ).toMatchObject({ objects: 2, reconstructed_bytes: 6 });
    expect(
      validateSourcePack(
        pack([{ bytes: base }, { type: 7, base: Buffer.alloc(20), bytes: delta }]),
        limits,
      ).reconstructed_bytes,
    ).toBe(6);
  });
  it("refuses an excessive object count before decompression", () => {
    expect(() =>
      validateSourcePack(pack([{ bytes: Buffer.from("a") }, { bytes: Buffer.from("b") }]), {
        ...limits,
        maximumObjects: 1,
      }),
    ).toThrow("size_refused");
  });
  it("refuses declared and actual inflation beyond its resource bound", () => {
    expect(() =>
      validateSourcePack(pack([{ bytes: Buffer.alloc(4096) }]), { ...limits, maximumBytes: 128 }),
    ).toThrow("size_refused");
    expect(() =>
      validateSourcePack(pack([{ bytes: Buffer.alloc(4096), declared: 5 }]), limits),
    ).toThrow("size_refused");
  });
  it("counts delta results independently of small instruction streams", () => {
    const delta = Buffer.from([
      64,
      0x80,
      0x20,
      ...Array.from({ length: 64 }, () => [0x90, 64]).flat(),
    ]);
    expect(() =>
      validateSourcePack(
        pack([
          { bytes: Buffer.alloc(64) },
          {
            type: 6,
            base: Buffer.from([header(3, 64).length + deflateSync(Buffer.alloc(64)).length]),
            bytes: delta,
          },
        ]),
        { ...limits, maximumBytes: 1024 },
      ),
    ).toThrow("size_refused");
  });
  it("rejects unsafe delta offsets and impossible reconstruction instructions", () => {
    for (const delta of [
      Buffer.from([3, 3, 0]),
      Buffer.from([3, 2, 0x90, 3]),
      Buffer.from([3, 3, 0x91, 3, 3]),
    ])
      expect(() =>
        validateSourcePack(
          pack([{ bytes: Buffer.from("abc") }, { type: 7, base: Buffer.alloc(20), bytes: delta }]),
          limits,
        ),
      ).toThrow("policy_refused");
    expect(() =>
      validateSourcePack(
        pack([{ type: 6, base: Buffer.from([1]), bytes: Buffer.from([0, 0]) }]),
        limits,
      ),
    ).toThrow("policy_refused");
  });
  it("refuses corruption, unknown types, truncation and trailing material", () => {
    const good = pack([{ bytes: Buffer.from("valid") }]);
    const bad = Buffer.from(good);
    bad[bad.length - 1] ^= 1;
    for (const bytes of [
      bad,
      good.subarray(0, good.length - 1),
      pack([{ type: 5, bytes: Buffer.from("x") }]),
      pack([{ bytes: Buffer.from("x") }], Buffer.from("extra")),
    ])
      expect(() => validateSourcePack(bytes, limits)).toThrow("policy_refused");
  });
});

describe("fixed source transport", () => {
  it("requests one exact SHA without thin packs or caller-selected transport", () => {
    expect(sourceFetchRequest("b".repeat(40)).toString()).toContain(
      "want " + "b".repeat(40) + " ofs-delta no-progress\n",
    );
    expect(sourceFetchRequest("b".repeat(40)).toString()).not.toContain("thin-pack");
    expect(() => sourceFetchRequest("refs/heads/main")).toThrow();
  });
  it("refuses nonliteral source identifiers before forming a transfer", () => {
    for (const source of ["refs/heads/main", "../objects", "a".repeat(40) + "\n", "A".repeat(40)])
      expect(() => sourceFetchRequest(source)).toThrow();
  });

  it("refuses redirects, incompatible response types and encoded bodies", async () => {
    for (const response of [
      new Response(null, { status: 302 }),
      new Response("wrong", { headers: { "Content-Type": "text/plain" } }),
      new Response("encoded", {
        headers: { "Content-Type": "fixture", "Content-Encoding": "gzip" },
      }),
    ]) {
      const acquisition = new GitSourceAcquisition({ fetcher: async () => response });
      await expect(
        acquisition.response(
          "/git-upload-pack",
          "fixture",
          100,
          {},
          new SigningDeadline(1000),
          () => {},
        ),
      ).rejects.toThrow();
    }
  });
  it("bounds streamed bytes independently of a missing Content-Length", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
      },
      cancel() {
        cancelled = true;
      },
    });
    const acquisition = new GitSourceAcquisition({
      fetcher: async () => new Response(body, { headers: { "Content-Type": "fixture" } }),
    });
    await expect(
      acquisition.response(
        "/git-upload-pack",
        "fixture",
        8,
        {},
        new SigningDeadline(1000),
        () => {},
      ),
    ).rejects.toThrow("size_refused");
    expect(cancelled).toBe(true);
  });
  it("refuses excessive or incomplete declared bodies", async () => {
    for (const length of ["101", "8"]) {
      const acquisition = new GitSourceAcquisition({
        fetcher: async () =>
          new Response("abc", { headers: { "Content-Type": "fixture", "Content-Length": length } }),
      });
      await expect(
        acquisition.response(
          "/git-upload-pack",
          "fixture",
          100,
          {},
          new SigningDeadline(1000),
          () => {},
        ),
      ).rejects.toThrow();
    }
  });
  it("ends a stalled response under the original monotonic deadline", async () => {
    const acquisition = new GitSourceAcquisition({
      fetcher: async () =>
        new Response(new ReadableStream({ start() {} }), {
          headers: { "Content-Type": "fixture" },
        }),
    });
    await expect(
      acquisition.response(
        "/git-upload-pack",
        "fixture",
        100,
        {},
        new SigningDeadline(30),
        () => {},
      ),
    ).rejects.toThrow("authority_unavailable");
  });
});

describe("native cold source verification", () => {
  linuxIt(
    "imports a complete pack and verifies signed history without running source files",
    async () => {
      const f = graph();
      f.git("branch", "révision", f.source);
      native(
        "/usr/bin/git",
        ["-C", f.repo, "update-ref", "--stdin"],
        Buffer.from(
          Array.from(
            { length: 1200 },
            (_, i) => `create refs/pull/${i + 1}/head ${f.source}\n`,
          ).join(""),
        ),
      );
      const paths: string[] = [];
      const acquisition = new GitSourceAcquisition({ fetcher: f.fetcher });
      const open = acquisition.open.bind(acquisition);
      acquisition.open = async (...args) => {
        const value = await open(...args);
        paths.push(value.repository);
        return value;
      };
      const result = await new GitSourceAuthority(f.policy, { acquisition }).inspect(
        f.source,
        f.tree,
      );
      expect(result.records).toMatchObject([{ commit: f.source, kind: "personal-signature" }]);
      expect(paths.every((p) => !fs.existsSync(p))).toBe(true);
      expect(fs.existsSync(path.join(f.root, "must-never-run"))).toBe(false);
      expect(f.calls.map((c) => c.url)).toEqual([
        "https://github.com/ohtia/ohtia.git/git-upload-pack",
      ]);
      expect(f.calls.every((c) => c.init.redirect === "error")).toBe(true);
    },
  );
  linuxIt("refuses unsigned fetched history and removes acquired objects", async () => {
    const f = graph(false),
      paths: string[] = [];
    const acquisition = new GitSourceAcquisition({ fetcher: f.fetcher });
    const open = acquisition.open.bind(acquisition);
    acquisition.open = async (...args) => {
      const value = await open(...args);
      paths.push(value.repository);
      return value;
    };
    await expect(
      new GitSourceAuthority(f.policy, { acquisition }).inspect(f.source, f.tree),
    ).rejects.toThrow("policy_refused");
    expect(paths.every((p) => !fs.existsSync(p))).toBe(true);
  });
  linuxIt("refuses an incorrect expected tree after cold acquisition", async () => {
    const f = graph();
    await expect(
      new GitSourceAuthority(f.policy, {
        acquisition: new GitSourceAcquisition({ fetcher: f.fetcher }),
      }).inspect(f.source, "0".repeat(40)),
    ).rejects.toThrow("policy_refused");
  });
  linuxIt("refuses a resource-hostile pack before native indexing", async () => {
    const f = graph(),
      wrapper = path.join(f.root, "git-wrapper"),
      log = path.join(f.root, "git-calls.jsonl");
    fs.writeFileSync(
      wrapper,
      `#!${process.execPath}\nconst fs=require('node:fs'),{spawnSync}=require('node:child_process');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');const r=spawnSync('/usr/bin/git',process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);\n`,
      { mode: 0o700 },
    );
    const malicious = pack([{ bytes: Buffer.from("x") }]);
    malicious.writeUInt32BE(signingLimits.source_acquisition_objects + 1, 8);
    createHash("sha1")
      .update(malicious.subarray(0, -20))
      .digest()
      .copy(malicious, malicious.length - 20);
    for (const rejected of [
      malicious,
      pack([{ bytes: Buffer.alloc(0), declared: signingLimits.source_acquisition_bytes + 1 }]),
    ]) {
      const acquisition = new GitSourceAcquisition({
        git: wrapper,
        fetcher: async (url, init) =>
          url.endsWith("/git-upload-pack")
            ? new Response(Buffer.concat([Buffer.from("0008NAK\n"), rejected]), {
                headers: { "Content-Type": "application/x-git-upload-pack-result" },
              })
            : f.fetcher(url, init),
      });
      await expect(acquisition.open(f.source)).rejects.toThrow("size_refused");
    }
    for (const response of [
      packet("ERR unavailable\n"),
      packet("ERR upload-pack: not our ref " + f.source + "\n"),
      Buffer.from("0008ACK\n"),
    ]) {
      const acquisition = new GitSourceAcquisition({
        git: wrapper,
        fetcher: async () =>
          new Response(response, {
            headers: { "Content-Type": "application/x-git-upload-pack-result" },
          }),
      });
      await expect(acquisition.open(f.source)).rejects.toThrow("authority_unavailable");
    }
    expect(fs.readFileSync(log, "utf8")).not.toContain('"index-pack"');
    // The supervised native helper deliberately exposes no stderr classification.
    // Failed verification stays unavailable; no retry is performed by acquisition.
    for (const bytes of [
      pack([{ type: 7, base: Buffer.alloc(20), bytes: Buffer.from([0, 0]) }]),
      pack([{ bytes: Buffer.from("does not contain the requested commit") }]),
    ]) {
      let transfers = 0;
      const acquisition = new GitSourceAcquisition({
        git: wrapper,
        fetcher: async () => {
          transfers++;
          return new Response(Buffer.concat([Buffer.from("0008NAK\n"), bytes]), {
            headers: { "Content-Type": "application/x-git-upload-pack-result" },
          });
        },
      });
      await expect(acquisition.open(f.source)).rejects.toThrow("authority_unavailable");
      expect(transfers).toBe(1);
    }
    const blob = Buffer.from("not a commit");
    const id = createHash("sha1")
      .update(Buffer.concat([Buffer.from(`blob ${blob.length}\0`), blob]))
      .digest("hex");
    const acquisition = new GitSourceAcquisition({
      fetcher: async () =>
        new Response(Buffer.concat([Buffer.from("0008NAK\n"), pack([{ bytes: blob }])]), {
          headers: { "Content-Type": "application/x-git-upload-pack-result" },
        }),
    });
    await expect(acquisition.open(id)).rejects.toThrow("policy_refused");
  });
  linuxIt("bounds unavailable cold acquisition without persisting an object store", async () => {
    const before = new Set(
      fs.readdirSync(os.tmpdir()).filter((p) => p.startsWith("ohtia-source-acquisition-")),
    );
    await expect(
      new GitSourceAcquisition({ git: "/bin/false" }).open("a".repeat(40)),
    ).rejects.toThrow("authority_unavailable");
    const acquisition = new GitSourceAcquisition({ fetcher: async () => new Promise(() => {}) });
    await expect(
      acquisition.open("a".repeat(40), { deadline: new SigningDeadline(30) }),
    ).rejects.toThrow("authority_unavailable");
    expect(
      new Set(fs.readdirSync(os.tmpdir()).filter((p) => p.startsWith("ohtia-source-acquisition-"))),
    ).toEqual(before);
  });
});
