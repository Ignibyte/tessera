---
number: 8
uuid: 5388d8bc-c160-4ac0-aa63-b230d93df4e9
title: "Signal scopes: component, region and document"
type: feature
status: in-progress
tags: ["signals"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T23:26:16Z
phase: "docs"
---

Make scopes explicit, the fix for the global-namespace collisions old AIC hit with Datastar (AIC
#423/#436; digest section 3, "Scopes versus the Datastar wire format").

- A component (its comment pair), a region (its element) and the document each own a scope.
  `data-signals` declares into the nearest scope; a name resolves innermost-first.
- Two components declaring `$open` keep separate values. A region-level signal is visible to its
  components; a document signal everywhere.
- A way to declare a signal into an outer scope deliberately (for example
  `data-signals__document`), named in `docs/protocol.md`.
- What a request sends: only the signals of the initiating element's scope chain, and never
  `_`-prefixed ones. Signals never carry application data (`docs/design.md`, "Signals").
- A scope is created and disposed with its component or region, through the kernel.
- Morphing a component keeps its scope when its key is unchanged and resets it when the key
  changes.

Acceptance: unit tests for resolution order, isolation of same-named signals in sibling
components, disposal on removal, kept versus reset scopes across a morph, and the request payload
holding only the scope chain.

## Comments

### 2026-10-20T23:15:09Z

Plan.

`src/scopes.ts`, new: `Scopes`, one per attributes mount.
- Owners: the document; a region (its element, `data-region`); a component (its opening
  comment, `<!--t:c KEY …-->`). An element's chain is found by walking up the DOM: at each level
  the node itself if it is a region, then every unmatched opening marker among its previous
  siblings, innermost first; block markers (`t:b`) are not scopes. The chain ends at the document.
- Each scope is a reactive object, created when a chain first reaches its owner and owned
  through the kernel (`kernel.own("service", "scope:…")`), so disposal releases it.
- Reading `$name` takes the innermost scope that has `name` (its `in` check is tracked, so a
  later inner declaration re-runs the effect). Writing goes to the scope that has the name, or
  else the nearest scope. `data-signals` declares into the nearest scope even when an outer one
  has the name: that is the shadowing, and how two components keep separate `$open`.
  `data-signals__region` and `data-signals__document` (already named in `docs/protocol.md`
  section 3) declare into the enclosing region's scope (the document's when there is none) or
  the document's. `data-computed` and `data-ref` declare into the nearest scope.
- Lifetime: a scope is disposed when its region element or opening comment leaves the document
  (a move within the page keeps it), and when a render removes it (the mount's `releaseTree`).
  A component scope remembers its key: if the opening comment's key changes (a morph rewrote
  it), the next lookup disposes the old scope and starts a new one. `transfer(from, to)` hands a
  scope to a new opening comment with the same key, for #9 when a morph replaces the marker
  node; a different key starts afresh.

The request payload, `scopes.payload(element)` and `encodeSignals(payload)`:
- Only the initiating element's chain; each name once, the innermost scope's value winning.
- Left out: names starting with `_` at any depth; computed signals (accessors: the server gets
  what they derive from); and every value JSON cannot carry faithfully: elements and other
  nodes (`data-ref`), functions, symbols, `undefined`, bigints, non-finite numbers, and class
  instances (`Date`, `Map`). In objects they are omitted; in arrays they become `null`, as
  `JSON.stringify` does. A cycle is an error naming the signal.
- `encodeSignals` writes compact JSON with every character above U+007E as `\u` escapes, and
  refuses more than 4,096 bytes with an error naming the size (protocol 4.4). The transport
  (#11) sends it.

Changes elsewhere: `src/attributes.ts` gives each element its chain as `signals` and releases
scopes with removed subtrees; the directive context gains `scope(level)`; `src/builtins.ts`
declares through it. `docs/protocol.md` 4.4 gains the exclusion rules above; `docs/decisions.md`
gets Provisional entries for the resolution and write rule, the payload rules and the
component-scope lifetime.

Tests: `test/unit/scopes.test.ts` for resolution order, sibling isolation, nested components at
one sibling level, the two modifiers, writes, disposal on removal and on a render, moves keeping
a scope, kept versus reset scopes across a morph (same marker, rewritten key, transferred
marker), and the payload holding only the chain with every exclusion.
`test/property/signals-payload.test.ts` (fixed seed): any value tree encodes to ASCII that
parses back to the payload, which holds only JSON values and no `_` names.
