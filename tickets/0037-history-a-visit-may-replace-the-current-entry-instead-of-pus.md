---
number: 37
uuid: e4f79009-b557-4a14-b6cc-d83106619a8e
title: "History: a visit may replace the current entry instead of pushing one (data-push=\"replace\")"
type: feature
status: open
tags: ["navigation","history"]
created: 2026-11-03T02:45:48Z
updated: 2026-11-03T02:45:48Z
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
