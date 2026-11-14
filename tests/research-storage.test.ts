import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Migrator } from "../packages/utility/node_modules/kysely/dist/migration/index.js";
import {
  decodeDiagnosticEvent,
  makeDiagnosticRecord,
  type Outcome,
  type ResearchCommand,
  type DiagnosticEvent,
} from "../packages/contracts/src/index.js";
import { canonicalJson, LanguageRegistry } from "../packages/utility/src/research.js";
import { DurableStore } from "../packages/utility/dist/index.js";
import { storageFixture, stores, Database } from "./fixtures/storage.js";

const registryFile = path.resolve("config/localization/iana-language-subtag-registry.txt");
const unknownId = "00000000-0000-7000-8000-000000000000";
const toBytes = (id: string) => Buffer.from(id.replaceAll("-", ""), "hex");
function value<T>(outcome: Outcome<T>): T {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  if (!outcome.ok) throw new Error("Expected successful research operation.");
  return outcome.value;
}
async function setup(emitDiagnostic?: (event: DiagnosticEvent) => void) {
  const fixture = storageFixture();
  if (emitDiagnostic) {
    fixture.store = new DurableStore({ ...fixture.options, emitDiagnostic });
    stores.push(fixture.store);
  }
  await fixture.store.open();
  const projectId = value(
    await fixture.store.executeResearchCommand({
      command: "project.create",
      operationId: "new-project",
      payload: {},
    }),
  ).resultId;
  const conversation = value(await fixture.store.readConversations(projectId))[0]!;
  return { ...fixture, projectId, conversation };
}
function confirm(
  projectId: string,
  documentLanguage = "en",
  operationId = "confirm",
): ResearchCommand {
  return {
    command: "project.confirmSetup",
    operationId,
    payload: { projectId, title: "Synthetic investigation", documentLanguage },
  };
}
function append(
  conversationId: string,
  operationId = "append",
  content = "Synthetic researcher message",
): ResearchCommand {
  return { command: "message.append", operationId, payload: { conversationId, content } };
}
function dropResearch(db: InstanceType<typeof Database>) {
  db.exec(
    "DROP TABLE attempts; DROP TABLE tasks; DELETE FROM kysely_migration WHERE name='0008_durable_ai_tasks'; DELETE FROM ohtia_migration_artifacts WHERE name='0008_durable_ai_tasks'; DROP TABLE command_receipts; DROP TABLE messages; DROP TABLE conversations; DROP TABLE projects; DELETE FROM kysely_migration WHERE name='0007_research_records'; DELETE FROM ohtia_migration_artifacts WHERE name='0007_research_records'; PRAGMA user_version=6",
  );
}

describe("project and conversation aggregates on real SQLite", () => {
  it("creates one setup conversation, confirms the project and atomically starts nonempty conversations", async () => {
    const { store, projectId, conversation } = await setup();
    const project = value(await store.readProjects())[0]!;
    expect(project).toMatchObject({
      id: projectId,
      projectType: "thesis",
      title: null,
      documentLanguage: null,
      isDevelopment: false,
      setupConfirmedAt: null,
    });
    expect(projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(conversation).toMatchObject({
      projectId,
      title: null,
      revision: 1,
      updatedAt: conversation.createdAt,
    });
    expect(value(await store.readMessages(conversation.id))).toEqual([]);
    const start = {
      command: "conversation.start",
      operationId: "start",
      payload: { projectId, content: "First message" },
    } as const;
    expect(await store.executeResearchCommand(start)).toMatchObject({
      error: { code: "project_in_setup", nextAction: "refresh_record" },
    });
    value(await store.executeResearchCommand(confirm(projectId, "ES-ar")));
    expect(value(await store.readProjects())[0]).toMatchObject({
      title: "Synthetic investigation",
      documentLanguage: "es-AR",
    });
    const started = value(await store.executeResearchCommand(start));
    const conversations = value(await store.readConversations(projectId));
    expect(conversations).toHaveLength(2);
    expect(conversations.find((row) => row.id === started.resultId)).toMatchObject({
      revision: 2,
      title: null,
    });
    expect(value(await store.readMessages(started.resultId))).toMatchObject([
      { position: 1, authorKind: "researcher", agentId: null, content: "First message" },
    ]);
  });

  it("replays all five commands across changes and restart, with canonical payload hashes and no duplicate effects", async () => {
    const { store, options, projectId, conversation, raw } = await setup();
    const commands: ResearchCommand[] = [
      { command: "project.create", operationId: "new-project", payload: {} },
      confirm(projectId),
      {
        command: "conversation.start",
        operationId: "start",
        payload: { projectId, content: "First message" },
      },
      {
        command: "conversation.rename",
        operationId: "rename",
        payload: {
          conversationId: conversation.id,
          title: "A name",
          expectedUpdatedAt: conversation.updatedAt,
        },
      },
      append(conversation.id),
    ];
    const results = [];
    for (const command of commands) {
      const saved = await store.executeResearchCommand(command);
      value(saved);
      expect(await store.executeResearchCommand(command)).toEqual(saved);
      results.push(saved);
    }
    value(
      await store.executeResearchCommand({
        command: "conversation.rename",
        operationId: "rename-again",
        payload: {
          conversationId: conversation.id,
          title: "A newer name",
          expectedUpdatedAt: value(await store.readConversations(projectId)).find(
            (c) => c.id === conversation.id,
          )!.updatedAt,
        },
      }),
    );
    const reordered = {
      command: "project.confirmSetup",
      operationId: "confirm",
      payload: { documentLanguage: "en", title: "Synthetic investigation", projectId },
    } as const;
    expect(await store.executeResearchCommand(reordered)).toEqual(results[1]);
    expect(
      await store.executeResearchCommand({
        ...reordered,
        payload: { ...reordered.payload, title: "Other" },
      }),
    ).toMatchObject({ error: { code: "operation_conflict" } });
    expect(await store.executeResearchCommand(append(conversation.id, "confirm"))).toMatchObject({
      error: { code: "operation_conflict" },
    });
    const db = raw();
    const hash = (
      db
        .prepare("SELECT payload_sha256 FROM command_receipts WHERE operation_id='confirm'")
        .get() as { payload_sha256: Buffer }
    ).payload_sha256;
    expect(hash).toEqual(createHash("sha256").update(canonicalJson(reordered.payload)).digest());
    expect(db.prepare("SELECT count(*) FROM messages").pluck().get()).toBe(2);
    db.close();
    await store.close();
    const reopened = new DurableStore(options);
    stores.push(reopened);
    await reopened.open();
    for (let i = 0; i < commands.length; i++)
      expect(await reopened.executeResearchCommand(commands[i]!)).toEqual(results[i]);
    expect(
      value(await reopened.readConversations(projectId)).find((c) => c.id === conversation.id)
        ?.title,
    ).toBe("A newer name");
  });

  it("keeps failed commands unrecorded and rechecks their preconditions with the same operation identity", async () => {
    const { store, projectId, conversation, raw } = await setup();
    const db = raw();
    const count = () => db.prepare("SELECT count(*) FROM command_receipts").pluck().get();
    const start = {
      command: "conversation.start",
      operationId: "same-start",
      payload: { projectId, content: "" },
    } as const;
    const invalid: [ResearchCommand, string][] = [
      [start, "project_in_setup"],
      [append(conversation.id, "empty", ""), "message_invalid"],
      [append(unknownId, "missing"), "record_not_found"],
      [
        {
          command: "conversation.rename",
          operationId: "name",
          payload: {
            conversationId: conversation.id,
            title: " bad ",
            expectedUpdatedAt: conversation.updatedAt,
          },
        },
        "name_invalid",
      ],
      [confirm(unknownId), "record_not_found"],
      [
        {
          command: "conversation.start",
          operationId: "missing-start",
          payload: { projectId: unknownId, content: "Synthetic" },
        },
        "record_not_found",
      ],
      [
        {
          command: "conversation.rename",
          operationId: "missing-rename",
          payload: {
            conversationId: unknownId,
            title: "Synthetic",
            expectedUpdatedAt: conversation.updatedAt,
          },
        },
        "record_not_found",
      ],
    ];
    for (const [command, code] of invalid) {
      expect(await store.executeResearchCommand(command)).toMatchObject({ error: { code } });
      expect(count()).toBe(1);
    }
    const prepare = Database.prototype.prepare;
    const commitFailure = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (
      query,
      ...args
    ) {
      if (query === "COMMIT") throw new Error("Synthetic commit failure must not run on rejection");
      return prepare.call(this, query, ...args);
    });
    expect(
      await store.executeResearchCommand(append(conversation.id, "rejected-commit", "")),
    ).toMatchObject({ error: { code: "message_invalid" } });
    commitFailure.mockRestore();
    value(await store.executeResearchCommand(confirm(projectId)));
    expect(await store.executeResearchCommand(start)).toMatchObject({
      error: { code: "message_invalid" },
    });
    expect(count()).toBe(2);
    value(
      await store.executeResearchCommand({
        ...start,
        payload: { projectId, content: "Now valid" },
      }),
    );
    expect(
      await store.executeResearchCommand(confirm(projectId, "fr", "second-confirm")),
    ).toMatchObject({ error: { code: "project_not_in_setup" } });
    expect(count()).toBe(3);
    expect(db.prepare("SELECT count(*) FROM conversations").pluck().get()).toBe(2);
    expect(db.prepare("SELECT count(*) FROM messages").pluck().get()).toBe(1);
    db.close();
  });

  it("renames using updated_at while messages advance only revision, including equal and backward clocks", async () => {
    const { store, projectId, conversation } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(conversation.updatedAt));
    const rename = (
      operationId: string,
      expectedUpdatedAt: string,
      title = operationId,
    ): ResearchCommand => ({
      command: "conversation.rename",
      operationId,
      payload: { conversationId: conversation.id, title, expectedUpdatedAt },
    });
    try {
      value(await store.executeResearchCommand(rename("rename-1", conversation.updatedAt)));
      const first = value(await store.readConversations(projectId))[0]!;
      expect(Date.parse(first.updatedAt)).toBe(Date.parse(conversation.updatedAt) + 1);
      value(await store.executeResearchCommand(append(conversation.id)));
      const afterMessage = value(await store.readConversations(projectId))[0]!;
      expect(afterMessage).toMatchObject({ updatedAt: first.updatedAt, revision: 3 });
      vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
      value(await store.executeResearchCommand(rename("rename-2", first.updatedAt)));
      const second = value(await store.readConversations(projectId))[0]!;
      expect(second).toMatchObject({ revision: 4 });
      expect(Date.parse(second.updatedAt)).toBe(Date.parse(first.updatedAt) + 1);
      expect(await store.executeResearchCommand(rename("stale", first.updatedAt))).toMatchObject({
        error: { code: "stale_revision", parameters: { currentRevision: 4 } },
      });
      expect(value(await store.readConversations(projectId))[0]).toEqual(second);
      // A repeated name still counts as an explicit rename and advances its timestamp.
      value(
        await store.executeResearchCommand(rename("same-name", second.updatedAt, second.title!)),
      );
      expect(value(await store.readConversations(projectId))[0]?.revision).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allocates increasing positions over gaps, reads from a position, scopes projects and sorts by the highest-position message", async () => {
    const { store, projectId, conversation, raw } = await setup();
    value(await store.executeResearchCommand(confirm(projectId)));
    const other = value(
      await store.executeResearchCommand({
        command: "conversation.start",
        operationId: "start",
        payload: { projectId, content: "Other conversation" },
      }),
    ).resultId;
    const db = raw();
    const insert = db.prepare(
      "INSERT INTO messages (id,conversation_id,position,author_kind,agent_id,content,created_at) VALUES (?,?,?,?,?,?,?)",
    );
    insert.run(
      toBytes("00000000-0000-7000-8000-000000000002"),
      toBytes(conversation.id),
      4,
      "researcher",
      null,
      "Earlier position",
      "2030-01-01T00:00:00.000Z",
    );
    insert.run(
      toBytes("00000000-0000-7000-8000-000000000001"),
      toBytes(conversation.id),
      9,
      "researcher",
      null,
      "Later position",
      "2025-01-01T00:00:00.000Z",
    );
    expect(value(await store.readConversations(projectId))[0]?.id).toBe(other);
    value(await store.executeResearchCommand(append(conversation.id)));
    const messages = value(await store.readMessages(conversation.id));
    expect(messages.map((m) => m.position)).toEqual([4, 9, 10]);
    expect(value(await store.readMessages(conversation.id, 9)).map((m) => m.position)).toEqual([
      9, 10,
    ]);
    const secondProject = value(
      await store.executeResearchCommand({
        command: "project.create",
        operationId: "other-project",
        payload: {},
      }),
    ).resultId;
    expect(value(await store.readConversations(secondProject))).toHaveLength(1);
    expect(await store.readConversations(unknownId)).toMatchObject({
      error: { code: "record_not_found" },
    });
    expect(await store.readMessages(unknownId)).toMatchObject({
      error: { code: "record_not_found" },
    });
    expect(await store.readMessages(conversation.id, 0)).toMatchObject({
      error: { code: "invalid_message" },
    });
    db.close();
  });

  it("rolls back project creation, conversation start and append when a later write fails", async () => {
    const { store, projectId, conversation, raw } = await setup();
    value(await store.executeResearchCommand(confirm(projectId)));
    const db = raw();
    db.exec(
      "CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    for (const command of [
      { command: "project.create", operationId: "failed-create", payload: {} },
      {
        command: "conversation.start",
        operationId: "failed-start",
        payload: { projectId, content: "Synthetic" },
      },
      append(conversation.id),
    ] as ResearchCommand[])
      expect(await store.executeResearchCommand(command)).toMatchObject({
        error: { code: "storage_failed" },
      });
    expect(db.prepare("SELECT count(*) FROM projects").pluck().get()).toBe(1);
    expect(db.prepare("SELECT count(*) FROM conversations").pluck().get()).toBe(1);
    expect(db.prepare("SELECT count(*) FROM messages").pluck().get()).toBe(0);
    expect(db.prepare("SELECT revision FROM conversations").pluck().get()).toBe(1);
    expect(db.prepare("SELECT count(*) FROM command_receipts").pluck().get()).toBe(2);
    db.exec("DROP TRIGGER synthetic_receipt_failure");
    db.close();
  });

  it("serializes ownership and returns busy rather than interleaving two commands", async () => {
    const { store, conversation } = await setup();
    const [first, second] = await Promise.all([
      store.executeResearchCommand(append(conversation.id, "a")),
      store.executeResearchCommand(append(conversation.id, "b")),
    ]);
    value(first);
    expect(second).toMatchObject({ error: { code: "busy" } });
    value(await store.executeResearchCommand(append(conversation.id, "b")));
    expect(value(await store.readMessages(conversation.id)).map((m) => m.position)).toEqual([1, 2]);
  });
});

describe("language registry and RFC 8785 receipt hashing", () => {
  it.each(["en", "ast", "sr-Latn", "es-419", "pt-BR", "sr-Latn-RS", "ES-ar"])(
    "accepts %s and stores canonical case",
    async (language) => {
      const { store, projectId } = await setup();
      value(await store.executeResearchCommand(confirm(projectId, language)));
      expect(value(await store.readProjects())[0]?.documentLanguage).toBe(
        language === "ES-ar" ? "es-AR" : language,
      );
    },
  );
  it.each([
    "iw",
    "sK",
    "Ko",
    "en-US-x-test",
    "zh-min-nan",
    "qzz",
    "en-BU",
    "en-Abcd",
    "abcd",
    "es_419",
    " en",
    "en-Latn-US-1901",
    "i-klingon",
  ])("rejects %s without a receipt", async (language) => {
    const { store, projectId, raw } = await setup();
    expect(await store.executeResearchCommand(confirm(projectId, language))).toMatchObject({
      error: { code: "invalid_message" },
    });
    expect(value(await store.readProjects())[0]?.setupConfirmedAt).toBeNull();
    const db = raw();
    expect(db.prepare("SELECT count(*) FROM command_receipts").pluck().get()).toBe(1);
    db.close();
  });
  it("uses each subtag's registry type, deprecated field and registered ranges", () => {
    const registry = new LanguageRegistry(registryFile);
    expect(registry.canonical("en-US-Latn")).toBeUndefined();
    expect(registry.canonical("en-Abcd")).toBeUndefined();
    expect(registry.canonical("qaa-Qaaa-QM")).toBe("qaa-Qaaa-QM");
    expect(() => new LanguageRegistry(new URL("data:text/plain,invalid"))).toThrow();
  });
  it("preserves the byte-for-byte IANA identity through text hooks", () => {
    const bytes = fs.readFileSync(registryFile);
    expect(bytes.length).toBeLessThan(1024 * 1024);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "755fad43283be7b41ebe3c89ad054b6eaf928f404f9c0edb74799e0eab74beb1",
    );
    expect(bytes.toString("utf8")).toMatch(/^File-Date: 2026-09-17\n/);
    expect(bytes.toString("utf8")).not.toMatch(/\r|[\t ]\n|\n\n$/);
    expect(bytes.at(-1)).toBe(10);
  });
  it("canonicalizes nested key order and RFC number/Unicode vectors without changing text", () => {
    expect(canonicalJson({ b: { z: 1, a: "é" }, a: [3, { b: 2, a: 1 }] })).toBe(
      '{"a":[3,{"a":1,"b":2}],"b":{"a":"é","z":1}}',
    );
    expect(canonicalJson([333333333.33333329, 1e30, 4.5, 2e-3, 1e-27, -0])).toBe(
      "[333333333.3333333,1e+30,4.5,0.002,1e-27,0]",
    );
    const keys = ["\ufb33", "😀", "€", "ö", "\u0080", "1", "\r"];
    const result = canonicalJson(Object.fromEntries(keys.map((k) => [k, 1])));
    expect(result).toBe('{"\\r":1,"1":1,"\u0080":1,"ö":1,"€":1,"😀":1,"\ufb33":1}');
    for (const input of [
      NaN,
      Infinity,
      undefined,
      { bad: undefined },
      "\ud800",
      { "\udfff": 1 },
      new Date(),
      Array(1),
    ])
      expect(() => canonicalJson(input)).toThrow();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow();
  });
});

describe("migration 0007 and database-owned rules", () => {
  it("upgrades a populated version-0006 store, checkpoints the source and keeps preferences", async () => {
    const { store, raw, root } = storageFixture();
    await store.open();
    value(
      await store.replaceAppearance({
        operationId: "appearance",
        expectedRevision: 0,
        value: "dark",
      }),
    );
    await store.close();
    const db = raw();
    dropResearch(db);
    const before = db.prepare("SELECT * FROM application_preferences ORDER BY key").all();
    db.close();
    await store.open();
    const upgraded = raw();
    expect(upgraded.pragma("user_version", { simple: true })).toBe(8);
    expect(upgraded.prepare("SELECT * FROM application_preferences ORDER BY key").all()).toEqual(
      before,
    );
    const checkpoints = fs
      .readdirSync(path.join(root, "recovery/migrations"))
      .filter((s) => !s.includes("."));
    expect(
      checkpoints.map((s) =>
        JSON.parse(
          fs.readFileSync(path.join(root, "recovery/migrations", s, "manifest.json"), "utf8"),
        ),
      ),
    ).toContainEqual(expect.objectContaining({ sourceRevision: 6, targetRevision: 8 }));
    expect(value(await store.readProjects())).toEqual([]);
    upgraded.close();
  });
  it("rolls a failed 0007 migration back to 0006 and keeps admission closed until explicit retry", async () => {
    const { store, raw, root } = storageFixture();
    await store.open();
    await store.close();
    const db = raw();
    dropResearch(db);
    const before = db.prepare("SELECT * FROM application_preferences").all();
    db.close();
    const original = Migrator.prototype.migrateTo;
    const spy = vi.spyOn(Migrator.prototype, "migrateTo").mockImplementation(async function (
      this: Migrator,
      ...args: Parameters<Migrator["migrateTo"]>
    ) {
      const result = await original.apply(this, args);
      expect(result.error).toBeUndefined();
      return { ...result, error: new Error("Synthetic failure after migration DDL") };
    });
    await expect(store.open()).rejects.toThrow();
    spy.mockRestore();
    const failed = raw();
    expect(failed.pragma("user_version", { simple: true })).toBe(6);
    expect(failed.prepare("SELECT * FROM application_preferences").all()).toEqual(before);
    expect(
      failed.prepare("SELECT name FROM sqlite_schema WHERE name='projects'").get(),
    ).toBeUndefined();
    failed.close();
    expect(store.ready).toBe(false);
    expect(fs.existsSync(path.join(root, "migration-pending.json"))).toBe(true);
    await expect(store.open()).rejects.toThrow(/Explicit/);
    expect(await store.readProjects()).toMatchObject({ error: { code: "service_unavailable" } });
    await store.retry();
    expect(store.ready).toBe(true);
  });
  it("enforces identity, language grammar/case, title, setup, timestamp, ownership, author, position and immutability in SQLite", async () => {
    const { store, projectId, conversation, raw } = await setup();
    const db = raw();
    db.pragma("foreign_keys=ON");
    for (const id of [
      Buffer.alloc(16),
      Buffer.alloc(15),
      "00000000-0000-7000-8000-000000000000",
      toBytes("00000000-0000-4000-8000-000000000000"),
      toBytes("00000000-0000-7000-1000-000000000000"),
    ])
      expect(() =>
        db
          .prepare(
            "INSERT INTO projects SELECT ?,project_type,title,document_language,is_development,setup_confirmed_at,created_at,updated_at FROM projects LIMIT 1",
          )
          .run(id),
      ).toThrow();
    for (const statement of [
      "UPDATE projects SET title='Only title'",
      "UPDATE projects SET is_development=1",
      "UPDATE projects SET project_type='paper'",
      "UPDATE projects SET created_at='2026-01-01T00:00:00Z'",
      "UPDATE projects SET updated_at='2026-02-30T00:00:00.000Z'",
      "UPDATE conversations SET project_id=x'00000000000070008000000000000000',revision=revision+1",
      "UPDATE conversations SET revision=0",
      "UPDATE conversations SET revision=revision+2",
      "UPDATE conversations SET title='Name',revision=revision+1",
      "DELETE FROM conversations",
    ])
      expect(() => db.exec(statement), statement).toThrow();
    for (const language of [
      "EN",
      "en-us",
      "en-latn",
      "abcd",
      "en-US-x-test",
      "zh-min-nan",
      "en-1234",
      "en-12",
      "en-Us",
      "en-LATN",
      "en\0-x-test",
      "en\0",
    ])
      expect(
        () =>
          db
            .prepare(
              "UPDATE projects SET title='Valid',document_language=?,setup_confirmed_at=created_at",
            )
            .run(language),
        language,
      ).toThrow();
    for (const title of ["", " x", "x\n", "\u2000x", "x\ufeff", "😀".repeat(201), "ab\0cd"])
      expect(() =>
        db
          .prepare(
            "UPDATE projects SET title=?,document_language='en',setup_confirmed_at=created_at",
          )
          .run(title),
      ).toThrow();
    value(await store.executeResearchCommand(confirm(projectId)));
    value(
      await store.executeResearchCommand({
        command: "conversation.start",
        operationId: "second-for-setup-invariant",
        payload: { projectId, content: "Synthetic" },
      }),
    );
    expect(() =>
      db.exec("UPDATE projects SET title=NULL,document_language=NULL,setup_confirmed_at=NULL"),
    ).toThrow();
    expect(value(await store.readProjects())[0]?.setupConfirmedAt).not.toBeNull();
    value(
      await store.executeResearchCommand({
        command: "conversation.rename",
        operationId: "emoji",
        payload: {
          conversationId: conversation.id,
          expectedUpdatedAt: conversation.updatedAt,
          title: "😀".repeat(200),
        },
      }),
    );
    value(await store.executeResearchCommand(append(conversation.id)));
    for (const statement of [
      "UPDATE messages SET content='other'",
      "DELETE FROM messages",
      "UPDATE command_receipts SET command='other'",
      "DELETE FROM command_receipts",
    ])
      expect(() => db.exec(statement)).toThrow();
    const insert = db.prepare(
      "INSERT INTO messages (id,conversation_id,position,author_kind,agent_id,content,created_at) VALUES (?,?,?,?,?,?,?)",
    );
    const id = toBytes("00000000-0000-7000-8000-000000000003");
    const created = "2026-11-01T00:00:00.000Z";
    for (const [position, kind, agent, content, conv, time] of [
      [0, "researcher", null, "text", conversation.id, created],
      [1, "researcher", null, "text", conversation.id, created],
      [1.5, "researcher", null, "text", conversation.id, created],
      [2, "human", null, "text", conversation.id, created],
      [2, "agent", null, "text", conversation.id, created],
      [2, "agent", "unknown", "text", conversation.id, created],
      [2, "researcher", "virgilio", "text", conversation.id, created],
      [2, "researcher", null, "", conversation.id, created],
      [2, "researcher", null, "text", unknownId, created],
      [2, "researcher", null, "text", conversation.id, "bad"],
    ] as const)
      expect(() => insert.run(id, toBytes(conv), position, kind, agent, content, time)).toThrow();
    // Content has no database length limit and may contain NUL; it is preserved as immutable text.
    value(
      await store.executeResearchCommand(
        append(conversation.id, "large", "a".repeat(100_000) + "\0end"),
      ),
    );
    expect(value(await store.readMessages(conversation.id)).at(-1)?.content).toHaveLength(100004);
    expect(() =>
      db.prepare("UPDATE conversations SET updated_at=created_at,revision=revision+1").run(),
    ).toThrow();
    expect(() =>
      db
        .prepare("INSERT INTO command_receipts VALUES ('bad','',?,?,?)")
        .run(Buffer.alloc(32), id, created),
    ).toThrow();
    expect(() =>
      db
        .prepare("INSERT INTO command_receipts VALUES ('bad','project.create',?,?,?)")
        .run(Buffer.alloc(31), id, created),
    ).toThrow();
    db.close();
  });
  it("rejects altered or extra triggers when reopening the schema", async () => {
    const { store, raw } = storageFixture();
    await store.open();
    await store.close();
    const db = raw();
    db.exec("DROP TRIGGER messages_update");
    db.close();
    await expect(store.open()).rejects.toThrow(/objects/);
  });
});

it("emits only closed catalog events, with no private content or identifiers", async () => {
  const fixture = storageFixture();
  await fixture.store.close();
  const events: DiagnosticEvent[] = [];
  const store = new DurableStore({
    ...fixture.options,
    emitDiagnostic: (event) => events.push(event),
  });
  stores.push(store);
  await store.open();
  const projectId = value(
    await store.executeResearchCommand({
      command: "project.create",
      operationId: "private-operation",
      payload: {},
    }),
  ).resultId;
  value(await store.executeResearchCommand(confirm(projectId)));
  const conversation = value(await store.readConversations(projectId))[0]!;
  value(
    await store.executeResearchCommand(
      append(conversation.id, "private-message", "PRIVATE_CONTENT"),
    ),
  );
  await store.executeResearchCommand(append(conversation.id, "invalid", ""));
  await store.readProjects();
  await store.readMessages(conversation.id);
  for (const event of events) {
    expect(decodeDiagnosticEvent(event)).toEqual(event);
    expect(makeDiagnosticRecord(event, "0.0.0", new Date().toISOString())).toBeDefined();
  }
  expect(events.map((e) => e.event_name)).toEqual(
    expect.arrayContaining([
      "ohtia.project.created",
      "ohtia.project.setup_confirmed",
      "ohtia.message.appended",
      "ohtia.research.failed",
      "ohtia.project.listed",
      "ohtia.conversation.listed",
      "ohtia.message.listed",
    ]),
  );
  expect(JSON.stringify(events)).not.toMatch(
    /PRIVATE_CONTENT|private-operation|private-message|Synthetic investigation/,
  );
  expect(JSON.stringify(events)).not.toContain(projectId);
});

it("preserves command identity across a lost commit acknowledgement", async () => {
  const diagnostics: DiagnosticEvent[] = [];
  const { store, conversation, raw } = await setup((event) => diagnostics.push(event));
  const command = append(conversation.id, "lost-ack");
  const original = Database.prototype.prepare;
  const spy = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (query, ...args) {
    const statement = original.call(this, query, ...args);
    if (query === "COMMIT") {
      const run = statement.run.bind(statement);
      statement.run = (...bindings: unknown[]) => {
        run(...bindings);
        throw new Error("Synthetic lost acknowledgement");
      };
    }
    return statement;
  });
  expect(await store.executeResearchCommand(command)).toMatchObject({
    error: { code: "uncertain" },
  });
  spy.mockRestore();
  expect(diagnostics.at(-1)).toEqual({
    event_name: "ohtia.research.uncertain",
    error_code: "uncertain",
  });
  const saved = value(await store.executeResearchCommand(command));
  expect(value(await store.readMessages(conversation.id))).toMatchObject([
    { id: saved.resultId, position: 1 },
  ]);
  const db = raw();
  expect(
    db.prepare("SELECT count(*) FROM command_receipts WHERE operation_id='lost-ack'").pluck().get(),
  ).toBe(1);
  db.close();
});

it("rejects malformed command boundaries and Unicode whitespace titles without receipts", async () => {
  const { store, projectId, conversation, raw } = await setup();
  const invalid: unknown[] = [
    null,
    {},
    { command: "project.create", operationId: "invalid.id", payload: {} },
    { command: "unknown", operationId: "unknown", payload: {} },
    { command: "project.create", operationId: "extra", payload: { extra: 1 } },
    { command: "project.create", operationId: "array", payload: [] },
    { command: "message.append", operationId: "missing", payload: {} },
    {
      command: "message.append",
      operationId: "nan",
      payload: { conversationId: conversation.id, content: NaN },
    },
    append("INVALID", "invalid-id"),
    ...["x", "2026-11-01T00:00:00Z", "2026-02-30T00:00:00.000Z"].map((expectedUpdatedAt) => ({
      command: "conversation.rename",
      operationId: "bad-version",
      payload: { conversationId: conversation.id, title: "Synthetic", expectedUpdatedAt },
    })),
  ];
  for (const command of invalid)
    expect(await store.executeResearchCommand(command as ResearchCommand)).toMatchObject({
      error: { code: "invalid_message" },
    });
  for (const title of ["", "x".repeat(201), "\u0085name", "name\u0085", "\tname", "name\ufeff"]) {
    expect(
      await store.executeResearchCommand({
        command: "project.confirmSetup",
        operationId: "invalid-title",
        payload: { projectId, title, documentLanguage: "en" },
      }),
    ).toMatchObject({ error: { code: "name_invalid" } });
  }
  expect(await store.readConversations("bad")).toMatchObject({
    error: { code: "invalid_message" },
  });
  expect(await store.readMessages(conversation.id, NaN)).toMatchObject({
    error: { code: "invalid_message" },
  });
  const db = raw();
  expect(db.prepare("SELECT count(*) FROM command_receipts").pluck().get()).toBe(1);
  db.close();
  await store.close();
  expect(await store.executeResearchCommand(append(conversation.id))).toMatchObject({
    error: { code: "service_unavailable" },
  });
  expect(await store.readMessages(conversation.id)).toMatchObject({
    error: { code: "service_unavailable" },
  });
});

it("never evaluates accessors or custom array properties during canonical hashing", () => {
  const getter = vi.fn(() => "private");
  const record = Object.defineProperty({}, "content", { enumerable: true, get: getter });
  const array = Object.defineProperty(["first"], "0", { enumerable: true, get: getter });
  for (const invalid of [
    record,
    array,
    Object.assign([1], { extra: 2 }),
    Object.assign([1], { [Symbol("extra")]: 2 }),
  ])
    expect(() => canonicalJson(invalid)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(canonicalJson({ "2": "second", "10": "first" })).toBe('{"10":"first","2":"second"}');
});

it("preserves setup when its bundled registry cannot be read and permits an explicit retry", async () => {
  const fixture = storageFixture();
  const file = path.join(fixture.root, "registry.txt");
  const store = new DurableStore({
    ...fixture.options,
    languageRegistry: file,
    emitDiagnostic: () => {
      throw new Error("Synthetic diagnostic delivery failure");
    },
  });
  stores.push(store);
  await store.open();
  const projectId = value(
    await store.executeResearchCommand({
      command: "project.create",
      operationId: "registry-project",
      payload: {},
    }),
  ).resultId;
  const command = confirm(projectId);
  expect(await store.executeResearchCommand(command)).toMatchObject({
    error: { code: "storage_failed" },
  });
  expect(value(await store.readProjects())[0]?.setupConfirmedAt).toBeNull();
  fs.writeFileSync(file, "invalid registry");
  expect(await store.executeResearchCommand(command)).toMatchObject({
    error: { code: "storage_failed" },
  });
  fs.copyFileSync(registryFile, file);
  value(await store.executeResearchCommand(command));
});
