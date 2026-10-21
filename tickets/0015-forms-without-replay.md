---
number: 15
uuid: ed4cabcf-8a15-43f5-be55-84ca669d3c30
title: "Forms without replay"
type: feature
status: done
tags: ["forms"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-21T00:51:11Z
phase: "docs"
closed: 2026-10-21T00:51:11Z
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

## Comments

### 2026-10-21T00:46:25Z

Plan. jqstar 0027's contract (declined there) on the #11 transport, which already sends the real
submitter with `formaction`, `formmethod` and `formenctype`, never retries a write, follows a
same-origin `Tessera-Location` as a GET visit and never a 307 or 308.

`src/forms.ts`:
- `formEligibility(event)`: a pure check with a reason per refusal: not already prevented; an
  HTML `<form>` in this document; method `get` or `post` (a `dialog` form is the browser's);
  `formtarget`/`target` absent or `_self`; an http or https action of the page's origin; the
  nearest `data-enhance` (from the submitter, then the form) not `off`. The browser fires
  `submit` only after its own validation, so an invalid form never reaches Tessera, and
  `novalidate` / `formnovalidate` keep the browser's meaning.
- `interceptForms(...)`: one delegated `submit` listener on the document, owned by the kernel. An
  eligible submit is prevented and goes through `transport.submit(form, event.submitter)`.
  - A form already in flight is blocked: its second submit is prevented and sends nothing.
  - After a 422 or 409 has committed and the page has enhanced, focus goes to
    `[data-error-summary]` in the form's targets (protocol section 3), else the first
    `[aria-invalid="true"]` field, with the browser's scrolling.
  - An indeterminate outcome raises a cancelable `tessera:indeterminate` event on the form;
    unless it is cancelled, a `role="alert"` message appears before the form: the submission was
    sent, no answer came back, it may have been saved, check before sending it again. The next
    submit of that form removes it.
- The transport: after the `before` interceptors, a request with a body drops any
  `Content-Type` header, so fetch derives the encoding from the body; with the method, URL and
  body already frozen, no interceptor can change method, origin, encoding or body.

Fixtures: `/forms` with a form posting to `/form` (422, 303), a held form with two submitters and
one with a file input (posting to the controller), a GET form, an opted-out form, a cross-origin
form, a `required` field and a `dialog` form.

Tests: unit tests for every eligibility rule, the block, the focus after 422 and 409, the
indeterminate message and its event, and the encoding guard. Browser
(`test/browser/forms.spec.ts`, each with its JavaScript-off baseline where the browser alone
can do it): opt-out and cross-origin left to the browser; the submitter's name and value; a 303
landing as a GET visit; a 307 answering the write not followed; a 422 committing in place with
focus on the summary; a dropped connection sending exactly one POST, with the message; a second
submit while in flight sending nothing; a file arriving as multipart; an invalid form sending
nothing. Chromium and Firefox.

### 2026-10-21T00:51:11Z

Delivered via PR #18 (e44bcfc). Form interception on the transport, a blocked second submit, focus after 422 and 409, the indeterminate message, and the encoding guard.
