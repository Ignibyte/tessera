import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// The attribute vocabulary on the reference server's /attributes page, booted by
// test/browser/harness.ts.

interface Harness {
  signals: Record<string, unknown>;
  scopes: { scopeOf(owner: Element): Record<string, unknown> };
  calls: readonly { method: string; url: string; options: unknown }[];
  failures: string[];
  settle(): Promise<void>;
}

type HarnessWindow = Window & { tesseraHarness: Harness };

/** Waits until the page's renders, effects and tasks have settled. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.settle());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/attributes");
  await page.waitForFunction(() => "tesseraHarness" in window);
});

test.afterEach(async ({ page }) => {
  await settle(page);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.failures)).toEqual([]);
});

test("form fields bind both ways", async ({ page }) => {
  await expect(page.locator("#greeting")).toHaveText("Hello, Ada");
  await expect(page.locator("#name")).toHaveValue("Ada");
  await expect(page.locator("#note")).toHaveValue("hi");
  await expect(page.locator("#choice")).toHaveValue("two");

  await page.locator("#name").fill("Grace");
  await page.locator("#qty").fill("4");
  await page.locator("#agree").check();
  await page.locator("#tag-b").check();
  await page.locator("#size-s").check();
  await page.locator("#choice").selectOption("one");
  await page.locator("#many").selectOption(["x", "y"]);
  await page.locator("#note").fill("bye");

  await expect(page.locator("#greeting")).toHaveText("Hello, Grace");
  expect(JSON.parse((await page.locator("#state").textContent()) ?? "")).toEqual({
    name: "Grace",
    qty: 4,
    agree: true,
    tags: ["a", "b"],
    size: "s",
    choice: "one",
    many: ["x", "y"],
    note: "bye",
  });

  // The page's signals live in the layout's content region, not in the document's scope.
  await page.evaluate(() => {
    const { scopes } = (window as unknown as HarnessWindow).tesseraHarness;
    const region = document.querySelector("[data-region=content]");
    if (!region) throw new Error("no content region");
    const signals = scopes.scopeOf(region);
    signals.name = "Edsger";
    signals.size = "m";
  });
  await expect(page.locator("#name")).toHaveValue("Edsger");
  await expect(page.locator("#size-m")).toBeChecked();
});

test("events drive classes, styles, attributes and visibility", async ({ page }) => {
  const panel = page.locator("#panel");
  await expect(panel).toBeHidden();
  await expect(page.locator("#toggle")).toHaveAttribute("aria-expanded", "false");

  await page.locator("#toggle").click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveClass("open");
  await expect(panel).toHaveCSS("color", "rgb(255, 0, 0)");
  await expect(page.locator("#toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#count")).toHaveText("1");
  await expect(page.locator("#effect")).toHaveText("count is 1");

  await page.locator("#keys").press("a");
  await page.locator("#keys").press("Enter");
  await expect(page.locator("#pressed")).toHaveText("1");

  await page.locator("#link").click();
  await expect(page.locator("#count")).toHaveText("11");
  expect(new URL(page.url()).pathname).toBe("/attributes");

  // Every click so far landed outside #menu.
  await expect(page.locator("#outside")).toHaveText("2");
  await page.locator("#inside").click();
  await settle(page);
  await expect(page.locator("#outside")).toHaveText("2");
  await page.locator("#heading").click();
  await expect(page.locator("#outside")).toHaveText("3");
});

test("debounce, refs, init, ignore and actions", async ({ page }) => {
  await page.locator("#search").pressSequentially("tess", { delay: 10 });
  await expect(page.locator("#typed")).toHaveText("tess");

  await expect(page.locator("#ref")).toHaveText("ref");
  await expect(page.locator("#init")).toHaveText("initialized");
  await expect(page.locator("#ignored")).toHaveText("untouched");

  await page.locator("#save").click();
  await settle(page);
  const calls = await page.evaluate(() =>
    (window as unknown as HarnessWindow).tesseraHarness.calls.map(({ method, url, options }) => ({ method, url, options })),
  );
  expect(calls).toEqual([
    { method: "post", url: "/save", options: { count: 0 } },
  ]);
});

test("__case.camel listens to a camelCase custom event, which HTML could not spell", async ({ page }) => {
  const dispatch = (type: string, detail: string): Promise<void> =>
    page.evaluate(([name, value]) => {
      document.querySelector("#picker")?.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: value }));
    }, [type, detail] as const);
  await dispatch("item-selected", "kebab");
  await settle(page);
  await expect(page.locator("#picked")).toHaveText("none");
  await dispatch("itemSelected", "lamp");
  await expect(page.locator("#picked")).toHaveText("lamp");
});

test("__case.camel on data-attr writes SVG's viewBox, which HTML lowercases", async ({ page }) => {
  await expect(page.locator("#icon")).toHaveAttribute("viewBox", "0 0 10 10");
  await page.locator("#zoom").click();
  await expect(page.locator("#icon")).toHaveAttribute("viewBox", "0 0 20 20");
  // The SVG itself sees it: a lowercase viewbox attribute would leave viewBox.baseVal empty.
  expect(await page.locator("#icon").evaluate((svg) => (svg as SVGSVGElement).viewBox.baseVal.width)).toBe(20);
});
