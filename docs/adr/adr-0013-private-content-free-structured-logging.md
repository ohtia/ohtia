---
type: DecisionRecord
title: "ADR-0013 — Structured diagnostics without research content"
description: "Define a versioned local JSONL diagnostic format mapped to OpenTelemetry, with privacy controls and bounded file retention."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: otel-logs
    resource: "https://opentelemetry.io/docs/specs/otel/logs/data-model/"
    title: "OpenTelemetry — Logs Data Model"
  - id: syslog
    resource: "https://www.rfc-editor.org/rfc/rfc5424.html"
    title: "RFC 5424 — The Syslog Protocol"
  - id: logging-security
    resource: "https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html"
    title: "OWASP — Logging Cheat Sheet"
---

# ADR-0013 — Structured diagnostics without research content

## Context

Debugging saves and agent attempts needs correlation, but dumping requests or exceptions makes another copy of private research. Redacting arbitrary strings after capture cannot reliably identify every private title, passage or credential.

A JSON object alone does not define severity, time, correlation or event compatibility. Choose an explicit application profile mapped to the stable OpenTelemetry Logs Data Model.[^otel-logs] RFC 5424 defines a syslog message/transport framework and explicitly leaves storage formats outside its scope.[^syslog] The chosen local profile keeps the same file contract across supported desktop systems; OS log services are not its storage authority. Full OTLP serialization would require its own encoding/envelope contract, beyond this application profile.

## Decision

Emit structured JSON events from named schemas: component, controlled operation/error code, opaque correlation, duration and outcome. Include entity IDs only when needed with bounded access/retention. Exclude corpus/draft text, private titles and filenames, research queries, prompts, responses, tool arguments, attachments, credentials, authorization headers, signed URLs, SQL parameter values and free-form exception representations.

Apply the policy to logs, traces, metrics, crash reports and SDK/ORM/runtime automatic capture. Translate untrusted errors into controlled diagnostic codes. Additional redaction does not enlarge the allowlist. Private manifests, analysis provenance and human decisions belong in the scoped research store, not telemetry.

### Record format and OpenTelemetry mapping

Use profile `ohtia-log-v1`: compact UTF-8 JSON objects, one object followed by one LF byte per record, without a byte-order mark, duplicate keys or blank records. Escape newlines inside string values. JSON key order carries no meaning. A pretty-printed example below is for reading; the writer serializes it on one line. This is Ohtia's local serialization with a defined OpenTelemetry mapping, not an OTLP payload.

The complete top-level field allowlist is:

- `schema_version`: required integer `1`, identifying this exact record contract.
- `timestamp`: optional event time, formatted as UTC `YYYY-MM-DDTHH:mm:ss.SSSZ`, from the emitting application component's clock. Omit it when that time is unknown; never substitute receipt time as an invented event time.
- `observed_timestamp`: required time at which the broker receives the event, in the same UTC format. For broker-originated events it can equal `timestamp`. Wall-clock corrections can reorder these values; record order is writer order, not proof of causal order.
- `severity_text` and `severity_number`: both required, using exactly one matching pair: `DEBUG`/`5`, `INFO`/`9`, `WARN`/`13`, `ERROR`/`17` or `FATAL`/`21`. These numbers follow OpenTelemetry's base values for the selected levels.[^otel-logs] The default output threshold is `INFO`; enabling `DEBUG` never changes the privacy allowlist.
- `event_name`: required identifier from a code-owned typed event catalog, with dot-separated lowercase segments under `ohtia.`, such as `ohtia.storage.open_failed`. Each name identifies one event structure; input text and provider error messages cannot become event names.
- `resource`: required object containing exactly `service.name: "ohtia"` and `service.version`, the nonempty version declared by the running application artifact. The broker supplies these trusted values. Do not add hostnames, account names, home directories or device fingerprints.
- `attributes`: required object using the closed catalog below, narrowed further by the named event's schema.

Map `timestamp` to OpenTelemetry `Timestamp` and `observed_timestamp` to `ObservedTimestamp`, converting the millisecond instants to its Unix nanosecond representation without inventing extra precision. Map the severity pair, `event_name`, `resource` and `attributes` to `SeverityText`/`SeverityNumber`, `EventName`, `Resource` and `Attributes`. On conversion, preserve the local profile version as `Attributes["ohtia.log.schema_version"]`. Ohtia's custom attributes remain explicitly application-owned; they are not advertised as OpenTelemetry semantic conventions. The optional OpenTelemetry `Body` is omitted to preserve the closed diagnostic schema.[^otel-logs]

The complete attribute catalog for this profile is:

- `ohtia.component`: required controlled component identifier, such as `data_service`; the event catalog owns the permitted values.
- `ohtia.operation`: required controlled operation identifier, such as `storage.open`.
- `ohtia.outcome`: required value from `success`, `failure`, `cancelled` or `uncertain`; a cancellation request or lost response cannot establish a confirmed outcome.
- `ohtia.error.code`: optional controlled error code, required for a failure event. Map external errors into this catalog without copying their messages.
- `ohtia.duration_ms`: optional finite, nonnegative number of milliseconds, measured with the applicable monotonic clock. Omit an unavailable measurement instead of substituting zero.
- `ohtia.correlation.id`: optional opaque UUID generated by the trusted application and carried across events of the same operation.
- `ohtia.task.id` and `ohtia.attempt.id`: optional validated entity UUIDs, allowed only in the task-related events that declare them necessary. An attempt ID requires its associated task ID, both resolved from trusted state.

Correlation UUIDs map to custom attributes; they are not OpenTelemetry trace/span IDs. This profile creates no fictitious tracing context. Every value remains subject to the privacy rule, even when it passes its primitive type check.

Synthetic storage-error example, with illustrative time and artifact version:

```json
{
  "schema_version": 1,
  "timestamp": "2000-01-01T00:00:00.000Z",
  "observed_timestamp": "2000-01-01T00:00:00.001Z",
  "severity_text": "ERROR",
  "severity_number": 17,
  "event_name": "ohtia.storage.open_failed",
  "resource": {
    "service.name": "ohtia",
    "service.version": "0.0.0-example"
  },
  "attributes": {
    "ohtia.component": "data_service",
    "ohtia.operation": "storage.open",
    "ohtia.outcome": "failure",
    "ohtia.error.code": "storage_unavailable",
    "ohtia.duration_ms": 5
  }
}
```

### Typed events and compatibility

Implement one code-owned, runtime-validated event catalog at the trusted logging boundary. Each event declares its allowed component/operation, severity, outcome, required/optional attributes and controlled error codes. Validate cross-field rules as well as primitive types; a generic `Record<string, unknown>`, arbitrary `message`, exception object, nested metadata bag or JSON serialization fallback cannot bypass that catalog. Do not spread SDK/ORM errors into an event. Privacy and log-injection checks follow OWASP guidance.[^logging-security]

Reject undeclared events/fields, invalid UUIDs/timestamps, mismatched severity pairs, invalid durations, non-finite JSON numbers and invalid event combinations before writing. Report only a fixed diagnostic code/counter for rejected records, never their input or thrown exception text; suppress recursive diagnostics if the logger itself fails. Validate events from child processes as untrusted messages and attach broker-owned metadata rather than accepting claimed trusted identity.

Version the complete file contract through `schema_version`. An incompatible field, meaning or event-schema change requires a new version and an explicit reader/mapping update. Additions to controlled event/value catalogs require their schema, privacy review and verification together. Retained records keep their original version; upgrades do not rewrite old logs. Readers use a supported version's decoder and show a bounded unsupported/invalid-record diagnostic when necessary, without exposing arbitrary raw payloads. Exports include only records validated by a supported schema. OpenTelemetry mapping preserves timestamps, severity and permitted attributes; any later OTLP exporter must separately demonstrate protocol conformance.

### Local files and rotation

The trusted application broker owns a single structured diagnostic writer under `<ohtia-data>/logs/`. Store UTF-8 JSON Lines: one complete JSON event per line in `ohtia.jsonl`. Workers and other components submit validated events to that writer; they do not independently append or rotate files. These diagnostic files are separate from the research database and its task/history records.

Use fixed application constants of **5 MiB per file** (`5 * 1024 * 1024` bytes) and **five files in total**: the active `ohtia.jsonl` plus `ohtia.1.jsonl` through `ohtia.4.jsonl`, newest archive first. The maximum retained log payload is **25 MiB**. These constants are not user preferences. Retention is determined by size and archive count.

Before appending an event whose encoded bytes and newline would exceed the active file's limit, close the active file, remove the oldest archive if present, shift the retained archive names and rename the active file to `ohtia.1.jsonl`. Create a new active file and append the complete event. Serialize append, rotation and deletion. Never split an event across files or create an extra retained archive. Reject an event larger than the file limit and emit only a bounded controlled diagnostic, without copying its rejected payload. After an interrupted write, discard an incomplete final line before further appends; readers present only complete valid events.

Restrict directory/file access to the current OS account using the supported platform mechanisms. A write, rotation or deletion failure produces a controlled diagnostic status for the interface; do not bypass the retention bound or fall back to dumping content elsewhere. Logging failure must not crash the application or prevent research saves. Startup reconciles the known managed filenames and bounds before normal diagnostic writing resumes.

### Inspection, deletion and sharing

[Frontend architecture](../frontend-architecture.md#diagnostics) defines **Settings → Diagnostics**, with **View logs** and **Delete logs** actions. The read-only viewer can inspect the active file and retained archives through named broker operations; it does not expose arbitrary filesystem paths or render event values as executable markup.

Delete logs requires explicit user confirmation. The broker serializes the operation with the writer, closes its active handle, deletes the managed active/archive files and creates a new active file for subsequent events. Report partial deletion or failure accurately. Deletion affects diagnostic logs only; it leaves research content, revisions, provenance and task/attempt receipts intact. It removes Ohtia's retained files without promising forensic erasure or deletion of copies previously shared by the user.

Keep diagnostics local by default. Sharing a diagnostic bundle is an explicit reviewed user action that previews its scope; it is not a hidden analytics path. Apply the same field allowlist to the viewer and any exported bundle.

## Consequences

Some incidents require synthetic reproduction instead of enabling full logs. Test sensitive markers through successful and failed paths, process stderr, SDK traces, the viewer and exported diagnostic bundles. Verify byte limits with multibyte UTF-8 events, exact-boundary rotation, the five-file bound, interrupted writes/rotation, concurrent append/delete, access restrictions, disk failures and deletion without changes to research history. Verify the event catalog, cross-field constraints, matching severity pairs, timestamps/unknown time, OpenTelemetry mapping, schema-version decoding, invalid SDK records and absence of duplicate output. Check that secrets placed in every rejected field, exception message and automatic-capture path never reach files, stdout/stderr, the viewer or exports. Treat schema changes as privacy changes. No event or automatic reporter sends research to an external analytics service by default.

[^otel-logs]: OpenTelemetry defines the common log fields, severity ranges and event naming semantics; Ohtia selects the local serialization and its restricted attribute catalog.

[^syslog]: RFC 5424 specifies the syslog protocol and message structure, and excludes an on-disk storage format from its scope.

[^logging-security]: OWASP covers event selection, exclusion of sensitive data, validation, log injection and verification of logging failures.
