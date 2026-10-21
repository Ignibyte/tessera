---
number: 26
uuid: 19f6e063-06a5-4e75-999e-ba54db40ee8d
title: "The __case modifier on data-attr"
type: feature
status: in-progress
tags: ["attributes"]
created: 2026-10-21T01:54:41Z
updated: 2026-10-21T01:55:42Z
phase: "docs"
---

Follow-up to #23 (driver, 2026-10-20). HTML lowercases attribute names, so `data-attr:viewBox` arrives as `data-attr:viewbox`. SVG's `viewBox`, `preserveAspectRatio` and other camelCase attributes cannot be written through `data-attr` today. Datastar allows `__case` on `data-attr`.

- `data-attr` takes `__case` with the same names and errors as #23. The default stays kebab, so keys are written as they are spelled today.
- `data-style` and `data-class` still do not take it.
- Update the #23 entry in `docs/decisions.md` and the changelog.

Acceptance: a unit test for `data-attr:view-box__case.camel` setting `viewBox` on an SVG element, and for the default staying kebab; a browser test on `/attributes` that sets `viewBox` on an inline SVG from a signal.

## Comments

### 2026-10-21T01:54:41Z

Plan.

Approach: add `case` to `data-attr`'s modifiers and spell its key with `keyCase(attribute, "kebab")` from #23. `setAttribute` keeps the case of a name on an SVG element (it lowercases names only on HTML elements in an HTML document), so `viewBox` lands as written. Restoring the original value uses the spelled name too.

Files: `src/builtins.ts`, `test/unit/attributes.test.ts` (the #23 test that used `data-attr` for the "not taken" error moves to `data-style`), `test/server/pages/attributes.html` (an inline SVG with `data-attr:view-box__case.camel` from a signal), `test/browser/attributes.spec.ts`, `docs/decisions.md`, `CHANGELOG.md`.

Acceptance: a unit test that sets `viewBox` on an SVG element from a signal and restores it, with the kebab default left as is; a browser test that changes the signal and reads `viewBox` back from the inline SVG.

### 2026-10-21T01:55:42Z

Check exited 0 (627 unit and property tests) and the browser suite exited 0 (130 tests, Chromium and Firefox). The browser test also reads `viewBox.baseVal`, so it shows the SVG took the attribute, not only that the string is there.
