# The navigation matrix

Ticket #18 ported jqstar's navigation acceptance fixture (`test/fixtures/navigation-decision/` and
`quality/navigation-decision.json`, contract revision 1, at `f17952b`) to the reference server and
Tessera. It is the acceptance suite for navigation: a change that breaks it has broken what a
browser does without Tessera, or a decision recorded in `docs/decisions.md`.

## Running it

```bash
npm run build
npx playwright test matrix.spec.ts                  # Chromium and Firefox, on the host
npm run test:browser:webkit -- matrix.spec.ts       # WebKit, in the Playwright image (#20)
```

It is part of `npm run test:browser` and `npm run test:browser:webkit`.

## What it checks

- **The site**: `test/server/navigation.ts`, at `/navigation/…`: jqstar's routes and page, with
  Tessera's markup. Regions are `main`, `activity` (inside `main`) and `preferences` (the
  `data-permanent` section). The header's links lie outside every region, so their visits target
  `page`; links and forms inside `main` target `main`; the activity links name `activity`. The
  server answers a Tessera request as the protocol says, fragments for the targets it names and
  `Tessera-Location` for a redirect, while its metrics keep the logical status (302, 303). Each
  browser context has a session (cookie `tessera-nav-session`) whose reads, writes, revision and
  request records the flows read at `/navigation/metrics`.
- **Two candidates per scenario**, each in a fresh context: `nojs` (JavaScript off, the baseline)
  and `tessera` (the harness boots Tessera). jqstar's other candidates (Turbo, htmx, its bridge)
  and their host corrections are gone.
- **Each run** must pass the scenario's frozen assertions. A Tessera run also fails on any page
  error, and ends by disposing the kernel: nothing may fail or stay in the ledger.
- **The two final observations** must match: the URL (path, query and fragment, or
  `browser-error` off http), the content (`#main`'s route and its heading, or `browser-error`), the
  focus (`title`, `destination`, `preference`, `query-value`, `heading` for the main `h1`, `body`
  or `other`) and the history length. A field may differ only where the scenario declares it, with
  the reason (`test/browser/matrix/scenarios.ts`). A declared field may still match in some
  engines.

## Scenarios

| Id | Flow | How it was ported | Tessera may differ |
|---|---|---|---|
| NAV-01 | direct | `ownedRoots`: jqstar's applications were live and connected; Tessera has one attributes mount, a live ledger, and `#enhanced`'s `data-text` applied. | |
| NAV-02 | visit | As jqstar. A click is a mousedown prefetch plus the click that takes it: one read. | focus (the main heading, decision #14) |
| NAV-03 | local-anchor | As jqstar: a change of fragment alone is the browser's. | |
| NAV-04 | remote-anchor | As jqstar. | |
| NAV-05 | history | As jqstar, without waiting on jqstar's scroll events. Back fetches the entry fresh. | |
| NAV-06 | eligibility | Headless Chromium sometimes opens a modified click's tab without Playwright reporting it, or reports it still at `about:blank`. So the server is the witness: a second GET for the guide sent by the browser (`tessera: false`), not by Tessera. A click Tessera took would still fail it: it would carry `Tessera-Request` and change the original page. | |
| NAV-07 | redirect | As jqstar; Tessera follows `Tessera-Location` with a fresh GET. | focus (heading) |
| NAV-08 | http-errors | As jqstar; `accessibleError` is the error page's `autofocus` field. | |
| NAV-09 | content-types | jqstar marked these links native. Here they are plain: the download link has `download`, which Tessera leaves to the browser, and the plain-text answer makes Tessera load the URL in full. | |
| NAV-10 | head | jqstar marked the link native. Here the head route adds tracked assets (`data-track`), so Tessera loads it in full, and its script runs once (decision #13). | |
| NAV-11 | get-form | As jqstar. | focus (heading) |
| NAV-12 | validation | As jqstar: the browser's own validation stops the submit. | |
| NAV-13 | write | As jqstar; the 303 travels as `Tessera-Location`. | |
| NAV-14 | preview | As jqstar. | focus (heading) |
| NAV-15 | server-validation | As jqstar. | URL and history length: a 422 or 409 renders the errors in place and adds no entry |
| NAV-16 | write-loss | `visibleRecovery`: Tessera's indeterminate message (#15). Without JavaScript the browser must not present the lost answer as a page of the site: Chromium shows its error page, Firefox reports the load failed and keeps the page, WebKit shows an empty document and reports nothing. | all four: Tessera keeps the page with its message (in Firefox nothing differs) |
| NAV-17 | region | As jqstar. | content: only `activity` changes; focus: WebKit on macOS focuses `#main` on the click, not the link, and Tessera keeps focus there since it lies outside `activity` (decision #14, #31) |
| NAV-18 | region-mismatch | As jqstar: the answer lacks `activity`, so Tessera commits the whole document. | focus (heading) |
| NAV-19 | supersession | `noStaleCommit`: the fast route stands after the slow answer's time; jqstar read its bridge's outcomes. | focus (heading) |
| NAV-20 | cancel-intent | The page's own script (`fixture.js`) cancels the click. `zeroDispatch`: jqstar sent nothing. Tessera prefetches on mousedown, before the page cancels the click, so one GET for the link may go; nothing else is sent and nothing commits. `outgoingRootsRemainLive`: the ledger is unchanged. | (JavaScript only) |
| NAV-21 | network-error | `visibleRecovery`: Tessera hands a visit the network refused to the browser, which does what it does without JavaScript: an error page in Chromium and Firefox, the page left as it was in WebKit. The flow checks the hand-over (the browser's own GET) and waits for a steady URL. `outgoingRootsRemainLiveWithoutMutation`: the route and ledger while the visit fails. | focus: Firefox's error page focuses its card after a load from script |
| NAV-22 | no-content | `zeroMutation`: the ledger is unchanged. | |
| NAV-23 | preservation | jqstar checked its application's state; here `#permanent` is a region, and its scope's `preference` survives with the node. | focus (heading) |
| NAV-24 | lifecycle | jqstar counted applications and bridge phases. Tessera: one mount (`noDuplicateApplications`); the ledger after eight visits is the ledger of the first load (`createdReleasedLiveReconcile`); no render left open (`orderedBridgePhases`); disposal with no failure and nothing left. | (JavaScript only) |
| NAV-25 | progress | `visibleProgress`: Tessera's progress bar (`[data-tessera-progress]`). `settledBusyState`: no `aria-busy` left. | |
| NAV-26 | private-cache | As jqstar: Back fetches fresh, nothing goes to web storage. | focus: Back restores focus to the element that had it (decision #14) |
| NAV-27 | prefetch | As jqstar: a hover alone sends nothing, since links prefetch on mousedown unless `data-prefetch="hover"`. | |
| NAV-28 | accessibility | As jqstar. | |
| TES-01 | write-307 | Tessera's own scenario. No frozen scenario answers a write with a real redirect, so a Tessera that followed one passed. A 307 asks for the same request again, body and all, and the protocol never converts it. Without JavaScript the browser sends the POST again to the new address; Tessera sends it once and shows its indeterminate message. | all four |
| TES-02 | region-push-off | Tessera's own (#28): `#region-tab` is the region link with `data-push="off"`. Tessera updates `activity` and keeps the URL and the history length; the baseline is the plain link. | url, content, history length; focus stays on the kept link where the engine focuses a clicked link |

## What it found

Each was fixed in Tessera or in the harness, as noted:

- **A visit the network refused did nothing visible** (NAV-21). Now it loads the URL in full after
  its retries, so the browser shows what it would show without Tessera (decision, #18).
- **A click cost two reads on a `no-store` site** (NAV-02, 04, 07): the mousedown prefetch's
  answer was thrown away for its `no-store`. A prefetch made by a press is the click's own request
  sent early, so its answer is now used (decision, #18; protocol 8).
- **WebKit reports a body cut short as complete** (NAV-16): a lost answer with `Content-Length:
  4096` resolved as an empty document, and Tessera reloaded the page as if a write had been
  answered. The body lease now fails a body shorter than its `Content-Length` (when there is no
  `Content-Encoding`), so the write is indeterminate in every engine (decision, #18).
- Harness only: headless Chromium's unreported tabs (NAV-06), Firefox's `page.request` failing once
  the page is an error page (the metrics are read from a request context of their own), and
  Firefox's error page committing its URL late (NAV-21 waits for a steady URL and route).

Mousedown prefetch costs one GET for a link whose click the page then cancels (NAV-20). That is
the price of prefetching on press (#17), recorded here rather than changed.

## Deliberate breakage

Each break went into a scratch copy of `src/transport.ts`, ran the matrix in Chromium and Firefox,
and was undone:

| Break | Caught by |
|---|---|
| Writes follow redirects (`redirect: "follow"`) | TES-01 in both. Before TES-01 existed, nothing caught it. |
| A write is sent again after a failure reading its answer | NAV-16 in Chromium (Firefox fails the fetch itself, which this break did not touch) |
| A write is sent again after any network failure | NAV-16 in both |
| A newer read no longer supersedes an older one | NAV-19 in both (`requestCancellationFacts`) |
| `data-push="off"` is ignored and the visit pushes (#28) | TES-02 in Chromium, the one engine it ran in (`urlKeptWhenEnhanced`, `historyKeptWhenEnhanced`) |
