---
number: 12
uuid: bdd19345-f071-4803-8b61-7b4e1bc607b5
title: "Region targeting and commit, with generations"
type: feature
status: done
tags: ["regions"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-21T00:08:29Z
phase: "docs"
closed: 2026-10-21T00:08:29Z
---

The concurrency model jqstar never built: jqstar 0028 AC-08 plus region generations (digest
section 7 and "Hardest parts" 2).

- Each region and component target carries a generation, bumped on every commit to it. A
  response commits only if its target's generation is the one recorded at dispatch; otherwise it
  is dropped and reported.
- The policy table for overlapping operations, frozen in `docs/protocol.md`: disjoint targets
  run side by side; the same target supersedes (a newer GET aborts an older GET) or queues (a
  write never aborts a write: the second waits or is refused, decide and document); an ancestor
  or descendant target queues behind or supersedes per the table. Polls yield to actions.
- A response that names a target which no longer exists (removed, retargeted) does nothing to the
  page and is reported.
- Per-target `aria-busy` and a `data-loading` attribute on the initiating element.

Acceptance: unit tests for every row of the table, and browser tests with the FIFO response
controller delivering responses out of order: a late response never overwrites a newer one, and
disjoint regions update independently.

## Comments

### 2026-10-21T00:02:21Z

Plan. jqstar 0028 AC-08 asks for a frozen reject/queue/supersede policy but never states it, so
this ticket writes it.

`src/coordination.ts`:
- `relation(a, b)` between two targets on the page: `same`, `inside` (a lies within b), `around`
  (a contains b) or `disjoint`, by DOM containment (a region by its element, a component by the
  run between its markers, `page` around everything). A request's targets combine pairwise.
- `decide(newer, older, relation)`, the table, over three classes of request: read (GET), write
  (anything else) and poll (a refresh from `data-poll`, #17):

  | older in flight or queued | newer read | newer write | newer poll |
  |---|---|---|---|
  | read, same or newer around | supersede | supersede | skip |
  | read, newer inside | queue | supersede | skip |
  | write, any overlap | queue | queue | skip |
  | poll, any overlap | supersede | supersede | skip |
  | disjoint | independent | independent | independent |

  Supersede aborts the older (never sent if still queued or in its 5 ms buffer). Queue waits for
  the older to settle, in arrival order, so writes to overlapping targets go one at a time and a
  write is never aborted (the "decide and document" of the ticket: the second write waits).
  Polls yield: one is skipped when anything overlapping is pending, and anything overlapping
  supersedes one in flight. Across several target pairs, queue wins over supersede.
- Generations as one commit sequence: each target node remembers the last commit that touched it
  (a commit to a target touches it, the targets around it and the targets inside it after the
  morph). A request records the sequence at dispatch; a fragment whose target was touched since
  is dropped and reported, so a late response never overwrites a newer one, including for
  targets the server sends unasked.

Changes to `src/transport.ts`: the #11 supersession is replaced by this; a `poll` input flag and
a `skipped` outcome; a followed `Tessera-Location` visit leaves the write's place first, so it
cannot queue behind its own write. A target missing at commit already does nothing and is
reported (#11). While a request is pending, its region targets carry `aria-busy="true"` (a
component's top-level elements do, `<body>` for the page; counted, so overlapping requests share
it) and the initiating element carries `data-loading`.

`docs/protocol.md`: a new section with the table, the generation rule and the busy attributes;
a Provisional decision for the choices (queue for a second write, a write superseding an
overlapping read, inner reads queuing behind outer ones).

Tests: `test/unit/coordination.test.ts` for every row of the table and for `relation` on regions,
components, nested regions and `page`; transport integration (two writes in order, read
supersession, an inner read queuing, polls skipped and superseded, a write aborting a read, a
stale fragment dropped, busy attributes set and cleared, a followed redirect not deadlocking).
Browser (`test/browser/coordination.spec.ts`, a `/coordination` page, the controller delivering
out of order): a late read for a component is dropped after a write's response re-rendered that
component; two disjoint regions answered in reverse order both update.

### 2026-10-21T00:08:29Z

Delivered via PR #13 (32e2008). The overlap table frozen in protocol 4.6, generations as one commit sequence, aria-busy and data-loading.
