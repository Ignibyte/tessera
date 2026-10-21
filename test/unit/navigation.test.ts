// Enhanced navigation: which clicks become visits, the head policy, committing a whole document,
// link interception and the progress bar. In jsdom's own document, as the patcher needs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { addHead, headConflict, takeMetadata, trackedSet } from "../../src/head.ts";
import { createDocumentCommitter, interceptLinks, linkEligibility } from "../../src/navigation.ts";
import type { LinkEligibility } from "../../src/navigation.ts";
import { createProgressBar } from "../../src/progress.ts";
import type { RequestInput, RequestOutcome, Transport } from "../../src/transport.ts";
import { disposeTransport, setup } from "./transport-fixture.ts";

afterEach(disposeTransport);

const parse = (html: string): Document => new DOMParser().parseFromString(html, "text/html");

describe("link eligibility", () => {
  /** Clicks `selector` with `init` and returns what eligibility said, keeping jsdom from navigating. */
  function click(html: string, selector: string, init: MouseEventInit = {}, prevent = false): LinkEligibility {
    document.body.innerHTML = html;
    const target = document.querySelector(selector);
    if (!target) throw new Error(`no ${selector}`);
    let result: LinkEligibility = { refused: "not-a-link" };
    const early = (event: Event): void => {
      if (prevent) event.preventDefault();
    };
    const record = (event: Event): void => {
      result = linkEligibility(event as MouseEvent, document);
      event.preventDefault();
    };
    target.addEventListener("click", early);
    document.addEventListener("click", record);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
    document.removeEventListener("click", record);
    return result;
  }

  const refused = (result: LinkEligibility): string | undefined => ("refused" in result ? result.refused : undefined);

  it("accepts a same-origin link, also when the click lands on its child", () => {
    const result = click(`<a id="a" href="/about"><span id="s">About</span></a>`, "#s");
    expect("link" in result ? [result.link.id, result.url.pathname] : result).toEqual(["a", "/about"]);
    expect(refused(click(`<a href="/x" target="_self" id="a">x</a>`, "#a"))).toBeUndefined();
    expect(refused(click(`<a href="/other#part" id="a">x</a>`, "#a"))).toBeUndefined();
  });

  it.each([
    ["a click already prevented", `<a id="a" href="/x">x</a>`, {}, true, "prevented"],
    ["a middle click", `<a id="a" href="/x">x</a>`, { button: 1 }, false, "button"],
    ["ctrl", `<a id="a" href="/x">x</a>`, { ctrlKey: true }, false, "modifier"],
    ["meta", `<a id="a" href="/x">x</a>`, { metaKey: true }, false, "modifier"],
    ["shift", `<a id="a" href="/x">x</a>`, { shiftKey: true }, false, "modifier"],
    ["alt", `<a id="a" href="/x">x</a>`, { altKey: true }, false, "modifier"],
    ["no link", `<div id="a">x</div>`, {}, false, "not-a-link"],
    ["a link without href", `<a id="a">x</a>`, {}, false, "not-a-link"],
    ["an SVG link", `<svg><a id="a" href="/x"><text>x</text></a></svg>`, {}, false, "not-a-link"],
    ["target _blank", `<a id="a" href="/x" target="_blank">x</a>`, {}, false, "target"],
    ["a named target", `<a id="a" href="/x" target="frame">x</a>`, {}, false, "target"],
    ["download", `<a id="a" href="/x" download>x</a>`, {}, false, "download"],
    ["mailto", `<a id="a" href="mailto:a@example.com">x</a>`, {}, false, "scheme"],
    ["another origin", `<a id="a" href="https://elsewhere.example/x">x</a>`, {}, false, "origin"],
    ["a fragment of this page", `<a id="a" href="#part">x</a>`, {}, false, "fragment"],
    ["data-enhance off around it", `<div data-enhance="off"><a id="a" href="/x">x</a></div>`, {}, false, "opted-out"],
  ] as const)("refuses %s", (_case, html, init, prevent, reason) => {
    expect(refused(click(html, "#a", init, prevent))).toBe(reason);
  });

  it("lets data-enhance on inside an off area turn it back on", () => {
    expect(refused(click(`<div data-enhance="off"><p data-enhance="on"><a id="a" href="/x">x</a></p></div>`, "#a"))).toBeUndefined();
  });
});

describe("the head policy", () => {
  it("compares tracked assets by tag, resolved URL and value, and the base", () => {
    const current = parse(`<head><script src="/app.js" data-track="1"></script><link href="a.css" data-track></head>`);
    expect(trackedSet(current.head.children, "http://localhost:3000/")).toBe(
      "link http://localhost:3000/a.css \nscript http://localhost:3000/app.js 1",
    );
    const same = parse(`<head><link href="/a.css" data-track><script src="/app.js" data-track="1"></script></head>`);
    const changed = parse(`<head><script src="/app.js" data-track="2"></script><link href="/a.css" data-track></head>`);
    document.head.innerHTML = current.head.innerHTML;
    expect(headConflict(document, same, "http://localhost:3000/next")).toBeUndefined();
    expect(headConflict(document, changed, "http://localhost:3000/next")).toBe("its tracked assets differ");
    const based = parse(`<head><base href="/sub/"><script src="/app.js" data-track="1"></script><link href="/a.css" data-track></head>`);
    expect(headConflict(document, based, "http://localhost:3000/next")).toBe("its <base> differs");
  });

  it("adds what the head lacks but never a script, waits for new stylesheets, and removes the obsolete after", async () => {
    document.head.innerHTML = `<meta name="old"><link rel="icon" href="/i.png">`;
    const incoming = parse(`<head><link rel="icon" href="/i.png"><meta name="new"><script src="/new.js"></script><link rel="stylesheet" href="/s.css"></head>`);
    const removeObsolete = await addHead(document, incoming, 10);
    expect(Array.from(document.head.children, (element) => element.outerHTML)).toEqual([
      '<meta name="old">',
      '<link rel="icon" href="/i.png">',
      '<meta name="new">',
      '<link rel="stylesheet" href="/s.css">',
    ]);
    removeObsolete();
    expect(document.head.querySelector('meta[name="old"]')).toBeNull();
    expect(document.head.querySelector("script")).toBeNull();
  });

  it("resolves when a new stylesheet loads, before its timeout", async () => {
    document.head.innerHTML = "";
    const incoming = parse(`<head><link rel="stylesheet" href="/s.css"></head>`);
    const pending = addHead(document, incoming, 60_000);
    const link = document.head.querySelector("link");
    link?.dispatchEvent(new Event("load"));
    await expect(pending).resolves.toBeTypeOf("function");
  });

  it("takes the title, lang, dir and the protocol's metas", () => {
    document.head.innerHTML = `<title>Old</title><meta name="tessera-layout" content="app"><meta name="tessera-csrf-token" content="a">`;
    document.documentElement.setAttribute("dir", "rtl");
    takeMetadata(document, parse(`<html lang="fr"><head><title>Neuf</title><meta name="tessera-csrf-token" content="b"></head></html>`));
    expect(document.title).toBe("Neuf");
    expect(document.documentElement.getAttribute("lang")).toBe("fr");
    expect(document.documentElement.hasAttribute("dir")).toBe(false);
    expect(document.head.querySelector('meta[name="tessera-layout"]')).toBeNull();
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="tessera-csrf-token"]')?.content).toBe("b");
    document.documentElement.removeAttribute("lang");
  });
});

describe("committing a whole document", () => {
  const head = `<title>Old</title><meta name="tessera-layout" content="app"><link href="/app.css" data-track>`;
  const body = `<header id="keep" data-permanent>player state</header><div id="gone" data-permanent>x</div><main data-region="content"><p id="p">old</p></main>`;

  it("morphs the body in place, keeping matched permanent elements as they are", async () => {
    const fixture = setup(body, {}, head);
    const commit = createDocumentCommitter({ kernel: fixture.kernel, patcher: fixture.patcher, stylesheetTimeoutMs: 10 });
    const main = fixture.find("main");
    const keep = fixture.find("#keep");
    keep.textContent = "playing";
    const result = await commit(
      `<!doctype html><html lang="en"><head><title>New</title><meta name="tessera-layout" content="bare"><link href="/app.css" data-track></head>
       <body><header id="keep" data-permanent>server</header><main data-region="content"><p id="p">new</p></main><script>window.ranCommitted = true</script></body></html>`,
      "http://localhost:3000/next",
      { kind: "visit", method: "GET", url: "http://localhost:3000/next", targets: [], element: undefined, body: undefined, signals: undefined, history: "push", writeId: undefined },
    );
    expect(result).toBe("committed");
    expect(fixture.find("main")).toBe(main);
    expect(fixture.find("#p").textContent).toBe("new");
    expect(fixture.find("#keep")).toBe(keep);
    expect(keep.textContent).toBe("playing");
    expect(document.querySelector("#gone")).toBeNull();
    expect(document.title).toBe("New");
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="tessera-layout"]')?.content).toBe("bare");
    expect("ranCommitted" in window).toBe(false);
  });

  it("changes nothing and asks for a full load when the tracked assets differ", async () => {
    const fixture = setup(body, {}, head);
    const commit = createDocumentCommitter({ kernel: fixture.kernel, patcher: fixture.patcher });
    const before = document.body.innerHTML;
    const result = await commit(
      `<!doctype html><html><head><title>New</title><link href="/app.2.css" data-track></head><body><p>new</p></body></html>`,
      "http://localhost:3000/next",
      { kind: "visit", method: "GET", url: "http://localhost:3000/next", targets: [], element: undefined, body: undefined, signals: undefined, history: "push", writeId: undefined },
    );
    expect(result).toBe("full-load");
    expect(document.body.innerHTML).toBe(before);
    expect(document.title).toBe("Old");
  });

  it("is what the transport commits a document answer with, recording the visit's URL", async () => {
    const committer: { commit?: ReturnType<typeof createDocumentCommitter> } = {};
    const fixture = setup(body, { commitDocument: (html, url, request) => committer.commit?.(html, url, request) ?? Promise.resolve("full-load") }, head);
    committer.commit = createDocumentCommitter({ kernel: fixture.kernel, patcher: fixture.patcher, stylesheetTimeoutMs: 10 });
    fixture.respond(
      () =>
        new Response(`<!doctype html><html><head><title>Bare</title><link href="/app.css" data-track></head><body><main data-region="content"><p id="p">bare</p></main></body></html>`, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    );
    const outcome = await fixture.transport.request({ kind: "visit", url: "/bare", targets: ["content"] });
    expect(outcome.status).toBe("committed");
    expect(fixture.find("#p").textContent).toBe("bare");
    expect(fixture.pushed).toEqual(["http://localhost:3000/bare"]);
    expect(fixture.navigated).toEqual([]);
  });
});

describe("link interception", () => {
  function fakeTransport() {
    const request = vi.fn((_input: RequestInput) => Promise.resolve<RequestOutcome>({ status: "committed" }));
    const transport: Transport = {
      request,
      submit: () => Promise.resolve({ status: "committed" }),
      actions: () => undefined,
      intercept: () => () => undefined,
    };
    return { transport, request };
  }

  it("turns an eligible click into a visit with the link's targets, and leaves the rest alone", async () => {
    const fixture = setup(
      `<nav data-region="sidebar"><a id="in" href="/about" data-target="content">About</a><a id="plain" href="/x">x</a><a id="out" href="https://elsewhere.example/">out</a></nav><main data-region="content"></main>`,
    );
    const { transport, request } = fakeTransport();
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    interceptLinks({ kernel: fixture.kernel, transport, progress: { start } });
    const outcomes: boolean[] = [];
    const after = (event: Event): void => {
      outcomes.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", after);
    try {
      fixture.find("#in").click();
      fixture.find("#plain").click();
      fixture.find("#out").click();
    } finally {
      window.removeEventListener("click", after);
    }
    expect(outcomes).toEqual([true, true, false]);
    expect(request.mock.calls).toEqual([
      [{ kind: "visit", url: "http://localhost:3000/about", targets: ["content"], element: fixture.find("#in") }],
      [{ kind: "visit", url: "http://localhost:3000/x", targets: ["sidebar"], element: fixture.find("#plain") }],
    ]);
    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledTimes(2);
    });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("stops listening when the kernel is disposed", () => {
    const fixture = setup(`<a id="a" href="/x">x</a>`);
    const { transport, request } = fakeTransport();
    interceptLinks({ kernel: fixture.kernel, transport });
    fixture.kernel.dispose();
    const after = (event: Event): void => {
      event.preventDefault();
    };
    window.addEventListener("click", after);
    document.querySelector<HTMLElement>("#a")?.click();
    window.removeEventListener("click", after);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("the progress bar", () => {
  it("shows only after the delay, and goes when the last visit settles", () => {
    vi.useFakeTimers();
    const bar = createProgressBar(document, { delayMs: 200 });
    const shown = (): boolean => document.querySelector("[data-tessera-progress]") !== null;

    const quick = bar.start();
    vi.advanceTimersByTime(199);
    quick();
    vi.advanceTimersByTime(500);
    expect(shown()).toBe(false);

    const first = bar.start();
    const second = bar.start();
    vi.advanceTimersByTime(200);
    expect(shown()).toBe(true);
    expect(document.querySelector("[data-tessera-progress]")?.getAttribute("aria-hidden")).toBe("true");
    first();
    first();
    expect(shown()).toBe(true);
    second();
    expect(shown()).toBe(false);
  });
});
