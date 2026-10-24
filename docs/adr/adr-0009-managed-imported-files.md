---
type: DecisionRecord
title: "ADR-0009 — Ohtia-managed copies of imported files"
description: "Store imported bytes under objects/ using a two-character SHA-256 prefix and the complete lowercase digest."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0009 — Ohtia-managed copies of imported files

## Context

An acquisition filename can contain spaces, accents, script-specific characters or OS-specific path syntax, and the researcher can later move or delete that original. Ohtia must retain the imported bytes independently of their acquisition path. Using original names also introduces collisions; using a random name alone does not identify duplicate bytes.

## Decision

### Exact object name and path

Compute SHA-256 over the complete, unmodified imported byte stream, before OCR, extraction, decoding or other conversion. Encode the digest as exactly 64 lowercase hexadecimal characters, without an algorithm prefix, separator or filename extension. This value is `assets.content_hash`.

The object key is derived, not independently editable:

```text
hash       = SHA256(original_bytes).hex_lowercase()
object_key = hash[0:2] + "/" + hash
path       = <ohtia-data>/objects/<hash[0:2]>/<hash>
```

There is exactly one two-character shard directory and then the complete digest, including those same first two characters. No source title, citekey, asset UUID, original filename or extension is appended. For example:

```text
objects/ab/ab412b53c76ceb68082a8d00d8eae0488632f70a06cee9245df0e2e386f9a366
```

The example is a SHA-256 digest of synthetic bytes, not a private research object. The asset's UUID identifies its database record; the digest identifies its retained bytes. A change of bytes produces a different hash/path.

Store the digest, verified byte length and detected media type in `assets`. Derive `object_key` from the digest rather than storing a second editable path or any absolute path. Original display filenames are acquisition metadata, independent of the deduplicated bytes; they never determine the object path.

### Native paths and access

The logical key uses `/`. Resolve its validated hexadecimal components with native path APIs on Windows, macOS and Linux under the configured `objects` root. The root may contain Unicode. Reject invalid digest lengths/characters, an inconsistent prefix, absolute paths and traversal. Do not accept caller-supplied filesystem paths as an object key or follow a managed-directory symlink outside the root.

Read the selected original through native file APIs without manually rewriting Unicode normalization or interpolating its name into a shell. Open the retained object through its asset identity. `sources.asset_id` identifies the retained original; extracted/corrected text is reached through `source_contents.source_id`.

### Import, reuse and failure

1. Copy into `<ohtia-data>/scratch/imports/<import-id>.part`, where `import-id` is an application-generated UUID. Hash/count the bytes during the copy; verify the completed file before publication. An interrupted or changing input cannot be reported as a complete retained copy.
2. Serialize installation through the trusted broker's object-write boundary. Create the two-character destination directory. If the final object already exists, verify its digest, size and byte equality before reusing it; a mismatch is an integrity failure and cannot be resolved by overwriting it or inventing a suffix.
3. Otherwise flush the completed temporary file and atomically rename it into its final same-filesystem path, with the required directory durability operations for the supported filesystem. Never fall back silently to an unverified cross-filesystem copy. The supported platform/filesystem must demonstrate these primitives before enabling imports.
4. Commit the asset reference only after durable object installation. Repeated delivery of the same import command returns its receipt. A crash can leave an unreferenced object, not a confirmed reference to a half-written file.
5. Remove incomplete temporary files only when their import is no longer active. Object cleanup checks every live/historical reference and every retained pre-migration checkpoint before removal.

Byte deduplication never merges source identity, provenance, restrictions or review. The database and retained originals remain outside an agent's general filesystem access. Explicit external references do not claim that bytes were retained.

## Consequences

The exact key can be reconstructed from one stored digest and remains independent of the original filename and OS separator. Import requires disk space, streaming verification, serialized publication and orphan reconciliation. Test accented/non-Latin/combining names, spaces, Unicode roots, duplicate names/bytes, changed inputs, crash points, permission/disk failures, traversal and mismatched existing objects. Export display names follow a separate delivery contract; Ohtia's internal keys do not replace user-facing titles.
