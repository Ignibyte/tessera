import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { testName } from "./names.ts";

// Search as you type on the reference server's /search page: a GET form under data-push="replace",
// submitted on a debounced input, whose submissions are visits (docs/protocol.md 3, 4.5 and 4.6).

type HarnessWindow = Window & {
  tesseraMarker?: number;
  tesseraHarness: { visit(url: string, targets?: string[], mode?: string): Promise<{ status: string }> };
};

interface Captured {
  url: string;
  state: string;
}

async function open(page: Page, path = "/search"): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => "tesseraHarness" in window);
}

async function captured(request: APIRequestContext, id: string): Promise<Captured[]> {
  return ((await (await request.get(`/_control/${id}/requests`)).json()) as { requests: Captured[] }).requests;
}

test("a newer query is sent while the older is in flight, and the older answer never paints over it", async ({ page, request }) => {
  await open(page);
  const id = testName("overlap");
  await page.evaluate((action) => {
    document.querySelector("#search")?.setAttribute("action", action);
  }, `/controlled/${id}/search`);

  await page.locator("#q").pressSequentially("c");
  await expect.poll(async () => (await captured(request, id)).length).toBe(1);
  await page.locator("#q").pressSequentially("r");
  await expect.poll(async () => (await captured(request, id)).map(({ url }) => url)).toEqual([
    `/controlled/${id}/search?q=c`,
    `/controlled/${id}/search?q=cr`,
  ]);

  const newer = await request.post(`/_control/${id}/release`, { data: { path: `/controlled/${id}/search?q=cr`, serve: "/search?q=cr" } });
  expect(newer.ok()).toBe(true);
  await expect(page.locator("#shown")).toHaveText("Results for cr");

  // The older visit was aborted when the newer one went. Should the server still hold it, its
  // answer arrives late and is dropped.
  if ((await captured(request, id))[0]?.state === "held") {
    await request.post(`/_control/${id}/release`, { data: { path: `/controlled/${id}/search?q=c`, serve: "/search?q=c", timeout: 500 } });
  }
  await page.waitForTimeout(300);
  await expect(page.locator("#shown")).toHaveText("Results for cr");
  await expect(page.locator("#q")).toHaveValue("cr");
  expect(new URL(page.url()).search).toBe("?q=cr");
  await request.post(`/_control/${id}/reset`);
});

test("typing a query in steps replaces one entry, and one Back returns to the page before the search", async ({ page }) => {
  await open(page, "/");
  await page.evaluate(() => {
    (window as unknown as HarnessWindow).tesseraMarker = 1;
  });
  const outcome = await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.visit("/search", ["content"]));
  expect(outcome.status).toBe("committed");
  await expect(page.locator("main h1")).toHaveText("Search");
  const length = await page.evaluate(() => window.history.length);

  for (const [key, query] of [["c", "c"], ["r", "cr"], ["a", "cra"]] as const) {
    await page.locator("#q").pressSequentially(key);
    await expect(page.locator("#shown")).toHaveText(`Results for ${query}`);
    expect(new URL(page.url()).search).toBe(`?q=${query}`);
  }
  expect(await page.evaluate(() => window.history.length)).toBe(length);
  await expect(page.locator("#q")).toBeFocused();

  await page.goBack();
  await expect(page.locator("main h1")).toHaveText("Home");
  expect(new URL(page.url()).pathname).toBe("/");
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).tesseraMarker)).toBe(1);

  await page.goForward();
  await expect(page.locator("#shown")).toHaveText("Results for cra");
  expect(new URL(page.url()).search).toBe("?q=cra");
});
