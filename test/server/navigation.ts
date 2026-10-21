// The navigation matrix's site, `/navigation/…` (ticket #18): jqstar's navigation-decision fixture
// (`test/fixtures/navigation-decision/server.mjs` and `html.mjs` at f17952b), with Tessera's
// markup and protocol in place of Turbo's and htmx's. Each browser context has its own session
// (cookie `tessera-nav-session`) holding the facts the scenarios check, read at
// `/navigation/metrics`. Every answer is a complete document for a plain request; a Tessera
// request naming targets gets fragments, as any Tessera server would answer it, and a redirect
// answering a Tessera request travels as Tessera-Location while the metrics keep the 302 or 303.
import type { ServerResponse } from "node:http";
import { answer, redirect } from "./answer.ts";
import { scan } from "./html.ts";
import { header, isTessera, send, text, VARY } from "./http.ts";
import type { FixtureRequest, FixtureResponse, ServerState } from "./http.ts";

const BASE = "/navigation";

const ROUTES = new Set([
  "start",
  "guide",
  "long",
  "redirect",
  "search",
  "edit",
  "saved",
  "preview",
  "region",
  "region-mismatch",
  "not-found",
  "server-error",
  "download",
  "text",
  "head",
  "private",
  "slow",
  "fast",
  "canceled",
  "no-content",
  "network-error",
]);

/** What the server saw of one request, as the scenarios check it. */
export interface NavigationRequest {
  readonly sequence: number;
  readonly route: string;
  readonly method: "GET" | "POST";
  /** Whether Tessera sent it (it carried `Tessera-Request`), or the browser did. */
  readonly tessera: boolean;
  /** The logical status: a redirect is 302 or 303 even when it travelled as Tessera-Location. */
  status: number | null;
  aborted: boolean;
  multipart: boolean;
  fileMatched: boolean;
  submitterMatched: boolean;
  disabledExcluded: boolean;
  revisionMatched: boolean;
}

export interface NavigationSession {
  revision: number;
  reads: number;
  writes: number;
  sequence: number;
  readonly requests: NavigationRequest[];
}

function cookie(request: FixtureRequest, name: string): string | undefined {
  for (const pair of (header(request.headers, "cookie") ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return undefined;
}

function link(id: string, target: string, label: string, attributes = ""): string {
  return `<a id="${id}" href="${BASE}/${target}"${attributes === "" ? "" : ` ${attributes}`}>${label}</a>`;
}

/**
 * One route's complete document. Regions: `main` and, inside it, `activity`; `#permanent` is a
 * region too, so its signals have a scope of their own, and carries `data-permanent`. The header's
 * links are outside every region, so their visits target `page`.
 */
export function navigationDocument(route: string, options: { revision?: number; error?: boolean } = {}): string {
  const revision = options.revision ?? 1;
  const error = options.error ?? false;
  const privatePage = route === "private";
  const activity = route === "region" ? "Updated activity" : "Recent activity";
  const region =
    route === "region-mismatch"
      ? '<section id="region-fallback"><h2>Activity document recovery</h2><p>The server intentionally returned a complete document without a matching enhanced region.</p></section>'
      : `<section id="activity" data-region="activity"><h2 id="activity-title">${activity}</h2><p>Server-authored activity</p>${link("region-link", "region", "Refresh activity", 'data-target="activity"')} ${link("region-tab", "region", "Show updated activity here", 'data-target="activity" data-push="off"')} ${link("region-mismatch", "region-mismatch", "Open activity recovery", 'data-target="activity"')}</section>`;
  // The head route adds tracked assets, so Tessera loads it in full and its script runs.
  const headAssets =
    route === "head"
      ? `<link rel="stylesheet" href="${BASE}/assets/head.css" data-track><script src="${BASE}/assets/head-proof.js" defer data-track></script>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tessera navigation ${route}</title>
  <meta name="navigation-page" content="${route}">
  <meta name="tessera-layout" content="navigation">
  <link rel="stylesheet" href="${BASE}/assets/style.css" data-track>
  ${headAssets}
  <script src="${BASE}/assets/fixture.js"></script>
</head>
<body>
  <a href="#main">Skip to content</a>
  <header><p>Tessera project documentation</p>
    <nav aria-label="Documents">
      ${link("home", "start", "Overview")}
      ${link("guide", "guide", "Guide")}
      ${link("query", "guide?view=details", "Detailed guide")}
      ${link("remote-anchor", "long#destination", "Long guide anchor")}
      ${link("redirect", "redirect", "Redirected guide")}
      ${link("new-tab", "guide", "Guide in a new tab", 'target="_blank" rel="noopener"')}
    </nav>
  </header>
  <section id="permanent" data-region="preferences" data-permanent data-signals="{preference: 0}" aria-label="Local preferences">
    <label for="preference">Local preference</label><input id="preference" value="server-default">
  </section>
  <main id="main" data-region="main" data-route="${route}" tabindex="-1">
    <h1>${error ? "Please review the server response" : `Project ${route}`}</h1>
    ${error ? '<p id="error-summary" role="alert">The server could not accept this operation. Review the marked field or return to the overview.</p>' : ""}
    <p id="revision" data-revision="${String(revision)}">Current revision ${String(revision)}</p>
    <p id="privacy-marker">${privatePage ? "private-fixture-marker" : "public-fixture-marker"}</p>
    <p id="enhanced" data-text="'enhanced'"></p>
    <section id="nested" aria-label="Guide content">
      <details id="disclosure">
        <summary>Advanced settings</summary>
        <div>The server owns routes, validation and saved revisions.</div>
      </details>
      <a id="local-anchor" href="#destination">On-page destination</a>
      <form id="search" method="get" action="${BASE}/search">
        <label for="query-value">Search documentation</label>
        <input id="query-value" name="query" value="navigation" required>
        <input name="ignored" value="disabled-sentinel" aria-label="Unavailable search option" disabled>
        <button id="search-submit" name="submitter" value="search">Search</button>
      </form>
      <form id="editor" method="post" action="${BASE}/edit" enctype="multipart/form-data">
        <input name="revision" type="hidden" value="${String(revision)}">
        <label for="title">Project title</label>
        <input id="title" name="title" value="Project" required${error ? ' autofocus aria-invalid="true" aria-describedby="error-summary"' : ""}>
        <label for="attachment">Attachment</label><input id="attachment" name="attachment" type="file">
        <input name="ignored" value="disabled-sentinel" aria-label="Unavailable editor option" disabled>
        <button id="save" name="intent" value="save">Save</button>
        <button id="preview" name="intent" value="preview">Preview</button>
        <button id="lose-response" name="intent" value="lose">Save with lost response</button>
        <button id="moved" name="intent" value="moved">Save to a moved address</button>
      </form>
      <output id="outcome" aria-live="polite">${route}</output>
    </section>
    ${region}
    <nav aria-label="Response examples">
      ${link("not-found", "not-found", "Missing document")}
      ${link("server-error", "server-error", "Server error")}
      ${link("download", "download", "Download example", 'download="example.txt"')}
      ${link("non-html", "text", "Plain text document")}
      ${link("head-change", "head", "Changed document assets")}
      ${link("private", "private", "Private document")}
      ${link("slow", "slow", "Slow document")}
      ${link("fast", "fast", "Fast document")}
      ${link("canceled", "canceled", "Cancel this intent")}
      ${link("no-content", "no-content", "No content")}
      ${link("network-error", "network-error", "Unavailable connection")}
    </nav>
    <div class="long-content" aria-hidden="true"></div>
    <h2 id="destination" tabindex="-1">Document destination</h2>
    <p>The destination is part of the server document.</p>
  </main>
  <footer>Native HTML remains usable without JavaScript.</footer>
  <script src="/assets/harness.js"></script>
</body>
</html>`;
}

const STYLE = `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 1rem auto; max-width: 64rem; padding: 0 1rem; overflow-wrap: anywhere; }
header { position: sticky; top: 0; z-index: 1; background: Canvas; }
#destination { scroll-margin-top: 8rem; }
nav { display: flex; flex-wrap: wrap; gap: 1rem; margin-block: 1rem; }
form { display: grid; gap: 0.5rem; margin-block: 1rem; max-width: 32rem; }
input, button { box-sizing: border-box; font: inherit; max-width: 100%; min-width: 0; }
:focus-visible { outline: 3px solid currentColor; outline-offset: 3px; }
.long-content { height: 1200px; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; animation: none; transition: none; } }
`;

// A page script of the application's: it cancels one link's click before Tessera sees it.
const FIXTURE_SCRIPT = `document.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("#canceled")) event.preventDefault();
}, true);
`;

const ASSETS: Readonly<Record<string, { type: string; body: string }>> = {
  "style.css": { type: "text/css; charset=utf-8", body: STYLE },
  "head.css": { type: "text/css; charset=utf-8", body: "#main { border-top: 7px solid rgb(0, 96, 160); }\n" },
  "head-proof.js": {
    type: "text/javascript; charset=utf-8",
    body: "globalThis.__navigationHeadProof = (globalThis.__navigationHeadProof ?? 0) + 1;\n",
  },
  "fixture.js": { type: "text/javascript; charset=utf-8", body: FIXTURE_SCRIPT },
};

function finish(res: ServerResponse, response: FixtureResponse, cacheControl = "no-store"): void {
  send(res, { ...response, headers: { "Cache-Control": cacheControl, ...response.headers } });
}

/** Answers `/navigation/…`, writing to `res` itself for the routes that need the socket. */
export async function serveNavigation(request: FixtureRequest, res: ServerResponse, state: ServerState): Promise<void> {
  const { url } = request;
  const id = cookie(request, "tessera-nav-session") ?? "default";
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) {
    finish(res, text(400, "tessera-nav-session is 1 to 80 of A-Z a-z 0-9 -."));
    return;
  }
  let session = state.navigation.get(id);
  if (!session) {
    session = { revision: 1, reads: 0, writes: 0, sequence: 0, requests: [] };
    state.navigation.set(id, session);
  }

  if (url.pathname === `${BASE}/metrics`) {
    finish(res, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: `${JSON.stringify(session)}\n` });
    return;
  }
  if (url.pathname.startsWith(`${BASE}/assets/`)) {
    const file = ASSETS[url.pathname.slice(`${BASE}/assets/`.length)];
    finish(res, file ? { status: 200, headers: { "Content-Type": file.type }, body: file.body } : text(404, "No such fixture asset."));
    return;
  }

  const route = url.pathname.replace(/^\/navigation\/?/, "") || "start";
  if (!ROUTES.has(route)) {
    finish(res, text(404, "Unknown fixture route."));
    return;
  }
  const method = request.method === "POST" ? "POST" : "GET";
  const record: NavigationRequest = {
    sequence: ++session.sequence,
    route,
    method,
    tessera: isTessera(request),
    status: null,
    aborted: false,
    multipart: false,
    fileMatched: false,
    submitterMatched: false,
    disabledExcluded: true,
    revisionMatched: true,
  };
  session.requests.push(record);
  if (method === "GET") session.reads++;
  res.once("close", () => {
    if (!res.writableFinished) record.aborted = true;
  });

  const current = session;
  const document = (status: number, target = route, error = false): void => {
    record.status = status;
    const html = navigationDocument(target, { revision: current.revision, error });
    const response = answer(request, { html, layout: "navigation", identities: scan(html) }, status, state);
    finish(res, response, target === "private" ? "private, no-store" : "no-store");
  };
  const redirected = (status: 302 | 303, location: string): void => {
    record.status = status;
    finish(res, isTessera(request) ? redirect(request, location) : { status, headers: { Location: location }, body: "" });
  };

  if (route === "network-error") {
    res.socket?.destroy();
    return;
  }
  if (route === "slow" || route === "fast") {
    await new Promise((resolve) => setTimeout(resolve, route === "slow" ? 900 : 30));
    if (!res.destroyed) document(200);
    return;
  }
  if (route === "no-content") {
    record.status = 204;
    finish(res, { status: 204, headers: {}, body: "" });
    return;
  }
  if (route === "redirect") {
    redirected(302, `${BASE}/guide`);
    return;
  }
  if (route === "download") {
    record.status = 200;
    finish(res, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="example.txt"' },
      body: "navigation download",
    });
    return;
  }
  if (route === "text") {
    record.status = 200;
    finish(res, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Canonical plain text" });
    return;
  }
  if (route === "search") {
    record.submitterMatched = url.searchParams.get("submitter") === "search";
    record.disabledExcluded = !url.searchParams.has("ignored");
  }
  if (route === "edit" && method === "POST") {
    const type = header(request.headers, "content-type") ?? "";
    const form = await new Request(`http://fixture.invalid${BASE}/edit`, {
      method: "POST",
      headers: { "Content-Type": type },
      body: request.body,
    }).formData();
    const intent = form.get("intent");
    const attachment = form.get("attachment");
    record.multipart = type.startsWith("multipart/form-data;");
    record.fileMatched =
      attachment instanceof File && attachment.name === "navigation-proof.txt" && (await attachment.text()) === "navigation-file-proof";
    record.submitterMatched = typeof intent === "string" && ["save", "preview", "lose", "moved"].includes(intent);
    record.disabledExcluded = !form.has("ignored");
    record.revisionMatched = Number(form.get("revision")) === session.revision;
    if (!record.revisionMatched) {
      document(409, "edit", true);
      return;
    }
    if (form.get("title") === "invalid") {
      document(422, "edit", true);
      return;
    }
    if (intent === "moved") {
      // Tessera's own scenario TES-01: a 307 asks for the same request again, body and all, so the
      // protocol never converts it (5.4) and Tessera never follows it. Nothing is saved here.
      record.status = 307;
      finish(res, { status: 307, headers: { Location: `${BASE}/saved` }, body: "" });
      return;
    }
    if (intent !== "preview") {
      session.writes++;
      session.revision++;
    }
    if (intent === "lose") {
      // Headers first, then the connection goes: the write was received, and a browser does not
      // resend a request it has an answer for.
      record.status = 200;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Length": "4096", Vary: VARY });
      res.flushHeaders();
      setTimeout(() => res.destroy(), 30);
      return;
    }
    redirected(303, intent === "preview" ? `${BASE}/preview` : `${BASE}/saved`);
    return;
  }
  document(route === "not-found" ? 404 : route === "server-error" ? 500 : 200, route, ["not-found", "server-error"].includes(route));
}
