// Fixed-origin smart HTTP imports objects only; downloaded code never runs in the signer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  command,
  demand,
  digest,
  SigningDeadline,
  SigningError,
  signingLimits,
} from "./installation-authority.mjs";

const origin = "https://github.com/ohtia/ohtia.git";
const environment = Object.freeze({
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_TERMINAL_PROMPT: "0",
});
const options = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.attributesFile=/dev/null",
  "-c",
  "protocol.allow=never",
  "-c",
  "gc.auto=0",
];
function packet(value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([Buffer.from((bytes.length + 4).toString(16).padStart(4, "0")), bytes]);
}
export function sourceFetchRequest(source) {
  digest(source, 40);
  // GitHub's fixed upload-pack origin supports these v0 capabilities. Discovery would
  // enumerate unrelated, potentially unbounded PR refs; it grants no source authority.
  return Buffer.concat([
    packet(`want ${source} ofs-delta no-progress\n`),
    Buffer.from("0000"),
    packet("done\n"),
  ]);
}

export class GitSourceAcquisition {
  constructor({ fetcher = fetch, git = "/usr/bin/git" } = {}) {
    this.fetcher = fetcher;
    this.git = git;
  }
  async response(suffix, type, maximum, init, deadline, consume) {
    deadline.check();
    const controller = new globalThis.AbortController();
    let timer, response, reader;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SigningError("authority_unavailable"));
      }, deadline.remaining());
    });
    try {
      response = await Promise.race([
        this.fetcher(origin + suffix, {
          ...init,
          redirect: "error",
          signal: controller.signal,
          headers: { Accept: type, "Accept-Encoding": "identity", ...init.headers },
        }),
        expired,
      ]);
      demand(
        response.status === 200 &&
          !response.redirected &&
          (!response.url || response.url === origin + suffix),
        "authority_unavailable",
      );
      demand(response.headers.get("content-type")?.split(";")[0] === type, "authority_unavailable");
      demand(
        !response.headers.has("content-encoding") ||
          response.headers.get("content-encoding") === "identity",
        "policy_refused",
      );
      const declared = response.headers.get("content-length");
      if (declared !== null)
        demand(
          /^[0-9]+$/.test(declared) &&
            Number.isSafeInteger(Number(declared)) &&
            Number(declared) <= maximum,
          "size_refused",
        );
      demand(
        response.body && typeof response.body.getReader === "function",
        "authority_unavailable",
      );
      reader = response.body.getReader();
      let length = 0;
      for (;;) {
        const next = await Promise.race([reader.read(), expired]);
        deadline.check();
        if (next.done) break;
        const bytes = Buffer.from(next.value);
        length += bytes.length;
        demand(length <= maximum, "size_refused");
        await consume(bytes);
      }
      demand(declared === null || Number(declared) === length, "authority_unavailable");
    } finally {
      clearTimeout(timer);
      controller.abort();
      Promise.resolve(reader ? reader.cancel() : response?.body?.cancel()).catch(() => {});
    }
  }
  async open(source, { deadline = new SigningDeadline() } = {}) {
    digest(source, 40);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-source-acquisition-"));
    fs.chmodSync(directory, 0o700);
    const repository = path.join(directory, "repository.git");
    const close = () => fs.rmSync(directory, { recursive: true, force: true });
    const git = (...args) =>
      command(this.git, [...options, ...args], {
        deadline,
        env: environment,
        maximum: signingLimits.request_bytes,
      });
    try {
      const body = sourceFetchRequest(source);
      await git("init", "--bare", "--template=", repository);
      const incoming = path.join(repository, "objects/pack/incoming.pack");
      const fd = fs.openSync(incoming, "wx", 0o600);
      let prefix = Buffer.alloc(0),
        packHeader = Buffer.alloc(0),
        packed = 0;
      try {
        await this.response(
          "/git-upload-pack",
          "application/x-git-upload-pack-result",
          signingLimits.source_acquisition_bytes + 8,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-git-upload-pack-request" },
            body,
          },
          deadline,
          (bytes) => {
            if (prefix.length < 8) {
              const take = Math.min(8 - prefix.length, bytes.length);
              prefix = Buffer.concat([prefix, bytes.subarray(0, take)]);
              bytes = bytes.subarray(take);
              if (prefix.length === 8)
                demand(prefix.equals(Buffer.from("0008NAK\n")), "authority_unavailable");
            }
            packed += bytes.length;
            demand(packed <= signingLimits.source_acquisition_bytes, "size_refused");
            if (packHeader.length < 12) {
              packHeader = Buffer.concat([packHeader, bytes.subarray(0, 12 - packHeader.length)]);
              if (packHeader.length === 12) {
                demand(
                  packHeader.subarray(0, 4).toString("ascii") === "PACK" &&
                    [2, 3].includes(packHeader.readUInt32BE(4)),
                  "policy_refused",
                );
                demand(
                  packHeader.readUInt32BE(8) > 0 &&
                    packHeader.readUInt32BE(8) <= signingLimits.source_acquisition_objects,
                  "size_refused",
                );
              }
            }
            for (let offset = 0; offset < bytes.length;) {
              deadline.check();
              const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
              demand(written > 0, "authority_unavailable");
              offset += written;
            }
          },
        );
      } finally {
        fs.closeSync(fd);
      }
      demand(prefix.length === 8 && packed >= 32, "policy_refused");
      // A supervised process bounds both delta expansion and its native CPU lifetime.
      const validation = JSON.parse(
        (
          await command(
            process.execPath,
            [fileURLToPath(new URL("./installation-source-pack.mjs", import.meta.url)), incoming],
            { deadline, maximum: 4096 },
          )
        ).toString(),
      );
      demand(
        validation.ok === true,
        ["size_refused", "policy_refused"].includes(validation.code)
          ? validation.code
          : "authority_unavailable",
      );
      digest(validation.pack_sha1, 40);
      const packedFile = path.join(repository, "objects/pack", `pack-${validation.pack_sha1}.pack`);
      fs.renameSync(incoming, packedFile);
      await git(
        "--git-dir",
        repository,
        "index-pack",
        "--strict",
        "--threads=1",
        `--max-input-size=${signingLimits.source_acquisition_bytes}`,
        packedFile,
      );
      demand(
        (await git("--git-dir", repository, "cat-file", "-t", source)).toString().trim() ===
          "commit",
        "policy_refused",
      );
      return { repository, close };
    } catch (error) {
      close();
      if (
        error instanceof SigningError &&
        ["size_refused", "policy_refused", "authority_unavailable"].includes(error.code)
      )
        throw error;
      throw new SigningError("authority_unavailable");
    }
  }
}
