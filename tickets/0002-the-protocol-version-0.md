---
number: 2
uuid: 3d88eba9-e521-4ee4-844e-54f9ed090d6f
title: "The protocol, version 0"
type: docs
status: open
tags: ["protocol"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
---

Write `docs/protocol.md`: everything a server must do to speak Tessera, precise enough that AIC
(PHP) and Rustal (Rust) can each implement it without reading Tessera's source. Sources:
`docs/design.md` ("Requests and responses"), jqstar 0024 to 0028 in
`/srv/stacks/jqstar/docs/tickets/`, `src/protocol-datastar.ts` and `src/sse.ts` in jqstar, and the
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
