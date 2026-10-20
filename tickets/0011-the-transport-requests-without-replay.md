---
number: 11
uuid: 4b188507-8ac6-45fd-bcb7-d28399cf60e2
title: "The transport: requests without replay"
type: feature
status: in-progress
tags: ["transport","fix"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T23:58:45Z
phase: "docs"
---

Rewrite `src/fetch.ts` (593 lines) and keep the body lease from `src/protocol.ts`. This ticket
fixes jqstar's shipped defects (digest headline 4 and section 6):

- **No retry for anything but GET.** jqstar retries a POST up to 10 times on network failure
  (`fetch.ts:262-275`). A write that failed after dispatch is indeterminate: report it, never
  resend it.
- **Redirects are manual** (`redirect: "manual"` or reading `response.redirected` is not
  enough: use the protocol's 303 handling). A same-origin 303 becomes a fresh GET visit; 307 and
  308 for a write are errors.
- **4xx HTML is rendered.** A 422 or 409 with fragments commits in place; only a body the
  protocol does not recognise is an error.
- **The submitter is in the form data**: `new FormData(form, submitter)`, honouring `formaction`,
  `formmethod` and `formenctype`.
- **Supersession by target**, not by `"METHOD URL"`: the request key is the target identity.
  (The full overlap table is #12; here a newer request for the same target aborts the older.)
- The CSRF header from the page's configuration on every unsafe request.
- 419 raises a "page expired" event with a default prompt that reloads.
- The 5 ms request buffer and an interceptor lifecycle (before, after, error) as the extension
  seam, from Livewire.
- Abort on disposal; GET waits for page visibility.

Acceptance: unit tests with a fake `fetch` for every bullet, and browser tests against the
reference server showing a POST is sent once when the network drops after dispatch, a 303 lands
as a GET, a 422 renders its errors in place, and the submitter's name and value arrive.

## Comments

### 2026-10-20T23:46:33Z

Plan.

Files: `src/transport.ts` (rewritten from jqstar `src/fetch.ts`), `src/body.ts` (the body lease
from jqstar `src/protocol.ts`: a response body claimed once, as text or a stream of chunks,
cancelled on abort).

The request (protocol section 4): kinds `visit`, `submit`, `action`, `refresh`; headers
`Tessera-Request`, `Tessera-Protocol: 0`, `Tessera-Targets` (with each component's props token
read from its marker at send time), `Tessera-Layout`, `Accept`; `Tessera-Signals` on actions only
(`scopes.payload` and `encodeSignals` from #8; over 4,096 bytes the action is refused, unsent);
the CSRF header named by the page's metas on POST, PUT, PATCH and DELETE to the page's origin.
Forms use `new FormData(form, submitter)` and the submitter's `formaction`, `formmethod` and
`formenctype`; a GET form becomes the URL's query; multipart, urlencoded and text/plain bodies.
Another origin is never fetched. An action's default target is the innermost component or region
around its element (via `Scopes`), else `page`; `target` and `form` options override.

Dispatch, with the defects jqstar ships fixed:
- A write is dispatched once. Network failure, abort or a redirect answering it (`redirect:
  "manual"`) after dispatch is **indeterminate**: reported, never retried, never resent. Only a GET
  is retried, on a network failure before any response, twice with backoff.
- Reads use `redirect: "follow"`; `Tessera-Location` is followed as a fresh GET visit with the
  original targets, the body never resent; another origin becomes a full load.
- Every status with a recognized body commits (protocol 6): 422 and 409 fragments in place with
  no history entry; a 4xx or 5xx with fragments commits like a 200. 204 does nothing; 419 raises
  a cancelable `tessera:expired` event whose default asks to reload; `Tessera-Full-Visit` and a
  `400` without version 0 hand over to `location.assign`; an unrecognized body is an error (a
  visit falls back to a full load, a write is indeterminate).
- Supersession by target: a newer request naming a target aborts an older **read** naming it. A
  write is never aborted by a newer request (#12 decides queuing); a Provisional decision.
- The 5 ms buffer (Livewire): a request waits 5 ms before it goes, so a read superseded in that
  window is never sent. Writes are not coalesced.
- Interceptors (`before`, `after`, `error`), run once per logical request; `before` may add
  headers but sees the method, URL and body frozen (#15 builds the rest of that rule).
- GET waits while the page is hidden. Every request in flight is owned by the kernel: disposal
  aborts it (a write so aborted is indeterminate), and `whenEnhanced` waits for it.

Fragment responses (protocol 5.3) are parsed and checked before anything changes: only the
allowed top-level elements, no `page` template, no two targets where one contains the other, every
target present (a requested target that left the page is dropped and reported; any other missing
target makes a visit a full load and anything else commit nothing). Tracked-asset copies that
differ from the head force a full load. Then the templates commit through the patcher (#9), the
signal patches, the title and the CSRF token. A whole document (`text/html`) goes to a
`commitDocument` option that #13 fills; until then it is a full load. A committed visit pushes
its URL (#14 owns the ordering).

Tests: `test/unit/transport.test.ts` with a fake `fetch` for every bullet; `test/unit/body.test.ts`.
Browser (`test/browser/transport.spec.ts`, a `/transport` fixture page, the harness gaining the
transport): a POST whose connection the reference server drops after dispatch arrives exactly
once (counted at the server, after waiting past the GET backoff) and is reported indeterminate; a
303 lands as a GET visit; a 422 renders its errors in place; the submitter's name and value
arrive. The controller gains `{"drop": true}`, which destroys the held connection.
