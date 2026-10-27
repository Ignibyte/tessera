// Patching: server markup morphed into the page, targeted by identity (docs/protocol.md,
// sections 2 and 5.3). Ported from jqstar `src/patch.ts`: Idiomorph keeping a focused field's value,
// `restoreFocus` and preserved nodes, inert parsing through `<template>`, one render transaction
// per patch. jqstar's id and CSS-selector targeting is replaced by regions and components.
//
// A component is the run of nodes between two comments, and Idiomorph's public `morph` takes one
// node. So a component is morphed by morphing its markers' parent against a copy of its children
// in which only that run is new: every node outside the run meets its own copy and stays as it is.
import { Idiomorph } from "idiomorph";
import type { IdiomorphCallbacks } from "idiomorph";
import type { Kernel, RenderTransaction } from "./kernel.ts";
import { isScopeOwner } from "./scopes.ts";
import type { Scopes } from "./scopes.ts";
import { cloneValue, isPlainRecord } from "./values.ts";

export type PatchMode = "morph" | "inner" | "append" | "prepend" | "remove";

export const PATCH_MODES: readonly PatchMode[] = ["morph", "inner", "append", "prepend", "remove"];

const REGION_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const COMPONENT_KEY = /^[A-Za-z0-9_.:]+(-[A-Za-z0-9_.:]+)*$/;
const OPENER = /^t:c ([^ ]+)(?: [^ ]+)?$/;
const CLOSER = "/t:c";

/** A patch that names a target the page lacks, or brings markup that does not fit its mode. */
export class PatchError extends Error {
  readonly target: string;

  constructor(target: string, detail: string) {
    super(`Cannot patch ${target}: ${detail}`);
    this.name = "PatchError";
    this.target = target;
  }
}

interface RegionTarget {
  readonly kind: "region";
  readonly element: Element;
}

interface ComponentTarget {
  readonly kind: "component";
  readonly key: string;
  readonly opener: Comment;
  readonly closer: Comment;
}

type Target = RegionTarget | ComponentTarget;

interface Component {
  readonly key: string;
  readonly opener: Comment;
  readonly closer: Comment;
  readonly content: readonly Node[];
}

function openerKey(node: Node): string | undefined {
  return node.nodeType === 8 ? OPENER.exec((node as Comment).data)?.[1] : undefined;
}

function isCloser(node: Node): boolean {
  return node.nodeType === 8 && (node as Comment).data === CLOSER;
}

/**
 * The components directly under a run of nodes: those whose nearest enclosing component or
 * region is the run's container. Nested regions start paths of their own and are skipped.
 */
function childComponents(nodes: Iterable<Node>): Component[] {
  const found: Component[] = [];
  let open: { key: string; opener: Comment; content: Node[]; depth: number } | undefined;
  for (const node of nodes) {
    const key = openerKey(node);
    if (open) {
      if (key !== undefined) open.depth++;
      else if (isCloser(node) && open.depth-- === 0) {
        found.push({ key: open.key, opener: open.opener, closer: node as Comment, content: open.content });
        open = undefined;
        continue;
      }
      open.content.push(node);
    } else if (key !== undefined) {
      open = { key, opener: node as Comment, content: [], depth: 0 };
    } else if (node.nodeType === 1 && !(node as Element).hasAttribute("data-region")) {
      found.push(...childComponents(node.childNodes));
    }
  }
  return found;
}

/** Finds a target by its spelling (protocol 2.6); throws a PatchError when the page lacks it. */
export function findTarget(document: Document, target: string): Target {
  if (target === "page") throw new PatchError(target, "the whole document is patched as a full document, not a fragment.");
  const [base = "", ...keys] = target.split("/");
  if (!(base === "page" && keys.length > 0) && !REGION_NAME.test(base)) {
    throw new PatchError(target, `"${base}" is not a region name.`);
  }
  for (const key of keys) if (!COMPONENT_KEY.test(key)) throw new PatchError(target, `"${key}" is not a component key.`);

  let container: readonly Node[];
  if (base === "page") {
    container = Array.from(document.body.childNodes);
  } else {
    const regions = document.querySelectorAll(`[data-region="${base}"]`);
    if (regions.length === 0) throw new PatchError(target, `the page has no region ${base}.`);
    if (regions.length > 1) throw new PatchError(target, `two elements are region ${base}.`);
    const element = regions[0] as Element;
    if (keys.length === 0) return { kind: "region", element };
    container = Array.from(element.childNodes);
  }

  let component: Component | undefined;
  for (const [index, key] of keys.entries()) {
    const matches = childComponents(container).filter((candidate) => candidate.key === key);
    const path = [base, ...keys.slice(0, index + 1)].join("/");
    if (matches.length === 0) throw new PatchError(target, `the page has no component ${path}.`);
    if (matches.length > 1) throw new PatchError(target, `two components are ${path}.`);
    component = matches[0];
    container = component?.content ?? [];
  }
  if (!component) throw new PatchError(target, "no component key.");
  return { kind: "component", key: component.key, opener: component.opener, closer: component.closer };
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
  const meaningful = significant(nodes);
  if (resolved.kind === "region") {
    const [element, extra] = meaningful;
    const name = resolved.element.getAttribute("data-region");
    if (!element || extra || element.nodeType !== 1 || (element as Element).getAttribute("data-region") !== name) {
      throw new PatchError(target, `a morph of a region brings exactly one element with data-region="${name ?? ""}".`);
    }
    if ((element as Element).localName !== resolved.element.localName) {
      throw new PatchError(target, `the region is a <${resolved.element.localName}>, the markup a <${(element as Element).localName}>.`);
    }
    return;
  }
  const components = childComponents(meaningful);
  const [only] = components;
  if (
    components.length !== 1 ||
    only?.key !== resolved.key ||
    meaningful[0] !== only.opener ||
    meaningful[meaningful.length - 1] !== only.closer
  ) {
    throw new PatchError(target, `a morph of a component brings exactly its markers, <!--t:c ${resolved.key} …--> and <!--/t:c-->, and what lies between.`);
  }
}

function ignored(node: Node): boolean {
  return node.nodeType === 1 && (node as Element).closest("[data-ignore-morph]") !== null;
}

/** Every scope owner in a tree (the tree itself included), outside the skipped subtrees. */
export function ownersWithin(root: Node, skip: readonly Node[]): (Element | Comment)[] {
  const owners: (Element | Comment)[] = [];
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

function componentRun(target: ComponentTarget): Node[] {
  const run: Node[] = [];
  for (let node = target.opener.nextSibling; node && node !== target.closer; node = node.nextSibling) run.push(node);
  return run;
}

export function createPatcher(options: PatcherOptions): Patcher {
  const { kernel, scopes, refresh } = options;
  const { document } = kernel;

  /**
   * Morphs `parent`'s children so that the run `first`…`last` becomes `replacement`. The children
   * outside the run go in as copies so Idiomorph keeps their places, and are never morphed from
   * them: a copy carries a field's markup, not what the user set (#32).
   */
  const morphRange = (parent: Node, first: Node, last: Node, replacement: readonly Node[], callbacks: IdiomorphCallbacks): void => {
    const copy: Node[] = [];
    const outside = new Set<Node>();
    let inside = false;
    for (const child of Array.from(parent.childNodes)) {
      if (child === first) {
        inside = true;
        copy.push(...replacement);
      }
      if (!inside) {
        outside.add(child);
        copy.push(child.cloneNode(true));
      }
      if (child === last) inside = false;
    }
    const beforeNodeMorphed: IdiomorphCallbacks["beforeNodeMorphed"] = (oldNode, newNode) =>
      outside.has(oldNode) ? false : callbacks.beforeNodeMorphed?.(oldNode, newNode);
    Idiomorph.morph(parent, copy, { morphStyle: "innerHTML", restoreFocus: true, callbacks: { ...callbacks, beforeNodeMorphed } });
  };

  const apply = (
    target: string,
    resolved: Target,
    nodes: Node[],
    mode: PatchMode,
    transaction: RenderTransaction,
    root: Node,
    kept: ReadonlySet<Element> = new Set(),
  ): void => {
    const keep = (node: Node): boolean => ignored(node) || (node.nodeType === 1 && kept.has(node as Element));
    const removeNode = (node: Node): void => {
      transaction.beforeRemove(node);
      scopes?.release(node);
      node.parentNode?.removeChild(node);
    };

    if (mode === "remove") {
      if (resolved.kind === "region") {
        removeNode(resolved.element);
        return;
      }
      const run: Node[] = [];
      for (let node: Node | null = resolved.opener; node; node = node.nextSibling) {
        run.push(node);
        if (node === resolved.closer) break;
      }
      for (const node of run) removeNode(node);
      return;
    }
    if (mode === "append" || mode === "prepend") {
      if (resolved.kind === "region") {
        if (mode === "append") resolved.element.append(...nodes);
        else resolved.element.prepend(...nodes);
      } else if (mode === "append") resolved.closer.before(...nodes);
      else resolved.opener.after(...nodes);
      return;
    }

    // morph and inner: Idiomorph, with removals of scope owners held back until the scopes
    // they own have been handed to their replacements.
    const before = new Map<string, Element | Comment>();
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

    if (resolved.kind === "region") {
      const [element] = significant(nodes);
      if (mode === "morph" && element) {
        Idiomorph.morph(resolved.element, element, { morphStyle: "outerHTML", restoreFocus: true, callbacks });
      } else {
        Idiomorph.morph(resolved.element, nodes, { morphStyle: "innerHTML", restoreFocus: true, callbacks });
      }
    } else {
      const parent = resolved.opener.parentNode;
      if (!parent) throw new PatchError(target, "the component's markers have no parent.");
      const replacement =
        mode === "morph" ? significant(nodes) : [resolved.opener.cloneNode(), ...nodes, resolved.closer.cloneNode()];
      morphRange(parent, resolved.opener, resolved.closer, replacement, callbacks);
    }

    if (scopes) {
      const after = new Map<string, Element | Comment>();
      for (const owner of ownersWithin(root, held)) if (!after.has(scopes.pathOf(owner))) after.set(scopes.pathOf(owner), owner);
      const moves: [Element | Comment, Element | Comment][] = [];
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

      const root = resolved.kind === "region" ? resolved.element : resolved.opener.parentElement;
      if (!root) throw new PatchError(target, "the component's markers are not inside an element.");
      // A permanent element the fragment brings again stays the same live node, unmorphed.
      const kept =
        mode === "morph" || mode === "inner"
          ? keptPermanents(resolved.kind === "region" ? [resolved.element] : componentRun(resolved), nodes)
          : new Set<Element>();
      const preserveRoots = [
        ...(root.matches("[data-ignore-morph]") ? [root] : []),
        ...Array.from(root.querySelectorAll("[data-ignore-morph]")),
        ...kept,
      ];
      const transaction = kernel.beginRender(root, { preserveRoots });
      try {
        apply(target, resolved, nodes, mode, transaction, root, kept);
      } catch (error) {
        transaction.fail(error);
      }
      transaction.commit();
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
        apply("page", { kind: "region", element: body }, [incoming], "morph", transaction, body, kept);
      } catch (error) {
        transaction.fail(error);
      }
      transaction.commit();
    },

    patchSignals(target, patch, patchOptions = {}) {
      if (!scopes) throw new PatchError(target, "signal patches need the attributes' scopes.");
      let scope: Record<string, unknown>;
      if (target === "page") scope = scopes.document;
      else {
        const resolved = findTarget(document, target);
        scope = scopes.scopeOf(resolved.kind === "region" ? resolved.element : resolved.opener);
      }
      mergeSignalPatch(scope, patch, patchOptions.onlyIfMissing ?? false);
    },
  };
}
