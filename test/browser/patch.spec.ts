import { expect, test } from "@playwright/test";

// Patches on the reference server's /patch page, driven through test/browser/harness.ts.

type HarnessWindow = Window & {
  tesseraHarness: { patch(target: string, markup: string, mode?: string): void; failures: string[] };
  ranScript?: boolean;
};

test.beforeEach(async ({ page }) => {
  await page.goto("/patch");
  await page.waitForFunction(() => "tesseraHarness" in window);
});

test("morphing a region keeps the focused input, its value and its caret", async ({ page }) => {
  const field = page.locator("#field");
  await field.fill("typed");
  await expect(field).toBeFocused();

  await page.evaluate(() => {
    (window as unknown as HarnessWindow).tesseraHarness.patch(
      "form-area",
      `<section data-region="form-area"><label for="field">Your field</label><input id="field" value="server-new"><p id="status">new</p></section>`,
    );
  });

  await expect(page.locator("#status")).toHaveText("new");
  await expect(page.locator("[data-region=form-area] label")).toHaveText("Your field");
  await expect(field).toHaveValue("typed");
  await expect(field).toBeFocused();
  await page.keyboard.type("!");
  await expect(field).toHaveValue("typed!");
});

test("a fragment's script is inserted as markup and never runs", async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as HarnessWindow).tesseraHarness.patch(
      "form-area",
      `<script>window.ranScript = true</script><p id="added">added</p>`,
      "append",
    );
  });
  await expect(page.locator("#added")).toHaveText("added");
  await expect(page.locator("[data-region=form-area] script")).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).ranScript)).toBeUndefined();
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.failures)).toEqual([]);
});
