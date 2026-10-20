---
number: 5
uuid: 3d23fb1e-1ff3-467a-be9b-fb7376df6fac
title: "Reactivity: signals, effects and computed values"
type: feature
status: open
tags: ["core","port","signals"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
---

Port `src/reactivity.ts` (192 lines): cached Proxies over plain objects, dependency sets keyed
target → key → effects, a microtask scheduler, `nextUpdate`.

Improve on jqstar (digest section 3):
- track `has` (`in`) and `ownKeys` (iteration), so `Object.keys($items)` and `'x' in $obj`
  re-run their effects;
- memoize computed values, invalidated by their dependencies;
- one scheduler per runtime instance instead of one per realm, so two runtimes on a page (tests,
  iframes) do not share a queue.

Acceptance: unit tests for each trap, nested objects and arrays, effect cleanup, batching within
a microtask, memoized computed values recomputing only on change, and no leaked dependencies
after an effect is disposed. A property test that a random sequence of writes leaves every
effect having seen the final value.
