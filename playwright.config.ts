import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/browser",
  forbidOnly: true,
  fullyParallel: true,
  reporter: "list",
  use: { headless: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
