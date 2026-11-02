---
number: 36
uuid: 01cfd7e5-efd1-417f-836a-1a27cad2dac9
title: "Devtools hooks: an event per exchange, an event per patched element, and a highlight mode"
type: feature
status: open
tags: ["devtools","events"]
created: 2026-11-02T18:01:08Z
updated: 2026-11-02T18:01:08Z
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
