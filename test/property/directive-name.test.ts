// Two grammars with fixed seeds: attribute names `data-NAME[:KEY][__MOD[.ARG…]…]` round-trip
// through the parser, and the action rewrite never changes what a string literal holds.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createActionRecorder } from "../../src/actions.ts";
import { parseAttributeName } from "../../src/directive.ts";
import { createTrustedExpressionEngine } from "../../src/expression.ts";

const SEED = 20261020;

const word = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/);
const name = fc.array(word, { minLength: 1, maxLength: 3 }).map((words) => words.join("-"));
const key = fc
  .stringMatching(/^[a-z0-9][a-z0-9._:-]{0,10}$/)
  .filter((value) => !value.includes("__") && !value.endsWith("_"));
const token = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,6}$/).filter((value) => !value.includes("__"));
const modifier = fc.record({ name: token, args: fc.array(token, { maxLength: 3 }) });

describe("parseAttributeName", () => {
  it("round-trips any name the grammar allows", () => {
    fc.assert(
      fc.property(name, fc.option(key, { nil: undefined }), fc.array(modifier, { maxLength: 3 }), (directive, attributeKey, modifiers) => {
        const keyPart = attributeKey === undefined ? "" : `:${attributeKey}`;
        const modifierPart = modifiers.map((entry) => `__${[entry.name, ...entry.args].join(".")}`).join("");
        const attributeName = `data-${directive}${keyPart}${modifierPart}`;
        expect(parseAttributeName(attributeName, "v")).toEqual({
          name: attributeName,
          directive,
          key: attributeKey,
          modifiers,
          value: "v",
        });
      }),
      { seed: SEED, numRuns: 500 },
    );
  });
});

describe("the action rewrite", () => {
  it("leaves string literals as they were", () => {
    const engine = createTrustedExpressionEngine();
    const text = fc.string({ maxLength: 30, unit: fc.constantFrom("a", " ", "@", "(", ")", "'", '"', "`", "\\", "/", "*", "p", "o", "s", "t") });
    fc.assert(
      fc.property(text, (value) => {
        const recorder = createActionRecorder();
        const source = `[${JSON.stringify(value)}, @post('/x')]`;
        const [result] = engine.compileValue(source)({
          element: document.createElement("div"),
          signals: {},
          actions: recorder.seam,
        }) as [string, unknown];
        expect(result).toBe(value);
        expect(recorder.calls.map(({ url }) => url)).toEqual(["/x"]);
      }),
      { seed: SEED, numRuns: 500 },
    );
  });
});
