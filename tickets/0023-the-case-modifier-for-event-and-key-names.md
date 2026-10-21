---
number: 23
uuid: 2b10965c-c23b-4b6c-a176-71ff27495d4a
title: "The __case modifier for event and key names"
type: feature
status: done
tags: ["attributes"]
created: 2026-10-20T23:12:59Z
updated: 2026-10-21T01:53:36Z
phase: "docs"
closed: 2026-10-21T01:53:36Z
---

HTML lowercases attribute names, so `data-on:myEvent` arrives as `data-on:myevent` and a
camelCase custom event cannot be listened to (#7). Datastar's `__case` modifier fixes this:
`data-on:my-event__case.camel` listens to `myEvent`.

- `__case.camel` (`my-event` → `myEvent`), `__case.kebab` (`my-event`, the default),
  `__case.snake` (`my_event`) and `__case.pascal` (`MyEvent`), converting the attribute key from
  its kebab-case spelling.
- On `data-on` first. Say in the plan whether other keyed directives take it too (Datastar
  allows it on `data-signals:`, `data-computed:`, `data-bind:` and `data-ref:`, where #7
  camelCases keys already), and record the choice in `docs/decisions.md`.
- An unknown case name or more than one `__case` is an error at the attribute.

Acceptance: unit tests for each case on a custom event dispatched with that name, the default
staying kebab, and the errors; the browser page `/attributes` gains a camelCase custom event.

## Comments

### 2026-10-21T01:51:26Z

Plan.

Approach: one helper in `src/builtins.ts`, `keyCase(attribute, fallback)`, reads at most one `__case.NAME` modifier and turns a kebab-case key into `camel`, `kebab`, `snake` or `pascal`. Only hyphens are converted, so `.` and `:` in a key stay as written (`data-on:htmx:after-swap` stays an event name with colons). The helper throws a `DirectiveSyntaxError` for an unknown case name, a missing or extra argument, and more than one `__case`.

Which directives take it: `data-on` (default `kebab`, so event names stay as written today), plus `data-computed`, `data-ref` and `data-bind` (default `camel`, the camelCasing #7 already does), as Datastar allows. For `data-bind` each dotted segment is converted. Not `data-attr`, `data-style` or `data-class`: their keys name HTML attributes and CSS properties, where Datastar's case conversion has no counterpart in #7 and HTML is lowercase anyway. `data-signals` takes no key. The choice goes in `docs/decisions.md` (Provisional).

Files: `src/builtins.ts`, `test/unit/attributes.test.ts`, `test/server/pages/attributes.html`, `test/browser/attributes.spec.ts`, `docs/decisions.md`, `CHANGELOG.md`.

Acceptance:
- Unit tests: a custom event dispatched as `myEvent`, `my_event` and `MyEvent` reaches `data-on:my-event__case.camel`, `__case.snake` and `__case.pascal`; `my-event` reaches both the plain key and `__case.kebab`; and the plain key does not hear `myEvent`. Also `__case.snake` on `data-computed`, `data-ref` and `data-bind`. The errors: an unknown case, two `__case`, and `__case` without a name.
- Browser: `/attributes` gains a button that dispatches `itemSelected` and a listener `data-on:item-selected__case.camel`, and the browser test sees the listener run.

### 2026-10-21T01:53:22Z

Check exited 0 (626 unit and property tests) and the browser suite exited 0 (128 tests, Chromium and Firefox). The plan held, with one change: the browser test dispatches `itemSelected` from the test rather than from a button on the page. Expressions see a closed scope without `CustomEvent`, and an outside script firing a camelCase event is the case the modifier exists for anyway.

### 2026-10-21T01:53:36Z

Delivered via PR #23 (76791f3). __case.camel|kebab|snake|pascal on data-on (default kebab) and on data-computed, data-ref and data-bind (default camel).
