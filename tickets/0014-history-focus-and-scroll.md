---
number: 14
uuid: 82b47973-a2f6-447e-b5c9-003d62abe54a
title: "History, focus and scroll"
type: feature
status: in-progress
tags: ["navigation","a11y"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-21T00:35:14Z
phase: "docs"
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

## Comments

### 2026-10-21T00:24:20Z

Plan. `src/history.ts` builds jqstar 0026's ordering (declined there): prepare → capture the
current entry → mutate body and head → push or replace URL and state → enhance → focus → scroll.

- The seam: the transport calls `history.capture(request)` just before a visit's commit changes
  the page, and `history.commit(url, request, updated)` right after it (before the attributes
  mount enhances what arrived). This replaces #11's `pushUrl`. A visit has a mode: `push` (the
  default), `replace`, `pop` (back and forward) or `none` (409 and 422, as now).
- State: each entry Tessera owns gets `history.state.tessera = { v: 1, kind, targets, scroll,
  focus }`: the visit kind, the targets of the visit that made the entry, the scroll position,
  and the focused element's `id` or `data-focus-key`. Never HTML. Other keys of a plain state
  object are kept; an entry with a state Tessera did not make is not touched. The current entry
  is stamped at install, and its scroll is kept up to date while the user scrolls (debounced,
  and on `pagehide`), since by `popstate` the browser has already left it.
- Back and forward: one owned `popstate` listener. An entry of Tessera's is fetched fresh as a
  `pop` visit of its stored targets (`page` for the first entry); #12's table supersedes a visit
  still in flight. A change of fragment alone is left to the browser. An entry Tessera did not
  make, or a pop visit that fails, reloads the page the browser is now on. No back cache.
- `history.scrollRestoration = "manual"` from install until disposal, then the prior value.
- After enhancement (`kernel.whenEnhanced()`, capped at one second), the latest visit only:
  focus, then scroll. Focus: the server's choice (`autofocus` in what arrived) → the stored key
  (on `pop`) → the URL fragment's target → the main heading of what arrived (`h1`, made
  focusable with `tabindex="-1"` only when it is not) → the body. Focus outside what changed
  stays where it is: the server's choice, the stored key and the fragment always apply; the
  heading and the body only when focus was inside what changed or is gone. All with
  `preventScroll`. Scroll: the fragment's target, else the top, on `push` and `replace`; the
  stored position on `pop`; nothing on `none`. A user who scrolls or moves focus before then
  keeps control.
- `visit(url, { history: "replace" })` on the navigation API.

Fixtures: `/long` (a tall page with sections), `/focus-server` (an `autofocus` field),
`/headless` (no heading), and links to them on `/links`.

Tests: unit tests for the state envelope, capture, each mode, popstate (ours, foreign,
fragment-only, failed), each focus rule, the scroll policy, user interruption and
`scrollRestoration`. Browser (`test/browser/history.spec.ts`, Chromium and Firefox): push,
replace, back and forward across region visits, each focus rule, and scroll to the top,
restored on back and to a fragment.
