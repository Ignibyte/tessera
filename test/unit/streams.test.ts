// Durable streams against a fake fetch: one block per bullet of ticket #16 (opening and sharing,
// fetch with the protocol's headers, reconnecting and stopping, what events commit), then the
// pause while hidden and the ledger. In jsdom's own document, as the patcher needs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectStreams } from "../../src/streams.ts";
import type { StreamsOptions } from "../../src/streams.ts";
import type { StreamEvent } from "../../src/sse.ts";
import { EXPIRED_EVENT } from "../../src/transport.ts";
import { disposeTransport, empty, fragments, hang, networkFailure, ORIGIN, setup } from "./transport-fixture.ts";
import type { Responder } from "./transport-fixture.ts";

let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });

afterEach(() => {
  visibility = "visible";
  disposeTransport();
});

const page = `
  <main data-region="content">
    <!--t:c latest--><p id="latest">none</p><!--/t:c-->
    <ul data-region="events" data-stream="/stream"></ul>
  </main>`;

/** A stream response whose body the test writes. */
function eventStream(headers: Record<string, string> = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream", "Tessera-Protocol": "0", ...headers } }),
    push(text: string): void {
      controller.enqueue(encoder.encode(text));
    },
    end(): void {
      controller.close();
    },
    fail(): void {
      controller.error(new TypeError("network error"));
    },
  };
}

/** List event `k`, with id `k` unless `id` is null. */
const item = (k: number, id: string | null = String(k)): string =>
  `event: tessera-patch-elements\n${id === null ? "" : `id: ${id}\n`}data: target events\ndata: mode prepend\ndata: elements <li>Event ${k}</li>\n\n`;

const close = "event: tessera-close\ndata: reason done\n\n";

/** The fixture with its fetch answers queued first, since the scan opens streams at once. */
function start(answers: Responder[], html = page, options: Partial<StreamsOptions> = {}) {
  const fixture = setup(html);
  fixture.respond(...answers);
  const streamReports: unknown[] = [];
  const streams = connectStreams({
    kernel: fixture.kernel,
    transport: fixture.transport,
    patcher: fixture.patcher,
    report: (error) => streamReports.push(error),
    delayMs: 10,
    ...options,
  });
  const items = (): string[] => Array.from(document.querySelectorAll("[data-region=events] li"), (li) => li.textContent);
  const streamResources = (): string[] => fixture.kernel.resourceSummary().flatMap(({ kind, owner }) => (owner.startsWith("stream:") ? [`${kind} ${owner}`] : []));
  return { ...fixture, streams, streamReports, items, streamResources };
}

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("opening a stream", () => {
  it("opens the stream an element names, with fetch and the protocol's headers", async () => {
    const stream = eventStream();
    const { calls, streams } = start([() => stream.response]);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const [call] = calls;
    expect(call?.url).toBe(`${ORIGIN}/stream`);
    expect(call?.method).toBe("GET");
    expect(call?.headers).toMatchObject({
      accept: "text/event-stream",
      "tessera-request": "stream",
      "tessera-protocol": "0",
      "tessera-layout": "app",
    });
    expect(call?.headers).not.toHaveProperty("last-event-id");
    expect(call?.headers).not.toHaveProperty("tessera-targets");
    expect(streams.urls()).toEqual([`${ORIGIN}/stream`]);
  });

  it("runs interceptors' before on each connection and restores the protocol's headers", async () => {
    const stream = eventStream();
    const { calls, transport, streams } = start([() => stream.response], "<main data-region=\"content\"></main>");
    const before = vi.fn(({ headers }: { headers: Headers }) => {
      headers.set("Authorization", "Bearer x");
      headers.set("Tessera-Request", "visit");
      headers.set("Last-Event-ID", "forged");
    });
    transport.intercept({ before });
    streams.open("/stream");
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(before).toHaveBeenCalledOnce();
    expect(calls[0]?.headers).toMatchObject({ authorization: "Bearer x", "tessera-request": "stream" });
    expect(calls[0]?.headers).not.toHaveProperty("last-event-id");
  });

  it("opens a stream from the API, held until its handle closes", async () => {
    const stream = eventStream();
    const { calls, streams, streamResources } = start([() => stream.response], "<main data-region=\"content\"></main>");
    const handle = streams.open("/api-stream");
    expect(handle.url).toBe(`${ORIGIN}/api-stream`);
    await vi.waitFor(() => {
      expect(handle.state).toBe("open");
    });
    handle.close();
    handle.close();
    await tick(5);
    expect(handle.state).toBe("closed");
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(streamResources()).toEqual([]);
  });

  it("shares one stream per URL among its elements, and stops when the last leaves", async () => {
    const stream = eventStream();
    const { calls, streams, find, streamResources } = start(
      [() => stream.response],
      `<main data-region="content"><ul data-region="events" data-stream="/stream"></ul><div id="also" data-stream="${ORIGIN}/stream"></div></main>`,
    );
    const listener = streams.open("/stream", { element: find("#also") });
    await vi.waitFor(() => {
      expect(listener.state).toBe("open");
    });
    expect(calls).toHaveLength(1);
    find("#also").remove();
    await tick(5);
    expect(listener.state).toBe("open");
    expect(calls[0]?.signal.aborted).toBe(false);
    find("[data-region=events]").remove();
    await tick(5);
    expect(listener.state).toBe("closed");
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(streams.urls()).toEqual([]);
    expect(streamResources()).toEqual([]);
  });

  it("keeps the connection when a render swaps the element for one naming the same stream", async () => {
    const stream = eventStream();
    const { calls, patcher, streams } = start([() => stream.response]);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    patcher.patchElements("content", `<main data-region="content"><section><ul data-region="events" data-stream="/stream"></ul></section></main>`);
    await tick(10);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal.aborted).toBe(false);
    expect(streams.urls()).toEqual([`${ORIGIN}/stream`]);
  });

  it("switches streams when data-stream changes, and closes when it goes", async () => {
    const first = eventStream();
    const second = eventStream();
    const { calls, find, streams } = start([() => first.response, () => second.response]);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    find("[data-region=events]").setAttribute("data-stream", "/other");
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    await tick(5);
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(calls[1]?.url).toBe(`${ORIGIN}/other`);
    find("[data-region=events]").removeAttribute("data-stream");
    await tick(5);
    expect(calls[1]?.signal.aborted).toBe(true);
    expect(streams.urls()).toEqual([]);
  });
});

describe("events", () => {
  it("morph a region and a component, patch signals, in order, and reach listeners", async () => {
    const stream = eventStream();
    const { streams, items, find, mount } = start([() => stream.response]);
    const seen: StreamEvent[] = [];
    streams.open("/stream", { onEvent: (event) => seen.push(event) });
    stream.push(item(1) + item(2));
    stream.push(`event: tessera-patch-elements\ndata: target content/latest\ndata: elements <!--t:c latest-->\ndata: elements <p id="latest">2</p><!--/t:c-->\n\n`);
    stream.push(`event: tessera-patch-signals\ndata: scope page\ndata: signals {"received":\ndata: signals 2}\n\n`);
    stream.push("event: custom\ndata: anything\n\n");
    await vi.waitFor(() => {
      expect(seen).toHaveLength(5);
    });
    expect(items()).toEqual(["Event 2", "Event 1"]);
    expect(find("#latest").textContent).toBe("2");
    expect(mount.signals.received).toBe(2);
    expect(seen.map(({ type }) => type)).toEqual([
      "tessera-patch-elements",
      "tessera-patch-elements",
      "tessera-patch-elements",
      "tessera-patch-signals",
      "custom",
    ]);
  });

  it("drops and reports an event for a target the page lacks, without a full load", async () => {
    const stream = eventStream();
    const { reported, navigated, items } = start([() => stream.response]);
    stream.push("event: tessera-patch-elements\ndata: target nowhere\ndata: elements <div data-region=\"nowhere\"></div>\n\n" + item(1));
    await vi.waitFor(() => {
      expect(items()).toEqual(["Event 1"]);
    });
    expect(String(reported[0])).toContain("nowhere");
    expect(navigated).toEqual([]);
  });

  it("reports a malformed event and goes on", async () => {
    const stream = eventStream();
    const { streamReports, items } = start([() => stream.response]);
    stream.push("event: tessera-patch-signals\ndata: scope page\ndata: signals [1]\n\n" + "event: tessera-patch-elements\ndata: mode morph\n\n" + item(1));
    await vi.waitFor(() => {
      expect(items()).toEqual(["Event 1"]);
    });
    expect(streamReports.map(String)).toEqual([
      "StreamError: A signal patch must be a JSON object.",
      "StreamError: A tessera-patch-elements event needs a target.",
    ]);
  });

  it("commits a page event as a whole document, or loads in full without a committer", async () => {
    const stream = eventStream();
    const { navigated } = start([() => stream.response]);
    stream.push("event: tessera-patch-elements\ndata: target page\ndata: elements <!doctype html><title>x</title>\n\n");
    await vi.waitFor(() => {
      expect(navigated).toEqual([window.location.href]);
    });
  });

  it("makes an older answer still in flight for the same target stale", async () => {
    const stream = eventStream();
    let answer!: (response: Response) => void;
    const { calls, transport, reported, items } = start([
      () => stream.response,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ]);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const refresh = transport.request({ kind: "refresh", url: "/events-region", targets: ["events"] });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    stream.push(item(1));
    await vi.waitFor(() => {
      expect(items()).toEqual(["Event 1"]);
    });
    answer(fragments(`<template data-target="events"><ul data-region="events" data-stream="/stream"><li>Old</li></ul></template>`));
    expect((await refresh).status).toBe("committed");
    expect(items()).toEqual(["Event 1"]);
    expect(String(reported[0])).toContain("changed after this request was sent");
  });
});

describe("reconnecting", () => {
  it("reconnects after the body ends, with Last-Event-ID, after the stream's retry", async () => {
    const first = eventStream();
    const second = eventStream();
    const { calls, items } = start([() => first.response, () => second.response]);
    first.push("retry: 30\n\n" + item(1) + item(2));
    await vi.waitFor(() => {
      expect(items()).toHaveLength(2);
    });
    const ended = performance.now();
    first.end();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(performance.now() - ended).toBeGreaterThanOrEqual(25);
    expect(calls[1]?.headers["last-event-id"]).toBe("2");
    // An event without an id on the new connection keeps the last id.
    second.push(item(3, null));
    await vi.waitFor(() => {
      expect(items()).toEqual(["Event 3", "Event 2", "Event 1"]);
    });
    second.fail();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(3);
    });
    expect(calls[2]?.headers["last-event-id"]).toBe("2");
  });

  it("doubles the delay after each failed attempt, up to the cap, and an event resets it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const later = eventStream();
    const after = eventStream();
    const { calls, items } = start([networkFailure, () => empty(503), networkFailure, networkFailure, () => later.response, () => after.response], page, {
      delayMs: 100,
      maxDelayMs: 300,
    });
    const at: number[] = [];
    let elapsed = 0;
    const advance = async (ms: number): Promise<void> => {
      for (let step = 0; step < ms; step += 10) {
        await vi.advanceTimersByTimeAsync(10);
        elapsed += 10;
        while (at.length < calls.length) at.push(elapsed);
      }
    };
    await advance(0);
    await vi.advanceTimersByTimeAsync(0);
    while (at.length < calls.length) at.push(0);
    await advance(1000);
    // Attempts at 0, then after 100, 200, 300 (capped) and 300 ms.
    expect(at).toEqual([0, 100, 300, 600, 900]);
    later.push(item(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(items()).toEqual(["Event 1"]);
    later.end();
    await advance(90);
    expect(calls).toHaveLength(5);
    await advance(20);
    expect(calls).toHaveLength(6);
  });

  it("backs off from 100 ms after a failure when the stream set a shorter retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const first = eventStream();
    const { calls } = start([() => first.response, networkFailure, networkFailure]);
    first.push("retry: 0\n\n" + item(1));
    await vi.advanceTimersByTimeAsync(0);
    first.end();
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(190);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toHaveLength(3);
  });

  it("retries a 429 and a 5xx", async () => {
    const stream = eventStream();
    const { calls } = start([() => empty(429), () => empty(500), () => stream.response]);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(3);
    });
  });
});

describe("stopping for good", () => {
  async function stopsAfter(answer: () => Response | Promise<Response>) {
    const fixture = start([answer]);
    await vi.waitFor(() => {
      expect(fixture.calls).toHaveLength(1);
    });
    await tick(40);
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.streams.urls()).toEqual([]);
    expect(fixture.streamResources().filter((resource) => resource.startsWith("service"))).toEqual([]);
    return fixture;
  }

  it("on tessera-close", async () => {
    const stream = eventStream();
    stream.push(item(1) + close);
    const { items } = await stopsAfter(() => stream.response);
    expect(items()).toEqual(["Event 1"]);
  });

  it("on a 204", async () => {
    const { reported } = await stopsAfter(() => empty(204));
    expect(reported).toEqual([]);
  });

  it.each([401, 403, 404, 410])("on a %i, reported", async (status) => {
    const { reported } = await stopsAfter(() => empty(status));
    expect(String(reported[0])).toContain(`answered ${status}`);
  });

  it("on a 200 that is not text/event-stream, reported", async () => {
    const { reported } = await stopsAfter(() => fragments(""));
    expect(String(reported[0])).toContain("not text/event-stream");
  });

  it("on a 419, raising the page-expired event", async () => {
    const expired = vi.fn();
    document.addEventListener(EXPIRED_EVENT, expired);
    try {
      await stopsAfter(() => empty(419));
      expect(expired).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener(EXPIRED_EVENT, expired);
    }
  });

  it("loading in full on a stream without Tessera-Protocol 0, or a 400 for another version", async () => {
    const { navigated } = await stopsAfter(() => new Response("", { headers: { "Content-Type": "text/event-stream" } }));
    expect(navigated).toEqual([window.location.href]);
    disposeTransport();
    const second = await stopsAfter(() => empty(400, { "Tessera-Protocol": "1" }));
    expect(second.navigated).toEqual([window.location.href]);
  });

  it("keeps a finished stream finished while its element stays", async () => {
    const stream = eventStream();
    stream.push(close);
    const { find, calls } = await stopsAfter(() => stream.response);
    find("[data-region=events]").setAttribute("data-stream", "/stream");
    await tick(20);
    expect(calls).toHaveLength(1);
  });
});

describe("pausing while hidden", () => {
  it("closes while hidden when the stream asks, and reconnects with the last id when visible", async () => {
    const first = eventStream({ "Tessera-Stream-Pause": "hidden" });
    const second = eventStream({ "Tessera-Stream-Pause": "hidden" });
    const { calls, items, streams } = start([() => first.response, () => second.response]);
    first.push(item(1));
    await vi.waitFor(() => {
      expect(items()).toEqual(["Event 1"]);
    });
    const handle = streams.open("/stream");
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => {
      expect(handle.state).toBe("paused");
    });
    expect(calls[0]?.signal.aborted).toBe(true);
    await tick(30);
    expect(calls).toHaveLength(1);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]?.headers["last-event-id"]).toBe("1");
  });

  it("stays open while hidden otherwise", async () => {
    const stream = eventStream();
    const { calls, items } = start([() => stream.response]);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    stream.push(item(1));
    await vi.waitFor(() => {
      expect(items()).toEqual(["Event 1"]);
    });
    expect(calls[0]?.signal.aborted).toBe(false);
  });
});

describe("the ledger", () => {
  it("holds each stream and each holder, and is empty after disposal", async () => {
    const { calls, kernel, streamResources } = start([hang]);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(streamResources().sort()).toEqual([
      `listener stream:${ORIGIN}/stream:visibility`,
      `service stream:${ORIGIN}/stream`,
      `subscription stream:${ORIGIN}/stream`,
    ].sort());
    expect(kernel.resourceSummary()).toContainEqual({ kind: "observer", owner: "streams:scan" });
    kernel.dispose();
    expect(kernel.resourceSummary()).toEqual([]);
    expect(calls[0]?.signal.aborted).toBe(true);
  });
});
