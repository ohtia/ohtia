// @vitest-environment jsdom
import { act, createElement as h, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  failure,
  type FoundationPort,
  type ProjectRecord,
  type ResearchOutputs,
  type ResearchScope,
} from "@ohtia/contracts";
import { ProjectController } from "../packages/renderer/src/project-controller.js";
import { ProjectSelector } from "../packages/renderer/src/project-selector.js";
import { call, deferred } from "./fixtures/settings.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const id = (n: number) => `019a8000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const project = (n: number): ProjectRecord => ({
  id: id(n),
  projectType: "thesis",
  title: null,
  documentLanguage: null,
  isDevelopment: false,
  setupConfirmedAt: null,
  createdAt: `2026-11-17T10:${String(n % 60).padStart(2, "0")}:00.000Z`,
  updatedAt: "2026-11-17T10:00:00.000Z",
  lastOpenedAt: "2026-11-17T10:00:00.000Z",
});
function fixture(size = 95) {
  const projects = Array.from({ length: size }, (_, n) => project(n + 1));
  const port = {
    listProjects: vi.fn(({ cursor, count }) => {
      const start = cursor ? projects.findIndex((p) => p.id === cursor.id) + 1 : 0;
      const items = projects.slice(start, start + count);
      const last = items.at(-1);
      const hasMore = start + items.length < projects.length;
      return call({
        ok: true as const,
        value: {
          items,
          next: hasMore && last ? { id: last.id, lastOpenedAt: last.lastOpenedAt } : null,
          hasMore,
        },
      });
    }),
    listConversations: vi.fn(({ projectId }) =>
      call({
        ok: true as const,
        value: { items: [{ id: projectId }], next: null, hasMore: false },
      }),
    ),
    openProject: vi.fn((_operation, { projectId }) =>
      call({ ok: true as const, value: { resultId: projectId } }),
    ),
  };
  const selected: ResearchScope[] = [];
  const controller = new ProjectController(port as unknown as FoundationPort, (scope) =>
    selected.push(scope),
  );
  return { projects, port, selected, controller };
}
async function mount(f: ReturnType<typeof fixture>, current = f.projects[0]) {
  function View() {
    const state = useSyncExternalStore(f.controller.subscribe, f.controller.snapshot);
    return h(ProjectSelector, {
      controller: f.controller,
      state,
      current,
      currentId: current?.id ?? null,
      locale: "en-US",
    });
  }
  await act(async () => {
    root.render(h(View));
  });
  return container.querySelector<HTMLButtonElement>("[role=combobox]")!;
}
async function key(button: HTMLElement, key: string) {
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("project selector", () => {
  it("loads 40, 40 and 15 only by explicit action, preserves rows after later failure, highlights the first appended row and rereads on reopening", async () => {
    const f = fixture();
    const button = await mount(f);
    await act(async () => {
      button.click();
    });
    expect(document.querySelectorAll("[role=option]")).toHaveLength(41);
    const list = document.querySelector("[role=listbox]")!;
    await act(async () => {
      list.dispatchEvent(new Event("scroll"));
    });
    expect(f.port.listProjects).toHaveBeenCalledTimes(1);
    f.port.listProjects.mockImplementationOnce(() => call(failure("storage_failed")) as never);
    await key(button, "End");
    await key(button, "Enter");
    expect(document.querySelectorAll("[role=option]")).toHaveLength(41);
    expect(document.querySelector("[role=alert]")?.textContent).toContain("couldn’t load more");
    expect(document.querySelector('[role="alert"]')?.closest('[role="listbox"]')).toBeNull();
    expect(document.querySelector('[role="listbox"]')?.getAttribute("aria-owns")).toBe(
      document.querySelector(".project-selector-more")?.id,
    );
    await key(button, "Enter");
    expect(document.querySelectorAll("[role=option]")).toHaveLength(81);
    expect(document.querySelectorAll('[role=option][aria-selected="true"]')[0]?.id).toMatch(
      /option-40$/,
    );
    await key(button, "End");
    await key(button, "Enter");
    expect(document.querySelectorAll("[role=option]")).toHaveLength(95);
    expect(document.body.textContent).not.toContain("Show more projects");
    await key(button, "Escape");
    await act(async () => {
      button.click();
    });
    expect(f.port.listProjects.mock.calls.at(-1)?.[0]).toEqual({ cursor: null, count: 40 });
    expect(document.querySelector('[aria-current="true"] svg')).not.toBeNull();
    f.controller.dispose();
  });

  it("announces slow, failed, retry and empty first pages with keyboard-operable Reload projects", async () => {
    const f = fixture(0);
    const pending = deferred<{ ok: true; value: ResearchOutputs["project.list"] }>();
    f.port.listProjects.mockImplementationOnce(() => ({
      result: pending.promise,
      cancel: vi.fn(),
    }));
    const button = await mount(f, undefined);
    await act(async () => {
      button.click();
    });
    expect(document.querySelector("[role=listbox]")?.getAttribute("aria-busy")).toBe("true");
    expect(document.body.textContent).toContain("Loading…");
    expect(document.querySelector('[role="status"]')?.closest('[role="listbox"]')).toBeNull();
    await act(async () => {
      pending.resolve({ ok: true, value: { items: [], next: null, hasMore: false } });
    });
    expect(document.body.textContent).toContain("No projects yet.");
    await key(button, "Escape");
    f.port.listProjects.mockImplementationOnce(() => call(failure("storage_failed")) as never);
    await key(button, "ArrowDown");
    expect(document.body.textContent).toContain("Reload projects");
    await key(button, "Enter");
    expect(document.body.textContent).toContain("No projects yet.");
    f.controller.dispose();
  });

  it("distinguishes setup dates, retains full titles, separates current from keyboard highlight and commits only the chosen option", async () => {
    const f = fixture(3);
    f.projects[2] = {
      ...project(3),
      title: "Long title ".repeat(18),
      setupConfirmedAt: project(3).createdAt,
      documentLanguage: "de-DE",
    };
    const button = await mount(f);
    expect(button.getAttribute("aria-label")).toBe("Current project");
    expect(button.textContent).toContain("New thesis · Setting up");
    await act(async () => {
      button.focus();
    });
    expect(document.querySelector("[role=tooltip]")).not.toBeNull();
    await key(button, "ArrowDown");
    expect(document.querySelector("[role=tooltip]")).toBeNull();
    await key(button, "Escape");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
    await key(button, "ArrowDown");
    const options = document.querySelectorAll("[role=option]");
    expect(options[0]?.textContent).not.toBe(options[1]?.textContent);
    await key(button, "ArrowDown");
    expect(options[0]?.getAttribute("aria-current")).toBe("true");
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    expect(f.selected).toHaveLength(0);
    expect(options[2]?.getAttribute("title")).toBe(f.projects[2]!.title);
    await key(button, "Enter");
    expect(f.selected.at(-1)?.projectId).toBe(id(2));
    expect(button.getAttribute("aria-expanded")).toBe("false");
    f.controller.dispose();
  });
});

describe("project selection ownership", () => {
  it("restores the last project only for the initial window and retains the project when its ordering write fails", async () => {
    const first = fixture(2);
    first.port.openProject.mockImplementation(() => call(failure("storage_failed")) as never);
    await first.controller.initialize(true);
    expect(first.selected.at(-1)?.projectId).toBe(id(1));
    const next = fixture(2);
    await next.controller.initialize(false);
    expect(next.selected).toEqual([]);
    expect(next.controller.snapshot().hasProjects).toBe(true);
    first.controller.dispose();
    next.controller.dispose();
  });
  it("ignores delayed B after A is reselected and restores each project's last conversation", async () => {
    const f = fixture(2);
    const pending = deferred<never>();
    f.controller.remember({ projectId: id(1), conversationId: id(101) });
    f.port.listConversations.mockImplementationOnce(() => ({
      result: pending.promise,
      cancel: vi.fn(),
    }));
    const b = f.controller.open(id(2));
    await f.controller.open(id(1));
    pending.resolve({
      ok: true,
      value: { items: [{ id: id(102) }], next: null, hasMore: false },
    } as never);
    await b;
    expect(f.selected).toEqual([{ projectId: id(1), conversationId: id(101) }]);
    expect(f.port.openProject).toHaveBeenCalledTimes(1);
    f.controller.dispose();
  });
});

it("keeps a project-free welcome aware of another window's creation during an older empty read", async () => {
  const f = fixture(0);
  const pending = deferred<{ ok: true; value: ResearchOutputs["project.list"] }>();
  f.port.listProjects.mockImplementationOnce(() => ({ result: pending.promise, cancel: vi.fn() }));
  const loading = f.controller.initialize(false);
  f.controller.noteProject();
  pending.resolve({ ok: true, value: { items: [], next: null, hasMore: false } });
  await loading;
  expect(f.controller.snapshot().hasProjects).toBe(true);
  expect(f.controller.snapshot().failed).toBe(true);
  f.projects.push(project(1));
  await f.controller.load();
  expect(f.controller.snapshot().items).toHaveLength(1);
  expect(f.selected).toEqual([]);
  f.controller.dispose();
});

it("supports type-ahead, Home, Tab and Alt-Up without committing navigation or IME input", async () => {
  const f = fixture(3);
  f.projects[2] = { ...project(3), title: "Zeta research", setupConfirmedAt: project(3).createdAt };
  const button = await mount(f);
  await act(async () => {
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, bubbles: true }),
    );
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    );
  });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  await act(async () => {
    button.click();
  });
  await key(button, "z");
  expect(document.querySelector('[aria-selected="true"]')?.getAttribute("title")).toBe(
    "Zeta research",
  );
  expect(f.selected).toEqual([]);
  await key(button, "Home");
  await key(button, "n");
  await key(button, "e");
  await key(button, "w");
  await key(button, " ");
  expect(button.getAttribute("aria-expanded")).toBe("true");
  await key(button, "Tab");
  expect(f.selected.at(-1)?.projectId).toBe(id(2));
  await act(async () => {
    button.click();
  });
  await key(button, "End");
  await act(async () => {
    button.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(f.selected.at(-1)?.projectId).toBe(id(3));
  f.controller.dispose();
});

it("handles pointer activation, outside dismissal and focus loss while keeping the selection explicit", async () => {
  const f = fixture(3);
  const button = await mount(f);
  await act(async () => {
    button.click();
  });
  const options = document.querySelectorAll<HTMLElement>("[role=option]");
  await act(async () => {
    options[1]!.dispatchEvent(new Event("pointermove", { bubbles: true }));
  });
  expect(options[1]!.getAttribute("aria-selected")).toBe("true");
  const pointer = new Event("pointerdown", { bubbles: true, cancelable: true });
  await act(async () => {
    options[1]!.dispatchEvent(pointer);
    options[1]!.click();
  });
  expect(pointer.defaultPrevented).toBe(true);
  expect(f.selected.at(-1)?.projectId).toBe(id(2));
  await act(async () => {
    button.click();
  });
  await act(async () => {
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  await act(async () => {
    button.click();
  });
  await act(async () => {
    button.click();
  });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  const outside = document.createElement("button");
  document.body.append(outside);
  await act(async () => {
    button.focus();
    button.click();
  });
  await act(async () => {
    outside.focus();
  });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  outside.remove();
  f.controller.dispose();
});

it("retains the current project after an opening read fails and offers a retry without losing saved projects", async () => {
  const f = fixture(2);
  const button = await mount(f);
  f.port.listConversations.mockImplementationOnce(() => call(failure("storage_failed")) as never);
  await act(async () => {
    button.click();
  });
  await key(button, "End");
  await key(button, "Enter");
  expect(f.selected).toEqual([]);
  expect(document.querySelector("[role=alert]")?.textContent).toContain(
    "couldn’t open the project",
  );
  const retry = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Try again",
  )!;
  expect(retry.closest("[role=alert]")).toBeNull();
  f.port.listConversations.mockImplementationOnce(() => call(failure("storage_failed")) as never);
  await act(async () => {
    retry.focus();
    retry.click();
  });
  expect(document.activeElement).toBe(button);
  expect(document.querySelector("[role=alert]")).not.toBeNull();
  const again = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Try again",
  )!;
  await act(async () => {
    again.focus();
    again.click();
  });
  expect(document.activeElement).toBe(button);
  expect(f.selected.at(-1)?.projectId).toBe(id(2));
  expect(document.querySelector("[role=alert]")).toBeNull();
  f.controller.dispose();
});

it("disables repeated Show more activation while its next page loads and highlights the appended page", async () => {
  const f = fixture();
  const button = await mount(f);
  await act(async () => {
    button.click();
  });
  const pending = deferred<{ ok: true; value: ResearchOutputs["project.list"] }>();
  f.port.listProjects.mockImplementationOnce(() => ({ result: pending.promise, cancel: vi.fn() }));
  const more = [...document.querySelectorAll<HTMLElement>("[role=option]")].at(-1)!;
  await act(async () => {
    more.dispatchEvent(new Event("pointermove", { bubbles: true }));
    more.click();
  });
  expect(more.getAttribute("aria-disabled")).toBe("true");
  expect(document.body.textContent).toContain("Loading more projects…");
  await act(async () => {
    more.click();
    void f.controller.load(true);
  });
  expect(f.port.listProjects).toHaveBeenCalledTimes(2);
  await act(async () => {
    document.querySelectorAll<HTMLElement>("[role=option]")[1]!.click();
  });
  expect(f.selected.at(-1)?.projectId).toBe(id(2));
  expect(button.getAttribute("aria-expanded")).toBe("false");
  await act(async () => {
    pending.resolve({
      ok: true,
      value: {
        items: f.projects.slice(40, 80),
        next: { id: id(80), lastOpenedAt: project(80).lastOpenedAt },
        hasMore: true,
      },
    });
  });
  expect(f.controller.snapshot().items).toHaveLength(80);
  expect(f.selected.at(-1)?.projectId).toBe(id(2));
  await act(async () => {
    button.click();
  });
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>("[role=option]")].at(-1)!.click();
  });
  expect(document.querySelectorAll("[role=option]")).toHaveLength(81);
  expect(document.querySelector('[aria-selected="true"]')?.id).toMatch(/option-40$/);
  f.controller.dispose();
});

it("ignores superseded and disposed project reads and never starts an opening after disposal", async () => {
  const f = fixture(2);
  const old = deferred<{ ok: true; value: ResearchOutputs["project.list"] }>();
  f.port.listProjects.mockImplementationOnce(() => ({ result: old.promise, cancel: vi.fn() }));
  const stale = f.controller.load();
  await f.controller.load();
  old.resolve({ ok: true, value: { items: [], next: null, hasMore: false } });
  await stale;
  expect(f.controller.snapshot().items).toHaveLength(2);
  const pending = deferred<never>();
  f.port.listConversations.mockImplementationOnce(() => ({
    result: pending.promise,
    cancel: vi.fn(),
  }));
  const opening = f.controller.open(id(2));
  f.controller.dispose();
  pending.resolve({
    ok: true,
    value: { items: [{ id: id(2) }], next: null, hasMore: false },
  } as never);
  await opening;
  await f.controller.open(id(1));
  await f.controller.initialize(true);
  await f.controller.load();
  f.controller.adopt({ projectId: id(1), conversationId: id(1) });
  expect(f.port.listConversations).toHaveBeenCalledTimes(1);
  expect(f.selected).toEqual([]);
});

it("honors closed Home, End and Up after delayed fresh reads without committing selection", async () => {
  for (const [opener, index] of [
    ["Home", 0],
    ["End", 2],
    ["ArrowUp", 0],
  ] as const) {
    const f = fixture(3);
    const pending = deferred<{ ok: true; value: ResearchOutputs["project.list"] }>();
    f.port.listProjects.mockReturnValueOnce({ result: pending.promise, cancel: vi.fn() });
    const button = await mount(f, f.projects[1]);
    const closedEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => button.dispatchEvent(closedEscape));
    expect(closedEscape.defaultPrevented).toBe(false);
    await key(button, opener);
    expect(button.hasAttribute("aria-activedescendant")).toBe(false);
    await act(async () =>
      pending.resolve({ ok: true, value: { items: f.projects, next: null, hasMore: false } }),
    );
    expect(button.getAttribute("aria-activedescendant")).toMatch(new RegExp(`option-${index}$`));
    expect(f.selected).toEqual([]);
    await key(button, "Escape");
    f.controller.dispose();
  }
});
it("anchors a restoration failure to the selector before its first opening and after resize", async () => {
  const f = fixture(2);
  f.port.listConversations.mockImplementationOnce(() => call(failure("storage_failed")) as never);
  const button = await mount(f);
  let rect = { bottom: 56, left: 200 } as DOMRect;
  vi.spyOn(button, "getBoundingClientRect").mockImplementation(() => rect);
  await act(async () => f.controller.initialize(true));
  const notice = container.querySelector<HTMLElement>(".project-selector-open-error")!;
  expect([notice.style.top, notice.style.left]).toEqual(["56px", "200px"]);
  rect = { bottom: 80, left: 240 } as DOMRect;
  await act(async () => window.dispatchEvent(new Event("resize")));
  expect([notice.style.top, notice.style.left]).toEqual(["80px", "240px"]);
  f.controller.dispose();
});
it("retries pending initial restoration through a fresh selector read and lets New project supersede it", async () => {
  const f = fixture(3);
  const pending = deferred<{ ok: true; value: ResearchOutputs["project.list"] }>();
  f.port.listProjects.mockReturnValueOnce({ result: pending.promise, cancel: vi.fn() });
  const initial = f.controller.initialize(true);
  await f.controller.load();
  expect(f.selected.at(-1)?.projectId).toBe(id(1));
  pending.resolve({ ok: true, value: { items: [], next: null, hasMore: false } });
  await initial;
  expect(f.selected).toHaveLength(1);
  f.controller.dispose();
  const g = fixture(3);
  g.port.listProjects.mockImplementationOnce(() => call(failure("storage_failed")) as never);
  await g.controller.initialize(true);
  expect(g.selected).toEqual([]);
  await g.controller.load();
  expect(g.selected.at(-1)?.projectId).toBe(id(1));
  g.controller.dispose();
  const c = fixture(3);
  const beforeCreation = deferred<{ ok: true; value: ResearchOutputs["project.list"] }>();
  c.port.listProjects.mockReturnValueOnce({ result: beforeCreation.promise, cancel: vi.fn() });
  const restore = c.controller.initialize(true);
  const revision = c.controller.beginCreation();
  beforeCreation.resolve({ ok: true, value: { items: c.projects, next: null, hasMore: false } });
  await restore;
  expect(c.selected).toEqual([]);
  expect(c.controller.adopt({ projectId: id(3), conversationId: id(3) }, revision)).toBe(true);
  expect(c.selected).toEqual([{ projectId: id(3), conversationId: id(3) }]);
  c.controller.dispose();
});
it("keeps the known current title while a fresh list read loads or fails", async () => {
  const f = fixture(3);
  Object.assign(f.projects[0]!, {
    title: "Remembered thesis",
    setupConfirmedAt: project(1).createdAt,
  });
  await f.controller.load();
  function View() {
    const state = useSyncExternalStore(f.controller.subscribe, f.controller.snapshot);
    return h(ProjectSelector, {
      controller: f.controller,
      state,
      current: f.controller.project(id(1)),
      currentId: id(1),
      locale: "en-US",
    });
  }
  await act(async () => root.render(h(View)));
  const button = container.querySelector<HTMLButtonElement>("[role=combobox]")!;
  const pending = deferred<ReturnType<typeof failure>>();
  f.port.listProjects.mockImplementationOnce(
    () => ({ result: pending.promise, cancel: vi.fn() }) as never,
  );
  await act(async () => button.click());
  expect(button.textContent).toContain("Remembered thesis");
  await act(async () => pending.resolve(failure("storage_failed")));
  expect(button.textContent).toContain("Remembered thesis");
  expect(document.querySelector("[role=alert]")?.textContent).toContain(
    "couldn’t load the projects",
  );
  expect(button.textContent).not.toContain("couldn’t open");
  await act(async () => f.controller.load());
  await act(async () =>
    root.render(
      h(ProjectSelector, {
        controller: f.controller,
        state: f.controller.snapshot(),
        current: undefined,
        currentId: id(2),
        currentFailed: true,
        locale: "en-US",
      }),
    ),
  );
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain(
    "couldn’t load the projects",
  );
  f.controller.dispose();
});

it("highlights the current project after Reload succeeds even when another project is first", async () => {
  const f = fixture(3);
  const button = await mount(f, f.projects[1]);
  f.port.listProjects.mockImplementationOnce(() => call(failure("storage_failed")) as never);
  await key(button, "ArrowDown");
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  await key(button, "Enter");
  expect(button.getAttribute("aria-activedescendant")).toMatch(/option-1$/);
  expect(document.querySelector('[aria-current="true"]')?.getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(f.selected).toEqual([]);
  await key(button, "Enter");
  expect(f.selected.at(-1)?.projectId).toBe(id(2));
  f.controller.dispose();
});
it("surfaces a failed startup read outside the closed selector and restores on its focused Reload", async () => {
  const f = fixture(3);
  f.port.listProjects.mockImplementationOnce(() => call(failure("storage_failed")) as never);
  const button = await mount(f);
  const region = document.querySelector('[role="status"]')!;
  await act(async () => f.controller.initialize(true));
  expect(button.getAttribute("aria-expanded")).toBe("false");
  const alert = container.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("couldn’t load the projects");
  const retry = [...container.querySelectorAll("button")].find(
    (n) => n.textContent === "Reload projects",
  )!;
  expect(retry.closest('[role="alert"]')).toBeNull();
  await act(async () => {
    retry.focus();
    retry.click();
  });
  expect(document.activeElement).toBe(button);
  expect(f.selected.at(-1)?.projectId).toBe(id(1));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[role="status"]')).toBe(region);
  f.controller.dispose();
});
it("keeps one persistent polite region and associates loading and empty descriptions with the combobox and listbox", async () => {
  const f = fixture(0);
  const button = await mount(f, undefined);
  const region = document.querySelector<HTMLElement>('[role="status"]')!;
  expect(region.textContent).toBe("");
  const pending = deferred<{ ok: true; value: ResearchOutputs["project.list"] }>();
  f.port.listProjects.mockReturnValueOnce({ result: pending.promise, cancel: vi.fn() });
  await key(button, "ArrowDown");
  expect(document.querySelector('[role="status"]')).toBe(region);
  expect(region.textContent).toBe("Loading…");
  expect(button.getAttribute("aria-describedby")).toBe(region.id);
  expect(document.querySelector('[role="listbox"]')?.getAttribute("aria-describedby")).toBe(
    region.id,
  );
  await act(async () =>
    pending.resolve({ ok: true, value: { items: [], next: null, hasMore: false } }),
  );
  expect(region.textContent).toBe("No projects yet.");
  expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(document.querySelector('[role="status"]')).toBe(region);
  await key(button, "Escape");
  expect(region.textContent).toBe("");
  expect(document.querySelector('[role="status"]')).toBe(region);
  f.controller.dispose();
});

it("refreshes the selector when adoption supersedes its read without publishing an empty result", async () => {
  const f = fixture(3);
  const revision = f.controller.beginCreation();
  const old = deferred<{ ok: true; value: ResearchOutputs["project.list"] }>();
  const fresh = deferred<{ ok: true; value: ResearchOutputs["project.list"] }>();
  f.port.listProjects
    .mockReturnValueOnce({ result: old.promise, cancel: vi.fn() })
    .mockReturnValueOnce({ result: fresh.promise, cancel: vi.fn() });
  const button = await mount(f);
  await key(button, "ArrowDown");
  await act(async () => {
    f.controller.adopt({ projectId: id(3), conversationId: id(3) }, revision);
  });
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Loading…");
  expect(document.body.textContent).not.toContain("No projects yet.");
  await act(async () =>
    old.resolve({ ok: true, value: { items: [], next: null, hasMore: false } }),
  );
  expect(document.body.textContent).not.toContain("No projects yet.");
  await act(async () =>
    fresh.resolve({ ok: true, value: { items: f.projects, next: null, hasMore: false } }),
  );
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
  expect(f.port.listProjects).toHaveBeenCalledTimes(2);
  expect(f.selected.at(-1)?.projectId).toBe(id(3));
  f.controller.dispose();
});
it("dismisses acknowledged failures, restores focus and exposes a later failure as a new notice", async () => {
  const f = fixture(3);
  const button = await mount(f);
  f.port.listProjects.mockImplementation(() => call(failure("storage_failed")) as never);
  await act(async () => f.controller.initialize(false));
  const revision = f.controller.snapshot().failureRevision;
  const dismiss = [...container.querySelectorAll("button")].find(
    (n) => n.textContent === "Dismiss",
  )!;
  await act(async () => {
    dismiss.focus();
    dismiss.click();
  });
  expect(document.activeElement).toBe(button);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(f.controller.snapshot().failed).toBe(true);
  expect(button.getAttribute("aria-describedby")).toContain("failure");
  await act(async () => f.controller.load());
  expect(f.controller.snapshot().failureRevision).toBeGreaterThan(revision);
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await key(button, "ArrowDown");
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await key(button, "Escape");
  expect(document.querySelector('[role="alert"]')).toBeNull();
  f.controller.dispose();
});
it("clears failed-list typeahead when pointer Reload restores current highlighting", async () => {
  const f = fixture(3);
  Object.assign(f.projects[0]!, { title: "Query match", setupConfirmedAt: project(1).createdAt });
  const button = await mount(f, f.projects[1]);
  f.port.listProjects.mockImplementationOnce(() => call(failure("storage_failed")) as never);
  await key(button, "ArrowDown");
  await key(button, "Q");
  await act(async () => document.querySelector<HTMLElement>(".project-selector-more")!.click());
  expect(button.getAttribute("aria-activedescendant")).toMatch(/option-1$/);
  expect(f.selected).toEqual([]);
  f.controller.dispose();
});

it("keeps outside focus unobscured when a notice appears and dismisses it on later focus, resize or pointer departure", async () => {
  const f = fixture(3);
  const button = await mount(f);
  const first = document.createElement("button");
  const second = document.createElement("button");
  document.body.append(first, second);
  let firstRect = new DOMRect(110, 50, 40, 32);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this === button) return new DOMRect(124, 8, 200, 32);
    if (this === first) return firstRect;
    if (this === second) return new DOMRect(800, 500, 80, 32);
    if (this.classList.contains("project-selector-open-error"))
      return new DOMRect(124, 40, 360, 120);
    return new DOMRect();
  });
  f.port.listProjects.mockImplementation(() => call(failure("storage_failed")) as never);
  await act(async () => {
    first.focus();
    await f.controller.initialize(false);
  });
  expect(document.activeElement).toBe(first);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  firstRect = new DOMRect(800, 500, 80, 32);
  await act(async () => f.controller.load());
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => second.focus());
  expect(document.activeElement).toBe(second);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => f.controller.load());
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => window.dispatchEvent(new Event("resize")));
  expect(document.activeElement).toBe(second);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => {
    button.focus();
    await f.controller.load();
  });
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(document.querySelector('[role="alert"]')).toBeNull();
  first.remove();
  second.remove();
  f.controller.dispose();
});

it("reconciles high highlights and pending pagination across successful and failed adoption replacements", async () => {
  for (const outcome of ["success", "failure"] as const) {
    const f = fixture(95);
    const revision = f.controller.beginCreation();
    function View() {
      const state = useSyncExternalStore(f.controller.subscribe, f.controller.snapshot);
      const currentId = f.selected.at(-1)?.projectId ?? id(1);
      return h(ProjectSelector, {
        controller: f.controller,
        state,
        current: f.controller.project(currentId) ?? f.projects[0],
        currentId,
        locale: "en-US",
      });
    }
    await act(async () => root.render(h(View)));
    const button = container.querySelector<HTMLElement>('[role="combobox"]')!;
    await key(button, "ArrowDown");
    await key(button, "End");
    await key(button, "Enter");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(81);
    await act(async () =>
      document
        .querySelectorAll('[role="option"]')[50]!
        .dispatchEvent(new Event("pointermove", { bubbles: true })),
    );
    const more = deferred<{ ok: true; value: ResearchOutputs["project.list"] }>();
    const oldRows = f.projects.slice(80);
    if (outcome === "failure") {
      f.port.listProjects.mockReturnValueOnce({ result: more.promise, cancel: vi.fn() });
      await key(button, "End");
      await key(button, "Enter");
    }
    const fresh = deferred<
      { ok: true; value: ResearchOutputs["project.list"] } | ReturnType<typeof failure>
    >();
    f.port.listProjects.mockImplementationOnce(
      () => ({ result: fresh.promise, cancel: vi.fn() }) as never,
    );
    f.projects.unshift(project(96));
    await act(async () => {
      f.controller.adopt({ projectId: id(96), conversationId: id(96) }, revision);
    });
    expect(button.hasAttribute("aria-activedescendant")).toBe(false);
    const rows = f.projects.slice(0, 40);
    const last = rows.at(-1)!;
    await act(async () =>
      fresh.resolve(
        outcome === "success"
          ? {
              ok: true,
              value: {
                items: rows,
                next: { id: last.id, lastOpenedAt: last.lastOpenedAt },
                hasMore: true,
              },
            }
          : failure("storage_failed"),
      ),
    );
    expect(button.getAttribute("aria-activedescendant")).toMatch(/option-0$/);
    expect(document.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(1);
    if (outcome === "failure") {
      await act(async () =>
        more.resolve({ ok: true, value: { items: oldRows, next: null, hasMore: false } }),
      );
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
      await key(button, "Enter");
      expect(f.port.listProjects.mock.calls.at(-1)?.[0]).toEqual({ cursor: null, count: 40 });
    }
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(41);
    expect(f.selected.at(-1)?.projectId).toBe(id(96));
    await key(button, "Escape");
    f.controller.dispose();
  }
});
it("keeps closed-notice actions present when Tab leaves the combobox", async () => {
  const f = fixture(3);
  const button = await mount(f);
  f.port.listProjects.mockImplementationOnce(() => call(failure("storage_failed")) as never);
  await act(async () => f.controller.initialize(false));
  await act(async () => button.focus());
  await key(button, "Tab");
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect([...container.querySelectorAll("button")].map((n) => n.textContent)).toEqual(
    expect.arrayContaining(["Reload projects", "Dismiss"]),
  );
  f.controller.dispose();
});
