// Durable streams: a long-lived GET read as Server-Sent Events, one per URL per page, shared by the
// elements and handles that hold it (docs/protocol.md, section 7). jqstar only read one-shot
// event streams in a response (`src/protocol-datastar.ts`), parsing `id` and `retry` and using
// neither; the reconnect from `Last-Event-ID`, the backoff, the stops and the pause while hidden
// are built here. The transport sends each connection and commits each fragment, so the
// protocol's headers, interceptors and generations apply.
import { ERROR_EVENT } from "./attributes.ts";
import { leaseBody } from "./body.ts";
import type { Kernel } from "./kernel.ts";
import { resolveAnchors } from "./patch.ts";
import type { Patcher, PatchMode } from "./patch.ts";
import { dataFields, EventStreamParser } from "./sse.ts";
import type { StreamEvent } from "./sse.ts";
import type { Transport } from "./transport.ts";
import { isPlainRecord } from "./values.ts";

/**
 * `connecting` until an answer, `open` while the body is read, `waiting` for the backoff,
 * `paused` while the page is hidden, `closed` for good.
 */
export type StreamState = "connecting" | "open" | "waiting" | "paused" | "closed";

export interface StreamHandle {
  /** The stream's absolute URL. */
  readonly url: string;
  readonly state: StreamState;
  /** Lets go of the stream; it stops once nothing else holds it. Calling it twice does nothing. */
  close(): void;
}

export interface OpenOptions {
  /** Holds the stream as long as this element is on the page. */
  readonly element?: Element;
  /** Receives every event, after Tessera has applied it. */
  readonly onEvent?: (event: StreamEvent) => void;
}

export interface Streams {
  /** Opens the stream at `url`, or joins it when it is open already. */
  open(url: string, options?: OpenOptions): StreamHandle;
  /** The URLs of the streams open now. */
  urls(): string[];
}

export interface StreamsOptions {
  readonly kernel: Kernel;
  readonly transport: Transport;
  readonly patcher: Patcher;
  readonly report?: (error: unknown, url: string) => void;
  /** The reconnect delay until the stream sets one with `retry`. Default 1000 ms. */
  readonly delayMs?: number;
  /** The longest the backoff grows. Default 30000 ms. */
  readonly maxDelayMs?: number;
}

class StreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamError";
  }
}

interface Holder {
  readonly onEvent: ((event: StreamEvent) => void) | undefined;
}

type ReadEnd = "closed" | "ended" | "aborted";

class Channel {
  readonly url: string;
  readonly holders = new Set<Holder>();
  state: StreamState = "connecting";

  readonly #options: StreamsOptions;
  readonly #forget: () => void;
  readonly #releases: (() => void)[] = [];
  #lastEventId = "";
  #delay: number;
  #failures = 0;
  #pauseWhenHidden = false;
  #connection: AbortController | undefined;
  #wake: (() => void) | undefined;
  #grace: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  constructor(url: string, options: StreamsOptions, forget: () => void) {
    this.url = url;
    this.#options = options;
    this.#forget = forget;
    this.#delay = options.delayMs ?? 1000;
    const { kernel } = options;
    this.#releases.push(
      kernel.own("service", `stream:${url}`, () => {
        this.stop();
      }),
      kernel.listen(`stream:${url}:visibility`, kernel.document, "visibilitychange", () => {
        this.#visibilityChanged();
      }),
    );
    void this.#run().catch((error: unknown) => {
      this.report(error);
      this.stop();
    });
  }

  join(holder: Holder): void {
    clearTimeout(this.#grace);
    this.#grace = undefined;
    this.holders.add(holder);
  }

  /** The last holder leaving stops the stream one task later, so a swapped element keeps it. */
  leave(holder: Holder): void {
    this.holders.delete(holder);
    if (this.holders.size > 0 || this.#stopped) return;
    clearTimeout(this.#grace);
    this.#grace = setTimeout(() => {
      if (this.holders.size === 0) this.stop();
    }, 0);
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.state = "closed";
    clearTimeout(this.#grace);
    this.#forget();
    this.#connection?.abort(new DOMException("stopped", "AbortError"));
    this.#wake?.();
    for (const release of this.#releases.splice(0)) release();
  }

  report(error: unknown): void {
    if (this.#options.report) {
      this.#options.report(error, this.url);
      return;
    }
    const window = this.#options.kernel.window as Window & typeof globalThis;
    const event = new window.CustomEvent(ERROR_EVENT, { bubbles: true, cancelable: true, detail: { error, url: this.url } });
    if (this.#options.kernel.document.dispatchEvent(event)) window.console.error(error);
  }

  /** A method, not a field read, so a check after an `await` is not narrowed away. */
  #isStopped(): boolean {
    return this.#stopped;
  }

  get #hidden(): boolean {
    return this.#options.kernel.document.visibilityState === "hidden";
  }

  #visibilityChanged(): void {
    if (!this.#pauseWhenHidden) return;
    if (this.#hidden) this.#connection?.abort(new DOMException("hidden", "AbortError"));
    else if (this.state === "paused") this.#wake?.();
  }

  /** Waits `ms`, or until the page is visible when `ms` is undefined; `stop` ends either. */
  #wait(ms?: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = ms === undefined ? undefined : setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        resolve();
      }
      this.#wake = done;
    }).finally(() => {
      this.#wake = undefined;
    });
  }

  async #run(): Promise<void> {
    const { transport } = this.#options;
    const maxDelay = this.#options.maxDelayMs ?? 30_000;
    while (!this.#stopped) {
      if (this.#pauseWhenHidden && this.#hidden) {
        this.state = "paused";
        await this.#wait();
        continue;
      }
      this.state = "connecting";
      const connection = new AbortController();
      this.#connection = connection;
      let end: ReadEnd | "retry";
      try {
        const answer = await transport.connect(this.url, { lastEventId: this.#lastEventId, signal: connection.signal });
        if (answer.status === "stop") break;
        if (answer.status === "open") {
          this.#pauseWhenHidden = answer.pauseWhenHidden;
          this.state = "open";
          end = await this.#read(answer.response, connection);
        } else end = "retry";
      } catch (error) {
        if (!connection.signal.aborted) throw error;
        end = "aborted";
      }
      if (end === "closed" || this.#isStopped()) break;
      // Aborted while hidden: reconnect at once when the page is visible again.
      if (end === "aborted") continue;
      this.state = "waiting";
      // A `retry` under 100 ms is used once; failures in a row back off from 100 ms, so a server
      // that sets `retry: 0` and then fails does not get a request on every task.
      const base = this.#failures === 0 ? this.#delay : Math.max(this.#delay, 100);
      const delay = Math.min(base * 2 ** this.#failures, maxDelay);
      this.#failures++;
      await this.#wait(delay);
    }
    this.stop();
  }

  async #read(response: Response, connection: AbortController): Promise<ReadEnd> {
    const parser = new EventStreamParser(this.#lastEventId);
    const lease = leaseBody(response, connection.signal);
    const read = { closed: false };
    try {
      await lease.stream(async (chunk) => {
        for (const event of parser.feed(chunk)) {
          if (read.closed || this.#stopped) return;
          this.#lastEventId = event.lastEventId;
          this.#failures = 0;
          read.closed = await this.#handle(event);
          if (read.closed) connection.abort(new DOMException("closed", "AbortError"));
        }
        this.#lastEventId = parser.lastEventId;
        if (parser.retry !== undefined) this.#delay = parser.retry;
      });
      parser.end();
      return "ended";
    } catch {
      if (read.closed) return "closed";
      // A failure reading the body is a dropped connection: it reconnects like an ended one.
      return connection.signal.aborted ? "aborted" : "ended";
    } finally {
      await lease.release();
    }
  }

  /** Applies one event; true when the stream is finished. */
  async #handle(event: StreamEvent): Promise<boolean> {
    let finished = false;
    try {
      if (event.type === "tessera-patch-elements") finished = await this.#patchElements(dataFields(event.data));
      else if (event.type === "tessera-patch-signals") this.#patchSignals(dataFields(event.data));
      else if (event.type === "tessera-close") finished = true;
    } catch (error) {
      this.report(error);
    }
    for (const { onEvent } of [...this.holders]) {
      try {
        onEvent?.(event);
      } catch (error) {
        this.report(error);
      }
    }
    return finished;
  }

  /** Commits one fragment; true after a full load, since the page is going away. */
  async #patchElements(fields: Map<string, string[]>): Promise<boolean> {
    const target = fields.get("target")?.[0];
    if (target === undefined || target === "") throw new StreamError("A tessera-patch-elements event needs a target.");
    const mode = (fields.get("mode")?.[0] ?? "morph") as PatchMode;
    const elements = fields.get("elements");
    if (elements === undefined && mode !== "remove") throw new StreamError(`The tessera-patch-elements event for ${target} has no elements.`);
    return (await this.#options.transport.commitStream(target, mode, (elements ?? []).join("\n"))) === "full-load";
  }

  #patchSignals(fields: Map<string, string[]>): void {
    const scope = fields.get("scope")?.[0];
    const signals = fields.get("signals");
    if (scope === undefined || scope === "") throw new StreamError("A tessera-patch-signals event needs a scope.");
    if (signals === undefined) throw new StreamError(`The tessera-patch-signals event for ${scope} has no signals.`);
    const patch: unknown = JSON.parse(signals.join("\n"));
    if (!isPlainRecord(patch)) throw new StreamError("A signal patch must be a JSON object.");
    // An `@NAME` scope resolves when the event arrives; one that does not throws, and the event
    // is reported and changes nothing.
    const [resolved = scope] = resolveAnchors(this.#options.kernel.document, [scope]);
    this.#options.patcher.patchSignals(resolved, patch, { onlyIfMissing: fields.get("onlyIfMissing")?.[0] === "true" });
  }
}

/**
 * Keeps one stream open per URL while anything holds it: elements carrying `data-stream`, found
 * as they arrive, and handles from `open`. Every holder and every stream is in the kernel's
 * ledger, so a holder lets go when its element leaves the page and disposal stops them all.
 */
export function connectStreams(options: StreamsOptions): Streams {
  const { kernel } = options;
  const { document } = kernel;
  const channels = new Map<string, Channel>();
  /** Each element's `data-stream` value and its hold; `released` once the element has let go. */
  const byElement = new WeakMap<Element, { readonly value: string; readonly hold: Hold }>();

  interface Hold {
    readonly handle: StreamHandle;
    readonly released: () => boolean;
  }

  const hold = (url: string, openOptions: OpenOptions): Hold => {
    const href = new URL(url, document.baseURI).href;
    let channel = channels.get(href);
    if (!channel) {
      const created: Channel = new Channel(href, options, () => {
        if (channels.get(href) === created) channels.delete(href);
      });
      channels.set(href, created);
      channel = created;
    }
    const joined = channel;
    const holder: Holder = { onEvent: openOptions.onEvent };
    joined.join(holder);
    let released = false;
    let release: () => void;
    try {
      release = kernel.own("subscription", `stream:${href}`, () => {
        released = true;
        joined.leave(holder);
      }, openOptions.element);
    } catch (error) {
      joined.leave(holder);
      throw error;
    }
    const handle: StreamHandle = {
      url: href,
      get state() {
        return joined.state;
      },
      close: release,
    };
    return { handle, released: () => released };
  };

  /**
   * Opens, changes or closes the stream an element names in `data-stream`. An element whose
   * stream finished for good keeps it finished until the value changes or the element leaves.
   */
  const sync = (element: Element): void => {
    const value = element.getAttribute("data-stream") ?? "";
    const held = byElement.get(element);
    if (held?.value === value && !held.hold.released()) return;
    held?.hold.handle.close();
    byElement.delete(element);
    if (value === "" || !element.isConnected || !kernel.canOwn(element, true)) return;
    try {
      byElement.set(element, { value, hold: hold(value, { element }) });
    } catch (error) {
      options.report?.(error, value);
    }
  };

  const scan = (root: Element): void => {
    if (root.hasAttribute("data-stream")) sync(root);
    for (const element of Array.from(root.querySelectorAll("[data-stream]"))) sync(element);
  };

  kernel.observe(
    "streams:scan",
    document,
    (records) => {
      for (const record of records) {
        if (record.type === "attributes") sync(record.target as Element);
        else for (const node of Array.from(record.addedNodes)) if (node.nodeType === 1 && node.isConnected) scan(node as Element);
      }
    },
    { childList: true, subtree: true, attributes: true, attributeFilter: ["data-stream"] },
  );
  scan(document.documentElement);

  return {
    open: (url, openOptions = {}) => hold(url, openOptions).handle,
    urls: () => [...channels.keys()],
  };
}
