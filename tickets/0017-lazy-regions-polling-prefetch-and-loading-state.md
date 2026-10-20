---
number: 17
uuid: ee58bae5-60d7-4b4c-8d4a-979bd76e1390
title: "Lazy regions, polling, prefetch and loading state"
type: feature
status: open
tags: ["regions","livewire"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
---

The Livewire-derived behaviours from `docs/design.md`, on top of #12 and #13.

- Lazy regions: load once on render, or when visible (`IntersectionObserver`), from a same-origin
  GET.
- Polling: an attribute with an interval; shared clocks so polls with the same interval fire
  together; throttled in background tabs; paused while hidden; yielding to actions on the same
  target.
- Prefetch on mousedown (or on hover after a delay) for enhanced links, used once.
- Persisted nodes: an attribute keeps an element (a video, a map) across visits.
- `data-loading` on the initiating element and `aria-busy` on the target (with #12).

Acceptance: unit tests with fake timers for the clocks and throttling, and browser tests for a
lazy region, a poll pausing while hidden, prefetch saving a request, and a persisted node keeping
its state across a visit.
