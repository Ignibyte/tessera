import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

// Durable streams against the reference server's /events (ticket #16): each step of the stream
// prepends to region `events`, morphs component `content/latest` and patches `$received`. The
// page holds the stream twice, on the region and on `#also`, so one connection is shared. The
// server logs each connection under the stream's `key`.

type HarnessWindow = Window & {
  tesseraHarness: {
    visit(url: string, targets?: string[]): Promise<{ status: string }>;
    streams(): string[];
    resources(): string[];
    dispose(): void;
    requestErrors: string[];
  };
};

interface Connection {
  lastEventId: string | null;
  closed: boolean;
}

function keyFor(name: string): string {
  return `${name}-${test.info().project.name}-${test.info().workerIndex}-${test.info().retry}`;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/events?${query}`);
  await page.waitForFunction(() => "tesseraHarness" in window);
}

async function connections(request: APIRequestContext, key: string): Promise<Connection[]> {
  const log = (await (await request.get(`/events/log?key=${key}`)).json()) as { connections: Connection[] };
  return log.connections;
}

const items = (page: Page) => page.locator("[data-region=events] li");

const streamResources = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.resources().filter((resource) => resource.includes(" stream:")));

test("events morph a region and a component, and patch signals", async ({ page, request }) => {
  const key = keyFor("morph");
  await open(page, `count=3&key=${key}`);
  await expect(items(page)).toHaveText(["Event 3", "Event 2", "Event 1"]);
  await expect(page.locator("#latest")).toHaveText("Latest: 3");
  await expect(page.locator("#received")).toHaveText("3");
  expect(await connections(request, key)).toEqual([{ key, lastEventId: null, closed: false }]);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.requestErrors)).toEqual([]);
});

test("a dropped connection reconnects with the last id and resumes without duplicates", async ({ page, request }) => {
  const key = keyFor("drop");
  await open(page, `count=4&drop=2&retry=50&key=${key}`);
  await expect(items(page)).toHaveText(["Event 4", "Event 3", "Event 2", "Event 1"]);
  await expect(page.locator("#latest")).toHaveText("Latest: 4");
  await expect(page.locator("#received")).toHaveText("4");
  expect(await connections(request, key)).toEqual([
    { key, lastEventId: null, closed: true },
    { key, lastEventId: "2", closed: false },
  ]);
});

test("the stream ends when the last element naming it leaves the page", async ({ page, request }) => {
  const key = keyFor("leave");
  await open(page, `count=1&key=${key}`);
  await expect(items(page)).toHaveText(["Event 1"]);
  await page.evaluate(() => document.querySelector("#also")?.remove());
  await page.waitForTimeout(100);
  expect(await connections(request, key)).toEqual([{ key, lastEventId: null, closed: false }]);

  await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.visit("/about", ["content"]));
  await expect(page.locator("h1")).toHaveText("About");
  await expect.poll(() => connections(request, key)).toEqual([{ key, lastEventId: null, closed: true }]);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.streams())).toEqual([]);
  expect(await streamResources(page)).toEqual([]);
});

test("nothing leaks: the kernel's ledger is empty after disposal", async ({ page, request }) => {
  const key = keyFor("dispose");
  await open(page, `count=1&key=${key}`);
  await expect(items(page)).toHaveText(["Event 1"]);
  expect(await streamResources(page)).not.toEqual([]);
  const left = await page.evaluate(() => {
    const harness = (window as unknown as HarnessWindow).tesseraHarness;
    harness.dispose();
    return harness.resources();
  });
  expect(left).toEqual([]);
  await expect.poll(() => connections(request, key)).toEqual([{ key, lastEventId: null, closed: true }]);
});
