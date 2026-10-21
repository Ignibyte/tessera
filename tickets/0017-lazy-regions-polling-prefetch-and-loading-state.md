---
number: 17
uuid: ee58bae5-60d7-4b4c-8d4a-979bd76e1390
title: "Lazy regions, polling, prefetch and loading state"
type: feature
status: done
tags: ["regions","livewire"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-21T01:37:17Z
phase: "docs"
closed: 2026-10-21T01:37:17Z
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

## Comments

### 2026-10-21T01:17:58Z

Plan.

Already in place: `data-loading` on the initiating element and `aria-busy` on the target came with #12, and `data-permanent` across whole-document visits came with #13. Lazy loads and polls pass their element to the transport, so both attributes apply to them too.

Lazy regions (`src/lazy.ts`): `data-lazy="URL"` sends one `refresh` GET when the element is rendered. `data-lazy__visible="URL"` waits for an `IntersectionObserver` (kernel-owned, rooted at the element) and loads at once where there is none. The target is the innermost component or region containing the element, else `page` (protocol 4.1). Each element loads once.

Polling (`src/polling.ts`): `data-poll[__DURATION]="URL"`, where the duration is a modifier in the directive grammar (`__5s`, `__750ms`) and the default is 2 s. One shared clock per interval, so polls with the same interval fire on the same tick. When the window does not have focus, only every 20th tick fires (Livewire skips 95%). No poll fires while the page is hidden or the browser is offline. A poll is a `refresh` with `poll: true`, so it yields to every overlapping request (protocol 4.6). A clock stops when its last poll leaves, and each poll is a ledger subscription rooted at its element. Both attributes are found by a scan at install plus a kernel-owned observer, as `data-stream` is.

Prefetch (`src/navigation.ts`, `src/transport.ts`): on mousedown, an eligible link starts its visit's fetch early with the visit's headers (interceptors' `before` runs then, not again). A link with `data-prefetch="hover"` also prefetches after 60 ms of hover, and `data-prefetch="off"` (nearest wins) turns prefetch off. The visit that follows, with the same URL, targets and layout, takes the prefetched response instead of fetching; it is used once. The generation recorded is the prefetch's, so a commit between mousedown and click still makes that fragment stale. Entries expire after 30 s. A failed prefetch falls back to a normal fetch, and a `Cache-Control: no-store` answer is never used (protocol 8), so that visit fetches again.

Persisted nodes (`src/patch.ts`): `data-permanent` elements with an `id` are also kept as the same live node, unmorphed, through fragment morphs (`morph` and `inner`) when the incoming markup has the same `id` with `data-permanent`.

Files: `src/lazy.ts`, `src/polling.ts` (new); `src/navigation.ts`, `src/transport.ts`, `src/patch.ts`, `src/directive.ts` (reserve `prefetch`); the harness; the reference server (pages `/lazy`, `/poll`, `/persist-a`, `/persist-b`, `/persist-c` on the bare layout); unit tests `test/unit/polling.test.ts`, `test/unit/lazy.test.ts`, `test/unit/prefetch.test.ts` and patch cases; browser tests `test/browser/regions.spec.ts`.

Acceptance:
- Clocks and throttling: unit tests with fake timers (one timer per interval, every 20th tick without focus, nothing while hidden or offline, the clock stops with its last poll).
- Lazy region: a browser test sees `/lazy` fill a region on render and another only after it scrolls into view.
- Poll pausing while hidden: a browser test sees the ticker advance, stop while the page reports hidden, and resume.
- Prefetch saving a request: a browser test holds the prefetch in the controller; mousedown, then click, then release; the controller saw one request and the visit landed.
- Persisted node: a browser test keeps `#player` as the same node with its state across a fragment visit and across a whole-document visit.

Decisions (Provisional, docs/decisions.md): the duration modifier syntax, `__visible`, the background rule (no window focus means every 20th tick), the `data-prefetch` attribute and its values, prefetch timing and expiry, and `data-permanent` in fragment morphs. Protocol section 3 and section 8 are updated to match.

### 2026-10-21T01:32:07Z

Check passed (typecheck, lint, 608 unit and property tests, build, size), and the browser suite passed: 126 tests in Chromium and Firefox, 8 of them in the new `regions.spec.ts`, which also passed 24 of 24 with `--repeat-each 3`. Two things the plan did not name: the attribute watcher went in `src/watch.ts`, which lazy loads and polls share, and `ownerPath` moved out of `Scopes` in `src/scopes.ts` so a refresh target can be computed without a mount. Polls are refused under 100 ms.

### 2026-10-21T01:37:03Z

Correction: the check I ran right before committing failed on one unit test, and I pushed anyway because a pipe into `tail` hid the exit code. The failing test was #16's 'shares one stream per URL…', which is flaky: under load its fixed 5 ms wait can fire before the stream's one-task grace timer. The stream code is right; the test now waits for the closed state, and so does its 'switches streams' sibling. After the fix: 15 of 15 runs of `streams.test.ts` passed, 8 of 8 runs of the whole unit suite passed, and `npm run check` exited 0.

### 2026-10-21T01:37:17Z

Delivered via PR #21 (c0c1c9b). Lazy regions, shared-clock polling with background throttling and pauses, prefetch on mousedown or hover, data-permanent through fragment morphs.
