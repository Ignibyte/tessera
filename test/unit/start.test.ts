// The public entry (#19): what `start` boots, its helpers and signals, the action seam bound before
// the transport exists, visits and interceptors, a second start, and stop. In jsdom's own document.
import { afterEach, describe, expect, it, vi } from "vitest";
import { start as startCsp } from "../../src/csp.ts";
import { start } from "../../src/index.ts";
import type { Runtime } from "../../src/index.ts";

let runtime: Runtime | undefined;

afterEach(() => {
  runtime?.stop();
  runtime = undefined;
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 20);
  });

function stubFetch(): ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>> {
  const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(
      new Response(`<template data-target="content"><main data-region="content"><p id="text">fetched</p></main></template>`, {
        headers: { "Content-Type": "text/vnd.tessera+html; charset=utf-8", "Tessera-Protocol": "0" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const url = (input: RequestInfo | URL | undefined): string => (input instanceof Request ? input.url : String(input));

describe("start", () => {
  it.each([
    ["the default build", start],
    ["the csp build", startCsp],
  ])("applies directives with the helpers it was given, in %s", async (_build, startBuild) => {
    stubFetch();
    document.body.innerHTML = `<div data-signals="{n: 1}"><p id="t" data-text="shout('a') + $n"></p></div>`;
    runtime = startBuild({ helpers: { shout: (value: string) => value.toUpperCase() } });
    await settle();
    expect(document.querySelector("#t")?.textContent).toBe("A1");
  });

  it("returns the document's scope, reactive", async () => {
    stubFetch();
    document.body.innerHTML = `<div data-signals__document="{word: 'one'}"><p id="t" data-text="$word"></p></div>`;
    runtime = start();
    await settle();
    expect(runtime.signals.word).toBe("one");
    runtime.signals.word = "two";
    await settle();
    expect(document.querySelector("#t")?.textContent).toBe("two");
  });

  it("sends an action a directive starts during the first scan, through the transport", async () => {
    const fetch = stubFetch();
    document.body.innerHTML = `<main data-region="content"><div data-init="@get('/early')"></div></main>`;
    runtime = start();
    await settle();
    expect(fetch.mock.calls.map(([input]) => new URL(url(input)).pathname)).toEqual(["/early"]);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("Tessera-Request")).toBe("action");
  });

  it("visits through the transport, with the interceptors it was given", async () => {
    const fetch = stubFetch();
    document.body.innerHTML = `<main data-region="content"><p id="text">old</p></main>`;
    runtime = start();
    const seen: string[] = [];
    const remove = runtime.intercept({ before: ({ request }) => seen.push(request.url) });
    const outcome = await runtime.visit("/about", { targets: ["content"] });
    remove();
    await runtime.visit("/other", { targets: ["content"], history: "none" });
    expect(outcome.status).toBe("committed");
    expect(document.querySelector("#text")?.textContent).toBe("fetched");
    expect(window.location.pathname).toBe("/about");
    expect(seen).toEqual([`${window.location.origin}/about`]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refuses a second start on the same document, and starts again after stop", () => {
    stubFetch();
    document.body.innerHTML = `<p></p>`;
    runtime = start();
    expect(() => start()).toThrow("Tessera has already started on this document.");
    runtime.stop();
    runtime = start();
    expect(runtime.signals).toBeDefined();
  });

  it("leaves link clicks to the browser once stopped", () => {
    stubFetch();
    document.body.innerHTML = `<a id="a" href="/x">x</a>`;
    runtime = start();
    runtime.stop();
    runtime = undefined;
    let prevented: boolean | undefined;
    const after = (event: Event): void => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener("click", after);
    document.querySelector<HTMLElement>("#a")?.click();
    window.removeEventListener("click", after);
    expect(prevented).toBe(false);
  });
});
