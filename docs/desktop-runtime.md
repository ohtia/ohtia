---
type: Playbook
title: Isolated desktop runtime
description: Admit native runtime contexts, run isolated development requests and verify supervised storage and window lifecycles.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# Isolated desktop runtime

## Scope and authority

The [runtime specification](epics/EPIC-001-desktop-foundation/STORY-001-004-run-the-isolated-desktop-and-supervised-data-service.md) composes the [locked workspace](developer-workspace.md), [foundation resource policy](desktop-foundation-contract.md) and [bounded application port](application-port.md). The broker owns native dialogs, window admission and one supervised utility service. The renderer receives named functions and controlled values through a sandbox-compatible preload. PRIN-004, PRIN-006, PRIN-007 and PRIN-016 require keeping portable checks, native observations, fixed-root initialization and confirmed storage effects distinct.

The utility initially reports status with the engine unavailable. [Durable foundation storage](storage.md) completes validated opening at the fixed native-home root, immutable migrations, locator activation and transactional appearance commands. The initial window explains recovery-copy sensitivity and offers explicit local opening; the broker preserves pending input during service replacement.

## Native window lifecycle

The existing broker factory applies [ADR-0039](adr/adr-0039-integrated-window-title-bar.md) and the [native-window specification](epics/EPIC-002-basic-interface/epic.md#spec-002-022-integrated-title-bar-and-native-window-state). Main and the renderer consume colors and row height projected from the canonical design tokens. Windows start hidden with the resolved page background and become visible on `ready-to-show`, with the approved native Wayland load-completion condition defined by the linked canonical contract. Main applies the confirmed choice through Electron's application-scoped `nativeTheme.themeSource` before new renderer creation, so Chromium's `prefers-color-scheme`, native UI, background and overlay share the effective theme without waiting for a renderer preference read. Bootstrap and recovery restore the system source. The bootstrap appearance control retains its draft and receipt identity without overriding the document theme. A late older preference revision cannot replace a newer one.

On Linux, backend-specific placement and first-show rules use Electron's resolved `ozone-platform` value, rather than inferring the rendering backend from session environment variables. This reads the runtime's automatic selection and does not force a backend or qualify an X11 session.

The bootstrap title row reuses the delivered workspace command control and brand. It stays outside the bootstrap main scroller, including during initialization and recovery; reducing viewport height scrolls the content while the application-menu entry and title remain visible alongside the native controls. This frame does not compose future project or workspace capabilities.

After storage activation, main loads bounds and appearance before exposing workspace readiness. The trusted broker serializes close-time bounds writes through the supervised data service and drains accepted writes before stopping that service at quit. A closing renderer owns no completion callback. Lost acknowledgements retain their original operation identities for receipt lookup without resubmission; failures produce only the content-free `ohtia.window.bounds_failed` diagnostic. Bootstrap and recovery windows do not save geometry. New windows use this same factory and its window/process admission limits.

The command bridge and deterministic tests do not establish native overlay support or safe-area measurements. Use the specification's target-specific qualification before recording system-control widths or macOS traffic-light insets; retain each native artifact, environment, keyboard journey and omitted target under the task's ignored evidence. The reference specimen's placeholder measurements are not product fallbacks (PRIN-006 and PRIN-007).

Native Wayland uses the [approved compositor-owned geometry contract](epics/EPIC-002-basic-interface/epic.md#spec-002-022-integrated-title-bar-and-native-window-state): saved size and maximized state are requests, and global positioning, display selection and cascading are not claimed. Bootstrap admission retains the existing window and private in-session state; later windows receive saved size in their constructor. Qualification records distinguish requested geometry from what the compositor accepted.

Renderer preference mutations remain unavailable until the broker publishes `storage_ready`, including when the data service is active but preference initialization failed. Main returns the existing definitive `service_unavailable` result without dispatching the mutation or retaining its request reservation; reads, receipts and lifecycle controls keep their existing admission rules so recovery remains observable.

## Runtime modes

[ADR-0043](adr/adr-0043-ordinary-startup-modes.md) selects one mode, independently in main and utility:

- **`development`:** `python3 scripts/workspace.py run dev`, from your ordinary account and graphical session. It takes no arguments except the development command switches `--ohtia-dev-command=<action>` and `--ohtia-dev-<argument>=<value>`, which main admits only in this mode; while a window from the checkout is open, they reach that instance.
- **`installed`:** an installed package opened normally. It needs no profile.
- **`qualification`:** the procedures below, with an independent profile.

### Develop from your ordinary account

```bash
python3 scripts/workspace.py setup
python3 scripts/workspace.py run dev
```

`dev` builds the workspace, replaces `.ohtia-dev/runtime` and opens the application. State persists in `.ohtia-dev/configuration` and `.ohtia-dev/research`, and deleting `.ohtia-dev/` is the reset. There is no automatic reload, so run `dev` again after a change. While a window from the checkout is open, `dev` attaches to it and keeps its runtime, so close the window before running `dev` to see a change. Wait for the window before running `dev` again, because two builds in one checkout overwrite each other's output. Other checkouts and an installed application run alongside with separate state. A checkout inside `<home>/ohtia` is refused. Electron's output reaches the terminal, and a failure prints its exit code and diagnostics location.

Open local data in the development window and connect ChatGPT in this checkout's Settings before using the development command to exercise the credential-free request route and the selected model. Commands received before local storage is ready wait for that explicit opening:

```bash
python3 scripts/workspace.py run dev --ohtia-dev-command=request --ohtia-dev-model=<slug>
python3 scripts/workspace.py run dev --ohtia-dev-command=interrupt --ohtia-dev-attempt=<id>
```

The request uses the fixed thesis-structure question and [SPEC-003-008's versioned development instructions and bounds](epics/EPIC-003-research-agents/epic.md#spec-003-008-chatgpt-requests). The running instance's terminal prints JSON records with operation and attempt identifiers, sequenced text, separately classified refusal text, usage and final outcome. Final events include the references-only transfer manifest, elapsed duration and longest observed silence. These records are explicit development output, separate from managed diagnostics. The data service retains bounded in-memory development attempts until it exits; no research project or durable task is created. The provider result distinguishes `refused` from `content_filtered` using the structured terminal signals defined in SPEC-003-008, retaining explanations under the same output bound as ordinary text. Unknown usage remains unknown (PRIN-006 and PRIN-016). Interrupt closes the local response and reports cancellation without asserting that provider billing stopped. Requests are never retried automatically.

The checkout uses its own admitted data root and credential namespace under [ADR-0048](adr/adr-0048-provider-access-routes-and-credential-store.md). Installed and qualification launches refuse these switches. The build and final-package inspection reject the development-command module in shipped artifacts.

`dev` does not require a qualified desktop. On Ubuntu, the Chromium sandbox needs one administrator-reviewed allowance, printed by `python3 scripts/linux_contributor.py sandbox-policy --development`. It stays valid across rebuilds, until the Electron pin or the checkout path changes.

`python3 scripts/workspace.py run preview` serves the [component catalog](semantic-primitives.md#isolated-catalog-and-verification), with no Electron and no research storage.

## Linux graphics compatibility

Main applies the fixed [Linux graphics policy](adr/adr-0044-linux-graphics-compatibility.md) before native readiness in every runtime mode. GNOME Wayland cells retain their color, GPU and WebGPU defaults. On the qualified KDE Plasma Wayland cells, the scoped KDE fallback avoids unsupported color negotiation while retaining the default WebGPU adapter. The decision defines the exact session condition, color/HDR limitations, upstream Vulkan diagnostic disposition, validation boundary and removal conditions. Ordinary launches still reject command-line feature overrides.

## Prepare an independent native profile

Provision an independent OS account or native VM using the inspection procedure in [Native foundation qualification](native-qualification.md#provision-an-independent-native-profile). Use synthetic or explicitly permitted public data. Keep configuration, research and scratch roots separate from the stable profile, its recovery material and the checkout. Selecting another research directory or changing an environment variable does not establish isolation. Preserve native CPU, filesystem, graphical-session and security-policy observations with the inspection record.

The account's native home comes from the OS account database. The configuration root is its native application-data parent: `.config` on Linux, `Library/Application Support` on macOS and `AppData/Roaming` on Windows. Redirected or aliased configuration roots fail admission. Create research and scratch directories on the inspected local, owned, unsynchronized volume. Inspect Windows ACLs and native aliases as part of that procedure; a matching path string does not certify them.

Create `runtime-profile.json` inside that account's home, preferably in its scratch directory. It must be an ordinary, unaliased file with one hard link. The launcher refuses another filename or a foreign-home path before reading it, so mistakenly passing a stable `data-location.json` cannot make that file a profile input. The example below describes the schema; it is not an inspected profile or human approval.

```json
{
  "schema_version": 1,
  "kind": "independent-native-profile",
  "inspected_by": "human:replace-with-inspector",
  "username": "isolated-user",
  "target": "linux-x64",
  "home": "/home/isolated-user",
  "configuration_root": "/home/isolated-user/.config",
  "research_root": "/home/isolated-user/ohtia",
  "scratch_root": "/home/isolated-user/scratch",
  "stable_roots": {
    "configuration": {
      "root": "/home/stable-fixture/configuration",
      "sentinel_sha256": "replace-with-the-observed-sha256"
    },
    "store": {
      "root": "/home/stable-fixture/store",
      "sentinel_sha256": "replace-with-the-observed-sha256"
    },
    "recovery": {
      "root": "/home/stable-fixture/store/recovery",
      "sentinel_sha256": "replace-with-the-observed-sha256"
    }
  },
  "manual_checks": {
    "independent_account_or_vm": true,
    "no_emulation": true,
    "local_owned_unsynchronized_volumes": true,
    "no_credentials": true,
    "stable_roots_complete": true,
    "native_security_and_display": true
  }
}
```

`inspected_by` accepts `human:<id>` or `agent:<id>` with ASCII letters, digits and hyphens. Each stable root contains a synthetic `.ohtia-runtime-sentinel` with the recorded SHA-256. An existing qualified fixture may instead explicitly declare `sentinel_filename: ".ohtia-native-probe-sentinel"`; these are the only two admitted names. No fallback searches for another file or rewrites a rejected sentinel. Keep the existing locator, store and recovery fixture contents and metadata under independent before/after observation as well as checking the sentinel bytes.

The launcher validates exact record fields, native account/home/architecture, owned canonical roots, disjoint configuration/research/scratch and exclusion of every stable root before checking sentinels or spawning Electron. Main rechecks the native context before broker admission; the utility independently checks the same profile before serving requests. Inspection declarations identify an actual procedure and actor. They cannot authenticate an operator, prove a VM from JSON alone or defend against an equivalent-privilege administrator.

## Build, assemble and launch

Run setup and builds in the task worktree under the inspected account. The Python bootstrap prerequisite and Windows command spelling follow the [workspace guide](developer-workspace.md#scope-and-prerequisites). Assembly downloads only the selected pinned Electron archive, verifies its digest, preserves constrained framework links and strips special executable mode bits. It does not execute Electron. Use a fresh absolute attempt directory whose parent already exists.

```bash
python3 scripts/workspace.py setup
python3 scripts/workspace.py run build
python3 scripts/workspace.py run desktop:prepare linux-x64 /home/isolated-user/scratch/runtime-attempt
python3 scripts/workspace.py run desktop:launch /home/isolated-user/scratch/runtime-profile.json /home/isolated-user/scratch/runtime-attempt
```

Select the actual target ID from the [target manifest](../config/desktop/targets.json). A target's archive existing or cross-building successfully does not qualify native execution. The prepared record binds the executable, application files, links and archive identity. Launch verifies those bytes and the native profile, then supplies a restricted environment with the actual native session and isolated temporary roots. It does not copy provider credentials, Node injection settings or update configuration.

The build produces independent `main.mjs`, sandbox-compatible `preload.cjs`, `utility.mjs` and local React/Vite assets under `artifacts/desktop-app`. The application uses the exact `ohtia://app/index.html` document and an allowlisted, integrity-checked resource inventory, an ephemeral session, restrictive CSP and denied permissions, external navigation and window creation. Development previews and probe fixtures are outside these outputs. [The font manifest](../packages/renderer/fonts/manifest.json) binds unmodified local faces to their versions, hashes and licenses. [Catalog provenance](../packages/contracts/catalog-provenance.json) records the actual producer evidence and any unresolved identity or human-review gaps without inventing a verifier.

The separate browser specimen remains available as `preview`. It serves synthetic transient state and follows the workspace's loopback-only server contract.

## Broker, port and lifecycle

The fixed native application name is `Ohtia`; the selected research directory never redirects Electron `userData`. The per-user single-instance lock attaches another launch to the existing broker or reports a controlled conflict. Every window shares one `PortAdmission` and service generation. Window, pending-request, subscription, startup and shutdown bounds come from the canonical resource policy rather than separate runtime numbers.

Preload obtains fresh trusted generations from the actual admitted main frame, exposes only `DesktopBridge` and removes its port listeners, streams and timers on disposal. Main checks the live `senderFrame`, owning window, exact document and generations before accepting requests or controls. The utility validates the shared wire schema independently. A result must match the original operation and correlation; an obsolete generation cannot deliver into a replacement session. Cancellation or frame detachment does not release accepted service capacity before a terminal result or proved child exit.

The private service lifecycle admits one exact ready handshake and bounded disposal acknowledgements. Invalid child messages fault the generation. A kill signal quarantines outstanding capacity; the child's exit event releases it. Retry is explicit and starts a new service only after cessation, without replaying commands. It refreshes window sessions while preserving the fixed-root bootstrap outcome. Quit stops admission, drains the child, escalates within the policy's termination budget and retains graphical uncertainty if cessation was not observed. Native acceptance separately accounts for all Electron helpers and descendants; `getAppMetrics()` alone does not prove complete-tree cessation or resource coverage.

## Fixed locator and native-home initialization

Main reads only `settings/data-location.json` beneath the fixed native `userData` location. [Application preferences and bootstrap](architecture.md#application-preferences-and-bootstrap) owns its exact record and size limit. Parsing rejects unsupported versions, unknown or duplicate keys, malformed UTF-8, non-absolute paths and invalid scalar strings. Native resolution excludes settings overlap, stable roots, foreign ownership and an unqualified volume. Malformed, newer, unreadable or aliased records remain intact and produce controlled graphical guidance.

The OS adapter derives the research root from the account's native home and requires the inspected profile to match it. A missing locator reports pending initialization at that fixed root. There is no location chooser or location-changing bridge action. The bootstrap snapshot carries a version, resolved locale, controlled state and optional bounded recovery notice; application-owned text and accessible controls use the broker's resolved catalog.

`LocatorPublisher` is a serialized storage-integration primitive. Its caller must supply successful store validation and a publication adapter qualified for the actual platform. It rechecks native directory identity after asynchronous validation, synchronizes created directories, retains the previous locator as evidence, writes a complete same-directory temporary file and replaces the locator atomically. Failure before replacement preserves the confirmed locator; an uncertain replacement preserves existing data and evidence. The POSIX adapter exposes explicit file/directory synchronization primitives; its existence is not Windows or physical power-loss qualification. The runtime invokes publication only after storage admission and enables appearance access only after confirmed publication.

## Native verification

Run portable checks and the repository hooks from the task worktree. Include new files explicitly before review; the workspace guide owns the common command list. Do not run commands that regenerate `dist` concurrently. Inspect all formatter changes and keep source/lock identities with each native attempt.

```bash
python3 scripts/workspace.py run check
python3 scripts/workspace.py run desktop:test /home/isolated-user/scratch/runtime-profile.json /home/isolated-user/scratch/runtime-attempt /home/isolated-user/scratch/evidence-attempt
```

The native Playwright harness explicitly enables Chromium sandboxing and leaves CSP enforced. The harness explicitly enables acceptance instrumentation; ordinary launches reject command-line feature overrides. Its inspector endpoints use only ephemeral loopback ports; these instrumented controls remain distinct from the uninstrumented resource anchor. The runtime harness checks real status IPC and initial storage unavailability, local resource and navigation denials, keyboard/reflow/accessibility observations, fixed-root initialization, concurrent windows, second launch, service death, explicit retry and shutdown. Collect native filesystem-failure, process-tree, active OS sandbox and display-backend observations separately.

For every required target/profile/backend, retain the actual host CPU, executable and utility identity, artifact and source-input digests, native inspection, command exits, positive/negative cases and complete shutdown observations. Exercise stable/unverified admission refusal without reading stable locator/store/recovery contents, native aliases, denied access and interrupted locator publication. Failed or missing cases leave that profile unqualified. The [native qualification report](native-foundation-report.md) establishes earlier mechanism feasibility; it does not become evidence for changed runtime bytes. [Integrated verification](epics/EPIC-001-desktop-foundation/STORY-001-017-verify-the-integrated-foundation-and-contributor-journeys.md) owns manual assistive acceptance and combined final-artifact evidence.
