import { defineConfig } from "vite";
import { productGraph } from "./product-graph.mjs";

export default defineConfig({
  plugins: [productGraph(process.cwd())],
  build: {
    outDir: "packages/renderer/dist",
    emptyOutDir: false,
    lib: { entry: "packages/renderer/src/index.tsx", formats: ["es"], fileName: () => "index.js" },
    rolldownOptions: { external: [/^react(?:\/|$)/, /^react-dom(?:\/|$)/, /^@ohtia\//] },
  },
});
