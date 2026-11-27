import { describe, expect, it } from "vitest";
import {
  manuscriptFormat,
  manuscriptLimits,
  type CanonicalManuscript,
  type ManuscriptParagraph,
  type ManuscriptResult,
} from "@ohtia/contracts";
import { parseManuscript, serializeManuscript } from "../packages/utility/src/manuscript.js";

const draftId = "01a14fbd-d779-7014-a580-95cd6274b134";
const foreign = "01a14fbd-d779-7014-b580-95cd6274b134";
const identity = { draftId };
const header =
  "---\nohtia_draft_format: ohtia-markdown-v1\nohtia_draft_id: draft_" + draftId + "\n---\n";

function wrapped(id: string, raw: string): string {
  return `\n::: {#${id} .ohtia-block}\n${raw}\n:::\n`;
}

function paragraph(id: string, text: string): ManuscriptParagraph {
  return { id, lines: [{ text, breakAfter: null }] };
}

function manuscript(
  paragraphs: readonly ManuscriptParagraph[] = [],
  title: CanonicalManuscript["title"] = null,
): CanonicalManuscript {
  return { format: manuscriptFormat, draftId, title, paragraphs };
}

function value<T>(result: ManuscriptResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostic));
  return result.value;
}

function roundTrip(ast: CanonicalManuscript): string {
  const serialized = value(serializeManuscript(ast, identity));
  expect(value(parseManuscript(serialized, identity))).toEqual(ast);
  expect(value(serializeManuscript(value(parseManuscript(serialized, identity)), identity))).toBe(
    serialized,
  );
  return serialized;
}

function bytes(raw: string): number {
  return Buffer.byteLength(raw);
}

function generator(seed: number) {
  return (length: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % length;
  };
}

describe("canonical manuscript codec", () => {
  it("round-trips the exact empty and title-only wire fixtures", () => {
    expect(value(parseManuscript(Buffer.from(header), identity))).toEqual(manuscript());
    expect(roundTrip(manuscript())).toBe(header);
    const ast = manuscript([], { id: "sec_main", text: "Memoria — 연구" });
    expect(roundTrip(ast)).toBe(header + "\n# Memoria — 연구 {#sec_main}\n");
    for (const [text, encoded] of [
      ["##", "\\#\\#"],
      ["C#", "C\\#"],
      ["A ##", "A \\#\\#"],
      ["A\\#", "A\\\\\\#"],
    ]) {
      expect(roundTrip(manuscript([], { id: "sec_hash", text: text! }))).toBe(
        header + "\n# " + encoded + " {#sec_hash}\n",
      );
    }
  });

  it("keeps IDs, order, Unicode, literal punctuation and both kinds of break", () => {
    const raw =
      header +
      "\n# Écriture {#sec_title}\n" +
      wrapped(
        "blk_z",
        "Café e\u0301 🧪 <script> variable_name 2 * 3\n" +
          String.raw`\*literal\*, \[texto](local), \$20, \@clave, \\` +
          "  \n最後",
      ) +
      wrapped("blk_a", "One  sentence.");
    const ast = manuscript(
      [
        {
          id: "blk_z",
          lines: [
            { text: "Café e\u0301 🧪 <script> variable_name 2 * 3", breakAfter: "soft" },
            { text: "*literal*, [texto](local), $20, @clave, \\", breakAfter: "hard" },
            { text: "最後", breakAfter: null },
          ],
        },
        paragraph("blk_a", "One  sentence."),
      ],
      { id: "sec_title", text: "Écriture" },
    );
    expect(value(parseManuscript(raw, identity))).toEqual(ast);
    expect(roundTrip(ast)).toBe(raw);
    expect(
      roundTrip(
        manuscript([
          {
            id: "blk_p",
            lines: [
              { text: "Text", breakAfter: "soft" },
              { text: "=", breakAfter: null },
            ],
          },
        ]),
      ),
    ).toBe(header + wrapped("blk_p", "Text\n\\="));
    for (const [lines, escaped] of [
      [["a|b", "-|-", "x|y"], "a|b\n\\-|-\nx|y"],
      [["a|b", "-:|:-"], "a|b\n\\-:|:-"],
      [["a *", "b *"], "a \\*\nb \\*"],
      [["x\u00a0*\u00a0y * z"], "x\u00a0\\*\u00a0y * z"],
    ] as const) {
      const literal = manuscript([
        {
          id: "blk_p",
          lines: lines.map((text, index) => ({
            text,
            breakAfter: index === lines.length - 1 ? null : "soft",
          })),
        },
      ]);
      expect(roundTrip(literal)).toBe(header + wrapped("blk_p", escaped));
      expect(parseManuscript(header + wrapped("blk_p", lines.join("\n")), identity)).toMatchObject({
        diagnostic: { code: "unsupported-construct" },
      });
    }
    const escaped = header + wrapped("blk_a", String.raw`\!` + " Hello.");
    expect(value(parseManuscript(escaped, identity))).toEqual(
      manuscript([paragraph("blk_a", "! Hello.")]),
    );
    expect(value(serializeManuscript(value(parseManuscript(escaped, identity)), identity))).toBe(
      header + wrapped("blk_a", "! Hello."),
    );
  });

  it("omits empty UI paragraphs and leaves their supplied identities untouched", () => {
    const blank = Object.freeze({ id: "blk_placeholder", lines: Object.freeze([]) });
    const real = paragraph("blk_real", "Researcher's text.");
    const input = Object.freeze(manuscript(Object.freeze([blank, real])));
    expect(value(serializeManuscript(input, identity))).toBe(
      header + wrapped("blk_real", "Researcher's text."),
    );
    expect(input.paragraphs[0]).toBe(blank);
    expect(value(serializeManuscript(manuscript([blank]), identity))).toBe(header);
    expect(serializeManuscript(manuscript([blank, blank]), identity)).toMatchObject({
      diagnostic: { code: "duplicate-id" },
    });
  });

  it("rejects corrupt, ambiguous and foreign metadata with bounded locations", () => {
    const cases = [
      ["\ufeff" + header, "invalid-header", 1],
      ["", "invalid-header", 1],
      [header.replace("ohtia_draft_format:", "unknown:"), "invalid-header", 2],
      [header.replace(manuscriptFormat, "ohtia-markdown-v2"), "invalid-version", 2],
      [header.replace(manuscriptFormat, '"ohtia-markdown-v1"'), "invalid-header", 2],
      [header.replace("ohtia_draft_id", "ohtia_draft_format"), "invalid-header", 3],
      [header.replace(draftId, draftId.toUpperCase()), "invalid-id", 3],
      [header.replace(draftId, draftId.replace("-7", "-4")), "invalid-id", 3],
      [header.replace(draftId, draftId.replace("-a580", "-c580")), "invalid-id", 3],
      [header.replace(draftId, foreign), "foreign-draft", 3],
      [header.replace(/---\n$/, "title: Other\n---\n"), "invalid-header", 4],
      [header + header, "invalid-header", 5],
      [header + "\n" + header, "invalid-header", 6],
      ["---\n", "invalid-header", 2],
    ] as const;
    for (const [wire, code, number] of cases) {
      expect(parseManuscript(wire, identity), wire).toEqual({
        ok: false,
        diagnostic: { code, location: { kind: "line", number } },
      });
    }
  });

  it("rejects wrong, repeated and unavailable unit IDs without replacing them", () => {
    expect(parseManuscript(header + "\n# Title {#blk_bad}\n", identity)).toMatchObject({
      diagnostic: { code: "invalid-id" },
    });
    expect(parseManuscript(header + wrapped("blk_UPPER", "One"), identity)).toMatchObject({
      diagnostic: { code: "invalid-id" },
    });
    expect(parseManuscript(header + wrapped("blk_", "One"), identity)).toMatchObject({
      diagnostic: { code: "invalid-id" },
    });
    expect(parseManuscript(header + wrapped("sec_wrong", "One"), identity)).toMatchObject({
      diagnostic: { code: "invalid-id" },
    });
    const duplicate = header + wrapped("blk_used", "First") + wrapped("blk_used", "Second");
    expect(parseManuscript(duplicate, identity)).toMatchObject({
      diagnostic: { code: "duplicate-id", location: { kind: "line", number: 10 } },
    });
    const ast = manuscript([paragraph("blk_old", "Retired")], { id: "sec_taken", text: "Title" });
    for (const id of ["blk_old", "sec_taken"]) {
      const policy = { ...identity, unavailableIds: new Set([id]) };
      const raw = roundTrip(ast);
      expect(parseManuscript(raw, policy)).toMatchObject({
        diagnostic: { code: "unavailable-id", location: { kind: "line" } },
      });
      expect(serializeManuscript(ast, policy)).toMatchObject({
        diagnostic: { code: "unavailable-id" },
      });
    }
    expect(serializeManuscript({ ...ast, draftId: foreign }, identity)).toMatchObject({
      diagnostic: { code: "foreign-draft" },
    });
  });

  it("keeps chapter and subsection identities in the original manuscript order", () => {
    const source =
      header +
      "\n## Introduction {#sec_intro}\n" +
      wrapped("blk_intro", "Introductory text") +
      "\n## Methodology {#sec_method}\n" +
      "\n### Sample {#sec_sample}\n" +
      wrapped("blk_method", "Method text") +
      "\n## Results {#sec_results}\n";
    const parsed = parseManuscript(Buffer.from(source), identity);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sections).toEqual([
      { id: "sec_intro", text: "Introduction", level: 2, beforeParagraph: 0 },
      { id: "sec_method", text: "Methodology", level: 2, beforeParagraph: 1 },
      { id: "sec_sample", text: "Sample", level: 3, beforeParagraph: 1 },
      { id: "sec_results", text: "Results", level: 2, beforeParagraph: 2 },
    ]);
    expect(serializeManuscript(parsed.value, identity)).toEqual({ ok: true, value: source });
    expect(
      parseManuscript(Buffer.from(source.replace("sec_results", "sec_intro")), identity),
    ).toMatchObject({ diagnostic: { code: "duplicate-id" } });
  });

  it("returns a single content-free refusal for unsupported syntax and preserves original bytes", () => {
    const bodies = [
      "*emphasis*",
      "**strong**",
      "_emphasis_",
      "[link](https://example.test)",
      "[@citation]",
      "@narrative",
      "[^note]",
      "$x$",
      "`code`",
      "```\ncode\n```",
      "![image](local.png)",
      "<!-- comment -->",
      "<https://example.test>",
      "&amp;",
      "word {#other}",
      String.raw`\alpha`,
      "line\\",
      "# Nested",
      "> Quote",
      "- List",
      "2. List",
      "one\n---",
      "one\n===",
      "one\n=",
      "one\n-",
      "one\n| two |",
      "+---+---+",
      "::: {.nested}\nInner\n:::",
      "A\n\nB",
      "",
      " A",
      "A ",
      "A  ",
      "A   \nB",
    ];
    for (const body of bodies) {
      const raw = Buffer.from(header + wrapped("blk_p", body));
      const original = Buffer.from(raw);
      const result = parseManuscript(raw, identity);
      expect(result, body).toEqual({
        ok: false,
        diagnostic: {
          code: "unsupported-construct",
          location: { kind: "line", number: expect.any(Number) },
        },
      });
      expect(raw).toEqual(original);
    }
    for (const tail of [
      "\nUnwrapped\n",
      "\n### Skipped level {#sec_a}\n",
      "\n# No ID\n",
      "\n#  {#sec_a}\n",
      "\n# Title # {#sec_a}\n",
      "\n# C# {#sec_a}\n",
      "\n# C\\## {#sec_a}\n",
      "\n# C\\\\# {#sec_a}\n",
      "\n# *Emphasis* {#sec_a}\n",
      "\n# A {#sec_a}\n\n# B {#sec_b}\n",
      "\n::: {#blk_a .other}\nA\n:::\n",
      "\n::: {#blk_a .ohtia-block}\nUnclosed\n",
      "\n",
      "\n\n" + wrapped("blk_a", "One"),
      wrapped("blk_a", "No separator").slice(1),
    ]) {
      expect(parseManuscript(header + tail, identity), tail).toMatchObject({
        diagnostic: { code: "unsupported-construct" },
      });
    }
  });

  it("rejects invalid UTF-8, invalid scalars, CRLF, controls and missing final LF", () => {
    const first = parseManuscript(header.slice(0, -1), identity);
    if (first.ok) throw new Error("Expected a refusal.");
    Object.assign(first.diagnostic.location, { kind: "line", number: 99 });
    for (const wire of [
      Buffer.concat([Buffer.from(header), Buffer.from([0xc0, 0xaf, 0x0a])]),
      header + wrapped("blk_p", "text \ud800"),
      header + wrapped("blk_p", "text \u0000"),
      header + wrapped("blk_p", "A\tB"),
      header.replaceAll("\n", "\r\n"),
      header.slice(0, -1),
    ]) {
      expect(parseManuscript(wire, identity)).toEqual({
        ok: false,
        diagnostic: { code: "invalid-text", location: { kind: "document" } },
      });
    }
  });

  it("validates working AST shape, break placement and representability at runtime", () => {
    const empty = manuscript();
    const accessor = {
      ...empty,
      get title() {
        throw new Error("unexpected getter");
      },
    };
    const sparse = new Array<ManuscriptParagraph>(1);
    for (const input of [
      null,
      [],
      accessor,
      Object.create(empty),
      { ...empty, unrelated: true },
      { ...empty, title: { id: "sec_a", text: 1 } },
      { ...empty, title: "" },
      { ...empty, paragraphs: "" },
      { ...empty, paragraphs: sparse },
      { ...empty, paragraphs: [{ id: "blk_p", lines: false }] },
      { ...empty, paragraphs: [{ id: "blk_p", lines: [null] }] },
      { ...empty, paragraphs: [{ id: "blk_p", lines: [{ text: "A", breakAfter: "hard" }] }] },
      {
        ...empty,
        paragraphs: [
          {
            id: "blk_p",
            lines: [
              { text: "A", breakAfter: null },
              { text: "B", breakAfter: null },
            ],
          },
        ],
      },
      manuscript([paragraph("blk_p", "")]),
    ]) {
      expect(serializeManuscript(input, identity)).toMatchObject({
        diagnostic: { code: "invalid-ast" },
      });
    }
    expect(serializeManuscript({ ...empty, format: 2 }, identity)).toMatchObject({
      diagnostic: { code: "invalid-version" },
    });
    expect(serializeManuscript({ ...empty, draftId: "not-an-id" }, identity)).toMatchObject({
      diagnostic: { code: "invalid-id" },
    });
    for (const text of ["A\udfff", "A\nB", "A\tB"]) {
      expect(serializeManuscript(manuscript([paragraph("blk_p", text)]), identity)).toMatchObject({
        diagnostic: { code: "invalid-text" },
      });
    }
    for (const text of [" A", "A "]) {
      expect(serializeManuscript(manuscript([paragraph("blk_p", text)]), identity)).toMatchObject({
        diagnostic: { code: "unsupported-construct" },
      });
    }
  });

  it("enforces exact UTF-8 title and paragraph bounds including escapes and breaks", () => {
    const limit = manuscriptLimits.textBytes;
    const title = (text: string) => manuscript([], { id: "sec_t", text });
    const astral = "🧪".repeat(limit / 4);
    roundTrip(title(astral));
    for (const raw of [astral + "a", "a".repeat(limit + 1)]) {
      expect(parseManuscript(header + `\n# ${raw} {#sec_t}\n`, identity)).toMatchObject({
        diagnostic: { code: "text-limit" },
      });
      expect(serializeManuscript(title(raw), identity)).toMatchObject({
        diagnostic: { code: "text-limit" },
      });
      expect(parseManuscript(header + wrapped("blk_p", raw), identity)).toMatchObject({
        diagnostic: { code: "text-limit" },
      });
    }
    roundTrip(title("a".repeat(limit - 2) + "*"));
    expect(serializeManuscript(title("a".repeat(limit - 1) + "*"), identity)).toMatchObject({
      diagnostic: { code: "text-limit" },
    });
    const byteFixture = (last: string) =>
      manuscript([
        {
          id: "blk_p",
          lines: [
            { text: "é".repeat((limit - 4) / 2), breakAfter: "hard" },
            { text: last, breakAfter: null },
          ],
        },
      ]);
    const raw = roundTrip(byteFixture("a"));
    expect(bytes(raw) - bytes(header + wrapped("blk_p", ""))).toBe(limit);
    const over = raw.replace("\na\n:::", "\na!\n:::");
    expect(parseManuscript(over, identity)).toMatchObject({ diagnostic: { code: "text-limit" } });
    expect(serializeManuscript(byteFixture("a!"), identity)).toMatchObject({
      diagnostic: { code: "text-limit" },
    });

    const maxLines = Array.from({ length: limit / 2 }, (_, index) =>
      index === limit / 2 - 1
        ? ({ text: "xy", breakAfter: null } as const)
        : ({ text: "x", breakAfter: "soft" } as const),
    );
    roundTrip(manuscript([{ id: "blk_many", lines: maxLines }]));
    expect(
      serializeManuscript(
        manuscript([
          {
            id: "blk_many",
            lines: [...maxLines, { text: "x", breakAfter: null }],
          },
        ]),
        identity,
      ),
    ).toMatchObject({ diagnostic: { code: "text-limit" } });
  });

  it("enforces exact document and paragraph count limits in both directions", () => {
    const full = Array.from({ length: 15 }, (_, index) =>
      paragraph(`blk_${index}`, "é".repeat(manuscriptLimits.textBytes / 2)),
    );
    const wire = roundTrip(manuscript(full));
    const remaining = manuscriptLimits.documentBytes - bytes(wire + wrapped("blk_final", ""));
    const finalText = "x".repeat(remaining);
    const exact = roundTrip(manuscript([...full, paragraph("blk_final", finalText)]));
    expect(bytes(exact)).toBe(manuscriptLimits.documentBytes);
    expect(value(parseManuscript(Buffer.from(exact), identity)).paragraphs).toHaveLength(16);
    const large = wire + wrapped("blk_final", finalText + "x");
    for (const input of [
      large,
      Buffer.from(large),
      "x".repeat(manuscriptLimits.documentBytes + 1),
    ]) {
      expect(parseManuscript(input, identity)).toMatchObject({
        diagnostic: { code: "document-limit" },
      });
    }
    expect(
      serializeManuscript(manuscript([...full, paragraph("blk_final", finalText + "x")]), identity),
    ).toMatchObject({ diagnostic: { code: "document-limit" } });

    const many = Array.from({ length: manuscriptLimits.paragraphCount }, (_, index) =>
      paragraph(`blk_${index}`, "abc"),
    );
    const manyWire = roundTrip(manuscript(many));
    const placeholder: ManuscriptParagraph = { id: "blk_empty", lines: [] };
    expect(value(serializeManuscript(manuscript([...many, placeholder]), identity))).toBe(manyWire);
    expect(
      serializeManuscript(
        manuscript([...many, placeholder, paragraph("blk_extra", "extra")]),
        identity,
      ),
    ).toMatchObject({ diagnostic: { code: "paragraph-limit" } });
    expect(parseManuscript(manyWire + wrapped("blk_extra", "extra"), identity)).toMatchObject({
      diagnostic: { code: "paragraph-limit" },
    });
    expect(
      serializeManuscript(manuscript([...many, paragraph("blk_extra", "extra")]), identity),
    ).toMatchObject({ diagnostic: { code: "paragraph-limit" } });
    expect(
      serializeManuscript(
        manuscript([paragraph("blk_" + "a".repeat(manuscriptLimits.documentBytes), "x")]),
        identity,
      ),
    ).toMatchObject({ diagnostic: { code: "invalid-id" } });
  });

  it("round-trips a seeded corpus of authored text and remains deterministic under mutations", () => {
    const next = generator(0x41412345);
    const alphabet = [
      ...Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)),
      "🙂",
      "中",
      "é",
      "e\u0301",
      "\u00a0",
    ];
    const text = () =>
      Array.from({ length: 1 + next(32) }, () => alphabet[next(alphabet.length)]!)
        .join("")
        .replace(/^ +| +$/g, "") || "A";

    for (let index = 0; index < 700; index++) {
      const lines = Array.from({ length: 1 + next(5) }, text);
      const raw = roundTrip(
        manuscript(
          [
            {
              id: "blk_p",
              lines: lines.map((item, line) => ({
                text: item,
                breakAfter: line === lines.length - 1 ? null : next(2) === 0 ? "hard" : "soft",
              })),
            },
            paragraph("blk_q", text()),
          ],
          { id: "sec_t", text: text() },
        ),
      );
      const position = next(raw.length + 1);
      const mutant = raw.slice(0, position) + text() + raw.slice(position + next(3));
      const result = parseManuscript(mutant, identity);
      expect(parseManuscript(mutant, identity)).toEqual(result);
      if (result.ok)
        expect(value(parseManuscript(roundTrip(result.value), identity))).toEqual(result.value);
      else expect(Object.keys(result.diagnostic).sort()).toEqual(["code", "location"]);
    }
  });

  it("bounds deep and long noncanonical inputs without expanding a diagnostic", () => {
    for (const content of [
      "{".repeat(manuscriptLimits.textBytes),
      "::: {#blk_new .ohtia-block}\n".repeat(4096),
      "&" + "a".repeat(manuscriptLimits.textBytes - 1),
      " ".repeat(manuscriptLimits.textBytes),
    ]) {
      const raw = header + wrapped("blk_p", content);
      const result = parseManuscript(raw, identity);
      if (result.ok) expect(roundTrip(result.value)).toBe(raw);
      else expect(JSON.stringify(result.diagnostic).length).toBeLessThan(100);
    }
  });
});
