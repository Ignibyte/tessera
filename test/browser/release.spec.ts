import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// The release files (#19) on the reference server, without the test harness: `?build=` loads one
// in its place (test/server/README.md). Run `npm run build` first.
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")) as { version: string };

type TesseraWindow = Window & {
  Tessera: { version: string; start(): { stop(): void } };
  tesseraErrors: string[];
  runtime?: { stop(): void };
};

/** Records every `tessera:error` from the first script on, as the page's own listener would. */
async function recordErrors(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const errors: string[] = [];
    (window as unknown as TesseraWindow).tesseraErrors = errors;
    document.addEventListener("tessera:error", (event) => {
      const { error } = (event as CustomEvent<{ error: unknown }>).detail;
      errors.push(error instanceof Error ? error.message : String(error));
    });
  });
}

const reloads = (page: Page): Promise<number> => page.evaluate(() => performance.timeOrigin);

for (const build of ["iife", "esm", "csp-iife", "csp-esm"]) {
  test(`the ${build} build starts by itself and enhances the page`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await recordErrors(page);
    await page.route("**/save", (route) => route.fulfill({ status: 204 }));
    // The csp builds run under a policy that refuses 'unsafe-eval'.
    await page.goto(`/attributes?build=${build}${build.startsWith("csp") ? "&csp=1" : ""}`);
    await expect(page.locator("#greeting")).toHaveText("Hello, Ada");

    // A button added after the start is scanned too; its action goes out through the transport.
    await page.evaluate(() => {
      document.querySelector("#vocabulary")?.insertAdjacentHTML("beforeend", `<button id="act" data-on:click="@post('/save')">Act</button>`);
    });
    const action = page.waitForRequest((request) => new URL(request.url()).pathname === "/save");
    await page.locator("#act").click();
    expect((await action).headers()["tessera-request"]).toBe("action");

    const origin = await reloads(page);
    await page.locator('nav a[href="/about"]').click();
    await expect(page.locator("main h1")).toHaveText("About");
    expect(await reloads(page)).toBe(origin);
    expect(await page.evaluate(() => (window as unknown as TesseraWindow).tesseraErrors)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test("an IIFE sets the Tessera global to the release's version", async ({ page }) => {
  await page.goto("/attributes?build=csp-iife");
  expect(await page.evaluate(() => (window as unknown as TesseraWindow).Tessera.version)).toBe(pkg.version);
});

test("tessera-start manual makes an IIFE wait for Tessera.start(), which runs once, and stop() lets go", async ({ page }) => {
  await page.goto("/attributes?build=iife&start=manual");
  await expect(page.locator("#greeting")).toHaveText("");
  await page.evaluate(() => {
    const win = window as unknown as TesseraWindow;
    win.runtime = win.Tessera.start();
  });
  await expect(page.locator("#greeting")).toHaveText("Hello, Ada");
  const again = await page.evaluate(() => {
    try {
      (window as unknown as TesseraWindow).Tessera.start();
      return "started twice";
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(again).toBe("Tessera has already started on this document.");
  await page.evaluate(() => {
    (window as unknown as TesseraWindow).runtime?.stop();
  });
  const origin = await reloads(page);
  await page.locator('nav a[href="/about"]').click();
  await expect(page.locator("main h1")).toHaveText("About");
  expect(await reloads(page)).not.toBe(origin);
});

test("under a policy that refuses 'unsafe-eval', the default build's directives fail and say so", async ({ page }) => {
  await recordErrors(page);
  await page.goto("/attributes?build=iife&csp=1");
  await expect.poll(() => page.evaluate(() => (window as unknown as TesseraWindow).tesseraErrors.length)).toBeGreaterThan(0);
  await expect(page.locator("#greeting")).toHaveText("");
});
