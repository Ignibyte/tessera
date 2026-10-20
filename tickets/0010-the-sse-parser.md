---
number: 10
uuid: f4851041-6fd1-4e46-a0bf-b51d1953c12c
title: "The SSE parser"
type: feature
status: open
tags: ["sse","port"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
---

Port `src/sse.ts` (93 lines), the incremental parser, to the WHATWG event-stream grammar.

- Add bare-CR line endings (jqstar handles LF and CRLF only).
- Fields `event`, `data` (multi-line), `id` (ignored when it contains NUL), `retry` (digits
  only); comments; a BOM at the start.
- Fed by chunks split anywhere, including inside a CRLF pair and inside a multi-byte UTF-8
  character (decode with a streaming `TextDecoder`).

Acceptance: unit tests from the spec's examples, and property tests with fast-check (fixed seed,
regression file) that any chunking of a stream yields the same events as parsing it whole. Port
jqstar's SSE property tests.
