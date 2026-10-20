// The trusted expression engine: the shared conformance cases, then signals, statements,
// actions, the closed scope, caching and disposal. The caching and disposal cases are ported
// from jqstar `test/expression-engine.test.ts`.
import { describe, expect, it } from "vitest";
import { createActionRecorder } from "../../src/actions.ts";
import { createTrustedExpressionEngine, ExpressionError, rewriteActions } from "../../src/expression.ts";
import type { ExpressionContext } from "../../src/expression.ts";
import { reactive, Scheduler } from "../../src/reactivity.ts";
import { runExpressionEngineConformance } from "./expression-conformance.ts";

runExpressionEngineConformance("trusted JavaScript", createTrustedExpressionEngine);

function context(signals: Record<string, unknown> = {}, element: Element = document.createElement("div")) {
  const recorder = createActionRecorder();
  const current: ExpressionContext = { element, signals, actions: recorder.seam };
  return { current, recorder };
}

function failure(work: () => unknown): ExpressionError {
  try {
    work();
  } catch (error) {
    if (error instanceof ExpressionError) return error;
    throw error;
  }
  throw new Error("expected an ExpressionError");
}

describe("signals", () => {
  it("reads and writes signals, nested values included", async () => {
    const engine = createTrustedExpressionEngine();
    const { current } = context({ user: { name: "Ada" }, count: 1 });

    expect(engine.compileValue("$user.name")(current)).toBe("Ada");
    await engine.compileStatement("$user.name = 'Grace'; $count++")(current);
    expect(current.signals).toEqual({ user: { name: "Grace" }, count: 2 });
  });

  it("reads an undeclared signal as undefined and creates it on write", async () => {
    const engine = createTrustedExpressionEngine();
    const { current } = context();
    expect(engine.compileValue("$later")(current)).toBeUndefined();
    await engine.compileStatement("$later = 'now'")(current);
    expect(current.signals.later).toBe("now");
  });

  it("drives effects when the signals are reactive", async () => {
    const engine = createTrustedExpressionEngine();
    const scheduler = new Scheduler();
    const signals = reactive<Record<string, unknown>>({ count: 1 });
    const { current } = context(signals);
    const read = engine.compileValue("$count * 10");
    const seen: unknown[] = [];
    scheduler.effect(() => seen.push(read(current)));

    await engine.compileStatement("$count = 2")(current);
    await scheduler.nextUpdate();
    expect(seen).toEqual([10, 20]);
  });
});

describe("statements", () => {
  it("runs several expressions in order, with local declarations", async () => {
    const engine = createTrustedExpressionEngine();
    const { current } = context({ a: 1 });
    await engine.compileStatement("const twice = $a * 2; $b = twice; $c = $b + 1; $a = 0")(current);
    expect(current.signals).toEqual({ a: 0, b: 2, c: 3 });
  });

  it("runs synchronously up to the first await", () => {
    const engine = createTrustedExpressionEngine();
    const { current } = context({ n: 0 });
    void engine.compileStatement("$n = 1; await Promise.resolve(); $n = 2")(current);
    expect(current.signals.n).toBe(1);
  });

  it("binds this to the element", async () => {
    const engine = createTrustedExpressionEngine();
    const element = document.createElement("input");
    const { current } = context({}, element);
    await engine.compileStatement("$same = this === el")(current);
    expect(current.signals.same).toBe(true);
  });
});

describe("actions", () => {
  it("compiles each method anywhere in an expression", async () => {
    const engine = createTrustedExpressionEngine();
    const { current, recorder } = context({ saving: false, id: 3 });
    await engine.compileStatement(
      "$saving = true; await @post('/save', { id: $id }); @get('/a'); @put('/b'); @patch('/c'); @delete('/d')",
    )(current);

    expect(current.signals.saving).toBe(true);
    expect(recorder.calls.map(({ method, url, options }) => [method, url, options])).toEqual([
      ["post", "/save", { id: 3 }],
      ["get", "/a", undefined],
      ["put", "/b", undefined],
      ["patch", "/c", undefined],
      ["delete", "/d", undefined],
    ]);
  });

  it("passes the element and the event with the call", async () => {
    const engine = createTrustedExpressionEngine();
    const element = document.createElement("button");
    const { current, recorder } = context({}, element);
    const event = new Event("click");
    await engine.compileStatement("@post('/x')")({ ...current, event });
    expect(recorder.calls[0]).toMatchObject({ element, event });
  });

  it("leaves an @ inside strings and comments alone", async () => {
    const engine = createTrustedExpressionEngine();
    const { current, recorder } = context();
    await engine.compileStatement(
      `$a = "mail @post(x)"; $b = 'it\\'s @get('; $c = \`@put(\`; // @delete(
       /* @patch( */ $d = 1`,
    )(current);
    expect(current.signals).toEqual({ a: "mail @post(x)", b: "it's @get(", c: "@put(", d: 1 });
    expect(recorder.calls).toEqual([]);
  });

  it.each([
    ["an unknown action", "@send('/x')", "Unknown action @send"],
    ["an action without parentheses", "@post", "An action is a call"],
  ])("refuses %s when compiling", (_case, source, message) => {
    const engine = createTrustedExpressionEngine();
    const error = failure(() => engine.compileStatement(source));
    expect(error.phase).toBe("compile");
    expect(error.message).toContain(message);
  });

  it.each([
    ["a URL that is not a string", "@get(42)", "needs a URL string"],
    ["options that are not an object", "@get('/x', 'fast')", "options must be an object"],
    ["extra arguments", "@get('/x', {}, 1)", "takes a URL and an optional options object"],
  ])("refuses %s when evaluating", (_case, source, message) => {
    const engine = createTrustedExpressionEngine();
    const { current, recorder } = context();
    const error = failure(() => engine.compileValue(source)(current));
    expect(error.phase).toBe("evaluate");
    expect(error.message).toContain(message);
    expect(recorder.calls).toEqual([]);
  });

  it("rewrites only the call head", () => {
    expect(rewriteActions("@get('/a')")).toBe(`__tesseraAction("get", '/a')`);
    expect(rewriteActions("@post ()")).toBe(`__tesseraAction("post", )`);
  });
});

describe("the closed scope", () => {
  it("names the identifier, the expression and the element", () => {
    const engine = createTrustedExpressionEngine();
    const element = document.createElement("span");
    element.id = "total";
    const { current } = context({}, element);
    const error = failure(() => engine.compileValue("price * 2", { attribute: "data-text" })(current));

    expect(error.element).toBe(element);
    expect(error.message).toBe(
      "Could not evaluate Tessera expression “price * 2” at data-text on <span id=\"total\">: price is not defined. " +
        "Expressions see signals ($name), el, evt, registered helpers and JavaScript's built-ins; " +
        "page globals such as window are not in scope.",
    );
  });

  it.each(["typeof window", "globalThis", "setTimeout(() => 1)", "console.log(1)", "localStorage", "location.href"])(
    "refuses the page global in %s",
    (source) => {
      const engine = createTrustedExpressionEngine();
      const { current } = context();
      expect(failure(() => engine.compileValue(source)(current)).message).toContain("is not defined");
    },
  );

  it("refuses assignments to anything but signals", async () => {
    const engine = createTrustedExpressionEngine();
    const { current } = context();
    await expect(engine.compileStatement("leaked = 1")(current)).rejects.toThrow("an expression assigns only to signals");
    await expect(engine.compileStatement("el = null")(current)).rejects.toThrow("an expression assigns only to signals");
    expect("leaked" in globalThis).toBe(false);
  });

  it("offers JavaScript's built-ins", () => {
    const engine = createTrustedExpressionEngine();
    const { current } = context({ items: [3, 1, 2] });
    expect(
      engine.compileValue(
        "[Math.max(...$items), JSON.stringify({ a: 1 }), Number.isNaN(NaN), String(undefined), Array.isArray($items), parseInt('12', 10), encodeURIComponent('a b')]",
      )(current),
    ).toEqual([3, '{"a":1}', true, "undefined", true, 12, "a%20b"]);
  });

  it("allows arrow functions and their parameters", () => {
    const engine = createTrustedExpressionEngine();
    const { current } = context({ items: [1, 2] });
    expect(engine.compileValue("$items.map((item) => item * 2)")(current)).toEqual([2, 4]);
  });
});

describe("caching and disposal (from jqstar)", () => {
  it("caches and clears values and statements by source and location", () => {
    const engine = createTrustedExpressionEngine();
    const location = { attribute: "data-text" };
    const value = engine.compileValue("$count", location);
    const statement = engine.compileStatement("$count += 1", location);

    expect(engine.compileValue("$count", location)).toBe(value);
    expect(engine.compileStatement(" $count += 1 ", location)).toBe(statement);
    expect(engine.compileValue("$count", { attribute: "data-show" })).not.toBe(value);

    engine.clearCache();
    expect(engine.compileValue("$count", location)).not.toBe(value);
    expect(engine.compileStatement("$count += 1", location)).not.toBe(statement);
  });

  it("keeps two engines' caches apart", () => {
    const first = createTrustedExpressionEngine();
    const second = createTrustedExpressionEngine();
    expect(first.compileValue("$a")).not.toBe(second.compileValue("$a"));
  });

  it("disposes once and invalidates retained evaluators", () => {
    const engine = createTrustedExpressionEngine();
    const evaluate = engine.compileValue("$count");
    const { current } = context({ count: 3 });
    expect(evaluate(current)).toBe(3);

    engine.dispose();
    engine.dispose();

    expect(() => evaluate(current)).toThrow("This Tessera expression engine has been disposed.");
    expect(() => engine.compileValue("$count")).toThrow("This Tessera expression engine has been disposed.");
    expect(() => {
      engine.clearCache();
    }).toThrow("This Tessera expression engine has been disposed.");
  });
});
