// Signal scopes: resolution through the chain, isolation, declaring with modifiers, writes,
// disposal, moves, morph-like changes to a component's marker, and the request payload.
import { afterEach, describe, expect, it } from "vitest";
import { encodeSignals, MAX_SIGNALS_BYTES } from "../../src/scopes.ts";
import { disposeFixtures, setup } from "./attributes-fixture.ts";

afterEach(disposeFixtures);

function messages(failures: readonly { error: unknown }[]): string[] {
  return failures.map(({ error }) => (error instanceof Error ? error.message : String(error)));
}

const page = `
  <p id="top" data-signals="{label: 'document', d: 1}" data-text="$label"></p>
  <main data-region="content" data-signals="{label: 'region', r: 1}">
    <!--t:c card eyJpZCI6MX0.c2ln-->
      <p id="inner" data-signals="{label: 'card'}" data-text="[$label, $r, $d].join()"></p>
    <!--/t:c-->
    <p id="middle" data-text="[$label, $r, $d].join()"></p>
  </main>`;

describe("resolution", () => {
  it("reads the innermost scope that has the name: component, region, document", () => {
    const { find, failures } = setup(page);
    expect(find("#inner").textContent).toBe("card,1,1");
    expect(find("#middle").textContent).toBe("region,1,1");
    expect(find("#top").textContent).toBe("document");
    expect(failures).toEqual([]);
  });

  it("follows the chain innermost first, through nested components at one level, past blocks", () => {
    const { find, mount } = setup(`
      <section data-region="list">
        <!--t:c outer--><!--t:b--><!--/t:b--><!--t:c inner--><p id="x"></p><!--/t:c--><p id="y"></p><!--/t:c-->
      </section>`);
    const describe = (id: string) =>
      mount.scopes.owners(find(id)).map((owner) =>
        owner.nodeType === 8 ? (owner as Comment).data : owner.nodeType === 1 ? (owner as Element).localName : "document",
      );
    expect(describe("#x")).toEqual(["t:c inner", "t:c outer", "section", "document"]);
    expect(describe("#y")).toEqual(["t:c outer", "section", "document"]);
  });

  it("re-runs a read when an inner scope later declares the name", async () => {
    const { find, doc, settle } = setup(`
      <p data-signals="{tone: 'document'}"></p>
      <!--t:c note--><div id="host"><span data-text="$tone"></span></div><!--/t:c-->`);
    expect(find("span").textContent).toBe("document");
    const declare = doc.createElement("i");
    declare.setAttribute("data-signals", "{tone: 'component'}");
    find("#host").append(declare);
    await settle();
    expect(find("span").textContent).toBe("component");
  });
});

describe("isolation", () => {
  it("keeps same-named signals in sibling components apart", async () => {
    const card = (key: string) =>
      `<!--t:c ${key}--><div id="${key}" data-signals="{open: false}"><button data-on:click="$open = !$open"></button><span data-text="$open"></span></div><!--/t:c-->`;
    const { find, settle, signals } = setup(`<main data-region="content">${card("a")}${card("b")}</main>`);
    (find("#a button") as HTMLButtonElement).click();
    await settle();
    expect(find("#a span").textContent).toBe("true");
    expect(find("#b span").textContent).toBe("false");
    expect("open" in signals).toBe(false);
  });

  it("gives refs, computed values and new bindings to the nearest scope", () => {
    const card = (key: string) =>
      `<!--t:c ${key}--><input id="${key}" value="${key}" data-ref:field data-bind:text data-computed:shout="$text.toUpperCase()"><!--/t:c-->`;
    const { find, mount, signals } = setup(card("a") + card("b"));
    const [a, b] = [find("#a"), find("#b")];
    const scopeA = mount.scopes.scopeFor(a, "nearest");
    const scopeB = mount.scopes.scopeFor(b, "nearest");
    expect(scopeA.field).toBe(a);
    expect(scopeB.field).toBe(b);
    expect([scopeA.text, scopeA.shout, scopeB.shout]).toEqual(["a", "A", "B"]);
    expect(Object.keys(signals)).toEqual([]);
  });
});

describe("declaring and writing", () => {
  it("declares into the region or the document with __region and __document", () => {
    const { find, mount, signals } = setup(`
      <main data-region="content"><!--t:c card--><p data-signals__region="{shared: 1}" data-signals__document="{global: 2}"></p><!--/t:c--></main>
      <p id="loose" data-signals__region="{fallback: 3}"></p>`);
    expect(mount.scopes.scopeOf(find("main"))).toEqual({ shared: 1 });
    expect(signals).toEqual({ global: 2, fallback: 3 });
  });

  it("refuses both modifiers at once", () => {
    const { failures } = setup(`<p data-signals__region__document="{a: 1}"></p>`);
    expect(messages(failures)).toEqual(["data-signals takes __region or __document, not both."]);
  });

  it("writes to the scope that has the name, else to the nearest scope", async () => {
    const { find, mount, settle, signals } = setup(`
      <main data-region="content" data-signals="{r: 1}">
        <!--t:c card--><button data-on:click="$r = 2; $fresh = 'here'"></button><!--/t:c-->
      </main>`);
    find("button").click();
    await settle();
    expect(mount.scopes.scopeOf(find("main"))).toEqual({ r: 2 });
    expect(mount.scopes.scopeFor(find("button"), "nearest")).toEqual({ fresh: "here" });
    expect(signals).toEqual({});
  });
});

describe("lifetime", () => {
  it("owns each scope through the kernel and disposes it when its owner leaves", async () => {
    const { find, doc, owners, settle, mount } = setup(page);
    const scopeOwners = () => owners().filter((owner) => owner.startsWith("scopes:")).map((owner) => owner.replace(/^scopes:\d+:/, ""));
    expect(scopeOwners().sort()).toEqual(["component:card", "region:content"]);
    const card = mount.scopes.scopeFor(find("#inner"), "nearest");

    const main = find("main");
    for (const node of Array.from(main.childNodes).slice(0, 4)) node.remove();
    await settle();
    expect(scopeOwners()).toEqual(["region:content"]);

    main.remove();
    await settle();
    expect(scopeOwners()).toEqual([]);
    expect(card).toEqual({ label: "card" });
    void doc;
  });

  it("keeps a scope through a move within the page", async () => {
    const { find, doc, settle, mount } = setup(`<main data-region="content" data-signals="{n: 1}"><button data-on:click="$n++"></button></main><aside></aside>`);
    const main = find("main");
    find("button").click();
    find("aside").append(main);
    await settle();
    expect(mount.scopes.scopeOf(main)).toEqual({ n: 2 });
    find("button").click();
    expect(mount.scopes.scopeOf(main)).toEqual({ n: 3 });
    void doc;
  });

  it("rebinds an element moved into another component to that component's scope", async () => {
    const { find, settle } = setup(
      `<!--t:c a--><div id="a" data-signals="{who: 'a'}"></div><!--/t:c-->` +
        `<!--t:c b--><div id="b" data-signals="{who: 'b'}"></div><!--/t:c-->` +
        `<p id="p" data-text="$who ?? 'none'"></p>`,
    );
    const p = find("#p");
    expect(p.textContent).toBe("none");
    find("#a").append(p);
    await settle();
    expect(p.textContent).toBe("a");
    find("#b").append(p);
    await settle();
    expect(p.textContent).toBe("b");
  });

  it("disposes the scopes a render removes, while they are still connected", () => {
    const { find, kernel, doc, owners } = setup(page);
    const transaction = kernel.beginRender(doc.body);
    transaction.beforeRemove(find("main"));
    expect(find("main").isConnected).toBe(true);
    expect(owners().filter((owner) => owner.startsWith("scopes:"))).toEqual([]);
    transaction.commit();
  });

  it("disposes every scope with the mount", () => {
    const { mount, owners } = setup(page);
    mount.destroy();
    expect(owners().filter((owner) => owner.startsWith("scopes:"))).toEqual([]);
  });
});

describe("across a morph", () => {
  function component(key: string) {
    const fixture = setup(`<!--t:c ${key}--><p data-signals="{n: 1}"></p><!--/t:c-->`);
    const opener = fixture.doc.body.firstChild as Comment;
    // Replaces what lies between whichever opening marker is now first and its closer.
    const replaceContent = async (html: string): Promise<void> => {
      const current = fixture.doc.body.firstChild as Comment;
      current.nextSibling?.remove();
      const holder = fixture.doc.createElement("template");
      holder.innerHTML = html;
      current.after(holder.content);
      await fixture.settle();
    };
    return { ...fixture, opener, replaceContent };
  }

  it("keeps the scope when the marker and its key stay", async () => {
    const { find, replaceContent, signals } = component("card");
    await replaceContent(`<span data-text="$n ?? 'reset'"></span>`);
    expect(find("span").textContent).toBe("1");
    expect(signals).toEqual({});
  });

  it("starts afresh when the marker's key changes", async () => {
    const { find, opener, replaceContent } = component("card");
    opener.data = "t:c other";
    await replaceContent(`<span data-text="$n ?? 'reset'"></span>`);
    expect(find("span").textContent).toBe("reset");
  });

  it("carries the scope to a new marker with the same key, and not to another key", async () => {
    const first = component("card");
    const replacement = first.doc.createComment("t:c card");
    first.opener.replaceWith(replacement);
    first.mount.scopes.transfer(first.opener, replacement);
    await first.replaceContent(`<span data-text="$n ?? 'reset'"></span>`);
    expect(first.find("span").textContent).toBe("1");

    const second = component("card");
    const other = second.doc.createComment("t:c other");
    second.opener.replaceWith(other);
    second.mount.scopes.transfer(second.opener, other);
    expect(second.mount.scopes.scopeOf(other)).toEqual({});
  });
});

describe("the request payload", () => {
  it("holds only the initiating element's chain, the innermost value winning", () => {
    const { find, mount } = setup(`
      <p data-signals="{d: 1, label: 'document'}"></p>
      <main data-region="content" data-signals="{r: 1, label: 'region'}">
        <!--t:c a--><p id="a" data-signals="{x: 1, label: 'a'}"></p><!--/t:c-->
        <!--t:c b--><p id="b" data-signals="{y: 2}"></p><!--/t:c-->
      </main>`);
    expect(mount.scopes.payload(find("#a"))).toEqual({ d: 1, r: 1, x: 1, label: "a" });
    expect(mount.scopes.payload(find("#b"))).toEqual({ d: 1, r: 1, y: 2, label: "region" });
  });

  it("leaves out _ names, computed signals, elements, functions and other values JSON cannot carry", () => {
    const { find, mount, signals } = setup(`<input id="field" data-ref:field data-signals="{n: 2}" data-computed:double="$n * 2">`);
    Object.assign(signals, {
      _secret: "s",
      user: { name: "Ada", _token: "t", greet: () => "hi", tags: ["a", find("#field"), undefined, 1n, NaN] },
      when: new Date(0),
      map: new Map([[1, 2]]),
      nothing: undefined,
      infinite: Infinity,
      ok: null,
      flag: false,
    });
    expect(mount.scopes.payload(find("#field"))).toEqual({
      n: 2,
      user: { name: "Ada", tags: ["a", null, null, null, null] },
      ok: null,
      flag: false,
    });
  });

  it("refuses a cycle and allows a shared value", () => {
    const { find, mount, signals } = setup(`<p></p>`);
    const shared = { v: 1 };
    Object.assign(signals, { left: shared, right: shared });
    expect(mount.scopes.payload(find("p"))).toEqual({ left: { v: 1 }, right: { v: 1 } });
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    signals.loop = loop;
    expect(() => mount.scopes.payload(find("p"))).toThrow("The signal loop.self refers to itself and cannot be sent.");
  });

  it("encodes compact ASCII JSON with \\u escapes, and refuses more than 4,096 bytes", () => {
    const header = encodeSignals({ note: "café", emoji: "😀", open: true });
    expect(header).toBe('{"note":"caf\\u00e9","emoji":"\\ud83d\\ude00","open":true}');
    expect(JSON.parse(header)).toEqual({ note: "café", emoji: "😀", open: true });
    expect(encodeSignals({ text: "x".repeat(MAX_SIGNALS_BYTES - 11) })).toHaveLength(MAX_SIGNALS_BYTES);
    expect(() => encodeSignals({ text: "x".repeat(MAX_SIGNALS_BYTES - 10) })).toThrow(
      "Tessera-Signals would be 4097 bytes; the limit is 4096.",
    );
  });
});
