# Handoff: moving Tessera to the Mac mini

Written 2026-10-21, when Chad paused the work to move it from the Z690 dev box to the Mac mini.
Read `CLAUDE.md` for the workflow, then `docs/design.md`, `docs/decisions.md` and
`docs/protocol.md`. This file says where things stand and what is specific to the move.

## What Tessera is

A browser runtime that AIC and Rustal share. The server sends HTML; Tessera morphs it into the
page one region or component at a time, over responses and Server-Sent Events, and keeps local
state in Datastar-style attributes with explicit scopes. The browser side has no framework names
in it. Servers speak the protocol in `docs/protocol.md` (version 1 since #33; Tessera 0.1.x speaks
version 0). The repo is private
(`Ignibyte/tessera`) and nothing from it goes into a public one.

## Released state

**v0.1.0** is published as a GitHub release on this repo (tag `v0.1.0` on `32f1773`). It holds
twelve files and `SHA256SUMS`. The driver and the agent each downloaded it and checked all twelve
sums.

- `tessera.js`, `tessera.min.js`, `tessera.iife.js`: the default build, with the trusted
  expression engine (needs `'unsafe-eval'`).
- `tessera.csp.js`, `tessera.csp.min.js`, `tessera.csp.iife.js`: the csp build, with the no-eval
  engine. `docs/consumers.md` recommends it to frameworks.
- A source map for each.

The public API is `start({ helpers })`, returning `{ signals, visit, intercept, stop }`. The IIFEs
start themselves unless the page renders `<meta name="tessera-start" content="manual">`; the ES
modules start nothing on import. `README.md` documents it, and `docs/consumers.md` says how a
framework pins, verifies and copies a release.

Size budgets (gzip, `size-budget.json`): the default build 35,514 bytes, measured 32,339; the csp
build 44,209, measured 40,190. Both were set to the measured size plus 10% (driver, #19). A later
ticket can lower them; `docs/decisions.md` says where the bytes go.

## What is open

- **Tickets:** none. #1 to #31 are closed (`bin/ticket.sh count` prints 0 open).
- **Branches:** none besides `main`; every feature branch was merged and deleted.
- **Pull requests:** none open.
- **Unreleased:** one entry under `## Unreleased` in `CHANGELOG.md`, #31. It changes tests and
  docs only, not the shipped files. The driver said to hold it for the next patch release and not
  to cut one yet.
- **Decisions:** `docs/decisions.md` has nothing under Open. Most entries are **Provisional**;
  Chad has not confirmed the two-build release (#19) or the public API (#19) yet.

## What was in progress

Nothing. The last instruction before the pause was to stand by: the Lotline site
(`/srv/stacks/lotline` on the dev box, read-only to the Tessera agent) will start using v0.1.0,
and any Tessera bug it finds arrives as a ticket here.

## The Mac mini

What #29 found and set up (details in `docs/decisions.md`, "The browser suite and the byte hold
on macOS"):

- macOS 27.0.1 on arm64, Node from Homebrew (`/opt/homebrew/bin`; 26.8.1 at #29), Safari 27.0.1.
  Reached from the dev box with `ssh macmini` (key-based; use `-o BatchMode=yes`).
- `~/scratch/tessera` is a working copy for test runs, kept on the driver's instruction. It is an
  export of `main` (`git archive`), **not a git checkout**: work on the Mac needs a real clone of
  `Ignibyte/tessera`. Check `gh auth status` there first; the dev box had the GitHub access.
- Its browsers live in `~/scratch/tessera/.browsers`. Always set
  `PLAYWRIGHT_BROWSERS_PATH=$HOME/scratch/tessera/.browsers` (or a path of the new clone's own)
  so the Mac's existing Playwright install in `~/Library/Caches/ms-playwright` is never touched.
- The Mac runs its own Playwright services under launchd (`playwright-mcp` on port 3100,
  `run-server` on 3101 and 3105). They are not Tessera's: do not stop, restart or edit them, and
  never use `sudo`.
- To refresh the scratch copy from the dev box: extract `git archive HEAD` into an empty
  directory, then `rsync -a --delete` it to `macmini:scratch/tessera/`, excluding `node_modules`,
  `.browsers`, `dist`, `test-results`, `playwright-report` and `*.log`.

## Build and test

Node 24 or later; `npm ci` installs the pinned toolchain. Run one command at a time, and **judge
each by its exit code, never by piped output** (redirect to a log, test `$?`, then read the
tail).

| Command | What it does |
|---|---|
| `npm run check` | typecheck, lint, unit and property tests, build, size; the gate for every change |
| `npm run build` | the six files in `dist/`, each with a source map |
| `npm run sums` | `dist/SHA256SUMS` over the twelve release files |
| `npm run test:browser` | Playwright against the reference server, Chromium and Firefox; `npm run build` first |
| `TESSERA_WEBKIT=1 npx playwright test` | adds WebKit on a machine that runs it natively, **the Mac**: the whole suite in three engines, 321 tests at #31 |
| `npm run test:browser:webkit` | WebKit from the pinned Playwright Docker image; the dev box needs it because Arch lacks WebKit's libraries. On the Mac use `TESSERA_WEBKIT=1` instead |
| `npx playwright test --config playwright.probes.config.ts` | the probes, never run with the suite: today the byte-hold probe (`test/probes/byte-hold.spec.ts`; `PROBE_RUNS`, `PROBE_BEAT`) |

The last full results, at #31: `npm run check` passed; Chromium and Firefox 214 of 214 on the
dev box; WebKit in the image 107 of 107; on the Mac 321 of 321 in all three engines.

Playwright starts and stops the reference servers itself. A server started by hand
(`node test/server/main.ts --port N`) must be stopped before the session ends.

## Safari on the Mac

Playwright cannot drive Safari, so the suite does not run there. Remote automation is already
enabled on the Mac, so `safaridriver` works without `sudo`; #29 used it for the byte-hold probe
(0 holds in 10,000 runs). Starting a session opens Safari on the Mac's desktop, so quit Safari
afterwards if it was not running before.

```bash
cd <clone>
node test/server/main.ts --port 47314 --close-connections </dev/null > probe-server.log 2>&1 & server=$!
safaridriver -p 47313 </dev/null > safaridriver.log 2>&1 & driver=$!
sleep 3
node safari-probe.ts http://127.0.0.1:47313 http://127.0.0.1:47314 2000 none   # or a beat in ms
kill $driver $server; wait
osascript -e 'tell application "Safari" to quit'
```

Over a non-interactive `ssh`, start `safaridriver` exactly like that (stdin from `/dev/null`, in
the background of the same command); started from a subshell it exited at once. The probe script
was a scratch file and is not in the repo; it is the byte-hold probe over the WebDriver protocol:

```ts
// safari-probe.ts: test/probes/byte-hold.spec.ts in real Safari over WebDriver.
const [driver, base, runsArg, beatArg] = process.argv.slice(2);
const runs = Number(runsArg ?? "1000");
const beat = beatArg === undefined || beatArg === "none" ? undefined : Number(beatArg);

async function call(method: string, path: string, body?: unknown): Promise<{ value: unknown }> {
  const response = await fetch(`${driver}${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = (await response.json()) as { value: unknown };
  if (!response.ok) throw new Error(JSON.stringify(json));
  return json;
}

const session = (await call("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } })).value as { sessionId: string; capabilities: { browserVersion: string } };
const id = session.sessionId;
try {
  await call("POST", `/session/${id}/timeouts`, { script: runs * 2000 + 30_000 });
  await call("POST", `/session/${id}/url`, { url: `${base}/navigation/text` });
  const script = `
    const [runs, beat, done] = arguments;
    (async () => {
      const results = [];
      for (let run = 0; run < runs; run++) {
        const controller = new AbortController();
        const start = performance.now();
        const timer = setTimeout(() => controller.abort(), 1500);
        let text = "", bytes = 0;
        try {
          const query = beat === null ? "" : "&beat=" + beat;
          const response = await fetch("/events/stream?probe=" + run + query, { signal: controller.signal, cache: "no-store" });
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (!text.includes('"received":3')) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            text += decoder.decode(value, { stream: true });
          }
        } catch {}
        clearTimeout(timer);
        controller.abort();
        const events = text.split("\\n").filter((line) => line.startsWith("event:")).length;
        results.push({ complete: text.includes('"received":3'), bytes, events, ms: Math.round(performance.now() - start) });
      }
      done(results);
    })();`;
  const results = (await call("POST", `/session/${id}/execute/async`, { script, args: [runs, beat ?? null] })).value as { complete: boolean; bytes: number; events: number; ms: number }[];
  const held = results.filter((run) => !run.complete);
  const late = beat === undefined ? [] : results.filter((run) => run.complete && run.ms >= beat * 0.8);
  console.log(`safari ${session.capabilities.browserVersion}: ${String(held.length)} of ${String(results.length)} runs held` + (beat === undefined ? "" : `; ${String(late.length)} completed at or after ${String(beat * 0.8)} ms`));
} finally {
  await call("DELETE", `/session/${id}`);
}
```

## Releasing

`RELEASING.md` is the procedure: bump the version (`npm version <v> --no-git-tag-version` and
`src/version.ts`), rename `## Unreleased` in `CHANGELOG.md`, run the gates, merge, then on `main`
`npm ci`, `npm run build`, `npm run sums`, `sha256sum -c`, tag, `gh release create` with the
twelve files and `SHA256SUMS`, and finally `gh release download` into an empty directory and
`sha256sum -c` again. On the Mac, `sha256sum` may be missing; `shasum -a 256 -c SHA256SUMS`
reads the same file. The WebKit gate there is `TESSERA_WEBKIT=1 npx playwright test`, not the
Docker script.

## Things the move changes

- `CLAUDE.md` names dev-box paths: the jqstar reference at `/srv/stacks/jqstar` (read-only, at
  `f17952b` of `Ignibyte/jqstar`), AIC at `/srv/stacks/aic-nextgen` (never touched), and Chromium
  in `~/.cache/ms-playwright`. On the Mac those paths differ; clone jqstar read-only at that
  commit if a ticket needs to port from it, and update `CLAUDE.md` in its own commit.
- `bin/agent-loop.sh` runs `claude -p` sessions in tmux; check that `claude` and `tmux` are on the
  Mac's `PATH` before using it.
- The dev box's agent memory and the driver's session do not move with the repo. This file and
  `docs/decisions.md` carry what a new session needs.

## Next steps

1. On the Mac: clone `Ignibyte/tessera`, `npm ci`, install the browsers under a
   `PLAYWRIGHT_BROWSERS_PATH` of the clone's own, and run `npm run check` and
   `TESSERA_WEBKIT=1 npx playwright test`. Expect 321 passing.
2. Adjust `CLAUDE.md` for the Mac's paths, as above.
3. Wait for Lotline: bugs it finds in v0.1.0 come in as tickets here, worked one at a time
   through `CLAUDE.md`'s workflow.
4. Cut 0.1.1 only when the driver or Chad asks; it would carry #31's test change and whatever the
   Lotline tickets fix.
5. Ask Chad to confirm the Provisional decisions, starting with #19's two builds and public API,
   since frameworks now depend on them.
6. Later, optional: lower the size budgets (a ticket that shortens error messages and removes
   duplication across modules).
