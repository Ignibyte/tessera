---
number: 25
uuid: 886115fe-0cbb-4a36-b934-8597b3284b54
title: "A commit inside a target makes a visit of that target drop its fragment"
type: bug
status: done
tags: ["coordination","streams"]
created: 2026-10-21T01:11:17Z
updated: 2026-10-21T01:14:05Z
phase: "docs"
closed: 2026-10-21T01:14:05Z
---

Found in #16 and confirmed as a bug by the driver. #12's generations touch a commit's target, every target around it and every target inside it, so a stream event that commits to `events` (inside `content`) while a visit of `content` is in flight makes the visit's fragment stale. The fragment is dropped and reported, but history still records the new URL: the URL changes and the content does not.

The rule (driver, 2026-10-20): a commit to a target invalidates fragments for that target and for targets inside it, never fragments for targets that contain it. A fragment for `content` stays valid after a commit to `events` inside it, since it replaces `events` anyway; a late fragment for `events` after `content` was committed stays dropped.

- Change `Generations.touch` in `src/coordination.ts` to touch the target and what is inside it, not what is around it.
- Update the #12 entry in `docs/decisions.md` and the generations paragraph of `docs/protocol.md` 4.6.
- Keep the existing generation tests; the one assertion that encodes the old "around" rule changes to the new rule.

Acceptance: a browser test where a stream event commits inside a region while a visit of that region is in flight; the visit's content and its URL both land. The unit and browser generation tests still pass.

## Comments

### 2026-10-21T01:11:37Z

Plan.

Approach: `Generations.touch` stops marking the targets around the committed one (the `scopeOwners` loop) and keeps marking the target and everything inside it, page commits included. `stale` is unchanged. In the transport, a fragment for `content` committed after a stream event for `events` is therefore valid, and a late fragment for `events` after a commit to `content` is still dropped.

Files: `src/coordination.ts`, `test/unit/coordination.test.ts` (the first generations test asserts the old rule for `content` and `page` after a commit to `content/cart`: those two assertions flip, and the test gains the case the driver named), `test/browser/streams.spec.ts` (new test), `docs/protocol.md` 4.6, `docs/decisions.md` (the #12 entry), `CHANGELOG.md`.

Acceptance:
- Browser test: on `/events` with a slow stream, a visit of `content` is held by the controller; while it is held a stream event commits to `events`; the visit is then answered with the About page. The test checks the heading, the URL and that no stale-fragment error was reported. I will run it before the fix to see it fail.
- The existing generation tests (unit and browser) still pass.

### 2026-10-21T01:14:05Z

Delivered via PR #20 (f9de0f8). A commit touches its target and what is inside it, never what is around it; a visit of a region lands when a stream event commits inside it.
