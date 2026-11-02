---
number: 36
uuid: 01cfd7e5-efd1-417f-836a-1a27cad2dac9
title: "Devtools hooks: an event per exchange, an event per patched element, and a highlight mode"
type: feature
status: in-progress
tags: ["devtools","events"]
created: 2026-11-02T18:01:08Z
updated: 2026-11-02T18:27:39Z
phase: "docs"
---

AIC is building a web profiler (AIC #229 to #231) whose toolbar shows each Tessera exchange live
and lets a developer see what a response changed. Tessera knows those facts; nothing outside it
can read them today: `intercept().after` gives the outcome, not the response's size, timing or
what was patched.

Add, generic and with no framework names in `src/`:

- **`tessera:exchange`**, raised on the document when any request settles (visit, submit, action,
  refresh, poll, lazy load, prefetch; a stream's connect and each event): `detail` holds the kind,
  the URL, the method, the targets sent, the status, the response's content type, its byte length,
  the response headers a page may read (a list, so a server's own debug header such as
  `X-AIC-Profile` reaches a listener), the time to first byte and to settled, and the outcome.
  Not cancelable; raising it costs nothing when no one listens.
- **`tessera:patched`**, raised on each element a fragment, a stream event or a morph replaced
  or updated, after the change: `detail` holds the target and the mode (`replace`, `append`,
  `prepend`, `morph`).
- **`<meta name="tessera-debug" content="highlight">`**: when the page carries it, each patched
  element gets `data-tessera-patched` for about 600 ms, and the docs give the CSS outline a page
  may use. With the meta absent nothing is added.

Export the two event names as constants, document both events and the meta in `README.md` and
`docs/protocol.md` (no wire change: the protocol version stays 2), and size them against the
budget. Tests: units for the event details, a browser test per kind of exchange, and one showing
the highlight attribute comes and goes. Release it as 0.4.0 so AIC can pin it.

## Comments

### 2026-11-02T18:15:19Z

Plan.

Approach: a new module `src/devtools.ts` holds `EXCHANGE_EVENT` (`tessera:exchange`), `PATCHED_EVENT` (`tessera:patched`), the detail types and the highlight. The transport, the streams and the patcher raise them; both builds export the two names and the detail types.

- `tessera:exchange`, on the document, not cancelable, does not bubble (the document is the top). Raised once per request that settles, after the interceptors' `after`: from `run` for visits, submits, actions, refreshes, polls and lazy loads (a poll that yields included, outcome `skipped`); from `prefetch` when the prefetched answer arrives, fails or is dropped; from `connect` for each stream connection; from the stream channel for each event. A request Tessera refuses before making it (bad URL, another origin, a GET with a body, an anchor that does not resolve) raises none; `tessera:error` reports those.
- Detail: `kind` (`visit`, `submit`, `action`, `refresh`, `poll`, `lazy`, `prefetch`, `stream`, `stream-event`), `url`, `method`, `targets` (as resolved and sent), `status`, `contentType` (the media type), `bytes` (body bytes Tessera read, counted by the body lease as it reads; for an event, its data's UTF-8 length), `headers` (the `[name, value]` pairs fetch lets the page read), `startTime` (`performance.now()` when sent), `firstByteMs`, `settledMs`, `outcome`, `prefetched` (a visit that took a prefetched answer) and `event` (the SSE event type, events only). Absent values are `null`, so the detail serializes whole. Lazy loads get `lazy: true` on the request input, as polls have `poll`.
- `tessera:patched`, bubbling from each target element after its render transaction commits: from `patchElements` (fragments, stream events, the harness API) and `patchBody` (a whole-document morph, target `page`). Detail `{ target, mode }` with Tessera's patch modes (`morph`, `inner`, `append`, `prepend`); the ticket's `replace` is `inner`. A `remove` raises none: the element is gone.
- Highlight: `<meta name="tessera-debug" content="highlight">`, read at each patch; the patched element gets `data-tessera-patched` for 600 ms, the timer in the kernel's ledger (disposal clears it), a repeat patch restarting it. README gives the CSS outline.

Files: src/devtools.ts (new), src/transport.ts, src/streams.ts, src/patch.ts, src/body.ts (a byte count), src/lazy.ts, src/index.ts, src/csp.ts; test/unit/devtools.test.ts (new); test/browser/devtools.spec.ts (new) with fixture pages as needed; README.md, docs/protocol.md, docs/decisions.md, CHANGELOG.md.

Criteria: units for each detail (request kinds, prefetch, stream connect and event, the patched detail, the highlight timer with fake timers); a browser test per kind (visit, submit, action, refresh, poll, lazy, prefetch, stream connect and events), one that reads a server header from `headers`, and one showing `data-tessera-patched` come and go, with none when the meta is absent. Size: measured against size-budget.json (31,717 / 39,573 today, budgets 35,514 / 44,209). Then release 0.4.0 per RELEASING.md, as the ticket asks.

Decisions (Provisional, in docs/decisions.md): the kind list, null for absent values, timings measured from the send, prefetch raising its own exchange, mode names, no event for `remove`.
