import { expect, test } from "@playwright/test";

// The no-JavaScript baseline of the reference server: what a plain browser gets.
test.use({ javaScriptEnabled: false });

const VARY = "Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout";

test("the fixture page loads with JavaScript off and shows its regions", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers().vary).toBe(VARY);
  await expect(page).toHaveTitle("Home · Fixture");
  const sidebar = page.locator('[data-region="sidebar"]');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "About" })).toBeVisible();
  await expect(page.locator('[data-region="content"] h1')).toHaveText("Home");
  await expect(page.locator('[data-region="notes"] li')).toHaveText(["First note", "Second note"]);
});

test("a form posts with JavaScript off: 422 in place, then 303 to the next page", async ({ page }) => {
  await page.goto("/form");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toHaveText("Name is required.");
  await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
  expect(new URL(page.url()).pathname).toBe("/form");
  await page.getByLabel("Name").fill("Ada");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("#done")).toHaveText("Thanks, Ada.");
  expect(new URL(page.url()).pathname).toBe("/form/done");
});
