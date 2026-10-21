// Polling: `data-poll="URL"` refreshes the element's target every 2 seconds, `data-poll__5s` or
// `data-poll__750ms` on another interval (docs/protocol.md, section 3). Livewire's heuristics: one
// shared clock per interval, so polls with the same interval fire together; only one tick in 20
// while the window is in the background; none while the page is hidden or the browser offline.
// A poll yields to every overlapping request in the transport (protocol 4.6).
import { ERROR_EVENT } from "./attributes.ts";
import type { DirectiveAttribute } from "./directive.ts";
import type { Kernel } from "./kernel.ts";
import type { Transport } from "./transport.ts";
import { protocolAttributes, refreshTargets, watchProtocolAttribute } from "./watch.ts";

export const DEFAULT_POLL_MS = 2000;

/** In the background, one tick in this many fires (Livewire skips 95%). */
export const BACKGROUND_EVERY = 20;

const DURATION = /^([0-9]+)(ms|s)$/;

class PollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PollError";
  }
}

/** The interval a `data-poll` attribute names, in milliseconds. Throws on a bad modifier. */
export function pollInterval(attribute: DirectiveAttribute): number {
  const [modifier, ...rest] = attribute.modifiers;
  if (!modifier) return DEFAULT_POLL_MS;
  const match = DURATION.exec(modifier.name);
  if (rest.length > 0 || modifier.args.length > 0 || !match) {
    throw new PollError(`${attribute.name} takes one duration modifier, such as __5s or __750ms.`);
  }
  const ms = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
  if (ms < 100) throw new PollError(`${attribute.name} polls more often than every 100 ms.`);
  return ms;
}

/**
 * Shared clocks: one timer per interval, started by its first subscriber and stopped with its
 * last, each tick numbered from 1 and handed to every subscriber.
 */
export class Clocks {
  readonly #kernel: Kernel;
  readonly #clocks = new Map<number, { readonly subscribers: Set<(tick: number) => void>; readonly stop: () => void }>();

  constructor(kernel: Kernel) {
    this.#kernel = kernel;
  }

  /** The intervals with a running timer. */
  get intervals(): number[] {
    return [...this.#clocks.keys()];
  }

  join(ms: number, subscriber: (tick: number) => void): () => void {
    let clock = this.#clocks.get(ms);
    if (!clock) {
      const subscribers = new Set<(tick: number) => void>();
      let tick = 0;
      const timer = setInterval(() => {
        tick++;
        for (const each of [...subscribers]) each(tick);
      }, ms);
      const stop = this.#kernel.own("task", `poll-clock:${ms}`, () => {
        clearInterval(timer);
        if (this.#clocks.get(ms)?.subscribers === subscribers) this.#clocks.delete(ms);
      });
      clock = { subscribers, stop };
      this.#clocks.set(ms, clock);
    }
    const joined = clock;
    joined.subscribers.add(subscriber);
    return () => {
      joined.subscribers.delete(subscriber);
      if (joined.subscribers.size === 0) joined.stop();
    };
  }
}

export interface PollingOptions {
  readonly kernel: Kernel;
  readonly transport: Transport;
  readonly report?: (error: unknown, element: Element) => void;
}

export interface Polling {
  readonly clocks: Clocks;
}

/** Polls every `data-poll` element on the document, now and as they arrive. */
export function startPolling(options: PollingOptions): Polling {
  const { kernel, transport } = options;
  const { document } = kernel;
  const window = kernel.window as Window & typeof globalThis;
  const clocks = new Clocks(kernel);
  const polls = new WeakMap<Element, { readonly name: string; readonly value: string; readonly release: () => void }>();

  const report = (error: unknown, element: Element): void => {
    if (options.report) {
      options.report(error, element);
      return;
    }
    const event = new window.CustomEvent(ERROR_EVENT, { bubbles: true, cancelable: true, detail: { error, element } });
    if (element.dispatchEvent(event)) window.console.error(error);
  };

  /** Whether a poll fires on this tick of its clock. */
  const fires = (tick: number): boolean => {
    if (document.visibilityState === "hidden" || !window.navigator.onLine) return false;
    return document.hasFocus() || tick % BACKGROUND_EVERY === 0;
  };

  watchProtocolAttribute(kernel, "poll", (element) => {
    const held = polls.get(element);
    let attribute: DirectiveAttribute | undefined;
    let ms = DEFAULT_POLL_MS;
    try {
      const attributes = protocolAttributes(element, "poll");
      if (attributes.length > 1) throw new PollError("An element carries one data-poll attribute.");
      [attribute] = attributes;
      if (attribute) ms = pollInterval(attribute);
    } catch (error) {
      held?.release();
      polls.delete(element);
      report(error, element);
      return;
    }
    if (held && attribute && held.name === attribute.name && held.value === attribute.value) return;
    held?.release();
    polls.delete(element);
    if (!attribute || attribute.value === "" || !kernel.canOwn(element, true)) return;
    const { value: url } = attribute;
    const leave = clocks.join(ms, (tick) => {
      if (!element.isConnected || !fires(tick)) return;
      void transport.request({ kind: "refresh", url, targets: refreshTargets(element), element, poll: true });
    });
    const release = kernel.own("subscription", `poll:${url}`, leave, element);
    polls.set(element, { name: attribute.name, value: url, release });
  });

  return { clocks };
}
