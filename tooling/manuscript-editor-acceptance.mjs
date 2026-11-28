// Pack only the isolated fixture and exercise the real Electron input surface.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { _electron, expect } from "@playwright/test";
import { build } from "vite";
import { nativeEnvironment, shortTemporaryDirectory, verifyPrepared } from "./desktop-launch.mjs";

const [prepared, mode] = process.argv.slice(2);
if (!prepared || !path.isAbsolute(prepared) || (mode && mode !== "--native-ime"))
  throw new Error("Use the absolute desktop:prepare path and optionally --native-ime.");

const target = `${process.platform}-${process.arch}`;
const runtime = verifyPrepared(prepared, target);
const attempt = shortTemporaryDirectory("ohtia-editor-");
const fixture = fileURLToPath(new URL("../tools/manuscript-editor-fixture/", import.meta.url));
const staging = path.join(attempt, "application");
const archive = path.join(attempt, "app.asar");
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const { createPackage } = createRequire(builderRequire.resolve("app-builder-lib"))(
  "@electron/asar",
);
await build({
  configFile: false,
  root: fixture,
  base: "./",
  build: {
    outDir: staging,
    emptyOutDir: false,
    rolldownOptions: {
      output: { entryFileNames: "renderer.js", assetFileNames: "editor[extname]" },
    },
  },
});
fs.copyFileSync(path.join(fixture, "main.cjs"), path.join(staging, "main.cjs"));
fs.writeFileSync(path.join(staging, "package.json"), JSON.stringify({ main: "main.cjs" }));
await createPackage(staging, archive);
const artifact = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
console.log(`Manuscript editor fixture: ${archive} (SHA-256 ${artifact})`);

// Electron loads its own resources/app before command-line app arguments. Stage a separate
// copy with the fixture archive in the packaged resource location.
const sourceRuntime = path.join(prepared, "runtime");
const fixtureRuntime = path.join(attempt, "runtime");
fs.cpSync(sourceRuntime, fixtureRuntime, {
  recursive: true,
  verbatimSymlinks: true,
  filter: (source) => source !== runtime.app,
});
const fixtureApp = path.join(fixtureRuntime, path.relative(sourceRuntime, runtime.app));
fs.copyFileSync(archive, path.join(path.dirname(fixtureApp), "app.asar"));

const env = {
  ...nativeEnvironment({
    home: attempt,
    username: "ohtia-fixture",
    configurationRoot: attempt,
    scratch: attempt,
  }),
  // The Linux fixture may run on an isolated native IBus/GTK display.
  ...(process.env.GTK_IM_MODULE ? { GTK_IM_MODULE: process.env.GTK_IM_MODULE } : {}),
  ...(process.env.IBUS_ADDRESS ? { IBUS_ADDRESS: process.env.IBUS_ADDRESS } : {}),
};
const app = await _electron.launch({
  executablePath: path.join(fixtureRuntime, path.relative(sourceRuntime, runtime.executable)),
  args: runtime.args,
  env,
  chromiumSandbox: true,
  artifactsDir: attempt,
});
try {
  expect(await app.evaluate(({ app }) => app.getAppPath())).toBe(
    path.join(path.dirname(fixtureApp), "app.asar"),
  );
  const page = await app.firstWindow();
  const surface = page.getByRole("textbox", { name: "Manuscript" });
  await expect(surface).toHaveAttribute("lang", "ko-KR");
  const snapshot = async () => JSON.parse(await page.locator("#snapshot").textContent());
  const block = (id) => surface.locator(`[data-manuscript-block="${id}"]`);
  const mac = process.platform === "darwin";
  const start = mac ? "Meta+ArrowLeft" : "Home";
  const end = mac ? "Meta+ArrowRight" : "End";
  const modifier = mac ? "Meta" : "Control";
  const atEnd = async (element) => {
    await element.click();
    await page.keyboard.press(end);
  };
  const initial = (await snapshot()).document;
  const dispose = page.getByRole("button", { name: "Dispose editor" });

  if (mode === "--native-ime") {
    const blockCount = await surface.locator("p").count();
    for (const [id, text, location] of [
      ["sec_title", "Title", "title"],
      ["blk_first", "First", "first paragraph"],
    ]) {
      const element = block(id);
      await atEnd(element);
      const before = (await snapshot()).composition.length;
      console.log(
        `In the fixture window, enable the native Korean IME for the ${location}, type 한글 after ${text}, commit it, then press Tab to leave the editor.`,
      );
      await expect(dispose).toBeFocused({ timeout: 120000 });
      await expect
        .poll(async () => {
          const { composition, composing } = await snapshot();
          return { composition: composition.slice(before), composing };
        })
        .toMatchObject({
          composition: expect.arrayContaining(["compositionstart"]),
          composing: false,
        });
      await expect(element).toHaveText(`${text}한글`);
      await atEnd(element);
      await page.keyboard.press("Shift+ArrowLeft");
      await page.keyboard.press("Shift+ArrowLeft");
      await page.keyboard.press(`${modifier}+x`);
      await expect(element).toHaveText(text);
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe("한글");
      await page.keyboard.press(`${modifier}+v`);
      await expect(element).toHaveText(`${text}한글`);
    }
    const result = await snapshot();
    expect(result.document.title).toEqual({ id: "sec_title", text: "Title한글" });
    expect(result.document.paragraphs[0].lines[0].text).toBe("First한글");
    expect(result.document.paragraphs.map(({ id }) => id)).toEqual(["blk_first", "blk_second"]);
    expect(result.validation.ok).toBe(true);
    await expect(surface.locator("p")).toHaveCount(blockCount);
  } else {
    await atEnd(block("sec_title"));
    await page.keyboard.type(" revision");
    await expect(block("sec_title")).toHaveText("Title revision");
    await page.keyboard.press(`${modifier}+z`);
    await expect(block("sec_title")).toHaveText("Title");
    await page.keyboard.press(`${modifier}+Shift+z`);
    await expect(block("sec_title")).toHaveText("Title revision");

    await atEnd(block("blk_first"));
    await page.keyboard.press("Delete");
    await expect(block("blk_first")).toHaveText("FirstSecond");
    expect((await snapshot()).document.paragraphs.map(({ id }) => id)).toEqual(["blk_first"]);
    await page.keyboard.press(`${modifier}+z`);
    await expect(block("blk_second")).toHaveText("Second");

    const writeClipboard = (data) =>
      app.evaluate(
        ({ clipboard, ClipboardItem }, value) => clipboard.write([new ClipboardItem(value)]),
        data,
      );
    await atEnd(block("blk_first"));
    await writeClipboard({ "text/plain": " clipboard" });
    await page.keyboard.press(`${modifier}+v`);
    await expect(block("blk_first")).toHaveText("First clipboard");
    await page.keyboard.press(start);
    await page.keyboard.press(`Shift+${end}`);
    await page.keyboard.press(`${modifier}+c`);
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe("First clipboard");
    await atEnd(block("blk_second"));
    await page.keyboard.press(`${modifier}+v`);
    await expect(block("blk_second")).toHaveText("SecondFirst clipboard");

    const html = "<table><tr><td>Unrepresentable</td></tr></table>";
    const before = (await snapshot()).document;
    await writeClipboard({ "text/html": html, "text/plain": "Unrepresentable" });
    await page.keyboard.press(`${modifier}+v`);
    await expect
      .poll(async () => (await snapshot()).refusal?.diagnostic.code)
      .toBe("unsupported-construct");
    expect((await snapshot()).document).toEqual(before);
    expect((await snapshot()).refusal.html).toContain(html);
    const retainedHtml = await app.evaluate(async ({ clipboard }) => {
      const [item] = await clipboard.read();
      return (await item.getType("text/html")).text();
    });
    expect(retainedHtml).toContain(html);
    await page.keyboard.press(`${modifier}+Shift+v`);
    await expect(block("blk_second")).toHaveText("SecondFirst clipboardUnrepresentable");
    expect(before).not.toEqual(initial);
    const table =
      "<table><thead><tr><th>Operating system</th><th>ARM64</th></tr></thead><tbody><tr><td>Linux</td><td>Required</td></tr></tbody></table>";
    await writeClipboard({
      "text/plain": "Operating system\tARM64\nLinux\tRequired",
      "text/html": table,
    });
    await page.keyboard.press(`${modifier}+v`);
    await expect
      .poll(async () => (await snapshot()).document.paragraphs.at(-1).lines)
      .toEqual([
        { text: "| Operating system | ARM64 |", breakAfter: "hard" },
        { text: "| --- | --- |", breakAfter: "hard" },
        { text: "| Linux | Required |", breakAfter: null },
      ]);
    expect((await snapshot()).validation.ok).toBe(true);
  }
  await dispose.click();
  await expect(surface).toHaveCount(0);
  const result = await snapshot();
  expect(result.disposed).toBe(true);
  fs.writeFileSync(
    path.join(attempt, "result.json"),
    JSON.stringify({ target, artifact, mode: mode ?? "keyboard-clipboard", result }, null, 2) +
      "\n",
  );
  console.log(`Manuscript editor fixture passed on ${target}.`);
} finally {
  await app.close();
}
