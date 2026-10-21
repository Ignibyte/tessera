// The no-eval engine under generated input (fixed seed): the tokenizer and parser are total (any
// string parses or fails with a NoEvalError, the same way every time); well-typed expressions give
// the trusted engine's value; and a compound assignment writes only its signal. The totality and
// signal-write properties are ported from jqstar `test/property/csp.property.test.ts`; the
// differential one is new, since Tessera has both engines behind one seam.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ExpressionContext } from "../../src/expression.ts";
import { createTrustedExpressionEngine } from "../../src/expression.ts";
import { createNoEvalExpressionEngine, NoEvalError } from "../../src/noeval/engine.ts";
import { parse } from "../../src/noeval/parser.ts";

const SEED = 20261020;
const RUNS = { seed: SEED, numRuns: 300 };

function context(signals: Record<string, unknown>): ExpressionContext {
  return { element: document.createElement("p"), signals, actions: () => undefined };
}

function outcome(source: string): string {
  try {
    return JSON.stringify(parse(source, "value"));
  } catch (error) {
    if (!(error instanceof NoEvalError)) throw error;
    return JSON.stringify({ code: error.code, span: error.span });
  }
}

type Typed = { readonly source: string; readonly type: "number" | "boolean" | "string" };

/** Expressions whose operands always have the types their operators take. */
const expression: fc.Arbitrary<Typed> = fc.letrec<{ number: Typed; boolean: Typed; string: Typed; any: Typed }>((tie) => {
  const number = tie("number");
  const boolean = tie("boolean");
  const string = tie("string");
  const as = (type: Typed["type"]) => (source: string): Typed => ({ source, type });
  return {
    number: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      fc.integer({ min: -20, max: 20 }).map((n) => as("number")(n < 0 ? `(${String(n)})` : String(n))),
      fc.constant(as("number")("$n")),
      fc.tuple(number, fc.constantFrom("+", "-", "*"), number).map(([a, op, b]) => as("number")(`(${a.source} ${op} ${b.source})`)),
      number.map((a) => as("number")(`(-${a.source})`)),
      fc.tuple(boolean, number, number).map(([c, a, b]) => as("number")(`(${c.source} ? ${a.source} : ${b.source})`)),
    ),
    boolean: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      fc.constantFrom(as("boolean")("true"), as("boolean")("false"), as("boolean")("$b")),
      fc.tuple(number, fc.constantFrom("<", "<=", ">", ">=", "===", "!=="), number).map(([a, op, b]) => as("boolean")(`(${a.source} ${op} ${b.source})`)),
      fc.tuple(string, fc.constantFrom("===", "!==", "<"), string).map(([a, op, b]) => as("boolean")(`(${a.source} ${op} ${b.source})`)),
      boolean.map((a) => as("boolean")(`(!${a.source})`)),
      fc.tuple(boolean, fc.constantFrom("&&", "||", "??"), boolean).map(([a, op, b]) => as("boolean")(`(${a.source} ${op} ${b.source})`)),
    ),
    string: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      fc.constantFrom(as("string")("'a'"), as("string")("'b c'"), as("string")("''"), as("string")("$s")),
      fc.tuple(string, string).map(([a, b]) => as("string")(`(${a.source} + ${b.source})`)),
      fc.tuple(string, number).map(([a, b]) => as("string")(`(${a.source} + ${b.source})`)),
      fc.tuple(boolean, string, string).map(([c, a, b]) => as("string")(`(${c.source} ? ${a.source} : ${b.source})`)),
    ),
    any: fc.oneof(number, boolean, string),
  };
}).any;

describe("the no-eval engine", () => {
  it("tokenizes and parses any string totally and deterministically", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (source) => {
        expect(outcome(source)).toBe(outcome(source));
      }),
      RUNS,
    );
  });

  it("parses any string built from the grammar's own characters totally", () => {
    const unit = fc.constantFrom(..."$abn01 .,;:?!+-*/%<>=&|()[]{}'\"@\\".split(""));
    fc.assert(
      fc.property(fc.string({ unit, maxLength: 80 }), (source) => {
        for (const entry of ["value", "statement"] as const) {
          const failure = ((): unknown => {
            try {
              parse(source, entry);
              return undefined;
            } catch (error) {
              return error;
            }
          })();
          expect(failure === undefined || failure instanceof NoEvalError).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it("gives the trusted engine's value for every well-typed expression", () => {
    const trusted = createTrustedExpressionEngine();
    const noEval = createNoEvalExpressionEngine();
    fc.assert(
      fc.property(expression, fc.integer({ min: -9, max: 9 }), fc.boolean(), fc.constantFrom("", "x", "y z"), ({ source }, n, b, s) => {
        const signals = { n, b, s };
        expect(noEval.compileValue(source)(context({ ...signals }))).toBe(trusted.compileValue(source)(context({ ...signals })));
      }),
      RUNS,
    );
  });

  it("writes only the signal a compound assignment names", async () => {
    const signal = fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/);
    const engine = createNoEvalExpressionEngine();
    await fc.assert(
      fc.asyncProperty(signal.filter((name) => name !== "untouched"), fc.integer({ min: -10_000, max: 10_000 }), fc.integer({ min: -1_000, max: 1_000 }), async (name, initial, increment) => {
        const signals: Record<string, unknown> = { [name]: initial, untouched: "same" };
        await expect(engine.compileStatement(`$${name} += ${String(increment)}; return $${name}`)(context(signals))).resolves.toBe(initial + increment);
        expect(signals).toEqual({ [name]: initial + increment, untouched: "same" });
      }),
      RUNS,
    );
  });
});
