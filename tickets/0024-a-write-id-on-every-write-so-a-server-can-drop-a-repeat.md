---
number: 24
uuid: 76ca643a-92da-49c6-9c31-535dcbb57586
title: "A write id on every write, so a server can drop a repeat"
type: feature
status: done
tags: ["protocol","transport"]
created: 2026-10-21T00:00:31Z
updated: 2026-10-21T00:41:26Z
phase: "docs"
closed: 2026-10-21T00:41:26Z
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

## Comments

### 2026-10-21T00:37:38Z

Plan.

- Header: `Tessera-Write-Id`, on every POST, PUT, PATCH and DELETE, one `crypto.randomUUID()`
  per submission, made when the request is built. It is a protocol header, restored after the
  `before` interceptors like the others, so an interceptor cannot change or drop it. A GET never
  carries one, nor does the visit following a `Tessera-Location`. A browser's own repeat is the
  same request, so it carries the same id.
- `docs/protocol.md`: 4.2 (the header), 4.5 (the browser's repeat now has an answer), the
  server checklist, and a new 5.8 for servers: keep each id seen for at least five minutes (a
  browser repeats within seconds; the window covers slow networks and proxies); a repeat within
  the window gets the first answer again (or `409` when it is no longer at hand) and is never
  applied twice; scope ids to the session, since they come from the browser; an id that is not
  1 to 64 of `A-Z a-z 0-9 -` is a `400`. A request without the header is applied as before.
- Reference server: every Tessera write outside the controller passes through a store of ids
  (the reference server has no sessions, so the store is global): a repeat gets the stored
  answer and reaches no route. New `/counter`: GET shows a count; POST adds one and answers with
  the content region; `POST /counter?drop=once` adds one, stores its answer, and destroys the
  connection instead of answering, the first time an id arrives. `GET /counter/log` lists each
  arrival's id and whether it was a repeat.
- Playwright starts a second reference server **without** `--close-connections` (a second
  `webServer` on its own port, `TESSERA_KEEPALIVE_PORT`), for this ticket's browser test only.

Tests: unit tests for the header on each write method and not on GET, a new id per submission
and per `submit()`, the id surviving an interceptor that changes or deletes it, and none on a
followed redirect; server tests for the store (a repeat answered from it, applied once, a bad
id refused) and `drop=once`. Browser (`test/browser/write-id.spec.ts`, on the keep-alive server):
after a GET leaves an idle connection, a POST to `/counter?drop=once` arrives, the server drops
the reused connection, the browser's own repeat arrives with the same id, the reference server
answers it from the store, the count is 1 and the request commits. Chromium and Firefox.

### 2026-10-21T00:41:26Z

Delivered via PR #16 (3f4c0ce). Tessera-Write-Id per submission, protocol 5.8 for servers, the reference server deduplicating; the browser's own repeat shown with the same id.
