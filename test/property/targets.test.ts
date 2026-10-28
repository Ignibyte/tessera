// The reference server's Tessera-Targets parser against the grammar of docs/protocol.md,
// section 4.3: any list of valid entries, with or without props and anchors and with any optional
// whitespace around the commas, parses back to itself; a character outside the grammar, or the
// tokens out of order, makes the header unparseable.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseTargets } from "../server/html.ts";
import type { TargetEntry } from "../server/html.ts";

const SEED = 20261020;

const region = fc.stringMatching(/^[a-z][a-z0-9]{0,6}(-[a-z0-9]{1,4}){0,2}$/).filter((name) => name !== "page");
const key = fc.stringMatching(/^[A-Za-z0-9_.:]{1,6}(-[A-Za-z0-9_.:]{1,4}){0,2}$/);
const props = fc.stringMatching(/^[A-Za-z0-9\-_.~+/=]{1,40}$/);
const target = fc.oneof(
  region,
  fc.tuple(fc.oneof(region, fc.constant("page")), fc.array(key, { minLength: 1, maxLength: 4 }))
    .map(([base, keys]) => [base, ...keys].join("/")),
);
const anchor = key;
const entry = fc
  .record({ target, props: fc.option(props, { nil: undefined }), anchor: fc.option(anchor, { nil: undefined }) })
  .map(({ target: value, props: token, anchor: name }): TargetEntry => ({
    target: value,
    ...(token === undefined ? {} : { props: token }),
    ...(name === undefined ? {} : { anchor: name }),
  }));
const ows = fc.stringMatching(/^[ \t]{0,2}$/);

function spell(item: TargetEntry): string {
  return [item.target, ...(item.props === undefined ? [] : [item.props]), ...(item.anchor === undefined ? [] : [`@${item.anchor}`])].join(" ");
}

describe("parseTargets", () => {
  it("round-trips any list of valid entries", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(entry, ows, ows), { minLength: 1, maxLength: 5 }), (items) => {
        const header = items.map(([item, before, after]) => `${before}${spell(item)}${after}`).join(",");
        expect(parseTargets(header)).toEqual(items.map(([item]) => item));
      }),
      { seed: SEED, numRuns: 500 },
    );
  });

  it("refuses an entry holding a character outside the grammar", () => {
    // `@` is left out: it is in the grammar where an anchor starts, and the next test covers it.
    const outside = fc.constantFrom("<", ">", '"', "'", "!", "#", "%", "&", "*", "?", "\\", "é");
    fc.assert(
      fc.property(entry, outside, fc.nat(), (item, character, at) => {
        const spelled = spell(item);
        const index = at % (spelled.length + 1);
        expect(parseTargets(`${spelled.slice(0, index)}${character}${spelled.slice(index)}`)).toBeUndefined();
      }),
      { seed: SEED, numRuns: 500 },
    );
  });

  it("refuses an anchor before the props, a second anchor, and an anchor that is not a key", () => {
    fc.assert(
      fc.property(target, props, anchor, (value, token, name) => {
        expect(parseTargets(`${value} @${name} ${token}`)).toBeUndefined();
        expect(parseTargets(`${value} @${name} @${name}`)).toBeUndefined();
        expect(parseTargets(`${value} ${token}@${name}`)).toBeUndefined();
      }),
      { seed: SEED, numRuns: 500 },
    );
    expect(parseTargets("content/cart @")).toBeUndefined();
    expect(parseTargets("content/cart @two-")).toBeUndefined();
    expect(parseTargets(`content/cart @${"a".repeat(65)}`)).toBeUndefined();
  });

  it("refuses an empty entry", () => {
    expect(parseTargets("")).toBeUndefined();
    expect(parseTargets("content,,sidebar")).toBeUndefined();
  });
});
