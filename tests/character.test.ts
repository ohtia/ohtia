// @vitest-environment jsdom
import { act, createElement as h, useEffect, useState } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { message, supportedLocales } from "@ohtia/contracts";
import { CharacterController } from "../packages/renderer/src/character-controller.js";
import {
  CharacterDecoration,
  CharacterDrawing,
  CharacterPreview,
} from "../packages/renderer/src/character.js";
import {
  VoiceLabel,
  ContributorSymbol,
  ContributorAttribution,
  contributorNames,
  type ContributorId,
} from "../packages/renderer/src/contributor-identity.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
let reduced = false;
const listeners = new Set<() => void>();
const cancel = vi.fn();
beforeEach(() => {
  reduced = false;
  listeners.clear();
  cancel.mockClear();
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
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener(_: string, listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_: string, listener: () => void) {
      listeners.delete(listener);
    },
  }));
  Element.prototype.animate = vi.fn(() => ({ cancel }) as unknown as Animation);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const event = {
  id: "event",
  project: "p",
  action: "a",
  result: "r",
  producer: undefined,
  batch: "b",
  text: "Synthetic notice",
  language: "en-US",
  pose: "thinking" as const,
  relevant: true,
  deferToNavigator: true,
};
it("removes active/deferred motion immediately on OS override and never replays on restoration", async () => {
  const controller = new CharacterController("p", "animated");
  await act(async () => {
    root.render(
      h(CharacterDecoration, { controller, confirmed: "animated", manuscriptVisible: false }),
    );
  });
  await act(async () => {
    controller.receive(event);
  });
  expect(container.querySelector('[data-moving="true"]')).not.toBeNull();
  await act(async () => {
    reduced = true;
    for (const changed of listeners) changed();
    expect(controller.snapshot().playing).toBeUndefined();
    expect(cancel).toHaveBeenCalled();
  });
  expect(container.querySelector('[data-moving="true"]')).toBeNull();
  expect(container.querySelector('[data-pose="thinking"]')).not.toBeNull();
  await act(async () => {
    reduced = false;
    for (const changed of listeners) changed();
  });
  expect(container.querySelector(".character-drawing")).toBeNull();
  expect(container.querySelector(".ohtia-glasses")).not.toBeNull();
  await act(async () => {
    root.render(
      h(CharacterDecoration, { controller, confirmed: "hidden", manuscriptVisible: false }),
    );
  });
  await act(async () => {
    reduced = true;
    for (const changed of listeners) changed();
  });
  expect(controller.snapshot().mode).toBe("hidden");
  expect(container.querySelector(".character-drawing")).toBeNull();
  expect(container.querySelector(".ohtia-glasses")).not.toBeNull();
});
it("guards manuscript placement, compact sizing and renderer replacement without losing notice text", async () => {
  const controller = new CharacterController("p", "animated");
  await act(async () => {
    root.render(
      h(CharacterDecoration, { controller, confirmed: "animated", manuscriptVisible: true }),
    );
  });
  await act(async () => {
    controller.receive(event);
  });
  expect(container.querySelector(".character-drawing")).toBeNull();
  expect(controller.snapshot().deferred).toBeDefined();
  await act(async () => {
    controller.setManuscriptVisible(false);
    controller.openNavigator(true, true);
    root.render(
      h(CharacterDecoration, { controller, confirmed: "animated", manuscriptVisible: false }),
    );
  });
  expect(container.querySelector('[data-moving="true"]')).not.toBeNull();
  await act(async () => {
    root.render(h("p", {}, "Preserved text"));
  });
  expect(controller.snapshot().playing).toBeUndefined();
  expect(controller.snapshot().notice?.text).toBe("Synthetic notice");
  expect(listeners.size).toBe(0);
  await act(async () => {
    root.render(
      h(CharacterDecoration, {
        controller,
        confirmed: "animated",
        manuscriptVisible: false,
        size: 64,
      }),
    );
  });
  expect(container.querySelector(".ohtia-glasses")).not.toBeNull();
  expect(container.querySelector(".character-drawing")).toBeNull();
});
it("keeps preview still and enforces canonical threshold, frame, layer order and key poses", async () => {
  for (const mode of ["animated", "static", "hidden"] as const) {
    await act(async () => {
      root.render(h(CharacterPreview, { mode, size: 96 }));
    });
    expect(container.querySelector("img") !== null).toBe(mode !== "hidden");
    expect(container.querySelector('[data-moving="true"]')).toBeNull();
  }
  await act(async () => {
    root.render(h(CharacterPreview, { mode: "animated", manuscriptVisible: true }));
  });
  expect(container.querySelector(".character-drawing")).toBeNull();
  for (const size of [NaN, Infinity, 95, 0])
    expect(() => CharacterDrawing({ size })).toThrow(RangeError);
  await act(async () => {
    root.render(h(CharacterDrawing, { pose: "thinking" }));
  });
  expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("-16 0 152 152");
  expect(
    [...container.querySelector(".character-head")!.children].map(
      (e) => e.getAttribute("class") ?? e.tagName,
    ),
  ).toEqual([
    "character-hair",
    "character-bun",
    "character-pencil",
    "circle",
    "character-brow character-brow-left",
    "character-brow character-brow-right",
    "character-mouth",
    "character-glasses",
  ]);
  expect(container.querySelector(".character-glasses")?.getAttribute("transform")).toBe(
    "translate(28 30)",
  );
  expect(container.querySelector(".character-head")?.getAttribute("transform")).toContain(
    "rotate(7",
  );
  expect(container.querySelector(".character-pencil path")?.getAttribute("d")).toBe("M46 24 L76 6");
  for (const pose of ["disagreement", "milestone"] as const) {
    await act(async () => {
      root.render(h(CharacterDrawing, { pose, moving: true }));
    });
    expect(container.querySelector("svg")?.getAttribute("data-pose")).toBe(pose);
  }
});
it("preserves every fixed name and localized role independently of symbols, provider and model", async () => {
  for (const locale of supportedLocales)
    for (const contributor of Object.keys(contributorNames) as ContributorId[]) {
      await act(async () => {
        root.render(
          h(ContributorAttribution, {
            identity: { kind: "ai", contributor, definitionVersion: "definition-1" },
            locale,
            producer: "artifact-producer-7",
            execution: "Synthetic queued",
          }),
        );
      });
      expect(container.textContent).toContain(contributorNames[contributor]);
      expect(container.textContent).toContain(message(locale, `identity.role.${contributor}`));
      expect(container.textContent).toContain(message(locale, "identity.ai"));
      const family =
        contributor === "boris" || contributor === "maria"
          ? `${message(locale, "identity.writingReview")} · `
          : "";
      expect(container.querySelector(".voice-label")?.textContent).toBe(
        `${contributorNames[contributor]} · ${family}${message(locale, `identity.role.${contributor}`)} · ${message(locale, "identity.ai")}`,
      );
      expect(container.textContent).toContain("artifact-producer-7");
      expect(container.textContent).toContain("definition-1");
      expect(container.textContent).toContain(message(locale, "identity.unknown"));
      expect(container.querySelector('[data-origin="human"]')).toBeNull();
      for (const svg of container.querySelectorAll("svg"))
        expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
});
it("reserves human voice for original supervisor feedback and keeps unknown producers unknown", async () => {
  await act(async () => {
    root.render(
      h(ContributorAttribution, {
        identity: { kind: "supervisor", author: "Declared author", submittedVersion: "revision-9" },
        locale: "en-US",
        producer: "imported declaration",
        provider: "Observed provider",
        model: "Observed model",
        execution: "Synthetic imported comment",
      }),
    );
  });
  expect(container.querySelector('[data-origin="human"]')).not.toBeNull();
  expect(container.textContent).toContain("revision-9");
  expect(container.textContent).toContain("Declared author");
  expect(container.textContent).toContain("Observed model");
  expect(container.querySelector("bdi")?.getAttribute("lang")).toBe("");
  expect(
    [...container.querySelectorAll("dd")]
      .find((node) => node.textContent === "Observed model")
      ?.getAttribute("lang"),
  ).toBe("");
  expect(
    [...container.querySelectorAll("dd")]
      .find((node) => node.textContent === "Synthetic imported comment")
      ?.getAttribute("lang"),
  ).toBe("en-US");
  await act(async () => {
    root.render(h(VoiceLabel, { identity: { kind: "unknown" }, locale: "en-US" }));
  });
  expect(container.textContent).toBe("Unknown");
  await act(async () => {
    root.render(h(VoiceLabel, { identity: { kind: "product" }, locale: "en-US" }));
  });
  expect(container.textContent).toBe("Ohtia");
  expect(container.querySelector('[data-origin="system"]')).not.toBeNull();
  expect(container.querySelector(".ohtia-glasses")).not.toBeNull();
});
it("leaves historical artifact identity unchanged when adjacent current contribution changes", async () => {
  const historical = {
    kind: "ai" as const,
    contributor: "josefa" as const,
    definitionVersion: "v1",
  };
  for (const current of ["virgilio", "erasmus"] as const) {
    await act(async () => {
      root.render(
        h(
          "div",
          {},
          h("article", { id: "history" }, h(VoiceLabel, { identity: historical, locale: "en-US" })),
          h(VoiceLabel, {
            identity: { kind: "ai", contributor: current, definitionVersion: "v2" },
            locale: "en-US",
          }),
        ),
      );
    });
    expect(container.querySelector("#history")?.textContent).toBe(
      "Josefa · Reference librarian · AI",
    );
  }
});

it("returns event decoration to compact glasses after each interval, dismissal or cancellation", async () => {
  vi.useFakeTimers();
  const controller = new CharacterController("p", "animated");
  await act(async () => {
    root.render(
      h(CharacterDecoration, { controller, confirmed: "animated", manuscriptVisible: false }),
    );
  });
  expect(container.querySelector(".character-drawing")).toBeNull();
  await act(async () => {
    controller.receive(event);
  });
  expect(container.querySelector(".character-drawing")).not.toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(1600);
  });
  expect(container.querySelector(".character-drawing")).toBeNull();
  expect(controller.snapshot().notice?.text).toBe("Synthetic notice");
  await act(async () => {
    controller.receive({ ...event, id: "next", batch: "next" });
  });
  await act(async () => {
    controller.invalidate("next");
  });
  expect(container.querySelector(".character-drawing")).toBeNull();
  await act(async () => {
    root.render(
      h(CharacterDecoration, { controller, confirmed: "static", manuscriptVisible: false }),
    );
  });
  await act(async () => {
    controller.receive({ ...event, id: "static", batch: "static" });
  });
  expect(container.querySelector(".character-drawing")).not.toBeNull();
  expect(container.querySelector('[data-moving="true"]')).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(1600);
  });
  expect(container.querySelector(".character-drawing")).toBeNull();
  expect(container.querySelector(".ohtia-glasses")).not.toBeNull();
});

it("never revives Static manuscript arrivals or preattachment events on renderer mounting", async () => {
  const controller = new CharacterController("p", "animated");
  controller.receive(event);
  await act(async () => {
    root.render(
      h(CharacterDecoration, { controller, confirmed: "animated", manuscriptVisible: false }),
    );
  });
  expect(container.querySelector(".character-drawing")).toBeNull();
  expect(Element.prototype.animate).not.toHaveBeenCalled();
  await act(async () => {
    root.render(
      h(CharacterDecoration, { controller, confirmed: "static", manuscriptVisible: true }),
    );
  });
  await act(async () => {
    controller.receive({ ...event, id: "static-manuscript", batch: "static-manuscript" });
  });
  await act(async () => {
    root.render(
      h(CharacterDecoration, { controller, confirmed: "static", manuscriptVisible: false }),
    );
  });
  expect(container.querySelector(".character-drawing")).toBeNull();
  expect(controller.snapshot().presenting).toBeUndefined();
  expect(controller.snapshot().notice?.id).toBe("static-manuscript");
  controller.dispose();
});

it("does not start canceled motion when keyed replacement mounts on the same controller", async () => {
  const controller = new CharacterController("p", "animated");
  await act(async () => {
    root.render(
      h(CharacterDecoration, {
        key: "first",
        controller,
        confirmed: "animated",
        manuscriptVisible: false,
      }),
    );
  });
  await act(async () => {
    controller.receive(event);
  });
  const starts = vi.mocked(Element.prototype.animate).mock.calls.length;
  expect(starts).toBeGreaterThan(0);
  await act(async () => {
    root.render(
      h(CharacterDecoration, {
        key: "replacement",
        controller,
        confirmed: "animated",
        manuscriptVisible: false,
      }),
    );
  });
  expect(controller.snapshot().playing).toBeUndefined();
  expect(vi.mocked(Element.prototype.animate).mock.calls).toHaveLength(starts);
  expect(container.querySelector(".character-drawing")).toBeNull();
  controller.dispose();
});

it("consumes an explicit Navigator opening after committed manuscript props without a second visibility writer", async () => {
  for (const staysVisible of [false, true]) {
    const controller = new CharacterController("p", "animated");
    function Consumer() {
      const [manuscript, setManuscript] = useState(true);
      const [opening, setOpening] = useState(0);
      useEffect(() => {
        if (opening) controller.openNavigator(true, true);
      }, [opening]);
      return h(
        "div",
        {},
        h(
          "button",
          {
            onClick: () => {
              setManuscript(staysVisible);
              setOpening((value) => value + 1);
            },
          },
          "Open Navigator",
        ),
        h(CharacterDecoration, {
          controller,
          confirmed: "animated",
          manuscriptVisible: manuscript,
        }),
      );
    }
    await act(async () => {
      root.render(h(Consumer));
    });
    await act(async () => {
      controller.receive(event);
    });
    expect(controller.snapshot().deferred?.id).toBe("event");
    await act(async () => {
      container.querySelector("button")!.click();
    });
    expect(controller.snapshot().deferred).toBeUndefined();
    expect(controller.snapshot().playing?.id).toBe(staysVisible ? undefined : "event");
    expect(container.querySelector('[data-moving="true"]') !== null).toBe(!staysVisible);
    if (staysVisible) {
      await act(async () => {
        controller.receive({ ...event, id: "new-visible", batch: "new-visible" });
      });
      expect(controller.snapshot().playing).toBeUndefined();
      expect(controller.snapshot().deferred?.id).toBe("new-visible");
    }
    controller.dispose();
  }
});

it("preserves every canonical static symbol shape, transform and per-piece stroke treatment", async () => {
  const geometry = ["d", "x", "y", "cx", "cy", "r", "width", "height", "rx"];
  const normalized = (element: Element) => [
    element.tagName.toLowerCase(),
    ...geometry.map((key) => {
      const value = element.getAttribute(key);
      return value !== null && /^-?[\d.]+$/.test(value) ? Number(value) : value;
    }),
  ];
  const inherited = (element: Element, attribute: string): string | null => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const value = node.getAttribute(attribute);
      if (value !== null) return value;
    }
    return null;
  };
  const transforms = (element: Element) => {
    const values: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const value = node.getAttribute("transform");
      if (value) values.unshift(value);
    }
    return values.join(" ");
  };
  for (const contributor of Object.keys(contributorNames) as ContributorId[]) {
    const svg = new DOMParser().parseFromString(
      readFileSync(`docs/assets/agents/${contributor}/symbol.svg`, "utf8"),
      "image/svg+xml",
    );
    await act(async () => {
      root.render(h(ContributorSymbol, { contributor }));
    });
    const expected = [...svg.querySelectorAll("path,rect,circle")];
    const actual = [...container.querySelectorAll("path,rect,circle")];
    expect(actual.map(normalized), contributor).toEqual(expected.map(normalized));
    for (const [index, reference] of expected.entries()) {
      const piece = actual[index]!;
      expect(transforms(piece), contributor).toBe(transforms(reference));
      const expectedFill =
        reference.getAttribute("class") === "s-line"
          ? "none"
          : reference.getAttribute("class") === "s-fill"
            ? "currentColor"
            : "var(--voice-ohtia-surface)";
      expect(inherited(piece, "fill"), contributor).toBe(expectedFill);
      if (reference.getAttribute("class") === "s-fill")
        expect(inherited(piece, "stroke"), contributor).toBe("none");
      else
        expect(Number(inherited(piece, "stroke-width")), contributor).toBe(
          Number(reference.getAttribute("stroke-width")),
        );
    }
  }
});
