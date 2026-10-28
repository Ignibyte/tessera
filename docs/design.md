# Tessera: design

Tessera is a browser runtime for server-rendered sites. The server sends HTML; Tessera morphs it
into the page one region or one component at a time, over normal responses or Server-Sent
Events. Local reactive state lives in HTML attributes, in Datastar's vocabulary. Two frameworks
use it: AIC (PHP) and Rustal (Rust). Each speaks the protocol in `docs/protocol.md` through its
own thin server layer, so the browser side has no framework names in it.

Tessera is built from parts of jqstar (`/srv/stacks/jqstar`, `Ignibyte/jqstar` at `f17952b`,
MIT). jqstar itself is not used and does not change. A digest of jqstar, with `file:line`
citations, is `docs/research/jqstar-digest.md`; the Livewire digest beside it is the source of
the "copy from Livewire" items.

## The model

The server renders a **page → regions → components** structure. Each level has an identity in
the markup:

- **Regions** are elements named by the layout: `<div data-region="content">`. One attribute,
  one name grammar (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`), unique on the page. Never a CSS selector.
- **Components** are elements too: one root element carrying `data-t-c="KEY"`, and its signed
  props in `data-t-props`. A component that renders siblings is wrapped by its server, and one
  inside `<h2>` or `<p>` is a `<span>`. Keys are unique among siblings; the full identity is the
  path from the region. A component may carry `data-t-anchor="NAME"` so a link can name it as
  `@NAME` without spelling its path, and every request entry for it carries `@NAME` so the server
  can find its props without the path either. Protocol 0 marked components with comment pairs;
  protocol 1 (ticket #33) moved them onto elements, and protocol 2 (ticket #34) sends the anchor.
- **Control-flow blocks** have no markers. A conditional that appears may shift its siblings in a
  morph, so a server gives fields and other state-bearing elements a stable `id`, which Idiomorph
  matches.

An update targets the page, a region or a component, and one response can carry any mix. The
server can leave out what did not change. A component rendered alone needs its inputs back; they
travel as signed props on the component (the server's business: Tessera only carries the
attribute back). Props are inputs, not state: there is no snapshot and no mass assignment.

## Requests and responses

| Request | How it is marked | Response |
|---|---|---|
| Direct visit, or JavaScript off | Plain GET | A full HTML document |
| Enhanced navigation | GET plus a request header naming the kind of update | The regions that change, as HTML fragments keyed by identity |
| Form post or action | POST, with the CSRF token in a header | The affected regions; a 422 renders the form region with its errors in place; a successful write answers 303 to a GET |
| Component refresh, poll, lazy load | GET naming the target | That component or region |
| Stream | `text/event-stream` | SSE events, each carrying fragments for any regions or components, up to the whole page |

A response that depends on Tessera's request headers sends `Vary` on them, so a cache never
serves a fragment as a page. A missing region on a read falls back to a full visit; a write never
replays. Head changes follow jqstar 0025: a changed tracked asset forces a full load, and fetched
scripts never run.

## What comes from jqstar

**Keep** (the hard parts, already solved):
- the render transaction and resource ledger (`src/kernel.ts`): deepest-first teardown, preserved
  roots, the enhancement barrier, exact-once cleanup;
- Idiomorph morphing with preservation (`src/patch.ts`);
- the Proxy reactivity, the expression engine, the directive registry, the SSE parser and the
  body lease.

**Fix** (defects in jqstar today):
- POST is retried on network failure (`src/fetch.ts:262-275`);
- redirects are followed automatically (`:402-408`);
- the submit button is left out of form data;
- 4xx HTML is never rendered (only `response.ok` reaches a profile);
- supersession is per URL instead of per region.

**Build** (specified in jqstar's declined tickets, never implemented; the tickets are in
`/srv/stacks/jqstar/docs/tickets/`):
- visit interception (0024);
- forms without replay (0027);
- region targeting, commit and the reject/queue/supersede table for overlapping targets (0028
  AC-08), with region generations so a late response cannot overwrite a newer one;
- history, focus and scroll ordering (0026);
- durable SSE with reconnect from `Last-Event-ID`;
- explicit signal scopes;
- lazy regions;
- the head and asset policy (0025).

**Copy from Livewire:**
- the 5 ms request buffer, per-scope queuing, polls yielding to actions;
- the polling heuristics (shared clocks, background throttling, pause when hidden);
- prefetch on mousedown, a small back cache, persisted nodes, a delayed progress bar;
- `data-loading` on the initiating element;
- an interceptor lifecycle as the extension seam;
- the 419 "page expired" prompt;
- morph rather than replace `<body>` on navigation.

**Drop:** jQuery and `$.fn.star`, the Turbo and htmx bridges, the UI catalog, persistence, the
inspector, the plugin host's semver graph, stores (until a named shared scope needs them).

## Signals

- Datastar's attribute vocabulary: `data-signals`, `data-computed`, `data-on`, `data-show`,
  `data-text`, `data-bind`, `data-class`, `data-attr`, `data-style`, `data-effect`, `data-init`,
  `data-ignore`, `data-ignore-morph`. `$name` is always a signal; `$` alone means nothing.
- Scopes are explicit: component, region or document. Two components that both declare `$open`
  do not share it. This ends the global-namespace collisions old AIC hit with Datastar (AIC
  #423/#436).
- Signals never hold application data: anything that changes what the server renders travels in
  the request, the URL, the session or the database.

## Size

About 5,000 to 7,700 lines of TypeScript plus Idiomorph (estimates from the digest), against
Livewire's roughly 86 KB gzipped with Alpine. A size budget in the check holds it.

## Packaging

The repo owns the TypeScript toolchain and ships a built, versioned file on its GitHub releases
(`tessera.js`, `tessera.min.js`, a source map and a SHA-256 sum). AIC and Rustal each pin a
version and copy the file into their public assets at build time. No npm publish.

## Later

- **Change detection.** The browser sends a manifest of region and component ids with
  fingerprints; the server omits unchanged fragments. Only when measurements show payloads
  matter: morphing already makes unchanged HTML a no-op in the DOM.
- **Feeds.** Append and prepend modes for a region.
- **WebSockets.** Research is under way on the AIC side (AIC #52); SSE plus requests covers
  Tessera's first release.
