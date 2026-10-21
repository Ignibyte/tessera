import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { testName } from "./names.ts";

// Forms without replay on the reference server's /forms page: each scenario with JavaScript on
// (Tessera) and, where the browser alone can show it, off. The server closes connections, so a
// dropped one is fresh and the count is what Tessera sent (docs/decisions.md).

interface Captured {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string>;
  state: string;
}

/** Points a form at a controller channel of its own. */
async function hold(page: Page, form: string, name: string, path: string): Promise<string> {
  const id = testName(name);
  await page.evaluate(([selector, action]) => {
    document.querySelector(selector)?.setAttribute("action", action);
  }, [form, `/controlled/${id}/${path}`] as const);
  return id;
}

async function captured(request: APIRequestContext, id: string): Promise<Captured[]> {
  return ((await (await request.get(`/_control/${id}/requests`)).json()) as { requests: Captured[] }).requests;
}

async function open(page: Page): Promise<void> {
  await page.goto("/forms");
  await page.waitForFunction(() => "tesseraHarness" in window);
}

async function mark(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & { tesseraMarker?: number }).tesseraMarker = 1;
  });
}

const marked = (page: Page): Promise<boolean> => page.evaluate(() => (window as Window & { tesseraMarker?: number }).tesseraMarker === 1);

test.describe("with JavaScript", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await mark(page);
  });

  test("an opted-out form and a cross-origin form are the browser's", async ({ page }) => {
    await page.evaluate(() => {
      window.addEventListener("submit", (event) => {
        if ((event.target as Element).id !== "external") return;
        (window as Window & { externalClaimed?: boolean }).externalClaimed = event.defaultPrevented;
        event.preventDefault();
      });
    });
    await page.locator("#external-send").click();
    expect(await page.evaluate(() => (window as Window & { externalClaimed?: boolean }).externalClaimed)).toBe(false);

    await page.locator("#off-send").click();
    await expect(page.locator("#done")).toHaveText("Thanks, Off.");
    expect(await marked(page)).toBe(false);
  });

  test("the submitter's name and value arrive", async ({ page, request }) => {
    const id = await hold(page, "#held", "submitter", "save");
    await page.locator("#draft").click();
    await expect.poll(async () => (await captured(request, id)).length).toBe(1);
    expect((await captured(request, id))[0]).toMatchObject({ method: "POST", body: "title=Lamp&intent=draft" });
    await request.post(`/_control/${id}/release`, { data: { status: 204 } });
  });

  test("a 303 lands as a GET visit", async ({ page }) => {
    await page.locator("#plain-name").fill("Ada");
    await page.locator("#plain-send").click();
    await expect(page.locator("#done")).toHaveText("Thanks, Ada.");
    expect(new URL(page.url()).pathname).toBe("/form/done");
    expect(await marked(page)).toBe(true);
  });

  test("a GET form is a visit with its fields in the query", async ({ page }) => {
    await page.locator("#search-go").click();
    await expect(page.locator("#done")).toHaveText("Thanks, Grace.");
    expect(new URL(page.url()).search).toBe("?name=Grace");
    expect(await marked(page)).toBe(true);
  });

  test("a 307 answering the write is not followed", async ({ page, request }) => {
    const id = await hold(page, "#held", "redirect", "save");
    await page.locator("#publish").click();
    await expect.poll(async () => (await captured(request, id)).length).toBe(1);
    await request.post(`/_control/${id}/release`, { data: { status: 307, headers: { Location: `/controlled/${id}/elsewhere` } } });
    await expect(page.locator("[data-tessera-indeterminate]")).toBeVisible();
    await page.waitForTimeout(500);
    expect((await captured(request, id)).map(({ url }) => url)).toEqual([`/controlled/${id}/save`]);
  });

  test("a 422 commits in place and focuses the error summary", async ({ page }) => {
    await page.locator("#plain-send").click();
    await expect(page.locator("[data-error-summary]")).toHaveText("Name is required.");
    await expect(page.locator("[data-error-summary]")).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/forms");
    expect(await marked(page)).toBe(true);
  });

  test("a dropped connection after dispatch sends exactly one POST and says so", async ({ page, request }) => {
    const id = await hold(page, "#held", "drop", "save");
    await page.locator("#publish").click();
    await expect.poll(async () => (await captured(request, id)).length).toBe(1);
    await request.post(`/_control/${id}/release`, { data: { drop: true } });
    await expect(page.locator("[data-tessera-indeterminate]")).toBeVisible();
    await page.waitForTimeout(1500);
    expect((await captured(request, id)).map(({ method, state }) => [method, state])).toEqual([["POST", "dropped"]]);
  });

  test("a second submit while the first is in flight sends nothing", async ({ page, request }) => {
    const id = await hold(page, "#held", "double", "save");
    await page.locator("#publish").click();
    await expect.poll(async () => (await captured(request, id)).length).toBe(1);
    await page.locator("#publish").click();
    await page.locator("#draft").click();
    await page.waitForTimeout(300);
    expect(await captured(request, id)).toHaveLength(1);
    await request.post(`/_control/${id}/release`, { data: { status: 204 } });
    // Blocked, not queued: once the first is answered, the second and third never go.
    await page.waitForTimeout(500);
    expect(await captured(request, id)).toHaveLength(1);
    await page.locator("#draft").click();
    await expect.poll(async () => (await captured(request, id)).length).toBe(2);
    await request.post(`/_control/${id}/release`, { data: { status: 204 } });
  });

  test("a file goes as multipart, unchanged", async ({ page, request }) => {
    const id = await hold(page, "#upload", "upload", "upload");
    await page.locator("#file").setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello file") });
    await page.locator("#upload-send").click();
    await expect.poll(async () => (await captured(request, id)).length).toBe(1);
    const [record] = await captured(request, id);
    expect(record?.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(record?.body).toContain('name="attachment"; filename="note.txt"');
    expect(record?.body).toContain("hello file");
    await request.post(`/_control/${id}/release`, { data: { status: 204 } });
  });

  test("an invalid form sends nothing", async ({ page, request }) => {
    const id = await hold(page, "#required", "invalid", "required");
    await page.locator("#required-send").click();
    await page.waitForTimeout(300);
    expect(await captured(request, id)).toEqual([]);
    expect(await page.locator("#needed").evaluate((input) => (input as HTMLInputElement).validity.valid)).toBe(false);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test.beforeEach(async ({ page }) => {
    await page.goto("/forms");
  });

  /** With JavaScript off the page cannot rewrite its own form, so the request does it. */
  async function holdNatively(page: Page, form: string, name: string, path: string): Promise<string> {
    const id = testName(name);
    await page.locator(form).evaluate((element, action) => {
      element.setAttribute("action", action);
    }, `/controlled/${id}/${path}`);
    return id;
  }

  test("the submitter's name and value arrive", async ({ page, request }) => {
    const id = await holdNatively(page, "#held", "native-submitter", "save");
    void page.locator("#draft").click();
    await expect.poll(async () => (await captured(request, id)).length).toBe(1);
    expect((await captured(request, id))[0]?.body).toBe("title=Lamp&intent=draft");
    await request.post(`/_control/${id}/release`, { data: { serve: "/about" } });
  });

  test("a 303 lands on the next page", async ({ page }) => {
    await page.locator("#plain-name").fill("Ada");
    await page.locator("#plain-send").click();
    await expect(page.locator("#done")).toHaveText("Thanks, Ada.");
  });

  test("a 422 shows the errors", async ({ page }) => {
    await page.locator("#plain-send").click();
    await expect(page.locator("[data-error-summary]")).toHaveText("Name is required.");
  });

  test("a file goes as multipart", async ({ page, request }) => {
    const id = await holdNatively(page, "#upload", "native-upload", "upload");
    await page.locator("#file").setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello file") });
    void page.locator("#upload-send").click();
    await expect.poll(async () => (await captured(request, id)).length).toBe(1);
    expect((await captured(request, id))[0]?.body).toContain('filename="note.txt"');
    await request.post(`/_control/${id}/release`, { data: { serve: "/about" } });
  });

  test("an invalid form sends nothing", async ({ page, request }) => {
    const id = await holdNatively(page, "#required", "native-invalid", "required");
    await page.locator("#required-send").click();
    await page.waitForTimeout(300);
    expect(await captured(request, id)).toEqual([]);
  });
});
