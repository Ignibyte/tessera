---
number: 7
uuid: a3e7bf24-6782-4475-9191-3f9e9da4031d
title: "The attributes: Datastar's vocabulary, on the DOM"
type: feature
status: in-progress
tags: ["core","port","signals"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T23:11:25Z
phase: "docs"
---

Rewrite `src/declarative.ts` (1,017 lines, 44 jQuery calls) against the DOM, each built-in as a
registry definition from #6.

Attributes: `data-signals` (object form, deep merge), `data-computed:name`, `data-on:event` with
the modifiers `prevent stop once self outside window document capture passive debounce[.N]
throttle[.N]` and the key filters `enter escape space tab up down left right`, `data-text`,
`data-show`, `data-class` (object form), `data-attr:name`, `data-style:name`, `data-bind:path`
(text, number, checkbox, checkbox arrays, radio, select, multiple select, textarea),
`data-effect`, `data-init`, `data-ignore`, `data-ignore-morph`. Add `data-ref` (an element as a
signal). Leave out `data-html`: server HTML arrives through fragments, never through a signal.

Every resource (listeners, effects, observers) is owned through the kernel's ledger, so removal
cleans up exactly once. A `MutationObserver` applies attributes to added elements.

Acceptance: unit tests per attribute and per modifier, a test that removing an element releases
its listeners and effects, and a browser test page in the reference server exercising the
vocabulary in every engine.

## Comments

### 2026-10-20T23:00:34Z

Plan.

Files:
- `src/attributes.ts` (from jqstar `src/declarative.ts`, the `DeclarativeApplication` class):
  `mountAttributes(root, options)` returns a mount tracked by the kernel (#4). It scans the
  root, applies every directive the registry (#6) matches, and keeps them in step through an
  owned `MutationObserver`: added elements are scanned, removed ones released, changed
  attributes re-applied (`update` when the directive has one, remount otherwise). A subtree's
  directives are applied in priority order across the whole subtree, then document order, so
  every `data-signals` in it merges before any `data-text` reads, as jqstar's separate passes
  did. `data-ignore` skips an element and its descendants, `data-ignore__self` the element
  only.
- `src/builtins.ts`: each built-in as a registry definition, `registerBuiltins(registry)`.
  Priorities: `signals` 300, `computed` 200, `ref` 150, `bind` 100 (it may create its signal
  from the element), the rest 0, `init` -100.
- `src/values.ts` (from jqstar `src/value-checks.ts`): `isPlainRecord`, `cloneValue`,
  `isThenable`.

Ownership: the directive context gains `listen`. Every effect (`kernel.own("effect", …)`),
listener (`kernel.listen`), cleanup and task a directive takes is owned through the kernel's
ledger with the element as its root, so a render's `beforeRemove`, the element leaving the
document, an attribute change or the mount's destruction each release it exactly once. The
mount registers as a `MountLifecycle`, so a render removing a subtree inside it releases that
subtree's directives.

Attributes, as the ticket lists them: `data-signals` (object form, deep merge of a clone),
`data-computed:name` (a memoized `computed()` from #5 behind a getter on the signals object;
assigning to it fails), `data-on:event` with every listed modifier and key filter (`prevent`
with `passive` is an error; `debounce` and `throttle` take `.250`, `.250ms` or `.1s`),
`data-text`, `data-show` (restores the element's own inline `display`), `data-class` (object
form; whitespace-separated names), `data-attr:name` (`null`, `undefined` and `false` remove,
`true` sets the empty value), `data-style:name`, `data-bind:path` (dotted, camelCased; text,
number and range inputs as numbers, checkbox as a boolean or array membership, radio,
single and multiple select, textarea; a signal not yet defined starts from the element's
value), `data-effect`, `data-init`, `data-ignore`, `data-ignore-morph` (a marker for #9) and
`data-ref` (`data-ref:name` or `data-ref="name"`). No `data-html`. Event names are the
lowercase attribute key, as HTML lowercases attribute names.

Errors: a directive failure goes to `options.report`, or else a bubbling `tessera:error`
`CustomEvent` on the element with `{ error, element, attribute, expression }` (jqstar's
`jquery-star:error`). A Provisional entry in `docs/decisions.md`.

One fix in `src/reactivity.ts`: reading a value wraps only plain objects and arrays.
Today a DOM element in a signal (`data-ref`) comes back as a Proxy whose methods throw
"Illegal invocation"; class instances, Maps and Sets now come back as themselves, as the module
header already says.

Tests: `test/unit/attributes.test.ts`, per attribute and per modifier (fake timers for
debounce and throttle), mutation handling (added, removed, changed, ignored), removal releasing
listeners and effects exactly once (counted through `kernel.resourceSummary()`), a render's
`beforeRemove`, and destruction. Browser: a Playwright `globalSetup` builds
`test/browser/harness.ts` with Vite into `node_modules/.cache/tessera-harness/` (no new public
entry in `src/index.ts`); the reference server serves it as `/assets/harness.js`; a fixture page
`/attributes` uses the whole vocabulary; `test/browser/attributes.spec.ts` drives it in
Chromium and Firefox (WebKit waits for #20).
