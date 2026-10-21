# Changelog

## Unreleased

- `data-attr` takes `__case` too, so `data-attr:view-box__case.camel` writes SVG's `viewBox`
  (#26).

- The `__case` modifier (`camel`, `kebab`, `snake`, `pascal`) on `data-on`, so a camelCase custom
  event can be heard (`data-on:item-selected__case.camel` listens to `itemSelected`), and on
  `data-computed`, `data-ref` and `data-bind`, which stay camelCase by default (#23).

- A computed value that recomputes to an `Object.is`-equal value no longer re-runs what read it:
  computed values are push-pull, with versions, so a chain stops at the first unchanged value,
  while batching and laziness stay (#21).
- Browser tests name controller channels and server log keys per test (`test/browser/names.ts`),
  not per worker: two specs using the same name in one worker shared a channel and saw each
  other's requests (#21).

- Lazy regions, polling, prefetch and persisted nodes (`src/lazy.ts`, `src/polling.ts`,
  `src/watch.ts`): `data-lazy` loads once, `data-lazy__visible` when in view; `data-poll`
  refreshes on shared clocks (`__5s`, `__750ms`), one tick in 20 without window focus, none while
  hidden or offline; enhanced links prefetch on mousedown, or after a hover with
  `data-prefetch="hover"`, and the click uses the prefetched answer once (`transport.prefetch`);
  `data-permanent` elements keep their node through fragment morphs too (#17).

- A commit no longer makes fragments for the targets around it stale: a visit of a region lands,
  content and URL, when a stream event or another answer commits inside that region while the
  visit is in flight; a late fragment for the inner target is still dropped (#25).

- Durable streams (`src/streams.ts`): `data-stream` and `streams.open` hold one `fetch`-read SSE
  stream per URL, in the kernel's ledger; reconnects with `Last-Event-ID` after `retry`, doubling
  to 30 s; stops on `tessera-close`, a `204`, the protocol's fatal statuses and the last holder
  leaving; pauses while hidden on `Tessera-Stream-Pause: hidden`. Events commit through the
  transport (`connect`, `commitStream`), so generations apply. The reference stream also morphs a
  component and patches a signal, can drop its first connection and logs connections (#16).

- Forms without replay (`src/forms.ts`): same-origin form submits go through the transport with
  their submitter; a second submit in flight is blocked; a 422 or 409 focuses the error summary or
  the first invalid field; an indeterminate write shows a message (`tessera:indeterminate`);
  interceptors cannot change a body's encoding (#15).
- `Tessera-Write-Id` on every write, one UUID per submission, so a server can answer a browser's
  own repeat of a write without applying it twice (`docs/protocol.md` section 5.8); the reference
  server deduplicates its writes by id (#24).
- History, focus and scroll (`src/history.ts`): visits push or replace entries holding their targets;
  Back and Forward fetch fresh; focus by the server's `autofocus`, a stored key
  (`data-focus-key`), the fragment, the main heading or the body; scroll to the top, to the
  fragment, or restored on Back and Forward. The patcher keeps a focused field's value without
  freezing other focused elements (#14).
- Enhanced navigation (`src/navigation.ts`, `src/head.ts`, `src/progress.ts`): same-origin link
  clicks become visits; a whole document is committed in place by the head policy of protocol
  section 9 and a body morph that keeps `data-permanent` elements; a changed tracked asset or
  `<base>` loads in full; a delayed progress bar (#13).
- Coordination (`src/coordination.ts`): the table for overlapping requests, frozen in
  `docs/protocol.md` section 4.6 (writes queue and are never aborted, reads supersede or queue,
  polls yield), generations that drop a late fragment for a target a newer commit touched, and
  `aria-busy` on pending targets with `data-loading` on the initiating element (#12).
- The transport (`src/transport.ts`, rewritten from jqstar's `fetch.ts`; `src/body.ts`): requests as
  protocol section 4 builds them, writes sent once and reported indeterminate on any failure after
  dispatch, only GETs retried, `Tessera-Location` followed as a fresh GET visit, 4xx and 5xx
  fragments committed, the submitter and its overrides in form data, supersession by target, the
  CSRF header, `tessera:expired` for 419, the 5 ms buffer and interceptors. The reference server
  can drop a held connection and close every connection (#11).
- The SSE parser (`src/sse.ts`, ported from jqstar): incremental over bytes or text split anywhere,
  CRLF, LF and bare CR line endings, a leading BOM, `id` and `retry` as the WHATWG algorithm
  has them, and `dataFields` for the protocol's `data: KEY VALUE` lines (#10).
- Patching (`src/patch.ts`, ported from jqstar): fragments morphed into a region or a component
  found by identity, in the modes morph, inner, append, prepend and remove, through one render
  transaction each; blocks pair by position, `data-ignore-morph` survives, focus and typed values
  stay, directives re-apply after a morph, and signal scopes survive a morph that replaces their
  marker. Signal patches merge into a target's scope (#9).
- Signal scopes (`src/scopes.ts`): the document, each region and each component own one; reads go
  innermost first, declarations shadow, `data-signals__region` and `__document` reach out, scopes
  are owned through the kernel and survive moves, and `payload` with `encodeSignals` builds
  `Tessera-Signals` from the initiating element's chain only, without `_` names, computed
  signals, elements or other non-JSON values (#8). The protocol's 4.4 example now escapes
  `café` as its own rule says.
- The attributes (`src/attributes.ts`, `src/builtins.ts`, rewritten from jqstar's `declarative.ts`):
  Datastar's vocabulary on the DOM, each built-in a registry definition, every listener, effect
  and cleanup owned through the kernel and released exactly once, `data-ref`, and `tessera:error`
  for failures. Values read from signals are reactive only when they are plain objects or arrays
  (#7).
- Expressions and the directive registry (`src/expression.ts`, `src/directive.ts`, `src/actions.ts`,
  ported from jqstar): a closed scope with no fall-through to page globals, `@get` to `@delete`
  anywhere in an expression through an action seam, and directive names parsed into a key and
  modifiers (#6).
- Reactivity (`src/reactivity.ts`, ported from jqstar): Proxy signals that also track `in` and key
  iteration, array mutators that do not re-run their own effect, memoized computed values, and
  one effect scheduler per runtime, which the kernel's `flush` option waits on (#5).
- The kernel (`src/kernel.ts`, ported from jqstar): one per Document, a resource ledger that
  releases each resource once (on release, on its root leaving the page, or at disposal), render
  transactions that tear down deepest first and keep preserved roots and their focus, the
  enhancement barrier, and disposal with a frozen report (#4).
- The reference server (`test/server/`, `npm run serve:test`): fixture pages on two layouts,
  fragments or full documents per protocol 5.1, the form's 303, 422, 409 and 419, a resumable SSE
  stream, a slow endpoint and a controller that holds requests until a test answers them. Playwright
  starts it and runs Chromium and Firefox; WebKit does not run on the dev box (#3).
- The protocol, version 0 (`docs/protocol.md`): identities, request and response headers,
  fragment responses, status codes, SSE events, caching, the head policy and worked examples (#2).
- The toolchain and the check gate: TypeScript, ESLint, Vitest, fast-check, Playwright, the
  Vite build (ES, minified ES, IIFE) and the size budget, all run by `npm run check` (#1).
- The repo, the design, the decisions and the first backlog (tickets #1 to #19).
