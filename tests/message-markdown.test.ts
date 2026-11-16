// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageMarkdown } from "../packages/renderer/src/research-presentation.js";
import { ConversationView } from "../packages/renderer/src/conversation-view.js";
import type {
  ConversationController,
  ConversationState,
} from "../packages/renderer/src/conversation-controller.js";
import { message, type InterfaceLocale } from "../packages/contracts/src/index.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  container.remove();
  vi.unstubAllGlobals();
});
async function render(
  text: string,
  locale: InterfaceLocale = "en-US",
  openExternalLink = vi.fn(async () => true),
) {
  await act(async () => root.render(h(MessageMarkdown, { text, locale, openExternalLink })));
  return openExternalLink;
}
describe("restricted message Markdown", () => {
  it.each([false, true])(
    "retains bounded escaped-dollar runs with final delimiter: %s",
    async (close) => {
      const text = "**Before**\n\n" + "\\$".repeat(8000) + (close ? "$" : "") + "\n\n**After**";
      expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(16384);
      await render(text);
      expect([...container.querySelectorAll("strong")].map((node) => node.textContent)).toEqual([
        "Before",
        "After",
      ]);
      expect(container.querySelectorAll("p")[1]?.textContent).toBe(
        "$".repeat(8000 + (close ? 1 : 0)),
      );
    },
    10000,
  );
  it.each([
    ["[^*x*]", ""],
    ["[^*x*]", "\n\nsee \\]"],
    ["[^*x*]", " [link \\]](https://example.org)"],
    ["[^a\\+b]", ""],
    ["[^a\\+b]", "\n\nsee \\]"],
    ["[^a\\+b]", " [link \\]](https://example.org)"],
  ])("keeps label %s literal after an escaped bracket with suffix %j", async (label, suffix) => {
    await render("\\" + label + suffix);
    expect(container.textContent).toContain(label);
    expect(container.querySelector("em,strong")).toBeNull();
    if (suffix.includes("[link"))
      expect(container.querySelector("a")?.textContent).toContain("link ]");
  });
  it.each(["$", "$$", "~~"])("uses opener escape parity for %s notation", async (delimiter) => {
    for (const count of [0, 2, 4]) {
      await render(`${"\\".repeat(count)}${delimiter}x **raw**${delimiter}`);
      expect(container.textContent).toBe(
        `${"\\".repeat(count / 2)}${delimiter}x **raw**${delimiter}`,
      );
      expect(container.querySelector("strong")).toBeNull();
    }
    for (const count of [1, 3]) {
      await render(`${"\\".repeat(count)}${delimiter} **bold** ${delimiter}`);
      expect(container.textContent).toBe(
        `${"\\".repeat((count - 1) / 2)}${delimiter} bold ${delimiter}`,
      );
      expect(container.querySelector("strong")?.textContent).toBe("bold");
    }
  });
  it.each([
    ["[^*x*]", " see \\]"],
    ["[^*x*]", "\n\nsee \\]"],
    ["[^*x*]", ""],
    ["[^a\\+b]", " see \\]"],
    ["[^a\\+b]", "\n\nsee \\]"],
    ["[^a\\+b]", ""],
  ])(
    "rescans footnote label %s after an escaped formula opener before %j",
    async (label, suffix) => {
      await render("\\\\" + label + suffix);
      expect(container.textContent).toContain("\\" + label);
      expect(container.querySelector("em,strong,a")).toBeNull();
    },
  );
  it.each(["(", "["])("respects escaped formula openers with %s delimiters", async (open) => {
    const close = open === "(" ? ")" : "]";
    for (const count of [2, 4]) {
      const prefix = "\\".repeat(count);
      await render(`${prefix}${open}x **bold**${prefix}${close}`);
      expect(container.textContent).toBe(
        `${"\\".repeat(count / 2)}${open}x bold${"\\".repeat(count / 2)}${close}`,
      );
      expect(container.querySelector("strong")?.textContent).toBe("bold");
    }
    for (const count of [1, 3]) {
      const prefix = "\\".repeat(count);
      await render(`${prefix}${open}x **raw**\\${close}`);
      expect(container.textContent).toBe(
        `${"\\".repeat((count + 1) / 2)}${open}x **raw**\\${close}`,
      );
      expect(container.querySelector("strong")).toBeNull();
    }
  });
  it.each([
    "https://example.org/\u202Egro.elpmaxe",
    "HTTPS://EXAMPLE.ORG/é?q=한글",
    "mailto:research@example.org?subject=é",
  ])("shows the full normalized external destination on keyboard focus: %s", async (url) => {
    const open = await render(`[docs](${url})`);
    const anchor = container.querySelector("a")!;
    await act(async () => {
      anchor.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(new URL(url).href);
    await act(async () => anchor.click());
    expect(open).toHaveBeenCalledWith(url);
  });
  it.each(["\n", "\r\n", "\r"])("uses CommonMark line endings consistently: %j", async (ending) => {
    await render(`First${ending}${ending}Second`);
    expect(
      [...container.querySelectorAll(".message-markdown > p")].map((p) => p.textContent),
    ).toEqual(["First", "Second"]);
    await render(`[^n]: raw${ending}${ending}**outside**`);
    expect(container.querySelector("strong")?.textContent).toBe("outside");
    await render(`> $$${ending}> x **raw**${ending}> $$`);
    expect(container.querySelector("blockquote")?.textContent).toBe("$$\nx **raw**\n$$");
    expect(container.querySelector("strong")).toBeNull();
  });
  it.each(["=-\n".repeat(5000), "\n    b\nc\n".repeat(1800)])(
    "bounds cumulative note lookahead while retaining all source: %#",
    async (body) => {
      const text = "**Before**\n\n[^n]: a\n" + body;
      expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(16384);
      await render(text);
      expect(container.querySelector(".message-markdown")?.textContent).toBe(text);
      expect(container.querySelector("strong")).toBeNull();
      await render("**After**");
      expect(container.querySelector("strong")?.textContent).toBe("After");
    },
    10000,
  );

  it.each([
    "[a](https://example.org/~~x y~~)",
    "[see]($x y$)",
    "<https://example.org/~~a b~~>",
    "<user$a(b$@example.org>",
    "[a](https://example.org/$a(b$)",
    "[v $(0,1]$ only](https://example.org)",
    "2*$x$*3",
    "2_~~x~~_3",
  ])("does not synthesize active inline structure from literal protection: %s", async (text) => {
    await render(text);
    expect(container.querySelector("a,em,strong,code")).toBeNull();
    expect(container.textContent).toBe(text);
  });
  it.each(["<~~x~~>", "<tag x=~~a`b~~>", '<tag x="$x" y$">'])(
    "keeps malformed HTML literal without swallowing the following formatting: %s",
    async (text) => {
      await render(`${text}\n**bold**`);
      expect(container.querySelector("strong")?.textContent).toBe("bold");
      expect(container.textContent).toBe(`${text}\nbold`);
      expect(container.querySelector("tag")).toBeNull();
    },
  );
  it("keeps an original HTML block literal through its continuation", async () => {
    const text = "<div>raw</div>\n**bold**";
    await render(text);
    expect(container.querySelector("strong,tag")).toBeNull();
    expect(container.textContent).toBe(text);
  });
  it.each([
    "[^n]: raw\n\n    ```\nx **y**",
    "[^n]: raw\n\n    ```\n    code\n    ```\nx **y**",
    "[^n]: # Heading\nx **y**",
    "[^n]: <div>\nx **y**",
    "[^n]: raw\n\n    | A |\n    | - |\nx **y**",
    "[^n]:\nx **y**",
  ])(
    "does not lazily absorb a paragraph after non-paragraph footnote content: %s",
    async (text) => {
      await render(text);
      expect(container.querySelector("strong")?.textContent).toBe("y");
      expect(container.textContent).toContain("[^n]:");
    },
  );
  it.each([
    "[^n]: raw\n    paragraph\nlazy **raw**",
    "- [^n]: raw\nlazy **raw**",
    "[^n]: raw\n[ref]: https://example.org",
    "[^n]: raw\n2. lazy **raw**",
  ])("keeps valid paragraph-only laziness literal: %s", async (text) => {
    await render(text);
    expect(container.querySelector("strong,a")).toBeNull();
    expect(container.textContent).toContain(
      text.includes("[ref]") ? "[ref]: https://example.org" : "**raw**",
    );
  });
  it.each([
    "[^a]: raw\n---",
    "> [^a]: raw\n> ---",
    "- [^a]: raw\n  ---",
    "1. [^a]: raw\n   ---",
    "[^a]: raw\n\n---",
    "[^a]: raw\n***",
  ])("retains the original thematic break after protecting a definition: %s", async (text) => {
    await render(text);
    expect(container.querySelectorAll("hr")).toHaveLength(1);
    expect(container.querySelector(".message-heading")).toBeNull();
    expect(container.textContent).toContain("[^a]: raw");
  });
  it("retains setext paragraph boundaries and genuine headings, while whole formulas stay literal", async () => {
    await render("[^a]: raw\n===");
    expect(container.querySelector(".message-heading")).toBeNull();
    expect(container.querySelector(".message-markdown")?.lastElementChild?.textContent).toBe("===");
    await render("Title\n---");
    expect(container.querySelector(".message-heading strong")?.textContent).toBe("Title");
    await render("$$\n\n---\n\n$$\n\n**outside**");
    expect(container.querySelector("hr")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("outside");
    expect(container.textContent).toContain("$$\n\n---\n\n$$");
  });
  it("preserves literal leading/trailing whitespace and requires a digit for numeric cells", async () => {
    await render('$$\n    x  \n"raw"\n$$');
    expect(container.querySelector("code,br")).toBeNull();
    expect(container.textContent).toBe('$$\n    x  \n"raw"\n$$');
    await render("| Name | Count |\n| --- | --- |\n| ... | 12 |");
    expect(container.querySelector("td")?.className).toBe("message-align-left");
    expect(container.querySelector("td.message-number")?.textContent).toBe("12");
  });

  it("keeps excessive valid nesting readable without unmounting the root", async () => {
    const text = "> ".repeat(9999) + "x";
    await render("**Before**");
    await render(text);
    expect(container.querySelector(".message-markdown")?.textContent).toBe(text);
    expect(container.querySelector("blockquote")).toBeNull();
    await render("> > **After**");
    expect(container.querySelector("strong")?.textContent).toBe("After");
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
  }, 10000);
  it.each([
    ["[$x$]$y$", "$x$$y$"],
    ["[$x$]~~z~~", "$x$~~z~~"],
  ])("orders alias insertion before adjacent masked content: %s", async (text, expected) => {
    await render(`${text}\n\n[$x$]: https://example.org\n[$p$-values]: https://example.org`);
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.textContent).toBe(expected);
    expect(container.textContent).not.toContain("OHTIALITERAL");
  });
  it("keeps an undefined explicit reference label as ordinary source", async () => {
    await render("[$p$-values][^2]\n\n[$p$-values]: https://example.org");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("[$p$-values][^2]");
  });
  it("does not hide a definition or create a table merely because notation was protected", async () => {
    const definition = "[a $b]$]: https://example.org";
    await render(definition);
    expect(container.textContent).toBe(definition);
    const table = "| $a|b$ |\n| --- |";
    await render(table);
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toBe(table);
  });
  it("maps original blocks through aliases and multiline literal replacements", async () => {
    const prefix = "[$x$]\n\n[$x$]: https://example.org\n\n> $$\n> x **raw**\n> $$\n\n";
    const table = "| $a|b$ |\n| --- |";
    await render(prefix + table);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.org");
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector(".message-markdown")?.lastElementChild?.textContent).toBe(table);
    await render(prefix + "| Name | Count |\n| --- | ---: |\n| Value | 12 |");
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.querySelector("td.message-number")?.textContent).toBe("12");
    expect(container.textContent).not.toContain("OHTIALITERAL");
  });
  it("keeps HTML blocks separate while inline HTML stays inside its paragraph", async () => {
    await render("<div>a</div>\n\n<div>b</div>");
    const children = [...container.querySelector(".message-markdown")!.children];
    expect(children.map((node) => node.tagName)).toEqual(["P", "P"]);
    expect(children.map((node) => node.textContent)).toEqual(["<div>a</div>", "<div>b</div>"]);
    await render("Before <b>raw</b> after.");
    expect(container.querySelector("p")?.textContent).toBe("Before <b>raw</b> after.");
    expect(container.querySelector("p p,b")).toBeNull();
    expect(container.querySelectorAll("p > span.message-literal")).toHaveLength(2);
    await render("> <div>\n> raw\n> </div>");
    expect(container.querySelector("blockquote p")?.textContent).toBe("<div>\nraw\n</div>");
    await render("> | $a|b$ |\n> | --- |");
    expect(container.querySelector("blockquote p")?.textContent).toBe("| $a|b$ |\n| --- |");
    expect(container.querySelector("table")).toBeNull();
  });

  it("cannot forge literal tokens through decoded character references in text or URLs", async () => {
    await render("OHTIALITERAL0TO&#75;EN0END $x$");
    expect(container.textContent).toBe("OHTIALITERAL0TOKEN0END $x$");
    await render("[a](https://example.org/OHTIALITERAL0TO&#75;EN0END) $x$");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.org/OHTIALITERAL0TOKEN0END",
    );
    await render("[$x$]\n\n[$x$]: https://example.org/OHTIALITERAL0TO&#75;EN0END");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.org/OHTIALITERAL0TOKEN0END",
    );
  });

  it.each([
    "[a $x](https://example.org/$)",
    "[a ~~x](https://example.org/~~)",
    "[a $x][id$]\n\n[id$]: https://example.org",
    "Costs $5 per [unit](https://example.org/a$b)",
    "[a $x](https://example.org) outside$",
    "$before [a x$](https://example.org)",
  ])("keeps supported links when notation only partly overlaps them: %s", async (text) => {
    await render(text);
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
  it("rejects partial code overlap in either inline or standalone display notation", async () => {
    await render("Set $JAVA_HOME and check `$PATH`.");
    expect(container.querySelector("code")?.textContent).toBe("$PATH");
    await render("Use:\n\n$$\n\n```latex\n$$\nE\n$$\n```\n\nAfter **bold**.");
    expect(container.querySelector("pre code")?.textContent).toBe("$$\nE\n$$");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    await render("$before `inside$` after");
    expect(container.querySelector("code")?.textContent).toBe("inside$");
  });
  it.each([
    ["> $$\n> x **raw**\n> $$", "blockquote", "$$\nx **raw**\n$$"],
    ["1. Step:\n   \\[\n   x = y\n   \\]", "li", "Step:\n\\[\nx = y\n\\]"],
    ["> - $$\n>   x **raw**\n>   $$", "blockquote li", "$$\nx **raw**\n$$"],
  ])(
    "keeps outer containers outside multiline literal notation: %s",
    async (text, selector, expected) => {
      await render(text);
      expect(container.querySelector(selector)?.textContent).toBe(expected);
      expect(container.querySelector("strong")).toBeNull();
    },
  );
  it.each(["a`b", "a`b $x$", "a<b $x$", "$x *raw*$"])(
    "keeps shortcut and collapsed bindings syntax-neutral for label %s",
    async (label) => {
      for (const suffix of ["", "[]"]) {
        await render(`[${label}]${suffix}\n\n[${label}]: https://example.org`);
        expect(container.querySelectorAll("a")).toHaveLength(1);
        expect(container.querySelector("code,em")).toBeNull();
        expect(container.textContent).not.toContain("OHTIALITERAL");
      }
    },
  );
  it("retains decoded destination identity and cannot leak aliases into an unclosed block", async () => {
    await render("[$x$]\n\n> [$x$]: <https://example.org/a&amp;amp;b&#32;c>\n\n<script>unclosed");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.org/a&amp;b c",
    );
    expect(container.textContent).not.toContain("OHTIALITERAL");
    expect(container.textContent).toContain("<script>unclosed");
    await render(
      "ohtialiteral0tokenreference0end [$x$]\n\n[$x$]: https://example.org\n\n```unclosed",
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.org");
    expect(container.querySelector("pre code")?.textContent).toBe("");
    expect(container.textContent).not.toContain("OHTIALITERAL");
  });

  it.each(["$x$", "$$x$$", "~~x~~", String.raw`\(x\)`, "$x *raw*$", String.raw`a \[b\]`])(
    "resolves all reference forms without changing notation-bearing identifier %s",
    async (label) => {
      await render(`[Read][${label}] [${label}][] [${label}]\n\n[${label}]: https://example.org`);
      expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(
        Array(3).fill("https://example.org"),
      );
      expect(container.querySelector("em,strong")).toBeNull();
      expect(container.textContent).toContain(label);
    },
  );
  it("keeps reference normalization, nested labels, and enclosing literal source separate", async () => {
    await render(
      "[Read][a $X$] [outer [inner] $x *raw*$](https://example.org)\n\n[a $x$]: https://example.org",
    );
    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(container.querySelector("em")).toBeNull();
    await render("$$\n[$x$]\n$$\n\n[$x$]: https://example.org");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("$$\n[$x$]\n$$");
  });
  it.each([String.raw`a\+b`, String.raw`a\]b`, String.raw`a\qb`, "a&copy;b"])(
    "retains escaped/entity footnote label %s and its body literally",
    async (label) => {
      await render(`Call.[^${label}]\n\n[^${label}]: **raw**`);
      expect(container.querySelector("strong,a")).toBeNull();
      expect(container.textContent).toBe(`Call.[^${label}][^${label}]: **raw**`);
    },
  );
  it("uses parser label boundaries when code contains unmatched brackets", async () => {
    await render(
      "[`[`][a $x$] [code `]` $x *raw*$](https://example.org)\n\n[a $x$]: https://example.org",
    );
    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect([...container.querySelectorAll("a code")].map((code) => code.textContent)).toEqual([
      "[",
      "]",
    ]);
    expect(container.querySelector("em")).toBeNull();
  });
  it("does not let a formula marker inside literal HTML consume following blocks", async () => {
    await render("<script>\n$$\n</script>\n\n**outside**\n\n$$");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("outside");
    expect(container.textContent).toContain("<script>\n$$\n</script>");
  });
  it("keeps whitespace-bearing labels as ordinary reference links", async () => {
    await render("[^a b]\n\n[^a b]: https://example.org");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.org");
  });
  it.each(["> [^n]: raw\nlazy **raw**", "> [^n]: raw\n>\t  **raw**"])(
    "preserves quoted lazy and partial-tab note continuations: %s",
    async (text) => {
      await render(text);
      expect(container.querySelector("strong")).toBeNull();
      expect(container.querySelector("blockquote")?.textContent).toContain("**raw**");
    },
  );
  it.each(["$$", String.raw`\[`])(
    "does not let a prose %s consume later code or containers",
    async (open) => {
      const close = open === "$$" ? "$$" : String.raw`\]`;
      await render(
        `The shell marker ${open} holds a value.\n\n\`\`\`sh\necho ${close}\n\`\`\`\n\nAfter **bold**.`,
      );
      expect(container.querySelector("pre code")?.textContent).toBe(`echo ${close}`);
      expect(container.querySelector("strong")?.textContent).toBe("bold");
      await render(`Costs ${open} a value.\n\n- **item**\n\nend ${close}`);
      expect(container.querySelector("li strong")?.textContent).toBe("item");
    },
  );
  it("lets Markdown decode escaped destinations before browser admission", async () => {
    await render(String.raw`[a](https://example.org/\(y\))`);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.org/(y)");
  });

  it("renders the allowed structures with bold paragraphs for headings and named focusable overflow boxes", async () => {
    await render(
      "# Heading\n\nParagraph with *emphasis*, **strong** and `inline`.\n\n> Quoted **text**\n\n- First\n- Second\n\n3. Third\n4. Fourth\n\n---\n\n```js\n<script>never()</script>\n```\n\n| Label | Count |\n| :--- | ---: |\n| Sample | 123 |",
    );
    expect(container.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    expect(container.querySelector(".message-heading strong")?.textContent).toBe("Heading");
    expect(container.querySelector("em")?.textContent).toBe("emphasis");
    expect(container.querySelector("p > strong")?.textContent).toBe("Heading");
    expect(container.querySelector("blockquote")?.textContent).toBe("Quoted text");
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector('div[aria-label="Code block"]')?.getAttribute("tabindex")).toBe(
      "0",
    );
    expect(container.querySelector("pre code")?.textContent).toBe("<script>never()</script>");
    expect(container.querySelector('div[aria-label="Table"]')?.getAttribute("tabindex")).toBe("0");
    expect(container.querySelector("thead th")?.getAttribute("scope")).toBe("col");
    expect(container.querySelector("td.message-number")?.textContent).toBe("123");
    expect(container.querySelector("td.message-align-left")?.textContent).toBe("Sample");
    expect(container.querySelector("p code")?.textContent).toBe("inline");
    expect(container.querySelector("script")).toBeNull();
  });
  it("preserves code delimiters and source when literal-notation markers span code fragments", async () => {
    await render("`$` and `$`\n\n```\n$$\n```\n\n**still bold**");
    expect([...container.querySelectorAll("p code")].map((node) => node.textContent)).toEqual([
      "$",
      "$",
    ]);
    expect(container.querySelector("pre code")?.textContent).toBe("$$");
    expect(container.querySelector("strong")?.textContent).toBe("still bold");
  });
  it("resolves inline, full, collapsed and shortcut references with first-definition precedence", async () => {
    const open = await render(
      "[Inline](https://example.org/a) [Full][ref] [ref][] [ref]\n\n[ref]: mailto:someone@example.org\n[REF]: https://wrong.example",
    );
    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://example.org/a",
      ...Array(3).fill("mailto:someone@example.org"),
    ]);
    expect(container.textContent).not.toContain("[ref]:");
    expect(
      container.querySelectorAll('[role="img"][aria-label="opens in your browser"]'),
    ).toHaveLength(4);
    await act(async () => {
      links[0]!.focus();
    });
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe("https://example.org/a");
    await act(async () => links[0]!.click());
    expect(open).toHaveBeenCalledWith("https://example.org/a");
  });
  it.each(["$$\nx **bold** and `code`\n$$", "~~*raw* `code`~~", "$x \\$ y$"])(
    "preserves unsupported notation enclosing code-like content: %s",
    async (source) => {
      await render(source);
      expect(container.textContent).toBe(source);
      expect(container.querySelector("em,strong,code")).toBeNull();
    },
  );
  it.each([
    "> [^note]: **raw footnote**",
    "- [^note]: **raw footnote**",
    "> - [^note]: **raw footnote**",
  ])("keeps nested footnote bodies literal: %s", async (source) => {
    await render(source);
    expect(container.textContent).toContain("[^note]: **raw footnote**");
    expect(container.querySelector("strong")).toBeNull();
  });
  it("keeps a quoted footnote’s continuation literal within its container", async () => {
    await render("> [^note]: raw" + String.fromCharCode(10) + ">     **continued body**");
    expect(container.querySelector("blockquote")?.textContent).toContain("**continued body**");
    expect(container.querySelector("strong,em,code")).toBeNull();
  });
  it("keeps currency out of literal formula spans across links, tables and strong text", async () => {
    await render(
      "See [$5 offer](https://example.org) and $10\n\nFrom $5 to **$10**\n\n| A | B | C |\n| --- | --- | --- |\n| A | $5 | $10 |",
    );
    expect(container.querySelector("a")?.textContent).toContain("$5 offer");
    expect(container.querySelector("strong")?.textContent).toBe("$10");
    expect([...container.querySelectorAll("tbody td")].map((cell) => cell.textContent)).toEqual([
      "A",
      "$5",
      "$10",
    ]);
  });
  it("does not let strikethrough markers swallow a list across block boundaries", async () => {
    await render("~~a\n\n- **b**\n\nc~~");
    expect(container.querySelector("ul li strong")?.textContent).toBe("b");
    expect(container.textContent).toContain("~~a");
    expect(container.textContent).toContain("c~~");
  });
  it.each([
    "`~~` then ~~*raw*~~",
    "`$` then **$x *raw*$**",
    "Use `$$` for display math:\n\n$$\nx **b**\n$$",
    "Use ~~ markers.\n\nOld: ~~*raw*~~",
    "~~a\n\n$x **b**$\n\nc~~",
  ])("rescans unsupported delimiters after a skipped code or block span: %s", async (source) => {
    await render(source);
    expect(container.querySelector("em")).toBeNull();
    if (!source.startsWith("`$`")) expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain(source.includes("raw") ? "*raw*" : "**b**");
  });
  it.each([
    "[^n]: raw\n\n    **continued body**",
    "- [^n]: raw\n\n      **continued body**",
    "> [^n]: raw\n>\n>     **continued body**",
    "> - [^n]: raw\n>\n>       **continued body**",
    "[^n]: raw\n**continued body**",
  ])("preserves blank-separated and lazy footnote continuations: %s", async (source) => {
    await render(source);
    expect(container.textContent).toContain("**continued body**");
    expect(container.querySelector("strong,em,pre")).toBeNull();
  });
  it.each([
    "The method works[^1]: it **reduces** cost.",
    "- [^n]: x\n  - **nested**",
    "- [^n]: raw\n\n    **ordinary paragraph**",
    "| A | B |\n| --- | --- |\n| [^a]: x | **y** |",
  ])(
    "does not treat ordinary prose, shallow list content or table cells as note definitions: %s",
    async (source) => {
      await render(source);
      expect(container.querySelector("strong")).not.toBeNull();
      if (source.startsWith("|")) expect(container.querySelectorAll("tbody td")).toHaveLength(2);
      if (source.includes("nested")) expect(container.querySelectorAll("ul")).toHaveLength(2);
    },
  );
  it("keeps escaped footnote labels literal without formatting their definition body", async () => {
    await render("[^a\\]b]: **raw**");
    expect(container.textContent).toBe("[^a\\]b]: **raw**");
    expect(container.querySelector("strong")).toBeNull();
  });
  it("shows a malformed allowed-scheme address as its label", async () => {
    await render("[broken](https://[)");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("broken");
  });
  it("does not let inline notation merge separate table cells", async () => {
    await render(
      "| A | B |" + String.fromCharCode(10) + "| --- | --- |" + String.fromCharCode(10) + "|$x|y$|",
    );
    expect([...container.querySelectorAll("tbody td")].map((cell) => cell.textContent)).toEqual([
      "$x",
      "y$",
    ]);
  });
  it("separates interface-label language from recorded message language", async () => {
    const text =
      "```" +
      String.fromCharCode(10) +
      "한국어 code" +
      String.fromCharCode(10) +
      "```" +
      String.fromCharCode(10, 10) +
      "| A |" +
      String.fromCharCode(10) +
      "| --- |" +
      String.fromCharCode(10) +
      "| 한글 |" +
      String.fromCharCode(10, 10) +
      "[link](https://example.org)";
    await act(async () =>
      root.render(
        h(MessageMarkdown, {
          text,
          locale: "de-DE",
          language: "ko",
          openExternalLink: async () => true,
        }),
      ),
    );
    expect(container.querySelector(".message-markdown")?.getAttribute("lang")).toBe("ko");
    expect(container.querySelector(".message-code-box")?.getAttribute("lang")).toBe("de-DE");
    expect(container.querySelector("pre")?.getAttribute("lang")).toBe("ko");
    expect(container.querySelector(".message-table-box")?.getAttribute("lang")).toBe("de-DE");
    expect(container.querySelector("table")?.getAttribute("lang")).toBe("ko");
    expect(container.querySelector(".message-external-icon")?.getAttribute("lang")).toBe("de-DE");
  });
  it("routes a middle click through the broker and leaves the context-menu gesture alone", async () => {
    const open = await render("[link](https://example.org)");
    const link = container.querySelector("a")!;
    const middle = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    await act(async () => link.dispatchEvent(middle));
    expect(middle.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.org");
    await act(async () =>
      link.dispatchEvent(new MouseEvent("auxclick", { button: 2, bubbles: true })),
    );
    expect(open).toHaveBeenCalledOnce();
  });
  it("shows forbidden destinations as label text and never requests image or HTML resources", async () => {
    await render(
      '[Bad](javascript:evil) [Local](file:///private) [Data](data:text/html,evil) [Relative](/private)\n\n![image](https://example.org/tracker.png)\n\n<script>globalThis.compromised=true</script>\n\n<img src="https://example.org/tracker" onerror="evil()">',
    );
    expect(container.querySelector("a,img,script,iframe,style,object,embed,math")).toBeNull();
    expect(container.textContent).toContain("Bad Local Data Relative");
    expect(container.textContent).toContain("![image](https://example.org/tracker.png)");
    expect(container.textContent).toContain(
      '<img src="https://example.org/tracker" onerror="evil()">',
    );
    expect(Reflect.get(globalThis, "compromised")).toBeUndefined();
  });
  it.each([
    "$x *not emphasis*$",
    "$$\nx **not bold**\n$$",
    "\\(x *raw*\\)",
    "\\[x **raw**\\]",
    "~~*raw*~~",
    "[^foot]\n\n[^foot]: **raw footnote**\n    continuation",
    "OHTIALITERAL0END $*raw*$",
  ])("preserves unsupported notation as written: %s", async (source) => {
    await render(source);
    expect(container.textContent).toBe(source.replace(/\n\n/g, ""));
    expect(container.querySelector("em,strong,math,del,sup,a")).toBeNull();
  });
  it.each([
    "| broken | table\n| ---\n<script>",
    "**unclosed _text [broken](javascript:",
    "![image][image]\n\n[image]: https://example.org/image",
    "> <b>raw</b>\n\n- nested\n  - **safe**",
    "```\n![image](https://example.org)\n$x$\n~~~raw~~~",
  ])("contains hostile and incomplete input: %s", async (source) => {
    await render(source);
    expect(container.querySelector("script,img,iframe,object,embed")).toBeNull();
    expect(container.textContent).not.toBe("");
  });
  it.each(["de-DE", "ko-KR"] as const)(
    "names code and tables in %s without changing message text",
    async (locale) => {
      await render(
        "```\n한국어 Latin\n```\n\n| Name | Value |\n| --- | --- |\n| 한글 | 3 |",
        locale,
      );
      expect(
        container.querySelector(`[aria-label="${message(locale, "conversation.codeBlock")}"]`),
      ).not.toBeNull();
      expect(
        container.querySelector(`[aria-label="${message(locale, "conversation.table")}"]`),
      ).not.toBeNull();
      expect(container.textContent).toContain("한국어 Latin");
    },
  );
  it("contains an external action rejection and supports empty tables and ordered lists without a supplied start", async () => {
    const open = vi.fn(async () => {
      throw new Error("browser unavailable");
    });
    await render("[go](http://example.org)\n\n1. start\n\n| Header |\n| --- |", "en-US", open);
    await act(async () => container.querySelector<HTMLAnchorElement>("a")!.click());
    expect(open).toHaveBeenCalledOnce();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });
});
const id = (n: number) => `019a8000-0000-7000-8000-${String(n).padStart(12, "0")}`;
function savedState(): ConversationState {
  return {
    scope: { projectId: id(10), conversationId: id(20) },
    status: "ready",
    items: [
      {
        kind: "message",
        id: id(1),
        position: 1,
        rank: 1,
        revision: 1,
        authorKind: "researcher",
        agentId: null,
        taskId: null,
        content: "**Saved**",
        language: null,
        ending: null,
      },
    ],
    texts: new Map([[id(1), "**Saved**"]]),
    replies: new Map(),
    next: null,
    loadingEarlier: false,
    failedEarlier: false,
    completed: 0,
  };
}
describe("saved message actions", () => {
  async function showCopyAction(copyMessage: (messageId: string) => Promise<boolean>) {
    await act(async () =>
      root.render(
        h(ConversationView, {
          state: savedState(),
          controller: {} as ConversationController,
          locale: "en-US",
          commands: { copyMessage, openExternalLink: async () => true },
        }),
      ),
    );
    return container.querySelector<HTMLButtonElement>(".conversation-actions button")!;
  }
  it("clears confirmed Copied after five seconds without moving focus", async () => {
    vi.useFakeTimers();
    const button = await showCopyAction(async () => true);
    await act(async () => {
      button.focus();
      button.click();
    });
    expect(container.querySelector(".conversation-copy-status")?.textContent).toBe("Copied");
    await act(async () => vi.advanceTimersByTime(4999));
    expect(container.querySelector(".conversation-copy-status")?.textContent).toBe("Copied");
    await act(async () => vi.advanceTimersByTime(1));
    expect(container.querySelector(".conversation-copy-status")?.textContent).toBe("");
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-disabled")).toBeNull();
  });
  it("restarts the confirmation interval when another copy succeeds", async () => {
    vi.useFakeTimers();
    const button = await showCopyAction(async () => true);
    await act(async () => button.click());
    await act(async () => vi.advanceTimersByTime(4000));
    await act(async () => button.click());
    await act(async () => vi.advanceTimersByTime(1000));
    expect(container.querySelector(".conversation-copy-status")?.textContent).toBe("Copied");
    await act(async () => vi.advanceTimersByTime(4000));
    expect(container.querySelector(".conversation-copy-status")?.textContent).toBe("");
  });
  it("starts a fresh interval after a pending retry is confirmed", async () => {
    vi.useFakeTimers();
    let resolve!: (value: boolean) => void;
    const copy = vi
      .fn<(messageId: string) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((done) => {
            resolve = done;
          }),
      );
    const button = await showCopyAction(copy);
    await act(async () => button.click());
    await act(async () => vi.advanceTimersByTime(4000));
    await act(async () => button.click());
    await act(async () => vi.advanceTimersByTime(6000));
    expect(container.querySelector(".conversation-copy-status")?.textContent).toBe("");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => resolve(true));
    await act(async () => vi.advanceTimersByTime(4999));
    expect(container.querySelector(".conversation-copy-status")?.textContent).toBe("Copied");
    await act(async () => vi.advanceTimersByTime(1));
    expect(container.querySelector(".conversation-copy-status")?.textContent).toBe("");
  });
  it("keeps a copy failure visible after the earlier success interval", async () => {
    vi.useFakeTimers();
    const copy = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const button = await showCopyAction(copy);
    await act(async () => button.click());
    await act(async () => vi.advanceTimersByTime(4000));
    await act(async () => button.click());
    await act(async () => vi.advanceTimersByTime(6000));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Ohtia couldn’t copy this message.",
    );
    expect(container.querySelector(".conversation-copy-status")?.textContent).toBe("");
  });
  it("cancels pending confirmation expiry when the message leaves the view", async () => {
    vi.useFakeTimers();
    const button = await showCopyAction(async () => true);
    await act(async () => button.click());
    await act(async () => root.render(h("p", null, "Closed conversation")));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(6000));
    expect(container.textContent).toBe("Closed conversation");
  });
  it("shows Copied only after main confirms, sends only the ID and keeps the button first and visible", async () => {
    let resolve!: (value: boolean) => void;
    const copyMessage = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    await act(async () =>
      root.render(
        h(ConversationView, {
          state: savedState(),
          controller: {} as ConversationController,
          locale: "en-US",
          commands: { copyMessage, openExternalLink: async () => true },
        }),
      ),
    );
    const button = container.querySelector<HTMLButtonElement>(".conversation-actions button")!;
    expect(button.getAttribute("aria-label")).toBe("Copy message");
    expect(button.hasAttribute("hidden")).toBe(false);
    await act(async () => {
      button.focus();
      button.click();
      button.click();
    });
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe("Copy message");
    expect(copyMessage.mock.calls).toEqual([[id(1)]]);
    expect(container.textContent).not.toContain("Copied");
    await act(async () => resolve(true));
    expect(container.querySelector('.conversation-copy-status[role="status"]')?.textContent).toBe(
      "Copied",
    );
    expect(document.activeElement).toBe(button);
  });
  it.each([false, "reject"])(
    "shows an inline danger alert for %s and no false success",
    async (outcome) => {
      const copyMessage = vi.fn(async () => {
        if (outcome === "reject") throw new Error("clipboard");
        return false;
      });
      await act(async () =>
        root.render(
          h(ConversationView, {
            state: savedState(),
            controller: {} as ConversationController,
            locale: "en-US",
            commands: { copyMessage, openExternalLink: async () => true },
          }),
        ),
      );
      await act(async () =>
        container.querySelector<HTMLButtonElement>(".conversation-actions button")!.click(),
      );
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "Ohtia couldn’t copy this message. Select its text and copy it manually.",
      );
      expect(container.querySelector('[role="alert"] button')).toBeNull();
      expect(container.querySelector(".conversation-copy-status")?.textContent).toBe("");
    },
  );
  it("does not apply an old copy completion to another conversation", async () => {
    let resolve!: (value: boolean) => void;
    const commands = {
      copyMessage: () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
      openExternalLink: async () => true,
    };
    const renderState = async (state: ConversationState) =>
      act(async () =>
        root.render(
          h(ConversationView, {
            state,
            controller: {} as ConversationController,
            locale: "en-US",
            commands,
          }),
        ),
      );
    await renderState(savedState());
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".conversation-actions button")!.click(),
    );
    const next = savedState();
    await renderState({ ...next, scope: { ...next.scope, conversationId: id(21) } });
    await act(async () => resolve(true));
    expect(container.textContent).not.toContain("Copied");
  });
});
