---
number: 16
uuid: f817d47f-2ea4-4f1f-bc21-b92dfe3c8610
title: "Durable SSE streams"
type: feature
status: open
tags: ["sse"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
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
