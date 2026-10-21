---
number: 18
uuid: 76ce9579-d569-469d-8afe-393eba637369
title: "The navigation matrix"
type: chore
status: done
tags: ["testing","navigation"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-21T03:09:57Z
phase: "docs"
closed: 2026-10-21T03:09:57Z
---

Port jqstar's navigation acceptance fixture (`/srv/stacks/jqstar/test/fixtures/navigation-decision/`,
1,607 lines, 28 frozen scenarios each with a no-JS baseline) to the reference server and Tessera.

- Every scenario runs twice: JavaScript off (the baseline) and with Tessera; the final URL, the
  visible content, focus and history length must match the baseline unless the scenario says
  otherwise.
- All engines that run on this box.
- Scenarios the region model changes on purpose (fragments instead of documents) say how and why.

Acceptance: the matrix passes, and a deliberately broken Tessera (for example, following a
307 on a write) fails it; say in the PR that you tried.

## Comments

### 2026-10-20T22:58:26Z

Depends on #20 (WebKit in Docker).

### 2026-10-21T02:22:24Z

Plan.

Port: jqstar's `navigation-decision` fixture (server, page template, driver; 28 frozen scenarios in `quality/navigation-decision.json`) moves to the reference server under `/navigation/`, and its driver to `test/browser/matrix/`. jqstar's candidates (Turbo, htmx, its own bridge) and their corrections are dropped: the two candidates are `nojs` (JavaScript off, the baseline) and `tessera` (the harness boots Tessera).

Server (`test/server/navigation.ts`): jqstar's routes, session cookie and `/navigation/metrics` (reads, writes, revision, request records with the facts the scenarios check), on the `navigation` layout. It speaks the protocol as a Tessera server would: `main` and `activity` are regions; a Tessera request with `Tessera-Targets` gets fragments; a redirect answering a Tessera request travels as `Tessera-Location` (the metrics keep the logical 302 or 303); the header's links target `page` and get the full document. Answering is shared with the rest of the reference server: `answer`, `redirect` and the version check move from `server.ts` into `test/server/answer.ts`. Routes that need the socket (slow, network-error, the lost answer) are served on the response directly, as the stream is.

Matrix (`test/browser/matrix.spec.ts`, flows in `test/browser/matrix/flows.ts`): one test per scenario, run in Chromium and Firefox on the host and in WebKit through `npm run test:browser:webkit`. Each test runs the flow without JavaScript and with Tessera in fresh contexts, checks the scenario's frozen assertions in each, then compares the two final observations: URL, visible content (the route and the main heading), focus (one of the fixture's named fields, the main heading, the body or other) and history length. A field may differ only where the scenario declares it, with the reason. Every Tessera run also fails on a page error, and ends by disposing the kernel: no failure, nothing left in the ledger.

How jqstar-specific assertions port (where Tessera has no "applications" or "bridge phases"): `ownedRoots` becomes Tessera booted with its ledger live and a directive applied; `outgoingRootsRemainLive` and `zeroMutation` become an unchanged ledger and route; `noDuplicateApplications`, `createdReleasedLiveReconcile` and `orderedBridgePhases` (NAV-24) become one attributes mount, the same ledger after eight visits as after the first load, and no render left open; `preservedIdentityWhenEnhanced` uses a region scope on `#permanent` for the state; `visibleProgress` uses Tessera's progress bar; `visibleRecovery` for a lost write uses Tessera's indeterminate message. Each scenario's port and its declared differences are written down in `docs/navigation-matrix.md`.

One behaviour change I expect to make, Provisional: a visit whose GET fails at the network level after its retries loads the URL in full, so the browser shows its own error page, as without JavaScript. Today nothing visible happens (NAV-21). Other gaps the matrix finds get fixed when they are bugs, or recorded as declared differences with the reason when they follow a decision.

Acceptance: the matrix passes in all three engines. Then I break Tessera on purpose in a scratch commit and confirm the matrix fails: first the ticket's example (following a redirect on a write), then a resent POST and a stale commit. The PR says which breaks the matrix caught and which it did not.

### 2026-10-21T03:09:38Z

Results (exit codes tested): `npm run check` 0 (635 tests); `npm run test:browser` 0 (188 tests, Chromium and Firefox); `npm run test:browser:webkit` 0 (94 tests). Over four repeats the matrix passed 224 of 224 on the host and 112 of 112 in WebKit.

What the matrix found and what changed (all in `docs/navigation-matrix.md`, Provisional in `docs/decisions.md`):
- A visit the network refused did nothing visible (NAV-21). Now it loads the URL in full after its retries, as planned.
- A click cost two reads on a `no-store` site (NAV-02, 04, 07): #17 dropped the mousedown prefetch's `no-store` answer. A press's prefetch is the click's own request, so its answer is now used; a hover's is still dropped. This revises a #17 choice the driver accepted, so it is flagged for review.
- WebKit resolves a body cut short as complete (NAV-16): a write whose answer was lost arrived as an empty document, and Tessera reloaded the page. The body lease now fails a body shorter than its `Content-Length` (when there is no encoding).
- Accepted as #17's cost, not changed: mousedown prefetch sends one GET for a link whose click the page then cancels (NAV-20).
- Harness only: headless Chromium opens some modified-click tabs without Playwright reporting them (NAV-06 uses the server as witness); in Firefox, `page.request` fails once the page is an error page (the metrics use a request context of their own); Firefox's error page commits its URL late (NAV-21 waits for a steady URL).

Deliberate breakage, each in a scratch copy of `src/transport.ts`, undone after:
- writes following redirects: not caught by jqstar's 28, since no scenario answers a write with a real redirect. So I added TES-01 (a write answered by a 307), which catches it in both engines.
- a write resent after a failure reading its answer: caught by NAV-16 in Chromium only.
- a write resent after any network failure: caught by NAV-16 in both.
- a newer read no longer superseding an older one: caught by NAV-19 in both.

### 2026-10-21T03:09:57Z

Delivered via PR #27 (0c71763). The matrix passes in Chromium, Firefox and WebKit; it led to three Tessera fixes and TES-01.
