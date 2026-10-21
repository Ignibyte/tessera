import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { testName } from "./names.ts";

// Lazy regions, polling, prefetch and persisted nodes against the reference server (ticket #17).

type HarnessWindow = Window & { tesseraHarness: { requestErrors: string[] } };

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => "tesseraHarness" in window);
}

const requestErrors = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.requestErrors);

/** Makes the page report itself hidden or visible, as switching tabs would. */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (value ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("a lazy region loads once rendered, and a __visible one once it scrolls into view", async ({ page }) => {
  await open(page, "/lazy");
  await expect(page.locator("#reviews")).toHaveText("Five stars");
  await page.waitForTimeout(300);
  await expect(page.locator("#more")).toHaveText("Loading more");
  await page.locator("#more").scrollIntoViewIfNeeded();
  await expect(page.locator("#more")).toHaveText("More, loaded");
  await expect(page.locator("[data-lazy], [data-lazy__visible]")).toHaveCount(0);
  expect(await requestErrors(page)).toEqual([]);
});

test("a poll stops while the page is hidden and goes on when it is visible", async ({ page }) => {
  await open(page, `/poll?key=${testName("poll")}`);
  await page.bringToFront();
  const ticks = async (): Promise<number> => Number(await page.locator("#ticks").textContent());
  await expect.poll(ticks).toBeGreaterThanOrEqual(2);

  await setHidden(page, true);
  // A poll already in flight may still land.
  await page.waitForTimeout(400);
  const hidden = await ticks();
  await page.waitForTimeout(1000);
  expect(await ticks()).toBe(hidden);

  await setHidden(page, false);
  await expect.poll(ticks).toBeGreaterThan(hidden);
});

test("a prefetch on mousedown is the request the click uses", async ({ page, request }) => {
  const name = testName("prefetch");
  await open(page, "/links");
  await page.evaluate((href) => {
    const link = document.createElement("a");
    link.id = "held";
    link.href = href;
    link.dataset.target = "content";
    link.textContent = "Held";
    document.querySelector("h1")?.after(link);
  }, `/controlled/${name}/about`);
  const held = async (): Promise<number> =>
    ((await (await request.get(`/_control/${name}/requests`)).json()) as { requests: unknown[] }).requests.length;

  await page.locator("#held").hover();
  await page.mouse.down();
  await expect.poll(held).toBe(1);
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(await held()).toBe(1);

  const released = await request.post(`/_control/${name}/release`, { data: { serve: "/about" } });
  expect(released.ok()).toBe(true);
  await expect(page.locator("h1")).toHaveText("About");
  expect(new URL(page.url()).pathname).toBe(`/controlled/${name}/about`);
  expect(await held()).toBe(1);
});

test("a data-permanent node keeps its state across a fragment visit and a whole-document visit", async ({ page }) => {
  await open(page, "/persist-a");
  await page.evaluate(() => {
    const player = document.querySelector<HTMLElement & { position?: number }>("#player");
    if (!player) throw new Error("no player");
    player.position = 12;
    player.querySelector("#state")?.replaceChildren("playing 0:12");
  });
  const position = (): Promise<number | undefined> =>
    page.evaluate(() => document.querySelector<HTMLElement & { position?: number }>("#player")?.position);

  await page.locator("#to-b").click();
  await expect(page.locator("h1")).toHaveText("Persist B");
  expect(await position()).toBe(12);
  await expect(page.locator("#state")).toHaveText("playing 0:12");
  await expect(page.locator("section > #player")).toHaveCount(1);

  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Persist A");
  expect(await position()).toBe(12);
  // persist-c is on the bare layout, so this visit commits the whole document.
  await page.locator("#to-c").click();
  await expect(page.locator("h1")).toHaveText("Persist C");
  await expect(page.locator("nav[data-region=sidebar]")).toHaveCount(0);
  expect(await position()).toBe(12);
  await expect(page.locator("#state")).toHaveText("playing 0:12");
  expect(await requestErrors(page)).toEqual([]);
});
