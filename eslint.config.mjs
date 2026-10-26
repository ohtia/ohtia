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
    files: ["tools/desktop-probes/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { process: "readonly", console: "readonly" },
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-unused-vars": "error",
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
