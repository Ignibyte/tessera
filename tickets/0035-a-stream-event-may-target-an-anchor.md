---
number: 35
uuid: a52b8d45-f915-4487-b872-230e09c6713f
title: "A stream event may target an anchor"
type: feature
status: open
tags: ["protocol","anchors","streams"]
created: 2026-10-29T07:29:51Z
updated: 2026-10-29T07:29:51Z
---

Driver (AIC), for aic-demo run 19 (a live bell in the page header): a tessera-patch-elements event names its target as a path, and transport.commitStream() looks it up with findTarget(), which takes paths only. A keyed component inside another component's template sits at a positional path (header/bell/Bell.2:count), which moves when a wrapper or an order changes, and AIC's gate refuses spelling such paths in app code. Links, forms, polls and actions already take @NAME (section 2.7). Let a stream event's target be @NAME too: commitStream resolves it with resolveAnchors() against the live page at commit time, then patches as now; a name that does not resolve (missing, doubled, not on a component) is reported and the event dropped, like a missing path today. The same for a signal-scope target if one exists. Wire: no version change, since a server pins its client and this widens only what an event may name; record that as a decision (Provisional). Update docs/protocol.md (the stream events section, 2.7's list of where @NAME is accepted, 11's server checklist), docs/consumers.md and decisions.md. Done: unit tests for commitStream with @NAME (found, missing, doubled, on a non-component), a browser test where a stream patches an anchored component nested in another component's template by @NAME; npm run check and test:browser pass; CHANGELOG under Unreleased. Release as 0.3.1 per RELEASING.md once merged (the driver confirms before the release).
