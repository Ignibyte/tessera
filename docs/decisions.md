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
- **Browser tests run in Chromium and Firefox; WebKit does not run on the dev box**
  (**Provisional**, ticket #3, 2026-10-20). Playwright 1.62.1's WebKit build (webkit-2336) is
  made for Ubuntu and needs libraries this Arch box lacks: ICU 74 (the box has 78),
  `libxml2.so.2`, flite, libjxl 0.8 and libbacktrace. Installing them means system packages,
  which the repo's rules forbid. `playwright.config.ts` defines the WebKit project only with
  `TESSERA_WEBKIT=1`, for a machine that has the libraries (Ubuntu, or a container). Safari
  coverage needs one before the navigation matrix (#18) counts as passing in all three engines.

- **Expressions see a closed scope** (**Provisional**, ticket #6, 2026-10-20): `$name` (a
  signal), `el`, `evt`, registered helpers and ECMAScript's built-ins (`Array`, `BigInt`,
  `Boolean`, `Date`, `Error`, `Infinity`, `Intl`, `JSON`, `Map`, `Math`, `NaN`, `Number`,
  `Object`, `Promise`, `RegExp`, `Set`, `String`, `Symbol`, the four URI functions, `isFinite`,
  `isNaN`, `parseFloat`, `parseInt`, `undefined`). Any other identifier, read, assigned or under
  `typeof`, is an error naming it, the expression and the element; nothing falls through to
  `window`, so browser APIs (`document`, `fetch`, `console`, timers, storage) are out of reach
  except through `el`. `$` alone is such an identifier, and only signals can be assigned.
  jqstar let unknown names reach the global object.
- **Actions anywhere in an expression** (**Provisional**, ticket #6, 2026-10-20): `@get`,
  `@post`, `@put`, `@patch` and `@delete`, each `@method(url, options?)`, may appear inside any
  expression or statement (`$saving = true; @post('/save')`). Any other `@name`, or one without
  parentheses, fails to compile. `@` inside string literals, template literals and comments is
  text; an action inside a template literal's `${…}` is not supported and fails to compile.
- **Directive attribute names** (**Provisional**, ticket #6, 2026-10-20):
  `data-NAME[:KEY][__MODIFIER[.ARG…]…]`. NAME is lowercase words joined by hyphens; KEY is
  lowercase letters, digits, `.`, `:`, `-` and single inner underscores, so `__` always starts a
  modifier; a modifier and each argument are lowercase letters, digits and hyphens. Each
  directive says whether it requires, forbids or allows a key, and which modifiers it accepts;
  anything else is an error at the attribute. Protocol attribute names (`region`, `target`,
  `enhance`, `track`, `permanent`, `lazy`, `poll`, `stream`, `error-summary`, `mode`, `scope`)
  cannot be directives.
- **The trusted engine may use `new Function`, in `src/expression.ts` only** (**Provisional**,
  driver decision, 2026-10-20, Chad to confirm; ticket #6). `docs/design.md` keeps jqstar's
  trusted engine, which compiles expressions with `new Function`, so lint's
  `@typescript-eslint/no-implied-eval` is turned off for that one file and that one rule in
  `eslint.config.js`; it stays on everywhere else, so no other file can compile code from
  strings. Pages whose Content-Security-Policy has no `'unsafe-eval'` cannot use the trusted
  engine; the no-eval engine is for them.
- **The no-eval expression engine ships before 0.1.0, as an option** (**Provisional**, driver
  decision, 2026-10-20, Chad to confirm): jqstar `src/csp/` ported behind the same
  `ExpressionEngine` seam, ticket #22, required before Release 0.1.0 (#19). The trusted engine
  stays the default.
- **Directive failures raise `tessera:error`** (**Provisional**, ticket #7, 2026-10-20): when a
  directive fails (a bad expression, a bad attribute name, a statement that rejects), the
  runtime dispatches a bubbling, cancelable `CustomEvent` named `tessera:error` on the element,
  with `detail` `{ error, element, attribute, expression }`; a listener that calls
  `preventDefault()` has handled it, otherwise the error goes to `console.error`. jqstar raised
  `jquery-star:error` through jQuery. The page goes on: one failing attribute does not stop the
  others.
- **What `data-bind` reads and writes** (**Provisional**, ticket #7, 2026-10-20): a signal not
  yet defined starts from the element's value; number and range inputs, and any input bound to
  a signal that already holds a number, give a number, or `null` when empty; a checkbox gives a
  boolean, or toggles its value in a signal holding an array; a radio gives its value when
  checked and leaves the signal alone otherwise; a multiple select gives an array. Paths are
  dotted, and each segment is camelCased (`data-bind:user.first-name` binds `$user.firstName`).
- **How scopes resolve, declare and live** (**Provisional**, ticket #8, 2026-10-20): an
  element's scopes are its enclosing components (each opening marker), its enclosing regions and
  the document, innermost first. `$name` reads the innermost scope that has the name; a write
  goes to that scope, or to the nearest one when none has it. `data-signals`, `data-computed`
  and `data-ref` declare into the nearest scope, so a name declared there shadows the same name
  further out; `data-signals__region` declares into the enclosing region (the document when
  there is none) and `data-signals__document` into the document. A scope is disposed when its
  owner leaves the document or a render removes it; a move within the page keeps it, and
  remounts only the directives whose chain changed. A component scope belongs to its opening
  comment and remembers its key: a changed key starts a new scope, and the patcher (#9) hands a
  scope to a replacement marker with the same key.
- **What the signals payload leaves out** (**Provisional**, ticket #8, 2026-10-20): `_` names
  at any depth, computed signals, and values JSON cannot carry (nodes, functions, `undefined`,
  symbols, bigints, non-finite numbers, class instances), omitted in objects and `null` in
  arrays; a cycle is an error. Written into `docs/protocol.md` section 4.4.
- **How the patcher morphs** (**Provisional**, ticket #9, 2026-10-20): a region morphs with
  Idiomorph's outer morph on the region element, so the element survives; a fragment for it
  must use the same tag (now in `docs/protocol.md` section 5.3). A component morphs by morphing
  its markers' parent against a copy of the parent's children in which only the component's run
  is new, since Idiomorph's public `morph` takes one node; the cost grows with the parent's
  size, not only the component's. `data-ignore-morph` nodes are neither morphed nor removed and
  are the render's preserved roots. After a morph, the directives on every morphed element run
  again, so what the server's markup undid (`data-text`'s text, `data-class`'s classes) comes
  back. An unknown target, a duplicate and a fragment that does not fit its mode are errors, and
  nothing changes.
- **Scopes survive a morph that replaces their owner** (**Provisional**, ticket #9, 2026-10-20):
  the patcher holds back the removal of any node that owns a scope until the morph is done,
  then hands each scope whose owner's path (protocol section 2.4) reappears on another node to
  that node with `scopes.transfer`, all pairs at once so components that trade places keep
  their own scopes, and only then tears down and removes the held nodes, still connected.

## Open

Nothing open.
