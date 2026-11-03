# Tessera protocol, version 2

This is what a server must do to speak Tessera. It is written for the server layers of AIC (PHP)
and Rustal (Rust), and for anyone writing another: each can be built from this document alone,
without reading Tessera's source. `docs/design.md` explains why the model is shaped this way;
`docs/decisions.md` records who chose each name and which choices are still **Provisional**.

"Must" and "must not" are requirements: a server that breaks one is not speaking the protocol.
"Should" is a strong recommendation with a stated reason. "The server" means the framework's
Tessera layer; the application behind it never sees most of this.

## Contents

1. Versions
2. Identities: regions, components, keys, props, anchors
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
13. What a page can observe

## 1. Versions

Every request Tessera makes carries `Tessera-Protocol: 2`. This document is version 2. A change
that an existing server or page would notice gets a new number.

Version 0 (Tessera 0.1.x) marked components with comment pairs (`<!--t:c KEY PROPS-->` …
`<!--/t:c-->`) and conditionals and loops with `<!--t:b-->` … `<!--/t:b-->`. Version 1 (Tessera
0.2.x) marks a component with attributes on its one root element (section 2.2), has no block
markers (section 2.3) and adds anchors (section 2.7).

Version 2 (Tessera 0.3.x) adds one thing: a `Tessera-Targets` entry for a component that carries
an anchor ends with `@NAME` (section 4.3), so the server can find the component's props by its
anchor and never has to spell its path. A version 1 server would read `@NAME` as a props token,
hence the new number. Everything else is as in version 1. A server moving to version 2 accepts
the anchor in the entry grammar and changes its version check; nothing else on the wire changes.

Tessera 0.3.1 lets a stream event name a component by its anchor (section 7.2) without a new
number. A server pins the Tessera release it serves (`docs/consumers.md`), so it sends `@NAME` in
an event only to a page that resolves it; Tessera 0.3.0 reports such an event and drops it.

A server that does not speak the version a request names must not act on the request: no write,
no side effect. It answers `400` with a `Tessera-Protocol` header listing the versions it does
speak, comma-separated (`Tessera-Protocol: 1, 2`); Tessera ignores the body. Tessera, seeing a
`400` that carries a `Tessera-Protocol` header without its own version, does a full load (section
5.6). A `400` without the header is an ordinary client error (section 6).

A fragment response or a stream must carry `Tessera-Protocol: 2`. One without it, or with another
value, is treated the same way: Tessera commits nothing from it and does a full load. So a server
that speaks only version 1 meets Tessera 0.3 with a full load on every enhanced request: it
answers `400` with `Tessera-Protocol: 1`, and the page still works as plain HTML.

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

A component is exactly one element carrying `data-t-c`, its key:

```html
<section data-t-c="cart" data-t-props="eyJpZCI6NDJ9.Kq3v">
  <h2>Cart <span data-t-c="count">3</span></h2>
  …
</section>
```

- `data-t-c="KEY"` makes the element a component; the key follows section 2.4.
- `data-t-props="TOKEN"` carries the component's props token when it has props (section 2.5), and
  is absent when it has none.
- `data-t-anchor="NAME"` is optional and names the component for links and forms (section 2.7).
- The element is the whole component: what a template renders for it is the element and its
  children. A component that renders several siblings is wrapped by its server in an element
  that is valid there: a `<tbody>` for table rows, a `<div>` elsewhere. A component inside
  `<h2>`, `<p>` or another element that holds only phrasing content is a `<span>`.
- An element must not carry both `data-t-c` and `data-region`, and `data-t-props` and
  `data-t-anchor` only appear beside `data-t-c`. Tessera refuses to patch an element that is both
  a region and a component.
- The component element itself survives an update, as a region element does (section 5.3).

### 2.3 Conditionals and loops

Version 1 has no block markers. A conditional or a loop renders its content, or nothing, with no
trace when it is false or empty. Idiomorph aligns the old and new children of an element by `id`
and then by tag, so a conditional that appears may shift the siblings after it in a morph: the
morph may reuse `<p>Your order</p>` for a notice that appears before it, and then add a new
`<p>`. For plain markup that is harmless. For an element that holds state the user sees (a field,
a `<details>`, anything focusable), the server must render a stable `id`: Idiomorph keeps an
element whose `id` the new markup also has as the same node, so a field keeps its value and focus
whatever appears around it.

```html
<p class="notice">Saved.</p>   <!-- rendered only after a save -->
<p>Your order</p>
<input id="qty" name="qty" value="1">
```

### 2.4 Keys and paths

- A key matches `^[A-Za-z0-9_.:]+(-[A-Za-z0-9_.:]+)*$` and is at most 64 characters: letters,
  digits, `_`, `.`, `:` and single hyphens, not first or last (`cart`, `line-7`, `post:42`).
- A key is unique among its siblings: the components whose nearest enclosing component, or region
  when there is none, is the same. Plain elements between them do not count. Two siblings with one
  key are a server error.
- A component's full identity is its **path**: the name of its nearest enclosing region, or `page`
  when no region encloses it, then the keys of every enclosing component from the outside in, then
  its own key, joined by `/`.

In this page:

```html
<body>
  <header><span data-t-c="cart-count">3</span></header>
  <main data-region="content">
    <section data-t-c="cart">
      <ul>
        <li data-t-c="line-7">…</li>
        <li data-t-c="line-9">…</li>
      </ul>
    </section>
  </main>
</body>
```

the paths are `page/cart-count`, `content/cart`, `content/cart/line-7` and `content/cart/line-9`.
The `<ul>` between the cart and its lines is not part of any path. A region nested in a component
starts paths of their own: components inside it are addressed from that region's name.

A path is at most 512 characters.

### 2.5 Props

A component rendered alone needs its inputs back. The server puts them, signed, in the
component's `data-t-props` attribute as an opaque **props token**:

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
attributes. Where the page names a target, an anchor (section 2.7) may stand in for a component's
path; the server gets the path, with the anchor beside it (section 4.3), never the anchor alone.
A stream event may name a component by its anchor as well (section 7.2).

### 2.7 Anchors

A component's path depends on where it sits, so a link that targets it would have to be rendered
with the page's structure in mind. An anchor names a component by itself instead:

```html
<main data-region="content">
  <section data-t-c="cart" data-t-anchor="cart">…</section>
</main>
<a href="/cart?coupon=1" data-target="@cart">Apply coupon</a>
```

- `data-t-anchor="NAME"` sits on a component element. NAME follows the key grammar (section 2.4)
  and is unique on the page.
- Wherever Tessera reads targets from the page (`data-target` on a link, a form or a submitter,
  an action's `target` option, a visit through the API), and in a stream event's `target` or
  `scope` (section 7.2), `@NAME` names the component carrying that anchor. Tessera resolves it to the component's path from the page before it sends the
  request, so `Tessera-Targets` above holds `content/cart`, then its props token, then `@cart`.
- An anchor that is badly spelled, that no element carries, that two elements carry, or that sits
  on an element without `data-t-c`, is an error: Tessera reports it as it reports a bad target and
  sends nothing.
- Anchors are also sent: every `Tessera-Targets` entry for a component whose element carries a
  well-formed anchor, unique on the page, ends with `@NAME` (section 4.3), however the component
  was targeted. A `data-target="@cart"` link, a poll, lazy load or refresh whose element sits in
  the cart, an action inside it or naming it, and a visit through the API all send
  `content/cart TOKEN @cart`. So a server can find a component's props by anchor, without
  spelling a path that moves when a wrapper or an order changes. An anchor that is badly spelled
  or that two elements carry is left out of the entry.
- A stream event may name a component by `@NAME`: Tessera resolves it against the page when the
  event arrives (section 7.2). A fragment response never uses `@`: its templates and signal
  patches name their targets by path, and `@` there is not a region name and fails as section 5.3
  says.

## 3. Attributes a server renders

Tessera reads these attributes from the server's HTML. Each has one name. The ticket in the last
column builds the browser behaviour; the name and the meaning are fixed here.

| Attribute | On | Meaning | Ticket |
|---|---|---|---|
| `data-region="NAME"` | any element | The element is region `NAME` (section 2.1). | #9 |
| `data-t-c="KEY"` | any element inside `<body>` | The element is a component with key `KEY` (section 2.2). | #33 |
| `data-t-props="TOKEN"` | a component element | The component's props token, sent back with its path (sections 2.5 and 4.3). | #33 |
| `data-t-anchor="NAME"` | a component element | Names the component as `@NAME` for `data-target` and the other places the page names targets, and is sent with the component's entry in `Tessera-Targets` (sections 2.7 and 4.3). | #33, #34 |
| `data-target="TARGETS"` | `<a>`, `<form>`, a submit `<button>` or `<input>` | The targets a visit or submission updates, space-separated (`content`, `content sidebar`, `page`, `@cart`). On a submitter it overrides the form's. Without it: the innermost region containing the element, or `page` when there is none. | #13 |
| `data-push="off"` | `<a>`, `<form>`, a submit `<button>` or `<input>` | The visit, or the visit a submission's `Tessera-Location` leads to, commits as usual and leaves history as it was: no entry, the URL unchanged. For tab-like swaps. On a submitter, `data-push` with any value overrides the form's, so `data-push="on"` there pushes. Any value but `off` pushes, which is the default. | #28 |
| `data-enhance="off"` | any element | Links and forms inside it, and the element itself, are left to the browser. `data-enhance="on"` inside an `off` element turns enhancement back on; the nearest one wins. | #13 |
| `data-track` | `<script src>`, `<link href>` in `<head>` | A tracked asset. Any change to the set of tracked assets forces a full load (section 9). The value is optional and is compared too, so `data-track="v42"` can carry a build id. | #13 |
| `autofocus` | a focusable element in a fragment | The server's choice of focus after an update. | #14 |
| `data-focus-key="KEY"` | any element | A stable name for the element, under which Back and Forward restore focus to it when its `id` is not stable across renders. | #14 |
| `data-error-summary` | the element listing a form's errors | After a `422` or `409`, Tessera focuses it; without one, the first field with `aria-invalid="true"`. | #15 |
| `aria-invalid="true"` | a form field | The standard attribute; Tessera uses it as the focus fallback above. | #15 |
| `data-permanent` | an element with an `id` | Kept as the same live node, its content not morphed, across whole-document visits and fragments (`morph` and `inner`), when the incoming markup has an element with the same `id` and `data-permanent`. | #13, #17 |
| `data-lazy="URL"` | any element | Load the element's target (section 4.1) from a same-origin GET once it is rendered, once. `data-lazy__visible="URL"` waits until the element scrolls into view. The answer should not carry `data-lazy` again. | #17 |
| `data-poll="URL"` | any element | Refresh the element's target from a same-origin GET on an interval: 2 seconds, or the duration modifier (`data-poll__5s`, `data-poll__750ms`; at least 100 ms). Polls with the same interval fire together; while the window does not have focus only every 20th tick fires; none fire while the page is hidden or the browser offline. | #17 |
| `data-prefetch="hover"` or `"off"` | an `<a>` or any element around links | Enhanced links prefetch their visit on mousedown; `hover` also prefetches after the pointer rests on the link for 60 ms, and `off` never prefetches. The nearest one wins. | #17 |
| `data-stream="URL"` | any element | Open a stream (section 7) that lives as long as the element. | #16 |
| `data-signals__region`, `data-signals__document` | any element | Declare signals into the enclosing region's scope or the document's scope instead of the nearest one. | #8 |

`data-push="off"` changes only what a visit does to history. With `data-target` it is the usual
tab: the named targets update and the address stays. Without `data-target` the visit still targets
the innermost region, or `page`; a `page` visit that keeps the old URL shows a document the address
does not name, so keep `off` to regions. A GET form under it sends its query as usual and leaves
the URL without it. A `Tessera-Location` answer is followed as section 5.4 says, with no entry.
Tessera moves neither focus nor scroll after such a visit, as after a refresh. Anything that ends
in a full load (section 5.6), a `Tessera-Location` on another origin and `Tessera-Full-Visit`
change the address regardless, since the browser loads the URL itself. With JavaScript off the
link or form is a plain one and the browser pushes as usual.

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
| `action` | GET, POST, PUT, PATCH or DELETE | `@get(…)`, `@post(…)`, `@put(…)`, `@patch(…)`, `@delete(…)` in an expression | the action's own option, else the innermost component or region containing the element (a component or region contains itself), else `page` |
| `refresh` | GET | `data-lazy`, `data-poll`, a refresh through the API | the innermost component or region containing the element (a component or region contains itself), else `page` |
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
| `Tessera-Protocol` | every request | `2` |
| `Tessera-Targets` | every request except streams, when the target is not `page` | the targets, with props and anchors (section 4.3) |
| `Tessera-Layout` | every request, when the page has a `tessera-layout` meta | its content |
| `Tessera-Signals` | actions only | the signals (section 4.4) |
| the CSRF header, `X-CSRF-Token` unless the page names another | POST, PUT, PATCH and DELETE to the page's own origin, when the page has a `tessera-csrf-token` meta | the token, read from the meta when the request is made |
| `Last-Event-ID` | a stream reconnecting, when an event id was seen | the last id |
| `Tessera-Write-Id` | POST, PUT, PATCH and DELETE | a UUID made for this submission; a browser's own repeat of the request carries the same one (section 5.8) |
| `Accept` | every request | `text/event-stream` for a stream; `text/vnd.tessera+html, text/html;q=0.9` for the rest |

The server tells a Tessera request from a plain one by `Tessera-Request` alone, and chooses its
answer from `Tessera-Request`, `Tessera-Targets` and `Tessera-Layout`, never from `Accept`.

A form keeps its own CSRF field (a hidden `_token` input, for example) in its body; the header is
sent as well, so a server can check either.

### 4.3 `Tessera-Targets`

```
Tessera-Targets = entry *( OWS "," OWS entry )
entry           = target [ SP props ] [ SP "@" anchor ]
target          = region / path            ; sections 2.1 and 2.4
props           = 1*( ALPHA / DIGIT / "-" / "_" / "." / "~" / "+" / "/" / "=" )
anchor          = key                      ; section 2.4, at most 64 characters
```

An entry is one, two or three tokens separated by single spaces: the target, then the props token
when the component's element carries `data-t-props`, then `@` and the anchor when it carries
`data-t-anchor` (section 2.7). `@` cannot occur in a props token, so a token starting with `@` is
always the anchor: an anchored component without props sends `target @NAME`. Regions, `page` and
components without an anchor send none.

For example, a click on a button inside `content/cart/line-7`, whose element carries a token:

```
Tessera-Targets: content/cart/line-7 eyJpZCI6N30.a9Zx
```

a link updating two regions:

```
Tessera-Targets: content, sidebar
```

a poll inside `content/stock-list`, which carries `data-t-props` and `data-t-anchor="stock-list"`:

```
Tessera-Targets: content/stock-list eyJ3IjoyfQ.c2ln @stock-list
```

and a link with `data-target="@live content"`, where the anchored panel has no props and sits at
a positional path inside another component's template:

```
Tessera-Targets: content/c0/Panel.1:live @live, content
```

The header is absent when the target is the page. It never holds an anchor in place of a path:
Tessera has resolved each `@NAME` to its path (section 2.7) and sends the anchor after it. A
server that reads props by anchor must still check that the entry's anchor is the one its target's
component carries, or render by the path, since the browser can send any header.

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
- No resent write. A write is dispatched once. A network failure, a timeout, an abort or an answer
  cut short (shorter than its `Content-Length`) after dispatch is reported as **indeterminate**
  (it may have been saved) and is never retried, and a
  redirect answering a write is never followed by resending the body (section 5.4). Tessera may
  retry a GET. One resend is outside Tessera's reach: Chromium and Firefox resend a request by
  themselves when a reused keep-alive connection closes before any answer, on the view that the
  server never saw it (WebKit does not, and Tessera then reports the write indeterminate). That
  repeat carries the first one's `Tessera-Write-Id`, so a server can tell it apart (section 5.8).
- No second write from a form while its first is in flight: a POST form's repeated submit sends
  nothing, even after the first settles. A GET form's submission is a visit, a read, so this rule
  does not hold it: a newer submission is sent and supersedes the older one (section 4.6), and a
  search box that submits its form as the user types ends on the last query.
- No CSRF header on a GET, or to another origin.
- No signals except on actions, and never `_`-prefixed ones.
- No HTML, DOM state, scroll position or component state. A component is identified by its path
  and its props token as the server rendered it.
- No `X-Requested-With`, and no `Datastar-Request`. Frameworks that switch to JSON errors on
  `X-Requested-With` (Laravel's `expectsJson()`) keep rendering HTML for Tessera.
- No body on a GET.

### 4.6 Overlapping requests

Two requests overlap when one's target is the other's, lies inside it or contains it: a region by
its element, a component by its element, and `page` contains everything. A
request with several targets overlaps another if any pair does. Requests whose targets are apart
run side by side.

For a newer request against an older one still queued or in flight, by class (a read is a GET,
a write anything else, a poll a refresh from `data-poll`):

| Older | Newer read | Newer write | Newer poll |
|---|---|---|---|
| read, newer's target the same or around it | supersedes the older | supersedes the older | is skipped |
| read, newer's target inside it | queues behind it | supersedes the older | is skipped |
| write, any overlap | queues behind it | queues behind it | is skipped |
| poll, any overlap | supersedes the older | supersedes the older | is skipped |
| apart | runs alongside | runs alongside | runs alongside |

To supersede is to abort the older request; one still queued or in its 5 ms wait is never sent.
A GET form's submission is a read like any visit: submitted again with the same targets, it
supersedes its own older submission, whose answer, should it still arrive, is dropped by the
generations below.
A write is never superseded: what overlaps it waits until it settles, in arrival order, so writes
to overlapping targets go one at a time. Polls yield to everything. Across several pairs of
targets, a queue wins over a supersession.

**Generations.** Every target remembers the last commit that touched it, and a commit touches its
target and every target inside it once it has committed, never the targets around it. A request
records the commit sequence when it is dispatched; a fragment for a target touched since then is
dropped and reported, so a late response never overwrites a newer one. A fragment for a target
around a newer commit stays valid, since it replaces that commit's target anyway: a visit of
`content` still lands after a stream event committed to `events` inside it, while a late fragment
for `events` after a commit to `content` is dropped. This holds for targets a response brings
without the request naming them.

While a request is queued or in flight, its targets carry `aria-busy="true"` (a region or a
component on its element; for `page`, `<body>`), and the element
that started it carries `data-loading`. Both go when the last request holding them settles. A
server need do nothing for any of this, beyond rendering targets fresh on every request.

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
Tessera-Protocol: 2
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
| `morph` | the whole target as the page would render it | Exactly one element, carrying `data-region` with the target's name and the same tag as the live region element. Its attributes and children are morphed into the live region element. | Exactly one element, carrying `data-t-c` with the target's key and the same tag as the live component element. Its attributes (`data-t-props` included) and children are morphed into the live component element. |
| `inner` | the target's new children | The children are morphed; the element's own attributes stay. | The children are morphed; the element's own attributes, its props among them, stay. |
| `append` | nodes to add | Added after the last child. | Added after the last child. |
| `prepend` | nodes to add | Added before the first child. | Added before the first child. |
| `remove` | nothing (whitespace only) | The region element is removed. | The component element is removed. |

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
Tessera-Protocol: 2
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout
```

- A server layer must turn every `301`, `302` and `303` it would send to a Tessera request into
  `200` with `Tessera-Location` set to the same URL and an empty body. A plain request still gets
  the real redirect. One middleware at the edge of the server layer can do it for every route.
- The value is a URL, absolute or relative to the request's URL, as in `Location`.
- Tessera follows it with a fresh GET: a `visit` with the original request's `Tessera-Targets`.
  The body of the original request is never sent again. A same-origin URL becomes an enhanced
  visit and its URL is pushed to history, unless the link or form opted out with
  `data-push="off"` (section 3); a URL on another origin becomes a full load.
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
| `Tessera-Protocol` | fragment responses, streams and the `400` of section 1; allowed on any response to a Tessera request | `1`; on a `400`, the versions the server speaks |
| `Tessera-Location` | in place of a `301`, `302` or `303` | a URL |
| `Tessera-Full-Visit` | any status | a URL |
| `Tessera-Stream-Pause` | a stream | `hidden` |
| `Vary` | every response from a URL that answers Tessera requests | section 8 |

### 5.8 Repeated writes

Every write carries `Tessera-Write-Id`, a UUID Tessera makes for that submission. Submitting the
same form again is a new submission with a new id; a browser repeating the request by itself
(section 4.5) sends the same id. Interceptors cannot change or remove it.

A server that sees an id it has already seen:

- must not apply the write a second time;
- answers with the first answer again, when it still has it, or with `409` when it does not;
- keeps each id for at least five minutes. A browser repeats within seconds; the margin covers
  slow networks and proxies that hold a request;
- treats the id as untrusted input, like the rest of the request: it scopes ids to the session,
  so one user cannot collide with another's, and answers an id that is not 1 to 64 of
  `A-Z a-z 0-9 -` with `400`.

A request without the header (a plain form post, an older Tessera) is applied as before.

## 6. Status codes

| Status | What the server means | What Tessera does |
|---|---|---|
| `200` | Here is the result. | Commits the body: a full document, fragments, or `Tessera-Location`. A visit pushes its URL, unless it opted out (section 3). |
| `204` | Nothing changes. | Nothing: no commit, no history entry. A visit stays on the current page, as a browser does. A stream stops. |
| `301`, `302`, `303` | Look elsewhere. | Never seen from a server speaking the protocol (section 5.4). From a proxy: a read follows it; a write is reported as indeterminate. |
| `307`, `308` | Resend the request elsewhere. | A read follows it. A write is reported as indeterminate and never resent. |
| `400` with a `Tessera-Protocol` header not listing `1` | This server does not speak your version. | Full load (section 1). |
| `409`, `422` | The write was refused; here is why. | Commits the fragments in place: the form's region with its errors. No history entry; the URL stays. Focus goes to `data-error-summary`, else the first `aria-invalid="true"` field. |
| `419` | The page expired (the session or the CSRF token is stale). | Raises a "page expired" event (`tessera:expired`, cancelable, on the document). Its default prompt offers a reload of the current page. Nothing is resent. |
| other `4xx` with a recognized body | The request failed; here is the page or region to show (a `404` page, a `403` notice). | Commits it as for `200`. A visit pushes its URL, as the browser would show the error page at that URL, unless it opted out (section 3). |
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
Tessera-Protocol: 2
Tessera-Layout: app
Last-Event-ID: 1187
```

```
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store
Tessera-Protocol: 2
```

Behind nginx, also send `X-Accel-Buffering: no`, or events wait in nginx's buffer.

While the stream is open the server should write a comment line (`: keep-alive`) at least every
15 seconds, idle or not. Proxies close silent connections, and WebKit has been seen (Playwright's
Linux build, webkit-2336) to hold back the end of what it has received until more bytes arrive,
so the gap between writes bounds how late an event can reach a WebKit page. A server whose
events must reach WebKit promptly writes the comment more often; the reference server's tests use
250 ms.

With `Tessera-Stream-Pause: hidden`, Tessera closes the stream while the page is hidden and
reconnects, with `Last-Event-ID`, when it is visible again. Without it the stream stays open.

### 7.2 Events

The framing is standard SSE (WHATWG HTML, "Server-sent events"): `event:`, `data:`, `id:` and
`retry:` fields, `:` comments, a blank line ending each event. Every data line holds one key,
optionally a space and a value: `data: KEY VALUE`. Keys are case-sensitive; Tessera ignores keys
it does not know. An event needs at least one data line, or SSE drops it, and it ends with a
blank line: an event the body ends before its blank line is dropped, as the standard says. Lines
may end with LF, CRLF or CR, and a leading byte order mark is ignored.

**`tessera-patch-elements`**: one fragment.

| Data key | Required | Value |
|---|---|---|
| `target` | yes | the target (section 2.6), `page` included, or `@NAME` for an anchored component (section 2.7) |
| `mode` | no | `morph` (default), `inner`, `append`, `prepend` or `remove` |
| `elements` | for every mode but `remove` | one line of the markup; repeat the key for each line, and Tessera joins the values with a line feed |

The markup is what a fragment response's `<template>` would hold for the same target and mode
(section 5.3). For the `page` target it is a full document, the mode must be `morph`, and Tessera
commits it as a whole-document visit.

```
event: tessera-patch-elements
id: 1188
data: target content/orders/order-42
data: elements <li data-t-c="order-42" data-t-props="eyJpZCI6NDJ9.Pq1">
data: elements Order 42: <strong>shipped</strong>
data: elements </li>

```

**`tessera-patch-signals`**: one signal patch.

| Data key | Required | Value |
|---|---|---|
| `scope` | yes | the target whose scope receives the patch, or `@NAME`; `page` is the document scope |
| `onlyIfMissing` | no | `true` to set only signals that do not exist yet |
| `signals` | yes | strict JSON, an object; repeat the key for a multi-line object, joined with a line feed |

```
event: tessera-patch-signals
data: scope page
data: signals {"unread":4}

```

A `target` or `scope` of `@NAME` names the component carrying `data-t-anchor="NAME"`. Tessera
resolves it when the event arrives, against the page as it is then, and the event commits as one
naming that component's path. A name that is badly spelled, that no element carries, that two
elements carry, or that sits on an element without `data-t-c` is reported, and the event is
dropped as one for a missing target is. So a stream can update a keyed component nested in
another component's template, whose path moves when a wrapper or an order changes, without
spelling the path:

```
event: tessera-patch-elements
data: target @bell
data: elements <span data-t-c="Bell.2:count" data-t-anchor="bell"><b>3</b></span>

```

**`tessera-close`**: the stream is finished. Tessera stops and does not reconnect. The data lines
are ignored, but one is required: `data: reason done`.

Events with other names change nothing on the page. Every event, whatever its name, reaches the
listeners a page registered for the stream through the API, after Tessera has applied it.

Each `tessera-patch-elements` event commits in its own render transaction, in the order it
arrives, under the same target checks as a fragment response, except that a stream never causes a
full load for a missing target: the event is dropped and reported. A `page` event whose tracked
assets changed does cause a full load of the current page. An event is never stale, since it is
the newest word on its target; a commit from it counts as a touch of that target (section 4.6),
so the answer to a request sent before it and still in flight drops its fragment for that target
or for a target inside it, and keeps its fragment for a target around it.

### 7.3 Ids, `retry` and reconnecting

- `id:` sets the stream's last event id, as the SSE standard says; an id containing NUL is
  ignored. The server should give an id to every event it could replay.
- `retry:` (digits only) sets the reconnect delay in milliseconds. The default is 1,000.
- When the connection drops or the body ends without `tessera-close`, Tessera waits the delay and
  reconnects with `Last-Event-ID` (left out until the stream has set an id). Each failed attempt
  in a row doubles the delay (from at least 100 ms), up to 30 seconds; an event arriving resets
  it.
- The server resumes after the event named by `Last-Event-ID`, so the page sees each event once.
  A server that cannot resume (the id is too old) sends the current state of everything the
  stream covers, as fragments, so a missed change is never silent.
- Tessera stops for good on `tessera-close`, on a `204`, when the last element naming the stream
  leaves the page, on a `401`, `403`, `404` or `410` (reported), on any other status that is not
  `200` (reported), and on a `200` that is not `text/event-stream` (reported). A `419` raises the
  "page expired" event and stops. A stream without `Tessera-Protocol: 2`, or a `400` naming other
  versions, does a full load of the current page (section 1). A `429`, a `5xx` or a network
  failure is retried with the backoff above.
- The last element leaving stops the stream one task later, so a render that replaces an element
  with one naming the same stream keeps the connection. An element whose stream stopped for good
  does not reopen it while it stays on the page with the same `data-stream`; a new element naming
  the URL opens a new connection.

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
- A prefetch is the visit's own request, sent early: the visit with the same URL, targets and
  layout takes its answer once, within 30 seconds, and at most 8 wait at once. A prefetch made by
  a press (mousedown) is the click's own request, so its answer is used whatever its
  `Cache-Control`. A prefetch made by a hover can wait longer, so its answer is not used when it
  says `no-store`, and that visit sends its request again; `data-prefetch="off"` avoids the
  second request.

## 9. Head and assets

**On a whole-document visit** (a `text/html` response, or a `page` stream event), in this order:

1. Tracked assets are compared. The set is every `<script src>` and `<link href>` in `<head>`
   with `data-track`, each identified by its tag, its resolved URL and its `data-track` value.
   If the incoming set differs from the current one in any way (an asset added, removed or
   changed), Tessera does a full load instead, before it changes anything. So does an incoming
   `<base href>` that differs from the current one.
2. Incoming head elements the current head lacks, compared by their markup, are added;
   stylesheets among them are loaded before the body changes, so the page does not flash
   unstyled. Current head elements the incoming head lacks are removed after the body commit.
   Scripts are never added and never run.
3. `<title>`, `<html lang dir>` and the `tessera-layout` and `tessera-csrf-token` metas take the
   incoming values.
4. The body is morphed in place. An element with `data-permanent` and an `id` stays the same live
   node, untouched, when the incoming body has an element with the same `id` and `data-permanent`;
   without one, it goes like any other.

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
  <header><a href="/cart">Cart (<span data-t-c="cart-count">3</span>)</a></header>
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
Tessera-Protocol: 2
Tessera-Targets: content
Tessera-Layout: app
```

The page at `/products/7` uses layout `app` and has a `content` region, so the server sends one
fragment:

```
HTTP/1.1 200 OK
Content-Type: text/vnd.tessera+html; charset=utf-8
Tessera-Protocol: 2
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
Tessera-Protocol: 2
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
Tessera-Protocol: 2
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout
```

Tessera follows it with a visit, without the body:

```
GET /cart HTTP/1.1
Accept: text/vnd.tessera+html, text/html;q=0.9
Tessera-Request: visit
Tessera-Protocol: 2
Tessera-Targets: content
Tessera-Layout: app
```

The server answers with `content` and, since the count changed, the header's component too:

```
HTTP/1.1 200 OK
Content-Type: text/vnd.tessera+html; charset=utf-8
Tessera-Protocol: 2
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout

<title>Cart · Shop</title>
<template data-target="content">
  <main data-region="content">
    <section data-t-c="cart" data-t-props="eyJjYXJ0IjoxOH0.c2ln">
      <p data-t-c="line-7" data-t-props="eyJsaW5lIjo3fQ.c2ln">Lamp × 1</p>
    </section>
  </main>
</template>
<template data-target="page/cart-count">
  <span data-t-c="cart-count">4</span>
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
Tessera-Protocol: 2
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
Tessera-Protocol: 2
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
Tessera-Protocol: 2
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout, Tessera-Signals

<template data-target="content/cart/line-7">
  <p data-t-c="line-7" data-t-props="eyJsaW5lIjo3fQ.c2ln">Lamp × 2</p>
</template>
<template data-target="page/cart-count">
  <span data-t-c="cart-count">5</span>
</template>
<script type="application/json" data-scope="content/cart/line-7">{"editing":false}</script>
```

Tessera morphs the line and the count, then sets `$editing` to `false` in the line's scope. The URL
and history do not change.

### 10.6 A component refresh, a poll, a lazy load

In `content`, `<div data-poll="/cart">` sits inside `content/cart`, which carries
`data-t-anchor="cart"`. Every 2 seconds:

```
GET /cart HTTP/1.1
Accept: text/vnd.tessera+html, text/html;q=0.9
Tessera-Request: refresh
Tessera-Protocol: 2
Tessera-Targets: content/cart eyJjYXJ0IjoxOH0.c2ln @cart
Tessera-Layout: app
```

The server may look the props up by the anchor `cart` (having checked that `content/cart` carries
it) or by the path; either names the same component.

When nothing changed the server answers `204` and Tessera does nothing. When the cart changed it
sends the component:

```
HTTP/1.1 200 OK
Content-Type: text/vnd.tessera+html; charset=utf-8
Tessera-Protocol: 2
Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout

<template data-target="content/cart">
  <section data-t-c="cart" data-t-props="eyJjYXJ0IjoxOH0.c2ln" data-t-anchor="cart">…</section>
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
carries `Tessera-Protocol: 1`; a server speaking only version 2 does nothing and answers
`400` with `Tessera-Protocol: 2`. Tessera does a full load, and the reloaded page brings the new
Tessera. The other way round, a page loading Tessera 0.3 from a server that still speaks only
version 1 gets `400` with `Tessera-Protocol: 1` on every enhanced request, and each one ends in a
full load.

## 11. Server checklist

A server layer speaks version 2 when it:

1. Renders regions with `data-region` and each component as one element carrying `data-t-c`,
   `data-t-props` when it has props and `data-t-anchor` when links name it, to the grammars of
   section 2, and gives a stable `id` to every field and other state-bearing element.
2. Signs props tokens, verifies them on every request that sends one, and keeps them small.
3. Renders the `tessera-layout` and `tessera-csrf-token` metas, and `data-track` on every script
   and stylesheet in `<head>`.
4. Detects a Tessera request by `Tessera-Request` and refuses a `Tessera-Protocol` it does not
   speak with `400`, before any side effect.
5. Answers a visit with fragments for the requested targets when the layout matches and every
   target exists, and with the full document otherwise.
6. Renders fragment responses as `text/vnd.tessera+html` with `Tessera-Protocol: 2`, one
   `<template>` per target, the `<title>`, the tracked-asset copies and any signal patches.
7. Authorizes every target it renders, and treats `Tessera-Targets` and `Tessera-Signals` as
   untrusted input.
8. Parses `Tessera-Targets` entries with an optional `@NAME` after the props token (section 4.3),
   and when it finds props by anchor, checks that the anchor is the one the target's component
   carries.
9. Turns every `301`, `302` and `303` for a Tessera request into `200` with `Tessera-Location`,
   and never sends `307` or `308` to a Tessera write.
10. Answers a refused write with `422` or `409` and the form's region with its errors,
    `data-error-summary` and `aria-invalid`.
11. Answers a stale session or CSRF token with `419`, and anything Tessera cannot update in place
    with `Tessera-Full-Visit`.
12. Sends `Vary: Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout` on every
    response from a URL that answers Tessera requests, plus `Tessera-Signals` when it reads them.
13. Serves streams as `text/event-stream` with `Cache-Control: no-store`, the three event names
    of section 7, ids on replayable events, resumption from `Last-Event-ID`, and `tessera-close`
    when finished. An event names a component by its path, or by `@NAME` when it carries an
    anchor.
14. Does the same work for a plain request, so a page with JavaScript off reaches the same results
    by full loads.
15. Applies a write carrying a `Tessera-Write-Id` it has seen within five minutes no more than
    once, answering the repeat with the first answer or `409` (section 5.8).

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

## 13. What a page can observe

Nothing here is on the wire: a server need not do anything for it, and the version stays 2. It
says what Tessera shows the page about each exchange, so a server knows what its own debug
headers reach.

- **`tessera:exchange`**, raised on the document, not cancelable, once for every exchange that
  settles: a visit, a submit, an action, a refresh, a poll, a lazy load, a prefetch, a stream's
  connection and each event a stream delivers. Its `detail` names the kind (with `poll`, `lazy`,
  `prefetch` and `stream-event` told apart from the `Tessera-Request` kinds of section 4.1), the
  URL, the method, the targets sent, the status, the media type, the bytes of the body Tessera
  read, the response headers, the time to the answer's headers and to settling, and the outcome.
  The headers are those fetch lets a page read: for a same-origin answer, every header but
  `Set-Cookie`. A server that adds its own header to an answer (a profile id, a timing) reaches a
  listener with no change to Tessera; an event carries its connection's status and headers, since
  an event has none of its own.
- **`tessera:patched`**, raised on each region or component element a fragment or a stream event
  patched, and on `<body>` for a whole document, after the change: `detail.target` as the answer
  named it (`page` for a whole document) and `detail.mode` (`morph`, `inner`, `append` or
  `prepend`). A `remove` raises none.
- **`<meta name="tessera-debug" content="highlight">`**: when the page carries it, each patched
  element holds `data-tessera-patched` for 600 ms. A server renders it only in development; a page
  without it gets nothing added.

`README.md` ("Devtools hooks") lists every field of the detail.
