import { seedDefaultModel } from "./fixtures/storage.js";
import { proposeSetup, setupConnections } from "./fixtures/project-setup.js";
import { describe, expect, it } from "vitest";
import { type Outcome, type Request, policyId, failure } from "@ohtia/contracts";
import { storageFixture, stores, preProjectOpeningSql } from "./fixtures/storage.js";
import { objects as previousObjects } from "../packages/utility/src/migrations/0016_task_notices.mjs";
import { preProjectTitleSql } from "../tooling/storage-legacy-consultation-fixture.mjs";
import { DurableStore } from "../packages/utility/src/storage.js";

function value<T>(result: Outcome<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function request(cursor: unknown = null, count = 40): Request {
  return {
    protocol: 1,
    policy: policyId,
    kind: "request",
    operation: "project.list",
    requestId: "list",
    operationId: "list",
    windowGeneration: "window",
    serviceGeneration: "service",
    payload: { cursor, count },
  } as Request;
}

describe("project opening", () => {
  it("records opening time without changing content time and replays success and missing-record receipts across restart", async () => {
    const fixture = storageFixture();
    await fixture.store.open();
    const id = value(
      await fixture.store.executeResearchCommand({
        command: "project.create",
        operationId: "create",
        payload: {},
      }),
    ).resultId;
    const before = value(await fixture.store.readProjects())[0]!;
    expect(before.lastOpenedAt).toBe(before.createdAt);
    const opened = await fixture.store.executeResearchCommand({
      command: "project.open",
      operationId: "open",
      payload: { projectId: id },
    });
    expect(opened).toEqual({ ok: true, value: { resultId: id } });
    const after = value(await fixture.store.readProjects())[0]!;
    expect(after.updatedAt).toBe(before.updatedAt);
    const unknown = "019a8000-0000-7000-8000-000000000000";
    const command = {
      command: "project.open" as const,
      operationId: "missing",
      payload: { projectId: unknown },
    };
    expect(await fixture.store.executeResearchCommand(command)).toEqual(
      failure("record_not_found"),
    );
    await fixture.store.close();
    const restarted = new DurableStore(fixture.options);
    stores.push(restarted);
    await restarted.open();
    expect(await restarted.executeResearchCommand(command)).toEqual(failure("record_not_found"));
    expect(
      await restarted.executeResearchCommand({ ...command, payload: { projectId: id } }),
    ).toEqual(failure("operation_conflict"));
    expect(
      await restarted.executeResearchCommand({
        command: "project.open",
        operationId: "open",
        payload: { projectId: id },
      }),
    ).toEqual(opened);
    expect(value(await restarted.readProjects())[0]!.lastOpenedAt).toBe(after.lastOpenedAt);
  });

  it("leaves an in-flight reply running while windows open another project and return", async () => {
    const fixture = storageFixture();
    await fixture.store.open();
    fixture.store.setTaskContext({
      generation: "setup-tests",
      mode: "development",
      connections: setupConnections(),
    });
    seedDefaultModel(fixture.raw, "first", "First");
    const a = value(
      await fixture.store.executeResearchCommand({
        command: "project.create",
        operationId: "create-a",
        payload: {},
      }),
    ).resultId;
    const b = value(
      await fixture.store.executeResearchCommand({
        command: "project.create",
        operationId: "create-b",
        payload: {},
      }),
    ).resultId;
    const conversation = value(await fixture.store.readConversations(a))[0]!;
    value(
      await fixture.store.executeResearchCommand({
        command: "message.append",
        operationId: "reply-a",
        payload: { conversationId: conversation.id, content: "Synthetic setup question" },
      }),
    );
    const task = value(await fixture.store.prepareTask());
    if (!task) throw new Error("Expected admitted task.");
    value(
      await fixture.store.executeResearchCommand({
        command: "project.open",
        operationId: "open-b",
        payload: { projectId: b },
      }),
    );
    value(
      await fixture.store.executeResearchCommand({
        command: "project.open",
        operationId: "return-a",
        payload: { projectId: a },
      }),
    );
    const db = fixture.raw();
    expect(db.prepare("SELECT state FROM tasks").pluck().get()).toBe("running");
    db.close();
    value(
      await fixture.store.recordTaskEvent(
        task.dispatch.request.attempt,
        { type: "result", sequence: 1, result: { status: "completed" } },
        "Reply completed after switching",
      ),
    );
    expect(value(await fixture.store.readMessages(conversation.id)).at(-1)?.content).toBe(
      "Reply completed after switching",
    );
  });

  it("backfills populated revision-16 projects from their creation times through a verified checkpoint", async () => {
    const fixture = storageFixture();
    await fixture.store.open();
    value(
      await fixture.store.executeResearchCommand({
        command: "project.create",
        operationId: "legacy",
        payload: {},
      }),
    );
    const original = value(await fixture.store.readProjects());
    await fixture.store.close();
    const db = fixture.raw();
    db.exec(
      preProjectOpeningSql +
        "DROP TRIGGER receipts_commands; " +
        previousObjects.receipts_commands +
        "; PRAGMA user_version=16;",
    );
    db.close();
    const store = new DurableStore(fixture.options);
    stores.push(store);
    await store.open();
    const projects = value(await store.readProjects());
    expect(projects.map((p) => [p.id, p.createdAt, p.lastOpenedAt, p.updatedAt])).toEqual(
      original.map((p) => [p.id, p.createdAt, p.createdAt, p.updatedAt]),
    );
    const upgraded = fixture.raw();
    expect(upgraded.pragma("user_version", { simple: true })).toBe(43);
    upgraded.close();
  });

  it("paginates 95 equal-time projects without gaps or repetitions and uses the opening-time cursor after another opening", async () => {
    const fixture = storageFixture();
    await fixture.store.open();
    const ids = [];
    for (let i = 0; i < 95; i++)
      ids.push(
        value(
          await fixture.store.executeResearchCommand({
            command: "project.create",
            operationId: `create-${String(i)}`,
            payload: {},
          }),
        ).resultId,
      );
    const all = value(await fixture.store.readProjects());
    // Equal timestamps force page boundaries to depend on the descending UUID tie breaker.
    await fixture.store.close();
    const db = fixture.raw();
    db.prepare("UPDATE projects SET last_opened_at=?").run("2026-11-01T00:00:00.000Z");
    db.close();
    const store = new DurableStore(fixture.options);
    stores.push(store);
    await store.open();
    const received: string[] = [];
    const sizes = [];
    let cursor: unknown = null;
    do {
      const page = value(await store.readResearch(request(cursor))) as {
        items: { id: string }[];
        next: unknown;
      };
      sizes.push(page.items.length);
      received.push(...page.items.map((item) => item.id));
      cursor = page.next;
    } while (cursor);
    expect(sizes).toEqual([38, 38, 19]);
    expect(received).toEqual([...ids].sort().reverse());
    expect(new Set(received).size).toBe(all.length);
    const id = received.at(-1)!;
    value(
      await store.executeResearchCommand({
        command: "project.open",
        operationId: "reorder",
        payload: { projectId: id },
      }),
    );
    expect(
      (value(await store.readResearch(request(null, 1))) as { items: { id: string }[] }).items[0]!
        .id,
    ).toBe(id);
  });
});

it("admits the first-window restoration signal only in the bootstrap contract", async () => {
  const { decodeBootstrapSnapshot, decodeSystemMotionNotice, decodeStorageNotice } =
    await import("@ohtia/contracts");
  const snapshot = { version: 1, locale: "en-US", state: "storage_ready" };
  expect(decodeBootstrapSnapshot({ ...snapshot, restoreLastProject: true })).toEqual({
    ...snapshot,
    restoreLastProject: true,
  });
  expect(decodeBootstrapSnapshot({ ...snapshot, restoreLastProject: false })).toEqual({
    ...snapshot,
    restoreLastProject: false,
  });
  expect(decodeBootstrapSnapshot({ ...snapshot, restoreLastProject: "true" })).toBeUndefined();
  const navigateConversation = {
    projectId: "019a8000-0000-7000-8000-000000000501",
    conversationId: "019a8000-0000-7000-8000-000000000502",
    revision: 1,
  };
  expect(decodeBootstrapSnapshot({ ...snapshot, navigateConversation })).toEqual({
    ...snapshot,
    navigateConversation,
  });
  for (const patch of [
    { revision: 0 },
    { revision: 1.5 },
    { revision: "1" },
    { projectId: "wrong" },
    { conversationId: null },
    { extra: true },
  ])
    expect(
      decodeBootstrapSnapshot({
        ...snapshot,
        navigateConversation: { ...navigateConversation, ...patch },
      }),
    ).toBeUndefined();

  expect(
    decodeSystemMotionNotice({ sequence: 1, value: "reduce", restoreLastProject: true }),
  ).toBeUndefined();
  expect(
    decodeStorageNotice({
      kind: "storage",
      generation: "service",
      state: "storage_ready",
      restoreLastProject: true,
    }),
  ).toBeUndefined();
});

it("migrates confirmed titles and retains exact rename receipts and setup history across restart", async () => {
  const fixture = storageFixture();
  await fixture.store.open();
  const projectId = value(
    await fixture.store.executeResearchCommand({
      command: "project.create",
      operationId: "title-project",
      payload: {},
    }),
  ).resultId;
  const command = (
    operationId: string,
    title: string,
    expectedTitleRevision: number,
    subtitle: string | null = null,
  ) => ({
    command: "project.rename" as const,
    operationId,
    payload: { projectId, title, subtitle, expectedTitleRevision },
  });
  expect(
    await fixture.store.executeResearchCommand(command("bad-revision", "Another title", 0)),
  ).toEqual(failure("invalid_message"));
  expect(
    await fixture.store.executeResearchCommand(command("unfinished", "Another title", 1)),
  ).toEqual(failure("project_in_setup"));
  const proposalId = await proposeSetup(fixture.store, fixture.raw, projectId, {
    title: "Working title A",
    document_language: "ko-KR",
  });
  value(
    await fixture.store.executeResearchCommand({
      command: "project.confirmSetup",
      operationId: "confirm-title",
      payload: { proposalId },
    }),
  );
  const before = value(await fixture.store.readProjects())[0]!;
  const context = value(await fixture.store.readConversations(projectId));
  await fixture.store.close();
  const prior = fixture.raw();
  const setup = prior.prepare("SELECT * FROM project_setup_proposals").get();
  prior.exec(preProjectTitleSql);
  expect(prior.pragma("user_version", { simple: true })).toBe(37);
  prior.close();
  const migrated = new DurableStore(fixture.options);
  stores.push(migrated);
  await migrated.open();
  expect(value(await migrated.readProjects())).toEqual([before]);
  expect(before.titleRevision).toBe(1);
  const unchanged = command("unchanged", "Working title A", 1);
  expect(value(await migrated.executeResearchCommand(unchanged)).titleChange).toEqual({
    title: "Working title A",
    subtitle: null,
    titleRevision: 1,
  });
  const first = command("first-title", "연구 제목 — مراجعة", 1);
  const accepted = await migrated.executeResearchCommand(first);
  expect(value(accepted).titleChange).toEqual({
    title: first.payload.title,
    subtitle: null,
    titleRevision: 2,
  });
  expect(
    await migrated.executeResearchCommand(command("stale", "Working title A", 1)),
  ).toMatchObject({
    ok: false,
    error: { code: "stale_revision", parameters: { currentRevision: 2 } },
  });
  expect(await migrated.executeResearchCommand(command("invalid", " leading", 2))).toEqual(
    failure("name_invalid"),
  );
  value(await migrated.executeResearchCommand(command("title-returned", "Working title A", 2)));
  expect(
    await migrated.executeResearchCommand(command("same-title-stale", "Working title A", 1)),
  ).toMatchObject({
    ok: false,
    error: { code: "stale_revision", parameters: { currentRevision: 3 } },
  });
  // The subtitle shares the title revision: adding or removing it advances the revision once.
  const subtitled = command("subtitle-added", "Working title A", 3, "Redes de cuidado — 연구");
  expect(value(await migrated.executeResearchCommand(subtitled)).titleChange).toEqual({
    title: "Working title A",
    subtitle: "Redes de cuidado — 연구",
    titleRevision: 4,
  });
  expect(value(await migrated.readProjects())[0]).toMatchObject({
    subtitle: "Redes de cuidado — 연구",
    titleRevision: 4,
  });
  for (const invalid of [" leading", "", "x".repeat(201), "a\0b"])
    expect(
      await migrated.executeResearchCommand(command("bad-subtitle", "Working title A", 4, invalid)),
    ).toEqual(failure("name_invalid"));
  expect(
    value(
      await migrated.executeResearchCommand(
        command("subtitle-unchanged", "Working title A", 4, "Redes de cuidado — 연구"),
      ),
    ).titleChange,
  ).toMatchObject({ titleRevision: 4 });
  expect(
    value(await migrated.executeResearchCommand(command("subtitle-removed", "Working title A", 4)))
      .titleChange,
  ).toEqual({ title: "Working title A", subtitle: null, titleRevision: 5 });
  await migrated.close();

  const restarted = new DurableStore(fixture.options);
  stores.push(restarted);
  await restarted.open();
  expect(await restarted.executeResearchCommand(first)).toEqual(accepted);
  expect(
    await restarted.executeResearchCommand(command("first-title", "Different title", 1)),
  ).toEqual(failure("operation_conflict"));
  expect(await restarted.executeResearchCommand(subtitled)).toMatchObject({
    ok: true,
    value: { titleChange: { subtitle: "Redes de cuidado — 연구", titleRevision: 4 } },
  });
  expect(value(await restarted.readProjects())).toEqual([{ ...before, titleRevision: 5 }]);
  expect(value(await restarted.readConversations(projectId))).toEqual(context);
  const current = fixture.raw();
  try {
    expect(current.prepare("SELECT * FROM project_setup_proposals").get()).toEqual(setup);
    expect(
      current
        .prepare(
          "SELECT previous_subtitle, subtitle, previous_revision, title_revision FROM project_title_history ORDER BY rowid",
        )
        .all(),
    ).toEqual([
      { previous_subtitle: null, subtitle: null, previous_revision: 1, title_revision: 1 },
      { previous_subtitle: null, subtitle: null, previous_revision: 1, title_revision: 2 },
      { previous_subtitle: null, subtitle: null, previous_revision: 2, title_revision: 3 },
      {
        previous_subtitle: null,
        subtitle: "Redes de cuidado — 연구",
        previous_revision: 3,
        title_revision: 4,
      },
      {
        previous_subtitle: "Redes de cuidado — 연구",
        subtitle: "Redes de cuidado — 연구",
        previous_revision: 4,
        title_revision: 4,
      },
      {
        previous_subtitle: "Redes de cuidado — 연구",
        subtitle: null,
        previous_revision: 4,
        title_revision: 5,
      },
    ]);
    // A subtitle requires a confirmed setup and cannot change outside a counted revision.
    expect(() =>
      current.exec("UPDATE projects SET subtitle='Changed' WHERE title_revision=5"),
    ).toThrow(/Invalid project title revision/);
    expect(
      current
        .prepare(
          "SELECT command FROM command_receipts WHERE operation_id IN ('stale','invalid','unfinished')",
        )
        .all(),
    ).toEqual([]);
    expect(() => current.exec("UPDATE project_title_history SET title='Changed'")).toThrow(
      /Immutable/,
    );
  } finally {
    current.close();
  }
});
