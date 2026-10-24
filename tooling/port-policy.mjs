import fs from "node:fs";
import path from "node:path";

export function generatePortPolicy(root) {
  const record = JSON.parse(
    fs.readFileSync(path.join(root, "config/desktop/resource-policy.json"), "utf8"),
  );
  if (record.schema_version !== 1 || record.policy_id !== "foundation-1")
    throw new Error(
      "Unsupported application-port resource policy; review the contract before integration.",
    );
  const names = [
    "message_bytes",
    "string_bytes",
    "identifier_bytes",
    "container_items",
    "message_nodes",
    "message_depth",
    "pending_per_window",
    "pending_global",
    "windows",
    "subscriptions_per_window",
    "event_queue_items",
    "event_queue_bytes",
    "request_deadline_ms",
    "initial_input_bytes",
    "initial_input_items",
    "initial_output_bytes",
  ];
  const limits = {};
  for (const name of names) {
    const budget = record.budgets?.[name];
    if (
      !budget ||
      !Number.isSafeInteger(budget.value) ||
      budget.value <= 0 ||
      budget.permitted?.minimum !== budget.value ||
      budget.permitted?.maximum !== budget.value
    )
      throw new Error(`Invalid application-port budget: ${name}`);
    limits[name] = budget.value;
  }
  const directory = path.join(root, "packages/contracts/src/generated");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "resource-policy.ts"),
    `// Generated from config/desktop/resource-policy.json. Do not edit.\nexport const policyId = ${JSON.stringify(record.policy_id)} as const;\nexport const portLimits = Object.freeze(${JSON.stringify(limits)}) as Readonly<${JSON.stringify(limits)}>;\n`,
  );
}
