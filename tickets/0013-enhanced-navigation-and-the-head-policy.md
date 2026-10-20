---
number: 13
uuid: 6fd43032-d010-4511-8c57-e33e43e1ab15
title: "Enhanced navigation and the head policy"
type: feature
status: open
tags: ["navigation"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
---

Visit interception (jqstar 0024) and the head and asset policy (jqstar 0025). Read both tickets
in `/srv/stacks/jqstar/docs/tickets/`.

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
