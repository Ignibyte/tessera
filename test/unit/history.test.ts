// History, focus and scroll: the state envelope, the current entry, each mode, popstate, each
// focus rule and the scroll policy. jsdom does not scroll, so scrolling is observed through stubs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTarget } from "../../src/coordination.ts";
import type { TargetNode } from "../../src/coordination.ts";
import { chooseFocus, createHistory, focusKey, readEntry, stateWith } from "../../src/history.ts";
import type { Entry } from "../../src/history.ts";
import type { HistoryMode, RequestInput, RequestOutcome, TesseraRequest, Transport } from "../../src/transport.ts";
import { disposeTransport, setup } from "./transport-fixture.ts";

let scrollTo: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
let scrollIntoView: ReturnType<typeof vi.fn>;
const realScrollTo = window.scrollTo.bind(window);

beforeEach(() => {
  scrollTo = vi.fn<(x: number, y: number) => void>();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  disposeTransport();
  window.scrollTo = realScrollTo;
  window.history.replaceState(null, "", "/");
});

const entry = (patch: Partial<Entry> = {}): Entry => ({ v: 1, kind: "visit", targets: [], scroll: null, focus: null, ...patch });

function request(history: HistoryMode, targets: string[] = []): TesseraRequest {
  return { kind: "visit", method: "GET", url: window.location.href, targets, element: undefined, body: undefined, signals: undefined, history };
}

const at = (name: string): TargetNode => resolveTarget(document, name) ?? { kind: "page", document };

function fakeTransport(outcome: RequestOutcome["status"] = "committed") {
  const requested = vi.fn((_input: RequestInput) => Promise.resolve<RequestOutcome>({ status: outcome }));
  const transport: Transport = {
    request: requested,
    submit: () => Promise.resolve({ status: "committed" }),
    actions: () => undefined,
    intercept: () => () => undefined,
  };
  return { transport, requested };
}


describe("the state envelope", () => {
  it("reads only an entry of its own shape", () => {
    expect(readEntry({ tessera: entry({ targets: ["content"], scroll: { x: 0, y: 40 }, focus: "q" }) })).toMatchObject({ targets: ["content"] });
    for (const state of [null, "x", { tessera: { v: 2, kind: "visit", targets: [] } }, { tessera: { v: 1, kind: "visit", targets: [1] } }, { tessera: entry({ scroll: { x: Number.NaN, y: 0 } }) }]) {
      expect(readEntry(state)).toBeUndefined();
    }
  });

  it("keeps the other keys of a plain state, and leaves any other state alone", () => {
    expect(stateWith({ app: 1 }, entry())).toEqual({ app: 1, tessera: entry() });
    expect(stateWith(null, entry())).toEqual({ tessera: entry() });
    expect(stateWith("theirs", entry())).toBeUndefined();
    expect(stateWith([1], entry())).toBeUndefined();
  });

  it("stores focus under data-focus-key, else a unique id", () => {
    document.body.innerHTML = `<input id="a"><input id="b" data-focus-key="query"><p id="dup"></p><p id="dup"></p><input>`;
    const [a, b, , second, plain] = Array.from(document.body.children);
    expect([focusKey(a ?? null, document), focusKey(b ?? null, document), focusKey(second ?? null, document), focusKey(plain ?? null, document), focusKey(document.body, document)]).toEqual([
      "a",
      "query",
      null,
      null,
      null,
    ]);
  });
});

describe("owning history", () => {
  it("stamps the current entry, keeping a plain state, and sets scrollRestoration manual until disposal", () => {
    window.history.replaceState({ app: "kept" }, "");
    window.history.scrollRestoration = "auto";
    const { kernel } = setup(`<main data-region="content"></main>`);
    createHistory({ kernel });
    expect(window.history.state).toEqual({ app: "kept", tessera: entry({ scroll: { x: 0, y: 0 } }) });
    expect(window.history.scrollRestoration).toBe("manual");
    kernel.dispose();
    expect(window.history.scrollRestoration).toBe("auto");
  });

  it("does not touch an entry whose state is not a plain object", () => {
    window.history.replaceState("theirs", "");
    const { kernel } = setup(`<main data-region="content"></main>`);
    createHistory({ kernel });
    expect(window.history.state).toBe("theirs");
  });

  it("captures scroll and focus into the current entry before a commit", () => {
    const { kernel, find } = setup(`<main data-region="content"><input id="q"></main>`);
    const history = createHistory({ kernel });
    find("#q").focus();
    history.capture(request("push"));
    expect(readEntry(window.history.state)).toMatchObject({ scroll: { x: 0, y: 0 }, focus: "q" });
  });

  it("pushes a new entry, replaces the current one, and writes nothing on pop", () => {
    const { kernel } = setup(`<main data-region="content"></main>`);
    const history = createHistory({ kernel });
    const length = window.history.length;
    history.commit(`${window.location.origin}/a`, request("push", ["content"]), [at("content")]);
    expect([window.history.length, window.location.pathname]).toEqual([length + 1, "/a"]);
    expect(readEntry(window.history.state)).toEqual(entry({ targets: ["content"] }));
    history.commit(`${window.location.origin}/b`, request("replace"), [at("content")]);
    expect([window.history.length, window.location.pathname]).toEqual([length + 1, "/b"]);
    const before = window.history.state as unknown;
    history.commit(window.location.href, request("pop"), [at("content")]);
    expect(window.history.state).toBe(before);
  });
});

describe("back and forward", () => {
  function pop(path: string, state: unknown): void {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  }

  it("fetches an entry of its own fresh, as a pop visit of the entry's targets", () => {
    const { kernel } = setup(`<main data-region="content"></main>`);
    const history = createHistory({ kernel });
    const { transport, requested } = fakeTransport();
    history.attach(transport);
    pop("/about", { tessera: entry({ targets: ["content"] }) });
    expect(requested).toHaveBeenCalledWith({ kind: "visit", url: `${window.location.origin}/about`, targets: ["content"], history: "pop" });
  });

  it("leaves a change of fragment alone to the browser", () => {
    const { kernel } = setup(`<main data-region="content"></main>`);
    const reload = vi.fn();
    const history = createHistory({ kernel, reload });
    const { transport, requested } = fakeTransport();
    history.attach(transport);
    pop("/#below", null);
    expect(requested).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads for an entry it did not make, and when the pop visit fails", async () => {
    const { kernel } = setup(`<main data-region="content"></main>`);
    const reload = vi.fn();
    const history = createHistory({ kernel, reload });
    const failing = fakeTransport("failed");
    history.attach(failing.transport);
    pop("/elsewhere", { app: 1 });
    expect(reload).toHaveBeenCalledOnce();
    pop("/other", { tessera: entry() });
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(2);
    });
  });
});

describe("focus", () => {
  const html = `<nav data-region="sidebar"><a id="side" href="/x">x</a></nav>
    <main data-region="content"><h1>Title</h1><input id="field"><input id="auto" autofocus><p id="target">t</p></main>`;

  it.each([
    ["the server's autofocus first", { storedKey: "field", hash: "#target" }, "server", "auto"],
  ] as const)("chooses %s", (_case, extra, reason, id) => {
    document.body.innerHTML = html;
    const choice = chooseFocus({ document, updated: [document.querySelector("main") as Element], active: null, ...extra });
    expect([choice.reason, choice.element?.id]).toEqual([reason, id]);
  });

  it("then the stored key, then the fragment, then the heading, then the body", () => {
    document.body.innerHTML = html.replace(" autofocus", "");
    const main = document.querySelector("main") as Element;
    const pick = (storedKey: string | null, hash: string, active: Element | null) => {
      const choice = chooseFocus({ document, updated: [main], active, storedKey, hash });
      return [choice.reason, choice.element?.localName ?? null, choice.element?.id ?? null];
    };
    expect(pick("field", "#target", null)).toEqual(["stored", "input", "field"]);
    expect(pick(null, "#target", null)).toEqual(["fragment", "p", "target"]);
    expect(pick(null, "", null)).toEqual(["heading", "h1", ""]);
    main.querySelector("h1")?.remove();
    expect(pick(null, "", null)).toEqual(["body", null, null]);
  });

  it("keeps focus outside what changed, but not inside it", () => {
    document.body.innerHTML = html.replace(" autofocus", "");
    const main = document.querySelector("main") as Element;
    expect(chooseFocus({ document, updated: [main], active: document.querySelector("#side"), storedKey: null, hash: "" }).reason).toBe("kept");
    expect(chooseFocus({ document, updated: [main], active: document.querySelector("#field"), storedKey: null, hash: "" }).reason).toBe("heading");
  });

  it("focuses the heading after enhancement, making it focusable only then", async () => {
    const { kernel, find } = setup(`<main data-region="content"><h1>Old</h1><input id="field"></main>`);
    const history = createHistory({ kernel });
    find("#field").focus();
    find("main").innerHTML = "<h1>New</h1><p>content</p>";
    history.commit(`${window.location.origin}/new`, request("push", ["content"]), [at("content")]);
    await vi.waitFor(() => {
      expect(document.activeElement?.localName).toBe("h1");
    });
    expect(find("h1").getAttribute("tabindex")).toBe("-1");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("leaves focus where the user put it after the commit", async () => {
    const { kernel, find } = setup(`<main data-region="content"><h1>T</h1><input id="a"><input id="b"></main>`);
    const history = createHistory({ kernel, settleMs: 20 });
    history.commit(`${window.location.origin}/n`, request("push", ["content"]), [at("content")]);
    find("#b").focus();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(document.activeElement?.id).toBe("b");
  });

  it("applies only the latest visit's focus and scroll", async () => {
    const { kernel, find } = setup(`<main data-region="content"><h1>T</h1><input id="auto" autofocus></main><nav data-region="sidebar"><h1 id="side-title">S</h1></nav>`);
    const history = createHistory({ kernel });
    history.commit(`${window.location.origin}/one`, request("push", ["content"]), [at("content")]);
    history.commit(`${window.location.origin}/two`, request("push", ["sidebar"]), [at("sidebar")]);
    await vi.waitFor(() => {
      expect(document.activeElement?.id).toBe("side-title");
    });
    expect(find("#auto")).not.toBe(document.activeElement);
  });
});

describe("scroll", () => {
  it("restores the stored position on pop, and goes to a fragment on push", async () => {
    const { kernel, find } = setup(`<main data-region="content"><h1>T</h1><p id="part">p</p></main>`);
    const history = createHistory({ kernel });
    history.attach(fakeTransport().transport);
    window.history.pushState(null, "", "/back");
    window.dispatchEvent(new PopStateEvent("popstate", { state: { tessera: entry({ targets: ["content"], scroll: { x: 0, y: 480 } }) } }));
    history.commit(window.location.href, request("pop", ["content"]), [at("content")]);
    await vi.waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(0, 480);
    });

    history.commit(`${window.location.origin}/page#part`, request("push", ["content"]), [at("content")]);
    await vi.waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledOnce();
    });
    expect(document.activeElement).toBe(find("#part"));
  });

  it("leaves the scroll to the user who scrolled after the commit", async () => {
    const { kernel } = setup(`<main data-region="content"><h1>T</h1></main>`);
    const history = createHistory({ kernel, settleMs: 20 });
    history.commit(`${window.location.origin}/n`, request("push", ["content"]), [at("content")]);
    window.dispatchEvent(new WheelEvent("wheel"));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
