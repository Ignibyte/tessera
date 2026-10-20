// The attributes: applies registered directives to a subtree and keeps them in step with the
// DOM. Rewritten from jqstar `src/declarative.ts` (`DeclarativeApplication`) against the DOM,
// with every built-in a registry definition (src/builtins.ts) and every resource a directive
// takes owned through the kernel's ledger, with its element as the root, so it is released
// exactly once: by an attribute change, by the element leaving the document, by a render
// removing it, or by the mount's destruction.
import type { ActionSeam } from "./actions.ts";
import type {
  Directive,
  DirectiveCleanup,
  DirectiveContext,
  DirectiveRegistry,
  ParsedDirectiveAttribute,
} from "./directive.ts";
import { isElementNode } from "./dom.ts";
import { attempt, throwCollectedErrors } from "./errors.ts";
import type { ExpressionContext, ExpressionEngine } from "./expression.ts";
import type { Kernel, Mount, MountLifecycle, ResourceKind } from "./kernel.ts";
import { reactive, stop } from "./reactivity.ts";
import type { ReactiveEffect, Scheduler } from "./reactivity.ts";
import { Scopes } from "./scopes.ts";
import type { ScopeLevel, ScopeOwner } from "./scopes.ts";
import { isThenable } from "./values.ts";

/** The event a directive failure raises on its element when no `report` option is given. */
export const ERROR_EVENT = "tessera:error";

export interface AttributeFailure {
  readonly error: unknown;
  readonly element: Element;
  readonly attribute: string;
  readonly expression: string;
}

export interface AttributesOptions {
  readonly kernel: Kernel;
  readonly scheduler: Scheduler;
  readonly expressions: ExpressionEngine;
  readonly registry: DirectiveRegistry;
  readonly actions: ActionSeam;
  /** The document's scope; a reactive object is made when none is given. */
  readonly signals?: Record<string, unknown>;
  /** Receives every directive failure; without it, failures raise `tessera:error`. */
  readonly report?: (failure: AttributeFailure) => void;
}

export interface AttributesMount extends Mount {
  /** The document's scope. */
  readonly signals: Record<string, unknown>;
  readonly scopes: Scopes;
  /**
   * Re-runs the effects of the directives on these elements, for a patch that morphed them back
   * to the server's markup (a morph empties what `data-text` wrote, drops what `data-class` added).
   */
  refresh(elements: Iterable<Element>): void;
}

interface MountedDirective {
  active: boolean;
  attribute: ParsedDirectiveAttribute<unknown>;
  readonly directive: Directive<unknown>;
  readonly element: Element;
  /** The element's scope chain when it mounted; a move that changes it remounts. */
  readonly owners: readonly ScopeOwner[];
  readonly releases: (() => void)[];
  readonly effects: ReactiveEffect[];
}

let mountId = 0;

class Attributes implements AttributesMount, MountLifecycle {
  readonly root: Element;
  readonly signals: Record<string, unknown>;
  readonly scopes: Scopes;

  readonly #options: AttributesOptions;
  readonly #owner = `attributes:${++mountId}`;
  readonly #byElement = new WeakMap<Element, Map<string, MountedDirective>>();
  readonly #active = new Set<MountedDirective>();
  #releaseObserver: (() => void) | undefined;
  #destroyed = false;

  constructor(root: Element, options: AttributesOptions) {
    const { kernel } = options;
    if (!isElementNode(root) || root.ownerDocument !== kernel.document || !root.isConnected) {
      throw new Error("Attributes mount on a connected element of the kernel's Document.");
    }
    this.root = root;
    this.#options = options;
    this.signals = options.signals ?? reactive({});
    this.scopes = new Scopes(kernel, this.signals);
    kernel.track(this, this);
    try {
      this.#releaseObserver = kernel.observe(
        `${this.#owner}:mutation`,
        root,
        (mutations) => {
          this.#handleMutations(mutations);
        },
        { attributes: true, childList: true, subtree: true },
      ).release;
      this.#scan(root, []);
    } catch (error) {
      const errors = [error];
      attempt(errors, () => {
        this.destroy();
      });
      throwCollectedErrors(errors, "Tessera attributes setup failed.");
    }
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    const errors: unknown[] = [];
    const releaseObserver = this.#releaseObserver;
    this.#releaseObserver = undefined;
    if (releaseObserver) attempt(errors, releaseObserver);
    for (const record of [...this.#active].reverse()) attempt(errors, () => { this.#release(record); });
    attempt(errors, () => {
      this.scopes.dispose();
    });
    this.#options.kernel.untrack(this);
    throwCollectedErrors(errors, "Tessera attributes destruction failed.");
  }

  /** Called by a render removing `tree` from inside this mount: its directives, then its scopes. */
  releaseTree(tree: Element, preservedRoots: readonly Element[]): void {
    const errors: unknown[] = [];
    attempt(errors, () => {
      this.#releaseDirectives(tree, preservedRoots);
    });
    attempt(errors, () => {
      this.scopes.release(tree, preservedRoots);
    });
    throwCollectedErrors(errors, "Tessera attributes subtree release failed.");
  }

  #releaseDirectives(tree: Element, preservedRoots: readonly Element[]): void {
    const errors: unknown[] = [];
    for (const element of [tree, ...Array.from(tree.querySelectorAll("*"))]) {
      if (preservedRoots.some((preserved) => preserved.contains(element))) continue;
      const records = this.#byElement.get(element);
      if (!records) continue;
      for (const record of [...records.values()]) attempt(errors, () => { this.#release(record); });
    }
    throwCollectedErrors(errors, "Tessera attributes subtree release failed.");
  }

  // --- Scanning ----------------------------------------------------------------------------

  #ignored(element: Element, preservedRoots: readonly Element[]): boolean {
    return (
      !this.root.contains(element) ||
      element.closest("[data-ignore]") !== null ||
      element.hasAttribute("data-ignore__self") ||
      preservedRoots.some((preserved) => preserved.contains(element))
    );
  }

  /** Applies a subtree's directives by priority across the subtree, then in document order. */
  #scan(tree: Element, preservedRoots: readonly Element[]): void {
    const entries: { element: Element; name: string; priority: number; order: number }[] = [];
    for (const element of [tree, ...Array.from(tree.querySelectorAll("*"))]) {
      if (this.#ignored(element, preservedRoots)) continue;
      for (const { name, value } of Array.from(element.attributes)) {
        let priority: number;
        try {
          const match = this.#options.registry.match(name, value);
          if (!match) continue;
          priority = match.directive.priority ?? 0;
        } catch (error) {
          this.#report(error, element, name, value);
          continue;
        }
        entries.push({ element, name, priority, order: entries.length });
      }
    }
    entries.sort((left, right) => right.priority - left.priority || left.order - right.order);
    for (const { element, name } of entries) {
      if (this.#destroyed) return;
      this.#reconcile(element, name);
    }
  }

  /** Brings one attribute's directive in line with its current value. */
  #reconcile(element: Element, name: string): void {
    const value = element.getAttribute(name);
    const current = this.#byElement.get(element)?.get(name);
    const releaseCurrent = (): void => {
      if (current) this.#release(current);
    };
    if (value === null || this.#ignored(element, [])) {
      releaseCurrent();
      return;
    }
    let match;
    try {
      match = this.#options.registry.match(name, value);
    } catch (error) {
      releaseCurrent();
      this.#report(error, element, name, value);
      return;
    }
    if (!match) {
      releaseCurrent();
      return;
    }
    const { directive, attribute } = match;
    if (current?.directive === directive && current.attribute.value === value) return;

    if (current?.directive === directive && directive.update) {
      try {
        const result = directive.update(this.#context(current, attribute, current.attribute));
        this.#keep(current, result);
        current.attribute = attribute;
      } catch (error) {
        releaseCurrent();
        this.#report(error, element, name, value);
      }
      return;
    }

    releaseCurrent();
    const record: MountedDirective = {
      active: true,
      attribute,
      directive,
      element,
      owners: this.scopes.owners(element),
      releases: [],
      effects: [],
    };
    let records = this.#byElement.get(element);
    if (!records) {
      records = new Map();
      this.#byElement.set(element, records);
    }
    records.set(name, record);
    this.#active.add(record);
    try {
      this.#keep(record, directive.mount(this.#context(record, attribute)));
    } catch (error) {
      this.#release(record);
      this.#report(error, element, name, value);
    }
  }

  /** Owns the cleanup a directive's mount or update returned. */
  #keep(record: MountedDirective, result: DirectiveCleanup | undefined): void {
    if (result === undefined) return;
    if (typeof result !== "function") {
      throw new TypeError(`data-${record.directive.name} must return a cleanup function or nothing.`);
    }
    if (record.active) this.#own(record, "service", result);
    else result();
  }

  #release(record: MountedDirective): void {
    if (!record.active) return;
    record.active = false;
    this.#active.delete(record);
    const records = this.#byElement.get(record.element);
    if (records?.get(record.attribute.name) === record) records.delete(record.attribute.name);
    const releases = record.releases.splice(0).reverse();
    const errors: unknown[] = [];
    for (const release of releases) attempt(errors, release);
    throwCollectedErrors(errors, `data-${record.directive.name} cleanup failed.`);
  }

  // --- Directive contexts ------------------------------------------------------------------

  #expressionContext(element: Element, owners: readonly ScopeOwner[]): ExpressionContext {
    return {
      element,
      signals: this.scopes.signalsFor(element, owners),
      helpers: this.#options.registry.helpers(),
      actions: this.#options.actions,
    };
  }

  #assertActive(record: MountedDirective): void {
    if (this.#destroyed || !record.active) {
      throw new Error(`data-${record.directive.name} on this element has already been released.`);
    }
  }

  #own(record: MountedDirective, kind: ResourceKind, cleanup: () => void): () => void {
    this.#assertActive(record);
    const release = this.#options.kernel.own(kind, `${this.#owner}:${record.attribute.name}`, cleanup, record.element);
    record.releases.push(release);
    return release;
  }

  #context(
    record: MountedDirective,
    attribute: ParsedDirectiveAttribute<unknown>,
    previous?: ParsedDirectiveAttribute<unknown>,
  ): DirectiveContext<unknown> {
    const { element } = record;
    const { kernel, scheduler } = this.#options;
    const owner = `${this.#owner}:${attribute.name}`;
    const report = (error: unknown): void => {
      this.#report(error, element, attribute.name, attribute.value);
    };
    return Object.freeze({
      attribute,
      context: this.#expressionContext(element, record.owners),
      element,
      expressions: this.#options.expressions,
      ...(previous ? { previous } : {}),
      cleanup: (cleanup: DirectiveCleanup) => this.#own(record, "service", cleanup),
      scope: (level: ScopeLevel = "nearest") => this.scopes.scopeFor(element, level),
      effect: (run: () => void) => {
        let runner: ReactiveEffect | undefined;
        const release = this.#own(record, "effect", () => {
          if (runner) stop(runner);
        });
        try {
          runner = scheduler.effect(run, { owner, onError: report });
          record.effects.push(runner);
        } catch (error) {
          release();
          throw error;
        }
        if (!record.active) stop(runner);
        return release;
      },
      listen: (target: EventTarget, type: string, listener: (event: Event) => void, options?: AddEventListenerOptions) => {
        this.#assertActive(record);
        const release = kernel.listen(owner, target, type, listener, options, element);
        record.releases.push(release);
        return release;
      },
      report,
      task: (task: (signal: AbortSignal) => PromiseLike<unknown>) => {
        const controller = new AbortController();
        const abort = this.#own(record, "task", () => {
          controller.abort();
        });
        const result = task(controller.signal);
        if (!isThenable(result)) {
          abort();
          throw new TypeError(`A data-${record.directive.name} task must return a promise.`);
        }
        const releaseTask = kernel.task(owner, result, report);
        record.releases.push(releaseTask);
        return () => {
          abort();
          releaseTask();
        };
      },
    });
  }

  // --- The DOM changing --------------------------------------------------------------------

  #handleMutations(mutations: MutationRecord[]): void {
    const { kernel } = this.#options;
    const errors: unknown[] = [];
    for (const mutation of mutations) {
      if (this.#destroyed) return;
      if (mutation.type === "attributes") {
        const element = mutation.target as Element;
        const name = mutation.attributeName;
        if (!name || !this.root.contains(element)) continue;
        if (name === "data-ignore" || name === "data-ignore__self") {
          const ignored = element.hasAttribute(name);
          if (ignored && name === "data-ignore") attempt(errors, () => { this.#releaseDirectives(element, []); });
          else if (ignored) attempt(errors, () => { this.#releaseElement(element); });
          else attempt(errors, () => { this.#scan(element, []); });
          continue;
        }
        attempt(errors, () => { this.#reconcile(element, name); });
        continue;
      }
      for (const node of Array.from(mutation.removedNodes)) {
        if (isElementNode(node) && node.isConnected && this.root.contains(node)) {
          // Moved within the mount: keep what still sees the same scopes.
          attempt(errors, () => {
            this.#rebindMoved(node);
          });
          continue;
        }
        const preserved = isElementNode(node) ? kernel.preservedRootsWithin(node) : [];
        if (isElementNode(node)) {
          attempt(errors, () => {
            this.#releaseDirectives(node, preserved);
          });
        }
        // A scope survives a move within the page; only what left the document goes.
        attempt(errors, () => {
          this.scopes.release(node, preserved, true);
        });
      }
      for (const node of Array.from(mutation.addedNodes)) {
        if (!isElementNode(node) || !node.isConnected || !this.root.contains(node)) continue;
        attempt(errors, () => { this.#scan(node, kernel.preservedRootsWithin(node)); });
      }
    }
    for (const error of errors) this.#report(error, this.root, "", "");
  }

  /** Releases the directives in a moved subtree whose scope chain or ignored state changed. */
  #rebindMoved(tree: Element): void {
    const errors: unknown[] = [];
    for (const element of [tree, ...Array.from(tree.querySelectorAll("*"))]) {
      const records = this.#byElement.get(element);
      if (!records) continue;
      const owners = this.scopes.owners(element);
      const ignored = this.#ignored(element, []);
      for (const record of [...records.values()]) {
        const same = record.owners.length === owners.length && record.owners.every((owner, index) => owner === owners[index]);
        if (ignored || !same) attempt(errors, () => { this.#release(record); });
      }
    }
    throwCollectedErrors(errors, "Tessera attributes move failed.");
  }

  refresh(elements: Iterable<Element>): void {
    for (const element of elements) {
      for (const record of this.#byElement.get(element)?.values() ?? []) {
        for (const runner of record.effects) {
          if (!runner.active) continue;
          try {
            runner();
          } catch (error) {
            this.#report(error, element, record.attribute.name, record.attribute.value);
          }
        }
      }
    }
  }

  #releaseElement(element: Element): void {
    const records = this.#byElement.get(element);
    const errors: unknown[] = [];
    for (const record of [...(records?.values() ?? [])]) attempt(errors, () => { this.#release(record); });
    throwCollectedErrors(errors, "Tessera attributes element release failed.");
  }

  #report(error: unknown, element: Element, attribute: string, expression: string): void {
    const failure: AttributeFailure = Object.freeze({ error, element, attribute, expression });
    if (this.#options.report) {
      this.#options.report(failure);
      return;
    }
    const window = this.#options.kernel.window as Window & typeof globalThis;
    const target = element.isConnected ? element : this.root;
    const event = new window.CustomEvent(ERROR_EVENT, { bubbles: true, cancelable: true, detail: failure });
    if (target.dispatchEvent(event)) window.console.error(failure.error);
  }
}

/**
 * Applies the registry's directives to `root` and its descendants, and keeps them applied as
 * the DOM changes. The mount is tracked by the kernel; `destroy()` releases everything.
 */
export function mountAttributes(root: Element, options: AttributesOptions): AttributesMount {
  return new Attributes(root, options);
}
