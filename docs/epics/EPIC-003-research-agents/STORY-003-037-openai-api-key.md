---
type: Story
title: "STORY-003-037 — OpenAI API key"
description: "Connect an OpenAI Platform API key with a verified model catalog, reusing the Responses transport."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:llm", "comp:desktop", "comp:app", "security"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/239
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:llm", "comp:desktop", "comp:app"]
applicable_blocks: ["SPEC-003-042"]
---

# STORY-003-037 — OpenAI API key

## Description

Add the OpenAI API-key connection, the catalog of verified text models crossed with the account, Responses requests through STORY-003-003's transport in the main process, billing pauses and error mapping. The key goes from the window to main only and never reaches the data service.

## Applicable specification

- [SPEC-003-042: OpenAI API key](./epic.md#spec-003-042-openai-api-key)

## Tasks

- [ ] Start after STORY-003-036 is merged and its output is on the base branch: API-key connection flow.
- [ ] Start from the Responses transport of STORY-003-003 and the API-key connection flow of STORY-003-036, and extend these existing boundaries rather than create parallel ones.
- [ ] Declare the connection with the display name "OpenAI" and the kind `api_key`, and reuse STORY-003-036's `api_key` texts: "Add {service} API key", the per-token charging line, the masked key entry with "Save key" and "Close key entry", which sends the key once to main through `connection.connect` or `connection.replaceKey`, the key check by listing models in main with STORY-003-036's outcome through `connection.subscribe`, `checking_key`, failure reasons `key_rejected`, `key_not_permitted`, `key_check_unreachable` and `key_check_unavailable` and their notices, without STORY-003-036's `key_needs_workspace`, which only Anthropic's workspace 400 sets, the `api_key` connection rows and test results, storage in the credential store as the entry `openai-api-key`, holding the key with its random `instance`, the account input of STORY-003-034's fingerprint, and the connection row "{service} · API key · Connected {date}" with "Test connection", whose result shows in one status notice with `info`, "Replace key" and "Disconnect {service}" and its inline confirmation in the row, "Keep connection" with the initial focus and the destructive "Disconnect {service}", never a dialog over Settings, under the connection identifier `openai_api_key`; connection operations record no `command_receipts` row; declare `late_usage: none`.
- [ ] Never show or store messages that come with a 401 or a failed connection check, and keep a 400 message in the notice from memory only, as its second line "{service} said: {provider_message}", plain text with `lang=""`, never stored or written to diagnostics.
- [ ] Ship the model catalog checked on 2026-11-09, in the listed order with the exact effort levels of SPEC-003-042, and show only catalog models available to the key according to the account's complete list and not marked with a `shutdown_date`, with the line "Models Ohtia hasn't checked yet aren't listed." and the origin and age: "Model details from Ohtia's catalog (checked {date}). Availability from your {service} account, updated {age}.", with `{date}` the catalog's check date as a medium date in the interface locale.
- [ ] Reuse the Responses transport in main with the API base address, Bearer authentication, `store: false`, streaming, namespaced tools and `reasoning.effort`, never `previous_response_id`, `conversation`, `prompt` or a tool other than Ohtia's own; the data service builds each request without the key and dispatches it through `provider_dispatch`.
- [ ] Map a 401 to `connection_expired` with the connection `expired` and the `api_key` notice "{service} no longer accepts this key. Replace it in Settings › Connections."; a 403 to `not_eligible` with its `api_key` notice; a 404 to `model_unavailable` with STORY-003-036's notice and a new read of the model list; a 503, a 500 and a connection that never opened to `provider_unavailable`; and a 400 or any other 4xx to `request_rejected`.
- [ ] Map the stream for this connection: `response.completed` completes the reply; `response.incomplete` whose `incomplete_details.reason` is `max_output_tokens` fails with `max_output_reached`, keeping partial text, with STORY-003-036's notice and partial line, not counted as cut in "Details"; any other `response.incomplete`, `response.failed` and an `error` event fail with `provider_error`, keeping partial text; an unparsable event or output fails with `invalid_output`; a stream without a terminal event or a dropped connection is uncertain with `connection_lost`.
- [ ] With the researcher's key, run STORY-003-035's measurement of the longest replies at the highest effort level the chosen catalog model declares, and apply the measurement rule.
- [ ] Map billing 429s to STORY-003-036's `billing_limit_reached` with a connection pause, `usage_limit_pauses` now also accepting `openai_api_key`, shown with the `api_key` usage-pause notice "{service} says this key's account has no credit or reached its spending limit. Ohtia paused new requests to {service}.", the destination line "Requests to {service} are paused: no credit or spending limit reached. Messages will wait." and "Resume {service} requests ({n})", without a "Check usage" link; other 429s to `rate_limited` with the `Retry-After` wait stored in `attempts.retry_not_before_at` and STORY-003-036's waiting texts.
- [ ] Build the OpenAI row from the canonical tokens and its reply notices with STORY-003-013's notices and their measurements, and compare them with `epic-003-connections.png` and the OpenAI columns of `epic-003-connections-states.png`; the EPIC text prevails over a capture.

## Acceptance criteria

- [ ] Only catalog models available to the key and without a `shutdown_date` are listed, with the unlisted-models line.
- [ ] A 401 shows the `api_key` `connection_expired` notice, a 403 fails with `not_eligible`, and a 404 fails with `model_unavailable` and reads the model list again.
- [ ] Each stream outcome yields its stated reason: a `response.incomplete` for `max_output_tokens` gives `max_output_reached`, another `response.incomplete`, a `response.failed` or an `error` event `provider_error`.
- [ ] A failed key check arrives with its reason and notice, and a failed `connection.replaceKey` keeps the earlier key.
- [ ] No request carries `previous_response_id`, `conversation`, `prompt` or a tool other than Ohtia's own.
- [ ] A billing 429 opens the connection's pause in `usage_limit_pauses`, blocks waiting and new tasks with `usage_limit_reached` and changes the destination line until "Resume {service} requests ({n})"; another 429 waits `Retry-After` when given.
- [ ] Usage records all four counters, and a stopped reply shows usage unknown with the stopped-reply usage line of every service, below "Incomplete — stopped by you" when text was saved or "Stopped." when none was, and its "Details", opened from its message or its notice, reads "Not reported by {service}" for "Usage" and "Unknown" token counts.
- [ ] No text of this connection names a fixed service.
- [ ] The key never appears in a message to the data service, in the database or in `command_receipts`.
- [ ] With the researcher's key, Josefa runs on the OpenAI API in a conversation and in a plan with Virgilio on ChatGPT, a reply stopped after its text starts shows "Incomplete — stopped by you" with its usage line and, in "Details", "Not reported by OpenAI" and "Unknown" token counts, and the longest replies are measured at the highest effort level the chosen model declares.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] The pull request records, under ADR-0000, the applicable OWASP ASVS 5.0.0 L2 requirement IDs for the key's entry, storage and use and the OpenAI API requests, with their applicability and evidence.
- [ ] Paid real-account checks start only after the researcher sets a spending cap in the provider console.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it. A raise of `search_strategy_planning` or `contribution_synthesis` also adds the next plan or consultation limits policy version, as SPEC-003-002 states.
- [ ] The marker sweep of STORY-003-034 includes OpenAI API paths and the key.
- [ ] The interface meets WCAG 2.2 AA and ADR-0023's eleven selected AAA criteria, with ATAG 2.0 Part B as guidance, and is checked with the keyboard alone (focus order and restoration), a screen reader (names, roles, states and announcements), a 280 CSS px chat width, reflow at 320 CSS px, light and dark themes, forced colors, reduced motion, German, Korean with mixed scripts in the packaged fonts, pseudolocalization, the locale fallback and override, and the native input methods in every text field it adds; each manual screen-reader result names the artifact, platform and journey, and its new text is in every supported locale catalog.
- [ ] "Disconnect {service}" is confirmed inline in the row with focus on "Keep connection", and the row is compared with the EPIC's connections captures.
- [ ] Catalog text uses the typographic apostrophe ’ (U+2019) and quotation marks “ ”, as `en-US.json` does; this EPIC writes them as straight characters for readability.
- [ ] Every notice this story adds holds only its icon and text inside its box; its buttons and links sit `space.2` below the box on the surrounding panel or page surface, never inside it, as `research-presentation.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
