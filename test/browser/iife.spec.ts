import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// The reference server serves dist/ under /assets/; run `npm run build` first.
const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
) as { version: string };

test("the IIFE build defines the Tessera global", async ({ page }) => {
  await page.goto("/");
  await page.addScriptTag({ url: "/assets/tessera.iife.js" });
  const version = await page.evaluate(
    () => (window as unknown as { Tessera: { version: string } }).Tessera.version,
  );
  expect(version).toBe(pkg.version);
});
