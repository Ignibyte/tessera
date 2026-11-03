---
number: 42
uuid: d1c3a4cb-f517-4c95-abbb-2cf99debd993
title: "Prefetch on focus, as on hover"
type: feature
status: in-progress
tags: 
created: 2026-11-03T23:10:05Z
updated: 2026-11-03T23:32:06Z
phase: "code"
---

Found by Lotline #31 (aic-demo): `data-prefetch="hover"` prefetches after 60 ms over the link itself,
and every enhanced link prefetches on mousedown, but nothing prefetches when a keyboard user focuses
the link (navigation.ts, closest a[href]). A row list whose VIN link a keyboard user tabs to never
gets the head start a pointer user does.

- Focus on a `data-prefetch="hover"` link prefetches as hover does (same delay, same reuse rules,
  cancelled on blur like mouseleave).
- Unit and browser tests; README and protocol section 8.

## Comments

### 2026-11-03T23:32:06Z

Plan: the link checks of linkEligibility() split into elementEligibility(element, document), which a focus prefetch uses (a FocusEvent has no button). A focusin on a data-prefetch=hover link arms the same 60 ms timer as a hover, but only when the last input was the keyboard (a keydown since the last mousedown or pointerdown), so a click's own focus does not prefetch again after the click took its press prefetch. focusout to outside the link cancels. Unit tests in test/unit/prefetch.test.ts, a browser test for Tab then Enter, README and protocol section 8.
