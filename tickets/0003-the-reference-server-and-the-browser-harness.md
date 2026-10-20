---
number: 3
uuid: acdaa989-8937-4d1b-a88f-73e4f3d52823
title: "The reference server and the browser harness"
type: chore
status: done
tags: ["testing","protocol"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T22:29:27Z
phase: "docs"
closed: 2026-10-20T22:29:27Z
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

## Comments

### 2026-10-20T22:20:51Z

Plan.

Approach: a dependency-free server on `node:http`, run by Node directly from TypeScript (Node 26
strips types, as `scripts/` already relies on). It finds regions and component paths with a small
scanner over the rendered HTML string, not a DOM: the fixtures are ours and well-formed, and it
keeps jsdom (which has no types installed) out of the server.

Files:
- `test/server/server.ts`: routing, the response choice of protocol 5.1, `Vary` on every
  response, the version check (400 with `Tessera-Protocol: 0` before any side effect),
  `Tessera-Location` in place of 303 for Tessera requests, props tokens signed with HMAC-SHA256
  and verified (403 when tampered).
- `test/server/html.ts`: page and layout rendering, the region and component scanner, fragment
  bodies, tracked-asset copies, the `Tessera-Targets` parser.
- `test/server/stream.ts`: `/events/stream`, SSE with `retry`, numeric ids, resumption after
  `Last-Event-ID`, the current state as one `morph` when the id cannot be resumed, and
  `?count`, `?end=open|drop|close`, `?interval`, `?pause=hidden` so later tickets can test
  reconnection.
- `test/server/controller.ts`: the controllable endpoint. Requests to
  `/controlled/<channel>/...` are captured and held. `POST /_control/<channel>/release` answers
  the oldest held request (strict FIFO), or the oldest whose path matches when the test names
  one, so a test can answer the second request first. The response is either given (status,
  headers, body) or served as the server would serve another URL to that request's headers.
  `GET .../requests` lists what arrived, `POST .../reset` answers what is still held with 503
  and reports how many. The channel keeps parallel tests apart.
- `test/server/main.ts`: `npm run serve:test`, a free port unless `--port`, prints the URL.
- `test/server/layouts/{app,bare}.html`, `test/server/pages/*.html`: home (nested component,
  a region inside `content`, a block), about, a page on the `bare` layout, the form (422 when
  empty, 409 for the name `taken`, 419 on a bad CSRF token, 303 to a done page), events, slow
  (`?ms=`), expired (419) and a 404 page.
- `test/server/README.md`: the routes and the controller's HTTP interface.
- `playwright.config.ts`: Chromium, Firefox and WebKit, `webServer` on a free port chosen once
  and passed to workers through the environment.
- `test/browser/smoke.spec.ts` replaces `iife.spec.ts` (its comment asks for that): the fixture
  page with JavaScript off shows its regions, plus a form round trip with JavaScript off; the
  IIFE-global check moves onto a page served by the reference server.

Acceptance: `npm run test:browser` passes the smoke test in every engine that runs here. Also
`test/unit/server.test.ts` (Vitest, against the server on port 0) covers each protocol answer
above, and `test/property/targets.test.ts` round-trips the `Tessera-Targets` parser with a fixed
seed.

Decisions: none on the protocol. If Firefox or WebKit cannot run here, that goes in
`docs/decisions.md`.

### 2026-10-20T22:29:27Z

Delivered via PR #4 (a099b62). The reference server, Playwright on it in Chromium and Firefox; WebKit cannot run on this box (docs/decisions.md).
