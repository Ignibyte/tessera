---
number: 3
uuid: acdaa989-8937-4d1b-a88f-73e4f3d52823
title: "The reference server and the browser harness"
type: chore
status: open
tags: ["testing","protocol"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
---

A small Node server under `test/server/` that speaks `docs/protocol.md`, for Playwright tests and
for trying Tessera by hand. It is test tooling, not a product: no framework dependency, Node's
`http` module only.

- Fixture pages as files (`test/server/pages/`), with a layout holding regions and components.
- Answers a plain GET with the full document and an enhanced GET with fragments; a form POST with
  303, 422 in place, or 409; a stream endpoint with SSE (ids, `retry`, `Last-Event-ID`); a 419;
  a slow endpoint and a controllable one (a strict FIFO response controller, as in jqstar's
  `test/` harness) so tests can order responses.
- Every response sets `Vary` per the protocol.
- `npm run serve:test` starts it on a free port and prints the URL.
- Playwright config: Chromium, Firefox and WebKit, headless, the server started by Playwright's
  `webServer`. Install the missing engines with `npx playwright install firefox webkit`; if one
  cannot run on this box, record that in `docs/decisions.md` and run the rest.
- One smoke test per engine: the fixture page loads with JavaScript off and shows its regions.

Acceptance: `npm run test:browser` passes the smoke test in every engine that runs here.
