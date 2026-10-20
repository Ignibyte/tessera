---
number: 5
uuid: 3d23fb1e-1ff3-467a-be9b-fb7376df6fac
title: "Reactivity: signals, effects and computed values"
type: feature
status: done
tags: ["core","port","signals"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T22:44:22Z
phase: "docs"
closed: 2026-10-20T22:44:22Z
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

## Comments

### 2026-10-20T22:40:55Z

Plan.

Port jqstar `src/reactivity.ts` into `src/reactivity.ts`: cached Proxies over plain objects and
arrays, dependency sets keyed target → key → subscribers, effects with `owner` and `onError`,
`stop`, `notifyPropertyChange`, plus `toRaw`. Changes from jqstar:

- **One scheduler per runtime.** `new Scheduler()` owns its queue, its pending errors and its
  `nextUpdate()`; `scheduler.effect(fn, options)` creates an effect that runs in that queue. The
  proxies and dependency maps stay shared (they are keyed by object), so two runtimes can read
  one object, but each flushes and reports only its own effects. The kernel takes it as
  `new Kernel(document, { flush: () => scheduler.nextUpdate() })` (the option from #4).
- **`has` and `ownKeys` are tracked.** `'x' in $obj` tracks key `x`; `Object.keys`, `for…in`
  and spreads track an iteration key that adding or deleting a key triggers. Arrays track
  `length` for iteration, a write past the end triggers `length`, and truncating through
  `length` triggers the removed indices.
- **Array mutators do not track.** `push`, `pop`, `shift`, `unshift` and `splice` read `length`
  while writing it; jqstar's effect that pushes would re-run itself forever. They run with
  tracking paused.
- **Memoized computed values.** `computed(getter)` returns `{ value, stop() }`: lazy, cached,
  marked dirty by its dependencies, and tracked by whatever reads `value`, so a computed can
  feed effects and other computed values.
- **`nextUpdate` waits until the queue is empty**, not one extra microtask, and a queue that
  does not settle after 100 rounds (an effect that keeps changing what it reads) is dropped and
  reported with the owners of the effects left in it, instead of spinning.
- `dependentCount(target, key?)` reports how many subscribers a target holds, so tests can show
  that a stopped effect leaves no dependencies behind.

Tests: `test/unit/reactivity.test.ts` ports jqstar `test/reactivity.test.ts` (each case
re-pointed at a scheduler) and adds: each trap (`get`, `set`, `deleteProperty`, `has`,
`ownKeys`), nested objects and arrays, array mutators, effect cleanup and no leaked
dependencies, batching within a microtask, two schedulers isolated, the settle guard, computed
memoization (the getter runs only when a dependency changed and someone reads it), chained
computed values, and the kernel's barrier waiting on a scheduler. `test/property/reactivity.test.ts`
(fixed seed): random write sequences over random effects and computed values leave every effect
having seen the final values.

No protocol or public API change: nothing new is exported from `src/index.ts`.

### 2026-10-20T22:44:22Z

Delivered via PR #6 (b51f025). Reactivity ported from jqstar with has/ownKeys tracking, memoized computed values and a scheduler per runtime.
