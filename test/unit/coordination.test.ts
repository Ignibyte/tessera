// Overlapping requests and generations: every row of the table (docs/protocol.md 4.6), the
// relation between targets, the commit sequence, and the transport following the table.
import { afterEach, describe, expect, it, vi } from "vitest";
import { busyElements, decide, decideAll, Generations, relation, resolveTarget } from "../../src/coordination.ts";
import type { Decision, Relation, RequestClass, TargetNode } from "../../src/coordination.ts";
import { disposeTransport, empty, fragments, hang, setup } from "./transport-fixture.ts";

afterEach(disposeTransport);

describe("the table", () => {
  const rows: [RequestClass, RequestClass, Relation, Decision][] = [];
  const expected: Record<RequestClass, Record<RequestClass, Record<Exclude<Relation, "disjoint">, Decision>>> = {
    // newer → older → relation of the newer's target to the older's
    read: {
      read: { same: "supersede", around: "supersede", inside: "queue" },
      write: { same: "queue", around: "queue", inside: "queue" },
      poll: { same: "supersede", around: "supersede", inside: "supersede" },
    },
    write: {
      read: { same: "supersede", around: "supersede", inside: "supersede" },
      write: { same: "queue", around: "queue", inside: "queue" },
      poll: { same: "supersede", around: "supersede", inside: "supersede" },
    },
    poll: {
      read: { same: "skip", around: "skip", inside: "skip" },
      write: { same: "skip", around: "skip", inside: "skip" },
      poll: { same: "skip", around: "skip", inside: "skip" },
    },
  };
  for (const [newer, byOlder] of Object.entries(expected) as [RequestClass, (typeof expected)["read"]][]) {
    for (const [older, byRelation] of Object.entries(byOlder) as [RequestClass, (typeof byOlder)["read"]][]) {
      for (const [where, decision] of Object.entries(byRelation) as [Exclude<Relation, "disjoint">, Decision][]) {
        rows.push([newer, older, where, decision]);
      }
      rows.push([newer, older, "disjoint", "independent"]);
    }
  }

  it("covers every class against every class and relation", () => {
    expect(rows).toHaveLength(36);
  });

  it.each(rows)("a newer %s against an older %s, %s: %s", (newer, older, where, decision) => {
    expect(decide(newer, older, where)).toBe(decision);
  });
});

describe("relation", () => {
  const page = `
    <main data-region="content">
      <div data-t-c="cart"><p id="in-cart"></p><i data-t-c="line"></i></div>
      <b data-t-c="other"></b>
      <section data-region="notes"><u data-t-c="note"></u></section>
    </main>
    <nav data-region="sidebar"></nav>`;

  function target(name: string): TargetNode {
    const found = resolveTarget(document, name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  }

  it.each([
    ["content", "content", "same"],
    ["content/cart", "content", "inside"],
    ["content", "content/cart", "around"],
    ["content/cart/line", "content/cart", "inside"],
    ["content/cart", "content/other", "disjoint"],
    ["notes", "content", "inside"],
    ["notes/note", "content", "inside"],
    ["notes/note", "content/cart", "disjoint"],
    ["sidebar", "content", "disjoint"],
    ["page", "content/cart/line", "around"],
    ["content", "page", "inside"],
    ["page", "page", "same"],
  ] as const)("%s against %s: %s", (a, b, expected) => {
    document.body.innerHTML = page;
    expect(relation(target(a), target(b))).toBe(expected);
  });

  it("combines target pairs: skip, then queue, then supersede", () => {
    document.body.innerHTML = page;
    const content = target("content");
    const cart = target("content/cart");
    const sidebar = target("sidebar");
    expect(decideAll({ class: "read", targets: [sidebar, cart] }, { class: "read", targets: [content] }, document)).toBe("queue");
    expect(decideAll({ class: "read", targets: [sidebar, content] }, { class: "read", targets: [cart] }, document)).toBe("supersede");
    expect(decideAll({ class: "read", targets: [] }, { class: "read", targets: [sidebar] }, document)).toBe("supersede");
    expect(decideAll({ class: "poll", targets: [sidebar] }, { class: "write", targets: [] }, document)).toBe("skip");
    expect(decideAll({ class: "write", targets: [sidebar] }, { class: "write", targets: [content] }, document)).toBe("independent");
  });
});

describe("generations", () => {
  const page = `<main data-region="content"><div data-t-c="cart"><p></p></div></main><nav data-region="sidebar"></nav>`;
  const at = (name: string): TargetNode => resolveTarget(document, name) ?? { kind: "page", document };

  it("makes a target stale when it or a target around it commits, never when a target inside it does", () => {
    document.body.innerHTML = page;
    const generations = new Generations();
    const since = generations.current;
    generations.touch(at("sidebar"));
    expect([generations.stale(at("content"), since), generations.stale(at("content/cart"), since)]).toEqual([false, false]);
    generations.touch(at("content/cart"));
    expect(generations.stale(at("content/cart"), since)).toBe(true);
    // A fragment for content or the page replaces the cart anyway, so it stays valid.
    expect(generations.stale(at("content"), since)).toBe(false);
    expect(generations.stale(at("page"), since)).toBe(false);

    const later = generations.current;
    generations.touch(at("content"));
    expect(generations.stale(at("content/cart"), later)).toBe(true);
    expect(generations.stale(at("sidebar"), later)).toBe(false);
  });

  it("touches the targets a commit brought, so a late response for the new element is stale too", () => {
    document.body.innerHTML = page;
    const generations = new Generations();
    const since = generations.current;
    const main = document.querySelector("main");
    if (!main) throw new Error("no main");
    main.innerHTML = '<div data-t-c="cart"><p>new</p></div>';
    generations.touch(at("content"));
    expect(generations.stale(at("content/cart"), since)).toBe(true);
  });

  it("finds the elements that carry aria-busy", () => {
    document.body.innerHTML = `<main data-region="content"><div data-t-c="cart"> <p></p><span></span></div></main>`;
    expect(busyElements(at("content")).map((element) => element.localName)).toEqual(["main"]);
    expect(busyElements(at("content/cart")).map((element) => element.localName)).toEqual(["div"]);
    expect(busyElements(at("page")).map((element) => element.localName)).toEqual(["body"]);
  });
});

describe("the transport follows the table", () => {
  const page = `<main data-region="content"><div data-t-c="cart"><p id="cart">old</p></div><p id="text">old</p></main><nav data-region="sidebar"><p id="side">old</p></nav>`;
  const cartFragment = (text: string) => `<template data-target="content/cart"><div data-t-c="cart"><p id="cart">${text}</p></div></template>`;

  it("sends overlapping writes one at a time, in order", async () => {
    const { transport, calls, respond } = setup(page);
    const answers: ((response: Response) => void)[] = [];
    const held = () => new Promise<Response>((resolve) => answers.push(resolve));
    respond(held, held);
    const first = transport.request({ kind: "action", method: "POST", url: "/one", targets: ["content"], body: "" });
    const second = transport.request({ kind: "action", method: "POST", url: "/two", targets: ["content/cart"], body: "" });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.map(({ url }) => new URL(url).pathname)).toEqual(["/one"]);
    answers[0]?.(empty(204));
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    answers[1]?.(empty(204));
    expect([(await first).status, (await second).status]).toEqual(["unchanged", "unchanged"]);
  });

  it("queues an inner read behind an outer one, and lets an outer read supersede an inner one", async () => {
    const { transport, calls, respond } = setup(page);
    respond(hang);
    const outer = transport.request({ kind: "visit", url: "/outer", targets: ["content"] });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const inner = transport.request({ kind: "refresh", url: "/inner", targets: ["content/cart"] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(1);
    const around = transport.request({ kind: "visit", url: "/around", targets: ["page"] });
    expect((await outer).status).toBe("superseded");
    expect((await inner).status).toBe("superseded");
    expect((await around).status).toBe("committed");
    expect(calls.map(({ url }) => new URL(url).pathname)).toEqual(["/outer", "/around"]);
  });

  it("skips a poll while anything overlapping is pending, and supersedes a poll in flight", async () => {
    const { transport, calls, respond } = setup(page);
    respond(hang);
    const poll = transport.request({ kind: "refresh", url: "/poll", targets: ["content/cart"], poll: true });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const action = transport.request({ kind: "action", method: "POST", url: "/act", targets: ["content"], body: "" });
    expect((await poll).status).toBe("superseded");
    const yielded = await transport.request({ kind: "refresh", url: "/poll", targets: ["content/cart"], poll: true });
    expect(yielded.status).toBe("skipped");
    await action;
    expect(calls.map(({ url }) => new URL(url).pathname)).toEqual(["/poll", "/act"]);
  });

  it("lets a write supersede an overlapping read in flight", async () => {
    const { transport, calls, respond } = setup(page);
    respond(hang);
    const read = transport.request({ kind: "refresh", url: "/read", targets: ["content/cart"] });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const write = transport.request({ kind: "action", method: "POST", url: "/write", targets: ["content"], body: "" });
    expect((await read).status).toBe("superseded");
    expect((await write).status).toBe("committed");
  });

  it("drops a late fragment for a target a newer commit changed", async () => {
    const { transport, calls, respond, find, reported } = setup(page);
    let late: (response: Response) => void = () => undefined;
    respond(
      () => new Promise<Response>((resolve) => { late = resolve; }),
      () => fragments(`${cartFragment("from the write")}<template data-target="sidebar"><nav data-region="sidebar"><p id="side">saved</p></nav></template>`),
    );
    const read = transport.request({ kind: "refresh", url: "/cart", targets: ["content/cart"] });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    // A disjoint write whose answer also re-renders the cart, as a server may.
    expect((await transport.request({ kind: "action", method: "POST", url: "/save", targets: ["sidebar"], body: "" })).status).toBe("committed");
    expect(find("#cart").textContent).toBe("from the write");

    late(fragments(cartFragment("stale")));
    await read;
    expect(find("#cart").textContent).toBe("from the write");
    expect(String(reported.at(-1))).toContain("content/cart changed after this request was sent; its older fragment is dropped.");
  });

  it("commits a late fragment for a target when only a target inside it changed meanwhile", async () => {
    const { transport, calls, respond, find, reported } = setup(page);
    let late: (response: Response) => void = () => undefined;
    respond(
      () => new Promise<Response>((resolve) => { late = resolve; }),
      () => fragments(`${cartFragment("from the write")}<template data-target="sidebar"><nav data-region="sidebar"><p id="side">saved</p></nav></template>`),
    );
    const read = transport.request({ kind: "refresh", url: "/content", targets: ["content"] });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect((await transport.request({ kind: "action", method: "POST", url: "/save", targets: ["sidebar"], body: "" })).status).toBe("committed");
    expect(find("#cart").textContent).toBe("from the write");

    late(fragments(`<template data-target="content"><main data-region="content"><div data-t-c="cart"><p id="cart">from the read</p></div><p id="text">new</p></main></template>`));
    expect((await read).status).toBe("committed");
    expect(find("#cart").textContent).toBe("from the read");
    expect(find("#text").textContent).toBe("new");
    expect(reported).toEqual([]);
  });

  it("commits a late fragment when only a disjoint target changed meanwhile", async () => {
    const { transport, calls, respond, find } = setup(page);
    let late: (response: Response) => void = () => undefined;
    respond(
      () => new Promise<Response>((resolve) => { late = resolve; }),
      () => fragments(`<template data-target="sidebar"><nav data-region="sidebar"><p id="side">saved</p></nav></template>`),
    );
    const read = transport.request({ kind: "refresh", url: "/cart", targets: ["content/cart"] });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    await transport.request({ kind: "action", method: "POST", url: "/side", targets: ["sidebar"], body: "" });
    late(fragments(cartFragment("late")));
    expect((await read).status).toBe("committed");
    expect(find("#cart").textContent).toBe("late");
    expect(find("#side").textContent).toBe("saved");
  });

  it("marks pending targets aria-busy and the initiating element data-loading, and clears both", async () => {
    const { transport, calls, respond, find } = setup(page);
    let answer: (response: Response) => void = () => undefined;
    respond(() => new Promise<Response>((resolve) => { answer = resolve; }));
    const button = find("#text");
    const pending = transport.request({ kind: "action", method: "POST", url: "/x", targets: ["content", "content/cart"], element: button, body: "" });
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(find("main").getAttribute("aria-busy")).toBe("true");
    expect(find("[data-t-c=cart]").getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("data-loading")).toBe(true);
    expect(find("nav").hasAttribute("aria-busy")).toBe(false);
    answer(empty(204));
    await pending;
    expect([find("main").hasAttribute("aria-busy"), find("[data-t-c=cart]").hasAttribute("aria-busy"), button.hasAttribute("data-loading")]).toEqual([false, false, false]);
  });

  it("follows a Tessera-Location while another write waits on the same target, without a deadlock", async () => {
    const { transport, calls, respond } = setup(page);
    respond(
      () => empty(200, { "Tessera-Location": "/done", "Tessera-Protocol": "2" }),
      () => empty(204),
      () => fragments(`<template data-target="content"><main data-region="content"><p id="text">done</p></main></template>`),
    );
    const first = transport.request({ kind: "submit", method: "POST", url: "/one", targets: ["content"], body: "" });
    const second = transport.request({ kind: "submit", method: "POST", url: "/two", targets: ["content"], body: "" });
    expect((await first).status).toBe("committed");
    expect((await second).status).toBe("unchanged");
    expect(calls.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual(["POST /one", "POST /two", "GET /done"]);
  });
});
