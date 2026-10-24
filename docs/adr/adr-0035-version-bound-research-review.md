---
type: DecisionRecord
title: "ADR-0035 — Research review bound to exact content versions"
description: "Persist human decisions and analysis against immutable versions and reject stale confirmations."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0035 — Research review bound to exact content versions

## Context

An approval flag on a mutable claim or manuscript can imply a person reviewed later text they never saw. Agent jobs can finish after an edit, and restored content can resemble an earlier revision without being the same review event. Stable entity or block identity alone does not establish reviewed meaning.

Alternatives are mutable approval flags, copying text into comments without version identity, or explicit version-bound events with expected-version commands.

## Decision

Persist each human review and analysis with entity/version, supporting representations, scope, actor, observed time and limitations. Human confirmation is a separate application command whose transaction checks the expected version and current domain preconditions. No agent tool can issue it.

Edits and restoration create new versions. Earlier reviews retain their exact targets. Track affected dependencies requiring reexamination without automatically transferring confirmation or declaring a conclusion false. Late agent results remain analyses of their actual inputs. [Product trust](../product-definition.md#proposals-and-human-review) owns review meaning; the [data model](../data-model.md#manuscripts-and-revisions) preserves manuscript revision relationships.

## Consequences

Research decisions remain examinable after changes, and UI/model output cannot manufacture human confirmation. Retaining exact evidence and dependency information increases storage and UI complexity. Purging versions can weaken reconstructability and therefore requires an explicit retention decision.

Test edit-versus-confirm races, repeated idempotent commands, delayed analyses, changed anchors, restore and imported attribution. A successful JSON validation, visible source pane or click on an unrelated control is never evidence of content review.
