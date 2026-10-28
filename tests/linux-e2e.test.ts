import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  descendants,
  sandboxEvidence,
  contentProcesses,
  assertCspReport,
  assertBrowserParity,
  assertArtifactTree,
  shutdownEvidence,
} from "../tooling/linux-e2e-core.mjs";

describe("Linux OS sandbox evidence", () => {
  const baseline = { filters: 1 };
  const process = {
    pid: 19,
    parent: 7,
    seccomp: 2,
    filters: 2,
    noNewPrivileges: 1,
    command: ["/runtime/electron", "--type=renderer"],
  };

  it("requires an additional filter rather than accepting the inherited container filter", () => {
    expect(sandboxEvidence([process], baseline).sandboxed).toEqual([process]);
    expect(() => sandboxEvidence([{ ...process, filters: 1 }], baseline)).toThrow(
      /additional active/,
    );
    expect(() => sandboxEvidence([{ ...process, seccomp: 0 }], baseline)).toThrow(
      /additional active/,
    );
    expect(() => sandboxEvidence([{ ...process, noNewPrivileges: 0 }], baseline)).toThrow(
      /additional active/,
    );
    expect(() => sandboxEvidence([], baseline)).toThrow(/additional active/);
  });

  it.each([
    { label: "argv no-sandbox", command: ["/runtime/electron", "--no-sandbox"] },
    {
      label: "rewritten no-sandbox title",
      command: ["/runtime/electron --type=renderer --no-sandbox --lang=en-US"],
    },
    {
      label: "seccomp sandbox override",
      command: ["/runtime/electron", "--disable-seccomp-filter-sandbox"],
    },
    { label: "setuid sandbox override", command: ["/runtime/electron --disable-setuid-sandbox=1"] },
  ])("rejects $label", ({ command }) => {
    expect(() => sandboxEvidence([{ ...process, command }], baseline)).toThrow(/disabled/);
  });

  it("does not accept a sandboxed helper as evidence for an unsandboxed content process", () => {
    const helper = { ...process, command: ["/runtime/firefox -contentproc socket"] };
    const content = {
      ...process,
      filters: 1,
      command: ["/runtime/firefox -contentproc -isForBrowser tab"],
    };
    expect(contentProcesses("firefox", [helper, content])).toEqual([content]);
    expect(() => sandboxEvidence(contentProcesses("firefox", [helper, content]), baseline)).toThrow(
      /Every content/,
    );
    expect(() => sandboxEvidence([process, content], baseline)).toThrow(/Every content/);
    expect(
      contentProcesses("chromium", [
        { ...process, command: ["/runtime/chrome --type=renderer --lang=en-US"] },
        helper,
      ]),
    ).toHaveLength(1);
    expect(
      contentProcesses("webkit", [
        { ...process, command: ["/runtime/WebKitWebProcess", "4", "18"] },
        {
          ...process,
          filters: 1,
          command: ["/usr/bin/bwrap", "--args", "24", "--", "/runtime/WebKitWebProcess", "4", "18"],
        },
        helper,
      ]),
    ).toHaveLength(1);
  });

  it("rejects an unexpected startup violation even when both deliberate negatives passed", () => {
    const expected = [
      {
        phase: "negative",
        directive: "connect-src",
        blocked: "https://example.invalid/ohtia-csp-test",
        disposition: "enforce",
      },
      {
        phase: "negative",
        directive: "script-src-elem",
        blocked: "inline",
        disposition: "enforce",
      },
    ];
    expect(() => assertCspReport(expected)).not.toThrow();
    expect(() =>
      assertCspReport([
        {
          phase: "startup",
          directive: "img-src",
          blocked: "https://unexpected.invalid",
          disposition: "enforce",
        },
        ...expected,
      ]),
    ).toThrow(/Unexpected CSP/);
    expect(() => assertCspReport(expected.slice(1))).toThrow();
  });

  it("finds grandchildren independently of process-list order", () => {
    const records = [
      { pid: 31, parent: 19 },
      { pid: 88, parent: 1 },
      { pid: 7, parent: 1 },
      { pid: 19, parent: 7 },
    ];
    expect(descendants(records, 7)).toEqual([records[0], records[3]]);
  });
});

describe("immutable browser parity", () => {
  it("refuses independent package, image, revision, marker and executable mismatches", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-parity-"));
    try {
      const directory = path.join(root, "chromium-123");
      fs.mkdirSync(directory);
      const marker = path.join(directory, "INSTALLATION_COMPLETE");
      const executable = path.join(directory, "chrome");
      fs.writeFileSync(marker, "");
      fs.writeFileSync(executable, "synthetic fixture");
      const input = {
        config: {
          playwrightImage: "example/image:v1",
          playwright: "paired-version",
          browsers: { chromium: "123" },
        },
        metadata: { driverVersion: "paired-version", dockerImageName: "example/image:v1" },
        coreVersion: "paired-version",
        packageVersion: "paired-version",
        browsers: [{ name: "chromium", revision: "123" }],
        browserRoot: root,
        executables: [executable],
      };
      expect(() => assertBrowserParity(input)).not.toThrow();
      expect(() => assertBrowserParity({ ...input, packageVersion: "wrong" })).toThrow();
      expect(() => assertBrowserParity({ ...input, coreVersion: "wrong" })).toThrow();
      expect(() =>
        assertBrowserParity({
          ...input,
          metadata: { ...input.metadata, dockerImageName: "other/image:v1" },
        }),
      ).toThrow();
      expect(() =>
        assertBrowserParity({ ...input, browsers: [{ name: "chromium", revision: "124" }] }),
      ).toThrow();
      fs.unlinkSync(marker);
      expect(() => assertBrowserParity(input)).toThrow(/Incomplete browser/);
      fs.writeFileSync(marker, "");
      fs.unlinkSync(executable);
      expect(() => assertBrowserParity(input)).toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("rebuilt browser artifacts", () => {
  it("rejects changed, missing and extra native files independently of browser revision labels", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ohtia-artifacts-"));
    try {
      const file = path.join(root, "binary");
      fs.writeFileSync(file, "synthetic native artifact");
      const artifacts = {
        binary: {
          sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
          mode: fs.statSync(file).mode & 0o7777,
        },
      };
      expect(() => assertArtifactTree(root, artifacts)).not.toThrow();
      fs.writeFileSync(file, "different bytes at the same revision");
      expect(() => assertArtifactTree(root, artifacts)).toThrow(/changed/);
      fs.unlinkSync(file);
      expect(() => assertArtifactTree(root, artifacts)).toThrow(/inventory differs/);
      fs.writeFileSync(file, "synthetic native artifact");
      fs.writeFileSync(path.join(root, "extra"), "unregistered file");
      expect(() => assertArtifactTree(root, artifacts)).toThrow(/inventory differs/);
      expect(() => assertArtifactTree(root, {})).toThrow(/Empty/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("packaged process shutdown admission", () => {
  it("requires a normal zero-code exit as well as bounded descendant cleanup", () => {
    const clean = { elapsedMs: 12, limitMs: 100, exitCode: 0, signalCode: null, remaining: [] };
    expect(shutdownEvidence(clean).exit_code).toBe(0);
    for (const change of [
      { exitCode: 1 },
      { exitCode: null, signalCode: "SIGSEGV" },
      { exitCode: null },
      { signalCode: "SIGABRT" },
      { elapsedMs: 101 },
      { remaining: [{ pid: 19 }] },
    ])
      expect(() => shutdownEvidence({ ...clean, ...change })).toThrow();
  });
});
