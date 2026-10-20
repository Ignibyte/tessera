import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

// The transport against the reference server on /transport, through test/browser/harness.ts.
// The first test is the point of ticket #11: a write is never sent twice. The server runs with
// --close-connections: a browser resends a request by itself when a reused keep-alive connection
// closes before any answer, so the dropped connection must be a fresh one for the count to be
// Tessera's (docs/decisions.md).

interface Outcome {
  status: string;
  httpStatus?: number;
  redirectedTo?: string;
}

type HarnessWindow = Window & {
  tesseraHarness: { submit(form: string, submitter?: string): Promise<Outcome>; requestErrors: string[] };
};

interface Captured {
  method: string;
  url: string;
  body: string;
  state: string;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/transport");
  await page.waitForFunction(() => "tesseraHarness" in window);
});

/** Points #held at a controller channel of its own. */
async function holdingChannel(page: Page, name: string): Promise<string> {
  const channel = `${name}-${test.info().project.name}-${test.info().workerIndex}-${test.info().retry}`;
  await page.evaluate((path) => {
    document.querySelector("#held")?.setAttribute("action", path);
  }, `/controlled/${channel}/save`);
  return channel;
}

async function captured(request: APIRequestContext, channel: string): Promise<Captured[]> {
  const response = await request.get(`/_control/${channel}/requests`);
  return ((await response.json()) as { requests: Captured[] }).requests;
}

function submit(page: Page, form: string, submitter?: string): Promise<Outcome> {
  return page.evaluate(
    ([formSelector, submitterSelector]) =>
      (window as unknown as HarnessWindow).tesseraHarness.submit(formSelector, submitterSelector),
    [form, submitter] as const,
  );
}

test("a POST whose connection drops after dispatch is sent exactly once", async ({ page, request }) => {
  const channel = await holdingChannel(page, "drop");
  const outcome = submit(page, "#held", "#publish");
  await expect.poll(async () => (await captured(request, channel)).length).toBe(1);

  const released = await request.post(`/_control/${channel}/release`, { data: { drop: true } });
  expect(await released.json()).toMatchObject({ method: "POST", dropped: true });

  // Past every delay a GET would be retried after (250 ms, then 500 ms), with room to spare,
  // then count at the server before waiting on the outcome, so a resend fails here.
  await page.waitForTimeout(1500);
  expect((await captured(request, channel)).map(({ method, state }) => [method, state])).toEqual([["POST", "dropped"]]);
  expect((await outcome).status).toBe("indeterminate");
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.requestErrors)).toEqual([
    "The write was sent and no answer came back; it may have been saved, so it is not sent again.",
  ]);
});

test("the submitter's name and value arrive", async ({ page, request }) => {
  const channel = await holdingChannel(page, "submitter");
  const outcome = submit(page, "#held", "#draft");
  await expect.poll(async () => (await captured(request, channel)).length).toBe(1);
  const [record] = await captured(request, channel);
  expect(record).toMatchObject({ method: "POST", body: "title=Lamp&intent=draft" });
  await request.post(`/_control/${channel}/release`, { data: { status: 204 } });
  expect((await outcome).status).toBe("unchanged");
});

test("a 303 lands as a GET visit", async ({ page }) => {
  await page.locator("#name").fill("Ada");
  const outcome = await submit(page, "#plain");
  expect(outcome).toMatchObject({ status: "committed", httpStatus: 200 });
  expect(new URL(outcome.redirectedTo ?? "").pathname).toBe("/form/done");
  await expect(page.locator("#done")).toHaveText("Thanks, Ada.");
  expect(new URL(page.url()).pathname).toBe("/form/done");
});

test("a 422 renders its errors in place", async ({ page }) => {
  const outcome = await submit(page, "#plain");
  expect(outcome).toMatchObject({ status: "committed", httpStatus: 422 });
  await expect(page.locator("[data-error-summary]")).toHaveText("Name is required.");
  await expect(page.locator("#name")).toHaveAttribute("aria-invalid", "true");
  expect(new URL(page.url()).pathname).toBe("/transport");
});
