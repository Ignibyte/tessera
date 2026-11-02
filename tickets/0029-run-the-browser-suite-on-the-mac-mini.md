---
number: 29
uuid: 437f1c35-e144-4217-8fc3-094ac1ed31b2
title: "Run the browser suite on the Mac mini"
type: chore
status: done
tags: ["testing","webkit","macos"]
created: 2026-10-21T03:12:55Z
updated: 2026-10-21T04:04:15Z
phase: "check"
closed: 2026-10-21T04:04:15Z
---

Chad approved the Mac mini for Tessera's tests on 2026-10-20 (driver). Playwright's WebKit on macOS uses Apple's network stack, so a run there settles whether the byte hold seen in Linux WebKit (#27) happens on macOS.

- Reach the Mac with SSH (key-based; use BatchMode).
- Work only in a scratch directory, for example `~/scratch/tessera`, filled by rsync or a git clone over ssh. Run `npm ci` and `npx playwright install webkit` inside it, then the reference servers and the browser suite there.
- Real Safari through `safaridriver` only if it is already enabled.
- Never run `sudo`. Do not touch the Mac's launchd agents or its existing Playwright install. Stop every server the scratch directory started when done.
- Record which engines pass, and whether the byte hold appears, in `docs/decisions.md`.

Acceptance: the suite's result per engine on macOS is recorded, with the probe result for the byte hold.

## Comments

### 2026-10-21T03:50:58Z

Plan.

- The Mac: macOS 27.0.1 on arm64, Node 26.8.1 from Homebrew, Safari 27.0.1. Its Playwright cache (`~/Library/Caches/ms-playwright`) is the existing install, so the scratch run sets `PLAYWRIGHT_BROWSERS_PATH=~/scratch/tessera/.browsers` and never writes there. No `sudo`, no launchd changes.
- Fill `~/scratch/tessera` with `git archive` of main piped over ssh (the Mac needs no GitHub access), then `npm ci`, `npx playwright install chromium firefox webkit` into the scratch path, `npm run build`, and `TESSERA_WEBKIT=1 npx playwright test` (Playwright's own webServer starts and stops the reference servers).
- The byte-hold probe as #27 ran it, now kept in the repo as `scripts/byte-hold.ts`: a page with no Tessera code reads `/events/stream` with plain `fetch`, 200 runs per engine, against the reference server with `--close-connections`; a run fails when the third step's signals have not arrived within 1.5 s. Run in WebKit and Chromium on the Mac, and once in the Linux image for a baseline with the same script.
- Real Safari: `safaridriver` only if remote automation is already on; enabling it needs `sudo`, so if a session is refused that is recorded and skipped.
- Result per engine and the probe numbers go in `docs/decisions.md` under #29; then the scratch servers are checked stopped. The scratch directory stays for later runs unless the driver says to remove it.

### 2026-10-21T04:04:15Z

Delivered via PR #30 (2f5fbfd). macOS: Firefox 101/101, Chromium 100/101, WebKit 97/101; byte hold in macOS WebKit about 1 in 6,000, none in 10,000 Safari runs; failures split into #30 and #31.
