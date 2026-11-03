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
  2026-10-20). **Superseded** by "Protocol 1: components are elements" below (ticket #33): regions
  and components are both elements, and blocks are gone.
- **The repo was private at first**, `Ignibyte/tessera` (2026-10-20, the default recommended to Chad).
  It opens with AIC's public release, under the MIT license (2026-11-02, Chad).
- **Tessera keeps tests** (2026-10-20): a browser runtime's correctness is behaviour across
  engines that static analysis cannot see. Unit tests with Vitest, property tests with fast-check
  for parsers, and Playwright browser tests, with jqstar's navigation matrix (28 scenarios with
  no-JS baselines) as the acceptance suite. AIC's no-tests rule does not apply here.
- **Build output names and what a release ships** (driver, Chad deferred to it, 2026-10-20;
  ticket #1): `dist/tessera.js` is the ES module, `dist/tessera.min.js` the same minified, and
  `dist/tessera.iife.js` a minified IIFE that sets the global `Tessera`, for a page loading it
  with a plain `<script>`. Each bundles Idiomorph. A release ships all three, each with its source
  map, plus `SHA256SUMS` over them (#19). The size budget measures `tessera.min.js`. What a
  release ships is replaced by the two builds of #19, below.
- **Vite 7.3.7, not jqstar's 7.3.6** (ticket #1, 2026-10-20): 7.3.6 has a high-severity
  advisory (launch-editor, GHSA-r825-w8mm-5pxw) fixed in the 7.3.7 patch. terser 5.51.2 is added
  as jqstar has it, because Vite leaves whitespace in a library's ES output when esbuild
  minifies it.
- **SSE event names are Tessera's own** (Chad, 2026-10-20; ticket #2):
  `tessera-patch-elements`, `tessera-patch-signals` and `tessera-close`, with Datastar's
  `data: KEY VALUE` line shape (`target`, `mode`, `elements`; `scope`, `onlyIfMissing`,
  `signals`). Tessera targets regions and component paths, never CSS selectors, so Datastar's names
  would promise a compatibility that is not there; keeping the line shape keeps the server encoders
  and jqstar's parser simple.
- **Protocol version 0 and its headers** (**Provisional**, ticket #2, 2026-10-20): requests carry
  `Tessera-Request` (the kind: `visit`, `submit`, `action`, `refresh`, `stream`),
  `Tessera-Protocol: 0`, `Tessera-Targets` (each component entry carries its props token),
  `Tessera-Layout` and, on actions only, `Tessera-Signals`. A server that does not speak the
  version answers `400` with the versions it speaks, before any side effect. The version is `1`
  since ticket #33; the headers are unchanged.
- **Identity spelling** (Chad, 2026-10-20; ticket #2): components are
  `<!--t:c KEY-->` or `<!--t:c KEY PROPS-->` ... `<!--/t:c-->`, blocks `<!--t:b-->` ...
  `<!--/t:b-->`. Blocks have no key, are always rendered (empty ones included) and pair by
  position, so a conditional that appears does not shift its siblings. `page` is a reserved target
  name for the whole document, and the root of paths for components outside any region.
  **Superseded** for components and blocks by "Protocol 1: components are elements" below (ticket
  #33); `page` stays as it was.
- **Fragment responses are `text/vnd.tessera+html`** (**Provisional**, ticket #2, 2026-10-20): a
  body of top-level `<template data-target data-mode>` elements, JSON signal patches in
  `<script type="application/json" data-scope>`, an optional `<title>`, CSRF meta and copies of
  the tracked assets. `<template>` parses any markup (table rows, list items) inertly. A
  whole-page update is a plain `text/html` document, so a server that ignores Tessera still works.
  Fragment responses keep HTML's compression and readability; streams use SSE.
- **Redirects for a Tessera request travel as `Tessera-Location` on a `200`** (Chad, 2026-10-20;
  ticket #2). `fetch` with `redirect: "manual"` hides the location of a `303`, and
  with `redirect: "follow"` it resends a write's body on a `307` or `308`. Writes go with
  `manual`, so any real redirect answering a write is reported as indeterminate and never
  followed; reads go with `follow`. The server layer converts `301`, `302` and `303` for Tessera
  requests in one middleware. `Tessera-Full-Visit` asks for a browser load instead.
- **`Tessera-Layout`** (**Provisional**, ticket #2, 2026-10-20): the page names its layout in a
  meta and every request sends it, so a server answers a visit to a page with another layout with
  the full document. Without it, a visit that sent only `content` would leave the old layout's
  other regions on screen.
- **Signals travel in a header, on actions only** (Chad, 2026-10-20; ticket #2):
  `Tessera-Signals` holds one flat JSON object of the signals the element can see (innermost scope
  wins, `_`-prefixed left out), with every character above U+007E escaped so the header is ASCII,
  at most 4,096 bytes. A header leaves form bodies in the browser's own encoding and GET URLs
  clean, and the cap enforces "signals never hold application data". Visits, submissions,
  refreshes and streams send none, so they get what a plain browser gets. Ticket #8 fixed what
  the object leaves out (below). Revisit this when a page needs more than 4 KB of signals, when a
  proxy or CDN in front of a Tessera site caps the total header size near 8 KB, or when a new
  protocol version can move signals into the body without breaking the servers that speak
  version 0.
- **Names of the attributes a server renders** (**Provisional**, ticket #2, 2026-10-20):
  `data-target`, `data-enhance="off"`, `data-track`, `data-error-summary`, `data-permanent`,
  `data-lazy`, `data-poll`, `data-stream`, `data-signals__region` and `data-signals__document`
  (and `data-prefetch`, added by ticket #17, and `data-push`, added by ticket #28),
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
- **WebKit runs in the Playwright image, the rest on the host** (**Provisional**, ticket #20,
  2026-10-20): `npm run test:browser:webkit` (`scripts/webkit.ts`) starts
  `mcr.microsoft.com/playwright:v1.62.1-noble` with only the host's `node_modules` mounted,
  read-only, and runs playwright-core's `run-server` in it. The runner, the build and the
  reference servers stay on the host, as in `npm run test:browser`; the WebKit project connects
  through `connectOptions` (`TESSERA_WEBKIT_ENDPOINT`), and the container shares the host's
  network, so the browser reaches the reference server at `127.0.0.1`. The image tag is pinned
  in `scripts/webkit-image.ts` and must be `v<@playwright/test version>-noble`: the script
  refuses to run and a unit test fails when they drift. The container is removed when the run
  ends, fails or is interrupted, and on any signal the run gets SIGINT, the one on which
  Playwright stops its reference servers. `npm run test:browser` still runs Chromium and Firefox
  on the host. The suite's first WebKit failures are ticket #27.

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
  `enhance`, `track`, `permanent`, `lazy`, `poll`, `prefetch`, `stream`, `error-summary`, `mode`,
  `scope`) cannot be directives.
- **The trusted engine may use `new Function`, in `src/expression.ts` only** (Chad, 2026-10-20;
  ticket #6), with the no-eval engine (#22) required before 0.1.0. `docs/design.md` keeps jqstar's
  trusted engine, which compiles expressions with `new Function`, so lint's
  `@typescript-eslint/no-implied-eval` is turned off for that one file and that one rule in
  `eslint.config.js`; it stays on everywhere else, so no other file can compile code from
  strings. Pages whose Content-Security-Policy has no `'unsafe-eval'` cannot use the trusted
  engine; the no-eval engine is for them.
- **The no-eval expression engine ships before 0.1.0, as an option** (Chad, 2026-10-20, with the
  `new Function` exception above): jqstar `src/csp/` ported behind the same
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
  dotted, and each segment is camelCased (`data-bind:user.first-name` binds `$user.firstName`),
  unless `__case` names another spelling (#23).
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
- **The SSE parser follows the WHATWG algorithm where jqstar did not** (**Provisional**,
  ticket #10, 2026-10-20): an event the stream ends before its blank line is dropped (jqstar's
  `finish()` dispatched it); `retry` sets the stream's reconnection time when it is read, not a
  field of the next event; a block with `id` and no `data` still sets the last event ID at its
  blank line; a bare CR ends a line, also when it ends a chunk and an LF starts the next.
- **How the transport dispatches** (**Provisional**, ticket #11, 2026-10-20): a write is sent
  once; after dispatch a network failure, an abort or a redirect answering it is
  **indeterminate**, reported and never resent. Only a GET is retried, twice, after a network
  failure before any answer (250 ms, then 500 ms). Every request waits 5 ms before it goes
  (Livewire's buffer), so a read superseded in that window is never sent. Overlapping requests
  follow #12's table (protocol 4.6), which replaced #11's same-target rule. A GET waits while the page is hidden. A 419 raises `tessera:expired` on the
  document; unless it is cancelled, `confirm()` offers a reload. Interceptors (`before`, `after`,
  `error`) run once per logical request, and the protocol's own headers are restored after
  `before`. Until #13, a whole-document answer is a full load.
- **Browsers resend some writes themselves** (**Provisional**, ticket #11, 2026-10-20): found by
  the transport's browser test. When the server drops a connection the browser had reused from
  its keep-alive pool before any answer, Chromium and Firefox both send the same POST again on a
  new connection, without Tessera's knowledge (Tessera called `fetch` once). `fetch` offers no way
  to opt out. So the reference server runs the browser tests with `--close-connections`, which
  makes every dropped connection a fresh one, and the test counts what Tessera sent: exactly one
  POST. `docs/protocol.md` section 4.5 tells servers to expect such a repeat; #24 gives them the
  means (the next entry). WebKit does not repeat it (ticket #27): the write stays indeterminate,
  so the write-id browser test asserts whichever happened, and the write is applied once either
  way.
- **`Tessera-Write-Id` on every write** (**Provisional**, ticket #24, 2026-10-20; driver's request):
  a `crypto.randomUUID()` per submission on POST, PUT, PATCH and DELETE, restored after
  interceptors; servers answer a repeat within five minutes with the first answer or `409` and
  never apply it twice, scoping ids to the session (`docs/protocol.md` section 5.8). The reference
  server does so, with one global store since it has no sessions. Its browser test runs on a
  second reference server without `--close-connections`, where both engines repeat the dropped
  POST with the same id.
- **The policy for overlapping requests** (**Provisional**, ticket #12, 2026-10-20; the table is
  `docs/protocol.md` section 4.6): a write is never aborted, so a second write to an overlapping
  target waits for the first (Livewire queues per scope the same way; refusing it would lose a
  click); a newer write supersedes an overlapping read, since the read's answer would predate the
  write; a newer read supersedes a read on the same target or inside its own, and queues behind a
  read around it, so a refresh inside a region never aborts the visit replacing that region; polls
  yield to everything. Generations are one commit sequence with each target's last touch, not a
  counter per target, so fragments a server sends unasked are covered too. A commit touches its
  target and the targets inside it, never those around it (driver, 2026-10-20; ticket #25): #12
  touched the targets around too, so a stream event inside `content` made a visit of `content` in
  flight drop its fragment while history recorded the new URL. A pending region carries
  `aria-busy`, a component's top-level elements do, and the initiating element `data-loading`.
- **Which link clicks become visits** (**Provisional**, ticket #13, 2026-10-20): the primary
  button, no modifier key, not already prevented, an HTML `<a href>` in the page's document,
  `target` absent or `_self`, no `download`, an http or https URL of the page's origin, not a
  change of fragment alone on the current URL (left to the browser's scrolling), and the nearest
  `data-enhance` not `off`. One delegated listener on the document, owned by the kernel. A visit
  targets the link's `data-target`, else its innermost region, else `page`, as protocol 4.1 says;
  so the fixture's sidebar links carry `data-target="content"`, as protocol example 10.1 does.
- **Committing a whole document** (**Provisional**, ticket #13, 2026-10-20): parsed with
  `DOMParser` (inert); a different tracked-asset set or `<base>` loads in full before anything
  changes; new stylesheets get 4 s to load or fail before the body commits; `<title>`, `lang`,
  `dir` and the `tessera-layout` and `tessera-csrf-token` metas are taken by value, everything
  else in the head by markup. The progress bar appears after 200 ms (Livewire uses 150).
- **History, focus and scroll** (**Provisional**, ticket #14, 2026-10-20): each entry Tessera owns
  keeps `history.state.tessera = { v: 1, kind, targets, scroll, focus }` (no HTML; other keys of a
  plain state are kept, a state that is not a plain object is never touched). Back and Forward
  fetch the entry again, fresh, as a visit of the targets that made it; the first entry has none,
  so going back to it fetches the whole page. A change of fragment alone is the browser's; a
  foreign entry, or a failed fetch, reloads. No back cache. `scrollRestoration` is manual from
  install to disposal. Focus, after enhancement: `autofocus` in what arrived, the stored key on
  Back and Forward, the fragment's target, the main heading of what arrived, the body. "Focus
  outside the updated region stays" is read as: the first three always apply, the heading and the
  body only when focus was inside what changed or lost. A visit keeps its URL's fragment past the
  response, as a browser does.
- **Idiomorph's `ignoreActiveValue` is not used** (ticket #14, 2026-10-20): found by the history
  tests in Firefox. With it, Idiomorph leaves the children of whatever element has focus
  unmorphed, not only a field's value, so a heading focused after one visit kept its old text
  through the next. The patcher instead refuses only the `value` update of a focused `input`,
  `textarea` or `select`, through Idiomorph's `beforeAttributeUpdated` callback.
- **Which submits Tessera takes, and what it does after** (**Provisional**, ticket #15,
  2026-10-20): a `get` or `post` form (with the submitter's overrides) of the page's origin,
  without a `target` other than `_self`, not under `data-enhance="off"`, and not already
  prevented; the browser's own validation runs first, since `submit` fires only after it. A second
  submit of a form in flight is blocked, not queued: the user's repeated click sends nothing, even
  later. After a 422 or 409, focus goes to `[data-error-summary]` in the form's targets, else the
  first `[aria-invalid="true"]`, with the browser's scrolling. An indeterminate write raises a
  cancelable `tessera:indeterminate` on the form; uncancelled, a `role="alert"` message goes
  before the form until its next submit. No interceptor can change the encoding: a request with a
  body drops any `Content-Type` an interceptor set, and fetch derives it from the body.
- **How durable streams live and stop** (**Provisional**, ticket #16, 2026-10-20): one stream per
  absolute URL per page, held by elements carrying `data-stream` and by handles from the API, each
  holder a `subscription` in the kernel's ledger rooted at its element, the stream itself a
  `service`. The last holder leaving stops the stream one task later, so a morph that swaps an
  element for one naming the same URL keeps the connection. The transport sends each connection
  (interceptors' `before` runs on each one; `after` and `error` do not, since a stream has no
  outcome) and commits each fragment without a staleness check, touching the generations. Any
  status protocol 7.3 does not name, other than `200`, stops the stream and is reported. A stream
  that stopped for good stays stopped for the elements that held it; a new element naming the URL
  opens a new one. Every event, unknown names included, reaches the API's listeners after it is
  applied (protocol 7.2 said only unknown names). A `retry` under 100 ms is used for the first
  reconnect only; failures in a row back off from 100 ms, so `retry: 0` cannot turn a failing
  server into a request per task.
- **Lazy regions, polling, prefetch and persisted nodes** (**Provisional**, ticket #17,
  2026-10-20): `data-lazy` and `data-poll` take modifiers in the directive grammar, so they read
  like Datastar's own: `data-lazy__visible` loads through an `IntersectionObserver` (at once
  where there is none), and `data-poll__5s` or `data-poll__750ms` sets the interval, at least
  100 ms, default 2 s. Each loads or polls the innermost component or region containing the
  element, as a `refresh`; a lazy element loads once per node. Polling follows Livewire: one
  clock per interval; "background" means the window lacks focus (`document.hasFocus()`), and then
  only every 20th tick fires, where Livewire skips 95% at random; nothing fires while the page is
  hidden or offline. Prefetch: every enhanced link on mousedown, `data-prefetch="hover"` also
  after 60 ms of hover (Livewire's `.hover`), `data-prefetch="off"` never. The transport sends the
  visit's request early (interceptors' `before` runs then, once) and the matching visit takes the
  answer once, recording the prefetch's generation, so a commit between mousedown and click makes
  its fragment stale. 30 s, at most 8 waiting; a failed or `no-store` answer is not used.
  `data-permanent` now also holds through fragment morphs, as the same live node, unmorphed.
- **Where `__case` applies** (**Provisional**, ticket #23, 2026-10-20): Datastar's modifier,
  `__case.camel`, `__case.kebab`, `__case.snake` or `__case.pascal`, spells the attribute's key
  from the kebab case HTML leaves it in, converting hyphens only (`.` and `:` stay). It applies to
  `data-on` (default kebab, so event names stay as written) and to the directives that name a
  signal, `data-computed`, `data-ref` and `data-bind` (default camel, as #7 already does; for
  `data-bind`, each dotted segment). `data-attr` takes it too, default kebab (driver, 2026-10-20;
  ticket #26), since SVG's `viewBox` and other camelCase attributes cannot be spelled otherwise.
  Not `data-style` or `data-class`, whose keys are CSS names; on those, `__case` is the usual
  unknown-modifier error.
  `data-signals` takes no key. An unknown case, a missing or extra name, or two `__case` modifiers
  is an error at the attribute.
- **WebKit can hold the end of a streamed body** (**Provisional**, ticket #27, 2026-10-20): found
  when the stream tests failed about 1 run in 50 in WebKit. A page reading `/events/stream` with
  plain `fetch` and no Tessera code got only the first 123 bytes (`retry` and the first event, a
  cut inside one server write) in 1 of 200 runs; Chromium never did. The rest arrived only with
  the server's next write: with a comment every 300 ms, a stalled run got its tail at 303 ms.
  `Connection: close` makes it more likely; `X-Content-Type-Options: nosniff` and keep-alive do
  not stop it. Tessera never receives the held bytes, so nothing in it can be fixed. The reference
  stream gains `beat` (ms between comments, for the whole connection), the stream tests use 250 ms
  and wait for a whole step before acting on it, and protocol 7.1 asks servers for a comment at
  least every 15 seconds, more often where WebKit must see events promptly. Seen in Playwright's
  Linux WebKit (webkit-2336); for macOS, see the Mac mini run (#29) below.
- **What the navigation matrix found, and what changed** (**Provisional**, ticket #18,
  2026-10-20; `docs/navigation-matrix.md`):
  - A visit whose GET the network refuses after its retries loads the URL in full, so the
    browser shows what it shows without Tessera (its error page in Chromium and Firefox, the
    page left as it was in WebKit). Before, nothing visible happened.
  - A prefetch made by a press uses its answer even when it says `no-store`: it is the click's
    own request, sent a moment early, and is used once by that click. A hover's prefetch still
    drops a `no-store` answer. #17's rule cost every click a second request on a `no-store`
    site, so a visit read the server twice where the browser reads it once.
  - A body shorter than its `Content-Length` (with no `Content-Encoding`) is a failure in the body
    lease. WebKit resolves such a body as complete: a write whose answer was cut short arrived as
    an empty document, and Tessera reloaded the page instead of saying the write's fate was
    unknown.
  - The matrix itself: jqstar's 28 scenarios plus Tessera's TES-01 (a write answered by a 307,
    which none of jqstar's sends), each run without JavaScript and with Tessera, compared on URL,
    content, focus and history length; a field may differ only where the scenario declares why.
    Mousedown prefetch sends one GET for a link whose click the page then cancels (NAV-20); the
    matrix accepts that as #17's cost.
- **The no-eval engine: its scope, and what it leaves out** (**Provisional**, ticket #22,
  2026-10-20). `createNoEvalExpressionEngine()` (`src/noeval/`, ported from jqstar `src/csp/`)
  sits behind the same `ExpressionEngine` seam. A page picks it with one option, the
  `expressions` engine given when Tessera starts (today `mountAttributes({ expressions })`; #19
  puts it in the public call). Importing `src/noeval/engine.ts` is the only way it enters a
  build. Both engines import only `src/expression-shared.ts`; `npm run size` builds each alone,
  checks that neither holds the other's code, and holds the trusted engine to 2,150 bytes
  gzipped and the no-eval engine to 10,950 (measured 1,920 and 9,914, plus 10%). The default
  build's budget is unchanged.
  - **The same scope**, resolved when the expression runs, in the trusted engine's order: `el`,
    `evt` and `this` (the element), the context's helpers, `$name`, then the built-ins. Any
    other name, `$` alone included, fails with the trusted engine's "is not defined" message.
    Actions `@get` to `@delete` anywhere, through the same seam. A statement returns a promise
    that rejects on an evaluation error, as the trusted engine's async function does.
  - **Less than JavaScript, as jqstar's grammar**: `===` and `!==` only (`==` and `!=` fail to
    compile); arithmetic on finite numbers with finite results, `+` also joining strings with
    strings, numbers, booleans, `null` and `undefined`; `<`, `<=`, `>`, `>=` on two numbers or two
    strings; `&&`, `||`, `??`, `?:`, `!`, unary `+` and `-`; assignment and compound assignment,
    postfix `++` and `--`; `;`-separated statements, a last `return`, and `await` in
    statements. No `new`, `typeof`, `in`, `instanceof`, `delete`, `throw`, `if`, loops, `let`,
    functions or arrows, classes, template literals, comments, regular expressions, optional
    chaining, spread, destructuring, `??=` or prefix updates. Strings take JSON's escapes;
    numbers are decimal.
  - **jqstar's limits**: 2,048 characters, 512 tokens, nesting 16, 256 syntax nodes, 64 literal
    entries, 8 path segments, 8 arguments, 128 evaluation steps, 128 collection items, 8 awaits.
  - **What a value can do** (the capability table in `src/noeval/evaluator.ts`): data reached
    from a signal can be read and written (own properties only, no accessors), and its arrays
    also `push`, `pop`, `shift` and `unshift`; other data is read-only. Arrays offer `at`,
    `includes`, `indexOf`, `join` and `slice`; strings `length`, an index, and `charAt`,
    `endsWith`, `includes`, `indexOf`, `slice`, `split`, `startsWith`, `substring`,
    `toLowerCase`, `toUpperCase` and `trim`. An element reads `checked`, `className`, `dataset`
    (a copy), `disabled`, `form`, `hidden`, `href`, `id`, `localName`, `name`, `open`,
    `parentElement`, `placeholder`, `readOnly`, `required`, `selectedIndex`, `tagName`,
    `textContent`, `title`, `type` and `value`. It writes only `checked`, `disabled`, `hidden`,
    `textContent` and `value`, never markup, and calls `blur`, `click`, `focus`,
    `requestSubmit`, `reset`, `scrollIntoView` and `select` with no arguments, and `closest`,
    `getAttribute`, `hasAttribute` and `matches` with one string. An event reads jqstar's
    members plus the modifier keys, `repeat` and `submitter`, and calls `preventDefault`,
    `stopPropagation` and `stopImmediatePropagation`. Helpers are called as registered. The
    built-ins are a table of pure functions: `Math`'s, `JSON.parse` and `JSON.stringify` (no
    replacer), `Number` and its predicates and parsers, `String`, `Boolean`, `parseInt`,
    `parseFloat`, `isFinite`, `isNaN`, the URI functions, `Array.isArray`, `Object.keys`,
    `values` and `entries`, `Promise.resolve` and `Date.now`. Another built-in name fails as
    not available here.
  - **Never**: `constructor`, `__proto__`, `prototype`, `call`, `apply`, `bind`, `arguments`,
    `callee`, `caller` and `eval` as a key or method; a function as a result; `await` of
    anything but a native promise. jqstar's cycle check and its owned-getter rule are gone: the
    path limit bounds a read, and Tessera's computed signals are getters on the scope itself.
  - The #6 conformance suite passes with one named adaptation: `location-aware-errors` fails
    asynchronously through a helper's rejected promise, since there is no `throw` or `new`.

- **`data-push="off"`: a visit that leaves history as it was** (**Provisional**, ticket #28,
  2026-10-20; the driver asked for the opt-out after NAV-17). On a link, a form or a submitter;
  the submitter's `data-push`, with any value, overrides the form's, as `data-target` does. Only
  `off` opts out. The visit runs with history mode `none`: it commits as any visit does, but adds
  or changes no entry, and Tessera moves neither focus nor scroll, as after a refresh or an action,
  since #14's focus and scroll rules belong to entries. A submission's request now carries the
  history mode of the visit its `Tessera-Location` leads to (`push`, or `none` when it opted
  out), so `TesseraRequest.history` is `push` on a submit where it was `none`. Full loads, a
  redirect to another origin and `Tessera-Full-Visit` still change the address. The matrix gains
  TES-02. Reserved as a directive name.
- **The browser suite and the byte hold on macOS** (ticket #29, 2026-10-20). Run on the Mac mini
  (macOS 27.0.1, arm64, Node 26.8.1) from `~/scratch/tessera`, a `git archive` of main with its
  own `npm ci` and browsers under `PLAYWRIGHT_BROWSERS_PATH` there, so the Mac's Playwright
  install, its launchd agents and `sudo` were left alone. `TESSERA_WEBKIT=1 npx playwright test`:
  - **Firefox** (firefox-1538): 101 of 101 pass.
  - **Chromium** (chromium-1234): 100 of 101. NAV-19 fails every run on `requestCancellationFacts`:
    the second click lands within the first visit's 5 ms buffer, and a visit superseded before it
    takes its prefetch leaves that prefetch running. A Tessera bug that the Mac's timing exposes,
    reproduced on the dev box with the transport fixture: split into #30.
  - **WebKit** (webkit-2336): 97 of 101. NAV-19 as in Chromium, plus three focus tests: macOS
    WebKit does not focus a link or a button on click, and Tab skips them (`focus()` from script
    works). Two history tests assume a clicked link has focus; in NAV-17 the click focuses `#main`,
    outside what changed, so Tessera keeps focus there, an undeclared difference. Split into #31.
  - **Safari** 27.0.1: remote automation was already on, so `safaridriver` ran the byte-hold probe
    over WebDriver. Playwright cannot drive Safari, so the suite does not run there.
  - **The byte hold**: `test/probes/byte-hold.spec.ts` (run with `playwright.probes.config.ts`,
    never with the suite) reads `/events/stream` with plain `fetch` on a page without Tessera, and
    counts runs whose third step has not arrived within 1.5 s; with `PROBE_BEAT` the server sends
    a comment every so many ms, and a held run completes late instead. Same script everywhere,
    against the reference server with `--close-connections`:

    | Engine | Held, no comments | Late, comment every 300 ms |
    |---|---|---|
    | Linux WebKit (the image) | 33 of 200, each at 123 bytes | 12 of 200, at 302 to 312 ms |
    | Linux Chromium, Firefox | 0 of 200 each | not run |
    | macOS WebKit (Playwright) | 2 of 12,200, each at 328 bytes | 1 of 8,000, at 306 ms |
    | macOS Chromium, Firefox | 0 of 200 each | not run |
    | Safari 27.0.1 | 0 of 10,000 | 0 of 2,000 |

    So the hold happens in Playwright's WebKit on macOS too, about 1 run in 6,000 against 1 in 6
    on Linux, cut at another place, and released by the next write as on Linux. Real Safari showed
    none in 10,000 runs, which bounds its rate but does not rule it out. Protocol 7.1's keep-alive
    comment stays the remedy.
- **A release ships two builds** (**Confirmed by Chad 2026-10-22**, ticket #19, 2026-10-20; the driver's decision,
  Chad to confirm): the default, `tessera.js`, `tessera.min.js` and `tessera.iife.js`, with the
  trusted engine, and `tessera.csp.js`, `tessera.csp.min.js` and `tessera.csp.iife.js` with the
  no-eval engine. Each has its source map, and `SHA256SUMS` covers the twelve files
  (`scripts/release-files.ts` lists them). `docs/consumers.md` says a strict-CSP page loads
  `tessera.csp` and recommends it as the safe default for frameworks. `npm run size` holds each
  minified ES module to a budget and checks that the default build holds nothing of the no-eval
  engine and the csp build nothing that compiles code from a string (`Function(`, `eval(`).
- **The public API** (**Confirmed by Chad 2026-10-22**, ticket #19, 2026-10-20): each build exports `start`,
  `version` and the three event names; `src/start.ts` is the runtime both share, and each entry
  binds its engine, so the choice of engine is the choice of file, not an option.
  `start({ helpers })` boots what the test harness boots (with the transport's real action seam)
  and returns `{ signals, visit, intercept, stop }`; a second `start` on a document throws.
  Failures go to the events that already exist, so there is no `report` option. An action a
  directive starts during the first scan, before the transport exists, waits one microtask for
  it. The IIFEs start themselves once the document is parsed unless
  `<meta name="tessera-start" content="manual">`; the ES modules never start on import, since an
  import with side effects would start Tessera wherever the module is merely loaded. The rest of
  the configuration stays in the protocol's metas.
- **The size budgets are the measured sizes plus 10%** (driver, ticket #19, 2026-10-20): the
  default build 35,514 bytes gzipped, the csp build 44,209. #1's 30,720 was a starting figure set
  while the build held only `version` (98 bytes), so no check had measured the runtime until
  `start` bundled it; #19 asks for the measured size plus 10%, so this follows the ticket rather
  than lowering a bar. Measured: the default build 32,285 when the driver set its figure (32,339
  after #30), the csp build 40,190. Terser's options gain nothing (`passes`, `module`, `unsafe`:
  within 100 bytes). By the source map the transport is 18% of the minified default build,
  Idiomorph 9.5%, the kernel 8.6% and the built-in directives 8.2%; long string literals, mostly
  error messages, are about 2.7 KB gzipped. A later ticket can lower both.

- **Protocol 1: components are elements** (Chad, 2026-10-28: "not in comments ... data attributes
  or something would make more sense"; the driver's decisions on ticket #33; AIC #189 and #188
  follow). `Tessera-Protocol: 1`, released as Tessera 0.2.0.
  - A component is exactly one element carrying `data-t-c="KEY"`, and `data-t-props="TOKEN"` when
    it has props. The key grammar, the path spelling (the region's name or `page`, then the keys of
    the enclosing components, outside in) and the 512-character cap are as in protocol 0. A
    component that renders siblings is wrapped by its server (`<tbody>` for rows, `<div>`
    elsewhere); a component inside `<h2>` or `<p>` is a `<span>`.
  - Blocks are dropped. Tessera 0.1.x never treated `t:b` specially: `patch.ts` had no block logic
    and `scopes.ts` only skipped them, so they were passive comments Idiomorph aligned. A
    conditional that appears may shift its siblings in a morph, and a server keeps state-bearing
    elements (fields) id'd, which Idiomorph matches by `id`.
  - Anchors: `data-t-anchor="NAME"` on a component (a key-shaped name, unique on the page). Where
    Tessera reads a target from the page (`data-target`, an action's `target`, a form, the API),
    `@NAME` names that component, resolved to its path before `Tessera-Targets` is sent. An
    unknown or doubled anchor, or one on an element without `data-t-c`, is reported as a bad
    target and the request is not sent. The server never sees `@`. `data-poll` and `data-lazy`
    take no target attribute, so they have nothing to resolve.
  - A component morph is Idiomorph on the component element itself (`outerHTML`, as a region's
    is), so #32's `morphRange` and the copies outside the range are gone. `inner`, `append` and
    `prepend` act on the element's children; `remove` removes the element.
  - A server speaking only 0 meets the refusal a mismatched version already got: `400` without `1`
    in its `Tessera-Protocol` is a full load.
- **Protocol 2: a target entry carries its component's anchor** (Chad, 2026-10-27, for AIC #194:
  "Tessera sends the anchor"; ticket #34). `Tessera-Protocol: 2`, to be released as Tessera
  0.3.0.
  - `entry = target [ SP props ] [ SP "@" anchor ]`. Tessera adds `@NAME` to an entry whenever
    the target component's element carries `data-t-anchor="NAME"`, however it was targeted: a
    `@NAME` link or form, a poll, lazy load or refresh inside the component, an action, a visit
    through the API. Regions, `page` and unanchored components send none; an anchored component
    without props sends `target @NAME`. `@` cannot occur in a props token, so the token is
    unambiguous.
  - Why: a server reads a component's props by the target it names. A keyed component nested in
    another's template sits at a positional path that moves when a wrapper or an order changes;
    with the anchor beside the path, the server finds the props by anchor and app code never
    spells the path.
  - A new version, because a protocol 1 server reads `@NAME` as a props token (AIC refuses it as
    altered). Requests carry 2; fragments and streams must carry 2. Everything else as in 1.
  - The server's answers still name targets by path; "the server never sees `@`" from protocol 1
    no longer holds for requests.
- **A stream event may target an anchor, within protocol 2** (**Provisional**, ticket #35,
  2026-10-29; the driver's request for AIC's aic-demo run 19, a live bell in the page header; the
  version question is the agent's choice). A `tessera-patch-elements` event's `target` and a
  `tessera-patch-signals` event's `scope` may be `@NAME`. `commitStream` resolves it with
  `resolveAnchors` against the live page when the event commits, then patches and touches the
  generations as for the path; a signal scope resolves when its event arrives. A name that is
  badly spelled, missing, doubled or not on a component is reported and the event dropped, as
  for a missing path. Fragment responses stay path-only.
  - Why: a keyed component inside another component's template sits at a positional path
    (`header/bell/Bell.2:count`) that moves when a wrapper or an order changes, and AIC's gate
    refuses spelling such paths in app code. Links, forms, polls and actions already take
    `@NAME`.
  - No new version: a server pins the Tessera release it serves, and this widens only what an
    event may name. A 0.3.0 page given `@NAME` reports the event and drops it, as it would an
    unknown region; it never applies it to the wrong element. The rule from protocol 2, "the
    server's answers still name targets by path", now holds for fragment responses only.
- **A malformed or doubled anchor is left out of the entry** (**Provisional**, ticket #34,
  2026-10-27; the agent's choice). Tessera sends `@NAME` only when the anchor follows the key
  grammar (at most 64 characters) and no other element carries it. Such an anchor is the server's
  own rendering error: sent, it would break the header's grammar or name two components, and
  failing every refresh of the component over it would turn a markup slip into a dead page. The
  entry goes with its path and props, as for an unanchored component. Targeting such an anchor
  by `@NAME` is still reported and sends nothing, as protocol 1 decided.
- **A component morph brings the same tag as the live component element** (**Provisional**,
  ticket #33, 2026-10-27; the agent's choice, beside the driver's decisions). The rule regions
  already follow: a morph whose element has another tag is refused (`the component is a <div>, the
  markup a <section>`). Idiomorph replaces rather than morphs an element whose tag changed, and the
  component element is the render transaction's root, which must survive the morph. A server that
  changes a component's tag sends the enclosing target instead.
- **An element is not both a region and a component** (**Provisional**, ticket #33, 2026-10-27):
  `findTarget` refuses a component element that also carries `data-region`, and the reference
  server's scanner refuses one in a fixture. Both attributes would give one element two scopes
  and two spellings.
- **Devtools hooks: `tessera:exchange`, `tessera:patched` and the highlight meta**
  (**Provisional**, ticket #36, 2026-11-02; the ticket names the three, the details below are the
  agent's choices). For AIC's profiler (AIC #229 to #231); `src/devtools.ts`, no wire change.
  - `tessera:exchange` is raised on the document, neither bubbling nor cancelable, after the
    interceptors' `after`. Its `kind` adds `poll`, `lazy`, `prefetch` and `stream-event` to the
    request kinds, since a toolbar needs them apart and the wire kind (`refresh`, `visit`) does not
    say; a lazy load tells the transport so with `lazy: true` on its input, as a poll has `poll`.
  - Absent values are `null`, not `undefined`, so a listener can post the detail as JSON.
  - Timings start when the request is sent, after the 5 ms buffer and any queue, so `firstByteMs`
    is close to the server's own time; a request stopped before it went (superseded, skipped)
    measures from when it was made.
  - A prefetch raises its own exchange (outcome `prefetched`, no bytes, since the visit reads the
    body), and the visit that takes it raises one with `prefetched: true`: two events for one HTTP
    request, each true to its own moment. A poll that yields raises one as `skipped`.
  - A request refused before it is made (bad URL, another origin, a GET with a body, an anchor
    that does not resolve) has no request to describe and raises none; `tessera:error` has it.
  - A stream event's exchange carries its connection's status and headers, and `bytes` is its
    data's UTF-8 length.
  - `tessera:patched` uses the patch modes' own names; the ticket's `replace` is `inner`. A
    `remove` raises none, since its element is gone. A whole-document morph raises it on `<body>`
    with target `page`.
  - The highlight's timer is in the kernel's ledger (disposal clears the attribute), and a patch
    within 600 ms restarts it. The meta is read at each patch, so a page may add it at any time.
  - Cost: the DOM cannot tell Tessera whether anyone listens, so each exchange is one event
    dispatch built from values the transport already holds. The body lease counts bytes as it
    reads; only a stream event encodes its data once to count it. Measured with the hooks: the
    default build 32,533 bytes gzipped (31,717 before), the csp build 40,395 (39,573); the
    budgets are unchanged.
- **A GET form's newer submit goes** (ticket #38, 2026-11-02; the driver's brief, from Lotline's
  search as you type). #15's blocked second submit now holds writes only. A GET submission is a
  visit: it neither waits on nor marks the form's in-flight state, so the transport's 4.6 rules
  apply to it as to any read. The newer one supersedes the older on the same target and a late
  answer is dropped; a GET submitter on a POST form whose write is out queues behind the write.
  Only a write's submit clears an earlier indeterminate message. Protocol 4.5 and 4.6 say so; the
  wire is unchanged.

## Open

Nothing open.
