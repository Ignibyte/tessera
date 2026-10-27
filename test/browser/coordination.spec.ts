import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { testName } from "./names.ts";

// Overlapping requests on /coordination, answered out of order by the reference server's
// controller (docs/protocol.md 4.6).

type HarnessWindow = Window & {
  tesseraHarness: {
    request(input: { kind: string; method?: string; url: string; targets?: string[]; body?: string }): Promise<{ status: string }>;
    requestErrors: string[];
  };
};

const FRAGMENTS = { "Content-Type": "text/vnd.tessera+html; charset=utf-8", "Tessera-Protocol": "1" };

test.beforeEach(async ({ page }) => {
  await page.goto("/coordination");
  await page.waitForFunction(() => "tesseraHarness" in window);
});

function send(page: Page, input: { kind: string; method?: string; url: string; targets: string[]; body?: string }): Promise<{ status: string }> {
  return page.evaluate((request) => (window as unknown as HarnessWindow).tesseraHarness.request(request), input);
}

async function held(request: APIRequestContext, name: string, count: number): Promise<void> {
  await expect
    .poll(async () => ((await (await request.get(`/_control/${name}/requests`)).json()) as { requests: unknown[] }).requests.length)
    .toBe(count);
}

async function release(request: APIRequestContext, name: string, path: string, body: string): Promise<void> {
  const response = await request.post(`/_control/${name}/release`, { data: { path, headers: FRAGMENTS, body } });
  expect(response.ok()).toBe(true);
}

const cart = (text: string) => `<template data-target="content/cart"><div data-t-c="cart"><p id="cart">${text}</p></div></template>`;

test("a late response never overwrites what a newer one committed", async ({ page, request }) => {
  const name = testName("late");
  const read = send(page, { kind: "refresh", url: `/controlled/${name}/cart`, targets: ["content/cart"] });
  await held(request, name, 1);
  // A write on another target, whose answer also re-renders the cart, as a server may.
  const write = send(page, { kind: "action", method: "POST", url: `/controlled/${name}/save`, targets: ["sidebar"], body: "" });
  await held(request, name, 2);

  await release(request, name, `/controlled/${name}/save`, `${cart("from the write")}<template data-target="sidebar"><nav data-region="sidebar"><p id="side">saved</p></nav></template>`);
  expect((await write).status).toBe("committed");
  await expect(page.locator("#cart")).toHaveText("from the write");

  await release(request, name, `/controlled/${name}/cart`, cart("stale"));
  await read;
  await expect(page.locator("#cart")).toHaveText("from the write");
  await expect(page.locator("#side")).toHaveText("saved");
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.requestErrors)).toEqual([
    "content/cart changed after this request was sent; its older fragment is dropped.",
  ]);
});

test("disjoint regions update independently, whatever order their answers arrive in", async ({ page, request }) => {
  const name = testName("disjoint");
  const left = send(page, { kind: "refresh", url: `/controlled/${name}/left`, targets: ["left"] });
  const right = send(page, { kind: "refresh", url: `/controlled/${name}/right`, targets: ["right"] });
  await held(request, name, 2);

  await release(request, name, `/controlled/${name}/right`, `<template data-target="right"><section data-region="right"><p id="right">right answered first</p></section></template>`);
  await expect(page.locator("#right")).toHaveText("right answered first");
  await expect(page.locator("#left")).toHaveText("left");
  await release(request, name, `/controlled/${name}/left`, `<template data-target="left"><section data-region="left"><p id="left">left answered second</p></section></template>`);

  expect([(await left).status, (await right).status]).toEqual(["committed", "committed"]);
  await expect(page.locator("#left")).toHaveText("left answered second");
  await expect(page.locator("#right")).toHaveText("right answered first");
});
