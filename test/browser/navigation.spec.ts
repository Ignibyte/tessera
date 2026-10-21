import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Enhanced navigation on the reference server, each scenario with JavaScript on (Tessera) and off
// (the plain document). A marker on window survives an enhanced visit and is lost on a full load.

type MarkedWindow = Window & { tesseraMarker?: number; ranFetchedScript?: boolean };

async function mark(page: Page): Promise<void> {
  await page.waitForFunction(() => "tesseraHarness" in window);
  await page.evaluate(() => {
    (window as MarkedWindow).tesseraMarker = 1;
  });
}

async function marked(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as MarkedWindow).tesseraMarker === 1);
}

const path = (page: Page): string => new URL(page.url()).pathname;

test.describe("with JavaScript", () => {
  test("a link updates the content region without a full load", async ({ page }) => {
    await page.goto("/");
    await mark(page);
    await page.evaluate(() => {
      (document.querySelector("[data-region=sidebar]") as HTMLElement & { tesseraSame?: boolean }).tesseraSame = true;
    });
    await page.locator("[data-region=sidebar] a", { hasText: "About" }).click();
    await expect(page.locator("main h1")).toHaveText("About");
    await expect(page).toHaveTitle("About · Fixture");
    expect(path(page)).toBe("/about");
    expect(await marked(page)).toBe(true);
    expect(await page.evaluate(() => (document.querySelector("[data-region=sidebar]") as HTMLElement & { tesseraSame?: boolean }).tesseraSame)).toBe(true);
  });

  test("each excluded link is left to the browser", async ({ page }) => {
    await page.goto("/links");
    await mark(page);
    // A listener on window, after Tessera's on the document, records whether Tessera claimed the
    // click, then stops the browser's own navigation so the page stays.
    await page.evaluate(() => {
      const claimed: Record<string, boolean> = {};
      (window as unknown as { claimed: Record<string, boolean> }).claimed = claimed;
      window.addEventListener("click", (event) => {
        const link = (event.target as Element).closest("a");
        if (link) claimed[link.id] = event.defaultPrevented;
        event.preventDefault();
      });
    });
    for (const id of ["blank", "download", "external", "hash", "mailto", "off"]) await page.locator(`#${id}`).click();
    await page.locator("#plain").click({ modifiers: ["Shift"] });
    const claimed = await page.evaluate(() => (window as unknown as { claimed: Record<string, boolean> }).claimed);
    expect(claimed).toEqual({ blank: false, download: false, external: false, hash: false, mailto: false, off: false, plain: false });
    expect(path(page)).toBe("/links");
    expect(await marked(page)).toBe(true);
  });

  test("a link to another layout commits the whole document by morphing", async ({ page }) => {
    await page.goto("/");
    await mark(page);
    await page.locator("[data-region=sidebar] a", { hasText: "Bare" }).click();
    await expect(page.locator("main h1")).toHaveText("Bare");
    await expect(page).toHaveTitle("Bare · Fixture");
    await expect(page.locator("[data-region=sidebar]")).toHaveCount(0);
    expect(await page.locator('meta[name="tessera-layout"]').getAttribute("content")).toBe("bare");
    expect(path(page)).toBe("/bare");
    expect(await marked(page)).toBe(true);
  });

  test("Tessera-Full-Visit falls back to a full load", async ({ page }) => {
    await page.goto("/links");
    await mark(page);
    await page.locator("#away").click();
    await expect(page.locator("main h1")).toHaveText("About");
    expect(path(page)).toBe("/about");
    expect(await marked(page)).toBe(false);
  });

  test("a fragment for a region the page lacks falls back to a full load", async ({ page }) => {
    await page.goto("/links");
    await mark(page);
    await page.locator("#stray").click();
    await expect(page.locator("#stray")).toHaveText("A Tessera visit here gets a fragment for a region no page has.");
    expect(path(page)).toBe("/stray");
    expect(await marked(page)).toBe(false);
  });

  test("a changed tracked asset forces a full load", async ({ page }) => {
    await page.goto("/links");
    await mark(page);
    await page.locator("#redeploy").click();
    await expect(page.locator("#redeployed")).toBeVisible();
    expect(path(page)).toBe("/redeploy");
    expect(await page.locator('link[href="/assets/fixture.css"]').getAttribute("data-track")).toBe("2");
    expect(await marked(page)).toBe(false);
  });

  test("a fetched script does not run", async ({ page }) => {
    await page.goto("/links");
    await mark(page);
    await page.locator("#scripted").click();
    await expect(page.locator("#scripted")).toHaveText("This content carries a script.");
    await expect(page.locator("main script")).toHaveCount(1);
    expect(await page.evaluate(() => (window as MarkedWindow).ranFetchedScript)).toBeUndefined();
    expect(await marked(page)).toBe(true);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const [name, from, link, destination, check] of [
    ["a link loads the page", "/", "[data-region=sidebar] a:text('About')", "/about", "main h1"],
    ["a link to another layout loads it", "/", "[data-region=sidebar] a:text('Bare')", "/bare", "main h1"],
    ["the full-visit page redirects to its destination", "/links", "#away", "/about", "main h1"],
    ["the stray page loads", "/links", "#stray", "/stray", "#stray"],
    ["the redeployed page loads", "/links", "#redeploy", "/redeploy", "#redeployed"],
    ["the scripted page loads", "/links", "#scripted", "/scripted", "#scripted"],
    ["an opted-out link navigates", "/links", "#off", "/about", "main h1"],
  ] as const) {
    test(name, async ({ page }) => {
      await page.goto(from);
      await page.locator(link).click();
      await page.waitForURL((url) => url.pathname === destination);
      await expect(page.locator(check)).toBeVisible();
    });
  }
});
