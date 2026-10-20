---
number: 6
uuid: 9dbd1722-9f88-4b7d-9a86-072df989fb2d
title: "Expressions and the directive registry"
type: feature
status: done
tags: ["core","port"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T22:57:03Z
phase: "docs"
closed: 2026-10-20T22:57:03Z
---

Port the trusted expression engine (`src/expression.ts`, `src/expression-types.ts`,
`src/expression-runtime.ts`) and the directive registry (`src/directive.ts`), jQuery-free.

- `$name` resolves to a signal in the element's scope (scopes arrive in #8; until then the
  nearest root's state). `$` alone is not special. `el` is the element, `evt` the event where
  there is one.
- Actions: `@get`, `@post`, `@put`, `@patch`, `@delete` compile to calls into an action seam the
  transport (#11) fills; until then a stub that records calls.
- Close the global fall-through: an unknown identifier is an error with the expression and the
  element named, not a lookup on `window`. Record this in `docs/decisions.md`.
- Keep the engine behind the 4-method seam so the no-eval engine (jqstar `src/csp/`) can be
  added later.
- The registry: directives by attribute name with modifiers and keys (`data-on:click__prevent`),
  helpers, matchers; a directive context without `$element`.

Acceptance: unit tests for signal reads and writes, statements with several expressions, action
compilation, unknown identifiers failing loudly, and registry matching with keys and modifiers.

## Comments

### 2026-10-20T22:48:06Z

Plan.

Files:
- `src/expression.ts` (from jqstar `src/expression.ts` and `src/expression-types.ts`): the
  4-method seam (`compileValue`, `compileStatement`, `clearCache`, `dispose`) and
  `createTrustedExpressionEngine()`, one per runtime (jqstar's module-level compatibility
  engine is dropped). Values compile to `with (scope) { return (…) }`, statements to an async
  function body bound to the element, as in jqstar. Errors are `ExpressionError` with `phase`,
  `source`, `location` and, on evaluation, the element, named in the message.
- `src/actions.ts`: the action seam, `(call: { method, url, options, element, event }) =>
  unknown`, and `createActionRecorder()`, the stub that records calls until #11.
- `src/directive.ts` (from jqstar `src/directive.ts`): the registry without the plugin
  install, `$element` or jqstar's two built-ins (#7 brings the built-ins as definitions).

The scope an expression sees: `$name` reads and writes `context.signals[name]` (#8 passes its
scope chain there; until then a root's state), `el`, `evt`, registered helpers, and a fixed
list of ECMAScript built-ins (`Math`, `JSON`, `Number`, `String`, `Boolean`, `Array`,
`Object`, `Date`, `Promise`, `RegExp`, `Intl`, `Map`, `Set`, `Symbol`, `BigInt`, `Error`,
`parseInt`, `parseFloat`, `isNaN`, `isFinite`, the URI functions, `undefined`, `NaN`,
`Infinity`). The scope proxy answers `has` for every name, so nothing falls through to
`window`: any other identifier, read, written or under `typeof`, throws naming itself, the
expression and the element. `$` alone is such an identifier. jqstar's `$`, `$el`, `$root`,
`state`, `signals`, `computed`, `root`, `stores`, `args` and `action()` are gone.

Actions: `@get(url, options)`, `@post`, `@put`, `@patch`, `@delete` anywhere in an expression
(jqstar accepted only a whole statement `@name(args)`). Compilation rewrites `@method(` outside
string literals, template literals and comments into a call on a fixed binding; an unknown
`@name` or one without parentheses is a compile error. The call checks that the URL is a
string and the options an object, then hands it to `context.actions`.

Not ported: jqstar `src/expression-runtime.ts`. The trusted engine does not use it; it brands
action and helper results for the no-eval engine (`src/csp/`) and comes with that engine.

Registry: a directive is registered by name (`on`, `signals`, `ignore-morph`) with a key rule
(required, forbidden, optional) and its allowed modifiers. `match(attributeName, value)` parses
`data-NAME[:KEY][__MOD[.ARG…]…]` (`data-on:click__debounce.500ms__prevent` gives key `click`,
modifiers `debounce` ["500ms"] and `prevent`), returns undefined for a `data-*` attribute no
directive claims, and throws for a claimed one with a missing or forbidden key or an unknown
modifier. Names the protocol already uses (`region`, `target`, `enhance`, `track`,
`permanent`, `lazy`, `poll`, `stream`, `error-summary`, `mode`, `scope`) cannot be registered.
Helpers keep jqstar's dotted names, reserved roots and frozen scope. The directive context type
keeps jqstar's shape without `$element` and `application`.

Decisions for `docs/decisions.md` (Provisional): the closed scope and its built-in list; actions
anywhere with the five methods; the attribute-name grammar.

Tests: `test/unit/expression.test.ts` with jqstar's engine conformance suite ported
(`test/unit/expression-conformance.ts`, re-pointed at Tessera's scope) plus signal reads and
writes (with a reactive effect re-running), statements with several expressions, actions inside
statements and strings, unknown identifiers, the built-ins, caching and disposal;
`test/unit/directive.test.ts` for matching with keys and modifiers, key rules, reserved names,
priority order and helpers; `test/property/directive-name.test.ts` (fixed seed) round-trips the
attribute grammar and shows the action rewrite never touches string literals.

### 2026-10-20T22:55:28Z

Unblocked by the driver (2026-10-20): option 3. new Function is allowed in src/expression.ts only, through a file-scoped override of @typescript-eslint/no-implied-eval in eslint.config.js, recorded in docs/decisions.md as Provisional for Chad to confirm. The no-eval engine is ticket #22, required before Release 0.1.0 (#19).

### 2026-10-20T22:57:03Z

Delivered via PR #7 (980964b). The trusted engine with a closed scope, actions anywhere, and the directive registry; new Function allowed in src/expression.ts only (Provisional), no-eval engine is #22.
