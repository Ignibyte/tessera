// @vitest-environment node
// The reference server against docs/protocol.md: each answer of sections 1 and 5 to 8, and the
// controllable endpoint. The server runs on a free port for the whole file.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scan } from "../server/html.ts";
import { VARY } from "../server/http.ts";
import { startServer } from "../server/server.ts";
import type { RunningServer } from "../server/server.ts";

let server: RunningServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server.close();
});

type Headers = Record<string, string>;

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, server.url), { redirect: "manual", ...init });
}

function tessera(kind: string, targets?: string, layout = "app"): Headers {
  return {
    "Tessera-Request": kind,
    "Tessera-Protocol": "2",
    "Tessera-Layout": layout,
    ...(targets === undefined ? {} : { "Tessera-Targets": targets }),
  };
}

async function csrf(): Promise<string> {
  const html = await (await request("/")).text();
  const token = /<meta name="tessera-csrf-token" content="([^"]+)">/.exec(html)?.[1];
  if (token === undefined) throw new Error("the home page has no CSRF meta");
  return token;
}

async function propsOf(key: string): Promise<string> {
  const html = await (await request("/")).text();
  const token = new RegExp(`data-t-c="${key}" data-t-props="([^"]+)"`).exec(html)?.[1];
  if (token === undefined) throw new Error(`no props on component ${key}`);
  return token;
}

function templates(body: string): string[] {
  return [...body.matchAll(/<template data-target="([^"]+)">/g)].map((match) => match[1] ?? "");
}

function post(path: string, fields: Headers, headers: Headers = {}): Promise<Response> {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

describe("documents and fragments", () => {
  it("answers a plain GET with the full document and its identities", async () => {
    const response = await request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("vary")).toBe(VARY);
    expect(response.headers.get("tessera-protocol")).toBeNull();
    const html = await response.text();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect([...scan(html).byTarget.keys()].sort()).toEqual([
      "content",
      "content/greeting",
      "content/greeting/count",
      "notes",
      "notes/note-1",
      "notes/note-2",
      "page/crumb",
      "sidebar",
    ]);
  });

  it("answers a visit from the same layout with fragments, the title and the tracked assets", async () => {
    const response = await request("/about", { headers: tessera("visit", "content") });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/vnd.tessera+html; charset=utf-8");
    expect(response.headers.get("tessera-protocol")).toBe("2");
    expect(response.headers.get("vary")).toBe(VARY);
    const body = await response.text();
    expect(body).not.toContain("<html");
    expect(body).toContain("<title>About · Fixture</title>");
    expect(body).toContain('<link rel="stylesheet" href="/assets/fixture.css" data-track="1">');
    expect(body).toContain('<script type="module" src="/assets/tessera.js" data-track></script>');
    expect(body).toContain('<template data-target="content">\n<main data-region="content">');
    expect(templates(body)).toEqual(["content"]);
  });

  it.each([
    ["from another layout", "/bare", tessera("visit", "content")],
    ["without Tessera-Layout", "/about", { "Tessera-Request": "visit", "Tessera-Protocol": "2", "Tessera-Targets": "content" }],
    ["for a target the page lacks", "/about", tessera("visit", "notes")],
    ["for the page target", "/about", tessera("visit", "page")],
    ["without Tessera-Targets", "/about", tessera("visit")],
  ])("answers a visit %s with the full document", async (_case, path, headers) => {
    const response = await request(path, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<!doctype html>");
  });

  it("refreshes a component by path when its props token verifies", async () => {
    const token = await propsOf("greeting");
    const response = await request("/", { headers: tessera("refresh", `content/greeting ${token}`) });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(templates(body)).toEqual(["content/greeting"]);
    expect(body).toContain(`<template data-target="content/greeting">\n<div data-t-c="greeting" data-t-props="${token}" data-t-anchor="hello">`);
    expect(body).toContain("</p>\n    </div>\n</template>");
  });

  it("reads an entry's anchor, and refuses one the target's component does not carry", async () => {
    const token = await propsOf("greeting");
    const anchored = await request("/", { headers: tessera("refresh", `content/greeting ${token} @hello`) });
    expect(templates(await anchored.text())).toEqual(["content/greeting"]);
    const wrong = await request("/", { headers: tessera("refresh", `content/greeting ${token} @other`) });
    expect(wrong.status).toBe(400);
    const unanchored = await request("/", { headers: tessera("refresh", `content/greeting/count @hello`) });
    expect(unanchored.status).toBe(400);
  });

  it("addresses a component in a nested region from that region's name", async () => {
    const token = await propsOf("note-2");
    const response = await request("/", { headers: tessera("refresh", `notes/note-2 ${token}`) });
    expect(await response.text()).toContain(`<template data-target="notes/note-2">\n<li data-t-c="note-2" data-t-props="${token}">Second note</li>\n</template>`);
  });

  it("refuses a props token that does not verify", async () => {
    const token = await propsOf("greeting");
    const tampered = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;
    const response = await request("/", { headers: tessera("refresh", `content/greeting ${tampered}`) });
    expect(response.status).toBe(403);
  });

  it("sends only the outermost of targets that contain one another", async () => {
    const token = await propsOf("greeting");
    const response = await request("/", {
      headers: tessera("visit", `content/greeting ${token}, content, sidebar`),
    });
    expect(templates(await response.text())).toEqual(["content", "sidebar"]);
  });

  it("answers a malformed Tessera-Targets with 400", async () => {
    const response = await request("/", { headers: tessera("visit", "Content!") });
    expect(response.status).toBe(400);
  });

  it("answers an unknown URL with a 404 page, as fragments for a visit", async () => {
    const plain = await request("/nowhere");
    expect(plain.status).toBe(404);
    expect(plain.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const visit = await request("/nowhere", { headers: tessera("visit", "content") });
    expect(visit.status).toBe(404);
    expect(templates(await visit.text())).toEqual(["content"]);
  });

  it("answers the navigation fixtures: /away, /stray and /redeploy", async () => {
    const away = await request("/away", { headers: tessera("visit", "content") });
    expect([away.status, away.headers.get("tessera-full-visit")]).toEqual([200, "/about"]);
    const plainAway = await request("/away");
    expect([plainAway.status, plainAway.headers.get("location")]).toEqual([302, "/about"]);
    const stray = await request("/stray", { headers: tessera("visit", "content") });
    expect(templates(await stray.text())).toEqual(["nowhere"]);
    expect(await (await request("/redeploy")).text()).toContain('href="/assets/fixture.css" data-track="2"');
  });

  it("applies a Tessera write once per write id, answering a repeat with the first answer", async () => {
    const send = (id: string) =>
      request("/counter?key=unit", { method: "POST", headers: { ...tessera("action", "content"), "Tessera-Write-Id": id }, body: "" });
    const first = await (await send("id-1")).text();
    const repeat = await (await send("id-1")).text();
    await send("id-2");
    expect(repeat).toBe(first);
    expect(first).toContain('<p id="count">1</p>');
    const log = (await (await request("/counter/log?key=unit")).json()) as { count: number; arrivals: { id: string; repeat: boolean }[] };
    expect(log).toEqual({
      count: 2,
      arrivals: [
        { path: "/counter?key=unit", id: "id-1", repeat: false },
        { path: "/counter?key=unit", id: "id-1", repeat: true },
        { path: "/counter?key=unit", id: "id-2", repeat: false },
      ],
    });
    expect((await send("not an id")).status).toBe(400);
  });

  it("drops the connection on the first arrival of drop=once, and answers the repeat", async () => {
    const send = () =>
      request("/counter?key=drop&drop=once", { method: "POST", headers: { ...tessera("action", "content"), "Tessera-Write-Id": "d-1" }, body: "" });
    await expect(send()).rejects.toThrow();
    const repeat = await send();
    expect(await repeat.text()).toContain('<p id="count">1</p>');
    expect(((await (await request("/counter/log?key=drop")).json()) as { count: number }).count).toBe(1);
  });

  it.each(["0", "1"])("refuses protocol %s and any other version it does not speak, before any side effect", async (version) => {
    const response = await post(
      "/form",
      { name: "Ada", _token: await csrf() },
      { ...tessera("submit", "content"), "Tessera-Protocol": version },
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("tessera-protocol")).toBe("2");
    expect(response.headers.get("tessera-location")).toBeNull();
  });

  it("sets Vary on every response", async () => {
    const responses = await Promise.all([
      request("/assets/fixture.css"),
      request("/about", { method: "DELETE" }),
      request("/events/stream?count=0&end=close"),
      request("/_control/vary/requests"),
      request("/slow?ms=0", { headers: tessera("visit", "content", "other") }),
    ]);
    for (const response of responses) expect(response.headers.get("vary")).toBe(VARY);
    expect(responses.map((response) => response.status)).toEqual([200, 405, 200, 200, 200]);
    await Promise.all(responses.map((response) => response.text()));
  });
});

describe("the form", () => {
  it("answers a plain post with 422 in place, then with 303 to the done page", async () => {
    const token = await csrf();
    const invalid = await post("/form", { name: "", _token: token });
    expect(invalid.status).toBe(422);
    const html = await invalid.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("data-error-summary");
    const valid = await post("/form", { name: "Ada Lovelace", _token: token });
    expect(valid.status).toBe(303);
    expect(valid.headers.get("location")).toBe("/form/done?name=Ada%20Lovelace");
  });

  it("answers a Tessera submission that succeeds with Tessera-Location on a 200", async () => {
    const response = await post("/form", { name: "Ada" }, { ...tessera("submit", "content"), "X-CSRF-Token": await csrf() });
    expect(response.status).toBe(200);
    expect(response.headers.get("tessera-location")).toBe("/form/done?name=Ada");
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("answers a refused Tessera submission with 422 or 409 and the form's region", async () => {
    const token = await csrf();
    const empty = await post("/form", { name: "", _token: token }, tessera("submit", "content"));
    expect(empty.status).toBe(422);
    const body = await empty.text();
    expect(templates(body)).toEqual(["content"]);
    expect(body).toContain('<div id="name-error" data-error-summary tabindex="-1" role="alert">Name is required.</div>');
    const taken = await post("/form", { name: "taken", _token: token }, tessera("submit", "content"));
    expect(taken.status).toBe(409);
    expect(await taken.text()).toContain("That name is taken.");
  });

  it("answers a stale CSRF token, and /expired, with 419", async () => {
    const stale = await post("/form", { name: "Ada", _token: "stale" }, tessera("submit", "content"));
    expect(stale.status).toBe(419);
    expect((await request("/expired")).status).toBe(419);
  });

  it("refuses a body it does not read", async () => {
    const response = await request("/form", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(response.status).toBe(415);
  });

  it("escapes what it echoes", async () => {
    const response = await request(`/form/done?name=${encodeURIComponent("<b>Ada</b>")}`);
    expect(await response.text()).toContain("Thanks, &lt;b&gt;Ada&lt;/b&gt;.");
  });
});

/** Reads a stream's body to its end, or until `until` appears in it. */
async function readStream(response: Response, until?: string): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no body");
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
    if (until !== undefined && text.includes(until)) {
      await reader.cancel();
      return text;
    }
  }
}

function eventIds(text: string): string[] {
  return [...text.matchAll(/^id: (.*)$/gm)].map((match) => match[1] ?? "");
}

describe("the stream", () => {
  it("sends retry, numbered events and tessera-close", async () => {
    const response = await request("/events/stream?end=close", { headers: { ...tessera("stream"), Accept: "text/event-stream" } });
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("tessera-protocol")).toBe("2");
    expect(response.headers.get("tessera-stream-pause")).toBeNull();
    const text = await readStream(response);
    expect(text.startsWith("retry: 1000\n\n")).toBe(true);
    expect(eventIds(text)).toEqual(["1", "2", "3"]);
    expect(text).toContain(
      "event: tessera-patch-elements\nid: 1\ndata: target events\ndata: mode prepend\ndata: elements <li>Event 1</li>\n\n",
    );
    expect(text.endsWith("event: tessera-close\ndata: reason done\n\n")).toBe(true);
  });

  it("resumes after Last-Event-ID", async () => {
    const response = await request("/events/stream?count=4&end=close", { headers: { ...tessera("stream"), "Last-Event-ID": "2" } });
    expect(eventIds(await readStream(response))).toEqual(["3", "4"]);
  });

  it("sends the current state when it cannot resume", async () => {
    const response = await request("/events/stream?end=close", { headers: { ...tessera("stream"), "Last-Event-ID": "stale" } });
    const text = await readStream(response);
    expect(eventIds(text)).toEqual(["3"]);
    expect(text).toContain(
      'data: target events\ndata: elements <ul data-region="events" data-stream="/events/stream?end=close"><li>Event 3</li><li>Event 2</li><li>Event 1</li></ul>\n\n',
    );
  });

  it("ends the body without tessera-close for end=drop", async () => {
    const text = await readStream(await request("/events/stream?count=1&end=drop"));
    expect(eventIds(text)).toEqual(["1"]);
    expect(text).not.toContain("tessera-close");
  });

  it("stays open for end=open, and sends Tessera-Stream-Pause when asked", async () => {
    const response = await request("/events/stream?count=2&retry=2000&pause=hidden");
    expect(response.headers.get("tessera-stream-pause")).toBe("hidden");
    const text = await readStream(response, "<li>Event 2</li>");
    expect(text.startsWith("retry: 2000\n\n")).toBe(true);
  });

  it("morphs content/latest and the bell by its anchor, and patches received after each list event", async () => {
    const text = await readStream(await request("/events/stream?count=1&end=close"));
    expect(text).toContain(
      'event: tessera-patch-elements\ndata: target content/latest\ndata: elements <div data-t-c="latest"><p id="latest">Latest: 1</p></div>\n\n' +
        'event: tessera-patch-elements\ndata: target @bell\ndata: elements <span data-t-c="Bell.2:count" data-t-anchor="bell"><b id="bell">1</b></span>\n\n' +
        'event: tessera-patch-signals\ndata: scope page\ndata: signals {"received":1}\n\n',
    );
  });

  it("destroys a first connection after step drop, and not a resumed one", async () => {
    const first = await readStream(await request("/events/stream?count=3&drop=2&end=close")).catch((error: unknown) => String(error));
    expect(first).not.toContain("Event 3");
    const resumed = await readStream(await request("/events/stream?count=3&drop=2&end=close", { headers: { "Last-Event-ID": "2" } }));
    expect(eventIds(resumed)).toEqual(["3"]);
    expect(resumed).toContain("tessera-close");
  });

  it("logs each connection under its key, with its Last-Event-ID and whether it closed", async () => {
    await readStream(await request("/events/stream?count=1&end=close&key=log-a"));
    await readStream(await request("/events/stream?count=1&end=close&key=log-a", { headers: { "Last-Event-ID": "1" } }));
    const log = (await (await request("/events/log?key=log-a")).json()) as unknown;
    expect(log).toEqual({ connections: [{ key: "log-a", lastEventId: null, closed: true }, { key: "log-a", lastEventId: "1", closed: true }] });
  });

  it("sends a keep-alive comment every beat, from the start", async () => {
    const started = performance.now();
    const text = await readStream(await request("/events/stream?count=0&beat=100"), ": keep-alive\n\n: keep-alive\n\n");
    expect(performance.now() - started).toBeGreaterThanOrEqual(190);
    expect(text).toBe("retry: 1000\n\n: keep-alive\n\n: keep-alive\n\n");
  });

  it("refuses options it does not know", async () => {
    expect((await request("/events/stream?end=later")).status).toBe(400);
    expect((await request("/events/stream?drop=x")).status).toBe(400);
    expect((await request("/events/stream?beat=10")).status).toBe(400);
  });
});

it("answers /slow after the delay it names", async () => {
  const started = performance.now();
  const response = await request("/slow?ms=150");
  expect(response.status).toBe(200);
  expect(performance.now() - started).toBeGreaterThanOrEqual(140);
  expect(await response.text()).toContain("Answered after 150 ms.");
});

describe("the controller", () => {
  interface Captured {
    seq: number;
    method: string;
    url: string;
    headers: Record<string, string>;
    state: string;
  }

  async function captured(channel: string): Promise<Captured[]> {
    const response = await request(`/_control/${channel}/requests`);
    return ((await response.json()) as { requests: Captured[] }).requests;
  }

  async function waitFor(channel: string, test: (requests: Captured[]) => boolean): Promise<Captured[]> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const requests = await captured(channel);
      if (test(requests)) return requests;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error(`channel ${channel} never reached the state`);
  }

  function release(channel: string, value: object): Promise<Response> {
    return request(`/_control/${channel}/release`, { method: "POST", body: JSON.stringify(value) });
  }

  it("holds requests and answers the oldest first", async () => {
    const first = request("/controlled/fifo/a");
    await waitFor("fifo", (requests) => requests.length === 1);
    const second = request("/controlled/fifo/b");
    await waitFor("fifo", (requests) => requests.length === 2);
    const answered = await release("fifo", { body: "one" });
    expect(await answered.json()).toEqual({ seq: 1, method: "GET", url: "/controlled/fifo/a", status: 200 });
    expect(await (await first).text()).toBe("one");
    await release("fifo", { status: 201, body: "two", headers: { "X-Order": "2" } });
    const last = await second;
    expect(last.status).toBe(201);
    expect(last.headers.get("x-order")).toBe("2");
    expect(last.headers.get("vary")).toBe(VARY);
  });

  it("answers a named request first, so a test can order responses", async () => {
    const first = request("/controlled/order/a");
    const second = request("/controlled/order/b?x=1");
    await waitFor("order", (requests) => requests.length === 2);
    const finished: string[] = [];
    const tracked = [first, second].map((response) => response.then((value) => value.text()).then((body) => finished.push(body)));
    await release("order", { path: "/controlled/order/b?x=1", body: "b" });
    await tracked[1];
    expect(finished).toEqual(["b"]);
    await release("order", { body: "a" });
    await Promise.all(tracked);
    expect(finished).toEqual(["b", "a"]);
  });

  it("captures what arrived, headers and body included", async () => {
    const pending = request("/controlled/capture/save", {
      method: "POST",
      headers: { ...tessera("submit", "content"), "Content-Type": "text/plain" },
      body: "payload",
    });
    const [record] = await waitFor("capture", (requests) => requests.length === 1);
    expect(record).toMatchObject({ seq: 1, method: "POST", url: "/controlled/capture/save", body: "payload", state: "held" });
    expect(record?.headers["tessera-targets"]).toBe("content");
    await release("capture", { method: "post", status: 204 });
    expect((await pending).status).toBe(204);
    expect((await captured("capture"))[0]?.state).toBe("answered");
  });

  it("serves a held request as the server would serve another URL", async () => {
    const pending = request("/controlled/serve/x", { headers: tessera("visit", "content") });
    await waitFor("serve", (requests) => requests.length === 1);
    await release("serve", { serve: "/about" });
    const response = await pending;
    expect(response.headers.get("content-type")).toBe("text/vnd.tessera+html; charset=utf-8");
    expect(await response.text()).toContain("<h1>About</h1>");
  });

  it("waits for a request that has not arrived yet", async () => {
    const answered = release("early", { body: "late" });
    const response = await request("/controlled/early/x");
    expect(await response.text()).toBe("late");
    expect((await answered).status).toBe(200);
  });

  it("fails a release that finds nothing to answer", async () => {
    const response = await release("empty", { timeout: 50 });
    expect(response.status).toBe(408);
    expect(await response.json()).toEqual({ error: "no held request matches", held: [] });
  });

  it("records a request the client aborted, and skips it", async () => {
    const abort = new AbortController();
    const pending = request("/controlled/abort/x", { signal: abort.signal }).catch(() => "aborted");
    await waitFor("abort", (requests) => requests.length === 1);
    abort.abort();
    expect(await pending).toBe("aborted");
    await waitFor("abort", (requests) => requests[0]?.state === "aborted");
    expect((await release("abort", { timeout: 50 })).status).toBe(408);
  });

  it("drops a held connection without answering it", async () => {
    const pending = request("/controlled/drop/x", { method: "POST", body: "once" }).then(
      () => "answered",
      () => "network failure",
    );
    await waitFor("drop", (requests) => requests.length === 1);
    const released = await release("drop", { drop: true });
    expect(await released.json()).toEqual({ seq: 1, method: "POST", url: "/controlled/drop/x", dropped: true });
    expect(await pending).toBe("network failure");
    expect((await captured("drop"))[0]?.state).toBe("dropped");
  });

  it("answers what is still held with 503 on reset", async () => {
    const pending = request("/controlled/reset/x");
    await waitFor("reset", (requests) => requests.length === 1);
    const reset = await request("/_control/reset/reset", { method: "POST" });
    expect(await reset.json()).toEqual({ held: 1 });
    expect((await pending).status).toBe(503);
    expect(await captured("reset")).toEqual([]);
  });

  it("keeps channels apart", async () => {
    const pending = request("/controlled/left/x");
    await waitFor("left", (requests) => requests.length === 1);
    expect((await release("right", { timeout: 50 })).status).toBe(408);
    await release("left", { body: "left" });
    expect(await (await pending).text()).toBe("left");
  });

  it.each([
    ["not JSON", "{"],
    ["an unknown field", JSON.stringify({ colour: "red" })],
    ["a status out of range", JSON.stringify({ status: 99 })],
    ["serve with a body", JSON.stringify({ serve: "/", body: "x" })],
    ["drop with a status", JSON.stringify({ drop: true, status: 200 })],
  ])("refuses a release with %s", async (_case, body) => {
    const response = await request("/_control/bad/release", { method: "POST", body });
    expect(response.status).toBe(400);
  });
});
