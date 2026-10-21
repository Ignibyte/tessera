// The transport: builds a request as docs/protocol.md section 4 says, dispatches it without ever
// resending a write, and reads the answer as sections 5 and 6 say. Rewritten from jqstar
// `src/fetch.ts`, whose shipped defects it fixes (digest headline 4, section 6): a POST is never
// retried, redirects are manual for writes, a 4xx or 5xx with a recognized body commits, the
// submitter is in the form data, and supersession is by target, not by method and URL. The 5 ms
// buffer, the interceptor lifecycle and the 419 prompt come from Livewire.
import type { ActionCall, ActionSeam } from "./actions.ts";
import { ERROR_EVENT } from "./attributes.ts";
import { leaseBody } from "./body.ts";
import { trackedSet } from "./head.ts";
import { busyElements, decideAll, Generations, resolveTarget } from "./coordination.ts";
import type { RequestClass, TargetNode } from "./coordination.ts";
import type { Kernel } from "./kernel.ts";
import { findTarget, PATCH_MODES } from "./patch.ts";
import type { Patcher, PatchMode } from "./patch.ts";
import { encodeSignals } from "./scopes.ts";
import type { Scopes } from "./scopes.ts";
import { isPlainRecord } from "./values.ts";

export type RequestKind = "visit" | "submit" | "action" | "refresh";

/**
 * What a committed visit does to history: a new entry (`push`, the default), the current entry
 * (`replace`), the entry the browser moved to (`pop`, back and forward), or nothing (`none`).
 */
export type HistoryMode = "push" | "replace" | "pop" | "none";
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A request as it is sent; frozen before interceptors see it. */
export interface TesseraRequest {
  readonly kind: RequestKind;
  readonly method: Method;
  readonly url: string;
  /** The targets named in `Tessera-Targets`; empty for the page. */
  readonly targets: readonly string[];
  readonly element: Element | undefined;
  readonly body: FormData | URLSearchParams | string | undefined;
  /** The `Tessera-Signals` value, on actions only. */
  readonly signals: string | undefined;
  /** For a visit, what it does to history; `none` for anything else. */
  readonly history: HistoryMode;
}

export interface RequestInput {
  readonly kind: RequestKind;
  readonly method?: Method;
  readonly url: string;
  readonly targets?: readonly string[];
  readonly element?: Element;
  readonly body?: FormData | URLSearchParams | string;
  /** Send the signals of the element's scope chain (actions only). */
  readonly signals?: boolean;
  /** A refresh from `data-poll`: it yields to every overlapping request (protocol 4.6). */
  readonly poll?: boolean;
  /** For a visit: what it does to history. Default `push`. */
  readonly history?: HistoryMode;
}

export type OutcomeStatus =
  | "committed"
  | "unchanged"
  | "full-load"
  | "expired"
  | "superseded"
  | "skipped"
  | "aborted"
  | "failed"
  | "indeterminate";

export interface RequestOutcome {
  /**
   * `indeterminate`: a write was dispatched and its fate is unknown (it may have been saved);
   * it is never resent. `superseded`, `skipped` (a poll that yielded) and `aborted`: nothing
   * more will happen for this request.
   */
  readonly status: OutcomeStatus;
  readonly httpStatus?: number;
  readonly url?: string;
  readonly error?: unknown;
  /** The URL a `Tessera-Location` led to, when the outcome is that visit's. */
  readonly redirectedTo?: string;
}

/**
 * The history seam: `capture` runs just before a visit's commit changes the page, `commit` right
 * after it, before what arrived is enhanced. Neither runs for a 409 or 422, or for mode `none`.
 */
export interface VisitHistory {
  capture(request: TesseraRequest): void;
  commit(url: string, request: TesseraRequest, updated: readonly TargetNode[]): void;
}

/** What committing a whole document came to: committed in place, or a full load is needed. */
export type DocumentCommit = "committed" | "full-load";

export interface Interceptor {
  /** Runs once before dispatch; may set headers, but the protocol's own headers are restored. */
  readonly before?: (context: { readonly request: TesseraRequest; readonly headers: Headers }) => void;
  readonly after?: (context: { readonly request: TesseraRequest; readonly outcome: RequestOutcome }) => void;
  readonly error?: (context: { readonly request: TesseraRequest; readonly error: unknown }) => void;
}

export interface TransportOptions {
  readonly kernel: Kernel;
  readonly patcher: Patcher;
  readonly scopes?: Scopes;
  readonly fetch?: typeof fetch;
  /** A full load: the browser takes over the navigation. Default `location.assign`. */
  readonly navigate?: (url: string) => void;
  /** Reload after a confirmed "page expired" prompt. Default `location.reload`. */
  readonly reload?: () => void;
  readonly confirm?: (message: string) => boolean;
  /** History around a visit's commit (src/history.ts). Default: push or replace the URL alone. */
  readonly history?: VisitHistory;
  /** Commits a whole document in place (src/navigation.ts). Without it, a document answer is a full load. */
  readonly commitDocument?: (html: string, url: string, request: TesseraRequest) => Promise<DocumentCommit>;
  readonly report?: (error: unknown, request: TesseraRequest | undefined) => void;
  /** How long a request waits before it goes, so a superseded read is never sent. Default 5. */
  readonly bufferMs?: number;
  /** How often a GET is retried after a network failure. Default 2. */
  readonly retries?: number;
  /** The first retry's delay; each further retry doubles it. Default 250. */
  readonly retryDelayMs?: number;
}

export interface Transport {
  request(input: RequestInput): Promise<RequestOutcome>;
  /** Submits a form as the browser would, with its submitter. */
  submit(form: HTMLFormElement, submitter?: HTMLElement | null): Promise<RequestOutcome>;
  /** The seam `@get` … `@delete` call. */
  readonly actions: ActionSeam;
  intercept(interceptor: Interceptor): () => void;
}

/** The event a 419 raises on the document; cancel it to replace the reload prompt. */
export const EXPIRED_EVENT = "tessera:expired";

export const ACCEPT = "text/vnd.tessera+html, text/html;q=0.9";

const PROTOCOL_HEADERS = ["accept", "tessera-request", "tessera-protocol", "tessera-targets", "tessera-layout", "tessera-signals"];

/** A request from admission until it settles, as the coordination sees it (protocol 4.6). */
interface Operation {
  readonly class: RequestClass;
  readonly targets: readonly TargetNode[];
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  /** The commit sequence when it was dispatched. */
  dispatched: number;
  done: boolean;
  /** Resolves `settled`: the requests queued behind this one may go. */
  readonly release: () => void;
}

class TransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransportError";
  }
}

function isWrite(method: Method): boolean {
  return method !== "GET";
}

function meta(document: Document, name: string): string | undefined {
  return document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? undefined;
}

function mediaType(response: Response): string {
  return (response.headers.get("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function withFragment(url: string, hash: string): string {
  const parsed = new URL(url);
  if (parsed.hash === "" && hash !== "") parsed.hash = hash;
  return parsed.href;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const aborted = (): void => {
      clearTimeout(timer);
      reject(signal.reason as Error);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

function visible(document: Document, signal: AbortSignal): Promise<void> {
  if (document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const changed = (): void => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", changed);
      signal.removeEventListener("abort", aborted);
      resolve();
    };
    const aborted = (): void => {
      document.removeEventListener("visibilitychange", changed);
      reject(signal.reason as Error);
    };
    document.addEventListener("visibilitychange", changed);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

// --- Forms --------------------------------------------------------------------------------

type Encoding = "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain";

function encoding(value: string | null): Encoding {
  const lowered = (value ?? "").toLowerCase();
  return lowered === "multipart/form-data" || lowered === "text/plain" ? lowered : "application/x-www-form-urlencoded";
}

function textEntries(data: FormData): [string, string][] {
  return Array.from(data, ([name, value]) => [name, typeof value === "string" ? value : value.name]);
}

/** A form's data in an encoding (HTML's form submission algorithm). */
function encodeForm(data: FormData, type: Encoding): FormData | URLSearchParams | string {
  if (type === "multipart/form-data") return data;
  if (type === "text/plain") return textEntries(data).map(([name, value]) => `${name}=${value}\r\n`).join("");
  return new URLSearchParams(textEntries(data));
}

function submitterAttribute(submitter: HTMLElement | null | undefined, name: string): string | null {
  return submitter?.getAttribute(name) ?? null;
}

/** The targets of a form or a link: `data-target` on the submitter, then the form, then its region. */
export function elementTargets(element: Element, submitter?: Element | null): string[] {
  const named = submitter?.getAttribute("data-target") ?? element.getAttribute("data-target");
  if (named !== null) return named.split(/\s+/).filter((target) => target !== "" && target !== "page");
  const region = element.closest("[data-region]")?.getAttribute("data-region");
  return region ? [region] : [];
}

// --- The transport ------------------------------------------------------------------------

let transportId = 0;

export function createTransport(options: TransportOptions): Transport {
  const { kernel, patcher, scopes } = options;
  const { document, window } = kernel;
  const fetcher = options.fetch ?? window.fetch.bind(window);
  const navigate = options.navigate ?? ((url: string) => {
    window.location.assign(url);
  });
  const reload = options.reload ?? (() => {
    window.location.reload();
  });
  const confirm = options.confirm ?? ((message: string) => window.confirm(message));
  const history: VisitHistory = options.history ?? {
    capture: () => undefined,
    commit: (url, request) => {
      if (request.history === "push" && url !== window.location.href) window.history.pushState(null, "", url);
      else if (request.history === "replace") window.history.replaceState(null, "", url);
    },
  };
  /** Whether a visit's answer is recorded in history. */
  const recorded = (request: TesseraRequest, status: number): boolean =>
    request.kind === "visit" && request.history !== "none" && status !== 409 && status !== 422;
  const bufferMs = options.bufferMs ?? 5;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const owner = `transport:${++transportId}`;
  const interceptors = new Set<Interceptor>();
  const operations: Operation[] = [];
  const generations = new Generations();
  const busy = new Map<Element, number>();
  const loading = new Map<Element, number>();

  /** Counts a holder of an attribute on an element; the attribute stays while any holds it. */
  const hold = (counts: Map<Element, number>, element: Element, name: string, value: string): (() => void) => {
    const count = counts.get(element) ?? 0;
    counts.set(element, count + 1);
    if (count === 0) element.setAttribute(name, value);
    return () => {
      const left = (counts.get(element) ?? 1) - 1;
      if (left > 0) counts.set(element, left);
      else {
        counts.delete(element);
        element.removeAttribute(name);
      }
    };
  };

  const report = (error: unknown, request: TesseraRequest | undefined): void => {
    if (options.report) {
      options.report(error, request);
      return;
    }
    const target = request?.element?.isConnected ? request.element : document;
    const event = new (window as Window & typeof globalThis).CustomEvent(ERROR_EVENT, {
      bubbles: true,
      cancelable: true,
      detail: { error, request },
    });
    if (target.dispatchEvent(event)) (window as Window & typeof globalThis).console.error(error);
  };

  const fullLoad = (url: string): RequestOutcome => {
    navigate(url);
    return { status: "full-load", url };
  };

  /** Targets with each component's props token, as `Tessera-Targets` carries them (4.3). */
  const targetsHeader = (targets: readonly string[]): string =>
    targets
      .map((target) => {
        if (!target.includes("/")) return target;
        try {
          const found = findTarget(document, target);
          const props = found.kind === "component" ? found.opener.data.split(" ")[2] : undefined;
          return props === undefined ? target : `${target} ${props}`;
        } catch {
          return target;
        }
      })
      .join(", ");

  const protocolHeaders = (request: TesseraRequest): [string, string][] => {
    const headers: [string, string][] = [
      ["Accept", ACCEPT],
      ["Tessera-Request", request.kind],
      ["Tessera-Protocol", "0"],
    ];
    if (request.targets.length > 0) headers.push(["Tessera-Targets", targetsHeader(request.targets)]);
    const layout = meta(document, "tessera-layout");
    if (layout !== undefined) headers.push(["Tessera-Layout", layout]);
    if (request.signals !== undefined) headers.push(["Tessera-Signals", request.signals]);
    const token = meta(document, "tessera-csrf-token");
    if (isWrite(request.method) && token !== undefined && new URL(request.url).origin === window.location.origin) {
      headers.push([meta(document, "tessera-csrf-header") ?? "X-CSRF-Token", token]);
    }
    return headers;
  };

  // --- Committing an answer ----------------------------------------------------------------

  interface ParsedFragments {
    readonly templates: { target: string; mode: PatchMode; markup: string }[];
    readonly signals: { scope: string; patch: Record<string, unknown>; onlyIfMissing: boolean }[];
    readonly title: string | undefined;
    readonly csrf: string | undefined;
    readonly tracked: Element[];
  }

  const parseFragments = (text: string): ParsedFragments => {
    const holder = document.createElement("template");
    holder.innerHTML = text;
    const parsed: ParsedFragments = { templates: [], signals: [], title: undefined, csrf: undefined, tracked: [] };
    let title: string | undefined;
    let csrf: string | undefined;
    for (const node of Array.from(holder.content.childNodes)) {
      if (node.nodeType === 8 || (node.nodeType === 3 && (node.textContent ?? "").trim() === "")) continue;
      if (node.nodeType !== 1) throw new TransportError("A fragment response holds text outside its elements.");
      const element = node as Element;
      const name = element.localName;
      if (name === "template" && element.hasAttribute("data-target")) {
        const target = element.getAttribute("data-target") ?? "";
        const mode = (element.getAttribute("data-mode") ?? "morph") as PatchMode;
        if (target === "page" || target.includes(" ")) throw new TransportError(`A fragment cannot target "${target}".`);
        if (!PATCH_MODES.includes(mode)) throw new TransportError(`"${mode}" is not a fragment mode.`);
        parsed.templates.push({ target, mode, markup: element.innerHTML });
      } else if (name === "script" && element.getAttribute("type") === "application/json" && element.hasAttribute("data-scope")) {
        const patch: unknown = JSON.parse(element.textContent || "null");
        if (!isPlainRecord(patch)) throw new TransportError("A signal patch must be a JSON object.");
        parsed.signals.push({ scope: element.getAttribute("data-scope") ?? "", patch, onlyIfMissing: element.hasAttribute("data-only-if-missing") });
      } else if (name === "title" && title === undefined) {
        title = element.textContent;
      } else if (name === "meta" && element.getAttribute("name") === "tessera-csrf-token" && csrf === undefined) {
        csrf = element.getAttribute("content") ?? "";
      } else if ((name === "link" || name === "script") && element.hasAttribute("data-track")) {
        parsed.tracked.push(element);
      } else {
        throw new TransportError(`A fragment response cannot hold <${name}> at its top level.`);
      }
    }
    return { ...parsed, title, csrf };
  };

  const nodeOf = (target: ReturnType<typeof findTarget>): Node => (target.kind === "region" ? target.element : target.opener);

  const containsTarget = (outer: ReturnType<typeof findTarget>, inner: ReturnType<typeof findTarget>): boolean => {
    const node = nodeOf(inner);
    if (outer.kind === "region") return outer.element !== node && outer.element.contains(node);
    if (node === outer.opener) return false;
    const after = outer.opener.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
    const before = outer.closer.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING;
    return Boolean(after && before);
  };

  const commitFragments = (text: string, request: TesseraRequest, response: Response, url: string, operation: Operation): RequestOutcome => {
    const fail = (error: unknown): RequestOutcome => {
      report(error, request);
      return { status: "failed", httpStatus: response.status, error };
    };
    let parsed: ParsedFragments;
    try {
      parsed = parseFragments(text);
    } catch (error) {
      return fail(error);
    }
    if (parsed.tracked.length > 0 && trackedSet(parsed.tracked, url) !== trackedSet(document.head.children, document.baseURI)) {
      return fullLoad(request.kind === "visit" ? url : window.location.href);
    }

    const resolved: { target: string; mode: PatchMode; markup: string; found: ReturnType<typeof findTarget> }[] = [];
    for (const template of parsed.templates) {
      try {
        resolved.push({ ...template, found: findTarget(document, template.target) });
      } catch (error) {
        if (request.targets.includes(template.target)) {
          report(new TransportError(`${template.target} left the page while its request was in flight; its fragment is dropped.`, { cause: error }), request);
          continue;
        }
        if (request.kind === "visit") return fullLoad(url);
        return fail(error);
      }
    }
    for (const outer of resolved) {
      const inner = resolved.find((other) => other !== outer && (other.target === outer.target || containsTarget(outer.found, other.found)));
      if (inner) return fail(new TransportError(`The response targets both ${outer.target} and ${inner.target}; send the outer target only.`));
    }

    const record = recorded(request, response.status);
    const updated: TargetNode[] = [];
    if (record) history.capture(request);
    try {
      for (const { target, mode, markup, found } of resolved) {
        const node: TargetNode = found.kind === "region" ? { kind: "region", element: found.element } : { kind: "component", opener: found.opener, closer: found.closer };
        if (generations.stale(node, operation.dispatched)) {
          report(new TransportError(`${target} changed after this request was sent; its older fragment is dropped.`), request);
          continue;
        }
        patcher.patchElements(target, markup, mode);
        const after = resolveTarget(document, target);
        if (after) {
          generations.touch(after);
          updated.push(after);
        } else generations.touch({ kind: "page", document });
      }
      for (const { scope, patch, onlyIfMissing } of parsed.signals) patcher.patchSignals(scope, patch, { onlyIfMissing });
    } catch (error) {
      return fail(error);
    }
    if (parsed.title !== undefined) document.title = parsed.title;
    if (parsed.csrf !== undefined) {
      const current = document.head.querySelector<HTMLMetaElement>('meta[name="tessera-csrf-token"]');
      if (current) current.content = parsed.csrf;
    }
    if (record) history.commit(url, request, updated);
    return { status: "committed", httpStatus: response.status, url };
  };

  const expired = (request: TesseraRequest): RequestOutcome => {
    const event = new (window as Window & typeof globalThis).CustomEvent(EXPIRED_EVENT, { cancelable: true, detail: { request } });
    if (document.dispatchEvent(event) && confirm("This page has expired. Reload it to continue?")) reload();
    return { status: "expired", httpStatus: 419 };
  };

  /** Reads an answer as protocol sections 5 and 6 say. */
  const interpret = async (request: TesseraRequest, response: Response, operation: Operation): Promise<RequestOutcome> => {
    const { signal } = operation.controller;
    const lease = leaseBody(response, signal);
    try {
      if (response.type === "opaqueredirect") {
        return { status: "indeterminate", error: new TransportError("The write was answered with a redirect Tessera does not follow; it may have been saved.") };
      }
      // A response's URL has no fragment; the request's carries over, as a browser does.
      const finalUrl = withFragment(response.url || request.url, new URL(request.url).hash);
      const fullVisit = response.headers.get("Tessera-Full-Visit");
      if (fullVisit !== null) {
        const url = new URL(fullVisit, finalUrl);
        if (url.protocol === "http:" || url.protocol === "https:") return fullLoad(url.href);
        const error = new TransportError(`Tessera-Full-Visit names a URL Tessera does not follow: ${fullVisit}`);
        report(error, request);
        return { status: "failed", httpStatus: response.status, error };
      }
      if (response.status === 204) return { status: "unchanged", httpStatus: 204 };
      const location = response.headers.get("Tessera-Location");
      if (location !== null) {
        const url = new URL(location, finalUrl);
        if (url.origin !== window.location.origin) return fullLoad(url.href);
        // The visit leaves this request's place first, so it cannot queue behind its own write.
        finish(operation);
        const followed = await run({
          kind: "visit",
          method: "GET",
          url: url.href,
          targets: request.targets,
          history: request.kind === "visit" ? request.history : "push",
          ...(request.element ? { element: request.element } : {}),
        });
        return { ...followed, redirectedTo: url.href };
      }
      const versions = response.headers.get("Tessera-Protocol");
      if (response.status === 400 && versions !== null && !versions.split(",").map((version) => version.trim()).includes("0")) {
        return fullLoad(request.kind === "visit" ? finalUrl : window.location.href);
      }
      if (response.status === 419) return expired(request);

      const type = mediaType(response);
      if (type === "text/vnd.tessera+html") {
        if (versions !== "0") return fullLoad(request.kind === "visit" ? finalUrl : window.location.href);
        return commitFragments(await lease.text(), request, response, finalUrl, operation);
      }
      if (type === "text/html") {
        const html = await lease.text();
        if (options.commitDocument) {
          const record = recorded(request, response.status);
          if (record) history.capture(request);
          const result = await options.commitDocument(html, finalUrl, request);
          if (result === "full-load") return fullLoad(request.kind === "visit" ? finalUrl : window.location.href);
          generations.touch({ kind: "page", document });
          if (record) history.commit(finalUrl, request, [{ kind: "page", document }]);
          return { status: "committed", httpStatus: response.status, url: finalUrl };
        }
        return fullLoad(request.kind === "visit" ? finalUrl : window.location.href);
      }
      const error = new TransportError(`A ${response.status} answer with ${type || "no"} content type is not one Tessera can use.`);
      report(error, request);
      if (request.kind === "visit") return fullLoad(finalUrl);
      return { status: isWrite(request.method) ? "indeterminate" : "failed", httpStatus: response.status, error };
    } finally {
      await lease.release();
    }
  };

  // --- Dispatch ------------------------------------------------------------------------------

  /** Takes a request out of the coordination; idempotent. */
  const finish = (operation: Operation): void => {
    if (operation.done) return;
    operation.done = true;
    const index = operations.indexOf(operation);
    if (index >= 0) operations.splice(index, 1);
    operation.release();
  };

  const dispatch = async (request: TesseraRequest, operation: Operation, blockers: readonly Operation[]): Promise<RequestOutcome> => {
    const { signal } = operation.controller;
    const stopped = (): RequestOutcome => ({ status: (signal.reason as DOMException | undefined)?.message === "superseded" ? "superseded" : "aborted" });
    try {
      await sleep(bufferMs, signal);
      await new Promise<void>((resolve, reject) => {
        const aborted = (): void => {
          reject(signal.reason as Error);
        };
        if (signal.aborted) aborted();
        signal.addEventListener("abort", aborted, { once: true });
        void Promise.all(blockers.map((blocker) => blocker.settled)).then(() => {
          signal.removeEventListener("abort", aborted);
          resolve();
        });
      });
      if (request.method === "GET") await visible(document, signal);
    } catch {
      return stopped();
    }
    operation.dispatched = generations.current;

    const headers = new Headers();
    const restore = (): void => {
      for (const name of PROTOCOL_HEADERS) headers.delete(name);
      for (const [name, value] of protocolHeaders(request)) headers.set(name, value);
    };
    restore();
    for (const interceptor of interceptors) interceptor.before?.({ request, headers });
    restore();

    const write = isWrite(request.method);
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetcher(request.url, {
          method: request.method,
          headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          signal,
          credentials: "same-origin",
          redirect: write ? "manual" : "follow",
        });
      } catch (error) {
        if (write) {
          return { status: "indeterminate", error: new TransportError("The write was sent and no answer came back; it may have been saved, so it is not sent again.", { cause: error }) };
        }
        if (signal.aborted) return stopped();
        if (attempt < retries) {
          try {
            await sleep(retryDelayMs * 2 ** attempt, signal);
          } catch {
            return stopped();
          }
          continue;
        }
        return { status: "failed", error };
      }
      try {
        return await interpret(request, response, operation);
      } catch (error) {
        if (signal.aborted && !write) return stopped();
        return { status: write ? "indeterminate" : "failed", httpStatus: response.status, error };
      }
    }
  };

  const run = async (input: RequestInput): Promise<RequestOutcome> => {
    const method = input.method ?? "GET";
    let url: URL;
    try {
      url = new URL(input.url, document.baseURI);
    } catch (error) {
      report(error, undefined);
      return { status: "failed", error };
    }
    if (url.origin !== window.location.origin) {
      if (input.kind === "visit" && method === "GET") return fullLoad(url.href);
      const error = new TransportError(`Tessera does not send requests to another origin: ${url.href}`);
      report(error, undefined);
      return { status: "failed", error };
    }
    if (method === "GET" && input.body !== undefined) {
      const error = new TransportError("A GET request has no body.");
      report(error, undefined);
      return { status: "failed", error };
    }
    let signals: string | undefined;
    if (input.signals && input.kind === "action" && scopes && input.element) {
      try {
        signals = encodeSignals(scopes.payload(input.element));
      } catch (error) {
        report(error, undefined);
        return { status: "failed", error };
      }
    }
    const request: TesseraRequest = Object.freeze({
      kind: input.kind,
      method,
      url: url.href,
      targets: Object.freeze([...(input.targets ?? [])]),
      element: input.element,
      body: input.body,
      signals,
      history: input.kind === "visit" ? (input.history ?? "push") : "none",
    });

    const requestClass: RequestClass = isWrite(method) ? "write" : input.poll ? "poll" : "read";
    const targets = request.targets.flatMap((target) => resolveTarget(document, target) ?? []);
    const pending = { class: requestClass, targets };
    const decisions = operations.map((older) => [older, decideAll(pending, older, document)] as const);
    if (decisions.some(([, decision]) => decision === "skip")) return { status: "skipped" };
    for (const [older, decision] of decisions) {
      if (decision === "supersede") older.controller.abort(new DOMException("superseded", "AbortError"));
    }
    const blockers = decisions.flatMap(([older, decision]) => (decision === "queue" ? [older] : []));

    let settle: () => void = () => undefined;
    const settledPromise = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const operation: Operation = {
      class: requestClass,
      targets,
      controller: new AbortController(),
      settled: settledPromise,
      dispatched: 0,
      done: false,
      release: () => {
        settle();
      },
    };
    operations.push(operation);
    const releases = [
      ...(targets.length > 0 ? targets : [{ kind: "page", document } as const]).flatMap((target) =>
        busyElements(target).map((element) => hold(busy, element, "aria-busy", "true")),
      ),
      ...(request.element ? [hold(loading, request.element, "data-loading", "")] : []),
    ];
    const releaseAbort = kernel.own("task", `${owner}:${request.kind}`, () => {
      operation.controller.abort(new DOMException("disposed", "AbortError"));
    });
    const settled = (async (): Promise<RequestOutcome> => {
      let outcome: RequestOutcome;
      try {
        outcome = await dispatch(request, operation, blockers);
      } catch (error) {
        outcome = { status: requestClass === "write" ? "indeterminate" : "failed", error };
      } finally {
        finish(operation);
        for (const release of releases) release();
        if (!kernel.disposed) releaseAbort();
      }
      if (outcome.status === "indeterminate" || (outcome.status === "failed" && outcome.error !== undefined)) {
        if (outcome.status === "indeterminate") report(outcome.error, request);
        for (const interceptor of interceptors) interceptor.error?.({ request, error: outcome.error });
      }
      for (const interceptor of interceptors) interceptor.after?.({ request, outcome });
      return outcome;
    })();
    kernel.task(`${owner}:${request.kind}`, settled, () => undefined);
    return settled;
  };

  const formRequest = (form: HTMLFormElement, submitter: HTMLElement | null | undefined, kind?: RequestKind, element?: Element): RequestInput | Error => {
    const method = (submitterAttribute(submitter, "formmethod") ?? form.getAttribute("method") ?? "get").toLowerCase();
    if (method !== "get" && method !== "post") return new TransportError(`A form with method "${method}" is left to the browser.`);
    const action = new URL(submitterAttribute(submitter, "formaction") ?? form.getAttribute("action") ?? "", document.baseURI);
    let data: FormData;
    try {
      data = new FormData(form, submitter ?? undefined);
    } catch (error) {
      return error instanceof Error ? error : new TransportError(String(error));
    }
    const targets = elementTargets(form, submitter);
    if (method === "get") {
      action.search = new URLSearchParams(textEntries(data)).toString();
      return { kind: kind ?? "visit", method: "GET", url: action.href, targets, element: element ?? form };
    }
    const type = encoding(submitterAttribute(submitter, "formenctype") ?? form.getAttribute("enctype"));
    return { kind: kind ?? "submit", method: "POST", url: action.href, targets, element: element ?? form, body: encodeForm(data, type) };
  };

  const actions: ActionSeam = (call: ActionCall) => {
    const { options = {} } = call;
    const unknown = Object.keys(options).filter((key) => key !== "target" && key !== "form");
    if (unknown.length > 0) throw new TypeError(`@${call.method} has no option ${unknown.join(", ")}; it takes target and form.`);
    const method = call.method.toUpperCase() as Method;
    let targets: string[];
    if (typeof options.target === "string") targets = options.target.split(/\s+/).filter((target) => target !== "" && target !== "page");
    else if (options.target !== undefined) throw new TypeError(`@${call.method} target must be a string of targets.`);
    else if (scopes) {
      const [nearest] = scopes.owners(call.element);
      targets = nearest && nearest.nodeType !== 9 ? [scopes.pathOf(nearest as Element | Comment)] : [];
    } else {
      targets = elementTargets(call.element);
    }
    let body: FormData | URLSearchParams | string | undefined;
    if (options.form !== undefined && options.form !== false) {
      const form =
        options.form === true ? call.element.closest("form") : typeof options.form === "string" ? document.querySelector(options.form) : null;
      if (!form || form.localName !== "form") throw new TypeError(`@${call.method} could not find its form.`);
      if (method !== "GET" && method !== "DELETE") {
        const formElement = form as HTMLFormElement;
        body = encodeForm(new FormData(formElement), encoding(formElement.getAttribute("enctype")));
      }
    }
    return run({ kind: "action", method, url: call.url, targets, element: call.element, signals: true, ...(body === undefined ? {} : { body }) });
  };

  return {
    request: run,
    submit(form, submitter) {
      const input = formRequest(form, submitter);
      if (input instanceof Error) {
        report(input, undefined);
        return Promise.resolve({ status: "failed", error: input });
      }
      return run(input);
    },
    actions,
    intercept(interceptor) {
      interceptors.add(interceptor);
      return () => {
        interceptors.delete(interceptor);
      };
    },
  };
}
