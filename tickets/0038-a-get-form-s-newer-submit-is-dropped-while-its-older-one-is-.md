---
number: 38
uuid: 5598b210-bcd2-4a4b-942c-2feb8ffff13f
title: "A GET form's newer submit is dropped while its older one is in flight"
type: bug
status: done
tags: ["forms","coordination"]
created: 2026-11-03T02:57:52Z
updated: 2026-11-03T03:09:24Z
phase: "check"
closed: 2026-11-03T03:09:24Z
---

src/forms.ts returns early with `if (inFlight.has(form)) return;` for every form. Protocol 4.5's rule, no second submission of a form while its first is in flight, exists for writes. A GET form's submission is a visit, a read, and protocol 4.6 says a newer read supersedes an older one on the same target.

Found by Lotline's search as you type (the case #37 describes): a search box submits its GET form on a debounced input. With a slow answer, the submit for "cr" is dropped while the one for "c" is in flight; the answer to "c" lands and the list stays on "c" while the box says "cr".

The fix: the in-flight guard applies to non-GET submissions only. A GET submission is sent, supersedes the older visit as overlapping visits already do (aborted, or its late fragment dropped by the generations), and a late answer to the older one never paints over the newer one. The indeterminate-write handling of non-GET forms stays as it is. Protocol 4.5 and 4.6 say so.

Acceptance: a unit test where a GET form submits twice and both go, the newer committing; the existing POST tests still block; a browser test where two GET submits overlap on a slow answer and the newer one wins.

## Comments

### 2026-11-03T02:58:03Z

Plan.

- `formEligibility` already reads the submission's method (the submitter's `formmethod`, else the form's); its accepted result now carries it as `method`. In `interceptForms`, a `get` submission skips the in-flight set entirely: it is neither blocked by it nor added to it, so a GET submit while a POST of the same form is out still goes (and queues behind the write, as 4.6 says), and a POST after a GET is not blocked by the read. The indeterminate message and the 422/409 focus stay as they are; only a non-GET submission removes an old indeterminate message.
- Supersession needs nothing new: the transport already aborts an older read on the same or an inner target, and the generations drop a late fragment.
- Docs: protocol 4.5 says the rule is for writes and a GET form's newer submission supersedes; 4.6 says a GET form's submissions are reads. CHANGELOG under Unreleased.
- Tests: unit (`test/unit/forms.test.ts`) two GET submits both sent, the first aborted, the second committed; a GET submitter on a POST form while the POST is out goes; the POST block test unchanged. Browser: a `/search` page on the reference server (a GET form with a debounced input, region `results`); with the form pointed at the controller, "c" is held, "cr" is sent, the newer answer commits and the older is aborted or, released late, dropped.

### 2026-11-03T03:09:24Z

Delivered via PR #45 (63caf18). A GET form's newer submit is sent and supersedes the older; writes stay blocked. Released in Tessera 0.4.1 (PR #47, f7ce44d): https://github.com/Ignibyte/tessera/releases/tag/v0.4.1
