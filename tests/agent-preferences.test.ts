import { describe, expect, it } from "vitest";
import {
  ServiceConnections,
  encodeEnvelope,
  policyId,
  type AgentPreferences,
  type Outcome,
  type ProviderModel,
  type ProviderModelPage,
  type ReplaceAgentPreference,
  type Request,
} from "../packages/contracts/src/index.js";
import { preAgentPreferencesSql } from "../tooling/storage-legacy-consultation-fixture.mjs";
import { storageFixture } from "./fixtures/storage.js";
import { proposeSetup } from "./fixtures/project-setup.js";

function value<T>(result: Outcome<T>): T {
  if (!result.ok) throw new Error("Expected success: " + JSON.stringify(result.error));
  return result.value;
}
async function setup() {
  const { store, raw } = storageFixture();
  await store.open();
  const connections = new ServiceConnections();
  const generation = "agent-preference-generation";
  const taskContext = { connections, generation, mode: "development" } as const;
  store.setTaskContext(taskContext);
  let report = 0;
  const catalog = async (connection: string, models: readonly ProviderModel[]) => {
    const revision = ++report;
    expect(
      connections.receive({
        kind: "connection_state",
        generation,
        snapshot: {
          connection,
          state: "connected",
          reason: null,
          probing: false,
          probe_id: null,
          model_list_revision: revision,
          model_count: models.length,
          model_report_id: "report-" + revision,
          model_read_at: new Date().toISOString(),
          account_fingerprint: "a".repeat(64),
          connection_kind: connection === "chatgpt" ? "subscription" : "api_key",
        },
      }),
    ).toBe(true);
    for (let cursor = 0; cursor < models.length || cursor === 0; cursor += 128) {
      const entries = models.slice(cursor, cursor + 128);
      expect(
        connections.receive({
          kind: "connection_models",
          generation,
          page: {
            connection,
            model_list_revision: revision,
            models: entries,
            nextCursor: cursor + entries.length,
            hasMore: cursor + entries.length < models.length,
          },
        }),
      ).toBe(true);
    }
    return value(await store.storeModelReport(connection));
  };
  const request = <
    K extends "agentPreference.list" | "providerModel.list" | "destination.read" | "reply.details",
  >(
    operation: K,
    payload: Extract<Request, { operation: K }>["payload"],
  ) =>
    ({
      protocol: 1,
      policy: policyId,
      kind: "request",
      windowGeneration: "agent-preference-window",
      serviceGeneration: generation,
      requestId: "agent-preference-read",
      operationId: "agent-preference-read",
      operation,
      payload,
    }) as Extract<Request, { operation: K }>;
  const read = async () =>
    value(await store.readResearch(request("agentPreference.list", {}))) as AgentPreferences;
  const replace = (id: string, choice: ReplaceAgentPreference) =>
    store.executeResearchCommand({
      command: "agentPreference.replace",
      operationId: id,
      payload: choice,
    });
  return { store, raw, catalog, request, read, replace, taskContext, connections, generation };
}

describe("durable agent preferences", () => {
  it("requires a first choice, retains command receipts, and freezes an admitted model", async () => {
    const { store, raw, catalog, read, replace, request } = await setup();
    const models = [
      { id: "first", name: "First" },
      { id: "second", name: "Second" },
    ];
    await catalog("chatgpt", models);
    expect((await read()).preferences).toEqual([]);
    const project = value(
      await store.executeResearchCommand({
        command: "development.createProject",
        operationId: "project",
        payload: {},
      }),
    ).resultId;
    const conversation = value(await store.readConversations(project))[0]!;
    value(
      await store.executeResearchCommand({
        command: "message.append",
        operationId: "message",
        payload: { conversationId: conversation.id, content: "Question" },
      }),
    );
    expect(value(await store.prepareTask())).toBeNull();
    const db = raw();
    expect(db.prepare("SELECT state,blocking_reason FROM tasks").get()).toEqual({
      state: "blocked",
      blocking_reason: "configuration_unavailable",
    });
    const first = {
      target: "default",
      expectedRevision: 0,
      connection: "chatgpt",
      model: "first",
      effort: null,
      inherit: false,
      source: "first_connection",
    } as const;
    const result = value(await replace("default", first));
    expect(value(await replace("default", first))).toEqual(result);
    const receipt = (operationId: string) =>
      store.readResearch(request("agentPreference.list", { operationId }));
    expect(value(await receipt("default"))).toMatchObject({ receipt: "recorded" });
    expect(value(await receipt("message"))).toMatchObject({ receipt: "not_found" });
    const later = { ...first, expectedRevision: 1, model: "second", source: "researcher" } as const;
    value(await replace("later", later));
    expect(value(await store.prepareTask())?.dispatch.request.model).toBe("first");
    expect(db.prepare("SELECT resolution_source, resolved_model FROM tasks").get()).toEqual({
      resolution_source: "default",
      resolved_model: "first",
    });
    db.close();
  });

  it("reuses a complete stored list only for the same account after restart", async () => {
    const { store, catalog, read, replace, request } = await setup();
    await catalog("chatgpt", [{ id: "stored", name: "Stored model" }]);
    const generation = "restarted-generation";
    const connections = new ServiceConnections();
    store.setTaskContext({ connections, generation, mode: "development" });
    const report = (fingerprint: string) =>
      connections.receive({
        kind: "connection_state",
        generation,
        snapshot: {
          connection: "chatgpt",
          state: "connected",
          reason: null,
          probing: false,
          probe_id: null,
          model_list_revision: null,
          model_count: 0,
          account_fingerprint: fingerprint.repeat(64),
        },
      });
    const choice = {
      target: "default",
      expectedRevision: 0,
      connection: "chatgpt",
      model: "stored",
      effort: null,
      inherit: false,
      source: "researcher",
    } as const;
    expect(report("a")).toBe(true);
    expect((await read()).lists[0]).toMatchObject({ current: true });
    value(await replace("stored-model", choice));

    expect(report("b")).toBe(true);
    const afterChange = await read();
    expect(afterChange.lists[0]).toMatchObject({ current: false, count: 1 });
    expect(afterChange.preferences[0]).toMatchObject({ model: "stored" });
    expect(
      await replace("previous-account-model", { ...choice, expectedRevision: 1 }),
    ).toMatchObject({
      ok: false,
      error: { code: "record_not_found" },
    });

    const projectId = value(
      await store.executeResearchCommand({
        command: "development.createProject",
        operationId: "project",
        payload: {},
      }),
    ).resultId;
    const conversation = value(await store.readConversations(projectId))[0]!;
    value(
      await store.executeResearchCommand({
        command: "message.append",
        operationId: "question",
        payload: { conversationId: conversation.id, content: "Question" },
      }),
    );
    expect(value(await store.prepareTask())).toBeNull();
    const destination = value(
      await store.readResearch(
        request("destination.read", { projectId, conversationId: conversation.id }),
      ),
    );
    expect(destination).toMatchObject({ destination: { connection: "chatgpt" } });
    expect(destination).not.toHaveProperty("destination.modelUnavailable");
  });

  it("pages a 1,500-model list within the application port and invalidates older cursors", async () => {
    const { store, catalog, read, request } = await setup();
    const connection = "anthropic";
    const models = Array.from({ length: 1500 }, (_, index) => ({
      id: "model-" + index,
      name: "Model " + index + " é".repeat(80),
      maxInput: 200_000 + index,
      maxOutput: 8192,
      effortSupport: "supported" as const,
      effortLevels: [{ name: "high", supported: true }],
    }));
    await catalog(connection, models);
    const { list_revision } = (await read()).lists[0]!;
    const ids = [];
    let cursor = 0;
    do {
      const input = request("providerModel.list", {
        connection,
        list_revision,
        cursor,
        count: 128,
      });
      const outcome = await store.readResearch(input);
      expect(encodeEnvelope({ ...input, kind: "result", payload: outcome }).ok).toBe(true);
      const page = value(outcome) as ProviderModelPage;
      expect(page.models).toMatchObject(models.slice(cursor, page.nextCursor));
      ids.push(...page.models.map(({ id }) => id));
      expect(page.nextCursor).toBeGreaterThan(cursor);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (ids.length < models.length);
    expect(ids).toEqual(models.map(({ id }) => id));
    await catalog(connection, []);
    expect(
      await store.readResearch(
        request("providerModel.list", {
          connection,
          list_revision,
          cursor: 0,
          count: 128,
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "stale_revision", parameters: { currentRevision: list_revision + 1 } },
    });
  });

  it("blocks a vanished model and admits the reply after a new choice with provider effort", async () => {
    const { store, raw, catalog, replace, read } = await setup();
    await catalog("chatgpt", [{ id: "old", name: "Original model", effortSupport: "unknown" }]);
    await catalog("anthropic", [
      {
        id: "new",
        name: "New model",
        effortSupport: "supported",
        effortLevels: [
          { name: "high", supported: true },
          { name: "other", supported: false },
        ],
      },
    ]);
    const own = {
      target: "virgilio",
      expectedRevision: 0,
      connection: "chatgpt",
      model: "old",
      effort: null,
      inherit: false,
      source: "researcher",
    } as const;
    value(await replace("virgilio-old", own));
    const project = value(
      await store.executeResearchCommand({
        command: "development.createProject",
        operationId: "project",
        payload: {},
      }),
    ).resultId;
    const conversation = value(await store.readConversations(project))[0]!;
    value(
      await store.executeResearchCommand({
        command: "message.append",
        operationId: "message",
        payload: { conversationId: conversation.id, content: "Question" },
      }),
    );
    await catalog("chatgpt", []);
    expect(value(await store.prepareTask())).toBeNull();
    const db = raw();
    expect(
      db.prepare("SELECT state, blocking_reason, resolved_model_name FROM tasks").get(),
    ).toEqual({
      state: "blocked",
      blocking_reason: "configuration_unavailable",
      resolved_model_name: "Original model",
    });
    value(
      await replace("virgilio-new", {
        ...own,
        expectedRevision: 1,
        connection: "anthropic",
        model: "new",
        effort: "high",
      }),
    );
    expect(value(await store.prepareTask())?.dispatch.request).toMatchObject({
      model: "new",
      connection: "anthropic",
      effort: "high",
    });
    await catalog("anthropic", [{ id: "new", name: "New model", effortSupport: "unsupported" }]);
    expect((await read()).preferences[0]).toMatchObject({ model: "new", effort: null });
    expect(db.prepare("SELECT resolved_effort FROM tasks").pluck().get()).toBe("high");
    db.close();
  });

  it("dispatches independent efforts on the same inherited model and keeps reported effort separate", async () => {
    const { store, raw, catalog, read, replace, request, taskContext } = await setup();
    const projectId = value(
      await store.executeResearchCommand({
        command: "project.create",
        operationId: "new-thesis",
        payload: {},
      }),
    ).resultId;
    const proposalId = await proposeSetup(store, raw, projectId);
    value(
      await store.executeResearchCommand({
        command: "project.confirmSetup",
        operationId: "confirm-thesis",
        payload: { proposalId },
      }),
    );
    store.setTaskContext(taskContext);
    await catalog("chatgpt", [
      {
        id: "first",
        name: "First",
        effortSupport: "supported",
        effortLevels: [
          { name: "low", supported: true },
          { name: "high", supported: true },
        ],
      },
      {
        id: "high-only",
        name: "High only",
        effortSupport: "supported",
        effortLevels: [{ name: "high", supported: true }],
      },
    ]);
    const preferences = (await read()).preferences;
    expect(preferences.find((row) => row.target === "default")).toMatchObject({ model: "first" });
    const conversationId = value(await store.readConversations(projectId))[0]!.id;
    for (const [agent, effort, reportedEffort, command] of [
      ["virgilio", "low", "high", "message.append"],
      ["josefa", "high", "low", "development.sendToJosefa"],
    ] as const) {
      value(
        await replace(`effort-${agent}`, {
          target: agent,
          expectedRevision: 0,
          model: null,
          connection: null,
          effort,
          inherit: true,
          source: "researcher",
        }),
      );
      value(
        await store.executeResearchCommand({
          command,
          operationId: `reply-${agent}`,
          payload: { conversationId, content: "Synthetic question" },
        }),
      );
      const prepared = value(await store.prepareTask())!;
      expect(prepared.dispatch.request).toMatchObject({ model: "first", effort });
      const attempt = prepared.dispatch.request.attempt;
      for (const [sequence, model, observed] of [
        [1, "first", undefined],
        [2, null, reportedEffort],
      ] as const) {
        value(
          await store.recordTaskEvent(attempt, {
            type: "started",
            sequence,
            model,
            provider_request_id: null,
            ...(observed === undefined ? {} : { effort: observed }),
          }),
        );
      }
      value(
        await store.recordTaskEvent(
          attempt,
          {
            type: "result",
            sequence: 3,
            result: { status: "completed" },
          },
          "Synthetic reply.",
        ),
      );
      const details = value(
        await store.readResearch(
          request("reply.details", {
            projectId,
            taskId: prepared.taskId,
          }),
        ),
      );
      expect(details).toMatchObject({
        agentId: agent,
        requestedEffort: effort,
        observedEffort: reportedEffort,
      });
    }
    const before = (await read()).preferences;
    value(
      await replace("default-high-only", {
        target: "default",
        expectedRevision: before.find((row) => row.target === "default")!.revision,
        model: "high-only",
        connection: "chatgpt",
        effort: null,
        inherit: false,
        source: "researcher",
      }),
    );
    const after = (await read()).preferences;
    expect(after.find((row) => row.target === "virgilio")).toMatchObject({
      inherit: true,
      effort: null,
      revision: before.find((row) => row.target === "virgilio")!.revision + 1,
    });
    expect(after.find((row) => row.target === "josefa")).toEqual(
      before.find((row) => row.target === "josefa"),
    );
  });

  it("keeps the seed pending while only a service that sends no request is connected", async () => {
    const { store, raw, read, connections, generation } = await setup();
    const project = value(
      await store.executeResearchCommand({
        command: "development.createProject",
        operationId: "project",
        payload: {},
      }),
    ).resultId;
    const conversation = value(await store.readConversations(project))[0]!;
    value(
      await store.executeResearchCommand({
        command: "message.append",
        operationId: "message",
        payload: { conversationId: conversation.id, content: "Question" },
      }),
    );
    await store.close();
    const prior = raw();
    prior.pragma("foreign_keys=OFF");
    prior.exec(preAgentPreferencesSql);
    prior.close();
    await store.open();
    // Main reports a connected OpenRouter without a model list (see ServiceSupervisor).
    expect(
      connections.receive({
        kind: "connection_state",
        generation,
        snapshot: {
          connection: "openrouter",
          state: "connected",
          reason: null,
          probing: false,
          probe_id: null,
          model_list_revision: null,
          model_count: 0,
          account_fingerprint: "b".repeat(64),
          connection_kind: "api_key",
        },
      }),
    ).toBe(true);
    const preferences = await read();
    expect(preferences.preferences[0]).toMatchObject({
      target: "default",
      model: null,
      seedPending: true,
    });
    expect(preferences.lists.some((list) => list.connection === "openrouter")).toBe(false);
  });

  it("seeds an upgraded workspace only after a complete report", async () => {
    const { store, raw, catalog, read } = await setup();
    const project = value(
      await store.executeResearchCommand({
        command: "development.createProject",
        operationId: "project",
        payload: {},
      }),
    ).resultId;
    const conversation = value(await store.readConversations(project))[0]!;
    value(
      await store.executeResearchCommand({
        command: "message.append",
        operationId: "message",
        payload: { conversationId: conversation.id, content: "Question" },
      }),
    );
    await store.close();
    const prior = raw();
    prior.pragma("foreign_keys=OFF");
    prior.exec(preAgentPreferencesSql);
    prior.close();
    await store.open();
    expect((await read()).preferences[0]).toMatchObject({
      target: "default",
      model: null,
      seedPending: true,
      source: "migration",
    });
    await catalog("chatgpt", []);
    expect((await read()).preferences[0]).toMatchObject({ model: null, seedPending: true });
    await catalog("chatgpt", [{ id: "seed", name: "Seed model" }]);
    expect((await read()).preferences[0]).toMatchObject({
      target: "default",
      model: "seed",
      modelName: "Seed model",
      seedPending: false,
      source: "migration",
    });
    await catalog("chatgpt", [{ id: "other", name: "Other model" }]);
    expect((await read()).preferences[0]).toMatchObject({ model: "seed", source: "migration" });
  });
});
