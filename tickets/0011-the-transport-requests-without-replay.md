---
number: 11
uuid: 4b188507-8ac6-45fd-bcb7-d28399cf60e2
title: "The transport: requests without replay"
type: feature
status: open
tags: ["transport","fix"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
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
