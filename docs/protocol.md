# Tessera protocol, version 0

This is what a server must do to speak Tessera. It is written for the server layers of AIC (PHP)
and Rustal (Rust), and for anyone writing another: each can be built from this document alone,
without reading Tessera's source. `docs/design.md` explains why the model is shaped this way;
`docs/decisions.md` records who chose each name and which choices are still **Provisional**.

"Must" and "must not" are requirements: a server that breaks one is not speaking the protocol.
"Should" is a strong recommendation with a stated reason. "The server" means the framework's
Tessera layer; the application behind it never sees most of this.

## Contents

1. Versions
2. Identities: regions, components, blocks, keys, props
3. Attributes a server renders
4. Requests
5. Responses
6. Status codes
7. Streams
8. Caching
9. Head and assets
10. Worked examples
11. Server checklist
12. Coverage of the design's request table

## 1. Versions

Every request Tessera makes carries `Tessera-Protocol: 0`. This document is version 0. A change
that an existing server or page would notice gets a new number.

A server that does not speak the version a request names must not act on the request: no write,
no side effect. It answers `400` with a `Tessera-Protocol` header listing the versions it does
speak, comma-separated (`Tessera-Protocol: 1, 2`); Tessera ignores the body. Tessera, seeing a
`400` that carries a `Tessera-Protocol` header without its own version, does a full load (section
5.6). A `400` without the header is an ordinary client error (section 6).

A fragment response or a stream must carry `Tessera-Protocol: 0`. One without it, or with another
value, is treated the same way: Tessera commits nothing from it and does a full load.

## 2. Identities

The server renders a page as regions, and regions hold components. Every update names its target
by identity, never by a CSS selector.

### 2.1 Regions

A region is an element carrying `data-region`:

```html
<main data-region="content">…</main>
```

- The name matches `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` and is at most 64 characters: lowercase
  letters and digits in words joined by single hyphens (`content`, `side-nav`, `step-2`).
- The name `page` is reserved (section 2.6) and must not name a region.
- A name is unique on the page: two elements with the same `data-region` are a server error, and
  Tessera refuses to commit into either.
- Any element inside `<body>` can be a region, `<tbody>` and `<li>` included. Regions may nest; a region inside another is still addressed by its own name alone.
- The region element itself survives an update: Tessera morphs its attributes and children in
  place, so listeners and focus on the element stay.

### 2.2 Components

A component is the run of nodes between two comments, since a wrapper element is invalid in many
places (inside `<h2>`, `<p>`, `<tr>`):

```html
<!--t:c cart eyJpZCI6NDJ9.Kq3v-->
  <h2>Cart <!--t:c count-->3<!--/t:c--></h2>
  …
<!--/t:c-->
```

- The opening marker is exactly `<!--t:c KEY-->` or `<!--t:c KEY PROPS-->`: the text `t:c`, one
  space, the key, and optionally one space and the props token (section 2.5). Nothing else is
  allowed inside the comment, not even a trailing space.
- The closing marker is exactly `<!--/t:c-->`. It closes the innermost open component.
- Markers nest properly, and a component's opening and closing markers have the same parent node.
  A component that opens inside an element and closes outside it is a server error.

AIC renders `<!--aic:c KEY-->` … `<!--/aic:c-->` today and will move to this spelling. Tessera
reads only the spelling above.

### 2.3 Blocks

A block is a conditional or a loop in a template, marked so that it morphs as one unit:

```html
<!--t:b--><p class="notice">Saved.</p><!--/t:b-->
<p>Your order</p>
```

- The markers are exactly `<!--t:b-->` and `<!--/t:b-->`, with the same nesting rules as
  components.
- A block's markers are always rendered, even when the condition is false or the loop is empty
  (`<!--t:b--><!--/t:b-->`). Tessera pairs the old and new blocks among a parent's children by
  position: the first block with the first block, and so on. Because an empty block still has its
  markers, a conditional that appears does not shift the nodes after it, and the morph never
  reuses `<p>Your order</p>` for the notice.
- Blocks have no key and are never a target. They shape the morph inside a target; nothing more.

### 2.4 Keys and paths

- A key matches `^[A-Za-z0-9_.:]+(-[A-Za-z0-9_.:]+)*$` and is at most 64 characters: letters,
  digits, `_`, `.`, `:` and single hyphens, not first or last (`cart`, `line-7`, `post:42`).
- A key is unique among its siblings: the components whose nearest enclosing component, or region
  when there is none, is the same. Blocks do not count. Two siblings with one key are a server
  error.
- A component's full identity is its **path**: the name of its nearest enclosing region, or `page`
  when no region encloses it, then the keys of every enclosing component from the outside in, then
  its own key, joined by `/`.

In this page:

```html
<body>
  <header><!--t:c cart-count-->3<!--/t:c--></header>
  <main data-region="content">
    <!--t:c cart-->
      <!--t:c line-7-->…<!--/t:c-->
      <!--t:c line-9-->…<!--/t:c-->
    <!--/t:c-->
  </main>
</body>
```

the paths are `page/cart-count`, `content/cart`, `content/cart/line-7` and `content/cart/line-9`.
A region nested in a component starts paths of its own: components inside it are addressed from
that region's name.

A path is at most 512 characters.

### 2.5 Props

A component rendered alone needs its inputs back. The server puts them, signed, in the opening
marker as an opaque **props token**:

- The token is 1 or more characters from `A-Z a-z 0-9 - _ . ~ + / =`, which covers base64,
  base64url, JWT-style tokens and hex.
- Tessera never reads, decodes or checks the token. It sends it back, byte for byte, when it asks
  for that component (section 4.3).
- The browser can change the token, so the server must verify its signature before it uses it,
  and must not put anything in it that the user may not read: signing is not encryption.
- Props are inputs, not state. The server renders from them and from its own data; there is no
  snapshot, and nothing the browser sends is assigned to the application's fields.
- The token travels in a request header, so it should stay small, under 1 KB: an id and a version
  rather than a record.

### 2.6 The `page` target

A **target** is what an update replaces: the page, a region or a component.

| Target | Written as | Example |
|---|---|---|
| The whole document | `page` | `page` |
| A region | its name | `content` |
| A component | its path | `content/cart/line-7` |

A target containing `/` is a component; `page` is the document; anything else is a region. The
same spelling is used in request headers, in fragment responses, in stream events and in
attributes.

## 3. Attributes a server renders

Tessera reads these attributes from the server's HTML. Each has one name. The ticket in the last
column builds the browser behaviour; the name and the meaning are fixed here.

| Attribute | On | Meaning | Ticket |
|---|---|---|---|
| `data-region="NAME"` | any element | The element is region `NAME` (section 2.1). | #9 |
| `data-target="TARGETS"` | `<a>`, `<form>`, a submit `<button>` or `<input>` | The targets a visit or submission updates, space-separated (`content`, `content sidebar`, `page`). On a submitter it overrides the form's. Without it: the innermost region containing the element, or `page` when there is none. | #13 |
| `data-enhance="off"` | any element | Links and forms inside it, and the element itself, are left to the browser. `data-enhance="on"` inside an `off` element turns enhancement back on; the nearest one wins. | #13 |
| `data-track` | `<script src>`, `<link href>` in `<head>` | A tracked asset. Any change to the set of tracked assets forces a full load (section 9). The value is optional and is compared too, so `data-track="v42"` can carry a build id. | #13 |
| `autofocus` | a focusable element in a fragment | The server's choice of focus after an update. | #14 |
| `data-error-summary` | the element listing a form's errors | After a `422` or `409`, Tessera focuses it; without one, the first field with `aria-invalid="true"`. | #15 |
| `aria-invalid="true"` | a form field | The standard attribute; Tessera uses it as the focus fallback above. | #15 |
| `data-permanent` | an element with an `id` | Kept as the same live node across whole-document visits, when the incoming page has an element with the same `id` and `data-permanent`. | #17 |
| `data-lazy="URL"` | any element | Load the element's target (section 4.1) from a same-origin GET once it is rendered. | #17 |
| `data-poll="URL"` | any element | Refresh the element's target from a same-origin GET on an interval. #17 defines the interval's modifier syntax; the default is 2 seconds. | #17 |
| `data-stream="URL"` | any element | Open a stream (section 7) that lives as long as the element. | #16 |
| `data-signals__region`, `data-signals__document` | any element | Declare signals into the enclosing region's scope or the document's scope instead of the nearest one. | #8 |

Tessera also reads three `<meta>` elements in `<head>`:

| Meta | Meaning |
|---|---|
| `<meta name="tessera-layout" content="NAME">` | The layout this page was rendered with, same grammar as a region name. Sent back as `Tessera-Layout` (section 4.2). |
| `<meta name="tessera-csrf-token" content="TOKEN">` | The CSRF token Tessera sends on every unsafe request. |
| `<meta name="tessera-csrf-header" content="HEADER">` | The header name for the token. Default `X-CSRF-Token`. |

The Datastar-style attributes (`data-signals`, `data-on`, `data-bind` and the rest, listed in
`docs/design.md`) are local state and behaviour; they need nothing from the server beyond
rendering them.

## 4. Requests

### 4.1 Kinds

Tessera makes five kinds of request. A plain browser request (a direct visit, JavaScript off, a
link opened in a new tab) carries none of the headers below.

| Kind | Method | Made by | Default target |
|---|---|---|---|
| `visit` | GET | an enhanced link, a GET form, Back and Forward, following a redirect, a prefetch | the link's or form's `data-target`, else its innermost region, else `page` |
| `submit` | POST | a form with `method="post"` | the submitter's or form's `data-target`, else the form's innermost region, else `page` |
| `action` | GET, POST, PUT, PATCH or DELETE | `@get(…)`, `@post(…)`, `@put(…)`, `@patch(…)`, `@delete(…)` in an expression | the action's own option, else the innermost component or region containing the element (a region contains itself), else `page` |
| `refresh` | GET | `data-lazy`, `data-poll`, a refresh through the API | the innermost component or region containing the element (a region contains itself), else `page` |
| `stream` | GET | `data-stream`, a stream through the API | none: the URL names the stream |

A **write** is any request whose method is not GET. Tessera sends a write once and never again
(section 4.5).

A form's method, action and encoding come from the browser's own rules, submitter included
(`formaction`, `formmethod`, `formenctype`), and its body is the browser's `FormData` for that
form and submitter. A GET form's fields become the visit URL's query, as the browser would build
it. File inputs go as `multipart/form-data`.

### 4.2 Headers Tessera sends

| Header | Sent on | Value |
|---|---|---|
| `Tessera-Request` | every request | the kind: `visit`, `submit`, `action`, `refresh` or `stream` |
| `Tessera-Protocol` | every request | `0` |
| `Tessera-Targets` | every request except streams, when the target is not `page` | the targets, with props (section 4.3) |
| `Tessera-Layout` | every request, when the page has a `tessera-layout` meta | its content |
| `Tessera-Signals` | actions only | the signals (section 4.4) |
| the CSRF header, `X-CSRF-Token` unless the page names another | POST, PUT, PATCH and DELETE to the page's own origin, when the page has a `tessera-csrf-token` meta | the token, read from the meta when the request is made |
| `Last-Event-ID` | a stream reconnecting, when an event id was seen | the last id |
| `Accept` | every request | `text/event-stream` for a stream; `text/vnd.tessera+html, text/html;q=0.9` for the rest |

The server tells a Tessera request from a plain one by `Tessera-Request` alone, and chooses its
answer from `Tessera-Request`, `Tessera-Targets` and `Tessera-Layout`, never from `Accept`.

A form keeps its own CSRF field (a hidden `_token` input, for example) in its body; the header is
sent as well, so a server can check either.

### 4.3 `Tessera-Targets`

```
Tessera-Targets = entry *( OWS "," OWS entry )
entry           = target [ SP props ]
target          = region / path            ; sections 2.1 and 2.4
props           = 1*( ALPHA / DIGIT / "-" / "_" / "." / "~" / "+" / "/" / "=" )
```

For example, a click on a button inside `content/cart/line-7`, whose marker carries a token:

```
Tessera-Targets: content/cart/line-7 eyJpZCI6N30.a9Zx
```

and a link updating two regions:

```
Tessera-Targets: content, sidebar
```

The header is absent when the target is the page.

The list says what the page wants. The server should render at least those targets when it can,
and may send others too: a write that changes the cart count in the header sends `page/cart-count`
alongside the form's region. The server may answer with the whole document instead (section 5.1).
The server must authorize every target it renders as it would the whole page: naming a target in a
header grants nothing.

### 4.4 Signals

An action sends the signals its element can see, so the server can read local UI state (a
selected tab, a quantity being edited). Signals never carry application data (`docs/design.md`,
"Signals"); the server must treat them as untrusted input, like a query string.

- Only actions send signals. Visits, submissions, refreshes and streams send none, so their
  responses are the ones a plain browser would get.
- The value is one JSON object: every signal visible from the initiating element, innermost scope
  first, so a component's `$open` hides the region's `$open`. The scopes are the element's
  enclosing components, its enclosing regions and the document; a sibling component's signals
  are never sent.
- Left out: signals and object keys whose names start with `_`, at any depth; computed signals
  (`data-computed`), since the server receives what they derive from; and values JSON cannot
  carry faithfully: elements and other DOM nodes (`data-ref`), functions, `undefined`, symbols,
  bigints, non-finite numbers and class instances such as dates. Inside an object such a value
  is omitted; inside an array it becomes `null`, as `JSON.stringify` writes it. A signal that
  contains itself is an error, and the action is not sent.
- The JSON has no insignificant whitespace, and every character above U+007E is written as a
  `\u` escape (UTF-16, with surrogate pairs above U+FFFF), so the header is plain ASCII. Any JSON
  parser reads it unchanged.
- Tessera refuses to send an action whose `Tessera-Signals` value would exceed 4,096 bytes, and
  reports an error naming the size. State that large is application data and belongs in the
  request body, the URL or the session.

```
Tessera-Signals: {"open":true,"qty":2,"note":"caf\u00e9"}
```

An action's body is empty unless the action is given a form, in which case the body is that
form's data in the form's encoding. A GET or DELETE action has no body.

### 4.5 What Tessera never sends

- No request to another origin. Every enhanced request, lazy load, poll and stream is
  same-origin, with `credentials: "same-origin"`. A cross-origin link or form is left to the
  browser.
- No resent write. A write is dispatched once. A network failure, a timeout or an abort after
  dispatch is reported as **indeterminate** (it may have been saved) and is never retried, and a
  redirect answering a write is never followed by resending the body (section 5.4). Tessera may
  retry a GET.
- No second submission of a form while its first is in flight.
- No CSRF header on a GET, or to another origin.
- No signals except on actions, and never `_`-prefixed ones.
- No HTML, DOM state, scroll position or component state. A component is identified by its path
  and its props token as the server rendered it.
- No `X-Requested-With`, and no `Datastar-Request`. Frameworks that switch to JSON errors on
  `X-Requested-With` (Laravel's `expectsJson()`) keep rendering HTML for Tessera.
- No body on a GET.

## 5. Responses

### 5.1 Choosing the answer

For a Tessera request, the server answers with one of:

| Answer | When | Section |
|---|---|---|
| A full document | the target is `page`; the request is a visit and the page at this URL was rendered with another layout than `Tessera-Layout` names, or the header is absent; a requested target is not on that page; or the server cannot render fragments for this route | 5.2 |
| A fragment response | otherwise, for a visit, a submission, an action or a refresh | 5.3 |
| `Tessera-Location` | the server would redirect | 5.4 |
| `Tessera-Full-Visit` | the page must be loaded by the browser from scratch (logged out, a page Tessera cannot update) | 5.5 |
| `204` | nothing changes | 6 |
| A stream | a stream request | 7 |

A server that ignores Tessera entirely still works: it sends full documents, and Tessera commits
them as whole-document visits.

For a refresh or an action whose target the server no longer renders (the cart was emptied), the
server sends that target with mode `remove`, or leaves it out.

### 5.2 Full documents

A response with `Content-Type: text/html` is a full document: what the server would send a plain
browser. Tessera commits it as a whole-document visit: the head policy of section 9, then the
`<body>` morphed in place (not replaced), keeping `data-permanent` elements.

### 5.3 Fragment responses

```
Content-Type: text/vnd.tessera+html; charset=utf-8
Tessera-Protocol: 0
```

The body is HTML whose top level holds only these elements, in any order, with whitespace and
comments between them:

| Element | Count | Meaning |
|---|---|---|
| `<template data-target="TARGET" data-mode="MODE">…</template>` | any | One fragment: new markup for one target. `data-target` is the attribute links use, here naming exactly one target. `data-mode` is optional; the default is `morph`. |
| `<script type="application/json" data-scope="TARGET">{…}</script>` | any | One signal patch into the scope of `TARGET` (`page` is the document scope). `data-only-if-missing` sets only signals that do not exist yet. |
| `<title>…</title>` | at most one | The new document title. |
| `<meta name="tessera-csrf-token" content="…">` | at most one | A new CSRF token, for a session that changed (after a login, for example). |
| `<link … data-track>`, `<script … data-track></script>` | any | Copies of the tracked assets the server would render in `<head>` now. Compared, never inserted or run (section 9). |

Any other element at the top level makes the response malformed: Tessera commits nothing and
reports an error.

A fragment response cannot target `page`: to update the whole document, send a full document.

**Modes.** The template's content depends on the mode:

| Mode | Template content | Effect on a region | Effect on a component |
|---|---|---|---|
| `morph` | the whole target as the page would render it | Exactly one element, carrying `data-region` with the target's name and the same tag as the live region element. Its attributes and children are morphed into the live region element. | Exactly one opening marker with the target's key, its content and its closing marker. The markers' props and the content between them are morphed in. |
| `inner` | the target's new children | The children are morphed; the element's own attributes stay. | The nodes between the markers are morphed; the markers and their props stay. |
| `append` | nodes to add | Added after the last child. | Added before the closing marker. |
| `prepend` | nodes to add | Added before the first child. | Added after the opening marker. |
| `remove` | nothing (whitespace only) | The region element is removed. | Both markers and everything between are removed. |

Every mode except `remove` morphs or inserts through one render transaction: nested components
and regions that leave the page are torn down first, the deepest first, and new ones start once.
A component whose key is unchanged keeps its local signal scope; one whose key changed is a new
component.

**Signal patches.** The JSON object is merged deeply into the named scope: nested objects merge,
arrays and other values replace, and `null` removes a signal. The JSON must be strict (no
comments, no trailing commas) and must not contain `</script`; escape `<` as `<`, which
PHP's `JSON_HEX_TAG` and a one-line replace in Rust both do.

**Rules for the body as a whole.**

- No two fragments in one response may name the same target, or targets one of which contains
  the other. Tessera refuses such a response: send the outer target only.
- Tessera checks every target before it changes anything. A target named in the request that has
  left the page since (the user removed the line while the request was in flight) is dropped and
  reported; the rest commit. Any other target the page lacks fails the whole response: on a visit,
  Tessera does a full load of the visit's URL; on anything else it commits nothing and reports the
  error.
- The response commits as one unit: every fragment, then the signal patches in body order, then
  the title and the CSRF token. Tracked assets are compared before any of it (section 9).
- A `<script>` inside a fragment is inserted as markup and never runs.

### 5.4 Redirects: `Tessera-Location`

`fetch` cannot follow a redirect selectively: with `redirect: "manual"` it hides the `Location`
of a `303`, and with `redirect: "follow"` it resends a write's body on a `307` or `308`. So for a
Tessera request the server sends a redirect as a header instead:

```
HTTP/1.1 200 OK
Tessera-Location: /orders/42
Tessera-Protocol: 0
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout
```

- A server layer must turn every `301`, `302` and `303` it would send to a Tessera request into
  `200` with `Tessera-Location` set to the same URL and an empty body. A plain request still gets
  the real redirect. One middleware at the edge of the server layer can do it for every route.
- The value is a URL, absolute or relative to the request's URL, as in `Location`.
- Tessera follows it with a fresh GET: a `visit` with the original request's `Tessera-Targets`.
  The body of the original request is never sent again. A same-origin URL becomes an enhanced
  visit and its URL is pushed to history; a URL on another origin becomes a full load.
- A server must not send `307` or `308` to a Tessera write. Tessera sends writes with
  `redirect: "manual"`, so any real redirect reaching it, from the server or from a proxy in
  front of it, arrives without a location: Tessera reports the write as indeterminate and follows
  nothing.
- Tessera sends reads with `redirect: "follow"`, so a proxy's redirect of a GET still works:
  `fetch` follows it with the same headers, and the final URL is the one pushed to history.

### 5.5 Full visits: `Tessera-Full-Visit`

```
Tessera-Full-Visit: /login
```

on any status asks Tessera to leave the page to the browser: it calls `location.assign` with the
URL, resolved against the request's URL, and ignores the body. Only `http:` and `https:` URLs are
followed; anything else is reported and ignored. `Tessera-Full-Visit` wins over
`Tessera-Location` when both are present.

### 5.6 Full loads

Several rules above end in a **full load**: Tessera hands the navigation to the browser with
`location.assign`. The URL is the visit's URL (its final URL after redirects) for a visit, and
the current page's URL for anything else. A full load is always a GET; it never resends a write.

### 5.7 Response headers

| Header | On | Value |
|---|---|---|
| `Content-Type` | every response with a body | `text/html` (a document), `text/vnd.tessera+html` (fragments) or `text/event-stream` (a stream), with `charset=utf-8` |
| `Tessera-Protocol` | fragment responses, streams and the `400` of section 1; allowed on any response to a Tessera request | `0`; on a `400`, the versions the server speaks |
| `Tessera-Location` | in place of a `301`, `302` or `303` | a URL |
| `Tessera-Full-Visit` | any status | a URL |
| `Tessera-Stream-Pause` | a stream | `hidden` |
| `Vary` | every response from a URL that answers Tessera requests | section 8 |

## 6. Status codes

| Status | What the server means | What Tessera does |
|---|---|---|
| `200` | Here is the result. | Commits the body: a full document, fragments, or `Tessera-Location`. A visit pushes its URL. |
| `204` | Nothing changes. | Nothing: no commit, no history entry. A visit stays on the current page, as a browser does. A stream stops. |
| `301`, `302`, `303` | Look elsewhere. | Never seen from a server speaking the protocol (section 5.4). From a proxy: a read follows it; a write is reported as indeterminate. |
| `307`, `308` | Resend the request elsewhere. | A read follows it. A write is reported as indeterminate and never resent. |
| `400` with a `Tessera-Protocol` header not listing `0` | This server does not speak your version. | Full load (section 1). |
| `409`, `422` | The write was refused; here is why. | Commits the fragments in place: the form's region with its errors. No history entry; the URL stays. Focus goes to `data-error-summary`, else the first `aria-invalid="true"` field. |
| `419` | The page expired (the session or the CSRF token is stale). | Raises a "page expired" event. Its default prompt offers a reload of the current page. Nothing is resent. |
| other `4xx` with a recognized body | The request failed; here is the page or region to show (a `404` page, a `403` notice). | Commits it as for `200`. A visit pushes its URL, as the browser would show the error page at that URL. |
| `5xx` with a recognized body | The server failed and rendered an error. | Commits it as for a `4xx`. |
| any status without a recognized body | A response Tessera cannot use. | Reports an error. A visit does a full load; a write is reported as indeterminate. |

A **recognized body** is a full document (`text/html`) or a fragment response with the right
`Tessera-Protocol`. JSON, plain text and an empty body (other than with `204`, `Tessera-Location`
or `Tessera-Full-Visit`) are not.

## 7. Streams

A stream is a long-lived GET whose response is Server-Sent Events. Tessera opens it with `fetch`
and a streamed body, not `EventSource`, so the protocol's headers go with it. One stream per URL
is open on a page, shared by every element that names it.

### 7.1 The request and the response

```
GET /orders/stream HTTP/1.1
Accept: text/event-stream
Tessera-Request: stream
Tessera-Protocol: 0
Tessera-Layout: app
Last-Event-ID: 1187
```

```
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store
Tessera-Protocol: 0
```

Behind nginx, also send `X-Accel-Buffering: no`, or events wait in nginx's buffer.

With `Tessera-Stream-Pause: hidden`, Tessera closes the stream while the page is hidden and
reconnects, with `Last-Event-ID`, when it is visible again. Without it the stream stays open.

### 7.2 Events

The framing is standard SSE (WHATWG HTML, "Server-sent events"): `event:`, `data:`, `id:` and
`retry:` fields, `:` comments, a blank line ending each event. Every data line holds one key,
optionally a space and a value: `data: KEY VALUE`. Keys are case-sensitive; Tessera ignores keys
it does not know. An event needs at least one data line, or SSE drops it.

**`tessera-patch-elements`**: one fragment.

| Data key | Required | Value |
|---|---|---|
| `target` | yes | the target (section 2.6), `page` included |
| `mode` | no | `morph` (default), `inner`, `append`, `prepend` or `remove` |
| `elements` | for every mode but `remove` | one line of the markup; repeat the key for each line, and Tessera joins the values with a line feed |

The markup is what a fragment response's `<template>` would hold for the same target and mode
(section 5.3). For the `page` target it is a full document, the mode must be `morph`, and Tessera
commits it as a whole-document visit.

```
event: tessera-patch-elements
id: 1188
data: target content/orders/order-42
data: elements <!--t:c order-42 eyJpZCI6NDJ9.Pq1-->
data: elements <li>Order 42: <strong>shipped</strong></li>
data: elements <!--/t:c-->

```

**`tessera-patch-signals`**: one signal patch.

| Data key | Required | Value |
|---|---|---|
| `scope` | yes | the target whose scope receives the patch; `page` is the document scope |
| `onlyIfMissing` | no | `true` to set only signals that do not exist yet |
| `signals` | yes | strict JSON, an object; repeat the key for a multi-line object, joined with a line feed |

```
event: tessera-patch-signals
data: scope page
data: signals {"unread":4}

```

**`tessera-close`**: the stream is finished. Tessera stops and does not reconnect. The data lines
are ignored, but one is required: `data: reason done`.

Events with other names change nothing on the page; Tessera passes them to the stream's listeners
in the API (ticket #16).

Each `tessera-patch-elements` event commits in its own render transaction, in the order it
arrives, under the same target checks as a fragment response, except that a stream never causes a
full load for a missing target: the event is dropped and reported. A `page` event whose tracked
assets changed does cause a full load of the current page.

### 7.3 Ids, `retry` and reconnecting

- `id:` sets the stream's last event id, as the SSE standard says; an id containing NUL is
  ignored. The server should give an id to every event it could replay.
- `retry:` (digits only) sets the reconnect delay in milliseconds. The default is 1,000.
- When the connection drops or the body ends without `tessera-close`, Tessera waits the delay and
  reconnects with `Last-Event-ID`. Each failed attempt in a row doubles the delay, up to 30
  seconds; an event arriving resets it.
- The server resumes after the event named by `Last-Event-ID`, so the page sees each event once.
  A server that cannot resume (the id is too old) sends the current state of everything the
  stream covers, as fragments, so a missed change is never silent.
- Tessera stops for good on `tessera-close`, on a `204`, when the last element naming the stream
  leaves the page, on a `401`, `403`, `404` or `410` (reported), and on a `200` that is not
  `text/event-stream` (reported). A `419` raises the "page expired" event. A `429`, a `5xx` or a
  network failure is retried with the backoff above.

## 8. Caching

A URL that answers both plain and Tessera requests has two or more representations, so every
response from it, the plain ones included, must carry:

```
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout
```

and also `Tessera-Signals` when the response depends on signals. Then no cache serves a fragment
to a plain request, or one region's fragment to a request for another. `Tessera-Targets` carries
the props tokens, so props are covered too. The server adds its own `Vary` values (`Cookie`,
`Accept-Language`) as it would anyway.

- Streams send `Cache-Control: no-store`.
- Writes are not cached; nothing here changes that.
- Tessera keeps responses in memory only for its back cache (#14) and prefetch (#17), bounded,
  for the life of the page, and never one sent with `Cache-Control: no-store`. A server that needs
  Back to show fresh content sends `no-store`.

## 9. Head and assets

**On a whole-document visit** (a `text/html` response, or a `page` stream event), in this order:

1. Tracked assets are compared. The set is every `<script src>` and `<link href>` in `<head>`
   with `data-track`, each identified by its tag, its resolved URL and its `data-track` value.
   If the incoming set differs from the current one in any way (an asset added, removed or
   changed), Tessera does a full load instead, before it changes anything.
2. Incoming head elements the current head lacks, compared by their markup, are added;
   stylesheets among them are loaded before the body changes, so the page does not flash
   unstyled. Current head elements the incoming head lacks are removed after the body commit.
   Scripts are never added and never run.
3. `<title>`, `<html lang dir>` and the `tessera-layout` and `tessera-csrf-token` metas take the
   incoming values.
4. The body is morphed in place.

**On a fragment response**, tracked assets are compared when the body carries copies of them
(section 5.3), with the same full-load rule, before anything commits. A server should include
them in every fragment response: it is the only way a page learns, during region visits, that a
deploy changed its scripts. `<title>` and the CSRF meta apply as in section 5.3.

**Scripts never run.** A `<script>` in a fragment, in a stream event or in an incoming document is
inserted as markup, or left out of the head, and never executes. A page that needs different
scripts must mark them `data-track`, so the change forces a full load. Put behaviour in the page's
tracked scripts and in Datastar-style attributes. Inline handlers (`onclick` and the like) are live
once inserted, as with any DOM change, and the page's Content Security Policy still governs them.

## 10. Worked examples

The examples share one application: a shop whose layout is `app`, with regions `sidebar` and
`content`, a cart count in the header, and a cart in `content`. Headers not specific to Tessera
(`Host`, cookies, lengths) are left out, and so are the tracked-asset copies in fragment responses
after example 10.2.

### 10.1 A direct visit, or JavaScript off

```
GET /products HTTP/1.1
Accept: text/html
```

```
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout

<!doctype html>
<html lang="en">
<head>
  <title>Products · Shop</title>
  <meta name="tessera-layout" content="app">
  <meta name="tessera-csrf-token" content="3f9c…">
  <link rel="stylesheet" href="/assets/app.4be1.css" data-track>
  <script type="module" src="/assets/tessera.min.js" data-track></script>
</head>
<body>
  <header><a href="/cart">Cart (<!--t:c cart-count-->3<!--/t:c-->)</a></header>
  <nav data-region="sidebar"><a href="/products/7" data-target="content">Lamp</a></nav>
  <main data-region="content">…</main>
</body>
</html>
```

The browser renders the page. Tessera starts and changes nothing. Every later example starts from
this page.

### 10.2 Enhanced navigation

The user clicks "Lamp" in the sidebar. The link names `content`.

```
GET /products/7 HTTP/1.1
Accept: text/vnd.tessera+html, text/html;q=0.9
Tessera-Request: visit
Tessera-Protocol: 0
Tessera-Targets: content
Tessera-Layout: app
```

The page at `/products/7` uses layout `app` and has a `content` region, so the server sends one
fragment:

```
HTTP/1.1 200 OK
Content-Type: text/vnd.tessera+html; charset=utf-8
Tessera-Protocol: 0
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout

<title>Lamp · Shop</title>
<link rel="stylesheet" href="/assets/app.4be1.css" data-track>
<script type="module" src="/assets/tessera.min.js" data-track></script>
<template data-target="content">
  <main data-region="content">
    <h1>Lamp</h1>
    <form method="post" action="/cart/lines">…</form>
  </main>
</template>
```

Tessera compares the tracked copies (unchanged), morphs `content`, sets the title and pushes
`/products/7` to history. The sidebar and the header are untouched.

If the user had followed a link to `/account`, whose page uses layout `account`, the server would
see `Tessera-Layout: app`, answer with the full document for `/account`, and Tessera would commit
it as a whole-document visit (section 5.2), or do a full load if its tracked assets differ.

### 10.3 A form submission that succeeds

The user submits the "add to cart" form in `content`.

```
POST /cart/lines HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Accept: text/vnd.tessera+html, text/html;q=0.9
Tessera-Request: submit
Tessera-Protocol: 0
Tessera-Targets: content
Tessera-Layout: app
X-CSRF-Token: 3f9c…

product=7&qty=1&_token=3f9c…
```

The application saves the line and redirects with `303 See Other` to `/cart`. The server layer
sees a Tessera request and sends the redirect as a header:

```
HTTP/1.1 200 OK
Tessera-Location: /cart
Tessera-Protocol: 0
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout
```

Tessera follows it with a visit, without the body:

```
GET /cart HTTP/1.1
Accept: text/vnd.tessera+html, text/html;q=0.9
Tessera-Request: visit
Tessera-Protocol: 0
Tessera-Targets: content
Tessera-Layout: app
```

The server answers with `content` and, since the count changed, the header's component too:

```
HTTP/1.1 200 OK
Content-Type: text/vnd.tessera+html; charset=utf-8
Tessera-Protocol: 0
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout

<title>Cart · Shop</title>
<template data-target="content">
  <main data-region="content">
    <!--t:c cart eyJjYXJ0IjoxOH0.c2ln-->
      <!--t:c line-7 eyJsaW5lIjo3fQ.c2ln--><p>Lamp × 1</p><!--/t:c-->
    <!--/t:c-->
  </main>
</template>
<template data-target="page/cart-count">
  <!--t:c cart-count-->4<!--/t:c-->
</template>
```

Tessera morphs both, sets the title and pushes `/cart`. With JavaScript off the browser posts the
same form, gets the real `303` and loads `/cart` in full.

### 10.4 A form submission with errors

The user submits a quantity of zero.

```
POST /cart/lines HTTP/1.1
Tessera-Request: submit
Tessera-Targets: content
…
```

```
HTTP/1.1 422 Unprocessable Content
Content-Type: text/vnd.tessera+html; charset=utf-8
Tessera-Protocol: 0
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout

<template data-target="content">
  <main data-region="content">
    <h1>Lamp</h1>
    <div data-error-summary tabindex="-1" role="alert">Quantity must be at least 1.</div>
    <form method="post" action="/cart/lines">
      <input name="qty" value="0" aria-invalid="true" aria-describedby="qty-error">
      …
    </form>
  </main>
</template>
```

Tessera morphs `content` in place, adds no history entry, keeps the URL `/products/7`, and
focuses the error summary. With JavaScript off the server renders the same page in full with the
`422`.

### 10.5 An action with signals

Inside `content/cart/line-7` a button reads `data-on:click="@post('/cart/lines/7/qty')"`, and the
line's scope holds `$qty`, set to 2 by a local stepper.

```
POST /cart/lines/7/qty HTTP/1.1
Accept: text/vnd.tessera+html, text/html;q=0.9
Tessera-Request: action
Tessera-Protocol: 0
Tessera-Targets: content/cart/line-7 eyJsaW5lIjo3fQ.c2ln
Tessera-Layout: app
Tessera-Signals: {"qty":2}
X-CSRF-Token: 3f9c…
```

The server verifies the props token, reads `qty` from the signals, saves it, and renders the line
and the count. It also resets a local "editing" flag:

```
HTTP/1.1 200 OK
Content-Type: text/vnd.tessera+html; charset=utf-8
Tessera-Protocol: 0
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout, Tessera-Signals

<template data-target="content/cart/line-7">
  <!--t:c line-7 eyJsaW5lIjo3fQ.c2ln--><p>Lamp × 2</p><!--/t:c-->
</template>
<template data-target="page/cart-count">
  <!--t:c cart-count-->5<!--/t:c-->
</template>
<script type="application/json" data-scope="content/cart/line-7">{"editing":false}</script>
```

Tessera morphs the line and the count, then sets `$editing` to `false` in the line's scope. The URL
and history do not change.

### 10.6 A component refresh, a poll, a lazy load

In `content`, `<div data-poll="/cart">` sits inside `content/cart`. Every 2 seconds:

```
GET /cart HTTP/1.1
Accept: text/vnd.tessera+html, text/html;q=0.9
Tessera-Request: refresh
Tessera-Protocol: 0
Tessera-Targets: content/cart eyJjYXJ0IjoxOH0.c2ln
Tessera-Layout: app
```

When nothing changed the server answers `204` and Tessera does nothing. When the cart changed it
sends the component:

```
HTTP/1.1 200 OK
Content-Type: text/vnd.tessera+html; charset=utf-8
Tessera-Protocol: 0
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout

<template data-target="content/cart">
  <!--t:c cart eyJjYXJ0IjoxOH0.c2ln-->…<!--/t:c-->
</template>
```

A lazy load is the same request, made once: `<section data-region="reviews" data-lazy="/products/7">`
asks for `Tessera-Targets: reviews`, and the fragment it gets back replaces the placeholder (the
new markup has no `data-lazy`).

### 10.7 A stream

`<ul data-region="orders" data-stream="/orders/stream">` opens the stream of section 7.1, first
without `Last-Event-ID`. The server sends:

```
retry: 2000

event: tessera-patch-elements
id: 1188
data: target orders
data: mode prepend
data: elements <li>Order 43: <strong>new</strong></li>

event: tessera-patch-signals
id: 1189
data: scope page
data: signals {"unread":5}

```

Tessera prepends the order, then sets `$unread`. The connection drops. Tessera waits 2 seconds and
reconnects with `Last-Event-ID: 1189`; the server sends what happened after 1189. When a visit
replaces the list, the stream closes. A server ending the stream on purpose
sends:

```
event: tessera-close
data: reason done

```

### 10.8 A full visit, an expired page, a mismatched version

The session ended while the user browsed. Any Tessera request gets:

```
HTTP/1.1 401 Unauthorized
Tessera-Full-Visit: /login?next=%2Fcart
```

and Tessera calls `location.assign("/login?next=%2Fcart")`.

The CSRF token went stale. A submission gets `419`, Tessera shows its "page expired" prompt, and
the user reloads; the form is not resent.

A tab kept open across a deploy runs an older Tessera than the server speaks. Its next request
carries `Tessera-Protocol: 0`; a server speaking only version 1 does nothing and answers
`400` with `Tessera-Protocol: 1`. Tessera does a full load, and the reloaded page brings the new
Tessera.

## 11. Server checklist

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

## 12. Coverage of the design's request table

| Row in `docs/design.md` | Here |
|---|---|
| Direct visit, or JavaScript off: plain GET, full HTML document | 4.1, 5.2, 8, example 10.1 |
| Enhanced navigation: GET plus a header naming the update kind; the regions that change, keyed by identity | 4.1 to 4.3, 5.1, 5.3, example 10.2 |
| Form post or action: POST with the CSRF token in a header; the affected regions; 422 in place; 303 to a GET | 4.2, 4.4, 5.3, 5.4, 6, examples 10.3, 10.4, 10.5 |
| Component refresh, poll, lazy load: GET naming the target; that component or region | 2.4, 2.5, 4.1, 4.3, example 10.6 |
| Stream: `text/event-stream`; SSE events carrying fragments for any targets, up to the whole page | 7, example 10.7 |
| `Vary` on Tessera's request headers | 8 |
| A missing region on a read falls back to a full visit; a write never replays | 4.5, 5.3, 5.6, 6 |
| Head changes: a changed tracked asset forces a full load; fetched scripts never run | 9 |
