import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/quality",
  testMatch: "**/*.spec.ts",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["json"]],
  projects: [{ name: "tooling-contracts" }],
});
