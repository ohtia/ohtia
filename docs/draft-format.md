---
type: Specification
title: "Draft format"
description: "Manuscript Markdown profile with citations, mathematics, tables, figures, cross-references and stable anchors."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: pandoc-manual
    resource: "https://github.com/jgm/pandoc/blob/main/MANUAL.txt"
    title: "Pandoc User's Guide — Markdown extensions"
---

# Draft format

## Scope

This document defines **`ohtia-markdown-v1`**, the manuscript text format edited by the researcher. “Academic Markdown” describes its use; it does not identify a single standard. Ohtia adopts an explicit set of extensions and adds conventions for identity, resources and cross-references.

The [product definition](product-definition.md#manuscript-and-feedback) establishes authorship and the editing and review workflow. [Architecture](architecture.md#opening-writing-and-manuscript-revisions) defines SQLite persistence and revision history, including the actor recorded for each save. Complete project interchange requires a separate serialization contract; this manuscript grammar does not define it. This document defines syntax and meaning; it does not establish that the editor or exporters are implemented.

The examples are illustrative: citekeys, identifiers, image references and figures do not describe real evidence. Abbreviated identifiers in examples show their shape; the application assigns opaque suffixes and preserves their identity during editing.

## Base and supported extensions

The base is Pandoc's `markdown_strict` without `raw_html`, which that base enables by default, extended only with the following extensions. Ohtia's rules below restrict their use; a converter's entire default extension set is not implicitly accepted.

```text
all_symbols_escapable
intraword_underscores
yaml_metadata_block
header_attributes
fenced_divs
bracketed_spans
link_attributes
footnotes
citations
tex_math_dollars
pipe_tables
grid_tables
table_captions
fenced_code_blocks
backtick_code_blocks
fenced_code_attributes
startnum
```

Expressed as a Pandoc input format, the syntax set is:

```text
markdown_strict-raw_html+all_symbols_escapable+intraword_underscores+yaml_metadata_block+header_attributes+fenced_divs+bracketed_spans+link_attributes+footnotes+citations+tex_math_dollars+pipe_tables+grid_tables+table_captions+fenced_code_blocks+backtick_code_blocks+fenced_code_attributes+startnum
```

Without `raw_html`, a tag written in the text, such as `<script>`, is literal text and never HTML. `all_symbols_escapable` allows any ASCII punctuation character to be escaped with `\`: without it, `\$` and `\@` retain the backslash, and a literal at sign before a possible citekey could only be written as an HTML entity. `intraword_underscores` prevents an underscore inside a word, such as `variable_name`, from opening emphasis. The base retains `shortcut_reference_links` and `spaced_reference_links`: without the former, Pandoc does not recognize a narrative citation with a suffix, `@key [p. 42]`. Since v1 does not allow link definitions, those forms never produce links.

Pandoc's manual is the reference for these syntactic extensions. The `ohtia-*` classes and semantics are defined here and require their own interpretation; enabling the extensions in Pandoc does not by itself implement the profile.[^pandoc-manual]

Paragraphs, emphasis, strong emphasis, literal code, block quotations, ordered and unordered lists, links and thematic breaks are supported. Links use inline form, `[text](destination)`; v1 does not allow reference links or link definitions. Headings use `#` through `######`, with a single level-one heading for the title and no skipped levels. A single line break inside a paragraph does not create another paragraph. Explicit line breaks in text use two spaces at the end of a line; they are preserved as content.

## Manuscript header

The manuscript text is UTF-8, uses LF line endings and ends with a newline. It has a single initial YAML block:

```yaml
ohtia_draft_format: ohtia-markdown-v1
ohtia_draft_id: draft_01a14fbd-d779-7014-a580-95cd6274b134
```

Both keys are required; duplicate keys and any other header keys are not allowed in v1. `ohtia_draft_id` stably identifies the manuscript within the project: it is `draft_` followed by the canonical textual representation of the internal draft-record identifier defined in [ADR-0008](adr/adr-0008-uuidv7-entity-identifiers.md). The identifier is not a credential and grants no access.

The save actor, save dates, SQLite revision identities, comments, bibliography and export settings remain in the database. They are not duplicated as editable manuscript metadata. This rule does not remove author names that form part of the text or bibliographic citations.

The manuscript text is not an OKF concept and has no `type` or `status`. Any later project-interchange export must preserve the distinction between the manuscript and metadata describing it.

## Identifiers and blocks

Every identifier definition is unique within the manuscript and follows `prefix_suffix`, with suffixes made of lowercase ASCII letters, digits and hyphens. The prefixes `draft`, `sec`, `blk`, `fig`, `tbl`, `eq` and `fn` are used according to their function, with `res` for resource references. A reference may occur multiple times without duplicating its target definition. Identifiers are not derived from titles, positions or display numbers.

Headings carry their identity in an attribute:

<!-- prettier-ignore -->
```markdown
## Results {#sec_s1}
```

Paragraphs, complete lists, block quotations, code blocks and thematic breaks are individually wrapped in a `Div` with a `blk_*` identifier and the `ohtia-block` class:

<!-- prettier-ignore -->
```markdown
::: {#blk_p1 .ohtia-block}
This paragraph keeps its identity even when moved.
:::
```

The block may contain nested elements belonging to its structure, such as paragraphs in a list. An anchor uses the containing block and the specific passage; it does not require another identifier for each word or list item. Figures, tables and equations have their own containers; headings and notes use their identifiers directly.

Editing or moving a unit preserves its identifier. Duplicating it assigns a new one. When splitting a block, the first part keeps the identifier and the others receive new ones; when merging blocks, the first block's identifier is kept and retired identifiers are recorded. Deleting content does not allow its identifier to be reused for different content.

Comments are stored in the database with the manuscript revision, identifier and examined passage. A position within that passage does not replace those data. Keeping an identifier does not confirm that a comment remains current after an edit; historical reviews are not silently relocated.

## Bibliographic citations

Use the `citations` extension, with citekeys defined by the [bibliography contract](data-model.md#sources). These forms are valid:

<!-- prettier-ignore -->
```markdown
[@garcia2024memoria]
[@garcia2024memoria, p. 42]
[@garcia2024memoria, pp. 42–45; @lopez2023aprendizaje]
@garcia2024memoria [p. 42]
[-@garcia2024memoria, p. 42]
```

The first three are parenthetical citations, the fourth is narrative and the last suppresses the author in the rendered citation. Prefixes, locators and suffixes are preserved according to Pandoc syntax. The citation style determines presentation; the manuscript does not store reference numbers or generated author–year strings in place of structured citations. A literal at sign that could be interpreted as a citation is escaped as `\@`.

Each citekey is resolved within the project. A citation without a resolved entry is preserved and receives a diagnostic; metadata is not invented and it is not considered verified. A delivery record freezes the bibliographic versions used without making `references.bib` a mandatory operational file.

## Footnotes

Use `[^fn_n1]` references and definitions with the same identifier. Definitions are placed at the end of the manuscript, outside other blocks; their physical order does not determine their visible number.

<!-- prettier-ignore -->
```markdown
::: {#blk_p2 .ohtia-block}
The term requires clarification.[^fn_n1]
:::

[^fn_n1]: This note may contain text and citations [@garcia2024memoria].
```

Multiple paragraphs, lists, bibliographic citations and mathematics are allowed within a note, using the `footnotes` extension's indentation. Notes inside notes are not allowed. Each note has one definition and one call in the manuscript; a second call requires another note with its own identity. Numbering is generated in call order and recalculated when content moves. A note without a call or a call without a definition produces a diagnostic.

## Mathematics

Inline mathematics uses `$...$`; display mathematics uses `$$...$$`. A literal dollar sign is escaped as `\$`. Display equations are stored in an identified container:

<!-- prettier-ignore -->
```markdown
::: {#eq_e1 .ohtia-equation}

$$
\bar{x} = \frac{1}{n}\sum_{i=1}^{n}x_i
$$

:::
```

The `ohtia-equation` class denotes a numbered equation. The additional `unnumbered` class permits an unnumbered display equation; it cannot be the target of a numbered cross-reference. The formula and identifier are preserved; its number is calculated by appearance order among the manuscript's numbered equations.

The mathematical syntax supported in v1 includes grouping with braces, subscripts and superscripts, Unicode symbols, literal operators and these commands:

```text
frac dfrac tfrac sqrt binom
sum prod int iint iiint oint lim min max
sin cos tan arcsin arccos arctan sinh cosh tanh log ln exp det Pr
alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta
iota kappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma
tau upsilon phi varphi chi psi omega
Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega
cdot times div pm mp le leq ge geq ne neq approx equiv sim simeq
in notin ni subset subseteq supset supseteq cup cap emptyset
land lor neg forall exists to mapsto leftarrow rightarrow
leftrightarrow Leftarrow Rightarrow Leftrightarrow implies iff
infty partial nabla ell hbar ldots cdots vdots ddots
left right lvert rvert lVert rVert langle rangle
mathrm mathit mathbf mathbb mathcal boldsymbol operatorname text
bar hat tilde vec dot ddot overline underline overbrace underbrace substack
begin end
```

Literal-character escapes and the mathematical spacing commands `\,`, `\:`, `\;`, `\!`, `\quad` and `\qquad` are also allowed. `\begin` and `\end` delimit only the environments `matrix`, `pmatrix`, `bmatrix`, `Bmatrix`, `vmatrix`, `Vmatrix`, `cases`, `aligned` and `gathered`; `&` and `\\` separate cells and rows within those environments. Opening and closing environments must match.

Macro definitions, package loading, file inclusion, layout commands and code execution are not allowed. A command outside the list is preserved as unsupported input with a diagnostic; it is not deleted or silently replaced with an image. Extending the list requires reviewing the profile and its export tests.

## Figures and resources

A figure uses an `ohtia-figure` container with a `fig_*` identifier, an image with alternative text and an explicit caption. The `ohtia-caption` class identifies the caption and does not appear in the visible text:

<!-- prettier-ignore -->
```markdown
::: {#fig_f1 .ohtia-figure}
![Diagram of two connected stages](assets/res_r1.svg)

[Stages of the procedure.]{.ohtia-caption}
:::
```

Alternative text explains the image for access without sight; the caption may include emphasis and citations. They are preserved separately. Figures are numbered in appearance order; the number is not written into the caption. A composite figure remains one resource with a joint description and caption, without inventing subfigure syntax in v1.

Images use relative paths `assets/<identifier>.<extension>`. PNG, JPEG and static SVG are supported; SVG cannot contain scripts or external resources. A reference resolves to immutable retained bytes through the information associated with the manuscript revision and the managed object store. Replacing an image with another version assigns another resource reference; it does not change earlier deliveries.

A standalone manuscript delivery materializes resources at those paths. Base64 images, presigned URLs and absolute host paths are not stored in Markdown. Exporters may generate a compatible image representation when necessary, preserving the original and its provenance; they must declare any loss of visual or accessibility fidelity.

## Tables

Tables carry a `tbl_*` identifier in an `ohtia-table` container and a caption through the `table_captions` extension. Identifiers are placed on the container to avoid depending on additional table-attribute extensions.

Rectangular tables with inline content use `pipe_tables`:

<!-- prettier-ignore -->
```markdown
::: {#tbl_t1 .ohtia-table}

| Group | Participants |
| :---- | -----------: |
| A     |           20 |
| B     |           24 |

: Participants by group.
:::
```

Tables with multiple lines per cell, paragraphs, lists, multiple headers or merged cells use `grid_tables`. A complex table is not converted to an image or stripped of its spans to fit a simple table.

<!-- prettier-ignore -->
```markdown
::: {#tbl_t2 .ohtia-table}
+------------+-----------------------+
| Indicator  | Group                 |
|            +-----------+-----------+
|            | A         | B         |
+============+===========+===========+
| Sample     | 20        | 24        |
+------------+-----------+-----------+

: Sample by group, with a merged header.
:::
```

Preserve headers, order, alignment, cell content and row/column spans. Cells support basic content, footnotes called from cell text, citations and inline mathematics; they do not support another table, figure or display equation. Final width and page splitting belong to the export template. Tables are numbered in appearance order without storing the number inside the caption.

## Cross-references

A cross-reference uses a link to the identifier and the `ohtia-ref` class:

<!-- prettier-ignore -->
```markdown
[Section](#sec_s1){.ohtia-ref}
[Figure](#fig_f1){.ohtia-ref}
[Table](#tbl_t1){.ohtia-ref}
[Equation](#eq_e1){.ohtia-ref}
```

The target prefix determines the reference type. The link text is a readable fallback label; the editor and exporter generate the current label and number, such as “Figure 2”, without making that number part of identity. An internal link without the class preserves its literal text and does not request automatic numbering.

Level-two sections are numbered consecutively; lower levels add their ordinal to their parent's numbering. The level-one title is not numbered: a reference to it uses its text. Figures, tables and equations have independent sequences across the manuscript. Notes follow their own call-order sequence. The template determines label presentation and language while preserving this correspondence.

Moving a target updates its references' presentation. Deleting it leaves pending references with a diagnostic, never a link relocated to a different element because it shares the old number. `@fig...` is not used for cross-references: `@` is reserved for bibliographic citations.

## Classes, attributes and unsupported content

The profile allows only the classes `ohtia-block`, `ohtia-figure`, `ohtia-caption`, `ohtia-table`, `ohtia-equation`, `ohtia-ref` and `unnumbered` in the contexts defined above. Code-block language labels are the exception and describe literal text that is never executed. Identity attributes are restricted to `id`; v1 does not allow arbitrary style, script or exporter attributes.

External links use `https`, `http` or `mailto` and are not downloaded or executed by opening or exporting the manuscript. Images resolve exclusively through the manuscript's logical resource paths. Raw HTML or LaTeX outside formulas, HTML comments, iframes, macros, includes, widgets, executable content and CSS styles are not allowed. Tags written in text are preserved and presented as literal text. A link to another project grants no access and incorporates none of its content.

Supervisor reviews, Ohtia comments and their states are not encoded as strikethrough, colors or hidden annotations in the manuscript. They live in the database with their anchors, provenance and revision. A file returned by the supervisor is preserved as an external original.

## Save, evolution and fidelity

The serializer preserves identifiers, block order, citation and reference structure, formulas, notes, resources and literal content. It does not silently normalize the researcher's prose. Whitespace changes that express only Markdown formatting cannot change explicit line breaks, code, equations or textual meaning. Bibliographic citations and cross-references are not converted to generated text when saving.

The editor's intermediate model must preserve original identities as well as visible structure. In particular, converting `[^fn_n1]` to `[^1]` on save violates note identity even if presentation is equivalent. A parser or serializer that discards that information requires an adapter that preserves it; syntactic compatibility alone is insufficient.

The editor offers only structures representable in this profile. An import containing unsupported elements preserves its original and presents a locatable diagnostic; it does not declare success after discarding content. A serialization error is not presented as a successful save, and input is preserved for recovery.

Existing revisions retain the `ohtia-markdown-v1` identifier. Changing syntax, meaning or supported elements requires another profile version and an explicit migration creating a new manuscript revision. Migration does not modify historical deliveries or imply a new human review.

## Fidelity and validation

The implementation must check these cases; listing them does not mean product tests already exist:

1. **Header and identity:** reject an unknown format version, duplicate YAML, manuscript mismatch or repeated identifiers; do not confuse the manuscript identifier with access permission.
2. **Structure:** recognize the enumerated extensions and only the allowed classes and attributes; treat HTML tags as literal text, reject reference links and preserve escaped characters; preserve order, levels and addressable units through editor → Markdown → editor.
3. **Citations:** preserve mode, citekey, locator, prefix and suffix; report unresolved references without fabricating a bibliography and preserve a delivery's bibliographic versions.
4. **Notes:** preserve content and identity, recalculate numbering when a call moves and report unmatched calls or definitions.
5. **Mathematics:** preserve original formulas and check fractions, indices, matrices, cases and aligned expressions on screen, in DOCX and in PDF. An unconverted symbol or construct must produce a diagnostic instead of silently disappearing.
6. **Figures and tables:** resolve exact resources and preserve description, caption, citations, merged cells, headers and alignment on save, reopen and export. Check visual fidelity as well as structural fidelity.
7. **Cross-references:** rename or move a target without losing the link; update numbers and report a deleted, unknown or incompatible target.
8. **Comments:** preserve revision, block and passage after a new edit without presenting old observations as current reviews. Duplication, splitting and merging obey the identity rules.
9. **Portability:** generate readable manuscript text, its selected resources and bibliography from an identified revision. Transferring complete project history and knowledge requires the separately defined interchange contract. A generic Markdown reader may show extensions as syntax; complete interpretation outside a profile consumer is not promised.
10. **Export:** the result declares elements it could not represent. A delivery is not presented as faithful when elements are missing; preserve content and the limitations report so the issue can be resolved.

The selected editor, parser and exporters must demonstrate these criteria on representative documents. A Markdown parser alone does not verify citations, permissions, resources, numbering, authorship or DOCX/PDF fidelity.

[^pandoc-manual]: Pandoc User's Guide: Markdown extensions for citations, notes, mathematics, tables, attributes, blocks and spans. The `ohtia-*` identity and semantics belong to this profile.
