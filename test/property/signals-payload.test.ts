// What a request carries, for any tree of signal values (fixed seed): only JSON values, no
// `_` names, and a header that is ASCII and parses back to the payload, or a refusal when it
// is over 4,096 bytes.
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { encodeSignals, MAX_SIGNALS_BYTES } from "../../src/scopes.ts";
import { disposeFixtures, setup } from "../unit/attributes-fixture.ts";

const SEED = 20261020;

afterEach(disposeFixtures);

const name = fc.oneof(fc.stringMatching(/^[a-z]{1,6}$/), fc.stringMatching(/^_[a-z]{1,4}$/));
const leaf = fc.oneof(
  fc.string({ maxLength: 8, unit: "grapheme" }),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(() => 1),
  fc.constant(new Date(0)),
  fc.bigInt(),
);
const { tree } = fc.letrec((tie) => ({
  tree: fc.oneof({ depthSize: "small" }, leaf, tie("array"), tie("object")),
  array: fc.array(tie("tree"), { maxLength: 4 }),
  object: fc.dictionary(name, tie("tree"), { maxKeys: 4 }),
}));

function onlyJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(onlyJson);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, child]) => !key.startsWith("_") && onlyJson(child));
}

describe("the request payload", () => {
  it("holds only JSON values and encodes to ASCII that parses back", () => {
    const { find, mount, signals } = setup(`<p></p>`);
    const element = find("p");
    fc.assert(
      fc.property(fc.dictionary(name, tree, { maxKeys: 5 }), (values) => {
        for (const key of Object.keys(signals)) Reflect.deleteProperty(signals, key);
        Object.assign(signals, values);
        const payload = mount.scopes.payload(element);
        expect(onlyJson(payload)).toBe(true);
        // Each character above U+007E becomes a six-character escape.
        const size = JSON.stringify(payload).replace(/[\u007f-\uffff]/g, "\\u0000").length;
        let outcome: unknown;
        try {
          outcome = encodeSignals(payload);
        } catch (error) {
          outcome = error;
        }
        expect(typeof outcome === "string" ? "encoded" : outcome instanceof RangeError ? "refused" : outcome).toBe(
          size <= MAX_SIGNALS_BYTES ? "encoded" : "refused",
        );
        const header = typeof outcome === "string" ? outcome : JSON.stringify(payload);
        expect(/^[\x20-\x7e]*$/.test(header) || typeof outcome !== "string").toBe(true);
        expect(JSON.parse(header)).toEqual(payload);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});
