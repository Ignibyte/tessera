---
number: 9
uuid: 5722b5dc-fa9f-488b-bd7b-3aa34945dda5
title: "Patching: morphing with preservation, targeted by identity"
type: feature
status: open
tags: ["core","port","regions"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
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
