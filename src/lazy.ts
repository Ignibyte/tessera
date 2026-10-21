// Lazy regions: `data-lazy="URL"` loads the element's target once it is rendered, and
// `data-lazy__visible="URL"` once it scrolls into view (docs/protocol.md, section 3). Livewire's
// lazy placeholders (`__lazyLoad` on init or intersect), rebuilt as a plain refresh of a region or
// component through the transport.
import { ERROR_EVENT } from "./attributes.ts";
import type { DirectiveAttribute } from "./directive.ts";
import type { Kernel } from "./kernel.ts";
import type { Transport } from "./transport.ts";
import { protocolAttributes, refreshTargets, watchProtocolAttribute } from "./watch.ts";

export interface LazyOptions {
  readonly kernel: Kernel;
  readonly transport: Transport;
  readonly report?: (error: unknown, element: Element) => void;
}

class LazyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LazyError";
  }
}

/** Loads every lazy element on the document once, now and as they arrive. */
export function loadLazyRegions(options: LazyOptions): void {
  const { kernel, transport } = options;
  const window = kernel.window as Window & typeof globalThis;
  const started = new WeakSet<Element>();

  const report = (error: unknown, element: Element): void => {
    if (options.report) {
      options.report(error, element);
      return;
    }
    const event = new window.CustomEvent(ERROR_EVENT, { bubbles: true, cancelable: true, detail: { error, element } });
    if (element.dispatchEvent(event)) window.console.error(error);
  };

  const load = (element: Element, url: string): void => {
    if (!element.isConnected) return;
    void transport.request({ kind: "refresh", url, targets: refreshTargets(element), element });
  };

  watchProtocolAttribute(kernel, "lazy", (element) => {
    if (started.has(element) || !kernel.canOwn(element, true)) return;
    let attributes: DirectiveAttribute[];
    try {
      attributes = protocolAttributes(element, "lazy");
    } catch (error) {
      report(error, element);
      return;
    }
    const [attribute] = attributes;
    if (!attribute || attributes.length > 1) {
      report(new LazyError("An element carries one data-lazy attribute."), element);
      return;
    }
    const { name, value, modifiers } = attribute;
    const visible = modifiers.length === 1 && modifiers[0]?.name === "visible" && modifiers[0].args.length === 0;
    if (modifiers.length > 0 && !visible) {
      report(new LazyError(`${name} has a modifier data-lazy does not take; it takes visible.`), element);
      return;
    }
    started.add(element);
    if (!visible || typeof window.IntersectionObserver !== "function") {
      load(element, value);
      return;
    }
    const observer = new window.IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      release();
      load(element, value);
    });
    const release = kernel.own("observer", "lazy:visible", () => {
      observer.disconnect();
    }, element);
    observer.observe(element);
  });
}
