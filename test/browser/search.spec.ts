import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { testName } from "./names.ts";

// Search as you type on the reference server's /search page: a GET form submitted on a debounced
// input, whose submissions are visits (docs/protocol.md 4.5 and 4.6).

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
