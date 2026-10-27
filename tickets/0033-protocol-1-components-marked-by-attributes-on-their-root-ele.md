---
number: 33
uuid: badf4141-f6b3-4355-9dc1-021717509bcd
title: "Protocol 1: components marked by attributes on their root element"
type: feature
status: open
tags: ["protocol","patch"]
created: 2026-10-27T13:01:41Z
updated: 2026-10-27T13:43:02Z
---

Chad, 2026-10-28: components are marked by data attributes, not comments. Protocol 0 spells a component <!--t:c KEY PROPS--> ... <!--/t:c--> and a block <!--t:b-->...<!--/t:b--> (decision 'Identity spelling', ticket #2). Protocol 1: a component is exactly one element carrying data-t-c="KEY" (and data-t-props="TOKEN" when it has props); its path is the data-t-c keys of its ancestors from the region (data-region) down, as before. A component may carry data-t-anchor="NAME"; a link, form or poll may target "@NAME", which the runtime resolves to that component's path from the DOM before it sends Tessera-Targets (an unknown or doubled anchor is an error). Blocks: decide in plan whether keyed morphing makes t:b unnecessary, or blocks become an attribute on an element. The runtime finds [data-t-c] by selector instead of walking comments; patch and scopes follow. Tessera-Protocol 1; 0 is refused with the versions spoken (400). docs/protocol.md, decisions.md, the reference server and the browser suite move to 1. Release 0.2.0.

## Comments

### 2026-10-27T13:43:02Z

Driver's decisions (2026-10-28, from Chad's "not in comments ... data attributes or something would make more sense"; AIC tickets #189 and #188 follow this release):

1. A component is exactly one element carrying data-t-c="KEY" (and data-t-props="TOKEN" when it has props). Key grammar, path spelling (region name or page, then the data-t-c keys of the enclosing components, outside in) and the 512-character cap stay as in protocol 0. A component that needs siblings is wrapped by its server (<tbody> for rows, <div> elsewhere); a component inside <h2> or <p> is a <span>.
2. Blocks are dropped. Tessera 0.1.x never treats t:b specially (patch.ts has no block logic; scopes.ts only skips them); they are passive comments Idiomorph aligns. Protocol 1 says a conditional that appears may shift its siblings in a morph, and a server keeps state-bearing elements (fields) id'd, which Idiomorph matches by id.
3. Anchors: a component may carry data-t-anchor="NAME" (NAME is a key-shaped name, unique on the page). Wherever Tessera reads a target from the page (data-target, data-poll, data-lazy, forms, the API), "@NAME" names the component with that anchor; the runtime resolves it to the component's path from the DOM before it sends Tessera-Targets. An unknown or doubled anchor is an error, reported as a bad target is today. The server never sees "@".
4. A component morph is Idiomorph on the component element itself (outerHTML, as a region is), so morphRange and the copies outside the range go; the fragment's <template data-target> holds exactly one element with that data-t-c. inner, append, prepend and remove act on the element's children (remove removes the element).
5. Tessera-Protocol: 1. A server that speaks only 0 is refused as a mismatched version today is (docs/protocol.md section 1). Release 0.2.0.
6. docs/protocol.md (sections 1, 2, 3, 4.3, 5.3, 10, 11), docs/decisions.md (supersede "Identity spelling"), README, the reference server's pages, unit tests and the browser suite move to protocol 1. npm run check, npm run test:browser and npm run test:browser:webkit all exit 0.
