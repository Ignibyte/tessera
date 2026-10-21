---
number: 29
uuid: 437f1c35-e144-4217-8fc3-094ac1ed31b2
title: "Run the browser suite on the Mac mini"
type: chore
status: open
tags: ["testing","webkit","macos"]
created: 2026-10-21T03:12:55Z
updated: 2026-10-21T03:12:55Z
---

Chad approved the Mac mini for Tessera's tests on 2026-10-20 (driver). Playwright's WebKit on macOS uses Apple's network stack, so a run there settles whether the byte hold seen in Linux WebKit (#27) happens on macOS.

- Reach the Mac with `ssh macmini` (key-based; use BatchMode).
- Work only in a scratch directory, for example `~/scratch/tessera`, filled by rsync or a git clone over ssh. Run `npm ci` and `npx playwright install webkit` inside it, then the reference servers and the browser suite there.
- Real Safari through `safaridriver` only if it is already enabled.
- Never run `sudo`. Do not touch the Mac's launchd agents or its existing Playwright install. Stop every server the scratch directory started when done.
- Record which engines pass, and whether the byte hold appears, in `docs/decisions.md`.

Acceptance: the suite's result per engine on macOS is recorded, with the probe result for the byte hold.
