---
number: 30
uuid: 28c757c4-5826-4e30-b3aa-049cd3580ece
title: "A visit superseded in its buffer leaves its prefetch running"
type: bug
status: done
tags: ["navigation","prefetch","transport"]
created: 2026-10-21T04:03:01Z
updated: 2026-10-21T04:29:11Z
phase: "check"
closed: 2026-10-21T04:29:11Z
---

Found by the Mac mini run (#29): NAV-19 (`requestCancellationFacts`) fails every time in Chromium and WebKit on macOS. Playwright clicks there come fast enough that the second click lands within the first visit's 5 ms buffer.

Cause: `run` in `src/transport.ts` aborts the older visit when the newer one supersedes it. If the older visit is still waiting (the 5 ms buffer, a blocker, or `visible`), it returns `stopped()` before `takePrefetch`, so the prefetch its own mousedown sent stays in `prefetches` with its fetch still running. It is dropped only after 30 s or at disposal. The server answers it in full, and the matrix sees the slow request finish instead of being cancelled. Shown on the dev box with the transport fixture: prefetch `/slow` with `press: true`, request a visit of `/slow`, then of `/fast` at once. The slow visit comes back `superseded` and its fetch signal is never aborted. Nothing stale commits, so this costs a request and a connection, not correctness.

- A visit that stops before it takes its prefetch drops the prefetch waiting for it (it is the click's own request sent early, decision #18), so the fetch is aborted.
- A unit test with the fixture above; NAV-19 passing on the Mac in Chromium and WebKit (over SSH, `~/scratch/tessera`, as #29 ran it).

Acceptance: the unit test; NAV-19 passing on the dev box and on the Mac.

## Comments

### 2026-10-21T04:24:56Z

Plan. Each operation records the prefetch key of its request (visits by GET only). When `dispatch` stops a visit before it takes its prefetch (the buffer, a blocker or `visible`), it drops the prefetch waiting under that key, which aborts its fetch, unless another live operation has the same key: a second click on the same link supersedes the first and must still take the shared prefetch. Unit tests in `test/unit/prefetch.test.ts`: the #29 repro (the slow prefetch's signal is aborted, and the fast visit commits), and the double click on one link (one fetch, the second visit commits from the prefetch). Then NAV-19 on the dev box and on the Mac in Chromium and WebKit.

### 2026-10-21T04:29:11Z

Delivered via PR #32 (7431b28). A visit stopped before it takes its prefetch drops it unless a newer visit of the same URL waits for it; NAV-19 passes on the Mac in all three engines.
