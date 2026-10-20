import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// Run `npm run build` first; ticket #3 replaces this with tests against the reference server.
const iife = resolve(import.meta.dirname, "../../dist/tessera.iife.js");
const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
) as { version: string };

test("the IIFE build defines the Tessera global", async ({ page }) => {
  await page.setContent("<!doctype html><title>iife</title>");
  await page.addScriptTag({ path: iife });
  const version = await page.evaluate(
    () => (window as unknown as { Tessera: { version: string } }).Tessera.version,
  );
  expect(version).toBe(pkg.version);
});
