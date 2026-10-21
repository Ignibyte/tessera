// Runs the browser tests in WebKit, which does not run on the dev box (docs/decisions.md), from
// the official Playwright image. The runner, the build and the reference servers stay on the
// host; only the browser runs in the container, served by playwright-core's run-server from the
// host's node_modules (mounted read-only) and reached over the host network, so the browser
// reaches the reference server at 127.0.0.1. Arguments go to `playwright test`. The container is
// removed when the run ends, fails or is interrupted.
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { imageFor, PLAYWRIGHT_IMAGE } from "./webkit-image.ts";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
const version = pkg.devDependencies["@playwright/test"] ?? "";

if (PLAYWRIGHT_IMAGE !== imageFor(version)) {
  console.error(`webkit: the image is ${PLAYWRIGHT_IMAGE}, but @playwright/test is ${version}.`);
  console.error(`webkit: set PLAYWRIGHT_IMAGE in scripts/webkit-image.ts to ${imageFor(version)}.`);
  process.exit(2);
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === "object") done(address.port);
        else fail(new Error("no port"));
      });
    });
  });
}

const port = await freePort();
const name = `tessera-webkit-${String(process.pid)}-${String(Date.now())}`;
let removed = false;
/** The test run, once it has started. */
const run: { child?: ChildProcess } = {};

/** Removes the container; safe to call more than once, and from an exit handler. */
function removeContainer(): void {
  if (removed) return;
  removed = true;
  spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
}

process.on("exit", removeContainer);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    removeContainer();
    // Playwright stops its reference servers on SIGINT (on SIGTERM it leaves them running), so the
    // run gets SIGINT whatever arrived here; the script exits when it does.
    if (run.child && run.child.exitCode === null) run.child.kill("SIGINT");
    else process.exit(130);
  });
}

const started = spawnSync(
  "docker",
  [
    "run",
    "--detach",
    "--rm",
    "--init",
    "--name",
    name,
    "--network",
    "host",
    "--user",
    "pwuser",
    "--volume",
    `${resolve(root, "node_modules")}:/deps:ro`,
    PLAYWRIGHT_IMAGE,
    "node",
    "/deps/playwright-core/cli.js",
    "run-server",
    "--port",
    String(port),
    "--host",
    "127.0.0.1",
  ],
  { encoding: "utf8" },
);
if (started.status !== 0) {
  console.error(`webkit: docker run failed:\n${started.stderr}`);
  process.exit(1);
}

// run-server prints "Listening on ws://…" once it accepts connections.
let listening = false;
for (let attempt = 0; attempt < 120 && !listening; attempt++) {
  const logs = spawnSync("docker", ["logs", name], { encoding: "utf8" });
  if (logs.status !== 0) {
    console.error(`webkit: the container stopped before listening:\n${logs.stderr}`);
    process.exit(1);
  }
  listening = `${logs.stdout}${logs.stderr}`.includes("Listening on");
  if (!listening) await sleep(250);
}
if (!listening) {
  console.error("webkit: run-server did not start within 30 seconds.");
  process.exit(1);
}

const child = spawn(resolve(root, "node_modules/.bin/playwright"), ["test", "--project=webkit", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, TESSERA_WEBKIT_ENDPOINT: `ws://127.0.0.1:${String(port)}/` },
});
run.child = child;
child.on("exit", (code, signal) => {
  removeContainer();
  process.exit(code ?? (signal === null ? 0 : 1));
});
