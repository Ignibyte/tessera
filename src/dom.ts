// Node predicates that work across realms (an iframe's nodes fail `instanceof Node` here).
// Ported from jqstar `src/dom.ts`; the tag predicates return with the tickets that use them.

let nodeTypeDescriptor: PropertyDescriptor | undefined;

function nodeType(value: unknown): unknown {
  try {
    nodeTypeDescriptor ??= Object.getOwnPropertyDescriptor(Node.prototype, "nodeType");
    return nodeTypeDescriptor?.get?.call(value);
  } catch {
    return undefined;
  }
}

export function isNode(value: unknown): value is Node {
  return typeof nodeType(value) === "number";
}

export function isElementNode(value: unknown): value is Element {
  return nodeType(value) === 1;
}
