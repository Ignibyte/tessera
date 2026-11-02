---
number: 1
uuid: 3e8f9fcf-b79b-4298-b797-8ff1a76fc0e9
title: "The toolchain and the check gate"
type: chore
status: done
tags: ["foundation"]
created: 2026-10-20T18:00:00Z
updated: 2026-10-20T22:00:53Z
phase: "check"
closed: 2026-10-20T22:00:53Z
---

Set up the TypeScript project every later ticket builds on.

- `package.json` at the root (private, `"type": "module"`), every dev dependency pinned exactly,
  `package-lock.json` committed. Start from jqstar's versions (`../jqstar/package.json`):
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

## Comments

### 2026-10-20T21:56:48Z

Plan.

Approach: one TypeScript project at the root, versions taken from jqstar's lock file at f17952b (TypeScript 5.9.3, Vite 7.3.6, Vitest 4.1.11, fast-check 4.9.0, @playwright/test 1.62.1, ESLint 10.9.1 with @eslint/js 10.0.1 and typescript-eslint 8.68.0, jsdom 26.1.0, @types/node 24.13.3, globals 17.11.0), all pinned exactly. Idiomorph 0.7.4 is the one runtime dependency. Added beyond jqstar's list: @vitest/eslint-plugin, so skipped and focused tests fail lint.

Files:
- `package.json`, `package-lock.json`, `tsconfig.json` (the five strict flags from the ticket, plus `erasableSyntaxOnly` so the build scripts run under Node's type stripping).
- `eslint.config.js`: recommended plus strictTypeChecked; `noInlineConfig` so an `eslint-disable` comment is a warning and `--max-warnings=0` fails it; `ban-ts-comment` bans `@ts-ignore` everywhere and `@ts-expect-error` outside `test/`.
- `vitest.config.ts`: jsdom, `test/unit` and `test/property`, `allowOnly: false`.
- `scripts/build.ts`: three Vite library builds of `src/index.ts`: `dist/tessera.js` (ES), `dist/tessera.min.js` (ES, minified) and `dist/tessera.iife.js` (minified IIFE, global `Tessera`), each with a source map.
- `scripts/size.ts` and `size-budget.json` (30720 gzip bytes for `dist/tessera.min.js`).
- `scripts/check.ts`: runs typecheck, lint, test, build, size in order and stops at the first failure.
- `playwright.config.ts` (Chromium, headless, `forbidOnly`) and one browser test loading the IIFE build and reading `Tessera.version`; ticket #3 adds the server and the other engines.
- `src/index.ts` exporting `version`, `test/unit/version.test.ts`.
- README "Working on Tessera", CHANGELOG entry. `.gitignore` already has the six entries.

Acceptance: run `npm ci && npm run check` in a fresh clone of the branch; plant a `// @ts-ignore`, a type error and a failing test one at a time, record that each fails `check` at the expected step, then remove them. The PR says so.

Decision: the output file names, the IIFE file name in particular, go in `docs/decisions.md` as Provisional.

### 2026-10-20T22:00:53Z

Delivered via PR #1 (d0e7eb3). npm run check (typecheck, lint, test, build, size) passes from a clean clone, and planted @ts-ignore, type-error and failing-test changes each fail it.
