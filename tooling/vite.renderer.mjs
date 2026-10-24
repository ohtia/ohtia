import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "packages/renderer/dist",
    emptyOutDir: false,
    lib: { entry: "packages/renderer/src/index.tsx", formats: ["es"], fileName: () => "index.js" },
    rolldownOptions: { external: [/^react(?:\/|$)/, /^react-dom(?:\/|$)/, /^@ohtia\//] },
  },
});
