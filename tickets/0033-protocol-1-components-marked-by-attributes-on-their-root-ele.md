---
number: 33
uuid: badf4141-f6b3-4355-9dc1-021717509bcd
title: "Protocol 1: components marked by attributes on their root element"
type: feature
status: open
tags: ["protocol","patch"]
created: 2026-10-27T13:01:41Z
updated: 2026-10-27T13:01:41Z
---

Chad, 2026-10-28: components are marked by data attributes, not comments. Protocol 0 spells a component <!--t:c KEY PROPS--> ... <!--/t:c--> and a block <!--t:b-->...<!--/t:b--> (decision 'Identity spelling', ticket #2). Protocol 1: a component is exactly one element carrying data-t-c="KEY" (and data-t-props="TOKEN" when it has props); its path is the data-t-c keys of its ancestors from the region (data-region) down, as before. A component may carry data-t-anchor="NAME"; a link, form or poll may target "@NAME", which the runtime resolves to that component's path from the DOM before it sends Tessera-Targets (an unknown or doubled anchor is an error). Blocks: decide in plan whether keyed morphing makes t:b unnecessary, or blocks become an attribute on an element. The runtime finds [data-t-c] by selector instead of walking comments; patch and scopes follow. Tessera-Protocol 1; 0 is refused with the versions spoken (400). docs/protocol.md, decisions.md, the reference server and the browser suite move to 1. Release 0.2.0.
