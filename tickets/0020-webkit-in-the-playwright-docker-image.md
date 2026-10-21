---
number: 20
uuid: 37217c2a-33c6-47c5-b00d-ae0ff0052fc9
title: "WebKit in the Playwright Docker image"
type: chore
status: in-progress
tags: ["testing","webkit"]
created: 2026-10-20T22:30:55Z
updated: 2026-10-21T02:03:51Z
phase: "docs"
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

## Comments

### 2026-10-21T01:57:33Z

Plan.

Where the server runs: on the host. The test runner, the build, the harness build and both reference servers stay on the host exactly as in `npm run test:browser`. Only the WebKit browser runs in the container: `playwright-core`'s `run-server` from the host's `node_modules`, mounted read-only, is the only mount. The WebKit project connects to it with `use.connectOptions.wsEndpoint`. The container runs with `--network host`, so the browser reaches the reference server at the host's `127.0.0.1` and the runner reaches `run-server` on a free port. Checked by hand: `mcr.microsoft.com/playwright:v1.62.1-noble` has Node 24.18 and `webkit-2336`, and a host `webkit.connect` to it rendered a page.

Script: `scripts/webkit.ts`, run by `npm run test:browser:webkit` (extra arguments go to Playwright). It pins the image tag in one constant and refuses to run when the tag is not `v<@playwright/test version>-noble`; a unit test in `test/unit/version.test.ts` checks the same, so `npm run check` fails on drift. It starts the container detached with `--rm --init`, as `pwuser`, under a unique name, waits for `Listening on`, runs `playwright test --project webkit` with `TESSERA_WEBKIT_ENDPOINT` set, and stops the container in a `finally` and on SIGINT and SIGTERM. Playwright stops the reference servers itself. It exits with the test run's status.

Config: `playwright.config.ts` defines the WebKit project when `TESSERA_WEBKIT=1` (a local WebKit, as today) or when `TESSERA_WEBKIT_ENDPOINT` is set (the container). Chromium and Firefox are unchanged, so `npm run test:browser` runs them on the host.

Acceptance: `npm run test:browser:webkit -- smoke.spec.ts iife.spec.ts` exits 0; `npm run test:browser` still runs Chromium and Firefox; no container is left after a passing run, a failing run and an interrupted one. I will also run the whole suite in WebKit and report what fails. Fixing WebKit-specific failures belongs to the navigation matrix (#18) or to new tickets, not to this one.

Docs: the WebKit entry in `docs/decisions.md`, the script table in `README.md`, the comment in `playwright.config.ts`, the changelog.

### 2026-10-21T02:03:51Z

Check exited 0 (628 unit and property tests); `npm run test:browser` exited 0 with 130 tests, Chromium and Firefox only; `npm run test:browser:webkit -- smoke.spec.ts iife.spec.ts` exited 0 with 3 tests in WebKit.

Cleanup, tested: a passing run, a failing run (`--timeout=1`), SIGINT to the process group during container startup and mid-run, and SIGTERM to the script alone all left no container and no reference server. The first SIGTERM test left both reference servers running: Playwright stops its web servers on SIGINT, not on SIGTERM. The script now forwards SIGINT to the run whatever signal it gets, and a retest left nothing. I stopped the two orphaned servers from that test by hand.

Split off: #27. The whole suite in WebKit is 63 or 64 of 65. `write-id.spec.ts` fails every run, because WebKit does not resend a dropped POST. `streams.spec.ts` fails now and then (1 of 50 in a repeated run). Ticket #27 has the evidence and lands before #18.
