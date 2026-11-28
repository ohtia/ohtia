import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  decodeProfileContent,
  decodeStoredProfileContent,
  encodeProfileContent,
  failure,
  policyId,
  type Outcome,
  type ProfileFields,
  type Request,
  type ResearchPayloads,
} from "@ohtia/contracts";
import { bytes, identifier, newId } from "../packages/utility/src/research.js";
import { objects as profileObjects } from "../packages/utility/src/migrations/0039_thesis_profile.mjs";
import { preThesisProfileSql } from "../tooling/storage-legacy-consultation-fixture.mjs";
import { proposeSetup, setupConnections } from "./fixtures/project-setup.js";
import { storageFixture } from "./fixtures/storage.js";

function value<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(outcome.error.code);
  return outcome.value;
}
const statement = { kind: "researcher_statement" } as const;
const known = <T>(value: T) => ({ state: "known", value, origin: statement }) as const;
const encode = (fields: ProfileFields) => encodeProfileContent({ schemaVersion: 2, fields });
function read(projectId: string, revisionId: string | null = null): Request {
  return {
    protocol: 1,
    policy: policyId,
    kind: "request",
    operation: "profile.read",
    requestId: "request",
    operationId: "read-profile",
    windowGeneration: "window",
    serviceGeneration: "service",
    payload: { projectId, subscriptionId: "subscription", revisionId },
  };
}
function save(
  projectId: string,
  operationId: string,
  expectedRevision: number,
  fields: ProfileFields,
) {
  return {
    command: "profile.save" as const,
    operationId,
    payload: {
      projectId,
      expectedRevision,
      patch: encode(fields),
    } satisfies ResearchPayloads["profile.save"],
  };
}

async function confirmed(f: ReturnType<typeof storageFixture>, name: string) {
  const projectId = value(
    await f.store.executeResearchCommand({
      command: "project.create",
      operationId: `project-${name}`,
      payload: {},
    }),
  ).resultId;
  const proposalId = await proposeSetup(f.store, f.raw, projectId, {
    title: `Thesis ${name}`,
    document_language: "es-AR",
  });
  value(
    await f.store.executeResearchCommand({
      command: "project.confirmSetup",
      operationId: `confirm-${name}`,
      payload: { proposalId },
    }),
  );
  return projectId;
}

describe("thesis profile storage", () => {
  it("upgrades confirmed thesis data and reopens exact profile revisions and receipts in a fresh process", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await confirmed(f, "legacy");
    const projects = value(await f.store.readProjects());
    await f.store.close();

    const prior = f.raw();
    try {
      prior.exec(preThesisProfileSql);
      expect(prior.pragma("user_version", { simple: true })).toBe(38);
    } finally {
      prior.close();
    }

    await f.store.open();
    expect(value(await f.store.readProjects())).toEqual(projects);
    expect(value(await f.store.readResearch(read(projectId)))).toEqual({
      projectId,
      profile: null,
    });
    const checkpoints = path.join(f.root, "recovery", "migrations");
    expect(
      fs
        .readdirSync(checkpoints)
        .filter((name) => !name.includes("."))
        .some(
          (name) =>
            JSON.parse(fs.readFileSync(path.join(checkpoints, name, "manifest.json"), "utf8"))
              .sourceRevision === 38,
        ),
    ).toBe(true);

    const first = save(projectId, "partial-profile", 0, {
      deadline: { state: "unknown" },
      topic: { state: "unknown" },
      questions: { state: "unknown" },
      weekly_availability_minutes: known(0),
      target_languages: { state: "inapplicable" },
    });
    const initial = value(await f.store.executeResearchCommand(first));
    const second = save(projectId, "advanced-profile", 1, {
      questions: { state: "known", items: [known("How was the collection catalogued?")] },
      bibliography: {
        state: "known",
        items: [
          {
            state: "known",
            value: "Municipal archive inventory",
            origin: {
              kind: "described_material",
              description: "Citation supplied by the researcher.",
            },
          },
        ],
      },
    });
    const latest = value(await f.store.executeResearchCommand(second));
    expect(latest.profileChange?.revision).toMatchObject({
      revision: 2,
      previousRevisionId: initial.resultId,
      changedFields: ["bibliography", "questions"],
    });
    expect(value(await f.store.readProjects())).toEqual(projects);
    await f.store.close();

    // The child loads the built packages and re-admits the same file-backed store from scratch.
    const verification = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { DurableStore } from "./packages/utility/dist/index.js";
       const [options, request, command] = process.argv.slice(1).map((text) => JSON.parse(text));
       const store = new DurableStore({ ...options, assertAdmission() {} });
       await store.open();
       const current = await store.readResearch({ ...request, payload: { ...request.payload, revisionId: null } });
       const exact = await store.readResearch(request);
       const replay = await store.executeResearchCommand(command);
       await store.close();
       process.stdout.write(JSON.stringify({ exact, current, replay }));`,
        JSON.stringify(f.options),
        JSON.stringify(read(projectId, initial.resultId)),
        JSON.stringify(first),
      ],
      { encoding: "utf8" },
    );
    const restarted = JSON.parse(verification);
    expect(restarted).toMatchObject({
      exact: {
        ok: true,
        value: {
          projectId,
          profile: {
            revisionId: initial.resultId,
            content: first.payload.patch,
          },
        },
      },
      current: {
        ok: true,
        value: {
          projectId,
          profile: {
            revisionId: latest.resultId,
            content: encode({
              ...decodeProfileContent(first.payload.patch)!.fields,
              ...decodeProfileContent(second.payload.patch)!.fields,
            }),
          },
        },
      },
      replay: { ok: true, value: initial },
    });
  });

  it("rejects invalid facts and rolls a failed receipt back with the current pointer", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await confirmed(f, "bounds");
    const original = save(projectId, "profile-bounds", 0, { topic: known("📝".repeat(512)) });
    expect(
      await f.store.executeResearchCommand({
        ...original,
        operationId: "missing-predecessor",
        payload: { ...original.payload, expectedRevision: 1 },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "stale_revision", parameters: { currentRevision: 0 } },
    });
    const first = value(await f.store.executeResearchCommand(original));
    const invalid = [
      { deadline: known("2025-02-29") },
      { deadline: known("2026-04-31") },
      { deadline: known("0000-12-25") },
      { weekly_availability_minutes: known(10_081) },
      { weekly_availability_minutes: known(0.25) },
      { goals: { state: "known", items: Array.from({ length: 17 }, () => known("Goal")) } },
      { topic: known("📝".repeat(512) + "x") },
      { topic: { ...known("Context"), origin: { kind: "model_guess" } } },
      { document_language: known("en") },
      { milestones: { state: "known", items: [known({ title: "No done mark" })] } },
      { milestones: { state: "known", items: [known({ title: "Mark", done: "yes" })] } },
    ];
    for (const fields of invalid) {
      const request = {
        ...original,
        operationId: "rejected-fact",
        payload: {
          projectId,
          expectedRevision: 1,
          patch: canonicalJson({ schemaVersion: 2, fields }),
        },
      };
      expect(await f.store.executeResearchCommand(request)).toEqual(failure("invalid_message"));
    }
    // Saves write the current schema version only.
    expect(
      await f.store.executeResearchCommand({
        ...original,
        operationId: "version-one-patch",
        payload: {
          projectId,
          expectedRevision: 1,
          patch: canonicalJson({ schemaVersion: 1, fields: { topic: known("Older shape") } }),
        },
      }),
    ).toEqual(failure("invalid_message"));
    const large = (count: number) => Array.from({ length: count }, () => known("📚".repeat(512)));
    const oversized = save(projectId, "profile-too-big", 1, {
      bibliography: { state: "known", items: large(15) },
    });
    expect(await f.store.executeResearchCommand(oversized)).toEqual(failure("limit_reached"));
    expect(
      await f.store.executeResearchCommand(
        save(projectId, "profile-bounds", 1, { topic: known("different") }),
      ),
    ).toEqual(failure("operation_conflict"));

    const db = f.raw();
    try {
      db.exec(`CREATE TRIGGER reject_profile_receipt BEFORE INSERT ON command_receipts
        WHEN NEW.operation_id='profile-rollback' BEGIN SELECT RAISE(ABORT,'Synthetic write failure'); END`);
      const command = save(projectId, "profile-rollback", 1, {
        deadline: known("2028-02-29"),
        milestones: {
          state: "known",
          items: [
            known({ title: "Review", done: true }),
            known({ title: "Submit", date: "2028-02-29", done: false }),
          ],
        },
      });
      expect(await f.store.executeResearchCommand(command)).toEqual(failure("storage_failed"));
      expect(value(await f.store.readResearch(read(projectId)))).toMatchObject({
        projectId,
        profile: { revisionId: first.resultId, revision: 1, content: original.payload.patch },
      });
      expect(db.prepare("SELECT count(*) FROM thesis_profile_revisions").pluck().get()).toBe(1);
      expect(
        db.prepare("SELECT 1 FROM command_receipts WHERE operation_id='profile-rollback'").get(),
      ).toBeUndefined();
      expect(() => db.exec("UPDATE thesis_profile_revisions SET content='{}'")).toThrow(
        /Immutable/,
      );
      db.exec("DROP TRIGGER reject_profile_receipt");
      const next = value(await f.store.executeResearchCommand(command));
      const unchanged = value(
        await f.store.executeResearchCommand({
          ...command,
          operationId: "identical-field-values",
          payload: { ...command.payload, expectedRevision: 2 },
        }),
      );
      expect(unchanged.profileChange?.revision).toMatchObject({
        revision: 3,
        changedFields: [],
        previousRevisionId: next.resultId,
      });
    } finally {
      db.close();
    }
  });

  it("checks artifact ownership and preserves only exact explicit proposal adoptions", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await confirmed(f, "author");
    const otherId = await confirmed(f, "foreign");
    f.store.setTaskContext({
      generation: "setup-tests",
      mode: "development",
      connections: setupConnections(),
    });
    const [{ id: ownConversation }] = value(await f.store.readConversations(projectId));
    const [{ id: otherConversation }] = value(await f.store.readConversations(otherId));
    const append = async (operationId: string, conversationId: string) =>
      value(
        await f.store.executeResearchCommand({
          command: "message.append",
          operationId,
          payload: { conversationId, content: "Synthetic supporting message" },
        }),
      ).resultId;
    const foreignMessage = await append("foreign-message", otherConversation);
    const ownMessage = await append("own-message", ownConversation);
    const supporting = (id: string) =>
      ({
        ...known("Researcher's source reference"),
        origin: {
          kind: "artifact_version",
          artifact: "conversation_message",
          id,
          revision: 1,
        },
      }) as const;

    expect(
      await f.store.executeResearchCommand(
        save(projectId, "foreign-origin", 0, {
          bibliography: { state: "known", items: [supporting(foreignMessage)] },
        }),
      ),
    ).toEqual(failure("record_not_found"));
    const first = value(
      await f.store.executeResearchCommand(
        save(projectId, "own-origin", 0, {
          bibliography: { state: "known", items: [supporting(ownMessage)] },
        }),
      ),
    );
    const thirdProjectRead = await f.store.readResearch(read(otherId, first.resultId));
    expect(thirdProjectRead).toEqual(failure("record_not_found"));

    const db = f.raw();
    try {
      const task = value(await f.store.prepareTask());
      expect(task).not.toBeNull();
      value(
        await f.store.recordTaskEvent(
          task!.dispatch.request.attempt,
          { type: "result", sequence: 1, result: { status: "completed" } },
          "Synthetic proposal discussion",
        ),
      );
      // Use the actual completed attempt and its project. The future guidance producer owns proposal creation.
      const attempt = db
        .prepare(
          `SELECT a.id, t.project_id FROM attempts a JOIN tasks t ON t.id=a.task_id
        WHERE a.state='completed' AND t.operation='direct_guidance'`,
        )
        .get() as { id: Uint8Array; project_id: Uint8Array };
      const producerProject = identifier(attempt.project_id);
      const base = producerProject === projectId ? bytes(first.resultId) : null;
      const proposal = newId();
      db.prepare("INSERT INTO thesis_profile_proposals VALUES (?,?,?,?,?,?)").run(
        proposal,
        attempt.project_id,
        attempt.id,
        base,
        "goals",
        canonicalJson("Describe the collection"),
      );
      const adoption = {
        ...known("Describe the collection"),
        origin: {
          kind: "adopted_proposal",
          producer: "virgilio",
          proposalId: identifier(proposal),
          attemptId: identifier(attempt.id),
        },
      } as const;
      const at = base === null ? 0 : 1;
      const wrong = save(producerProject, "fabricated-adoption", at, {
        goals: {
          state: "known",
          items: [{ ...adoption, value: "Altered value" }],
        },
      });
      expect(await f.store.executeResearchCommand(wrong)).toEqual(failure("record_not_found"));
      expect(
        await f.store.executeResearchCommand(
          save(producerProject, "wrong-field", at, {
            questions: { state: "known", items: [adoption] },
          }),
        ),
      ).toEqual(failure("record_not_found"));
      const adopted = value(
        await f.store.executeResearchCommand(
          save(producerProject, "adopted", at, {
            goals: { state: "known", items: [adoption] },
          }),
        ),
      );
      expect(
        value(await f.store.readResearch(read(producerProject, adopted.resultId))),
      ).toMatchObject({
        profile: { content: expect.stringContaining(identifier(attempt.id)) },
      });
      value(
        await f.store.executeResearchCommand(
          save(producerProject, "extend-adopted-list", at + 1, {
            goals: { state: "known", items: [adoption, known("Another goal")] },
          }),
        ),
      );
      // A milestone proposed before schema version 2 has no done mark and adopts as not done.
      const head = db
        .prepare("SELECT revision_id FROM thesis_profile_heads WHERE project_id=?")
        .pluck()
        .get(attempt.project_id) as Uint8Array;
      const legacyProposal = newId();
      db.prepare("INSERT INTO thesis_profile_proposals VALUES (?,?,?,?,?,?)").run(
        legacyProposal,
        attempt.project_id,
        attempt.id,
        head,
        "milestones",
        canonicalJson({ title: "Pilot interviews", date: "2027-03-01" }),
      );
      const milestone = (done: boolean) =>
        ({
          ...known({ title: "Pilot interviews", date: "2027-03-01", done }),
          origin: { ...adoption.origin, proposalId: identifier(legacyProposal) },
        }) as const;
      expect(
        await f.store.executeResearchCommand(
          save(producerProject, "legacy-milestone-done", at + 2, {
            milestones: { state: "known", items: [milestone(true)] },
          }),
        ),
      ).toEqual(failure("record_not_found"));
      value(
        await f.store.executeResearchCommand(
          save(producerProject, "legacy-milestone", at + 2, {
            milestones: { state: "known", items: [milestone(false)] },
          }),
        ),
      );
      value(
        await f.store.executeResearchCommand(
          save(producerProject, "extend-legacy-milestones", at + 3, {
            milestones: {
              state: "known",
              items: [milestone(false), known({ title: "Ethics form", done: false })],
            },
          }),
        ),
      );
      expect(() => db.exec("DELETE FROM thesis_profile_proposals")).toThrow(/Immutable/);
    } finally {
      db.close();
    }
  });

  it("reads a version 1 snapshot as not done and saves the next revision as version 2", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await confirmed(f, "milestones");
    const first = value(
      await f.store.executeResearchCommand(
        save(projectId, "first-milestones", 0, {
          milestones: {
            state: "known",
            items: [known({ title: "Draft", date: "2027-01-10", done: true })],
          },
        }),
      ),
    );
    // Rewrite the stored snapshot to the released version 1 shape, which has no done mark.
    const legacy = canonicalJson({
      schemaVersion: 1,
      fields: {
        milestones: { state: "known", items: [known({ title: "Draft", date: "2027-01-10" })] },
      },
    });
    const db = f.raw();
    try {
      db.exec("DROP TRIGGER thesis_profile_revision_update");
      db.prepare("UPDATE thesis_profile_revisions SET content=?").run(legacy);
      db.exec(profileObjects.thesis_profile_revision_update);
    } finally {
      db.close();
    }
    const stored = value(await f.store.readResearch(read(projectId))) as {
      profile: { content: string; revisionId: string };
    };
    expect(stored.profile).toMatchObject({ revisionId: first.resultId, content: legacy });
    expect(decodeProfileContent(legacy)).toBeUndefined();
    expect(decodeStoredProfileContent(legacy)).toEqual({
      schemaVersion: 2,
      fields: {
        milestones: {
          state: "known",
          items: [known({ title: "Draft", date: "2027-01-10", done: false })],
        },
      },
    });

    value(
      await f.store.executeResearchCommand(
        save(projectId, "after-legacy", 1, { topic: known("Care networks") }),
      ),
    );
    const next = value(await f.store.readResearch(read(projectId))) as {
      profile: { content: string; revision: number };
    };
    expect(next.profile.revision).toBe(2);
    expect(decodeProfileContent(next.profile.content)).toEqual({
      schemaVersion: 2,
      fields: {
        milestones: {
          state: "known",
          items: [known({ title: "Draft", date: "2027-01-10", done: false })],
        },
        topic: known("Care networks"),
      },
    });
  });
});
