# Tessera

A browser runtime for server-rendered sites. The server sends HTML; Tessera morphs it into the
page one region or one component at a time, over normal responses or Server-Sent Events, and
keeps local reactive state in HTML attributes (Datastar's vocabulary, with explicit scopes).

AIC and Rustal both use it. Each speaks the protocol in `docs/protocol.md` from its own server
side; nothing in the browser side knows which framework is behind it.

Releases are on this repo's GitHub releases page; `CHANGELOG.md` says what each holds, and
`docs/consumers.md` how a framework takes one.

- Design: `docs/design.md`
- Decisions: `docs/decisions.md`
- Protocol: `docs/protocol.md`, what a server must do to speak Tessera
- Navigation matrix: `docs/navigation-matrix.md`, the acceptance suite for navigation
- Research behind it: `docs/research/`

Tessera is built from parts of jqstar (MIT); see `NOTICE`.

## Using a release

A release holds two builds of the same runtime, each three ways, each with a source map, and
`SHA256SUMS` over the twelve files:

| Build | Expressions | ES module | Minified ES module | For a plain `<script>` |
|---|---|---|---|---|
| default | compiled with `Function`; the page's Content-Security-Policy must allow `'unsafe-eval'` | `tessera.js` | `tessera.min.js` | `tessera.iife.js` |
| csp | the no-eval engine: a closed grammar, no code from strings (`docs/decisions.md`, #22) | `tessera.csp.js` | `tessera.csp.min.js` | `tessera.csp.iife.js` |

A page under a policy without `'unsafe-eval'` loads the csp build. A framework that cannot know
its pages' policies should ship the csp build (`docs/consumers.md`).

### Loading it

The IIFE starts Tessera by itself once the document is parsed, and sets the global `Tessera`:

```html
<script src="/assets/tessera.csp.iife.js" defer></script>
```

The ES modules start nothing on import; the page calls `start`:

```html
<script type="module">
  import { start } from "/assets/tessera.csp.min.js";
  start({ helpers: { money: new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }) } });
</script>
```

To configure an IIFE build from a call, add `<meta name="tessera-start" content="manual">` and
call `Tessera.start({ ... })` yourself. Starting twice on one document throws.

### Configuration

Most of it is markup the server renders (`docs/protocol.md`, section 3):

- `<meta name="tessera-layout" content="NAME">`, the layout the page was rendered with;
- `<meta name="tessera-csrf-token" content="TOKEN">` and, when the header is not
  `X-CSRF-Token`, `<meta name="tessera-csrf-header" content="HEADER">`;
- `<meta name="tessera-start" content="manual">`, which keeps an IIFE from starting itself;
- `<meta name="tessera-debug" content="highlight">`, which marks each patched element for a
  moment (Devtools hooks, below).

`start(options)` takes one option, `helpers`: names expressions may use, functions or objects
(`data-text="money.format($total)"`). They are registered before the page is scanned.

### The runtime

`start` returns:

| Member | What it does |
|---|---|
| `signals` | The document's signal scope, reactive: writing `signals.count = 3` updates every directive that reads `$count` from it. |
| `visit(url, { targets, history })` | Visits `url` as a click on a link would. `targets` names regions or components by path, or a component as `@NAME` by its `data-t-anchor` (none: the page); `history` is `push` (the default), `replace` or `none`. Resolves to the outcome (`committed`, `full-load`, `superseded`, …). |
| `intercept({ before, after, error })` | Adds an interceptor to every request; returns the function that removes it. `before({ request, headers })` runs once before dispatch and may set headers (Tessera's own are restored after it); `after({ request, outcome })` and `error({ request, error })` run when the request settles. A stream's connection runs `before` only. To watch every exchange, with its timings and response headers, listen for `tessera:exchange` (Devtools hooks, below). |
| `stop()` | Releases everything Tessera started on the document: listeners, streams, polls, history ownership. Links and forms go back to the browser. |

### Attributes

What a server renders for navigation, regions and requests is in `docs/protocol.md` section 3:
`data-region`, `data-target`, `data-push="off"`, `data-enhance="off"`, `data-track`,
`data-permanent`, `data-lazy`, `data-poll`, `data-prefetch`, `data-stream`, `data-focus-key`,
`data-error-summary`. Local state and behaviour use Datastar's vocabulary, with explicit scopes
(`docs/design.md`): `data-signals` (with `__region` and `__document`), `data-computed`, `data-ref`,
`data-text`, `data-show`, `data-class`, `data-attr`, `data-style`, `data-bind`, `data-effect`,
`data-init`, `data-on` (with `__prevent`, `__outside`, `__debounce`, `__case` and the rest),
`data-ignore` and `data-ignore-morph`. Expressions call `@get`, `@post`, `@put`, `@patch` and
`@delete`, with the options `target` and `form`.

While a request is out, its targets carry `aria-busy="true"` and the element that started it
`data-loading`; a visit that takes a moment shows a progress bar (`[data-tessera-progress]`).

### Events

The first three are cancelable, and cancelling one replaces what Tessera does by default. The
last two only report: nothing cancels them, and Tessera does nothing more when they are raised.

| Event | Raised on | When | Default |
|---|---|---|---|
| `tessera:error` | the element (or the document), bubbling | a directive, a request, a stream, a lazy load or a poll failed; `detail.error` | `console.error` |
| `tessera:expired` | the document | an answer was `419` (protocol 6); `detail.request` | a prompt offering a reload |
| `tessera:indeterminate` | the form, bubbling | a write was sent and no answer came back, so it may have been saved; `detail.error` | a `role="alert"` message before the form |
| `tessera:exchange` | the document | an exchange settled: a request, a prefetch, a stream's connection, a stream event; `detail` below | none |
| `tessera:patched` | each element a patch changed, bubbling | after a fragment, a stream event or a whole-document morph changed it; `detail.target`, `detail.mode` | none |

The builds export the names as `ERROR_EVENT`, `EXPIRED_EVENT`, `INDETERMINATE_EVENT`,
`EXCHANGE_EVENT` and `PATCHED_EVENT`, and the ES modules the types `ExchangeDetail` and
`PatchedDetail`.

### Devtools hooks

`tessera:exchange` is for a profiler or a debug toolbar: one event per exchange, after it settled
and after the interceptors' `after`. Its `detail` holds:

| Field | Value |
|---|---|
| `kind` | `visit`, `submit`, `action`, `refresh`, `poll`, `lazy`, `prefetch`, `stream` (a connection) or `stream-event` |
| `url`, `method` | the absolute URL and the method |
| `targets` | the targets sent in `Tessera-Targets`, anchors resolved; for an event, the target or scope it names |
| `status` | the HTTP status, or `null` when no answer came |
| `contentType` | the media type, lowercased, or `null` |
| `bytes` | the body bytes Tessera read (for an event, its data), or `null` when it read none |
| `headers` | the response headers the page may read, as `[name, value]` pairs: a server's own header, such as a profile id, is there |
| `startTime` | `performance.now()` when the request was sent (an event: when it arrived) |
| `firstByteMs`, `settledMs` | milliseconds from `startTime` to the answer's headers (`null` when none came) and to settling |
| `outcome` | the request's outcome (`committed`, `unchanged`, `skipped`, `superseded`, `failed`, …); `prefetched` for a prefetch; `open`, `retry` or `stop` for a connection; `committed`, `dropped`, `full-load`, `failed`, `closed` or `ignored` for an event |
| `prefetched` | a visit that took a prefetched answer instead of fetching |
| `event` | an event's type (`tessera-patch-elements`, …), else `null` |

A value Tessera does not have is `null`, so the detail goes through `JSON.stringify` whole. A
request Tessera refuses before making it (a bad URL, another origin, an anchor that does not
resolve) raises no exchange; `tessera:error` reports it. A prefetch raises its own exchange when
its answer arrives, and the visit that takes it raises another with `prefetched: true`.

`tessera:patched` is raised on each target element after its patch: `detail.target` as the fragment
or event named it (`page` for a whole-document morph, raised on `<body>`) and `detail.mode`
(`morph`, `inner`, `append` or `prepend`). A `remove` raises none.

With `<meta name="tessera-debug" content="highlight">` in the head, each patched element also
carries `data-tessera-patched` for 600 ms, so a page in development can show what an answer
changed:

```css
[data-tessera-patched] { outline: 2px solid #f59e0b; outline-offset: 2px; }
```

Without the meta nothing is added.

## Working on Tessera

Node 24 or later. `npm ci` installs the pinned toolchain; Idiomorph is the one runtime
dependency, and the build bundles it.

| Script | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over `src/`, `test/`, `scripts/` and the configs |
| `npm run lint` | ESLint (typescript-eslint, strict type-checked), no warnings allowed |
| `npm run test` | Vitest: `test/unit/` and `test/property/` |
| `npm run build` | The release's six files in `dist/`, each with a source map: `tessera.js` (ES module), `tessera.min.js` (minified) and `tessera.iife.js` (minified, for a plain `<script>`; global `Tessera`), and the same three as `tessera.csp.*` with the no-eval engine |
| `npm run sums` | `dist/SHA256SUMS` over the twelve files a release ships; run `npm run build` first |
| `npm run size` | gzip size of `dist/tessera.min.js` and `dist/tessera.csp.min.js` against `size-budget.json`, with a check that neither holds the other's expression engine, and each engine built alone against its own budget |
| `npm run test:browser` | Playwright, headless, in Chromium and Firefox (WebKit with `TESSERA_WEBKIT=1` on a machine that has its libraries, see `docs/decisions.md`), against the reference server; run `npm run build` first |
| `npm run test:browser:webkit` | The browser tests in WebKit, which runs in the pinned Playwright Docker image while the runner and the reference server stay on the host; arguments go to `playwright test` (`npm run test:browser:webkit -- smoke.spec.ts`); needs Docker; run `npm run build` first |
| `npm run serve:test` | The reference server (`test/server/`) on a free port, for trying Tessera by hand; prints the URL |
| `npm run check` | typecheck, lint, test, build and size, in that order, stopping at the first failure |

`npm run check` is the gate every change passes. `RELEASING.md` says how a release is cut, and
`test/probes/` holds probes of the engines that never run with the suite (`playwright.probes.config.ts`). Lint also refuses what would weaken it:
`@ts-ignore`, `@ts-expect-error` outside `test/`, `eslint-disable` comments (inline config is
off, and the warning it raises fails lint), and skipped or focused Vitest tests. Playwright
refuses a focused test with `forbidOnly`. One rule is off for one file: `no-implied-eval` in
`src/expression.ts`, the trusted expression engine (`docs/decisions.md`).

## License

MIT (`LICENSE`). Tessera includes code ported from jqstar, also MIT; `NOTICE` names it.
