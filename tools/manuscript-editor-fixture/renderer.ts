import { parseManuscript } from "../../packages/domain/dist/index.js";
import type { ManuscriptResult } from "../../packages/contracts/dist/index.js";
import {
  mountManuscriptEditor,
  type ManuscriptClipboardRefusal,
} from "../../packages/renderer/src/manuscript-editor.js";

const draftId = "01a14fbd-d779-7014-a580-95cd6274b134";
const source = [
  "---",
  "ohtia_draft_format: ohtia-markdown-v1",
  `ohtia_draft_id: draft_${draftId}`,
  "---",
  "",
  "# Title {#sec_title}",
  "",
  "::: {#blk_first .ohtia-block}",
  "First",
  ":::",
  "",
  "::: {#blk_second .ohtia-block}",
  "Second",
  ":::",
  "",
].join("\n");
const initial = parseManuscript(source, { draftId });
if (!initial.ok) throw new Error("Invalid fixture manuscript.");

const host = document.querySelector<HTMLElement>("#editor");
const output = document.querySelector<HTMLOutputElement>("#snapshot");
const dispose = document.querySelector<HTMLButtonElement>("#dispose");
if (!host || !output || !dispose) throw new Error("Missing fixture elements.");
let validation: ManuscriptResult<string> = { ok: true, value: source };
let refusal: ManuscriptClipboardRefusal | undefined;
let disposed = false;
const composition: string[] = [];
const editor = mountManuscriptEditor(
  host,
  initial.value,
  "Manuscript",
  (_working, result) => {
    validation = result;
    publish();
  },
  () => undefined,
  undefined,
  {
    language: "ko-KR",
    onPasteRefused: (result) => {
      refusal = result;
      publish();
    },
  },
);

function publish() {
  if (!output) return;
  output.value = JSON.stringify({
    document: editor.read(),
    validation,
    refusal,
    composition,
    composing: editor.isComposing(),
    disposed,
  });
}
for (const name of ["compositionstart", "compositionend"] as const)
  host.addEventListener(
    name,
    (event) => {
      if (!event.isTrusted) return;
      composition.push(name);
      window.setTimeout(publish, 0);
    },
    { capture: true },
  );
host.addEventListener("focusout", () => {
  window.setTimeout(publish, 0);
});
dispose.addEventListener("click", () => {
  // Publish the final working snapshot before releasing the DOM.
  disposed = true;
  publish();
  editor.destroy();
});
window.addEventListener("pagehide", () => {
  if (!disposed) editor.destroy();
});
publish();
editor.jump("blk_first");
