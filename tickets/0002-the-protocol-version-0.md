---
number: 2
uuid: 3d88eba9-e521-4ee4-844e-54f9ed090d6f
title: "The protocol, version 0"
type: docs
status: done
tags: ["protocol"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T22:15:04Z
phase: "check"
closed: 2026-10-20T22:15:04Z
---

Write `docs/protocol.md`: everything a server must do to speak Tessera, precise enough that AIC
(PHP) and Rustal (Rust) can each implement it without reading Tessera's source. Sources:
`docs/design.md` ("Requests and responses"), jqstar 0024 to 0028 in
`../jqstar/docs/tickets/`, `src/protocol-datastar.ts` and `src/sse.ts` in jqstar, and the
Livewire digest.

Cover:
- **Identities.** The region attribute and its name grammar; the component comment-pair markers
  (fix the spelling: generic, short, for example `<!--t:c KEY-->` ... `<!--/t:c-->`; AIC renders
  `<!--aic:c KEY-->` today and will follow); control-flow block markers; key rules (unique among
  siblings, the full identity is the path from the region); signed props as an opaque attribute
  Tessera sends back unread.
- **Request headers.** The header that marks an enhanced request and names the update kind, the
  header naming targets (regions and component paths), the CSRF header (name configurable on the
  page, for example through a `<meta>`), and what Tessera never sends.
- **Fragment responses.** The media type and the body: one or more fragments, each naming its
  target and mode (morph, inner, append, prepend, remove), plus signal patches. Say how a
  response asks for a full visit instead.
- **Status codes.** 200, 204, 303 after a write (followed as a fresh GET), 4xx with HTML
  rendered in place (422, 409), 419 page expired, 5xx; never follow 307/308 for a write.
- **SSE.** Event names and data lines for fragments and signal patches, `id` and `retry`,
  reconnect from `Last-Event-ID`, how a stream ends. Decide the event names: Datastar's
  (`datastar-patch-elements`, `datastar-patch-signals`) or Tessera's own. Record the choice in
  `docs/decisions.md` as **Provisional** with the reason; recommended: Tessera's own names with
  the same data-line shape, since the target model (regions and component paths, never CSS
  selectors) differs from Datastar's.
- **Caching.** `Vary` on every header that changes the response.
- **Head and assets.** Title updates, tracked assets (a change forces a full load), scripts in
  fragments never run.
- A worked example per request kind: request, response, what the page does.

Version the protocol (`Tessera-Protocol: 0` or similar) so a server can refuse a mismatched
client.

Acceptance: the document covers every row of the table in `docs/design.md`; every header, event
and attribute has one name; `docs/decisions.md` records the provisional choices.

## Comments

### 2026-10-20T22:09:22Z

Plan.

Approach: write `docs/protocol.md` as the server's contract, version 0, from `docs/design.md`, jqstar 0024 to 0028, jqstar `src/protocol-datastar.ts` and `src/sse.ts`, and the Livewire digest. Sections: versioning, identities (regions, component markers `<!--t:c KEY PROPS-->` ... `<!--/t:c-->`, block markers `<!--t:b-->` ... `<!--/t:b-->`, keys, paths, props), the attributes a server renders, request headers, fragment responses, redirects and full visits, status codes, SSE, caching, head and assets, a worked example per request kind, and a server checklist.

Files: `docs/protocol.md` (new), `docs/decisions.md` (provisional entries; the open SSE item moves to decided), `CHANGELOG.md`, `README.md` (the protocol line loses "(ticket #2)").

Decisions, each recorded as Provisional:
- SSE event names are Tessera's own, `tessera-patch-elements`, `tessera-patch-signals` and `tessera-close`, with Datastar's `data: key value` line shape. The target model (regions and component paths, never selectors) differs from Datastar's, so reusing its names would promise a compatibility that is not there.
- Header names `Tessera-Request` (kind: visit, submit, action, refresh, stream), `Tessera-Protocol: 0`, `Tessera-Targets` (each entry carries its component's props token), `Tessera-Layout`, `Tessera-Signals`; response headers `Tessera-Location` and `Tessera-Full-Visit`.
- Redirects for a Tessera request travel as `Tessera-Location` on a 200, because `fetch` with `redirect: "manual"` hides the Location of a 303. A real 3xx answering a write is an error, never followed, so a 307 or 308 cannot replay a body.
- `Tessera-Layout`: the page names its layout and a visit sends it, so a server can answer a visit to a page with another layout with the full document instead of fragments that leave stale regions behind.
- Fragment responses are `text/vnd.tessera+html`: top-level `<template>` elements naming target and mode, plus `<title>`, tracked elements and JSON signal patches.
- `page` is a reserved target name: the whole document.
- Signals go only with actions, in a header, as ASCII-only JSON, at most 4,096 bytes.

Acceptance: a table at the end maps every row of the design's request table to its section and example; a pass over the document checks each header, event and attribute appears under one name only; `docs/decisions.md` lists the provisional choices. `npm run check` passes (a docs-only change, run anyway).

### 2026-10-20T22:15:04Z

Delivered via PR #2 (d5524ee). docs/protocol.md specifies version 0 for servers; its choices are Provisional in docs/decisions.md.
