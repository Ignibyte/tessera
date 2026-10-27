// Lazy regions against a fake fetch: a load on render, once, of the innermost component or
// region; a load when visible through a stubbed IntersectionObserver; and the errors.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLazyRegions } from "../../src/lazy.ts";
import { disposeTransport, fragments, setup } from "./transport-fixture.ts";
import type { Responder } from "./transport-fixture.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  disposeTransport();
});

function start(html: string, answers: Responder[] = []) {
  const fixture = setup(html);
  fixture.respond(...answers);
  const reports: unknown[] = [];
  loadLazyRegions({ kernel: fixture.kernel, transport: fixture.transport, report: (error) => reports.push(error) });
  return { ...fixture, reports };
}

/** An IntersectionObserver whose entries the test delivers. */
function stubObserver() {
  const observers: { callback: IntersectionObserverCallback; targets: Element[]; disconnected: boolean }[] = [];
  class FakeObserver {
    readonly #record: (typeof observers)[number];
    constructor(callback: IntersectionObserverCallback) {
      this.#record = { callback, targets: [], disconnected: false };
      observers.push(this.#record);
    }
    observe(target: Element): void {
      this.#record.targets.push(target);
    }
    disconnect(): void {
      this.#record.disconnected = true;
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  const intersect = (isIntersecting: boolean): void => {
    for (const record of observers) {
      record.callback(
        record.targets.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry),
        {} as IntersectionObserver,
      );
    }
  };
  return { observers, intersect };
}

const reviews = `<template data-target="reviews"><section data-region="reviews"><p id="loaded">Five stars</p></section></template>`;

describe("lazy regions", () => {
  it("loads a region once it is rendered, as a refresh of that region, and only once", async () => {
    const { calls, find } = start(`<main data-region="content"><section data-region="reviews" data-lazy="/reviews">Loading</section></main>`, [
      () => fragments(reviews),
    ]);
    await vi.waitFor(() => {
      expect(find("#loaded").textContent).toBe("Five stars");
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toMatchObject({ "tessera-request": "refresh", "tessera-targets": "reviews" });
    find("[data-region=reviews]").setAttribute("data-lazy", "/reviews");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
  });

  it("loads an element that arrives later, for its innermost component", async () => {
    const { calls, find } = start(`<main data-region="content"><div data-t-c="cart"><div id="slot"></div></div></main>`);
    find("#slot").innerHTML = `<p data-lazy="/cart">Loading</p>`;
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.headers["tessera-targets"]).toBe("content/cart");
  });

  it("waits for __visible until the element intersects, then stops observing", async () => {
    const { observers, intersect } = stubObserver();
    const { calls, kernel } = start(`<section data-region="more" data-lazy__visible="/more">Later</section>`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(0);
    intersect(false);
    expect(calls).toHaveLength(0);
    intersect(true);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(observers[0]?.disconnected).toBe(true);
    expect(kernel.resourceSummary().filter(({ owner }) => owner === "lazy:visible")).toEqual([]);
  });

  it("drops the observer when the element leaves before it is seen", async () => {
    const { observers } = stubObserver();
    const { find, kernel } = start(`<section data-region="more" data-lazy__visible="/more">Later</section>`);
    find("[data-region=more]").remove();
    await vi.waitFor(() => {
      expect(observers[0]?.disconnected).toBe(true);
    });
    expect(kernel.resourceSummary().filter(({ owner }) => owner === "lazy:visible")).toEqual([]);
  });

  it("loads __visible at once where there is no IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { calls } = start(`<section data-region="more" data-lazy__visible="/more">Later</section>`);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
  });

  it("reports a modifier it does not take, and loads nothing", async () => {
    const { calls, reports } = start(`<section data-region="more" data-lazy__soon="/more">Later</section>`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(0);
    expect(String(reports[0])).toContain("data-lazy__soon has a modifier data-lazy does not take");
  });
});
