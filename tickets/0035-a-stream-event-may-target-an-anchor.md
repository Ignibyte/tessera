---
number: 35
uuid: a52b8d45-f915-4487-b872-230e09c6713f
title: "A stream event may target an anchor"
type: feature
status: in-progress
tags: ["protocol","anchors","streams"]
created: 2026-10-29T07:29:51Z
updated: 2026-10-29T07:33:23Z
phase: "check"
---

Driver (AIC), for aic-demo run 19 (a live bell in the page header): a tessera-patch-elements event names its target as a path, and transport.commitStream() looks it up with findTarget(), which takes paths only. A keyed component inside another component's template sits at a positional path (header/bell/Bell.2:count), which moves when a wrapper or an order changes, and AIC's gate refuses spelling such paths in app code. Links, forms, polls and actions already take @NAME (section 2.7). Let a stream event's target be @NAME too: commitStream resolves it with resolveAnchors() against the live page at commit time, then patches as now; a name that does not resolve (missing, doubled, not on a component) is reported and the event dropped, like a missing path today. The same for a signal-scope target if one exists. Wire: no version change, since a server pins its client and this widens only what an event may name; record that as a decision (Provisional). Update docs/protocol.md (the stream events section, 2.7's list of where @NAME is accepted, 11's server checklist), docs/consumers.md and decisions.md. Done: unit tests for commitStream with @NAME (found, missing, doubled, on a non-component), a browser test where a stream patches an anchored component nested in another component's template by @NAME; npm run check and test:browser pass; CHANGELOG under Unreleased. Release as 0.3.1 per RELEASING.md once merged (the driver confirms before the release).

## Comments

### 2026-10-29T07:31:26Z

Plan.

Approach: transport.commitStream() resolves a target starting with @ through resolveAnchors() against the live page at commit time, then patches and touches the generations with the resolved path as now. A failed resolution (bad name, missing, doubled, not on a component) is reported as a TransportError naming the anchor and the reason, and the event is dropped, as a missing path is. A tessera-patch-signals event's scope gets the same: streams.ts resolves an @ scope with resolveAnchors() before patcher.patchSignals(); a failure is reported and the event changes nothing, as a missing scope path does today. Fragment responses and their signal patches stay path-only.

Files: src/transport.ts, src/streams.ts; test/unit/streams.test.ts (events by @NAME: found, missing, doubled, on a non-component, and a signal scope); test/server/pages/events.html and test/server/stream.ts (an anchored component Bell.2:count nested in component panel, morphed by "target @bell" on every step); test/browser/streams.spec.ts (the stream morphs the nested anchored component, nothing reported); docs/protocol.md (2.6, 2.7, 7.2, 11), docs/consumers.md, docs/decisions.md, CHANGELOG.md.

Acceptance: the unit tests above; the browser test; npm run check and npm run test:browser by exit code; CHANGELOG under Unreleased. Then 0.3.1 per RELEASING.md once the driver confirms.

Decision (Provisional, in decisions.md): no protocol version change. A server pins its client, and this widens only what a stream event may name; a 0.3.0 client drops and reports an @ event, never misapplies it.
