# Livewire digest

A source read of `livewire/livewire` for ticket #12, made 2026-10-19 by a research agent: default
branch `4.x` at `5383ac73` (2026-10-07), newest tag `v4.4.7`, with `v3.8.10` checked for
differences. Paths are relative to that repo. The repo's own `docs/the-livewire-protocol.md` is
stale; the source is the truth. "Inferred" marks a conclusion rather than something read.

## v4 against v3

v4 moved the update endpoint to a secret-derived path (`/livewire-{8 hex of
sha256(app.key.'livewire-endpoint')}/update`), added a required-header guard, payload limits, rate
limiting of checksum failures and a class denylist, rewrote the client request layer (Action →
Message → Request with an interceptor API), and added islands, slots as fragments, `.async`,
`.renderless`, `wire:ref`, `wire:sort`, `wire:intersect` and View Transitions for
`wire:transition`.

## 1. Request lifecycle

**First render** (`HandleComponents::mount()`, `src/Mechanisms/HandleComponents/HandleComponents.php:36-85`):
mount hooks, render, inject `wire:id`/`wire:name`, dehydrate, then inject `wire:snapshot` and
`wire:effects` (HTML-escaped JSON) on the single required root element. A full-page component is
wrapped in its layout only on that first GET.

The client builds a `Component` from each snapshot (`js/component.js:7-52`) holding three copies of
its data: `canonical` (last from the server), `ephemeral` (user edits) and `reactive` (an Alpine
wrapper). `$wire` is a Proxy over them.

**Updates** go to `POST {prefix}/update` with the `web` middleware and a required `X-Livewire`
header (404 without it). For each component the server verifies the checksum, hydrates public
properties, applies `updates` (then the `updated*` hooks), runs `calls` (public methods declared on
the subclass only), renders into the `html` effect and takes a new snapshot. The client buffers
actions for **5 ms** and groups them into one request across components.

Request:

```json
{
  "_token": "csrf…",
  "components": [{
    "snapshot": "{\"data\":{…},\"memo\":{\"id\":\"…\",\"name\":\"counter\",…,\"children\":{…}},\"checksum\":\"…\"}",
    "updates": { "title": "Hello", "tags.1": "b", "tags.2": "__rm__" },
    "calls": [{ "method": "save", "params": [5], "metadata": {} }]
  }]
}
```

Response:

```json
{
  "components": [
    { "snapshot": "…", "effects": { "html": "<div wire:id=\"…\">…</div>", "returns": [null],
      "dispatches": [{"name":"saved","params":{"id":5}}], "redirect": "/posts/5" } },
    { "skip": true, "id": "…" }
  ],
  "assets": []
}
```

Effect keys include `html`, `returns`, `dispatches`, `listeners`, `redirect`,
`redirectUsingNavigate`, `download`, `js`, `url`, `scripts`, `islandFragments`, `slotFragments`
and `transition`. A 419 asks "page expired, refresh?"; a non-JSON body shows in an HTML modal.

## 2. State and its security

- Public properties are dehydrated; anything not primitive becomes a tuple
  `[value, {s: <synth>, …}]`. Synthesizers cover arrays, stdClass, Stringable, collections,
  dates, backed enums, Eloquent models (sent as `{class, key}` and re-queried), form objects,
  uploads and `Wireable`.
- The checksum is `hash_hmac('sha256', snapshot without checksum and memo.children, APP_KEY)`.
  Ten failures in ten minutes per IP returns 429.
- `#[Locked]` properties throw on update. Auth and route-binding middleware are re-run on update
  against a fake request built from `memo.path` (`PersistentMiddleware`). A release token forces a
  refresh after a deploy. Validation errors live in `memo.errors`.
- **An attacker can** set any unlocked public property to any JSON value (mass assignment), call
  any public method on the subclass with arbitrary params, trigger any declared listener, edit
  `memo.children` (regex-checked only), read all public state (signed, not encrypted), and
  (inferred) replay any snapshot ever issued: it has no expiry and isn't bound to a session.
- **An attacker cannot** change `data` or `memo`, choose a synthesizer or class, or exceed the
  payload limits (1 MB, 50 calls, 200 components, path depth 10).

## 3. DOM updates

- Livewire bundles Alpine's morph (`js/morph.js:7-69`): parse the new HTML into a wrapper of the
  parent's tag type, copy the snapshot over, replace child-component stubs with **clones of the
  existing children**, then `Alpine.morph`. Islands and slots use `morphBetween` two comment
  markers.
- Keys: `wire:id`, then `wire:key`, then `id`, matched among siblings only. Lookahead is off in
  the code (`morph.js:207`) though the docs still advertise it.
- A Blade precompiler wraps `@if`, `@foreach` and similar in `<!--[if BLOCK]><![endif]-->` …
  `<!--[if ENDBLOCK]><![endif]-->` markers so each block morphs as one unit; loops get
  deterministic keys.
- Child components survive a parent re-render because the parent emits only an empty stub for a
  known child key and the morph skips any element with a different `wire:id`.
- Documented failure: inserting an element between siblings reuses the wrong element, losing or
  duplicating state; the remedies are a wrapper that is always present, `wire:key`, or
  `wire:replace`.

## 4. Directives

`wire:<event>` (with `.async`, `.renderless`, `.append`, `.prepend`), `wire:model` (deferred by
default; `.live`, `.blur`, `.change`, `.enter`, `.debounce`, `.throttle`, `.number`, `.boolean`,
`.fill`), `wire:loading` (+ `wire:target`, delays), `wire:dirty`, `wire:poll`, `wire:init`,
`wire:intersect`, `wire:navigate` (`.hover`, `.preserve-scroll`), `wire:current`, `wire:stream`,
`wire:offline`, `wire:transition`, `wire:ignore`, `wire:replace`, `wire:confirm`, `wire:show`,
`wire:text`, `wire:bind`, `wire:cloak`, `wire:key`, `wire:ref`, `wire:island`, `wire:sort`, and
`data-loading` on the element that started a request. Blade adds `@island`, `@placeholder`,
`@persist`, `@teleport`, and `lazy`/`defer` on nested components.

## 5. Islands (v4)

- `IslandCompiler` pulls each `@island … @endisland` body out into its own cached view with a
  token of `<hash of view path>-<occurrence>`. That extraction is why islands can't sit inside
  loops or conditionals or see local template variables.
- Rendered between `<!--[if FRAGMENT:type=island|name=…|token=…|mode=morph]><![endif]-->` and a
  matching end marker. Later full renders emit them as empty `mode=skip` markers unless declared
  `always`. `lazy` and `defer` render placeholders that load later.
- An action inside an island still hydrates the **whole component**, then skips the component
  render and renders only the island into `islandFragments`. The client applies it with
  `morphBetween`, or appends or prepends for feeds.
- Islands get their own request scope and run in parallel; the docs warn "the last response to
  return will win".

## 6. Navigation (`wire:navigate`)

- Fetches the **full page** with `X-Livewire-Navigate: 1`; nothing on the server reads the header.
- Swaps with `document.body.replaceWith(newBody)` (a replace, not a morph), tearing Alpine down
  and starting it again.
- Head merge: assets compared by normalized outerHTML; new ones appended, old ones **never
  removed** (livewire#6824); title and meta replaced; a `data-navigate-track` asset with a changed
  query string forces a full reload; body scripts re-run unless `data-navigate-once`.
- `@persist` detaches the same DOM node before the swap and puts it back after.
- Prefetch on **mousedown** (`.hover` after 60 ms), cached 30 s. History keeps the outerHTML of up
  to 10 pages in memory, with component snapshots written back first, so Back restores state.
- Scroll positions stored as data attributes; a progress bar after 150 ms; optional View
  Transitions; `redirect(navigate: true)` navigates without a full load.

## 7. Streaming

`$this->stream(…)->to(name|el|ref)` sends `Content-Type: text/event-stream` but **is not SSE**: it
echoes JSON chunks `{"stream":true,"body":{…},"endStream":true}` and ends with the normal JSON
response, and the client splits them with a regex. There is no `EventSource` anywhere; the only
push channel is optional Laravel Echo over WebSockets. Inferred bug: a new `TextDecoder` per chunk
corrupts multi-byte characters split across chunks. A stream can reach only named targets, refs or
selectors inside one component, set with `innerHTML` (no morph); the most it can replace is an
island.

## 8. Bundling, lazy loading, polling, uploads, events

- **Bundling:** 5 ms buffer into one request; new actions for a scope wait for the in-flight one;
  `.async` passes through; polls drop if a request is in flight and are cancelled by user
  actions; overlapping `model.live` requests run in parallel and older responses are discarded
  (`js/request/index.js:517-534`).
- **Lazy loading:** a placeholder calls `__lazyLoad` on intersect or init; the mount params are
  signed inside a throwaway checksummed snapshot.
- **Polling:** default 2 s; one shared clock per interval; 95% of ticks skipped in a background
  tab; paused when invisible or offline; stops when the element is removed.
- **Uploads:** sign, upload to temporary storage with progress, then finish with a signed
  reference. Inferred: the path signature is truncated to 8 hex characters.
- **Events:** server `dispatch()` becomes DOM CustomEvents; each listening component then makes a
  **second request** to handle it.
- **JS API:** `Livewire.hook()` lifecycle hooks, v4 interceptors (`onSend`, `onSuccess`,
  `onMorph`, `onRender`, …) and custom directives. Alpine is bundled; `$wire` is an Alpine magic;
  `entangle` binds Alpine and Livewire properties.

## 9. Size

- **JavaScript:** `js/` is 9,897 lines without specs. The built bundle is 17,543 lines, about
  10,600 of them Alpine and plugins; minified 262 KB, about 86 KB gzipped.
- **PHP:** `src/` is about 22,200 lines in 78 feature folders, with about 63,000 lines of tests.
  About 20 features keep static state that a long-running worker must flush between requests.

## Lessons for a stateless, region-first framework

**Can Livewire send the whole page back as an update? No.** An update response is JSON keyed by
component, and a stream reaches only targets inside one component. The only whole-page path is a
redirect or `redirect(navigate: true)`, which makes a second GET and swaps `<body>`.

**What a stateless design gets for free:**
- No snapshot attack surface: no HMAC, synthesizers, gadget denylist, payload cap or replayable
  state.
- Real middleware on every request.
- Safe deploys without release tokens.
- No mass assignment.
- Whole-page updates on the same code path as one region.
- No static state to flush in a worker.

**What it loses, and how to offer it anyway:**
- **Server UI state** lives in the URL, form fields, client signals sent with requests, or the
  session.
- **Typed hydration** becomes explicit request mapping.
- **Validation errors** come back with the re-rendered form region.
- **Dirty tracking** diffs client signals locally.
- **Return values** become a JSON mode or a signal patch.
- **Events get cheaper:** one response carries every affected region, with no second round trip.
- **Polling** is a timed GET of a region.
- **Lazy regions** load from a URL, with authorization re-checked in the controller.
- **Optimistic UI** comes from local signals corrected by the server fragment.
- **Parallel regions** need a version stamp so stale fragments are dropped.

**Worth copying:**
1. Comment-delimited fragments with `name|token|mode` and `morphBetween`, so a region needs no
   wrapper and can append or prepend (`HandlesIslands.php:406-424`, `js/fragment.js`).
2. Identity fixed at compile time (`hash(view path)-occurrence`), stable across renders and
   deploys.
3. Morph markers emitted by the template compiler around control flow; AIC's template compiler
   can do it from the AST instead of a regex.
4. Morph configuration: keyed by region id, then key, then `id`; ignore and replace flags; region
   roots skipped by an enclosing morph.
5. Request coordination: the 5 ms buffer, per-scope queuing, polls yielding to actions, superseded
   responses dropped.
6. Polling heuristics.
7. Navigation details: prefetch on mousedown, a small back cache, head merge by normalized
   outerHTML, tracked-asset reload, run-once scripts, persisted nodes, scroll restore, a delayed
   progress bar. Prefer a morph to replacing the body.
8. Endpoint hardening that has nothing to do with snapshots: a required header, payload limits, a
   419 "page expired" prompt.
9. An interceptor lifecycle API as the extension seam, and `data-loading` on the initiating
   element.
10. The upload flow shape, with full-length MACs.

**Pitfalls to avoid:**
- Signed state in the DOM, and mass assignment.
- Morph heuristics the docs overstate; make keys and markers structural.
- A fake event stream: use real SSE framing with one streaming decoder, and let a stream carry
  whole regions or the whole page.
- Two round trips per cross-component event.
- Compile-time extraction rules that ban regions in loops; make regions controller-level instead.
- Head assets never removed across navigations.
- Static request state needing a manual flush.
