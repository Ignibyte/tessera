---
number: 18
uuid: 76ce9579-d569-469d-8afe-393eba637369
title: "The navigation matrix"
type: chore
status: open
tags: ["testing","navigation"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T22:58:26Z
---

Port jqstar's navigation acceptance fixture (`/srv/stacks/jqstar/test/fixtures/navigation-decision/`,
1,607 lines, 28 frozen scenarios each with a no-JS baseline) to the reference server and Tessera.

- Every scenario runs twice: JavaScript off (the baseline) and with Tessera; the final URL, the
  visible content, focus and history length must match the baseline unless the scenario says
  otherwise.
- All engines that run on this box.
- Scenarios the region model changes on purpose (fragments instead of documents) say how and why.

Acceptance: the matrix passes, and a deliberately broken Tessera (for example, following a
307 on a write) fails it; say in the PR that you tried.

## Comments

### 2026-10-20T22:58:26Z

Depends on #20 (WebKit in Docker).
