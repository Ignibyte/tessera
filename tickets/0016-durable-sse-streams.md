---
number: 16
uuid: f817d47f-2ea4-4f1f-bc21-b92dfe3c8610
title: "Durable SSE streams"
type: feature
status: in-progress
tags: ["sse"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-21T01:09:14Z
phase: "docs"
---

jqstar has only one-shot response streams. Build a stream channel on the parser from #10.

- Open a stream from an attribute (for example `data-stream="/path"`) or from the API; it lives
  as long as its owning element, through the kernel's ledger.
- Use `fetch` with a streamed body (not `EventSource`), so the protocol's headers go with it.
- Reconnect with backoff, honouring `retry`, sending `Last-Event-ID`; stop on a protocol
  "close" event, on a 204, and on disposal. Pause while the page is hidden if the stream says so.
- Each event carries fragments for any targets, up to the whole page, and signal patches; each
  commits through #12, so generations apply.
- One stream per URL per page, shared by its elements.

Acceptance: browser tests against the reference server: events morph a region and a component,
a dropped connection reconnects with the last id and resumes without duplicates, the stream ends
when its element is removed, and nothing leaks (kernel ledger empty after disposal).

## Comments

### 2026-10-21T00:56:30Z

Plan.

Approach: a new `src/streams.ts` holds one channel per absolute URL per page. A channel opens when its first holder arrives and stops one task after its last holder leaves, so a morph that swaps an element for one naming the same stream keeps the connection. Holders are elements carrying `data-stream` (found by a scan at install and a kernel-owned MutationObserver for added nodes and changed values) and handles from `streams.open(url, { element?, onEvent? })`. Each element holder is a kernel `subscription` rooted at the element, so the ledger releases it when the element leaves or a render removes it; the channel is a `service` in the ledger, so disposal stops it.

The loop reads the body with `fetch` and the parser from #10, one parser per connection, seeded with the last event id (a small constructor option in `src/sse.ts`, since an event without `id` must not clear it). Protocol 7.3 already fixes the rest: delay 1,000 ms unless `retry` says otherwise, doubled per failed attempt in a row up to 30 s, reset by an event; stop on `tessera-close`, `204`, the last holder leaving, `401`/`403`/`404`/`410` and a non-SSE `200` (reported); `419` raises `tessera:expired` and stops; `429`, `5xx` and network failures retry; a missing or wrong `Tessera-Protocol` loads in full. `Tessera-Stream-Pause: hidden` closes the connection while the page is hidden and reconnects on visible. Events are handled one at a time, in order.

Transport additions (`src/transport.ts`), so the protocol headers, interceptors and generations stay in one place: `connect(url, { lastEventId, signal })` sends the stream request (kind `stream`, `Accept: text/event-stream`, `Last-Event-ID`, `before` interceptors, protocol headers restored), and `commitStream(target, mode, markup)` commits one `tessera-patch-elements` without a staleness check and touches the generations, so an older answer still in flight for that target is dropped. A missing target is reported and dropped; `page` commits as a whole document (a changed tracked asset loads the current page in full). Signal patches go to the patcher. Every event, including unknown names, goes to the handle's listeners after it is applied.

Files: `src/streams.ts` (new), `src/transport.ts`, `src/sse.ts`, `test/browser/harness.ts`, the reference server (`stream.ts`: a component `events/latest` morphed and a `received` signal patched on each event, `drop=K` to destroy the first connection after event K, `status=N` for one answer), `pages/events.html`, unit tests `test/unit/streams.test.ts` (fake fetch: backoff, retry, stops, sharing, pause), browser tests `test/browser/streams.spec.ts`.

Acceptance:
- events morph a region and a component: the browser test sees `events` gain items and `events/latest` show the latest number, plus the signal.
- reconnect with the last id, no duplicates: `drop=2` destroys the first connection after event 2; the second request carries `Last-Event-ID: 2` and the list holds each event once.
- the stream ends when its element is removed: the server sees the connection close, and no `stream:` resource stays in the ledger.
- nothing leaks: after `kernel.dispose()` the ledger is empty (browser test) and the unit tests check the ledger after each stop.

Decision (Provisional, in docs/decisions.md): listeners get every event, not only unknown names; protocol 7.2 is updated to say so. The one-task grace before a channel stops is recorded too.

### 2026-10-21T01:09:14Z

Check passed (typecheck, lint, 575 unit and property tests, build, size), and the browser suite passed: 116 tests in Chromium and Firefox, 8 of them the new stream tests.

Two changes to the plan. The reference server reports connections through `/events/log?key=K` rather than the controller. The backoff has a floor: failures in a row back off from at least 100 ms, so `retry: 0` cannot turn a failing server into a request per task (recorded in docs/decisions.md and protocol 7.3).

One consequence of #12's generations for the driver to look at: a commit touches every target around its own, so a stream event for `events` (inside `content`) arriving while a visit of `content` is in flight makes that visit's fragment stale. The fragment is dropped and reported, while history still records the new URL. Requests already behave this way (a component refresh committing during a visit of its region), and the ticket asks for generations to apply, so I left it alone. With a busy stream it will happen often enough to notice. One option: let a visit's fragment win over touches from inside it.
