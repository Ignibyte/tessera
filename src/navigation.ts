// Enhanced navigation: same-origin link clicks become visits through the transport, and a whole
// document answering a visit is committed in place (protocol sections 5.2 and 9). From jqstar
// 0024 (intercepting visits) and 0025 (committing documents and the head), both declined there
// and never built; the body morph instead of a replacement, and prefetch on mousedown or after a
// short hover, are Livewire's.
import { addHead, headConflict, takeMetadata } from "./head.ts";
import type { Kernel } from "./kernel.ts";
import type { Patcher } from "./patch.ts";
import type { ProgressBar } from "./progress.ts";
import { elementHistory, elementTargets } from "./transport.ts";
import type { DocumentCommit, HistoryMode, RequestOutcome, TesseraRequest, Transport } from "./transport.ts";

export type LinkRefusal =
  | "prevented"
  | "button"
  | "modifier"
  | "not-a-link"
  | "target"
  | "download"
  | "scheme"
  | "origin"
  | "fragment"
  | "opted-out";

export type LinkEligibility = { readonly link: HTMLAnchorElement; readonly url: URL } | { readonly refused: LinkRefusal };

const HTML = "http://www.w3.org/1999/xhtml";

/** Whether a click is one Tessera turns into a visit, and why not when it is not. */
export function linkEligibility(event: MouseEvent, document: Document): LinkEligibility {
  if (event.defaultPrevented) return { refused: "prevented" };
  if (event.button !== 0) return { refused: "button" };
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return { refused: "modifier" };
  const node = event.target as Node | null;
  const element = node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
  const link = element?.closest("a[href]");
  if (!link || link.namespaceURI !== HTML || link.ownerDocument !== document) return { refused: "not-a-link" };
  const anchor = link as HTMLAnchorElement;
  const target = anchor.getAttribute("target");
  if (target !== null && target !== "" && target.toLowerCase() !== "_self") return { refused: "target" };
  if (anchor.hasAttribute("download")) return { refused: "download" };
  const url = new URL(anchor.href);
  if (url.protocol !== "http:" && url.protocol !== "https:") return { refused: "scheme" };
  const here = new URL(document.URL);
  if (url.origin !== here.origin) return { refused: "origin" };
  if (url.hash !== "" && url.pathname === here.pathname && url.search === here.search) return { refused: "fragment" };
  if (anchor.closest("[data-enhance]")?.getAttribute("data-enhance") === "off") return { refused: "opted-out" };
  return { link: anchor, url };
}

export interface DocumentCommitterOptions {
  readonly kernel: Kernel;
  readonly patcher: Patcher;
  /** How long a new stylesheet may take before the body commits anyway. Default 4000 ms. */
  readonly stylesheetTimeoutMs?: number;
}

/**
 * Commits a whole document in place (protocol 9): tracked assets and `<base>` compared first (a
 * difference loads in full), new head elements added and their stylesheets awaited, the title,
 * `lang`, `dir` and metas taken, `<body>` morphed keeping `data-permanent` elements, then the
 * obsolete head elements removed. Scripts in the document never run.
 */
export function createDocumentCommitter(options: DocumentCommitterOptions) {
  const { kernel, patcher } = options;
  const { document } = kernel;
  const timeoutMs = options.stylesheetTimeoutMs ?? 4000;
  return async (html: string, url: string, _request: TesseraRequest): Promise<DocumentCommit> => {
    const incoming = new (kernel.window as Window & typeof globalThis).DOMParser().parseFromString(html, "text/html");
    if (headConflict(document, incoming, url) !== undefined) return "full-load";
    const removeObsolete = await addHead(document, incoming, timeoutMs);
    takeMetadata(document, incoming);
    patcher.patchBody(incoming.body as HTMLBodyElement);
    removeObsolete();
    return "committed";
  };
}

export interface LinkOptions {
  readonly kernel: Kernel;
  readonly transport: Transport;
  readonly progress?: ProgressBar;
  /** How long the pointer rests on a `data-prefetch="hover"` link before it prefetches. Default 60 ms. */
  readonly hoverMs?: number;
}

/** When a link prefetches: on mousedown (the default), also after a hover, or never. */
export type PrefetchMode = "mousedown" | "hover" | "off";

/** The nearest `data-prefetch` decides: `hover`, `off`, or anything else for mousedown. */
export function prefetchMode(link: Element): PrefetchMode {
  const value = link.closest("[data-prefetch]")?.getAttribute("data-prefetch");
  return value === "hover" || value === "off" ? value : "mousedown";
}

export interface Navigation {
  /** A visit from code, as a click on a link to `url` would make. */
  visit(url: string, options?: { targets?: readonly string[]; element?: Element; history?: HistoryMode }): Promise<RequestOutcome>;
}

/**
 * Turns eligible link clicks on the document into visits, and prefetches them from mousedown, or
 * from a hover on `data-prefetch="hover"` links. The listeners are owned by the kernel.
 */
export function interceptLinks(options: LinkOptions): Navigation {
  const { kernel, transport, progress } = options;
  const hoverMs = options.hoverMs ?? 60;
  const visit: Navigation["visit"] = async (url, visitOptions = {}) => {
    const stop = progress?.start();
    try {
      return await transport.request({
        kind: "visit",
        url,
        targets: visitOptions.targets ?? [],
        ...(visitOptions.element ? { element: visitOptions.element } : {}),
        ...(visitOptions.history ? { history: visitOptions.history } : {}),
      });
    } finally {
      stop?.();
    }
  };
  kernel.listen("navigation:links", kernel.document, "click", (event) => {
    const eligibility = linkEligibility(event as MouseEvent, kernel.document);
    if ("refused" in eligibility) return;
    event.preventDefault();
    void visit(eligibility.url.href, { targets: elementTargets(eligibility.link), element: eligibility.link, history: elementHistory(eligibility.link) });
  });

  const prefetch = (event: Event, modes: readonly PrefetchMode[]): void => {
    const eligibility = linkEligibility(event as MouseEvent, kernel.document);
    if ("refused" in eligibility || !modes.includes(prefetchMode(eligibility.link))) return;
    transport.prefetch({
      url: eligibility.url.href,
      targets: elementTargets(eligibility.link),
      element: eligibility.link,
      press: event.type === "mousedown",
    });
  };
  kernel.listen("navigation:prefetch", kernel.document, "mousedown", (event) => {
    prefetch(event, ["mousedown", "hover"]);
  });

  let hovered: { readonly link: Element; readonly cancel: () => void } | undefined;
  kernel.listen("navigation:hover", kernel.document, "mouseover", (event) => {
    const node = event.target as Node | null;
    const link = (node?.nodeType === 1 ? (node as Element) : node?.parentElement)?.closest("a[href]");
    if (!link || hovered?.link === link) return;
    hovered?.cancel();
    hovered = undefined;
    if (prefetchMode(link) !== "hover") return;
    const timer = setTimeout(() => {
      cancel();
      prefetch(event, ["hover"]);
    }, hoverMs);
    const release = kernel.own("task", "navigation:hover", () => {
      clearTimeout(timer);
    });
    const cancel = (): void => {
      release();
      if (hovered?.link === link) hovered = undefined;
    };
    hovered = { link, cancel };
  });
  kernel.listen("navigation:hover", kernel.document, "mouseout", (event) => {
    const next = (event as MouseEvent).relatedTarget as Node | null;
    if (hovered && !(next && hovered.link.contains(next))) {
      hovered.cancel();
      hovered = undefined;
    }
  });
  return { visit };
}
