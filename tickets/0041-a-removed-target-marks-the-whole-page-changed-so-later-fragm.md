---
number: 41
uuid: c3e7f870-65c7-4d97-8a77-e204b0d7634d
title: "A removed target marks the whole page changed, so later fragments of the same answer are dropped"
type: bug
status: in-progress
tags: ["transport","coordination"]
created: 2026-11-03T20:38:50Z
updated: 2026-11-03T20:38:50Z
phase: "code"
---

Found by Lotline (aic-demo #42) on 0.4.1. A fragment answer with two `data-mode="remove"` templates and
then a morph lands only the first remove. The console says, for the second row and for the totals,
"... changed after this request was sent; its older fragment is dropped."

Cause: in `src/transport.ts`'s apply loop, after `patchElements(target, "", "remove")` the target no
longer resolves, so the loop calls `generations.touch({ kind: "page", document })`. That stamps every
owner on the page with the new sequence, and every later fragment of the same answer reads stale.

Fix: a removed target touches the element it removed (resolved before the patch), not the page. A
fragment for a target that is still on the page stays fresh; a target inside the removed one is gone
with it anyway.

Acceptance:
- One answer may remove several targets and patch others after them; every fragment lands.
- A unit test in `test/unit/transport.test.ts` holds it (fails on 0.4.1's loop).
- `npm run check` and `npm run test:browser` exit 0. CHANGELOG under Unreleased.
