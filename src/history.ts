// History, focus and scroll for visits: jqstar 0026's ordering (declined there, never built),
// prepare → capture the current entry → mutate body and head → push or replace URL and state →
// enhance → focus → scroll. A replacing visit stops after the URL and state, as a refresh would. The transport calls `capture` and `commit` around a visit's commit;
// back and forward fetch fresh content through the transport.
import { busyElements, relation, resolveTarget } from "./coordination.ts";
import type { TargetNode } from "./coordination.ts";
import type { Kernel } from "./kernel.ts";
import type { TesseraRequest, Transport, VisitHistory } from "./transport.ts";
import { isPlainRecord } from "./values.ts";

/** What Tessera keeps in `history.state.tessera` for an entry it owns. Never HTML. */
export interface Entry {
  readonly v: 1;
  readonly kind: string;
  /** The targets of the visit that made the entry; empty for the page. */
  readonly targets: readonly string[];
  readonly scroll: { readonly x: number; readonly y: number } | null;
  /** The focused element's `data-focus-key` or `id` when the entry was left. */
  readonly focus: string | null;
}

const KEY = "tessera";

export function readEntry(state: unknown): Entry | undefined {
  if (!isPlainRecord(state)) return undefined;
  const entry = state[KEY];
  if (!isPlainRecord(entry) || entry.v !== 1 || typeof entry.kind !== "string" || !Array.isArray(entry.targets)) return undefined;
  if (!entry.targets.every((target) => typeof target === "string")) return undefined;
  const scroll = entry.scroll;
  const validScroll = scroll === null || (isPlainRecord(scroll) && Number.isFinite(scroll.x) && Number.isFinite(scroll.y));
  if (!validScroll || (entry.focus !== null && typeof entry.focus !== "string")) return undefined;
  return entry as unknown as Entry;
}

/** The state with an entry in it, or undefined when the state is not a plain object to extend. */
export function stateWith(state: unknown, entry: Entry): Record<string, unknown> | undefined {
  if (state === null || state === undefined) return { [KEY]: entry };
  if (!isPlainRecord(state)) return undefined;
  return { ...state, [KEY]: entry };
}

function withoutHash(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

/** The key focus is stored under: `data-focus-key`, else a unique `id`, else nothing. */
export function focusKey(element: Element | null, document: Document): string | null {
  if (!element || element === document.body || element === document.documentElement) return null;
  const key = element.getAttribute("data-focus-key");
  if (key) return key;
  return element.id && document.getElementById(element.id) === element ? element.id : null;
}

function byKey(document: Document, key: string): HTMLElement | null {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-focus-key]"))) {
    if (element.getAttribute("data-focus-key") === key) return element;
  }
  return document.getElementById(key);
}

function fragmentTarget(document: Document, hash: string): HTMLElement | null {
  if (hash.length <= 1) return null;
  let name: string;
  try {
    name = decodeURIComponent(hash.slice(1));
  } catch {
    name = hash.slice(1);
  }
  return document.getElementById(name) ?? Array.from(document.querySelectorAll<HTMLElement>("a[name]")).find((anchor) => anchor.getAttribute("name") === name) ?? null;
}

export type FocusReason = "server" | "stored" | "fragment" | "heading" | "body" | "kept";

export interface FocusChoice {
  readonly reason: FocusReason;
  readonly element: HTMLElement | null;
}

/**
 * Where focus goes after a visit: the server's `autofocus` in what arrived → the stored key (on
 * `pop`) → the URL fragment's target → the main heading of what arrived → the body. Focus outside
 * what changed stays: the first three always apply, the heading and the body only when focus was
 * inside what changed or is gone.
 */
export function chooseFocus(options: {
  readonly document: Document;
  readonly updated: readonly Element[];
  readonly active: Element | null;
  readonly storedKey: string | null;
  readonly hash: string;
}): FocusChoice {
  const { document, updated, active, storedKey, hash } = options;
  const within = (selector: string): HTMLElement | null => {
    for (const root of updated) {
      if (root.matches(selector)) return root as HTMLElement;
      const found = root.querySelector<HTMLElement>(selector);
      if (found) return found;
    }
    return null;
  };
  const server = within("[autofocus]:not([disabled])");
  if (server) return { reason: "server", element: server };
  const stored = storedKey === null ? null : byKey(document, storedKey);
  if (stored) return { reason: "stored", element: stored };
  const fragment = fragmentTarget(document, hash);
  if (fragment) return { reason: "fragment", element: fragment };
  const lost = !active || !active.isConnected || active === document.body || active === document.documentElement;
  const inside = !lost && updated.some((root) => root.contains(active));
  if (!lost && !inside) return { reason: "kept", element: null };
  const heading = within("h1");
  if (heading) return { reason: "heading", element: heading };
  return { reason: "body", element: null };
}

/**
 * The targets a replaced entry records, so Back or Forward from another page still fetches what it
 * shows: those that made the entry and the replacing visit's, the page when either is the page,
 * and none that lies inside another, since a response carries the outer one only.
 */
export function replacedTargets(document: Document, kept: readonly string[], next: readonly string[]): string[] {
  if (kept.length === 0 || next.length === 0) return [];
  const all = [...new Set([...kept, ...next])];
  const nodes = all.map((target) => resolveTarget(document, target));
  return all.filter((_target, index) => {
    const node = nodes[index];
    if (node === undefined) return true;
    return !nodes.some((other, at) => other !== undefined && at !== index && (relation(node, other) === "inside" || (relation(node, other) === "same" && at < index)));
  });
}

function focus(element: HTMLElement): void {
  if (element.tabIndex < 0 && !element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
  element.focus({ preventScroll: true });
}

export interface HistoryOptions {
  readonly kernel: Kernel;
  /** How long scroll must rest before the current entry records it. Default 150 ms. */
  readonly scrollDebounceMs?: number;
  /** The longest focus and scroll wait for enhancement after a commit. Default 1000 ms. */
  readonly settleMs?: number;
  /** Reloads the page the browser is on. Default `location.reload`. */
  readonly reload?: () => void;
}

export interface History extends VisitHistory {
  /** Gives back and forward the transport to fetch with. */
  attach(transport: Transport): void;
}

/**
 * Owns history while the kernel lives: stamps the current entry, keeps its scroll up to date,
 * sets `scrollRestoration` to manual (restored at disposal), and answers `popstate`.
 */
export function createHistory(options: HistoryOptions): History {
  const { kernel } = options;
  const { document } = kernel;
  const window = kernel.window as Window & typeof globalThis;
  const reload = options.reload ?? (() => {
    window.location.reload();
  });
  const debounceMs = options.scrollDebounceMs ?? 150;
  const settleMs = options.settleMs ?? 1000;
  let transport: Transport | undefined;
  let rendered = withoutHash(window.location.href);
  let popped: Entry | undefined;
  let token = 0;
  /** Counts the user's scrolling input, so a settle can tell whether the user moved meanwhile. */
  let interactions = 0;

  const update = (patch: Partial<Entry>): void => {
    const entry = readEntry(window.history.state);
    if (!entry) return;
    const next = stateWith(window.history.state, { ...entry, ...patch });
    if (next) window.history.replaceState(next, "");
  };

  const prior = window.history.scrollRestoration;
  window.history.scrollRestoration = "manual";
  kernel.own("service", "history:scroll-restoration", () => {
    window.history.scrollRestoration = prior;
  });
  const first = stateWith(window.history.state, { v: 1, kind: "visit", targets: [], scroll: { x: window.scrollX, y: window.scrollY }, focus: null });
  if (first) window.history.replaceState(first, "");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const recordScroll = (): void => {
    clearTimeout(timer);
    timer = undefined;
    update({ scroll: { x: window.scrollX, y: window.scrollY } });
  };
  kernel.own("service", "history:scroll-timer", () => {
    clearTimeout(timer);
  });
  kernel.listen("history:scroll", window, "scroll", () => {
    clearTimeout(timer);
    timer = setTimeout(recordScroll, debounceMs);
  }, { passive: true });
  kernel.listen("history:pagehide", window, "pagehide", recordScroll);
  for (const type of ["wheel", "touchmove", "keydown"]) {
    kernel.listen(`history:${type}`, window, type, () => {
      interactions++;
    }, { passive: true });
  }

  kernel.listen("history:popstate", window, "popstate", (event) => {
    const url = window.location.href;
    if (withoutHash(url) === rendered) return;
    const entry = readEntry((event as PopStateEvent).state);
    if (!entry || !transport) {
      reload();
      return;
    }
    popped = entry;
    void transport.request({ kind: "visit", url, targets: entry.targets, history: "pop" }).then((outcome) => {
      if (outcome.status !== "committed" && outcome.status !== "superseded" && outcome.status !== "full-load") reload();
    });
  });

  /** After enhancement, the latest visit only: focus, then scroll. */
  const settle = async (mode: TesseraRequest["history"], updated: readonly TargetNode[], entry: Entry | undefined): Promise<void> => {
    const mine = ++token;
    const interactionsAtCommit = interactions;
    const activeAtCommit = document.activeElement;
    await Promise.race([kernel.whenEnhanced().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, settleMs))]);
    if (mine !== token || kernel.disposed) return;

    if (document.activeElement === activeAtCommit) {
      const choice = chooseFocus({
        document,
        updated: updated.flatMap(busyElements),
        active: document.activeElement,
        storedKey: mode === "pop" ? (entry?.focus ?? null) : null,
        hash: window.location.hash,
      });
      if (choice.element) focus(choice.element);
      else if (choice.reason === "body" && document.activeElement instanceof window.HTMLElement) document.activeElement.blur();
    }
    if (interactions !== interactionsAtCommit) return;
    const fragment = fragmentTarget(document, window.location.hash);
    if (mode === "pop" && entry?.scroll) window.scrollTo(entry.scroll.x, entry.scroll.y);
    else if (fragment) fragment.scrollIntoView();
    else window.scrollTo(0, 0);
  };

  return {
    attach(next) {
      transport = next;
    },
    capture() {
      update({ scroll: { x: window.scrollX, y: window.scrollY }, focus: focusKey(document.activeElement, document) });
    },
    commit(url, request, updated) {
      const entry: Entry = { v: 1, kind: request.kind, targets: [...request.targets], scroll: null, focus: null };
      let restoring: Entry | undefined;
      if (request.history === "push") {
        window.history.pushState(stateWith(null, entry), "", url);
      } else if (request.history === "replace") {
        // The entry stays the one the user is on: it keeps the scroll and focus `capture` stored,
        // and Tessera moves neither, as after a refresh.
        const current = readEntry(window.history.state);
        const targets = current ? replacedTargets(document, current.targets, entry.targets) : entry.targets;
        const next = stateWith(window.history.state, { ...entry, targets, scroll: current?.scroll ?? null, focus: current?.focus ?? null });
        window.history.replaceState(next ?? window.history.state, "", url);
        rendered = withoutHash(window.location.href);
        return;
      } else if (request.history === "pop") {
        restoring = popped;
        popped = undefined;
      }
      rendered = withoutHash(window.location.href);
      void settle(request.history, updated, restoring);
    },
  };
}
