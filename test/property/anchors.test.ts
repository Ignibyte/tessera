// Component paths and anchors over any page shape (fixed seed): in a random tree of regions,
// components and plain elements, every component's path finds that component again, every
// `@NAME` resolves to the path of the component carrying the anchor, and an anchor the page
// lacks is refused (docs/protocol.md, sections 2.2 to 2.7).
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { findTarget, PatchError, resolveAnchors } from "../../src/patch.ts";
import { ownerPath } from "../../src/scopes.ts";

const SEED = 20261028;
const RUNS = { seed: SEED, numRuns: 300 };

interface Shape {
  readonly kind: "component" | "region" | "plain";
  readonly name: string;
  readonly anchor: string | undefined;
  readonly tag: string;
  readonly children: readonly Shape[];
}

const REGION_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const key = fc.stringMatching(/^[A-Za-z0-9_.:]{1,5}(-[A-Za-z0-9_.:]{1,3}){0,1}$/);
const regionName = fc.stringMatching(/^[a-z][a-z0-9]{0,4}$/).filter((name) => name !== "page");
const tag = fc.constantFrom("div", "span", "section", "li", "tbody");

const { tree } = fc.letrec<{ tree: Shape[]; node: Shape }>((recurse) => ({
  tree: fc.array(recurse("node"), { maxLength: 4 }),
  node: fc.record({
    kind: fc.constantFrom("component", "component", "region", "plain"),
    name: fc.oneof(key, regionName),
    anchor: fc.option(key, { nil: undefined, freq: 2 }),
    tag,
    children: fc.oneof({ depthSize: "small" }, fc.constant([]), recurse("tree")),
  }),
}));

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * Builds the tree under `<body>` as a server would render it: keys unique among the components
 * of one owner, region names and anchors unique on the page. Returns the components and the
 * anchored ones by name.
 */
function render(shapes: readonly Shape[]): { components: Element[]; anchors: Map<string, Element> } {
  const components: Element[] = [];
  const anchors = new Map<string, Element>();
  const regions = new Set<string>();
  const build = (parent: Element, items: readonly Shape[], used: Set<string>): void => {
    for (const shape of items) {
      const element = document.createElement(shape.tag);
      let inner = used;
      if (shape.kind === "component") {
        let name = shape.name;
        for (let n = 2; used.has(name); n++) name = `${shape.name}-${n}`;
        used.add(name);
        element.setAttribute("data-t-c", name);
        if (shape.anchor !== undefined && !anchors.has(shape.anchor)) {
          element.setAttribute("data-t-anchor", shape.anchor);
          anchors.set(shape.anchor, element);
        }
        components.push(element);
        inner = new Set();
      } else if (shape.kind === "region") {
        let name = REGION_NAME.test(shape.name) && shape.name !== "page" ? shape.name : "r";
        for (let n = 2; regions.has(name); n++) name = `r${n}`;
        regions.add(name);
        element.setAttribute("data-region", name);
        inner = new Set();
      }
      parent.append(element);
      build(element, shape.children, inner);
    }
  };
  build(document.body, shapes, new Set());
  return { components, anchors };
}

describe("component paths", () => {
  it("find every component again from the path its place gives it", () => {
    fc.assert(
      fc.property(tree, (shapes) => {
        document.body.innerHTML = "";
        const { components } = render(shapes);
        for (const component of components) expect(findTarget(document, ownerPath(component)).element).toBe(component);
      }),
      RUNS,
    );
  });
});

describe("anchors", () => {
  it("resolve to the path of the component that carries them", () => {
    fc.assert(
      fc.property(tree, (shapes) => {
        document.body.innerHTML = "";
        const { anchors } = render(shapes);
        for (const [name, element] of anchors) {
          const [path = ""] = resolveAnchors(document, [`@${name}`]);
          expect(path.startsWith("@")).toBe(false);
          expect(findTarget(document, path).element).toBe(element);
        }
      }),
      RUNS,
    );
  });

  it("refuse an anchor the page lacks", () => {
    fc.assert(
      fc.property(tree, key, (shapes, name) => {
        document.body.innerHTML = "";
        const { anchors } = render(shapes);
        fc.pre(!anchors.has(name));
        expect(() => resolveAnchors(document, [`@${name}`])).toThrow(PatchError);
      }),
      RUNS,
    );
  });
});
