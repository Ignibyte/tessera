import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Anchors (docs/protocol.md, sections 2.7 and 4.3): a link naming "@NAME" sends the anchored
// component's path, and an anchor the page lacks is reported with nothing sent. Every entry for
// an anchored component carries `@NAME` after its props, however the component was targeted, and
// the reference server checks it against the component it names.

type HarnessWindow = Window & { tesseraHarness: { requestErrors: string[] } };

/** The greeting's entry: its path, its props token and its anchor. */
const ANCHORED_GREETING = /^content\/greeting [A-Za-z0-9\-_.~+/=]+ @hello$/;

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
  expect(headers["tessera-targets"]).toMatch(ANCHORED_GREETING);
  expect(headers["tessera-protocol"]).toBe("2");
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

// The harness records actions instead of sending them, so these run on the IIFE release build
// (`?build=iife`, test/server/README.md), whose actions go through the transport.
for (const [initiator, markup, kind] of [
  ["a poll", `<span id="inside" data-poll__200ms="/"></span>`, "refresh"],
  ["an action", `<button id="inside" data-on:click="@get('/')">Reload</button>`, "action"],
] as const) {
  test(`${initiator} inside an anchored component sends the anchor with the component's path`, async ({ page }) => {
    await page.addInitScript(() => {
      const errors: string[] = [];
      Object.assign(window, { tesseraErrors: errors });
      document.addEventListener("tessera:error", (event) => {
        const { error } = (event as CustomEvent<{ error: unknown }>).detail;
        errors.push(error instanceof Error ? error.message : String(error));
      });
    });
    await page.goto("/?build=iife");
    await page.waitForFunction(() => "Tessera" in window);
    const sent = page.waitForRequest((request) => request.headers()["tessera-request"] === kind);
    const answered = page.waitForResponse((response) => response.request().headers()["tessera-request"] === kind);
    await page.evaluate((html) => {
      document.querySelector('[data-t-anchor="hello"] p')?.insertAdjacentHTML("afterend", html);
    }, markup);
    if (kind === "action") await page.locator("#inside").click();
    expect((await sent).headers()["tessera-targets"]).toMatch(ANCHORED_GREETING);
    // The reference server accepts the anchor and answers with the component, whose fresh markup
    // drops the inserted element.
    expect((await answered).status()).toBe(200);
    await expect(page.locator("#inside")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { tesseraErrors: string[] }).tesseraErrors)).toEqual([]);
  });
}
