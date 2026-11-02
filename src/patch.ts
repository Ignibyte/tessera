// Patching: server markup morphed into the page, targeted by identity (docs/protocol.md,
// sections 2 and 5.3). Ported from jqstar `src/patch.ts`: Idiomorph keeping a focused field's value,
// `restoreFocus` and preserved nodes, inert parsing through `<template>`, one render transaction
// per patch. jqstar's id and CSS-selector targeting is replaced by regions and components.
//
// A region and a component are both one element (`data-region`, `data-t-c`), so every mode acts
// on that element the same way: a morph is Idiomorph on the element itself, the other modes act
// on its children. After each patch the changed element raises `tessera:patched` (src/devtools.ts).
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

function ignored(node: Node): boolean {
  return node.nodeType === 1 && (node as Element).closest("[data-ignore-morph]") !== null;
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
   * each element with `data-permanent` and an `id` the incoming body also has as the same node.
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

/** The elements with `data-permanent` and an `id` in a run of nodes, the nodes included. */
function permanents(nodes: Iterable<Node>): Element[] {
  const found: Element[] = [];
  for (const node of nodes) {
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (element.matches("[data-permanent][id]")) found.push(element);
    found.push(...Array.from(element.querySelectorAll("[data-permanent][id]")));
  }
  return found;
}

/** The permanent elements among `current` that the incoming nodes also bring, by `id`. */
function keptPermanents(current: Iterable<Node>, incoming: Iterable<Node>): Set<Element> {
  const ids = new Set(permanents(incoming).map((element) => element.id));
  return new Set(permanents(current).filter((element) => ids.has(element.id)));
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
  ): void => {
    const keep = (node: Node): boolean => ignored(node) || (node.nodeType === 1 && kept.has(node as Element));
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
    if (mode === "morph" && element) {
      Idiomorph.morph(resolved.element, element, { morphStyle: "outerHTML", restoreFocus: true, callbacks });
    } else {
      Idiomorph.morph(resolved.element, nodes, { morphStyle: "innerHTML", restoreFocus: true, callbacks });
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
      // A permanent element the fragment brings again stays the same live node, unmorphed.
      const kept = mode === "morph" || mode === "inner" ? keptPermanents([root], nodes) : new Set<Element>();
      const preserveRoots = [
        ...(root.matches("[data-ignore-morph]") ? [root] : []),
        ...Array.from(root.querySelectorAll("[data-ignore-morph]")),
        ...kept,
      ];
      const transaction = kernel.beginRender(root, { preserveRoots });
      try {
        apply(resolved, nodes, mode, transaction, kept);
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
      const preserveRoots = [...kept, ...Array.from(body.querySelectorAll("[data-ignore-morph]"))];
      const transaction = kernel.beginRender(body, { preserveRoots });
      try {
        apply({ kind: "region", element: body }, [incoming], "morph", transaction, kept);
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
