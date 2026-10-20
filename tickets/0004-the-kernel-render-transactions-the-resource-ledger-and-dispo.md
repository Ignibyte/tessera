---
number: 4
uuid: b8ac874a-c48f-41e9-b4a4-cd1867b6f513
title: "The kernel: render transactions, the resource ledger and disposal"
type: feature
status: done
tags: ["core","port"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T22:38:23Z
phase: "docs"
closed: 2026-10-20T22:38:22Z
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

## Comments

### 2026-10-20T22:32:42Z

Plan.

Approach: port jqstar `src/kernel.ts` close to verbatim for the parts the ticket keeps, without
`$`, the plugin host, actions, protocols, middleware, the operation hub, the expression engine
and the metadata seam. Files:

- `src/kernel.ts` (from jqstar `src/kernel.ts`): `Kernel`, `kernelFor(document)`,
  `compareElementDepth`. The document claim (`WeakMap`), the resource ledger (`own`, `canOwn`,
  removal scopes, the lazily created removal `MutationObserver`), `observe`, `listen`, `task`,
  `beginRender` (`beforeRemove`, `preservedWithin`, `commit`, `fail`, focus capture and restore
  with `preventScroll`, the focus retry, monotonic `operationId`), `whenEnhanced`, `dispose`.
- jqstar's "application" (a booted root with `destroy()`) becomes a **mount**: `track(mount,
  lifecycle?)`, `untrack(mount)`, `mountCount()`. Later tickets mount what lives at a region or
  component (#7, #8); the kernel only orders their teardown deepest first.
- `src/disposal.ts` (from jqstar `src/disposal.ts`): the frozen report, schema
  `tessera-disposal/1`, and `DisposalError`.
- `src/errors.ts` (from jqstar `src/errors.ts` and `errorFields` in `src/value-checks.ts`).
- `src/dom.ts` (from jqstar `src/dom.ts`): only `isNode` and `isElementNode`; the tag
  predicates come back with the tickets that use them.

Decisions (internal; nothing is exported from `src/index.ts` yet, so no public API changes):
- No preservation attribute in the kernel. jqstar scans `[data-jqs-preserve]`; here the caller
  passes `preserveRoots`, since which attribute preserves depends on the patch mode
  (`data-ignore-morph` in #9, `data-permanent` on whole-document visits in #13 and #17).
- `nextUpdate` belongs to reactivity (#5), which wants one scheduler per runtime. The kernel
  takes a `flush` hook in its options (default: one microtask) and awaits it where jqstar
  awaits `nextUpdate`; #5 passes its scheduler's flush.
- `listen` is a plain owned `addEventListener`. jqstar's listener dedupe and option-getter
  rechecks guard plugin hosts, which Tessera does not have.
- Disposal reports one `mount` entry per mount instead of jqstar's six per application.

Tests: `test/unit/kernel.test.ts` ports jqstar `test/kernel.test.ts` minus the plugin,
expression, action and operation-hub cases; `test/unit/kernel-resources.test.ts` ports
`test/scoped-resource-lifecycle.test.ts`. Acceptance mapping: exact-once cleanup (release before
and after disposal, record removed before cleanup), deepest-first teardown (two ordering tests),
preserved roots surviving a render (kept, missing, failed, temporarily detached), cleanup on
element removal (native removal, moves, adoption), refusing acquisition in a removal boundary,
idempotent disposal (same report, same error, recursive dispose). New: focus restore inside a
preserved root with `preventScroll`, and the flush hook awaited by the barrier.

### 2026-10-20T22:38:23Z

Delivered via PR #5 (54763e8). The kernel ported from jqstar: claim, ledger, render transactions, barrier and disposal, with mounts and a flush hook for #5.
