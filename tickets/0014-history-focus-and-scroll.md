---
number: 14
uuid: 82b47973-a2f6-447e-b5c9-003d62abe54a
title: "History, focus and scroll"
type: feature
status: open
tags: ["navigation","a11y"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
---

jqstar 0026's ordering, implemented: prepare → capture the current entry → mutate body and head →
push or replace URL, title and state before enhancement → enhance → focus → scroll.

- History state holds the region names and the visit kind, never HTML. Back and forward fetch
  fresh content (a small back cache from Livewire is allowed if documented, keyed by URL and
  bounded).
- `history.scrollRestoration = "manual"` only while Tessera owns the navigation.
- Focus precedence: server-chosen (`autofocus` or an attribute in the protocol) → the stored key
  → the fragment target → the main heading → the body. Focus outside the updated region stays
  where it is.
- Scroll by policy: top on a new visit, restored on back and forward, to the fragment on `#hash`.

Acceptance: browser tests for push, replace, back and forward across region visits, each focus
rule, and scroll restoration, in every engine.
