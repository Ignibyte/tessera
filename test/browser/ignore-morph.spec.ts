import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// data-ignore-morph across visits and patches (#44): a morph that brings the field again keeps the
// live node and what the user typed; a visit or patch whose markup drops it lands without an error.

type HarnessWindow = Window & {
  tesseraHarness: { patch(target: string, markup: string, mode?: string): void; failures: string[]; requestErrors: string[] };
};
type MarkedArea = HTMLTextAreaElement & { marked?: boolean };

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => "tesseraHarness" in window);
}

const errors = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const { failures, requestErrors } = (window as unknown as HarnessWindow).tesseraHarness;
    return [...failures, ...requestErrors];
  });

/** Types into the chat box and marks the node, so a later look can tell it is the same one. */
async function typeIntoBox(page: Page): Promise<void> {
  await page.locator("textarea[name=body]").fill("half a message");
  await page.evaluate(() => {
    const box = document.querySelector<MarkedArea>("textarea[name=body]");
    if (!box) throw new Error("no box");
    box.marked = true;
  });
}

test("a visit whose markup keeps the data-ignore-morph box keeps the same node and its typed text", async ({ page }) => {
  await open(page, "/chat");
  await typeIntoBox(page);

  await page.locator("#to-sent").click();
  await expect(page.locator("h1")).toHaveText("Chat sent");
  await expect(page.locator("#notice")).toHaveText("Sent.");
  const box = page.locator("textarea[name=body]");
  await expect(box).toHaveCount(1);
  await expect(box).toHaveValue("half a message");
  expect(await box.evaluate((element: MarkedArea) => ({ marked: element.marked, id: element.getAttribute("id") }))).toEqual({ marked: true, id: null });
  expect(new URL(page.url()).pathname).toBe("/chat-sent");
  expect(await errors(page)).toEqual([]);
});

test("a visit whose markup puts a different form in the box's place lands without an error", async ({ page }) => {
  await open(page, "/chat");
  await typeIntoBox(page);

  await page.locator("#to-rate").click();
  await expect(page.locator("h1")).toHaveText("Chat rate");
  await expect(page.locator("#stars")).toHaveCount(1);
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/chat-rate");
  expect(await errors(page)).toEqual([]);
});

test("a visit whose region no longer holds the box lands without an error", async ({ page }) => {
  await open(page, "/chat");
  await typeIntoBox(page);

  await page.locator("#to-closed").click();
  await expect(page.locator("h1")).toHaveText("Chat closed");
  await expect(page.locator("#closed")).toHaveText("This chat is closed.");
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/chat-closed");

  // Back brings the box again, as a new node.
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Chat");
  await expect(page.locator("textarea[name=body]")).toHaveValue("");
  expect(await errors(page)).toEqual([]);
});

test("an inner patch that replaces the box's parent's children drops it without an error", async ({ page }) => {
  await open(page, "/chat");
  await typeIntoBox(page);

  await page.evaluate(() => {
    (window as unknown as HarnessWindow).tesseraHarness.patch("content/chat", `<p id="thanks">Thanks.</p>`, "inner");
  });
  await expect(page.locator("#thanks")).toHaveText("Thanks.");
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(await errors(page)).toEqual([]);
});
