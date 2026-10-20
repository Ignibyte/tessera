---
number: 10
uuid: f4851041-6fd1-4e46-a0bf-b51d1953c12c
title: "The SSE parser"
type: feature
status: in-progress
tags: ["sse","port"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T23:43:03Z
phase: "docs"
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

## Comments

### 2026-10-20T23:40:20Z

Plan.

`src/sse.ts`, ported from jqstar `src/sse.ts` and brought to the WHATWG HTML event-stream
interpretation ("Server-sent events", parsing an event stream):

- `EventStreamParser`: `feed(chunk)` takes bytes (`Uint8Array`, decoded by one streaming
  `TextDecoder`, so a chunk may end inside a multi-byte character) or text, and returns the
  events the chunk completed: `{ type, data, lastEventId }`. `end()` flushes the decoder and
  discards what is incomplete.
- Line endings CRLF, LF and bare CR, including a CR at the end of one chunk and its LF at the
  start of the next (jqstar handled LF and CRLF, and a CR split from its LF made an empty line).
- One leading U+FEFF is ignored, at the start of the stream only.
- Fields: `event`, `data` (each line appended, the last LF dropped), `id` (ignored when it
  contains NUL), `retry` (ASCII digits only); comment lines; unknown fields ignored; one space
  after the colon removed.
- Three places jqstar departs from the spec, now as the spec says, which a Provisional decision
  records: an event not ended by a blank line is never dispatched (jqstar's `finish()`
  dispatched it); `retry` sets the parser's reconnection time at once, not a field on the next
  event; and a block with `id` but no `data` still sets the last event ID at its blank line
  (the parser's `lastEventId`, kept across events, as the spec's "last event ID string").
- `dataFields(data)` (jqstar `sseDataFields`): the protocol's `data: KEY VALUE` lines grouped by
  key, in order (docs/protocol.md 7.2).

Tests: `test/unit/sse.test.ts` with the spec's examples and jqstar's four cases (the
unterminated-event case inverted, as above). `test/property/sse.test.ts` (fixed seed): any
chunking at byte level (inside CRLF pairs and multi-byte characters) yields the same events,
last event ID and retry as feeding the whole; a serialised event list parses back to itself;
jqstar's chunk-boundary and data-field properties. `test/property/regressions.json` holds
counterexamples as named cases, replayed by a test: jqstar's `sse-crlf-boundary` is the first.
