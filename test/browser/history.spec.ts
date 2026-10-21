import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// History, focus and scroll across region visits on the reference server. A marker on window
// shows a back or forward was an enhanced visit, not a full load.

type HarnessWindow = Window & {
  tesseraMarker?: number;
  tesseraHarness: { visit(url: string, targets?: string[], mode?: string): Promise<{ status: string }> };
};

async function ready(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => "tesseraHarness" in window);
  await page.evaluate(() => {
    (window as unknown as HarnessWindow).tesseraMarker = 1;
  });
}

const marked = (page: Page): Promise<boolean> => page.evaluate(() => (window as unknown as HarnessWindow).tesseraMarker === 1);
const historyLength = (page: Page): Promise<number> => page.evaluate(() => window.history.length);
const pathname = (page: Page): string => new URL(page.url()).pathname;

test.describe("history", () => {
  test("a visit pushes an entry; back and forward fetch each entry again, enhanced", async ({ page }) => {
    await ready(page, "/");
    const length = await historyLength(page);
    await page.locator("[data-region=sidebar] a", { hasText: "About" }).click();
    await expect(page.locator("main h1")).toHaveText("About");
    expect(await historyLength(page)).toBe(length + 1);

    await page.goBack();
    await expect(page.locator("main h1")).toHaveText("Home");
    await expect(page).toHaveTitle("Home · Fixture");
    expect(pathname(page)).toBe("/");

    await page.goForward();
    await expect(page.locator("main h1")).toHaveText("About");
    expect(pathname(page)).toBe("/about");
    expect(await marked(page)).toBe(true);
    expect(await historyLength(page)).toBe(length + 1);
  });

  test("a replacing visit changes the URL without a new entry", async ({ page }) => {
    await ready(page, "/");
    const length = await historyLength(page);
    const outcome = await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.visit("/about", ["content"], "replace"));
    expect(outcome.status).toBe("committed");
    await expect(page.locator("main h1")).toHaveText("About");
    expect(pathname(page)).toBe("/about");
    expect(await historyLength(page)).toBe(length);
  });
});

test.describe("focus", () => {
  test("goes to the field the server chose", async ({ page }) => {
    await ready(page, "/links");
    await page.locator("#autofocus").click();
    await expect(page.locator("#server-choice")).toBeFocused();
  });

  test("goes back to the stored element on back", async ({ page }) => {
    await ready(page, "/links");
    await page.locator("#plain").click();
    await expect(page.locator("main h1")).toHaveText("About");
    await page.goBack();
    await expect(page.locator("main h1")).toHaveText("Links");
    await expect(page.locator("#plain")).toBeFocused();
  });

  test("goes to the fragment's target", async ({ page }) => {
    await ready(page, "/links");
    await page.locator("#long-hash").click();
    await expect(page.locator("#section-3")).toBeFocused();
  });

  test("goes to the main heading when focus was in what changed", async ({ page }) => {
    await ready(page, "/links");
    await page.locator("#plain").click();
    await expect(page.locator("main h1")).toBeFocused();
    expect(await page.locator("main h1").getAttribute("tabindex")).toBe("-1");
  });

  test("goes to the body when what arrived has no heading", async ({ page }) => {
    await ready(page, "/links");
    await page.locator("#headless").click();
    await expect(page.locator("#headless")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });

  test("stays where it is when it was outside what changed", async ({ page }) => {
    await ready(page, "/");
    const link = page.locator("[data-region=sidebar] a", { hasText: "About" });
    await link.click();
    await expect(page.locator("main h1")).toHaveText("About");
    await page.waitForTimeout(300);
    await expect(link).toBeFocused();
  });
});

test.describe("scroll", () => {
  test("goes to the top on a new visit and is restored on back", async ({ page }) => {
    await ready(page, "/long");
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    const before = await page.evaluate(() => window.scrollY);

    await page.locator("#bottom-link").click();
    await expect(page.locator("main h1")).toHaveText("About");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    await page.goBack();
    await expect(page.locator("main h1")).toHaveText("Long");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 50);
  });

  test("goes to the fragment on a visit to a URL with a hash", async ({ page }) => {
    await ready(page, "/links");
    await page.locator("#long-hash").click();
    await expect(page.locator("#section-3")).toBeVisible();
    await expect.poll(() => page.evaluate(() => Math.abs(document.querySelector("#section-3")?.getBoundingClientRect().top ?? 999))).toBeLessThan(5);
  });
});
