# Tessera

A browser runtime for server-rendered sites. The server sends HTML; Tessera morphs it into the
page one region or one component at a time, over normal responses or Server-Sent Events, and
keeps local reactive state in HTML attributes (Datastar's vocabulary, with explicit scopes).

AIC and Rustal both use it. Each speaks the protocol in `docs/protocol.md` from its own server
side; nothing in the browser side knows which framework is behind it.

Status: being built, ticket by ticket (`tickets/`). Nothing is released yet.

- Design: `docs/design.md`
- Decisions: `docs/decisions.md`
- Protocol: `docs/protocol.md`, what a server must do to speak Tessera
- Research behind it: `docs/research/`

Tessera is built from parts of jqstar (MIT); see `NOTICE`.

## Working on Tessera

Node 24 or later. `npm ci` installs the pinned toolchain; Idiomorph is the one runtime
dependency, and the build bundles it.

| Script | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over `src/`, `test/`, `scripts/` and the configs |
| `npm run lint` | ESLint (typescript-eslint, strict type-checked), no warnings allowed |
| `npm run test` | Vitest: `test/unit/` and `test/property/` |
| `npm run build` | `dist/tessera.js` (ES module), `dist/tessera.min.js` (minified ES module) and `dist/tessera.iife.js` (minified, for a plain `<script>`; global `Tessera`), each with a source map |
| `npm run size` | gzip size of `dist/tessera.min.js` against `size-budget.json` |
| `npm run test:browser` | Playwright, headless, in Chromium and Firefox (WebKit with `TESSERA_WEBKIT=1` on a machine that has its libraries, see `docs/decisions.md`), against the reference server; run `npm run build` first |
| `npm run test:browser:webkit` | The browser tests in WebKit, which runs in the pinned Playwright Docker image while the runner and the reference server stay on the host; arguments go to `playwright test` (`npm run test:browser:webkit -- smoke.spec.ts`); needs Docker; run `npm run build` first |
| `npm run serve:test` | The reference server (`test/server/`) on a free port, for trying Tessera by hand; prints the URL |
| `npm run check` | typecheck, lint, test, build and size, in that order, stopping at the first failure |

`npm run check` is the gate every change passes. Lint also refuses what would weaken it:
`@ts-ignore`, `@ts-expect-error` outside `test/`, `eslint-disable` comments (inline config is
off, and the warning it raises fails lint), and skipped or focused Vitest tests. Playwright
refuses a focused test with `forbidOnly`. One rule is off for one file: `no-implied-eval` in
`src/expression.ts`, the trusted expression engine (`docs/decisions.md`).
