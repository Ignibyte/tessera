---
number: 31
uuid: 22fbad43-9d43-4036-bcc8-4b59a5d274f6
title: "The browser suite's focus assumptions in macOS WebKit"
type: bug
status: done
tags: ["testing","webkit","macos","focus"]
created: 2026-10-21T04:03:01Z
updated: 2026-10-21T04:42:11Z
phase: "check"
closed: 2026-10-21T04:42:11Z
---

Found by the Mac mini run (#29). WebKit on macOS does not focus a link or a button on click, and Tab skips them, unlike Linux WebKit, Chromium and Firefox; `focus()` from script still works. Probed in Playwright's WebKit (webkit-2336) on macOS 27.0.1. Three tests assume a click focuses the link and fail there every time:

- `test/browser/history.spec.ts` "goes back to the stored element on back" and "stays where it is when it was outside what changed": the link never had focus, so there is nothing to restore or keep.
- NAV-17: the click focuses the link's nearest focusable ancestor, `#main` (`tabindex="-1"`). That is outside the updated `activity` region, so decision #14 keeps focus there and the matrix sees focus "other" against the baseline's "body". Tessera follows its rule here; the scenario does not declare the difference for this engine.

What to do: give the two history tests focus that does not depend on the engine's click focus (focus the link from script, or with the keyboard where the engine allows it), and declare NAV-17's focus difference with the reason, as NAV-21 does for Firefox. No change to Tessera's focus rules unless the driver decides otherwise.

Acceptance: the suite passing in WebKit on the Mac, with no change to the results on the dev box.

## Comments

### 2026-10-21T04:37:29Z

Plan.

- `test/browser/history.spec.ts`, the two focus tests: focus the link from script (`focus()` works in every engine, macOS WebKit included) and follow it with Enter, a keyboard user's path, instead of a click whose focus depends on the engine. What they check stays the same: Back restores focus to the stored element; focus outside what changed stays.
- NAV-17 (`test/browser/matrix/scenarios.ts`, `docs/navigation-matrix.md`): declare the focus difference with its reason, as NAV-21 does for Firefox. macOS WebKit focuses the clicked link's nearest focusable ancestor, `#main`, which lies outside `activity`, so decision #14 keeps focus there, where the browser's new page leaves it on the body. Elsewhere the field still matches. No change to Tessera's focus rules.
- Show it: `npm run check`, `npm run test:browser`, `npm run test:browser:webkit` on the dev box, and the whole suite in all three engines on the Mac in `~/scratch/tessera`, as #29 ran it. CHANGELOG under Unreleased; no release.

### 2026-10-21T04:42:11Z

Delivered via PR #33 (af0f333). The history focus tests follow their link from the keyboard and NAV-17 declares its macOS WebKit focus; the suite passes 321 of 321 on the Mac.
