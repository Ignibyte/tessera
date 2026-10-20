// The reference server's Tessera-Targets parser against the grammar of docs/protocol.md,
// section 4.3: any list of valid entries, with any optional whitespace around the commas, parses
// back to itself; a character outside the grammar makes the header unparseable.
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
const entry = fc.record({ target, props: fc.option(props, { nil: undefined }) }).map(
  ({ target: value, props: token }): TargetEntry => (token === undefined ? { target: value } : { target: value, props: token }),
);
const ows = fc.stringMatching(/^[ \t]{0,2}$/);

function spell(item: TargetEntry): string {
  return item.props === undefined ? item.target : `${item.target} ${item.props}`;
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
    const outside = fc.constantFrom("<", ">", '"', "'", "!", "#", "%", "&", "*", "?", "@", "\\", "é");
    fc.assert(
      fc.property(entry, outside, fc.nat(), (item, character, at) => {
        const spelled = spell(item);
        const index = at % (spelled.length + 1);
        expect(parseTargets(`${spelled.slice(0, index)}${character}${spelled.slice(index)}`)).toBeUndefined();
      }),
      { seed: SEED, numRuns: 500 },
    );
  });

  it("refuses an empty entry", () => {
    expect(parseTargets("")).toBeUndefined();
    expect(parseTargets("content,,sidebar")).toBeUndefined();
  });
});
