// @vitest-environment jsdom
import { act, createElement as h, StrictMode, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionMenu,
  Button,
  Choice,
  Confirmation,
  DataTable,
  Dialog,
  ErrorSummary,
  Form,
  IconButton,
  Link,
  Notice,
  OperationStatus,
  Panel,
  Popover,
  Progress,
  Selector,
  Separator,
  Skeleton,
  StateLabel,
  Tabs,
  TextField,
  ToastRegion,
  Tooltip,
  useFieldDraft,
  type PresentationEvent,
} from "../packages/renderer/src/index.js";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let disconnect: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect = disconnect;
    },
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(node: Parameters<Root["render"]>[0]) {
  await act(async () => root.render(node));
}
async function click(node: Element) {
  await act(async () => (node as HTMLElement).click());
}
async function key(node: Element, value: string, extra = {}) {
  await act(async () =>
    node.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra }),
    ),
  );
}
async function focus(node: Element) {
  await act(async () => (node as HTMLElement).focus());
}
function button() {
  return container.querySelector("button")!;
}

describe("semantic actions and fields", () => {
  it("retains loading labels and explains unavailable actions without dispatch", async () => {
    const onPress = vi.fn();
    for (const variant of ["primary", "secondary", "quiet", "destructive"] as const) {
      await render(h(Button, { label: "Save draft", onPress, variant, loadingLabel: "Saving" }));
      expect(button().textContent).toBe("Save draft");
      expect(button().getAttribute("aria-busy")).toBe("true");
      await click(button());
      expect(onPress).not.toHaveBeenCalled();
    }
    await render(h(Button, { label: "Save draft", onPress, disabledReason: "Open a project" }));
    await click(button());
    expect(container.textContent).toContain("Open a project");
    await render(h(Button, { label: "Save draft", onPress }));
    await click(button());
    expect(onPress).toHaveBeenCalledOnce();
    await render(
      h(IconButton, { label: "Add source", icon: "+", onPress, disabledReason: "Offline" }),
    );
    await click(button());
    expect(onPress).toHaveBeenCalledOnce();
    await render(h(IconButton, { label: "Add source", icon: "+", onPress }));
    await focus(button());
    expect(button().getAttribute("aria-describedby")).toBe(
      container.querySelector('[role="tooltip"]')!.id,
    );
    await click(button());
    expect(onPress).toHaveBeenCalledTimes(2);
  });
  it("admits safe links and keeps external destinations identified", async () => {
    await render(
      h(Link, { href: "https://example.org", externalLabel: "external", children: "Source" }),
    );
    expect(container.textContent).toContain("external");
    await render(h(Link, { href: "javascript:alert(1)", children: "Source" }));
    expect(container.querySelector("a")!.hasAttribute("href")).toBe(false);
  });
  it("validates on blur after composition and preserves errors and input", async () => {
    const validate = vi.fn(),
      edit = vi.fn();
    const props = {
      id: "title",
      label: "Title",
      help: "Enter the original title",
      error: "Use a title",
      value: "연구",
      onChange: edit,
      onValidate: validate,
    };
    await render(h(TextField, props));
    const input = container.querySelector("input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("title-help title-error");
    await focus(input);
    await act(async () =>
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    await act(async () => input.blur());
    expect(validate).not.toHaveBeenCalled();
    await act(async () =>
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
    );
    expect(validate).toHaveBeenCalledWith("연구");
    expect(input.value).toBe("연구");
    await focus(input);
    await act(async () => input.blur());
    expect(validate).toHaveBeenCalledTimes(2);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      set.call(input, "New title");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(edit).toHaveBeenCalledWith("New title");
    await render(h(TextField, { ...props, disabledReason: "Read only" }));
    expect(input.readOnly).toBe(true);
  });
  it("exposes native selection and immediate switch semantics with controlled callbacks", async () => {
    const change = vi.fn();
    const props = {
      id: "select",
      label: "Source type",
      value: "article",
      options: [
        { value: "article", label: "Article" },
        { value: "book", label: "Book" },
      ],
      onChange: change,
    };
    await render(h(Selector, props));
    const select = container.querySelector("select")!;
    await act(async () => {
      select.value = "book";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(change).toHaveBeenCalledWith("book");
    await render(h(Selector, { ...props, disabledReason: "Saving" }));
    await act(async () => select.dispatchEvent(new Event("change", { bubbles: true })));
    expect(change).toHaveBeenCalledOnce();
    for (const kind of ["checkbox", "radio", "switch"] as const) {
      await render(h(Choice, { id: kind, label: kind, kind, checked: false, onChange: change }));
      await click(container.querySelector("input")!);
    }
    expect(container.querySelector("input")!.getAttribute("role")).toBe("switch");
    const calls = change.mock.calls.length;
    await render(
      h(Choice, {
        id: "check",
        label: "Check",
        kind: "checkbox",
        checked: false,
        onChange: change,
        disabledReason: "Unavailable",
      }),
    );
    await click(container.querySelector("input")!);
    expect(change).toHaveBeenCalledTimes(calls);
  });
  it("focuses a linked error summary on submission, without passive focus theft", async () => {
    const errors = [{ fieldId: "title", message: "Enter a title" }];
    const tree = (submission: number, currentErrors = errors) =>
      h(
        "div",
        {},
        h("input", { id: "title" }),
        h(ErrorSummary, { title: "Correct title", errors: currentErrors, submission }),
      );
    await render(tree(1));
    expect(document.activeElement).toBe(container.querySelector('[role="alert"]'));
    await click(container.querySelector("a")!);
    expect(document.activeElement).toBe(container.querySelector("input"));
    await render(tree(1));
    expect(document.activeElement).toBe(container.querySelector("input"));
    await render(tree(2));
    expect(document.activeElement).toBe(container.querySelector('[role="alert"]'));
    await render(tree(2, []));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await focus(container.querySelector("input")!);
    await render(tree(2));
    expect(document.activeElement).toBe(container.querySelector("input"));
  });
  it("blocks composition submission and validates an explicit submit", async () => {
    const submit = vi.fn();
    await render(h(Form, { onSubmit: submit, children: h("input") }));
    const form = container.querySelector("form")!;
    await act(async () =>
      form.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    );
    await key(form, "Enter");
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(submit).not.toHaveBeenCalled();
    await act(async () =>
      form.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
    );
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(submit).toHaveBeenCalledOnce();
  });
  it("ignores late acknowledgements after newer edits, A→B→A, and disposal", async () => {
    let draft!: ReturnType<typeof useFieldDraft>;
    function Harness() {
      draft = useFieldDraft("A");
      return h("input", { value: draft.value, readOnly: true });
    }
    await render(h(Harness));
    const sent = draft.capture();
    await act(async () => {
      draft.edit("B");
      draft.edit("A");
    });
    await act(async () => expect(draft.acknowledge(sent)).toBe(false));
    expect(draft.value).toBe("A");
    const current = draft.capture();
    await act(async () => expect(draft.acknowledge(current)).toBe(true));
    expect(draft.value).toBe("");
    const disposed = draft.capture();
    await render(null);
    expect(draft.acknowledge(disposed)).toBe(false);
  });
});
describe("tabs and layers", () => {
  it("moves tab focus without selection and keeps close buttons as siblings", async () => {
    const select = vi.fn(),
      close = vi.fn();
    const items = [
      { id: "one", label: "One", content: "First" },
      { id: "two", label: "Two", content: "Second", closeLabel: "Close Two" },
    ];
    await render(
      h(Tabs, { label: "Views", items, selected: "one", onSelect: select, onClose: close }),
    );
    const tabs = container.querySelectorAll('[role="tab"]');
    await focus(tabs[0]!);
    await key(tabs[0]!, "ArrowRight");
    expect(document.activeElement).toBe(tabs[1]);
    expect(select).not.toHaveBeenCalled();
    await key(tabs[1]!, "Home");
    expect(document.activeElement).toBe(tabs[0]);
    await key(tabs[0]!, "End");
    expect(document.activeElement).toBe(tabs[1]);
    await key(tabs[1]!, "ArrowLeft");
    await key(tabs[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(tabs[1]);
    await click(tabs[1]!);
    expect(select).toHaveBeenCalledWith("two");
    await key(tabs[1]!, "Delete");
    expect(close).toHaveBeenCalledWith("two");
    const sibling = container.querySelector('[aria-label="Close Two"]')!;
    expect(sibling.parentElement).toBe(tabs[1]!.parentElement);
    await click(sibling);
    expect(close).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="tabpanel"][hidden]')!.textContent).toBe("Second");
    await focus(sibling);
    await render(
      h(Tabs, {
        label: "Views",
        items: [items[0]!],
        selected: "one",
        onSelect: select,
        onClose: close,
      }),
    );
    expect(document.activeElement).toBe(container.querySelector('[role="tab"]'));
  });
  it("keeps help hoverable, dismisses by Escape and cleans positioning observers", async () => {
    await render(h(Tooltip, { label: "Optional help", children: h("button", {}, "Help") }));
    await focus(button());
    const tip = container.querySelector('[role="tooltip"]')!;
    expect(tip.textContent).toBe("Optional help");
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    expect(disconnect).toHaveBeenCalled();
    await act(async () => button().blur());
    await focus(button());
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull();
    await render(null);
    const calls = disconnect.mock.calls.length;
    await key(document.body, "Escape");
    expect(disconnect).toHaveBeenCalledTimes(calls);
  });
  it("opens/closes a popover, restores focus and disposes outside listeners", async () => {
    await render(
      h(Popover, { label: "Details", closeLabel: "Close details", children: "Supplement" }),
    );
    await click(button());
    expect(document.activeElement).toBe(container.querySelector('[role="region"]'));
    await key(document.activeElement!, "Escape");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button());
    await click(button());
    await click(container.querySelector('[role="region"] button')!);
    expect(document.activeElement).toBe(button());
    await click(button());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(container.querySelector('[role="region"]')).toBeNull();
  });
  it("uses action menus with roving keys, disabled explanations and contextual access", async () => {
    const action = vi.fn();
    await render(
      h(ActionMenu, {
        label: "Actions",
        contextual: true,
        actions: [
          { id: "first", label: "First", onPress: action },
          { id: "blocked", label: "Blocked", disabledReason: "In use", onPress: action },
        ],
      }),
    );
    await key(button(), "F10", { shiftKey: true });
    const items = container.querySelectorAll('[role="menuitem"]');
    expect(document.activeElement).toBe(items[0]);
    await key(items[0]!, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    await click(items[1]!);
    expect(action).not.toHaveBeenCalled();
    await key(items[1]!, "Home");
    await key(items[0]!, "End");
    await key(items[1]!, "ArrowUp");
    await click(items[0]!);
    expect(action).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button());
    await key(button(), "ArrowDown");
    await key(container.querySelector('[role="menuitem"]')!, "Escape");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await act(async () =>
      container.firstElementChild!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    await key(container.querySelector('[role="menuitem"]')!, "Tab");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await click(button());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });
  it("opens a single modal, requests cancellation and restores its connected trigger", async () => {
    const close = vi.fn();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    await render(
      h(Dialog, {
        open: true,
        title: "Details",
        closeLabel: "Close",
        onClose: close,
        children: h(
          "div",
          {},
          h("input", { type: "radio", name: "group", defaultChecked: true }),
          h("input", { type: "radio", name: "group" }),
          h("button", { type: "button" }, "Last"),
          h("button", { type: "button", hidden: true }, "Hidden"),
          h("button", { type: "button", disabled: true }, "Disabled"),
        ),
      }),
    );
    expect(container.querySelector("dialog")!.open).toBe(true);
    for (const element of container.querySelectorAll("button, input"))
      Object.defineProperty(element, "getClientRects", {
        value: () => (element.hasAttribute("hidden") ? [] : [{}]),
      });
    await key(button(), "Tab", { shiftKey: true });
    expect(document.activeElement!.textContent).toBe("Last");
    await key(document.activeElement!, "Tab");
    expect(document.activeElement).toBe(button());
    await key(button(), "Tab");
    expect(document.activeElement).toBe(container.querySelector("input:checked"));
    await key(document.activeElement!, "Tab");
    expect(document.activeElement!.textContent).toBe("Last");
    await focus(button());
    expect(document.activeElement).toBe(button());
    await act(async () =>
      container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })),
    );
    expect(close).toHaveBeenCalledOnce();
    await key(button(), "Escape");
    await key(button(), "Escape");
    expect(container.querySelector("dialog")!.open).toBe(true);
    expect(close).toHaveBeenCalledTimes(3);
    close.mockClear();
    await click(button());
    expect(close).toHaveBeenCalledOnce();
    await render(null);
    expect(document.activeElement).toBe(trigger);
    await render(
      h(Confirmation, {
        open: true,
        title: "Delete source?",
        consequences: "Synthetic only",
        cancelLabel: "Keep source",
        confirmLabel: "Delete",
        onCancel: close,
        onConfirm: close,
        disabledReason: "In use",
      }),
    );
    expect(document.activeElement).toBe(container.querySelector("[data-safe]"));
    const blocked = container.querySelector('[aria-disabled="true"]')!;
    expect(document.getElementById(blocked.getAttribute("aria-describedby")!)!.textContent).toBe(
      "In use",
    );
    await click(container.querySelector('[aria-disabled="true"]')!);
    expect(close).toHaveBeenCalledOnce();
    await click(container.querySelector("[data-safe]")!);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
describe("controlled presentation", () => {
  it("announces current outcomes once, ignores old operations/revisions and keeps snapshots passive", async () => {
    const event: PresentationEvent = {
      operationId: "one",
      revision: 1,
      phase: "accepted",
      label: "Accepted",
      source: "snapshot",
    };
    await render(h(OperationStatus, { operationId: "one", event }));
    expect(container.querySelector('[role="status"]')!.textContent).toBe("");
    await render(
      h(OperationStatus, { operationId: "one", event: { ...event, source: "response" } }),
    );
    const live = container.querySelector('[role="status"]')!;
    expect(live.textContent).toBe("Accepted");
    const observer = new MutationObserver(() => {});
    const mutation = vi.fn();
    observer.disconnect();
    const watcher = new MutationObserver(mutation);
    watcher.observe(live, { subtree: true, childList: true, characterData: true });
    await render(
      h(OperationStatus, { operationId: "one", event: { ...event, source: "response" } }),
    );
    expect(mutation).not.toHaveBeenCalled();
    watcher.disconnect();
    await render(
      h(OperationStatus, {
        operationId: "one",
        event: { ...event, revision: 0, phase: "failed", label: "Old failure", source: "response" },
      }),
    );
    expect(container.textContent).not.toContain("Old failure");
    await render(h(OperationStatus, { operationId: "two", event }));
    expect(container.textContent).toBe("");
    await render(
      h(OperationStatus, {
        operationId: "two",
        event: {
          ...event,
          operationId: "two",
          revision: 2,
          phase: "failed",
          label: "Retry explicitly",
          source: "response",
        },
      }),
    );
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Retry explicitly");
    await render(
      h(OperationStatus, {
        operationId: "two",
        event: { ...event, operationId: "two", revision: NaN },
      }),
    );
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Retry explicitly");
  });
  it("exposes persistent notices, labels, one toast slot, bounded tables and loading semantics", async () => {
    const action = vi.fn();
    await render(
      h(
        "div",
        {},
        h(Notice, {
          title: "Failed",
          tone: "danger",
          children: "Your input is safe",
          action: { label: "Retry", onPress: action },
        }),
        h(StateLabel, { phase: "review-required", label: "Review required" }),
        h(Skeleton, { label: "Loading" }),
        h(Progress, { label: "Import", phase: "Reading", value: 2, max: 5 }),
        h(Panel, { label: "Hidden", hidden: true, children: "Private input" }),
        h(Separator, {}),
      ),
    );
    await click(button());
    expect(action).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector("progress")!.value).toBe(2);
    expect(container.querySelector('[data-phase="review-required"] svg')).not.toBeNull();
    expect(container.querySelector("[hidden]")).not.toBeNull();
    await render(
      h(ToastRegion, {
        toast: { id: "1", label: "Accepted" },
        dismissLabel: "Dismiss",
        onDismiss: action,
      }),
    );
    await click(button());
    expect(action).toHaveBeenLastCalledWith("1");
    await render(
      h(ToastRegion, {
        toast: { id: "2", label: "Second" },
        dismissLabel: "Dismiss",
        onDismiss: action,
      }),
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.textContent).not.toContain("Accepted");
    await render(h(ToastRegion, { dismissLabel: "Dismiss", onDismiss: action }));
    expect(container.textContent).toBe("");
    const props = {
      label: "Sources",
      columns: [{ id: "count", label: "Pages", numeric: true }],
      rows: [{ id: "1", heading: "Source", cells: { count: 120 } }],
      sort: { column: "count", direction: "ascending" as const, label: "Pages ascending" },
      onSort: action,
      more: { label: "Next batch", onPress: action },
    };
    await render(h(DataTable, props));
    expect(container.querySelector('[aria-sort="ascending"]')).not.toBeNull();
    expect(container.querySelector('[scope="row"]')!.textContent).toBe("Source");
    expect(container.querySelector("td")!.className).toBe("primitive-numeric");
    await click(button());
    expect(action).toHaveBeenLastCalledWith("count");
    await render(h(DataTable, { ...props, compact: true }));
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("dt")!.textContent).toBe("Pages");
    await click(button());
    await render(h(Progress, { label: "Import", phase: "Waiting" }));
    expect(container.querySelector('[role="progressbar"]')!.hasAttribute("aria-valuenow")).toBe(
      false,
    );
  });
});

it("exposes each distinct same-text outcome and suppresses A→B→A replay", async () => {
  const base: PresentationEvent = {
    operationId: "A",
    revision: 1,
    phase: "accepted",
    label: "Accepted",
    source: "response",
  };
  await render(h(OperationStatus, { operationId: "A", event: base }));
  const live = container.querySelector('[role="status"]')!;
  const changed = vi.fn();
  const observer = new MutationObserver(changed);
  observer.observe(live, { childList: true, subtree: true, characterData: true });
  await render(h(OperationStatus, { operationId: "A", event: { ...base, revision: 2 } }));
  expect(changed).toHaveBeenCalled();
  changed.mockClear();
  await render(h(OperationStatus, { operationId: "A", event: { ...base, revision: 2 } }));
  expect(changed).not.toHaveBeenCalled();
  await render(h(OperationStatus, { operationId: "B", event: { ...base, operationId: "B" } }));
  expect(changed).toHaveBeenCalled();
  changed.mockClear();
  await render(h(OperationStatus, { operationId: "A", event: { ...base, revision: 2 } }));
  expect(live.textContent).toBe("");
  await render(
    h(OperationStatus, {
      operationId: "A",
      event: { ...base, revision: 3, phase: "failed", label: "Retry explicitly" },
    }),
  );
  const alert = container.querySelector('[role="alert"]')!;
  const old = alert.firstChild;
  await render(
    h(OperationStatus, {
      operationId: "C",
      event: { ...base, operationId: "C", phase: "failed", label: "Retry explicitly" },
    }),
  );
  expect(alert.textContent).toBe("Retry explicitly");
  expect(alert.firstChild).not.toBe(old);
  observer.disconnect();
});
it("announces loading transitions while preserving labels and focus", async () => {
  const props = { label: "Save draft", onPress: vi.fn() };
  await render(h(Button, props));
  await focus(button());
  await render(h(Button, { ...props, loadingLabel: "Saving draft" }));
  expect(document.activeElement).toBe(button());
  expect(button().textContent).toBe("Save draft");
  expect(container.querySelector('[role="status"]')!.textContent).toBe("Saving draft");
  await render(h(IconButton, { ...props, icon: "+" }));
  await focus(button());
  await render(h(IconButton, { ...props, icon: "+", loadingLabel: "Saving draft" }));
  expect(container.querySelector('[role="status"]')!.textContent).toBe("Saving draft");
});
it("rejects a second modal without displacing the admitted dialog", async () => {
  const close = vi.fn();
  await render(
    h(
      "div",
      {},
      h(Dialog, {
        open: true,
        title: "First",
        closeLabel: "Close first",
        onClose: vi.fn(),
        children: "First content",
      }),
      h(Dialog, {
        open: true,
        title: "Second",
        closeLabel: "Close second",
        onClose: close,
        children: "Second content",
      }),
    ),
  );
  expect(container.querySelectorAll("dialog[open]")).toHaveLength(1);
  expect(close).toHaveBeenCalledOnce();
  expect(document.activeElement!.textContent).toBe("Close first");
});
it("nested help Escape prevents native modal cancellation", async () => {
  const close = vi.fn();
  await render(
    h(Dialog, {
      open: true,
      title: "Layered",
      closeLabel: "Close",
      onClose: close,
      children: h(Tooltip, { label: "Optional help", children: h("button", {}, "Help") }),
    }),
  );
  const help = container.querySelectorAll("button")[1]!;
  await focus(help);
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => help.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(close).not.toHaveBeenCalled();
  expect(container.querySelector('[role="tooltip"]')).toBeNull();
  await render(
    h(Dialog, {
      open: true,
      title: "Layered",
      closeLabel: "Close",
      onClose: close,
      children: h(Popover, {
        label: "Details",
        closeLabel: "Close details",
        children: "Supplement",
      }),
    }),
  );
  const trigger = container.querySelectorAll("button")[1]!;
  await click(trigger);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => container.querySelector('[role="region"]')!.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(close).not.toHaveBeenCalled();
});
it("removes document and viewport listeners on layer disposal", async () => {
  const added = vi.spyOn(document, "addEventListener"),
    removed = vi.spyOn(document, "removeEventListener");
  const windowAdded = vi.spyOn(window, "addEventListener"),
    windowRemoved = vi.spyOn(window, "removeEventListener");
  for (const component of [
    h(Popover, { label: "Details", closeLabel: "Close", children: "Content" }),
    h(ActionMenu, { label: "Actions", actions: [{ id: "one", label: "One", onPress: vi.fn() }] }),
    h(Tooltip, { label: "Help", children: h("button", {}, "Help") }),
  ]) {
    added.mockClear();
    removed.mockClear();
    windowAdded.mockClear();
    windowRemoved.mockClear();
    await render(component);
    if (container.querySelector("[aria-expanded]")) await click(button());
    else await focus(button());
    const owned = added.mock.calls.filter(([type]) => type === "pointerdown" || type === "keydown");
    expect(owned.length).toBeGreaterThan(0);
    const viewport = windowAdded.mock.calls.filter(
      ([type]) => type === "resize" || type === "scroll",
    );
    expect(viewport.length).toBe(2);
    await render(null);
    for (const [type, listener, options] of viewport)
      expect(
        windowRemoved.mock.calls.some(
          ([removedType, removedListener, removedOptions]) =>
            removedType === type && removedListener === listener && removedOptions === options,
        ),
      ).toBe(true);
    for (const [type, listener] of owned)
      expect(
        removed.mock.calls.some(
          ([removedType, removedListener]) => removedType === type && removedListener === listener,
        ),
      ).toBe(true);
  }
});

it.each(
  (["accepted", "failed"] as const).flatMap((phase) =>
    [true, false].flatMap((pending) =>
      (["response", "snapshot"] as const).map((source) => ({ phase, pending, source })),
    ),
  ),
)(
  "does not replay $phase after silent operation (pending=$pending, source=$source)",
  async ({ phase, pending, source }) => {
    const event: PresentationEvent = {
      operationId: "A",
      revision: 1,
      phase,
      label: "Outcome",
      source: "response",
    };
    await render(h(OperationStatus, { operationId: "A", event }));
    const live = container.querySelector(
      phase === "failed" ? '[role="alert"]' : '[role="status"]',
    )!;
    expect(live.textContent).toBe("Outcome");
    const mutations = vi.fn();
    const observer = new MutationObserver(mutations);
    observer.observe(live, { childList: true, subtree: true, characterData: true });
    const other: PresentationEvent | undefined = pending
      ? { ...event, operationId: "B", phase: "pending", source: "snapshot" }
      : undefined;
    await render(h(OperationStatus, { operationId: "B", ...(other ? { event: other } : {}) }));
    expect(live.textContent).toBe("");
    mutations.mockClear();
    await render(h(OperationStatus, { operationId: "A", event: { ...event, source } }));
    expect(live.textContent).toBe("");
    expect(mutations).not.toHaveBeenCalled();
    await render(h(OperationStatus, { operationId: "A", event: { ...event, revision: 2 } }));
    expect(live.textContent).toBe("Outcome");
    expect(mutations).toHaveBeenCalled();
    observer.disconnect();
  },
);
it("retains the first current response under strict effect replay", async () => {
  await render(
    h(
      StrictMode,
      {},
      h(OperationStatus, {
        operationId: "A",
        event: {
          operationId: "A",
          revision: 1,
          phase: "accepted",
          label: "Accepted",
          source: "response",
        },
      }),
    ),
  );
  expect(container.querySelector('[role="status"]')!.textContent).toBe("Accepted");
});
it("does not restore tab focus after an intentional blur to the page", async () => {
  const items = [
    { id: "one", label: "Source", content: "Source" },
    { id: "two", label: "Notes", content: "Notes", closeLabel: "Close notes" },
  ];
  await render(
    h(Tabs, { label: "Views", items, selected: "two", onSelect: vi.fn(), onClose: vi.fn() }),
  );
  const tab = container.querySelector('[aria-selected="true"]')!;
  await focus(tab);
  await act(async () => (tab as HTMLElement).blur());
  expect(document.activeElement).toBe(document.body);
  await render(
    h(Tabs, {
      label: "Views",
      items: [items[0]!],
      selected: "one",
      onSelect: vi.fn(),
      onClose: vi.fn(),
    }),
  );
  expect(document.activeElement).toBe(document.body);
});
it("restores selected tab focus when confirmation removes the original trigger", async () => {
  function Harness() {
    const selectedTab = useRef<HTMLButtonElement>(null);
    const [notes, setNotes] = useState(true),
      [selected, setSelected] = useState("two"),
      [open, setOpen] = useState(false);
    return h(
      "div",
      {},
      h(Tabs, {
        label: "Views",
        selected,
        selectedTabRef: selectedTab,
        onSelect: setSelected,
        onClose: () => setOpen(true),
        items: [
          { id: "one", label: "Source", content: "Source" },
          ...(notes
            ? [{ id: "two", label: "Notes", content: "Notes", closeLabel: "Close notes" }]
            : []),
        ],
      }),
      h(Dialog, {
        open,
        title: "Close notes?",
        closeLabel: "Keep open",
        returnFocusRef: selectedTab,
        onClose: () => setOpen(false),
        children: h(
          "button",
          {
            type: "button",
            onClick: () => {
              setNotes(false);
              setSelected("one");
              setOpen(false);
            },
          },
          "Save and close",
        ),
      }),
    );
  }
  await render(h(Harness));
  const close = container.querySelector('[aria-label="Close notes"]')!;
  await focus(close);
  await click(close);
  const confirm = [...container.querySelectorAll("button")].find(
    (el) => el.textContent === "Save and close",
  )!;
  await click(confirm);
  expect(container.querySelector("dialog")!.open).toBe(false);
  expect(document.activeElement).toBe(container.querySelector('[role="tab"]'));
});
it("contains focus after child removal and resynchronizes unexpected native closure", async () => {
  const requested = vi.fn();
  function Harness() {
    const [shown, setShown] = useState(true);
    return h(Dialog, {
      open: true,
      title: "Held modal",
      closeLabel: "Close",
      onClose: requested,
      children: h(
        "div",
        {},
        shown && h("input", { id: "temporary" }),
        h("button", { onClick: () => setShown(false) }, "Remove field"),
      ),
    });
  }
  await render(h(Harness));
  await focus(container.querySelector("input")!);
  await click(container.querySelectorAll("button")[1]!);
  expect(document.activeElement).toBe(button());
  const dialog = container.querySelector("dialog")!;
  await act(async () => {
    dialog.close();
    dialog.dispatchEvent(new Event("close"));
  });
  expect(dialog.open).toBe(true);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => document.body.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(requested).toHaveBeenCalledOnce();
  await render(null);
  const outside = document.createElement("input");
  document.body.append(outside);
  await focus(outside);
  await act(async () => {
    dialog.append(document.createElement("span"));
    dialog.dispatchEvent(new Event("close"));
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  expect(document.activeElement).toBe(outside);
  expect(requested).toHaveBeenCalledOnce();
});

it("uses modal fallback when a connected trigger cannot receive focus", async () => {
  const fallback = document.createElement("button"),
    trigger = document.createElement("button");
  document.body.append(fallback, trigger);
  trigger.focus();
  const props = {
    open: true,
    title: "Hide panel",
    closeLabel: "Close",
    onClose: vi.fn(),
    returnFocusRef: { current: fallback },
  };
  await render(h(Dialog, props));
  trigger.hidden = true;
  // JSDOM permits hidden-element focus; emulate the native no-op exercised by the catalog journey.
  vi.spyOn(trigger, "focus").mockImplementation(() => {});
  await render(h(Dialog, { ...props, open: false }));
  expect(trigger.isConnected).toBe(true);
  expect(document.activeElement).toBe(fallback);
});

it("retains tab ownership when focusout leaves the active element unchanged", async () => {
  const items = [
    { id: "one", label: "Source", content: "Source" },
    { id: "two", label: "Notes", content: "Notes", closeLabel: "Close notes" },
  ];
  await render(h(Tabs, { label: "Views", items, selected: "two", onSelect: vi.fn() }));
  const tab = container.querySelector('[aria-selected="true"]')!;
  await focus(tab);
  await act(async () =>
    tab.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null })),
  );
  expect(document.activeElement).toBe(tab);
  await render(h(Tabs, { label: "Views", items: [items[0]!], selected: "one", onSelect: vi.fn() }));
  expect(document.activeElement).toBe(container.querySelector('[role="tab"]'));
});
