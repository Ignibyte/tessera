---
number: 21
uuid: 0f8a243e-bdde-46e3-b2fe-4938d82ef5cd
title: "Computed values that recompute to an equal value do not re-run their dependents"
type: feature
status: in-progress
tags: ["core","reactivity"]
created: 2026-10-20T22:45:29Z
updated: 2026-10-21T01:49:37Z
phase: "docs"
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

## Comments

### 2026-10-21T01:39:37Z

Plan.

Approach: push-pull, as in Vue 3.4 and Preact Signals. A write pushes only marks; values are pulled when read.

- A computed value has a state, `clean`, `check` (an upstream computed value may have changed) or `dirty` (one of its own reactive reads was written), and a `version` that goes up only when a recomputation gives a value that is not `Object.is`-equal to the cached one.
- A write notifies its direct subscribers with `dirty`. A computed value moving out of `clean` passes `check` to its own subscribers, so marking stays one walk per change and evaluates nothing (laziness kept).
- Every subscriber, effect or computed, records the version of each computed value it read during its last run.
- Pulling a computed value (`refresh`): `clean` returns. `check` refreshes each computed value it read and compares versions: all equal means `clean` again without calling the getter, so the outer computed value of a chain does not recompute. `dirty`, or a changed source, recomputes and bumps the version only on a new value.
- The scheduler keeps, for each pending effect, whether it is `dirty` or only `check`. At flush, a `check` effect runs only if a computed value it read now has a new version; a refresh that throws makes it run, so the effect reports the error as today. Batching is unchanged: writes in one microtask mark once and the flush pulls once.
- A failed evaluation leaves the value `dirty` and still passes the next notification on, as today.

Files: `src/reactivity.ts`, `test/unit/reactivity.test.ts`, and `test/property/reactivity.test.ts`, where each effect also records its runs and the property adds that an effect reading through a computed value never runs twice in a row on the same value.

Acceptance: unit tests for an equal recomputation not re-running an effect; a chain of two computed values with the inner one unchanged (the outer getter not called, the effect not run); a value changing after an equal one (the effect runs then); getter call counts showing one evaluation for several writes in a microtask and none for a computed value nobody reads. The existing reactivity tests and the property test keep passing.

Also in this PR, at the driver's request: the CLAUDE.md step 4 rule that the check and the browser tests are judged by their exit code.

### 2026-10-21T01:49:37Z

Check exited 0 (615 unit and property tests), and four full browser runs exited 0, 126 tests each. Run against main's `src/reactivity.ts`, the new tests fail: the property and three of the unit tests.

Split off nothing, but fixed one thing outside the plan. The first browser run failed in Firefox: a transport test's controller channel held two POSTs. Their write ids and referers differed, and the first came from `forms.spec.ts`, which ran earlier in the same worker under the same channel name (`name-project-worker-retry`). So the browser tests collided with each other; Tessera did not send twice. Channel names and log keys now come from `testName` in `test/browser/names.ts`, built from the test id, in all six specs that named them per worker.

Also in this PR: the CLAUDE.md step 4 rule that exit codes decide.
