---
number: 8
uuid: 5388d8bc-c160-4ac0-aa63-b230d93df4e9
title: "Signal scopes: component, region and document"
type: feature
status: open
tags: ["signals"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
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
