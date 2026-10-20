# Tessera

A browser runtime for server-rendered sites. The server sends HTML; Tessera morphs it into the
page one region or one component at a time, over normal responses or Server-Sent Events, and
keeps local reactive state in HTML attributes (Datastar's vocabulary, with explicit scopes).

AIC and Rustal both use it. Each speaks the protocol in `docs/protocol.md` from its own server
side; nothing in the browser side knows which framework is behind it.

Status: being built, ticket by ticket (`tickets/`). Nothing is released yet.

- Design: `docs/design.md`
- Decisions: `docs/decisions.md`
- Protocol: `docs/protocol.md` (ticket #2)
- Research behind it: `docs/research/`

Tessera is built from parts of jqstar (MIT); see `NOTICE`.
