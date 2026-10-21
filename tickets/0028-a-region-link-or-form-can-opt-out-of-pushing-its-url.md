---
number: 28
uuid: 655dc928-6759-4c13-b547-a93b6983447f
title: "A region link or form can opt out of pushing its URL"
type: feature
status: open
tags: ["navigation","history"]
created: 2026-10-21T03:12:55Z
updated: 2026-10-21T03:12:55Z
---

Found by the navigation matrix (#18, NAV-17): a link with `data-target` pushes its URL, so a region swap such as a tab or a refreshed panel leaves an address whose document differs from the page on screen, and a reload shows another page. Tessera has no way to say "don't push" (driver, 2026-10-20).

- A protocol attribute a server renders on a link or a form (or its submitter), for example `data-push="off"`, for tab-like swaps: the visit commits as usual and leaves history as it was. Fix the name and its values in `docs/protocol.md` section 3, and say how it combines with `data-target`, with GET forms, and with a `Tessera-Location` the answer carries.
- Reserve the name for directives, as with the other protocol attributes.
- The navigation matrix gains a scenario: a region link that opts out keeps the URL and the history length, and its no-JavaScript baseline is the plain link.

Acceptance: unit tests for the attribute on a link, a form and a submitter; the new matrix scenario passing in Chromium, Firefox and WebKit.
