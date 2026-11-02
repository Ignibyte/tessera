// The devtools hooks of ticket #36 against a fake fetch: the detail `tessera:exchange` carries for
// each kind of exchange, `tessera:patched` on each patched element, and the highlight meta. In
// jsdom's own document, as the patcher needs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXCHANGE_EVENT, HIGHLIGHT_MS, PATCHED_EVENT } from "../../src/devtools.ts";
import type { ExchangeDetail, PatchedDetail } from "../../src/devtools.ts";
import { connectStreams } from "../../src/streams.ts";
import { disposeTransport, empty, fragments, networkFailure, ORIGIN, setup } from "./transport-fixture.ts";

afterEach(disposeTransport);

const page = `<nav data-region="sidebar"><a id="about" href="/about">About</a></nav><main data-region="content"><p id="text">old</p></main>`;
const content = (text: string) => `<template data-target="content"><main data-region="content"><p id="text">${text}</p></main></template>`;

/** Every `tessera:exchange` raised from now on, and the events themselves. */
function listen() {
  const details: ExchangeDetail[] = [];
  const events: Event[] = [];
  const record = (event: Event): void => {
    events.push(event);
    details.push((event as CustomEvent<ExchangeDetail>).detail);
  };
  document.addEventListener(EXCHANGE_EVENT, record);
  afterEach(() => {
    document.removeEventListener(EXCHANGE_EVENT, record);
  });
  return { details, events };
}

const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

describe("tessera:exchange for a request", () => {
  it("carries the request, the answer, its bytes and readable headers, the timings and the outcome", async () => {
    const { details, events } = listen();
    const { transport, respond } = setup(page);
    const body = content("café");
    respond(() => fragments(body, { headers: { "X-Debug-Profile": "abc123" } }));
    const outcome = await transport.request({ kind: "refresh", url: "/content?x=1", targets: ["content"] });
    expect(outcome.status).toBe("committed");
    expect(details).toHaveLength(1);
    const [detail] = details;
    expect(detail).toMatchObject({
      kind: "refresh",
      url: `${ORIGIN}/content?x=1`,
      method: "GET",
      targets: ["content"],
      status: 200,
      contentType: "text/vnd.tessera+html",
      bytes: byteLength(body),
      outcome: "committed",
      prefetched: false,
      event: null,
    });
    expect(detail?.bytes).toBeGreaterThan(body.length);
    expect(detail?.headers).toContainEqual(["x-debug-profile", "abc123"]);
    expect(detail?.headers).toContainEqual(["tessera-protocol", "2"]);
    expect(detail?.firstByteMs).toBeGreaterThanOrEqual(0);
    expect(detail?.settledMs).toBeGreaterThanOrEqual(detail?.firstByteMs ?? Infinity);
    expect(typeof detail?.startTime).toBe("number");
    expect(events[0]?.bubbles).toBe(false);
    expect(events[0]?.cancelable).toBe(false);
    expect(events[0]?.target).toBe(document);
    expect(JSON.parse(JSON.stringify(detail))).toEqual(detail);
  });

  it("names each kind of request, polls and lazy loads apart from other refreshes", async () => {
    const { details } = listen();
    const { transport } = setup(page);
    await transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    await transport.request({ kind: "submit", method: "POST", url: "/save", targets: ["content"], body: "a=1" });
    await transport.request({ kind: "action", method: "DELETE", url: "/item/1", targets: ["content"] });
    await transport.request({ kind: "refresh", url: "/content", targets: ["content"] });
    await transport.request({ kind: "refresh", url: "/content", targets: ["content"], poll: true });
    await transport.request({ kind: "refresh", url: "/content", targets: ["content"], lazy: true });
    expect(details.map(({ kind, method }) => `${kind} ${method}`)).toEqual([
      "visit GET",
      "submit POST",
      "action DELETE",
      "refresh GET",
      "poll GET",
      "lazy GET",
    ]);
  });

  it("is raised after the interceptors' after", async () => {
    const { transport } = setup(page);
    const order: string[] = [];
    transport.intercept({ after: () => order.push("after") });
    const record = (): void => {
      order.push("exchange");
    };
    document.addEventListener(EXCHANGE_EVENT, record);
    await transport.request({ kind: "refresh", url: "/content", targets: ["content"] });
    document.removeEventListener(EXCHANGE_EVENT, record);
    expect(order).toEqual(["after", "exchange"]);
  });

  it("has no answer, bytes or first byte for a write the network lost", async () => {
    const { details } = listen();
    const { transport, respond } = setup(page);
    respond(networkFailure);
    await transport.request({ kind: "submit", method: "POST", url: "/save", body: "a=1" });
    expect(details[0]).toMatchObject({ kind: "submit", status: null, contentType: null, bytes: null, headers: [], firstByteMs: null, outcome: "indeterminate" });
  });

  it("has a status and no bytes for a 204", async () => {
    const { details } = listen();
    const { transport, respond } = setup(page);
    respond(() => empty(204, { "X-Debug-Profile": "p" }));
    await transport.request({ kind: "action", method: "POST", url: "/ping" });
    expect(details[0]).toMatchObject({ status: 204, contentType: null, bytes: null, outcome: "unchanged" });
    expect(details[0]?.headers).toContainEqual(["x-debug-profile", "p"]);
  });

  it("is raised for a poll that yields, as skipped, with nothing sent", async () => {
    const { details } = listen();
    const { transport, calls } = setup(page, { bufferMs: 20 });
    const visit = transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    expect((await transport.request({ kind: "refresh", url: "/content", targets: ["content"], poll: true })).status).toBe("skipped");
    await visit;
    expect(calls).toHaveLength(1);
    expect(details.map(({ kind, outcome, status }) => [kind, outcome, status])).toEqual([
      ["poll", "skipped", null],
      ["visit", "committed", 200],
    ]);
  });

  it("is raised for a superseded read with no answer", async () => {
    const { details } = listen();
    const { transport } = setup(page, { bufferMs: 20 });
    const first = transport.request({ kind: "visit", url: "/a", targets: ["content"] });
    await transport.request({ kind: "visit", url: "/b", targets: ["content"] });
    await first;
    expect(details.map(({ url, outcome, status }) => [url, outcome, status])).toEqual([
      [`${ORIGIN}/a`, "superseded", null],
      [`${ORIGIN}/b`, "committed", 200],
    ]);
  });

  it("is raised for a submit and for the visit its Tessera-Location leads to", async () => {
    const { details } = listen();
    const { transport, respond } = setup(page);
    respond(() => empty(200, { "Tessera-Location": "/done" }), () => fragments(content("done")));
    await transport.request({ kind: "submit", method: "POST", url: "/save", targets: ["content"], body: "a=1" });
    expect(details.map(({ kind, url, status, outcome }) => [kind, url, status, outcome])).toEqual([
      ["visit", `${ORIGIN}/done`, 200, "committed"],
      ["submit", `${ORIGIN}/save`, 200, "committed"],
    ]);
    expect(details[1]?.headers).toContainEqual(["tessera-location", "/done"]);
  });

  it("is raised for none of the requests Tessera refuses before making them", async () => {
    const { details } = listen();
    const { transport } = setup(page);
    await transport.request({ kind: "action", method: "POST", url: "https://elsewhere.example/x" });
    await transport.request({ kind: "refresh", url: "/x", targets: ["@missing"] });
    expect(details).toEqual([]);
  });
});

describe("tessera:exchange for a prefetch", () => {
  it("is raised when the prefetched answer arrives, and the visit that takes it says so", async () => {
    const { details } = listen();
    const { transport, respond } = setup(page);
    respond(() => fragments(content("prefetched")));
    transport.prefetch({ url: "/about", targets: ["content"] });
    await vi.waitFor(() => {
      expect(details).toHaveLength(1);
    });
    expect(details[0]).toMatchObject({ kind: "prefetch", url: `${ORIGIN}/about`, targets: ["content"], status: 200, bytes: null, outcome: "prefetched" });
    expect(details[0]?.settledMs).toBeGreaterThanOrEqual(details[0]?.firstByteMs ?? Infinity);
    await transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    expect(details[1]).toMatchObject({ kind: "visit", status: 200, bytes: byteLength(content("prefetched")), prefetched: true, outcome: "committed" });
  });

  it("is raised as failed when the prefetch's fetch fails", async () => {
    const { details } = listen();
    const { transport, respond } = setup(page);
    respond(networkFailure);
    transport.prefetch({ url: "/about", targets: ["content"] });
    await vi.waitFor(() => {
      expect(details).toHaveLength(1);
    });
    expect(details[0]).toMatchObject({ kind: "prefetch", status: null, outcome: "failed" });
  });
});

/** A stream response whose body the test writes. */
function eventStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream", "Tessera-Protocol": "2", "X-Debug-Profile": "s1" } }),
    push(text: string): void {
      controller.enqueue(encoder.encode(text));
    },
  };
}

describe("tessera:exchange for a stream", () => {
  const streamPage = `<main data-region="content"><ul data-region="events" data-stream="/stream"></ul></main>`;

  it("is raised for the connection and for each event, with what applying it came to", async () => {
    const { details } = listen();
    const stream = eventStream();
    const fixture = setup(streamPage);
    fixture.respond(() => stream.response);
    connectStreams({ kernel: fixture.kernel, transport: fixture.transport, patcher: fixture.patcher, report: () => undefined });
    await vi.waitFor(() => {
      expect(details).toHaveLength(1);
    });
    expect(details[0]).toMatchObject({ kind: "stream", url: `${ORIGIN}/stream`, method: "GET", targets: [], status: 200, contentType: "text/event-stream", bytes: null, outcome: "open" });
    const data = "data: target events\ndata: mode prepend\ndata: elements <li>É</li>";
    stream.push(`event: tessera-patch-elements\nid: 1\n${data}\n\n`);
    stream.push("event: tessera-patch-elements\ndata: target nowhere\ndata: elements <p></p>\n\n");
    stream.push('event: tessera-patch-signals\ndata: scope page\ndata: signals {"n":1}\n\n');
    stream.push("data: hello\n\n");
    stream.push("event: tessera-close\ndata: reason done\n\n");
    await vi.waitFor(() => {
      expect(details).toHaveLength(6);
    });
    const events = details.slice(1);
    expect(events.map(({ kind, event, targets, outcome }) => [kind, event, targets, outcome])).toEqual([
      ["stream-event", "tessera-patch-elements", ["events"], "committed"],
      ["stream-event", "tessera-patch-elements", ["nowhere"], "dropped"],
      ["stream-event", "tessera-patch-signals", ["page"], "committed"],
      ["stream-event", "message", [], "ignored"],
      ["stream-event", "tessera-close", [], "closed"],
    ]);
    const expectedBytes = byteLength("target events\nmode prepend\nelements <li>É</li>");
    expect(events[0]).toMatchObject({ url: `${ORIGIN}/stream`, status: 200, contentType: "text/event-stream", bytes: expectedBytes, firstByteMs: null });
    expect(events[0]?.headers).toContainEqual(["x-debug-profile", "s1"]);
  });

  it("is raised as retry for a connection answered 503", async () => {
    const { details } = listen();
    const fixture = setup(streamPage);
    fixture.respond(() => empty(503), () => new Promise<Response>(() => undefined));
    connectStreams({ kernel: fixture.kernel, transport: fixture.transport, patcher: fixture.patcher, report: () => undefined, delayMs: 1 });
    await vi.waitFor(() => {
      expect(details).toHaveLength(1);
    });
    expect(details[0]).toMatchObject({ kind: "stream", status: 503, outcome: "retry" });
  });
});

describe("tessera:patched", () => {
  const patchPage = `<main data-region="content"><ul data-region="list"><li>a</li></ul><div data-t-c="card"><p>old</p></div></main>`;

  function patchedEvents() {
    const seen: { target: EventTarget | null; detail: PatchedDetail; bubbles: boolean; cancelable: boolean }[] = [];
    const record = (event: Event): void => {
      seen.push({ target: event.target, detail: (event as CustomEvent<PatchedDetail>).detail, bubbles: event.bubbles, cancelable: event.cancelable });
    };
    document.addEventListener(PATCHED_EVENT, record);
    afterEach(() => {
      document.removeEventListener(PATCHED_EVENT, record);
    });
    return seen;
  }

  it("is raised on each patched element after the change, bubbling, with its target and mode", () => {
    const seen = patchedEvents();
    const { patcher, find } = setup(patchPage);
    const list = find("[data-region=list]");
    let textAtEvent = "";
    list.addEventListener(PATCHED_EVENT, () => {
      textAtEvent = list.textContent;
    });
    patcher.patchElements("list", "<li>b</li>", "append");
    patcher.patchElements("content/card", '<div data-t-c="card"><p>new</p></div>', "morph");
    patcher.patchElements("list", "<li>c</li>", "inner");
    patcher.patchElements("list", "<li>z</li>", "prepend");
    expect(textAtEvent).toBe("zc");
    expect(seen.map(({ target, detail }) => [target, detail])).toEqual([
      [list, { target: "list", mode: "append" }],
      [find("[data-t-c=card]"), { target: "content/card", mode: "morph" }],
      [list, { target: "list", mode: "inner" }],
      [list, { target: "list", mode: "prepend" }],
    ]);
    expect(seen.every(({ bubbles, cancelable }) => bubbles && !cancelable)).toBe(true);
  });

  it("is not raised for a remove, or for a patch that fails", () => {
    const seen = patchedEvents();
    const { patcher } = setup(patchPage);
    patcher.patchElements("list", "", "remove");
    expect(() => {
      patcher.patchElements("content/card", '<div data-t-c="other"></div>', "morph");
    }).toThrow();
    expect(seen).toEqual([]);
  });

  it("is raised on the body as page for a whole-document morph", () => {
    const seen = patchedEvents();
    const { patcher } = setup(patchPage);
    const incoming = new DOMParser().parseFromString(`<body><main data-region="content"><p>next</p></main></body>`, "text/html");
    patcher.patchBody(incoming.body as HTMLBodyElement);
    expect(seen.map(({ target, detail }) => [target, detail])).toEqual([[document.body, { target: "page", mode: "morph" }]]);
  });

  it("is raised for each fragment a response commits", async () => {
    const seen = patchedEvents();
    const { transport, respond } = setup(patchPage);
    respond(() => fragments(`<template data-target="list" data-mode="append"><li>b</li></template><template data-target="content/card"><div data-t-c="card"><p>x</p></div></template>`));
    await transport.request({ kind: "refresh", url: "/x", targets: ["list", "content/card"] });
    expect(seen.map(({ detail }) => detail)).toEqual([
      { target: "list", mode: "append" },
      { target: "content/card", mode: "morph" },
    ]);
  });
});

describe("the highlight meta", () => {
  const patchPage = `<ul data-region="list"><li>a</li></ul>`;
  const highlight = `<meta name="tessera-debug" content="highlight">`;

  it("marks a patched element with data-tessera-patched for HIGHLIGHT_MS", () => {
    const { patcher, find } = setup(patchPage, {}, highlight);
    vi.useFakeTimers();
    const list = find("[data-region=list]");
    let markedAtEvent = false;
    list.addEventListener(PATCHED_EVENT, () => {
      markedAtEvent = list.hasAttribute("data-tessera-patched");
    });
    patcher.patchElements("list", "<li>b</li>", "append");
    expect(markedAtEvent).toBe(true);
    vi.advanceTimersByTime(HIGHLIGHT_MS - 1);
    expect(list.hasAttribute("data-tessera-patched")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(list.hasAttribute("data-tessera-patched")).toBe(false);
    expect(HIGHLIGHT_MS).toBe(600);
  });

  it("restarts the mark when the element is patched again", () => {
    const { patcher, find } = setup(patchPage, {}, highlight);
    vi.useFakeTimers();
    const list = find("[data-region=list]");
    patcher.patchElements("list", "<li>b</li>", "append");
    vi.advanceTimersByTime(400);
    patcher.patchElements("list", "<li>c</li>", "append");
    vi.advanceTimersByTime(400);
    expect(list.hasAttribute("data-tessera-patched")).toBe(true);
    vi.advanceTimersByTime(200);
    expect(list.hasAttribute("data-tessera-patched")).toBe(false);
  });

  it("adds nothing when the page has no such meta, or one without highlight", () => {
    for (const head of ["", `<meta name="tessera-debug" content="other">`]) {
      const { patcher, find, kernel } = setup(patchPage, {}, head);
      const before = kernel.resourceSummary().length;
      patcher.patchElements("list", "<li>b</li>", "append");
      expect(find("[data-region=list]").hasAttribute("data-tessera-patched")).toBe(false);
      expect(kernel.resourceSummary()).toHaveLength(before);
      disposeTransport();
    }
  });

  it("is cleared by disposal", () => {
    const { patcher, find, kernel } = setup(patchPage, {}, highlight);
    patcher.patchElements("list", "<li>b</li>", "append");
    const list = find("[data-region=list]");
    expect(list.hasAttribute("data-tessera-patched")).toBe(true);
    kernel.dispose();
    expect(list.hasAttribute("data-tessera-patched")).toBe(false);
  });
});
