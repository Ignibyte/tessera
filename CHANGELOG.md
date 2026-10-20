# Changelog

## Unreleased

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
