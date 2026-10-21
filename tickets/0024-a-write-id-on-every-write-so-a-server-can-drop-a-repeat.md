---
number: 24
uuid: 76ca643a-92da-49c6-9c31-535dcbb57586
title: "A write id on every write, so a server can drop a repeat"
type: feature
status: open
tags: ["protocol","transport"]
created: 2026-10-21T00:00:31Z
updated: 2026-10-21T00:00:31Z
---

Follow-up to #11. When a server drops a reused keep-alive connection before answering, Chromium
and Firefox resend the write by themselves; Tessera called `fetch` once and cannot prevent it
(`docs/decisions.md`, "Browsers resend some writes themselves"). Give the server what it needs to
recognise the repeat.

- Every write (POST, PUT, PATCH, DELETE) carries a header with a unique id per submission, made
  with `crypto.randomUUID()`. The browser's own repeat of that request carries the same id,
  since it is the same request. A new submission of the same form gets a new id. Name the header
  in the plan (for example `Tessera-Write-Id`) and fix the name in `docs/protocol.md`.
- `docs/protocol.md` (sections 4.2, 4.5 and the server checklist): a server that sees an id it
  has already seen, within a window it chooses, answers with the first answer or with `409`, and
  never applies the write twice. Say how long a window is reasonable and that ids are untrusted
  input (scope them to the session).
- Interceptors cannot remove or change the id.
- The reference server keeps the ids it has seen and answers a repeat as the protocol says, so
  the fixtures model a correct server.

Acceptance: unit tests for the header on each write method and not on GET, a new id per
submission, and the id surviving interceptors. A browser test **without** `--close-connections`
(a second reference server, or a per-test way to keep connections alive; choose in the plan):
the server drops a reused keep-alive connection after the POST arrives, the browser's own repeat
arrives, and both carry the same id; the reference server applies the write once. Chromium and
Firefox; WebKit with #20.
