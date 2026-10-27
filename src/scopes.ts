// Signal scopes: the document, each region and each component own one, and an element sees
// the chain from its innermost scope out to the document. This replaces jqstar's one state
// object per application root (digest section 3), the cause of the global-signal collisions
// old AIC hit with Datastar (AIC #423/#436). Also builds what a request sends: the signals of
// one element's chain (docs/protocol.md, section 4.4).
import type { Kernel } from "./kernel.ts";
import { notifyPropertyChange, reactive, toRaw } from "./reactivity.ts";
import { isPlainRecord } from "./values.ts";

export type ScopeLevel = "nearest" | "region" | "document";

/** A scope's owner: a region element, a component element, or the document. */
export type ScopeOwner = Element | Document;

/** The longest `Tessera-Signals` value Tessera sends (docs/protocol.md, section 4.4). */
export const MAX_SIGNALS_BYTES = 4096;

interface ScopeRecord {
  readonly signals: Record<string, unknown>;
  readonly key: string | undefined;
  readonly release: () => void;
}

function isComponent(element: Element): boolean {
  return element.hasAttribute("data-t-c");
}

/** What a scope remembers of its owner: a component's key, a region's name. */
function keyOf(owner: Element): string | undefined {
  return (isComponent(owner) ? owner.getAttribute("data-t-c") : owner.getAttribute("data-region")) ?? undefined;
}

/** Whether a node owns a scope: a component element or a region element. */
export function isScopeOwner(node: Node): node is Element {
  return node.nodeType === 1 && ((node as Element).hasAttribute("data-t-c") || (node as Element).hasAttribute("data-region"));
}

/**
 * The owners of a node's scopes, innermost first, ending with the document: the node itself if
 * it is a component or a region, then each enclosing component and region.
 */
export function scopeOwners(start: Element): ScopeOwner[] {
  const owners: ScopeOwner[] = [];
  for (let element: Element | null = start; element; element = element.parentElement) {
    if (isScopeOwner(element)) owners.push(element);
  }
  owners.push(start.ownerDocument);
  return owners;
}

/**
 * The target spelling of a scope's owner (docs/protocol.md, section 2.4): a region's name, or a
 * component's path from its nearest region (or `page`).
 */
export function ownerPath(owner: Element): string {
  if (!isComponent(owner)) return owner.getAttribute("data-region") ?? "";
  const keys: string[] = [];
  let base = "page";
  for (let element: Element | null = owner; element; element = element.parentElement) {
    if (element !== owner && element.hasAttribute("data-region")) {
      base = element.getAttribute("data-region") ?? "";
      break;
    }
    if (isComponent(element)) keys.unshift(element.getAttribute("data-t-c") ?? "");
  }
  return [base, ...keys].join("/");
}

let scopesId = 0;

export class Scopes {
  /** The document's scope. */
  readonly document: Record<string, unknown>;

  readonly #kernel: Kernel;
  readonly #owner = `scopes:${++scopesId}`;
  readonly #records = new Map<Element, ScopeRecord>();
  #disposed = false;

  constructor(kernel: Kernel, documentSignals: Record<string, unknown> = reactive({})) {
    this.#kernel = kernel;
    this.document = documentSignals;
  }

  /** The owners of a node's scopes, innermost first, ending with the document. */
  owners(start: Element): ScopeOwner[] {
    return scopeOwners(start);
  }

  /**
   * The target spelling of a scope's owner (docs/protocol.md, section 2.4): a region's name, or a
   * component's path from its nearest region (or `page`).
   */
  pathOf(owner: Element): string {
    return ownerPath(owner);
  }

  /** The scope an owner holds, created on first use, started afresh if a component's key changed. */
  scopeOf(owner: ScopeOwner): Record<string, unknown> {
    if (owner.nodeType === 9) return this.document;
    const node = owner as Element;
    const key = keyOf(node);
    const current = this.#records.get(node);
    if (current && current.key === key) return current.signals;
    if (current) this.#dispose(node, current);
    if (this.#disposed) throw new Error("These Tessera scopes have been disposed.");
    const signals = reactive<Record<string, unknown>>({});
    const label = isComponent(node) ? `component:${key ?? ""}` : `region:${key ?? ""}`;
    const release = this.#kernel.own("service", `${this.#owner}:${label}`, () => {
      if (this.#records.get(node)?.signals === signals) this.#records.delete(node);
    });
    this.#records.set(node, { signals, key, release });
    return signals;
  }

  /** The scope `data-signals` and its modifiers declare into, for an element. */
  scopeFor(element: Element, level: ScopeLevel): Record<string, unknown> {
    if (level === "document") return this.document;
    const owners = this.owners(element);
    const owner =
      level === "nearest"
        ? owners[0]
        : owners.find((candidate) => candidate.nodeType === 1 && (candidate as Element).hasAttribute("data-region"));
    return this.scopeOf(owner ?? element.ownerDocument);
  }

  /**
   * What `$name` sees from an element: reads take the innermost scope that has the name,
   * writes go to that scope, or to the nearest one when none has it.
   */
  signalsFor(element: Element, owners: readonly ScopeOwner[] = this.owners(element)): Record<string, unknown> {
    for (const owner of owners) this.scopeOf(owner);
    const chain = (): Record<string, unknown>[] => owners.map((owner) => this.scopeOf(owner));
    const holder = (name: PropertyKey): Record<string, unknown> | undefined =>
      chain().find((scope) => name in scope);
    const nearest = (): Record<string, unknown> => chain()[0] ?? this.document;

    return new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_target, name) => holder(name)?.[name as string],
      set: (_target, name, value) => Reflect.set(holder(name) ?? nearest(), name, value),
      has: (_target, name) => holder(name) !== undefined,
      deleteProperty: (_target, name) => {
        const scope = holder(name);
        return scope ? Reflect.deleteProperty(scope, name) : true;
      },
      ownKeys: () => [...new Set(chain().flatMap((scope) => Reflect.ownKeys(scope)))],
      getOwnPropertyDescriptor: (_target, name) => {
        const scope = holder(name);
        const descriptor = scope ? Reflect.getOwnPropertyDescriptor(toRaw(scope), name) : undefined;
        return descriptor ? { ...descriptor, configurable: true } : undefined;
      },
      defineProperty: (_target, name, descriptor) => {
        const scope = nearest();
        const defined = Reflect.defineProperty(scope, name, descriptor);
        if (defined) notifyPropertyChange(scope, name);
        return defined;
      },
    });
  }

  /**
   * Hands a scope to the element replacing its owner: a component with the same key, or a region
   * with the same name. Any other replacement starts afresh. A list of
   * pairs moves together, so two owners can trade places (a morph that reorders components).
   */
  transfer(from: Element, to: Element): void;
  transfer(pairs: readonly (readonly [Element, Element])[]): void;
  transfer(
    first: Element | readonly (readonly [Element, Element])[],
    second?: Element,
  ): void {
    const pairs: readonly (readonly [Element, Element])[] =
      "nodeType" in first ? (second ? [[first, second]] : []) : first;
    const moving = pairs.flatMap(([from, to]) => {
      const record = this.#records.get(from);
      if (!record) return [];
      this.#records.delete(from);
      return [{ record, from, to }];
    });
    for (const { record, from, to } of moving) {
      if (isComponent(from) !== isComponent(to) || record.key !== keyOf(to) || this.#records.has(to)) record.release();
      else this.#records.set(to, record);
    }
  }

  /**
   * Disposes the scopes owned inside `tree` (the tree itself included), except inside the
   * preserved roots. With `onlyDetached`, scopes whose owner is still in the document (a move)
   * are kept.
   */
  release(tree: Node, preservedRoots: readonly Element[] = [], onlyDetached = false): void {
    for (const [owner, record] of [...this.#records]) {
      if (owner !== tree && !tree.contains(owner)) continue;
      if (onlyDetached && owner.isConnected) continue;
      if (preservedRoots.some((preserved) => preserved.contains(owner))) continue;
      this.#dispose(owner, record);
    }
  }

  dispose(): void {
    this.#disposed = true;
    for (const [owner, record] of [...this.#records]) this.#dispose(owner, record);
  }

  #dispose(owner: Element, record: ScopeRecord): void {
    if (this.#records.get(owner) === record) this.#records.delete(owner);
    record.release();
  }

  /**
   * The signals a request from `element` carries: each name visible from it once, the
   * innermost scope's value winning, with `_` names, computed signals and values JSON cannot
   * carry left out (docs/protocol.md, section 4.4).
   */
  payload(element: Element): Record<string, unknown> {
    const visible = new Map<string, unknown>();
    for (const scope of this.owners(element).map((owner) => this.scopeOf(owner)).reverse()) {
      for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(toRaw(scope)))) {
        visible.delete(name);
        if ("value" in descriptor) visible.set(name, descriptor.value);
      }
    }
    return sendable(Object.fromEntries(visible), "", new Set()) as Record<string, unknown>;
  }
}

/** A value as a request sends it; undefined when it is left out. */
function sendable(value: unknown, path: string, seen: Set<object>): unknown {
  const raw = toRaw(value);
  if (raw === null || typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const container = Array.isArray(raw) || isPlainRecord(raw);
  if (!container) return undefined;
  if (seen.has(raw)) throw new TypeError(`The signal ${path} refers to itself and cannot be sent.`);
  seen.add(raw);
  try {
    if (Array.isArray(raw)) {
      return raw.map((item: unknown, index) => sendable(item, `${path}[${index}]`, seen) ?? null);
    }
    const result: Record<string, unknown> = {};
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(raw))) {
      if (name.startsWith("_") || !("value" in descriptor)) continue;
      const child = sendable(descriptor.value, path ? `${path}.${name}` : name, seen);
      if (child !== undefined) result[name] = child;
    }
    return result;
  } finally {
    seen.delete(raw);
  }
}

/**
 * The `Tessera-Signals` header value: compact JSON, every character above U+007E escaped, at
 * most 4,096 bytes.
 */
export function encodeSignals(payload: Record<string, unknown>): string {
  const ascii = JSON.stringify(payload).replace(
    /[\u007f-￿]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  if (ascii.length > MAX_SIGNALS_BYTES) {
    throw new RangeError(
      `Tessera-Signals would be ${ascii.length} bytes; the limit is ${MAX_SIGNALS_BYTES}. ` +
        "State that large belongs in the request body, the URL or the session.",
    );
  }
  return ascii;
}
