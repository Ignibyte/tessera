import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// data-mount on the reference server (#45): /assets/mount-widget.js stands in for a client
// library. It mounts on load and again on an element a fragment brings, its DOM stays through a
// morph, it unmounts before a remove takes the element, and the release builds carry it under a
// policy without 'unsafe-eval'.

type MountWindow = Window & {
  mountLog?: string[];
  tesseraHarness: { patch(target: string, markup: string, mode?: string): void; failures: string[]; requestErrors: string[] };
};
type MarkedCanvas = HTMLCanvasElement & { marked?: boolean };

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => "tesseraHarness" in window);
}

const log = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as MountWindow).mountLog ?? []);

const errors = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const { failures, requestErrors } = (window as unknown as MountWindow).tesseraHarness;
    return [...failures, ...requestErrors];
  });

/** Marks the library's canvas, so a later look can tell it is the same node. */
async function markCanvas(page: Page, selector: string): Promise<void> {
  await page.locator(selector).evaluate((canvas: MarkedCanvas) => {
    canvas.marked = true;
  });
}

const marked = (page: Page, selector: string): Promise<boolean | undefined> =>
  page.locator(selector).evaluate((canvas: MarkedCanvas) => canvas.marked);

test("mounts on load, and on the element a fragment brings, importing the module once", async ({ page }) => {
  const imports: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/assets/mount-widget.js")) imports.push(request.url());
  });
  await open(page, "/mount");
  await expect(page.locator("#chart-1 canvas.library")).toHaveAttribute("data-label", "one");
  expect(await log(page)).toEqual(["loaded", 'mount chart-1 {"label":"one"}']);
  await markCanvas(page, "#chart-1 canvas");

  await page.locator("#to-more").click();
  await expect(page.locator("h1")).toHaveText("Mount more");
  await expect(page.locator("#chart-2 canvas.library")).toHaveAttribute("data-label", "two");
  // #chart-1 took its new class and kept the library's canvas.
  await expect(page.locator("#chart-1")).toHaveClass("wide");
  await expect(page.locator("#chart-1 canvas")).toHaveCount(1);
  expect(await marked(page, "#chart-1 canvas")).toBe(true);
  expect(await log(page)).toEqual(["loaded", 'mount chart-1 {"label":"one"}', 'mount chart-2 {"label":"two"}']);
  expect(imports).toHaveLength(1);
  expect(await errors(page)).toEqual([]);
});

test("a morph keeps the library's DOM, and a changed data-mount-data mounts again", async ({ page }) => {
  await open(page, "/mount");
  await expect(page.locator("#chart-1 canvas")).toHaveCount(1);
  await markCanvas(page, "#chart-1 canvas");

  await page.evaluate(() => {
    (window as unknown as MountWindow).tesseraHarness.patch(
      "content/board",
      `<div data-t-c="board"><div id="chart-1" title="Sales" data-mount="/assets/mount-widget.js" data-mount-data='{"label":"one"}'><p>server child</p></div></div>`,
    );
  });
  await expect(page.locator("#chart-1")).toHaveAttribute("title", "Sales");
  expect(await marked(page, "#chart-1 canvas")).toBe(true);
  await expect(page.locator("#chart-1 p")).toHaveCount(0);

  await page.evaluate(() => {
    (window as unknown as MountWindow).tesseraHarness.patch(
      "content/board",
      `<div data-t-c="board"><div id="chart-1" data-mount="/assets/mount-widget.js" data-mount-data='{"label":"three"}'></div></div>`,
    );
  });
  await expect(page.locator("#chart-1 canvas.library")).toHaveAttribute("data-label", "three");
  expect(await log(page)).toEqual(["loaded", 'mount chart-1 {"label":"one"}', "cleanup chart-1", "unmount chart-1 connected", 'mount chart-1 {"label":"three"}']);
  expect(await errors(page)).toEqual([]);
});

test("unmounts before a remove takes the element", async ({ page }) => {
  await open(page, "/mount");
  await expect(page.locator("#chart-1 canvas")).toHaveCount(1);
  await page.evaluate(() => {
    (window as unknown as MountWindow).tesseraHarness.patch("content/board", "", "remove");
  });
  await expect(page.locator("#chart-1")).toHaveCount(0);
  expect(await log(page)).toEqual(["loaded", 'mount chart-1 {"label":"one"}', "cleanup chart-1", "unmount chart-1 connected"]);
  expect(await errors(page)).toEqual([]);
});

for (const build of ["csp-iife", "csp-esm", "iife"]) {
  test(`the ${build} release mounts under script-src 'self', on load and after a visit`, async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));
    const response = await page.goto(`/mount?build=${build}&csp=1`);
    expect(response?.headers()["content-security-policy"]).toBe("script-src 'self'");
    await expect(page.locator("#chart-1 canvas.library")).toHaveAttribute("data-label", "one");
    await page.locator("#to-more").click();
    await expect(page.locator("h1")).toHaveText("Mount more");
    await expect(page.locator("#chart-2 canvas.library")).toHaveAttribute("data-label", "two");
    await expect(page.locator("#chart-1 canvas")).toHaveCount(1);
    expect(problems).toEqual([]);
  });
}
