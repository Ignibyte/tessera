---
number: 34
uuid: c226988e-5d24-422b-8225-916eb874bc35
title: "Protocol 2: a target entry carries its component's anchor"
type: feature
status: done
tags: ["protocol","anchors"]
created: 2026-10-28T02:49:56Z
updated: 2026-10-28T02:58:12Z
phase: "docs"
closed: 2026-10-28T02:58:12Z
---

Driver (AIC), for AIC #194, Chad's choice 2026-10-27: Tessera sends the anchor.

Why: a server reads a component's props by the target it names (AIC: TesseraProps::forTarget(request, 'content/stock-list')). A keyed component nested inside another component's template sits at a positional path (content/c0/Panel.1:live), which moves when a wrapper or an order changes, and AIC's gate now refuses spelling such paths in app code. If Tessera says which anchor an entry is for, the server finds the props by anchor and never spells the path.

Wire (protocol 2): `entry = target [ SP props ] [ SP "@" anchor ]`. Tessera adds `@NAME` to an entry whenever the target component's element carries `data-t-anchor="NAME"` (section 2.7), however it was targeted: a `data-target="@NAME"` link or form, a poll, lazy load or refresh whose element sits in that component, or an action. Regions, `page` and unanchored components send no anchor. `@` cannot occur in a props token, so the third token is unambiguous; an anchored component without props sends `target @NAME`.

Version: an existing protocol 1 server would read `@NAME` as a props token (AIC refuses it as altered), so this is version 2 (section 1): every request carries `Tessera-Protocol: 2`; fragments and streams must carry `Tessera-Protocol: 2`. Everything else as in version 1. Update section 1 (versions, what changed), 4.3 (grammar, examples, the line saying the header never holds an anchor), 2.7 (anchors are also sent in entries), 11 (server checklist), the worked examples that show anchored targets, docs/consumers.md (what a server speaking 2 does), decisions.md.

Done: unit and property tests for the entry grammar (with and without props, several entries), browser tests that a @NAME link, a poll inside an anchored component and an action send the anchor; npm run check and test:browser pass; CHANGELOG under Unreleased. Release as 0.3.0 per RELEASING.md once merged (the driver confirms before the release).

## Comments

### 2026-10-28T02:51:37Z

Plan.

Approach: the transport builds each `Tessera-Targets` entry from the target's element on the page, so it reads `data-t-anchor` there, the same way it reads `data-t-props`. That covers every way the component was targeted (`@NAME` resolved to its path, a poll, lazy load or refresh inside the component, an action's default or `target` option), since all of them reach the header as a path. `PROTOCOL` goes to `"2"`.

Files:
- `src/transport.ts`: the entry builder moves to a module-level `targetsHeader(document, targets)` (exported for tests) and appends ` @NAME` for a component element whose anchor is well-formed and unique on the page; `PROTOCOL = "2"`.
- Reference server (`test/server/`): speaks 2 only; `parseTargets` reads the optional `@NAME` third token (or second, without props); the scanner records each component's anchor, and `answer` refuses with 400 an entry whose anchor is not the one its target's component carries.
- Tests: `test/property/targets.test.ts` round-trips entries with and without props and anchors, several per header; `test/property/anchors.test.ts` checks that the header built from any random page parses back to each component's props and anchor; unit tests in `test/unit/transport.test.ts` (anchored without props, with props, several entries, refresh and action inside an anchored component, a malformed or doubled anchor left out) and the reference server's parser; the protocol version bumped wherever tests name `1`.
- Browser (`test/browser/anchors.spec.ts`): a `@hello` link, a poll inside the anchored greeting, and an action inside it each send `content/greeting TOKEN @hello`, and the reference server answers them with the fragment.
- Docs: `docs/protocol.md` sections 1, 2.7, 4.2, 4.3, 10 (an anchored poll in 10.6, version 2 in every example header), 11; `docs/consumers.md`; `docs/decisions.md`; `CHANGELOG.md` under Unreleased; `test/server/README.md`.

Decision (Provisional, the agent's): Tessera sends `@NAME` only when the anchor follows the key grammar (64 characters at most) and no other element carries it. A malformed or doubled anchor is the server's own rendering error and would make the entry ambiguous or break the header's grammar, so the entry goes without it rather than the request failing; targeting such an anchor by `@NAME` is still reported as before.

No release: the driver confirms 0.3.0 separately.

### 2026-10-28T02:58:12Z

Delivered via PR #38 (829d7a7). Tessera-Targets entries carry @NAME for anchored components; Tessera-Protocol is 2; release 0.3.0 left for the driver.
