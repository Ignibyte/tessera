---
number: 12
uuid: bdd19345-f071-4803-8b61-7b4e1bc607b5
title: "Region targeting and commit, with generations"
type: feature
status: open
tags: ["regions"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
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
