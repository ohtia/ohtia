---
type: Story
title: "STORY-001-021 — Qualify KDE Plasma as a required Linux desktop"
description: "Qualify KDE Plasma 6 on Wayland as a required Linux desktop with GNOME parity on every supported distribution and CPU, with one identifier per native cell."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:desktop", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/145
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:desktop", "comp:tooling"]
applicable_blocks: ["SPEC-001-015", "SPEC-001-027", "SPEC-001-028", "SPEC-001-031"]
---

# STORY-001-021 — Qualify KDE Plasma as a required Linux desktop

## Description

Make KDE Plasma 6 on Wayland a required Linux desktop with the same standing as GNOME on Ubuntu 26.04, Fedora 44 and Debian 13, on x86-64 and ARM64. KDE adds native cells, not packages: each KDE cell consumes the same sealed package as its GNOME counterpart. Linux cells gain a required desktop dimension, and every native cell on every platform is renamed to `<target>-<profile>`, followed by `-<desktop>` on Linux, without the display backend or the execution environment. The same identifier serves CI, guests, evidence and delivery admission. Twelve Linux cells result. This story qualifies native foundation and packaged evidence; signed installation and updates on the twelve cells remain STORY-001-013.

## Applicable specification

- [SPEC-001-015: Quality builds and native packaged smoke tests](./epic.md#spec-001-015-quality-builds-and-native-packaged-smoke-tests)
- [SPEC-001-027: Native feasibility and frozen workspace qualification](./epic.md#spec-001-027-native-feasibility-and-frozen-workspace-qualification)
- [SPEC-001-028: Linux-first delivery and platform capability admission](./epic.md#spec-001-028-linux-first-delivery-and-platform-capability-admission)
- [SPEC-001-031: KDE Plasma desktop qualification](./epic.md#spec-001-031-kde-plasma-desktop-qualification)

## Tasks

- [ ] Integrate gate: verify B12 from STORY-001-012, U9 from STORY-001-009 and D1b from STORY-001-018 on the consumer base, and record PA as reviewed compatibility evidence for the workflow and verifier changes; the required check `ci` and the ruleset do not change.
- [ ] Add the required `desktop` dimension to Linux cells in the target manifest, contract, probes, delivery admission and evidence schemas, with `gnome` and `kde` for each distribution profile.
- [ ] Rename every native cell identifier, job name and artifact name, the Linux delivery admission keys and the full-suite job, as SPEC-001-031 specifies; add `launcher` to `build-targets.json` and the workflow matrix, dispatch by it, and add the matrix equality test.
- [ ] Replace the fixed GNOME and Workstation checks with desktop-specific admission, including the KWin compositor observation and the Debian 13 X11 rejection.
- [ ] Implement the Plasma session launcher with the activation environment update, the readiness conditions, the 60-second limit, teardown and `OHTIA_NATIVE_COMPOSITOR_PID`, and keep `KDE_SESSION_VERSION` in every environment allowlist.
- [ ] Add `quality_kwin_focus.py` and select it in `command-native-focus.mjs` by `XDG_CURRENT_DESKTOP`; register its test file and cases.
- [ ] Make the hosted dependency step, the KVM guest configuration and the Scaleway guest preparation specific to each desktop, installing each distribution's official KDE set without recommended or weak dependencies plus the explicit packages SPEC-001-031 lists.
- [ ] Run the 29 native foundation cases on the six KDE cells, extend the Scaleway workflow to the two ARM64 KDE cells, and run the contributor route on the three x86-64 KDE distributions and hosted Ubuntu ARM64.
- [ ] Update the issue bodies that SPEC-001-031 names, and add the new ADR and its register entry.
- [ ] Before closing, search `docs/` and the root guidance files for every previous cell identifier and job name and for Linux desktop statements limited to GNOME; update each match and every document SPEC-001-031 lists, except retained evidence records and its previous-identifier column. Review the frontmatter, `generated.by` and directory indexes of each changed document, and report to the maintainer what changed in each document that carries a human `verified` declaration.

## Acceptance criteria

- [ ] `profile_cells(required_only=True)` returns fifteen records and delivery admission derives twelve Linux cells whose keys equal their cell identifiers in SPEC-001-031.
- [ ] Every cell identifier, job name, artifact name and admission key follows `<target>-<profile>[-<desktop>]`, none ends in `-wayland`, `-vm` or `-scaleway`, the full-suite job is named `full-suite (linux-x64-ubuntu-26-04)`, and the workflow dispatches by `launcher`. The matrix equality test fails when the workflow and `build-targets.json` disagree.
- [ ] Negative tests reject Fedora KDE identity in a GNOME cell, Workstation identity in a KDE cell, `gnome-shell` serving a KDE cell, `gnome-shell` installed in a KDE cell, KWin without `plasmashell`, an X11 session on Debian 13 KDE, a missing `KDE_SESSION_VERSION` and `KDE_SESSION_VERSION=5`.
- [ ] The KDE focus helper refuses an ordinary desktop, a missing or non-numeric process identifier and a compositor process that does not own `org.kde.KWin` on the session bus; it unloads and deletes its script after a failed step; and the GNOME helper refuses a KDE session.
- [ ] A test fails the Plasma session launcher when the activation environment update fails or `StartServiceByName` for `org.freedesktop.impl.portal.desktop.kde` fails.
- [ ] A positive test proves that one sealed package passes in its GNOME and KDE cells, and the digest-mismatch test still rejects two different digests.
- [ ] The recurring `ci` requires twelve Linux cells and fourteen package results, and all four recurring KDE cells pass on the pull request and on the integrated `main`, verified against the originating run and SHAs.
- [ ] Each of the six KDE cells records 29 of 29 foundation cases and passes every packaged case, with the observations SPEC-001-031 requires.
- [ ] The Fedora and Debian ARM64 KDE cells pass their packaged cases on approved ephemeral Scaleway guests with `fault=none`, cleanup confirms that no resources remain, and duration and cost are reported.
- [ ] The Scaleway storage and time limits, the KVM free-space check and guest disk, and the hosted runner's disk are observed to be enough for KDE or raised with measured values, and recurring KDE job durations are recorded within the job timeout.
- [ ] Each KDE cell records its installed package count and that no display-manager process runs.
- [ ] The issue bodies SPEC-001-031 names state the KDE scope and the new identifiers, confirmed by rereading them after the update.
- [ ] A repository search finds no previous cell identifier or job name outside retained evidence records and the previous-identifier column of SPEC-001-031, and every document SPEC-001-031 lists describes twelve Linux cells and both desktops.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v` and the workspace test suite pass.
- [ ] The repository's pre-commit code review is complete.
- [ ] No result is reported for a cell without its native execution, and hosted, guest and optional human observations stay distinct in the report.
