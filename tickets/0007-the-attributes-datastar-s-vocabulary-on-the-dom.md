---
number: 7
uuid: a3e7bf24-6782-4475-9191-3f9e9da4031d
title: "The attributes: Datastar's vocabulary, on the DOM"
type: feature
status: open
tags: ["core","port","signals"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
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
