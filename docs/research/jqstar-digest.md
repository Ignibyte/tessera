# jqstar digest

A read of `Ignibyte/jqstar` at HEAD `f17952b` (v1.1.0, 73 commits) for ticket #12, made
2026-10-19 by a research agent that read the core in full and the rest in outline. Citations are
`file:line` in that repo. "Inferred" marks a conclusion rather than something read.

## Headline findings

1. **The runtime core is about 10k of the 48k lines.** The UI catalog is 27,197 lines (49 files in
   `src/ui/`) and is already jQuery-free.
2. **jQuery is structural in only three places:**
   - `runtime.ts`: the `$.fn.star` plugin and `$.data` instance storage.
   - `declarative.ts`: DOM operations through jQuery (`val`, `html`, `toggle`, class, `attr`,
     `prop`, `css`, `on`/`off`/`trigger`).
   - The jQuery-only event surface (`jquery-star:error`, `datastar-fetch`, `jquery-star:fetch`,
     `jquery-star:sse`).

   The kernel, patching, reactivity, protocols, SSE, middleware and observation code do not
   depend on it.
3. **Native navigation, forms, regions, history and prefetch exist only as specs** (tickets
   0024–0029), all declined by a measured decision. Ticket 0028 is a usable starting spec, but it
   assumed full-document responses containing regions and put a "fragment-only server protocol"
   out of scope (`docs/tickets/0028-add-navigation-regions.md:91-94`).
4. **Write-replay defect in the shipped code.** With the default `retry: "auto"`, a network-level
   failure is retried up to 10 times for every method, POST included (`src/fetch.ts:262-275`,
   defaults `:349-352`). `fetch` also follows redirects by default (`:402-408`). Both contradict
   the no-replay rule in ticket 0027.
5. **Signals are scoped per application root, not per page as in Datastar.** Shared state goes
   through a per-document `stores` namespace. This bears directly on old AIC's Datastar
   global-signal collision (AIC #423/#436).

## 1. Subsystem map

| File | Lines | Responsibility | jQuery depth |
|---|---|---|---|
| `kernel.ts` | 1055 | Document claim, application records, render transactions, resource ledger, enhancement barrier, disposal | Incidental: stores `$` (`:149`, `:179`) |
| `patch.ts` | 232 | `patchSignals` deep merge; `patchElements` (8 modes, Idiomorph, preservation) | None |
| `reactivity.ts` | 192 | Proxy signals, effects, microtask scheduler, `nextUpdate` | None |
| `expression.ts` | 259 | Trusted engine (`new Function` with `with`), scope proxy | Incidental: `$`, `$el`, `$root` in scope (`:66-75`) |
| `expression-runtime.ts` | 115 | Branded action/helper results (used by the CSP engine) | None |
| `expression-types.ts` | 23 | Engine interface | None |
| `directive.ts` | 370 | Directive and helper registry, matchers, built-ins `data-text`, `data-destroy` | Incidental (`:46`, `:259`) |
| `declarative.ts` | 1017 | Attribute applications: signals, computed, built-in directives, MutationObserver rescans | Structural but replaceable: 44 jQuery calls |
| `fetch.ts` | 593 | Backend actions, cancellation keys, retry loop, pending/error signals | Structural for events: `$.Event` plus `.trigger` (`:97-119`) |
| `protocol.ts` | 963 | Profile registry, request writer, response metadata, exclusive body lease | None |
| `protocol-generic.ts` | 108 | `core.generic` profile (JSON/HTML) | None |
| `protocol-datastar.ts` | 178 | `core.datastar` profile (headers, signal encoding, SSE events) | None |
| `sse.ts` | 93 | Incremental SSE parser | None |
| `render-adapter.ts` | 90 | Seam for external renderers (Turbo, htmx) | Structural: boots roots through `$.fn.star` (`:37-39`) |
| `disposal.ts` | 91 | Frozen disposal report and aggregate error | None |
| `dom.ts` | 37 | Cross-realm node predicates | None |
| `request-middleware.ts` | 807 | Once-per-request onion with branded outcomes and final policy validation | None |
| `request-headers.ts` | 32 | Browser-owned header predicate | None |
| `observation.ts` | 661 | Operation hub (action, request, store records) | None |
| `runtime.ts` | 773 | `installStarRuntime`, behavior sheets, `$.fn.star` | Structural |
| `core.ts` / `index.ts` | 172 / 307 | Entries; `index.ts` imports jQuery and auto-installs | `index.ts` structural |
| `registry.ts` | 92 | Namespaced action registry | None |
| `plugin.ts` | 826 | Transactional plugin host, semver ranges, dependency graph | None |
| `stores.ts` (+ types) | 881 + 67 | Per-kernel shared reactive stores | None |
| `csp/*` + `csp.ts` | 2,964 + 52 | Finite expression engine (no eval) | Capability table of jQuery methods in `evaluator.ts` |
| `datastar.ts`, `datastar/testing.ts` | 18 / 77 | Official plugin wrapper; SDK test fixtures | None |

Skimmed: `turbo.ts` (677) and `htmx.ts` (1,373) translate host events into render transactions;
`persist/` (~1,300) persists stores; `inspect/` (~1,000) is the inspector; `testing/` (~1,450)
is the harness and conformance runners.

## 2. Render transaction and ownership (`kernel.ts`)

- **Topology.** One kernel per `Document` (a `WeakMap` claim, `:130`, `:182-187`). An
  "application" is a booted root (`$(el).star()` or `$.star.boot()`); nothing auto-discovers roots.
- **Resource ledger.** `own(kind, owner, cleanup, root?)` (`:704-736`) records each resource.
  Records are removed before their cleanup runs, so cleanup runs at most once. Element-scoped
  records are released when their element leaves the document, driven by a lazily created
  MutationObserver (`:680-721`). `canOwn` refuses acquisitions inside an active removal boundary.
- **`beginRender(root, {boot, preserveRoots})`** (`:313-600`):
  1. Begin: validate the root; collect preserved roots (`[data-jqs-preserve]` plus caller roots);
     capture focus only if inside a preserved root; allocate a monotonic `operationId`; add a
     barrier promise; register the transaction as a `task` resource so disposal abandons it.
  2. `beforeRemove(node)` (`:560-582`), once per outgoing node: skip preserved roots; release
     element-scoped resources; destroy every application rooted inside, deepest first, while the
     DOM is still connected; ancestors drop their directive records for the subtree.
  3. The host mutates the DOM.
  4. `commit(incomingRoots)` (`:583-589`): release preserved roots that disappeared (reported as
     an error); boot incoming roots without an owner; restore focus with `preventScroll`; settle
     asynchronously (microtasks and `nextUpdate`, an optional focus retry only for the latest
     render, release preservation counts, resolve the barrier); throw aggregated errors.
  5. `fail(error)` runs the same cleanup and rethrows.
- **Preservation.** Idiomorph skips `[data-ignore-morph]` and `[data-jqs-preserve]`
  (`patch.ts:79-88`); direct replace/remove skips a target containing a preserved root; morph
  options are `ignoreActiveValue: true, restoreFocus: true`.
- **Barrier.** `whenEnhanced()` (`:602-616`) waits until no render or task barriers are pending.
- **Disposal** (`:742-818`): applications, then ledger records in reverse, the operation hub,
  plugins, middleware, protocols, actions, the expression engine and the document claim; repeat
  calls return the same report.
- **Ordering.** Internal patch transactions are synchronous with monotonic ids. **There is no
  region- or target-level supersession**: a late response for a target simply renders.
  Supersession exists only per element and per `"${method} ${url}"` key (`fetch.ts:177-206`).
  SSE events commit one at a time, each in its own transaction, with no atomic grouping.

## 3. Reactive model and scoping

- Cached Proxies over raw objects; dependency sets keyed target → key → effects. Only `get`,
  `set` and `deleteProperty` are trapped: `in` checks and iteration are not tracked.
- One module-global effect queue flushed in a microtask, shared by all kernels in a realm.
- Computed values are not memoized.
- **Scope:** one reactive `state` per application root (`declarative.ts:215`); every
  `data-signals` inside it deep-merges into it. An application rooted on a plain `data-jqs=""`
  island skips descendant islands. Shared state is the per-document `stores` namespace.
- **Collisions** are avoided only by separate islands or naming discipline. `_`-prefixed signals
  stay out of server payloads but are not namespaced. The Datastar profile sends all filtered
  signals of the initiating application.

## 4. Directive vocabulary

Datastar-compatible in syntax: `data-signals="{…}"` (object form only), `data-computed:name`,
`data-on:event__mods`, `data-text`, `data-show`, `data-class`, `data-attr:name`,
`data-style:name`, `data-bind:path` (handles checkbox arrays, radio, multiple select),
`data-effect`, `data-init`, `data-ignore`, `data-ignore-morph`, and the actions
`@get @post @put @patch @delete`.

`data-on` modifiers: `prevent stop once self outside window document capture passive
debounce[.N] throttle[.N]`, plus key filters `enter escape space tab up down left right`.

jqstar-specific: `data-html` (unsanitized), `data-prop:name`, `data-destroy`, `data-jqs` roots,
`data-jqs-preserve`, the UI attributes `data-part`, `data-state`, `data-variant`, and plugin
directives.

Absent Datastar v1 attributes (the agent's knowledge of Datastar, not the repo): `data-ref`,
`data-indicator`, `data-json-signals`, `data-on-intersect`, `data-on-interval`,
`data-on-signal-patch`, `data-preserve-attr`, `data-signals:*`, and the Pro attributes.

In expressions `$` is jQuery and `$name` is a signal, which diverges from Datastar.

## 5. Expression engine and the CSP-safe mode

- **Trusted engine** (`expression.ts`): `new Function("scope", "with (scope) { return (src); }")`;
  statements compile to async functions bound to the element; `@name(args)` compiles to an action
  call. Inferred: unknown identifiers fall through to globals.
- **No-eval engine** (`csp/`, contract `jqstar-csp-expression/1`): tokenizer → closed EBNF parser
  → immutable AST → capability evaluator. No coercion, `===` only, fixed l-values, denied magic
  keys, hard limits (2,048 characters, 512 tokens, 256 nodes, 128 steps), an LRU cache and
  diagnostics with spans. Installed through the same 4-method engine seam. Its jQuery coupling is
  one removable island.

## 6. Protocols, requests, middleware

- **Request construction** (`fetch.ts:304-571`): resolve the URL; pick the profile; for forms,
  `new FormData(form)` **without the submitter**; build the payload; abort any earlier request on
  the same key (`"superseded"`); set `pending`; run middleware once; GET waits for page
  visibility; the retry loop. **Only `response.ok` responses reach a profile**, so a 422 HTML body
  is never rendered.
- **Generic profile:** `Accept: text/html, application/json`; JSON patches signals; HTML patches
  elements with the action's `target` and `mode`; 204/205 are no-ops.
- **Patch modes:** `outer` (default), `inner`, `replace`, `prepend`, `append`, `before`, `after`,
  `remove`. Without a selector, `outer`/`replace`/`remove` match top-level fragment elements by
  `id`. Markup is parsed inertly through `<template>` or `DOMParser`.
- **Datastar profile:** `Datastar-Request: true`; signals in `?datastar=` for GET or a JSON body;
  SSE events `datastar-patch-elements` (selector, mode, namespace, view transition, multi-line
  elements) and `datastar-patch-signals` (JSON5, `onlyIfMissing`). SSE `id` and `retry` are
  parsed and unused: no reconnect, no Last-Event-ID. `executeScript` is unsupported.
- **Body lease** (`protocol.ts:601-779`): bounded frozen metadata; exactly one adapter matches;
  the body can be claimed once.
- **Middleware:** an onion run once per logical request; the final policy allows only a changed
  same-origin path or query and added non-browser headers.
- **Ticket 0027's no-replay contract** (declined, design only): enhance only same-origin POST;
  use the real submitter (`new FormData(form, submitter)`, honoring `formaction` and friends);
  middleware cannot change method, origin, encoding or body; follow only a same-origin 303 as a
  new GET visit, never 307/308; commit a 422/409 HTML response in place and focus the error
  summary; after dispatch any failure is "indeterminate": no retry, no resubmit; block a second
  submit of the same form. The current `fetch.ts` meets none of the redirect, submitter or
  no-retry points.

## 7. Navigation

- **What `NATIVE_NAVIGATION.md` measured:** plain browser navigation, plain documents with
  jqstar, Turbo 8.0.x and htmx 2.0.x with bridges; 3 engines; 28 frozen scenarios; 840 flows; all
  498 applicable configured flows passed; native build estimates of 320–800 h (documents),
  160–400 h (forms), 80–200 h (regions), 120–320 h (prefetch).
- **Decision:** keep browser navigation plus the bridges and decline 0024–0029. It is a
  product-fit verdict for a backend-agnostic library (no demand, host configuration closed every
  gap), not a finding that native regions are infeasible.
- **Ticket 0028 (matching navigation regions), condensed** (verbatim in the jqstar repo):
  - `data-jqs-region="name"` with one safe id grammar, uniqueness and containment rules, stable
    roots, explicit target, whole-document and opt-out attributes. Never a CSS selector.
  - Links and forms default to their nearest region, may name one, or escape to document
    navigation; targets are validated before claim and again before commit; nested or
    overlapping operations follow one queue/supersession rule.
  - A region adds metadata to the document request; it does not own a parallel protocol.
  - Commit exactly one matching region from the staged same-origin full document, after
    validating names, nesting, limits, permanent roots and the final URL.
  - Keep the region root, morph its content through one render transaction, destroy outgoing
    nested applications first, mount incoming roots once.
  - On a mismatch, promote the already-fetched document to a whole-document commit; never
    re-request, never replay a write.
  - History stores only the region name and action; back and forward fetch fresh content.
  - Focus outside the region stays; removed internal focus goes to server autofocus or error,
    then the region heading or root. Scrolling only by policy.
  - Per-region `aria-busy`, state and error; optional one-shot or visibility-triggered lazy
    loading from a same-origin GET.
  - Out of scope there: client routes, caches, transitions, **a fragment-only server protocol**,
    streaming region commits, polling, multi-region atomic commit.
  - Key acceptance criterion AC-08: disjoint operations coexist; same, ancestor or descendant
    targets follow a frozen reject/queue/supersede policy; late responses cannot mutate removed,
    retargeted or newer regions.
- **Ticket 0026 (history, focus, scroll):** prepare → capture the current entry → mutate body and
  head → push or replace URL, title and state before enhancement → enhance → focus → scroll.
  Popstate fetches fresh; `scrollRestoration = "manual"` only while the runtime owns navigation;
  focus precedence server → stored key → fragment target → main heading → body.

## 8. Stores, persistence, UI, inspector

Optional modules depend on the core, not the other way round. Stores map naturally onto named
shared scopes. Persistence depends on stores. The UI catalog (102 recipes, 49 controllers) is
jQuery-free with heavy per-controller ownership hardening. The inspector reads kernel metadata;
the core never imports it.

## 9. Test infrastructure worth reusing

- The navigation fixture (`test/fixtures/navigation-decision/`, 1,607 lines) with 28 frozen
  scenarios, each with a no-JS baseline: a ready acceptance matrix for native navigation.
- Property tests (fast-check, fixed seed, regression file) for SSE chunk boundaries, protocol,
  middleware, runtime, stores.
- A strict FIFO response controller, API Extractor reports, size budgets with a ratchet,
  dependency-cruiser boundaries, Playwright in 3 engines with axe.
- Avoid importing the process weight: ticket 0006 runs to 7,403 lines.

## 10. Extraction plan: a jQuery-free, region-first runtime

Target: direct visits get a full document; enhanced navigation, form posts and actions get only
the changed regions as HTML fragments keyed by a region identity attribute; SSE carries the same
fragments; signals have explicit scopes.

| File | Disposition | Lines kept (est.) |
|---|---|---|
| `kernel.ts` | Keep the render transaction, ledger, barrier and disposal; drop `$`, metadata and plugin plumbing | ~600 |
| `patch.ts` | Keep morph, preservation and namespaces; replace id/selector targeting with exact region matching | ~200 |
| `reactivity.ts` | Keep; add `has`/`ownKeys` tracking and computed memoization | ~250 |
| `expression.ts` | Keep; remove jQuery bindings; consider closing the global fall-through | ~180 |
| `expression-types.ts`, `expression-runtime.ts` | Keep | ~140 |
| `directive.ts` | Keep the registry; context without `$element` | ~300 |
| `declarative.ts` | Rewrite: DOM instead of 44 jQuery calls, built-ins as registry definitions, scope-aware state, native events | ~750 |
| `fetch.ts` | Rewrite: no retry for non-GET, manual redirects, render 4xx HTML, submitter-aware forms, region-level supersession | ~400 |
| `protocol.ts` | Keep the body lease; two fixed profiles instead of an open registry | ~450 |
| `protocol-generic.ts` | Replace with the region-HTML profile | ~150 |
| `protocol-datastar.ts` | Keep the event names; strict JSON instead of JSON5 | ~160 |
| `sse.ts` | Keep; add bare-CR line endings | ~100 |
| `render-adapter.ts` | Keep, small | ~70 |
| `disposal.ts`, `dom.ts`, `request-headers.ts`, `registry.ts`, value checks, errors | Keep | ~330 |
| `request-middleware.ts` | Keep once-per-request and the final policy (CSRF header injection) | ~250 |
| `observation.ts` | Keep, slim; add visit and region operations | ~250 |
| `plugin.ts` | Slim heavily or drop (registration can happen at build time) | ~0–250 |
| `runtime.ts`, `core.ts`, `index.ts`, `compatibility.ts`, `trusted-runtime.ts` | Replace with a new `createRuntime(document)` entry | ~200 new |
| `types.ts` | Rewrite | ~250 |
| `stores.ts` | Optional, later, as named shared scopes | ~500 |
| `csp/*` | Optional module without the jQuery island | ~2,400 |
| `turbo.ts`, `htmx.ts`, `ui/`, `persist/`, `inspect/`, metadata, Datastar test fixtures | Drop | 0 |

New code, each designed in a declined jqstar ticket and none implemented: visit interception
(0024, ~350), form submission without replay (0027, ~350), region targeting and commit (0028,
~400), history, focus, scroll and busy state (0026, ~450), long-lived SSE with reconnect and
Last-Event-ID (~300), explicit scopes (~250), title and tracked-asset reload policy (0025, ~150),
lazy regions (~120).

**Hardest parts:**
1. Ownership across replacement: solved in `kernel.ts`; port it nearly verbatim.
2. Region-level concurrency: not solved; needs region generations and the 0028 AC-08 table.
3. Fragment-only responses versus progressive enhancement: a missing region on a read falls back
   to a full visit; on a write the server answers 303 to a GET. Fragment responses need `Vary` on
   the region request header.
4. No write replay: specified in 0027, violated by the current code; fix the transport first.
5. History, focus and scroll ordering: 0026.
6. Head changes under enhanced navigation: 0025 (tracked assets force a full reload; never run
   fetched scripts).
7. SSE as a durable channel: jqstar has only one-shot response streams.
8. Scopes versus the Datastar wire format, which sends every signal.

**Size:** about 7,700 lines of TypeScript for the core runtime (about 5,300 kept and rewritten,
2,400 new), plus optional modules (finite expression engine ~2,400, stores ~500) and Idiomorph.
A lean variant without plugin transactions, the middleware onion, the operation hub and the
render adapter comes to roughly 5,000–5,500 lines. Estimates, not measurements.

Toolchain note: keep the runtime's `package.json` out of the repo root (old AIC's hooks deadlock
on a root `package.json`, AIC #292).
