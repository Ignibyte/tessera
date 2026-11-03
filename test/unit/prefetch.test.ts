// Prefetch against a fake fetch: the transport's prefetch taken once by the visit that matches it,
// with the prefetch's generation, and dropped when it fails, says no-store or waits too long; then
// the link listeners that start it, on mousedown and after a hover.
import { afterEach, describe, expect, it, vi } from "vitest";
import { interceptLinks } from "../../src/navigation.ts";
import { disposeTransport, fragments, hang, networkFailure, setup } from "./transport-fixture.ts";

afterEach(disposeTransport);

const page = `<nav data-region="sidebar"><a id="about" href="/about" data-target="content">About</a></nav><main data-region="content"><p id="text">old</p></main>`;
const content = (text: string) => `<template data-target="content"><main data-region="content"><p id="text">${text}</p></main></template>`;

describe("the transport's prefetch", () => {
  it("is taken by the next visit with the same URL and targets, once", async () => {
    const { transport, calls, respond, find } = setup(page);
    respond(() => fragments(content("prefetched")), () => fragments(content("fetched")));
    transport.prefetch({ url: "/about", targets: ["content"] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toMatchObject({ "tessera-request": "visit", "tessera-targets": "content" });
    expect((await transport.request({ kind: "visit", url: "/about", targets: ["content"] })).status).toBe("committed");
    expect(find("#text").textContent).toBe("prefetched");
    expect(calls).toHaveLength(1);
    await transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    expect(calls).toHaveLength(2);
    expect(find("#text").textContent).toBe("fetched");
  });

  it("is not taken by a visit with other targets", async () => {
    const { transport, calls, respond } = setup(page);
    respond(() => fragments(content("prefetched")), () => fragments(content("fetched")));
    transport.prefetch({ url: "/about", targets: ["content"] });
    await transport.request({ kind: "visit", url: "/about", targets: ["sidebar"] });
    expect(calls).toHaveLength(2);
  });

  it("runs interceptors' before once, when it is sent", async () => {
    const { transport, respond } = setup(page);
    respond(() => fragments(content("prefetched")));
    const before = vi.fn();
    transport.intercept({ before });
    transport.prefetch({ url: "/about", targets: ["content"] });
    await transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    expect(before).toHaveBeenCalledOnce();
  });

  it("is not used when it failed, or said no-store without a press; the visit fetches", async () => {
    const { transport, calls, respond, find } = setup(page);
    respond(networkFailure, () => fragments(content("fetched")));
    transport.prefetch({ url: "/about", targets: ["content"] });
    expect((await transport.request({ kind: "visit", url: "/about", targets: ["content"] })).status).toBe("committed");
    expect(calls).toHaveLength(2);
    expect(find("#text").textContent).toBe("fetched");

    respond(() => fragments(content("stored"), { headers: { "Cache-Control": "private, no-store" } }), () => fragments(content("fresh")));
    transport.prefetch({ url: "/about", targets: ["content"] });
    await transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    expect(calls).toHaveLength(4);
    expect(find("#text").textContent).toBe("fresh");
  });

  it("is used when a press made it, even if it said no-store: it is the click's own request", async () => {
    const { transport, calls, respond, find } = setup(page);
    respond(() => fragments(content("pressed"), { headers: { "Cache-Control": "no-store" } }), () => fragments(content("hovered")), () => fragments(content("fetched")));
    transport.prefetch({ url: "/about", targets: ["content"], press: true });
    await transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    expect(calls).toHaveLength(1);
    expect(find("#text").textContent).toBe("pressed");
  });

  it("lets a press take over a hover's prefetch, no-store and all", async () => {
    const { transport, calls, respond, find } = setup(page);
    respond(() => fragments(content("hovered"), { headers: { "Cache-Control": "no-store" } }));
    transport.prefetch({ url: "/about", targets: ["content"] });
    transport.prefetch({ url: "/about", targets: ["content"], press: true });
    await transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    expect(calls).toHaveLength(1);
    expect(find("#text").textContent).toBe("hovered");
  });

  it("expires, aborting its fetch", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { transport, calls, respond, kernel } = setup(page, { prefetchMs: 1000 });
    respond(() => fragments(content("prefetched")), () => fragments(content("fetched")));
    transport.prefetch({ url: "/about", targets: ["content"] });
    expect(kernel.resourceSummary().filter(({ owner }) => owner.endsWith(":prefetch"))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(kernel.resourceSummary().filter(({ owner }) => owner.endsWith(":prefetch"))).toEqual([]);
    const visit = transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    await vi.advanceTimersByTimeAsync(5);
    await visit;
    expect(calls).toHaveLength(2);
  });

  it("keeps the prefetch's generation, so a commit before the visit makes its fragment stale", async () => {
    const { transport, respond, find, reported } = setup(page);
    respond(() => fragments(content("prefetched")), () => fragments(content("from the write")));
    transport.prefetch({ url: "/about", targets: ["content"] });
    await transport.request({ kind: "action", method: "POST", url: "/save", targets: ["content"], body: "" });
    expect(find("#text").textContent).toBe("from the write");
    await transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    expect(find("#text").textContent).toBe("from the write");
    expect(String(reported.at(-1))).toContain("content changed after this request was sent");
  });

  it("is aborted when its visit is superseded before it takes it (#30)", async () => {
    const { transport, calls, respond, find } = setup(page);
    respond(hang, () => fragments(content("fast")));
    transport.prefetch({ url: "/slow", targets: ["content"], press: true });
    const slow = transport.request({ kind: "visit", url: "/slow", targets: ["content"] });
    const fast = transport.request({ kind: "visit", url: "/fast", targets: ["content"] });
    expect([(await slow).status, (await fast).status]).toEqual(["superseded", "committed"]);
    expect(calls.map(({ url }) => new URL(url).pathname)).toEqual(["/slow", "/fast"]);
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(find("#text").textContent).toBe("fast");
  });

  it("stays for a second visit of the same link that supersedes the first", async () => {
    const { transport, calls, respond, find } = setup(page);
    respond(() => fragments(content("prefetched")));
    transport.prefetch({ url: "/about", targets: ["content"], press: true });
    const first = transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    const second = transport.request({ kind: "visit", url: "/about", targets: ["content"] });
    expect([(await first).status, (await second).status]).toEqual(["superseded", "committed"]);
    expect(calls).toHaveLength(1);
    expect(find("#text").textContent).toBe("prefetched");
  });

  it("is aborted at disposal", () => {
    const { transport, calls, respond, kernel } = setup(page);
    respond(() => new Promise<Response>(() => undefined));
    transport.prefetch({ url: "/about", targets: ["content"] });
    kernel.dispose();
    expect(calls[0]?.signal.aborted).toBe(true);
  });
});

describe("prefetching links", () => {
  function links(html: string) {
    const fixture = setup(html);
    const prefetch = vi.spyOn(fixture.transport, "prefetch").mockImplementation(() => undefined);
    interceptLinks({ kernel: fixture.kernel, transport: fixture.transport, hoverMs: 60 });
    const press = (selector: string, init: MouseEventInit = {}): void => {
      fixture.find(selector).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...init }));
    };
    const hover = (selector: string): void => {
      fixture.find(selector).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    };
    const leave = (selector: string): void => {
      fixture.find(selector).dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    };
    const key = (): void => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    };
    const focus = (selector: string): void => {
      fixture.find(selector).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    };
    const blur = (selector: string): void => {
      fixture.find(selector).dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    };
    return { ...fixture, prefetch, press, hover, leave, key, focus, blur };
  }

  it("prefetches an eligible link on mousedown, with its targets", () => {
    const { prefetch, press, find } = links(page);
    press("#about");
    expect(prefetch).toHaveBeenCalledWith({ url: "http://localhost:3000/about", targets: ["content"], element: find("#about"), press: true });
  });

  it("leaves a modified press, another button, an ineligible link and data-prefetch=off alone", () => {
    const { prefetch, press } = links(
      `<a id="a" href="/a">a</a><a id="out" href="https://elsewhere.example/">out</a><div data-prefetch="off"><a id="off" href="/off">off</a></div>`,
    );
    press("#a", { ctrlKey: true });
    press("#a", { button: 1 });
    press("#out");
    press("#off");
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("prefetches a data-prefetch=hover link after the pointer rests on it, unless it leaves first", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { prefetch, hover, leave } = links(`<a id="h" href="/h" data-prefetch="hover"><span id="inner">h</span></a><a id="m" href="/m">m</a>`);
    hover("#m");
    vi.advanceTimersByTime(100);
    expect(prefetch).not.toHaveBeenCalled();
    hover("#h");
    vi.advanceTimersByTime(30);
    leave("#h");
    vi.advanceTimersByTime(100);
    expect(prefetch).not.toHaveBeenCalled();
    hover("#inner");
    vi.advanceTimersByTime(60);
    expect(prefetch).toHaveBeenCalledOnce();
    expect(prefetch.mock.calls[0]?.[0]).toMatchObject({ url: "http://localhost:3000/h", press: false });
  });

  it("prefetches a data-prefetch=hover link a keyboard focus stays on, unless it moves first (#42)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { prefetch, key, focus, blur } = links(`<a id="h" href="/h" data-prefetch="hover">h</a><a id="m" href="/m">m</a>`);
    key();
    focus("#m");
    vi.advanceTimersByTime(100);
    expect(prefetch).not.toHaveBeenCalled();
    focus("#h");
    vi.advanceTimersByTime(30);
    blur("#h");
    vi.advanceTimersByTime(100);
    expect(prefetch).not.toHaveBeenCalled();
    focus("#h");
    vi.advanceTimersByTime(60);
    expect(prefetch).toHaveBeenCalledOnce();
    expect(prefetch.mock.calls[0]?.[0]).toMatchObject({ url: "http://localhost:3000/h", press: false });
  });

  it("leaves a click's own focus alone: only a press prefetches it (#42)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { prefetch, key, press, focus } = links(`<a id="h" href="/h" data-prefetch="hover">h</a>`);
    key();
    press("#h");
    focus("#h");
    vi.advanceTimersByTime(100);
    expect(prefetch).toHaveBeenCalledOnce();
    expect(prefetch.mock.calls[0]?.[0]).toMatchObject({ press: true });
  });
});
