---
number: 15
uuid: ed4cabcf-8a15-43f5-be55-84ca669d3c30
title: "Forms without replay"
type: feature
status: open
tags: ["forms"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
---

jqstar 0027's contract, implemented on the transport from #11. Read the ticket in
`/srv/stacks/jqstar/docs/tickets/0027-*.md`.

- Enhance only same-origin forms; a form can opt out.
- The real submitter, `formaction` and friends (from #11).
- Middleware and interceptors cannot change the method, origin, encoding or body.
- A same-origin 303 becomes a GET visit; never follow 307/308.
- 422 or 409 HTML commits in place and focuses the error summary (an attribute in the
  protocol), else the first invalid field.
- After dispatch, any failure is indeterminate: no retry, no resubmit, a visible message.
- A second submit of the same form while one is in flight is blocked.
- File inputs send as multipart, unchanged.

Acceptance: browser tests in every engine against the reference server for each bullet,
including a dropped connection after dispatch sending exactly one POST, and each scenario's no-JS
baseline.
