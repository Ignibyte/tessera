---
number: 23
uuid: 2b10965c-c23b-4b6c-a176-71ff27495d4a
title: "The __case modifier for event and key names"
type: feature
status: open
tags: ["attributes"]
created: 2026-10-20T23:12:59Z
updated: 2026-10-20T23:12:59Z
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
