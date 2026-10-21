---
number: 27
uuid: d6961fc1-957f-4268-b4ec-b727be5571b2
title: "The browser suite's failures in WebKit"
type: bug
status: in-progress
tags: ["testing","webkit"]
created: 2026-10-21T02:02:47Z
updated: 2026-10-21T02:16:08Z
phase: "docs"
---

Found by #20, the first time the whole browser suite ran in WebKit (`npm run test:browser:webkit`, Playwright 1.62.1, webkit-2336). Out of 65 tests:

- `write-id.spec.ts`, "the browser's repeat of a dropped write carries the same id and is applied once", fails every run. WebKit does not resend the POST whose reused keep-alive connection was dropped: the server logs one arrival, where Chromium and Firefox log two with the same write id. The test asserts a browser's own behaviour, not Tessera's. In WebKit it should assert what WebKit does (one arrival, and the outcome Tessera reports for a dropped write), without skipping. `docs/decisions.md` ("Browsers resend some writes themselves") names only Chromium and Firefox; record WebKit there too.
- `streams.spec.ts` fails now and then: 1 of 50 in a repeated run ("a dropped connection reconnects…"), and once in two full runs ("events morph a region and a component…", where only "Event 1" of three arrived within 5 s). The cause is not known yet: WebKit buffering a streamed `fetch` body, the stream code, or the test's timing. Find it before deciding.

Ordering: #18 counts only when the suite passes in all three engines, so this lands before #18.

## Comments

### 2026-10-21T02:09:08Z

Plan, with the cause of the stream failure.

Cause: WebKit, not Tessera. A probe read `/events/stream` with plain `fetch` in the container's WebKit, no Tessera code on the page, and checked whether all three events arrived within 1.5 s:
- Reference server (`--close-connections`): 1 of 200 runs got only the first 123 bytes, `retry` plus the first event, and nothing more. Chromium: 0 of 200.
- A minimal Node server sending the same bytes: `Connection: close` stalled 3 of 1,500 under `text/event-stream` and 1 of 1,500 with `X-Content-Type-Options: nosniff`, so MIME sniffing is not the cause. Keep-alive stalled 0 of 1,500 there, but the keep-alive reference server stalled 1 of 1,500, so `Connection: close` only makes it more likely.
- With a comment written every 300 ms, a stalled run got its first 123 bytes at 2 ms and the other 835 at 303 ms, when the next comment arrived.

So WebKit holds bytes it has already received until more arrive, cutting inside a single server write. The stream code never sees them, so there is no race in Tessera to fix. A burst's tail waits for the server's next write, which in the reference stream is the keep-alive comment every 15 s, longer than the test's 5 s wait. This was seen in Playwright's Linux WebKit (webkit-2336); Safari on macOS uses another network stack, untested.

Fix:
- `test/server/stream.ts` gains `beat=MS`, the keep-alive comment interval (default 15000, from 100). `streams.spec.ts` opens every stream with `beat=250`, so a held tail is released within 250 ms, and still asserts that each event arrives exactly once.
- `docs/protocol.md` 7.1: a server should send a comment at least every 15 seconds while a stream is idle, and the gap bounds how long WebKit can hold a burst's tail. Recorded in `docs/decisions.md` (Provisional).
- `write-id.spec.ts`, engine-neutral as the driver specified: the counter is applied exactly once. Then either two arrivals with the same id, the second answered from the store, and the outcome `committed`, or one arrival and the outcome `indeterminate` with the indeterminate report. The test asserts whichever the log shows and branches on nothing else. The decision "Browsers resend some writes themselves" gains WebKit's behaviour.

Acceptance: the whole suite passes in WebKit (`npm run test:browser:webkit`) on repeated runs, `streams.spec.ts` with `--repeat-each 20` in WebKit, and `npm run test:browser` and `npm run check` exit 0.

### 2026-10-21T02:16:08Z

Results (exit codes tested): `npm run check` 0 (629 tests); `npm run test:browser` 0 (130 tests, Chromium and Firefox); the whole suite in WebKit 0 in five full runs, 65 of 65 each; `streams.spec.ts --repeat-each 60` in WebKit 0 twice (600 of 600).

One thing the plan did not foresee: with `beat=250` in place, a 300-run WebKit repeat failed 3 times in "a visit of a region lands…". The failures were `A stream event targets content/latest, which is not on the page; it is dropped.` Same cause: WebKit held the step's later events past the comment, the test released the visit after the step's first event, and the late `content/latest` event arrived after the visit had replaced `content`. Tessera dropped and reported it, as protocol 7.2 says. The stream tests now wait for the whole step (list, component and signal) before they act. After that, 600 of 600 passed.

Nothing in `src/` changed: the cause is in WebKit's network layer, and the held bytes never reach Tessera.
