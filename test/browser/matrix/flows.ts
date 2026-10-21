// The matrix's flows, ported from jqstar `test/fixtures/navigation-decision/driver.mjs` (runFlow,
// at f17952b). jqstar's candidates were Turbo, htmx and its own bridge; here the candidates are the
// browser without JavaScript and Tessera. Where an assertion read jqstar's own instrumentation
// (applications, bridge phases), it reads Tessera's kernel through the harness instead;
// docs/navigation-matrix.md says how, scenario by scenario.
import type { Page } from "@playwright/test";

export interface Candidate {
  readonly id: "nojs" | "tessera";
  readonly javascript: boolean;
}

export interface Metrics {
  revision: number;
  reads: number;
  writes: number;
  requests: {
    route: string;
    method: string;
    tessera: boolean;
    status: number | null;
    aborted: boolean;
    multipart: boolean;
    fileMatched: boolean;
    submitterMatched: boolean;
    disabledExcluded: boolean;
  }[];
}

export interface FlowContext {
  readonly page: Page;
  readonly base: string;
  readonly candidate: Candidate;
  readonly baseline: Metrics;
  /** The session's metrics, read apart from the page, which may be on a browser error page. */
  readonly metrics: () => Promise<Metrics>;
  readonly check: (key: string, passed: boolean) => void;
  /** Requests the browser reported as failed, documents and fetches alike. */
  readonly failures: () => number;
}

interface Harness {
  settle(): Promise<void>;
  resources(): string[];
  mounts(): number;
  scopes: { scopeOf(owner: Element): Record<string, unknown> };
}

type HarnessWindow = Window & { tesseraHarness?: Harness; __kept?: Element | null };

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Polls `read` until `predicate` holds; a read may fail while a document is between loads. */
export async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean = Boolean, timeout = 4000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch {
      // A document can be between loads.
    }
    await pause(30);
  }
  throw new Error("Navigation fixture condition timed out.");
}

/** With Tessera: the harness is up, its renders and requests have settled, nothing is busy. */
export async function ready(page: Page, candidate: Candidate): Promise<void> {
  if (!candidate.javascript) return;
  await page.waitForFunction(() => "tesseraHarness" in window, undefined, { timeout: 4000 });
  await page.evaluate(() => (window as HarnessWindow).tesseraHarness?.settle());
  await until(() => page.evaluate(() => document.querySelector("[aria-busy]") === null));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );
}

async function route(page: Page, name: string, candidate: Candidate): Promise<void> {
  await until(() => page.locator("#main").getAttribute("data-route"), (value) => value === name);
  await ready(page, candidate);
}

/**
 * The page's own part of the ledger as `kind owner` lines, sorted; empty without Tessera. The
 * transport's tasks for requests in flight or prefetched come and go, so they are left out.
 */
async function ledger(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...((window as HarnessWindow).tesseraHarness?.resources() ?? [])].filter((line) => !/^task transport:/.test(line)).sort(),
  );
}

async function routeName(page: Page): Promise<string> {
  return page.evaluate(() => document.getElementById("main")?.getAttribute("data-route") ?? "browser-error").catch(() => "browser-error");
}

async function focusName(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const focus = document.activeElement;
      if (focus && ["title", "destination", "preference", "query-value"].includes(focus.id)) return focus.id;
      if (focus === document.body || focus === null) return "body";
      return focus.localName === "h1" && focus.closest("#main") ? "heading" : "other";
    })
    .catch(() => "other");
}

/** Waits until the URL and the route have stayed the same for half a second (at most 5 s). */
async function steady(page: Page): Promise<void> {
  const snapshot = async (): Promise<string> => `${page.url()} ${await routeName(page)}`;
  let last = await snapshot();
  let since = Date.now();
  const deadline = Date.now() + 5000;
  while (Date.now() - since < 500 && Date.now() < deadline) {
    await pause(50);
    const now = await snapshot();
    if (now !== last) {
      last = now;
      since = Date.now();
    }
  }
}

async function errorVisible(page: Page): Promise<boolean> {
  return page.locator("#error-summary").isVisible().catch(() => false);
}

async function errorAccessible(page: Page): Promise<boolean> {
  await until(async () => (await errorVisible(page)) && (await focusName(page)) === "title");
  return true;
}

async function destinationVisible(page: Page): Promise<boolean> {
  const box = await page.locator("#destination").boundingBox();
  const viewport = page.viewportSize();
  return Boolean(box && viewport && box.y >= -2 && box.y < viewport.height);
}

/** Clicks by position, measured before the first click, as a person aiming at both would. */
async function pointerTargets(page: Page, ids: readonly string[]): Promise<(id: string) => Promise<void>> {
  await page.locator(`#${ids[0] ?? ""}`).scrollIntoViewIfNeeded();
  const targets = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const box = await page.locator(`#${id}`).boundingBox();
    if (!box) throw new Error("Navigation pointer target is unavailable.");
    targets.set(id, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  return async (id) => {
    const target = targets.get(id);
    if (target) await page.mouse.click(target.x, target.y);
  };
}

export async function runFlow(key: string, context: FlowContext): Promise<void> {
  const { page, base, candidate, baseline, check, failures } = context;
  const getMetrics = context.metrics;
  const visit = async (id: string, target: string): Promise<void> => {
    await page.locator(`#${id}`).click();
    await route(page, target, candidate);
  };
  const canonical = async (target: string): Promise<boolean> => (await routeName(page)) === target;
  const path = (): string => new URL(page.url()).pathname;

  switch (key) {
    case "direct": {
      check("canonicalDocument", await canonical("start"));
      check(
        "accessibleLandmarks",
        (await page.locator("html[lang=en] main h1").count()) === 1 && (await page.locator('nav[aria-label="Documents"]').count()) === 1,
      );
      await page.locator("#disclosure summary").click();
      check("nativeDisclosure", await page.locator("#disclosure").evaluate((node) => (node as HTMLDetailsElement).open));
      // jqstar: its applications were live and connected. Tessera: one attributes mount, a live
      // ledger, and a directive applied.
      check(
        "ownedRoots",
        !candidate.javascript ||
          ((await page.evaluate(() => (window as HarnessWindow).tesseraHarness?.mounts())) === 1 &&
            (await ledger(page)).length > 0 &&
            (await page.locator("#enhanced").textContent()) === "enhanced"),
      );
      break;
    }
    case "visit": {
      await visit("query", "guide");
      const url = new URL(page.url());
      check("canonicalURL", url.pathname === "/navigation/guide" && url.searchParams.get("view") === "details");
      check("canonicalTitle", (await page.title()) === "Tessera navigation guide");
      check("oneRead", (await getMetrics()).reads - baseline.reads === 1);
      check("zeroWrites", (await getMetrics()).writes === 0);
      check("canonicalDocument", await canonical("guide"));
      break;
    }
    case "local-anchor": {
      await page.locator("#local-anchor").click();
      await until(() => destinationVisible(page));
      check("zeroReads", (await getMetrics()).reads === baseline.reads);
      check("zeroWrites", (await getMetrics()).writes === 0);
      check("anchorVisible", await destinationVisible(page));
      break;
    }
    case "remote-anchor": {
      await visit("remote-anchor", "long");
      await until(() => destinationVisible(page));
      check("oneRead", (await getMetrics()).reads - baseline.reads === 1);
      check("anchorVisible", await destinationVisible(page));
      check("canonicalURL", path() === "/navigation/long" && new URL(page.url()).hash === "#destination");
      break;
    }
    case "history": {
      await page.evaluate(() => {
        window.scrollTo(0, 500);
      });
      await until(() => page.evaluate(() => Math.round(window.scrollY)), (value) => Math.abs(value - 500) < 3);
      await visit("guide", "guide");
      await page.goBack();
      await route(page, "start", candidate);
      await until(() => page.evaluate(() => window.scrollY), (value) => Math.abs(value - 500) < 3).catch(() => 0);
      check("restoredScroll", Math.abs((await page.evaluate(() => window.scrollY)) - 500) < 3);
      await page.goForward();
      await route(page, "guide", candidate);
      check("canonicalHistory", path() === "/navigation/guide");
      await page.reload();
      await route(page, "guide", candidate);
      const report = await getMetrics();
      check("reloadIsGET", report.requests.at(-1)?.method === "GET");
      check("cacheFacts", report.reads >= 3 && report.writes === 0);
      break;
    }
    case "eligibility": {
      const popup = page.waitForEvent("popup");
      await page.locator("#new-tab").click();
      const opened = await popup;
      await opened.waitForLoadState();
      const target = new URL(opened.url()).pathname === "/navigation/guide";
      await opened.close();
      const modified = page.context().waitForEvent("page", { timeout: 2000 }).catch(() => undefined);
      await page.locator("#guide").click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
      const tab = await modified;
      // Playwright misses about 1 in 20 of the background tabs headless Chromium opens for a
      // modified click, or reports one still at about:blank after its load event, while the
      // server already has the tab's GET. So the server is the witness: the browser itself, not
      // Tessera, asked for the guide a second time.
      const browserReads = async (): Promise<number> =>
        (await getMetrics()).requests.filter((request) => request.route === "guide" && !request.tessera).length;
      const opensTab = await until(browserReads, (reads) => reads === 2).then(() => true, () => false);
      check("browserOwnedTarget", target && opensTab);
      await tab?.close();
      check("unchangedOriginalDocument", await canonical("start"));
      check("zeroWrites", (await getMetrics()).writes === 0);
      break;
    }
    case "redirect": {
      await visit("redirect", "guide");
      check("twoReads", (await getMetrics()).reads - baseline.reads === 2);
      check("canonicalURL", path() === "/navigation/guide");
      check("canonicalTitle", (await page.title()) === "Tessera navigation guide");
      check("canonicalDocument", await canonical("guide"));
      break;
    }
    case "http-errors": {
      let visible = true;
      let focused = true;
      for (const name of ["not-found", "server-error"]) {
        await visit(name, name);
        visible &&= await errorVisible(page);
        focused &&= await errorAccessible(page).catch(() => false);
        await page.goto(`${base}/start`);
        await ready(page, candidate);
      }
      const statuses = (await getMetrics()).requests.map((request) => request.status);
      check("authoritativeStatus", statuses.includes(404) && statuses.includes(500));
      check("visibleError", visible);
      check("accessibleError", focused);
      check("zeroWrites", (await getMetrics()).writes === 0);
      break;
    }
    case "content-types": {
      const download = page.waitForEvent("download");
      await page.locator("#download").click();
      const received = await download;
      check("downloadReceived", received.suggestedFilename() === "example.txt" && (await received.failure()) === null);
      await page.locator("#non-html").click();
      await until(() => page.locator("body").textContent(), (value) => value?.includes("Canonical plain text") ?? false);
      check("nonHTMLReceived", ((await page.locator("body").textContent()) ?? "").includes("Canonical plain text"));
      check("zeroWrites", (await getMetrics()).writes === 0);
      break;
    }
    case "head": {
      const origin = await page.evaluate(() => performance.timeOrigin);
      await visit("head-change", "head");
      check("canonicalHead", (await page.locator('meta[name="navigation-page"]').getAttribute("content")) === "head");
      check("canonicalStyle", await page.locator("#main").evaluate((node) => getComputedStyle(node).borderTopWidth === "7px"));
      check(
        "canonicalScript",
        await page.evaluate(
          (enabled) => {
            const proof = (globalThis as { __navigationHeadProof?: number }).__navigationHeadProof;
            return enabled ? proof === 1 : proof === undefined;
          },
          candidate.javascript,
        ),
      );
      check("fullDocumentBoundary", origin !== (await page.evaluate(() => performance.timeOrigin)));
      break;
    }
    case "get-form": {
      await page.locator("#query-value").fill("navigation");
      await page.locator("#search-submit").click();
      await route(page, "search", candidate);
      const request = (await getMetrics()).requests.filter((item) => item.route === "search").at(-1);
      check("canonicalQuery", new URL(page.url()).searchParams.get("query") === "navigation");
      check("submitterIncluded", request?.submitterMatched ?? false);
      check("disabledExcluded", request?.disabledExcluded ?? false);
      check("zeroWrites", (await getMetrics()).writes === 0);
      break;
    }
    case "validation": {
      await page.locator("#title").fill("");
      await page.locator("#save").click();
      await pause(100);
      check("zeroDispatch", (await getMetrics()).requests.length === baseline.requests.length);
      check(
        "invalidFocus",
        await page.locator("#title").evaluate((node) => node === node.ownerDocument.activeElement && !(node as HTMLInputElement).validity.valid),
      );
      break;
    }
    case "write": {
      await page.locator("#attachment").setInputFiles({ name: "navigation-proof.txt", mimeType: "text/plain", buffer: Buffer.from("navigation-file-proof") });
      await page.locator("#save").click();
      await route(page, "saved", candidate);
      const report = await getMetrics();
      const write = report.requests.find((request) => request.method === "POST");
      check("oneWrite", report.writes === 1);
      check("multipartFile", Boolean(write?.multipart && write.fileMatched));
      check("submitterIncluded", write?.submitterMatched ?? false);
      check("disabledExcluded", write?.disabledExcluded ?? false);
      check("revisionAdvanced", report.revision === 2);
      check("redirectIsGET", write?.status === 303 && report.requests.at(-1)?.method === "GET" && path() === "/navigation/saved");
      await page.reload();
      await route(page, "saved", candidate);
      const reloaded = await getMetrics();
      check("reloadIsGET", reloaded.writes === 1 && reloaded.requests.at(-1)?.method === "GET");
      break;
    }
    case "preview": {
      await page.locator("#preview").click();
      await route(page, "preview", candidate);
      const report = await getMetrics();
      check("previewSubmitter", report.requests.find((request) => request.method === "POST")?.submitterMatched ?? false);
      check("zeroCommittedWrites", report.writes === 0 && report.revision === 1);
      check("authoritativePreview", path() === "/navigation/preview");
      break;
    }
    case "server-validation": {
      await page.locator("#title").fill("invalid");
      await page.locator("#save").click();
      await route(page, "edit", candidate);
      const validation = await errorAccessible(page).catch(() => false);
      await page.goto(`${base}/start`);
      await ready(page, candidate);
      await page.locator('input[name="revision"]').evaluate((node) => {
        (node as HTMLInputElement).value = "0";
      });
      await page.locator("#save").click();
      await route(page, "edit", candidate);
      const conflict = await errorAccessible(page).catch(() => false);
      const report = await getMetrics();
      const statuses = report.requests.map((request) => request.status);
      check("authoritativeStatus", statuses.includes(422) && statuses.includes(409));
      check("revisionUnchanged", report.revision === 1 && report.writes === 0);
      check("visibleError", validation && conflict);
      check("accessibleError", validation && conflict);
      break;
    }
    case "write-loss": {
      await page.locator("#lose-response").click({ noWaitAfter: true }).catch(() => undefined);
      await until(getMetrics, (value) => value.writes === 1);
      await pause(300);
      const report = await getMetrics();
      check("oneWrite", report.writes === 1);
      check("noAutomaticReplay", report.requests.filter((request) => request.method === "POST").length === 1);
      // jqstar: its recovery element. Tessera: the message it shows for a write whose fate is
      // unknown (#15). Without JavaScript the browser does not present the lost answer as a page
      // of the site: Chromium shows its error page, Firefox reports the load failed and keeps the
      // page, WebKit shows an empty document without reporting a failure.
      check(
        "visibleRecovery",
        candidate.javascript
          ? await until(() => page.locator("[data-tessera-indeterminate]").isVisible()).catch(() => false)
          : failures() > 0 || (await routeName(page)) === "browser-error",
      );
      break;
    }
    case "write-307": {
      await page.locator("#moved").click();
      await until(getMetrics, (value) => value.requests.some((request) => request.status === 307));
      await pause(300);
      const posts = (await getMetrics()).requests.filter((request) => request.method === "POST");
      // The browser follows a 307 with the same method and body: a second POST, to /saved.
      check("noRedirectReplay", candidate.javascript ? posts.length === 1 : posts.length === 2 && posts[1]?.route === "saved");
      check(
        "visibleRecovery",
        !candidate.javascript || (await until(() => page.locator("[data-tessera-indeterminate]").isVisible()).catch(() => false)),
      );
      break;
    }
    case "region": {
      const previous = await page.evaluate(() => performance.timeOrigin);
      await page.locator("#region-link").click();
      await until(() => page.locator("#activity-title").textContent(), (value) => value === "Updated activity");
      await ready(page, candidate);
      check("canonicalRegion", (await page.locator("#activity-title").textContent()) === "Updated activity");
      check(
        "unrelatedContentRetainedWhenEnhanced",
        !candidate.javascript || (previous === (await page.evaluate(() => performance.timeOrigin)) && (await canonical("start"))),
      );
      check("regionAsDocumentWithoutEnhancement", candidate.javascript || ((await canonical("region")) && path() === "/navigation/region"));
      break;
    }
    case "region-mismatch": {
      await page.locator("#region-mismatch").click();
      await route(page, "region-mismatch", candidate);
      check("noWrongTargetCommit", (await page.locator("#region-fallback").count()) === 1);
      check("visibleRecovery", (await page.locator("#region-fallback h2").count()) === 1);
      check("canonicalFallback", path() === "/navigation/region-mismatch");
      break;
    }
    case "supersession": {
      const click = await pointerTargets(page, ["slow", "fast"]);
      await click("slow");
      await until(getMetrics, (value) => value.requests.some((request) => request.route === "slow"));
      await click("fast");
      await route(page, "fast", candidate);
      await pause(950);
      const report = await getMetrics();
      check("lastIntentWins", await canonical("fast"));
      check("noStaleCommit", await canonical("fast"));
      check("requestCancellationFacts", report.requests.some((request) => request.route === "slow" && request.aborted));
      check("zeroWrites", report.writes === 0);
      break;
    }
    case "cancel-intent": {
      // The page's own script cancels the click (navigation.ts, fixture.js).
      const before = await ledger(page);
      await page.locator("#canceled").click();
      await pause(50);
      // jqstar: nothing was sent. Tessera prefetches on mousedown (#17), before the page cancels
      // the click, so one GET may go; it is never committed: no visit, no other request.
      const sent = (await getMetrics()).requests.slice(baseline.requests.length);
      check("zeroDispatch", sent.every((request) => request.route === "canceled" && request.method === "GET") && sent.length <= 1);
      // jqstar: no application was created or released. Tessera: the ledger is unchanged.
      check("outgoingRootsRemainLive", JSON.stringify(await ledger(page)) === JSON.stringify(before) && (await canonical("start")));
      break;
    }
    case "network-error": {
      const before = await ledger(page);
      await page.locator("#network-error").click({ noWaitAfter: true }).catch(() => undefined);
      await until(getMetrics, (value) => value.requests.some((request) => request.route === "network-error"));
      await pause(50);
      // While the visit fails, the page it would replace is untouched.
      check(
        "outgoingRootsRemainLiveWithoutMutation",
        !candidate.javascript || ((await canonical("start")) && JSON.stringify(await ledger(page)) === JSON.stringify(before)),
      );
      // jqstar: a recovery element. Tessera hands a visit the network refused to the browser, which
      // then does what it does without JavaScript: an error page in Chromium and Firefox, the page
      // left as it was in WebKit. The browser's own request shows the hand-over; the matrix
      // compares where both runs end.
      check(
        "visibleRecovery",
        await until(getMetrics, (value) => value.requests.some((request) => request.route === "network-error" && !request.tessera), 6000).then(
          () => true,
          () => false,
        ),
      );
      await steady(page);
      check("zeroWrites", (await getMetrics()).writes === 0);
      break;
    }
    case "no-content": {
      const before = await ledger(page);
      await page.locator("#no-content").click({ noWaitAfter: true });
      await until(getMetrics, (value) => value.requests.some((request) => request.status === 204));
      await pause(100);
      check("zeroMutation", !candidate.javascript || JSON.stringify(await ledger(page)) === JSON.stringify(before));
      check("zeroWrites", (await getMetrics()).writes === 0);
      check("unchangedDocument", await canonical("start"));
      break;
    }
    case "preservation": {
      await page.locator("#preference").fill("local-preference-proof");
      if (candidate.javascript) {
        await page.evaluate(() => {
          const node = document.getElementById("permanent");
          const harness = (window as HarnessWindow).tesseraHarness;
          if (node && harness) harness.scopes.scopeOf(node).preference = 7;
          (window as HarnessWindow).__kept = node;
        });
      }
      await visit("guide", "guide");
      const kept = candidate.javascript
        ? await page.evaluate(() => {
            const node = document.getElementById("permanent");
            const harness = (window as HarnessWindow).tesseraHarness;
            return { sameNode: node !== null && node === (window as HarnessWindow).__kept, sameState: node !== null && harness?.scopes.scopeOf(node).preference === 7 };
          })
        : undefined;
      check(
        "preservedIdentityWhenEnhanced",
        !candidate.javascript ||
          (Boolean(kept?.sameNode && kept.sameState) && (await page.locator("#preference").inputValue()) === "local-preference-proof"),
      );
      check("canonicalServerStateForFullDocument", candidate.javascript || (await page.locator("#preference").inputValue()) === "server-default");
      break;
    }
    case "lifecycle": {
      const first = await ledger(page);
      for (let index = 0; index < 4; index++) {
        await visit("guide", "guide");
        await visit("home", "start");
      }
      const after = await ledger(page);
      // jqstar: no duplicate applications, every one created was released or is live, and each
      // render ran its phases in order. Tessera: one mount; the ledger after eight visits is the
      // ledger of the first load; and no render is left open.
      check("noDuplicateApplications", (await page.evaluate(() => (window as HarnessWindow).tesseraHarness?.mounts())) === 1);
      check("createdReleasedLiveReconcile", JSON.stringify(after) === JSON.stringify(first));
      check("orderedBridgePhases", !after.some((line) => / render:\d+$/.test(line)));
      const disposal = await page.evaluate(
        () => (window as HarnessWindow & { tesseraHarness?: { dispose(): { failed: number; remaining: number; left: number } } }).tesseraHarness?.dispose(),
      );
      check("zeroFailedDisposal", disposal?.failed === 0);
      check("zeroRemainingDisposal", disposal?.remaining === 0 && disposal.left === 0);
      break;
    }
    case "progress": {
      const click = await pointerTargets(page, ["slow"]);
      await click("slow");
      await until(getMetrics, (value) => value.requests.some((request) => request.route === "slow"));
      // jqstar: its #progress element. Tessera: its delayed progress bar (#13).
      check(
        "visibleProgress",
        !candidate.javascript || (await until(() => page.locator("[data-tessera-progress]").isVisible()).catch(() => false)),
      );
      await page.keyboard.press("Tab");
      await route(page, "slow", candidate);
      await page.locator("#query-value").fill("");
      await page.keyboard.type("keyboard-ready");
      check("keyboardContinuity", (await page.locator("#query-value").inputValue()) === "keyboard-ready" && (await focusName(page)) === "query-value");
      check("settledBusyState", await page.evaluate(() => document.querySelector("[aria-busy]") === null));
      break;
    }
    case "private-cache": {
      let policies = true;
      let restoration = true;
      let noStoredContent = true;
      for (const entry of ["direct", "link"]) {
        let header: string | undefined;
        if (entry === "direct") {
          const response = await page.goto(`${base}/private`);
          header = (await response?.allHeaders())?.["cache-control"];
          await ready(page, candidate);
        } else {
          await page.goto(`${base}/start`);
          await ready(page, candidate);
          const pending = page.waitForResponse((value) => new URL(value.url()).pathname === "/navigation/private");
          await visit("private", "private");
          header = (await (await pending).allHeaders())["cache-control"];
        }
        policies = header === "private, no-store" && policies;
        const initial = await getMetrics();
        await visit("guide", "guide");
        await page.goBack();
        await route(page, "private", candidate);
        const report = await getMetrics();
        restoration = report.reads >= initial.reads + 1 && report.writes === 0 && restoration;
        const clean = await page.evaluate(() =>
          Object.keys(localStorage).every((name) => !(localStorage.getItem(name) ?? "").includes("private-fixture-marker")),
        );
        noStoredContent = clean && noStoredContent;
      }
      check("privateResponsePolicy", policies);
      check("restorationRequestFacts", restoration);
      check("noPrivateWebStorage", noStoredContent);
      break;
    }
    case "prefetch": {
      await page.locator("#guide").hover();
      await pause(250);
      check("zeroIncidentalRequests", (await getMetrics()).reads === baseline.reads);
      check("zeroWrites", (await getMetrics()).writes === 0);
      break;
    }
    case "accessibility": {
      await page.locator("#disclosure summary").focus();
      await page.keyboard.press("Enter");
      check("keyboardDisclosure", await page.locator("#disclosure").evaluate((node) => (node as HTMLDetailsElement).open));
      check(
        "visibleFocus",
        await page.locator("#disclosure summary").evaluate((node) => node === node.ownerDocument.activeElement && getComputedStyle(node).outlineStyle !== "none"),
      );
      let overflow = false;
      const overflowing = (): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      for (const preferences of [{ reducedMotion: "reduce" }, { forcedColors: "active" }] as const) {
        await page.emulateMedia(preferences);
        overflow ||= await overflowing();
      }
      await page.setViewportSize({ width: 320, height: 720 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      overflow ||= await overflowing();
      check("noHorizontalOverflow", !overflow);
      await page.goto(`${base}/not-found`);
      await ready(page, candidate);
      check("accessibleError", await errorAccessible(page).catch(() => false));
      break;
    }
    default:
      throw new Error(`Unknown navigation flow ${key}.`);
  }
}

/** The end state the matrix compares between the baseline and Tessera. */
export async function observe(page: Page): Promise<{ url: string; content: string; focus: string; historyLength: number }> {
  const url = ((): string => {
    try {
      const parsed = new URL(page.url());
      return parsed.protocol === "http:" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "browser-error";
    } catch {
      return "browser-error";
    }
  })();
  const content = await page
    .evaluate(() => {
      const main = document.getElementById("main");
      return main ? `${main.getAttribute("data-route") ?? ""}: ${main.querySelector("h1")?.textContent ?? ""}` : "browser-error";
    })
    .catch(() => "browser-error");
  return {
    url,
    content,
    focus: await focusName(page),
    historyLength: await page.evaluate(() => history.length).catch(() => 0),
  };
}
