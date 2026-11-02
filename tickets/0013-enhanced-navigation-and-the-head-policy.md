---
number: 13
uuid: 6fd43032-d010-4511-8c57-e33e43e1ab15
title: "Enhanced navigation and the head policy"
type: feature
status: done
tags: ["navigation"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-21T00:21:35Z
phase: "docs"
closed: 2026-10-21T00:21:35Z
---

Visit interception (jqstar 0024) and the head and asset policy (jqstar 0025). Read both tickets
in `../jqstar/docs/tickets/`.

- Same-origin link clicks (no modifier keys, no `target`, no `download`, not opted out) become
  enhanced visits: an enhanced GET naming the regions to update; the response's fragments commit
  through #12. A response that asks for a full visit, or a missing region, falls back to
  `location.assign` with the already-known URL, never a second fetch of a write.
- Opt-out and whole-document attributes per `docs/protocol.md`.
- Morph rather than replace `<body>` on a whole-document visit (Livewire).
- Head: update `<title>`; tracked assets (an attribute on `<link>` and `<script>`) compared by
  value, and a change forces a full load; scripts in fragments never run.
- A delayed progress bar (shown after a threshold, as Livewire's).

Acceptance: browser tests in every engine for link interception and its exclusions, a region
update without a full load, the full-visit fallback, a tracked asset change forcing a load, and
a fetched `<script>` not running. Each scenario also passes with JavaScript off (the plain
document).

## Comments

### 2026-10-21T00:12:07Z

Plan. jqstar 0024 and 0025 were declined there and never built; this takes what the ticket lists
and docs/protocol.md section 9 already fixes.

`src/navigation.ts`:
- `linkEligibility(event)`: a pure check with a reason for each refusal: primary button, no
  modifier keys, not already prevented, an `<a href>` (HTML namespace) in this document, no
  `target` other than `_self`, no `download`, an http or https URL of the page's origin, not a
  fragment-only change of the current URL, and the nearest `data-enhance` not `off`.
- `interceptLinks(...)`: one delegated `click` listener on the document, owned by the kernel,
  turning an eligible click into a `visit` through the transport (#11, #12) with the link's
  targets (`data-target`, else its innermost region, else `page`), and `visit(url)` for code.
- `commitDocument(html, url)`, the seam #11 left for whole documents (protocol 9), in order:
  parse inertly (`DOMParser`); compare tracked assets and, if they differ, load in full before
  anything changes; add the incoming head elements the current head lacks (by markup; scripts
  never), waiting for new stylesheets to load or fail (with a timeout) before the body changes;
  take the incoming `<title>`, `lang`, `dir` and the `tessera-layout` and `tessera-csrf-token`
  metas; morph `<body>` in place (Livewire), keeping each element with `data-permanent` and an
  `id` that the incoming body also has; then remove the current head elements the incoming head
  lacks.
- A delayed progress bar (`src/progress.ts`): a thin bar shown only when a visit takes longer than
  a threshold (200 ms by default, Livewire uses 150), removed when it settles.

Changes: the patcher gains `patchBody` (the body morph through one render transaction, with the
held-back scope hand-over of #9 and permanent elements as preserved roots); the transport's
`commitDocument` returns whether it committed or loaded in full, a committed document visit
records its URL, and it touches the page's generation. The reference server's layout puts
`data-target="content"` on its sidebar links (protocol example 10.1), gains a `build` value on
its tracked stylesheet, and new routes: `/redeploy` (a different build), `/away` (answers a
Tessera request with `Tessera-Full-Visit: /about` and a plain one with a redirect), `/scripted`
(a page whose content holds a script) and `/links` (each excluded kind of link).

Tests: unit tests for every eligibility rule, the head policy, the body morph with permanent
elements, and the progress bar's delay. Browser (`test/browser/navigation.spec.ts`), each with
JavaScript on and off: a link updates `content` without a full load (a marker on `window`
survives, the sidebar is the same node); each exclusion is left to the browser; a link to the
`bare` layout commits the whole document by morphing; `Tessera-Full-Visit` and a missing region
fall back to a full load; a changed tracked asset forces a full load; a fetched script does not
run. Chromium and Firefox.

### 2026-10-21T00:21:35Z

Delivered via PR #14 (49ab803). Link interception, whole-document commits by the protocol 9 head policy with a body morph keeping data-permanent, and a delayed progress bar.
