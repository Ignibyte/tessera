---
number: 37
uuid: e4f79009-b557-4a14-b6cc-d83106619a8e
title: "History: a visit may replace the current entry instead of pushing one (data-push=\"replace\")"
type: feature
status: done
tags: ["navigation","history"]
created: 2026-11-03T02:45:48Z
updated: 2026-11-03T03:09:25Z
phase: "check"
closed: 2026-11-03T03:09:25Z
---

Found by Lotline run 27 (search as you type, 2026-11-02). A search box that submits its GET form on a
debounced input (`data-on:input__debounce.300ms="el.form.requestSubmit()"`) is a visit, so `?q=`
reaches the URL and Back, Forward and reload agree, a newer visit cancels the older request and a
late answer is dropped. But each pause in typing pushes a history entry, so Back steps through every
partial query. An `@get` action never touches history, so it cannot keep `?q=` either.

Add `data-push="replace"` on a link, form or submitter: the visit commits as usual and replaces the
current history entry (`history.replaceState`) with its URL instead of pushing a new one; scroll and
focus as for a refresh. The protocol's section 3 table gains the value; `off` and the default stay
as they are. A browser test types a query in steps and goes Back once to the page before the search.

## Comments

### 2026-11-03T03:02:07Z

Plan.

- `elementHistory` in `src/transport.ts` maps `data-push="replace"` to history mode `replace`, which the transport and `src/history.ts` already carry (the API's `visit(url, { history: "replace" })`). Links, GET forms and a POST form's `Tessera-Location` visit all read it there; a submitter's `data-push`, any value, still overrides the form's. `off` and the default are unchanged.
- Focus and scroll, as the ticket says, stay as after a refresh: `history.commit` for `replace` replaces the entry and moves neither. That also holds for the API's `replace`, which until now focused and scrolled as a push did; one rule for both, in `docs/decisions.md` (Provisional) and the CHANGELOG. The replaced entry keeps the scroll and focus `capture` recorded, so Back and Forward to it restore them.
- `data-push` stays reserved as a directive name (already). Docs: protocol section 3 row and the paragraph after the table, 5.4, README's attribute list.
- Tests: unit for a link, a form and a submitter with `replace`, and the history seam replacing without focus or scroll; browser: on `/search` with `data-push="replace"`, reached by a link from another page, a query typed in steps leaves the history length as it was and one Back returns to the page before the search.

### 2026-11-03T03:09:25Z

Delivered via PR #46 (ee9cbf6). data-push="replace" replaces the current entry, focus and scroll left as they are. Released in Tessera 0.4.1 (PR #47, f7ce44d): https://github.com/Ignibyte/tessera/releases/tag/v0.4.1
