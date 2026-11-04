// Patching: server markup morphed into the page, targeted by identity (docs/protocol.md,
// sections 2 and 5.3). Ported from jqstar `src/patch.ts`: Idiomorph keeping a focused field's value,
// `restoreFocus` and preserved nodes, inert parsing through `<template>`, one render transaction
// per patch. jqstar's id and CSS-selector targeting is replaced by regions and components.
//
// A region and a component are both one element (`data-region`, `data-t-c`), so every mode acts
// on that element the same way: a morph is Idiomorph on the element itself, the other modes act
// on its children. After each patch the changed element raises `tessera:patched` (src/devtools.ts).
//
// A `data-permanent` element and a `data-ignore-morph` element stay the same live nodes, unmorphed,
// only while the incoming markup brings them again; each one kept is a preserved root of the render.
// One the markup drops is removed like any other node, with its parent if that goes (#44).
import { Idiomorph } from "idiomorph";
import type { IdiomorphCallbacks } from "idiomorph";
import { createPatchedSignal } from "./devtools.ts";
import type { Kernel, RenderTransaction } from "./kernel.ts";
import { isScopeOwner, ownerPath } from "./scopes.ts";
import type { Scopes } from "./scopes.ts";
import { cloneValue, isPlainRecord } from "./values.ts";

export type PatchMode = "morph" | "inner" | "append" | "prepend" | "remove";

export const PATCH_MODES: readonly PatchMode[] = ["morph", "inner", "append", "prepend", "remove"];

const REGION_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const COMPONENT_KEY = /^[A-Za-z0-9_.:]+(-[A-Za-z0-9_.:]+)*$/;
const OWNER = "[data-t-c], [data-region]";
const IGNORE_MORPH = "[data-ignore-morph]";
const PERMANENT = "[data-permanent][id]";

/** A patch that names a target the page lacks, or brings markup that does not fit its mode. */
export class PatchError extends Error {
  readonly target: string;

  constructor(target: string, detail: string) {
    super(`Cannot patch ${target}: ${detail}`);
    this.name = "PatchError";
    this.target = target;
  }
}

/** A target found on the page: a region's element or a component's element. */
export interface Target {
  readonly kind: "region" | "component";
  readonly element: Element;
}

/** The element a component or region sits in: its nearest enclosing component or region. */
function enclosingOwner(element: Element): Element | null {
  return element.parentElement?.closest(OWNER) ?? null;
}

/**
 * The components directly under a container (a region element, a component element, or `null`
 * for the page): those whose nearest enclosing component or region is the container. Nested
 * regions start paths of their own, so the components inside them are not the container's.
 */
function childComponents(document: Document, container: Element | null, key: string): Element[] {
  const scope = container ?? document.body;
  return Array.from(scope.querySelectorAll(`[data-t-c="${key}"]`)).filter((element) => enclosingOwner(element) === container);
}

/** Finds a target by its spelling (protocol 2.6); throws a PatchError when the page lacks it. */
export function findTarget(document: Document, target: string): Target {
  if (target === "page") throw new PatchError(target, "the whole document is patched as a full document, not a fragment.");
  const [base = "", ...keys] = target.split("/");
  if (!(base === "page" && keys.length > 0) && !REGION_NAME.test(base)) {
    throw new PatchError(target, `"${base}" is not a region name.`);
  }
  for (const key of keys) if (!COMPONENT_KEY.test(key)) throw new PatchError(target, `"${key}" is not a component key.`);

  let container: Element | null = null;
  if (base !== "page") {
    const regions = document.querySelectorAll(`[data-region="${base}"]`);
    if (regions.length === 0) throw new PatchError(target, `the page has no region ${base}.`);
    if (regions.length > 1) throw new PatchError(target, `two elements are region ${base}.`);
    container = regions[0] as Element;
    if (keys.length === 0) return { kind: "region", element: container };
  }

  for (const [index, key] of keys.entries()) {
    const matches = childComponents(document, container, key);
    const path = [base, ...keys.slice(0, index + 1)].join("/");
    if (matches.length === 0) throw new PatchError(target, `the page has no component ${path}.`);
    if (matches.length > 1) throw new PatchError(target, `two components are ${path}.`);
    container = matches[0] as Element;
    if (container.hasAttribute("data-region")) throw new PatchError(target, `${path} is both a region and a component.`);
  }
  if (!container) throw new PatchError(target, "no component key.");
  return { kind: "component", element: container };
}

/**
 * Resolves each `@NAME` among `targets` to the path of the component carrying
 * `data-t-anchor="NAME"` (protocol 2.7); other targets pass unchanged. Throws a PatchError for an
 * anchor that is badly spelled, missing, doubled or on an element that is not a component.
 */
export function resolveAnchors(document: Document, targets: readonly string[]): string[] {
  return targets.map((target) => {
    if (!target.startsWith("@")) return target;
    const name = target.slice(1);
    if (!isAnchorName(name)) throw new PatchError(target, `"${name}" is not an anchor name.`);
    const anchored = document.querySelectorAll(`[data-t-anchor="${name}"]`);
    if (anchored.length === 0) throw new PatchError(target, `the page has no anchor ${name}.`);
    if (anchored.length > 1) throw new PatchError(target, `two elements carry the anchor ${name}.`);
    const element = anchored[0] as Element;
    if (!element.hasAttribute("data-t-c")) throw new PatchError(target, `the anchor ${name} is not on a component.`);
    return ownerPath(element);
  });
}

/** Whether a string is an anchor name: the key grammar, at most 64 characters (protocol 2.7). */
function isAnchorName(name: string): boolean {
  return COMPONENT_KEY.test(name) && name.length <= 64;
}

/**
 * The anchor a component element carries, as `Tessera-Targets` sends it (protocol 4.3): its
 * `data-t-anchor` when that is well-formed and no other element carries it, else undefined.
 */
export function anchorOf(document: Document, element: Element): string | undefined {
  const name = element.getAttribute("data-t-anchor");
  if (name === null || !isAnchorName(name)) return undefined;
  return document.querySelectorAll(`[data-t-anchor="${name}"]`).length === 1 ? name : undefined;
}

/** Parses markup inertly: scripts in it never run. */
function parse(document: Document, markup: string): Node[] {
  const template = document.createElement("template");
  template.innerHTML = markup;
  return Array.from(template.content.childNodes);
}

function significant(nodes: readonly Node[]): Node[] {
  return nodes.filter((node) => !(node.nodeType === 3 && (node.textContent ?? "").trim() === ""));
}

function checkMorph(target: string, resolved: Target, nodes: readonly Node[]): void {
  const [element, extra] = significant(nodes);
  const attribute = resolved.kind === "region" ? "data-region" : "data-t-c";
  const name = resolved.element.getAttribute(attribute) ?? "";
  if (!element || extra || element.nodeType !== 1 || (element as Element).getAttribute(attribute) !== name) {
    throw new PatchError(target, `a morph of a ${resolved.kind} brings exactly one element with ${attribute}="${name}".`);
  }
  if ((element as Element).localName !== resolved.element.localName) {
    throw new PatchError(target, `the ${resolved.kind} is a <${resolved.element.localName}>, the markup a <${(element as Element).localName}>.`);
  }
}

/** Every scope owner in a tree (the tree itself included), outside the skipped subtrees. */
export function ownersWithin(root: Node, skip: readonly Node[]): Element[] {
  const owners: Element[] = [];
  const visit = (node: Node): void => {
    if (skip.includes(node)) return;
    if (isScopeOwner(node)) owners.push(node);
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(root);
  return owners;
}

function ownsScope(node: Node): boolean {
  return ownersWithin(node, []).length > 0;
}

export interface PatcherOptions {
  readonly kernel: Kernel;
  /** The scopes of the attributes mount; signal patches and scope hand-over need them. */
  readonly scopes?: Scopes;
  /** Re-applies directives to the elements a patch morphed (the attributes mount's `refresh`). */
  readonly refresh?: (elements: readonly Element[]) => void;
}

export interface Patcher {
  /** Morphs or inserts `markup` into one target, or removes it, in one render transaction. */
  patchElements(target: string, markup?: string, mode?: PatchMode): void;
  /** Merges `patch` into the target's scope; `page` is the document's. */
  patchSignals(target: string, patch: Record<string, unknown>, options?: { onlyIfMissing?: boolean }): void;
  /**
   * Morphs `<body>` in place into an incoming document's body (a whole-document visit), keeping
   * each element with `data-permanent` and an `id` the incoming body also has as the same node,
   * and each `data-ignore-morph` element the incoming body brings again.
   */
  patchBody(incoming: HTMLBodyElement): void;
}

/** Deep merge: objects merge, arrays and other values replace, `null` removes. From jqstar. */
export function mergeSignalPatch(
  scope: Record<string, unknown>,
  patch: Record<string, unknown>,
  onlyIfMissing = false,
): void {
  for (const [key, value] of Object.entries(patch)) {
    const exists = Object.hasOwn(scope, key);
    if (value === null) {
      if (!onlyIfMissing && exists) Reflect.deleteProperty(scope, key);
      continue;
    }
    if (isPlainRecord(value)) {
      if (!isPlainRecord(scope[key])) {
        if (onlyIfMissing && exists) continue;
        scope[key] = {};
      }
      mergeSignalPatch(scope[key] as Record<string, unknown>, value, onlyIfMissing);
      continue;
    }
    if (onlyIfMissing && exists) continue;
    scope[key] = cloneValue(value);
  }
}

/** The elements matching `selector` in a run of nodes, the nodes included, in document order. */
function within(nodes: Iterable<Node>, selector: string): Element[] {
  const found: Element[] = [];
  for (const node of nodes) {
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (element.matches(selector)) found.push(element);
    found.push(...Array.from(element.querySelectorAll(selector)));
  }
  return found;
}

/** The permanent elements among `current` that the incoming nodes also bring, by `id`. */
function keptPermanents(current: Iterable<Node>, incoming: Iterable<Node>): Set<Element> {
  const ids = new Set(within(incoming, PERMANENT).map((element) => element.id));
  return new Set(within(current, PERMANENT).filter((element) => ids.has(element.id)));
}

/** Where an element sits below `top`: the tag and the id of each element from there down to it. */
function placeOf(element: Element, top: Element | null): string[] {
  const steps: string[] = [];
  for (let at: Element | null = element; at && at !== top; at = at.parentElement) {
    const id = at.getAttribute("id");
    steps.unshift(id ? `${at.localName}#${id}` : at.localName);
  }
  return steps;
}

/**
 * The outermost `data-ignore-morph` elements in a run of nodes, each under the key its
 * counterpart in other markup has: its tag and id when it has an id no other element in the run
 * shares, else its place below `top` and its order among the elements in that place. An element
 * whose id is not unique gets no key: Idiomorph pairs nothing by such an id.
 */
function ignorePlaces(nodes: readonly Node[], top: Element | null): Map<string, Element> {
  const all = within(nodes, IGNORE_MORPH);
  const ids = within(nodes, "[id]").map((element) => element.getAttribute("id"));
  const places = new Map<string, Element>();
  const orders = new Map<string, number>();
  for (const element of all) {
    if (all.some((other) => other !== element && other.contains(element))) continue;
    const id = element.getAttribute("id");
    if (id) {
      if (ids.indexOf(id) === ids.lastIndexOf(id)) places.set(JSON.stringify([element.localName, id]), element);
      continue;
    }
    const place = JSON.stringify(placeOf(element, top));
    const order = orders.get(place) ?? 0;
    orders.set(place, order + 1);
    places.set(JSON.stringify([place, order]), element);
  }
  return places;
}

/**
 * The `data-ignore-morph` elements among `current` (below `currentTop`) that the incoming nodes
 * (below `incomingTop`) bring again, each with its counterpart there. Idiomorph pairs an id-less
 * element with a counterpart only by tag and sibling position, which the patcher cannot read
 * back, so `apply` makes it pair these by a temporary id, as it pairs permanents by theirs.
 */
function keptIgnored(
  current: readonly Node[],
  currentTop: Element | null,
  incoming: readonly Node[],
  incomingTop: Element | null,
): Map<Element, Element> {
  const theirs = ignorePlaces(incoming, incomingTop);
  const pairs = new Map<Element, Element>();
  for (const [key, element] of ignorePlaces(current, currentTop)) {
    const counterpart = theirs.get(key);
    if (counterpart) pairs.set(element, counterpart);
  }
  return pairs;
}

/**
 * Gives each id-less kept element and its counterpart one temporary id for the morph, so
 * Idiomorph pairs them wherever they sit; the returned function takes the ids off again.
 */
function stampPairs(pairs: ReadonlyMap<Element, Element>, operationId: number): () => void {
  const stamped: [Element, string | null][] = [];
  for (const [element, counterpart] of pairs) {
    if (element === counterpart || element.getAttribute("id")) continue;
    const id = `tessera-ignore-morph-${operationId}-${stamped.length}`;
    stamped.push([element, element.getAttribute("id")]);
    element.setAttribute("id", id);
    counterpart.setAttribute("id", id);
  }
  return () => {
    for (const [element, id] of stamped) {
      if (id === null) element.removeAttribute("id");
      else element.setAttribute("id", id);
    }
  };
}

export function createPatcher(options: PatcherOptions): Patcher {
  const { kernel, scopes, refresh } = options;
  const { document } = kernel;
  const patched = createPatchedSignal(kernel);

  const apply = (
    resolved: Target,
    nodes: Node[],
    mode: PatchMode,
    transaction: RenderTransaction,
    kept: ReadonlySet<Element> = new Set(),
    ignoredKept: ReadonlyMap<Element, Element> = new Map(),
  ): void => {
    const keep = (node: Node): boolean =>
      node.nodeType === 1 && (kept.has(node as Element) || [...ignoredKept.keys()].some((element) => element.contains(node)));
    const removeNode = (node: Node): void => {
      transaction.beforeRemove(node);
      scopes?.release(node);
      node.parentNode?.removeChild(node);
    };

    if (mode === "remove") {
      removeNode(resolved.element);
      return;
    }
    if (mode === "append") {
      resolved.element.append(...nodes);
      return;
    }
    if (mode === "prepend") {
      resolved.element.prepend(...nodes);
      return;
    }

    // morph and inner: Idiomorph, with removals of scope owners held back until the scopes
    // they own have been handed to their replacements.
    const root = resolved.element;
    const before = new Map<string, Element>();
    if (scopes) for (const owner of ownersWithin(root, [])) if (!before.has(scopes.pathOf(owner))) before.set(scopes.pathOf(owner), owner);
    const held: Node[] = [];
    const morphed: Element[] = [];
    const callbacks: IdiomorphCallbacks = {
      // In place of Idiomorph's ignoreActiveValue, which also leaves the children of any focused
      // element unmorphed (a heading focused after a visit kept its old text): only a focused
      // field keeps the value the user is typing.
      beforeAttributeUpdated: (name, element) =>
        name === "value" && element === document.activeElement && ["input", "textarea", "select"].includes(element.localName) ? false : undefined,
      beforeNodeMorphed: (oldNode) => (keep(oldNode) ? false : undefined),
      afterNodeMorphed: (oldNode) => {
        if (oldNode.nodeType === 1) morphed.push(oldNode as Element);
        return undefined;
      },
      beforeNodeRemoved: (node) => {
        if (keep(node)) return false;
        if (scopes && ownsScope(node)) {
          held.push(node);
          return false;
        }
        transaction.beforeRemove(node);
        return undefined;
      },
    };

    const [element] = significant(nodes);
    const unstamp = stampPairs(ignoredKept, transaction.operationId);
    try {
      if (mode === "morph" && element) {
        Idiomorph.morph(resolved.element, element, { morphStyle: "outerHTML", restoreFocus: true, callbacks });
      } else {
        Idiomorph.morph(resolved.element, nodes, { morphStyle: "innerHTML", restoreFocus: true, callbacks });
      }
    } finally {
      unstamp();
    }

    if (scopes) {
      const after = new Map<string, Element>();
      for (const owner of ownersWithin(root, held)) if (!after.has(scopes.pathOf(owner))) after.set(scopes.pathOf(owner), owner);
      const moves: [Element, Element][] = [];
      for (const [path, owner] of before) {
        const replacement = after.get(path);
        if (replacement && replacement !== owner) moves.push([owner, replacement]);
      }
      scopes.transfer(moves);
    }
    for (const node of held) removeNode(node);
    refresh?.(morphed.filter((element) => element.isConnected));
  };

  return {
    patchElements(target, markup = "", mode = "morph") {
      if (!PATCH_MODES.includes(mode)) throw new PatchError(target, `"${mode}" is not a mode.`);
      const resolved = findTarget(document, target);
      if (mode === "remove" && markup.trim() !== "") throw new PatchError(target, "a remove brings no markup.");
      const nodes = mode === "remove" ? [] : parse(document, markup);
      if (mode === "morph") checkMorph(target, resolved, nodes);

      const root = resolved.element;
      const morphing = mode === "morph" || mode === "inner";
      // A permanent element the fragment brings again stays the same live node, unmorphed, and
      // so does a data-ignore-morph element; one the fragment drops goes like any other node.
      // A target inside such an element, or an inner patch of one, changes nothing.
      const kept = morphing ? keptPermanents([root], nodes) : new Set<Element>();
      let ignoredKept = new Map<Element, Element>();
      if (morphing && (root.parentElement?.closest(IGNORE_MORPH) || (mode === "inner" && root.matches(IGNORE_MORPH)))) {
        ignoredKept = new Map([[root, root]]);
      } else if (mode === "morph") {
        ignoredKept = keptIgnored([root], root.parentElement, nodes, null);
      } else if (mode === "inner") {
        ignoredKept = keptIgnored(Array.from(root.childNodes), root, nodes, null);
      }
      const preserveRoots = [...ignoredKept.keys(), ...kept];
      const transaction = kernel.beginRender(root, { preserveRoots });
      try {
        apply(resolved, nodes, mode, transaction, kept, ignoredKept);
      } catch (error) {
        transaction.fail(error);
      }
      transaction.commit();
      if (mode !== "remove" && root.isConnected) patched(root, { target, mode });
    },

    patchBody(incoming) {
      const body = document.body;
      const incomingIds = new Set(
        Array.from(incoming.querySelectorAll("[data-permanent][id]"), (element) => element.id),
      );
      const kept = new Set(
        Array.from(body.querySelectorAll("[data-permanent][id]")).filter((element) => incomingIds.has(element.id)),
      );
      const ignoredKept = keptIgnored([body], body.parentElement, [incoming], incoming.parentElement);
      const preserveRoots = [...kept, ...ignoredKept.keys()];
      const transaction = kernel.beginRender(body, { preserveRoots });
      try {
        apply({ kind: "region", element: body }, [incoming], "morph", transaction, kept, ignoredKept);
      } catch (error) {
        transaction.fail(error);
      }
      transaction.commit();
      patched(body, { target: "page", mode: "morph" });
    },

    patchSignals(target, patch, patchOptions = {}) {
      if (!scopes) throw new PatchError(target, "signal patches need the attributes' scopes.");
      let scope: Record<string, unknown>;
      if (target === "page") scope = scopes.document;
      else scope = scopes.scopeOf(findTarget(document, target).element);
      mergeSignalPatch(scope, patch, patchOptions.onlyIfMissing ?? false);
    },
  };
}
