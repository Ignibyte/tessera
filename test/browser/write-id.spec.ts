import { expect, test } from "@playwright/test";
import { testName } from "./names.ts";

// A write whose reused keep-alive connection the server drops before answering, on the reference
// server that keeps connections alive (docs/decisions.md, "Browsers resend some writes
// themselves"). Browsers differ: Chromium and Firefox send the POST again on a new connection,
// with the same Tessera-Write-Id, and the server answers the repeat from its store; WebKit does
// not, and Tessera reports the write as indeterminate. The test asserts whichever the server saw,
// and in both the write is applied exactly once.

const origin = `http://127.0.0.1:${process.env.TESSERA_KEEPALIVE_PORT ?? ""}`;

type HarnessWindow = Window & {
  tesseraHarness: {
    request(input: { kind: string; method: string; url: string; targets: string[]; body: string }): Promise<{ status: string }>;
    requestErrors: string[];
  };
};

interface Log {
  count: number;
  arrivals: { id: string; repeat: boolean }[];
}

test("a dropped write is applied once, whether or not the browser repeats it", async ({ page, request }) => {
  const key = testName("write-id");
  await page.goto(`${origin}/counter?key=${key}`);
  await page.waitForFunction(() => "tesseraHarness" in window);
  // A request just before leaves an idle keep-alive connection for the POST to reuse.
  await page.evaluate(() => fetch("/about").then((response) => response.text()));

  const outcome = await page.evaluate(
    (url) => (window as unknown as HarnessWindow).tesseraHarness.request({ kind: "action", method: "POST", url, targets: ["content"], body: "" }),
    `/counter?drop=once&key=${key}`,
  );

  const log = (await (await request.get(`${origin}/counter/log?key=${key}`)).json()) as Log;
  expect(log.count).toBe(1);
  const [first, ...repeats] = log.arrivals;
  expect(first?.repeat).toBe(false);
  expect(first?.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(repeats.length).toBeLessThanOrEqual(1);
  const errors = await page.evaluate(() => (window as unknown as HarnessWindow).tesseraHarness.requestErrors);

  if (repeats.length === 1) {
    // The browser repeated it: same id, answered from the store, and the answer committed.
    expect(repeats[0]).toEqual({ ...first, repeat: true });
    expect(outcome.status).toBe("committed");
    await expect(page.locator("#count")).toHaveText("1");
    expect(errors).toEqual([]);
  } else {
    // No repeat: the answer never came, so Tessera cannot know whether the write was saved.
    expect(outcome.status).toBe("indeterminate");
    expect(errors).toEqual(["The write was sent and no answer came back; it may have been saved, so it is not sent again."]);
  }
});
