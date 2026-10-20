# tickets/

One markdown file per ticket, named `NNNN-slug.md` (4-digit zero-padded number). There is no
server and no database: `bin/ticket.sh` is the interface, and the files are plain
markdown you can read, grep and edit by hand. The format and the tool come from AIC
; numbering starts at #1.

## File format

````markdown
---
number: 4
uuid: 3d29…
title: "Ticket title (JSON-encoded string, safe for colons and quotes)"
type: feature | bug | chore | spike | docs
status: open | in-progress | in-review | blocked | done | won-t-fix | abandoned | closed
phase: "plan"            # optional: plan, code, check, docs
tags: ["foundation","http"]
created: 2026-10-19T14:05:45Z
updated: 2026-10-19T14:05:45Z
closed: 2026-10-20T09:00:00Z   # present once status is terminal
---

Description body, plain markdown, written at create time.

## Comments

### 2026-10-19T15:00:00Z

Comment body. Append-only; `bin/ticket.sh comment` adds entries.
````

String frontmatter values (`title`, `phase`) are JSON-encoded, which is valid YAML. Decode them
with `jq -r .` by hand; `bin/ticket.sh` does it for you.

## CLI

```bash
bin/ticket.sh list                       # open, in-progress and in-review
bin/ticket.sh list --status all
bin/ticket.sh show 4
bin/ticket.sh next                       # lowest-numbered open ticket
bin/ticket.sh create --title "…" --type feature [--tags a,b] [--description "…"]
bin/ticket.sh update 4 --status in-progress --phase code
bin/ticket.sh comment 4 --body "…"       # or pipe the body on stdin
bin/ticket.sh close 4 [--as done] [--note "Delivered via PR #N …"]
```

## Conventions

- Statuses run `open` → `in-progress` → `done`, `won-t-fix`, `abandoned` or `closed`; `blocked`
  means it waits on Chad (the question is the last comment). The phase follows the workflow in
  `CLAUDE.md`: plan, code, check, docs.
- Every piece of work has a ticket. The branch name, the commit body and the PR
  cite it.
- History is append-only: never rewrite a closed ticket's description; corrections go in
  comments. Status and phase updates are fine.
- Ticket changes are committed to this repo: with the code on a ticket's branch, or straight to
  `main` as `chore(tickets): ...` when only tickets change.
