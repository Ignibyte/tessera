import { createServer } from "node:net";
import { defineConfig, devices } from "@playwright/test";

// The reference server listens on a port chosen once, in the runner, and handed to the workers
// through the environment, since each worker loads this file again.
async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === "object") done(address.port);
        else fail(new Error("no port"));
      });
    });
  });
}

process.env.TESSERA_TEST_PORT ??= String(await freePort());
const baseURL = `http://127.0.0.1:${process.env.TESSERA_TEST_PORT}`;

export default defineConfig({
  testDir: "test/browser",
  globalSetup: "./test/browser/global-setup.ts",
  forbidOnly: true,
  fullyParallel: true,
  reporter: "list",
  use: { headless: true, baseURL },
  webServer: {
    // --close-connections: see the transport's drop test and docs/decisions.md.
    command: `node test/server/main.ts --port ${process.env.TESSERA_TEST_PORT} --close-connections`,
    url: `${baseURL}/`,
    reuseExistingServer: false,
  },
  // WebKit does not run on the dev box (docs/decisions.md); TESSERA_WEBKIT=1 adds it where it does.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    ...(process.env.TESSERA_WEBKIT === "1"
      ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }]
      : []),
  ],
});
