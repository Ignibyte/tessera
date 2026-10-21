---
number: 27
uuid: d6961fc1-957f-4268-b4ec-b727be5571b2
title: "The browser suite's failures in WebKit"
type: bug
status: open
tags: ["testing","webkit"]
created: 2026-10-21T02:02:47Z
updated: 2026-10-21T02:02:47Z
---

Found by #20, the first time the whole browser suite ran in WebKit (`npm run test:browser:webkit`, Playwright 1.62.1, webkit-2336). Out of 65 tests:

- `write-id.spec.ts`, "the browser's repeat of a dropped write carries the same id and is applied once", fails every run. WebKit does not resend the POST whose reused keep-alive connection was dropped: the server logs one arrival, where Chromium and Firefox log two with the same write id. The test asserts a browser's own behaviour, not Tessera's. In WebKit it should assert what WebKit does (one arrival, and the outcome Tessera reports for a dropped write), without skipping. `docs/decisions.md` ("Browsers resend some writes themselves") names only Chromium and Firefox; record WebKit there too.
- `streams.spec.ts` fails now and then: 1 of 50 in a repeated run ("a dropped connection reconnects…"), and once in two full runs ("events morph a region and a component…", where only "Event 1" of three arrived within 5 s). The cause is not known yet: WebKit buffering a streamed `fetch` body, the stream code, or the test's timing. Find it before deciding.

Ordering: #18 counts only when the suite passes in all three engines, so this lands before #18.
