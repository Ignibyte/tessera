import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

// Probes measure an engine rather than test Tessera, so they never run with the browser suite:
// `npx playwright test --config playwright.probes.config.ts`, or with the WebKit image,
// `npm run test:browser:webkit -- --config playwright.probes.config.ts`. Same servers and projects
// as the suite, the harness build included.
export default defineConfig({ ...base, testDir: "test/probes" });
