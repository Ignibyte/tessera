// The transport against a fake fetch: one block per bullet of ticket #11, then the request
// headers and the protocol's answers. In jsdom's own document, as the patcher needs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCEPT, EXPIRED_EVENT, targetsHeader } from "../../src/transport.ts";
import type { RequestOutcome } from "../../src/transport.ts";
import { bodyText, disposeTransport, empty, fragments, hang, networkFailure, ORIGIN, setup } from "./transport-fixture.ts";

afterEach(disposeTransport);

const content = `<main data-region="content"><p id="text">old</p></main>`;
const contentFragment = (text: string) => `<template data-target="content"><main data-region="content"><p id="text">${text}</p></main></template>`;

describe("no replay: a write is sent once", () => {
  it("reports a POST indeterminate when the network fails after dispatch, and never resends it", async () => {
    const { transport, calls, respond, reported } = setup(content);
    respond(networkFailure, () => fragments(contentFragment("second")));
    const outcome = await transport.request({ kind: "submit", method: "POST", url: "/save", targets: ["content"], body: "a=1" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcome.status).toBe("indeterminate");
    expect(calls.map(({ method }) => method)).toEqual(["POST"]);
    expect(reported).toHaveLength(1);
  });

  it.each(["PUT", "PATCH", "DELETE"] as const)("does the same for %s", async (method) => {
    const { transport, calls, respond } = setup(content);
    respond(networkFailure);
    expect((await transport.request({ kind: "action", method, url: "/x" })).status).toBe("indeterminate");
    expect(calls).toHaveLength(1);
  });

  it("retries a GET twice after network failures, with backoff", async () => {
    const { transport, calls, respond, find } = setup(content);
    respond(networkFailure, networkFailure, () => fragments(contentFragment("third")));
    const outcome = await transport.request({ kind: "refresh", url: "/content", targets: ["content"] });
    expect(outcome.status).toBe("committed");
    expect(calls).toHaveLength(3);
    expect(find("#text").textContent).toBe("third");
  });

  it("gives up on a GET after its retries, as failed", async () => {
    const { transport, calls, respond } = setup(content);
    respond(networkFailure, networkFailure, networkFailure);
    expect((await transport.request({ kind: "refresh", url: "/content" })).status).toBe("failed");
    expect(calls).toHaveLength(3);
  });

  it("reports a write indeterminate when its answer is shorter than its Content-Length", async () => {
    const { transport, calls, respond, navigated } = setup(content);
    respond(() => new Response(new ReadableStream({ start: (controller) => { controller.close(); } }), { headers: { "Content-Type": "text/html", "Content-Length": "4096" } }));
    const outcome = await transport.request({ kind: "submit", method: "POST", url: "/save", targets: ["content"], body: "a=1" });
    expect(outcome.status).toBe("indeterminate");
    expect(calls).toHaveLength(1);
    expect(navigated).toEqual([]);
  });

  it("loads a visit in full after its retries, so the browser shows its own error page", async () => {
    const { transport, calls, respond, navigated } = setup(content);
    respond(networkFailure, networkFailure, networkFailure);
    const outcome = await transport.request({ kind: "visit", url: "/gone", targets: ["content"] });
    expect(outcome).toEqual({ status: "full-load", url: `${ORIGIN}/gone` });
    expect(calls).toHaveLength(3);
    expect(navigated).toEqual([`${ORIGIN}/gone`]);
  });

  it("reports a dispatched write that disposal aborts as indeterminate", async () => {
    const { transport, calls, respond, kernel: current } = setup(content);
    respond(hang);
    const pending = transport.request({ kind: "submit", method: "POST", url: "/save", body: "a=1" });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    current.dispose();
    expect((await pending).status).toBe("indeterminate");
  });

  it("does not send a write that disposal stops in the buffer", async () => {
    const { transport, calls, kernel: current } = setup(content, { bufferMs: 50 });
    const pending = transport.request({ kind: "submit", method: "POST", url: "/save", body: "a=1" });
    current.dispose();
    expect((await pending).status).toBe("aborted");
    expect(calls).toEqual([]);
  });
});

describe("redirects", () => {
  it("sends writes with redirect manual and reads with redirect follow", async () => {
    const { transport, calls } = setup(content);
    await transport.request({ kind: "submit", method: "POST", url: "/save", body: "" });
    await transport.request({ kind: "refresh", url: "/content" });
    expect(calls.map(({ redirect }) => redirect)).toEqual(["manual", "follow"]);
  });

  it("follows Tessera-Location with a fresh GET visit carrying the targets, never the body", async () => {
    const { transport, calls, respond, find, pushed } = setup(content);
    respond(() => empty(200, { "Tessera-Location": "/done", "Tessera-Protocol": "2" }), () => fragments(contentFragment("done")));
    const outcome = await transport.request({ kind: "submit", method: "POST", url: "/save", targets: ["content"], body: "secret=1" });
    expect(outcome).toMatchObject({ status: "committed", redirectedTo: `${ORIGIN}/done` });
    expect(calls[1]).toMatchObject({ url: `${ORIGIN}/done`, method: "GET", body: undefined });
    expect(calls[1]?.headers).toMatchObject({ "tessera-request": "visit", "tessera-targets": "content" });
    expect(find("#text").textContent).toBe("done");
    expect(pushed).toEqual([`${ORIGIN}/done`]);
  });

  it("follows Tessera-Location without a history entry after a form under data-push=\"off\"", async () => {
    const { transport, calls, respond, find, form, pushed } = setup(
      `<main data-region="content"><form id="f" method="post" action="/save" data-push="off"><button id="go">Go</button></form><p id="text">old</p></main>`,
    );
    respond(() => empty(200, { "Tessera-Location": "/done", "Tessera-Protocol": "2" }), () => fragments(contentFragment("done")));
    const outcome = await transport.submit(form("#f"), find("#go"));
    expect(outcome).toMatchObject({ status: "committed", redirectedTo: `${ORIGIN}/done` });
    expect(calls[1]?.headers).toMatchObject({ "tessera-request": "visit", "tessera-targets": "content" });
    expect(find("#text").textContent).toBe("done");
    expect(pushed).toEqual([]);
  });

  it("hands a Tessera-Location on another origin to the browser", async () => {
    const { transport, respond, navigated, calls } = setup(content);
    respond(() => empty(200, { "Tessera-Location": "https://elsewhere.example/x" }));
    expect((await transport.request({ kind: "submit", method: "POST", url: "/save", body: "" })).status).toBe("full-load");
    expect(navigated).toEqual(["https://elsewhere.example/x"]);
    expect(calls).toHaveLength(1);
  });

  it("reports a write answered by a real redirect (a 303 or a 307 from a proxy) as indeterminate", async () => {
    const { transport, respond, calls } = setup(content);
    respond(() => {
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, "type", { value: "opaqueredirect" });
      return response;
    });
    expect((await transport.request({ kind: "submit", method: "POST", url: "/save", body: "" })).status).toBe("indeterminate");
    expect(calls).toHaveLength(1);
  });
});

describe("answers with errors render", () => {
  it.each([422, 409])("commits a %s's fragments in place, without a history entry", async (status) => {
    const { transport, respond, find, pushed } = setup(content);
    respond(() => fragments(contentFragment("errors"), { status }));
    const outcome = await transport.request({ kind: "visit", url: "/form", targets: ["content"] });
    expect(outcome).toMatchObject({ status: "committed", httpStatus: status });
    expect(find("#text").textContent).toBe("errors");
    expect(pushed).toEqual([]);
  });

  it.each([404, 500])("commits a %s's fragments and, for a visit, records its URL", async (status) => {
    const { transport, respond, find, pushed } = setup(content);
    respond(() => fragments(contentFragment(`error ${status}`), { status }));
    expect((await transport.request({ kind: "visit", url: "/missing", targets: ["content"] })).status).toBe("committed");
    expect(find("#text").textContent).toBe(`error ${status}`);
    expect(pushed).toEqual([`${ORIGIN}/missing`]);
  });

  it("treats a body it cannot use as an error: a visit loads in full, a write is indeterminate", async () => {
    const { transport, respond, navigated } = setup(content);
    const json = () => new Response("{}", { headers: { "Content-Type": "application/json" } });
    respond(json, json, json);
    expect((await transport.request({ kind: "visit", url: "/x" })).status).toBe("full-load");
    expect(navigated).toEqual([`${ORIGIN}/x`]);
    expect((await transport.request({ kind: "submit", method: "POST", url: "/x", body: "" })).status).toBe("indeterminate");
    expect((await transport.request({ kind: "refresh", url: "/x" })).status).toBe("failed");
  });
});

describe("forms: the submitter and its overrides", () => {
  const formHtml = `<main data-region="content"><form id="f" method="post" action="/save">
      <input name="title" value="Hi">
      <button id="draft" name="intent" value="draft">Draft</button>
      <button id="publish" name="intent" value="publish" formaction="/publish">Publish</button>
      <button id="search" formmethod="get" formaction="/search">Search</button>
      <button id="multi" formenctype="multipart/form-data">Multipart</button>
      <button id="plain" formenctype="text/plain">Plain</button>
      <button id="dialog" formmethod="dialog">Dialog</button>
    </form></main>`;

  it("puts the submitter's name and value in the data and honours formaction", async () => {
    const { transport, calls, find, form } = setup(formHtml);
    await transport.submit(form("#f"), find("#publish"));
    expect(calls[0]).toMatchObject({ url: `${ORIGIN}/publish`, method: "POST" });
    expect(calls[0]?.headers).toMatchObject({ "tessera-request": "submit", "tessera-targets": "content" });
    expect(bodyText(calls[0]?.body)).toBe("title=Hi&intent=publish");
  });

  it("makes a GET form, or formmethod get, a visit with the data in the query", async () => {
    const { transport, calls, find, form } = setup(formHtml);
    await transport.submit(form("#f"), find("#search"));
    expect(calls[0]).toMatchObject({ url: `${ORIGIN}/search?title=Hi`, method: "GET", body: undefined });
    expect(calls[0]?.headers["tessera-request"]).toBe("visit");
  });

  it("honours formenctype: multipart sends FormData, text/plain sends lines", async () => {
    const { transport, calls, find, form } = setup(formHtml);
    await transport.submit(form("#f"), find("#multi"));
    await transport.submit(form("#f"), find("#plain"));
    expect(calls[0]?.body).toBeInstanceOf(FormData);
    expect(calls[1]?.body).toBe("title=Hi\r\n");
  });

  it("leaves a dialog form to the browser", async () => {
    const { transport, calls, find, form } = setup(formHtml);
    expect((await transport.submit(form("#f"), find("#dialog"))).status).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("takes data-push from the submitter, then the form: off commits without a history entry", async () => {
    const { transport, calls, respond, find, form, pushed } = setup(
      `<nav><form id="off" action="/tabs" data-target="content" data-push="off"><button id="keep">Keep</button><button id="push" data-push="on">Push</button></form>` +
        `<form id="on" action="/tabs" data-target="content"><button id="plain">Plain</button><button id="skip" data-push="off">Skip</button></form></nav>${content}`,
    );
    respond(...["a", "b", "c", "d"].map((text) => () => fragments(contentFragment(text))));
    const outcomes: RequestOutcome[] = [];
    for (const [selector, submitter] of [["#off", "#keep"], ["#off", "#push"], ["#on", "#plain"], ["#on", "#skip"]] as const) {
      outcomes.push(await transport.submit(form(selector), find(submitter)));
    }
    expect(outcomes.map(({ status }) => status)).toEqual(["committed", "committed", "committed", "committed"]);
    expect(calls.map(({ headers }) => headers["tessera-request"])).toEqual(["visit", "visit", "visit", "visit"]);
    expect(find("#text").textContent).toBe("d");
    expect(pushed).toEqual([`${ORIGIN}/tabs`, `${ORIGIN}/tabs`]);
  });

  it("takes data-push=\"replace\" from the submitter, then the form, for a visit and a Tessera-Location", async () => {
    const modes: [string, string][] = [];
    const { transport, respond, find, form } = setup(
      `<nav><form id="get" action="/search" data-target="content" data-push="replace"><button id="replace">Replace</button><button id="push" data-push="on">Push</button></form>` +
        `<form id="plain" action="/search" data-target="content"><button id="step" data-push="replace">Step</button></form>` +
        `<form id="post" method="post" action="/save" data-target="content" data-push="replace"><button id="save">Save</button></form></nav>${content}`,
      {
        history: {
          capture: () => undefined,
          commit: (url, request) => {
            modes.push([url, request.history]);
          },
        },
      },
    );
    respond(
      () => fragments(contentFragment("a")),
      () => fragments(contentFragment("b")),
      () => fragments(contentFragment("c")),
      () => empty(200, { "Tessera-Location": "/saved", "Tessera-Protocol": "2" }),
      () => fragments(contentFragment("d")),
    );
    for (const [selector, submitter] of [["#get", "#replace"], ["#get", "#push"], ["#plain", "#step"], ["#post", "#save"]] as const) {
      expect((await transport.submit(form(selector), find(submitter))).status).toBe("committed");
    }
    expect(modes).toEqual([
      [`${ORIGIN}/search`, "replace"],
      [`${ORIGIN}/search`, "push"],
      [`${ORIGIN}/search`, "replace"],
      [`${ORIGIN}/saved`, "replace"],
    ]);
    expect(find("#text").textContent).toBe("d");
  });

  it("takes data-target from the submitter, then the form", async () => {
    const { transport, calls, find, form } = setup(
      `<main data-region="content"><form id="f" method="post" action="/s" data-target="content sidebar"><button id="b" data-target="sidebar">Go</button></form></main><nav data-region="sidebar"></nav>`,
    );
    await transport.submit(form("#f"), find("#b"));
    await transport.submit(form("#f"));
    expect(calls.map(({ headers }) => headers["tessera-targets"])).toEqual(["sidebar", "content, sidebar"]);
  });
});

describe("supersession by target", () => {
  it("never sends a read superseded within the buffer", async () => {
    const { transport, calls } = setup(content, { bufferMs: 20 });
    const first = transport.request({ kind: "refresh", url: "/a", targets: ["content"] });
    const second = transport.request({ kind: "refresh", url: "/b", targets: ["content"] });
    expect((await first).status).toBe("superseded");
    expect((await second).status).toBe("committed");
    expect(calls.map(({ url }) => url)).toEqual([`${ORIGIN}/b`]);
  });

  it("aborts an older read in flight for the same target, by target and not by URL", async () => {
    const { transport, calls, respond } = setup(`${content}<nav data-region="sidebar"></nav>`);
    respond(hang, hang);
    const older = transport.request({ kind: "refresh", url: "/same", targets: ["content"] });
    const other = transport.request({ kind: "refresh", url: "/same", targets: ["sidebar"] });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    const newer = transport.request({ kind: "visit", url: "/other", targets: ["content"] });
    expect((await older).status).toBe("superseded");
    expect((await newer).status).toBe("committed");
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(calls[1]?.signal.aborted).toBe(false);
    void other;
  });

  it("never aborts a write for a newer request: a read on its target waits for it", async () => {
    const { transport, calls, respond, find } = setup(content);
    let answer: (response: Response) => void = () => undefined;
    respond(() => new Promise<Response>((resolve) => { answer = resolve; }), () => fragments(contentFragment("read after")));
    const write = transport.request({ kind: "submit", method: "POST", url: "/save", targets: ["content"], body: "" });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const read = transport.request({ kind: "refresh", url: "/content", targets: ["content"] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls[0]?.signal.aborted).toBe(false);
    expect(calls).toHaveLength(1);
    answer(fragments(contentFragment("saved")));
    expect((await write).status).toBe("committed");
    expect((await read).status).toBe("committed");
    expect(calls.map(({ method }) => method)).toEqual(["POST", "GET"]);
    expect(find("#text").textContent).toBe("read after");
  });
});

describe("headers", () => {
  it("sends the protocol's headers, with props tokens from the components", async () => {
    const { transport, calls } = setup(`<main data-region="content"><div data-t-c="cart" data-t-props="eyJpZCI6MX0.c2ln"><p></p></div></main>`);
    await transport.request({ kind: "refresh", url: "/cart", targets: ["content/cart"] });
    expect(calls[0]?.headers).toEqual({
      accept: ACCEPT,
      "tessera-request": "refresh",
      "tessera-protocol": "2",
      "tessera-targets": "content/cart eyJpZCI6MX0.c2ln",
      "tessera-layout": "app",
    });
  });

  it("leaves Tessera-Targets out for the page and Tessera-Layout out without its meta", async () => {
    const { transport, calls } = setup(content, {}, "");
    await transport.request({ kind: "visit", url: "/x" });
    expect(Object.keys(calls[0]?.headers ?? {}).sort()).toEqual(["accept", "tessera-protocol", "tessera-request"]);
  });

  it("sends the CSRF token on unsafe requests only, under the page's header name", async () => {
    const { transport, calls } = setup(content, {}, `<meta name="tessera-csrf-token" content="tok"><meta name="tessera-csrf-header" content="X-XSRF-Token">`);
    await transport.request({ kind: "submit", method: "POST", url: "/a", body: "" });
    await transport.request({ kind: "action", method: "DELETE", url: "/a" });
    await transport.request({ kind: "refresh", url: "/a" });
    expect(calls.map(({ headers }) => headers["x-xsrf-token"])).toEqual(["tok", "tok", undefined]);
  });

  it("reads the CSRF token when the request is made", async () => {
    const { transport, calls, find } = setup(content);
    (find('meta[name="tessera-csrf-token"]') as HTMLMetaElement).content = "fresh";
    await transport.request({ kind: "submit", method: "POST", url: "/a", body: "" });
    expect(calls[0]?.headers["x-csrf-token"]).toBe("fresh");
  });

  it("sends the signals of the element's chain on actions only", async () => {
    const { transport, calls, find } = setup(
      `<main data-region="content" data-signals="{qty: 2, _local: 1}"><div data-t-c="line"><button id="b" data-signals="{open: true}"></button></div></main>`,
    );
    await transport.actions({ method: "post", url: "/qty", options: undefined, element: find("#b"), event: undefined });
    expect(calls[0]?.headers).toMatchObject({ "tessera-request": "action", "tessera-targets": "content/line", "tessera-signals": '{"qty":2,"open":true}' });
    await transport.request({ kind: "refresh", url: "/x", element: find("#b"), signals: true });
    expect(calls[1]?.headers["tessera-signals"]).toBeUndefined();
  });

  it("refuses an action whose signals exceed 4,096 bytes, unsent", async () => {
    const { transport, calls, find, reported } = setup(`<main data-region="content"><button id="b" data-signals="{text: '${"x".repeat(5000)}'}"></button></main>`);
    const outcome = (await transport.actions({ method: "post", url: "/x", options: undefined, element: find("#b"), event: undefined })) as RequestOutcome;
    expect(outcome.status).toBe("failed");
    expect(calls).toEqual([]);
    expect(String(reported[0])).toContain("the limit is 4096");
  });
});

describe("the write id", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)("is on a %s, as a UUID", async (method) => {
    const { transport, calls } = setup(content);
    await transport.request({ kind: "action", method, url: "/x", ...(method === "DELETE" ? {} : { body: "" }) });
    expect(calls[0]?.headers["tessera-write-id"]).toMatch(UUID);
  });

  it("is never on a GET, nor on the visit a Tessera-Location leads to", async () => {
    const { transport, calls, respond } = setup(content);
    respond(() => empty(204), () => empty(200, { "Tessera-Location": "/done", "Tessera-Protocol": "2" }), () => fragments(contentFragment("done")));
    await transport.request({ kind: "refresh", url: "/x" });
    await transport.request({ kind: "submit", method: "POST", url: "/save", targets: ["content"], body: "" });
    expect(calls.map(({ method, headers }) => [method, headers["tessera-write-id"] !== undefined])).toEqual([
      ["GET", false],
      ["POST", true],
      ["GET", false],
    ]);
  });

  it("is new for every submission, the same form submitted twice included", async () => {
    const { transport, calls, find } = setup(`<main data-region="content"><form id="f" method="post" action="/s"><button id="b">Go</button></form></main>`);
    await transport.submit(find("#f") as HTMLFormElement, find("#b"));
    await transport.submit(find("#f") as HTMLFormElement, find("#b"));
    const [first, second] = calls.map(({ headers }) => headers["tessera-write-id"]);
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(first).not.toBe(second);
  });

  it("cannot be changed or removed by an interceptor", async () => {
    const { transport, calls } = setup(content);
    transport.intercept({
      before: ({ headers, request }) => {
        expect(request.writeId).toMatch(UUID);
        headers.set("Tessera-Write-Id", "forged");
      },
    });
    transport.intercept({
      before: ({ headers }) => {
        headers.delete("Tessera-Write-Id");
      },
    });
    const outcome = transport.request({ kind: "action", method: "POST", url: "/x", body: "" });
    await outcome;
    expect(calls[0]?.headers["tessera-write-id"]).toMatch(UUID);
  });
});

describe("the 419 prompt", () => {
  it("raises tessera:expired and, unless it is cancelled, offers a reload", async () => {
    const reload = vi.fn();
    const confirm = vi.fn(() => true);
    const { transport, respond } = setup(content, { reload, confirm });
    respond(() => empty(419), () => empty(419));
    const seen = vi.fn();
    document.addEventListener(EXPIRED_EVENT, seen);
    expect((await transport.request({ kind: "submit", method: "POST", url: "/a", body: "" })).status).toBe("expired");
    expect([seen.mock.calls.length, confirm.mock.calls.length, reload.mock.calls.length]).toEqual([1, 1, 1]);

    const cancel = (event: Event): void => { event.preventDefault(); };
    document.addEventListener(EXPIRED_EVENT, cancel);
    await transport.request({ kind: "submit", method: "POST", url: "/a", body: "" });
    expect(confirm).toHaveBeenCalledOnce();
    document.removeEventListener(EXPIRED_EVENT, seen);
    document.removeEventListener(EXPIRED_EVENT, cancel);
  });
});

describe("the 5 ms buffer", () => {
  it("holds a request for the buffer before sending it", async () => {
    vi.useFakeTimers();
    const { transport, calls } = setup(content, { bufferMs: 5 });
    const pending = transport.request({ kind: "refresh", url: "/x" });
    await vi.advanceTimersByTimeAsync(4);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    await pending;
  });
});

describe("interceptors", () => {
  it("run once per logical request: before may add headers but not change the protocol's", async () => {
    const { transport, calls, respond } = setup(content);
    respond(networkFailure, () => fragments(""));
    const before = vi.fn(({ headers }: { headers: Headers }) => {
      headers.set("X-Trace", "1");
      headers.set("Tessera-Request", "forged");
    });
    const after = vi.fn();
    const remove = transport.intercept({ before, after });
    await transport.request({ kind: "refresh", url: "/x" });
    expect(before).toHaveBeenCalledOnce();
    expect(after.mock.calls.map(([context]) => (context as { outcome: RequestOutcome }).outcome.status)).toEqual(["committed"]);
    expect(calls.map(({ headers }) => [headers["x-trace"], headers["tessera-request"]])).toEqual([
      ["1", "refresh"],
      ["1", "refresh"],
    ]);
    remove();
    await transport.request({ kind: "refresh", url: "/x" });
    expect(before).toHaveBeenCalledOnce();
  });

  it("hand an indeterminate write to error", async () => {
    const { transport, respond } = setup(content);
    respond(networkFailure);
    const error = vi.fn();
    transport.intercept({ error });
    await transport.request({ kind: "submit", method: "POST", url: "/x", body: "" });
    expect(error).toHaveBeenCalledOnce();
  });
});

describe("lifetime", () => {
  it("aborts a read in flight on disposal, and whenEnhanced waits for requests", async () => {
    const { transport, calls, respond, kernel: current } = setup(content);
    respond(hang);
    const pending = transport.request({ kind: "refresh", url: "/x" });
    let settled = false;
    void current.whenEnhanced().then(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(settled).toBe(false);
    current.dispose();
    expect((await pending).status).toBe("aborted");
  });

  it("waits while the page is hidden before sending a GET", async () => {
    const { transport, calls } = setup(`${content}<nav data-region="sidebar"></nav>`);
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      // Different targets, so the newer write does not supersede the waiting read.
      const pending = transport.request({ kind: "refresh", url: "/x", targets: ["content"] });
      const write = transport.request({ kind: "submit", method: "POST", url: "/y", targets: ["sidebar"], body: "" });
      await write;
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls.map(({ method }) => method)).toEqual(["POST"]);
      state.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await pending;
      expect(calls.map(({ method }) => method)).toEqual(["POST", "GET"]);
    } finally {
      state.mockRestore();
    }
  });
});

describe("the protocol's answers", () => {
  it("does nothing for a 204", async () => {
    const { transport, respond, find } = setup(content);
    respond(() => empty(204));
    expect((await transport.request({ kind: "refresh", url: "/x", targets: ["content"] })).status).toBe("unchanged");
    expect(find("#text").textContent).toBe("old");
  });

  it("hands Tessera-Full-Visit to the browser, http and https only", async () => {
    const { transport, respond, navigated } = setup(content);
    respond(() => empty(401, { "Tessera-Full-Visit": "/login?next=%2Fcart" }), () => empty(401, { "Tessera-Full-Visit": "javascript:alert(1)" }));
    expect((await transport.request({ kind: "refresh", url: "/x" })).status).toBe("full-load");
    expect(navigated).toEqual([`${ORIGIN}/login?next=%2Fcart`]);
    expect((await transport.request({ kind: "refresh", url: "/x" })).status).toBe("failed");
  });

  it("loads in full on a 400 from a server speaking only version 1, and on a fragment response without version 2", async () => {
    const { transport, respond, navigated } = setup(content);
    respond(
      () => empty(400, { "Tessera-Protocol": "1" }),
      () => new Response("", { headers: { "Content-Type": "text/vnd.tessera+html" } }),
      () => new Response("", { headers: { "Content-Type": "text/vnd.tessera+html", "Tessera-Protocol": "1" } }),
    );
    await transport.request({ kind: "visit", url: "/a" });
    await transport.request({ kind: "visit", url: "/b" });
    await transport.request({ kind: "visit", url: "/c" });
    expect(navigated).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b`, `${ORIGIN}/c`]);
  });

  it("treats a 400 listing version 2 among others as an ordinary client error", async () => {
    const { transport, respond, navigated } = setup(content);
    respond(() => empty(400, { "Tessera-Protocol": "1, 2" }));
    expect((await transport.request({ kind: "refresh", url: "/a" })).status).toBe("failed");
    expect(navigated).toEqual([]);
  });

  it("hands a whole document to commitDocument, or loads in full without it", async () => {
    const commitDocument = vi.fn();
    const html = () => new Response("<!doctype html><title>x</title>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const first = setup(content, { commitDocument });
    first.respond(html);
    expect((await first.transport.request({ kind: "visit", url: "/doc" })).status).toBe("committed");
    expect(commitDocument).toHaveBeenCalledWith("<!doctype html><title>x</title>", `${ORIGIN}/doc`, expect.anything());
    first.kernel.dispose();
    const second = setup(content);
    second.respond(html);
    expect((await second.transport.request({ kind: "visit", url: "/doc" })).status).toBe("full-load");
  });

  it("commits templates, signal patches, the title and the CSRF token", async () => {
    const { transport, respond, find, mount } = setup(`${content}<nav data-region="sidebar"></nav>`);
    respond(() =>
      fragments(`<title>New · Shop</title><meta name="tessera-csrf-token" content="next">
        ${contentFragment("new")}<template data-target="sidebar" data-mode="append"><a>link</a></template>
        <script type="application/json" data-scope="page">{"unread":4}</script>`),
    );
    expect((await transport.request({ kind: "visit", url: "/n", targets: ["content"] })).status).toBe("committed");
    expect(find("#text").textContent).toBe("new");
    expect(find("nav").innerHTML).toBe("<a>link</a>");
    expect(document.title).toBe("New · Shop");
    expect((find('meta[name="tessera-csrf-token"]') as HTMLMetaElement).content).toBe("next");
    expect(mount.scopes.document).toEqual({ unread: 4 });
  });

  it("lands every fragment after a remove in the same answer (#41)", async () => {
    const { transport, respond, find } = setup(`<ul><li data-region="first">1</li><li data-region="second">2</li></ul>${content}`);
    respond(() =>
      fragments(`<template data-target="first" data-mode="remove"></template><template data-target="second" data-mode="remove"></template>
        ${contentFragment("new")}`),
    );
    expect((await transport.request({ kind: "refresh", url: "/r", targets: ["first", "second", "content"] })).status).toBe("committed");
    expect(find("ul").children).toHaveLength(0);
    expect(find("#text").textContent).toBe("new");
  });

  it("commits nothing for a malformed response or overlapping targets", async () => {
    const { transport, respond, find } = setup(content);
    respond(
      () => fragments(`${contentFragment("x")}<div>stray</div>`),
      () => fragments(`${contentFragment("x")}<template data-target="content" data-mode="inner"><p>y</p></template>`),
      () => fragments(`<template data-target="page"><p></p></template>`),
    );
    for (let index = 0; index < 3; index++) {
      expect((await transport.request({ kind: "refresh", url: "/x" })).status).toBe("failed");
    }
    expect(find("#text").textContent).toBe("old");
  });

  it("drops a requested target that left the page, and loads a visit in full for another missing one", async () => {
    const { transport, respond, find, navigated } = setup(`${content}<nav data-region="sidebar"><p id="side">old</p></nav>`);
    respond(
      () => fragments(`<template data-target="gone"><div data-region="gone"></div></template><template data-target="sidebar"><nav data-region="sidebar"><p id="side">new</p></nav></template>`),
      () => fragments(`<template data-target="unknown"><div data-region="unknown"></div></template>`),
    );
    expect((await transport.request({ kind: "refresh", url: "/x", targets: ["gone", "sidebar"] })).status).toBe("committed");
    expect(find("#side").textContent).toBe("new");
    expect((await transport.request({ kind: "visit", url: "/v", targets: ["content"] })).status).toBe("full-load");
    expect(navigated).toEqual([`${ORIGIN}/v`]);
  });

  it("loads in full when the tracked assets changed", async () => {
    const { transport, respond, navigated, find } = setup(content, {}, `<script src="/app.1.js" data-track></script>`);
    respond(() => fragments(`<script src="/app.2.js" data-track></script>${contentFragment("x")}`), () => fragments(`<script src="/app.1.js" data-track></script>${contentFragment("y")}`));
    expect((await transport.request({ kind: "visit", url: "/v", targets: ["content"] })).status).toBe("full-load");
    expect(navigated).toEqual([`${ORIGIN}/v`]);
    expect((await transport.request({ kind: "visit", url: "/v", targets: ["content"] })).status).toBe("committed");
    expect(find("#text").textContent).toBe("y");
  });

  it("never fetches another origin: a visit loads in full, anything else fails", async () => {
    const { transport, calls, navigated } = setup(content);
    expect((await transport.request({ kind: "visit", url: "https://elsewhere.example/" })).status).toBe("full-load");
    expect((await transport.request({ kind: "submit", method: "POST", url: "https://elsewhere.example/", body: "" })).status).toBe("failed");
    expect(calls).toEqual([]);
    expect(navigated).toEqual(["https://elsewhere.example/"]);
  });
});

describe("anchors", () => {
  const page = `<main data-region="content"><div data-t-c="cart" data-t-props="eyJpZCI6MX0.c2ln" data-t-anchor="basket"><button id="b"></button></div></main>
    <p data-t-c="x" data-t-anchor="twice"></p><p data-t-c="y" data-t-anchor="twice"></p>`;

  it("resolves @NAME to the component's path, with its props and its anchor, before Tessera-Targets is sent", async () => {
    const { transport, calls, find } = setup(page);
    const outcome = await transport.request({ kind: "refresh", url: "/cart", targets: ["@basket", "sidebar"] });
    await transport.actions({ method: "post", url: "/qty", options: { target: "@basket" }, element: find("#b"), event: undefined });
    expect(calls.map(({ headers }) => headers["tessera-targets"])).toEqual([
      "content/cart eyJpZCI6MX0.c2ln @basket, sidebar",
      "content/cart eyJpZCI6MX0.c2ln @basket",
    ]);
    expect(outcome.status).not.toBe("failed");
  });

  it("sends the anchor of a component targeted by its path: a refresh, an action inside it", async () => {
    const { transport, calls, find } = setup(page);
    await transport.request({ kind: "refresh", url: "/cart", targets: ["content/cart"] });
    await transport.actions({ method: "get", url: "/cart", options: undefined, element: find("#b"), event: undefined });
    expect(calls.map(({ headers }) => headers["tessera-targets"])).toEqual(["content/cart eyJpZCI6MX0.c2ln @basket", "content/cart eyJpZCI6MX0.c2ln @basket"]);
  });

  it("spells an anchored component without props as target @NAME, and leaves regions and unanchored components alone", () => {
    setup(`<main data-region="content"><div data-t-c="list" data-t-anchor="stock"><p data-t-c="row" data-t-props="cm93"></p></div><p data-t-c="plain"></p></main>`);
    expect(targetsHeader(document, ["content/list", "content/list/row", "content/plain", "content"])).toBe("content/list @stock, content/list/row cm93, content/plain, content");
  });

  it.each([
    ["badly spelled", `<p data-t-c="x" data-t-props="cHJvcHM" data-t-anchor="no good"></p>`, "page/x cHJvcHM"],
    ["carried by two elements", `<p data-t-c="x" data-t-anchor="twice"></p><p data-t-c="y" data-t-anchor="twice"></p>`, "page/x"],
  ])("leaves out an anchor %s", (_case, markup, entry) => {
    setup(markup);
    expect(targetsHeader(document, ["page/x"])).toBe(entry);
  });

  it.each([
    ["an unknown anchor", "@nowhere", "the page has no anchor nowhere."],
    ["a doubled anchor", "@twice", "two elements carry the anchor twice."],
  ])("reports %s and sends nothing", async (_case, target, message) => {
    const { transport, calls, reported } = setup(page);
    const outcome = await transport.request({ kind: "visit", url: "/x", targets: [target] });
    expect(outcome.status).toBe("failed");
    expect(calls).toEqual([]);
    expect(String(reported[0])).toContain(message);
  });

  it("sends a form's anchored data-target as a path", async () => {
    const { transport, calls, find } = setup(`${page}<form id="f" method="post" action="/save" data-target="@basket"></form>`);
    await transport.submit(find("#f") as HTMLFormElement);
    expect(calls[0]?.headers["tessera-targets"]).toBe("content/cart eyJpZCI6MX0.c2ln @basket");
  });

  it("prefetches nothing for an anchor that does not resolve", () => {
    const { transport, calls } = setup(page);
    transport.prefetch({ url: "/x", targets: ["@nowhere"], press: true });
    expect(calls).toEqual([]);
  });
});

describe("the action seam", () => {
  it("targets the innermost component or region by default, or the target option", async () => {
    const { transport, calls, find } = setup(`<main data-region="content"><div data-t-c="card"><button id="in"></button></div><button id="out"></button></main><p id="loose"></p>`);
    const call = (element: Element, options?: Record<string, unknown>) =>
      transport.actions({ method: "get", url: "/x", options, element, event: undefined }) as Promise<RequestOutcome>;
    await call(find("#in"));
    await call(find("#out"));
    await call(find("#loose"));
    await call(find("#in"), { target: "content sidebar" });
    expect(calls.map(({ headers }) => headers["tessera-targets"])).toEqual(["content/card", "content", undefined, "content, sidebar"]);
  });

  it("sends a form's data with { form: true }, and refuses unknown options", async () => {
    const { transport, calls, find } = setup(`<main data-region="content"><form><input name="q" value="lamp"><button id="b"></button></form></main>`);
    await transport.actions({ method: "post", url: "/search", options: { form: true }, element: find("#b"), event: undefined });
    expect(bodyText(calls[0]?.body)).toBe("q=lamp");
    expect(() => transport.actions({ method: "post", url: "/x", options: { retry: 3 }, element: find("#b"), event: undefined })).toThrow(
      "@post has no option retry; it takes target and form.",
    );
  });
});
