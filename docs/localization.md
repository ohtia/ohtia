---
type: Reference
title: Shared interface localization
description: Author complete typed catalogs and use the durable application-wide language preference without changing research content.
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
sources:
  - id: wcag-input-purposes
    resource: https://www.w3.org/TR/WCAG22/#input-purposes
    title: W3C — WCAG 2.2, Input Purposes for User Interface Components
  - id: understanding-input-purpose
    resource: https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html
    title: W3C — Understanding SC 1.3.5 Identify Input Purpose
  - id: html-autofill
    resource: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill
    title: WHATWG — HTML Living Standard, Autofill
---

# Shared interface localization

## Authority and catalogs

The shared [locale resolver](../packages/contracts/src/locale.ts), [message contracts](../packages/contracts/src/catalogs.ts) and [autonym table](../packages/contracts/src/localization.ts) belong to the existing portable contracts package, allowing the broker and renderer to use one service without crossing package authority boundaries. [ADR-0024](adr/adr-0024-typed-localization-catalogs.md) owns the resolution algorithm and supported matching examples. Main obtains the ordered system preferences from Electron; unavailable preferences select the global fallback.

Each supported locale has one complete UTF-8 JSON file in [the shared localization directory](../packages/contracts/src/localization), including the `en-US.json` authoring catalog. Every feature adding a message updates all 25 files and its typed parameter contract in the same change. New keys use semantic English dotted identifiers. Existing foundation identifiers remain stable for their delivered consumers. Catalog lookup never fills missing messages from another locale. Autonyms are checked constants with their own `lang`, independent of the interface language and `Intl.DisplayNames`.

The delivered messages use plain text and named string parameters. The TypeScript `message` API requires the declared parameters; runtime checks also reject missing or extra parameters. `formatNumber` and `formatDate` use the selected locale within the actual runtime ICU environment; stored and protocol values do not use presentation formatting. The common [catalog gate](../tooling/quality-catalogs.mjs) checks exact keys, parameter types, ICU syntax and declared plural/select forms, including each locale’s required plural categories. Future plural/select message producers must supply a matching typed rendering contract before introducing such messages.

[Catalog provenance](../packages/contracts/catalog-provenance.json) separates inherited foundation messages from later surface-specific generation batches. The [candidate-bound provenance snapshot](../config/localization/catalog-provenance.json) records each locale’s catalog and English-reference hashes with the inherited generation records. These translations have no human linguistic verification. Known effective model identities are retained; batches without a confirmed exact identity explicitly leave that identifier unavailable. Structural checks and rendering do not certify fluency, regional review or human approval (PRIN-004 and PRIN-007).

## Named preference operations

The existing [application port](application-port.md) adds `locale.read`, `locale.replace`, `locale.receipt` and `locale.subscribe`. Its existing protocol, sender/frame/origin admission, generations, bounds, cancellation and subscription policy apply. There is no renderer authority over OS preference lists, catalog paths, arbitrary keys or storage location.

`interface_locale` is a schema-version-1 application preference whose value is `system` or an exact supported locale. `locale.read` and locale events return the record plus the admitted `serviceGeneration`, `systemLocale` and `effectiveLocale`; the latter must equal the explicit choice or the broker-resolved system locale. Missing records use revision zero and `system`. Invalid saved values produce `invalid_fallback` with a known revision and a controlled notice; reads preserve their original bytes. An unreadable revision cannot authorize replacement. Invalid saved values offer an explicit Use system language repair through the ordinary validated replacement command.

`locale.replace` takes exactly `expectedRevision` and `value`; its envelope supplies the operation identity. The local `replaceLocale` method also accepts an optional expected service generation. The selector always supplies its snapshot generation; the current preload client rejects a mismatch before sending, so a write cannot use a stale snapshot across connection replacement. This guard is not a wire payload field. The [domain command](../packages/domain/src/locale-command.ts) checks that identity before revision admission. The [SQLite store](../packages/utility/src/storage.ts) commits only `interface_locale` and its receipt in one transaction, preserving every other preference. The immutable `0003_locale_receipts` migration adds its receipt table through the existing compatibility, checkpoint and recovery path without changing earlier migrations. Startup and returning to system mode obtain the system resolution from main. Confirmed snapshots update broker-owned future text and window titles and reach open renderers through bounded subscriptions.

## Presentation and recovery

The [language controller](../packages/renderer/src/language-controller.ts) and [native select](../packages/renderer/src/language-panel.tsx) save each explicit choice immediately. System mode precedes the 25 autonyms. Help text distinguishes interface language from document and analysis language. The select collects the researcher's own preferred interface language, so WCAG 2.2 SC 1.3.5 applies even though Ohtia has no sign-in or profile: the criterion covers `select` controls collecting information about the user, and its input-purpose list names `language` as preferred language.[^understanding-input-purpose][^wcag-input-purposes] The select therefore declares the HTML `autocomplete="language"` token, which `select` elements may carry, while its accessible name and description remain the Language title and help text.[^html-autofill] The token exposes that purpose to software; Ohtia provides no autofill service, and the `system` value keeps following the operating-system preference. Applying a confirmed locale updates messages and `html.lang` while preserving mounted form/editor state and focus (PRIN-002).

Submitting, confirmed, rejected, conflicting and uncertain outcomes remain distinct. A rejected choice retains the confirmed value; Try again allocates a fresh explicit intent. Check queries the uncertain command’s original receipt. `pending`, a failed receipt read and `not_found` alone preserve uncertainty; none resubmits the mutation. After a snapshot from a new admitted service generation and a `not_found` receipt from its current store, the prior execution is known to have ceased and its receipt is absent from the authoritative ledger. The original identity remains available to Check until the researcher explicitly chooses again; that action creates a new operation identity rather than replaying the original. A confirmed save followed by a refresh or display error remains saved; refresh/application recovery never repeats the mutation (PRIN-006).

After a stream gap or invalidation, the controller uses fresh subscription identities and a bounded reread/resubscribe. An unsuccessful recovery stays inspectable for explicit refresh. Revisions are compared within their admitted service generation, so a restored checkpoint can supply a lower revision through its new generation while old replies remain rejected by the port. A private preference-ready acknowledgement invalidates logical locale subscriptions after connection replacement; recovery uses the same bounded reread/resubscribe path. A failed subscription remains inspectable even when a concurrent preference read succeeds. Disposed view callbacks cannot replace newer state. Passive snapshots and receipt reconciliation do not announce another save. Closing a view disposes its subscriptions and pending reads without claiming that an admitted write rolled back.

## Verification boundaries

The [localization tests](../tests/localization.test.ts) exercise catalog contracts, actual-runtime formatting and deterministic controller ordering. The [language surface tests](../tests/language-panel.test.ts) render every locale and verify control labeling, input purpose, notices, focus and preservation of a mixed-script draft. The [storage suite](../tests/storage.test.ts) uses real file-backed SQLite to verify transactions, receipts, stale windows, invalid records and restart; it does not establish Electron execution. [Shared verification](shared-verification.md) owns the common inventory and coverage gates. Packaged native accessibility and complete-page/manual assistive qualification remain separate evidence under the consuming stories’ contracts.

## Check candidate provenance

Use the [snapshot checker](../scripts/localization_qualification.py) with the complete manifest produced by [candidate admission](application-composition.md#freeze-a-verification-candidate). Retain that manifest with its original candidate and source-tree identities; the source Git objects must be available in the checkout. Replace the example absolute manifest path below with the actual retained file.

```bash
python3 scripts/localization_qualification.py /absolute/evidence/interface-candidate.json config/localization/catalog-provenance.json --check
```

The checker binds each locale and the English reference to the frozen hashes and exact original Git blobs. It preserves the recorded generation batches and unknown effective model identities. Its initial-catalog snapshot requires human linguistic review to remain explicitly not performed; recording a later review requires its actual version and scope. Checking provenance does not perform or certify that review.

`--check` rejects stale content and incorrectly typed JSON values while accepting formatting and object-member ordering differences. To create a snapshot, omit `--check` and provide a new output path; an existing output file is never overwritten. The command checks provenance, catalog bytes and source binding. It does not replace full candidate admission, the shared catalog syntax gate or contextual presentation testing.

Record candidate-specific execution results, artifact digests, findings and limitations in the associated issue and retained evidence. Keep reusable procedures in this guide; a passing structural or presentation check does not certify linguistic fluency or accessibility conformance (PRIN-004 and PRIN-007).

[^wcag-input-purposes]: Section 7 lists `language - Preferred language`.

[^understanding-input-purpose]: The Understanding document includes `select` in the term input and scopes the criterion to inputs collecting information about the user; actual autofill is not relevant to the evaluation.

[^html-autofill]: The `language` autofill field name means preferred language with a valid BCP 47 tag; its Text control group includes `select` elements.
