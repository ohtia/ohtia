import { ServiceConnections, type Outcome } from "../../packages/contracts/src/index.js";
import { setupTool, type SetupValues } from "../../packages/utility/src/project-setup.js";
import type { DurableStore } from "../../packages/utility/src/storage.js";
import { bytes } from "../../packages/utility/src/research.js";
import { seedDefaultModel, type storageFixture } from "./storage.js";

export function successful<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(outcome.error.code);
  return outcome.value;
}
export function setupConnections() {
  const connections = new ServiceConnections();
  connections.receive({
    kind: "connection_state",
    generation: "setup-tests",
    snapshot: {
      connection: "chatgpt",
      state: "connected",
      reason: null,
      probing: false,
      probe_id: null,
      model_list_revision: 1,
      model_count: 1,
    },
  });
  connections.receive({
    kind: "connection_models",
    generation: "setup-tests",
    page: {
      connection: "chatgpt",
      model_list_revision: 1,
      models: [{ id: "first", name: "First" }],
      nextCursor: 1,
      hasMore: false,
    },
  });
  return connections;
}
let operation = 0;
/** Exercise setup through the real task finalization transaction, without a network request. */
export async function proposeSetup(
  store: DurableStore,
  raw: ReturnType<typeof storageFixture>["raw"],
  projectId: string,
  values: SetupValues = { title: "Synthetic investigation", document_language: "en" },
) {
  store.setTaskContext({
    generation: "setup-tests",
    mode: "development",
    connections: setupConnections(),
  });
  seedDefaultModel(raw, "first", "First");
  const conversations = successful(await store.readConversations(projectId));
  const conversation = conversations[0];
  if (!conversation) throw new Error("Missing setup conversation.");
  successful(
    await store.executeResearchCommand({
      command: "message.append",
      operationId: `setup-seed-${++operation}`,
      payload: { conversationId: conversation.id, content: "Synthetic setup request" },
    }),
  );
  const prepared = successful(await store.prepareTask());
  if (!prepared) throw new Error("Missing setup task.");
  successful(
    await store.recordTaskEvent(
      prepared.dispatch.request.attempt,
      { type: "result", sequence: 1, result: { status: "completed" } },
      "",
      [{ namespace: setupTool.namespace, name: setupTool.name, arguments: JSON.stringify(values) }],
    ),
  );
  const db = raw();
  try {
    const row = db
      .prepare("SELECT lower(hex(id)) AS id FROM project_setup_proposals WHERE task_id=?")
      .get(bytes(prepared.taskId)) as { id: string };
    return `${row.id.slice(0, 8)}-${row.id.slice(8, 12)}-${row.id.slice(12, 16)}-${row.id.slice(16, 20)}-${row.id.slice(20)}`;
  } finally {
    db.close();
  }
}
