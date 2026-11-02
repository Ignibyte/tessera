// Devtools hooks (ticket #36): an event on the document for every exchange that settles, an event
// on every element a patch changed, and `<meta name="tessera-debug" content="highlight">`, which
// marks each patched element for a moment. New here; jqstar has no counterpart. Nothing on the
// wire changes.
import type { Kernel } from "./kernel.ts";
import type { PatchMode } from "./patch.ts";
import type { Method, OutcomeStatus } from "./transport.ts";

/** Raised on the document when an exchange settles; `detail` is an `ExchangeDetail`. */
export const EXCHANGE_EVENT = "tessera:exchange";

/** Raised on an element after a patch changed it, bubbling; `detail` is a `PatchedDetail`. */
export const PATCHED_EVENT = "tessera:patched";

/** How long `data-tessera-patched` stays on a patched element under the highlight meta. */
export const HIGHLIGHT_MS = 600;

/**
 * What made the exchange: a request's kind, with `poll`, `lazy` and `prefetch` told apart from the
 * refreshes and visits they send, `stream` for a stream's connection and `stream-event` for each
 * event it delivers.
 */
export type ExchangeKind = "visit" | "submit" | "action" | "refresh" | "poll" | "lazy" | "prefetch" | "stream" | "stream-event";

/**
 * A request's outcome; for a prefetch, `prefetched` once its answer waits for its visit; for a
 * stream's connection, `open`, `retry` or `stop` (protocol 7.3); for an event, what applying it
 * came to (`committed`, `dropped`, `full-load`, `failed`, `closed` for `tessera-close`, `ignored`
 * for a type Tessera does not act on).
 */
export type ExchangeOutcome = OutcomeStatus | "prefetched" | "open" | "retry" | "stop" | "dropped" | "closed" | "ignored";

/** One settled exchange. A value Tessera does not have is `null`, so the detail serializes whole. */
export interface ExchangeDetail {
  readonly kind: ExchangeKind;
  /** The absolute URL requested. */
  readonly url: string;
  readonly method: Method;
  /** The targets sent in `Tessera-Targets`, anchors resolved; for an event, the one it names. */
  readonly targets: readonly string[];
  /** The answer's HTTP status; null when none came. */
  readonly status: number | null;
  /** The answer's media type, lowercased, without parameters; null when none came. */
  readonly contentType: string | null;
  /** The bytes of the body Tessera read (an event: its data, UTF-8); null when it read none. */
  readonly bytes: number | null;
  /** The answer's headers the page may read, as fetch gives them: `[name, value]`, names lowercased. */
  readonly headers: readonly (readonly [string, string])[];
  /** `performance.now()` when the request was sent (an event: when it arrived). */
  readonly startTime: number;
  /** Milliseconds from `startTime` to the answer's headers; null when none came. */
  readonly firstByteMs: number | null;
  /** Milliseconds from `startTime` to the exchange settling. */
  readonly settledMs: number;
  readonly outcome: ExchangeOutcome;
  /** A visit that took a prefetched answer instead of fetching. */
  readonly prefetched: boolean;
  /** For a `stream-event`, the event's type; else null. */
  readonly event: string | null;
}

/** The target a patch changed, as the fragment or event named it, and its mode. */
export interface PatchedDetail {
  readonly target: string;
  readonly mode: Exclude<PatchMode, "remove">;
}

/** What an exchange's detail is built from, filled in as the exchange goes. */
export interface ExchangeTiming {
  /** `performance.now()` when it was sent (or arrived, for an event). */
  start: number;
  response: Response | undefined;
  /** `performance.now()` when the answer's headers came. */
  firstByte: number | undefined;
  bytes: number | null;
  prefetched: boolean;
}

export function startTiming(kernel: Kernel): ExchangeTiming {
  return { start: kernel.window.performance.now(), response: undefined, firstByte: undefined, bytes: null, prefetched: false };
}

export interface ExchangeReport {
  readonly kind: ExchangeKind;
  readonly request: { readonly url: string; readonly method: Method; readonly targets: readonly string[] };
  readonly outcome: ExchangeOutcome;
  readonly timing: ExchangeTiming;
  readonly event?: string;
}

/** Raises `tessera:exchange` on the kernel's document; it neither bubbles nor can be cancelled. */
export function raiseExchange(kernel: Kernel, report: ExchangeReport): void {
  const { kind, request, outcome, timing } = report;
  const { response, start, firstByte } = timing;
  const type = response?.headers.get("Content-Type") ?? null;
  const detail: ExchangeDetail = {
    kind,
    url: request.url,
    method: request.method,
    targets: request.targets,
    status: response?.status ?? null,
    contentType: type === null ? null : (type.split(";")[0] ?? "").trim().toLowerCase(),
    bytes: timing.bytes,
    headers: response ? Array.from(response.headers) : [],
    startTime: start,
    firstByteMs: firstByte === undefined ? null : firstByte - start,
    settledMs: kernel.window.performance.now() - start,
    outcome,
    prefetched: timing.prefetched,
    event: report.event ?? null,
  };
  const { CustomEvent } = kernel.window as Window & typeof globalThis;
  kernel.document.dispatchEvent(new CustomEvent(EXCHANGE_EVENT, { detail }));
}

/** Whether the page asks for patched elements to be highlighted. */
function highlighting(document: Document): boolean {
  const content = document.head.querySelector<HTMLMetaElement>('meta[name="tessera-debug"]')?.content ?? "";
  return content.split(/\s+/).includes("highlight");
}

/**
 * Raises `tessera:patched` on an element a patch changed and, under the highlight meta, marks it
 * with `data-tessera-patched` for `HIGHLIGHT_MS`; a later patch restarts the mark. Each mark's
 * timer is in the kernel's ledger, so disposal clears it and the attribute.
 */
export function createPatchedSignal(kernel: Kernel): (element: Element, detail: PatchedDetail) => void {
  const marks = new WeakMap<Element, () => void>();
  return (element, detail) => {
    if (!kernel.disposed && highlighting(kernel.document)) {
      marks.get(element)?.();
      element.setAttribute("data-tessera-patched", "");
      const timer = setTimeout(() => {
        release();
      }, HIGHLIGHT_MS);
      const release = kernel.own("task", "devtools:highlight", () => {
        clearTimeout(timer);
        if (marks.get(element) === release) marks.delete(element);
        element.removeAttribute("data-tessera-patched");
      });
      marks.set(element, release);
    }
    const { CustomEvent } = kernel.window as Window & typeof globalThis;
    element.dispatchEvent(new CustomEvent(PATCHED_EVENT, { bubbles: true, detail }));
  };
}
