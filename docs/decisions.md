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

## Open

- **SSE event names**: Datastar's (`datastar-patch-elements`, `datastar-patch-signals`) where
  the meaning matches, or Tessera's own. Ticket #2 records a provisional choice.
- **The no-eval expression engine** (jqstar `src/csp/`, about 2,400 lines): ship it in 0.1.0 or
  later. Not in the first backlog.
