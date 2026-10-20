# CLAUDE.md — Tessera

Tessera is the browser runtime AIC and Rustal share: server HTML morphed into the page one region
or component at a time, over responses and Server-Sent Events, with Datastar-style attributes for
local state. Read `docs/design.md` first, then `docs/decisions.md` and, once it exists,
`docs/protocol.md`.

The repo is private, `Ignibyte/tessera`. **Nothing from this repo goes into a public one.**

## How work runs here

An agent works the tickets in `tickets/` one at a time, usually started by `bin/agent-loop.sh` in
tmux, which hands it one ticket per session. Chad does not review PRs; he reads the tickets, the
PRs and `docs/decisions.md`. The workflow is light, but every step is required.

### 1. Pick

The ticket named in your prompt. With none named: an `in-progress` ticket first (a session that
stopped mid-ticket), else `bin/ticket.sh next`. Never work two tickets at once.

### 2. Plan

- Read the ticket, the docs it names, and the jqstar source it cites (`/srv/stacks/jqstar`,
  read-only, at `f17952b`).
- `bin/ticket.sh update <n> --status in-progress --phase plan`.
- Post the plan as a ticket comment (`bin/ticket.sh comment <n>`): the approach, the files, how
  each acceptance criterion will be shown, and any decision you take. A decision that changes the
  protocol, the public API or a decided item goes in `docs/decisions.md`; one Chad has not made
  is marked **Provisional** there.
- Do not wait for confirmation. Go on.

### 3. Code

- `git switch -c t<NNNN>-<slug> main` (for example `t0004-kernel`).
- `bin/ticket.sh update <n> --phase code`.
- Port from jqstar where the ticket says so: keep the logic, drop jQuery, cite the source file in
  the module's header comment.
- Tests go with the code: Vitest for units (`test/unit/`), fast-check for parsers and anything
  with an input grammar (`test/property/`, fixed seed), Playwright for browser behaviour
  (`test/browser/`, against the reference server once ticket #3 lands).

### 4. Check

- `bin/ticket.sh update <n> --phase check`.
- `npm run check` until it passes: typecheck, lint, unit and property tests, the build and the
  size budget. Then `npm run test:browser` when the ticket touches browser behaviour.
- **No suppressions and no lowered bars:** no `eslint-disable`, `@ts-ignore`,
  `@ts-expect-error` (outside a test proving a type error), `any` in the public API, skipped or
  focused tests, or loosened thresholds. Fix the source.
- A failure you cannot fix in this ticket: say so in a comment and either split it into a new
  ticket (`bin/ticket.sh create`) or mark the ticket blocked (step 6).

### 5. Deliver

- Update the docs the change touches: `docs/protocol.md` for anything on the wire, `README.md`
  for the public API, and an entry under `## Unreleased` in `CHANGELOG.md` citing the ticket.
- Commit with a Conventional Commits subject (at most 72 characters) ending `(#<n>)`, a body
  saying what and why, and `Ticket: #<n>`. Stage explicit paths, never `git add -A`.
- `git push -u origin <branch>`, `gh pr create` (body: what changed, the check output's last
  lines, the ticket), then `gh pr merge <PR> --squash --delete-branch --subject "<the commit subject>"`
  (without `--subject`, GitHub appends the PR number, which is not the ticket number), `git switch main`,
  `git pull --ff-only`. A merge refused right after the push: wait a few seconds and retry.
- Close the ticket on main: `bin/ticket.sh close <n> --note "Delivered via PR #<PR> (<hash>).
  <one line>."`, then commit `chore(tickets): close #<n>` and push to main. Ticket-only commits
  are the one thing that goes straight to main.

### 6. Blocked

When the ticket needs a decision only Chad can make, or something outside this repo is broken:
write the question as a ticket comment (what you need, the options, your recommendation),
`bin/ticket.sh update <n> --status blocked`, commit and push the ticket change to main, and end
the session. Leave a half-done branch pushed, with a draft PR naming what is left. The loop goes
on to the next ticket; a later ticket that depends on the blocked one is blocked too.

### End of a session

One ticket per session. End with three lines: what landed (PR and ticket), what failed or was
split off, what Chad should look at.

## Rules

- Work only in this repo. `/srv/stacks/jqstar` is read-only. Never touch AIC
  (`/srv/stacks/aic-nextgen`), the elephc compiler or any other checkout.
- Push only to `origin` (`Ignibyte/tessera`). Never publish to npm, never make the repo public,
  never open issues or PRs on other repositories.
- No secrets, keys, tokens or passwords in any file.
- Dependencies: dev dependencies as needed, pinned exactly in `package.json` and locked. Runtime
  dependencies: Idiomorph only, unless `docs/decisions.md` records another. Never install
  anything globally; `npx playwright install` for browser engines is fine.
- Browser tests run headless on this box. Chromium is in `~/.cache/ms-playwright`; Firefox and
  WebKit install with `npx playwright install firefox webkit`. If an engine cannot run on this
  box, record it in `docs/decisions.md` and run the others.
- Never walk `$HOME` or the whole filesystem; scope searches to this repo and jqstar. `grep` here
  is ugrep: use `grep -E` (BRE `\|` matches nothing).
- Long-running commands (a dev server) run in the background and are stopped before the session
  ends. Never leave a server on a port.
- The browser side stays generic: no AIC or Rustal names in `src/`. Examples in docs may show
  either framework's server side.
- Prose (docs, comments, commit messages, ticket comments) follows the `no-ai-slop` skill: plain,
  specific, no filler.

## Layout

- `src/` the runtime, TypeScript, strict.
- `test/unit`, `test/property`, `test/browser`, `test/server` (the reference server, ticket #3).
- `docs/` design, decisions, protocol, research digests.
- `tickets/` one file per ticket; `bin/ticket.sh` is the interface (format in
  `tickets/README.md`).
- `bin/agent-loop.sh` runs the backlog: one `claude -p` session per ticket. `touch .agent-stop`
  stops it after the current ticket.
- `dist/` build output, ignored; releases carry it.
