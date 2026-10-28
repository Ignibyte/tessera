---
number: 34
uuid: c226988e-5d24-422b-8225-916eb874bc35
title: "Protocol 2: a target entry carries its component's anchor"
type: feature
status: open
tags: ["protocol","anchors"]
created: 2026-10-28T02:49:56Z
updated: 2026-10-28T02:49:56Z
---

Driver (AIC), for AIC #194, Chad's choice 2026-10-27: Tessera sends the anchor.

Why: a server reads a component's props by the target it names (AIC: TesseraProps::forTarget(request, 'content/stock-list')). A keyed component nested inside another component's template sits at a positional path (content/c0/Panel.1:live), which moves when a wrapper or an order changes, and AIC's gate now refuses spelling such paths in app code. If Tessera says which anchor an entry is for, the server finds the props by anchor and never spells the path.

Wire (protocol 2): `entry = target [ SP props ] [ SP "@" anchor ]`. Tessera adds `@NAME` to an entry whenever the target component's element carries `data-t-anchor="NAME"` (section 2.7), however it was targeted: a `data-target="@NAME"` link or form, a poll, lazy load or refresh whose element sits in that component, or an action. Regions, `page` and unanchored components send no anchor. `@` cannot occur in a props token, so the third token is unambiguous; an anchored component without props sends `target @NAME`.

Version: an existing protocol 1 server would read `@NAME` as a props token (AIC refuses it as altered), so this is version 2 (section 1): every request carries `Tessera-Protocol: 2`; fragments and streams must carry `Tessera-Protocol: 2`. Everything else as in version 1. Update section 1 (versions, what changed), 4.3 (grammar, examples, the line saying the header never holds an anchor), 2.7 (anchors are also sent in entries), 11 (server checklist), the worked examples that show anchored targets, docs/consumers.md (what a server speaking 2 does), decisions.md.

Done: unit and property tests for the entry grammar (with and without props, several entries), browser tests that a @NAME link, a poll inside an anchored component and an action send the anchor; npm run check and test:browser pass; CHANGELOG under Unreleased. Release as 0.3.0 per RELEASING.md once merged (the driver confirms before the release).
