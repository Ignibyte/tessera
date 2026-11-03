---
number: 40
uuid: 146e76ee-1c94-4864-bc42-210e2d5b7852
title: "Drag does not start in Firefox: expressions cannot call dataTransfer.setData()"
type: bug
status: done
tags: ["events","drag"]
created: 2026-11-03T10:30:42Z
updated: 2026-11-03T23:42:03Z
phase: "code"
closed: 2026-11-03T23:42:03Z
---

Found in Lotline (aic-demo) #30 (2026-11-03), the leads board. Firefox starts an HTML5 drag only when the `dragstart` handler calls `event.dataTransfer.setData(...)`; Chromium starts one without it. A card with `draggable="true"` and `data-on:dragstart` works in Chromium and never starts in Firefox, because a Tessera expression cannot reach `dataTransfer`. Lotline keeps a "Move to" menu that works everywhere. Either give `dragstart` a default `setData('text/plain', '')` when the element has a `data-on:dragstart`, or expose the event's `dataTransfer` to the expression (decide which fits the expression sandbox). Probe it in Firefox through Playwright.

## Comments

### 2026-11-03T23:37:34Z

Plan: give dragstart a default rather than open dataTransfer to expressions (the sandbox reaches no host methods, and the no-eval engine would need a carve-out). A data-on:dragstart listener that runs sets dataTransfer's text/plain to '' when the drag carries no data yet, before its expression, so Firefox starts the drag and an expression in the trusted engine can still set its own data. Unit test with a stub dataTransfer; a browser test on /attributes that drags onto a drop zone in Chromium and Firefox; protocol attribute row and CHANGELOG.

### 2026-11-03T23:42:03Z

Delivered via PR (bbb6765). A data-on:dragstart drag with no data gets an empty text/plain.
