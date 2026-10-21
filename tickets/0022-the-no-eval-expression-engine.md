---
number: 22
uuid: 8d1e2177-9861-407a-bc31-e5612f341d22
title: "The no-eval expression engine"
type: feature
status: in-progress
tags: ["core","port","csp"]
created: 2026-10-20T22:55:17Z
updated: 2026-10-21T03:40:05Z
phase: "docs"
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

## Comments

### 2026-10-21T03:17:29Z

Plan.

Port: jqstar `src/csp/` (tokenizer, parser, AST, evaluator, diagnostics, contract, engine) into `src/noeval/`, behind the four-method `ExpressionEngine` seam, as `createNoEvalExpressionEngine()`. The jQuery island goes: the `$(…)` call, `$el` and `$root`, the jQuery method table. So do jqstar's own bindings (`state`, `signals`, `stores`, `computed`, `args`, `root`) and `action('name')`. jqstar `src/expression-runtime.ts` is not needed: actions go through Tessera's action seam and helpers come in the context, as with the trusted engine.

The scope is the trusted engine's, resolved when an expression runs, in its order: `el`, `evt` and `this` (the element), then the context's helpers, then `$name` signals, then the built-ins. Any other name, `$` alone included, fails at evaluation with the trusted engine's "is not defined" message. Actions: `@get` to `@delete` with parentheses, anywhere in an expression, through the same seam. What the grammar keeps from jqstar, every item listed in `docs/decisions.md`:
- `===` and `!==` only; no coercion (arithmetic on finite numbers, `+` also joins strings, comparisons of two numbers or two strings);
- no `new`, `typeof`, `in`, `throw`, `if` or loops, functions, template literals, comments, regular expressions, optional chaining, spread, `??=` or prefix updates;
- denied magic keys (`constructor`, `__proto__`, `prototype`, `call`, `apply`, `bind` …);
- jqstar's limits (2,048 characters, 512 tokens, nesting 16, 256 nodes, 128 evaluation steps, 128 collection items, 8 path segments, 8 arguments, 8 async steps).

What a value can do is a capability table:
- plain data reached from signals: read and write own properties; array `at`, `includes`, `indexOf`, `join`, `slice`, plus `push`, `pop`, `shift` and `unshift` on arrays reached from a signal;
- strings: jqstar's methods plus `split`;
- elements: a list of readable properties (`id`, `value`, `checked`, `textContent`, `dataset`, `parentElement` …) and writable ones (`value`, `checked`, `disabled`, `hidden`, `textContent`), and a few methods (`focus`, `blur`, `click`, `closest`, `matches`, `getAttribute` …);
- events: jqstar's members plus the modifier keys and `submitter`, and `preventDefault`, `stopPropagation` and `stopImmediatePropagation`;
- helpers: any own member, called as registered;
- built-ins: a table of pure functions (`Math`, `JSON`, `Number`, `String`, `Boolean`, `parseInt` and the like, `Array.isArray`, `Object.keys`, `values` and `entries`, `Promise.resolve`, `Date.now`). Another built-in name fails as not available in the no-eval engine.

Errors are `ExpressionError` with the phase, location and element, wrapping a `NoEvalError` that carries jqstar's diagnostic code and span. A statement returns a promise, and rejects on an evaluation error, as the trusted engine's async function does.

How a page picks the engine: one option, the `expressions` engine given when Tessera starts. Today that is `mountAttributes({ expressions })`; #19 puts it in the public call. Importing `src/noeval/engine.ts` is the only way the no-eval engine enters a build. The types, `ExpressionError`, the built-in list and the action call move to `src/expression-shared.ts`, which both engines import and which holds no `new Function`; `expression.ts` re-exports them. Measuring: `npm run size` also builds each engine alone, minified, checks that the trusted bundle holds no no-eval code and the no-eval bundle no `Function(`, and holds each to a budget in `size-budget.json`. The default build's budget is unchanged.

Tests:
- the #6 conformance suite against the new engine; `location-aware-errors` gets one named adaptation: its asynchronous failure is a helper's rejected promise, since the grammar has no `throw` or `new`;
- jqstar's tokenizer and parser tests and its denied and adversarial cases, ported where they apply (the jQuery, `state`, `computed` and `stores` ones do not);
- fast-check with a fixed seed: the tokenizer and parser either succeed or throw a `NoEvalError`, never anything else; and a differential test where random well-typed expressions give the same value in both engines;
- browser: `/attributes?csp=1` is served with `Content-Security-Policy: script-src 'self'` and booted with the no-eval engine, and the whole attributes spec runs there too. A control run with the trusted engine under the same policy shows the policy holds.

### 2026-10-21T03:40:05Z

Results (exit codes tested): `npm run check` 0 (727 unit and property tests). The engines measured alone: trusted 1,920 bytes gzipped, no-eval 9,914, each within its budget of measured plus 10%, and neither bundle holds the other's code. `npm run test:browser` 0 (200 tests); `npm run test:browser:webkit` 0 (100 tests). The whole attributes spec now also runs under `script-src 'self'` with the no-eval engine in all three engines, with no violation reported, and the trusted engine fails under the same policy.

Conformance: six of seven cases pass unchanged against the no-eval engine. `this`, `el.parentElement.localName` and `Promise.resolve` are in its scope, so `element-and-event` and `asynchronous-results` need no adaptation. `location-aware-errors` has the one named adaptation: its asynchronous failure is a helper's rejected promise.

Ported from jqstar: the tokenizer cases, the parser cases, the denied and adversarial vectors that apply (mapped to Tessera's codes), and two of the three properties (totality, the signal write). New: a differential property; over 300 generated well-typed expressions, up to 465 characters, both engines agree. Not ported: jqstar's cases about jQuery, `state`, `computed`, stores, and the owned-getter and cycle rules (gone, as `docs/decisions.md` says).

One choice beyond the plan: an array literal, an object literal and an argument may hold a promise without awaiting it (`[@get('/a'), 1]`), as in JavaScript; operators, conditions and assignments still refuse one.
