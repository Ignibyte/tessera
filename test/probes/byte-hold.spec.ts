// The byte-hold probe of ticket #27, kept for ticket #29: does the engine hold bytes of a streamed
// body it has already received until more arrive? A page with no Tessera code reads
// `/events/stream` (three steps at once, no keep-alive comment for 15 s) with plain `fetch`, and a
// run holds when the third step's signals have not arrived within 1.5 s. It reports the count and
// fails only when the probe itself cannot run. PROBE_RUNS sets the runs (default 200).
import { expect, test } from "@playwright/test";

const RUNS = Number(process.env.PROBE_RUNS ?? "200");

interface Run {
  readonly complete: boolean;
  readonly bytes: number;
  readonly ms: number;
}

test("an SSE burst arrives whole, without waiting for the next write", async ({ page }, info) => {
  test.setTimeout(RUNS * 2000 + 30_000);
  await page.goto("/navigation/text");
  const runs: Run[] = [];
  for (let index = 0; index < RUNS; index++) {
    runs.push(
      await page.evaluate(async (run) => {
        const controller = new AbortController();
        const start = performance.now();
        const timer = setTimeout(() => {
          controller.abort();
        }, 1500);
        let text = "";
        let bytes = 0;
        try {
          const response = await fetch(`/events/stream?probe=${String(run)}`, { signal: controller.signal, cache: "no-store" });
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          while (reader && !text.includes('"received":3')) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            text += decoder.decode(value, { stream: true });
          }
        } catch {
          // Aborted at 1.5 s: the run held.
        } finally {
          clearTimeout(timer);
          controller.abort();
        }
        return { complete: text.includes('"received":3'), bytes, ms: Math.round(performance.now() - start) };
      }, index),
    );
  }
  const held = runs.filter((run) => !run.complete);
  const summary = `${info.project.name}: ${String(held.length)} of ${String(RUNS)} runs held${held.length > 0 ? ` (bytes received: ${held.map((run) => run.bytes).join(", ")})` : ""}`;
  info.annotations.push({ type: "byte-hold", description: summary });
  console.log(summary);
  expect(runs.filter((run) => run.complete || run.bytes > 0).length, "runs that received anything").toBeGreaterThan(0);
});
