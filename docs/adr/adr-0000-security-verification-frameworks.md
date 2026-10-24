---
type: DecisionRecord
title: "ADR-0000 — Security verification with explicit desktop applicability"
description: "Use ASVS L2 and complementary risk/testing frameworks with evidence scoped to actual desktop boundaries."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: asvs
    resource: "https://asvs.owasp.org/"
    title: "OWASP — ASVS"
  - id: web
    resource: "https://top10.owasp.org/2025/"
    title: "OWASP — Top 10 2025"
  - id: api
    resource: "https://api-security.owasp.org/editions/2023/en/0x11-t10/"
    title: "OWASP — API Security Top 10 2023"
  - id: llm
    resource: "https://genai.owasp.org/llm-top-10/"
    title: "OWASP — LLM Top 10 2025"
  - id: wstg
    resource: "https://wstg.owasp.org/v4.2/"
    title: "OWASP — WSTG 4.2"
  - id: csf
    resource: "https://www.nist.gov/cyberframework"
    title: "NIST — Cybersecurity Framework"
---

# ADR-0000 — Security verification with explicit desktop applicability

## Context

Private research, untrusted files and connected inference require verifiable controls beyond formatter checks or a scanner with no findings. A risk list alone is not an acceptance-control catalog; a private checklist alone makes coverage difficult to assess. Desktop IPC, local storage and agent execution also have boundaries that web standards do not cover completely.

## Decision

Use OWASP ASVS `5.0.0` L2, including applicable L1 requirements, as the application-security verification baseline. Record versioned requirement IDs, applicability, implementation and evidence. Justify exclusions against the actual product: an absent control is not automatically inapplicable. ASVS is a web/service standard; supplement it with Electron, native-process and filesystem controls rather than claiming complete desktop coverage from it.[^asvs]

Use OWASP Top 10 `2025` for general risks, API Security Top 10 `2023` for object/operation authorization and external-service consumption, and LLM Top 10 `2025` for injection, disclosure, output handling and excessive agency.[^web][^api][^llm] Use WSTG `4.2` cases on applicable renderer/HTTP surfaces, CWE for evidenced weakness classification and NIST CSF `2.0` for operational responsibility and recovery.[^wstg][^csf]

Each affected specification identifies controls and reproducible verification on the final candidate. Findings identify cause, trigger, impact, evidence and applicable references; unknown CWE mappings remain unknown. Do not map every finding mechanically to every framework. Failed or unverified mandatory controls block claiming the affected capability ready for real research.

## Consequences

Reviews gain common acceptance language and must maintain applicability and evidence. Scanner success is supporting evidence, not certification. Store execution results in review/test artifacts rather than a second history inside ADRs. Revisit selected editions explicitly when threats, platform scope or control coverage change.

[^asvs]: ASVS defines an application-security verification standard; L2 and the desktop applicability policy are Ohtia choices.

[^web]: The general risk catalog complements control verification.

[^api]: API risks inform scoped operations and external integrations.

[^llm]: The LLM catalog informs model trust boundaries.

[^wstg]: WSTG supplies web testing techniques, not native process containment.

[^csf]: CSF organizes operational risk responsibilities; it is not an application-control or weakness catalog.
