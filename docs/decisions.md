# Decisions

Each entry says who decided and when. **Provisional** means the agent working the tickets chose a
default so work could go on; Chad confirms or changes it, and until then the code follows it.

## Decided

- **The name is Tessera**, a mosaic tile, since the page is built from regions swapped one at a
  time (Chad, 2026-10-20).
- **One runtime for AIC and Rustal** (Chad, 2026-10-20). The browser side stays generic: no AIC
  or Rustal names in it. The server side is a documented HTML-and-SSE protocol; each framework
  writes its own thin server layer. There is no server SDK in this repo.
- **Built from jqstar's parts; jqstar is not used and does not change** (Chad, 2026-10-19).
- **No React or other client framework in core** (Chad, 2026-10-19): it cannot morph server HTML
  into a tree it owns.
- **Livewire's model rebuilt around regions, without component state** (Chad, 2026-10-19). The
  server can send anything from one component to the whole page, over a normal response or SSE.
- **Releases are built files on GitHub releases**, pinned by version (2026-10-20). No npm
  package, no composer package.
- **Regions are elements, components and control-flow blocks are comment pairs** (AIC #37,
  2026-10-20).
- **The repo is private**, `Ignibyte/tessera` (2026-10-20, the default recommended to Chad; he can
  make it public later).
- **Tessera keeps tests** (2026-10-20): a browser runtime's correctness is behaviour across
  engines that static analysis cannot see. Unit tests with Vitest, property tests with fast-check
  for parsers, and Playwright browser tests, with jqstar's navigation matrix (28 scenarios with
  no-JS baselines) as the acceptance suite. AIC's no-tests rule does not apply here.
- **Build output names** (**Provisional**, ticket #1, 2026-10-20): `dist/tessera.js` is the ES
  module, `dist/tessera.min.js` the same minified, and `dist/tessera.iife.js` a minified IIFE
  that sets the global `Tessera`, for a page loading it with a plain `<script>`. Each has a
  source map, and each bundles Idiomorph. The size budget measures `tessera.min.js`. Ticket #19
  ships `tessera.js` and `tessera.min.js`; whether a release carries the IIFE file too is
  Chad's call.
- **Vite 7.3.7, not jqstar's 7.3.6** (ticket #1, 2026-10-20): 7.3.6 has a high-severity
  advisory (launch-editor, GHSA-r825-w8mm-5pxw) fixed in the 7.3.7 patch. terser 5.51.2 is added
  as jqstar has it, because Vite leaves whitespace in a library's ES output when esbuild
  minifies it.
- **SSE event names are Tessera's own** (**Provisional**, ticket #2, 2026-10-20):
  `tessera-patch-elements`, `tessera-patch-signals` and `tessera-close`, with Datastar's
  `data: KEY VALUE` line shape (`target`, `mode`, `elements`; `scope`, `onlyIfMissing`,
  `signals`). Tessera targets regions and component paths, never CSS selectors, so Datastar's names
  would promise a compatibility that is not there; keeping the line shape keeps the server encoders
  and jqstar's parser simple.
- **Protocol version 0 and its headers** (**Provisional**, ticket #2, 2026-10-20): requests carry
  `Tessera-Request` (the kind: `visit`, `submit`, `action`, `refresh`, `stream`),
  `Tessera-Protocol: 0`, `Tessera-Targets` (each component entry carries its props token),
  `Tessera-Layout` and, on actions only, `Tessera-Signals`. A server that does not speak the
  version answers `400` with the versions it speaks, before any side effect.
- **Identity spelling** (**Provisional**, ticket #2, 2026-10-20): components are
  `<!--t:c KEY-->` or `<!--t:c KEY PROPS-->` ... `<!--/t:c-->`, blocks `<!--t:b-->` ...
  `<!--/t:b-->`. Blocks have no key, are always rendered (empty ones included) and pair by
  position, so a conditional that appears does not shift its siblings. `page` is a reserved target
  name for the whole document, and the root of paths for components outside any region.
- **Fragment responses are `text/vnd.tessera+html`** (**Provisional**, ticket #2, 2026-10-20): a
  body of top-level `<template data-target data-mode>` elements, JSON signal patches in
  `<script type="application/json" data-scope>`, an optional `<title>`, CSRF meta and copies of
  the tracked assets. `<template>` parses any markup (table rows, list items) inertly. A
  whole-page update is a plain `text/html` document, so a server that ignores Tessera still works.
  Fragment responses keep HTML's compression and readability; streams use SSE.
- **Redirects for a Tessera request travel as `Tessera-Location` on a `200`** (**Provisional**,
  ticket #2, 2026-10-20). `fetch` with `redirect: "manual"` hides the location of a `303`, and
  with `redirect: "follow"` it resends a write's body on a `307` or `308`. Writes go with
  `manual`, so any real redirect answering a write is reported as indeterminate and never
  followed; reads go with `follow`. The server layer converts `301`, `302` and `303` for Tessera
  requests in one middleware. `Tessera-Full-Visit` asks for a browser load instead.
- **`Tessera-Layout`** (**Provisional**, ticket #2, 2026-10-20): the page names its layout in a
  meta and every request sends it, so a server answers a visit to a page with another layout with
  the full document. Without it, a visit that sent only `content` would leave the old layout's
  other regions on screen.
- **Signals travel in a header, on actions only** (**Provisional**, ticket #2, 2026-10-20):
  `Tessera-Signals` holds one flat JSON object of the signals the element can see (innermost scope
  wins, `_`-prefixed left out), with every character above U+007E escaped so the header is ASCII,
  at most 4,096 bytes. A header leaves form bodies in the browser's own encoding and GET URLs
  clean, and the cap enforces "signals never hold application data". Visits, submissions,
  refreshes and streams send none, so they get what a plain browser gets. Ticket #8 may refine
  the shape.
- **Names of the attributes a server renders** (**Provisional**, ticket #2, 2026-10-20):
  `data-target`, `data-enhance="off"`, `data-track`, `data-error-summary`, `data-permanent`,
  `data-lazy`, `data-poll`, `data-stream`, `data-signals__region` and `data-signals__document`,
  plus the standard `autofocus` and `aria-invalid`, and the metas `tessera-layout`,
  `tessera-csrf-token` and `tessera-csrf-header` (default header `X-CSRF-Token`). The owning
  tickets build the behaviour; the names are fixed in `docs/protocol.md`.

## Open

- **The no-eval expression engine** (jqstar `src/csp/`, about 2,400 lines): ship it in 0.1.0 or
  later. Not in the first backlog.
