// Coordination of overlapping requests and the generations that keep a late response from
// overwriting a newer one: jqstar 0028 AC-08 (a frozen reject/queue/supersede policy, never
// built there) plus region generations (jqstar digest, "Hardest parts" 2). The table is
// docs/protocol.md section 4.6.
import { findTarget, ownersWithin } from "./patch.ts";

/** A read is a GET, a write anything else, a poll a refresh from `data-poll`. */
export type RequestClass = "read" | "write" | "poll";

/** How a newer request's target lies against an older one's. */
export type Relation = "same" | "inside" | "around" | "disjoint";

export type Decision = "independent" | "supersede" | "queue" | "skip";

/** A target found on the page: the document, a region's element, or a component's markers. */
export type TargetNode =
  | { readonly kind: "page"; readonly document: Document }
  | { readonly kind: "region"; readonly element: Element }
  | { readonly kind: "component"; readonly opener: Comment; readonly closer: Comment };

/**
 * The table (docs/protocol.md 4.6), for a newer request against an older one in flight or
 * queued: polls yield to everything; anything supersedes a poll; a write is never aborted, so
 * whatever overlaps it queues; a newer write supersedes an overlapping read; a newer read
 * supersedes a read on the same target or inside its own, and queues behind a read around it.
 */
export function decide(newer: RequestClass, older: RequestClass, relation: Relation): Decision {
  if (relation === "disjoint") return "independent";
  if (newer === "poll") return "skip";
  if (older === "poll") return "supersede";
  if (older === "write") return "queue";
  if (newer === "write") return "supersede";
  return relation === "inside" ? "queue" : "supersede";
}

/** Finds a target's node; undefined when the page lacks it. */
export function resolveTarget(document: Document, target: string): TargetNode | undefined {
  if (target === "page") return { kind: "page", document };
  try {
    const found = findTarget(document, target);
    return found.kind === "region"
      ? { kind: "region", element: found.element }
      : { kind: "component", opener: found.opener, closer: found.closer };
  } catch {
    return undefined;
  }
}

function nodeOf(target: TargetNode): Node {
  if (target.kind === "page") return target.document;
  return target.kind === "region" ? target.element : target.opener;
}

/** Whether `inner` lies strictly within `outer`. */
function contains(outer: TargetNode, inner: TargetNode): boolean {
  if (inner.kind === "page") return false;
  if (outer.kind === "page") return true;
  const node = nodeOf(inner);
  if (outer.kind === "region") return outer.element !== node && outer.element.contains(node);
  if (node === outer.opener) return false;
  const after = outer.opener.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
  const before = outer.closer.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING;
  return Boolean(after && before);
}

/** How `a` lies against `b`: the same target, inside it, around it, or apart. */
export function relation(a: TargetNode, b: TargetNode): Relation {
  if (nodeOf(a) === nodeOf(b)) return "same";
  if (contains(b, a)) return "inside";
  if (contains(a, b)) return "around";
  return "disjoint";
}

export interface Pending {
  readonly class: RequestClass;
  /** Its targets on the page; empty means the page. */
  readonly targets: readonly TargetNode[];
}

/**
 * The decision for a newer request against an older one over every pair of their targets: skip
 * wins, then queue, then supersede.
 */
export function decideAll(newer: Pending, older: Pending, document: Document): Decision {
  const page: TargetNode = { kind: "page", document };
  const ours = newer.targets.length > 0 ? newer.targets : [page];
  const theirs = older.targets.length > 0 ? older.targets : [page];
  let result: Decision = "independent";
  for (const a of ours) {
    for (const b of theirs) {
      const decision = decide(newer.class, older.class, relation(a, b));
      if (decision === "skip") return "skip";
      if (decision === "queue" || (decision === "supersede" && result === "independent")) result = decision;
    }
  }
  return result;
}

/**
 * The commit sequence. Each target node remembers the last commit that touched it; a request
 * records the sequence when it is dispatched, and a fragment for a target touched since then is
 * stale.
 */
export class Generations {
  #sequence = 0;
  readonly #touched = new WeakMap<Node, number>();

  /** The sequence a request records at dispatch. */
  get current(): number {
    return this.#sequence;
  }

  stale(target: TargetNode, since: number): boolean {
    return (this.#touched.get(nodeOf(target)) ?? 0) > since;
  }

  /**
   * Records a commit to `target`, after it: the target and every target now inside it. Targets
   * around it are left alone, since a fragment for one of them replaces this target anyway.
   */
  touch(target: TargetNode): void {
    const sequence = ++this.#sequence;
    const node = nodeOf(target);
    this.#touched.set(node, sequence);
    if (target.kind === "page") {
      for (const owner of ownersWithin(target.document, [])) this.#touched.set(owner, sequence);
      return;
    }
    if (target.kind === "region") {
      for (const owner of ownersWithin(target.element, [])) this.#touched.set(owner, sequence);
      return;
    }
    for (let inside = target.opener.nextSibling; inside && inside !== target.closer; inside = inside.nextSibling) {
      for (const owner of ownersWithin(inside, [])) this.#touched.set(owner, sequence);
    }
  }
}

/** The elements that carry `aria-busy` for a target. */
export function busyElements(target: TargetNode): Element[] {
  if (target.kind === "page") return [target.document.body];
  if (target.kind === "region") return [target.element];
  const elements: Element[] = [];
  for (let node = target.opener.nextSibling; node && node !== target.closer; node = node.nextSibling) {
    if (node.nodeType === 1) elements.push(node as Element);
  }
  return elements;
}
