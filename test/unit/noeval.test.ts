// The no-eval engine: the shared conformance cases, with the one adaptation its grammar needs;
// then the tokenizer, the parser and the capability table. The tokenizer and parser cases and the
// denied and adversarial vectors are jqstar's (`test/csp-tokenizer.test.ts`, `csp-parser.test.ts`,
// `test/fixtures/csp/denied.json` and `adversarial.json`) where they apply to Tessera's scope; the
// ones about jqstar's jQuery, `state`, `computed` and stores do not.
import { describe, expect, it, vi } from "vitest";
import type { ActionCall } from "../../src/actions.ts";
import { ExpressionError } from "../../src/expression.ts";
import type { ExpressionContext } from "../../src/expression.ts";
import { createNoEvalExpressionEngine, NOEVAL_LIMITS, NoEvalError } from "../../src/noeval/engine.ts";
import { parse } from "../../src/noeval/parser.ts";
import type { EntryKind } from "../../src/noeval/parser.ts";
import { tokenize } from "../../src/noeval/tokenizer.ts";
import { reactive, Scheduler } from "../../src/reactivity.ts";
import { runExpressionEngineConformance } from "./expression-conformance.ts";

runExpressionEngineConformance("no-eval", createNoEvalExpressionEngine, {
  asyncFailure: {
    source: "await Promise.resolve(); await fail()",
    helpers: { fail: () => Promise.reject(new Error("async expression failure")) },
    reason: "the grammar has no throw or new, so the asynchronous failure is a helper's rejected promise",
  },
});

function noEval(run: () => unknown): NoEvalError {
  try {
    run();
  } catch (error) {
    const cause = error instanceof ExpressionError ? error.cause : error;
    expect(cause).toBeInstanceOf(NoEvalError);
    return cause as NoEvalError;
  }
  throw new Error("Expected a no-eval failure.");
}

function context(signals: Record<string, unknown> = {}, helpers?: Record<string, unknown>): ExpressionContext & { element: HTMLInputElement } {
  const section = document.createElement("section");
  section.id = "outer";
  const element = document.createElement("input");
  element.id = "field";
  element.value = "typed";
  element.dataset.role = "save";
  section.append(element);
  const actions = vi.fn<(call: ActionCall) => unknown>(() => Promise.resolve("done"));
  return { element, signals, event: new KeyboardEvent("keydown", { key: "Enter", cancelable: true }), actions, ...(helpers ? { helpers } : {}) };
}

const engine = createNoEvalExpressionEngine();
const valueOf = (source: string, current: ExpressionContext = context()): unknown => engine.compileValue(source)(current);
const codeOf = (source: string, current: ExpressionContext = context()): string => noEval(() => valueOf(source, current)).code;
const parseCode = (source: string, entry: EntryKind = "value"): string => noEval(() => parse(source, entry)).code;

describe("the tokenizer", () => {
  it("emits its token vocabulary with decoded values and exact spans", () => {
    const tokens = tokenize("$count + format('save', 1.5e+2)\n@post(this)");
    expect(tokens.map(({ kind, value }) => [kind, value])).toEqual([
      ["signal", "count"],
      ["operator", "+"],
      ["identifier", "format"],
      ["punctuator", "("],
      ["string", "save"],
      ["punctuator", ","],
      ["number", 150],
      ["punctuator", ")"],
      ["punctuator", "@"],
      ["identifier", "post"],
      ["punctuator", "("],
      ["keyword", "this"],
      ["punctuator", ")"],
      ["eof", ""],
    ]);
    expect(tokens[8]?.span).toEqual({ startOffset: 32, endOffset: 33, startLine: 2, startColumn: 1, endLine: 2, endColumn: 2 });
    expect(Object.isFrozen(tokens) && tokens.every(Object.isFrozen)).toBe(true);
  });

  it("decodes only JSON's escapes and paired surrogate escapes", () => {
    expect(tokenize(String.raw`'\b\f\n\r\t\\\'\"😀'`)[0]).toMatchObject({ kind: "string", value: "\b\f\n\r\t\\'\"😀" });
    expect(noEval(() => tokenize(String.raw`'\uD83D'`)).code).toBe("NOEVAL_TOKEN_INVALID_ESCAPE");
    expect(noEval(() => tokenize(String.raw`'\uDE00'`)).code).toBe("NOEVAL_TOKEN_INVALID_ESCAPE");
  });

  it.each([
    ["#", "NOEVAL_TOKEN_INVALID_CHARACTER", 0, 1],
    [String.raw`'\x41'`, "NOEVAL_TOKEN_INVALID_ESCAPE", 1, 3],
    ["01", "NOEVAL_TOKEN_NUMBER", 0, 2],
    ["'abc", "NOEVAL_TOKEN_UNTERMINATED_STRING", 0, 4],
    ["1e309", "NOEVAL_TOKEN_NUMBER", 0, 5],
    ["2px", "NOEVAL_TOKEN_NUMBER", 0, 3],
  ])("refuses %j with %s at its span", (source, code, start, end) => {
    const error = noEval(() => tokenize(source));
    expect([error.code, error.span.startOffset, error.span.endOffset]).toEqual([code, start, end]);
  });

  it("holds the source and token limits exactly", () => {
    expect(tokenize("0".padEnd(NOEVAL_LIMITS.sourceLength, " ")).at(-1)?.kind).toBe("eof");
    expect(noEval(() => tokenize("0".padEnd(NOEVAL_LIMITS.sourceLength + 1, " "))).code).toBe("NOEVAL_LIMIT_SOURCE_LENGTH");
    expect(tokenize("!".repeat(NOEVAL_LIMITS.tokens - 2) + "0")).toHaveLength(NOEVAL_LIMITS.tokens);
    expect(noEval(() => tokenize("!".repeat(NOEVAL_LIMITS.tokens - 1) + "0")).code).toBe("NOEVAL_LIMIT_TOKENS");
  });

  it("refuses raw control characters and lone surrogates, and counts lines from the location", () => {
    const control = noEval(() => tokenize("\r\n'bad\u0001'", { attribute: "data-text", line: 4, column: 3 }));
    expect(control).toMatchObject({ code: "NOEVAL_TOKEN_INVALID_CHARACTER", span: { startLine: 5, startColumn: 5, endLine: 5, endColumn: 6 } });
    expect(noEval(() => tokenize(`'${String.fromCharCode(0xd800)}'`)).code).toBe("NOEVAL_TOKEN_INVALID_CHARACTER");
    expect(tokenize(`'${String.fromCharCode(0xd83d, 0xde00)}'`)[0]).toMatchObject({ kind: "string", value: "😀" });
  });
});

describe("the parser", () => {
  it("parses into frozen nodes with spans", () => {
    const tree = parse("$a.b[0] + f(1)", "value");
    expect(tree).toMatchObject({ kind: "binary", operator: "+", left: { kind: "member", property: { kind: "literal", value: 0 } }, right: { kind: "call" } });
    expect(Object.isFrozen(tree)).toBe(true);
    expect(tree.span).toMatchObject({ startOffset: 0, endOffset: 14 });
  });

  it.each([
    ["]", "NOEVAL_PARSE_UNEXPECTED_TOKEN"],
    ["$a[", "NOEVAL_PARSE_EXPECTED_TOKEN"],
    ["$a.", "NOEVAL_PARSE_EXPECTED_TOKEN"],
    ["true false", "NOEVAL_PARSE_TRAILING_INPUT"],
    ["{a:1,'a':2}", "NOEVAL_PARSE_DUPLICATE_KEY"],
    ["{0: 1}", "NOEVAL_PARSE_EXPECTED_TOKEN"],
    ["{__proto__: 1}", "NOEVAL_PARSE_UNSUPPORTED_SYNTAX"],
    ["return 1", "NOEVAL_PARSE_UNEXPECTED_TOKEN"],
    ["await f()", "NOEVAL_PARSE_UNSUPPORTED_SYNTAX"],
    ["1 = 2", "NOEVAL_CAPABILITY_LVALUE"],
    ["f() = 2", "NOEVAL_CAPABILITY_LVALUE"],
    ["@foo('/x')", "NOEVAL_PARSE_ACTION"],
    ["@get", "NOEVAL_PARSE_ACTION"],
    ["$a == 1", "NOEVAL_PARSE_UNSUPPORTED_SYNTAX"],
    ["$a != 1", "NOEVAL_PARSE_UNSUPPORTED_SYNTAX"],
  ])("refuses %j with %s", (source, code) => {
    expect(parseCode(source)).toBe(code);
  });

  // jqstar's unsupported-syntax corpus, as statements.
  it.each([
    "true // comment",
    "true /* comment */",
    "`value`",
    "/value/",
    "let value = 1",
    "() => 1",
    "function () {}",
    "class Value {}",
    "new Date()",
    "if (true) $count = 1",
    "while (true) {}",
    "switch ($count) {}",
    "try {} catch (error) {}",
    "throw 'no'",
    "import('module')",
    "import value from 'module'",
    "$a?.value",
    "$count ??= 1",
    "++$count",
    "[...$a]",
    "[$count] = $a",
    "typeof $a",
    "delete $a.b",
  ])("refuses the statement %j as unsupported syntax", (source) => {
    expect(parseCode(source, "statement")).toBe("NOEVAL_PARSE_UNSUPPORTED_SYNTAX");
  });

  it("holds the nesting, literal, node, path and argument limits", () => {
    expect(parseCode(`${"(".repeat(NOEVAL_LIMITS.nesting + 1)}0${")".repeat(NOEVAL_LIMITS.nesting + 1)}`)).toBe("NOEVAL_LIMIT_NESTING");
    expect(parseCode(`[${Array(NOEVAL_LIMITS.literalEntries + 1).fill("0").join(",")}]`)).toBe("NOEVAL_LIMIT_LITERAL_ENTRIES");
    expect(parseCode(`[${Array(NOEVAL_LIMITS.literalEntries).fill("[-0,0]").join(",")}]`)).toBe("NOEVAL_LIMIT_AST_NODES");
    expect(parse("$a.b.c.d.e.f.g.h.i", "value")).toBeDefined();
    expect(parseCode("$a.b.c.d.e.f.g.h.i.j")).toBe("NOEVAL_LIMIT_PATH_SEGMENTS");
    expect(parseCode("f(0,1,2,3,4,5,6,7,8)")).toBe("NOEVAL_LIMIT_CALL_ARGUMENTS");
  });

  it("leaves names to the evaluator, so a name not in scope fails when the expression runs", () => {
    for (const name of ["eval('1')", "Function('return 1')", "setTimeout('run()', 0)", "globalThis", "window", "document", "self", "top", "parent", "Reflect", "Proxy", "WebAssembly"]) {
      expect(() => parse(name, "value")).not.toThrow();
      expect(codeOf(name)).toBe("NOEVAL_CAPABILITY_IDENTIFIER");
    }
  });
});

describe("values and operators", () => {
  it("reads literals, arrays, objects, signals and their data", () => {
    const signals = { user: { name: "Ada", tags: ["a", "b"] }, count: 2 };
    expect(valueOf("[null, true, 0, 1.5, 'ok', {name: $user.name, n: $count * 2}, $user.tags[1], $user.tags.length]", context(signals))).toEqual([
      null,
      true,
      0,
      1.5,
      "ok",
      { name: "Ada", n: 4 },
      "b",
      2,
    ]);
  });

  it("keeps jqstar's operator rules: finite arithmetic, + joining strings, strict equality, no coercion", () => {
    expect(valueOf("[1 + 2 * 3, 7 % 4, -2, !0, 'a' + 1 + true + null, 2 < 3, 'a' < 'b', 1 === 1, 1 !== '1']")).toEqual([7, 3, -2, true, "a1truenull", true, true, true, true]);
    expect(valueOf("[$x ?? 'fallback', 0 || 'or', 1 && 'and', $x ? 1 : 2]", context({ x: null }))).toEqual(["fallback", "or", "and", 2]);
    expect(codeOf("1 / 0")).toBe("NOEVAL_EVALUATE_NUMBER");
    expect(codeOf("1 < '2'")).toBe("NOEVAL_EVALUATE_TYPE");
    expect(codeOf("'a' - 1")).toBe("NOEVAL_EVALUATE_NUMBER");
    expect(codeOf("'a' + {}")).toBe("NOEVAL_EVALUATE_TYPE");
  });

  it("assigns and updates signals and the data under them", async () => {
    const signals: Record<string, unknown> = { count: 1, user: { name: "Ada" }, items: [1] };
    const result = await engine.compileStatement("$count += 2; $count++; $user.name = 'Grace'; $items[1] = 2; $items.push(3); $fresh = [$count]; return $count")(context(signals));
    expect(result).toBe(4);
    expect(signals).toEqual({ count: 4, user: { name: "Grace" }, items: [1, 2, 3], fresh: [4] });
  });

  it("does not write data that came from elsewhere", async () => {
    const helpers = { config: { mode: "a" }, list: () => [1, 2] };
    await expect(engine.compileStatement("config.mode = 'b'")(context({}, helpers))).rejects.toThrow(/NOEVAL_CAPABILITY_WRITE/);
    expect(codeOf("list().push(3)", context({}, helpers))).toBe("NOEVAL_CAPABILITY_CALL");
    expect(codeOf("[1, 2].push(3)")).toBe("NOEVAL_CAPABILITY_CALL");
  });

  it("goes through the signals object, so an effect tracks what an expression read", async () => {
    const scheduler = new Scheduler();
    const signals = reactive<Record<string, unknown>>({ user: { name: "Ada" } });
    const read = engine.compileValue("$user.name");
    const seen: unknown[] = [];
    scheduler.effect(() => {
      seen.push(read(context(signals)));
    });
    (signals.user as { name: string }).name = "Grace";
    await scheduler.nextUpdate();
    expect(seen).toEqual(["Ada", "Grace"]);
  });
});

describe("the capability table", () => {
  it("lets elements be read, written and focused within their lists", () => {
    const current = context();
    expect(valueOf("[el.id, el.value, el.dataset.role, el.parentElement.id, el.closest('section').id, el.matches('input'), el.localName, this === el]", current)).toEqual([
      "field",
      "typed",
      "save",
      "outer",
      "outer",
      true,
      "input",
      true,
    ]);
    void engine.compileStatement("el.value = ''; el.disabled = true; el.focus()")(current);
    expect([current.element.value, current.element.disabled]).toEqual(["", true]);
    for (const source of ["el.innerHTML", "el.ownerDocument", "el.outerHTML", "el.onclick", "el.style"]) expect(codeOf(source, current)).toBe("NOEVAL_CAPABILITY_PROPERTY");
    expect(codeOf("el.setAttribute('onclick', 'x')", current)).toBe("NOEVAL_CAPABILITY_CALL");
    expect(codeOf("el.closest($sel)", context({ sel: 1 }))).toBe("NOEVAL_CAPABILITY_CALL");
  });

  it("refuses to write an element's markup", async () => {
    await expect(engine.compileStatement("el.innerHTML = '<b>x</b>'")(context())).rejects.toThrow(/NOEVAL_CAPABILITY_WRITE/);
  });

  it("lets events be read and stopped within their lists", () => {
    const current = context();
    expect(valueOf("[evt.type, evt.key, evt.target, evt.ctrlKey]", current)).toEqual(["keydown", "Enter", null, false]);
    expect(valueOf("evt.preventDefault()", current)).toBe(undefined);
    expect(current.event?.defaultPrevented).toBe(true);
    expect(codeOf("evt.view", current)).toBe("NOEVAL_CAPABILITY_PROPERTY");
    expect(codeOf("evt.detail.callback()", { ...current, event: new CustomEvent("x", { detail: { callback: () => 1 } }) })).toBe("NOEVAL_CAPABILITY_CALL");
  });

  it("offers a table of pure built-ins, and refuses the others", () => {
    expect(valueOf("[Math.max(1, $n), Math.PI > 3, JSON.stringify({a: [1]}), JSON.parse('{\"b\":2}').b, Number('4'), String(5), Boolean(''), parseInt('6'), Object.keys({x: 1, y: 2}), Array.isArray([]), encodeURIComponent('a b'), undefined]", context({ n: 9 }))).toEqual([
      9,
      true,
      '{"a":[1]}',
      2,
      4,
      "5",
      false,
      6,
      ["x", "y"],
      true,
      "a%20b",
      undefined,
    ]);
    for (const source of ["new Map()", "Map", "Symbol('x')", "Math.constructor", "Object.assign({}, {})"]) {
      const current = context({ a: 1 }, { fn: () => 1 });
      const failure = noEval(() => (source.startsWith("new") ? parse(source, "value") : valueOf(source, current)));
      expect(["NOEVAL_CAPABILITY_BUILTIN", "NOEVAL_CAPABILITY_PROPERTY", "NOEVAL_PARSE_UNSUPPORTED_SYNTAX", "NOEVAL_CAPABILITY_VALUE"]).toContain(failure.code);
    }
    expect(valueOf("JSON.stringify($a, fn)", context({ a: 1 }, { fn: () => 1 }))).toBe(undefined);
  });

  it("lets helpers be called as registered, and never hands back a function", () => {
    const helpers = { tools: { add: (a: number, b: number) => a + b, functionValue: () => () => 1, value: () => ({ x: 1 }) } };
    expect(valueOf("tools.add(2, 3)", context({}, helpers))).toBe(5);
    expect(codeOf("tools.functionValue()", context({}, helpers))).toBe("NOEVAL_CAPABILITY_VALUE");
    expect(codeOf("tools.functionValue()()", context({}, helpers))).toBe("NOEVAL_CAPABILITY_VALUE");
    expect(codeOf("tools.value().constructor", context({}, helpers))).toBe("NOEVAL_CAPABILITY_PROPERTY");
    expect(codeOf("tools.add", context({}, helpers))).toBe("NOEVAL_CAPABILITY_VALUE");
  });

  // jqstar's adversarial vectors that reach for code through a value.
  it.each([
    "$value.constructor",
    "$value['constructor']",
    String.raw`$value['constructor']`,
    "$value['con' + 'structor']",
    "$value['prototype']",
    "$value['__proto__']",
    "[].constructor.constructor",
    "''.constructor.constructor",
    "el.constructor",
    "evt.constructor",
  ])("refuses %s", (source) => {
    expect(codeOf(source, context({ value: { x: 1 } }))).toBe("NOEVAL_CAPABILITY_PROPERTY");
  });

  it.each(["$fn.call(null)", "$fn.apply(null, [])", "$fn.bind(null)", "$fn()", "$response.callback()"])("refuses the call %s", (source) => {
    expect(codeOf(source, context({ fn: () => 1, response: { callback: () => 1 } }))).toBe("NOEVAL_CAPABILITY_CALL");
  });

  it("refuses accessors in data, absent paths, thenables that are not promises, and oversized collections", async () => {
    const secret = Object.defineProperty({}, "secret", { get: () => "s", enumerable: true });
    expect(codeOf("$data.secret", context({ data: secret }))).toBe("NOEVAL_CAPABILITY_ACCESSOR");
    expect(codeOf("$data.missing.name", context({ data: {} }))).toBe("NOEVAL_PROPERTY_ABSENT");
    await expect(engine.compileStatement("await tools.thenable()")(context({}, { tools: { thenable: () => ({ then: () => undefined }) } }))).rejects.toThrow(/NOEVAL_ASYNC_VALUE/);
    expect(codeOf("$items.length", context({ items: Array(NOEVAL_LIMITS.collectionSize + 1).fill(0) }))).toBe("NOEVAL_LIMIT_COLLECTION_SIZE");
  });

  it("holds the evaluation-step and asynchronous-chain budgets", async () => {
    expect(codeOf(`[${Array(50).fill("[0,0]").join(",")}]`)).toBe("NOEVAL_LIMIT_EVALUATION_STEPS");
    const tick = { tick: () => Promise.resolve(1) };
    const nine = Array(NOEVAL_LIMITS.asyncChain + 1).fill("await tick()").join("; ");
    await expect(engine.compileStatement(nine)(context({}, tick))).rejects.toThrow(/NOEVAL_LIMIT_ASYNC_CHAIN/);
    await expect(engine.compileStatement(Array(NOEVAL_LIMITS.asyncChain).fill("await tick()").join("; "))(context({}, tick))).resolves.toBe(undefined);
  });

  it("sends actions through the seam, anywhere in an expression", async () => {
    const current = context({ id: 4 });
    expect(engine.compileValue("[@get('/a'), 1][1]")(current)).toBe(1);
    await expect(engine.compileStatement("$saving = true; await @post('/items/' + $id, {form: true}); $saving = false")(current)).resolves.toBe(undefined);
    expect(vi.mocked(current.actions).mock.calls.map(([call]) => [call.method, call.url, call.options])).toEqual([
      ["get", "/a", undefined],
      ["post", "/items/4", { form: true }],
    ]);
    expect(current.signals.saving).toBe(false);
  });
});

describe("the engine", () => {
  it("caches compiled expressions, at most 128, and refuses work once disposed", () => {
    const own = createNoEvalExpressionEngine();
    const first = own.compileValue("$a");
    expect(own.compileValue("$a")).toBe(first);
    for (let index = 0; index < 130; index++) own.compileValue(`$a + ${String(index)}`);
    expect(own.compileValue("$a")).not.toBe(first);
    own.dispose();
    expect(() => first(context({ a: 1 }))).toThrow(/disposed/);
    expect(() => own.compileValue("$a")).toThrow(/disposed/);
  });

  it("wraps failures in ExpressionError with the phase, the location and the element", async () => {
    const current = context();
    const location = { attribute: "data-text", line: 3, column: 2 };
    expect(() => engine.compileValue("(", location)).toThrow(expect.objectContaining({ name: "ExpressionError", phase: "compile", location }));
    expect(() => engine.compileValue("window", location)(current)).toThrow(expect.objectContaining({ phase: "evaluate", element: current.element }));
    await expect(engine.compileStatement("window", location)(current)).rejects.toMatchObject({ phase: "evaluate", location });
  });
});
