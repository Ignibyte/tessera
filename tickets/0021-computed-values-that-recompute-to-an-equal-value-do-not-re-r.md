---
number: 21
uuid: 0f8a243e-bdde-46e3-b2fe-4938d82ef5cd
title: "Computed values that recompute to an equal value do not re-run their dependents"
type: feature
status: open
tags: ["core","reactivity"]
created: 2026-10-20T22:45:29Z
updated: 2026-10-20T22:45:29Z
---

Follow-up to #5. Today a computed value (`computed()` in `src/reactivity.ts`) tells its
dependents to re-run as soon as one of its own dependencies changes. When the getter then
recomputes to a value equal to the cached one (`Object.is`), the dependents re-run for nothing.

- A computed value whose recomputed value is `Object.is`-equal to the cached one must not re-run
  the effects or computed values that read it.
- This holds through chains: an outer computed value whose inner one did not change does not
  recompute, and its dependents do not re-run.
- Batching stays as it is: several writes in one microtask still cost one evaluation at most.
- Laziness stays: a computed value nobody reads is not evaluated by a write.

One approach: on a dependency change, mark the computed value as possibly stale and schedule
its dependents through a check that recomputes first and goes on only when the value changed
(the push-pull model of Vue 3.4 and Preact Signals). Say in the plan which approach is taken.

Acceptance: unit tests for an equal recomputation not re-running an effect, a chain of two
computed values where the inner one is unchanged, a value that changes after an equal one
(the effect runs then), and getter call counts showing batching and laziness kept. The property
test in `test/property/reactivity.test.ts` keeps passing, with effects counting their runs.
