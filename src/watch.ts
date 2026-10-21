// Protocol attributes in the directive grammar (`data-poll__5s`, `data-lazy__visible`): finding
// the elements that carry them as they arrive or change, and the target a refresh from one of
// them names (docs/protocol.md, sections 3 and 4.1).
import { parseAttributeName } from "./directive.ts";
import type { DirectiveAttribute } from "./directive.ts";
import type { Kernel } from "./kernel.ts";
import { ownerPath, scopeOwners } from "./scopes.ts";

/** The attribute's name up to its first `__` or `:`, without `data-`. */
function baseName(attributeName: string): string | undefined {
  if (!attributeName.startsWith("data-")) return undefined;
  return attributeName.slice("data-".length).split(/__|:/, 1)[0];
}

/** The element's attributes named `data-NAME`, with or without modifiers, parsed. Throws on bad syntax. */
export function protocolAttributes(element: Element, name: string): DirectiveAttribute[] {
  const found: DirectiveAttribute[] = [];
  for (const attribute of Array.from(element.attributes)) {
    if (baseName(attribute.name) !== name) continue;
    const parsed = parseAttributeName(attribute.name, attribute.value);
    if (parsed) found.push(parsed);
  }
  return found;
}

function carries(element: Element, name: string): boolean {
  return Array.from(element.attributes).some((attribute) => baseName(attribute.name) === name);
}

/**
 * Calls `sync` for every element carrying `data-NAME` (with any modifiers) now, for each one that
 * arrives, and for each one whose such attribute changes or goes. The observer is the kernel's.
 */
export function watchProtocolAttribute(kernel: Kernel, name: string, sync: (element: Element) => void): void {
  const scan = (root: Element): void => {
    if (carries(root, name)) sync(root);
    for (const element of Array.from(root.querySelectorAll("*"))) if (carries(element, name)) sync(element);
  };
  kernel.observe(
    `watch:${name}`,
    kernel.document,
    (records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          if (baseName(record.attributeName ?? "") === name && record.target.isConnected) sync(record.target as Element);
        } else for (const node of Array.from(record.addedNodes)) if (node.nodeType === 1 && node.isConnected) scan(node as Element);
      }
    },
    { childList: true, subtree: true, attributes: true },
  );
  scan(kernel.document.documentElement);
}

/** The target of a refresh from `element`: its innermost component or region, else the page (none). */
export function refreshTargets(element: Element): string[] {
  const [nearest] = scopeOwners(element);
  return nearest === undefined || nearest.nodeType === 9 ? [] : [ownerPath(nearest as Element | Comment)];
}
