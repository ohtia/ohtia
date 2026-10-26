import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { observeMigrationRollback } from "../tools/desktop-probes/dist/rollback.js";
import { expectedSender, parseRequest } from "../tools/desktop-probes/dist/journey.js";
import { reserveProbeFile } from "../tools/desktop-probes/dist/filesystem.js";

describe("exclusive synthetic probe files", () => {
  it("preserves existing file and hardlink bytes before SQLite admission", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ohtia existing probe "));
    try {
      const existing = path.join(directory, "existing.db3");
      const alias = path.join(directory, "alias.db3");
      const marker = "permitted synthetic existing bytes";
      writeFileSync(existing, marker);
      linkSync(existing, alias);
      for (const file of [existing, alias]) {
        expect(() => reserveProbeFile(file)).toThrow();
        expect(readFileSync(existing, "utf8")).toBe(marker);
        expect(readFileSync(alias, "utf8")).toBe(marker);
      }
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
  // Ordinary Windows accounts may not have symlink creation authority; native reparse tests remain separate.
  it.skipIf(process.platform === "win32")("preserves a symlink target without following it", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ohtia aliased probe "));
    try {
      const existing = path.join(directory, "existing.db3");
      const alias = path.join(directory, "alias.db3");
      writeFileSync(existing, "permitted synthetic target");
      symlinkSync(existing, alias);
      expect(() => reserveProbeFile(alias)).toThrow();
      expect(readFileSync(existing, "utf8")).toBe("permitted synthetic target");
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
  it("opens and backs up only newly reserved SQLite files", async () => {
    const SQLite = createRequire(new URL("../tools/desktop-probes/package.json", import.meta.url))(
      "better-sqlite3",
    );
    const directory = mkdtempSync(path.join(tmpdir(), "ohtia reserved probe "));
    const databasePath = path.join(directory, "synthetic.db3");
    const backupPath = path.join(directory, "backup.db3");
    let database;
    let backup;
    try {
      reserveProbeFile(databasePath);
      reserveProbeFile(backupPath);
      if (process.platform !== "win32") {
        expect(statSync(databasePath).mode & 0o777).toBe(0o600);
        expect(statSync(backupPath).mode & 0o777).toBe(0o600);
      }
      database = new SQLite(databasePath);
      database.exec("CREATE TABLE marker(value INTEGER); INSERT INTO marker VALUES(7)");
      await database.backup(backupPath);
      backup = new SQLite(backupPath, { readonly: true });
      expect(backup.prepare("SELECT value FROM marker").pluck().get()).toBe(7);
    } finally {
      backup?.close();
      database?.close();
      rmSync(directory, { recursive: true });
    }
  });
});

describe("private native journey boundary", () => {
  const url = "ohtia-probe://qualification/index.html";
  const limits = { messageBytes: 65536, stringBytes: 4096 };
  it("uses actual contents and frame identity rather than a matching URL claim", () => {
    const contents = { mainFrame: { url } };
    expect(
      expectedSender({ sender: contents, senderFrame: contents.mainFrame }, contents, url),
    ).toBe(true);
    const foreign = { mainFrame: { url } };
    expect(expectedSender({ sender: foreign, senderFrame: foreign.mainFrame }, contents, url)).toBe(
      false,
    );
    expect(expectedSender({ sender: contents, senderFrame: { url } }, contents, url)).toBe(false);
    contents.mainFrame.url = "ohtia-probe://other/index.html";
    expect(
      expectedSender({ sender: contents, senderFrame: contents.mainFrame }, contents, url),
    ).toBe(false);
  });
  it("refuses an inaccessible frame without throwing or assigning authority", () => {
    const contents = { mainFrame: { url } };
    const event = {
      sender: contents,
      get senderFrame(): null {
        throw new Error("Destroyed frame");
      },
    };
    expect(expectedSender(event, contents, url)).toBe(false);
  });
  it("admits only the private read operations and bounded appearance enum", () => {
    for (const operation of ["status", "appearance-read"])
      expect(parseRequest({ operation }, limits)).toEqual({ operation });
    for (const value of ["system", "light", "dark"])
      expect(parseRequest({ operation: "appearance-write", value }, limits)).toEqual({
        operation: "appearance-write",
        value,
      });
  });
  it("rejects malformed, forged and oversized requests before dispatch", () => {
    const cyclic: Record<string, unknown> = { operation: "status" };
    cyclic["self"] = cyclic;
    for (const value of [
      null,
      [],
      "status",
      {},
      { operation: "delete-store" },
      { operation: "status", frameUrl: url },
      { operation: "appearance-write", value: "x".repeat(65537) },
      { operation: "appearance-write", value: { theme: "dark" } },
      { operation: "status", [Symbol("authority")]: true },
      cyclic,
    ])
      expect(parseRequest(value, limits)).toBeUndefined();
  });
  it("honors the supplied canonical byte bounds instead of coercing or truncating", () => {
    expect(parseRequest({ operation: "status" }, { ...limits, messageBytes: 1 })).toBeUndefined();
    expect(parseRequest({ operation: "status" }, { ...limits, stringBytes: 1 })).toBeUndefined();
  });
});

describe("native probe evidence", () => {
  it("observes actual transactional rollback on a synthetic developer-Node file", () => {
    const SQLite = createRequire(new URL("../tools/desktop-probes/package.json", import.meta.url))(
      "better-sqlite3",
    );
    const directory = mkdtempSync(path.join(tmpdir(), "ohtia rollback "));
    const database = new SQLite(path.join(directory, "synthetic.db3"));
    try {
      expect(observeMigrationRollback(database)).toBe(true);
    } finally {
      database.close();
      rmSync(directory, { recursive: true });
    }
  });
  it("never reports rollback when BEGIN fails before the migration callback", () => {
    const failure = new Error("Synthetic begin failure");
    let callbackCalled = false;
    const db = {
      transaction: (_callback: () => void) => () => {
        throw failure;
      },
      exec: () => {
        callbackCalled = true;
      },
      pragma: () => 0,
      prepare: () => ({ get: () => undefined }),
    } as unknown as Parameters<typeof observeMigrationRollback>[0];
    expect(() => observeMigrationRollback(db)).toThrow(failure);
    expect(callbackCalled).toBe(false);
  });
});
