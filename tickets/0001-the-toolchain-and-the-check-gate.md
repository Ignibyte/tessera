---
number: 1
uuid: 3e8f9fcf-b79b-4298-b797-8ff1a76fc0e9
title: "The toolchain and the check gate"
type: chore
status: open
tags: ["foundation"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T18:00:00Z
---

Set up the TypeScript project every later ticket builds on.

- `package.json` at the root (private, `"type": "module"`), every dev dependency pinned exactly,
  `package-lock.json` committed. Start from jqstar's versions (`/srv/stacks/jqstar/package.json`):
  TypeScript, Vite, Vitest, fast-check, `@playwright/test`, ESLint (typescript-eslint, strict
  type-checked config). Idiomorph is the one runtime dependency.
- `tsconfig.json` strict: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `verbatimModuleSyntax`. Target ES2022, DOM lib.
- Vite library build from `src/index.ts`: `dist/tessera.js` (ES module), `dist/tessera.min.js`,
  source maps. An IIFE build too, so a page can load it with a plain `<script>` (global
  `Tessera`).
- Scripts: `typecheck`, `lint`, `test` (Vitest, unit and property), `build`, `size` (gzip size
  of `dist/tessera.min.js` against a budget in `size-budget.json`; start at 30 KB and lower it
  as the code settles), `test:browser` (Playwright), and `check` running typecheck, lint, test,
  build and size in that order and failing on the first failure.
- A placeholder `src/index.ts` exporting `version` so the pipeline has something to build, and
  one unit test.
- `.gitignore`: `node_modules/`, `dist/`, `test-results/`, `playwright-report/`, `.agent-stop`,
  `.agent-logs/`.
- `README.md` gains a "Working on Tessera" section: the scripts and what `check` runs.

Acceptance:
- `npm ci && npm run check` passes from a clean clone.
- A planted `// @ts-ignore` fails lint, a planted type error fails typecheck, and a failing test
  fails `check` (try each, then remove it; say in the PR that you did).
