---
number: 39
uuid: cfa3940f-ff91-4eca-a03a-7410c2a57bec
title: "Back to an entry pushed by a nested-region visit, from a page without that region, lands nothing"
type: bug
status: open
tags: ["navigation","history"]
created: 2026-11-03T03:07:16Z
updated: 2026-11-03T03:07:16Z
---

Found while building #37 (2026-11-02). An entry records the targets of the visit that pushed it, and Back or Forward fetches those targets again (`src/history.ts`, popstate). When the entry was pushed by a visit of a region nested inside another, and the user pops to it from a page that lacks that region, the fragment for it is dropped as "left the page while its request was in flight" and the outcome is `committed`, so nothing reloads: the address names the entry while the page shows the other one.

Reproduced on the reference server: from Home, visit `/search` (target `content`), submit the GET form without `data-push` (a push of `results`, inside `content`), follow the sidebar link to About (target `content`), go Back. The URL is `/search?q=c`, the page still About.

#37 fixed this for replaced entries, which record the targets that made the entry widened by the replacing visit's (`replacedTargets`). A pushed entry has no earlier entry to widen from. Options: a pop visit whose targets are not all on the page asks for the page (`Tessera-Targets` absent), as a visit from another layout already does; or a pushed entry records the outer target the page had when it was pushed. Acceptance: a browser test of the steps above lands on Search with the query.
