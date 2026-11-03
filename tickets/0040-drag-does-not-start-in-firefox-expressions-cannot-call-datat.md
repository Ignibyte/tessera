---
number: 40
uuid: 146e76ee-1c94-4864-bc42-210e2d5b7852
title: "Drag does not start in Firefox: expressions cannot call dataTransfer.setData()"
type: bug
status: open
tags: ["events","drag"]
created: 2026-11-03T10:30:42Z
updated: 2026-11-03T10:30:42Z
---

Found in Lotline (aic-demo) #30 (2026-11-03), the leads board. Firefox starts an HTML5 drag only when the `dragstart` handler calls `event.dataTransfer.setData(...)`; Chromium starts one without it. A card with `draggable="true"` and `data-on:dragstart` works in Chromium and never starts in Firefox, because a Tessera expression cannot reach `dataTransfer`. Lotline keeps a "Move to" menu that works everywhere. Either give `dragstart` a default `setData('text/plain', '')` when the element has a `data-on:dragstart`, or expose the event's `dataTransfer` to the expression (decide which fits the expression sandbox). Probe it in Firefox through Playwright.
