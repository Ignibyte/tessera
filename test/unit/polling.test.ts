// Polling against a fake fetch, with fake timers: the interval syntax, shared clocks, the
// background throttle, the pauses while hidden and offline, yielding, and the ledger.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAttributeName } from "../../src/directive.ts";
import type { DirectiveAttribute } from "../../src/directive.ts";
import { BACKGROUND_EVERY, DEFAULT_POLL_MS, pollInterval, startPolling } from "../../src/polling.ts";
import { disposeTransport, empty, hang, setup } from "./transport-fixture.ts";
import type { Responder } from "./transport-fixture.ts";

let visibility: DocumentVisibilityState = "visible";
let online = true;
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });

let focus = vi.spyOn(document, "hasFocus");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  visibility = "visible";
  online = true;
  vi.restoreAllMocks();
  disposeTransport();
});

function start(html: string, answers: Responder[] = []) {
  const fixture = setup(html);
  fixture.respond(...answers);
  const reports: unknown[] = [];
  // The clocks are checked at the transport's door: what each tick asked for, before the buffer.
  const requested = vi.spyOn(fixture.transport, "request");
  const polling = startPolling({ kernel: fixture.kernel, transport: fixture.transport, report: (error) => reports.push(error) });
  const paths = (): string[] => requested.mock.calls.map(([input]) => new URL(input.url, document.baseURI).pathname);
  const pollResources = (): string[] =>
    fixture.kernel.resourceSummary().flatMap(({ kind, owner }) => (owner.startsWith("poll") ? [`${kind} ${owner}`] : []));
  return { ...fixture, requested, polling, reports, paths, pollResources };
}

const attribute = (name: string): DirectiveAttribute => {
  const parsed = parseAttributeName(name, "/x");
  if (!parsed) throw new Error(`not an attribute: ${name}`);
  return parsed;
};

const advance = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);

/** Answers every request with 204, so polls leave the page as it is. */
const quiet = (count: number): Responder[] => Array.from({ length: count }, () => () => empty(204));

describe("the interval", () => {
  it("is 2 seconds by default, or the duration modifier", () => {
    expect(pollInterval(attribute("data-poll"))).toBe(DEFAULT_POLL_MS);
    expect(pollInterval(attribute("data-poll__5s"))).toBe(5000);
    expect(pollInterval(attribute("data-poll__750ms"))).toBe(750);
  });

  it.each(["data-poll__fast", "data-poll__5s__1s", "data-poll__5s.x", "data-poll__50ms"])("refuses %s", (name) => {
    expect(() => pollInterval(attribute(name))).toThrow(/data-poll/);
  });

  it("reports a bad attribute at its element and polls nothing", async () => {
    const { reports, requested, polling } = start(`<p data-region="ticker" data-poll__soon="/tick"></p>`);
    await advance(5000);
    expect(String(reports[0])).toContain("data-poll__soon takes one duration modifier");
    expect(requested).not.toHaveBeenCalled();
    expect(polling.clocks.intervals).toEqual([]);
  });
});

describe("shared clocks", () => {
  it("runs one timer per interval, so polls with the same interval fire on the same tick", async () => {
    const { polling, paths } = start(
      `<p data-region="a" data-poll__500ms="/a"></p><p data-region="b" data-poll__500ms="/b"></p><p data-region="c" data-poll__1s="/c"></p>`,
      quiet(10),
    );
    expect(polling.clocks.intervals.sort()).toEqual([1000, 500]);
    await advance(499);
    expect(paths()).toEqual([]);
    await advance(1);
    expect(paths().sort()).toEqual(["/a", "/b"]);
    await advance(500);
    expect(paths().sort()).toEqual(["/a", "/a", "/b", "/b", "/c"]);
  });

  it("sends a refresh of the element's innermost component or region, as a poll", async () => {
    const { calls, requested } = start(`<main data-region="content"><!--t:c cart--><div data-poll__100ms="/cart"></div><!--/t:c--></main>`, quiet(1));
    await advance(100);
    expect(requested.mock.calls[0]?.[0]).toMatchObject({ kind: "refresh", url: "/cart", targets: ["content/cart"], poll: true });
    // The transport's 0 ms buffer is a 1 ms timer under fake timers.
    await advance(1);
    expect(calls[0]?.headers).toMatchObject({ "tessera-request": "refresh", "tessera-targets": "content/cart" });
  });

  it("yields to an overlapping request in flight", async () => {
    const { transport, calls, requested } = start(`<main data-region="content"><p data-poll__100ms="/tick"></p></main>`, [hang]);
    void transport.request({ kind: "visit", url: "/next", targets: ["content"] });
    await advance(300);
    expect(calls).toHaveLength(1);
    const outcomes = await Promise.all(requested.mock.results.slice(1).map(({ value }) => value as Promise<{ status: string }>));
    expect(outcomes.map(({ status }) => status)).toEqual(["skipped", "skipped", "skipped"]);
  });

  it("stops a clock with its last poll, when the element leaves or the attribute changes", async () => {
    const { polling, find, pollResources, paths } = start(
      `<p id="one" data-region="a" data-poll__500ms="/a"></p><p id="two" data-region="b" data-poll__500ms="/b"></p>`,
      quiet(10),
    );
    find("#one").remove();
    await advance(0);
    expect(polling.clocks.intervals).toEqual([500]);
    find("#two").removeAttribute("data-poll__500ms");
    find("#two").setAttribute("data-poll__1s", "/b2");
    await advance(0);
    expect(polling.clocks.intervals).toEqual([1000]);
    await advance(1000);
    expect(paths()).toEqual(["/b2"]);
    find("#two").remove();
    await advance(0);
    expect(polling.clocks.intervals).toEqual([]);
    expect(pollResources()).toEqual([]);
  });
});

describe("throttling and pauses", () => {
  it(`fires one tick in ${String(BACKGROUND_EVERY)} while the window is in the background`, async () => {
    focus.mockReturnValue(false);
    const { requested } = start(`<p data-region="ticker" data-poll__100ms="/tick"></p>`, quiet(5));
    await advance(100 * (BACKGROUND_EVERY - 1));
    expect(requested).toHaveBeenCalledTimes(0);
    await advance(100);
    expect(requested).toHaveBeenCalledTimes(1);
    focus.mockReturnValue(true);
    await advance(100);
    expect(requested).toHaveBeenCalledTimes(2);
  });

  it("fires nothing while the page is hidden, and goes on when it is visible", async () => {
    const { requested } = start(`<p data-region="ticker" data-poll__100ms="/tick"></p>`, quiet(5));
    visibility = "hidden";
    await advance(1000);
    expect(requested).toHaveBeenCalledTimes(0);
    visibility = "visible";
    await advance(100);
    expect(requested).toHaveBeenCalledTimes(1);
  });

  it("fires nothing while the browser is offline", async () => {
    const { requested } = start(`<p data-region="ticker" data-poll__100ms="/tick"></p>`, quiet(5));
    online = false;
    await advance(1000);
    expect(requested).toHaveBeenCalledTimes(0);
    online = true;
    await advance(100);
    expect(requested).toHaveBeenCalledTimes(1);
  });
});

describe("the ledger", () => {
  it("holds each clock and each poll, and is empty after disposal", () => {
    const { kernel, pollResources } = start(`<p data-region="ticker" data-poll="/tick"></p>`);
    expect(pollResources().sort()).toEqual(["subscription poll:/tick", "task poll-clock:2000"]);
    expect(kernel.resourceSummary()).toContainEqual({ kind: "observer", owner: "watch:poll" });
    kernel.dispose();
    expect(kernel.resourceSummary()).toEqual([]);
  });
});
