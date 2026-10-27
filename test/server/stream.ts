// The reference server's stream, `/events/stream` (docs/protocol.md, section 7): step `k`
// prepends `<li>Event k</li>` to region `events` with id `k`, then morphs component
// `content/latest` and patches the document's `received` signal. Query parameters shape it for
// tests: `count` (steps, default 3), `interval` (ms between steps, default 0), `retry` (the
// reconnect delay sent first, default 1000), `end` (`open` keeps the connection, `drop` ends the
// body without `tessera-close`, `close` sends it), `pause=hidden`, `drop=K` (destroy a first
// connection after step K), `key` (log each connection under it) and `beat` (ms between keep-alive
// comments, default 15000). WebKit can hold the end of what it has received until more bytes
// arrive (#27), so the comments also bound how late an event can be there.
import type { ServerResponse } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { renderPage } from "./html.ts";
import { header, PROTOCOL, send, text, VARY } from "./http.ts";
import type { FixtureRequest, Secrets, ServerState, StreamConnection } from "./http.ts";

interface StreamOptions {
  count: number;
  interval: number;
  retry: number;
  end: "open" | "drop" | "close";
  pause: boolean;
  /** Destroy a connection without `Last-Event-ID` after this step. */
  drop: number | undefined;
  /** Milliseconds between keep-alive comments, for the whole connection. */
  beat: number;
}

function integer(value: string | null, fallback: number, max: number): number | undefined {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return number <= max ? number : undefined;
}

function options(url: URL): StreamOptions | string {
  const query = url.searchParams;
  const count = integer(query.get("count"), 3, 1000);
  const interval = integer(query.get("interval"), 0, 10_000);
  const retry = integer(query.get("retry"), 1000, 60_000);
  const end = query.get("end") ?? "open";
  const pause = query.get("pause");
  const drop = query.get("drop") === null ? undefined : integer(query.get("drop"), 0, 1000);
  const beat = integer(query.get("beat"), 15_000, 60_000);
  if (count === undefined) return "count must be an integer from 0 to 1000";
  if (interval === undefined) return "interval must be an integer from 0 to 10000";
  if (retry === undefined) return "retry must be an integer from 0 to 60000";
  if (end !== "open" && end !== "drop" && end !== "close") return "end must be open, drop or close";
  if (pause !== null && pause !== "hidden") return "pause must be hidden";
  if (query.get("drop") !== null && drop === undefined) return "drop must be an integer from 0 to 1000";
  if (beat === undefined || beat < 100) return "beat must be an integer from 100 to 60000";
  return { count, interval, retry, end, pause: pause !== null, drop, beat };
}

/** One SSE event; each line of `data` becomes a `data:` line. */
export function sseEvent(name: string, id: string | undefined, data: readonly string[]): string {
  const idLine = id === undefined ? "" : `id: ${id}\n`;
  return `event: ${name}\n${idLine}${data.map((line) => `data: ${line}\n`).join("")}\n`;
}

function item(k: number): string {
  return `<li>Event ${k}</li>`;
}

/** The component and the signal after step `k`; they carry no id. */
function latest(k: number): string {
  return (
    sseEvent("tessera-patch-elements", undefined, ["target content/latest", `elements <div data-t-c="latest"><p id="latest">Latest: ${k}</p></div>`]) +
    sseEvent("tessera-patch-signals", undefined, ["scope page", `signals {"received":${k}}`])
  );
}

/** Step `k`: the list item with id `k`, then the component and the signal. */
function step(k: number): string {
  return sseEvent("tessera-patch-elements", String(k), ["target events", "mode prepend", `elements ${item(k)}`]) + latest(k);
}

/** The `events` region holding events `count` down to 1, as the page would render it now. */
function currentState(request: FixtureRequest, count: number, secrets: Secrets): string {
  const items = Array.from({ length: count }, (_, index) => item(count - index)).join("");
  const stream = `${request.url.pathname}${request.url.search}`;
  const rendered = renderPage("events", { csrf: secrets.csrf, stream, items, latest: String(count) }, secrets.key);
  const region = rendered.identities.byTarget.get("events");
  if (!region) throw new Error("pages/events.html has no events region");
  return rendered.html.slice(region.start, region.end);
}

export async function serveStream(
  request: FixtureRequest,
  res: ServerResponse,
  secrets: ServerState,
): Promise<void> {
  if (request.method !== "GET") {
    send(res, { ...text(405, "Streams are GET only."), headers: { Allow: "GET" } });
    return;
  }
  const parsed = options(request.url);
  if (typeof parsed === "string") {
    send(res, text(400, parsed));
    return;
  }
  const { count, interval, retry, end, pause, drop, beat } = parsed;

  // Resume after a numeric id this stream issued; any other id cannot be resumed, so the
  // stream sends the current state instead (section 7.3).
  const last = header(request.headers, "last-event-id");
  let next = 1;
  let snapshot = false;
  if (last !== undefined) {
    if (/^\d+$/.test(last) && Number(last) <= count) next = Number(last) + 1;
    else snapshot = true;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "Tessera-Protocol": PROTOCOL,
    "X-Accel-Buffering": "no",
    Vary: VARY,
    ...(pause ? { "Tessera-Stream-Pause": "hidden" } : {}),
  });
  res.flushHeaders();

  const key = request.url.searchParams.get("key");
  const connection: StreamConnection | undefined = key === null ? undefined : { key, lastEventId: last ?? null, closed: false };
  if (connection) secrets.streams.push(connection);
  const closed = new AbortController();
  res.on("close", () => {
    if (connection) connection.closed = true;
    closed.abort();
  });
  const { signal } = closed;
  const beats = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, beat);
  res.on("close", () => {
    clearInterval(beats);
  });

  try {
    res.write(`retry: ${retry}\n\n`);
    if (snapshot) {
      const markup = currentState(request, count, secrets).split("\n");
      res.write(
        sseEvent("tessera-patch-elements", String(count), [
          "target events",
          ...markup.map((line) => `elements ${line}`),
        ]) + latest(count),
      );
      next = count + 1;
    }
    for (let k = next; k <= count; k++) {
      if (interval > 0) await sleep(interval, undefined, { signal });
      res.write(step(k));
      if (k === drop && last === undefined) {
        // Let the step reach the client before the connection goes. A comment after it releases
        // what WebKit may hold back of it (#27).
        await sleep(50, undefined, { signal });
        res.write(": dropping\n\n");
        await sleep(50, undefined, { signal });
        res.socket?.destroy();
        return;
      }
    }
    if (end === "close") {
      res.end(sseEvent("tessera-close", undefined, ["reason done"]));
      return;
    }
    if (end === "drop") {
      res.end();
      return;
    }
    // Open: the keep-alive comments go on until the client goes away.
    if (!signal.aborted) {
      await new Promise((resolve) => {
        signal.addEventListener("abort", resolve, { once: true });
      });
    }
  } catch (error) {
    // The client went away during a sleep; anything else is a fault in the server.
    if (!signal.aborted) throw error;
  } finally {
    clearInterval(beats);
  }
}
