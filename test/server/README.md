# The reference server

A small site that speaks `docs/protocol.md`, for the Playwright tests and for trying Tessera by
hand. It is test tooling: Node's `http` module, no dependencies, TypeScript run by Node directly.

```bash
npm run serve:test              # a free port; prints the URL
node test/server/main.ts --port 4180
```

Every page loads `/assets/harness.js` from its layout, which boots Tessera when JavaScript is on.
Playwright starts it itself (`webServer` in `playwright.config.ts`) with `--close-connections`,
which closes every connection after its response. A browser resends a request by itself when a
reused keep-alive connection closes before any answer, so without it a connection the controller
drops would show the browser's resend, not what Tessera sent. A second instance without the flag
runs for the write-id test (`TESSERA_KEEPALIVE_PORT`), where that resend is the point.

Every Tessera write outside the controller passes through a store of write ids (protocol 5.8): a
repeat within five minutes gets the first answer and reaches no route; a bad id is a `400`.

## Files

| File | What it holds |
|---|---|
| `server.ts` | routing |
| `answer.ts` | the response choice of protocol 5.1, the version check, redirects |
| `navigation.ts` | the navigation matrix's site, `/navigation/…` |
| `html.ts` | page rendering, the region and component scanner, props tokens, the `Tessera-Targets` parser |
| `stream.ts` | `/events/stream` |
| `controller.ts` | the controllable endpoint |
| `layouts/` | `app` (regions `sidebar` and `content`, component `page/crumb`) and `bare` (region `content`) |
| `pages/` | one file per page |

A page file starts with `<!--page {"title":…,"layout":…}-->`, then one or more
`<!--slot NAME-->` lines, each followed by that slot's markup; the layout places the slot with
`{{{NAME}}}`. `{{name}}` inserts a value escaped and `{{{name}}}` inserts it as markup; a
missing value is an error. A component in a fixture may carry JSON props,
`data-t-props='{"id":1}'`: the server signs them into a props token (HMAC-SHA256 under a key
made at startup) before it sends the page, and refuses a token that does not verify with `403`.

## Routes

Every response carries `Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout`.
A Tessera request naming a protocol other than `2` gets `400` with `Tessera-Protocol: 2` before
anything else happens. A Tessera request gets fragments for its `Tessera-Targets` when they are
all on the page (and, for a visit, the layout matches), and the full document otherwise. An
entry's `@NAME` must be the anchor its target's component carries, or the answer is `400`.

| Route | Answer |
|---|---|
| `GET /` | Home: regions `sidebar`, `content` and `notes` (inside `content`); components `content/greeting`, `content/greeting/count`, `notes/note-1`, `notes/note-2`, `page/crumb` |
| `GET /about` | A second page on `app` |
| `GET /attributes` | The attribute vocabulary of #7 on one page, booted by `/assets/harness.js` |
| `?csp=1` on any route | Adds `Content-Security-Policy: script-src 'self'`, which refuses `'unsafe-eval'`; with `?engine=no-eval` the harness boots the no-eval expression engine (#22) |
| `?build=NAME` on a page | Loads a release file in place of `/assets/harness.js` (#19): `iife` (`tessera.iife.js`), `csp-iife` (`tessera.csp.iife.js`), `esm` and `csp-esm` (the minified ES modules, started by `/assets/start-esm.js` or `/assets/start-csp-esm.js`); `&start=manual` adds `<meta name="tessera-start" content="manual">`. `/assets/` serves every file a release ships |
| `GET /coordination` | Component `content/cart` and regions `left` and `right`, for out-of-order responses through the controller |
| `GET /patch` | Region `form-area` with an input, for patches driven through `/assets/harness.js` |
| `GET /transport` | A form posting to `/form` and one posting to the controller, for the transport's tests |
| `GET /links` | One link of each kind link interception enhances or leaves to the browser |
| `GET /redeploy` | A page rendered with `build` 2 on the tracked stylesheet, so a visit to it loads in full |
| `GET /away` | A Tessera request gets `Tessera-Full-Visit: /about`; a plain one a `302` to `/about` |
| `GET /stray` | A Tessera request gets a fragment for region `nowhere`; a plain one the Stray page |
| `GET /scripted` | A page whose content holds an inline script |
| `GET /counter?key=K` | A count per key; `POST` adds one and answers with the content region; `?drop=once` also destroys the connection instead of answering |
| `GET /counter/log?key=K` | `{count, arrivals: [{path, id, repeat}]}`: each write to that key that carried `Tessera-Write-Id` |
| `GET /forms` | A form posting to `/form`, forms posting to the controller (two submitters; a file), a GET form, an opted-out form, a cross-origin form and one with a `required` field |
| `GET /long` | A tall page with `#section-1` to `#section-3` and a link at the bottom, for scroll |
| `GET /lazy` | Region `reviews` with `data-lazy="/lazy/content"`, and below a tall spacer region `more` with `data-lazy__visible` |
| `GET /lazy/content` | The same regions, loaded |
| `GET /poll?key=K` | Region `ticker` polling `/poll/tick?key=K` every 200 ms, showing the ticks so far |
| `GET /poll/tick?key=K` | Adds one tick for `K` and answers as `/poll` |
| `GET /persist-a`, `/persist-b`, `/persist-c` | `#player` with `data-permanent` on each; B wraps it in a `<section>`, C is on the `bare` layout |
| `/navigation/…` | The navigation matrix's site (`navigation.ts`, `docs/navigation-matrix.md`): jqstar's routes on the `navigation` layout, a session per `tessera-nav-session` cookie, and `/navigation/metrics` with what each session's requests carried |
| `GET /focus-server` | A page whose field has `autofocus` |
| `GET /headless` | A page whose content has no heading |
| `GET /bare` | A page on the `bare` layout, so a visit from `app` gets the full document |
| `GET /form` | A form posting `name` and `_token` to `/form` |
| `POST /form` | `419` on a CSRF token matching neither `X-CSRF-Token` nor `_token`; `422` with the errors for an empty name; `409` for the name `taken`; else `303` to `/form/done?name=…`, or `200` with `Tessera-Location` for a Tessera request |
| `GET /form/done?name=` | The page after a successful post |
| `GET /search?q=` | A GET form `#search` with `data-push="replace"`, targeting region `results` (inside `content`), submitted 150 ms after each input; `results` shows the query |
| `GET /events` | Region `events` and `#also`, both with `data-stream="/events/stream"` plus this URL's query; component `content/latest`; component `content/panel/Bell.2:count`, anchored `bell`; `$received` in the document scope |
| `GET /events/stream` | The stream, below |
| `GET /events/log?key=K` | `{connections: [{key, lastEventId, closed}]}`: each connection to the stream that named `key`, in arrival order |
| `GET /slow?ms=N` | The Slow page, after N ms (default 1000, at most 10000) |
| `/expired` | `419`, any method |
| `/assets/fixture.css`, `/assets/tessera*.js` | The stylesheet, and `dist/` (run `npm run build` first) |
| `/assets/harness.js` | `test/browser/harness.ts`, built by Playwright's global setup into `node_modules/.cache/tessera-harness/` |
| anything else | `404` with a page |

## The stream

`/events/stream` sends `retry` first, then step `k` for `k` from 1 to `count`: a
`tessera-patch-elements` with id `k` prepending `<li>Event k</li>` to `events`, then, without
ids, a morph of `content/latest` to `Latest: k`, a morph of the bell named `target @bell` (the
component at `content/panel/Bell.2:count`) to `k`, and a `tessera-patch-signals` setting
`received` to `k` in the document scope. With a numeric `Last-Event-ID` it resumes after that id; with any
other id it cannot resume and sends the whole region as one `morph`, id `count`, then the
components and the signal for `count`. Query parameters:

| Parameter | Default | Meaning |
|---|---|---|
| `count` | 3 | events, 0 to 1000 |
| `interval` | 0 | ms between events |
| `retry` | 1000 | the `retry:` value |
| `end` | `open` | `open` keeps the connection; `drop` ends the body without `tessera-close`; `close` sends `tessera-close` |
| `pause` | | `hidden` sends `Tessera-Stream-Pause: hidden` |
| `drop` | | `K` destroys a connection without `Last-Event-ID` after step `K`, so the client sees a network failure; a resumed connection runs to the end |
| `key` | | logs the connection under `K` for `/events/log` |
| `beat` | 15000 | ms between `: keep-alive` comments, from the start of the connection (100 to 60000); WebKit can hold received bytes until more arrive, so the stream tests use 250 |

## The controller

Requests to `/controlled/CHANNEL/…` (any method, any path below the channel) are captured and
held until the test answers them. A channel is 1 to 64 of `A-Z a-z 0-9 _ -`; give each test its
own, since tests run in parallel against one server and a worker runs tests from several files
in turn: `testName` in `test/browser/names.ts` builds one from the test id.

| Request | Effect |
|---|---|
| `POST /_control/CHANNEL/release` | Answers the oldest held request, or with `path` (path and query, exactly) and `method`, the oldest held one that matches. Waits up to `timeout` ms (default 5000, at most 30000) for one to arrive; with none, `408` and the held list. On success, `200` with `{seq, method, url, status}`. |
| `GET /_control/CHANNEL/requests` | `{requests: [{seq, method, url, headers, body, state}]}` in arrival order; `state` is `held`, `answered`, `aborted` (the client went away) or `dropped` (a release with `drop`) |
| `POST /_control/CHANNEL/reset` | Answers every held request `503`, forgets the channel, returns `{held: N}` |

The release body is JSON: either `status` (default 200), `headers` and `body` (default empty),
or `serve`, a URL whose answer the server gives to the held request's method, headers and body
(`{"serve": "/about"}` answers a held visit with the About page's fragments), or `drop: true`, which
destroys the held connection without an answer, so the client sees a network failure after
dispatch (its state becomes `dropped`). An unknown field or a bad value is a `400`.

```js
// Answer two visits in the reverse of their order.
fetch("/controlled/t1/a", { headers });
fetch("/controlled/t1/b", { headers });
await fetch("/_control/t1/release", { method: "POST", body: '{"path":"/controlled/t1/b","serve":"/about"}' });
await fetch("/_control/t1/release", { method: "POST", body: '{"serve":"/"}' });
```
