---
number: 44
uuid: 7693a41f-4a52-4b94-8b31-302b1c09727f
title: "A dropped data-ignore-morph element fails the render"
type: bug
status: done
tags: 
created: 2026-11-04T09:08:17Z
updated: 2026-11-04T09:19:25Z
phase: "docs"
closed: 2026-11-04T09:19:25Z
---

Found by Lotline #32 on 0.4.4. A morph or inner patch, or a visit's body morph, adds every [data-ignore-morph] element under the target to the render's preserveRoots (src/patch.ts, patchElements and patchBody), whether or not the incoming markup still holds it. When the new markup has no such element, the kernel (src/kernel.ts) tears it down and raises 'Tessera render operation N did not retain 1 promised preserved root.', and a visit does not land.

Repro: <div data-t-c=x><textarea data-ignore-morph></textarea></div>, then a fragment for x (or a visit whose markup) without the textarea.

Protocol: a morph leaves such an element as it is, which holds only while the new markup keeps it. Fix: promise to preserve only the ignore-morph elements the incoming markup keeps, as keptPermanents() does for permanents; one the markup drops is removed with its parent, without an error. A kept look: a box with data-ignore-morph and typed text survives a morph that keeps it, and a patch or visit that drops it lands with no error.

## Comments

### 2026-11-04T09:12:44Z

Plan. Cause: patchElements and patchBody promise every [data-ignore-morph] element under the target as a preserved root, and the morph's keep() refuses to remove any of them. When the incoming markup drops one, Idiomorph removes its parent; the kernel skips the promised element during that teardown, then finds it detached at commit and raises the error. Idiomorph pairs an id-less ignore-morph element with a counterpart only by soft match (same tag, sibling position), so the patcher cannot read the pairing back from the morph. Fix in src/patch.ts: keptIgnored() pairs each outermost ignore-morph element under the target with one the incoming markup brings: by tag and id when it has a unique id, else by its place (the chain of tags and ids from the target) and its order among elements in that place. Only the paired ones are promised and kept. For an id-less pair, the patcher stamps a temporary id on both nodes for the morph, so Idiomorph pairs them by id as it pairs permanents, then removes it. An unpaired one is morphed or removed like any node, torn down with its parent. Remove mode promises none. Tests: unit tests in test/unit/patch.test.ts for a dropped element (morph, inner, body visit), a kept one (same node, client content), a kept one moved under a new wrapper; a browser test in test/browser/patch.spec.ts on a fixture page: typed text survives a morph that keeps the box, a patch and a visit that drop it land with no error. Bite: revert src/patch.ts and run both. Docs: docs/protocol.md section 3 gains a data-ignore-morph row; docs/decisions.md's #9 entry is amended; CHANGELOG entry.

### 2026-11-04T09:18:55Z

Check: npm run check passed (810 unit and property tests). npm run test:browser: the first run failed one test, Firefox history #39 (Back to /search?q=c stayed on /about) at load average 16; alone it passed 3 of 3, and the full suite passed on the rerun, 270 of 270. That failure is load. Bite: with src/patch.ts from main, 6 of the new unit tests fail and the 6 dropping browser tests (3 cases, Chromium and Firefox) fail with 'Tessera render operation 1 did not retain 1 promised preserved root.'; the keeping tests pass on both, as they should. With the temporary ids switched off, the unit test where a like form comes first fails.

### 2026-11-04T09:19:25Z

Delivered via PR #56 (e086da3). The patcher promises and keeps only the data-ignore-morph elements the incoming markup brings again; a dropped one goes with its parent, without an error.
