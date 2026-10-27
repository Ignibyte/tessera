// Patching by identity: each mode on regions and on components, anchors, preserved nodes, focus
// and values, teardown order, errors, scopes across a morph, and signal patches. These run in
// jsdom's own document: Idiomorph reads the global `document`, so an iframe's nodes would be
// adopted into the wrong one.
import { Idiomorph } from "idiomorph";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActionRecorder } from "../../src/actions.ts";
import { mountAttributes } from "../../src/attributes.ts";
import type { AttributeFailure } from "../../src/attributes.ts";
import { registerBuiltins } from "../../src/builtins.ts";
import { createDirectiveRegistry } from "../../src/directive.ts";
import { createTrustedExpressionEngine } from "../../src/expression.ts";
import { Kernel } from "../../src/kernel.ts";
import type { Mount } from "../../src/kernel.ts";
import { createPatcher, PatchError, resolveAnchors } from "../../src/patch.ts";
import { Scheduler } from "../../src/reactivity.ts";

let kernel: Kernel | undefined;

afterEach(() => {
  if (kernel && !kernel.disposed) kernel.dispose();
  kernel = undefined;
  document.body.innerHTML = "";
});

function fixture(html: string) {
  document.body.innerHTML = html;
  const scheduler = new Scheduler();
  const current = new Kernel(document, { flush: () => scheduler.nextUpdate() });
  kernel = current;
  const registry = createDirectiveRegistry();
  registerBuiltins(registry);
  const failures: AttributeFailure[] = [];
  const mount = mountAttributes(document.body, {
    kernel: current,
    scheduler,
    expressions: createTrustedExpressionEngine(),
    registry,
    actions: createActionRecorder().seam,
    report: (failure) => failures.push(failure),
  });
  const patcher = createPatcher({
    kernel: current,
    scopes: mount.scopes,
    refresh: (elements) => {
      mount.refresh(elements);
    },
  });
  const find = (selector: string): HTMLElement => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`no ${selector}`);
    return element;
  };
  const settle = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await current.whenEnhanced();
  };
  const component = (key: string): HTMLElement => find(`[data-t-c="${key}"]`);
  return { kernel: current, mount, patcher, failures, find, settle, component, scopes: mount.scopes };
}

function failure(work: () => unknown): PatchError {
  try {
    work();
  } catch (error) {
    if (error instanceof PatchError) return error;
    throw error;
  }
  throw new Error("expected a PatchError");
}

describe("regions", () => {
  it("morphs in place, keeping the region element and matching nodes", () => {
    const { patcher, find } = fixture(`<main data-region="content" class="old"><h1>Old</h1><p id="keep">a</p></main>`);
    const main = find("main");
    const keep = find("#keep");
    patcher.patchElements("content", `<main data-region="content" class="new"><h1>New</h1><p id="keep">b</p></main>`);
    expect(find("main")).toBe(main);
    expect(find("#keep")).toBe(keep);
    expect(main.className).toBe("new");
    expect(main.textContent).toBe("Newb");
  });

  it("inner morphs the children and leaves the element's own attributes", () => {
    const { patcher, find } = fixture(`<main data-region="content" class="own"><p>a</p></main>`);
    patcher.patchElements("content", `<p>b</p><p>c</p>`, "inner");
    expect(find("main").className).toBe("own");
    expect(find("main").innerHTML).toBe("<p>b</p><p>c</p>");
  });

  it("appends, prepends and removes", () => {
    const { patcher, find } = fixture(`<ul data-region="list"><li>b</li></ul>`);
    patcher.patchElements("list", `<li>c</li>`, "append");
    patcher.patchElements("list", `<li>a</li>`, "prepend");
    expect(find("ul").textContent).toBe("abc");
    patcher.patchElements("list", "", "remove");
    expect(document.querySelector("ul")).toBeNull();
  });

  it("applies directives to what a morph brings, and releases what it takes away", async () => {
    const { patcher, find, settle, kernel: current } = fixture(
      `<main data-region="content" data-signals="{n: 4}"><button id="old" data-on:click="$n++"></button></main>`,
    );
    patcher.patchElements("content", `<main data-region="content" data-signals="{n: 4}"><span data-text="$n"></span></main>`);
    await settle();
    expect(find("span").textContent).toBe("4");
    expect(current.resourceSummary().filter(({ owner }) => owner.includes("data-on:click"))).toEqual([]);
  });
});

describe("components", () => {
  const page = `<main data-region="content">
      <input id="before" value="x">
      <div data-t-c="cart" data-t-props="eyJjYXJ0IjoxfQ.c2ln"><p id="line">Lamp × 1</p></div>
      <p id="after">after</p>
    </main>`;

  it("morphs the component element, updating the props and leaving the siblings", () => {
    const { patcher, find, component } = fixture(page);
    const before = find("#before") as HTMLInputElement;
    before.value = "typed";
    const after = find("#after");
    const line = find("#line");
    const cart = component("cart");

    patcher.patchElements("content/cart", `<div data-t-c="cart" data-t-props="eyJjYXJ0IjoyfQ.c2ln"><p id="line">Lamp × 2</p></div>`);

    expect(component("cart")).toBe(cart);
    expect(cart.getAttribute("data-t-props")).toBe("eyJjYXJ0IjoyfQ.c2ln");
    expect(find("#line")).toBe(line);
    expect(line.textContent).toBe("Lamp × 2");
    expect(find("#before")).toBe(before);
    expect(before.value).toBe("typed");
    expect(find("#after")).toBe(after);
  });

  it("inner keeps the element and its props", () => {
    const { patcher, component } = fixture(page);
    const cart = component("cart");
    patcher.patchElements("content/cart", `<p id="line">Lamp × 3</p><p>extra</p>`, "inner");
    expect(component("cart")).toBe(cart);
    expect(cart.outerHTML).toBe('<div data-t-c="cart" data-t-props="eyJjYXJ0IjoxfQ.c2ln"><p id="line">Lamp × 3</p><p>extra</p></div>');
  });

  it("appends and prepends to the element's children, and removes the element", () => {
    const { patcher, find } = fixture(`<table><tbody data-region="list"><tr id="head"><td>head</td></tr></tbody><tbody data-t-c="items"><tr><td>b</td></tr></tbody></table>`);
    expect(failure(() => { patcher.patchElements("list/items", "<tr><td>c</td></tr>", "append"); }).message).toContain("no component list/items");
    patcher.patchElements("page/items", "<tr><td>c</td></tr>", "append");
    patcher.patchElements("page/items", "<tr><td>a</td></tr>", "prepend");
    expect(find('[data-t-c="items"]').textContent).toBe("abc");
    patcher.patchElements("page/items", "", "remove");
    expect(find("table").innerHTML).toBe('<tbody data-region="list"><tr id="head"><td>head</td></tr></tbody>');
  });

  it("finds nested components and page components by path, a <span> inside a heading included", () => {
    const { patcher, find } = fixture(`
      <header><h2>Cart <span data-t-c="count">3</span></h2></header>
      <main data-region="content"><div data-t-c="cart"><ul><li data-t-c="line-7">old</li></ul></div></main>`);
    patcher.patchElements("content/cart/line-7", `<li data-t-c="line-7">new</li>`);
    patcher.patchElements("page/count", `<span data-t-c="count">4</span>`);
    expect(find("li").textContent).toBe("new");
    expect(find("h2").textContent).toBe("Cart 4");
  });

  it("addresses a component in a region nested inside a component from that region", () => {
    const { patcher, find } = fixture(
      `<main data-region="content"><div data-t-c="card"><section data-region="notes"><p data-t-c="note">old</p></section></div></main>`,
    );
    expect(() => {
      patcher.patchElements("content/card/note", `<p data-t-c="note">x</p>`);
    }).toThrow("the page has no component content/card/note.");
    patcher.patchElements("notes/note", `<p data-t-c="note">new</p>`);
    expect(find("section p").textContent).toBe("new");
  });

  it("does not take a component inside another for a child of the region", () => {
    const { patcher } = fixture(`<main data-region="content"><div data-t-c="cart"><p data-t-c="line">a</p></div></main>`);
    expect(failure(() => { patcher.patchElements("content/line", "", "remove"); }).message).toContain("the page has no component content/line.");
  });
});

describe("anchors", () => {
  const page = `<main data-region="content"><div data-t-c="cart" data-t-anchor="basket"><p data-t-c="line-7" data-t-anchor="lamp">a</p></div></main>
    <p data-t-c="count" data-t-anchor="count">3</p><p data-t-anchor="loose"></p><p data-t-c="x" data-t-anchor="twice"></p><p data-t-c="y" data-t-anchor="twice"></p>`;

  it("resolves @NAME to the anchored component's path and leaves other targets alone", () => {
    fixture(page);
    expect(resolveAnchors(document, ["@basket", "sidebar", "@lamp", "@count", "content/cart"])).toEqual([
      "content/cart",
      "sidebar",
      "content/cart/line-7",
      "page/count",
      "content/cart",
    ]);
  });

  it.each([
    ["an unknown anchor", "@nowhere", "the page has no anchor nowhere."],
    ["a doubled anchor", "@twice", "two elements carry the anchor twice."],
    ["an anchor on an element that is not a component", "@loose", "the anchor loose is not on a component."],
    ["a badly spelled anchor", "@a b", '"a b" is not an anchor name.'],
    ["an empty anchor", "@", '"" is not an anchor name.'],
  ])("refuses %s", (_case, target, message) => {
    fixture(page);
    expect(failure(() => resolveAnchors(document, ["content", target])).message).toContain(message);
  });
});

describe("the morph", () => {
  it("re-applies directives the server's markup undid", () => {
    const { patcher, find } = fixture(
      `<main data-region="content" data-signals="{on: true, label: 'live'}"><p id="p" data-text="$label" data-class="{active: $on}" data-attr:title="$label"></p></main>`,
    );
    patcher.patchElements(
      "content",
      `<main data-region="content" data-signals="{on: true, label: 'live'}"><p id="p" data-text="$label" data-class="{active: $on}" data-attr:title="$label" class="server"></p></main>`,
    );
    const p = find("#p");
    expect(p.textContent).toBe("live");
    expect([...p.classList].sort()).toEqual(["active", "server"]);
    expect(p.getAttribute("title")).toBe("live");
  });

  it("keeps a field with an id as the same node when a conditional appears before it", () => {
    const { patcher, find } = fixture(`<main data-region="content"><p>Your order</p><input id="qty" value="1"></main>`);
    const qty = find("#qty") as HTMLInputElement;
    qty.value = "3";
    patcher.patchElements(
      "content",
      `<main data-region="content"><p class="notice">Saved.</p><p>Your order</p><input id="qty" value="1"></main>`,
    );
    expect(find("#qty")).toBe(qty);
    expect(find(".notice").textContent).toBe("Saved.");
    expect(find("main").textContent).toBe("Saved.Your order");
  });

  it("keeps data-ignore-morph nodes as they are, even when the new markup lacks them", () => {
    const { patcher, find } = fixture(`<main data-region="content"><div id="kept" data-ignore-morph>client</div><p>old</p></main>`);
    const kept = find("#kept");
    patcher.patchElements("content", `<main data-region="content"><div id="kept" data-ignore-morph>server</div><p>new</p></main>`);
    expect(find("#kept")).toBe(kept);
    expect(kept.textContent).toBe("client");
    patcher.patchElements("content", `<main data-region="content"><p>newer</p></main>`);
    expect(find("#kept")).toBe(kept);
  });

  it("keeps a data-permanent element the fragment brings again as the same node, unmorphed", () => {
    const { patcher, find } = fixture(
      `<main data-region="content"><div data-t-c="player"><div id="player" data-permanent><p>playing 0:12</p></div></div><h1>A</h1></main>`,
    );
    const player = find("#player");
    patcher.patchElements("content", `<main data-region="content"><div data-t-c="player"><div id="player" data-permanent><p>server</p></div></div><h1>B</h1></main>`);
    expect(find("#player")).toBe(player);
    expect(player.textContent).toBe("playing 0:12");
    expect(find("h1").textContent).toBe("B");
    patcher.patchElements("content/player", `<div data-t-c="player"><div id="player" data-permanent><p>again</p></div></div>`);
    expect(find("#player")).toBe(player);
    expect(player.textContent).toBe("playing 0:12");
  });

  it("morphs a data-permanent element the fragment brings without data-permanent, and removes one it lacks", () => {
    const { patcher, find } = fixture(`<main data-region="content"><div id="player" data-permanent><p>playing</p></div></main>`);
    patcher.patchElements("content", `<main data-region="content"><div id="player"><p>server</p></div></main>`);
    expect(find("#player").textContent).toBe("server");
    patcher.patchElements("content", `<main data-region="content"><p>gone</p></main>`);
    expect(document.querySelector("#player")).toBeNull();
  });

  it("keeps focus and the typed value of an input it morphs", () => {
    const { patcher, find } = fixture(`<main data-region="content"><label>Name</label><input id="name" value="server"></main>`);
    const input = find("#name") as HTMLInputElement;
    input.focus();
    input.value = "typing";
    patcher.patchElements("content", `<main data-region="content"><label>Your name</label><input id="name" value="server-new"></main>`);
    expect(find("#name")).toBe(input);
    expect(input.value).toBe("typing");
    expect(document.activeElement).toBe(input);
    expect(find("label").textContent).toBe("Your name");
  });

  it("morphs the children of a focused element that is not a field", () => {
    const { patcher, find } = fixture(`<main data-region="content"><h1 tabindex="-1">Old</h1><p>a</p></main>`);
    find("h1").focus();
    patcher.patchElements("content", `<main data-region="content"><h1 tabindex="-1">New</h1><p>b</p></main>`);
    expect(find("h1").textContent).toBe("New");
    expect(find("main").textContent).toBe("Newb");
  });

  it("tears nested mounts down deepest first, while they are still connected", () => {
    const { patcher, find, kernel: current } = fixture(
      `<main data-region="content"><section id="outer"><div id="inner"></div></section></main>`,
    );
    const order: string[] = [];
    const track = (element: Element, name: string): void => {
      let destroyed = false;
      const mount: Mount = {
        root: element,
        get destroyed() {
          return destroyed;
        },
        destroy: () => {
          destroyed = true;
          order.push(`${name}:${String(element.isConnected)}`);
          current.untrack(mount);
        },
      };
      current.track(mount);
    };
    track(find("#inner"), "inner");
    track(find("#outer"), "outer");
    patcher.patchElements("content", `<main data-region="content"><p>new</p></main>`);
    expect(order).toEqual(["inner:true", "outer:true"]);
  });

  it("fails the render transaction and rethrows when the morph throws", async () => {
    const { patcher, kernel: current } = fixture(`<main data-region="content"><p>a</p></main>`);
    const morph = vi.spyOn(Idiomorph, "morph").mockImplementation(() => {
      throw new Error("morph broke");
    });
    try {
      expect(() => {
        patcher.patchElements("content", `<main data-region="content"><p>b</p></main>`);
      }).toThrow("morph broke");
    } finally {
      morph.mockRestore();
    }
    await expect(current.whenEnhanced()).resolves.toBeUndefined();
  });
});

describe("errors", () => {
  it.each([
    ["a missing region", "sidebar", "the page has no region sidebar."],
    ["a missing component", "content/cart", "the page has no component content/cart."],
    ["a bad region name", "Content", '"Content" is not a region name.'],
    ["a bad key", "content/a b", '"a b" is not a component key.'],
    ["the page", "page", "the whole document is patched as a full document"],
  ])("reports %s and changes nothing", (_case, target, message) => {
    const { patcher, find } = fixture(`<main data-region="content"><p>a</p></main>`);
    const before = find("main").outerHTML;
    expect(failure(() => { patcher.patchElements(target, `<p>x</p>`, "inner"); }).message).toContain(message);
    expect(find("main").outerHTML).toBe(before);
  });

  it("reports duplicate regions and duplicate keys", () => {
    const { patcher } = fixture(
      `<div data-region="twice"></div><div data-region="twice"></div><main data-region="content"><p data-t-c="a"></p><p data-t-c="a"></p><p data-t-c="both" data-region="both"></p></main>`,
    );
    expect(failure(() => { patcher.patchElements("twice", "", "remove"); }).message).toContain("two elements are region twice.");
    expect(failure(() => { patcher.patchElements("content/a", "", "remove"); }).message).toContain("two components are content/a.");
    expect(failure(() => { patcher.patchElements("content/both", "", "remove"); }).message).toContain("content/both is both a region and a component.");
  });

  it.each([
    ["two elements for a region", "content", `<main data-region="content"></main><p></p>`, "exactly one element"],
    ["another region's element", "content", `<main data-region="other"></main>`, "exactly one element"],
    ["another tag for the region", "content", `<div data-region="content"></div>`, "the region is a <main>, the markup a <div>."],
    ["another key for the component", "content/cart", `<div data-t-c="line"></div>`, 'exactly one element with data-t-c="cart"'],
    ["the component's children alone", "content/cart", `<p>a</p>`, 'exactly one element with data-t-c="cart"'],
    ["content beside the component", "content/cart", `<div data-t-c="cart"></div><p></p>`, 'exactly one element with data-t-c="cart"'],
    ["another tag for the component", "content/cart", `<section data-t-c="cart"></section>`, "the component is a <div>, the markup a <section>."],
  ])("refuses a morph bringing %s", (_case, target, markup, message) => {
    const { patcher, find } = fixture(`<main data-region="content"><div data-t-c="cart"><p>a</p></div></main>`);
    const before = find("main").outerHTML;
    expect(failure(() => { patcher.patchElements(target, markup); }).message).toContain(message);
    expect(find("main").outerHTML).toBe(before);
  });

  it("refuses markup on a remove", () => {
    const { patcher } = fixture(`<main data-region="content"></main>`);
    expect(failure(() => { patcher.patchElements("content", "<p></p>", "remove"); }).message).toContain("a remove brings no markup.");
  });
});

describe("scopes across a morph", () => {
  const card = (key: string, wrapper = "div") =>
    `<${wrapper} class="wrap"><div data-t-c="${key}"><p class="${key}" data-signals="{n: 1}" data-on:click="$n++" data-text="$n"></p></div></${wrapper}>`;

  it("keeps a component's scope when the morph keeps its element", async () => {
    const { patcher, find, settle, component, scopes } = fixture(`<main data-region="content">${card("cart")}</main>`);
    find(".cart").click();
    await settle();
    const scope = scopes.scopeOf(component("cart"));
    patcher.patchElements("content", `<main data-region="content"><div class="wrap"><div data-t-c="cart"><p class="cart" data-text="$n"></p></div></div></main>`);
    await settle();
    expect(scopes.scopeOf(component("cart"))).toBe(scope);
    expect(find(".cart").textContent).toBe("2");
  });

  it("hands the scope over through transfer when a new element with the same key replaces the old one", async () => {
    const { patcher, find, settle, component, scopes } = fixture(`<main data-region="content">${card("cart")}</main>`);
    find(".cart").click();
    await settle();
    const oldElement = component("cart");
    const scope = scopes.scopeOf(oldElement);
    const transfer = vi.spyOn(scopes, "transfer");

    // A <section> replaces the wrapper <div>: the component inside it is a new node, at the same path.
    patcher.patchElements("content", `<main data-region="content"><section class="wrap"><div data-t-c="cart"><p class="cart" data-text="$n"></p></div></section></main>`);
    await settle();

    const newElement = component("cart");
    expect(newElement).not.toBe(oldElement);
    expect(transfer).toHaveBeenCalledWith([[oldElement, newElement]]);
    expect(scopes.scopeOf(newElement)).toBe(scope);
    expect(find(".cart").textContent).toBe("2");
    expect(oldElement.isConnected).toBe(false);
  });

  it("keeps each scope with its key when components trade places", async () => {
    const { patcher, find, settle, component, scopes } = fixture(`<main data-region="content">${card("a")}${card("b")}</main>`);
    find(".b").click();
    find(".b").click();
    await settle();
    const [a, b] = [scopes.scopeOf(component("a")), scopes.scopeOf(component("b"))];
    patcher.patchElements(
      "content",
      `<main data-region="content"><div class="wrap"><div data-t-c="b"><p class="b" data-text="$n"></p></div></div><div class="wrap"><div data-t-c="a"><p class="a" data-text="$n"></p></div></div></main>`,
    );
    await settle();
    expect(scopes.scopeOf(component("a"))).toBe(a);
    expect(scopes.scopeOf(component("b"))).toBe(b);
    expect([find(".a").textContent, find(".b").textContent]).toEqual(["1", "3"]);
  });

  it("starts a new scope when the component's key changes", async () => {
    const { patcher, find, settle, component, scopes } = fixture(`<main data-region="content">${card("cart")}</main>`);
    find(".cart").click();
    await settle();
    patcher.patchElements("content", `<main data-region="content"><div class="wrap"><div data-t-c="cart-2"><p class="cart" data-text="$n ?? 'reset'"></p></div></div></main>`);
    await settle();
    expect(scopes.scopeOf(component("cart-2"))).toEqual({});
    expect(find(".cart").textContent).toBe("reset");
  });

  it("disposes the scope of a component the morph removes", async () => {
    const { patcher, settle, owners } = { ...fixture(`<main data-region="content">${card("cart")}</main>`), owners: () => (kernel?.resourceSummary() ?? []).map(({ owner }) => owner) };
    expect(owners().some((owner) => owner.endsWith("component:cart"))).toBe(true);
    patcher.patchElements("content", `<main data-region="content"><p>empty</p></main>`);
    await settle();
    expect(owners().some((owner) => owner.endsWith("component:cart"))).toBe(false);
  });
});

describe("signal patches", () => {
  it("merges deeply into the target's scope: objects merge, arrays replace, null removes", () => {
    const { patcher, scopes, find, component } = fixture(
      `<main data-region="content" data-signals="{user: {name: 'Ada', tags: ['a']}, gone: 1}"><p data-t-c="line" data-signals="{qty: 1}"></p></main>`,
    );
    patcher.patchSignals("content", { user: { age: 36, tags: ["b"] }, gone: null });
    patcher.patchSignals("content/line", { qty: 2, editing: false });
    patcher.patchSignals("page", { unread: 4 });
    expect(scopes.scopeOf(find("main"))).toEqual({ user: { name: "Ada", tags: ["b"], age: 36 } });
    expect(scopes.scopeOf(component("line"))).toEqual({ qty: 2, editing: false });
    expect(scopes.document).toEqual({ unread: 4 });
  });

  it("sets only what is missing with onlyIfMissing", () => {
    const { patcher, scopes, find } = fixture(`<main data-region="content" data-signals="{a: 1, nested: {b: 1}}"></main>`);
    patcher.patchSignals("content", { a: 2, c: 3, nested: { b: 2, d: 4 }, gone: null }, { onlyIfMissing: true });
    expect(scopes.scopeOf(find("main"))).toEqual({ a: 1, c: 3, nested: { b: 1, d: 4 } });
  });

  it("reports an unknown scope", () => {
    const { patcher } = fixture(`<main data-region="content"></main>`);
    expect(failure(() => { patcher.patchSignals("sidebar", { a: 1 }); }).message).toContain("the page has no region sidebar.");
  });
});
