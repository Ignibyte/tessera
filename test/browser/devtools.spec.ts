import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { testName } from "./names.ts";

// The devtools hooks (ticket #36) in a real browser, on the release IIFE (`?build=iife`, started by
// the test so it holds the runtime): one test per kind of exchange `tessera:exchange` reports, a
// server's own header read from its detail, `tessera:patched` on what each answer changed, and
// the highlight meta's `data-tessera-patched` coming and going. A plain refresh has no public
// call, so its test uses the harness's transport.

interface Exchange {
  kind: string;
  url: string;
  method: string;
  targets: string[];
  status: number | null;
  contentType: string | null;
  bytes: number | null;
  headers: [string, string][];
  startTime: number;
  firstByteMs: number | null;
  settledMs: number;
  outcome: string;
  prefetched: boolean;
  event: string | null;
}

interface Patched {
  target: string;
  mode: string;
  tag: string;
  marked: boolean;
}

interface Mark {
  element: string;
  present: boolean;
  at: number;
}

type DevtoolsWindow = Window & {
  exchanges: Exchange[];
  patched: Patched[];
  marks: Mark[];
  Tessera: { EXCHANGE_EVENT: string; PATCHED_EVENT: string; start(): unknown };
  runtime: { visit(url: string, options?: { targets?: string[] }): Promise<{ status: string }> };
  tesseraHarness: { request(input: { kind: string; url: string; targets: string[] }): Promise<{ status: string }> };
};

/** Records every exchange, every patched element, and every change of `data-tessera-patched`. */
async function record(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as DevtoolsWindow;
    target.exchanges = [];
    target.patched = [];
    target.marks = [];
    document.addEventListener("tessera:exchange", (event) => {
      target.exchanges.push((event as CustomEvent<Exchange>).detail);
    });
    document.addEventListener("tessera:patched", (event) => {
      const element = event.target as Element;
      const { target: name, mode } = (event as CustomEvent<{ target: string; mode: string }>).detail;
      target.patched.push({ target: name, mode, tag: element.localName, marked: element.hasAttribute("data-tessera-patched") });
    });
    new MutationObserver((records) => {
      for (const change of records) {
        const element = change.target as Element;
        target.marks.push({ element: element.localName, present: element.hasAttribute("data-tessera-patched"), at: performance.now() });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-tessera-patched"] });
  });
}

/** Opens `path` on the IIFE build and starts Tessera, keeping the runtime as `window.runtime`. */
async function open(page: Page, path: string): Promise<void> {
  await record(page);
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}build=iife&start=manual`);
  await page.evaluate(() => {
    const target = window as unknown as DevtoolsWindow;
    target.runtime = target.Tessera.start() as DevtoolsWindow["runtime"];
  });
}

const exchanges = (page: Page): Promise<Exchange[]> => page.evaluate(() => (window as unknown as DevtoolsWindow).exchanges);
const patched = (page: Page): Promise<Patched[]> => page.evaluate(() => (window as unknown as DevtoolsWindow).patched);
const marks = (page: Page): Promise<Mark[]> => page.evaluate(() => (window as unknown as DevtoolsWindow).marks);

/** Waits until `count` exchanges matching `kind` were raised, and returns them. */
async function settled(page: Page, kind: string, count = 1): Promise<Exchange[]> {
  await expect.poll(async () => (await exchanges(page)).filter((exchange) => exchange.kind === kind).length).toBeGreaterThanOrEqual(count);
  return (await exchanges(page)).filter((exchange) => exchange.kind === kind);
}

/** What a fragment answer's detail always holds. */
function expectFragmentAnswer(exchange: Exchange | undefined): void {
  expect(exchange?.status).toBe(200);
  expect(exchange?.contentType).toBe("text/vnd.tessera+html");
  expect(exchange?.bytes).toBeGreaterThan(0);
  expect(exchange?.headers).toContainEqual(["tessera-protocol", "2"]);
  expect(exchange?.firstByteMs).toBeGreaterThanOrEqual(0);
  expect(exchange?.settledMs).toBeGreaterThanOrEqual(exchange?.firstByteMs ?? Infinity);
}

for (const build of ["iife", "csp-iife"]) {
  test(`the ${build} build exports both event names`, async ({ page }) => {
    await page.goto(`/?build=${build}${build.startsWith("csp") ? "&csp=1" : ""}`);
    expect(await page.evaluate(() => {
      const { EXCHANGE_EVENT, PATCHED_EVENT } = (window as unknown as DevtoolsWindow).Tessera;
      return [EXCHANGE_EVENT, PATCHED_EVENT];
    })).toEqual(["tessera:exchange", "tessera:patched"]);
  });
}

test("a visit raises its exchange and a patched event for its target", async ({ page, baseURL }) => {
  await open(page, "/");
  expect(await page.evaluate(() => (window as unknown as DevtoolsWindow).runtime.visit("/about", { targets: ["content"] }))).toMatchObject({ status: "committed" });
  const [visit] = await settled(page, "visit");
  expect(visit).toMatchObject({ url: `${baseURL ?? ""}/about`, method: "GET", targets: ["content"], outcome: "committed", prefetched: false, event: null });
  expectFragmentAnswer(visit);
  expect(await patched(page)).toContainEqual({ target: "content", mode: "morph", tag: "main", marked: false });
  expect(await marks(page)).toEqual([]);
});

test("a whole-document visit raises a patched event for the page on the body", async ({ page }) => {
  await open(page, "/");
  await page.evaluate(() => (window as unknown as DevtoolsWindow).runtime.visit("/bare"));
  const [visit] = await settled(page, "visit");
  expect(visit).toMatchObject({ status: 200, contentType: "text/html", targets: [], outcome: "committed" });
  expect(await patched(page)).toEqual([{ target: "page", mode: "morph", tag: "body", marked: false }]);
});

test("a link pressed prefetches, and its visit takes the prefetched answer", async ({ page, baseURL }) => {
  await open(page, "/");
  await page.locator('nav a[href="/about"]').click();
  await expect(page.locator("main h1")).toHaveText("About");
  const [visit] = await settled(page, "visit");
  const [prefetch] = await settled(page, "prefetch");
  expect(prefetch).toMatchObject({ url: `${baseURL ?? ""}/about`, targets: ["content"], status: 200, bytes: null, outcome: "prefetched" });
  expect(visit).toMatchObject({ prefetched: true, outcome: "committed" });
  expectFragmentAnswer(visit);
  expect((await exchanges(page)).map(({ kind }) => kind)).toEqual(["prefetch", "visit"]);
});

test("a form submit raises its exchange after the visit its Tessera-Location leads to", async ({ page, baseURL }) => {
  await open(page, "/form");
  await page.locator("#name").fill("Ada");
  await page.locator("form button").click();
  await expect(page.locator("main h1")).toHaveText("Sent");
  const [submit] = await settled(page, "submit");
  expect(submit).toMatchObject({ url: `${baseURL ?? ""}/form`, method: "POST", targets: ["content"], status: 200, outcome: "committed" });
  expect(submit?.headers.find(([name]) => name === "tessera-location")?.[1]).toContain("/form/done");
  expect((await exchanges(page)).map(({ kind, url }) => `${kind} ${new URL(url).pathname}`)).toEqual(["visit /form/done", "submit /form"]);
});

test("an action's exchange carries a header the server added for its own tools", async ({ page, request }) => {
  const channel = testName("devtools-action");
  await open(page, "/attributes");
  await page.evaluate((url) => {
    document.querySelector("#vocabulary")?.insertAdjacentHTML("beforeend", `<button id="act" data-on:click="@post('${url}')">Act</button>`);
  }, `/controlled/${channel}/save`);
  await page.locator("#act").click();
  const released = await request.post(`/_control/${channel}/release`, { data: { status: 204, headers: { "X-Debug-Profile": "profile-42" } } });
  expect(released.status()).toBe(200);
  const [action] = await settled(page, "action");
  expect(action).toMatchObject({ method: "POST", status: 204, bytes: null, outcome: "unchanged" });
  expect(new URL(action?.url ?? "").pathname).toBe(`/controlled/${channel}/save`);
  expect(action?.headers).toContainEqual(["x-debug-profile", "profile-42"]);
});

test("a refresh raises its exchange", async ({ page, baseURL }) => {
  await record(page);
  await page.goto("/");
  await page.waitForFunction(() => "tesseraHarness" in window);
  await page.evaluate(() => (window as unknown as DevtoolsWindow).tesseraHarness.request({ kind: "refresh", url: "/", targets: ["content"] }));
  const [refresh] = await settled(page, "refresh");
  expect(refresh).toMatchObject({ url: `${baseURL ?? ""}/`, targets: ["content"], outcome: "committed" });
  expectFragmentAnswer(refresh);
});

test("each poll raises its exchange, apart from other refreshes", async ({ page }) => {
  const key = testName("devtools-poll");
  await open(page, `/poll?key=${key}`);
  // A poll that comes while the one before is still out yields to it (protocol 4.6) and is
  // reported as skipped, with nothing sent; under load that can happen here.
  await expect.poll(async () => (await exchanges(page)).filter(({ kind, outcome }) => kind === "poll" && outcome === "committed").length).toBeGreaterThanOrEqual(2);
  const polls = await settled(page, "poll", 2);
  for (const poll of polls) {
    expect(new URL(poll.url).pathname).toBe("/poll/tick");
    expect(poll).toMatchObject({ method: "GET", targets: ["ticker"] });
    if (poll.outcome === "skipped") expect(poll).toMatchObject({ status: null, bytes: null, headers: [] });
    else {
      expect(poll.outcome).toBe("committed");
      expectFragmentAnswer(poll);
    }
  }
  expect(await patched(page)).toContainEqual({ target: "ticker", mode: "morph", tag: "p", marked: false });
  expect((await exchanges(page)).some(({ kind }) => kind === "refresh")).toBe(false);
});

test("each lazy load raises its exchange", async ({ page }) => {
  await open(page, "/lazy");
  const [first] = await settled(page, "lazy");
  expect(first).toMatchObject({ targets: ["reviews"], outcome: "committed" });
  expect(new URL(first?.url ?? "").pathname).toBe("/lazy/content");
  expectFragmentAnswer(first);
  await page.locator("#more").scrollIntoViewIfNeeded();
  const loads = await settled(page, "lazy", 2);
  expect(loads.map(({ targets }) => targets)).toEqual([["reviews"], ["more"]]);
});

test("a stream raises an exchange for its connection and one for each event", async ({ page }) => {
  const key = testName("devtools-stream");
  await open(page, `/events?count=2&beat=250&key=${key}`);
  const [connection] = await settled(page, "stream");
  expect(connection).toMatchObject({ method: "GET", targets: [], status: 200, contentType: "text/event-stream", bytes: null, outcome: "open" });
  expect(new URL(connection?.url ?? "").pathname).toBe("/events/stream");
  expect(connection?.firstByteMs).toBeGreaterThanOrEqual(0);
  const events = await settled(page, "stream-event", 8);
  expect(events.slice(0, 4).map(({ event, targets, outcome }) => [event, targets, outcome])).toEqual([
    ["tessera-patch-elements", ["events"], "committed"],
    ["tessera-patch-elements", ["content/latest"], "committed"],
    ["tessera-patch-elements", ["@bell"], "committed"],
    ["tessera-patch-signals", ["page"], "committed"],
  ]);
  for (const event of events) {
    expect(event).toMatchObject({ url: connection?.url, status: 200, contentType: "text/event-stream", firstByteMs: null });
    expect(event.bytes).toBeGreaterThan(0);
  }
  const changed = (await patched(page)).map(({ target, mode }) => `${target} ${mode}`);
  expect(changed.slice(0, 3)).toEqual(["events prepend", "content/latest morph", "content/panel/Bell.2:count morph"]);
});

test("under the highlight meta, a patched element carries data-tessera-patched for 600 ms", async ({ page }) => {
  await open(page, "/");
  await page.evaluate(() => {
    document.head.insertAdjacentHTML("beforeend", '<meta name="tessera-debug" content="highlight">');
  });
  await page.evaluate(() => (window as unknown as DevtoolsWindow).runtime.visit("/about", { targets: ["content"] }));
  await expect.poll(async () => (await marks(page)).length).toBe(2);
  const [added, removed] = await marks(page);
  expect(added).toMatchObject({ element: "main", present: true });
  expect(removed).toMatchObject({ element: "main", present: false });
  expect((removed?.at ?? 0) - (added?.at ?? 0)).toBeGreaterThanOrEqual(550);
  expect(await patched(page)).toContainEqual({ target: "content", mode: "morph", tag: "main", marked: true });
  await expect(page.locator("main[data-tessera-patched]")).toHaveCount(0);
});
