// The reference server: a small site that speaks docs/protocol.md, for the Playwright tests and
// for trying Tessera by hand. Test tooling, not a product: Node's `http` module only. The routes
// and the controller's interface are listed in test/server/README.md.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CHANNEL, Controller } from "./controller.ts";
import { answer, documentResponse, redirect, versionRefusal } from "./answer.ts";
import { escapeHtml, renderPage } from "./html.ts";
import type { Vars } from "./html.ts";
import { header, isTessera, json, send, text } from "./http.ts";
import type { FixtureRequest, FixtureResponse, Secrets, ServerState } from "./http.ts";
import { serveNavigation } from "./navigation.ts";
import { serveStream } from "./stream.ts";

const root = import.meta.dirname;
const repo = resolve(root, "../..");
const MAX_BODY = 1024 * 1024;

const assets: Readonly<Record<string, string>> = {
  "/assets/fixture.css": resolve(root, "assets/fixture.css"),
  // Built by test/browser/global-setup.ts.
  "/assets/harness.js": resolve(repo, "node_modules/.cache/tessera-harness/harness.js"),
  ...Object.fromEntries(
    ["tessera.js", "tessera.min.js", "tessera.iife.js"].flatMap((file) => [
      [`/assets/${file}`, resolve(repo, "dist", file)],
      [`/assets/${file}.map`, resolve(repo, "dist", `${file}.map`)],
    ]),
  ),
};

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

// --- Routes --------------------------------------------------------------------------------

function formVars(name: string, error: string | undefined): Vars {
  return {
    name,
    "error-summary":
      error === undefined
        ? ""
        : `<div id="name-error" data-error-summary tabindex="-1" role="alert">${escapeHtml(error)}</div>`,
    "name-invalid": error === undefined ? "" : ' aria-invalid="true" aria-describedby="name-error"',
  };
}

/** `POST /form`: 419 on a bad CSRF token, 422 for an empty name, 409 for `taken`, else 303. */
function submitForm(request: FixtureRequest, secrets: Secrets): FixtureResponse {
  const type = header(request.headers, "content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) {
    return text(415, "The form posts application/x-www-form-urlencoded.");
  }
  const fields = new URLSearchParams(request.body);
  const token = header(request.headers, "x-csrf-token");
  if (token !== secrets.csrf && fields.get("_token") !== secrets.csrf) {
    return documentResponse(renderPage("expired", { csrf: secrets.csrf }, secrets.key), 419);
  }
  const name = (fields.get("name") ?? "").trim();
  const error = name === "" ? "Name is required." : name === "taken" ? "That name is taken." : undefined;
  if (error !== undefined) {
    const rendered = renderPage("form", { csrf: secrets.csrf, ...formVars(name, error) }, secrets.key);
    return answer(request, rendered, name === "" ? 422 : 409, secrets);
  }
  return redirect(request, `/form/done?name=${encodeURIComponent(name)}`);
}

async function asset(path: string): Promise<FixtureResponse> {
  const file = assets[path];
  if (file === undefined) return text(404, `No asset at ${path}.`);
  try {
    const body = await readFile(file);
    return { status: 200, headers: { "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream" }, body };
  } catch {
    return text(404, `${path} is not built: run npm run build, or npm run test:browser for the harness.`);
  }
}

const simplePages: Readonly<Record<string, string>> = {
  "/": "index",
  "/about": "about",
  "/attributes": "attributes",
  "/bare": "bare",
  "/coordination": "coordination",
  "/focus-server": "focus-server",
  "/forms": "forms",
  "/headless": "headless",
  "/links": "links",
  "/lazy": "lazy",
  "/lazy/content": "lazy-content",
  "/long": "long",
  "/persist-a": "persist-a",
  "/persist-b": "persist-b",
  "/persist-c": "persist-c",
  "/scripted": "scripted",
  "/patch": "patch",
  "/transport": "transport",
};

/** Answers every route that is not a stream, the controller or its control interface. */
async function respond(request: FixtureRequest, secrets: ServerState): Promise<FixtureResponse> {
  const { method, url } = request;
  const path = url.pathname;
  const page = (name: string, vars: Vars = {}, status = 200): FixtureResponse =>
    answer(request, renderPage(name, { csrf: secrets.csrf, ...vars }, secrets.key), status, secrets);

  if (path === "/expired") {
    return documentResponse(renderPage("expired", { csrf: secrets.csrf }, secrets.key), 419);
  }
  if (path === "/form" && method === "POST") return submitForm(request, secrets);
  if (path.startsWith("/assets/") && method === "GET") return asset(path);

  const known =
    path in simplePages || ["/form", "/form/done", "/events", "/slow", "/redeploy", "/away", "/stray", "/counter/log", "/events/log", "/poll", "/poll/tick"].includes(path);
  if (known && method !== "GET") return { ...text(405, `${path} answers GET.`), headers: { Allow: path === "/form" ? "GET, POST" : "GET" } };

  const simple = simplePages[path];
  if (simple !== undefined) return page(simple);
  if (path === "/form") return page("form", formVars("", undefined));
  if (path === "/form/done") return page("form-done", { name: url.searchParams.get("name") ?? "" });
  if (path === "/events") return page("events", { stream: `/events/stream${url.search}`, items: "", latest: "none" });
  if (path === "/redeploy") return page("redeploy", { build: "2" });
  if (path === "/events/log") {
    const key = url.searchParams.get("key") ?? "";
    return json(200, { connections: secrets.streams.filter((connection) => connection.key === key) });
  }
  if (path === "/poll" || path === "/poll/tick") {
    // Each GET of /poll/tick is one tick for its key; /poll shows the count without adding one.
    const key = url.searchParams.get("key") ?? "";
    const ticks = (secrets.ticks.get(key) ?? 0) + (path === "/poll/tick" ? 1 : 0);
    secrets.ticks.set(key, ticks);
    return page("poll", { key, ticks: String(ticks) });
  }
  if (path === "/counter/log") {
    const key = url.searchParams.get("key") ?? "";
    return json(200, {
      count: secrets.counts.get(key) ?? 0,
      arrivals: secrets.arrivals.filter((arrival) => new URL(arrival.path, url).searchParams.get("key") === key),
    });
  }
  if (path === "/counter") {
    const key = url.searchParams.get("key") ?? "";
    if (method === "POST") {
      // The write: applied here once per write id, since a repeat is answered from the store.
      secrets.counts.set(key, (secrets.counts.get(key) ?? 0) + 1);
      const answer = isTessera(request)
        ? page("counter", { count: String(secrets.counts.get(key)) })
        : redirect(request, `/counter?key=${encodeURIComponent(key)}`);
      return url.searchParams.get("drop") === "once" ? { ...answer, drop: true } : answer;
    }
    return page("counter", { count: String(secrets.counts.get(key) ?? 0) });
  }
  if (path === "/away") {
    // A page Tessera cannot update in place: a Tessera request is told to load it in full.
    return isTessera(request)
      ? { status: 200, headers: { "Tessera-Full-Visit": "/about", "Tessera-Protocol": "0" }, body: "" }
      : { status: 302, headers: { Location: "/about" }, body: "" };
  }
  if (path === "/stray" && isTessera(request)) {
    // A fragment for a region no page has: Tessera falls back to a full load.
    return {
      status: 200,
      headers: { "Content-Type": "text/vnd.tessera+html; charset=utf-8", "Tessera-Protocol": "0" },
      body: '<template data-target="nowhere"><div data-region="nowhere"></div></template>\n',
    };
  }
  if (path === "/stray") return page("stray");
  if (path === "/slow") {
    const raw = url.searchParams.get("ms") ?? "1000";
    if (!/^\d+$/.test(raw) || Number(raw) > 10_000) return text(400, "ms must be an integer from 0 to 10000");
    await sleep(Number(raw), undefined, { ref: false });
    return page("slow", { ms: raw });
  }
  return page("not-found", {}, 404);
}

// --- The server ----------------------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Protocol 5.8: how long a write id is remembered. */
const WRITE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Protocol 5.8, as a server should do it: a Tessera write with an id seen within the window gets
 * the first answer again and is never applied twice. This server has no sessions, so its store is
 * global. Returns undefined when the request is not such a write.
 */
async function deduplicated(request: FixtureRequest, state: ServerState): Promise<FixtureResponse | undefined> {
  const id = header(request.headers, "tessera-write-id");
  if (id === undefined || !isTessera(request) || request.method === "GET") return undefined;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return text(400, "Tessera-Write-Id is 1 to 64 of A-Z a-z 0-9 -.");
  const now = Date.now();
  for (const [seen, { at }] of state.writes) if (now - at > WRITE_WINDOW_MS) state.writes.delete(seen);
  const path = `${request.url.pathname}${request.url.search}`;
  const first = state.writes.get(id);
  state.arrivals.push({ path, id, repeat: first !== undefined });
  if (first) return first.response;
  const response = await respond(request, state);
  state.writes.set(id, { response: { status: response.status, headers: response.headers, body: response.body }, at: now });
  return response;
}

async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  secrets: ServerState,
  controller: Controller,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const body = await readBody(req);
  if (body === undefined) {
    send(res, text(413, "The body is over 1 MB."));
    return;
  }
  const request: FixtureRequest = { method: req.method ?? "GET", url, headers: req.headers, body };

  const control = /^\/_control\/([^/]+)\/([a-z]+)$/.exec(url.pathname);
  if (control) {
    const [, channel = "", action = ""] = control;
    if (!CHANNEL.test(channel)) send(res, text(400, "A channel is 1 to 64 of A-Z a-z 0-9 _ -."));
    else await controller.api(channel, action, request, res);
    return;
  }

  const refusal = versionRefusal(request);
  if (refusal) {
    send(res, refusal);
    return;
  }

  const controlled = /^\/controlled\/([^/]+)(\/|$)/.exec(url.pathname);
  if (controlled) {
    const channel = controlled[1] ?? "";
    if (!CHANNEL.test(channel)) send(res, text(400, "A channel is 1 to 64 of A-Z a-z 0-9 _ -."));
    else controller.capture(channel, request, res);
    return;
  }

  if (url.pathname === "/events/stream") {
    await serveStream(request, res, secrets);
    return;
  }
  if (url.pathname === "/navigation" || url.pathname.startsWith("/navigation/")) {
    await serveNavigation(request, res, secrets);
    return;
  }
  const response = (await deduplicated(request, secrets)) ?? (await respond(request, secrets));
  send(res, url.searchParams.get("csp") === "1" ? { ...response, headers: { ...response.headers, "Content-Security-Policy": STRICT_POLICY } } : response);
}

/**
 * `?csp=1` on any route: a policy that refuses 'unsafe-eval' (and inline scripts), for the no-eval
 * engine's browser test (#22). Same-origin scripts, the harness and the build, still load.
 */
const STRICT_POLICY = "script-src 'self'";

export interface RunningServer {
  readonly url: string;
  readonly server: Server;
  close(): Promise<void>;
}

/** Starts the server; port 0 (the default) takes a free port. */
export interface ServerOptions {
  port?: number;
  host?: string;
  /**
   * Closes every connection after its response. Browsers resend a request on their own when a
   * reused keep-alive connection closes before any answer; with no connection to reuse, a
   * connection the controller drops is always a fresh one, so a test counts what Tessera sent.
   */
  closeConnections?: boolean;
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const secrets: ServerState = {
    key: randomBytes(32).toString("hex"),
    csrf: randomBytes(16).toString("hex"),
    counts: new Map(),
    arrivals: [],
    streams: [],
    ticks: new Map(),
    navigation: new Map(),
    writes: new Map(),
  };
  const controller = new Controller((request) => respond(request, secrets));
  const server = createServer((req, res) => {
    if (options.closeConnections) res.shouldKeepAlive = false;
    dispatch(req, res, secrets, controller).catch((error: unknown) => {
      console.error(error);
      if (res.headersSent) res.destroy();
      else send(res, text(500, `The server failed: ${String(error)}`));
    });
  });
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? 0, host, done);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${host}:${port}/`,
    server,
    close: async () => {
      controller.dispose();
      const closed = new Promise<void>((done) => server.close(() => {
        done();
      }));
      server.closeAllConnections();
      await closed;
    },
  };
}
