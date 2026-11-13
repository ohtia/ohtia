---
type: Story
title: "STORY-003-003 — ChatGPT requests"
description: "Send bounded, streamed ChatGPT requests with dispatch control, classified refusals and honest usage."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:llm", "comp:desktop", "comp:tooling", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/205
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:llm", "comp:desktop", "comp:tooling", "comp:docs"]
applicable_blocks: ["SPEC-003-008"]
---

# STORY-003-003 — ChatGPT requests

## Description

Complete the adapter contract with start, interrupt and query, sequenced events, final results with their failure reasons, dispatch control and usage, and implement ChatGPT requests over the Responses API. The data service decides and prepares each request without credentials; main checks its permit, attaches the credential, sends it and forwards the events. A development command, a switch of the unpackaged development runtime only, exercises the route before tasks exist.

## Applicable specification

- [SPEC-003-008: ChatGPT requests](./epic.md#spec-003-008-chatgpt-requests)

## Tasks

- [ ] Start after STORY-003-001 is merged and its output is on the base branch: Adapter contract and credential store.
- [ ] Start after STORY-003-002 is merged and its output is on the base branch: ChatGPT sign-in, session and renewal.
- [ ] Start from the adapter contract of STORY-003-001, `packages/utility/src/entry.ts`, `packages/main/src/service-supervisor.ts`, `packages/main/src/profile.ts` (`admitRuntimeSwitches`) and `tooling/workspace.mjs` (`dev`), and extend these existing boundaries rather than create parallel ones.
- [ ] Add the request operations, request data without credentials, sequenced events, separately classified refusal text and the six final results (`completed`, `refused`, `content_filtered`, `failed`, `cancelled` and `uncertain`) with the failure reasons `usage_limit_reached`, `not_eligible`, `connection_expired`, `provider_unavailable`, `request_rejected`, `provider_error`, `invalid_output`, with `connection_lost` reserved for `uncertain`, to the adapter contract and the conformance suite, with a not-dispatched result for when main sends nothing, carrying `connection_expired`, `provider_unavailable` or `permit_expired`; declare resume unsupported for ChatGPT.
- [ ] Implement dispatch control in the data service: connection check just before sending, the exact transfer list without content, a single-use 2-second permit and no retries.
- [ ] Add the versioned, runtime-validated messages `provider_dispatch`, `provider_event` and `provider_interrupt` in `packages/contracts`; main discards without a result a dispatch from an ended data-service generation or with an already used permit, and otherwise checks that the permit was issued less than 2 seconds earlier for that attempt, renews an expired session once, checks that the connection is still connected, and otherwise sends nothing and returns the attempt not dispatched with `connection_expired`, which STORY-003-006 handles as a rejected renewal, checks the permit's age again just before the body leaves, and only then attaches the credential, sends the request and forwards every event without keeping a copy; a permit 2 seconds old or more at either check sends nothing and returns the attempt not dispatched with `permit_expired`.
- [ ] When a data-service generation ends, close every provider connection it dispatched and discard their later events before the next data service starts.
- [ ] Implement the Responses API transport in main with `store: false`, `stream: true`, `instructions` and `input`, never sending unsupported fields, and accept success only on `response.completed`.
- [ ] Send only the instructions, input and tools that Ohtia builds: never `previous_response_id`, `conversation`, `prompt` or a tool other than Ohtia's own, so no request reads or writes conversation state or prompts kept by the provider; add a conformance check of every request for these fields.
- [ ] Map interrupt to cancelled and every documented error to its result: a 401 before the stream or `subscription_sharing_invalid_user` to `connection_expired` with one renewal; a 403 before the stream or `subscription_sharing_user_not_eligible` to `not_eligible`; `subscription_sharing_usage_limit_exceeded` to `usage_limit_reached`; a 503 before the stream, `subscription_sharing_usage_unavailable` and `subscription_sharing_user_unavailable` to `provider_unavailable`; `subscription_sharing_unsupported_capability` and `subscription_sharing_route_not_supported` to `request_rejected`; `chatpass_v2_scope_not_authorized` and `chatpass_v2_invalid_authorization_context` to `request_rejected`, with the connection in `error` with the reason `sign_in_rejected`, stored with the kept session; any other 4xx to `request_rejected` and any other 429 or 5xx to `provider_unavailable`.
- [ ] Map structured refusal output in a validated `response.completed` to `refused` and an explicit `response.incomplete` reason of `content_filter` to `content_filtered`, which prevails over received refusal parts; preserve text, refusal explanations and usage separately within the shared output bound, without retries or connection-state changes. Refusal delta/done alone is not terminal, and ordinary negative text is not reclassified. Map `response.failed`, other `response.incomplete` events or an `error` event to `provider_error` keeping partial content; unparsable output to `invalid_output`, closing the response and keeping the text already received as partial; a stream that ends without a final event or drops after the request left to uncertain with `connection_lost`; a connection that never opened to `provider_unavailable`. Never show or store the `{"detail":"..."}` text.
- [ ] Renew an expired session once in main before dispatch, between the two permit checks; when OpenAI rejects the renewal with an unusable-token code or `invalid_client`, set the connection to `expired` or `error` as STORY-003-002 states, send nothing and return the attempt as not dispatched with `connection_expired`; when the renewal fails temporarily (no network or a 5xx response), keep the connection `connected`, send nothing and return the attempt as not dispatched with `provider_unavailable`.
- [ ] Add the development command in its own module, `packages/main/src/development-command.ts`, loaded only in the `development` runtime mode: main admits `--ohtia-dev-command=<action>` and `--ohtia-dev-<argument>=<value>` only in that mode, `python3 scripts/workspace.py run dev` passes them on, and an open instance receives them through `second-instance`; add the `request` action, with `--ohtia-dev-model=<slug>` and the fixed text "Describe the usual parts of a thesis in about 300 words.", and the `interrupt` action, with `--ohtia-dev-attempt=<id>`; each prints its identifiers and results to the running instance's terminal. The development runtime keeps its state under `<checkout>/.ohtia-dev/` and uses the checkout's own credential-store service of STORY-003-001, `Ohtia Development` followed by the checkout identifier, so the development command never reads or overwrites the installed application's credentials or another checkout's.
- [ ] Make the data service accept development actions and the operation catalog accept `development_test` only in the `development` mode, and add the `development_test` policy and instruction version 1, whose input is the newest whole messages up to the input limits, sent oldest first, with the note "Earlier messages in this conversation are not included." when older ones are left out (the `request` action's input is its one fixed message), whose instructions are the text of SPEC-003-008 that begins "You are Virgilio, the research guide in Ohtia" and ends "Keep replies short unless the message asks for a particular length.", sent in `instructions` with every `development_test` request, and whose values are `max_pending_tasks` 20; `max_input_bytes` 16 KiB and `max_input_items` 20; `max_output_bytes` 16 KiB; `max_work_units` 1; `max_attempt_duration_ms` 10 minutes; `max_inactivity_ms` 120 seconds; `stop_grace_ms` 5 seconds; `max_attempts` 2, `max_auto_retries` 0 and `retry_backoff_ms` 0.
- [ ] Add the artifact inspection test that fails if any package built in the 12 CI cells contains the development-command module, and check that a built package launched with `--ohtia-dev-command=request` is refused at startup.
- [ ] Apply the documentation amendment to `docs/desktop-runtime.md`: "It takes no arguments." becomes "It takes no arguments except the development command switches `--ohtia-dev-command=<action>` and `--ohtia-dev-<argument>=<value>`, which main admits only in this mode; while a window from the checkout is open, they reach that instance."

## Acceptance criteria

- [ ] The `request` action receives a real streamed reply with the researcher's stored session, read from the checkout's own `Ohtia Development` entries, and a chosen model.
- [ ] The `interrupt` action stops a request mid-reply and yields `cancelled`.
- [ ] With the fake provider imitating OpenAI's documented responses, every documented error, stream ending and network failure yields its specified result and reason, and `chatpass_v2_scope_not_authorized` leaves the connection in `error` with the reason `sign_in_rejected` after a restart.
- [ ] A rejected renewal sends nothing and returns `connection_expired` with the connection `expired` or `error`; a temporary renewal failure sends nothing and returns `provider_unavailable` with the connection still `connected`.
- [ ] Main refuses with `permit_expired`, sending nothing, a permit older than 2 seconds at the first check and one that a slow renewal ages past 2 seconds before the second check; it discards a reused permit and a dispatch from an ended generation; a connection that is no longer connected at its check sends nothing and returns `connection_expired`; an unparsable event in the stream fails with `invalid_output` and keeps the text received before it; and ending the data service closes the requests it dispatched.
- [ ] Every `development_test` request carries the instructions of SPEC-003-008.
- [ ] No message from the data service to main contains a credential.
- [ ] No request carries `previous_response_id`, `conversation`, `prompt` or a tool other than Ohtia's own.
- [ ] Unreported usage is stored as unknown, never zero.
- [ ] The artifact inspection test proves that no package contains the development command, and a package launched with the switch is refused.
- [ ] Structured refusals and explicit content filtering yield their own results, preserve separately classified bounded content and usage, and do not become completion, technical failure, account disconnection or an automatic retry; a refusal fragment followed by loss or interruption remains uncertain or cancelled.
- [ ] The extended conformance suite passes.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] The pull request records, under ADR-0000, the applicable OWASP ASVS 5.0.0 L2 requirement IDs for the outbound provider requests, the dispatch permit and the development command's switches, with their applicability and evidence.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
