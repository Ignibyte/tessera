# Consuming a Tessera release

How a framework takes Tessera: AIC (PHP) and Rustal (Rust) today, any other server layer the same
way. Tessera is never published to npm. A framework pins a release from this repo's GitHub
releases and copies the built file into its public assets when it builds.

## Which build

A release holds two builds (`README.md`, "Using a release"):

- `tessera.csp.*`, with the no-eval expression engine. It works under any Content-Security-Policy,
  including one that refuses `'unsafe-eval'`. **A framework ships this one by default**: it cannot
  know every application's policy, and a policy added later must not break the page.
- `tessera.*`, with the trusted engine, which compiles expressions with `Function`. Smaller, and
  expressions may use the whole of JavaScript, but the page's policy must allow `'unsafe-eval'`.
  An application that wants it and controls its policy can opt in.

A strict-CSP page must load `tessera.csp`: the default build's directives fail there, each with a
`tessera:error`. Both builds speak the same protocol and have the same API; only what an
expression may say differs (`docs/decisions.md`, "The no-eval engine").

Take the IIFE (`tessera.csp.iife.js`) for a plain `<script defer>` that starts itself, or the
minified ES module (`tessera.csp.min.js`) for a page that calls `start` from a module. The source
map (`.js.map`) beside each goes into the same directory.

## Pinning and copying

1. Pin the version and the SHA-256 of each file you copy, in the framework's own source: a
   manifest or a constant, reviewed like code. The sums come from the release's `SHA256SUMS`.
2. At build time, download the pinned release's files (`gh release download v0.1.0 --repo
   Ignibyte/tessera --pattern 'tessera.csp.*'`, or the same URLs over HTTPS with a token: the repo
   is private), check each against the pinned sum (`sha256sum -c`, or the language's own SHA-256),
   and fail the build on any mismatch.
3. Copy the files into the public assets, under a path that changes with the version
   (`/assets/tessera-0.1.0/tessera.csp.iife.js`) or with a content hash, and serve them with a long
   cache lifetime.
4. Render the `<script>` with `data-track` in `<head>`, so a deploy that changes Tessera makes open
   tabs load in full (protocol 9).

Upgrading is the same three steps with the new version and sums; `CHANGELOG.md` says what changed,
and a new protocol version is called out there.

## The server checklist

`docs/protocol.md` is what a server must do; its section 11 is the checklist, repeated here as it
stands for protocol 0 at release 0.1.0. When the two differ, the protocol wins.

A server layer speaks version 0 when it:

1. Renders regions with `data-region`, components with `<!--t:c KEY PROPS-->` … `<!--/t:c-->`,
   and every conditional and loop between `<!--t:b-->` … `<!--/t:b-->`, empty ones included, all
   to the grammars of section 2.
2. Signs props tokens, verifies them on every request that sends one, and keeps them small.
3. Renders the `tessera-layout` and `tessera-csrf-token` metas, and `data-track` on every script
   and stylesheet in `<head>`.
4. Detects a Tessera request by `Tessera-Request` and refuses a `Tessera-Protocol` it does not
   speak with `400`, before any side effect.
5. Answers a visit with fragments for the requested targets when the layout matches and every
   target exists, and with the full document otherwise.
6. Renders fragment responses as `text/vnd.tessera+html` with `Tessera-Protocol: 0`, one
   `<template>` per target, the `<title>`, the tracked-asset copies and any signal patches.
7. Authorizes every target it renders, and treats `Tessera-Targets` and `Tessera-Signals` as
   untrusted input.
8. Turns every `301`, `302` and `303` for a Tessera request into `200` with `Tessera-Location`,
   and never sends `307` or `308` to a Tessera write.
9. Answers a refused write with `422` or `409` and the form's region with its errors,
   `data-error-summary` and `aria-invalid`.
10. Answers a stale session or CSRF token with `419`, and anything Tessera cannot update in place
    with `Tessera-Full-Visit`.
11. Sends `Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout` on every
    response from a URL that answers Tessera requests, plus `Tessera-Signals` when it reads them.
12. Serves streams as `text/event-stream` with `Cache-Control: no-store`, the three event names
    of section 7, ids on replayable events, resumption from `Last-Event-ID`, and `tessera-close`
    when finished.
13. Does the same work for a plain request, so a page with JavaScript off reaches the same results
    by full loads.
14. Applies a write carrying a `Tessera-Write-Id` it has seen within five minutes no more than
    once, answering the repeat with the first answer or `409` (section 5.8).

## What AIC changes

AIC's server layer already renders regions and components; what it renders and detects follows
the protocol instead of its own spellings. This list comes from the protocol and the design; the
AIC side owns the details.

- **Component markers.** `<!--aic:c KEY-->` … `<!--/aic:c-->` becomes `<!--t:c KEY-->` …
  `<!--/t:c-->`, with the signed props token after the key when the component needs its inputs
  back (protocol 2.2 and 2.5). The opening marker holds nothing else, not even a trailing space.
  Its template compiler also emits `<!--t:b-->` … `<!--/t:b-->` around every conditional and loop,
  empty ones included (2.3).
- **Detecting an enhanced request.** A Tessera request is one with `Tessera-Request` (`visit`,
  `submit`, `action`, `refresh` or `stream`); its `Tessera-Protocol` is checked first, and a
  version AIC does not speak gets `400` with `Tessera-Protocol: 0` before any side effect (4.2,
  section 1). `Tessera-Targets` names what to render, `Tessera-Layout` the layout the page has.
- **Fragment responses.** For a visit or a refresh whose targets all exist under the same layout:
  `200`, `text/vnd.tessera+html; charset=utf-8`, `Tessera-Protocol: 0`, one `<template
  data-target="…">` per target, the `<title>`, the tracked assets' copies, and signal patches when
  there are any (5.3). Otherwise the full document. A redirect to a Tessera request travels as
  `Tessera-Location` (5.4), and one middleware at the edge can do it for every route.
- **`Vary`.** Every response from a URL that answers Tessera requests carries `Vary:
  Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout`, plus `Tessera-Signals`
  where it reads them (section 8), so no cache serves a fragment as a page.
- **The CSRF header.** The page renders `<meta name="tessera-csrf-token">`, and Tessera sends the
  token on every unsafe same-origin request in `X-CSRF-Token`, or in the header a
  `<meta name="tessera-csrf-header">` names (3, 4.2). AIC's CSRF check accepts that header beside
  the form field, answers a stale token with `419`, and may refresh the token in a fragment
  response's meta (5.3).
- **Writes.** A write's `Tessera-Write-Id` is applied once (5.8); a refused write answers `422` or
  `409` with the form's region (6).

## What Rustal changes

Rustal's server layer is new, so it builds the whole checklist above from `docs/protocol.md`
alone, with the same markers, headers and responses as AIC. The parts that need a choice on the
Rust side: where the props tokens' key lives and how tokens are signed (2.5; HMAC-SHA256 in the
reference server), the store of write ids with its five-minute window (5.8), and the middleware
that turns redirects into `Tessera-Location` (5.4). The reference server in `test/server/` speaks
every part of it and is the example to port from; the navigation matrix (`docs/navigation-matrix.md`)
is the acceptance test a Rustal site can run its own routes through.
