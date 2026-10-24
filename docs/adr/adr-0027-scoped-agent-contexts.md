---
type: DecisionRecord
title: "ADR-0027 — Scoped agent contexts with mediated research tools"
description: "Agents receive restricted per-attempt inputs and create proposals through application-controlled operations."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0027 — Scoped agent contexts with mediated research tools

## Context

A connected agent may have filesystem tools, network access, inherited plugins and its own context persistence. Corpus text and model output are untrusted. Giving that runtime the Ohtia data directory would make prompts the practical control over manuscript edits, confirmed knowledge and unintended transfers. An unrestricted coding workspace conflicts with researcher authorship and source restrictions.

Alternatives are direct project access with instructions, treating all integrations as plain text calls, or materializing bounded execution contexts and explicitly mediating domain effects.

## Decision

Choose per-attempt contexts containing only permitted immutable inputs. Keep the authoritative database, drafts, unrelated project material and general home directory outside the agent's accessible scope. Provider credential state is separately constrained. Bind application tools to project, attempt, expected versions and a closed operation registry. Each tool declares bounded typed inputs/outputs and allowed effects; validate runtime data, current restrictions and idempotency rather than accepting identity from model arguments. Do not expose generic SQL, shell, file paths or arbitrary HTTP destinations. Treat tool returns as untrusted content and mediate any return to a provider through [ADR-0028](adr-0028-mediated-provider-transfers.md).

Tools may read approved material or propose allowed findings; only a separate human command can confirm knowledge. Effective filesystem, network, tool and inherited-configuration controls must be demonstrated for each enabled platform/runtime. When necessary controls are unavailable, the operation remains unavailable rather than receiving broader authority. [Architecture](../architecture.md#agent-authority-and-context) owns the operational contract.

## Consequences

Ohtia retains authority over research state while adapters preserve useful agent capabilities. Maintaining scoped contexts and tool bridges costs more than pointing an agent at a folder. It cannot promise interception of every inference request made internally by a provider runtime.

Conformance includes hostile source instructions, attempted cross-project reads, inherited hooks, direct draft writes, replayed tool requests and late results. Permission changes and provider/runtime updates trigger revalidation. Do not claim a sandbox merely because a process has a temporary working directory or no write tools.
