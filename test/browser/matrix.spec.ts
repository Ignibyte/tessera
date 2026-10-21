import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Browser, PlaywrightWorkerArgs } from "@playwright/test";
import { observe, ready, runFlow } from "./matrix/flows.ts";
import type { Candidate, Metrics } from "./matrix/flows.ts";
import { SCENARIOS } from "./matrix/scenarios.ts";
import type { ObservationField, Scenario } from "./matrix/scenarios.ts";

// The navigation matrix (ticket #18): jqstar's 28 navigation scenarios on the reference server's
// /navigation site. Each runs without JavaScript (the baseline) and with Tessera, in fresh
// contexts; each run must pass its scenario's assertions, a Tessera run must end without page
// errors and dispose cleanly, and the two final observations must match except where the
// scenario declares a difference (matrix/scenarios.ts, docs/navigation-matrix.md).

const NOJS: Candidate = { id: "nojs", javascript: false };
const TESSERA: Candidate = { id: "tessera", javascript: true };

interface Run {
  readonly failed: string[];
  readonly observation: Awaited<ReturnType<typeof observe>>;
}

async function run(
  playwright: PlaywrightWorkerArgs["playwright"],
  browser: Browser,
  baseURL: string,
  scenario: Scenario,
  candidate: Candidate,
): Promise<Run> {
  const session = randomUUID();
  const context = await browser.newContext({ javaScriptEnabled: candidate.javascript, viewport: { width: 1100, height: 760 }, acceptDownloads: true });
  context.setDefaultTimeout(4000);
  await context.addCookies([{ name: "tessera-nav-session", value: session, url: baseURL }]);
  const api = await playwright.request.newContext({ extraHTTPHeaders: { Cookie: `tessera-nav-session=${session}` } });
  const page = await context.newPage();
  const base = `${baseURL}/navigation`;
  const metrics = async (): Promise<Metrics> => (await api.get(`${base}/metrics`)).json() as Promise<Metrics>;
  let requestFailures = 0;
  const pageErrors: string[] = [];
  page.on("requestfailed", () => {
    requestFailures++;
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const passed = new Map<string, boolean>();
  const failed: string[] = [];
  try {
    await page.goto(`${base}/start`);
    await ready(page, candidate);
    const baseline = await metrics();
    await runFlow(scenario.key, {
      page,
      base,
      candidate,
      baseline,
      metrics,
      check: (key, value) => passed.set(key, value),
      failures: () => requestFailures,
    });
  } catch (error) {
    failed.push(`flow: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const key of scenario.assertions) if (passed.get(key) !== true) failed.push(key);
  for (const key of passed.keys()) if (!scenario.assertions.includes(key)) failed.push(`unexpected assertion ${key}`);
  const observation = await observe(page);
  if (candidate.javascript) {
    for (const message of pageErrors) failed.push(`page error: ${message}`);
    const disposal = await page
      .evaluate(() => (window as Window & { tesseraHarness?: { dispose(): { failed: number; remaining: number; left: number } } }).tesseraHarness?.dispose())
      .catch(() => undefined);
    // A browser error page or plain text has no harness to dispose.
    if (observation.content !== "browser-error" && disposal !== undefined && (disposal.failed > 0 || disposal.remaining > 0 || disposal.left > 0)) {
      failed.push(`disposal: ${JSON.stringify(disposal)}`);
    }
  }
  await context.close();
  await api.dispose();
  return { failed, observation };
}

for (const scenario of SCENARIOS) {
  test(`${scenario.id} ${scenario.key}`, async ({ browser, baseURL, playwright }) => {
    test.setTimeout(60_000);
    const origin = baseURL ?? "";
    const enhanced = await run(playwright, browser, origin, scenario, TESSERA);
    expect(enhanced.failed, "Tessera's run").toEqual([]);
    if (scenario.applicability === "javascript") return;
    const plain = await run(playwright, browser, origin, scenario, NOJS);
    expect(plain.failed, "the run without JavaScript").toEqual([]);
    const mismatches = (Object.keys(plain.observation) as ObservationField[]).flatMap((field) =>
      scenario.differences?.[field] !== undefined || enhanced.observation[field] === plain.observation[field]
        ? []
        : [`${field}: ${JSON.stringify(enhanced.observation[field])} with Tessera, ${JSON.stringify(plain.observation[field])} without JavaScript`],
    );
    expect(mismatches, "observations Tessera changes without declaring it").toEqual([]);
  });
}
