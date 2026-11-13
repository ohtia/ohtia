# EPIC-003 — Research agents and their conversation interface

- [EPIC-003 — Research agents and their conversation interface](epic.md) - Let the researcher connect ChatGPT, Anthropic or OpenAI accounts, set up a project with Virgilio and work through bounded, durable, attributed conversations, consultations, plans and handoffs with Virgilio and Josefa.

## Stories

- [STORY-003-001 — Provider adapter contract and credential store](STORY-003-001-provider-adapter-contract-and-credential-store.md) - Define the shared provider adapter contract with its fake provider and conformance suite, the connection operations in main and the operating-system credential store.
- [STORY-003-002 — Sign in with ChatGPT](STORY-003-002-sign-in-with-chatgpt.md) - Connect a ChatGPT subscription through Sign in with ChatGPT and show every connection state in Settings › Connections.
- [STORY-003-003 — ChatGPT requests](STORY-003-003-chatgpt-requests.md) - Send bounded, streamed ChatGPT requests with dispatch control, classified refusals and honest usage.
- [STORY-003-004 — Project and conversation records](STORY-003-004-project-and-conversation-records.md) - Store projects, conversations, messages and idempotent command receipts with their data-service operations.
- [STORY-003-005 — Durable AI tasks](STORY-003-005-durable-ai-tasks.md) - Run accepted AI requests as durable tasks and attempts in a multitask queue with per-conversation ordering and coalescing.
- [STORY-003-006 — Blocked work and plan-limit pause](STORY-003-006-blocked-work-and-plan-limit-pause.md) - Block work while ChatGPT is unavailable or its plan is exhausted, and resume it in order.
- [STORY-003-007 — Stop, time limits and uncertain replacement](STORY-003-007-stop-time-limits-and-uncertain-replacement.md) - Let the researcher stop tasks, enforce attempt and inactivity limits, keep partial text and replace uncertain tasks.
- [STORY-003-008 — Restart and suspension](STORY-003-008-restart-and-suspension.md) - Recover tasks after a restart: they continue by themselves after an orderly stop and wait for the researcher after a crash.
- [STORY-003-009 — Application exit](STORY-003-009-application-exit.md) - Ask before quitting with running work and let the researcher keep working, wait or cancel.
- [STORY-003-010 — Conversation view](STORY-003-010-conversation-view.md) - Show a conversation with attributed messages and live replies that never move a reader, carrying research operations and long texts through the port.
- [STORY-003-011 — Markdown, copy and links](STORY-003-011-markdown-copy-and-links.md) - Render messages as restricted Markdown and let the researcher copy a message and open its links through main.
- [STORY-003-012 — Message composer](STORY-003-012-message-composer.md) - Let the researcher write, send and stop from a growing composer with a 20,000-character limit and a destination line.
- [STORY-003-013 — Task notices](STORY-003-013-task-notices.md) - Show every task state, failure and pause as a clear notice with the right action and announcement.
- [STORY-003-014 — Project setup operation](STORY-003-014-project-setup-operation.md) - Let Virgilio agree a working title and document language through a proposal the researcher confirms.
- [STORY-003-015 — New project flow](STORY-003-015-new-project-flow.md) - Let the researcher start a project from five places and complete its setup with Virgilio through a proposal card.
- [STORY-003-016 — Open and switch projects](STORY-003-016-open-and-switch-projects.md) - Let the researcher list, open and switch projects and reopen the last one at start.
- [STORY-003-017 — Virgilio: clarify and next step](STORY-003-017-virgilio-clarify-and-next-step.md) - Let Virgilio guide the researcher in every confirmed project in the document language, within bounded input and output.
- [STORY-003-018 — Conversation history](STORY-003-018-conversation-history.md) - Let the researcher list, start, rename and switch conversations within the open project.
- [STORY-003-019 — Concurrency limits](STORY-003-019-concurrency-limits.md) - Let the researcher set how many AI replies run at once, from 1 to 50, without cutting running work.
- [STORY-003-020 — Josefa: search plan](STORY-003-020-josefa-search-plan.md) - Let Josefa propose an unverified, eight-part search strategy as a written plan in the document language.
- [STORY-003-021 — Agent selector and direct use](STORY-003-021-agent-selector-and-direct-use.md) - Let the researcher choose Virgilio or Josefa for a new conversation, with unavailable roles shown disabled.
- [STORY-003-022 — Consultation](STORY-003-022-consultation.md) - Let Virgilio propose one consultation of Josefa that runs only after the researcher accepts the exact request.
- [STORY-003-023 — Contribution graphs](STORY-003-023-contribution-graphs.md) - Store plans of several contributions with dependencies, validate them and advance them without holding slots while waiting.
- [STORY-003-024 — Shared work limits](STORY-003-024-shared-work-limits.md) - Bound every consultation and plan with a total work budget enforced by reservations and settlements.
- [STORY-003-025 — Coordination events and continuation](STORY-003-025-coordination-events-and-continuation.md) - Make plan events durable and deduplicated, create one synthesis per ready state, cancel plans and recover them after a crash.
- [STORY-003-026 — Virgilio: synthesis](STORY-003-026-virgilio-synthesis.md) - Let Virgilio combine a plan's results into one attributed synthesis whose source line Ohtia builds from the actual input.
- [STORY-003-027 — Virgilio: plan proposal and approval](STORY-003-027-virgilio-plan-proposal-and-approval.md) - Let Virgilio propose a complete plan that the researcher reads on a card and runs or declines.
- [STORY-003-028 — Plan progress, stop and finish](STORY-003-028-plan-progress-stop-and-finish.md) - Show an accepted plan's progress on its card and let the researcher stop or finish it.
- [STORY-003-029 — Handoff](STORY-003-029-handoff.md) - Let Virgilio hand a conversation to Josefa with a note and let the researcher bring Virgilio back with selected messages.
- [STORY-003-030 — Plan redirection](STORY-003-030-plan-redirection.md) - Let the researcher change a running plan through a change Virgilio proposes, touching only unfinished work.
- [STORY-003-031 — Attention signals](STORY-003-031-attention-signals.md) - Mark new replies and problems on the chat, history and project buttons without opening anything.
- [STORY-003-032 — Project memory for agents](STORY-003-032-project-memory-for-agents.md) - Give every project an automatic, attributed and reversible memory that Virgilio keeps and every agent receives.
- [STORY-003-033 — Project memory view and entries](STORY-003-033-project-memory-view-and-entries.md) - Let the researcher read, add, edit and withdraw project memory entries and see their history.
- [STORY-003-034 — Late usage and diagnostics](STORY-003-034-late-usage-and-diagnostics.md) - Record late usage within a fixed window, show each reply's details and prove that diagnostics carry no research content.
- [STORY-003-035 — Models and effort](STORY-003-035-models-and-effort.md) - Let the researcher choose, visibly, the service, model and effort of each agent and of a default.
- [STORY-003-036 — Anthropic API key](STORY-003-036-anthropic-api-key.md) - Connect an Anthropic Console API key and run agent replies through the official SDK without hidden retries.
- [STORY-003-037 — OpenAI API key](STORY-003-037-openai-api-key.md) - Connect an OpenAI Platform API key with a verified model catalog, reusing the Responses transport.
