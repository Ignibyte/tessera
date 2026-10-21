// The attributes and the built-in directives on the DOM: each attribute and each data-on
// modifier, the DOM changing under a mount, and every resource released exactly once.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActionRecorder } from "../../src/actions.ts";
import { ERROR_EVENT, mountAttributes } from "../../src/attributes.ts";
import type { AttributeFailure } from "../../src/attributes.ts";
import { registerBuiltins } from "../../src/builtins.ts";
import { createDirectiveRegistry } from "../../src/directive.ts";
import { createTrustedExpressionEngine } from "../../src/expression.ts";
import { Kernel } from "../../src/kernel.ts";
import { reactive, Scheduler } from "../../src/reactivity.ts";
import { disposeFixtures, frames, setup } from "./attributes-fixture.ts";

afterEach(disposeFixtures);

function messages(failures: readonly AttributeFailure[]): string[] {
  return failures.map(({ error }) => (error instanceof Error ? error.message : String(error)));
}

describe("data-signals", () => {
  it("deep-merges objects in document order, cloning what it merges", () => {
    const shared = { nested: { a: 1 } };
    const { signals, failures } = setup(
      `<div data-signals="{user: {name: 'Ada', tags: ['x']}, count: 1}">
         <p data-signals="{user: {age: 36}, count: 2}"></p>
       </div>`,
      { signals: reactive<Record<string, unknown>>({ shared }) },
    );
    expect(signals).toEqual({ shared, user: { name: "Ada", tags: ["x"], age: 36 }, count: 2 });
    expect(failures).toEqual([]);
  });

  it("merges before any other directive in the subtree reads", () => {
    const { find, failures } = setup(`<p data-text="$later.label"></p><div data-signals="{later: {label: 'ready'}}"></div>`);
    expect(find("p").textContent).toBe("ready");
    expect(failures).toEqual([]);
  });

  it("refuses a value that is not an object", () => {
    const { failures } = setup(`<div data-signals="[1, 2]"></div>`);
    expect(messages(failures)).toEqual(['data-signals must evaluate to an object, as in data-signals="{count: 0}".']);
    expect(failures[0]?.attribute).toBe("data-signals");
  });
});

describe("data-computed", () => {
  it("defines a memoized signal that follows its dependencies", async () => {
    const { find, signals, settle } = setup(
      `<div data-signals="{first: 'Ada', last: 'Lovelace'}" data-computed:full-name="$first + ' ' + $last">
         <p data-text="$fullName"></p>
       </div>`,
    );
    expect(find("p").textContent).toBe("Ada Lovelace");
    signals.last = "Byron";
    await settle();
    expect(find("p").textContent).toBe("Ada Byron");
  });

  it("removes the signal when the attribute goes, and cannot be assigned", async () => {
    const { find, signals, settle, failures } = setup(
      `<div data-signals="{n: 2}" data-computed:double="$n * 2"><button data-on:click="$double = 1"></button></div>`,
    );
    expect(signals.double).toBe(4);
    find("button").click();
    await settle();
    expect(messages(failures).join()).toContain("double");
    find("div").removeAttribute("data-computed:double");
    await settle();
    expect("double" in signals).toBe(false);
  });
});

describe("data-ref", () => {
  it("puts the element itself in a signal, by key or by value", () => {
    const { find, signals } = setup(`<input data-ref:field><button data-ref="button"></button><p data-text="$field.localName"></p>`);
    expect(signals.field).toBe(find("input"));
    expect(signals.button).toBe(find("button"));
    expect(find("p").textContent).toBe("input");
  });

  it("drops the signal with the element", async () => {
    const { find, signals, settle } = setup(`<input data-ref:field>`);
    find("input").remove();
    await settle();
    expect("field" in signals).toBe(false);
  });
});

describe("showing values", () => {
  it("data-text writes text, JSON for objects, nothing for null", async () => {
    const { find, signals, settle } = setup(`<p data-signals="{v: 'a'}" data-text="$v"></p>`);
    expect(find("p").textContent).toBe("a");
    signals.v = { b: 1 };
    await settle();
    expect(find("p").textContent).toBe('{"b":1}');
    signals.v = null;
    await settle();
    expect(find("p").textContent).toBe("");
  });

  it("data-show hides with display none and restores the element's own display", async () => {
    const { find, signals, settle } = setup(`<p data-signals="{on: false}" style="display: flex" data-show="$on"></p>`);
    expect(find("p").style.display).toBe("none");
    signals.on = true;
    await settle();
    expect(find("p").style.display).toBe("flex");
  });

  it("data-class toggles classes from an object and removes only what it added", async () => {
    const { find, signals, settle } = setup(
      `<p class="base" data-signals="{a: true, b: false}" data-class="{'one two': $a, three: $b, base: $b}"></p>`,
    );
    const p = find("p");
    expect([...p.classList]).toEqual(["one", "two"]);
    signals.a = false;
    signals.b = true;
    await settle();
    expect([...p.classList].sort()).toEqual(["base", "three"]);
    p.removeAttribute("data-class");
    await settle();
    expect([...p.classList]).toEqual(["base"]);
  });

  it("data-attr sets, empties and removes, then restores the original", async () => {
    const { find, signals, settle } = setup(`<button title="orig" data-signals="{t: 'x'}" data-attr:title="$t" data-attr:disabled="$t === 'off'"></button>`);
    const button = find("button");
    expect(button.getAttribute("title")).toBe("x");
    expect(button.hasAttribute("disabled")).toBe(false);
    signals.t = "off";
    await settle();
    expect(button.getAttribute("disabled")).toBe("");
    signals.t = null;
    await settle();
    expect(button.hasAttribute("title")).toBe(false);
    button.removeAttribute("data-attr:title");
    await settle();
    expect(button.getAttribute("title")).toBe("orig");
  });

  it("data-style sets a property and restores it for null", async () => {
    const { find, signals, settle } = setup(`<p style="color: blue" data-signals="{c: 'red'}" data-style:color="$c" data-style:background-color="'green'"></p>`);
    const p = find("p");
    expect(p.style.color).toBe("red");
    expect(p.style.backgroundColor).toBe("green");
    signals.c = null;
    await settle();
    expect(p.style.color).toBe("blue");
  });
});

describe("data-bind", () => {
  function type(window: Window & typeof globalThis, field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    field.value = value;
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  }

  it("binds a text input both ways, starting from the element when the signal is unset", async () => {
    const { find, signals, settle, window } = setup(`<input value="start" data-bind:user.first-name>`);
    const input = (find("input") as HTMLInputElement);
    expect(signals).toEqual({ user: { firstName: "start" } });
    type(window, input, "Ada");
    expect((signals.user as { firstName: string }).firstName).toBe("Ada");
    (signals.user as { firstName: string }).firstName = "Grace";
    await settle();
    expect(input.value).toBe("Grace");
  });

  it("reads number and range inputs as numbers, empty as null", () => {
    const { find, signals, window } = setup(`<input type="number" value="3" data-bind:n><input type="range" value="7" data-bind:r>`);
    expect(signals).toEqual({ n: 3, r: 7 });
    type(window, (find("input") as HTMLInputElement), "");
    expect(signals.n).toBeNull();
  });

  it("keeps a number signal a number through a text input", () => {
    const { find, signals, window } = setup(`<input data-signals="{qty: 1}" data-bind:qty>`);
    type(window, (find("input") as HTMLInputElement), "5");
    expect(signals.qty).toBe(5);
  });

  it("binds a checkbox to a boolean, and checkboxes to an array", async () => {
    const { doc, signals, settle } = setup(
      `<input type="checkbox" id="agree" data-bind:agree>
       <div data-signals="{tags: ['b']}"><input type="checkbox" value="a" data-bind:tags><input type="checkbox" value="b" data-bind:tags></div>`,
    );
    const [agree, a, b] = Array.from(doc.querySelectorAll<HTMLInputElement>("input"));
    expect(signals.agree).toBe(false);
    expect([a?.checked, b?.checked]).toEqual([false, true]);
    agree?.click();
    a?.click();
    b?.click();
    expect(signals.agree).toBe(true);
    expect(signals.tags).toEqual(["a"]);
    signals.tags = ["a", "b"];
    await settle();
    expect(b?.checked).toBe(true);
  });

  it("binds radios to the checked value", async () => {
    const { doc, signals, settle } = setup(
      `<input type="radio" name="size" value="s" data-bind:size><input type="radio" name="size" value="m" checked data-bind:size>`,
    );
    const [small, medium] = Array.from(doc.querySelectorAll<HTMLInputElement>("input"));
    expect(signals.size).toBe("m");
    small?.click();
    expect(signals.size).toBe("s");
    signals.size = "m";
    await settle();
    expect(medium?.checked).toBe(true);
  });

  it("binds a select, a multiple select and a textarea", async () => {
    const { find, signals, settle, window } = setup(
      `<select id="one" data-bind:one><option>a</option><option selected>b</option></select>
       <select id="many" multiple data-bind:many><option selected>x</option><option>y</option><option selected>z</option></select>
       <textarea data-bind:note>hello</textarea>`,
    );
    expect(signals).toEqual({ one: "b", many: ["x", "z"], note: "hello" });
    const many = (find("#many") as HTMLSelectElement);
    signals.many = ["y"];
    signals.one = "a";
    await settle();
    expect(Array.from(many.selectedOptions, (option) => option.value)).toEqual(["y"]);
    expect((find("#one") as HTMLSelectElement).value).toBe("a");
    type(window, (find("textarea") as HTMLTextAreaElement), "bye");
    expect(signals.note).toBe("bye");
  });

  it("refuses an element that holds no value", () => {
    const { failures } = setup(`<div data-bind:x></div>`);
    expect(messages(failures)).toEqual(["data-bind works on input, select and textarea elements."]);
  });
});

describe("statements", () => {
  it("data-effect runs again when what it read changes", async () => {
    const { signals, settle } = setup(`<div data-signals="{a: 1, seen: 0}" data-effect="$seen = $a * 10"></div>`);
    expect(signals.seen).toBe(10);
    signals.a = 2;
    await settle();
    expect(signals.seen).toBe(20);
  });

  it("data-init runs once, after the subtree's signals and bindings", async () => {
    const { signals, settle } = setup(`<div data-init="$runs = ($runs ?? 0) + 1; $saw = $name"></div><input value="Ada" data-bind:name>`);
    expect(signals).toMatchObject({ runs: 1, saw: "Ada" });
    signals.name = "Grace";
    await settle();
    expect(signals.runs).toBe(1);
  });

  it("reports a statement that fails after an await", async () => {
    const { settle, failures } = setup(`<div data-init="await Promise.resolve(); throw new Error('late')"></div>`);
    await settle();
    expect(messages(failures)).toEqual([expect.stringContaining("late")]);
  });
});

describe("data-on", () => {
  function key(window: Window & typeof globalThis, target: Element, name: string): void {
    target.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true }));
  }

  it("runs its statement with evt and el", () => {
    const { find, signals } = setup(`<button id="b" data-on:click="$type = evt.type; $id = el.id">go</button>`);
    find("button").click();
    expect(signals).toEqual({ type: "click", id: "b" });
  });

  it("calls actions through the seam", async () => {
    const { find, recorder, settle } = setup(`<button data-signals="{id: 4}" data-on:click="@post('/items/' + $id)">save</button>`);
    find("button").click();
    await settle();
    expect(recorder.calls.map(({ method, url }) => `${method} ${url}`)).toEqual(["post /items/4"]);
  });

  it("__prevent and __stop", () => {
    const { find, doc } = setup(`<div id="outer"><a href="#x" data-on:click__prevent__stop="$n = 1">x</a></div>`);
    const outer = vi.fn();
    find("#outer").addEventListener("click", outer);
    const event = new (doc.defaultView as Window & typeof globalThis).MouseEvent("click", { bubbles: true, cancelable: true });
    find("a").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
  });

  it("__once", () => {
    const { find, signals } = setup(`<button data-signals="{n: 0}" data-on:click__once="$n++"></button>`);
    find("button").click();
    find("button").click();
    expect(signals.n).toBe(1);
  });

  it("__self", () => {
    const { find, signals } = setup(`<div data-signals="{n: 0}" data-on:click__self="$n++"><span>inner</span></div>`);
    find("span").click();
    expect(signals.n).toBe(0);
    find("div").click();
    expect(signals.n).toBe(1);
  });

  it("__outside", () => {
    const { find, signals } = setup(`<div id="menu" data-signals="{n: 0}" data-on:click__outside="$n++"><span>in</span></div><p>out</p>`);
    find("span").click();
    expect(signals.n).toBe(0);
    find("p").click();
    expect(signals.n).toBe(1);
  });

  it("__window and __document", () => {
    const { window, doc, signals } = setup(
      `<div data-signals="{w: 0, d: 0}" data-on:resize__window="$w++" data-on:ping__document="$d++"></div>`,
    );
    window.dispatchEvent(new window.Event("resize"));
    doc.dispatchEvent(new window.Event("ping"));
    expect(signals).toMatchObject({ w: 1, d: 1 });
  });

  it("__capture runs before a bubbling listener inside", () => {
    const { find, signals } = setup(`<div data-signals="{order: []}" data-on:click__capture="$order.push('outer')"><button>b</button></div>`);
    find("button").addEventListener("click", () => {
      (signals.order as string[]).push("inner");
    });
    find("button").click();
    expect(signals.order).toEqual(["outer", "inner"]);
  });

  it("__passive cannot prevent the default", () => {
    const { find, window } = setup(`<div data-on:wheel__passive="evt.preventDefault()"></div>`);
    const event = new window.Event("wheel", { cancelable: true });
    find("div").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("__debounce waits for quiet, with the last event", () => {
    vi.useFakeTimers();
    const { find, signals } = setup(`<input data-signals="{runs: 0}" data-on:input__debounce.200ms="$runs++; $last = evt.data">`);
    const input = find("input");
    for (const data of ["a", "b", "c"]) input.dispatchEvent(new InputEvent("input", { data }));
    vi.advanceTimersByTime(199);
    expect(signals.runs).toBe(0);
    vi.advanceTimersByTime(1);
    expect(signals).toMatchObject({ runs: 1, last: "c" });
  });

  it("__throttle runs at most once per interval", () => {
    vi.useFakeTimers();
    const { find, signals } = setup(`<button data-signals="{runs: 0}" data-on:click__throttle.1s="$runs++"></button>`);
    find("button").click();
    find("button").click();
    vi.advanceTimersByTime(1000);
    find("button").click();
    expect(signals.runs).toBe(2);
  });

  it.each([
    ["enter", "Enter"],
    ["escape", "Escape"],
    ["space", " "],
    ["tab", "Tab"],
    ["up", "ArrowUp"],
    ["down", "ArrowDown"],
    ["left", "ArrowLeft"],
    ["right", "ArrowRight"],
  ])("the __%s key filter", (filter, keyName) => {
    const { find, signals, window } = setup(`<input data-signals="{n: 0}" data-on:keydown__${filter}="$n++">`);
    key(window, find("input"), "x");
    key(window, find("input"), keyName);
    expect(signals.n).toBe(1);
  });

  it.each([
    ["prevent with passive", "data-on:click__prevent__passive", "prevent and passive cannot be combined"],
    ["a bad duration", "data-on:input__debounce.soon", "debounce takes a duration such as 250, 250ms or 1s"],
    ["an unknown modifier", "data-on:click__twice", "data-on has no modifier twice"],
    ["two key filters", "data-on:keydown__enter__tab", "one key filter per listener"],
    ["a missing event", "data-on", "data-on needs a key"],
  ])("refuses %s", (_case, attribute, message) => {
    const { failures } = setup(`<button ${attribute}="1"></button>`);
    expect(messages(failures)).toEqual([expect.stringContaining(message)]);
  });
});

describe("the __case modifier", () => {
  const dispatch = (element: Element, type: string): void => {
    element.dispatchEvent(new Event(type, { bubbles: true }));
  };

  it.each([
    ["camel", "myEvent"],
    ["snake", "my_event"],
    ["pascal", "MyEvent"],
    ["kebab", "my-event"],
  ])("data-on:my-event__case.%s listens to %s", (spelling, type) => {
    const { find, signals } = setup(`<button data-signals="{n: 0}" data-on:my-event__case.${spelling}="$n++"></button>`);
    for (const other of ["myEvent", "my_event", "MyEvent", "my-event"]) dispatch(find("button"), other);
    expect(signals.n).toBe(1);
    dispatch(find("button"), type);
    expect(signals.n).toBe(2);
  });

  it("leaves data-on's key in kebab case by default, and converts only hyphens", () => {
    const { find, signals } = setup(
      `<button data-signals="{n: 0, m: 0}" data-on:my-event="$n++" data-on:lib:after-swap.done__case.camel="$m++"></button>`,
    );
    dispatch(find("button"), "myEvent");
    expect(signals.n).toBe(0);
    dispatch(find("button"), "my-event");
    expect(signals.n).toBe(1);
    dispatch(find("button"), "lib:afterSwap.done");
    expect(signals.m).toBe(1);
  });

  it("spells the signal data-computed, data-ref and data-bind name, camelCase by default", () => {
    const { signals } = setup(
      `<div data-signals="{n: 2}" data-computed:twice-n="$n * 2" data-computed:half-n__case.snake="$n / 2">
         <input data-ref:the-field__case.pascal>
         <input value="Ada" data-bind:user.first-name__case.snake>
         <input value="x" data-bind:last-seen>
       </div>`,
    );
    expect(signals.twiceN).toBe(4);
    expect(signals.half_n).toBe(1);
    expect((signals.TheField as Element).localName).toBe("input");
    expect(signals.user).toEqual({ first_name: "Ada" });
    expect(signals.lastSeen).toBe("x");
  });

  it.each([
    ["an unknown case", "data-on:my-event__case.upper", "__case.upper is not a case; use camel, kebab, snake or pascal"],
    ["two __case modifiers", "data-on:my-event__case.camel__case.snake", "one __case per attribute"],
    ["__case without a name", "data-on:my-event__case", "__case takes one case name, as in __case.camel"],
    ["__case with two names", "data-computed:my-value__case.camel.snake", "__case takes one case name, as in __case.camel"],
    ["__case where it is not taken", "data-attr:aria-label__case.camel", "data-attr has no modifier case"],
  ])("refuses %s", (_case, attribute, message) => {
    const { failures } = setup(`<button ${attribute}="1"></button>`);
    expect(messages(failures)).toEqual([expect.stringContaining(message)]);
  });
});

describe("data-ignore", () => {
  it("skips an element and its subtree, or with __self only the element", () => {
    const { doc } = setup(
      `<div data-ignore><p id="a" data-text="'x'"></p></div><div data-ignore__self data-text="'y'"><p id="b" data-text="'z'"></p></div>`,
    );
    expect(doc.querySelector("#a")?.textContent).toBe("");
    expect(doc.querySelector("[data-ignore__self]")?.firstElementChild?.id).toBe("b");
    expect(doc.querySelector("#b")?.textContent).toBe("z");
  });

  it("releases when added and applies when removed", async () => {
    const { find, signals, settle } = setup(`<section><button data-signals="{n: 0}" data-on:click="$n++"></button></section>`);
    find("section").setAttribute("data-ignore", "");
    await settle();
    find("button").click();
    expect(signals.n).toBe(0);
    find("section").removeAttribute("data-ignore");
    await settle();
    find("button").click();
    expect(signals.n).toBe(1);
  });

  it("data-ignore-morph and data-html change nothing here", () => {
    const { find, failures } = setup(`<div data-ignore-morph data-html="'<b>x</b>'">kept</div>`);
    expect(find("div").innerHTML).toBe("kept");
    expect(failures).toEqual([]);
  });
});

describe("the DOM changing", () => {
  it("applies directives to added elements", async () => {
    const { doc, signals, settle } = setup(`<div data-signals="{n: 5}"></div>`);
    doc.body.insertAdjacentHTML("beforeend", `<p data-text="$n"></p>`);
    await settle();
    expect(doc.querySelector("p")?.textContent).toBe("5");
    signals.n = 6;
    await settle();
    expect(doc.querySelector("p")?.textContent).toBe("6");
  });

  it("re-applies a changed attribute and releases a removed one", async () => {
    const { find, signals, settle } = setup(`<button data-signals="{a: 0, b: 0}" data-on:click="$a++"></button>`);
    const button = find("button");
    button.setAttribute("data-on:click", "$b++");
    await settle();
    button.click();
    expect(signals).toMatchObject({ a: 0, b: 1 });
    button.removeAttribute("data-on:click");
    await settle();
    button.click();
    expect(signals.b).toBe(1);
  });

  it("releases a removed element's listeners and effects exactly once", async () => {
    const { find, signals, settle, kernel, scheduler } = setup(
      `<div data-signals="{n: 0, text: 'a'}"></div><section><button data-on:click="$n++" data-text="$text"></button></section>`,
    );
    const button = find("button");
    const held = (): string[] =>
      kernel
        .resourceSummary()
        .filter(({ owner }) => owner.includes("data-on:click") || owner.includes("data-text"))
        .map(({ kind }) => kind)
        .sort();
    expect(held()).toEqual(["effect", "listener", "service"]);

    find("section").remove();
    await settle();
    expect(held()).toEqual([]);
    button.click();
    expect(signals.n).toBe(0);
    signals.text = "b";
    await scheduler.nextUpdate();
    expect(button.textContent).toBe("a");
  });

  it("runs a directive's cleanup once, however it is released", async () => {
    const { kernel, find, doc, settle } = setup(`<p></p>`);
    const registry = createDirectiveRegistry();
    const cleanup = vi.fn();
    registry.register({ name: "probe", key: "forbidden", mount: () => cleanup });
    const scheduler = new Scheduler();
    const mount = mountAttributes(find("p"), {
      kernel,
      scheduler,
      expressions: createTrustedExpressionEngine(),
      registry,
      actions: createActionRecorder().seam,
    });
    find("p").innerHTML = `<i data-probe></i>`;
    await settle();
    const i = find("i");
    const transaction = kernel.beginRender(doc.body);
    transaction.beforeRemove(i);
    i.remove();
    transaction.commit();
    await settle();
    mount.destroy();
    kernel.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("releases inside a render's beforeRemove while the subtree is still connected", () => {
    const { kernel, find, doc } = setup(`<section><p data-text="'x'"></p></section>`);
    const transaction = kernel.beginRender(doc.body);
    const before = kernel.resourceSummary().length;
    transaction.beforeRemove(find("section"));
    expect(find("section").isConnected).toBe(true);
    expect(kernel.resourceSummary().length).toBeLessThan(before);
    transaction.commit();
  });

  it("keeps a preserved root's directives through a render that moves it", async () => {
    const { kernel, find, doc, signals, settle } = setup(
      `<main><section id="kept"><button data-signals="{n: 0}" data-on:click="$n++"></button></section><p>old</p></main>`,
    );
    const main = find("main");
    const kept = find("#kept");
    const transaction = kernel.beginRender(main, { preserveRoots: [kept] });
    transaction.beforeRemove(main.querySelector("p") ?? main);
    main.replaceChildren(doc.createElement("p"), kept);
    transaction.commit();
    await settle();
    find("button").click();
    expect(signals.n).toBe(1);
  });
});

describe("the mount", () => {
  it("releases everything it holds on destroy, and the kernel destroys it on disposal", () => {
    const { mount, kernel, owners } = setup(`<div data-signals="{n: 1}"><button data-on:click="$n++" data-text="$n"></button></div>`);
    expect(owners().some((owner) => owner.startsWith("attributes:"))).toBe(true);
    expect(kernel.mountCount()).toBe(1);
    mount.destroy();
    expect(owners().filter((owner) => owner.startsWith("attributes:"))).toEqual([]);
    expect(kernel.mountCount()).toBe(0);
  });

  it("is destroyed by the kernel's disposal", () => {
    const { mount, kernel } = setup(`<p data-text="1"></p>`);
    kernel.dispose();
    expect(mount.destroyed).toBe(true);
    expect(kernel.resourceSummary()).toEqual([]);
  });

  function unreported(html: string) {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const window = frame.contentWindow as Window & typeof globalThis;
    const doc = window.document;
    doc.body.innerHTML = html;
    const scheduler = new Scheduler();
    const kernel = new Kernel(doc, { flush: () => scheduler.nextUpdate() });
    frames.push({ frame, kernel });
    const registry = createDirectiveRegistry();
    registerBuiltins(registry);
    const start = (): void => {
      mountAttributes(doc.body, { kernel, scheduler, expressions: createTrustedExpressionEngine(), registry, actions: createActionRecorder().seam });
    };
    return { window, doc, start };
  }

  it("raises tessera:error on the element, naming the attribute and expression", () => {
    const { window, doc, start } = unreported(`<p data-text="missing + 1"></p>`);
    const logged = vi.spyOn(window.console, "error").mockImplementation(() => undefined);
    const raised: AttributeFailure[] = [];
    doc.addEventListener(ERROR_EVENT, (event) => {
      event.preventDefault();
      raised.push((event as CustomEvent<AttributeFailure>).detail);
    });
    start();

    expect(raised.map(({ attribute, expression, element }) => [attribute, expression, element.localName])).toEqual([
      ["data-text", "missing + 1", "p"],
    ]);
    expect(logged).not.toHaveBeenCalled();
  });

  it("logs a failure no listener handled", () => {
    const { window, start } = unreported(`<p data-text="missing + 1"></p>`);
    const logged = vi.spyOn(window.console, "error").mockImplementation(() => undefined);
    start();
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ name: "ExpressionError" }));
  });
});
