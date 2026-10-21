import { expect, test } from "@playwright/test";

// The browser's own repeat of a write (docs/decisions.md, "Browsers resend some writes
// themselves"), on the reference server that keeps connections alive: the repeat carries the same
// Tessera-Write-Id, and the server answers it from its store without applying the write again.

const origin = `http://127.0.0.1:${process.env.TESSERA_KEEPALIVE_PORT ?? ""}`;

type HarnessWindow = Window & {
  tesseraHarness: { request(input: { kind: string; method: string; url: string; targets: string[]; body: string }): Promise<{ status: string }> };
};

interface Log {
  count: number;
  arrivals: { id: string; repeat: boolean }[];
}

test("the browser's repeat of a dropped write carries the same id and is applied once", async ({ page, request }) => {
  const key = `${test.info().project.name}-${test.info().workerIndex}-${test.info().retry}`;
  await page.goto(`${origin}/counter?key=${key}`);
  await page.waitForFunction(() => "tesseraHarness" in window);
  // A request just before leaves an idle keep-alive connection for the POST to reuse.
  await page.evaluate(() => fetch("/about").then((response) => response.text()));

  const outcome = await page.evaluate(
    (url) => (window as unknown as HarnessWindow).tesseraHarness.request({ kind: "action", method: "POST", url, targets: ["content"], body: "" }),
    `/counter?drop=once&key=${key}`,
  );

  const log = (await (await request.get(`${origin}/counter/log?key=${key}`)).json()) as Log;
  expect(log.arrivals).toHaveLength(2);
  const [first, repeat] = log.arrivals;
  expect(first?.repeat).toBe(false);
  expect(repeat).toEqual({ ...first, repeat: true });
  expect(first?.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(log.count).toBe(1);
  expect(outcome.status).toBe("committed");
  await expect(page.locator("#count")).toHaveText("1");
});
