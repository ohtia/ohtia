import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  decodeProfileContent,
  encodeProfileContent,
  failure,
  splitText,
  type Outcome,
  type ProfileFields,
  type ProfileReadResult,
  type ProfileReceiptResult,
  type ProfileSaveResult,
  type ResearchInputs,
  type ResearchOutputs,
} from "@ohtia/contracts";
import { ThesisProfileController } from "../packages/renderer/src/thesis-profile-controller.js";
import { PendingProjectWork } from "../packages/renderer/src/pending-project-work.js";
import {
  editFact,
  newDraftValue,
  profileFields,
  researcherOrigin,
} from "../packages/renderer/src/thesis-profile-fields.js";
import { profileFieldTypes } from "@ohtia/contracts";
import { call, deferred } from "./fixtures/settings.js";

const projectId = "project-a";
const subscriptionId = "subscription-a";
const scope = { projectId, subscriptionId };
const operationId = "operation-1";
const topic = (text: string) => editFact({ state: "known", value: text, origin: researcherOrigin });
const unknown = { state: "unknown", values: [] } as const;
const revision = (number: number) => ({
  revisionId: `revision-${number}`,
  previousRevisionId: number === 1 ? null : `revision-${number - 1}`,
  revision: number,
  changedFields: ["topic"] as const,
});
function saved(fields: ProfileFields, number: number): ProfileReadResult {
  return {
    projectId,
    profile: { ...revision(number), content: encodeProfileContent({ schemaVersion: 2, fields }) },
  };
}
function receipt(number: number): ProfileSaveResult {
  const metadata = revision(number);
  return { resultId: metadata.revisionId, profileChange: { projectId, revision: metadata } };
}
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });

function fixture() {
  const current = vi.fn(() => true);
  const lease = { projectId, isCurrent: current };
  const port = {
    readThesisProfile: vi.fn(() => call<ProfileReadResult>(ok({ projectId, profile: null }))),
    readThesisProfilePart: vi.fn(() =>
      call<ResearchOutputs["profile.readPart"]>(failure("storage_failed")),
    ),
    stageThesisProfilePart: vi.fn((_id: string, _input: ResearchInputs["profile.stagePart"]) =>
      call<ResearchOutputs["profile.stagePart"]>(ok({ accepted: true })),
    ),
    saveThesisProfile: vi.fn((_id: string, _input: ResearchInputs["profile.save"]) =>
      call<ProfileSaveResult>(failure("storage_failed")),
    ),
    readThesisProfileReceipt: vi.fn((_input: ResearchInputs["profile.receipt"]) =>
      call<ProfileReceiptResult>(ok({ projectId, operationId, receipt: null })),
    ),
  };
  const profile = new ThesisProfileController(port, () => operationId);
  const attach = () => profile.attach(lease, subscriptionId);
  const ready = async () => {
    attach();
    await vi.waitFor(() => expect(profile.snapshot().reading).toBe(false));
  };
  return { profile, port, ready, attach, lease, current };
}

it("covers each profile field exactly once and saves only submitted context", async () => {
  expect([...profileFields].sort()).toEqual(Object.keys(profileFieldTypes).sort());
  const { profile, port, ready } = fixture();
  await ready();
  expect(profile.snapshot().saved).toBeNull();
  profile.edit("deadline", unknown);
  profile.edit("topic", { state: "inapplicable", values: [] });
  profile.edit("weekly_availability_minutes", topic("0"));
  profile.edit("milestones", {
    state: "known",
    values: [{ ...newDraftValue(), text: "Submit draft", date: "2027-02-28" }],
  });
  const fields = {
    deadline: { state: "unknown" },
    topic: { state: "inapplicable" },
    weekly_availability_minutes: { state: "known", value: 0, origin: researcherOrigin },
    milestones: {
      state: "known",
      items: [
        {
          state: "known",
          value: { title: "Submit draft", date: "2027-02-28", done: false },
          origin: researcherOrigin,
        },
      ],
    },
  } as const;
  port.saveThesisProfile.mockReturnValueOnce(call(ok(receipt(1))));
  port.readThesisProfile.mockReturnValueOnce(call(ok(saved(fields, 1))));
  await profile.save();
  expect(port.saveThesisProfile).toHaveBeenCalledExactlyOnceWith(operationId, {
    ...scope,
    expectedRevision: 0,
    patch: encodeProfileContent({ schemaVersion: 2, fields }),
  });
  expect(port.readThesisProfile).toHaveBeenLastCalledWith({
    ...scope,
    revisionId: revision(1).revisionId,
  });
  expect(profile.snapshot()).toMatchObject({ saved: { fields }, draft: {}, notice: "saved" });
  expect(profile.clean()).toBe(true);
});

it("preserves the old revision and edits through conflict, read failure, and a checked comparison", async () => {
  const { profile, port, ready } = fixture();
  const original = saved(
    { topic: { state: "known", value: "Original question", origin: researcherOrigin } },
    1,
  );
  port.readThesisProfile.mockReturnValueOnce(call(ok(original)));
  await ready();
  profile.edit("topic", topic("My pending question"));
  port.saveThesisProfile.mockReturnValueOnce(call(failure("stale_revision")));
  await profile.save();
  expect(profile.snapshot()).toMatchObject({
    conflict: true,
    draft: { topic: topic("My pending question") },
    notice: "conflict",
  });
  expect(profile.snapshot().saved?.revision.revision).toBe(1);
  await profile.save();
  expect(port.saveThesisProfile).toHaveBeenCalledTimes(1);
  port.readThesisProfile.mockReturnValueOnce(call(failure("storage_failed")));
  await profile.load(true);
  expect(profile.snapshot()).toMatchObject({ readFailed: true, conflict: true });
  expect(profile.snapshot().saved?.revision.revision).toBe(1);
  const competing = {
    state: "known",
    value: "Competing question",
    origin: researcherOrigin,
  } as const;
  const delayed = deferred<Outcome<ProfileReadResult>>();
  const presented: (number | undefined)[] = [];
  const stop = profile.subscribe(() => {
    presented.push(profile.snapshot().saved?.revision.revision);
  });
  port.readThesisProfile
    .mockReturnValueOnce({ result: delayed.promise, cancel() {} })
    .mockReturnValueOnce(call(ok(saved({ topic: competing }, 3))));
  const comparing = profile.load(true);
  profile.changed(3);
  delayed.resolve(
    ok(
      saved(
        {
          topic: { state: "known", value: "My pending question", origin: researcherOrigin },
        },
        2,
      ),
    ),
  );
  await comparing;
  await vi.waitFor(() => expect(profile.snapshot().saved?.revision.revision).toBe(3));
  stop();
  expect(presented).not.toContain(2);
  expect(profile.snapshot()).toMatchObject({
    conflict: false,
    draft: { topic: topic("My pending question") },
    saved: { fields: { topic: competing } },
  });
  await profile.save();
  expect(port.saveThesisProfile).toHaveBeenLastCalledWith(
    operationId,
    expect.objectContaining({ expectedRevision: 3 }),
  );
  expect(profile.snapshot()).toMatchObject({
    notice: "saveFailed",
    draft: { topic: topic("My pending question") },
    saved: { fields: { topic: competing } },
  });
});

it("reconciles a lost acknowledgement, preserves its operation and separates a confirmed save from refresh failure", async () => {
  const { profile, port, ready } = fixture();
  await ready();
  profile.edit("topic", topic("Committed context"));
  port.saveThesisProfile.mockReturnValueOnce(call(failure("uncertain")));
  await profile.save();
  profile.discard();
  profile.edit("topic", topic("Unsafe alteration"));
  expect(profile.snapshot()).toMatchObject({
    notice: "uncertain",
    draft: { topic: topic("Committed context") },
  });
  port.readThesisProfileReceipt.mockReturnValueOnce(call(failure("service_unavailable")));
  await profile.reconcile(true);
  expect(port.saveThesisProfile).toHaveBeenCalledTimes(1);
  port.readThesisProfileReceipt.mockReturnValueOnce(
    call(ok({ projectId, operationId, receipt: receipt(1) })),
  );
  port.readThesisProfile.mockReturnValueOnce(call(failure("storage_failed")));
  await profile.reconcile(true);
  expect(port.readThesisProfileReceipt).toHaveBeenLastCalledWith({
    ...port.saveThesisProfile.mock.calls[0]![1],
    operationId,
  });
  expect(port.saveThesisProfile).toHaveBeenCalledTimes(1);
  expect(profile.snapshot()).toMatchObject({
    notice: "refreshFailed",
    intent: undefined,
    draft: {},
    saved: { revision: revision(1) },
  });
  port.readThesisProfile.mockReturnValueOnce(
    call(
      ok(
        saved(
          {
            topic: { state: "known", value: "Committed context", origin: researcherOrigin },
          },
          1,
        ),
      ),
    ),
  );
  await profile.refreshSaved();
  expect(port.readThesisProfile).toHaveBeenLastCalledWith({
    ...scope,
    revisionId: revision(1).revisionId,
  });
  expect(profile.snapshot().notice).toBe("saved");
});

it("stages and reads bounded UTF-8 parts and replays the same intent only after checking its receipt", async () => {
  const { profile, port, ready } = fixture();
  await ready();
  const text = "🧪".repeat(490);
  profile.edit("topic", topic(text));
  profile.edit("discipline", topic(text));
  profile.edit("approach", topic(text));
  port.saveThesisProfile.mockReturnValueOnce(call(failure("timeout")));
  await profile.save();
  expect(port.stageThesisProfilePart).toHaveBeenCalledTimes(2);
  const input = port.saveThesisProfile.mock.calls[0]![1];
  const staged = port.stageThesisProfilePart.mock.calls.map(([, part]) => part.text).join("");
  const sha256 = createHash("sha256").update(staged).digest("hex");
  expect(input.patch).toEqual({ parts: 2, bytes: Buffer.byteLength(staged), sha256 });
  expect(decodeProfileContent(staged)?.fields.topic).toMatchObject({ value: text });
  await profile.reconcile();
  expect(port.saveThesisProfile).toHaveBeenCalledTimes(1);

  port.saveThesisProfile.mockReturnValueOnce(call(ok(receipt(1))));
  const wire = {
    projectId,
    profile: {
      ...revision(1),
      content: {
        parts: 2,
        bytes: Buffer.byteLength(staged),
        sha256,
        source: revision(1).revisionId,
      },
    },
  };
  port.readThesisProfile.mockReturnValueOnce(call(ok(wire)));
  for (const [index, text] of splitText(staged).entries())
    port.readThesisProfilePart.mockReturnValueOnce(
      call(ok({ projectId, revisionId: revision(1).revisionId, index: index + 1, text })),
    );
  await profile.reconcile(true);
  expect(port.saveThesisProfile).toHaveBeenLastCalledWith(operationId, input);
  expect(port.readThesisProfilePart).toHaveBeenCalledTimes(2);
  expect(profile.snapshot().notice).toBe("saved");

  port.readThesisProfile.mockReturnValueOnce(call(ok(wire)));
  port.readThesisProfilePart.mockReturnValueOnce(call(failure("storage_failed")));
  await profile.load();
  expect(profile.snapshot().readFailed).toBe(true);
  expect(profile.snapshot().saved?.revision.revision).toBe(1);
});

it("rejects invalid partial values without discarding them and protects dirty work from detach", async () => {
  const { profile, ready, lease, port } = fixture();
  const work = new PendingProjectWork(() => lease);
  const dispose = work.register(lease, profile.beforeDetach);
  await ready();
  const clean = await work.evaluate(lease);
  expect(clean.status).toBe("safe_to_detach");
  profile.edit("deadline", topic("2026-02-29"));
  profile.edit("weekly_availability_minutes", topic("0.1"));
  profile.edit("bibliography", {
    state: "known",
    values: [
      {
        ...newDraftValue(),
        text: "Reference",
        origin: { kind: "described_material", description: "" },
      },
    ],
  });
  if (clean.status === "safe_to_detach") expect(clean.isCurrent()).toBe(false);
  expect(await work.evaluate(lease)).toEqual({ status: "keep_open" });
  await profile.save();
  expect(profile.snapshot().invalid).toEqual([
    "deadline",
    "weekly_availability_minutes",
    "bibliography",
  ]);
  expect(port.saveThesisProfile).not.toHaveBeenCalled();
  profile.discard();
  expect(profile.snapshot().draft).toEqual({});
  const fullList = {
    state: "known",
    values: Array.from({ length: 16 }, (_, index) => ({
      ...newDraftValue(String(index)),
      text: "𐐀".repeat(480),
    })),
  } as const;
  profile.edit("bibliography", fullList);
  profile.edit("interests", {
    state: "known",
    values: [{ ...newDraftValue(), text: "a".repeat(2048) }],
  });
  await profile.save();
  expect(profile.snapshot()).toMatchObject({
    notice: "tooLarge",
    draft: { bibliography: fullList },
  });
  expect(port.saveThesisProfile).not.toHaveBeenCalled();
  profile.discard();
  dispose();
  expect(await work.evaluate(lease)).toMatchObject({ status: "safe_to_detach" });
});

it("revokes old A reads and saves before an A to B to A return", async () => {
  const { profile, port, attach, current } = fixture();
  const oldRead = deferred<Outcome<ProfileReadResult>>();
  const cancelled = vi.fn();
  port.readThesisProfile.mockReturnValueOnce({ result: oldRead.promise, cancel: cancelled });
  const clear = attach();
  current.mockReturnValue(false);
  clear();
  const currentLease = { projectId, isCurrent: () => true };
  const newer = profile.attach(currentLease, "subscription-a2");
  await vi.waitFor(() => expect(profile.snapshot().saved).toBeNull());
  oldRead.resolve(
    ok(saved({ topic: { state: "known", value: "Stale input", origin: researcherOrigin } }, 1)),
  );
  expect(cancelled).toHaveBeenCalledOnce();
  profile.edit("deadline", unknown);
  const pending = deferred<Outcome<ProfileSaveResult>>();
  port.saveThesisProfile.mockReturnValueOnce({ result: pending.promise, cancel: vi.fn() });
  const saving = profile.save();
  newer();
  pending.resolve(ok(receipt(1)));
  await saving;
  expect(profile.snapshot()).toMatchObject({ saved: null, draft: { deadline: unknown } });
  const final = profile.attach(currentLease, "subscription-a3");
  await vi.waitFor(() => expect(profile.snapshot().notice).toBe("uncertain"));
  expect(port.readThesisProfileReceipt).toHaveBeenCalledWith(
    expect.objectContaining({ subscriptionId: "subscription-a3", operationId }),
  );
  expect(port.saveThesisProfile).toHaveBeenCalledTimes(1);
  final();
});

it("observes newer versions while retaining unchanged provenance and pending edits", async () => {
  const { profile, port, ready } = fixture();
  const origin = {
    kind: "artifact_version",
    artifact: "conversation_message",
    revision: 1,
    id: "019a8000-0000-7000-8000-000000000002",
  } as const;
  const known = { state: "known", value: "Prior quotation", origin } as const;
  const bibliography = { state: "known", items: [known] } as const;
  port.readThesisProfile.mockReturnValueOnce(call(ok(saved({ bibliography }, 1))));
  await ready();
  const draft = editFact(bibliography);
  profile.edit("bibliography", {
    ...draft,
    values: [...draft.values, { ...newDraftValue("new"), text: "My new reference" }],
  });
  port.readThesisProfile.mockReturnValueOnce(call(ok(saved({ bibliography }, 2))));
  profile.changed(2);
  profile.changed(2);
  await vi.waitFor(() => expect(profile.snapshot().conflict).toBe(true));
  expect(profile.snapshot().draft.bibliography?.values[0]?.origin).toEqual(origin);
  expect(port.readThesisProfile).toHaveBeenCalledTimes(2);
});

it("restages a checked save when the same project's subscription is replaced during upload", async () => {
  const { profile, port, ready } = fixture();
  await ready();
  const field = topic("🧪".repeat(490));
  profile.edit("topic", field);
  profile.edit("discipline", field);
  profile.edit("approach", field);
  const part = deferred<Outcome<ResearchOutputs["profile.stagePart"]>>();
  const cancel = vi.fn();
  port.stageThesisProfilePart.mockReturnValueOnce({ result: part.promise, cancel });
  const saving = profile.save();
  await vi.waitFor(() => expect(port.stageThesisProfilePart).toHaveBeenCalledOnce());
  profile.setSubscription(undefined);
  profile.setSubscription("new-subscription");
  part.resolve(ok({ accepted: true }));
  await saving;
  await vi.waitFor(() => expect(port.saveThesisProfile).toHaveBeenCalledOnce());
  expect(cancel).not.toHaveBeenCalled();
  expect(port.readThesisProfileReceipt).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      operationId,
      subscriptionId: "new-subscription",
      expectedRevision: 0,
    }),
  );
  expect(
    port.stageThesisProfilePart.mock.calls.map(([id, body]) => [id, body.subscriptionId]),
  ).toEqual([
    [operationId, subscriptionId],
    [operationId, "new-subscription"],
    [operationId, "new-subscription"],
  ]);
  expect(port.saveThesisProfile).toHaveBeenCalledWith(
    operationId,
    expect.objectContaining({ subscriptionId: "new-subscription" }),
  );
});

it("keeps the draft editable after a terminal receipt rejection", async () => {
  const { profile, port, ready } = fixture();
  await ready();
  profile.edit("topic", topic("Researcher's draft"));
  port.saveThesisProfile.mockReturnValueOnce(call(failure("uncertain")));
  await profile.save();
  port.readThesisProfileReceipt.mockReturnValueOnce(call(failure("operation_conflict")));
  await profile.reconcile(true);
  expect(profile.snapshot()).toMatchObject({
    intent: undefined,
    notice: "saveFailed",
    draft: { topic: topic("Researcher's draft") },
  });
  expect(port.saveThesisProfile).toHaveBeenCalledOnce();
  profile.edit("topic", topic("Revised draft"));
  expect(profile.snapshot().draft.topic).toEqual(topic("Revised draft"));
});

it("opens one section for editing, keeps it while its input is pending and closes it on save", async () => {
  const { profile, port, ready } = fixture();
  expect(profile.beginSection("schedule")).toBe(false);
  await ready();
  expect(profile.beginSection("schedule")).toBe(true);
  expect(profile.snapshot().editing).toBe("schedule");
  // Without pending input another section can take over.
  expect(profile.beginSection("research")).toBe(true);
  expect(profile.snapshot().editing).toBe("research");
  expect(profile.beginSection("research")).toBe(true);
  profile.edit("milestones", {
    state: "known",
    values: [{ ...newDraftValue(), text: "Defend", date: "2027-06-01", done: true }],
  });
  expect(profile.beginSection("schedule")).toBe(false);
  expect(profile.snapshot().editing).toBe("research");
  const fields = {
    milestones: {
      state: "known",
      items: [
        {
          state: "known",
          value: { title: "Defend", date: "2027-06-01", done: true },
          origin: researcherOrigin,
        },
      ],
    },
  } as const;
  port.saveThesisProfile.mockReturnValueOnce(call(ok(receipt(1))));
  port.readThesisProfile.mockReturnValueOnce(call(ok(saved(fields, 1))));
  await profile.save();
  expect(port.saveThesisProfile).toHaveBeenCalledWith(operationId, {
    ...scope,
    expectedRevision: 0,
    patch: encodeProfileContent({ schemaVersion: 2, fields }),
  });
  expect(profile.snapshot()).toMatchObject({ editing: undefined, draft: {}, saved: { fields } });
  expect(editFact(fields.milestones).values[0]).toMatchObject({ done: true, date: "2027-06-01" });
  expect(profile.beginSection("prior_work")).toBe(true);
  profile.discard();
  expect(profile.snapshot().editing).toBeUndefined();
});
