---
number: 43
uuid: fedaecad-3ef4-463f-9c7e-72ee72d1cf84
title: "A press leaves the hover timer running: one extra prefetch after the click"
type: bug
status: done
tags: 
created: 2026-11-04T00:27:19Z
updated: 2026-11-04T00:28:40Z
phase: "code"
closed: 2026-11-04T00:28:40Z
---

Found by Lotline #31 (aic-demo) on 0.4.2: a pointer moved onto a data-prefetch=hover link starts the 60 ms timer; mousedown prefetches and the click takes that answer, then the timer fires a second, unused prefetch of the page just opened (navigation.ts: the hover timer is cancelled only by mouseout). Lotline's navigation looks saw the extra fetch. Fix: a press cancels a waiting hover or focus prefetch, since the press prefetched. Unit test; CHANGELOG.

## Comments

### 2026-11-04T00:28:40Z

Delivered via PR (04e69e7). A press cancels a waiting hover or focus prefetch.
