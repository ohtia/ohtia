import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  encodeProfileContent,
  failure,
  policyId,
  researchStages,
  staleRevision,
  type DiagnosticEvent,
  type Outcome,
  type Request,
  type StageTransitionPayload,
  type StageTransitionDetails,
} from "@ohtia/contracts";
import { bytes, identifier, newId } from "../packages/utility/src/research.js";
import { preResearchStageSql } from "../tooling/storage-legacy-consultation-fixture.mjs";
import { proposeSetup } from "./fixtures/project-setup.js";
import { storageFixture } from "./fixtures/storage.js";

type Fixture = ReturnType<typeof storageFixture>;
const subscriptionId = "selected-thesis";
const stageId = "onboarding";
const scope = (projectId: string) => ({ projectId, stageId, subscriptionId }) as const;

function value<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(outcome.error.code);
  return outcome.value;
}

async function confirmed({ raw, store }: Fixture, name: string) {
  const { resultId: projectId } = value(
    await store.executeResearchCommand({
      command: "project.create",
      operationId: `project-${name}`,
      payload: {},
    }),
  );
  const proposalId = await proposeSetup(store, raw, projectId);
  value(
    await store.executeResearchCommand({
      command: "project.confirmSetup",
      operationId: `confirm-${name}`,
      payload: { proposalId },
    }),
  );
  return projectId;
}

function profile(projectId: string, expectedRevision: number) {
  return {
    command: "profile.save" as const,
    operationId: `profile-${expectedRevision}`,
    payload: {
      projectId,
      expectedRevision,
      patch: encodeProfileContent({
        schemaVersion: 1,
        fields: {
          topic: expectedRevision === 0 ? { state: "unknown" } : { state: "inapplicable" },
        },
      }),
    },
  };
}

function enter(
  projectId: string,
  {
    stageId = "onboarding",
    expectedRevision = 0,
    ...details
  }: Partial<Omit<StageTransitionPayload, "projectId" | "decision"> & StageTransitionDetails> = {},
) {
  return {
    command: "stage.transition" as const,
    operationId: "start-onboarding",
    payload: {
      projectId,
      stageId,
      expectedRevision,
      decision: {
        profileRevisionId: null,
        reason: "Confirm the initial stage after reviewing the available context.",
        artifacts: [],
        remainingConditions: ["Check institutional requirements."],
        transition: { kind: "enter" },
        ...details,
      },
    } satisfies StageTransitionPayload,
  };
}

function read(
  f: Fixture,
  input: Extract<Request, { operation: "stage.read" | "stage.history" | "stage.receipt" }>,
) {
  return f.store.readResearch(input);
}

const authority = {
  protocol: 1,
  policy: policyId,
  kind: "request",
  requestId: "request",
  operationId: "read-stage",
  windowGeneration: "window",
  serviceGeneration: "service",
} as const;

function snapshot(f: Fixture, projectId: string) {
  return read(f, { ...authority, operation: "stage.read", payload: scope(projectId) });
}

function history(f: Fixture, projectId: string, revision: number) {
  return read(f, {
    ...authority,
    operation: "stage.history",
    payload: { ...scope(projectId), revision },
  });
}

function receipt(f: Fixture, command: ReturnType<typeof enter>) {
  return read(f, {
    ...authority,
    operation: "stage.receipt",
    payload: { ...command.payload, subscriptionId, operationId: command.operationId },
  });
}

async function researcherMessage(f: Fixture, projectId: string) {
  const { resultId: conversationId } = value(
    await f.store.executeResearchCommand({
      command: "conversation.start",
      operationId: `conversation-${projectId}`,
      payload: { projectId, content: "A synthetic source description the researcher reviewed." },
    }),
  );
  const messages = value(await f.store.readMessages(conversationId));
  return { artifact: "conversation_message", id: messages[0]!.id, revision: 1 } as const;
}

function persistReviewedCompletion(
  f: Fixture,
  projectId: string,
  previousId: string,
  profileId: string,
  messageId: string,
) {
  const db = f.raw();
  const id = newId();
  try {
    db.pragma("foreign_keys = ON");
    db.transaction(() => {
      db.prepare(
        `INSERT INTO research_stage_decisions
        (id,project_id,stage,revision,project_order,kind,preceding_state,previous_decision_id,
         profile_revision_id,operation_id,actor,observed_at,reason,remaining_conditions,next_review_condition)
        VALUES (?,?,'onboarding',2,2,'complete','in-progress',?,?,'test-reviewed-milestone',
          'researcher','2026-01-01T11:00:00.000Z','Reviewed the attributed profile and first focus.','[]',NULL)`,
      ).run(id, bytes(projectId), bytes(previousId), bytes(profileId));
      db.prepare("INSERT INTO research_stage_artifacts VALUES (?,1,?)").run(id, bytes(messageId));
      db.prepare(
        `INSERT INTO command_receipts
        (operation_id,command,payload_sha256,result_id,created_at)
        VALUES ('test-reviewed-milestone','stage.complete',zeroblob(32),?,'2026-01-01T11:00:00.000Z')`,
      ).run(id);
    })();
  } finally {
    db.close();
  }
  return identifier(id);
}

describe("research stage decisions in file-backed SQLite", () => {
  it("upgrades schema 39 with its profile and receipt intact and reads each stage without opening it", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await confirmed(f, "previous-schema");
    const command = profile(projectId, 0);
    const saved = value(await f.store.executeResearchCommand(command));
    await f.store.close();
    const prior = f.raw();
    prior.exec(preResearchStageSql);
    expect(prior.pragma("user_version", { simple: true })).toBe(39);
    prior.close();
    await f.store.open();
    const upgraded = f.raw();
    expect(upgraded.pragma("user_version", { simple: true })).toBe(42);
    upgraded.close();
    const checkpointDir = path.join(f.root, "recovery", "migrations");
    expect(
      fs.readdirSync(checkpointDir).some((id) => {
        const manifest = path.join(checkpointDir, id, "manifest.json");
        return (
          fs.existsSync(manifest) &&
          JSON.parse(fs.readFileSync(manifest, "utf8")).sourceRevision === 39
        );
      }),
    ).toBe(true);
    expect(await f.store.executeResearchCommand(command)).toEqual({ ok: true, value: saved });
    expect(
      await f.store.readResearch({
        ...authority,
        operation: "profile.read",
        payload: { projectId, subscriptionId, revisionId: saved.resultId },
      }),
    ).toMatchObject({
      ok: true,
      value: { profile: { revisionId: saved.resultId, content: command.payload.patch } },
    });
    for (const stageId of researchStages) {
      expect(
        value(
          await read(f, {
            ...authority,
            operation: "stage.read",
            payload: { projectId, stageId, subscriptionId },
          }),
        ),
      ).toEqual({
        projectId,
        stageId,
        profileRevisionId: saved.resultId,
        state: "not-started",
        decisionId: null,
        revision: 0,
        latestEntry: null,
        enter: stageId === "onboarding" ? "available" : "workflow_unavailable",
        reopen: stageId === "onboarding" ? "wrong_state" : "workflow_unavailable",
      });
    }
    expect(await history(f, projectId, 1)).toEqual(failure("record_not_found"));
    expect(
      await f.store.executeResearchCommand(
        enter(projectId, { stageId: "literature", profileRevisionId: saved.resultId }),
      ),
    ).toEqual(failure("stage_unavailable"));
  });

  it("serializes two first entries and reconciles only the canonical winning request", async () => {
    const diagnostics: DiagnosticEvent[] = [];
    const f = storageFixture((event) => diagnostics.push(event));
    await f.store.open();
    const projectId = await confirmed(f, "concurrent");
    const command = enter(projectId);
    const contender = { ...command, operationId: "competing-entry" };
    const [first, concurrent] = await Promise.all([
      f.store.executeResearchCommand(command),
      f.store.executeResearchCommand(contender),
    ]);
    expect(concurrent).toEqual(failure("busy"));
    expect(await f.store.executeResearchCommand(contender)).toEqual(staleRevision(1));
    const saved = value(first);
    expect(value(await history(f, projectId, 1))).toEqual(saved.stageDecision);
    expect(value(await snapshot(f, projectId))).toMatchObject({
      state: "in-progress",
      revision: 1,
      decisionId: saved.resultId,
      latestEntry: { stageId, revision: 1, decisionId: saved.resultId },
    });
    expect(
      await f.store.executeResearchCommand({
        ...contender,
        payload: { ...contender.payload, expectedRevision: 1 },
      }),
    ).toEqual(failure("stage_state_changed"));
    expect(value(await receipt(f, contender))).toEqual({
      projectId,
      stageId,
      operationId: contender.operationId,
      receipt: null,
    });
    expect(value(await receipt(f, command))).toMatchObject({ receipt: saved });
    const changed = {
      ...command,
      payload: {
        ...command.payload,
        decision: { ...command.payload.decision, reason: "A different choice" },
      },
    };
    expect(await receipt(f, changed)).toEqual(failure("operation_conflict"));
    expect(await f.store.executeResearchCommand(changed)).toEqual(failure("operation_conflict"));
    expect(await f.store.executeResearchCommand(command)).toEqual(first);
    expect(await history(f, projectId, 2)).toEqual(failure("record_not_found"));
    expect(
      await f.store.executeResearchCommand({
        ...contender,
        payload: { ...contender.payload, stageId: "literature" },
      }),
    ).toEqual(failure("stage_unavailable"));
    const failures = diagnostics.filter(({ event_name }) => event_name === "ohtia.research.failed");
    expect(failures.map(({ error_code }) => error_code)).toEqual([
      "busy",
      "stale_revision",
      "stage_state_changed",
      "operation_conflict",
      "stage_unavailable",
    ]);
  });

  it("enforces the stage chain, artifact ownership, receipt pairing and immutability in SQLite", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await confirmed(f, "schema");
    const otherProject = await confirmed(f, "schema-other");
    const local = await researcherMessage(f, projectId);
    const foreign = await researcherMessage(f, otherProject);
    const entered = value(await f.store.executeResearchCommand(enter(projectId)));
    const db = f.raw();
    try {
      db.pragma("foreign_keys = ON");
      const previousId = bytes(entered.resultId);
      const project = bytes(projectId);
      const completionId = newId();
      const append = db.prepare(`INSERT INTO research_stage_decisions
        (id,project_id,stage,revision,project_order,kind,preceding_state,previous_decision_id,
         operation_id,actor,observed_at,reason,remaining_conditions,next_review_condition)
        VALUES (?,?,'onboarding',?,2,?,?,?,'raw-stage-fixture',
          'researcher','2026-01-01T11:00:00.000Z','Reviewed the attributed context.','[]',?)`);
      const attach = db.prepare("INSERT INTO research_stage_artifacts VALUES (?,1,?)");
      const receipt = db.prepare(`INSERT INTO command_receipts
        (operation_id,command,payload_sha256,result_id,created_at)
        VALUES ('raw-stage-fixture',?,zeroblob(32),?,'2026-01-01T11:00:00.000Z')`);

      expect(() => append.run(newId(), project, 1, "enter", "not-started", null, null)).toThrow(
        "Invalid research stage predecessor",
      );
      expect(() =>
        append.run(newId(), project, 3, "reopen", "done", previousId, "Recheck scope."),
      ).toThrow("Invalid research stage predecessor");

      const complete = () =>
        append.run(completionId, project, 2, "complete", "in-progress", previousId, null);
      expect(() =>
        db.transaction(() => {
          complete();
        })(),
      ).toThrow("FOREIGN KEY");
      expect(() =>
        db.transaction(() => {
          complete();
          receipt.run("stage.transition", completionId);
        })(),
      ).toThrow("Invalid research stage receipt");

      db.transaction(() => {
        complete();
        expect(() => attach.run(completionId, bytes(foreign.id))).toThrow(
          "Invalid research stage artifact",
        );
        attach.run(completionId, bytes(local.id));
        receipt.run("stage.complete", completionId);
      })();

      expect(() => attach.run(previousId, bytes(local.id))).toThrow(
        "Invalid research stage artifact",
      );
      expect(() =>
        db
          .prepare("UPDATE research_stage_decisions SET reason=? WHERE id=?")
          .run("A different decision.", completionId),
      ).toThrow("Immutable research stage decision");
      expect(() =>
        db.prepare("DELETE FROM research_stage_artifacts WHERE decision_id=?").run(completionId),
      ).toThrow("Immutable research stage artifact");
    } finally {
      db.close();
    }
    expect(value(await history(f, projectId, 2))).toMatchObject({
      kind: "complete",
      artifacts: [local],
      decisionId: expect.any(String),
    });
    expect(await history(f, otherProject, 2)).toEqual(failure("record_not_found"));
  });

  it("rejects stale profile context, cross-project evidence, and failed receipt writes without changing history", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await confirmed(f, "current");
    const outside = await confirmed(f, "outside");
    const artifact = await researcherMessage(f, outside);
    const { resultId: profileRevisionId } = value(
      await f.store.executeResearchCommand(profile(projectId, 0)),
    );
    const earlier = enter(projectId);
    expect(await f.store.executeResearchCommand(earlier)).toEqual(failure("input_changed"));
    const command = enter(projectId, { profileRevisionId });
    const profileRead = {
      ...authority,
      operation: "profile.read",
      payload: { projectId, subscriptionId, revisionId: null },
    } as const;
    const previousProfile = value(await f.store.readResearch(profileRead));
    expect(
      await f.store.executeResearchCommand(
        enter(projectId, { profileRevisionId, artifacts: [artifact] }),
      ),
    ).toEqual(failure("record_not_found"));
    expect(await f.store.executeResearchCommand(enter(projectId, { reason: "  " }))).toEqual(
      failure("invalid_message"),
    );
    expect(
      await f.store.executeResearchCommand(enter(projectId, { reason: "📝".repeat(257) })),
    ).toEqual(failure("invalid_message"));
    const raw = f.raw();
    raw.exec(`CREATE TRIGGER reject_stage_receipt BEFORE INSERT ON command_receipts
      WHEN NEW.command='stage.transition' BEGIN SELECT RAISE(ABORT,'Synthetic receipt rejection'); END`);
    expect(await f.store.executeResearchCommand(command)).toEqual(failure("storage_failed"));
    raw.exec("DROP TRIGGER reject_stage_receipt");
    raw.close();
    expect(value(await snapshot(f, projectId))).toMatchObject({
      revision: 0,
      state: "not-started",
      latestEntry: null,
      profileRevisionId,
    });
    expect(value(await f.store.readResearch(profileRead))).toEqual(previousProfile);
    expect(value(await receipt(f, command))).toMatchObject({ receipt: null });
    const saved = value(await f.store.executeResearchCommand(command));
    expect(value(await history(f, projectId, 1))).toEqual(saved.stageDecision);
    expect(await history(f, outside, 1)).toEqual(failure("record_not_found"));
    expect(
      await receipt(f, { ...command, payload: { ...command.payload, projectId: outside } }),
    ).toEqual(failure("operation_conflict"));
  });

  it("reopens an exact persisted milestone and retains its reviewed context after restart", async () => {
    const f = storageFixture();
    await f.store.open();
    const projectId = await confirmed(f, "reviewed");
    const artifact = await researcherMessage(f, projectId);
    const { resultId: oldProfile } = value(
      await f.store.executeResearchCommand(profile(projectId, 0)),
    );
    const first = enter(projectId, { profileRevisionId: oldProfile });
    const started = value(await f.store.executeResearchCommand(first));
    const reviewedDecisionId = persistReviewedCompletion(
      f,
      projectId,
      started.resultId,
      oldProfile,
      artifact.id,
    );
    const complete = value(await history(f, projectId, 2));
    expect(complete).toMatchObject({
      decisionId: reviewedDecisionId,
      kind: "complete",
      state: "done",
      profileRevisionId: oldProfile,
      artifacts: [artifact],
    });
    expect(value(await snapshot(f, projectId))).toMatchObject({
      state: "done",
      enter: "wrong_state",
      reopen: "available",
      latestEntry: { decisionId: started.resultId },
    });
    const { resultId: profileRevisionId } = value(
      await f.store.executeResearchCommand(profile(projectId, 1)),
    );
    const command = {
      ...enter(projectId, {
        expectedRevision: 2,
        profileRevisionId,
        reason: "A scope change calls for another review.",
        artifacts: [artifact],
        transition: {
          kind: "reopen",
          reviewedDecisionId,
          nextReviewCondition: "Confirm the revised focus.",
        },
      }),
      operationId: "reopen-onboarding",
    };
    expect(
      await f.store.executeResearchCommand({
        ...command,
        payload: { ...command.payload, expectedRevision: 1 },
      }),
    ).toEqual(staleRevision(2));
    expect(
      await f.store.executeResearchCommand({
        ...command,
        payload: {
          ...command.payload,
          decision: {
            ...command.payload.decision,
            transition: {
              kind: "reopen",
              reviewedDecisionId: started.resultId,
              nextReviewCondition: "Review.",
            },
          },
        },
      }),
    ).toEqual(failure("input_changed"));
    const saved = value(await f.store.executeResearchCommand(command));
    expect(saved.stageDecision).toMatchObject({
      revision: 3,
      precedingState: "done",
      state: "in-progress",
      kind: "reopen",
      actor: "researcher",
      profileRevisionId,
      reviewedDecisionId,
      affectedProfileRevisionId: oldProfile,
      affectedOutputs: [artifact],
      nextReviewCondition: "Confirm the revised focus.",
    });
    expect(value(await snapshot(f, projectId))).toMatchObject({
      revision: 3,
      latestEntry: { decisionId: saved.resultId },
    });
    await f.store.close();
    await f.store.open();
    expect(value(await history(f, projectId, 2))).toEqual(complete);
    expect(value(await history(f, projectId, 3))).toEqual(saved.stageDecision);
    expect(value(await receipt(f, command))).toMatchObject({ receipt: saved });
    expect(value(await f.store.executeResearchCommand(first))).toEqual(started);
    await f.store.close();
    const verification = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { DurableStore } from "./packages/utility/dist/index.js";
       const [options, history, profile, command] = process.argv.slice(1).map(JSON.parse);
       const store = new DurableStore({ ...options, assertAdmission() {} });
       await store.open();
       const reviewed = await store.readResearch(history);
       const exactProfile = await store.readResearch(profile);
       const replay = await store.executeResearchCommand(command);
       await store.close();
       process.stdout.write(JSON.stringify({ reviewed, exactProfile, replay }));`,
        JSON.stringify(f.options),
        JSON.stringify({
          ...authority,
          operation: "stage.history",
          payload: { ...scope(projectId), revision: 2 },
        }),
        JSON.stringify({
          ...authority,
          operation: "profile.read",
          payload: { projectId, subscriptionId, revisionId: oldProfile },
        }),
        JSON.stringify(command),
      ],
      { encoding: "utf8" },
    );
    expect(JSON.parse(verification)).toMatchObject({
      reviewed: { ok: true, value: complete },
      exactProfile: { ok: true, value: { profile: { revisionId: oldProfile } } },
      replay: { ok: true, value: saved },
    });
  });
});
