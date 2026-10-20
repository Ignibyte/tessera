---
number: 9
uuid: 5722b5dc-fa9f-488b-bd7b-3aa34945dda5
title: "Patching: morphing with preservation, targeted by identity"
type: feature
status: done
tags: ["core","port","regions"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T23:38:10Z
phase: "docs"
closed: 2026-10-20T23:38:10Z
---

Port `src/patch.ts` (232 lines): Idiomorph with preservation (`data-ignore-morph`, preserved
roots), `ignoreActiveValue`, `restoreFocus`, inert parsing through `<template>`.

Replace jqstar's id and CSS-selector targeting with exact identity matching from
`docs/protocol.md`: a region by name, a component by its path of keys (morphing the nodes
between its comment markers), a control-flow block by its markers. Modes: morph (default),
inner, append, prepend, remove. Every patch runs inside one kernel render transaction, so
outgoing roots tear down first and incoming ones boot once.

Signal patches: deep merge into a named scope, with `onlyIfMissing`.

Acceptance: unit tests for each mode on regions and on components between markers, preserved
nodes surviving, focus and input values kept, nested components torn down deepest first, and an
unknown target reported as an error rather than silently skipped. A browser test morphing a
region while an input in it has focus, in every engine.

## Comments

### 2026-10-20T23:30:39Z

Plan.

`src/patch.ts` (from jqstar `src/patch.ts`): `createPatcher({ kernel, scopes })` with
`patchElements(target, markup, mode)` and `patchSignals(target, patch, { onlyIfMissing })`.
`src/idiomorph.d.ts` ports jqstar's typings for Idiomorph 0.7.4, which ships none.

- Targets by identity (protocol 2.6): a region by name (zero or two matches is an error); a
  component by its path, walked from its region (or `<body>` for `page/…`) through the
  components whose nearest enclosing component or region is the parent, skipping nested
  regions, as protocol 2.4 defines the path. An unknown target, a duplicate key and a
  malformed fragment throw a `PatchError` naming the target; nothing changes.
- Fragments parse inertly through `<template>` (scripts never run).
- Modes (protocol 5.3): `morph` (a region: exactly one element with that `data-region`, same
  tag; a component: exactly its opening marker with the same key, its content, its closer),
  `inner`, `append`, `prepend`, `remove`.
- Regions morph with Idiomorph's outer morph on the region element, which survives. A component
  is a run of nodes between two comments, and Idiomorph's public `morph` takes one node, so the
  patcher morphs the markers' parent against a copy of its children in which only that run is
  new; every node outside the run is matched with its own copy and left as it was. Options as
  jqstar: `ignoreActiveValue`, `restoreFocus`; `data-ignore-morph` nodes are neither morphed
  nor removed and are the render's preserved roots.
- Every patch runs in one kernel render transaction: removed elements go through
  `beforeRemove` (deepest-first teardown while connected), then the morph, then `commit`, or
  `fail` on an error.
- Scopes across a morph: a removal Idiomorph asks for, of a node that owns a scope (a component's
  opening marker, a region, or anything containing one), is held back until the morph is done.
  Then each such owner whose path (protocol 2.4) reappears in the new content on a different node
  gets its scope through `scopes.transfer(from, to)`, as #8 left for this ticket; the held-back
  nodes are then torn down and removed, still connected. `transfer` extends to region elements
  (by name). A kept marker keeps its scope by identity; a changed key resets it (#8).
- Signal patches (protocol 5.3): deep merge into the target's scope (`page` is the document),
  nested objects merge, arrays and other values replace, `null` removes, `onlyIfMissing` sets
  only what is absent (jqstar `patchSignals`).

Tests: `test/unit/patch.test.ts` in jsdom's own document (Idiomorph reads the global `document`,
so an iframe's nodes would be adopted into the wrong document): each mode on regions and on
components, blocks pairing by position, preserved and ignored nodes surviving, focus and input
values kept, nested mounts torn down deepest first, unknown targets and malformed fragments
reported, the scope surviving a morph that replaces its marker (through `transfer`) and one
that keeps it, a changed key resetting it, and signal patches. Browser: a `/patch` fixture page
and `test/browser/patch.spec.ts` morph a region while an input in it has focus, and check that a
fragment's script does not run, in Chromium and Firefox.

### 2026-10-20T23:38:10Z

Delivered via PR #10 (e5bc7b7). Patching by identity in five modes; scopes survive a replaced marker through transfer; directives re-apply after a morph.
