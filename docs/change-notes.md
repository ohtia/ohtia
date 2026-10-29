---
type: Playbook
title: "Change-note tooling"
description: "Capture inert PR impact records, reconcile source scope and prepare immutable editorial note and correction evidence."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# Change-note tooling

## Boundary and commands

[Release policy](release-policy.md#change-note-capture-and-editorial-review) owns public communication and authorization. `scripts/change_notes.py` implements the N14 input/assembly contract from [STORY-001-014](epics/EPIC-001-desktop-foundation/STORY-001-014-capture-and-assemble-reviewed-user-change-notes.md), using Python's standard library. It reads local JSON and writes new evidence files; all diagnostics are English and exclude input contents and local paths. It performs no network requests, shell evaluation, subprocess execution, dynamic helper imports, signing or publication. Run from the task worktree using the repository's [developer setup](developer-workspace.md).

```bash
python3 scripts/change_notes.py --help
python3 -m unittest discover -s scripts/tests -p test_change_notes.py -v
```

Every input object has the exact documented fields; unknown fields, duplicate JSON keys and noninteger JSON numbers fail. Root documents and captured PR records carry integer `schema_version: 1`. Lists permit at most 20,000 entries, a text field contains 1–4,096 characters with no leading/trailing whitespace or Unicode control/format characters, and each input/output file is at most 8 MiB. IDs/digests use lowercase hexadecimal; commit IDs have 40 characters and SHA-256 digests have 64. Application versions are final `major.minor.patch` versions without leading zeroes, matching the [immutable-artifact contract](adr/adr-0021-versioned-desktop-artifacts.md). Outputs use exclusive creation, so an existing file is never overwritten. Use a new output path after a failed or interrupted write; preserve earlier evidence. A bounded-contract failure requires reviewing the input or contract, rather than silently dropping history or consequences.

## PR capture

Every PR has exactly one fenced `ohtia-note` JSON object, as introduced by the [PR template](../.github/pull_request_template.md). Replace its placeholder PR and issue numbers with the actual identities after opening the PR. A change without installed-user effects uses `schema_version`, `pr`, nonempty `issues`, `impact: "none"` and a concrete `reason`. A user-impact record uses the following complete shape. The numbers and behavior here are synthetic illustrations, not delivered capabilities.

```ohtia-note
{
  "schema_version": 1,
  "pr": 101,
  "issues": [1101],
  "impact": "user",
  "change_id": "resume-reading",
  "kind": "capability",
  "task": "Resume your reading",
  "result": "Reopening a source returns you to the page you were reading.",
  "platforms": ["Linux", "Windows", "macOS"],
  "availability": "available",
  "disclosures": {
    "migration": null,
    "reinstall": null,
    "removed_support": null,
    "format_adapter": null,
    "privacy_transfers": null,
    "security_urgency": null,
    "limitations": null
  },
  "claims": []
}
```

`change_id` is a stable capability key matching `[a-z][a-z0-9-]{0,79}`; related implementation PRs share it. `kind` is `capability`, `improvement`, `correction`, `deprecation/removal` or `security`. `availability` is `available` or `unfinished`; the trusted editor independently assesses actual candidate availability. PR and issue numbers are positive integers below 2⁵³, with no duplicates in an evidence list. Platforms are nonempty distinct text values. Each disclosure is either a concrete user action/consequence or `null`, explicitly assessing all seven categories. Claims have `text` and `evidence`, a list of HTTPS source URLs. Capture retains unsupported author claims for editorial correction; final copy requires evidence for any retained claim.

Export PR bodies as `{"schema_version":1,"pull_requests":[{"number":101,"body":"…"}]}` from the actual repository through a trusted collection procedure. `collect` extracts exactly one fenced block, handles LF/CRLF, validates its identity against the wrapper and rejects duplicate PRs. Text outside the block is not interpreted. Retain the original capture with the resulting `{"schema_version":1,"notes":[…]}` document. A PR cannot select a workflow, helper, credential, candidate, publication channel or authority through an extra field.

```bash
mkdir -p tmp/change-notes-example
python3 scripts/change_notes.py collect scripts/tests/fixtures/change-notes/capture.json tmp/change-notes-example/notes.json
```

## Trusted source history

The operator supplies `history.json` independently of untrusted PR bodies. Its fields are `schema_version`, `repository` in `owner/name` form, selected `source` commit, `commits` and `releases`. `commits` is the complete selected source's ancestry in parent-before-child order. Each commit has `sha`, distinct `parents`, `pr` and `reason`. Set `pr` to its associated PR and `reason` to `null`; a genuinely non-PR integration/root commit instead needs `pr: null` and a reviewed nonempty `reason`. Excluded commits and their reasons remain in the result. Never label an unaccounted implementation commit as integration merely to pass reconciliation.

`releases` lists actual published records in publication order, each with distinct `id`, final intended `version`, `channel` (`preview` or `stable`), `source` and cumulative `announced` capability IDs. Every baseline source must be an ancestor of the selected source. The trusted producer must verify the complete Git parent graph, PR-to-commit mapping, published-record order, prior announced scope and selected repository/source against actual Git and retained release evidence. The tool validates internal consistency, not remote provenance; a fabricated graph is not evidence of a real source difference. No commit message becomes release prose.

Stable selects the last published stable baseline, including all intervening preview-only changes; first stable uses complete delivered scope. Preview selects the last preview for the same intended stable version, or complete scope when none exists, including when a different stable version was previously published; it does not invent a preceding-stable preview baseline. Source difference is ancestor-set subtraction, including side branches merged after the baseline. All ancestor PR notes remain inputs, even when their commit predates the delta, so a previously unfinished capability can first be announced when the editor confirms it is available. The output records the explicit baseline, changed commits/PRs, complete source PR inventory and excluded integration commits. The supplied history fixture illustrates the shape with synthetic hashes only.

## Independent editorial assessment

`editorial.json` has `schema_version`, selected `source`, `channel`, `application_version`, English `summary`, summary `claims`, `assessments` and `changes`. The editor reviews actual source and delivered behavior independently of the PR proposal. Every ancestor PR has exactly one assessment with `pr`, `impact`, concrete `reason` and the same seven nullable disclosure fields as capture. A missing note, mismatched impact, missing assessment or a consequence classified as no public effect fails assembly; correct the captured input explicitly and retain the original capture. An omitted author consequence can be introduced by the independent assessment and must appear in final copy.

Each unique user `change_id` has one editorial change with `id`, Boolean `available`, `kind`, `task`, `result`, nonempty `platforms`, complete grouped `prs`, union of their `issues`, `disclosures` and `claims`. Editorial disclosures use a distinct list of concrete texts for each of the seven keys, including empty lists for no consequence. Each list must preserve every non-null author and independently assessed consequence. This exact-preservation rule deliberately favors explicit disclosure over silent paraphrase. Additional reviewed explanation is allowed. A changed or superseded consequence requires an explicit reviewed correction to the inputs, retaining the original evidence.

Assembly reconciles every PR and capability, deduplicates grouped capability prose and retains complete unfinished records outside the public body. A change already announced cannot silently become unfinished. `available` assesses whether the current change outcome is delivered, rather than whether a former feature still exists: for a removal, reuse that capability key, describe the delivered removal outcome, classify it as `deprecation/removal`, set `available: true` and provide a nonempty `removed_support` action/consequence. Deprecations and removals have their own public section; security changes are also separated from improvements. Unchanged available capability prose already announced at the baseline is omitted from the delta, while all currently assessed applicable disclosures remain prominent, including disclosures newly identified on that earlier scope. Without a baseline disclosure ledger, the tool deliberately repeats current disclosures instead of silently assuming they were already communicated. Newly available previously unfinished capabilities are included with all their issue/PR evidence. Required actions, incompatibilities, privacy transfers, security urgency and limitations appear before the summary; task-oriented improvements/corrections and separate technical links follow.

Final claims need nonempty HTTPS `evidence`. A conservative English wording detector also rejects possible benefit/performance assertions unless the complete flagged summary, task, result or disclosure appears as a reviewed claim with evidence. Editors must examine all text and supporting sources: the detector is a prompt for review, not semantic verification, language detection or proof that a URL supports a statement. Remove unsupported benefits and absent capabilities rather than inventing evidence. Confirm that the canonical public prose is English and distinguish observed corrections from remaining limitations.

```bash
python3 scripts/change_notes.py assemble scripts/tests/fixtures/change-notes/history.json tmp/change-notes-example/notes.json scripts/tests/fixtures/change-notes/editorial.json tmp/change-notes-example/note.json
python3 scripts/change_notes.py render tmp/change-notes-example/note.json
```

The sealed note contains `schema_version`, `kind: "note"`, the reconciled `scope`, complete assembly `inputs` with `inputs_sha256`, rendered `body` with `body_sha256`, cumulative `announced`, full `retained` unfinished records and `subject_sha256`. Canonical JSON is ASCII with sorted object keys, compact separators, escaped non-ASCII and one LF; list order remains significant. SHA-256 is over those canonical bytes, excluding the envelope's `subject_sha256`; `body_sha256` is over the exact UTF-8 Markdown bytes. Validation reproduces assembly from the retained inputs and rejects even a resealed body that no longer matches them. Every punctuation character in author/editor text is encoded as literal content. GitHub also post-processes decoded text, so tokens containing URL, mention, issue-reference or commit-reference syntax receive encoder-owned inline code elements that suppress standard automatic linking while preserving their exact visible text. Evidence URLs remain complete readable literals rather than partial autolinks. Structure comes from the fixed renderer and its code elements or generated repository links, never from caller markup. Consumers must review the final rendering when GitHub behavior or custom autolink configuration changes.

## Candidate annotations and approvals

Package identity is a separate trusted document with `schema_version`, `id` (candidate digest), `source`, `application_version` and `packages_sha256` (digest of the immutable package manifest). It comes from the candidate owner; text in a PR cannot choose it. `propose` requires the candidate and note to name the same source/version and emits a sealed `kind: "annotation"` with separate `candidate` and `note` fields. The note identity remains independent of package identity, while the annotation digest binds both.

```bash
python3 scripts/change_notes.py propose tmp/change-notes-example/note.json scripts/tests/fixtures/change-notes/candidate.json tmp/change-notes-example/proposal.json
```

Present the exact proposal, rendered English note, candidate identity, baseline, channel and supporting source evidence for human review. An actual reviewer must explicitly confirm that proposal before a trusted operator records a decision file containing `schema_version: 1`, the proposal's `subject_sha256`, `by: "human:<github-login>"` and an HTTPS `evidence` permalink to that confirmation. No command generates human approval automatically. The fixture tests use synthetic receipts, never declarations of real sign-off.

```bash
python3 scripts/change_notes.py approve tmp/change-notes-example/proposal.json tmp/change-notes-example/decision.json tmp/change-notes-example/approved.json
python3 scripts/change_notes.py verify tmp/change-notes-example/approved.json
```

The decision file in these commands must be supplied after the actual review; it is not part of the example fixtures. Approved records have `schema_version`, the complete `proposal` and its `approval` receipt. Any change to bytes, source, baseline, channel, candidate or retained inputs changes the proposal digest and invalidates its prior receipt. The CLI checks internal consistency only: a claimed human login, HTTPS link and matching digest do not authenticate a person or confer publication authority. The future trusted candidate/publication consumer must verify the reviewer, explicit confirmation, provenance, current policy and exact externally authorized identities independently. A generic PR approval or model review is insufficient.

## Channel promotion and prose correction

Build and review a new stable annotation when promoting preview bytes, selecting the stable baseline independently. `transition` requires approved before/after annotations, identical complete candidate/package identities and a concrete English reason. `channel-promotion` permits preview→stable only, with the same source, final application version and exact package manifest. `prose-correction` requires the same complete source/channel/baseline scope and changed body bytes. A prose correction may repair an omitted or misstated announcement for those same packages, so editorial `announced`/`retained` claims may change after independent reassessment of actual availability; it cannot represent newly delivered package behavior. Both operations retain complete before/after note bytes, digests, inputs and annotation receipts, and require a new explicit human receipt for the transition proposal itself.

```bash
python3 scripts/change_notes.py transition tmp/change-notes-example/approved-preview.json tmp/change-notes-example/approved-stable.json channel-promotion "Promote the reviewed stable scope." tmp/change-notes-example/promotion.json
python3 scripts/change_notes.py approve tmp/change-notes-example/promotion.json tmp/change-notes-example/promotion-decision.json tmp/change-notes-example/approved-promotion.json
python3 scripts/change_notes.py transition tmp/change-notes-example/approved.json tmp/change-notes-example/approved-correction.json prose-correction "Clarify the required user action." tmp/change-notes-example/correction.json
```

These commands consume separately reviewed annotation and decision files; they do not create them implicitly. The sealed transition has `schema_version`, its operation as `kind`, complete `before`/`after` approved annotations, `reason` and `subject_sha256`. A publication owner may replace the canonical GitHub release body only after independently authorized use of the approved transition and exact identity readback. Retain the old preview note or corrected prose with its approvals outside GitHub edit history, alongside supported release evidence. Prose changes never conceal changed packages, and this tool never makes a GitHub write. Retention/publication mechanisms remain with their [release-policy owners](release-policy.md).

## Verification and security evidence

The [scoped applicability record](../config/change-notes/security.json) maps versioned ASVS requirements to enforcing code, positive/negative fixtures and explicit exclusions. The [ASVS baseline](adr/adr-0000-security-verification-frameworks.md) remains authoritative. This boundary covers inert untrusted-note parsing, editorial flow and approval/content integrity; local receipts do not prove external authorization. No dependency, workflow, token or live administrative setting changes are required. The existing test runner discovers the new suite through its [Python inventory](../config/quality/inventory.json); unchanged workflow/policy controls retain their own verification obligations.

The complete example set under `scripts/tests/fixtures/change-notes/` is synthetic. It exercises first stable, preview delta, stable-inclusive-of-preview, late merged branches, unfinished carry-forward, missing/duplicate PR coverage, critical omissions, unsupported claims, malicious markup/shell/helper text, stale approvals, exact-byte promotion and retained prose corrections. No fixture claims native installation, signed artifacts or a real published release. Run configured repository hooks and the committed-history scan in addition to the meaningful local suite; hosted CI and human integration remain separate evidence.
