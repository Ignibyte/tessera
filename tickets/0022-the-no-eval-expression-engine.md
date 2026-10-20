---
number: 22
uuid: 8d1e2177-9861-407a-bc31-e5612f341d22
title: "The no-eval expression engine"
type: feature
status: open
tags: ["core","port","csp"]
created: 2026-10-20T22:55:17Z
updated: 2026-10-20T22:55:17Z
---

Port jqstar's no-eval expression engine (`src/csp/`: tokenizer, parser, AST, evaluator,
diagnostics, contract; `src/csp.ts`; about 3,000 lines, digest section 5) as an optional engine
behind the `ExpressionEngine` seam of #6, so a page whose Content-Security-Policy refuses
`'unsafe-eval'` can use Tessera. The trusted `new Function` engine stays the default
(`docs/decisions.md`, ticket #6).

- Drop the jQuery island (the capability table of jQuery methods in `evaluator.ts`).
- The same closed scope as the trusted engine: `$name`, `el`, `evt`, helpers and the built-ins
  in `EXPRESSION_BUILTINS`; actions `@get` to `@delete` anywhere in an expression, through the
  same action seam. Where the grammar allows less than JavaScript (jqstar: `===` only, fixed
  l-values, denied magic keys, hard limits on length, tokens, nodes and steps), keep it and
  list the differences in `docs/decisions.md`.
- jqstar `src/expression-runtime.ts` (branded action and helper results) comes with it if the
  evaluator still needs it.
- Choosing the engine: one runtime option; say in the plan how a page picks it. Nothing in the
  trusted engine's build pulls in the no-eval engine, and the reverse; the size budget covers
  the default build, and the plan says how the optional one is measured.

Acceptance: the conformance suite of #6 (`test/unit/expression-conformance.ts`) passes against
the no-eval engine, with each case jqstar marked "csp-equivalent" adapted and the adaptation
named; jqstar's CSP tests ported where they apply; fast-check property tests for the tokenizer
and parser (fixed seed); a browser test page served by the reference server with a
Content-Security-Policy without `'unsafe-eval'`, where expressions run.

Ordering: required before Release 0.1.0 (#19).
