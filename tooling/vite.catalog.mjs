import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
const root = fileURLToPath(new URL("../", import.meta.url));
export const catalogCsp =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export default defineConfig({
  root: path.join(root, "tools/renderer-preview"),
  base: "./",
  preview: {
    host: "127.0.0.1",
    strictPort: true,
    headers: { "Content-Security-Policy": catalogCsp },
  },
  build: {
    outDir: path.join(root, "artifacts/semantic-catalog"),
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
