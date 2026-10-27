import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Anchors (docs/protocol.md, section 2.7): a link naming "@NAME" sends the anchored component's
// path, and an anchor the page lacks is reported with nothing sent.

type HarnessWindow = Window & { tesseraHarness: { requestErrors: string[] } };

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => "tesseraHarness" in window);
}

async function addLink(page: Page, id: string, target: string): Promise<void> {
  await page.evaluate(
    ({ linkId, linkTarget }) => {
      const link = document.createElement("a");
      link.id = linkId;
      link.href = "/";
      link.dataset.target = linkTarget;
      link.textContent = linkId;
      document.querySelector("h1")?.after(link);
    },
    { linkId: id, linkTarget: target },
  );
}

test("a link targeting @NAME sends the anchored component's path and morphs that component", async ({ page }) => {
  await open(page, "/");
  await addLink(page, "to-greeting", "@hello");
  await page.evaluate(() => {
    (document.querySelector('[data-t-anchor="hello"]') as HTMLElement & { marked?: boolean }).marked = true;
  });
  const sent = page.waitForRequest((request) => request.headers()["tessera-request"] === "visit");
  await page.locator("#to-greeting").click();
  const headers = (await sent).headers();
  expect(headers["tessera-targets"]).toMatch(/^content\/greeting [A-Za-z0-9\-_.~+/=]+$/);
  expect(headers["tessera-protocol"]).toBe("1");
  // The visit's history entry records the targets it committed, as paths.
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(Object.values((window.history.state ?? {}) as Record<string, { targets?: unknown }>).map((entry) => entry.targets))))
    .toBe(JSON.stringify([["content/greeting"]]));
  expect(await page.evaluate(() => (document.querySelector('[data-t-anchor="hello"]') as HTMLElement & { marked?: boolean }).marked)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.requestErrors)).toEqual([]);
});

test("a link targeting an anchor the page lacks is reported and sends nothing", async ({ page }) => {
  await open(page, "/");
  await addLink(page, "to-nowhere", "@nowhere");
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["tessera-request"] !== undefined) requests.push(request.url());
  });
  await page.locator("#to-nowhere").click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.requestErrors))
    .toEqual([expect.stringContaining("the page has no anchor nowhere.")]);
  expect(requests).toEqual([]);
  expect(new URL(page.url()).pathname).toBe("/");
});
