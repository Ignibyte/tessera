---
number: 42
uuid: d1c3a4cb-f517-4c95-abbb-2cf99debd993
title: "Prefetch on focus, as on hover"
type: feature
status: open
tags: 
created: 2026-11-03T23:10:05Z
updated: 2026-11-03T23:10:05Z
---

Found by Lotline #31 (aic-demo): `data-prefetch="hover"` prefetches after 60 ms over the link itself,
and every enhanced link prefetches on mousedown, but nothing prefetches when a keyboard user focuses
the link (navigation.ts, closest a[href]). A row list whose VIN link a keyboard user tabs to never
gets the head start a pointer user does.

- Focus on a `data-prefetch="hover"` link prefetches as hover does (same delay, same reuse rules,
  cancelled on blur like mouseleave).
- Unit and browser tests; README and protocol section 8.
