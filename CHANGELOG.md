# Changelog

## Unreleased

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
