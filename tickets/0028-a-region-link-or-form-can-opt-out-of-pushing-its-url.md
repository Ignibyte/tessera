---
number: 28
uuid: 655dc928-6759-4c13-b547-a93b6983447f
title: "A region link or form can opt out of pushing its URL"
type: feature
status: done
tags: ["navigation","history"]
created: 2026-10-21T03:12:55Z
updated: 2026-10-21T03:49:18Z
phase: "check"
closed: 2026-10-21T03:49:18Z
---

Found by the navigation matrix (#18, NAV-17): a link with `data-target` pushes its URL, so a region swap such as a tab or a refreshed panel leaves an address whose document differs from the page on screen, and a reload shows another page. Tessera has no way to say "don't push" (driver, 2026-10-20).

- A protocol attribute a server renders on a link or a form (or its submitter), for example `data-push="off"`, for tab-like swaps: the visit commits as usual and leaves history as it was. Fix the name and its values in `docs/protocol.md` section 3, and say how it combines with `data-target`, with GET forms, and with a `Tessera-Location` the answer carries.
- Reserve the name for directives, as with the other protocol attributes.
- The navigation matrix gains a scenario: a region link that opts out keeps the URL and the history length, and its no-JavaScript baseline is the plain link.

Acceptance: unit tests for the attribute on a link, a form and a submitter; the new matrix scenario passing in Chromium, Firefox and WebKit.

## Comments

### 2026-10-21T03:44:08Z

Plan.

- The attribute: `data-push="off"` on an `<a>`, a `<form>` or a submitter. On a submitter, `data-push` (any value) overrides the form's, as `data-target` does; `off` opts out, any other value pushes. A new `elementHistory(element, submitter?)` beside `elementTargets` in `src/transport.ts` reads it; links (`src/navigation.ts`), GET forms and POST forms (`formRequest`) pass the result as the request's `history`.
- What opting out does: the visit runs with history `none`, which exists already. It commits as usual and touches no entry; focus and scroll stay where they are, as after a refresh or an action (no #14 settle, which belongs to entries). A POST submit's `history` now carries what its `Tessera-Location` visit does: `push` by default, `none` when the form opts out. A redirect to another origin, `Tessera-Full-Visit`, and every full-load fallback still load a URL in full; those change the address by necessity.
- Docs: `docs/protocol.md` section 3 (the row, how it combines with `data-target`, GET forms and `Tessera-Location`) and 5.4; `data-push` reserved in `src/directive.ts`; decision under #28; README if the attribute list is there; CHANGELOG.
- Tests: unit tests in `test/unit/` for a link, a form, a GET form, a submitter overriding both ways, and a redirect after an opted-out submit (URL and history length unchanged). Matrix: TES-02 `region-push-off`, a link in `activity` with `data-target="activity" data-push="off"`; Tessera keeps the URL and history length, the baseline is the plain link; declared differences url, content, historyLength and focus (a kept link keeps focus). Run in Chromium, Firefox and WebKit (the image).

### 2026-10-21T03:49:18Z

Delivered via PR #29 (3bdaae2). data-push="off" on a link, form or submitter commits a visit without a history entry; matrix TES-02 passes in Chromium, Firefox and WebKit.
