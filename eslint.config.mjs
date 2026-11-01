import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".tooling/**",
      ".cache/**",
      "tmp/**",
      "docs/assets/**",
    ],
  },
  {
    files: [
      "tools/desktop-probes/*.mjs",
      "tooling/quality*.mjs",
      "tooling/design-*.mjs",
      "tooling/catalog*.mjs",
      "tooling/product-graph.mjs",
      "tooling/linux-e2e*.mjs",
      "tooling/update-*.mjs",
      "tooling/installation-*.mjs",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        TextDecoder: "readonly",
        AbortSignal: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-unused-vars": "error",
    },
  },
  {
    files: ["tooling/installation-*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { process: "readonly", require: "readonly" },
    },
    rules: { "no-undef": "error", "no-unreachable": "error", "no-unused-vars": "error" },
  },
  {
    files: [
      "tooling/design-acceptance.mjs",
      "tooling/design-viewport.mjs",
      "tooling/catalog-acceptance.mjs",
    ],
    languageOptions: {
      globals: { document: "readonly", getComputedStyle: "readonly", window: "readonly" },
    },
  },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["packages/*/src/**/*.{ts,tsx}", "tools/desktop-probes/src/**/*.{ts,cts}"],
  })),
  {
    files: ["packages/*/src/**/*.{ts,tsx}", "tools/desktop-probes/src/**/*.{ts,cts}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["tools/desktop-probes/src/preload.cts"],
    rules: {
      // Electron's sandboxed preload is CommonJS; admit only its Electron shim.
      "@typescript-eslint/no-require-imports": ["error", { allow: ["^electron$"] }],
    },
  },
  {
    files: ["packages/main/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "navigator",
        "localStorage",
        "sessionStorage",
      ],
    },
  },
);
