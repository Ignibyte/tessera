---
number: 4
uuid: b8ac874a-c48f-41e9-b4a4-cd1867b6f513
title: "The kernel: render transactions, the resource ledger and disposal"
type: feature
status: open
tags: ["core","port"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
---

Port jqstar's render transaction and ownership model (`src/kernel.ts`, 1,055 lines;
`src/disposal.ts`; `src/dom.ts`) without jQuery. Digest section 2 describes it.

- One kernel per `Document` (a `WeakMap` claim).
- The resource ledger: `own(kind, owner, cleanup, root?)`; records removed before cleanup runs, so
  cleanup runs at most once; element-scoped records released when the element leaves the
  document (a lazily created `MutationObserver`); no acquisitions inside an active removal
  boundary.
- `beginRender(root, {preserveRoots})`: begin, `beforeRemove(node)` (deepest-first teardown while
  still connected), the host mutates, `commit(incomingRoots)`, `fail(error)`. Focus capture and
  restore with `preventScroll`. A monotonic operation id.
- The enhancement barrier (`whenEnhanced()`), and disposal with a frozen report that repeat calls
  return unchanged.
- Drop: `$` storage, application metadata the new runtime does not need, plugin plumbing.

Acceptance: unit tests (happy-dom or jsdom under Vitest) for exact-once cleanup, deepest-first
teardown, preserved roots surviving a render, cleanup on element removal, refusing acquisition in
a removal boundary, and idempotent disposal. Port jqstar's kernel tests where they exist
(`/srv/stacks/jqstar/test/`).
