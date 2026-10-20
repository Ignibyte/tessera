---
number: 20
uuid: 37217c2a-33c6-47c5-b00d-ae0ff0052fc9
title: "WebKit in the Playwright Docker image"
type: chore
status: open
tags: ["testing","webkit"]
created: 2026-10-20T22:30:55Z
updated: 2026-10-20T22:30:55Z
---

WebKit does not run on the dev box: Playwright's WebKit build needs Ubuntu libraries Arch lacks
(`docs/decisions.md`, ticket #3). Docker 29.7 runs on the box, so run the WebKit project in the
official Playwright image instead.

- The image is `mcr.microsoft.com/playwright`, at the tag matching the pinned `@playwright/test`
  version in `package.json` (`v1.62.1-noble` today). Pin the tag; when `@playwright/test`
  changes, the tag changes with it, and the script or a check says so if they drift.
- The reference server (`test/server/`) must be reachable from the container: run it inside the
  container, or on the host with the container reaching it, and say which in the ticket comment.
- An npm script (for example `npm run test:browser:webkit`) runs the WebKit project in the
  container against the repo mounted read-only where possible, and leaves no container or server
  behind, including when a test fails or the run is interrupted.
- No system packages on the host. Nothing is installed globally.
- Update `docs/decisions.md` (the WebKit entry from #3), `README.md` (the script table) and the
  `TESSERA_WEBKIT` comment in `playwright.config.ts` to match.

Acceptance: the new script passes the smoke test and the IIFE test in WebKit on this box, and
`npm run test:browser` still runs Chromium and Firefox on the host.

Ordering: this must land before the navigation matrix (#18), which counts only when it passes in
all three engines. Chad schedules it.
