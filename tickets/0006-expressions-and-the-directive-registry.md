---
number: 6
uuid: 9dbd1722-9f88-4b7d-9a86-072df989fb2d
title: "Expressions and the directive registry"
type: feature
status: open
tags: ["core","port"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
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
